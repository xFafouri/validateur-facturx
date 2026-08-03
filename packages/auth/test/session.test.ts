/**
 * Sessions and sign-in, against a real Postgres.
 *
 * Mocking Prisma here would test the mock. The properties that matter - a token is unusable once
 * revoked, an expired row does not resolve, the absolute cap survives sliding, a unique index
 * decides a registration race - are all properties of the database, not of the call sequence.
 *
 * Skipped when Postgres is unavailable, so `pnpm test` still works on a bare machine:
 *
 *   docker compose up -d postgres
 *   pnpm --filter @facturx/db migrate:deploy
 */

import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import {
  authenticate,
  normaliseEmail,
  registerTenant,
  RegistrationError,
} from '../src/accounts.js';
import {
  createSession,
  hashSessionToken,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  SESSION_ABSOLUTE_MAX_AGE_MS,
  SESSION_MAX_AGE_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from '../src/session.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://facturx:facturx_dev_only@localhost:5432/facturx';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

// Probed at module load: `describe.skipIf` is evaluated during collection, before any hook runs.
const databaseUp = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
if (!databaseUp) {
  console.warn(
    '[auth] skipping session suite: no database. ' +
      'docker compose up -d postgres && pnpm --filter @facturx/db migrate:deploy',
  );
}

const suite = describe.skipIf(!databaseUp);

const PASSWORD = 'un mot de passe assez long';
const run = Date.now();
const emailFor = (label: string): string => `${label}.${run}@cabinet-test.fr`;

const createdTenants: string[] = [];

async function newAccount(label: string): Promise<{ tenantId: string; userId: string }> {
  const account = await registerTenant(prisma, {
    tenantName: `Cabinet ${label}`,
    email: emailFor(label),
    password: PASSWORD,
  });
  createdTenants.push(account.tenantId);
  return account;
}

afterAll(async () => {
  if (databaseUp && createdTenants.length > 0) {
    // Cascades to users, sessions and audit rows.
    await prisma.tenant.deleteMany({ where: { id: { in: createdTenants } } });
  }
  await prisma.$disconnect();
});

suite('registerTenant', () => {
  it('creates the tenant and its first user as OWNER, in one transaction', async () => {
    const { tenantId, userId } = await newAccount('owner');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.tenantId).toBe(tenantId);
    expect(user.role).toBe('OWNER');
    expect(user.passwordHash).toMatch(/^scrypt\$/);

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId, action: 'tenant.registered' },
    });
    expect(audit).not.toBeNull();
  });

  it('stores the email lowercased, so case cannot create a second account', async () => {
    const email = emailFor('casse');
    const { tenantId } = await registerTenant(prisma, {
      tenantName: 'Cabinet Casse',
      email: email.toUpperCase(),
      password: PASSWORD,
    });
    createdTenants.push(tenantId);

    const user = await prisma.user.findUnique({ where: { email: normaliseEmail(email) } });
    expect(user).not.toBeNull();

    await expect(
      registerTenant(prisma, { tenantName: 'Doublon', email, password: PASSWORD }),
    ).rejects.toBeInstanceOf(RegistrationError);
  });

  it('rejects a weak password and an invalid address before writing anything', async () => {
    await expect(
      registerTenant(prisma, { tenantName: 'X', email: emailFor('faible'), password: 'court' }),
    ).rejects.toBeInstanceOf(RegistrationError);

    await expect(
      registerTenant(prisma, { tenantName: 'X', email: 'pas-une-adresse', password: PASSWORD }),
    ).rejects.toBeInstanceOf(RegistrationError);

    expect(await prisma.user.findUnique({ where: { email: emailFor('faible') } })).toBeNull();
  });

  /**
   * Two submissions of the same form landing together both pass the pre-check. The unique index
   * is what actually decides, and its verdict has to arrive as a domain error the user can act
   * on rather than as a raw Prisma failure.
   */
  it('lets the unique index settle a concurrent double submission', async () => {
    const email = emailFor('course');
    const attempt = (): Promise<{ tenantId: string }> =>
      registerTenant(prisma, { tenantName: 'Cabinet Course', email, password: PASSWORD });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RegistrationError);

    createdTenants.push(
      (fulfilled[0] as PromiseFulfilledResult<{ tenantId: string }>).value.tenantId,
    );
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });
});

suite('authenticate', () => {
  it('accepts the right password and records the sign-in', async () => {
    const { userId } = await newAccount('connexion');

    const result = await authenticate(prisma, emailFor('connexion'), PASSWORD);
    expect(result?.userId).toBe(userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.lastLoginAt).not.toBeNull();
  });

  it('is case-insensitive on the address', async () => {
    await newAccount('casse2');
    const result = await authenticate(prisma, emailFor('casse2').toUpperCase(), PASSWORD);
    expect(result).not.toBeNull();
  });

  it('returns null for a wrong password, an unknown address and a disabled account alike', async () => {
    const { userId } = await newAccount('refus');

    expect(await authenticate(prisma, emailFor('refus'), 'mauvais mot de passe')).toBeNull();
    expect(await authenticate(prisma, emailFor('inexistant'), PASSWORD)).toBeNull();

    await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    expect(await authenticate(prisma, emailFor('refus'), PASSWORD)).toBeNull();
  });
});

