/**
 * Top-level entry point: takes an uploaded file and produces everything the interface needs.
 *
 * Responsibilities, in order:
 *  1. Work out what was actually uploaded (Factur-X PDF, bare CII XML, or neither).
 *  2. Recover the CII payload and parse it into a readable invoice.
 *  3. Run the authoritative Schematron/XSD validation via the engine.
 *  4. Attach French explanations to each finding and rank them by what the user should fix first.
 *  5. Add arithmetic self-checks that name the amounts the engine only alludes to.
 *
 * Steps 2 and 3 are independent and both can fail on their own terms: a PDF whose XML cannot be
 * extracted still gets a verdict from the engine, and a document the engine rejects outright can
 * still be displayed if it parses. Neither failure is allowed to suppress the other's output.
 */

import { checkArithmetic, suspectLinesForLineTotal, type ArithmeticReport } from './checks.js';
import { type CiiInvoice, CiiParseError, looksLikeCiiXml, parseCii } from './extract/cii.js';
import {
  type PdfExtractionResult,
  PdfExtractionError,
  extractFromPdf,
  looksLikePdf,
} from './extract/pdf.js';
import { appliesInFrance, explainRule, type RuleExplanation } from './rules/catalogue.fr.js';
import { termsInMessage, type BusinessTerm } from './rules/terms.fr.js';
import type {
  Severity,
  ValidationEngine,
  ValidationFinding,
  ValidationReport,
} from './engine/types.js';
import { ValidationEngineError } from './engine/types.js';
import { PROFILE_INFO, type FacturxProfile } from './profiles.js';

/** What kind of document was uploaded. */
export type DocumentKind = 'facturx-pdf' | 'cii-xml' | 'pdf-without-xml' | 'unknown';

/** A finding enriched for display. */
export interface ExplainedFinding extends ValidationFinding {
  readonly explanation: RuleExplanation | null;
  /** Business terms named in the message, resolved to French labels. */
  readonly terms: readonly BusinessTerm[];
  /** False for rules that do not govern a French domestic invoice. */
  readonly applicable: boolean;
}

export interface AnalysisResult {
  readonly kind: DocumentKind;
  readonly filename: string;
  readonly sizeBytes: number;

  /** Engine verdict. `null` when the engine could not be reached. */
  readonly validation: ValidationReport | null;
  /** Present when the engine failed, so the UI can explain the degraded result. */
  readonly engineError: { readonly code: string; readonly message: string } | null;

  /** Parsed invoice, when the CII could be read. */
  readonly invoice: CiiInvoice | null;
  /** Why parsing failed, in French. */
  readonly parseError: string | null;

  /** PDF container details, when the upload was a PDF. */
  readonly pdf: PdfExtractionResult | null;

  readonly profile: FacturxProfile | null;
  readonly profileNote: string | null;

  /** Findings that govern a French invoice, most severe first. */
  readonly findings: readonly ExplainedFinding[];
  /** Findings from rulesets that do not apply here (notably German XRechnung). */
  readonly inapplicableFindings: readonly ExplainedFinding[];

  readonly arithmetic: ArithmeticReport | null;
  /** Lines whose amount exactly equals a total mismatch - likely culprits. */
  readonly suspectLines: readonly string[];

  readonly counts: {
    readonly errors: number;
    readonly warnings: number;
    readonly notices: number;
    readonly inapplicable: number;
  };

  /** Overall verdict shown at the top of the page. */
  readonly verdict: 'conforme' | 'non-conforme' | 'indeterminé';
}

/** Ranking for sorting: what a user should deal with first. */
const SEVERITY_ORDER: Record<Severity, number> = {
  exception: 0,
  fatal: 1,
  error: 2,
  warning: 3,
  notice: 4,
};

function enrich(finding: ValidationFinding): ExplainedFinding {
  return {
    ...finding,
    explanation: explainRule(finding.ruleId),
    terms: termsInMessage(finding.rawMessage),
    applicable: appliesInFrance(finding.ruleset, finding.ruleId),
  };
}

/**
 * Sorts findings by severity, then puts French national rules ahead of the rest.
 *
 * Two findings of equal severity are not equally urgent: a DGFiP rule blocks the invoice under the
 * French mandate specifically, so it earns the user's attention before a general interoperability
 * recommendation.
 */
function compareFindings(a: ExplainedFinding, b: ExplainedFinding): number {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) return bySeverity;

  const rank = (finding: ExplainedFinding) =>
    finding.ruleset === 'cius-fr' ? 0 : finding.ruleset === 'facturx-en16931' ? 1 : 2;
  const byRuleset = rank(a) - rank(b);
  if (byRuleset !== 0) return byRuleset;

  return (a.ruleId ?? '').localeCompare(b.ruleId ?? '');
}

