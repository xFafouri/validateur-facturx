/**
 * The lifecycle vocabulary, and what each status does to an invoice.
 *
 * ## Why an internal vocabulary rather than the platforms' codes
 *
 * Under the 5-corner model an invoice's life is reported back to us as a stream of statuses, and
 * some of them are not decorative: a refusal changes what the supplier may claim, and the payment
 * statuses feed e-reporting. Every platform expresses them differently - numeric codes for some,
 * strings for others, and the numbering has moved between revisions of the DGFiP specifications.
 *
 * So the codes below are *ours*, and each adapter maps its platform's codes onto them. That keeps
 * the translation in the one place that knows the platform, and it means a platform renumbering
 * its statuses is an adapter change rather than a data migration over rows that have already been
 * written. `LifecycleStatus.payload` keeps the platform's original message verbatim, so nothing
 * this mapping discards is actually lost.
 *
 * ## Accuracy
 *
 * The names follow the French specifications' vocabulary, and the *mandatory* subset is flagged
 * below. Per the README's standing caveat, the mandatory set and its exact semantics must be
 * confirmed against current DGFiP and FNFE-MPE publications before go-live - they have changed
 * once already. Nothing here should be read as a citation.
 */

import type { InvoiceState } from '@prisma/client';

export type LifecycleCode =
  | 'DEPOSEE'
  | 'REJETEE'
  | 'PRISE_EN_CHARGE'
  | 'MISE_A_DISPOSITION'
  | 'RECUE_PAR_LA_PLATEFORME_DESTINATAIRE'
  | 'APPROUVEE'
  | 'APPROUVEE_PARTIELLEMENT'
  | 'REFUSEE'
  | 'PAIEMENT_TRANSMIS'
  | 'ENCAISSEE'
  | 'COMPLETEE'
  | 'SUSPENDUE';

export interface LifecycleDefinition {
  readonly code: LifecycleCode;
  /** Shown in the UI and in the status timeline. */
  readonly label: string;
  /**
   * Whether the specifications require this status to be exchanged.
   *
   * Recorded because a platform that never emits a mandatory status is misconfigured or
   * non-conforming, and that is worth being able to detect rather than assume.
   */
  readonly mandatory: boolean;
  /**
   * The invoice state this status implies, or `null` when it carries no state change.
   *
   * `SUSPENDUE` is the interesting `null`: a suspension is a real event that belongs in the
   * history, but it does not move the invoice forward or backward - inventing a state for it
   * would make the timeline lie about where the document actually is.
   */
  readonly state: InvoiceState | null;
}

export const LIFECYCLE_DEFINITIONS: Readonly<Record<LifecycleCode, LifecycleDefinition>> = {
  DEPOSEE: {
    code: 'DEPOSEE',
    label: 'Déposée sur la plateforme',
    mandatory: true,
    state: 'TRANSMITTED',
  },
  REJETEE: {
    code: 'REJETEE',
    label: 'Rejetée par la plateforme',
    mandatory: true,
    state: 'REJECTED',
  },
  PRISE_EN_CHARGE: {
    code: 'PRISE_EN_CHARGE',
    label: 'Prise en charge par la plateforme',
    mandatory: false,
    state: 'TRANSMITTED',
  },
  MISE_A_DISPOSITION: {
    code: 'MISE_A_DISPOSITION',
    label: 'Mise à disposition du destinataire',
    mandatory: true,
    state: 'DELIVERED',
  },
  RECUE_PAR_LA_PLATEFORME_DESTINATAIRE: {
    code: 'RECUE_PAR_LA_PLATEFORME_DESTINATAIRE',
    label: 'Reçue par la plateforme du destinataire',
    mandatory: false,
    state: 'DELIVERED',
  },
  APPROUVEE: {
    code: 'APPROUVEE',
    label: 'Approuvée par le destinataire',
    mandatory: false,
    state: 'DELIVERED',
  },
  APPROUVEE_PARTIELLEMENT: {
    code: 'APPROUVEE_PARTIELLEMENT',
    label: 'Approuvée partiellement par le destinataire',
    mandatory: false,
    state: 'DELIVERED',
  },
  REFUSEE: {
    code: 'REFUSEE',
    label: 'Refusée par le destinataire',
    mandatory: true,
    state: 'REJECTED',
  },
  PAIEMENT_TRANSMIS: {
    code: 'PAIEMENT_TRANSMIS',
    label: 'Paiement transmis',
    mandatory: false,
    state: null,
  },
  ENCAISSEE: {
    code: 'ENCAISSEE',
    label: 'Encaissée',
    // Mandatory for the supplier, and the one that matters for VAT on services: the tax becomes
    // due on collection, so this status is what a cash-basis e-reporting return is built from.
    mandatory: true,
    state: null,
  },
  COMPLETEE: {
    code: 'COMPLETEE',
    label: 'Complétée',
    mandatory: false,
    state: null,
  },
  SUSPENDUE: {
    code: 'SUSPENDUE',
    label: 'Suspendue',
    mandatory: false,
    state: null,
  },
};

