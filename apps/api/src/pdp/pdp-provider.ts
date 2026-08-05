/**
 * The boundary between this product and the certified platforms.
 *
 * ## Scope
 *
 * We are a *Solution Compatible* (SC), not a *Plateforme Agréée* (PA). We create invoices and hand
 * them to a PA; we never talk to the PPF directly, and we are not accredited to. Around a hundred
 * PAs already exist, and becoming one demands DGFiP accreditation plus heavy audit obligations -
 * that is not where this product's value is.
 *
 * Everything PA-specific lives behind this interface. Nothing above it should know which platform
 * a client uses, because:
 *
 *  - businesses switch platforms, and a switch must not touch invoicing logic;
 *  - an accountant tenant will have clients on several different platforms at once;
 *  - PEPPOL eDelivery is the default inter-platform transport, so becoming a PEPPOL Access Point
 *    later should be one more implementation of this interface rather than a rewrite.
 *
 * ## Reliability
 *
 * Every method here crosses a network to a third party that will be slow, will fail, and will
 * occasionally double-deliver. Implementations must therefore be called from queue workers and
 * never inline in a request, and `transmit` must be idempotent on `idempotencyKey` - a retry after
 * an ambiguous timeout must not produce a second invoice at the buyer, which would be a
 * commercial and fiscal problem, not just a technical one.
 */

/** The flows defined by the 5-corner model, named as the DGFiP specifications name them. */
export type FlowId = 'F1' | 'F2' | 'F6' | 'F10';

export interface TransmitRequest {
  /** The exact artifact to send - the sealed bytes, not a re-serialisation. */
  readonly artifact: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
  /**
   * Deduplication key, stable across retries of the same logical send.
   * The platform must treat two calls with the same key as one transmission.
   */
  readonly idempotencyKey: string;
  /** Routing target: the buyer's electronic address and its scheme. */
  readonly recipient: {
    readonly address: string;
    readonly scheme: string;
  };
  readonly sender: {
    readonly address: string;
    readonly scheme: string;
  };
}

export interface TransmitResult {
  /** Identifier assigned by the platform, stored for later reconciliation. */
  readonly externalId: string;
  readonly acceptedAt: Date;
  /** Whatever the platform returned, retained verbatim for dispute resolution. */
  readonly raw?: unknown;
}

export interface InboundInvoice {
  readonly externalId: string;
  readonly artifact: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
  readonly receivedAt: Date;
}

export interface LifecycleStatusUpdate {
  readonly externalId: string;
  /** DGFiP status code. The mandatory set must be confirmed against current specifications. */
  readonly code: string;
  readonly occurredAt: Date;
  readonly raw?: unknown;
}

export interface PdpCredentials {
  readonly apiBaseUrl: string;
  /** Decrypted only in memory, at the point of use. Never logged. */
  readonly secrets: Readonly<Record<string, string>>;
}

/**
 * One secret a platform authenticates with, described well enough to draw an input for it.
 *
 * Only the shape is described here, never a value: this travels to the settings screen, and the
 * screen's whole job is to collect a secret it will never be allowed to read back.
 */
export interface PdpCredentialField {
  /** The key this value is stored under in `PdpCredentials.secrets`. */
  readonly key: string;
  /** Label for the input, in the platform's own vocabulary - "Client ID", not "secret 1". */
  readonly label: string;
  /** Where the user finds this value, which is usually the hard part. */
  readonly hint?: string;
  /** Whether the platform refuses to authenticate without it. */
  readonly required?: boolean;
}

export interface PdpProvider {
  /** Adapter key stored on `PdpConnection.provider`. */
  readonly key: string;
  /** Display name for the UI. */
  readonly displayName: string;

  /**
   * The secrets this platform asks for.
   *
   * Declared rather than discovered, because the settings screen has to draw the boxes before
   * anyone has typed into them, and only the adapter knows whether its platform wants an API key,
   * an OAuth pair or a certificate passphrase.
   *
   * Three states, all meaningful. A list names the fields. An **empty** list means the platform
   * genuinely needs no secret - mutual TLS, or the sandbox - and the screen should say so rather
   * than show an empty form. **Omitted** means the adapter has not declared them, and the screen
   * falls back to a free-form list; an adapter that has not got round to this is then still
   * configurable rather than unusable, which is the point of leaving it optional.
   */
  readonly credentialFields?: readonly PdpCredentialField[];

  /**
   * Sends an invoice (flow F2, via the platform).
   *
   * Must be idempotent on `request.idempotencyKey`.
   */
  transmit(credentials: PdpCredentials, request: TransmitRequest): Promise<TransmitResult>;

  /**
   * Fetches invoices addressed to us that we have not yet ingested.
   *
   * Pull-based by design even where a platform offers webhooks: a missed webhook is silent, and
   * silently missing an inbound invoice means missing a payable. Webhooks, where available, should
   * trigger an early poll rather than replace polling.
   */
  fetchInbound(credentials: PdpCredentials, since: Date): Promise<InboundInvoice[]>;

  /** Fetches lifecycle status updates (flow F6). Statuses affect VAT reporting. */
  fetchStatuses(credentials: PdpCredentials, since: Date): Promise<LifecycleStatusUpdate[]>;

  /** Acknowledges receipt so the platform stops re-delivering. */
  acknowledge(credentials: PdpCredentials, externalIds: readonly string[]): Promise<void>;

  /** Cheap connectivity/credential check for the settings screen. */
  verifyCredentials(credentials: PdpCredentials): Promise<{ ok: boolean; detail?: string }>;
}

/** Injection token for the provider registry. */
export const PDP_PROVIDERS = Symbol('PDP_PROVIDERS');
