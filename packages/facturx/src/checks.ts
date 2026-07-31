/**
 * Arithmetic self-checks computed from the parsed invoice.
 *
 * These do not replace the Schematron engine - it stays the authority on compliance. They exist
 * because the engine reports a failure as the rule text ("Sum of Invoice line net amount (BT-106)
 * = Σ Invoice line net amount (BT-131)") without ever stating the two amounts it compared. The
 * user is left knowing a total is wrong but not by how much, or which line to look at.
 *
 * Having parsed the document, we can compute both sides and show the difference to the cent. In
 * practice that turns the single most common rejection into a fifteen-second fix.
 *
 * All arithmetic goes through the exact `Decimal` type; see `money.ts` for why that matters here.
 */

import type { CiiInvoice } from './extract/cii.js';
import { profileCanExpressPrepaidAmount } from './profiles.js';
import {
  type Decimal,
  add,
  equalsAtMonetaryScale,
  format,
  formatFrench,
  multiply,
  parseDecimal,
  rescale,
  subtract,
  sum,
  MONETARY_SCALE,
  ZERO,
} from './money.js';

export interface ArithmeticCheck {
  /** The EN 16931 rule this check mirrors. */
  readonly ruleId: string;
  /** Short French statement of what is being checked. */
  readonly label: string;
  readonly passed: boolean;
  /** What the document declares. */
  readonly declared: Decimal | null;
  /** What the document's own components add up to. */
  readonly computed: Decimal | null;
  /** `computed - declared`, when both are known. */
  readonly difference: Decimal | null;
  /** Ready-to-display French sentence describing the outcome. */
  readonly detail: string;
}

const HUNDRED = parseDecimal('100')!;

/**
 * Describes a mismatch.
 *
 * The check's `label` is carried as its own field, so it is deliberately absent here - embedding
 * it would print the label twice wherever both are shown together.
 */
function describeMismatch(declared: Decimal, computed: Decimal, currency: string | null): string {
  const difference = subtract(computed, declared);
  // `difference` is computed - declared, so a positive value means the declared figure is the
  // smaller of the two. Stating the direction explicitly avoids the ambiguity of "il manque X",
  // which reads as an understatement even when the declared total is too high.
  const direction = difference.value > 0n ? 'inférieur' : 'supérieur';
  return (
    `La facture déclare ${formatFrench(declared, currency)}, ` +
    `mais le calcul donne ${formatFrench(computed, currency)}. ` +
    `Le montant déclaré est ${direction} de ${formatFrench(abs(difference), currency)} au montant attendu.`
  );
}

function abs(d: Decimal): Decimal {
  return d.value < 0n ? { value: -d.value, scale: d.scale } : d;
}

function check(
  ruleId: string,
  label: string,
  declared: Decimal | null,
  computed: Decimal | null,
  currency: string | null,
  skippedDetail: string,
): ArithmeticCheck {
  if (declared === null || computed === null) {
    return {
      ruleId,
      label,
      passed: true, // Not evaluable is not a failure; the engine will report the missing field.
      declared,
      computed,
      difference: null,
      detail: skippedDetail,
    };
  }

  const passed = equalsAtMonetaryScale(declared, computed);
  return {
    ruleId,
    label,
    passed,
    declared,
    computed,
    difference: subtract(computed, declared),
    detail: passed
      ? `Cohérent (${formatFrench(declared, currency)}).`
      : describeMismatch(declared, computed, currency),
  };
}