suite('sessions', () => {
  it('issues a token that resolves to the user, and stores only its hash', async () => {
    const { userId, tenantId } = await newAccount('session');

    const { token, sessionId } = await createSession(prisma, userId, {
      ipAddress: '203.0.113.7',
      userAgent: 'vitest',
    });

    const resolved = await resolveSession(prisma, token);
    expect(resolved).toMatchObject({ userId, tenantId, sessionId, role: 'OWNER' });

    const row = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.tokenHash).toBe(hashSessionToken(token));
    // The property the schema note claims: the cookie value is not recoverable from the row.
    expect(row.tokenHash).not.toContain(token);
  });

  it('does not resolve an unknown, revoked or expired token', async () => {
    const { userId } = await newAccount('rejet');

    expect(await resolveSession(prisma, 'jamais-emis')).toBeNull();
    expect(await resolveSession(prisma, null)).toBeNull();
    expect(await resolveSession(prisma, '')).toBeNull();

    const revoked = await createSession(prisma, userId);
    await revokeSession(prisma, revoked.token);
    expect(await resolveSession(prisma, revoked.token)).toBeNull();

    const expired = await createSession(prisma, userId);
    await prisma.session.update({
      where: { id: expired.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await resolveSession(prisma, expired.token)).toBeNull();
  });

  it('stops resolving as soon as the account is disabled', async () => {
    const { userId } = await newAccount('desactive');
    const { token } = await createSession(prisma, userId);

    expect(await resolveSession(prisma, token)).not.toBeNull();
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    expect(await resolveSession(prisma, token)).toBeNull();
  });

  it('revokes every live session at once', async () => {
    const { userId } = await newAccount('revoque-tout');
    const a = await createSession(prisma, userId);
    const b = await createSession(prisma, userId);

    expect(await revokeAllSessions(prisma, userId)).toBe(2);
    expect(await resolveSession(prisma, a.token)).toBeNull();
    expect(await resolveSession(prisma, b.token)).toBeNull();
  });

  it('slides the expiry only once the touch interval has passed', async () => {
    const { userId } = await newAccount('glissement');
    const { token, sessionId } = await createSession(prisma, userId);

    const before = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    await resolveSession(prisma, token);
    const unchanged = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    // A page load a second later must not cost a write.
    expect(unchanged.expiresAt.getTime()).toBe(before.expiresAt.getTime());

    const stale = new Date(Date.now() - SESSION_TOUCH_INTERVAL_MS - 60_000);
    await prisma.session.update({ where: { id: sessionId }, data: { lastSeenAt: stale } });

    await resolveSession(prisma, token);
    const slid = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(slid.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  /**
   * The reason the absolute cap exists: without it, a session used often enough never ends, and a
   * token lifted from a browser that stays open is good forever.
   */
  it('never slides a session past the absolute cap', async () => {
    const { userId } = await newAccount('plafond');
    const { token, sessionId } = await createSession(prisma, userId);

    // Created 29 days ago and still in use: sliding would take it well past the 30-day cap.
    const createdAt = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    await prisma.session.update({
      where: { id: sessionId },
      data: { createdAt, lastSeenAt: createdAt },
    });

    expect(await resolveSession(prisma, token)).not.toBeNull();

    const slid = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    const cap = createdAt.getTime() + SESSION_ABSOLUTE_MAX_AGE_MS;
    expect(slid.expiresAt.getTime()).toBeLessThanOrEqual(cap);
    expect(slid.expiresAt.getTime()).toBeLessThan(Date.now() + SESSION_MAX_AGE_MS);
  });

  it('refuses a session that is past the absolute cap even though its own expiry is future', async () => {
    const { userId } = await newAccount('plafond-depasse');
    const { token, sessionId } = await createSession(prisma, userId);

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        createdAt: new Date(Date.now() - SESSION_ABSOLUTE_MAX_AGE_MS - 1000),
        expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS),
      },
    });

    expect(await resolveSession(prisma, token)).toBeNull();
  });

  it('issues a fresh token per sign-in, so a session cannot be fixed in advance', async () => {
    const { userId } = await newAccount('fixation');
    const first = await createSession(prisma, userId);
    const second = await createSession(prisma, userId);

    expect(first.token).not.toBe(second.token);
    expect(first.sessionId).not.toBe(second.sessionId);
  });
});
