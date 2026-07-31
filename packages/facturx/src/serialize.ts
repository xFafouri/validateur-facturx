/**
 * JSON-safe projection of an analysis result.
 *
 * `Decimal` is backed by `bigint`, which `JSON.stringify` throws on. Rather than weaken the money
 * type to keep serialisation convenient - the exact opposite of what a compliance product should
 * trade away - amounts cross the wire as pre-formatted strings: the exact plain value for
 * machines, and the French rendering for display.
 *
 * This DTO is the contract for both the Next.js route handler and the future NestJS API, so the
 * two cannot drift into different shapes for the same data.
 */

import type { AnalysisResult, ExplainedFinding } from './analyze.js';
import type { ArithmeticReport } from './checks.js';
import type { CiiInvoice } from './extract/cii.js';
import { type Decimal, format, formatFrench } from './money.js';
import { PROFILE_INFO } from './profiles.js';
import { rulesetLabel, severityLabel } from './rules/catalogue.fr.js';

export interface AmountDto {
  /** Exact value, e.g. `1234.50`. Safe to parse; never lossy. */
  readonly value: string;
  /** French rendering, e.g. `1 234,50 €`. */
  readonly display: string;
}

function amountDto(amount: Decimal | null, currency: string | null): AmountDto | null {
  if (amount === null) return null;
  return { value: format(amount), display: formatFrench(amount, currency) };
}

export interface PartyDto {
  readonly name: string | null;
  readonly legalId: string | null;
  readonly vatId: string | null;
  readonly city: string | null;
  readonly postcode: string | null;
  readonly countryCode: string | null;
}

export interface LineDto {
  readonly id: string | null;
  readonly name: string | null;
  readonly quantity: string | null;
  readonly unitCode: string | null;
  readonly unitPrice: AmountDto | null;
  readonly netAmount: AmountDto | null;
  readonly vatRatePercent: string | null;
}

export interface InvoiceDto {
  readonly invoiceNumber: string | null;
  readonly typeCode: string | null;
  readonly typeLabel: string;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly currency: string | null;
  readonly buyerReference: string | null;
  readonly seller: PartyDto;
  readonly buyer: PartyDto;
  readonly lines: readonly LineDto[];
  readonly taxBreakdown: ReadonlyArray<{
    readonly categoryCode: string | null;
    readonly ratePercent: string | null;
    readonly basisAmount: AmountDto | null;
    readonly calculatedAmount: AmountDto | null;
    readonly exemptionReason: string | null;
  }>;
  readonly totals: {
    readonly lineTotalAmount: AmountDto | null;
    readonly taxBasisTotalAmount: AmountDto | null;
    readonly taxTotalAmount: AmountDto | null;
    readonly grandTotalAmount: AmountDto | null;
    readonly duePayableAmount: AmountDto | null;
  };
  readonly notes: readonly string[];
}

export interface FindingDto {
  readonly severity: string;
  readonly severityLabel: string;
  readonly ruleId: string | null;
  readonly ruleVariant: string | null;
  readonly ruleset: string;
  readonly rulesetLabel: string;
  readonly message: string;
  readonly location: string | null;
  readonly explanation: {
    readonly title: string;
    readonly meaning: string;
    readonly cause: string;
    readonly fix: string;
  } | null;
  readonly terms: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly plain: string;
  }>;
}

export interface CheckDto {
  readonly ruleId: string;
  readonly label: string;
  readonly passed: boolean;
  readonly declared: AmountDto | null;
  readonly computed: AmountDto | null;
  readonly detail: string;
}

export interface AnalysisDto {
  readonly filename: string;
  readonly sizeBytes: number;
  readonly kind: string;
  readonly verdict: string;
  readonly profile: string | null;
  readonly profileLabel: string | null;
  readonly profileNote: string | null;
  readonly counts: AnalysisResult['counts'];
  readonly findings: readonly FindingDto[];
  readonly inapplicableFindings: readonly FindingDto[];
  readonly invoice: InvoiceDto | null;
  readonly parseError: string | null;
  readonly engineError: AnalysisResult['engineError'];
  readonly checks: readonly CheckDto[];
  readonly vatChecks: ReadonlyArray<{ readonly passed: boolean; readonly detail: string }>;
  readonly suspectLines: readonly string[];
  readonly pdf: {
    readonly attachmentNames: readonly string[];
    readonly usesCanonicalName: boolean;
    readonly pdfaPart: number | null;
    readonly pdfaLevel: string | null;
    readonly warnings: readonly string[];
  } | null;
  readonly durationMs: number | null;
  readonly rulesFired: number | null;
}

