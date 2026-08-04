/**
 * The transmission queue: handing issued invoices to a certified platform.
 *
 * ## The queue is a table
 *
 * `Transmission` rows are the work items. There is no broker, and the reason is narrow: the thing
 * that must never happen is an invoice arriving at the buyer twice, or not at all. Both are
 * fiscal events, not technical ones - a duplicate is a document the buyer may book and pay, and a
 * silent drop is a receivable nobody chases.
 *
 * A broker cannot give that guarantee here, because enqueueing would be a second write that
 * cannot join the transaction which decided the invoice was ready. Whichever order you choose,
 * one crash window either loses jobs or duplicates them, and you are left reconciling two stores
 * that disagree. With the row *as* the job, enqueueing commits with the state change, and
 * `idempotencyKey` is a unique constraint rather than a convention. Workers claim rows with
 * `FOR UPDATE SKIP LOCKED`, which is the same primitive a broker would be using underneath.
 *
 * Redis stays in the stack for what it is good at - caching, rate limits - and out of the path
 * where correctness is measured in invoices.
 *
 * ## Three layers of idempotency
 *
 * Each covers what the one before it cannot:
 *
 *  1. **Enqueue** derives its key from the sealed content hash, so the same document always
 *     produces the same key and a double enqueue is refused by the database.
 *  2. **Claim** takes a lease, so two workers cannot run one row at the same time.
 *  3. **The platform** is told the key, so a retry after a timeout we never saw the answer to
 *     resolves to the original transmission rather than a second one.
 *
 * Only the third protects against the genuinely ambiguous failure - the request arrived, the
 * response did not - which is why `PdpProvider.transmit` requires it of implementations.
 */

import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Transmission } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ArchivingService } from '../archiving/archiving.service';
import { PdpRegistryService } from './pdp-registry.service';
import { advanceState, LIFECYCLE_DEFINITIONS } from './lifecycle';
import type { TransmitRequest } from './pdp-provider';

/**
 * Backoff schedule, in seconds, indexed by the attempt that just failed.
 *
 * Long rather than aggressive. A platform that is down stays down for minutes, and hammering it
 * neither helps us nor endears us to it; an invoice that leaves twenty minutes late is not a
 * problem, whereas one rejected for rate-limiting is. The last entry repeats until the attempt
 * ceiling.
 */
const BACKOFF_SECONDS = [30, 120, 600, 1800, 3600] as const;

/**
 * Attempts before a transmission is parked as FAILED.
 *
 * Parked, not abandoned: a FAILED row keeps its key, so a human retry re-uses it and the platform
 * still recognises the send as the same one. What stops is the automatic retrying, because after
 * this many failures the cause is configuration or a rejected document, and neither is fixed by
 * waiting.
 */
const MAX_ATTEMPTS = 6;

/**
 * How long a claim is honoured before another worker may take the row.
 *
 * Longer than the slowest plausible `transmit`, because reclaiming a row that is still in flight
 * is how you send an invoice twice. The platform's own idempotency is the backstop if that ever
 * happens, but it should not be the first line of defence.
 */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

export interface EnqueueResult {
  readonly transmissionId: string;
  readonly idempotencyKey: string;
  /** True when this invoice was already queued; nothing new was created. */
  readonly alreadyQueued: boolean;
}

export class NotTransmittableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotTransmittableError';
  }
}

export class NoActiveConnectionError extends Error {
  constructor(clientOrgName: string) {
    super(
      `« ${clientOrgName} » n'est raccordée à aucune plateforme active. Configurez une plateforme avant d'émettre vers le circuit officiel.`,
    );
    this.name = 'NoActiveConnectionError';
  }
}

/** What one drain pass did, for logs and for the tests that assert on progress. */
export interface DrainReport {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly parked: number;
}

@Injectable()
export class TransmissionService {
  private readonly logger = new Logger(TransmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly archiving: ArchivingService,
    private readonly registry: PdpRegistryService,
  ) {}

