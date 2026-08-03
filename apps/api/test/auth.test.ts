/**
 * The authentication boundary, exercised over real HTTP against a real Postgres.
 *
 * These are the tests that matter most in the whole suite. Everything else protects correctness of
 * a document; this protects one cabinet's client list from another's. So it is deliberately not a
 * unit test of the guard: it boots the actual Nest application and makes actual requests, because
 * the failure mode being guarded against - a route that forgot `@UseGuards`, a tenant read from
 * the body instead of the session - is invisible to a test that calls the service directly.
 *
 * Skipped when Postgres is unavailable:
 *
 *   docker compose up -d postgres
 *   pnpm --filter @facturx/db migrate:deploy
 */

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createSession, registerTenant, sessionCookieName } from '@facturx/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://facturx:facturx_dev_only@localhost:5432/facturx';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const databaseUp = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
if (!databaseUp) {
  console.warn('[auth] skipping: no database. docker compose up -d postgres');
}

const suite = describe.skipIf(!databaseUp);

const PASSWORD = 'un mot de passe assez long';
const run = Date.now();

let app: INestApplication;
let baseUrl: string;
const tenants: string[] = [];

interface Actor {
  readonly tenantId: string;
  readonly userId: string;
  readonly cookie: string;
  clientOrgId: string;
}

async function newActor(label: string): Promise<Actor> {
  const { tenantId, userId } = await registerTenant(prisma, {
    tenantName: `Cabinet ${label}`,
    email: `${label}.${run}@api-test.fr`,
    password: PASSWORD,
  });
  tenants.push(tenantId);

  const { token } = await createSession(prisma, userId);

  const clientOrg = await prisma.clientOrg.create({
    data: {
      tenantId,
      name: `Client de ${label}`,
      // A checksum-valid SIREN; the create route rejects anything else.
      siren: '443061841',
      siret: '44306184100005',
      addressLine1: '1 rue de la Paix',
      postcode: '75002',
      city: 'Paris',
      countryCode: 'FR',
    },
  });

  return {
    tenantId,
    userId,
    cookie: `${sessionCookieName(false)}=${token}`,
    clientOrgId: clientOrg.id,
  };
}

beforeAll(async () => {
  if (!databaseUp) return;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  app = moduleRef.createNestApplication();
  // The same pipe main.ts installs; without it this suite would not be testing the real surface.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.listen(0);

  baseUrl = await app.getUrl().then((url) => url.replace('[::1]', '127.0.0.1'));
});

afterAll(async () => {
  await app?.close();
  if (databaseUp && tenants.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  }
  await prisma.$disconnect();
});

const get = (path: string, cookie?: string): Promise<Response> =>
  fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });

const post = (path: string, body: unknown, cookie?: string): Promise<Response> =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

suite('SessionGuard', () => {
  it('refuses every invoicing route without a session', async () => {
    for (const path of ['/invoices', '/client-orgs']) {
      expect((await get(path)).status).toBe(401);
    }
    expect((await post('/invoices', {})).status).toBe(401);
    expect((await post('/client-orgs', { name: 'X', siren: '443061841' })).status).toBe(401);
  });

  it('refuses a forged, unknown or malformed cookie', async () => {
    for (const cookie of [
      'facturx_session=inventé',
      'facturx_session=',
      'autre_cookie=valeur',
      `${sessionCookieName(false)}=${'a'.repeat(43)}`,
    ]) {
      expect((await get('/invoices', cookie)).status).toBe(401);
    }
  });

  it('admits a live session', async () => {
    const actor = await newActor('admis');
    const response = await get('/invoices', actor.cookie);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 0, invoices: [] });
  });

  it('stops admitting the moment the session is revoked', async () => {
    const actor = await newActor('revoque');
    expect((await get('/invoices', actor.cookie)).status).toBe(200);

    await prisma.session.updateMany({
      where: { userId: actor.userId },
      data: { revokedAt: new Date() },
    });

    // The property that opaque server-side sessions buy over a stateless token: no grace period.
    expect((await get('/invoices', actor.cookie)).status).toBe(401);
  });

  it('stops admitting the moment the account is disabled', async () => {
    const actor = await newActor('desactive');
    expect((await get('/invoices', actor.cookie)).status).toBe(200);

    await prisma.user.update({ where: { id: actor.userId }, data: { disabledAt: new Date() } });
    expect((await get('/invoices', actor.cookie)).status).toBe(401);
  });

  /** The message must be the same for absent, unknown, revoked and disabled. */
  it('does not say which kind of failure it was', async () => {
    const actor = await newActor('opaque');
    await prisma.user.update({ where: { id: actor.userId }, data: { disabledAt: new Date() } });

    const [absent, unknown, disabled] = await Promise.all([
      get('/invoices').then((r) => r.json()),
      get('/invoices', 'facturx_session=inconnu').then((r) => r.json()),
      get('/invoices', actor.cookie).then((r) => r.json()),
    ]);

    expect(absent.message).toBe(unknown.message);
    expect(unknown.message).toBe(disabled.message);
  });
});

