/**
 * Derives every monetary total on an invoice from its lines.
 *
 * This is the half of generation that makes the output valid rather than merely well-formed. The
 * EN 16931 arithmetic rules (`BR-CO-10`, `BR-CO-13`, `BR-CO-15`, `BR-CO-16`, `BR-S-08`...) all
 * assert that a declared total equals a sum computed from the document's own parts. Computing those
 * totals here, from the same parts, is what makes them true by construction.
 *
 * Rounding happens at exactly one place per quantity, and in the order EN 16931 specifies: each
 * line is rounded to the cent *before* being summed (BT-131 is a 2-decimal amount, so the sum the
 * validator checks is a sum of rounded values). Summing unrounded products and rounding at the end
 * gives a different figure on perhaps one invoice in fifty - and that invoice is rejected.
 */

import {
  type Decimal,
  MONETARY_SCALE,
  add,
  decimal,
  multiply,
  parseDecimal,
  rescale,
  subtract,
  sum,
  ZERO,
} from '../money.js';
import {
  REASON_REQUIRED_CATEGORIES,
  type DraftLine,
  type InvoiceDraft,
  type VatCategory,
} from './draft.js';

export class DraftAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftAmountError';
  }
}

/** Parses an amount from the draft, refusing rather than coercing anything unparseable. */
function required(raw: string, field: string): Decimal {
  const value = parseDecimal(raw);
  if (value === null) {
    throw new DraftAmountError(`Montant illisible pour « ${field} » : « ${raw} ».`);
  }
  return value;
}

export interface ComputedLine {
  readonly source: DraftLine;
  /** 1-based position, used as BT-126. */
  readonly lineId: string;
  readonly quantity: Decimal;
  readonly unitPrice: Decimal;
  /** BT-131, rounded to the cent. */
  readonly netAmount: Decimal;
  readonly vatCategory: VatCategory;
  readonly vatRatePercent: Decimal;
}

export interface ComputedTaxGroup {
  /** BT-118. */
  readonly categoryCode: VatCategory;
  /** BT-119. */
  readonly ratePercent: Decimal;
  /** BT-116: sum of the net amounts taxed at this rate. */
  readonly basisAmount: Decimal;
  /** BT-117: VAT due on that basis. */
  readonly calculatedAmount: Decimal;
  /** BT-120. */
  readonly exemptionReason: string | null;
}

export interface ComputedTotals {
  /** BT-106. */
  readonly lineTotalAmount: Decimal;
  /** BT-109: total excluding VAT. */
  readonly taxBasisTotalAmount: Decimal;
  /** BT-110. */
  readonly taxTotalAmount: Decimal;
  /** BT-112: total including VAT. */
  readonly grandTotalAmount: Decimal;
  /** BT-113. */
  readonly prepaidAmount: Decimal;
  /** BT-115: what the buyer actually owes. */
  readonly duePayableAmount: Decimal;
}

export interface ComputedInvoice {
  readonly lines: readonly ComputedLine[];
  readonly taxGroups: readonly ComputedTaxGroup[];
  readonly totals: ComputedTotals;
}

const HUNDRED_SCALE = 2;

/**
 * VAT on a basis, without dividing.
 *
 * `basis * rate` is exact; the `/ 100` is applied by declaring the result two decimal places
 * further right rather than performing a division, which would be the only inexact step in the
 * whole calculation.
 */
function vatOn(basis: Decimal, ratePercent: Decimal): Decimal {
  const product = multiply(basis, ratePercent);
  return rescale(decimal(product.value, product.scale + HUNDRED_SCALE), MONETARY_SCALE);
}

/** Groups are keyed on the pair EN 16931 breaks VAT down by (BR-CO-18). */
function groupKey(category: VatCategory, rate: Decimal): string {
  return `${category}|${rescale(rate, MONETARY_SCALE).value.toString()}`;
}

function computeLine(line: DraftLine, index: number): ComputedLine {
  const label = line.name || `ligne ${index + 1}`;
  const quantity = required(line.quantity, `quantité (${label})`);
  const unitPrice = required(line.unitPrice, `prix unitaire (${label})`);
  const vatRatePercent = required(line.vatRatePercent, `taux de TVA (${label})`);

  return {
    source: line,
    lineId: String(index + 1),
    quantity,
    unitPrice,
    // Rounded here, once. See the module note on rounding order.
    netAmount: rescale(multiply(quantity, unitPrice), MONETARY_SCALE),
    vatCategory: line.vatCategory,
    vatRatePercent,
  };
}

/**
 * Computes lines, the VAT breakdown and the totals.
 *
 * Throws only on input that cannot be read as a number at all. Everything a business rule would
 * object to - a missing exemption reason, a rate that does not exist in France - is the concern of
 * `checkDraft`, which reports all such problems together instead of failing at the first.
 */
export function computeInvoice(draft: InvoiceDraft): ComputedInvoice {
  const lines = draft.lines.map(computeLine);

  // Insertion-ordered, so the breakdown follows the order the rates first appear on the invoice
  // rather than an arbitrary one. Two documents built from the same data are then byte-identical.
  const groups = new Map<string, { lines: ComputedLine[]; line: ComputedLine }>();
  for (const line of lines) {
    const key = groupKey(line.vatCategory, line.vatRatePercent);
    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(line);
    } else {
      groups.set(key, { lines: [line], line });
    }
  }

  const taxGroups: ComputedTaxGroup[] = [...groups.values()].map((group) => {
    const basisAmount = sum(group.lines.map((line) => line.netAmount));
    const ratePercent = rescale(group.line.vatRatePercent, MONETARY_SCALE);
    return {
      categoryCode: group.line.vatCategory,
      ratePercent,
      basisAmount,
      calculatedAmount: vatOn(basisAmount, ratePercent),
      // The reason is a property of the category, so the first line carrying it speaks for the
      // group; `checkDraft` is what ensures the lines in a group do not disagree about it. It is
      // dropped for any category that must not carry one - a zero-rated line with a stray reason
      // would otherwise emit a document failing BR-Z-10.
      exemptionReason: REASON_REQUIRED_CATEGORIES.includes(group.line.vatCategory)
        ? (group.lines.find((line) => line.source.exemptionReason)?.source.exemptionReason ?? null)
        : null,
    };
  });

  const lineTotalAmount = sum(lines.map((line) => line.netAmount));
  // No document-level allowances or charges are emitted yet, so BT-109 is BT-106. Kept as its own
  // binding rather than an alias because BT-107/BT-108 land here when they arrive.
  const taxBasisTotalAmount = lineTotalAmount;
  const taxTotalAmount = sum(taxGroups.map((group) => group.calculatedAmount));
  const grandTotalAmount = add(taxBasisTotalAmount, taxTotalAmount);
  const prepaidAmount = draft.prepaidAmount
    ? rescale(required(draft.prepaidAmount, 'acompte versé'), MONETARY_SCALE)
    : rescale(ZERO, MONETARY_SCALE);

  return {
    lines,
    taxGroups,
    totals: {
      lineTotalAmount,
      taxBasisTotalAmount,
      taxTotalAmount,
      grandTotalAmount,
      prepaidAmount,
      duePayableAmount: subtract(grandTotalAmount, prepaidAmount),
    },
  };
}
