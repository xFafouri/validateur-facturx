/**
 * One-time links, against a real Postgres.
 *
 * The properties under test are properties of the database - a link works exactly once even when
 * submitted twice at the same instant, issuing a new one kills the old, a used row is
 * distinguishable from one that never existed. A mocked client would prove none of them.
 */

import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { registerTenant } from '../src/accounts.js';
import { authenticate } from '../src/accounts.js';
import {
  checkCredentialToken,
  hashCredentialToken,
  issueCredentialToken,
  PASSWORD_RESET_TTL_MS,
} from '../src/credential-tokens.js';
import { requestPasswordReset, setPasswordWithToken } from '../src/password-reset.js';
import { createSession, resolveSession } from '../src/session.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://facturx:facturx_dev_only@localhost:5432/facturx';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
const databaseUp = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
if (!databaseUp) console.warn('[reset] skipping: no database.');

const suite = describe.skipIf(!databaseUp);

const run = Date.now();
const PASSWORD = 'un mot de passe assez long';
const NEW_PASSWORD = 'un tout autre mot de passe';
const tenants: string[] = [];

async function newAccount(label: string): Promise<{ userId: string; email: string }> {
  const email = `${label}.${run}@reset-test.fr`;
  const account = await registerTenant(prisma, {
    tenantName: `Cabinet ${label}`,
    email,
    password: PASSWORD,
  });
  tenants.push(account.tenantId);
  return { userId: account.userId, email };
}

afterAll(async () => {
  if (databaseUp && tenants.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  }
  await prisma.$disconnect();
});

suite('requesting a reset', () => {
  it('issues a link for a real account, storing only its hash', async () => {
    const { userId, email } = await newAccount('demande');

    const { issued } = await requestPasswordReset(prisma, email);
    expect(issued).not.toBeNull();
    expect(issued!.email).toBe(email);

    const row = await prisma.credentialToken.findUniqueOrThrow({
      where: { id: issued!.tokenId },
    });
    expect(row.userId).toBe(userId);
    expect(row.purpose).toBe('PASSWORD_RESET');
    expect(row.tokenHash).toBe(hashCredentialToken(issued!.token));
    // The property that matters: the emailed value is not recoverable from the row.
    expect(row.tokenHash).not.toContain(issued!.token);
  });

  /** The caller must answer identically either way; this is the half that lets it. */
  it('returns nothing for an unknown address, without throwing', async () => {
    const { issued } = await requestPasswordReset(prisma, `personne.${run}@reset-test.fr`);
    expect(issued).toBeNull();
  });

  it('is case-insensitive on the address', async () => {
    const { email } = await newAccount('casse');
    const { issued } = await requestPasswordReset(prisma, email.toUpperCase());
    expect(issued).not.toBeNull();
  });

  /** A reset is not a way back into a disabled account, and must not suggest it is. */
  it('issues nothing for a disabled account', async () => {
    const { userId, email } = await newAccount('desactive');
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });

    const { issued } = await requestPasswordReset(prisma, email);
    expect(issued).toBeNull();
  });

  /**
   * Otherwise clicking "forgot password" three times leaves three live links in three emails, and
   * an attacker only needs whichever mailbox is weakest.
   */
  it('invalidates the previous link when a new one is issued', async () => {
    const { email } = await newAccount('remplace');

    const first = (await requestPasswordReset(prisma, email)).issued!;
    const second = (await requestPasswordReset(prisma, email)).issued!;

    expect(await checkCredentialToken(prisma, first.token, 'PASSWORD_RESET')).toMatchObject({
      ok: false,
      reason: 'superseded',
    });
    expect(await checkCredentialToken(prisma, second.token, 'PASSWORD_RESET')).toMatchObject({
      ok: true,
    });
  });
});

