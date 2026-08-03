/**
 * Tests for generation.
 *
 * The load-bearing test in this file is the round trip: generate a document, then parse it back
 * with the same code the public validator uses and run the arithmetic checks over it. That closes
 * the loop between the two halves of the product - if the generator can produce something our own
 * validator objects to, this fails.
 */

import { describe, expect, it } from 'vitest';
import { checkArithmetic } from '../src/checks.js';
import { parseCii } from '../src/extract/cii.js';
import { extractFromPdf, CANONICAL_ATTACHMENT_NAME } from '../src/extract/pdf.js';
import { checkDraft, isValidIban } from '../src/generate/check-draft.js';
import { serialiseCii } from '../src/generate/cii.js';
import { computeInvoice } from '../src/generate/compute.js';
import { DraftInvalidError, generateCiiXml, generateFacturX } from '../src/generate/index.js';
import { buildSrgbIccProfile } from '../src/generate/icc.js';
import { resolveSystemFonts } from '../src/generate/fonts.js';
import { format } from '../src/money.js';
import { BASE_DRAFT, draftWith, lineWith, FIXED_NOW } from './fixtures/draft.js';

describe('computeInvoice', () => {
  it('derives the totals from the lines', () => {
    const { totals } = computeInvoice(BASE_DRAFT);

    expect(format(totals.lineTotalAmount)).toBe('1730.00'); // 1250 + 390 + 90
    expect(format(totals.taxTotalAmount)).toBe('346.00');
    expect(format(totals.grandTotalAmount)).toBe('2076.00');
    expect(format(totals.duePayableAmount)).toBe('2076.00');
  });

  it('rounds each line to the cent before summing them', () => {
    // 3 x 10.005 is 30.015 exactly. Rounded per line it is 3 x 10.01 = 30.03; rounded only at the
    // end it is 30.02. EN 16931 compares against the first, so a generator that sums unrounded
    // products emits a document that fails BR-CO-10 by a cent.
    const { lines, totals } = computeInvoice(
      draftWith({
        lines: [
          lineWith({ quantity: '1', unitPrice: '10.005' }),
          lineWith({ quantity: '1', unitPrice: '10.005' }),
          lineWith({ quantity: '1', unitPrice: '10.005' }),
        ],
      }),
    );

    expect(lines.map((line) => format(line.netAmount))).toEqual(['10.01', '10.01', '10.01']);
    expect(format(totals.lineTotalAmount)).toBe('30.03');
  });

  it('groups the VAT breakdown by category and rate', () => {
    const { taxGroups } = computeInvoice(
      draftWith({
        lines: [
          lineWith({ quantity: '1', unitPrice: '100.00', vatRatePercent: '20.00' }),
          lineWith({ quantity: '1', unitPrice: '200.00', vatRatePercent: '20.00' }),
          lineWith({ quantity: '1', unitPrice: '50.00', vatRatePercent: '5.50' }),
        ],
      }),
    );

    expect(taxGroups).toHaveLength(2);
    expect(format(taxGroups[0]!.basisAmount)).toBe('300.00');
    expect(format(taxGroups[0]!.calculatedAmount)).toBe('60.00');
    expect(format(taxGroups[1]!.basisAmount)).toBe('50.00');
    expect(format(taxGroups[1]!.calculatedAmount)).toBe('2.75');
  });

  it('treats a rate written 20 and 20.00 as one group', () => {
    const { taxGroups } = computeInvoice(
      draftWith({
        lines: [
          lineWith({ vatRatePercent: '20' }),
          lineWith({ vatRatePercent: '20.00' }),
          lineWith({ vatRatePercent: '20.000' }),
        ],
      }),
    );

    expect(taxGroups).toHaveLength(1);
  });

  it('subtracts a deposit to give the amount due', () => {
    const { totals } = computeInvoice(draftWith({ prepaidAmount: '500.00' }));

    expect(format(totals.grandTotalAmount)).toBe('2076.00');
    expect(format(totals.prepaidAmount)).toBe('500.00');
    expect(format(totals.duePayableAmount)).toBe('1576.00');
  });

  it('computes VAT without ever dividing', () => {
    // 5.5% of 33.33 is 1.83315, which no binary float represents. The exact answer rounds to 1.83.
    const { taxGroups } = computeInvoice(
      draftWith({
        lines: [lineWith({ quantity: '1', unitPrice: '33.33', vatRatePercent: '5.50' })],
      }),
    );

    expect(format(taxGroups[0]!.calculatedAmount)).toBe('1.83');
  });
});

