/**
 * The pieces of the PDP layer that are pure functions, tested without a database.
 *
 * Credential encryption, status ranking and webhook authentication all fail quietly when they are
 * wrong - a secret that round-trips through the wrong key, an invoice whose state walks backwards,
 * a token comparison that accepts the wrong string - so they get direct tests rather than being
 * covered incidentally by the integration suite.
 */

import { describe, expect, it } from 'vitest';
import {
  CredentialCryptoError,
  openCredentials,
  resolveCredentialsKey,
  sealCredentials,
  secretsEqual,
} from '../src/pdp/credentials';
import { advanceState, isLifecycleCode, lifecycleLabel } from '../src/pdp/lifecycle';
import {
  generateWebhookToken,
  hashWebhookToken,
  shouldPoll,
  WEBHOOK_DEBOUNCE_MS,
  webhookTokenMatches,
} from '../src/pdp/webhook-token';

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);

describe('credential encryption', () => {
  it('round-trips a credential set', () => {
    const secrets = { apiKey: 'sk-live-123', clientSecret: 'très secret · é' };
    const sealed = sealCredentials(secrets, KEY);

    expect(openCredentials(sealed, KEY)).toEqual(secrets);
  });

  it('never writes the plaintext into the envelope', () => {
    const sealed = sealCredentials({ apiKey: 'sk-live-123' }, KEY);

    expect(Buffer.from(sealed).toString('utf8')).not.toContain('sk-live-123');
    expect(Buffer.from(sealed).toString('utf8')).not.toContain('apiKey');
  });

  it('produces a different envelope each time, so identical secrets are not linkable', () => {
    const first = sealCredentials({ apiKey: 'same' }, KEY);
    const second = sealCredentials({ apiKey: 'same' }, KEY);

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
  });

  it('refuses the wrong key rather than returning garbage', () => {
    const sealed = sealCredentials({ apiKey: 'sk-live-123' }, KEY);

    expect(() => openCredentials(sealed, OTHER_KEY)).toThrow(CredentialCryptoError);
  });

  /** The authentication half of AES-GCM. A row edited in the database must not decrypt. */
  it('refuses a tampered envelope', () => {
    const sealed = sealCredentials({ apiKey: 'sk-live-123' }, KEY);
    const tampered = Uint8Array.from(sealed);
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => openCredentials(tampered, KEY)).toThrow(CredentialCryptoError);
  });

  it('refuses a truncated envelope', () => {
    expect(() => openCredentials(new Uint8Array([1, 2, 3]), KEY)).toThrow(CredentialCryptoError);
  });

  it('rejects an envelope whose version byte it does not know', () => {
    const sealed = sealCredentials({ apiKey: 'x' }, KEY);
    const rewritten = Uint8Array.from(sealed);
    rewritten[0] = 99;

    expect(() => openCredentials(rewritten, KEY)).toThrow(/version de chiffrement 99/);
  });
});

