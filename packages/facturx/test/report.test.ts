/**
 * Report-parsing tests.
 *
 * The message strings here are verbatim captures from Mustangproject validator 2.24.0, not
 * invented examples. Rule-identifier extraction is regex-driven against a format nobody
 * standardised, so testing against anything other than real output would only prove the regexes
 * match the regexes.
 */

import { describe, expect, it } from 'vitest';
import { extractRuleId, parseMustangReport } from '../src/engine/report.js';

/** Verbatim messages captured from validator 2.24.0. */
const REAL_MESSAGES = {
  bracketed:
    '[BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131). from /xslt/ZF_250/FACTUR-X_BASIC.xslt)',
  frenchSlash:
    'BR-FR-12/BT-49 : Le BT-49 est obligatoire. Valeur actuelle : BT-49="". [ID BR-FR-12_BT-49] from /xslt/XP_Z12_012/20260216_BR-FR-Flux2-Schematron-CII_V1.3.0.xsl)',
  frenchVariant:
    'BR-FR-05/BT-22 : La mention relative aux frais de recouvrement (code PMT) est absente. Elle est obligatoire dans les notes (BG-1). [ID BR-FR-05_BT-22_PMT] from /xslt/XP_Z12_012/20260216_BR-FR-Flux2-Schematron-CII_V1.3.0.xsl)',
  germanBoth:
    '[BR-DE-15] Das Element "Buyer reference" (BT-10) muss übermittelt werden. [ID BR-DE-15] from /xslt/XR_30/XRechnung-CII-validation.xslt)',
  idOnly:
    'Seller electronic address MUST be provided [ID PEPPOL-EN16931-R020] from /xslt/XR_30/XRechnung-CII-validation.xslt)',
  peppolBracketed:
    '[PEPPOL-EN16931-R008]-Document MUST not contain empty elements. (still status warning) from /xslt/ZF_250/FACTUR-X_BASIC.xslt)',
};

describe('extractRuleId', () => {
  it('reads a bracketed EN 16931 identifier', () => {
    expect(extractRuleId(REAL_MESSAGES.bracketed, null)).toEqual({
      ruleId: 'BR-CO-10',
      variant: null,
    });
  });

  it('reads the French slash-qualified form via its trailing ID marker', () => {
    // The base rule drives the explanation lookup; the qualified form names the field concerned.
    expect(extractRuleId(REAL_MESSAGES.frenchSlash, null)).toEqual({
      ruleId: 'BR-FR-12',
      variant: 'BR-FR-12_BT-49',
    });
  });

  it('separates a French rule from its variant', () => {
    // BR-FR-05 fails once per missing mention (PMT, PMD, AAB); the variant is what makes each
    // occurrence actionable, while the base ID drives the explanation lookup.
    expect(extractRuleId(REAL_MESSAGES.frenchVariant, null)).toEqual({
      ruleId: 'BR-FR-05',
      variant: 'BR-FR-05_BT-22_PMT',
    });
  });

  it('reads a German identifier stated twice', () => {
    expect(extractRuleId(REAL_MESSAGES.germanBoth, null).ruleId).toBe('BR-DE-15');
  });

  it('reads an identifier available only in the trailing marker', () => {
    expect(extractRuleId(REAL_MESSAGES.idOnly, null).ruleId).toBe('PEPPOL-EN16931-R020');
  });

  it('reads a bracketed PEPPOL identifier', () => {
    expect(extractRuleId(REAL_MESSAGES.peppolBracketed, null).ruleId).toBe('PEPPOL-EN16931-R008');
  });

  it('returns null rather than inventing an identifier', () => {
    // A false identifier would mislookup the French catalogue.
    expect(extractRuleId('Something entirely unexpected happened.', null).ruleId).toBeNull();
  });

  describe('engine-level findings', () => {
    // Verbatim from validator 2.24.0. These carry no BR-* identifier but are often the most
    // directly actionable lines in a report, so they must not fall through unclassified.
    const ARITHMETIC =
      'Arithmetical issue:Payable total in XML is 1968.00, but calculated total is 2076.00 with tax basis 1730.00 and with positions 1730.00 = 1250.00 + 390.00 + 90.00';
    const SCHEMA =
      "schema validation fails:org.xml.sax.SAXParseException; lineNumber: 96; columnNumber: 34; cvc-complex-type.2.4.a: Invalid content was found starting with element 'DefinedTradeContact'.";

    it('classifies the arithmetic cross-check', () => {
      expect(extractRuleId(ARITHMETIC, null).ruleId).toBe('ENGINE-ARITHMETIC');
    });

    it('classifies an XSD schema failure', () => {
      expect(extractRuleId(SCHEMA, null).ruleId).toBe('ENGINE-SCHEMA');
    });

    it('lets a Schematron identifier win over engine classification', () => {
      // A message mentioning PDF/A but carrying a real rule ID must keep the real one.
      expect(extractRuleId('[BR-CO-10]-Sum of Invoice line net amount. pdfa', null).ruleId).toBe(
        'BR-CO-10',
      );
    });

    it('gives engine findings the engine ruleset and a French explanation', () => {
      const report = parseMustangReport(
        buildReport(`<warning>${escapeXml(ARITHMETIC)}</warning>`),
        10,
      );
      const finding = report.findings[0]!;
      expect(finding.ruleset).toBe('engine');
      expect(finding.ruleId).toBe('ENGINE-ARITHMETIC');
    });
  });
});

