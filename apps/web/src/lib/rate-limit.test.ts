import { beforeEach, describe, expect, it } from 'vitest';
import {
  VALIDATION_LIMIT,
  checkRateLimit,
  clientKeyFromHeaders,
  resetRateLimits,
  type RateLimitConfig,
} from './rate-limit';

/** One token per second, burst of 3 - easy to reason about in tests. */
const CONFIG: RateLimitConfig = { capacity: 3, refillPerSecond: 1 };

describe('checkRateLimit', () => {
  beforeEach(() => resetRateLimits());

  it('allows a burst up to capacity, then refuses', () => {
    const now = 1_000_000;
    for (let i = 0; i < CONFIG.capacity; i += 1) {
      expect(checkRateLimit('a', CONFIG, now).allowed).toBe(true);
    }
    expect(checkRateLimit('a', CONFIG, now).allowed).toBe(false);
  });

  it('reports how long to wait', () => {
    const now = 1_000_000;
    for (let i = 0; i < CONFIG.capacity; i += 1) checkRateLimit('b', CONFIG, now);

    const blocked = checkRateLimit('b', CONFIG, now);
    expect(blocked.allowed).toBe(false);
    // Never zero: a `Retry-After: 0` invites an immediate retry, which is the opposite of the point.
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('refills over time', () => {
    const now = 1_000_000;
    for (let i = 0; i < CONFIG.capacity; i += 1) checkRateLimit('c', CONFIG, now);
    expect(checkRateLimit('c', CONFIG, now).allowed).toBe(false);

    expect(checkRateLimit('c', CONFIG, now + 1_000).allowed).toBe(true);
    expect(checkRateLimit('c', CONFIG, now + 1_000).allowed).toBe(false);
  });

  it('never refills beyond capacity', () => {
    const now = 1_000_000;
    checkRateLimit('d', CONFIG, now);
    // An hour idle must not bank an unlimited burst.
    for (let i = 0; i < CONFIG.capacity; i += 1) {
      expect(checkRateLimit('d', CONFIG, now + 3_600_000).allowed).toBe(true);
    }
    expect(checkRateLimit('d', CONFIG, now + 3_600_000).allowed).toBe(false);
  });

  it('tracks clients independently', () => {
    const now = 1_000_000;
    for (let i = 0; i < CONFIG.capacity; i += 1) checkRateLimit('x', CONFIG, now);
    expect(checkRateLimit('x', CONFIG, now).allowed).toBe(false);
    expect(checkRateLimit('y', CONFIG, now).allowed).toBe(true);
  });

  it('caps sustained validation traffic well below what would saturate the engine', () => {
    const now = 1_000_000;
    for (let i = 0; i < VALIDATION_LIMIT.capacity; i += 1) {
      expect(checkRateLimit('z', VALIDATION_LIMIT, now).allowed).toBe(true);
    }
    expect(checkRateLimit('z', VALIDATION_LIMIT, now).allowed).toBe(false);
    // One request per 20s sustained: far slower than a person iterating on a broken invoice
    // would need, and far too slow to exhaust the sidecar.
    expect(checkRateLimit('z', VALIDATION_LIMIT, now + 20_000).allowed).toBe(true);
  });
});

describe('clientKeyFromHeaders', () => {
  beforeEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it('uses the first x-forwarded-for entry', () => {
    // Later entries are appended by intermediaries and are attacker-controlled; only the first
    // is written by the proxy we trust.
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 172.16.0.2' });
    expect(clientKeyFromHeaders(headers)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    expect(clientKeyFromHeaders(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('ignores forwarding headers when the proxy is not trusted', () => {
    // Exposed directly, a client can set these freely and would otherwise get a fresh bucket
    // per request simply by varying the header.
    process.env.TRUST_PROXY = 'false';
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7' });
    expect(clientKeyFromHeaders(headers)).toBe('unknown');
  });

  it('shares one bucket when no address is available, rather than skipping the limit', () => {
    expect(clientKeyFromHeaders(new Headers())).toBe('unknown');
  });
});
