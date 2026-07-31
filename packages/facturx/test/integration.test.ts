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
import { buildInvoiceBytes } from './fixtures/builder.js';

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
