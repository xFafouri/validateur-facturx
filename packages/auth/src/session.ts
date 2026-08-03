/**
 * Server-side sessions.
 *
 * The token in the cookie is opaque - 256 bits of CSPRNG output carrying no claims - and every
 * request resolves it against the `Session` table. That is a database read per request, which a
 * signed self-contained token would avoid, and the trade is made deliberately:
 *
 *  - **Revocation is immediate.** Signing out, disabling an account, or ending every session
 *    after a laptop is stolen takes effect on the next request. A stateless token stays valid
 *    until it expires, whatever the database says, and "valid for another week" is not an
 *    acceptable answer for a system holding ten years of a client's tax records.
 *  - **The API can verify callers itself.** Both the web app and the API read the same table, so
 *    the API never has to take the web tier's word for who is calling. There is no shared signing
 *    secret to rotate and no trusted header to spoof if the web app is ever reached directly.
 *
 * Only the SHA-256 of the token is stored; see the note on `Session.tokenHash` in the schema.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient, UserRole } from '@prisma/client';

/** Rolling lifetime. Extended while the session is used, so an active user is not logged out. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hard cap from creation, which sliding never extends.
 *
 * Without it a session that is used often enough never ends, and a token stolen from a browser
 * that stays open is good indefinitely.
 */
export const SESSION_ABSOLUTE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How stale `lastSeenAt` may get before a request bothers to write.
 *
 * Sliding expiry on every request would mean a write on every page load, including on the
 * navigation-heavy invoice list. An hour of imprecision on a seven-day window costs nothing.
 */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** Any Prisma client, including one inside a transaction. */
export type SessionDb = PrismaClient | Prisma.TransactionClient;

/** Who is making a request, resolved from a session token. */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: UserRole;
  readonly sessionId: string;
}

export interface SessionOrigin {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface IssuedSession {
  readonly token: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

/** Hex SHA-256. The lookup key; never reversible to a usable cookie. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Base64url over 32 random bytes.
 *
 * base64url rather than hex so the cookie stays short, and rather than plain base64 because `+`
 * and `/` are not safe in a cookie value without quoting.
 */
function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Opens a session for a user and returns the token to put in the cookie.
 *
 * The token is returned here and nowhere else: it is never written to the database, never logged,
 * and cannot be recovered afterwards. Losing it means the user signs in again, which is the
 * correct failure mode.
 */
export async function createSession(
  db: SessionDb,
  userId: string,
  origin: SessionOrigin = {},
  now: Date = new Date(),
): Promise<IssuedSession> {
  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);

  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      lastSeenAt: now,
      createdAt: now,
      // Truncated: a User-Agent is attacker-controlled and unbounded, and this column exists for
      // "was that me?" in a session list, not for analytics.
      ipAddress: origin.ipAddress ?? null,
      userAgent: origin.userAgent?.slice(0, 400) ?? null,
    },
    select: { id: true },
  });

  return { token, sessionId: session.id, expiresAt };
}

/**
 * Resolves a session token to the acting user, or null.
 *
 * Null covers every failure the same way - unknown token, expired, revoked, disabled account -
 * because the caller has no legitimate use for the distinction and an error message that made it
 * would be an oracle.
 *
 * Slides the expiry as a side effect when the session is being actively used.
 */
export async function resolveSession(
  db: SessionDb,
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        select: {
          id: true,
          tenantId: true,
          email: true,
          name: true,
          role: true,
          disabledAt: true,
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  if (session.createdAt.getTime() + SESSION_ABSOLUTE_MAX_AGE_MS <= now.getTime()) return null;
  if (session.user.disabledAt !== null) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    const slidTo = new Date(now.getTime() + SESSION_MAX_AGE_MS);
    const absoluteEnd = new Date(session.createdAt.getTime() + SESSION_ABSOLUTE_MAX_AGE_MS);
    await db.session.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        expiresAt: slidTo < absoluteEnd ? slidTo : absoluteEnd,
      },
    });
  }

  return {
    userId: session.user.id,
    tenantId: session.user.tenantId,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sessionId: session.id,
  };
}

/**
 * Ends one session. Idempotent, and silent when the token is unknown.
 *
 * The row is marked rather than deleted, so an incident review can still answer when a session
 * started and when it ended.
 */
export async function revokeSession(
  db: SessionDb,
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (!token) return;
  await db.session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Ends every live session for a user. Used on password change and when disabling an account. */
export async function revokeAllSessions(
  db: SessionDb,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return count;
}

/**
 * Constant-time equality for two session identifiers.
 *
 * Exposed for callers comparing a token against one they already hold; the resolve path uses an
 * indexed lookup on a hash, where timing carries no secret.
 */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
