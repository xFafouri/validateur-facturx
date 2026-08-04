/**
 * Encrypting platform credentials before they reach the database.
 *
 * A `PdpConnection` holds the secret that lets us submit invoices in a business's name. A dump of
 * the invoice database is already bad; one that also hands over every client's platform
 * credentials is a different category of incident, and it is the one thing in this schema that is
 * worth protecting from our own storage layer rather than only from the network.
 *
 * AES-256-GCM, so the ciphertext is authenticated: a modified row fails to open rather than
 * decrypting to something else. The key never comes from the database - it is supplied by the
 * environment, which is what makes a stolen backup useless on its own.
 *
 * ## Why not a KMS
 *
 * Because the hosting region is still open (see the README), and picking a managed KMS now would
 * pick a cloud. The envelope format below carries a version byte so that moving to KMS-wrapped
 * data keys later is a new version that reads the old one, not a migration that cannot be rolled
 * back. What must not change is the boundary: everything above this file handles plaintext
 * secrets only in memory, and only at the point of use.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Envelope layout: `version(1) | iv(12) | authTag(16) | ciphertext`.
 *
 * The version is first so a reader can dispatch before assuming any of the offsets that follow.
 */
const VERSION_AES_256_GCM = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export const PDP_CREDENTIALS_KEY_ENV = 'PDP_CREDENTIALS_KEY';

/**
 * Raised when credentials cannot be protected or read back.
 *
 * A distinct type because the caller's only correct response is to refuse the operation. Storing
 * a secret in clear "just this once" when the key is missing is precisely the shortcut this
 * module exists to make impossible.
 */
export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialCryptoError';
  }
}

/**
 * Reads the master key from the environment.
 *
 * No default and no generated fallback. A key invented at boot would encrypt this run's
 * credentials into something the next run cannot read, and the failure would surface days later
 * as an invoice that will not send - so a missing key is refused loudly at the point of use.
 */
export function resolveCredentialsKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const configured = env[PDP_CREDENTIALS_KEY_ENV]?.trim();
  if (!configured) {
    throw new CredentialCryptoError(
      `${PDP_CREDENTIALS_KEY_ENV} n'est pas défini. Les identifiants de plateforme ne peuvent pas être chiffrés, et ne seront jamais enregistrés en clair. Générez une clé avec « openssl rand -base64 32 ».`,
    );
  }

  // Base64 first, hex as a courtesy: both are plausible things to paste, and a 64-character hex
  // string is also valid base64, so the length check below is what actually decides.
  let key = Buffer.from(configured, 'base64');
  if (key.length !== KEY_BYTES && /^[0-9a-fA-F]{64}$/.test(configured)) {
    key = Buffer.from(configured, 'hex');
  }

  if (key.length !== KEY_BYTES) {
    throw new CredentialCryptoError(
      `${PDP_CREDENTIALS_KEY_ENV} doit être une clé de 32 octets encodée en base64 (« openssl rand -base64 32 ») ; ${key.length} octets ont été lus.`,
    );
  }

  return key;
}

/**
 * Encrypts a credential set. The result is what goes into `credentialsEncrypted`.
 *
 * Returned as a plain `Uint8Array` rather than a `Buffer`. A `Buffer` may be backed by a
 * `SharedArrayBuffer`, which is why Prisma's `Bytes` will not accept one, and copying into an
 * exactly-sized array here is cheaper than making every caller do the conversion.
 */
export function sealCredentials(
  secrets: Readonly<Record<string, string>>,
  key: Buffer,
): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  // The version byte is authenticated but not encrypted: it must be readable before we know how
  // to decrypt, and binding it as AAD stops it being rewritten to select a weaker version later.
  const version = Buffer.of(VERSION_AES_256_GCM);
  cipher.setAAD(version);

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secrets), 'utf8'),
    cipher.final(),
  ]);

  return new Uint8Array(Buffer.concat([version, iv, cipher.getAuthTag(), ciphertext]));
}

/** Decrypts a credential set. Throws rather than returning partial or unauthenticated data. */
export function openCredentials(envelope: Uint8Array, key: Buffer): Record<string, string> {
  const buffer = Buffer.from(envelope);
  if (buffer.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new CredentialCryptoError(
      'Identifiants de plateforme illisibles : enregistrement tronqué.',
    );
  }

  const version = buffer.subarray(0, 1);
  if (version[0] !== VERSION_AES_256_GCM) {
    throw new CredentialCryptoError(
      `Identifiants de plateforme illisibles : version de chiffrement ${version[0]} inconnue.`,
    );
  }

  const iv = buffer.subarray(1, 1 + IV_BYTES);
  const tag = buffer.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = buffer.subarray(1 + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(version);
  decipher.setAuthTag(tag);

  let plaintext: string;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // The GCM tag did not verify. Either the key is not the one that sealed this row, or the row
    // was altered. The message says both, because from here they are indistinguishable - and the
    // usual cause is a redeployment with a rotated key, which is worth naming.
    throw new CredentialCryptoError(
      "Les identifiants de plateforme n'ont pas pu être déchiffrés : la clé ne correspond pas, ou l'enregistrement a été modifié. Vérifiez " +
        `${PDP_CREDENTIALS_KEY_ENV}.`,
    );
  }

  const parsed: unknown = JSON.parse(plaintext);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CredentialCryptoError('Identifiants de plateforme illisibles : format inattendu.');
  }

  const secrets: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new CredentialCryptoError(
        `Identifiants de plateforme illisibles : « ${name} » n'est pas une chaîne.`,
      );
    }
    secrets[name] = value;
  }
  return secrets;
}

/**
 * Constant-time equality for secrets.
 *
 * Used where a caller-supplied token is compared against a stored one - a webhook signature, for
 * instance. `===` on strings leaks the length of the matching prefix through timing, which is a
 * silly way to lose a shared secret.
 */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
