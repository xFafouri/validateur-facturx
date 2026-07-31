import { describe, expect, it } from 'vitest';
import { parseCii, looksLikeCiiXml, CiiParseError } from '../src/extract/cii.js';
import { format } from '../src/money.js';
import { profileFromUrn, PROFILE_URNS } from '../src/profiles.js';
import { buildInvoiceXml } from './fixtures/builder.js';

describe('parseCii', () => {
  it('reads header, parties and totals from a well-formed invoice', () => {
    const invoice = parseCii(buildInvoiceXml());

    expect(invoice.invoiceNumber).toBe('FA-2026-0042');
    expect(invoice.typeCode).toBe('380');
    expect(invoice.currency).toBe('EUR');
    expect(invoice.profile).toBe('BASIC');
    expect(invoice.seller.name).toBe('ACME Conseil SARL');
    expect(invoice.seller.legalId).toBe('552081317');
    expect(invoice.buyer.name).toBe('Boulangerie Martin SAS');
    expect(invoice.buyer.address.city).toBe('Lyon');
  });

  it('converts CII format-102 dates to ISO', () => {
    const invoice = parseCii(buildInvoiceXml({ issueDate: '20260901', dueDate: '20261001' }));
    expect(invoice.issueDate).toBe('2026-09-01');
    expect(invoice.dueDate).toBe('2026-10-01');
  });

  it('keeps amounts as exact decimals rather than floats', () => {
    const invoice = parseCii(buildInvoiceXml({ lineTotalAmount: '250.10' }));
    // Written as 250.10; must not become 250.1.
    expect(format(invoice.totals.lineTotalAmount!)).toBe('250.10');
  });

  it('normalises a single line to an array', () => {
    // fast-xml-parser yields an object for one occurrence and an array for several.
    const single = parseCii(
      buildInvoiceXml({
        lines: [
          { id: '1', name: 'Article', quantity: '1', unitPrice: '10.00', netAmount: '10.00' },
        ],
      }),
    );
    expect(single.lines).toHaveLength(1);
    expect(single.lines[0]!.name).toBe('Article');

    expect(parseCii(buildInvoiceXml()).lines).toHaveLength(2);
  });

  it('reads line detail including unit codes and rates', () => {
    const invoice = parseCii(buildInvoiceXml());
    const first = invoice.lines[0]!;
    expect(first.id).toBe('1');
    expect(first.unitCode).toBe('HUR');
    expect(format(first.netAmount!)).toBe('200.00');
    expect(format(first.vatRatePercent!)).toBe('20.00');
    expect(first.vatCategoryCode).toBe('S');
  });

  it('picks the VAT registration by schemeID rather than by position', () => {
    // A party can carry both an FC tax number and a VA VAT number; order is not guaranteed.
    const xml = buildInvoiceXml().replace(
      '<ram:SpecifiedTaxRegistration>',
      `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">1234567890</ram:ID></ram:SpecifiedTaxRegistration>
       <ram:SpecifiedTaxRegistration>`,
    );
    expect(parseCii(xml).seller.vatId).toBe('FR38552081317');
  });

  it('reads a multi-rate VAT breakdown', () => {
    const invoice = parseCii(
      buildInvoiceXml({
        taxes: [
          { basisAmount: '200.00', calculatedAmount: '40.00', ratePercent: '20.00' },
          { basisAmount: '50.00', calculatedAmount: '2.75', ratePercent: '5.50' },
        ],
      }),
    );
    expect(invoice.taxBreakdown).toHaveLength(2);
    expect(format(invoice.taxBreakdown[1]!.ratePercent!)).toBe('5.50');
  });

  it('returns null for absent fields instead of failing', () => {
    // An incomplete document is exactly what a user brings to a validator; it must still display.
    const invoice = parseCii(
      buildInvoiceXml().replace(/<ram:BuyerReference>.*?<\/ram:BuyerReference>/, ''),
    );
    expect(invoice.buyerReference).toBeNull();
    expect(invoice.invoiceNumber).toBe('FA-2026-0042');
  });

  it('rejects XML that is not a CII invoice', () => {
    expect(() => parseCii('<?xml version="1.0"?><Order><Id>1</Id></Order>')).toThrow(CiiParseError);
    expect(() => parseCii('<?xml version="1.0"?><Order>')).toThrow(CiiParseError);
  });
});

describe('profile detection', () => {
  it('resolves each profile from its guideline URN', () => {
    for (const [profile, urn] of Object.entries(PROFILE_URNS)) {
      expect(profileFromUrn(urn)).toBe(profile);
    }
  });

  it('does not confuse BASIC with EN 16931', () => {
    // BASIC's URN begins with EN 16931's URN, so prefix matching would misidentify every BASIC
    // document as EN 16931.
    expect(profileFromUrn(PROFILE_URNS.BASIC)).toBe('BASIC');
    expect(profileFromUrn(PROFILE_URNS.EN_16931)).toBe('EN_16931');
    expect(parseCii(buildInvoiceXml({ profile: 'BASIC' })).profile).toBe('BASIC');
    expect(parseCii(buildInvoiceXml({ profile: 'EN_16931' })).profile).toBe('EN_16931');
  });

  it('ignores surrounding whitespace and case', () => {
    expect(profileFromUrn(`  ${PROFILE_URNS.MINIMUM.toUpperCase()}  `)).toBe('MINIMUM');
  });

  it('returns null for an unknown URN rather than guessing', () => {
    expect(profileFromUrn('urn:something:else')).toBeNull();
    expect(profileFromUrn(null)).toBeNull();
  });
});

describe('looksLikeCiiXml', () => {
  it('detects CII by root element', () => {
    expect(looksLikeCiiXml(new TextEncoder().encode(buildInvoiceXml()))).toBe(true);
    expect(looksLikeCiiXml(new TextEncoder().encode('<Order/>'))).toBe(false);
  });

  it('finds the root element behind a long leading licence comment', () => {
    // Regression: the reference ZUGFeRD/Factur-X samples open with a multi-kilobyte German
    // licence comment, putting CrossIndustryInvoice ~6 KB into the file. A fixed 4 KB scan
    // window rejected those valid invoices as "not a CII file".
    const preamble = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${'Nutzungsrechte. '.repeat(600)} -->\n`;
    const withComment = new TextEncoder().encode(preamble + buildInvoiceXml());

    expect(preamble.length).toBeGreaterThan(4096);
    expect(looksLikeCiiXml(withComment)).toBe(true);
  });

  it('does not match an empty or tiny buffer', () => {
    expect(looksLikeCiiXml(new Uint8Array(0))).toBe(false);
    expect(looksLikeCiiXml(new TextEncoder().encode('Cross'))).toBe(false);
  });
});