  /**
   * Queues an issued invoice for transmission.
   *
   * Idempotent by construction: the key is a function of the invoice and the exact bytes that
   * were sealed, so calling this twice - from the issuing request and again from the sweep - can
   * only ever produce one row.
   */
  async enqueue(params: {
    tenantId: string;
    invoiceId: string;
    actorUserId?: string | null;
  }): Promise<EnqueueResult> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: params.invoiceId, tenantId: params.tenantId },
      select: {
        id: true,
        direction: true,
        state: true,
        invoiceNumber: true,
        clientOrg: { select: { id: true, name: true } },
        archiveEntries: {
          where: { artifactKind: { in: ['facturx-pdf', 'cii-xml'] } },
          orderBy: { sealedAt: 'desc' },
          select: { id: true, contentHash: true, artifactKind: true },
        },
      },
    });

    if (!invoice) {
      throw new NotTransmittableError('Facture introuvable.');
    }

    // Receiving is the other direction of the same pipe, and an invoice that arrived through it
    // is the supplier's to transmit, not ours. Sending one back would put a document into the
    // official circuit under the wrong party's name.
    if (invoice.direction !== 'ISSUED') {
      throw new NotTransmittableError(
        'Seules les factures émises peuvent être transmises. Une facture reçue a déjà été transmise par son fournisseur.',
      );
    }

    // The Factur-X PDF is what gets handed over: it carries the CII XML inside it, so one file
    // satisfies both the machine-readable original and the human-readable rendition. The XML is
    // the fallback for the day we emit a profile with no PDF rendition.
    const artifact =
      invoice.archiveEntries.find((entry) => entry.artifactKind === 'facturx-pdf') ??
      invoice.archiveEntries.find((entry) => entry.artifactKind === 'cii-xml');

    if (!artifact) {
      throw new NotTransmittableError(
        "Cette facture n'a aucun artefact scellé ; il n'y a rien à transmettre.",
      );
    }

    const connection = await this.prisma.pdpConnection.findFirst({
      where: { clientOrgId: invoice.clientOrg.id, active: true },
    });
    if (!connection) {
      throw new NoActiveConnectionError(invoice.clientOrg.name);
    }

    const idempotencyKey = transmissionKey(invoice.id, artifact.contentHash);

    const existing = await this.prisma.transmission.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return { transmissionId: existing.id, idempotencyKey, alreadyQueued: true };
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.transmission.create({
          data: {
            invoiceId: invoice.id,
            pdpConnectionId: connection.id,
            idempotencyKey,
            state: 'PENDING',
          },
        });

        // QUEUED only from VALIDATED. A re-queue of an invoice already TRANSMITTED - which is
        // what a manual retry after a partial failure looks like - must not walk it backwards.
        if (invoice.state === 'VALIDATED' || invoice.state === 'DRAFT') {
          await tx.invoice.update({ where: { id: invoice.id }, data: { state: 'QUEUED' } });
        }

        await tx.auditLog.create({
          data: {
            tenantId: params.tenantId,
            userId: params.actorUserId ?? null,
            action: 'invoice.queued',
            entityType: 'Invoice',
            entityId: invoice.id,
            metadata: {
              invoiceNumber: invoice.invoiceNumber,
              provider: connection.provider,
              idempotencyKey,
            },
          },
        });

        return row;
      });

      this.logger.log(
        `Facture ${invoice.invoiceNumber} mise en file pour ${connection.provider} (${created.id}).`,
      );
      return { transmissionId: created.id, idempotencyKey, alreadyQueued: false };
    } catch (error) {
      // Two callers raced - the issuing request and the sweep, most likely. The constraint did its
      // job; the loser reports the winner's row rather than an error, because from the caller's
      // point of view the invoice is queued either way.
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.transmission.findUnique({ where: { idempotencyKey } });
        if (winner) {
          return { transmissionId: winner.id, idempotencyKey, alreadyQueued: true };
        }
      }
      throw error;
    }
  }

  /**
   * Queues everything that should be queued and is not.
   *
   * The reconciliation half of the design. `enqueue` is called from the issuing request, but that
   * request can die between committing the invoice and queueing it, and an invoice sitting in
   * `VALIDATED` forever is a document the client believes was sent. Rather than force issuance to
   * depend on this module - and to know about platforms at all - the invoice's own state is the
   * outbox, and this sweep drains it.
   *
   * Bounded per pass so a backlog cannot monopolise a worker tick.
   */
  async enqueuePending(limit = 50): Promise<number> {
    const candidates = await this.prisma.invoice.findMany({
      where: {
        direction: 'ISSUED',
        state: 'VALIDATED',
        transmissions: { none: {} },
        clientOrg: { pdpConnections: { some: { active: true } } },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, tenantId: true },
    });

    let queued = 0;
    for (const invoice of candidates) {
      try {
        const result = await this.enqueue({ tenantId: invoice.tenantId, invoiceId: invoice.id });
        if (!result.alreadyQueued) queued += 1;
      } catch (error) {
        // One unqueueable invoice must not stop the sweep reaching the rest.
        this.logger.warn(`Mise en file impossible pour ${invoice.id} : ${describe(error)}`);
      }
    }
    return queued;
  }

  /**
   * Claims due work.
   *
   * Raw SQL because `FOR UPDATE SKIP LOCKED` is the whole point and Prisma cannot express it. The
   * inner select picks rows that are due and unclaimed (or whose claim has gone stale) and locks
   * them, skipping any row another worker holds; the outer update stamps the lease. Two workers
   * running this concurrently get disjoint sets, with no coordination beyond the database.
   */
  async claim(workerId: string, limit: number, now: Date = new Date()): Promise<Transmission[]> {
    const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS);

    return this.prisma.$queryRaw<Transmission[]>`
      UPDATE "Transmission" AS t
         SET "claimedAt" = ${now}, "claimedBy" = ${workerId}
       WHERE t."id" IN (
         SELECT c."id"
           FROM "Transmission" AS c
          WHERE c."state" = 'PENDING'
            AND c."nextAttemptAt" <= ${now}
            AND (c."claimedAt" IS NULL OR c."claimedAt" < ${staleBefore})
          ORDER BY c."nextAttemptAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
       )
      RETURNING t.*;
    `;
  }

  /** Claims and runs one batch. The unit a worker tick performs. */
  async drain(workerId: string, limit = 10): Promise<DrainReport> {
    const claimed = await this.claim(workerId, limit);
    let sent = 0;
    let failed = 0;
    let parked = 0;

    for (const row of claimed) {
      const outcome = await this.attempt(row);
      if (outcome === 'sent') sent += 1;
      else if (outcome === 'parked') parked += 1;
      else failed += 1;
    }

    return { claimed: claimed.length, sent, failed, parked };
  }

  /**
   * One transmission attempt.
   *
   * Never throws. A worker loop that can be killed by one bad row stops draining every other row
   * behind it, so every failure is recorded on the row and the loop continues.
   */
  async attempt(row: Transmission, now: Date = new Date()): Promise<'sent' | 'retry' | 'parked'> {
    try {
      const request = await this.buildRequest(row);
      const { provider, credentials, connection } = this.registry.resolve(request.connection);

      const result = await provider.transmit(credentials, request.transmit);

      await this.recordSent(row, result.externalId, result.acceptedAt, result.raw, now);
      this.logger.log(
        `Facture ${request.invoiceNumber} transmise via ${connection.provider} (${result.externalId}).`,
      );
      return 'sent';
    } catch (error) {
      return this.recordFailure(row, error, now);
    }
  }

  /** Assembles everything the provider needs, verifying the artifact against its sealed hash. */
  private async buildRequest(row: Transmission): Promise<{
    connection: Prisma.PdpConnectionGetPayload<object>;
    invoiceNumber: string;
    transmit: TransmitRequest;
  }> {
    const transmission = await this.prisma.transmission.findUniqueOrThrow({
      where: { id: row.id },
      select: {
        idempotencyKey: true,
        pdpConnection: true,
        invoice: {
          select: {
            id: true,
            tenantId: true,
            invoiceNumber: true,
            clientOrg: {
              select: {
                name: true,
                siret: true,
                siren: true,
                eInvoicingAddress: true,
                eInvoicingScheme: true,
              },
            },
            buyer: { select: { name: true, eAddress: true, eScheme: true, legalId: true } },
            archiveEntries: {
              where: { artifactKind: { in: ['facturx-pdf', 'cii-xml'] } },
              orderBy: { sealedAt: 'desc' },
              select: { id: true, artifactKind: true },
            },
          },
        },
      },
    });

    const { invoice } = transmission;
    const entry =
      invoice.archiveEntries.find((candidate) => candidate.artifactKind === 'facturx-pdf') ??
      invoice.archiveEntries[0];

    if (!entry) {
      throw new NotTransmittableError(
        "L'artefact scellé de cette facture est introuvable ; la transmission est impossible.",
      );
    }

    // Read back through the archive rather than from the store directly, so the bytes are checked
    // against the hash recorded at sealing. Sending a document that no longer matches what we
    // certified would be worse than not sending it.
    const { bytes } = await this.archiving.retrieve(invoice.tenantId, entry.id);
    const isPdf = entry.artifactKind === 'facturx-pdf';

    const sender = electronicAddress(
      invoice.clientOrg.eInvoicingAddress,
      invoice.clientOrg.eInvoicingScheme,
      invoice.clientOrg.siret ?? invoice.clientOrg.siren,
    );
    if (!sender) {
      throw new NotTransmittableError(
        `« ${invoice.clientOrg.name} » n'a pas d'adresse électronique de facturation. Renseignez son SIRET ou son adresse de routage avant de transmettre.`,
      );
    }

    const recipient = electronicAddress(
      invoice.buyer.eAddress,
      invoice.buyer.eScheme,
      invoice.buyer.legalId,
    );
    if (!recipient) {
      throw new NotTransmittableError(
        `Le client « ${invoice.buyer.name} » n'a pas d'adresse électronique de routage sur cette facture. La plateforme ne pourrait pas la livrer.`,
      );
    }

    return {
      connection: transmission.pdpConnection,
      invoiceNumber: invoice.invoiceNumber,
      transmit: {
        artifact: bytes,
        filename: `${invoice.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.${isPdf ? 'pdf' : 'xml'}`,
        mimeType: isPdf ? 'application/pdf' : 'application/xml',
        idempotencyKey: transmission.idempotencyKey,
        recipient,
        sender,
      },
    };
  }

  /** Success: the row, the lifecycle history and the invoice state move together or not at all. */
  private async recordSent(
    row: Transmission,
    externalId: string,
    acceptedAt: Date,
    raw: unknown,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.transmission.update({
        where: { id: row.id },
        data: {
          state: 'SENT',
          externalId,
          sentAt: now,
          lastError: null,
          claimedAt: null,
          claimedBy: null,
        },
      });

      // `DEPOSEE` is our own observation that the platform accepted the document, so it is
      // recorded with the platform as its source and the platform's own timestamp. The status
      // stream will confirm it later; `skipDuplicates` makes that confirmation a no-op instead of
      // a constraint violation.
      await tx.lifecycleStatus.createMany({
        data: [
          {
            invoiceId: row.invoiceId,
            code: 'DEPOSEE',
            label: LIFECYCLE_DEFINITIONS.DEPOSEE.label,
            source: 'PA',
            occurredAt: acceptedAt,
            payload: raw === undefined ? undefined : (raw as Prisma.InputJsonValue),
          },
        ],
        skipDuplicates: true,
      });

      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: row.invoiceId },
        select: { state: true },
      });
      const next = advanceState(invoice.state, 'DEPOSEE');
      if (next) {
        await tx.invoice.update({ where: { id: row.invoiceId }, data: { state: next } });
      }
    });
  }

  /**
   * Failure: back off, or park.
   *
   * The claim is released either way. A row that stays claimed after a failure is a row no worker
   * will touch until its lease expires, which turns a thirty-second backoff into five minutes.
   */
  private async recordFailure(
    row: Transmission,
    error: unknown,
    now: Date,
  ): Promise<'retry' | 'parked'> {
    const attempt = row.attempt + 1;
    const message = describe(error);

    // A document the platform will never accept, or a connection that cannot be resolved, does
    // not become acceptable by waiting. Park it now rather than spending six attempts finding out.
    const permanent = error instanceof NotTransmittableError;
    const park = permanent || attempt > MAX_ATTEMPTS;

    const delaySeconds = BACKOFF_SECONDS[Math.min(row.attempt, BACKOFF_SECONDS.length - 1)];
    // Jitter, so a platform coming back up is not met by every parked invoice at once.
    const jitter = Math.floor(Math.random() * Math.min(delaySeconds, 30));

    await this.prisma.$transaction(async (tx) => {
      await tx.transmission.update({
        where: { id: row.id },
        data: {
          state: park ? 'FAILED' : 'PENDING',
          attempt,
          lastError: message.slice(0, 1000),
          claimedAt: null,
          claimedBy: null,
          nextAttemptAt: park
            ? row.nextAttemptAt
            : new Date(now.getTime() + (delaySeconds + jitter) * 1000),
        },
      });

      // The failure history lives in the status timeline rather than only in `lastError`, which
      // holds one message. When a client asks why their invoice took three days, the answer is
      // the sequence of attempts, not the last of them.
      await tx.lifecycleStatus.createMany({
        data: [
          {
            invoiceId: row.invoiceId,
            code: park ? 'TRANSMISSION_ABANDONNEE' : 'TRANSMISSION_ECHOUEE',
            label: park
              ? `Transmission abandonnée après ${attempt} tentative(s)`
              : `Échec de transmission (tentative ${attempt})`,
            source: 'INTERNAL',
            occurredAt: now,
            payload: { error: message.slice(0, 1000), attempt },
          },
        ],
        skipDuplicates: true,
      });
    });

    if (park) {
      this.logger.error(
        `Transmission ${row.id} abandonnée après ${attempt} tentative(s) : ${message}`,
      );
      return 'parked';
    }

    this.logger.warn(
      `Transmission ${row.id} en échec (tentative ${attempt}), nouvel essai dans ${delaySeconds}s : ${message}`,
    );
    return 'retry';
  }

  /**
   * Puts a parked transmission back in the queue.
   *
   * The row keeps its key, so the platform still recognises the send as the same one - a retry
   * after fixing a wrong address must not become a second invoice.
   */
  async retry(tenantId: string, transmissionId: string): Promise<void> {
    const row = await this.prisma.transmission.findFirst({
      where: { id: transmissionId, invoice: { tenantId } },
      select: { id: true, state: true },
    });
    if (!row) throw new NotTransmittableError('Transmission introuvable.');
    if (row.state === 'SENT' || row.state === 'ACKNOWLEDGED') {
      throw new NotTransmittableError(
        'Cette facture a déjà été transmise. La renvoyer créerait un doublon chez le destinataire.',
      );
    }

    await this.prisma.transmission.update({
      where: { id: row.id },
      data: {
        state: 'PENDING',
        nextAttemptAt: new Date(),
        attempt: 0,
        claimedAt: null,
        claimedBy: null,
      },
    });
  }
}

