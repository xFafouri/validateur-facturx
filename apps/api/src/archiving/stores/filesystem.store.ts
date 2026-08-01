/**
 * Filesystem `ArtifactStore`, for development and tests.
 *
 * **Not a production archive.** A directory offers no object-lock, no versioning and no guarantee
 * against an operator with a shell, and the statutory obligation is to keep invoices intact for
 * years. Production must point at EU object storage with versioning plus a retention policy that
 * the application's own credentials cannot lift. This exists so the rest of Phase 1 can be built
 * and tested without that decision being made first.
 *
 * The write-once guarantee is still enforced here rather than left to the production driver: a
 * guarantee that only holds in production is one nothing in CI ever exercises.
 */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  ArtifactImmutableError,
  ArtifactStoreError,
  type ArtifactStore,
  type StoredArtifact,
} from '../artifact-store';

export class FilesystemArtifactStore implements ArtifactStore {
  readonly key = 'filesystem';

  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Keys are `ab/cd/<full-hash>.<ext>`.
   *
   * The two-level prefix keeps directory sizes workable: a flat directory with a million entries
   * is slow to list on most filesystems, and an archive only ever grows.
   */
  private keyFor(hash: string, extension: string): string {
    return join(hash.slice(0, 2), hash.slice(2, 4), `${hash}.${extension}`);
  }

  private pathFor(storageKey: string): string {
    const path = resolve(this.root, storageKey);
    // A key is built from a hex hash, never from user input - but a store that would happily read
    // outside its root is one traversal bug away from serving arbitrary files.
    if (path !== this.root && !path.startsWith(`${this.root}/`)) {
      throw new ArtifactStoreError(`Clé d'archive invalide : « ${storageKey} ».`);
    }
    return path;
  }

  async put(bytes: Uint8Array, options: { extension: string }): Promise<StoredArtifact> {
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = this.keyFor(contentHash, options.extension);
    const path = this.pathFor(storageKey);

    if (await this.exists(storageKey)) {
      // Identical bytes are a no-op, which is what makes a retried issuance safe. Different bytes
      // under the same hash mean corruption; verifying rather than trusting costs one read.
      const existing = await readFile(path);
      if (!Buffer.from(bytes).equals(existing)) {
        throw new ArtifactImmutableError(storageKey);
      }
      return { storageKey, contentHash, sizeBytes: bytes.byteLength };
    }

    await mkdir(dirname(path), { recursive: true });

    // Written to a temporary name and renamed into place: `rename` is atomic within a filesystem,
    // so a crash mid-write leaves a stray temporary file rather than a truncated artifact that
    // would read as a valid archive entry with the wrong bytes.
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o440, flag: 'wx' });
      await rename(temporary, path);
    } catch (error) {
      throw new ArtifactStoreError("L'artefact n'a pas pu être écrit dans l'archive.", error);
    }

    return { storageKey, contentHash, sizeBytes: bytes.byteLength };
  }

  async get(storageKey: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.pathFor(storageKey)));
    } catch (error) {
      throw new ArtifactStoreError(`L'artefact « ${storageKey} » est introuvable.`, error);
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await access(this.pathFor(storageKey), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
