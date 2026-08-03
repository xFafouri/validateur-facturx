import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyPassword,
  WeakPasswordError,
  MIN_PASSWORD_LENGTH,
  SCRYPT_PARAMS,
} from '../src/password.js';

const GOOD = 'correcte batterie agrafe cheval';

describe('hashPassword', () => {
  it('produces a self-describing digest carrying its own parameters', async () => {
    const hash = await hashPassword(GOOD);
    const [scheme, N, r, p, salt, key] = hash.split('$');

    expect(scheme).toBe('scrypt');
    expect(Number(N)).toBe(SCRYPT_PARAMS.N);
    expect(Number(r)).toBe(SCRYPT_PARAMS.r);
    expect(Number(p)).toBe(SCRYPT_PARAMS.p);
    expect(Buffer.from(salt as string, 'base64')).toHaveLength(16);
    expect(Buffer.from(key as string, 'base64')).toHaveLength(32);
  });

  it('salts, so the same password never yields the same digest twice', async () => {
    const [a, b] = await Promise.all([hashPassword(GOOD), hashPassword(GOOD)]);
    expect(a).not.toBe(b);
    await expect(verifyPassword(GOOD, a)).resolves.toBe(true);
    await expect(verifyPassword(GOOD, b)).resolves.toBe(true);
  });

  it('refuses a password below the minimum length', async () => {
    await expect(hashPassword('court')).rejects.toBeInstanceOf(WeakPasswordError);
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull();
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a near miss', async () => {
    const hash = await hashPassword(GOOD);
    await expect(verifyPassword(GOOD, hash)).resolves.toBe(true);
    await expect(verifyPassword(`${GOOD} `, hash)).resolves.toBe(false);
    await expect(verifyPassword(GOOD.toUpperCase(), hash)).resolves.toBe(false);
  });

  /**
   * `é` typed as one code point and as `e` + U+0301 are indistinguishable on screen, and a French
   * user switching keyboard or operating system can produce either. Without NFC normalisation
   * that user is locked out of their own account with a password that looks correct.
   */
  it('treats canonically equivalent Unicode as the same password', async () => {
    const composed = 'trésorerie-2026-ok';
    const decomposed = composed.normalize('NFD');

    expect(composed).not.toBe(decomposed);
    const hash = await hashPassword(composed);
    await expect(verifyPassword(decomposed, hash)).resolves.toBe(true);
  });

  it('returns false, rather than throwing, for a null or corrupt digest', async () => {
    await expect(verifyPassword(GOOD, null)).resolves.toBe(false);
    await expect(verifyPassword(GOOD, 'not-a-digest')).resolves.toBe(false);
    await expect(verifyPassword(GOOD, 'scrypt$0$0$0$$')).resolves.toBe(false);
    await expect(verifyPassword(GOOD, 'bcrypt$12$abc$def')).resolves.toBe(false);
  });

  /**
   * The property that keeps sign-in from answering "does this address have an account here?".
   * Timing is noisy, so this asserts the weak form that actually holds on a shared CI runner: the
   * no-account path still costs a full scrypt, rather than returning immediately.
   */
  it('spends real work on an absent account instead of returning early', async () => {
    const hash = await hashPassword(GOOD);

    const timeOf = async (stored: string | null): Promise<number> => {
      const start = process.hrtime.bigint();
      await verifyPassword('une tentative quelconque', stored);
      return Number(process.hrtime.bigint() - start) / 1e6;
    };

    const withAccount = await timeOf(hash);
    const withoutAccount = await timeOf(null);

    expect(withoutAccount).toBeGreaterThan(withAccount / 4);
  });
});

describe('needsRehash', () => {
  it('flags digests made with weaker parameters, and passes current ones', async () => {
    expect(needsRehash(await hashPassword(GOOD))).toBe(false);
    expect(needsRehash('scrypt$16384$8$1$c2FsdA==$a2V5')).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });
});
