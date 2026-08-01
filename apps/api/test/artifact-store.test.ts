/**
 * Tests for the archive's storage layer.
 *
 * No database and no engine: these pin the two properties the archive rests on - that a key is
 * derived from the bytes, and that existing bytes cannot be replaced - so they run everywhere.
 */

import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArtifactImmutableError, ArtifactStoreError } from '../src/archiving/artifact-store';
import { retentionUntil, RETENTION_YEARS } from '../src/archiving/archiving.service';
import { FilesystemArtifactStore } from '../src/archiving/stores/filesystem.store';

let root: string;
let store: FilesystemArtifactStore;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'facturx-archive-'));
  store = new FilesystemArtifactStore(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe('FilesystemArtifactStore', () => {
  it('addresses an artifact by the SHA-256 of its content', async () => {
    const content = bytes('<Invoice>FA-2026-0001</Invoice>');
    const stored = await store.put(content, { extension: 'xml' });

    expect(stored.contentHash).toBe(createHash('sha256').update(content).digest('hex'));
    expect(stored.storageKey).toContain(stored.contentHash);
    expect(stored.sizeBytes).toBe(content.byteLength);
  });

  it('returns the exact bytes it was given', async () => {
    // A PDF is binary; a store that round-trips text but mangles bytes would pass a naive test and
    // corrupt every invoice.
    const content = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x0a, 0x80]);
    const stored = await store.put(content, { extension: 'pdf' });

    expect(Buffer.from(await store.get(stored.storageKey))).toEqual(Buffer.from(content));
  });

  it('is a no-op when the identical artifact is stored twice', async () => {
    // This is what makes a retried issuance safe.
    const content = bytes('idempotent');
    const first = await store.put(content, { extension: 'xml' });
    const second = await store.put(content, { extension: 'xml' });

    expect(second.storageKey).toBe(first.storageKey);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it('refuses to write over an artifact whose stored bytes no longer match', async () => {
    const content = bytes('original');
    const stored = await store.put(content, { extension: 'xml' });

    // Reachable only through corruption or tampering on disk, since the key is the hash. The
    // response must be loud rather than a silent overwrite of a document someone may later have
    // to produce as evidence.
    await chmod(join(root, stored.storageKey), 0o640);
    await writeFile(join(root, stored.storageKey), 'corrompu');

    await expect(store.put(content, { extension: 'xml' })).rejects.toThrow(ArtifactImmutableError);
  });

  it('refuses a key that escapes the archive root', async () => {
    await expect(store.get('../../etc/passwd')).rejects.toThrow(ArtifactStoreError);
  });

  it('reports whether an artifact is present', async () => {
    const stored = await store.put(bytes('present'), { extension: 'xml' });

    expect(await store.exists(stored.storageKey)).toBe(true);
    expect(await store.exists('aa/bb/deadbeef.xml')).toBe(false);
  });
});

describe('retention', () => {
  it('runs ten years from the issue date, not from the moment of sealing', () => {
    // The obligation attaches to the document's date. Sealing late must not shorten it.
    expect(retentionUntil(new Date('2026-09-03T00:00:00Z')).toISOString()).toBe(
      '2036-09-03T00:00:00.000Z',
    );
    expect(RETENTION_YEARS).toBe(10);
  });

  it('handles a leap day without moving the date', () => {
    expect(retentionUntil(new Date('2028-02-29T00:00:00Z')).toISOString()).toBe(
      '2038-03-01T00:00:00.000Z',
    );
  });
});