describe('checkDraft', () => {
  it('accepts a well-formed draft', () => {
    const result = checkDraft(BASE_DRAFT);

    expect(result.ok).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const result = checkDraft(
      draftWith({ invoiceNumber: '', issueDate: '', lines: [lineWith({ name: '' })] }),
    );

    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
    expect(result.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['invoiceNumber', 'issueDate', 'lines.0.name']),
    );
  });

  /**
   * Regression. A credit transfer must name the account to credit (BR-CO-27), and nothing checked
   * it, so the engine caught it instead - which surfaces as a failed self-validation, i.e. a 500,
   * for what is really a field the user forgot. The codes come from the engine's own verdicts:
   * `30` and `58` are refused without an account, cash, cheque, card and direct debit are not.
   */
  it('refuses a credit transfer with no IBAN, and only for the transfer codes', () => {
    for (const paymentMeansCode of ['30', '58']) {
      const result = checkDraft(draftWith({ paymentMeansCode, iban: null }));
      const issue = result.issues.find((candidate) => candidate.ruleId === 'BR-CO-27');
      expect(issue?.severity, `code ${paymentMeansCode}`).toBe('error');
      expect(result.ok).toBe(false);
    }

    for (const paymentMeansCode of ['10', '20', '48', '49']) {
      const result = checkDraft(draftWith({ paymentMeansCode, iban: null }));
      expect(
        result.issues.some((candidate) => candidate.ruleId === 'BR-CO-27'),
        `code ${paymentMeansCode}`,
      ).toBe(false);
    }

    // BASE_DRAFT already pairs code 30 with an IBAN, which is the combination that must pass.
    expect(checkDraft(BASE_DRAFT).ok).toBe(true);
  });

  /** Warns, without refusing: the text still reaches the reader, just not the reader's software. */
  it('warns that a line description will not reach the XML', () => {
    const result = checkDraft(
      draftWith({ lines: [lineWith({ description: 'Modèle X, pose comprise' })] }),
    );

    expect(result.ok).toBe(true);
    const warning = result.issues.find((issue) => issue.field === 'lines.0.description');
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain('BASIC');
  });

  it('requires a reason when VAT is not charged', () => {
    const result = checkDraft(
      draftWith({
        lines: [lineWith({ vatCategory: 'AE', vatRatePercent: '0' })],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.ruleId === 'BR-AE-10')).toBe(true);
  });

  it('accepts a reverse-charge line that states its reason', () => {
    const result = checkDraft(
      draftWith({
        lines: [
          lineWith({
            vatCategory: 'AE',
            vatRatePercent: '0',
            exemptionReason: 'Autoliquidation — article 283-2 du CGI',
          }),
        ],
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('rejects a standard-rate line carrying a zero rate', () => {
    const result = checkDraft(draftWith({ lines: [lineWith({ vatRatePercent: '0' })] }));

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.ruleId === 'BR-S-05')).toBe(true);
  });

  it('accepts a zero-rated line with no reason, since BR-Z-10 forbids one', () => {
    // Zero-rated is the exception among the no-VAT categories: the supply is taxed at 0 %, not
    // exempt, so there is nothing to justify. Requiring a reason here would make the generator
    // emit documents that fail BR-Z-10.
    const result = checkDraft(
      draftWith({ lines: [lineWith({ vatCategory: 'Z', vatRatePercent: '0' })] }),
    );

    expect(result.ok).toBe(true);
  });

  it('warns, rather than fails, when a zero-rated line carries a reason', () => {
    const draft = draftWith({
      lines: [lineWith({ vatCategory: 'Z', vatRatePercent: '0', exemptionReason: 'Taux zéro' })],
    });
    const result = checkDraft(draft);

    expect(result.ok).toBe(true);
    expect(result.issues.some((issue) => issue.ruleId === 'BR-Z-10')).toBe(true);
    // The reason is dropped rather than emitted, so the document stays valid.
    expect(generateCiiXml(draft)).not.toContain('ExemptionReason');
  });

  it('requires a delivery country for an intra-community supply', () => {
    const draft = draftWith({
      lines: [
        lineWith({
          vatCategory: 'K',
          vatRatePercent: '0',
          exemptionReason: 'Livraison intracommunautaire — article 262 ter I du CGI',
        }),
      ],
    });

    expect(checkDraft(draft).ok).toBe(false);
    expect(checkDraft(draft).issues.some((issue) => issue.ruleId === 'BR-IC-12')).toBe(true);

    const withCountry = { ...draft, deliveryCountryCode: 'DE' };
    expect(checkDraft(withCountry).ok).toBe(true);
    expect(generateCiiXml(withCountry)).toContain('ShipToTradeParty');
  });

  it('names the rule family a category actually belongs to', () => {
    // Category `K` is governed by rules named `BR-IC-*`; quoting `BR-K-10` would send a user
    // looking for a rule that does not exist.
    const result = checkDraft(
      draftWith({
        deliveryCountryCode: 'DE',
        lines: [lineWith({ vatCategory: 'K', vatRatePercent: '0' })],
      }),
    );

    expect(result.issues.some((issue) => issue.ruleId === 'BR-IC-10')).toBe(true);
    expect(result.issues.some((issue) => issue.ruleId?.startsWith('BR-K-'))).toBe(false);
  });

  it('catches a VAT number that does not belong to the stated SIREN', () => {
    const result = checkDraft(
      draftWith({
        seller: { ...BASE_DRAFT.seller, vatId: 'FR64443061841' }, // the buyer's number
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'seller.vatId')).toBe(true);
  });

  it('catches a mistyped IBAN', () => {
    expect(isValidIban('FR7630006000011234567890189')).toBe(true);
    expect(isValidIban('FR7630006000011234567890188')).toBe(false);

    const result = checkDraft(draftWith({ iban: 'FR7630006000011234567890188' }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'iban')).toBe(true);
  });

  it('requires a due date or payment terms when something is owed', () => {
    const result = checkDraft(draftWith({ dueDate: null, paymentTerms: null }));

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.ruleId === 'BR-CO-25')).toBe(true);
  });

  it('accepts payment terms in place of a due date', () => {
    expect(
      checkDraft(draftWith({ dueDate: null, paymentTerms: 'Paiement à 30 jours fin de mois' })).ok,
    ).toBe(true);
  });

  it('rejects a due date that precedes the issue date', () => {
    const result = checkDraft(draftWith({ dueDate: '2026-08-01' }));

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'dueDate')).toBe(true);
  });

  it('rejects a date that does not exist', () => {
    expect(checkDraft(draftWith({ issueDate: '2026-02-30' })).ok).toBe(false);
  });

  it('warns about an unusual VAT rate without blocking it', () => {
    const result = checkDraft(draftWith({ lines: [lineWith({ vatRatePercent: '17.00' })] }));

    expect(result.ok).toBe(true);
    expect(result.issues.some((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('refuses a deposit larger than the invoice', () => {
    expect(checkDraft(draftWith({ prepaidAmount: '9999.00' })).ok).toBe(false);
  });
});

describe('serialiseCii', () => {
  const xml = () => serialiseCii(BASE_DRAFT, computeInvoice(BASE_DRAFT));

  it('declares the BASIC profile', () => {
    expect(xml()).toContain('urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic');
  });

  it('writes the computed totals, not anything supplied', () => {
    expect(xml()).toContain('<ram:LineTotalAmount>1730.00</ram:LineTotalAmount>');
    expect(xml()).toContain('<ram:GrandTotalAmount>2076.00</ram:GrandTotalAmount>');
  });

  it('orders the VAT breakdown as the schema sequence requires', () => {
    const document = xml();
    const breakdown = document.slice(document.lastIndexOf('<ram:ApplicableTradeTax>'));
    const order = [...breakdown.matchAll(/<ram:(\w+)>/g)].map((match) => match[1]);

    expect(order.slice(1, 6)).toEqual([
      'CalculatedAmount',
      'TypeCode',
      'BasisAmount',
      'CategoryCode',
      'RateApplicablePercent',
    ]);
  });

  /**
   * Regression. `ram:Description` was emitted for any line that had one, and BASIC's
   * `TradeProductType` admits only `GlobalID` and `Name` - the element first appears in EN 16931.
   * The result was an XSD failure ("Invalid content was found starting with element
   * 'ram:Description'"), so every invoice with a line description was refused at issuance. It got
   * that far because no test ever set a description.
   */
  it('omits the line description, which the BASIC profile cannot carry', () => {
    const drafted = draftWith({
      lines: [lineWith({ name: 'Chauffe-eau', description: 'Modèle X, pose comprise' })],
    });
    const document = serialiseCii(drafted, computeInvoice(drafted));

    expect(document).toContain('<ram:Name>Chauffe-eau</ram:Name>');
    expect(document).not.toContain('Modèle X, pose comprise');
    // The `SpecifiedTradeProduct` sequence is `GlobalID`, `Name` and nothing else here.
    const product = document.slice(
      document.indexOf('<ram:SpecifiedTradeProduct>'),
      document.indexOf('</ram:SpecifiedTradeProduct>'),
    );
    expect([...product.matchAll(/<ram:(\w+)>/g)].map((match) => match[1])).toEqual([
      'SpecifiedTradeProduct',
      'Name',
    ]);
  });

  it('escapes characters that would break the document', () => {
    const document = serialiseCii(
      draftWith({ lines: [lineWith({ name: 'Vis & écrous <6mm> "inox"' })] }),
      computeInvoice(draftWith({ lines: [lineWith({ name: 'Vis & écrous <6mm> "inox"' })] })),
    );

    expect(document).toContain('Vis &amp; écrous &lt;6mm&gt; "inox"');
    expect(() => parseCii(document)).not.toThrow();
  });

  it('strips control characters XML cannot carry', () => {
    const draft = draftWith({ lines: [lineWith({ name: 'Tuyau cuivre' })] });
    const document = serialiseCii(draft, computeInvoice(draft));

    expect(document).not.toContain('');
    expect(parseCii(document).lines[0]?.name).toBe('Tuyau cuivre');
  });

  it('carries the mandatory French mentions as structured notes', () => {
    expect(parseCii(xml()).notes.some((note) => note.includes('Pénalités de retard'))).toBe(true);
  });

  it('omits the prepaid element when nothing was prepaid', () => {
    expect(xml()).not.toContain('TotalPrepaidAmount');
    expect(
      serialiseCii(
        draftWith({ prepaidAmount: '500.00' }),
        computeInvoice(draftWith({ prepaidAmount: '500.00' })),
      ),
    ).toContain('<ram:TotalPrepaidAmount>500.00</ram:TotalPrepaidAmount>');
  });
});

describe('generated XML, read back by our own parser', () => {
  it('round-trips every field the validator displays', () => {
    const invoice = parseCii(generateCiiXml(BASE_DRAFT));

    expect(invoice.profile).toBe('BASIC');
    expect(invoice.invoiceNumber).toBe('FA-2026-0087');
    expect(invoice.issueDate).toBe('2026-09-03');
    expect(invoice.dueDate).toBe('2026-10-03');
    expect(invoice.currency).toBe('EUR');
    expect(invoice.buyerReference).toBe('SERVICE-ACHATS');
    expect(invoice.seller.name).toBe('Plomberie Diderot SARL');
    expect(invoice.seller.legalId).toBe('552081317');
    expect(invoice.seller.vatId).toBe('FR03552081317');
    expect(invoice.buyer.legalId).toBe('443061841');
    expect(invoice.lines).toHaveLength(3);
    expect(invoice.lines[1]?.name).toBe("Main-d'œuvre installation");
    expect(format(invoice.totals.grandTotalAmount!)).toBe('2076.00');
  });

  it('passes the arithmetic checks the public validator runs', () => {
    const report = checkArithmetic(parseCii(generateCiiXml(BASE_DRAFT)));

    expect(report.allPassed).toBe(true);
    expect(report.checks.filter((check) => !check.passed)).toHaveLength(0);
    expect(report.vatRates.every((rate) => rate.passed)).toBe(true);
  });

  it('still passes them with mixed rates, a deposit and awkward quantities', () => {
    const draft = draftWith({
      prepaidAmount: '150.00',
      lines: [
        lineWith({ quantity: '3.5', unitPrice: '12.3456', vatRatePercent: '20.00' }),
        lineWith({ quantity: '7', unitPrice: '4.99', vatRatePercent: '5.50' }),
        lineWith({ quantity: '1', unitPrice: '999.99', vatRatePercent: '10.00' }),
        lineWith({
          quantity: '2',
          unitPrice: '80.00',
          vatCategory: 'AE',
          vatRatePercent: '0',
          exemptionReason: 'Autoliquidation — article 283-2 du CGI',
        }),
      ],
    });

    const report = checkArithmetic(parseCii(generateCiiXml(draft)));
    expect(report.allPassed).toBe(true);
  });

  it('refuses to generate a draft it knows is wrong', () => {
    expect(() => generateCiiXml(draftWith({ invoiceNumber: '' }))).toThrow(DraftInvalidError);
  });
});

describe('sRGB ICC profile', () => {
  const profile = buildSrgbIccProfile();
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const signature = (offset: number) => String.fromCharCode(...profile.slice(offset, offset + 4));

  it('declares its own length correctly', () => {
    expect(view.getUint32(0)).toBe(profile.byteLength);
  });

  it('carries the ICC file signature and a display RGB device class', () => {
    expect(signature(36)).toBe('acsp');
    expect(signature(12)).toBe('mntr');
    expect(signature(16)).toBe('RGB ');
    expect(signature(20)).toBe('XYZ ');
    expect(view.getUint32(8)).toBe(0x02100000);
  });

  it('contains the tags a matrix/TRC profile requires', () => {
    const count = view.getUint32(128);
    const tags = Array.from({ length: count }, (_, index) => signature(132 + index * 12));

    expect(tags).toEqual(
      expect.arrayContaining([
        'desc',
        'wtpt',
        'rXYZ',
        'gXYZ',
        'bXYZ',
        'rTRC',
        'gTRC',
        'bTRC',
        'cprt',
      ]),
    );
  });

  it('places every tag inside the file, aligned to four bytes', () => {
    const count = view.getUint32(128);
    for (let index = 0; index < count; index += 1) {
      const offset = view.getUint32(132 + index * 12 + 4);
      const size = view.getUint32(132 + index * 12 + 8);
      expect(offset % 4).toBe(0);
      expect(offset + size).toBeLessThanOrEqual(profile.byteLength);
    }
  });

  it('shares one copy of the tone curve between the three channels', () => {
    const count = view.getUint32(128);
    const offsets = new Map<string, number>();
    for (let index = 0; index < count; index += 1) {
      offsets.set(signature(132 + index * 12), view.getUint32(132 + index * 12 + 4));
    }

    expect(offsets.get('rTRC')).toBe(offsets.get('gTRC'));
    expect(offsets.get('gTRC')).toBe(offsets.get('bTRC'));
  });
});

/**
 * PDF assembly needs an embeddable font, which not every machine has. Skipping rather than failing
 * keeps a checkout without one green - the same convention as the corpus and integration suites.
 */
const fonts = (() => {
  try {
    return resolveSystemFonts();
  } catch {
    return null;
  }
})();

if (!fonts) {
  console.warn('[generate] no embeddable system font found; skipping PDF assembly tests.');
}

describe.skipIf(!fonts)('PDF/A-3 assembly', () => {
  it('embeds the XML under the canonical name, readable by our own extractor', async () => {
    const generated = await generateFacturX(BASE_DRAFT, { fonts: fonts!, now: FIXED_NOW });
    const extracted = await extractFromPdf(generated.pdf);

    expect(extracted.usesCanonicalName).toBe(true);
    expect(extracted.attachments.map((file) => file.name)).toContain(CANONICAL_ATTACHMENT_NAME);
    expect(extracted.pdfa.part).toBe(3);
    expect(extracted.pdfa.level).toBe('B');
  });

  it('embeds XML identical to what the XML-only path produces', async () => {
    const generated = await generateFacturX(BASE_DRAFT, { fonts: fonts!, now: FIXED_NOW });
    const extracted = await extractFromPdf(generated.pdf);
    const embedded = new TextDecoder().decode(extracted.invoiceXml!.bytes);

    expect(embedded).toBe(generateCiiXml(BASE_DRAFT));
    expect(embedded).toBe(generated.xml);
  });

  it('produces identical bytes for the same draft and clock', async () => {
    const first = await generateFacturX(BASE_DRAFT, { fonts: fonts!, now: FIXED_NOW });
    const second = await generateFacturX(BASE_DRAFT, { fonts: fonts!, now: FIXED_NOW });

    expect(Buffer.from(second.pdf).equals(Buffer.from(first.pdf))).toBe(true);
  });

  it('breaks a long invoice across pages instead of running off the first', async () => {
    const lines = Array.from({ length: 60 }, (_, index) =>
      lineWith({ name: `Prestation détaillée numéro ${index + 1}`, quantity: '1' }),
    );
    const generated = await generateFacturX(draftWith({ lines }), {
      fonts: fonts!,
      now: FIXED_NOW,
    });

    const { PDFDocument } = await import('pdf-lib');
    const loaded = await PDFDocument.load(generated.pdf);
    expect(loaded.getPageCount()).toBeGreaterThan(1);

    // The document must still be arithmetically sound after pagination.
    expect(checkArithmetic(parseCii(generated.xml)).allPassed).toBe(true);
  });

  it('reports warnings without blocking generation', async () => {
    const generated = await generateFacturX(
      draftWith({ buyer: { ...BASE_DRAFT.buyer, siret: null, vatId: null } }),
      { fonts: fonts!, now: FIXED_NOW },
    );

    expect(generated.warnings.some((issue) => issue.severity === 'warning')).toBe(true);
  });
});
