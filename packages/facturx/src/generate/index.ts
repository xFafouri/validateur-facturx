/**
 * Generation: a draft invoice in, a Factur-X document out.
 *
 * The order of operations is the design. Checks run first and refuse a draft with errors, because
 * the alternative - emitting a document we already know a validator will reject - is the failure
 * this product exists to prevent. Totals are then computed from the lines rather than accepted from
 * the caller (`compute.ts`), so the arithmetic rules hold by construction. Only then is anything
 * serialised.
 *
 * The result is one invoice in two renditions that cannot disagree, because both are rendered from
 * the same computed values.
 */

import { checkDraft, type DraftIssue } from './check-draft.js';
import { serialiseCii, type SerialiseOptions } from './cii.js';
import { computeInvoice, type ComputedInvoice } from './compute.js';
import type { InvoiceDraft } from './draft.js';
import { renderPdfA3, type EmbeddedFonts } from './pdf.js';

/** Thrown when a draft has errors. Carries every issue found, not just the first. */
export class DraftInvalidError extends Error {
  readonly issues: readonly DraftIssue[];

  constructor(issues: readonly DraftIssue[]) {
    const errors = issues.filter((issue) => issue.severity === 'error');
    super(
      `La facture ne peut pas être générée : ${errors.length} problème(s) à corriger. ${errors
        .map((issue) => issue.message)
        .join(' ')}`,
    );
    this.name = 'DraftInvalidError';
    this.issues = issues;
  }
}

export interface GenerateOptions extends SerialiseOptions {
  /** Fonts to embed. See `resolveSystemFonts()`. */
  readonly fonts: EmbeddedFonts;
  readonly producer?: string;
  /** Injectable clock, so the same draft twice produces identical bytes. */
  readonly now?: Date;
}

export interface GeneratedInvoice {
  /** The CII XML - the legal original under the mandate. */
  readonly xml: string;
  /** PDF/A-3 with the XML embedded as `factur-x.xml`. */
  readonly pdf: Uint8Array;
  /** The derived amounts, for storing alongside the document without re-parsing it. */
  readonly computed: ComputedInvoice;
  /** Non-blocking observations about the draft. Errors would have thrown. */
  readonly warnings: readonly DraftIssue[];
}

/** Builds the XML alone. The PDF needs a font; a caller that only wants the data does not. */
export function generateCiiXml(draft: InvoiceDraft, options: SerialiseOptions = {}): string {
  const result = checkDraft(draft);
  if (!result.ok) throw new DraftInvalidError(result.issues);
  return serialiseCii(draft, computeInvoice(draft), options);
}

/** Builds the complete Factur-X document. */
export async function generateFacturX(
  draft: InvoiceDraft,
  options: GenerateOptions,
): Promise<GeneratedInvoice> {
  const checked = checkDraft(draft);
  if (!checked.ok) throw new DraftInvalidError(checked.issues);

  const computed = computeInvoice(draft);
  const xml = serialiseCii(draft, computed, options);
  const pdf = await renderPdfA3(draft, computed, xml, {
    fonts: options.fonts,
    producer: options.producer,
    now: options.now,
  });

  return { xml, pdf, computed, warnings: checked.issues };
}
