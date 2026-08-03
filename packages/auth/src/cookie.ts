/**
 * The session cookie.
 *
 * Written by hand rather than through a cookie library because there are exactly two operations
 * here and both are security-relevant enough to want visible: the attribute set is the CSRF
 * defence, not an implementation detail.
 *
 * `SameSite=Lax` is that defence. The browser will not attach this cookie to a cross-site POST,
 * and every state-changing route in the platform is a POST, so a form on an attacker's page
 * cannot act as the signed-in user. Top-level GET navigation still carries it, which is what
 * makes an emailed link to an invoice work.
 */

/** Name used when the cookie can carry `Secure`, i.e. anywhere real. */
const SECURE_NAME = '__Host-facturx_session';
/** Fallback for plain-HTTP local development, where a `__Host-` cookie would be rejected. */
const INSECURE_NAME = 'facturx_session';

/**
 * `__Host-` is not decoration. It tells the browser to refuse the cookie unless it is `Secure`,
 * path `/`, and carries no `Domain` - which means a sibling subdomain, including one taken over
 * by someone else, cannot overwrite our session cookie.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_NAME : INSECURE_NAME;
}

/** True unless explicitly disabled; production must not be one env var away from insecure. */
export function secureCookiesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.AUTH_COOKIE_SECURE === 'true') return true;
  if (env.AUTH_COOKIE_SECURE === 'false') return false;
  return env.NODE_ENV === 'production';
}

export interface CookieOptions {
  readonly secure: boolean;
  /** Cookie lifetime in seconds. Zero clears it. */
  readonly maxAgeSeconds: number;
}

/** Serialises the `Set-Cookie` value for a session token. */
export function serialiseSessionCookie(token: string, options: CookieOptions): string {
  const parts = [
    `${sessionCookieName(options.secure)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Serialises the `Set-Cookie` values that clear the session.
 *
 * Both names are cleared, not just the one this deployment currently writes: an environment that
 * has just been moved behind TLS will still have the old cookie sitting in browsers, and a
 * sign-out that leaves it there is a sign-out that did not sign the user out.
 */
export function clearSessionCookies(): string[] {
  return [SECURE_NAME, INSECURE_NAME].map((name) => {
    const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (name === SECURE_NAME) parts.push('Secure');
    return parts.join('; ');
  });
}

/**
 * Extracts the session token from a raw `Cookie` header.
 *
 * The secure name wins when both are present, so that a lingering plain-HTTP cookie cannot be
 * used to downgrade a session on a deployment that has since been secured.
 */
export function readSessionToken(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;

  const found = new Map<string, string>();
  for (const pair of cookieHeader.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    if (name !== SECURE_NAME && name !== INSECURE_NAME) continue;
    found.set(name, pair.slice(eq + 1).trim());
  }

  return found.get(SECURE_NAME) ?? found.get(INSECURE_NAME) ?? null;
}