/**
 * Statuses we record about ourselves.
 *
 * Kept apart from the specifications' vocabulary rather than mixed into it, because they are not
 * lifecycle statuses in the regulatory sense - no platform emits them and none should ever be
 * reported onward as if the DGFiP defined it. They exist because the timeline is what a user
 * reads when they ask why an invoice has not arrived, and "we tried four times and the platform
 * refused the connection" is the honest answer to that question.
 *
 * They carry `source: INTERNAL`, which is exactly the distinction `StatusSource` was added for.
 */
export const INTERNAL_LIFECYCLE_LABELS: Readonly<Record<string, string>> = {
  RECEIVED: 'Facture reçue et déposée',
  TRANSMISSION_ECHOUEE: 'Échec de transmission',
  TRANSMISSION_ABANDONNEE: 'Transmission abandonnée',
};

const KNOWN_CODES = new Set<string>(Object.keys(LIFECYCLE_DEFINITIONS));

export function isLifecycleCode(code: string): code is LifecycleCode {
  return KNOWN_CODES.has(code);
}

/** A human label for any code we might have stored, ours or a platform's. */
export function lifecycleLabel(code: string): string | null {
  if (isLifecycleCode(code)) return LIFECYCLE_DEFINITIONS[code].label;
  return INTERNAL_LIFECYCLE_LABELS[code] ?? null;
}

/**
 * How far along an invoice is.
 *
 * Statuses do not arrive in order. Platforms batch them, retry them, and emit them from several
 * systems at once, so a poll can easily deliver `DEPOSEE` after `MISE_A_DISPOSITION` has already
 * been recorded. Applying each status as it arrives would then walk the invoice *backwards*, and
 * a user watching the screen would see a delivered invoice revert to "sent".
 *
 * Ranking makes the state a function of the furthest point reached rather than of the most
 * recently received message. The history stays complete either way - every status is appended,
 * including the late one; only the summary state is monotonic.
 *
 * `ARCHIVED` is absent on purpose. It is not a point on this path: archiving is something we do,
 * not something a platform reports, and no incoming status should be able to set it.
 */
const STATE_RANK: Readonly<Record<InvoiceState, number>> = {
  DRAFT: 0,
  VALIDATED: 1,
  QUEUED: 2,
  TRANSMITTED: 3,
  DELIVERED: 4,
  // Above DELIVERED because a refusal is something the buyer does *after* receiving. Terminal in
  // practice: the remedy is a corrective invoice, which is a new document with its own lifecycle.
  REJECTED: 5,
  ARCHIVED: 6,
};

/**
 * The state an invoice should hold, given where it is and a status that just arrived.
 *
 * Returns `null` when nothing should change, so a caller can skip the write rather than issue an
 * update that sets a column to the value it already has.
 */
export function advanceState(current: InvoiceState, code: string): InvoiceState | null {
  if (!isLifecycleCode(code)) return null;

  const next = LIFECYCLE_DEFINITIONS[code].state;
  if (next === null) return null;

  // Never regress, and never disturb an archived invoice.
  if (current === 'ARCHIVED') return null;
  if (STATE_RANK[next] <= STATE_RANK[current]) return null;

  return next;
}
