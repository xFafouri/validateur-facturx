/**
 * End-to-end tests against a running Mustangproject sidecar.
 *
 * Skipped automatically when the sidecar is unreachable, so `pnpm test` works without Docker.
 * Start it with `pnpm validator:up` (or `docker compose up -d validator`) to run these.
 *
 * These are the tests that would actually catch a regression in the contract between the Java
 * service and the TypeScript client - report shape, severity mapping, ruleset provenance. The
 * unit tests pin our parsing of a captured report; only these prove the captured report still
 * resembles what the engine emits.
 */

import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { MustangEngine } from '../src/engine/mustang.js';
import { resolveSystemFonts } from '../src/generate/fonts.js';
import { generateCiiXml, generateFacturX } from '../src/generate/index.js';
import { buildInvoiceBytes } from './fixtures/builder.js';
import { BASE_DRAFT, draftWith, lineWith, FIXED_NOW } from './fixtures/draft.js';

const BASE_URL = process.env.VALIDATOR_URL ?? 'http://127.0.0.1:8081';
const engine = new MustangEngine({ baseUrl: BASE_URL });

/**
 * Probed at module load, not in `beforeAll`.
 *
 * `describe.skipIf` is evaluated while tests are being collected, which happens before any hook
 * runs - a flag set in `beforeAll` is still `false` at that point and the whole suite silently
 * skips even with the sidecar running. Top-level await resolves before collection.
 */
const available = (await engine.health()).ok;

if (!available) {
  console.warn(
    `[integration] sidecar unreachable at ${BASE_URL}; skipping. Start it with: pnpm validator:up`,
  );
}

const suite = describe.skipIf(!available);

/** PDF assembly needs an embeddable font; see the note in `generate.test.ts`. */
const fonts = (() => {
  try {
    return resolveSystemFonts();
  } catch {
    return null;
  }
})();

suite('sidecar health', () => {
  it('reports readiness once warmed up', async () => {
    expect((await engine.health()).ok).toBe(true);
  });
});

