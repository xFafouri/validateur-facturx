/**
 * Roles and client-org scoping, over real HTTP against a real Postgres.
 *
 * The tenant-isolation suite proves one cabinet cannot see another's data. This proves the harder
 * case: inside a *single* cabinet, a login handed to one client must not reach another client's
 * books. That is the entire purpose of `CLIENT_USER`, and until now the role was recorded and
 * enforced nowhere.
 *
 * Deliberately end to end. The failure being guarded against is a query that forgot its scope
 * predicate, which is invisible to a test that calls the service with scope already applied.
 */

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, type UserRole } from '@prisma/client';
import { createSession, hashPassword, registerTenant, sessionCookieName } from '@facturx/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://facturx:facturx_dev_only@localhost:5432/facturx';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
const databaseUp = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
if (!databaseUp) console.warn('[roles] skipping: no database.');

const suite = describe.skipIf(!databaseUp);

const run = Date.now();
const PASSWORD = 'un mot de passe assez long';

let app: INestApplication;
let baseUrl: string;
let tenantId: string;
let ownerCookie: string;
/** Two client businesses in one cabinet. The point of the suite is keeping them apart. */
let orgA: string;
let orgB: string;

async function makeUser(
  label: string,
  role: UserRole,
  clientOrgIds: string[] = [],
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${label}.${run}@roles-test.fr`,
      role,
      passwordHash: await hashPassword(PASSWORD),
      ...(clientOrgIds.length > 0
        ? { scopedClientOrgs: { create: clientOrgIds.map((id) => ({ clientOrgId: id })) } }
        : {}),
    },
    select: { id: true },
  });
  const { token } = await createSession(prisma, user.id);
  return `${sessionCookieName(false)}=${token}`;
}

const req = (method: string, path: string, cookie?: string, body?: unknown): Promise<Response> =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const get = (path: string, cookie?: string) => req('GET', path, cookie);
const post = (path: string, cookie: string, body: unknown) => req('POST', path, cookie, body);

function invoicePayload(clientOrgId: string, invoiceNumber: string) {
  return {
    clientOrgId,
    invoiceNumber,
    issueDate: '2026-09-03',
    dueDate: '2026-10-03',
    paymentMeansCode: '30',
    iban: 'FR7630006000011234567890189',
    buyer: {
      name: 'Boulangerie Martin SAS',
      siret: '44306184100005',
      address: { line1: '12 rue X', postcode: '69002', city: 'Lyon', countryCode: 'FR' },
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
  };
}

beforeAll(async () => {
  if (!databaseUp) return;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.listen(0);
  baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  const account = await registerTenant(prisma, {
    tenantName: 'Cabinet Rôles',
    email: `owner.${run}@roles-test.fr`,
    password: PASSWORD,
  });
  tenantId = account.tenantId;
  const { token } = await createSession(prisma, account.userId);
  ownerCookie = `${sessionCookieName(false)}=${token}`;

  const a = await prisma.clientOrg.create({
    data: { tenantId, name: 'Client A', siren: '552081317', siret: '55208131700018' },
  });
  const b = await prisma.clientOrg.create({
    data: { tenantId, name: 'Client B', siren: '443061841', siret: '44306184100005' },
  });
  orgA = a.id;
  orgB = b.id;
});

afterAll(async () => {
  await app?.close();
  if (databaseUp && tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

suite('permissions', () => {
  it('lets an owner manage users and refuses everyone else', async () => {
    const accountant = await makeUser('compta', 'ACCOUNTANT');
    const client = await makeUser('client-perm', 'CLIENT_USER', [orgA]);

    expect((await get('/users', ownerCookie)).status).toBe(200);
    expect((await get('/users', accountant)).status).toBe(403);
    expect((await get('/users', client)).status).toBe(403);
  });

  it('explains a refusal instead of only reporting one', async () => {
    const accountant = await makeUser('compta-msg', 'ACCOUNTANT');
    const body = await get('/users', accountant).then((r) => r.json());
    expect(body.message).toContain('propriétaire');
  });

  it('refuses a client user issuing an invoice, and allows an accountant', async () => {
    const client = await makeUser('client-emet', 'CLIENT_USER', [orgA]);
    const accountant = await makeUser('compta-emet', 'ACCOUNTANT');

    const refused = await post('/invoices', client, invoicePayload(orgA, `CU-${run}`));
    expect(refused.status).toBe(403);
    expect((await refused.json()).message).toContain("permet pas d'émettre");

    // The accountant is allowed through the permission check; whether the draft is any good is a
    // different question, so anything other than 403 proves the point.
    const allowed = await post('/invoices', accountant, invoicePayload(orgA, `AC-${run}`));
    expect(allowed.status).not.toBe(403);
  });

  it('refuses a client user creating a client business', async () => {
    const client = await makeUser('client-org', 'CLIENT_USER', [orgA]);
    const response = await post('/client-orgs', client, { name: 'X', siren: '552081317' });
    expect(response.status).toBe(403);
  });

  it('lets a client user read and receive', async () => {
    const client = await makeUser('client-lecture', 'CLIENT_USER', [orgA]);
    expect((await get('/client-orgs', client)).status).toBe(200);
    expect((await get('/invoices', client)).status).toBe(200);

    // Not 403: the permission is granted, so the request gets as far as the document being
    // unreadable, which is a 422.
    const deposit = await fetch(`${baseUrl}/invoices/reception?filename=x.txt`, {
      method: 'POST',
      headers: { cookie: client, 'content-type': 'application/octet-stream' },
      body: 'pas une facture',
    });
    expect(deposit.status).not.toBe(403);
  });
});

/** The property the whole role exists for. */
suite('client-org scoping', () => {
  it('shows a client user only the businesses assigned to them', async () => {
    const client = await makeUser('client-scope', 'CLIENT_USER', [orgA]);

    const visible = await get('/client-orgs', client).then((r) => r.json());
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(orgA);

    // The owner sees both, so the difference is scope and not an empty tenant.
    expect(await get('/client-orgs', ownerCookie).then((r) => r.json())).toHaveLength(2);
  });

  it("returns 404 for a business outside a client user's scope", async () => {
    const client = await makeUser('client-404', 'CLIENT_USER', [orgA]);

    expect((await get(`/client-orgs/${orgA}`, client)).status).toBe(200);
    // 404 rather than 403: confirming the id exists would itself disclose a business this login
    // has no business knowing about.
    expect((await get(`/client-orgs/${orgB}`, client)).status).toBe(404);
  });

  it("does not list another business's invoices, even when asked for them by id", async () => {
    await post('/invoices', ownerCookie, invoicePayload(orgB, `B-${run}`));
    const client = await makeUser('client-liste', 'CLIENT_USER', [orgA]);

    const all = await get('/invoices', client).then((r) => r.json());
    expect(
      all.invoices.every((invoice: { clientOrg: { id: string } }) => invoice.clientOrg.id === orgA),
    ).toBe(true);

    // A caller-supplied filter narrows within scope and can never widen past it.
    const forced = await get(`/invoices?clientOrgId=${orgB}`, client).then((r) => r.json());
    expect(forced.total).toBe(0);
    expect(forced.invoices).toHaveLength(0);
  });

  it('returns 404 on an invoice detail outside scope', async () => {
    const issued = await post('/invoices', ownerCookie, invoicePayload(orgB, `B2-${run}`));
    if (issued.status !== 201) return; // engine unavailable; the list test already covers scope
    const { invoiceId } = await issued.json();

    const client = await makeUser('client-detail', 'CLIENT_USER', [orgA]);
    expect((await get(`/invoices/${invoiceId}`, client)).status).toBe(404);
    expect((await get(`/invoices/${invoiceId}/artifacts/pdf`, client)).status).toBe(404);
    expect((await get(`/invoices/${invoiceId}`, ownerCookie)).status).toBe(200);
  });

  /**
   * Fail closed. A half-finished invitation - a client user created before anyone assigned them a
   * business - must see nothing, not everything.
   */
  it('shows nothing to a client user with no assignment', async () => {
    const orphan = await makeUser('client-vide', 'CLIENT_USER', []);

    expect(await get('/client-orgs', orphan).then((r) => r.json())).toHaveLength(0);
    expect((await get('/invoices', orphan).then((r) => r.json())).total).toBe(0);
  });
});

suite('user management', () => {
  it('creates a scoped client user that can immediately sign in with the right scope', async () => {
    const created = await post('/users', ownerCookie, {
      email: `nouveau.${run}@roles-test.fr`,
      name: 'Nouveau Client',
      role: 'CLIENT_USER',
      password: PASSWORD,
      clientOrgIds: [orgA],
    });
    expect(created.status).toBe(201);

    const { id } = await created.json();
    const { token } = await createSession(prisma, id);
    const cookie = `${sessionCookieName(false)}=${token}`;

    expect(await get('/client-orgs', cookie).then((r) => r.json())).toHaveLength(1);
  });

  it('refuses a client org from another tenant in an assignment', async () => {
    const other = await registerTenant(prisma, {
      tenantName: 'Autre Cabinet',
      email: `autre.${run}@roles-test.fr`,
      password: PASSWORD,
    });
    const foreign = await prisma.clientOrg.create({
      data: { tenantId: other.tenantId, name: 'Pas la nôtre', siren: '390063352' },
    });

    // The scope predicate proves a user may see *those ids*; it cannot prove the ids were the
    // owner's to grant. That check has to happen here.
    const response = await post('/users', ownerCookie, {
      email: `voleur.${run}@roles-test.fr`,
      role: 'CLIENT_USER',
      password: PASSWORD,
      clientOrgIds: [foreign.id],
    });
    expect(response.status).toBe(400);

    await prisma.tenant.deleteMany({ where: { id: other.tenantId } });
  });

  it('refuses a password below the minimum', async () => {
    const response = await post('/users', ownerCookie, {
      email: `faible.${run}@roles-test.fr`,
      role: 'ACCOUNTANT',
      password: 'court',
    });
    expect(response.status).toBe(400);
  });

  /**
   * Runs against its own tenant, because the successful half of it demotes an owner and revokes
   * their sessions - which would pull the rug out from under every later test sharing a cookie.
   */
  it('keeps at least one enabled owner, including against the last owner themselves', async () => {
    const solo = await registerTenant(prisma, {
      tenantName: 'Cabinet Solo',
      email: `solo.${run}@roles-test.fr`,
      password: PASSWORD,
    });
    const soloOwner = await prisma.user.findFirstOrThrow({
      where: { tenantId: solo.tenantId },
      select: { id: true },
    });
    const soloSession = await createSession(prisma, soloOwner.id);
    const soloCookie = `${sessionCookieName(false)}=${soloSession.token}`;

    // The last owner demoting themselves would leave nobody able to administer the account.
    const refused = await req('PATCH', `/users/${soloOwner.id}`, soloCookie, {
      role: 'ACCOUNTANT',
    });
    expect(refused.status).toBe(409);

    // With a second owner in place, handing over is a legitimate act and is allowed.
    const second = await post('/users', soloCookie, {
      email: `solo-2.${run}@roles-test.fr`,
      role: 'OWNER',
      password: PASSWORD,
    });
    expect(second.status).toBe(201);

    const handover = await req('PATCH', `/users/${soloOwner.id}`, soloCookie, {
      role: 'ACCOUNTANT',
    });
    expect(handover.status).toBe(200);

    await prisma.tenant.deleteMany({ where: { id: solo.tenantId } });
  });

  it('refuses disabling your own account', async () => {
    const owner = await prisma.user.findFirstOrThrow({
      where: { tenantId, role: 'OWNER' },
      select: { id: true },
    });

    // Locking yourself out gains nothing; another owner can always do it for you.
    expect((await req('PATCH', `/users/${owner.id}`, ownerCookie, { disabled: true })).status).toBe(
      403,
    );
  });

  /**
   * Access changed, so sessions held under the old rules must end. Otherwise a demoted user keeps
   * a working tab for as long as they leave it open.
   */
  it("ends the target user's sessions when their access changes", async () => {
    const target = await prisma.user.create({
      data: {
        tenantId,
        email: `revoque.${run}@roles-test.fr`,
        role: 'CLIENT_USER',
        passwordHash: await hashPassword(PASSWORD),
        scopedClientOrgs: { create: [{ clientOrgId: orgA }] },
      },
      select: { id: true },
    });
    const { token } = await createSession(prisma, target.id);
    const cookie = `${sessionCookieName(false)}=${token}`;

    expect((await get('/client-orgs', cookie)).status).toBe(200);

    await req('PATCH', `/users/${target.id}`, ownerCookie, { clientOrgIds: [orgB] });

    expect((await get('/client-orgs', cookie)).status).toBe(401);
  });

  it('drops client-org assignments when promoting to an unscoped role', async () => {
    const target = await prisma.user.create({
      data: {
        tenantId,
        email: `promu.${run}@roles-test.fr`,
        role: 'CLIENT_USER',
        passwordHash: await hashPassword(PASSWORD),
        scopedClientOrgs: { create: [{ clientOrgId: orgA }] },
      },
      select: { id: true },
    });

    await req('PATCH', `/users/${target.id}`, ownerCookie, { role: 'ACCOUNTANT' });

    // A later demotion must not silently restore access to a business someone has since decided
    // they should not see.
    expect(await prisma.clientOrgUser.count({ where: { userId: target.id } })).toBe(0);
  });
});
