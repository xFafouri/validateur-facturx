import { describe, expect, it } from 'vitest';
import { checkArithmetic, suspectLinesForLineTotal } from '../src/checks.js';
import { parseCii } from '../src/extract/cii.js';
import { format } from '../src/money.js';
import { buildInvoiceXml, type InvoiceSpec } from './fixtures/builder.js';

const analyse = (spec: InvoiceSpec = {}) => checkArithmetic(parseCii(buildInvoiceXml(spec)));
const checkFor = (spec: InvoiceSpec, ruleId: string) =>
  analyse(spec).checks.find((c) => c.ruleId === ruleId)!;

describe('checkArithmetic', () => {
  it('passes a consistent invoice', () => {
    const report = analyse();
    expect(report.allPassed).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  describe('BR-CO-10 (BT-106 = Σ BT-131)', () => {
    it('detects a mismatch and states the exact difference', () => {
      // Lines total 250.00; the header claims 300.00.
      const check = checkFor({ lineTotalAmount: '300.00' }, 'BR-CO-10');

      expect(check.passed).toBe(false);
      expect(format(check.declared!)).toBe('300.00');
      expect(format(check.computed!)).toBe('250.00');
      expect(format(check.difference!)).toBe('-50.00');
      // The engine never states the amounts; naming them is the whole point of this check.
      expect(check.detail).toContain('300,00');
      expect(check.detail).toContain('250,00');
      expect(check.detail).toContain('50,00');
    });

    it('catches a one-cent rounding drift', () => {
      expect(checkFor({ lineTotalAmount: '250.01' }, 'BR-CO-10').passed).toBe(false);
    });

    it('does not report a failure when no lines exist to compare against', () => {
      // The missing lines are themselves a finding (BR-16); reporting an arithmetic error too
      // would send the user hunting for a calculation problem that does not exist.
      const check = checkFor({ lines: [] }, 'BR-CO-10');
      expect(check.passed).toBe(true);
      expect(check.detail).toMatch(/non vérifiable/i);
    });

    it('sums many lines exactly', () => {
      const lines = Array.from({ length: 50 }, (_, index) => ({
        id: String(index + 1),
        name: `Ligne ${index + 1}`,
        quantity: '1',
        unitPrice: '0.07',
        netAmount: '0.07',
      }));
      expect(checkFor({ lines, lineTotalAmount: '3.50' }, 'BR-CO-10').passed).toBe(true);
      expect(checkFor({ lines, lineTotalAmount: '3.49' }, 'BR-CO-10').passed).toBe(false);
    });
  });

  describe('BR-CO-13 / BR-CO-15 / BR-CO-16', () => {
    it('checks BT-109 against lines, allowances and charges', () => {
      expect(checkFor({ taxBasisTotalAmount: '240.00' }, 'BR-CO-13').passed).toBe(false);
    });

    it('checks BT-112 = BT-109 + BT-110', () => {
      expect(checkFor({ grandTotalAmount: '299.00' }, 'BR-CO-15').passed).toBe(false);
      expect(checkFor({}, 'BR-CO-15').passed).toBe(true);
    });

    it('does not apply BR-CO-16 to a MINIMUM invoice', () => {
      // Regression: MINIMUM's monetary summation has no BT-113 element, so a deposit produces a
      // legitimate BT-112/BT-115 gap. Mustangproject validates such a document as valid; flagging
      // it here would contradict the authoritative engine on a compliant invoice.
      const check = checkFor(
        { profile: 'MINIMUM', grandTotalAmount: '671.15', duePayableAmount: '470.15' },
        'BR-CO-16',
      );
      expect(check.passed).toBe(true);
      expect(check.detail).toMatch(/acomptes|non vérifiable/i);
    });

    it('still applies BR-CO-16 on profiles that can express a prepayment', () => {
      expect(
        checkFor(
          { profile: 'BASIC', grandTotalAmount: '671.15', duePayableAmount: '470.15' },
          'BR-CO-16',
        ).passed,
      ).toBe(false);
    });

    it('accounts for prepayments in the net due', () => {
      // 300.00 TTC less a 100.00 prepayment leaves 200.00 due.
      expect(
        checkFor({ prepaidAmount: '100.00', duePayableAmount: '200.00' }, 'BR-CO-16').passed,
      ).toBe(true);
      expect(
        checkFor({ prepaidAmount: '100.00', duePayableAmount: '300.00' }, 'BR-CO-16').passed,
      ).toBe(false);
    });
  });

  describe('per-rate VAT (BR-CO-17)', () => {
    it('verifies base x rate for each rate', () => {
      const report = analyse();
      expect(report.vatRates).toHaveLength(1);
      expect(report.vatRates[0]!.passed).toBe(true);
      expect(format(report.vatRates[0]!.computedTax!)).toBe('50.00');
    });

    it('detects a miscalculated VAT amount', () => {
      const report = analyse({
        taxes: [{ basisAmount: '250.00', calculatedAmount: '49.00', ratePercent: '20.00' }],
      });
      expect(report.vatRates[0]!.passed).toBe(false);
      expect(report.vatRates[0]!.detail).toContain('50,00');
    });

    it('handles the French reduced rate, where rounding matters', () => {
      // 249.90 x 5.5% = 13.7445, which must round to 13.74.
      const report = analyse({
        taxes: [{ basisAmount: '249.90', calculatedAmount: '13.74', ratePercent: '5.50' }],
      });
      expect(report.vatRates[0]!.passed).toBe(true);
      expect(format(report.vatRates[0]!.computedTax!)).toBe('13.74');
    });

    it('verifies each rate separately on a multi-rate invoice', () => {
      const report = analyse({
        taxes: [
          { basisAmount: '200.00', calculatedAmount: '40.00', ratePercent: '20.00' },
          { basisAmount: '50.00', calculatedAmount: '9.99', ratePercent: '5.50' },
        ],
      });
      expect(report.vatRates[0]!.passed).toBe(true);
      expect(report.vatRates[1]!.passed).toBe(false);
    });

    it('treats a zero-rated line as consistent', () => {
      const report = analyse({
        taxes: [
          {
            basisAmount: '250.00',
            calculatedAmount: '0.00',
            ratePercent: '0.00',
            categoryCode: 'E',
            exemptionReason: 'TVA non applicable, article 293 B du CGI',
          },
        ],
      });
      expect(report.vatRates[0]!.passed).toBe(true);
    });
  });
});

describe('suspectLinesForLineTotal', () => {
  it('names the line whose amount equals the discrepancy', () => {
    // Header says 200.00, lines total 250.00 - the 50.00 line looks omitted from the total.
    const invoice = parseCii(buildInvoiceXml({ lineTotalAmount: '200.00' }));
    expect(suspectLinesForLineTotal(invoice)).toContain('2');
  });

  it('returns nothing when the totals agree', () => {
    expect(suspectLinesForLineTotal(parseCii(buildInvoiceXml()))).toEqual([]);
  });

  it('returns nothing when no single line explains the gap', () => {
    expect(
      suspectLinesForLineTotal(parseCii(buildInvoiceXml({ lineTotalAmount: '123.45' }))),
    ).toEqual([]);
  });
});