suite('tenant isolation', () => {
  it("does not list another tenant's client orgs or invoices", async () => {
    const alice = await newActor('alice');
    const bob = await newActor('bob');

    const aliceOrgs = await get('/client-orgs', alice.cookie).then((r) => r.json());
    const bobOrgs = await get('/client-orgs', bob.cookie).then((r) => r.json());

    expect(aliceOrgs).toHaveLength(1);
    expect(bobOrgs).toHaveLength(1);
    expect(aliceOrgs[0].id).not.toBe(bobOrgs[0].id);
    expect(aliceOrgs[0].id).toBe(alice.clientOrgId);
  });

  it("returns 404, not 403, for another tenant's client org", async () => {
    const alice = await newActor('alice-404');
    const bob = await newActor('bob-404');

    // 404 rather than 403 on purpose: 403 confirms the id exists, which is itself a leak.
    expect((await get(`/client-orgs/${bob.clientOrgId}`, alice.cookie)).status).toBe(404);
    expect((await get(`/client-orgs/${alice.clientOrgId}`, alice.cookie)).status).toBe(200);
  });

  /**
   * The attack the guard exists to stop: a well-formed request naming someone else's client org.
   * `IssuanceService` scopes its lookup by the session's tenant, so the org is simply not found.
   */
  it("refuses to issue against another tenant's client org", async () => {
    const alice = await newActor('alice-emission');
    const bob = await newActor('bob-emission');

    const response = await post(
      '/invoices',
      {
        clientOrgId: bob.clientOrgId,
        invoiceNumber: `TENTATIVE-${run}`,
        issueDate: '2026-09-03',
        buyer: {
          name: 'Client Test',
          address: { line1: '2 rue Test', postcode: '75001', city: 'Paris', countryCode: 'FR' },
        },
        lines: [
          {
            name: 'Prestation',
            quantity: '1',
            unitCode: 'C62',
            unitPrice: '100.00',
            vatCategory: 'S',
            vatRatePercent: '20.00',
          },
        ],
      },
      alice.cookie,
    );

    expect(response.status).toBe(404);
    expect(await prisma.invoice.count({ where: { tenantId: bob.tenantId } })).toBe(0);
  });
});

suite('request validation', () => {
  it('rejects unknown fields rather than silently dropping them', async () => {
    const actor = await newActor('champs');

    const response = await post(
      '/client-orgs',
      { name: 'Test', siren: '443061841', tenantId: 'un-autre-tenant' },
      actor.cookie,
    );

    // `forbidNonWhitelisted` matters most for exactly this field: a body that names a tenant must
    // be refused outright, not accepted with the field quietly ignored.
    expect(response.status).toBe(400);
  });

  it('checks the SIREN and SIRET checksums, not just their shape', async () => {
    const actor = await newActor('checksum');

    const badSiren = await post('/client-orgs', { name: 'X', siren: '123456789' }, actor.cookie);
    expect(badSiren.status).toBe(400);

    const mismatched = await post(
      '/client-orgs',
      { name: 'X', siren: '443061841', siret: '55208131766522' },
      actor.cookie,
    );
    expect(mismatched.status).toBe(400);
  });

  it('rejects a float where an exact decimal string is required', async () => {
    const actor = await newActor('decimal');

    const response = await post(
      '/invoices',
      {
        clientOrgId: actor.clientOrgId,
        invoiceNumber: `DEC-${run}`,
        issueDate: '2026-09-03',
        buyer: {
          name: 'Client',
          address: { line1: '2 rue Test', postcode: '75001', city: 'Paris', countryCode: 'FR' },
        },
        lines: [
          {
            name: 'Prestation',
            quantity: 1,
            unitCode: 'C62',
            unitPrice: 100.5,
            vatCategory: 'S',
            vatRatePercent: '20.00',
          },
        ],
      },
      actor.cookie,
    );

    expect(response.status).toBe(400);
  });
});