export interface VatRateCheck {
  readonly ratePercent: Decimal | null;
  readonly categoryCode: string | null;
  readonly declaredBasis: Decimal | null;
  readonly declaredTax: Decimal | null;
  readonly computedTax: Decimal | null;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ArithmeticReport {
  readonly checks: readonly ArithmeticCheck[];
  readonly vatRates: readonly VatRateCheck[];
  /** True when every evaluable check passed. */
  readonly allPassed: boolean;
}

/**
 * Runs the arithmetic checks mirroring BR-CO-10, BR-CO-13, BR-CO-14, BR-CO-15 and BR-CO-16,
 * plus per-rate VAT verification (BR-CO-17).
 *
 * A check whose inputs are missing is reported as passed-but-not-evaluated rather than failed:
 * the absent field is itself a finding the engine raises, and double-reporting it as an
 * arithmetic error would send the user looking for a calculation problem that does not exist.
 */
export function checkArithmetic(invoice: CiiInvoice): ArithmeticReport {
  const currency = invoice.currency;
  const totals = invoice.totals;

  // --- BR-CO-10: BT-106 = Σ BT-131 -----------------------------------------
  const lineAmounts = invoice.lines
    .map((line) => line.netAmount)
    .filter((amount): amount is Decimal => amount !== null);

  const computedLineTotal = invoice.lines.length > 0 ? sum(lineAmounts) : null;

  const lineTotalCheck = check(
    'BR-CO-10',
    'Total HT des lignes',
    totals.lineTotalAmount,
    computedLineTotal,
    currency,
    'Non vérifiable : la facture ne comporte pas de lignes exploitables.',
  );

  // --- BR-CO-13: BT-109 = BT-106 - BT-107 + BT-108 --------------------------
  const allowance = totals.allowanceTotalAmount ?? ZERO;
  const charge = totals.chargeTotalAmount ?? ZERO;
  const computedTaxBasis =
    totals.lineTotalAmount !== null
      ? add(subtract(totals.lineTotalAmount, allowance), charge)
      : null;

  const taxBasisCheck = check(
    'BR-CO-13',
    'Total HT de la facture',
    totals.taxBasisTotalAmount,
    computedTaxBasis,
    currency,
    'Non vérifiable : le total des lignes est absent.',
  );

  // --- BR-CO-14: BT-110 = Σ BT-117 -----------------------------------------
  const taxAmounts = invoice.taxBreakdown
    .map((entry) => entry.calculatedAmount)
    .filter((amount): amount is Decimal => amount !== null);

  const computedTaxTotal = invoice.taxBreakdown.length > 0 ? sum(taxAmounts) : null;

  const taxTotalCheck = check(
    'BR-CO-14',
    'Total de TVA',
    totals.taxTotalAmount,
    computedTaxTotal,
    currency,
    'Non vérifiable : la ventilation de TVA est absente.',
  );

  // --- BR-CO-15: BT-112 = BT-109 + BT-110 ----------------------------------
  const computedGrandTotal =
    totals.taxBasisTotalAmount !== null && totals.taxTotalAmount !== null
      ? add(totals.taxBasisTotalAmount, totals.taxTotalAmount)
      : null;

  const grandTotalCheck = check(
    'BR-CO-15',
    'Total TTC',
    totals.grandTotalAmount,
    computedGrandTotal,
    currency,
    'Non vérifiable : le total HT ou le total de TVA est absent.',
  );

  // --- BR-CO-16: BT-115 = BT-112 - BT-113 ----------------------------------
  // Skipped on profiles that cannot express a prepayment: the gap that BR-CO-16 measures is then
  // unexplainable by construction, and reporting it would contradict the authoritative engine on
  // a document it accepts. These checks exist to explain the engine's findings, never to invent
  // findings of their own.
  const prepaid = totals.prepaidAmount ?? ZERO;
  const canCheckDue = profileCanExpressPrepaidAmount(invoice.profile);
  const computedDue =
    canCheckDue && totals.grandTotalAmount !== null
      ? subtract(totals.grandTotalAmount, prepaid)
      : null;

  const dueCheck = check(
    'BR-CO-16',
    'Net à payer',
    totals.duePayableAmount,
    computedDue,
    currency,
    canCheckDue
      ? 'Non vérifiable : le total TTC est absent.'
      : 'Non vérifiable : le profil MINIMUM ne permet pas de déclarer les acomptes (BT-113). Un écart avec le total TTC peut donc être parfaitement régulier.',
  );

  // --- BR-CO-17: per-rate VAT ----------------------------------------------
  const vatRates: VatRateCheck[] = invoice.taxBreakdown.map((entry) => {
    const { basisAmount, calculatedAmount, ratePercent, categoryCode } = entry;

    if (basisAmount === null || ratePercent === null) {
      return {
        ratePercent,
        categoryCode,
        declaredBasis: basisAmount,
        declaredTax: calculatedAmount,
        computedTax: null,
        passed: true,
        detail: 'TVA : non vérifiable, la base ou le taux est absent.',
      };
    }

    // BT-117 = round(BT-116 x BT-119 / 100, 2). Rounding at the end, once, is what the rule says.
    const product = multiply(basisAmount, ratePercent);
    const scaled = rescale(
      { value: product.value, scale: product.scale + HUNDRED.scale },
      product.scale,
    );
    const computedTax = rescale(divideByHundred(scaled), MONETARY_SCALE);

    const rateLabel = `${format(rescale(ratePercent, 2))} %`;
    if (calculatedAmount === null) {
      return {
        ratePercent,
        categoryCode,
        declaredBasis: basisAmount,
        declaredTax: null,
        computedTax,
        passed: true,
        detail: `TVA à ${rateLabel} : montant non déclaré.`,
      };
    }

    const passed = equalsAtMonetaryScale(calculatedAmount, computedTax);
    return {
      ratePercent,
      categoryCode,
      declaredBasis: basisAmount,
      declaredTax: calculatedAmount,
      computedTax,
      passed,
      detail: passed
        ? `TVA à ${rateLabel} : cohérente (${formatFrench(calculatedAmount, currency)} sur une base de ${formatFrench(basisAmount, currency)}).`
        : `TVA à ${rateLabel} : la facture déclare ${formatFrench(calculatedAmount, currency)}, ` +
          `mais ${formatFrench(basisAmount, currency)} × ${rateLabel} donne ${formatFrench(computedTax, currency)}.`,
    };
  });

  const checks = [lineTotalCheck, taxBasisCheck, taxTotalCheck, grandTotalCheck, dueCheck];

  return {
    checks,
    vatRates,
    allPassed: checks.every((c) => c.passed) && vatRates.every((r) => r.passed),
  };
}

/**
 * Divides by 100 exactly, by shifting the scale rather than dividing the unscaled value.
 *
 * Dividing the integer would truncate; increasing the scale by two is lossless and lets the single
 * rounding step happen where the rule specifies it.
 */
function divideByHundred(d: Decimal): Decimal {
  return { value: d.value, scale: d.scale + 2 };
}

/**
 * Identifies which lines are most likely responsible for a `BR-CO-10` mismatch.
 *
 * When the difference matches a single line's amount exactly, that line was probably omitted from
 * or double-counted in the total, and naming it saves the user scanning the whole invoice.
 */
export function suspectLinesForLineTotal(invoice: CiiInvoice): string[] {
  const declared = invoice.totals.lineTotalAmount;
  if (declared === null || invoice.lines.length === 0) return [];

  const amounts = invoice.lines
    .map((line) => line.netAmount)
    .filter((amount): amount is Decimal => amount !== null);
  if (amounts.length === 0) return [];

  const difference = subtract(sum(amounts), declared);
  if (difference.value === 0n) return [];

  const target = abs(difference);
  return invoice.lines
    .filter((line) => line.netAmount !== null && equalsAtMonetaryScale(abs(line.netAmount), target))
    .map((line, index) => line.id ?? line.name ?? `ligne ${index + 1}`);
}
