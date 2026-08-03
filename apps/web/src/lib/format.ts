/**
 * French formatting for amounts, dates and identifiers.
 *
 * Amounts arrive as exact decimal strings and are formatted for display only - never parsed back
 * into a number for arithmetic. `Intl.NumberFormat` needs a `number`, which is acceptable at the
 * very last step because nothing downstream of a rendered string is computed from it.
 *
 * The locale is fixed to `fr-FR` rather than taken from the browser: the amounts are French tax
 * figures, and a user with an en-US browser reading `1,234.56` where the invoice says `1 234,56`
 * would have to translate every number on screen back to the document they are checking.
 */

const EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });
const DATE_SHORT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeZone: 'Europe/Paris',
});

/**
 * An amount a received invoice may simply not have stated.
 *
 * Rendered as a dash rather than as `0,00 €`: an invented figure on an accountant's screen is far
 * worse than a visible gap, and a supplier who omitted BT-112 did not bill zero.
 */
export function formatOptionalEuros(amount: string | null | undefined, currency = 'EUR'): string {
  if (amount === null || amount === undefined) return 'non indiqué';
  return formatEuros(amount, currency);
}

export function formatEuros(amount: string, currency = 'EUR'): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  if (currency !== 'EUR') {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
  }
  return EUROS.format(value);
}

/** A quantity or rate: up to the given precision, trailing zeros trimmed. */
export function formatDecimal(value: string, maxDigits = 4): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: maxDigits }).format(parsed);
}

/**
 * `YYYY-MM-DD` to a long French date.
 *
 * Parsed as UTC midnight and rendered in Europe/Paris. A bare `new Date('2026-09-01')` is UTC
 * midnight rendered in the *server's* zone, which for a server west of Greenwich prints 31 August
 * - an off-by-one on the issue date of a legal document.
 */
export function formatDate(iso: string | null | undefined, short = false): string {
  if (!iso) return '—';
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return (short ? DATE_SHORT : DATE).format(date);
}

/** `443 061 841`, the way INSEE writes it. */
export function formatSirenDisplay(siren: string | null | undefined): string {
  if (!siren) return '—';
  return siren.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
}

/** `443 061 841 00005`. */
export function formatSiretDisplay(siret: string | null | undefined): string {
  if (!siret) return '—';
  return siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4');
}

/** `12,3 ko`. Sizes here are archive artifacts, which are kilobytes, not gigabytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/** French labels for the lifecycle states the UI can show. */
export const INVOICE_STATE_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  VALIDATED: 'Vérifiée',
  QUEUED: 'En attente de transmission',
  TRANSMITTED: 'Transmise',
  DELIVERED: 'Remise',
  REJECTED: 'Rejetée',
  ARCHIVED: 'Archivée',
};

/** BT-3, UNTDID 1001. */
export const TYPE_CODE_LABELS: Record<string, string> = {
  '380': 'Facture',
  '381': 'Avoir',
  '384': 'Facture rectificative',
  '386': 'Facture d’acompte',
};

/** BT-151, UNTDID 5305. */
export const VAT_CATEGORY_LABELS: Record<string, string> = {
  S: 'TVA au taux normal',
  Z: 'Taux zéro',
  E: 'Exonéré',
  AE: 'Autoliquidation',
  K: 'Livraison intracommunautaire',
  G: 'Exportation hors UE',
};
