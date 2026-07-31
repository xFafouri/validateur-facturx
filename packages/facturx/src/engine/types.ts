/**
 * The validation engine boundary.
 *
 * Everything above this interface is engine-agnostic. Today the only implementation wraps
 * Mustangproject over HTTP; the brief keeps a pure-Node pipeline open as a future option, and the
 * public validator page, the API and the golden-file tests all speak to this interface rather than
 * to Mustang, so swapping or adding an engine stays a contained change.
 */

import type { FacturxProfile } from '../profiles.js';

/** Mustang's severity ladder, preserved verbatim so nothing is lost in translation. */
export type Severity = 'notice' | 'warning' | 'error' | 'fatal' | 'exception';

/** Which layer of the document a finding concerns. */
export type FindingPart = 'pdf' | 'xml' | 'general';

/**
 * Which body of rules produced a finding.
 *
 * The engine validates against several Schematron rulesets simultaneously, and they do not all
 * apply to a French B2B invoice. Keeping the provenance lets the UI foreground the rules that
 * govern the user's actual obligation and fold away the ones that do not.
 *
 * - `facturx-en16931` - the EN 16931 core rules (`BR-*`, `BR-CO-*`, `BR-CL-*`) plus CII structural
 *   rules. Authoritative everywhere.
 * - `cius-fr` - the DGFiP "Flux 2" French Schematron (`BR-FR-*`). Authoritative for the French
 *   mandate, and already written in French.
 * - `xrechnung-de` - Germany's national CIUS (`BR-DE-*`), reported in German. Not applicable to a
 *   French domestic invoice.
 * - `peppol` - PEPPOL BIS interoperability rules; relevant because PEPPOL eDelivery is the default
 *   transport between platforms.
 */
export type Ruleset = 'facturx-en16931' | 'cius-fr' | 'xrechnung-de' | 'peppol' | 'other';

export interface ValidationFinding {
  readonly severity: Severity;
  /** Which part of the document produced this finding. */
  readonly part: FindingPart;
  /** Base rule identifier such as `BR-CO-10`, when one could be recovered. */
  readonly ruleId: string | null;
  /**
   * Fully-qualified rule identifier when the rule has variants, e.g. `BR-FR-05_BT-22_PMT`.
   * One French rule can fail in several distinguishable ways.
   */
  readonly ruleVariant: string | null;
  readonly ruleset: Ruleset;
  /** Message with engine plumbing stripped, ready to display. */
  readonly message: string;
  /** The engine's untouched message, for diagnostics. */
  readonly rawMessage: string;
  /** XPath pointer into the document, when the engine supplies one. */
  readonly location: string | null;
  /** The Schematron test that failed, when available. */
  readonly criterion: string | null;
  /** Path of the Schematron/XSLT that produced the finding. */
  readonly sourcePath: string | null;
  /** Mustang's numeric section code, retained for debugging. */
  readonly section: number | null;
}

export interface ValidationSummary {
  /** True only when the document passed every check the engine applies. */
  readonly valid: boolean;
  /** PDF/A verdict; `absent` when the input was bare XML rather than a PDF. */
  readonly pdf: 'valid' | 'invalid' | 'absent';
  readonly xml: 'valid' | 'invalid';
}

export interface ValidationReport {
  readonly summary: ValidationSummary;
  readonly findings: readonly ValidationFinding[];
  /** Profile the engine detected, when it reports one. */
  readonly profile: FacturxProfile | null;
  /** Raw profile/version strings as reported, for diagnostics. */
  readonly detected: {
    readonly profileRaw: string | null;
    readonly version: string | null;
  };
  /** Number of Schematron rules evaluated, when the engine reports it. */
  readonly rulesFired: number | null;
  /** Number that failed, when the engine reports it. */
  readonly rulesFailed: number | null;
  /** Engine wall-clock time in milliseconds. */
  readonly durationMs: number | null;
  /** The engine's untouched report, kept so a support case can be reproduced exactly. */
  readonly rawReport: string;
}

export interface ValidationInput {
  readonly bytes: Uint8Array;
  /**
   * Original filename. It matters: engines key PDF-vs-XML handling off the extension, so passing
   * a generic name can change the verdict.
   */
  readonly filename: string;
}

export interface ValidationEngine {
  /** Stable identifier for the engine, recorded on stored results. */
  readonly name: string;
  validate(input: ValidationInput): Promise<ValidationReport>;
  /** Readiness probe. Implementations that need warm-up should report `false` until warm. */
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export type ValidationErrorCode =
  'unavailable' | 'timeout' | 'too_large' | 'bad_request' | 'engine_failure';

export class ValidationEngineError extends Error {
  constructor(
    message: string,
    readonly code: ValidationErrorCode,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'ValidationEngineError';
  }
}