describe('resolving the master key', () => {
  it('accepts base64 and hex', () => {
    const base64 = KEY.toString('base64');
    const hex = KEY.toString('hex');

    expect(resolveCredentialsKey({ PDP_CREDENTIALS_KEY: base64 }).equals(KEY)).toBe(true);
    expect(resolveCredentialsKey({ PDP_CREDENTIALS_KEY: hex }).equals(KEY)).toBe(true);
  });

  /** No silent fallback: a missing key must stop the operation, not downgrade it. */
  it('refuses when unset, naming the variable and how to generate one', () => {
    expect(() => resolveCredentialsKey({})).toThrow(/PDP_CREDENTIALS_KEY/);
    expect(() => resolveCredentialsKey({})).toThrow(/openssl rand -base64 32/);
  });

  it('refuses a key of the wrong length', () => {
    expect(() =>
      resolveCredentialsKey({ PDP_CREDENTIALS_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/32 octets/);
  });
});

describe('constant-time secret comparison', () => {
  it('matches equal strings and rejects others', () => {
    expect(secretsEqual('abc', 'abc')).toBe(true);
    expect(secretsEqual('abc', 'abd')).toBe(false);
    expect(secretsEqual('abc', 'abcd')).toBe(false);
    expect(secretsEqual('', '')).toBe(true);
  });
});

describe('lifecycle status vocabulary', () => {
  it('recognises specification codes and labels internal ones', () => {
    expect(isLifecycleCode('DEPOSEE')).toBe(true);
    expect(isLifecycleCode('TRANSMISSION_ECHOUEE')).toBe(false);

    expect(lifecycleLabel('DEPOSEE')).toBe('Déposée sur la plateforme');
    expect(lifecycleLabel('TRANSMISSION_ECHOUEE')).toBe('Échec de transmission');
    expect(lifecycleLabel('QUELQUE_CHOSE_INCONNU')).toBeNull();
  });
});

describe('advancing invoice state from a status', () => {
  it('moves forward through the ordinary path', () => {
    expect(advanceState('QUEUED', 'DEPOSEE')).toBe('TRANSMITTED');
    expect(advanceState('TRANSMITTED', 'MISE_A_DISPOSITION')).toBe('DELIVERED');
    expect(advanceState('DELIVERED', 'REFUSEE')).toBe('REJECTED');
  });

  /**
   * The property the whole ranking exists for. Platforms batch and retry statuses, so a poll can
   * deliver `DEPOSEE` after `MISE_A_DISPOSITION` is already recorded - and a user watching the
   * screen must not see a delivered invoice revert to "sent".
   */
  it('never walks an invoice backwards when statuses arrive out of order', () => {
    expect(advanceState('DELIVERED', 'DEPOSEE')).toBeNull();
    expect(advanceState('TRANSMITTED', 'DEPOSEE')).toBeNull();
    expect(advanceState('REJECTED', 'MISE_A_DISPOSITION')).toBeNull();
  });

  it('leaves an archived invoice alone', () => {
    expect(advanceState('ARCHIVED', 'REFUSEE')).toBeNull();
  });

  it('ignores statuses that carry no state, and codes it does not know', () => {
    expect(advanceState('TRANSMITTED', 'ENCAISSEE')).toBeNull();
    expect(advanceState('TRANSMITTED', 'SUSPENDUE')).toBeNull();
    expect(advanceState('QUEUED', 'PAS_UN_STATUT')).toBeNull();
  });
});

describe('webhook tokens', () => {
  it('mints a distinct, prefixed, high-entropy token each time', () => {
    const first = generateWebhookToken();
    const second = generateWebhookToken();

    expect(first).toMatch(/^whk_/);
    expect(first).not.toEqual(second);
    // 32 bytes of base64url, plus the prefix. Short enough to paste, long enough not to guess.
    expect(first.length).toBeGreaterThanOrEqual(40);
  });

  it('recognises its own token', () => {
    const token = generateWebhookToken();
    expect(webhookTokenMatches(token, hashWebhookToken(token))).toBe(true);
  });

  it('refuses a different token, and the hash itself', () => {
    const token = generateWebhookToken();
    const stored = hashWebhookToken(token);

    expect(webhookTokenMatches(generateWebhookToken(), stored)).toBe(false);
    // Presenting the stored digest must not authenticate: a database leak would otherwise be
    // directly presentable rather than merely embarrassing.
    expect(webhookTokenMatches(stored, stored)).toBe(false);
  });

  it('refuses everything when no webhook is configured', () => {
    // The default for every connection that existed before webhooks did.
    expect(webhookTokenMatches(generateWebhookToken(), null)).toBe(false);
    expect(webhookTokenMatches('', null)).toBe(false);
  });

  it('refuses an empty token and survives a corrupted stored hash', () => {
    const stored = hashWebhookToken(generateWebhookToken());

    expect(webhookTokenMatches('', stored)).toBe(false);
    // A truncated hash is a bad row, not a match - and must not throw out of a length check,
    // which would report an authentication failure as a 500.
    expect(() => webhookTokenMatches('whk_abc', 'tronqué')).not.toThrow();
    expect(webhookTokenMatches('whk_abc', 'tronqué')).toBe(false);
  });
});

describe('webhook debounce', () => {
  const now = new Date('2026-08-05T10:00:00Z');
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  it('polls when the connection has never had a webhook', () => {
    expect(shouldPoll(null, now)).toBe(true);
  });

  it('collapses a burst into one poll', () => {
    // The case this exists for: ten statuses on one invoice arriving as ten calls in a second.
    expect(shouldPoll(now, at(0))).toBe(false);
    expect(shouldPoll(now, at(500))).toBe(false);
    expect(shouldPoll(now, at(WEBHOOK_DEBOUNCE_MS - 1))).toBe(false);
  });

  it('polls again once the window has passed', () => {
    expect(shouldPoll(now, at(WEBHOOK_DEBOUNCE_MS))).toBe(true);
    expect(shouldPoll(now, at(WEBHOOK_DEBOUNCE_MS * 10))).toBe(true);
  });

  it('polls rather than wedging when the stored timestamp is in the future', () => {
    // A clock that stepped back, or a row written by a host running ahead. Refusing would strand
    // the connection until real time caught up with the bad timestamp.
    expect(shouldPoll(at(60_000), now)).toBe(true);
  });
});