/**
 * The exact `<pdf>` payload the engine returned for a generated invoice that was missing the
 * trailer identifier. Captured verbatim from validator v2.24.0, because the format is a Java
 * `toString()` dump and no specification pins it - a paraphrase would not prove we can read the
 * real thing.
 */
const VERAPDF_FAILURE =
  'ValidationResult [flavour=3b, totalAssertions=25120, assertions=[TestAssertion ' +
  '[ruleId=RuleId [specification=ISO 19005-3:2012, clause=6.1.3, testNumber=1], status=failed, ' +
  'message=The file trailer dictionary shall contain the ID keyword whose value shall be File ' +
  'Identifiers as defined in ISO 32000-1:2008, 14.4, location=Location [level=CosDocument, ' +
  'context=root], locationContext=null, errorMessage=Missing or empty ID in the document ' +
  'trailer]], isCompliant=false]';

/** Mirrors a report for a PDF upload: veraPDF's verdict is text inside `<pdf>`, not `<error>`s. */
function buildPdfReport(pdfBody: string, pdfStatus: string, overallStatus = 'valid'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<validation filename="facture.pdf" datetime="2026-08-01 13:50:01">
  <pdf>${escapeXml(pdfBody)}
    <info><signature>unknown</signature></info>
    <summary status="${pdfStatus}"/>
  </pdf>
  <xml>
    <info>
      <profile>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic</profile>
      <rules><fired>21</fired><failed>0</failed></rules>
    </info>
    <messages></messages>
    <summary status="valid"/>
  </xml>
  <messages></messages>
  <summary status="${overallStatus}"/>
</validation>`;
}

describe('PDF/A findings', () => {
  it('reports a PDF/A failure the engine buries in element text', () => {
    const report = parseMustangReport(buildPdfReport(VERAPDF_FAILURE, 'invalid'), 40);

    expect(report.summary.pdf).toBe('invalid');
    const pdfa = report.findings.filter((f) => f.ruleId === 'ENGINE-PDFA');
    expect(pdfa).toHaveLength(1);
    expect(pdfa[0]!.severity).toBe('error');
    expect(pdfa[0]!.part).toBe('pdf');
    // The clause is what makes the finding actionable for whoever produced the PDF.
    expect(pdfa[0]!.message).toContain('6.1.3');
    expect(pdfa[0]!.message).toContain('trailer');
  });

  it('stays silent when the PDF is compliant', () => {
    const report = parseMustangReport(
      buildPdfReport('ValidationResult [flavour=3b, assertions=[], isCompliant=true]', 'valid'),
      40,
    );

    expect(report.summary.pdf).toBe('valid');
    expect(report.findings.filter((f) => f.ruleId === 'ENGINE-PDFA')).toHaveLength(0);
  });

  it('still reports non-compliance when the detail cannot be parsed', () => {
    const report = parseMustangReport(
      buildPdfReport('ValidationResult [some future format], isCompliant=false', 'invalid'),
      40,
    );

    const pdfa = report.findings.filter((f) => f.ruleId === 'ENGINE-PDFA');
    expect(pdfa).toHaveLength(1);
    expect(pdfa[0]!.severity).toBe('error');
  });
});

/** Mirrors the real envelope: messages nested inside <xml>, summaries at two levels. */
function buildReport(body: string, status = 'invalid'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<validation filename="test.xml" datetime="2026-07-31 12:00:00">
  <xml>
    <info>
      <version>2</version>
      <profile>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic</profile>
      <rules><fired>142</fired><failed>3</failed></rules>
    </info>
    <messages>${body}</messages>
    <summary status="${status}"/>
  </xml>
  <messages></messages>
  <summary status="${status}"/>
</validation>`;
}

