'use server';

/**
 * Sign-in, registration and sign-out.
 *
 * Server Actions rather than route handlers: the forms work without JavaScript, which for a tool
 * accountants will open on locked-down office machines is worth more than a smoother transition.
 *
 * CSRF has two independent defences here. The session cookie is `SameSite=Lax`, so a cross-site
 * POST does not carry it at all, and Next.js checks Origin against Host on every Server Action.
 * Neither is relied on alone.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  authenticate,
  clearSessionCookies,
  createSession,
  registerTenant,
  revokeSession,
  secureCookiesEnabled,
  sessionCookieName,
  RegistrationError,
  SESSION_MAX_AGE_MS,
} from '@facturx/auth';
import { getPrisma, isDatabaseConfigured } from '@/lib/db';
import { SIGN_IN_PATH } from '@/lib/session';
import type { FormState } from '@/lib/form-state';
import { checkRateLimit, clientKeyFromHeaders, type RateLimitConfig } from '@/lib/rate-limit';
import { headers } from 'next/headers';

/** Where a user lands after signing in, when they were not headed anywhere in particular. */
const HOME_PATH = '/tableau-de-bord';

/**
 * Sign-in attempts, per client address.
 *
 * Tighter than the waitlist limit because the thing being guessed is a password. Six in a burst
 * covers a person who genuinely cannot remember which of their passwords it is; one every thirty
 * seconds after that makes online guessing pointless without locking out the account itself -
 * which would hand an attacker a denial of service against a named user.
 */
const SIGN_IN_LIMIT: RateLimitConfig = { capacity: 6, refillPerSecond: 1 / 30 };

/** Registration is cheap for us and expensive to spam-clean, so it is capped harder. */
const REGISTER_LIMIT: RateLimitConfig = { capacity: 3, refillPerSecond: 1 / 300 };

async function rateLimited(config: RateLimitConfig, bucket: string): Promise<boolean> {
  const requestHeaders = await headers();
  const key = `${bucket}:${clientKeyFromHeaders(requestHeaders)}`;
  return !checkRateLimit(key, config).allowed;
}

/** Writes the session cookie. Shared so registration and sign-in cannot diverge on flags. */
async function setSessionCookie(token: string): Promise<void> {
  const secure = secureCookiesEnabled();
  const store = await cookies();

  store.set(sessionCookieName(secure), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
}

/**
 * A destination supplied in the query string.
 *
 * Only same-origin absolute paths are honoured. Without this check `?next=https://evil.example`
 * turns our sign-in page into an open redirect, which is a phishing primitive: the link genuinely
 * starts on our domain.
 */
function safeNext(next: unknown): string {
  if (typeof next !== 'string') return HOME_PATH;
  if (!next.startsWith('/') || next.startsWith('//')) return HOME_PATH;
  return next;
}

async function origin(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const requestHeaders = await headers();
  return {
    ipAddress: clientKeyFromHeaders(requestHeaders),
    userAgent: requestHeaders.get('user-agent'),
  };
}

export async function signIn(_state: FormState, formData: FormData): Promise<FormState> {
  if (!isDatabaseConfigured()) {
    return { error: 'La connexion est momentanément indisponible. Réessayez plus tard.' };
  }

  if (await rateLimited(SIGN_IN_LIMIT, 'signin')) {
    return { error: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.' };
  }

  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = safeNext(formData.get('next'));

  if (email === '' || password === '') {
    return { error: 'Renseignez votre adresse e-mail et votre mot de passe.' };
  }

  const prisma = getPrisma();
  const account = await authenticate(prisma, email, password);
  if (!account) {
    // One message for a wrong password and for an address with no account. Distinguishing them
    // would confirm to anyone who asks which addresses have accounts here.
    return { error: 'Adresse e-mail ou mot de passe incorrect.' };
  }

  // A fresh session per sign-in, never a reused one: a token planted in the browser beforehand
  // must not become an authenticated session when the user signs in.
  const { token } = await createSession(prisma, account.userId, await origin());
  await setSessionCookie(token);

  redirect(next);
}

export async function register(_state: FormState, formData: FormData): Promise<FormState> {
  if (!isDatabaseConfigured()) {
    return { error: 'La création de compte est momentanément indisponible. Réessayez plus tard.' };
  }

  if (await rateLimited(REGISTER_LIMIT, 'register')) {
    return { error: 'Trop de tentatives. Réessayez dans quelques minutes.' };
  }

  const password = String(formData.get('password') ?? '');
  if (password !== String(formData.get('passwordConfirm') ?? '')) {
    return { error: 'Les deux mots de passe ne correspondent pas.' };
  }

  const prisma = getPrisma();

  let account;
  try {
    account = await registerTenant(prisma, {
      tenantName: String(formData.get('tenantName') ?? ''),
      email: String(formData.get('email') ?? ''),
      password,
      name: String(formData.get('name') ?? '') || null,
    });
  } catch (error) {
    if (error instanceof RegistrationError) return { error: error.message };
    console.error('[register] unexpected failure', error);
    return { error: 'La création du compte a échoué. Réessayez plus tard.' };
  }

  const { token } = await createSession(prisma, account.userId, await origin());
  await setSessionCookie(token);

  // Straight to adding a business: an empty account can do nothing until there is one to invoice
  // on behalf of, and a dashboard that only says "no data" is not a useful first screen.
  redirect('/clients/nouveau?bienvenue=1');
}

export async function signOut(): Promise<void> {
  const secure = secureCookiesEnabled();
  const store = await cookies();
  const token = store.get(sessionCookieName(secure))?.value ?? null;

  if (token && isDatabaseConfigured()) {
    // Revoked server-side, not merely forgotten client-side. Clearing the cookie alone would
    // leave a token that still works to anyone who captured it.
    await revokeSession(getPrisma(), token).catch(() => undefined);
  }

  // Both names, so a deployment that has moved behind TLS does not leave the old cookie behind.
  for (const cookie of clearSessionCookies()) {
    const name = cookie.slice(0, cookie.indexOf('='));
    store.set(name, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: name.startsWith('__Host-'),
      path: '/',
      maxAge: 0,
    });
  }

  redirect(SIGN_IN_PATH);
}
