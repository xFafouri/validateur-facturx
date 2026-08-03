/**
 * `@facturx/core/browser` - the parts that run anywhere.
 *
 * The main entry point reaches for `node:fs` (font resolution) and `node:crypto`, which is correct
 * for the API and the server side of the web app and fatal for a bundle sent to a browser. Rather
 * than stubbing Node builtins in the bundler - which would quietly ship the whole PDF generator to
 * every visitor - the browser-safe modules are named explicitly here.
 *
 * The reason this entry point exists at all is that the invoicing form previews totals as the user
 * types. Those figures have to match the issued document exactly, and the only way to guarantee
 * that is for both to call the same function. A second implementation in the UI would be a second
 * rounding policy, and BR-CO-10 is precisely the rule that catches two rounding policies
 * disagreeing by a cent.
 *
 * Everything re-exported here is `bigint`-backed or pure data: no I/O, no Node builtins.
 */

export * as money from './money.js';
export type { Decimal } from './money.js';

export { computeInvoice, DraftAmountError } from './generate/compute.js';
export type {
  ComputedInvoice,
  ComputedLine,
  ComputedTaxGroup,
  ComputedTotals,
} from './generate/compute.js';

export {
  DRAFT_TYPE_CODES,
  REASON_REQUIRED_CATEGORIES,
  VAT_CATEGORIES,
  ZERO_RATED_CATEGORIES,
} from './generate/draft.js';
export type {
  DraftAddress,
  DraftLine,
  DraftParty,
  DraftTypeCode,
  InvoiceDraft,
  VatCategory,
} from './generate/draft.js';

/** Lets the form report the same problems the generator would, before anything is submitted. */
export { checkDraft, isValidIban } from './generate/check-draft.js';
export type { DraftCheckResult, DraftIssue, DraftIssueSeverity } from './generate/check-draft.js';

export {
  formatSiren,
  formatSiret,
  sirenFromSiret,
  validateFrenchVatNumber,
  validateSiren,
  validateSiret,
  vatNumberFromSiren,
} from './identifiers.js';
export type { IdentifierKind, IdentifierValidation } from './identifiers.js';
