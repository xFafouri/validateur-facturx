/**
 * Per-client rate limiting for the public validator.
 *
 * The endpoint is deliberately unauthenticated - requiring a signup to find out whether your
 * invoice is valid would defeat the point - which makes it the most abusable surface we have.
 * Each call costs several seconds of JVM CPU running Schematron, so a handful of concurrent
 * clients can saturate the sidecar and take the page down for everyone.
 *
 * Token bucket rather than a fixed window: it allows a small burst (a user validating three
 * invoices back to back is normal behaviour, not abuse) while capping the sustained rate.
 *
 * ## Limitation
 *
 * State is in-process. With more than one web instance the effective limit multiplies by the
 * instance count, and a restart forgets every bucket. That is an accepted trade for Phase 0,
 * where the sidecar is the bottleneck and the web tier is single-instance. Redis is already in
 * the compose file for when this needs to be shared - see `REDIS_URL`.
 */

export interface RateLimitConfig {
  /** Maximum burst size. */
  readonly capacity: number;
  /** Tokens replenished per second. */
  readonly refillPerSecond: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Whole tokens left after this request. */
  readonly remaining: number;
  /** Seconds until the next token, for `Retry-After`. */
  readonly retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * Validation is expensive, so the sustained rate is low: 6 in a burst, then one every 20 seconds.
 * A person fixing an invoice iterates far slower than that; a script does not.
 */
export const VALIDATION_LIMIT: RateLimitConfig = {
  capacity: 6,
  refillPerSecond: 1 / 20,
};

/**
 * Waitlist signups are cheap but worth capping to keep the table free of junk.
 *
 * The budget is looser than the raw number of *successful* signups would suggest, because
 * rejected attempts consume tokens too. A user who mistypes their address, forgets the consent
 * box, then corrects both has already spent three attempts before their first real one - so a
 * tight cap locks out exactly the people who are trying to sign up.
 */
export const SIGNUP_LIMIT: RateLimitConfig = {
  capacity: 6,
  refillPerSecond: 1 / 120,
};

const buckets = new Map<string, Bucket>();

/** Buckets are evicted once full again, so idle clients cost nothing. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweepMs = Date.now();

function sweep(config: RateLimitConfig, nowMs: number): void {
  if (nowMs - lastSweepMs < SWEEP_INTERVAL_MS) return;
  lastSweepMs = nowMs;

  for (const [key, bucket] of buckets) {
    const refilled =
      bucket.tokens + ((nowMs - bucket.lastRefillMs) / 1000) * config.refillPerSecond;
    if (refilled >= config.capacity) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  nowMs: number = Date.now(),
): RateLimitResult {
  sweep(config, nowMs);

  const existing = buckets.get(key);
  const bucket: Bucket = existing ?? { tokens: config.capacity, lastRefillMs: nowMs };

  const elapsedSeconds = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
  bucket.tokens = Math.min(
    config.capacity,
    bucket.tokens + elapsedSeconds * config.refillPerSecond,
  );
  bucket.lastRefillMs = nowMs;

  if (bucket.tokens < 1) {
    const deficit = 1 - bucket.tokens;
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(deficit / config.refillPerSecond)),
    };
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);

  return {
    allowed: true,
    remaining: Math.floor(bucket.tokens),
    retryAfterSeconds: 0,
  };
}

/**
 * Derives a client key from request headers.
 *
 * Behind a reverse proxy the socket address is the proxy's, so `x-forwarded-for` is used when
 * present - but only its *first* entry, since a client can append arbitrary values to that header
 * and trailing entries are attacker-controlled.
 *
 * Set `TRUST_PROXY=false` when the app is exposed directly, otherwise a client can spoof the
 * header and bypass the limit entirely.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const trustProxy = process.env.TRUST_PROXY !== 'false';

  if (trustProxy) {
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    const realIp = headers.get('x-real-ip');
    if (realIp) return realIp.trim();
  }

  // No usable address: fall back to a single shared bucket rather than to no limit at all.
  return 'unknown';
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweepMs = Date.now();
}
