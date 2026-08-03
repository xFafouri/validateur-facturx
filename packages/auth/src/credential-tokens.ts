/**
 * One-time links: password reset, and invitations.
 *
 * Both are the same primitive - a high-entropy token that stands in for a password exactly once -
 * so they share an implementation rather than acquiring two subtly different ones. The security
 * properties are the same as `Session`, for the same reasons:
 *
 *  - the token is 256 bits of CSPRNG output and carries no claims;
 *  - only its SHA-256 is stored, so a leaked backup yields nothing usable;
 *  - it is checked against the database on use, so revoking it takes effect immediately.
 *
 * Two things are specific to one-time links and worth stating:
 *
 *  - **Issuing a new one invalidates the old.** Otherwise a user who clicks "forgot password"
 *    three times leaves three live links in three emails, and the attacker only needs whichever
 *    mailbox is weakest.
 *  - **Consuming is atomic.** `updateMany` with `usedAt: null` in the predicate means two
 *    simultaneous submissions of the same link cannot both succeed - the database decides, not a
 *    read-then-write in application code.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { CredentialTokenPurpose, PrismaClient } from '@prisma/client';
import type { SessionDb } from './session.js';

/** A reset link is a live credential in a mailbox. Short, but long enough to act on unhurried. */
export const PASSWORD_RESET_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Invitations last longer than resets.
 *
 * A reset is answered within minutes by someone already at their keyboard. An invitation arrives
 * unannounced, often to someone who is not expecting it and may be away - and an expired
 * invitation costs an administrator a second round trip rather than costing the user a password.
 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface IssuedCredentialToken {
  /** Goes in the emailed link. Returned here and nowhere else; never stored, never logged. */
  readonly token: string;
  readonly tokenId: string;
  readonly expiresAt: Date;
}

/** Hex SHA-256. The lookup key; not reversible to a usable link. */
export function hashCredentialToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** base64url so the token survives a URL without escaping, and a mail client without wrapping. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function ttlFor(purpose: CredentialTokenPurpose): number {
  return purpose === 'INVITATION' ? INVITATION_TTL_MS : PASSWORD_RESET_TTL_MS;
}

/**
 * Issues a link, invalidating any earlier live one for the same user and purpose.
 *
 * Runs in the caller's transaction when one is given, so that issuing a token and creating the
 * user it belongs to commit together.
 */
export async function issueCredentialToken(
  db: SessionDb,
  input: {
    readonly userId: string;
    readonly purpose: CredentialTokenPurpose;
    readonly createdByUserId?: string | null;
    readonly now?: Date;
  },
): Promise<IssuedCredentialToken> {
  const now = input.now ?? new Date();
  const token = newToken();
  const expiresAt = new Date(now.getTime() + ttlFor(input.purpose));

  // Superseded, not deleted: "this link was replaced by a newer one" stays answerable.
  await db.credentialToken.updateMany({
    where: {
      userId: input.userId,
      purpose: input.purpose,
      usedAt: null,
      invalidatedAt: null,
    },
    data: { invalidatedAt: now },
  });

  const row = await db.credentialToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: hashCredentialToken(token),
      expiresAt,
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
    },
    select: { id: true },
  });

  return { token, tokenId: row.id, expiresAt };
}

/** Why a link did not work. Distinguished because the right thing to tell the user differs. */
export type CredentialTokenFailure = 'unknown' | 'expired' | 'used' | 'superseded' | 'disabled';

export interface CredentialTokenHolder {
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly tenantId: string;
  readonly tokenId: string;
  readonly purpose: CredentialTokenPurpose;
}

export type CredentialTokenCheck =
  | { readonly ok: true; readonly holder: CredentialTokenHolder }
  | { readonly ok: false; readonly reason: CredentialTokenFailure };

/**
 * Checks a link without consuming it, so a page can be rendered before the user submits.
 *
 * Unlike sign-in, the failures are reported distinctly. There is no enumeration risk here - the
 * caller already holds a 256-bit secret, so telling them it expired discloses nothing they could
 * not learn by trying - and "this link has expired, ask for a new one" is far more useful than a
 * blanket refusal that leaves someone retrying the same dead link.
 */
export async function checkCredentialToken(
  db: SessionDb,
  token: string | null | undefined,
  purpose: CredentialTokenPurpose,
  now: Date = new Date(),
): Promise<CredentialTokenCheck> {
  if (!token) return { ok: false, reason: 'unknown' };

  const row = await db.credentialToken.findUnique({
    where: { tokenHash: hashCredentialToken(token) },
    include: {
      user: { select: { id: true, email: true, name: true, tenantId: true, disabledAt: true } },
    },
  });

  if (!row || row.purpose !== purpose) return { ok: false, reason: 'unknown' };
  if (row.usedAt !== null) return { ok: false, reason: 'used' };
  if (row.invalidatedAt !== null) return { ok: false, reason: 'superseded' };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (row.user.disabledAt !== null) return { ok: false, reason: 'disabled' };

  return {
    ok: true,
    holder: {
      userId: row.user.id,
      email: row.user.email,
      name: row.user.name,
      tenantId: row.user.tenantId,
      tokenId: row.id,
      purpose: row.purpose,
    },
  };
}

/**
 * Marks a link used, and only succeeds once.
 *
 * The `usedAt: null` predicate is what makes that true under concurrency: two submissions race,
 * the database serialises them, and exactly one sees a row updated. A read-then-write would let
 * both through.
 */
export async function consumeCredentialToken(
  db: SessionDb,
  tokenId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { count } = await db.credentialToken.updateMany({
    where: { id: tokenId, usedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return count === 1;
}

/**
 * Deletes tokens that expired long enough ago to be of no forensic interest.
 *
 * Not called automatically. Left for a scheduled job, because a table that quietly deletes its own
 * rows during a request is a table nobody can reason about during an incident.
 */
export async function purgeExpiredCredentialTokens(
  db: PrismaClient,
  olderThan: Date,
): Promise<number> {
  const { count } = await db.credentialToken.deleteMany({
    where: { expiresAt: { lt: olderThan } },
  });
  return count;
}
