/**
 * Pulling from the platforms: lifecycle statuses, and invoices addressed to us.
 *
 * ## Why polling, when webhooks exist
 *
 * Because a webhook that never arrives is silent, and both of these flows fail dangerously when
 * they fail silently. A missed status leaves an invoice showing as merely sent when the buyer has
 * refused it; a missed inbound invoice is a payable nobody knows about, and from 1 September 2026
 * being able to receive is the obligation that applies to every VAT-registered business. Polling
 * has a floor on how wrong it can be - one interval - and that floor is what makes it the primary
 * mechanism. Webhooks, where a platform offers them, should trigger an early poll rather than
 * replace one.
 *
 * ## Cursors that lag on purpose
 *
 * Each connection keeps a watermark per flow, advanced only as far as the last item actually
 * written. If the process dies halfway through a batch, the next poll re-reads from the last
 * *durable* point and re-delivers items we already have - which costs nothing, because statuses
 * deduplicate on their unique constraint and inbound invoices on their content hash. The
 * alternative, advancing the cursor to the end of the fetched window before the writes are
 * committed, loses whatever was in flight. Between re-reading and losing, this domain has an easy
 * answer.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { PdpConnection, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReceptionService } from '../invoicing/reception.service';
import { PdpRegistryService } from './pdp-registry.service';
import { advanceState, lifecycleLabel, LIFECYCLE_DEFINITIONS, isLifecycleCode } from './lifecycle';

/**
 * How far back a connection with no cursor starts.
 *
 * A new connection should not drag in a year of history the first time it polls, but starting at
 * "now" would skip anything that arrived while it was being configured. A day is comfortably
 * wider than that gap and narrow enough to stay cheap.
 */
const COLD_START_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Lifecycle codes that mean the platform has the document and is done taking it from us. */
const ACKNOWLEDGING_CODES = new Set([
  'MISE_A_DISPOSITION',
  'RECUE_PAR_LA_PLATEFORME_DESTINATAIRE',
  'APPROUVEE',
  'APPROUVEE_PARTIELLEMENT',
]);

export interface StatusPollReport {
  readonly fetched: number;
  readonly recorded: number;
  /** Statuses whose `externalId` matches no transmission of ours. */
  readonly unmatched: number;
}

export interface InboundPollReport {
  readonly fetched: number;
  readonly received: number;
  readonly duplicates: number;
  readonly rejected: number;
}

@Injectable()
export class PdpSyncService {
  private readonly logger = new Logger(PdpSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PdpRegistryService,
    private readonly reception: ReceptionService,
  ) {}

  /** Every connection that should be polled this tick. */
  async activeConnections(): Promise<PdpConnection[]> {
    const connections = await this.prisma.pdpConnection.findMany({ where: { active: true } });
    // A connection naming an adapter this build does not have is a deployment mismatch, not a
    // per-poll error: log it once per tick and skip, rather than throwing inside the loop.
    return connections.filter((connection) => {
      if (this.registry.has(connection.provider)) return true;
      this.logger.warn(
        `Connexion ${connection.id} ignorée : aucun adaptateur « ${connection.provider} ».`,
      );
      return false;
    });
  }

  /** Polls both flows for every active connection. Never throws; one bad connection is isolated. */
  async pollAll(): Promise<void> {
    for (const connection of await this.activeConnections()) {
      await this.pollConnection(connection);
    }
  }

