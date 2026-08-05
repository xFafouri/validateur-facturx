/**
 * Webhook tokens: minting, recognising, and deciding whether a call earns a poll.
 *
 * ## Why the token is hashed rather than encrypted
 *
 * The other secret in this module - `credentialsEncrypted` - belongs to the platform, and we have
 * to be able to replay it on every call, so it is encrypted and reversible. This one is the
 * opposite in every respect. **We** mint it, hand it to the platform once, and thereafter only
 * ever need to answer "is this the same string?". That is what a hash is for, and it means a
 * stolen database yields nothing anyone could present back to us. Losing it costs a regeneration.
 *
 * ## Why a webhook may not carry data
 *
 * The endpoint this backs takes no invoice, no status and no payload it acts on: a webhook only
 * ever says *poll sooner*, and the poll is what reads the truth from the platform's own API over
 * an authenticated channel. That is a deliberate ceiling on what a forged call can achieve. An
 * attacker holding a valid token cannot inject a status, cannot fabricate an invoice, and cannot
 * suppress one - the worst they can do is ask us to do work we were already going to do. Trusting
 * a webhook body would turn that same forgery into a fake payment status on a real invoice.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * How long after an accepted webhook the next one is a no-op.
 *
 * A public endpoint that triggers outbound work is an amplifier if every call is honoured, and
 * platforms legitimately fan out - ten statuses on one invoice can be ten calls in a second. The
 * window collapses a burst into one poll, which is all a burst needed: the poll reads *everything*
 * outstanding since the cursor, so it does not matter how many notifications it stands in for.
 *
 * Short enough that a genuine second event moments later is not delayed past the point of being
 * useful, since the timer-driven poll is the backstop either way.
 */
export const WEBHOOK_DEBOUNCE_MS = 10_000;

/** Distinguishes a webhook token at a glance in a support ticket, and from a session cookie. */
const TOKEN_PREFIX = 'whk_';

/**
 * A new token: 256 bits of CSPRNG output, base64url.
 *
 * The same primitive as a session and a password-reset link, for the same reason - it is the only
 * thing standing between a stranger and the endpoint, so it is generated rather than derived from
 * anything guessable.
 */
export function generateWebhookToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** Hex SHA-256. The stored form; never reversible to a presentable token. */
export function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Whether a presented token matches the stored hash.
 *
 * Hashing first and comparing the digests in constant time means the comparison is over two
 * fixed-length strings, so neither the token's length nor the position of its first wrong byte is
 * observable in the response time.
 */
export function webhookTokenMatches(presented: string, storedHash: string | null): boolean {
  if (!storedHash) return false;

  const candidate = Buffer.from(hashWebhookToken(presented), 'utf8');
  const expected = Buffer.from(storedHash, 'utf8');
  // A stored hash of the wrong length is a corrupted row, not a match. `timingSafeEqual` throws on
  // a length mismatch, and a 500 here would be an authentication failure reported as our bug.
  if (candidate.length !== expected.length) return false;

  return timingSafeEqual(candidate, expected);
}

/**
 * Whether this call should trigger a poll, or fall inside the debounce window.
 *
 * Separated from the request handler so the rule is testable without a database or a clock, and
 * so "we accepted it but did not act" stays an explicit decision rather than an early return
 * buried in a controller.
 */
export function shouldPoll(
  lastWebhookAt: Date | null,
  now: Date = new Date(),
  windowMs: number = WEBHOOK_DEBOUNCE_MS,
): boolean {
  if (!lastWebhookAt) return true;

  const elapsed = now.getTime() - lastWebhookAt.getTime();
  // A negative elapsed means the stored timestamp is in the future - a clock that stepped back, or
  // a row written by a host that is ahead. Polling is the safe reading: refusing would wedge the
  // connection until real time caught up with the bad timestamp.
  if (elapsed < 0) return true;

  return elapsed >= windowMs;
}