suite('validation via the sidecar', () => {
  it('accepts a well-formed invoice', async () => {
    const result = await analyze(buildInvoiceBytes(), 'valide.xml', { engine });

    expect(result.kind).toBe('cii-xml');
    expect(result.verdict).toBe('conforme');
    expect(result.counts.errors).toBe(0);
    expect(result.profile).toBe('BASIC');
  });

  it('reports BR-CO-10 when the line total does not match the lines', async () => {
    // The single most common real-world rejection.
    const result = await analyze(
      buildInvoiceBytes({ lineTotalAmount: '300.00', taxBasisTotalAmount: '300.00' }),
      'somme-incorrecte.xml',
      { engine },
    );

    expect(result.verdict).toBe('non-conforme');
    const codes = result.findings.map((f) => f.ruleId);
    expect(codes).toContain('BR-CO-10');
  });

  it('attaches a French explanation to the finding', async () => {
    const result = await analyze(
      buildInvoiceBytes({ lineTotalAmount: '300.00', taxBasisTotalAmount: '300.00' }),
      'somme-incorrecte.xml',
      { engine },
    );

    const finding = result.findings.find((f) => f.ruleId === 'BR-CO-10');
    expect(finding?.explanation).not.toBeNull();
    expect(finding?.explanation?.fix).toMatch(/arrondi/i);
    // The engine states the rule; we must also name the amounts it compared.
    const check = result.arithmetic?.checks.find((c) => c.ruleId === 'BR-CO-10');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('300,00');
    expect(check?.detail).toContain('250,00');
  });

  it('separates German XRechnung findings from applicable ones', async () => {
    const result = await analyze(buildInvoiceBytes(), 'valide.xml', { engine });

    // The engine evaluates XRechnung rules regardless of origin and reports them in German.
    // They must never appear among the findings a French user is asked to act on.
    expect(result.findings.every((f) => f.ruleset !== 'xrechnung-de')).toBe(true);
    expect(result.inapplicableFindings.every((f) => !f.applicable)).toBe(true);

    for (const finding of result.findings) {
      expect(finding.rawMessage).not.toMatch(/muss übermittelt werden|Eine Rechnung/);
    }
  });

  it('surfaces the French DGFiP ruleset when it fires', async () => {
    const result = await analyze(buildInvoiceBytes(), 'valide.xml', { engine });
    const french = [...result.findings, ...result.inapplicableFindings].filter(
      (f) => f.ruleset === 'cius-fr',
    );

    // Mustang ships the DGFiP "Flux 2" Schematron, so French rules are evaluated for real.
    expect(french.length).toBeGreaterThan(0);
    expect(french.every((f) => f.ruleId?.startsWith('BR-FR'))).toBe(true);
  });

  it('ranks errors above warnings and notices', async () => {
    const result = await analyze(buildInvoiceBytes({ lineTotalAmount: '300.00' }), 'desordre.xml', {
      engine,
    });

    const order = ['exception', 'fatal', 'error', 'warning', 'notice'];
    const positions = result.findings.map((f) => order.indexOf(f.severity));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('rejects a non-invoice upload without throwing', async () => {
    const result = await analyze(
      new TextEncoder().encode('ceci nest pas une facture'),
      'notes.txt',
      { engine },
    );
    expect(result.kind).toBe('unknown');
    expect(result.parseError).toMatch(/n'est ni un PDF Factur-X ni un XML CII/);
  });

  it('degrades to indeterminate rather than accusing a document when the engine is down', async () => {
    const brokenEngine = new MustangEngine({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 2000 });
    const result = await analyze(buildInvoiceBytes(), 'valide.xml', { engine: brokenEngine });

    // Calling a document non-compliant because our own service failed would be a false
    // accusation about a legal document.
    expect(result.verdict).toBe('indeterminé');
    expect(result.engineError).not.toBeNull();
    // Parsing is independent of the engine and must still produce a readable invoice.
    expect(result.invoice?.invoiceNumber).toBe('FA-2026-0042');
  });
});

/**
 * The closed loop.
 *
 * Everything else in the suite proves we read the engine correctly. This proves we can *write* a
 * document it accepts - which is the only assertion that covers the generator end to end, since
 * our own parser agreeing with our own serialiser proves nothing about either. A regression here
 * means we are shipping invoices that a certified platform would reject.
 */
suite('generated documents, validated by the engine', () => {
  it('accepts generated XML with no errors at all', async () => {
    const xml = generateCiiXml(BASE_DRAFT);
    const result = await analyze(new TextEncoder().encode(xml), 'generee.xml', { engine });

    if (result.verdict !== 'conforme') {
      console.error(
        'findings:',
        result.findings.map((f) => `${f.ruleId}: ${f.message}`),
      );
    }
    expect(result.verdict).toBe('conforme');
    expect(result.counts.errors).toBe(0);
    expect(result.profile).toBe('BASIC');
  });

  it('accepts the generated PDF/A-3, including the ICC profile we build ourselves', async () => {
    const generated = await generateFacturX(BASE_DRAFT, { fonts: fonts!, now: FIXED_NOW });
    const result = await analyze(generated.pdf, 'facture.pdf', { engine });

    if (result.verdict !== 'conforme') {
      console.error(
        'findings:',
        result.findings.map((f) => `${f.ruleId}: ${f.message}`),
      );
    }
    expect(result.kind).toBe('facturx-pdf');
    expect(result.verdict).toBe('conforme');
    expect(result.counts.errors).toBe(0);
  });

  /**
   * Regression, against the engine rather than against our own expectations.
   *
   * A line description used to be written out as `ram:Description`, which BASIC's schema rejects
   * outright, so any invoice carrying one failed XSD validation and could not be issued. The unit
   * test asserts the element is absent; this asserts the document the engine actually sees is
   * accepted - which is the claim that matters, and the one no amount of reading the XSD proves.
   */
  it('accepts an invoice whose lines carry descriptions', async () => {
    const draft = draftWith({
      invoiceNumber: 'FA-2026-0093',
      lines: [
        lineWith({
          name: 'Remplacement chauffe-eau 200 L',
          description: 'Modèle thermodynamique, dépose de l’ancien appareil et mise en service.',
        }),
      ],
    });
    const generated = await generateFacturX(draft, { fonts: fonts!, now: FIXED_NOW });
    const result = await analyze(generated.pdf, 'facture-description.pdf', { engine });

    if (result.verdict !== 'conforme') {
      console.error(
        'findings:',
        result.findings.map((f) => `${f.ruleId}: ${f.message}`),
      );
    }
    expect(result.verdict).toBe('conforme');
    expect(result.counts.errors).toBe(0);
    // The description is warned about at draft time, not silently swallowed.
    expect(generated.warnings.map((warning) => warning.field)).toContain('lines.0.description');
  });

  it('accepts an invoice mixing VAT rates, a reverse charge and a deposit', async () => {
    const draft = draftWith({
      invoiceNumber: 'FA-2026-0091',
      prepaidAmount: '150.00',
      lines: [
        lineWith({ quantity: '3.5', unitPrice: '12.3456', vatRatePercent: '20.00' }),
        lineWith({ quantity: '7', unitPrice: '4.99', vatRatePercent: '5.50' }),
        lineWith({
          quantity: '2',
          unitPrice: '80.00',
          vatCategory: 'AE',
          vatRatePercent: '0',
          exemptionReason: 'Autoliquidation — article 283-2 du CGI',
        }),
      ],
    });

    const result = await analyze(new TextEncoder().encode(generateCiiXml(draft)), 'mixte.xml', {
      engine,
    });

    if (result.verdict !== 'conforme') {
      console.error(
        'findings:',
        result.findings.map((f) => `${f.ruleId}: ${f.message}`),
      );
    }
    expect(result.verdict).toBe('conforme');
  });

  /**
   * Each VAT category has its own rule family, and they do not agree with one another: `E`, `AE`,
   * `K` and `G` each require an exemption reason, while `Z` forbids one, and `K` additionally
   * requires a delivery country. Getting this wrong produces a document rejected for the exact
   * field the generator was trying to be careful about - which is what happened, in both
   * directions, until the engine was asked.
   */
  const categories: ReadonlyArray<[string, Partial<(typeof BASE_DRAFT.lines)[number]>, string?]> = [
    ['S standard', { vatCategory: 'S', vatRatePercent: '20.00' }],
    ['Z zero-rated', { vatCategory: 'Z', vatRatePercent: '0' }],
    [
      'E exempt',
      { vatCategory: 'E', vatRatePercent: '0', exemptionReason: 'Exonération article 261 du CGI' },
    ],
    [
      'AE reverse charge',
      {
        vatCategory: 'AE',
        vatRatePercent: '0',
        exemptionReason: 'Autoliquidation — article 283-2 du CGI',
      },
    ],
    [
      'G export',
      {
        vatCategory: 'G',
        vatRatePercent: '0',
        exemptionReason: 'Exportation hors UE — article 262 I du CGI',
      },
    ],
    [
      'K intra-community',
      {
        vatCategory: 'K',
        vatRatePercent: '0',
        exemptionReason: 'Livraison intracommunautaire — article 262 ter I du CGI',
      },
      'DE',
    ],
  ];

  it.each(categories)('accepts a %s line', async (_label, override, deliveryCountryCode) => {
    const draft = draftWith({
      lines: [lineWith(override)],
      ...(deliveryCountryCode ? { deliveryCountryCode } : {}),
    });

    const result = await analyze(new TextEncoder().encode(generateCiiXml(draft)), 'tva.xml', {
      engine,
    });

    if (result.verdict !== 'conforme') {
      console.error(
        'findings:',
        result.findings.map((f) => `${f.ruleId}: ${f.message}`),
      );
    }
    expect(result.verdict).toBe('conforme');
  });

  it('generates an invoice whose amounts the engine and our own checks agree on', async () => {
    const result = await analyze(
      new TextEncoder().encode(generateCiiXml(BASE_DRAFT)),
      'generee.xml',
      { engine },
    );

    expect(result.arithmetic?.allPassed).toBe(true);
    expect(result.suspectLines).toHaveLength(0);
  });
});
