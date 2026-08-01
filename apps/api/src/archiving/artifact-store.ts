/**
 * The boundary between archiving policy and archive storage.
 *
 * The archive holds legal documents that must survive for years and must be provably unaltered,
 * which puts two hard requirements on any implementation:
 *
 *  - **Content-addressed.** The key is derived from the bytes, so a stored artifact cannot be
 *    silently swapped for a different one under the same name.
 *  - **Write-once.** Overwriting an existing key is a bug, not a feature. An implementation must
 *    refuse it rather than accept it, and the refusal must be loud.
 *
 * Kept behind an interface for the same reason as `PdpProvider`: production must run on EU object
 * storage with versioning and an object-lock retention policy, while development and tests want a
 * directory. Neither should be able to leak into the service above.
 */

/** Where an artifact ended up, and what it is. */
export interface StoredArtifact {
  /** Storage key, derived from the content hash. Stable across re-writes of identical bytes. */
  readonly storageKey: string;
  /** SHA-256 of the stored bytes, hex-encoded. */
  readonly contentHash: string;
  readonly sizeBytes: number;
}

export class ArtifactStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ArtifactStoreError';
  }
}

/**
 * Raised when a key already holds *different* bytes.
 *
 * Under content addressing this cannot happen without either a hash collision or corruption, so it
 * is treated as a fault rather than a condition to recover from.
 */
export class ArtifactImmutableError extends ArtifactStoreError {
  constructor(storageKey: string) {
    super(
      `L'artefact « ${storageKey} » existe déjà avec un contenu différent. Un archive est en écriture unique : il ne peut pas être remplacé.`,
    );
    this.name = 'ArtifactImmutableError';
  }
}

export interface ArtifactStore {
  /** Implementation key, for logs and diagnostics. */
  readonly key: string;

  /**
   * Stores bytes under their content hash.
   *
   * Idempotent by construction: storing identical bytes twice is a no-op that returns the same
   * key, which is what makes a retried issuance safe. Storing *different* bytes under an existing
   * key must throw `ArtifactImmutableError`.
   */
  put(bytes: Uint8Array, options: { readonly extension: string }): Promise<StoredArtifact>;

  /** Reads an artifact back. Used to serve a download and to verify integrity. */
  get(storageKey: string): Promise<Uint8Array>;

  exists(storageKey: string): Promise<boolean>;
}

/** Injection token; `ArtifactStore` is an interface and cannot be one itself. */
export const ARTIFACT_STORE = Symbol('ARTIFACT_STORE');
