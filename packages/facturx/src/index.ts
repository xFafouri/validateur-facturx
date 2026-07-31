/**
 * `@facturx/core` - Factur-X parsing, extraction and validation.
 *
 * Framework-agnostic on purpose: the Next.js validator page, the NestJS API and the test suite all
 * consume this package, and none of them should be able to reach past it into engine specifics.
 */

export { analyze } from './analyze.js';
export type { AnalysisResult, AnalyzeOptions, DocumentKind, ExplainedFinding } from './analyze.js';

export { toAnalysisDto } from './serialize.js';
export type {
  AmountDto,
  AnalysisDto,
  CheckDto,
  FindingDto,
  InvoiceDto,
  LineDto,
  PartyDto,
} from './serialize.js';

export { checkArithmetic, suspectLinesForLineTotal } from './checks.js';
export type { ArithmeticCheck, ArithmeticReport, VatRateCheck } from './checks.js';

export { MustangEngine } from './engine/mustang.js';
export type { MustangEngineOptions } from './engine/mustang.js';
export { extractRuleId, parseMustangReport } from './engine/report.js';
export { ValidationEngineError } from './engine/types.js';
export type {
  FindingPart,
  Ruleset,
  Severity,
  ValidationEngine,
  ValidationFinding,
  ValidationInput,
  ValidationReport,
  ValidationSummary,
} from './engine/types.js';

export { CiiParseError, looksLikeCiiXml, parseCii } from './extract/cii.js';
export type {
  CiiAddress,
  CiiInvoice,
  CiiLine,
  CiiParty,
  CiiTaxBreakdown,
  CiiTotals,
} from './extract/cii.js';

export {
  CANONICAL_ATTACHMENT_NAME,
  PdfExtractionError,
  extractFromPdf,
  looksLikePdf,
} from './extract/pdf.js';
export type { PdfAConformance, PdfAttachment, PdfExtractionResult } from './extract/pdf.js';

export * as money from './money.js';
export type { Decimal } from './money.js';

export {
  DEFAULT_OUTPUT_PROFILE,
  FACTURX_PROFILES,
  PROFILE_INFO,
  PROFILE_URNS,
  profileAtLeast,
  profileCanExpressPrepaidAmount,
  profileCarriesLines,
  profileFromUrn,
} from './profiles.js';
export type { FacturxProfile, ProfileInfo } from './profiles.js';

export {
  CATALOGUE_SIZE,
  appliesInFrance,
  explainRule,
  rulesetLabel,
  severityLabel,
} from './rules/catalogue.fr.js';
export type { RuleExplanation } from './rules/catalogue.fr.js';

export { ALL_TERMS, lookupTerm, termsInMessage } from './rules/terms.fr.js';
export type { BusinessTerm } from './rules/terms.fr.js';

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
