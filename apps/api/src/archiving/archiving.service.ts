/**
 * Sealing artifacts into the immutable archive.
 *
 * "Sealing" is two writes that must agree: the bytes into write-once storage, and a row recording
 * their hash, their location and how long they must be kept. The row without the bytes is a
 * dangling reference; the bytes without the row are unfindable.
 *
 * Order is deliberate - storage first, then the row. A blob written for a transaction that later
 * rolls back is an orphan addressed by its own hash, costing disk and nothing else, and a retry
 * writes the identical key. The reverse order can leave a row pointing at bytes that were never
 * written, which is a broken archive rather than a wasted block.
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ArchiveEntry, Prisma } from '@prisma/client';
import { ARTIFACT_STORE, type ArtifactStore } from './artifact-store';
import { PrismaService } from '../prisma/prisma.service';

/**
 * How long an issued invoice must be kept.
 *
 * Ten years, the longer of the two French obligations that apply: the Code de commerce (art.
 * L123-22) requires accounting records to be kept ten years, while the Livre des procédures
 * fiscales (art. L102 B) requires six for the tax authority's purposes. Keeping the longer is the
 * only choice that satisfies both.
 *
 * The retention rules attached to the e-invoicing mandate specifically must be confirmed against
 * current DGFiP guidance before go-live - see the accuracy note in the README.
 */
export const RETENTION_YEARS = 10;

export interface SealRequest {
  readonly tenantId: string;
  readonly invoiceId: string | null;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  /** `facturx-pdf`, `cii-xml`, ... Stored so the archive can be read without sniffing. */
  readonly artifactKind: string;
  /** File extension for the storage key. */
  readonly extension: string;
  /** Base date for retention. The issue date, not the moment of sealing. */
  readonly issuedAt: Date;
}

export function retentionUntil(issuedAt: Date, years = RETENTION_YEARS): Date {
  const until = new Date(issuedAt);
  until.setUTCFullYear(until.getUTCFullYear() + years);
  return until;
}

@Injectable()
export class ArchivingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ARTIFACT_STORE) private readonly store: ArtifactStore,
  ) {}

  /**
   * Seals an artifact.
   *
   * Idempotent on `(tenantId, invoiceId, contentHash)`: re-sealing identical bytes for the same
   * invoice returns the existing entry rather than creating a second one. That is what makes a
   * retried issuance safe, and it is enforced by a unique constraint rather than by a prior read,
   * so two concurrent attempts cannot both pass a check and then both insert.
   *
   * **Scoped to the invoice, not to the tenant.** The same bytes belonging to two invoices is not
   * a duplicate but an intercompany trade - see the note on the model. Deduplicating per tenant
   * left the second invoice with no entry at all. The bytes themselves are still stored once: the
   * store is content-addressed, so `put` returns the same key without rewriting them.
   *
   * `tx` lets the caller seal inside a wider transaction, so an invoice and its archive entries
   * commit together.
   */
  async seal(request: SealRequest, tx?: Prisma.TransactionClient): Promise<ArchiveEntry> {
    const stored = await this.store.put(request.bytes, { extension: request.extension });
    const client = tx ?? this.prisma;

    const data = {
      tenantId: request.tenantId,
      invoiceId: request.invoiceId,
      contentHash: stored.contentHash,
      storageKey: stored.storageKey,
      mimeType: request.mimeType,
      sizeBytes: stored.sizeBytes,
      artifactKind: request.artifactKind,
      retentionUntil: retentionUntil(request.issuedAt),
    };

    // An unattached artifact cannot use the compound key, because Postgres treats every NULL
    // `invoiceId` as distinct and `upsert` would insert a fresh row every time. The partial index
    // in the migration is what keeps those unique, so this path reads first and lets the index
    // refuse a genuine race.
    if (request.invoiceId === null) {
      const existing = await client.archiveEntry.findFirst({
        where: { tenantId: request.tenantId, invoiceId: null, contentHash: stored.contentHash },
      });
      return existing ?? client.archiveEntry.create({ data });
    }

    // `upsert` with an empty update: the row is never modified, only created if absent. An archive
    // entry that could be updated would not be an archive entry.
    return client.archiveEntry.upsert({
      where: {
        tenantId_invoiceId_contentHash: {
          tenantId: request.tenantId,
          invoiceId: request.invoiceId,
          contentHash: stored.contentHash,
        },
      },
      create: data,
      update: {},
    });
  }

  /**
   * Reads a sealed artifact back, verifying it against the hash recorded when it was sealed.
   *
   * The verification is the point. An archive whose contents are never checked is an assumption,
   * and the one thing this archive has to be able to prove is that a document has not changed
   * since it was issued.
   */
  async retrieve(
    tenantId: string,
    entryId: string,
  ): Promise<{ entry: ArchiveEntry; bytes: Uint8Array }> {
    const entry = await this.prisma.archiveEntry.findFirst({ where: { id: entryId, tenantId } });
    if (!entry) {
      throw new Error(`Entrée d'archive introuvable : ${entryId}.`);
    }

    const bytes = await this.store.get(entry.storageKey);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== entry.contentHash) {
      throw new Error(
        `L'intégrité de l'archive est compromise : l'empreinte de « ${entry.storageKey} » ne correspond plus à celle enregistrée lors du scellement.`,
      );
    }

    return { entry, bytes };
  }
}