describe('parseMustangReport', () => {
  it('extracts findings nested inside <xml> and marks their part', () => {
    const report = parseMustangReport(
      buildReport(
        `<error type="5" criterion="false">${escapeXml(REAL_MESSAGES.bracketed)}</error>`,
      ),
      120,
    );

    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0]!;
    expect(finding.severity).toBe('error');
    expect(finding.part).toBe('xml');
    expect(finding.ruleId).toBe('BR-CO-10');
    expect(report.summary.valid).toBe(false);
  });

  it('classifies rulesets by their originating XSLT', () => {
    const report = parseMustangReport(
      buildReport(
        `<error>${escapeXml(REAL_MESSAGES.bracketed)}</error>` +
          `<warning>${escapeXml(REAL_MESSAGES.frenchSlash)}</warning>` +
          `<notice>${escapeXml(REAL_MESSAGES.germanBoth)}</notice>`,
      ),
      50,
    );

    const byRule = Object.fromEntries(report.findings.map((f) => [f.ruleId, f.ruleset]));
    expect(byRule['BR-CO-10']).toBe('facturx-en16931');
    expect(byRule['BR-FR-12']).toBe('cius-fr');
    expect(byRule['BR-DE-15']).toBe('xrechnung-de');
  });

  it('strips engine plumbing from the displayed message but keeps the raw one', () => {
    const report = parseMustangReport(
      buildReport(`<error>${escapeXml(REAL_MESSAGES.bracketed)}</error>`),
      10,
    );

    const finding = report.findings[0]!;
    expect(finding.message).not.toContain('/xslt/');
    expect(finding.message).not.toMatch(/^\[BR-CO-10\]/);
    expect(finding.message).toContain('Sum of Invoice line net amount');
    // The untouched message is retained so a support case stays reproducible.
    expect(finding.rawMessage).toContain('/xslt/');
  });

  it('removes the [ID …] marker from the displayed message', () => {
    const report = parseMustangReport(
      buildReport(`<warning>${escapeXml(REAL_MESSAGES.frenchVariant)}</warning>`),
      10,
    );
    expect(report.findings[0]!.message).not.toContain('[ID');
    expect(report.findings[0]!.message).toContain('frais de recouvrement');
  });

  it('reads the declared profile and the rule counters', () => {
    const report = parseMustangReport(buildReport('', 'valid'), 10);
    expect(report.profile).toBe('BASIC');
    expect(report.rulesFired).toBe(142);
    expect(report.rulesFailed).toBe(3);
  });

  it('reports pdf as absent when the input was bare XML', () => {
    const report = parseMustangReport(buildReport('', 'valid'), 10);
    expect(report.summary.pdf).toBe('absent');
    expect(report.summary.valid).toBe(true);
  });

  it('treats every severity element as a finding', () => {
    const report = parseMustangReport(
      buildReport('<error>e</error><warning>w</warning><notice>n</notice><exception>x</exception>'),
      10,
    );
    expect(report.findings.map((f) => f.severity).sort()).toEqual([
      'error',
      'exception',
      'notice',
      'warning',
    ]);
  });

  it('rejects a report missing its envelope rather than returning an empty pass', () => {
    // Silently returning "no findings" would read as a clean bill of health.
    expect(() => parseMustangReport('<nonsense/>', 10)).toThrow(/validation/i);
  });
});

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