/**
 * Notes when the declared profile is a poor fit for the user's situation.
 *
 * A document can pass every rule and still be the wrong choice: `MINIMUM` and `BASIC_WL` validate
 * cleanly but carry no usable line/VAT detail, so a VAT-registered business issuing one has a
 * technically valid file that does not do the job of an invoice.
 */
function profileNoteFor(profile: FacturxProfile | null): string | null {
  if (!profile) return null;
  const info = PROFILE_INFO[profile];
  if (info.suitableForVatRegistered) return null;

  return (
    `Ce document utilise le profil ${info.label}. ${info.description} ` +
    `Pour une entreprise assujettie à la TVA, préférez le profil BASIC : il porte le détail des lignes et la ventilation de TVA.`
  );
}

export interface AnalyzeOptions {
  readonly engine: ValidationEngine;
  /** Skip engine validation and return only parsing plus arithmetic. Used by unit tests. */
  readonly skipValidation?: boolean;
}

/**
 * Analyses an uploaded file.
 *
 * Never throws for document-level problems - a corrupt upload is a result to be displayed, not an
 * exception. It propagates only genuine programming errors.
 */
export async function analyze(
  bytes: Uint8Array,
  filename: string,
  options: AnalyzeOptions,
): Promise<AnalysisResult> {
  const isPdf = looksLikePdf(bytes);

  let pdf: PdfExtractionResult | null = null;
  let ciiBytes: Uint8Array | null = null;
  let parseError: string | null = null;

  if (isPdf) {
    try {
      pdf = await extractFromPdf(bytes);
      ciiBytes = pdf.invoiceXml?.bytes ?? null;
      if (!ciiBytes) {
        parseError = pdf.warnings[0] ?? "Aucune facture XML n'a pu être extraite de ce PDF.";
      }
    } catch (error) {
      parseError =
        error instanceof PdfExtractionError ? error.message : "Le PDF n'a pas pu être analysé.";
    }
  } else if (looksLikeCiiXml(bytes)) {
    ciiBytes = bytes;
  } else {
    parseError =
      "Ce fichier n'est ni un PDF Factur-X ni un XML CII. Vérifiez que vous avez bien téléversé une facture électronique structurée.";
  }

  let invoice: CiiInvoice | null = null;
  if (ciiBytes) {
    try {
      invoice = parseCii(ciiBytes);
    } catch (error) {
      parseError =
        error instanceof CiiParseError ? error.message : "Le XML n'a pas pu être analysé.";
    }
  }

  // The engine is given the original upload, not the extracted XML: it performs PDF/A-3
  // conformance checks that only exist on the container.
  let validation: ValidationReport | null = null;
  let engineError: AnalysisResult['engineError'] = null;

  if (!options.skipValidation) {
    try {
      validation = await options.engine.validate({ bytes, filename });
    } catch (error) {
      engineError =
        error instanceof ValidationEngineError
          ? { code: error.code, message: error.message }
          : { code: 'engine_failure', message: 'La validation a échoué.' };
    }
  }

  const allFindings = (validation?.findings ?? []).map(enrich);
  const findings = allFindings.filter((f) => f.applicable).sort(compareFindings);
  const inapplicableFindings = allFindings.filter((f) => !f.applicable).sort(compareFindings);

  const arithmetic = invoice ? checkArithmetic(invoice) : null;
  const suspectLines = invoice ? suspectLinesForLineTotal(invoice) : [];

  const kind: DocumentKind = isPdf
    ? ciiBytes
      ? 'facturx-pdf'
      : 'pdf-without-xml'
    : invoice
      ? 'cii-xml'
      : 'unknown';

  const profile = invoice?.profile ?? validation?.profile ?? null;

  const counts = {
    errors: findings.filter(
      (f) => f.severity === 'error' || f.severity === 'fatal' || f.severity === 'exception',
    ).length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    notices: findings.filter((f) => f.severity === 'notice').length,
    inapplicable: inapplicableFindings.length,
  };

  // "Indeterminate" is a real third state and must not be collapsed into "non-compliant": if the
  // engine never ran, we have no basis to call a document non-compliant, and saying so would be
  // a false accusation about a legal document.
  const verdict: AnalysisResult['verdict'] = validation
    ? validation.summary.valid && counts.errors === 0
      ? 'conforme'
      : 'non-conforme'
    : 'indeterminé';

  return {
    kind,
    filename,
    sizeBytes: bytes.byteLength,
    validation,
    engineError,
    invoice,
    parseError,
    pdf,
    profile,
    profileNote: profileNoteFor(profile),
    findings,
    inapplicableFindings,
    arithmetic,
    suspectLines,
    counts,
    verdict,
  };
}
