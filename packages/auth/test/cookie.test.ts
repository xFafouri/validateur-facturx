import { describe, expect, it } from 'vitest';
import {
  clearSessionCookies,
  readSessionToken,
  secureCookiesEnabled,
  serialiseSessionCookie,
  sessionCookieName,
} from '../src/cookie.js';

describe('serialiseSessionCookie', () => {
  it('carries the attributes that make the cookie the CSRF defence', () => {
    const cookie = serialiseSessionCookie('abc123', { secure: true, maxAgeSeconds: 3600 });

    expect(cookie).toContain('__Host-facturx_session=abc123');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=3600');
  });

  /** A `__Host-` cookie without `Secure` is rejected by the browser, so the name has to follow. */
  it('drops the __Host- prefix when the cookie cannot be Secure', () => {
    const cookie = serialiseSessionCookie('abc123', { secure: false, maxAgeSeconds: 60 });

    expect(cookie).toContain('facturx_session=abc123');
    expect(cookie).not.toContain('__Host-');
    expect(cookie).not.toContain('Secure');
  });

  it('never emits a negative Max-Age', () => {
    expect(serialiseSessionCookie('t', { secure: false, maxAgeSeconds: -10 })).toContain(
      'Max-Age=0',
    );
  });
});

describe('clearSessionCookies', () => {
  /** A deployment moved behind TLS still has the old cookie in browsers; both must be cleared. */
  it('clears both names, so a sign-out is a sign-out on either scheme', () => {
    const cookies = clearSessionCookies();

    expect(cookies).toHaveLength(2);
    expect(cookies.join('\n')).toContain('__Host-facturx_session=');
    expect(cookies.join('\n')).toContain('facturx_session=');
    for (const cookie of cookies) expect(cookie).toContain('Max-Age=0');
  });
});

describe('readSessionToken', () => {
  it('finds the cookie among others', () => {
    expect(readSessionToken('theme=dark; facturx_session=tok-1; other=x')).toBe('tok-1');
  });

  it('returns null when absent or when there is no header at all', () => {
    expect(readSessionToken('theme=dark')).toBeNull();
    expect(readSessionToken('')).toBeNull();
    expect(readSessionToken(null)).toBeNull();
    expect(readSessionToken(undefined)).toBeNull();
  });

  /**
   * A subdomain an attacker controls can set a host-wide `facturx_session`, but cannot touch a
   * `__Host-` cookie. Preferring the secure name means such an injection cannot downgrade a
   * session on a deployment that is already behind TLS.
   */
  it('prefers the __Host- cookie when both are present', () => {
    expect(readSessionToken('facturx_session=injected; __Host-facturx_session=real')).toBe('real');
    expect(readSessionToken('__Host-facturx_session=real; facturx_session=injected')).toBe('real');
  });

  it('ignores malformed pairs rather than throwing', () => {
    expect(readSessionToken('novalue; ; facturx_session=tok')).toBe('tok');
  });
});

describe('secureCookiesEnabled', () => {
  it('defaults to on in production and off elsewhere', () => {
    expect(secureCookiesEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
    expect(secureCookiesEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('can be overridden explicitly, for TLS-terminating proxies in development', () => {
    expect(
      secureCookiesEnabled({
        NODE_ENV: 'development',
        AUTH_COOKIE_SECURE: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      secureCookiesEnabled({
        NODE_ENV: 'production',
        AUTH_COOKIE_SECURE: 'false',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe('sessionCookieName', () => {
  it('is the __Host- prefixed name exactly when secure', () => {
    expect(sessionCookieName(true)).toBe('__Host-facturx_session');
    expect(sessionCookieName(false)).toBe('facturx_session');
  });
});
