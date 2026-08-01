/**
 * Tests for the verdict.
 *
 * The verdict is the one thing a user actually reads, and the only failure mode that matters more
 * than being wrong is being wrongly reassuring. These use a stubbed engine so the exact report
 * shape under test is fixed, rather than whatever the live sidecar happens to return.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { parseMustangReport } from '../src/engine/report.js';
import type { ValidationEngine } from '../src/engine/types.js';

const DEMO_PDF = join(
  dirname(fileURLToPath(import.meta.url)),
  'corpus',
  'demo',
  'demo-conforme.pdf',
);

/** An engine that returns a fixed report, so the verdict rule is what is under test. */
function stubEngine(report: string): ValidationEngine {
  return {
    name: 'stub',
    validate: async () => parseMustangReport(report, 10),
    health: async () => ({ ok: true }),
  };
}

/**
 * A report where the XML is clean but PDF/A validation failed.
 *
 * Note the top-level `<summary status="valid"/>`: the engine aggregates the Schematron result only,
 * so a document whose PDF/A check failed is still summarised as valid. Trusting that summary alone
 * is what made this a false pass.
 */
function reportWithPdfaFailure(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<validation filename="facture.pdf" datetime="2026-08-01 13:50:01">
  <pdf>ValidationResult [flavour=3b, totalAssertions=25120, assertions=[TestAssertion [ruleId=RuleId [specification=ISO 19005-3:2012, clause=6.1.3, testNumber=1], status=failed, message=The file trailer dictionary shall contain the ID keyword, location=Location [level=CosDocument, context=root], locationContext=null, errorMessage=Missing or empty ID in the document trailer]], isCompliant=false]
    <summary status="invalid"/>
  </pdf>
  <xml>
    <info><profile>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic</profile><rules><fired>21</fired><failed>0</failed></rules></info>
    <messages></messages>
    <summary status="valid"/>
  </xml>
  <messages></messages>
  <summary status="valid"/>
</validation>`;
}

function reportAllValid(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<validation filename="facture.pdf" datetime="2026-08-01 13:50:01">
  <pdf>ValidationResult [flavour=3b, totalAssertions=25134, assertions=[], isCompliant=true]
    <summary status="valid"/>
  </pdf>
  <xml>
    <info><profile>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic</profile><rules><fired>21</fired><failed>0</failed></rules></info>
    <messages></messages>
    <summary status="valid"/>
  </xml>
  <messages></messages>
  <summary status="valid"/>
</validation>`;
}

describe('verdict', () => {
  const pdf = new Uint8Array(readFileSync(DEMO_PDF));

  it('does not call a document compliant when its PDF/A validation failed', async () => {
    const result = await analyze(pdf, 'facture.pdf', {
      engine: stubEngine(reportWithPdfaFailure()),
    });

    // A Factur-X file that is not PDF/A-3 is not compliant, however clean its XML is.
    expect(result.verdict).toBe('non-conforme');
    expect(result.counts.errors).toBeGreaterThan(0);
  });

  it('explains the PDF/A failure in French rather than only flagging it', async () => {
    const result = await analyze(pdf, 'facture.pdf', {
      engine: stubEngine(reportWithPdfaFailure()),
    });

    const finding = result.findings.find((f) => f.ruleId === 'ENGINE-PDFA');
    expect(finding).toBeDefined();
    expect(finding?.explanation?.title).toContain('PDF/A-3');
    expect(finding?.explanation?.fix).toBeTruthy();
  });

  it('calls a fully valid document compliant', async () => {
    const result = await analyze(pdf, 'facture.pdf', { engine: stubEngine(reportAllValid()) });

    expect(result.verdict).toBe('conforme');
    expect(result.counts.errors).toBe(0);
  });
});
