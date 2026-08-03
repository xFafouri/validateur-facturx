/**
 * Password hashing.
 *
 * scrypt from `node:crypto`, not bcrypt or argon2. Both of those are native addons, and this
 * package is compiled into a Docker image and a Next.js server bundle; a memory-hard KDF that is
 * already in the Node runtime avoids a build toolchain in the image and a whole class of
 * "works on my machine" failures, at no cost in strength. scrypt is memory-hard, which is the
 * property that matters against GPU cracking.
 *
 * The digest is self-describing - parameters travel with the hash - so raising the cost later
 * does not invalidate existing passwords. `needsRehash` reports which stored digests are below
 * the current cost so they can be upgraded on the next successful sign-in.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Cost parameters for new hashes. Raise `N` over time; old digests keep working. */
export const SCRYPT_PARAMS = {
  /** CPU/memory cost. 2^15 needs 32 MiB per hash and takes roughly 100 ms on server hardware. */
  N: 32768,
  r: 8,
  p: 1,
} as const;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * Node's default `maxmem` is exactly 32 MiB, and scrypt at N=2^15, r=8 needs 128·N·r = 32 MiB
 * plus overhead - so the default rejects our own parameters. Doubling it leaves room to raise N
 * one more notch without revisiting this.
 */
const MAX_MEM = 128 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r * 2;

/**
 * A hash of a random string, used when there is no stored password to check against.
 *
 * Computed once at module load. Sign-in must take the same time whether or not the account
 * exists, otherwise response latency answers "is this address registered here?" for anyone who
 * asks - which for an accountancy product is a client list.
 */
let decoyHash: Promise<string> | null = null;
function decoy(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(24).toString('base64'));
  return decoyHash;
}

/** Rejected before hashing. Length is the control that matters; composition rules are theatre. */
export const MIN_PASSWORD_LENGTH = 12;
/**
 * scrypt has no bcrypt-style 72-byte truncation, so this is only a denial-of-service bound on how
 * much data we agree to run a deliberately expensive function over.
 */
export const MAX_PASSWORD_LENGTH = 512;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeakPasswordError';
  }
}

/**
 * Checks a candidate password against the minimum policy.
 *
 * Returns the French message to show the user, or null when acceptable.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Le mot de passe ne peut pas dépasser ${MAX_PASSWORD_LENGTH} caractères.`;
  }
  return null;
}

/**
 * Hashes a password into `scrypt$N$r$p$salt$key`, both binary fields base64.
 *
 * Normalises to NFC first: `é` can be typed as one code point or as `e` plus a combining accent,
 * they look identical, and without normalisation a French user who set their password on one
 * keyboard layout could not sign in from another.
 */
export async function hashPassword(password: string): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) throw new WeakPasswordError(problem);

  const salt = randomBytes(SALT_LENGTH);
  const { N, r, p } = SCRYPT_PARAMS;
  const key = await scrypt(password.normalize('NFC'), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });

  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

interface ParsedHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // A digest is attacker-influenced only if the database is already compromised, but parameters
  // read back from storage still drive an allocation, so they are bounded rather than trusted.
  if (N < 1024 || N > 1 << 22 || r < 1 || r > 64 || p < 1 || p > 16) return null;

  const salt = Buffer.from(parts[4] as string, 'base64');
  const key = Buffer.from(parts[5] as string, 'base64');
  if (salt.length === 0 || key.length === 0) return null;

  return { N, r, p, salt, key };
}

/**
 * Verifies a password against a stored digest.
 *
 * `stored` may be null - for a user who has not set a password, or for an address with no account
 * at all. Both cases still perform a full scrypt computation before returning false, so that the
 * caller cannot accidentally turn this into an account-enumeration oracle by returning early.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parsed = parseHash(stored ?? (await decoy()));
  if (!parsed) {
    // Unparseable digest: still burn the time, still fail.
    parseHash(await decoy());
    return false;
  }

  const { N, r, p, salt, key } = parsed;
  const candidate = await scrypt(password.normalize('NFC'), salt, key.length, {
    N,
    r,
    p,
    maxmem: Math.max(MAX_MEM, 128 * N * r * 2),
  });

  const matches = timingSafeEqual(candidate, key);
  // A correct password checked against the decoy is still not a sign-in.
  return matches && stored !== null;
}

/** True when a stored digest was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N < SCRYPT_PARAMS.N || parsed.r < SCRYPT_PARAMS.r || parsed.p < SCRYPT_PARAMS.p;
}