/**
 * The deduplication key.
 *
 * Bound to the sealed bytes, not to the row: two enqueues of the same document agree, and a
 * genuinely different document - a corrective invoice, say - cannot collide with the original.
 * Prefixed and truncated so it stays a reasonable length for a platform's own field limits while
 * keeping far more entropy than a collision would need.
 */
export function transmissionKey(invoiceId: string, contentHash: string): string {
  const digest = createHash('sha256').update(`${invoiceId}:${contentHash}`).digest('hex');
  return `fx-${digest.slice(0, 40)}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * The routing address for a party, and the scheme that gives it meaning.
 *
 * An address without its scheme is ambiguous - `44306184100005` is a SIRET under `0009` and
 * nothing under anything else - so a bare fallback identifier is labelled by its shape: fourteen
 * digits is an establishment (SIRET, `0009`), nine is a company (SIREN, `0002`).
 */
function electronicAddress(
  address: string | null,
  scheme: string | null,
  fallback: string | null,
): { address: string; scheme: string } | null {
  if (address && scheme) return { address, scheme };

  const candidate = (address ?? fallback ?? '').replace(/\s/g, '');
  if (/^\d{14}$/.test(candidate)) return { address: candidate, scheme: '0009' };
  if (/^\d{9}$/.test(candidate)) return { address: candidate, scheme: '0002' };
  return null;
}
