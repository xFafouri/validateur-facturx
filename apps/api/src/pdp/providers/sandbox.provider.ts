import { Injectable, Logger } from '@nestjs/common';
import type {
  InboundInvoice,
  LifecycleStatusUpdate,
  PdpCredentialField,
  PdpCredentials,
  PdpProvider,
  TransmitRequest,
  TransmitResult,
} from '../pdp-provider';

/**
 * In-memory provider used for local development and tests.
 *
 * It exists so the whole issue -> transmit -> status pipeline can be built and tested in Phase 2
 * before a real platform's sandbox credentials are available, and so CI never depends on a third
 * party being up. It deliberately models the awkward parts of a real platform - asynchronous
 * status arrival and idempotent replay - rather than being a trivial success stub, because those
 * are precisely the behaviours the calling code must get right.
 *
 * Never register this in production; `AppModule` selects providers by environment.
 */
@Injectable()
export class SandboxPdpProvider implements PdpProvider {
  readonly key = 'sandbox';
  readonly displayName = 'Plateforme de test (sandbox)';

  /** Empty, not omitted: this one authenticates nothing, and the screen should say so. */
  readonly credentialFields: readonly PdpCredentialField[] = [];

  private readonly logger = new Logger(SandboxPdpProvider.name);

  /** Keyed by idempotency key, so a replayed send returns the original result. */
  private readonly transmitted = new Map<string, TransmitResult>();
  private readonly statuses: LifecycleStatusUpdate[] = [];
  private readonly inbound: InboundInvoice[] = [];

  async transmit(_credentials: PdpCredentials, request: TransmitRequest): Promise<TransmitResult> {
    const existing = this.transmitted.get(request.idempotencyKey);
    if (existing) {
      // Exactly what a real platform must do, and what the caller must be able to rely on.
      this.logger.warn(`Replay of ${request.idempotencyKey}; returning the original result.`);
      return existing;
    }

    const result: TransmitResult = {
      externalId: `SANDBOX-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      acceptedAt: new Date(),
    };
    this.transmitted.set(request.idempotencyKey, result);

    // Statuses arrive after the fact in reality, so they are queued rather than returned.
    this.statuses.push({
      externalId: result.externalId,
      code: 'DEPOSEE',
      occurredAt: new Date(),
    });
    this.statuses.push({
      externalId: result.externalId,
      code: 'RECUE_PAR_LA_PLATEFORME_DESTINATAIRE',
      occurredAt: new Date(Date.now() + 1000),
    });

    return result;
  }

  async fetchInbound(_credentials: PdpCredentials, since: Date): Promise<InboundInvoice[]> {
    return this.inbound.filter((invoice) => invoice.receivedAt > since);
  }

  async fetchStatuses(_credentials: PdpCredentials, since: Date): Promise<LifecycleStatusUpdate[]> {
    return this.statuses.filter((status) => status.occurredAt > since);
  }

  async acknowledge(_credentials: PdpCredentials, externalIds: readonly string[]): Promise<void> {
    this.logger.debug(`Acknowledged: ${externalIds.join(', ')}`);
  }

  async verifyCredentials(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: 'Sandbox provider - aucune vérification réelle.' };
  }

  /** Test helper: queue an invoice as if a supplier had sent it to us. */
  seedInbound(invoice: InboundInvoice): void {
    this.inbound.push(invoice);
  }
}
