/**
 * Reading the current session, server-side.
 *
 * The web app resolves the cookie itself rather than asking the API who is signed in: it owns the
 * browser relationship, and a round trip to answer "is there a session" on every page render
 * would be latency spent on a question a single indexed lookup already answers. The API resolves
 * the same cookie independently through the same `@facturx/auth` code, so neither tier is
 * trusting the other's answer - they are both reading the same row.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  readSessionToken,
  resolveSession,
  secureCookiesEnabled,
  sessionCookieName,
  type AuthenticatedUser,
} from '@facturx/auth';
import { getPrisma, isDatabaseConfigured } from './db';

/** Where an unauthenticated visitor is sent. */
export const SIGN_IN_PATH = '/connexion';

/**
 * The signed-in user, or null.
 *
 * Never throws on a missing or unreachable database: the marketing pages and the public validator
 * share this app and must not go down because Postgres did. They render as signed-out instead.
 */
export async function currentUser(): Promise<AuthenticatedUser | null> {
  if (!isDatabaseConfigured()) return null;

  const store = await cookies();
  const token = store.get(sessionCookieName(secureCookiesEnabled()))?.value ?? null;

  try {
    return await resolveSession(getPrisma(), token);
  } catch {
    return null;
  }
}

/**
 * The signed-in user, or a redirect to sign-in.
 *
 * `next` carries where they were headed so they land there rather than on a dashboard, which
 * matters for a link to a specific invoice sent by email.
 */
export async function requireUser(next?: string): Promise<AuthenticatedUser> {
  const user = await currentUser();
  if (user) return user;

  const target = next ? `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}` : SIGN_IN_PATH;
  redirect(target);
}

/**
 * The raw `Cookie` header to forward to the API.
 *
 * Forwarded verbatim rather than reconstructed, so that whichever cookie name this deployment
 * uses reaches the API unchanged.
 */
export async function sessionCookieHeader(): Promise<string | null> {
  const store = await cookies();
  const all = store.getAll();
  if (all.length === 0) return null;
  return all.map((entry) => `${entry.name}=${entry.value}`).join('; ');
}

export { readSessionToken };
export type { AuthenticatedUser };