  /**
   * Polls both flows for one connection, recording the outcome on the row.
   *
   * Never throws, because both callers need that. The tick must reach the connections behind a
   * broken one, and the webhook endpoint has already answered the platform by the time this runs -
   * an exception there would surface as an unhandled rejection rather than as anything a caller
   * could act on. The failure goes on the connection instead, where the settings screen shows it.
   *
   * Safe to run concurrently with the tick. Statuses deduplicate on their unique constraint and
   * inbound invoices on their content hash, so a webhook-triggered poll racing the timer costs a
   * duplicated read and writes nothing twice - which is what makes the debounce a courtesy to the
   * platform rather than a correctness requirement.
   */
  async pollConnection(connection: PdpConnection): Promise<void> {
    try {
      await this.pollStatuses(connection);
      await this.pollInbound(connection);
      await this.prisma.pdpConnection.update({
        where: { id: connection.id },
        data: { lastPolledAt: new Date(), lastError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Interrogation de la connexion ${connection.id} en échec : ${message}`);
      await this.prisma.pdpConnection
        .update({
          where: { id: connection.id },
          data: { lastPolledAt: new Date(), lastError: message.slice(0, 1000) },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Fetches lifecycle statuses and applies them.
   *
   * Statuses are matched to invoices through `Transmission.externalId`, which is the only
   * identifier both sides agree on. One that matches nothing is counted and dropped rather than
   * guessed at: attaching a status to the wrong invoice would corrupt the evidence trail that the
   * status exists to provide.
   */
  async pollStatuses(connection: PdpConnection): Promise<StatusPollReport> {
    const { provider, credentials } = this.registry.resolve(connection);
    const since = connection.statusCursor ?? new Date(Date.now() - COLD_START_WINDOW_MS);

    const updates = await provider.fetchStatuses(credentials, since);
    if (updates.length === 0) return { fetched: 0, recorded: 0, unmatched: 0 };

    // Oldest first, so the invoice state walks forward in the order the platform meant. The
    // ranking in `advanceState` makes this robust rather than required, but a timeline written in
    // order is also the one a human can read.
    const ordered = [...updates].sort(
      (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
    );

    let recorded = 0;
    let unmatched = 0;
    let watermark: Date | null = null;

    for (const update of ordered) {
      // Scoped to the connection that reported it: two platforms are free to mint the same
      // identifier, and a status from one must never be applied to the other's invoice.
      const transmission = await this.prisma.transmission.findFirst({
        where: { externalId: update.externalId, pdpConnectionId: connection.id },
        select: { id: true, invoiceId: true, state: true },
      });

      if (!transmission) {
        unmatched += 1;
        this.logger.warn(
          `Statut « ${update.code} » pour ${update.externalId} : aucune transmission correspondante.`,
        );
        // The cursor still advances past it. An unmatched status will never match on a re-read
        // either, and refusing to move would wedge the poller on it forever.
        watermark = update.occurredAt;
        continue;
      }

      const written = await this.applyStatus(transmission, update);
      if (written) recorded += 1;
      watermark = update.occurredAt;
    }

    if (watermark) {
      await this.prisma.pdpConnection.update({
        where: { id: connection.id },
        data: { statusCursor: watermark },
      });
    }

    if (recorded > 0 || unmatched > 0) {
      this.logger.log(
        `${recorded} statut(s) enregistré(s) pour ${connection.provider}` +
          (unmatched > 0 ? `, ${unmatched} sans correspondance.` : '.'),
      );
    }
    return { fetched: updates.length, recorded, unmatched };
  }

  /** Writes one status, advancing the invoice and closing out the transmission where warranted. */
  private async applyStatus(
    transmission: { id: string; invoiceId: string; state: string },
    update: { code: string; occurredAt: Date; raw?: unknown },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const inserted = await tx.lifecycleStatus.createMany({
        data: [
          {
            invoiceId: transmission.invoiceId,
            code: update.code,
            label: lifecycleLabel(update.code),
            source: 'PA',
            occurredAt: update.occurredAt,
            payload: update.raw === undefined ? undefined : (update.raw as Prisma.InputJsonValue),
          },
        ],
        skipDuplicates: true,
      });

      // Already had it - a re-read after a crash, or the platform repeating itself. Nothing
      // further to do: the state it implies was applied when it was first seen.
      if (inserted.count === 0) return false;

      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: transmission.invoiceId },
        select: { state: true },
      });
      const next = advanceState(invoice.state, update.code);
      if (next) {
        await tx.invoice.update({ where: { id: transmission.invoiceId }, data: { state: next } });
      }

      // Once the receiving side has it, our handover is complete and the row stops being
      // interesting to the queue.
      if (ACKNOWLEDGING_CODES.has(update.code) && transmission.state === 'SENT') {
        await tx.transmission.update({
          where: { id: transmission.id },
          data: { state: 'ACKNOWLEDGED', acknowledgedAt: update.occurredAt },
        });
      }

      // A rejection is not a retryable transmission failure - the platform or the buyer has taken
      // a decision, and re-sending the same document would only be refused again.
      if (isLifecycleCode(update.code) && LIFECYCLE_DEFINITIONS[update.code].state === 'REJECTED') {
        await tx.transmission.updateMany({
          where: { id: transmission.id, state: 'PENDING' },
          data: { state: 'FAILED', lastError: `Refusée par la plateforme : ${update.code}` },
        });
      }

      return true;
    });
  }

  /**
   * Fetches invoices addressed to our clients and files them.
   *
   * The work is `ReceptionService`'s, unchanged: this is a different doorway into the same room.
   * Routing by the document's buyer, deduplication by content hash, and recording a
   * non-conforming invoice rather than dropping it all behave exactly as they do for an upload -
   * which is the point of having built reception first and given it a `sourceChannel`.
   */
  async pollInbound(connection: PdpConnection): Promise<InboundPollReport> {
    const { provider, credentials } = this.registry.resolve(connection);
    const since = connection.inboundCursor ?? new Date(Date.now() - COLD_START_WINDOW_MS);

    const inbound = await provider.fetchInbound(credentials, since);
    if (inbound.length === 0) return { fetched: 0, received: 0, duplicates: 0, rejected: 0 };

    const clientOrg = await this.prisma.clientOrg.findUniqueOrThrow({
      where: { id: connection.clientOrgId },
      select: { tenantId: true },
    });

    const ordered = [...inbound].sort(
      (left, right) => left.receivedAt.getTime() - right.receivedAt.getTime(),
    );

    let received = 0;
    let duplicates = 0;
    let rejected = 0;
    let watermark: Date | null = null;
    const acknowledge: string[] = [];

    for (const invoice of ordered) {
      try {
        const result = await this.reception.receive({
          tenantId: clientOrg.tenantId,
          // Unrestricted: this is the platform delivering to the tenant, not a user acting. The
          // document's buyer decides which client business it lands in, and a poller has no user
          // whose scope could narrow that.
          allowedClientOrgIds: null,
          bytes: invoice.artifact,
          filename: invoice.filename,
          sourceChannel: provider.key,
          actorUserId: null,
          now: invoice.receivedAt,
        });

        if (result.duplicate) duplicates += 1;
        else received += 1;
        acknowledge.push(invoice.externalId);
        watermark = invoice.receivedAt;
      } catch (error) {
        // Unreadable, or addressed to a business this tenant does not manage. Both are the
        // platform's mistake or a supplier's, and neither is fixed by fetching it again - so it
        // is acknowledged and the cursor moves past it, with the reason on the record.
        rejected += 1;
        this.logger.error(
          `Facture entrante ${invoice.externalId} refusée : ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        acknowledge.push(invoice.externalId);
        watermark = invoice.receivedAt;
      }
    }

    if (acknowledge.length > 0) {
      // After the writes, never before. Acknowledging first would tell the platform to stop
      // re-delivering an invoice we then failed to store, and there is no way to ask for it back.
      await provider.acknowledge(credentials, acknowledge);
    }

    if (watermark) {
      await this.prisma.pdpConnection.update({
        where: { id: connection.id },
        data: { inboundCursor: watermark },
      });
    }

    this.logger.log(
      `${received} facture(s) entrante(s) via ${connection.provider}` +
        (duplicates > 0 ? `, ${duplicates} déjà connue(s)` : '') +
        (rejected > 0 ? `, ${rejected} refusée(s)` : '') +
        '.',
    );
    return { fetched: inbound.length, received, duplicates, rejected };
  }
}
