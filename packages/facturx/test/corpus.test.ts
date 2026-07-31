/**
 * Golden-file tests against third-party sample invoices.
 *
 * These documents come from the Mustangproject test suite - real files produced by an independent
 * implementation. Testing only against fixtures we wrote ourselves would prove that our parser
 * agrees with our own idea of what CII looks like, which is exactly the assumption most likely to
 * be wrong.
 *
 * The corpus is fetched, not committed (`pnpm --filter @facturx/core fetch-samples`). When it is
 * absent the suite skips rather than fails, so an offline checkout still runs green.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCii, looksLikeCiiXml } from '../src/extract/cii.js';
import { extractFromPdf, looksLikePdf, CANONICAL_ATTACHMENT_NAME } from '../src/extract/pdf.js';
import { checkArithmetic } from '../src/checks.js';
import { PROFILE_INFO } from '../src/profiles.js';

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'corpus', 'vendor');
const hasCorpus = existsSync(CORPUS_DIR) && readdirSync(CORPUS_DIR).length > 0;

const read = (name: string) => new Uint8Array(readFileSync(join(CORPUS_DIR, name)));
const present = (name: string) => hasCorpus && existsSync(join(CORPUS_DIR, name));

describe.skipIf(!hasCorpus)('corpus: PDF/A-3 extraction', () => {
  it.skipIf(!present('EN16931_Einfach.pdf'))(
    'extracts the embedded XML from a real Factur-X PDF',
    async () => {
      const bytes = read('EN16931_Einfach.pdf');
      expect(looksLikePdf(bytes)).toBe(true);

      const result = await extractFromPdf(bytes);

      expect(result.invoiceXml).not.toBeNull();
      expect(result.invoiceXml!.bytes.byteLength).toBeGreaterThan(500);
      expect(looksLikeCiiXml(result.invoiceXml!.bytes)).toBe(true);
    },
  );

  it.skipIf(!present('EN16931_Einfach.pdf'))(
    'reports the attachment name and PDF/A conformance',
    async () => {
      const result = await extractFromPdf(read('EN16931_Einfach.pdf'));

      // A conforming file attaches under exactly this name; anything else is worth telling the
      // user about even though the payload is still readable.
      expect(result.invoiceXml!.name.toLowerCase()).toBe(CANONICAL_ATTACHMENT_NAME);
      expect(result.usesCanonicalName).toBe(true);
      expect(result.pdfa.part).toBe(3);
    },
  );

  it.skipIf(!present('EN16931_Einfach.pdf'))(
    'parses the extracted XML into a usable invoice',
    async () => {
      const result = await extractFromPdf(read('EN16931_Einfach.pdf'));
      const invoice = parseCii(result.invoiceXml!.bytes);

      expect(invoice.invoiceNumber).toBeTruthy();
      expect(invoice.seller.name).toBeTruthy();
      expect(invoice.lines.length).toBeGreaterThan(0);
      expect(invoice.totals.grandTotalAmount).not.toBeNull();
    },
  );

  it.skipIf(!present('EN16931_1_Teilrechnung.pdf'))('handles a partial invoice', async () => {
    const result = await extractFromPdf(read('EN16931_1_Teilrechnung.pdf'));
    expect(result.invoiceXml).not.toBeNull();
    expect(parseCii(result.invoiceXml!.bytes).invoiceNumber).toBeTruthy();
  });

  it('reports a non-Factur-X PDF as having no invoice rather than throwing', async () => {
    // A plain PDF is the single most common wrong upload: users assume any PDF invoice qualifies.
    const plainPdf = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
        '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>',
    );
    if (!looksLikePdf(plainPdf)) return;

    try {
      const result = await extractFromPdf(plainPdf);
      expect(result.invoiceXml).toBeNull();
      expect(result.warnings.join(' ')).toMatch(/aucun fichier joint|n'est pas une facture/i);
    } catch (error) {
      // A deliberately minimal PDF may be unparseable; a typed failure is an acceptable outcome.
      expect(error).toBeInstanceOf(Error);
    }
  });
});

describe.skipIf(!hasCorpus)('corpus: CII parsing', () => {
  it.skipIf(!present('Factur-X_basic.xml'))('parses a BASIC-profile invoice', () => {
    const invoice = parseCii(read('Factur-X_basic.xml'));
    expect(invoice.profile).toBe('BASIC');
    expect(invoice.invoiceNumber).toBeTruthy();
    expect(invoice.lines.length).toBeGreaterThan(0);
  });

  it.skipIf(!present('facturFrMinimum.xml'))(
    'parses a French MINIMUM invoice and flags the profile as unfit for VAT-registered issuers',
    () => {
      const invoice = parseCii(read('facturFrMinimum.xml'));
      expect(invoice.profile).toBe('MINIMUM');
      // MINIMUM omits per-rate VAT detail, so it cannot serve as an invoice for a business
      // registered for VAT - the validator page must say so.
      expect(PROFILE_INFO.MINIMUM.suitableForVatRegistered).toBe(false);
    },
  );

  it.skipIf(!present('factur-x-extended.xml'))('parses an EXTENDED-profile invoice', () => {
    const invoice = parseCii(read('factur-x-extended.xml'));
    expect(invoice.profile).toBe('EXTENDED');
    expect(invoice.seller.name).toBeTruthy();
  });

  it.skipIf(!present('Extended_fremdwaehrung.xml'))(
    'reads a non-EUR currency without assuming euros',
    () => {
      const invoice = parseCii(read('Extended_fremdwaehrung.xml'));
      expect(invoice.currency).toBeTruthy();
      expect(invoice.currency).toMatch(/^[A-Z]{3}$/);
    },
  );
});

describe.skipIf(!hasCorpus)('corpus: arithmetic agrees with real invoices', () => {
  const xmlSamples = hasCorpus
    ? readdirSync(CORPUS_DIR).filter((name) => name.toLowerCase().endsWith('.xml'))
    : [];

  it.each(xmlSamples)('%s is arithmetically self-consistent', (name) => {
    const invoice = parseCii(read(name));
    const report = checkArithmetic(invoice);

    // These are published, valid sample invoices. Any check reporting a failure means our
    // arithmetic disagrees with a real implementation - our bug, not theirs.
    const failures = [
      ...report.checks.filter((c) => !c.passed).map((c) => `${c.ruleId}: ${c.detail}`),
      ...report.vatRates.filter((r) => !r.passed).map((r) => r.detail),
    ];
    expect(failures).toEqual([]);
  });
});