/** UNTDID 1001 document type codes, limited to those a French B2B invoice actually uses. */
function documentTypeLabel(typeCode: string | null): string {
  switch (typeCode) {
    case '380':
      return 'Facture';
    case '381':
      return 'Avoir';
    case '384':
      return 'Facture rectificative';
    case '386':
      return "Facture d'acompte";
    case '389':
      return 'Autofacturation';
    case '751':
      return 'Informations comptables';
    default:
      return typeCode ? `Type ${typeCode}` : 'Type non déclaré';
  }
}

function partyDto(party: CiiInvoice['seller']): PartyDto {
  return {
    name: party.name,
    legalId: party.legalId,
    vatId: party.vatId,
    city: party.address.city,
    postcode: party.address.postcode,
    countryCode: party.address.countryCode,
  };
}

function invoiceDto(invoice: CiiInvoice): InvoiceDto {
  const currency = invoice.currency;
  return {
    invoiceNumber: invoice.invoiceNumber,
    typeCode: invoice.typeCode,
    typeLabel: documentTypeLabel(invoice.typeCode),
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency,
    buyerReference: invoice.buyerReference,
    seller: partyDto(invoice.seller),
    buyer: partyDto(invoice.buyer),
    lines: invoice.lines.map((line) => ({
      id: line.id,
      name: line.name,
      quantity: line.quantity ? format(line.quantity) : null,
      unitCode: line.unitCode,
      unitPrice: amountDto(line.netUnitPrice, currency),
      netAmount: amountDto(line.netAmount, currency),
      vatRatePercent: line.vatRatePercent ? format(line.vatRatePercent) : null,
    })),
    taxBreakdown: invoice.taxBreakdown.map((tax) => ({
      categoryCode: tax.categoryCode,
      ratePercent: tax.ratePercent ? format(tax.ratePercent) : null,
      basisAmount: amountDto(tax.basisAmount, currency),
      calculatedAmount: amountDto(tax.calculatedAmount, currency),
      exemptionReason: tax.exemptionReason,
    })),
    totals: {
      lineTotalAmount: amountDto(invoice.totals.lineTotalAmount, currency),
      taxBasisTotalAmount: amountDto(invoice.totals.taxBasisTotalAmount, currency),
      taxTotalAmount: amountDto(invoice.totals.taxTotalAmount, currency),
      grandTotalAmount: amountDto(invoice.totals.grandTotalAmount, currency),
      duePayableAmount: amountDto(invoice.totals.duePayableAmount, currency),
    },
    notes: invoice.notes,
  };
}

function findingDto(finding: ExplainedFinding): FindingDto {
  return {
    severity: finding.severity,
    severityLabel: severityLabel(finding.severity),
    ruleId: finding.ruleId,
    ruleVariant: finding.ruleVariant,
    ruleset: finding.ruleset,
    rulesetLabel: rulesetLabel(finding.ruleset),
    message: finding.message,
    location: finding.location,
    explanation: finding.explanation
      ? {
          title: finding.explanation.title,
          meaning: finding.explanation.meaning,
          cause: finding.explanation.cause,
          fix: finding.explanation.fix,
        }
      : null,
    terms: finding.terms.map((term) => ({ id: term.id, label: term.label, plain: term.plain })),
  };
}

function checksDto(arithmetic: ArithmeticReport | null, currency: string | null): CheckDto[] {
  if (!arithmetic) return [];
  return arithmetic.checks.map((check) => ({
    ruleId: check.ruleId,
    label: check.label,
    passed: check.passed,
    declared: amountDto(check.declared, currency),
    computed: amountDto(check.computed, currency),
    detail: check.detail,
  }));
}

/** Projects an analysis result to its JSON-safe form. */
export function toAnalysisDto(result: AnalysisResult): AnalysisDto {
  const currency = result.invoice?.currency ?? null;

  return {
    filename: result.filename,
    sizeBytes: result.sizeBytes,
    kind: result.kind,
    verdict: result.verdict,
    profile: result.profile,
    profileLabel: result.profile ? PROFILE_INFO[result.profile].label : null,
    profileNote: result.profileNote,
    counts: result.counts,
    findings: result.findings.map(findingDto),
    inapplicableFindings: result.inapplicableFindings.map(findingDto),
    invoice: result.invoice ? invoiceDto(result.invoice) : null,
    parseError: result.parseError,
    engineError: result.engineError,
    checks: checksDto(result.arithmetic, currency),
    vatChecks:
      result.arithmetic?.vatRates.map((rate) => ({ passed: rate.passed, detail: rate.detail })) ??
      [],
    suspectLines: result.suspectLines,
    pdf: result.pdf
      ? {
          attachmentNames: result.pdf.attachments.map((a) => a.name),
          usesCanonicalName: result.pdf.usesCanonicalName,
          pdfaPart: result.pdf.pdfa.part,
          pdfaLevel: result.pdf.pdfa.level,
          warnings: result.pdf.warnings,
        }
      : null,
    durationMs: result.validation?.durationMs ?? null,
    rulesFired: result.validation?.rulesFired ?? null,
  };
}