suite('setting a password from a link', () => {
  it('sets the password and lets the user sign in with it', async () => {
    const { email } = await newAccount('applique');
    const { issued } = await requestPasswordReset(prisma, email);

    const outcome = await setPasswordWithToken(prisma, {
      token: issued!.token,
      password: NEW_PASSWORD,
      purpose: 'PASSWORD_RESET',
    });
    expect(outcome.ok).toBe(true);

    expect(await authenticate(prisma, email, NEW_PASSWORD)).not.toBeNull();
    expect(await authenticate(prisma, email, PASSWORD)).toBeNull();
  });

  /**
   * A reset is what someone does when they think they have been compromised. Leaving the
   * attacker's session alive would defeat the entire point of the exercise.
   */
  it('ends every existing session', async () => {
    const { userId, email } = await newAccount('sessions');
    const live = await createSession(prisma, userId);
    expect(await resolveSession(prisma, live.token)).not.toBeNull();

    const { issued } = await requestPasswordReset(prisma, email);
    await setPasswordWithToken(prisma, {
      token: issued!.token,
      password: NEW_PASSWORD,
      purpose: 'PASSWORD_RESET',
    });

    expect(await resolveSession(prisma, live.token)).toBeNull();
  });

  it('refuses a second use of the same link', async () => {
    const { email } = await newAccount('unique');
    const { issued } = await requestPasswordReset(prisma, email);

    expect(
      (
        await setPasswordWithToken(prisma, {
          token: issued!.token,
          password: NEW_PASSWORD,
          purpose: 'PASSWORD_RESET',
        })
      ).ok,
    ).toBe(true);

    const again = await setPasswordWithToken(prisma, {
      token: issued!.token,
      password: 'encore un autre mot de passe',
      purpose: 'PASSWORD_RESET',
    });
    expect(again).toMatchObject({ ok: false, reason: 'used' });
  });

  /**
   * Two submissions landing together must not both succeed. The `usedAt: null` predicate in the
   * consuming update is what makes the database decide rather than application code.
   */
  it('lets exactly one of two simultaneous submissions win', async () => {
    const { email } = await newAccount('course');
    const { issued } = await requestPasswordReset(prisma, email);

    const attempt = () =>
      setPasswordWithToken(prisma, {
        token: issued!.token,
        password: NEW_PASSWORD,
        purpose: 'PASSWORD_RESET',
      });

    const results = await Promise.all([attempt(), attempt()]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it('refuses an expired link', async () => {
    const { userId } = await newAccount('expire');
    const issued = await issueCredentialToken(prisma, {
      userId,
      purpose: 'PASSWORD_RESET',
      now: new Date(Date.now() - PASSWORD_RESET_TTL_MS - 60_000),
    });

    const outcome = await setPasswordWithToken(prisma, {
      token: issued.token,
      password: NEW_PASSWORD,
      purpose: 'PASSWORD_RESET',
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('refuses an invented link', async () => {
    const outcome = await setPasswordWithToken(prisma, {
      token: 'jamais-emis',
      password: NEW_PASSWORD,
      purpose: 'PASSWORD_RESET',
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'unknown' });
  });

  /** A reset link must not activate an invitation, or the reverse. */
  it('refuses a link issued for the other purpose', async () => {
    const { userId } = await newAccount('objet');
    const invitation = await issueCredentialToken(prisma, { userId, purpose: 'INVITATION' });

    const outcome = await setPasswordWithToken(prisma, {
      token: invitation.token,
      password: NEW_PASSWORD,
      purpose: 'PASSWORD_RESET',
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'unknown' });
  });

  /** A typo must not burn the link and send the user back to their mailbox. */
  it('leaves the link usable when the new password is too weak', async () => {
    const { email } = await newAccount('faible');
    const { issued } = await requestPasswordReset(prisma, email);

    const rejected = await setPasswordWithToken(prisma, {
      token: issued!.token,
      password: 'court',
      purpose: 'PASSWORD_RESET',
    });
    expect(rejected).toMatchObject({ ok: false, reason: 'weak' });

    const retried = await setPasswordWithToken(prisma, {
      token: issued!.token,
      password: NEW_PASSWORD,
      purpose: 'PASSWORD_RESET',
    });
    expect(retried.ok).toBe(true);
  });
});

suite('invitations', () => {
  it('activates an account that has no password yet', async () => {
    const { tenantId } = await registerTenant(prisma, {
      tenantName: 'Cabinet Invitations',
      email: `hote.${run}@reset-test.fr`,
      password: PASSWORD,
    });
    tenants.push(tenantId);

    const invitee = await prisma.user.create({
      data: {
        tenantId,
        email: `invite.${run}@reset-test.fr`,
        role: 'ACCOUNTANT',
        // No password: an invited user cannot sign in until they set one.
        passwordHash: null,
      },
      select: { id: true, email: true },
    });

    expect(await authenticate(prisma, invitee.email, NEW_PASSWORD)).toBeNull();

    const issued = await issueCredentialToken(prisma, {
      userId: invitee.id,
      purpose: 'INVITATION',
    });
    const outcome = await setPasswordWithToken(prisma, {
      token: issued.token,
      password: NEW_PASSWORD,
      purpose: 'INVITATION',
    });

    expect(outcome.ok).toBe(true);
    expect(await authenticate(prisma, invitee.email, NEW_PASSWORD)).not.toBeNull();
  });
});
