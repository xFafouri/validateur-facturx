import { describe, expect, it } from 'vitest';
import {
  add,
  equalsAtMonetaryScale,
  format,
  formatFrench,
  multiply,
  parseDecimal,
  rescale,
  subtract,
  sum,
  toNumber,
} from '../src/money.js';

describe('parseDecimal', () => {
  it('preserves the scale as written, so 20.10 is not silently 20.1', () => {
    const value = parseDecimal('20.10');
    expect(value).toEqual({ value: 2010n, scale: 2 });
    expect(format(value!)).toBe('20.10');
  });

  it('handles negatives, leading signs and bare fractions', () => {
    expect(format(parseDecimal('-15.75')!)).toBe('-15.75');
    expect(format(parseDecimal('+3.5')!)).toBe('3.5');
    // A bare fraction is accepted on input and normalised with its leading zero on output.
    expect(format(parseDecimal('.25')!)).toBe('0.25');
  });

  it('parses high-precision unit prices without loss', () => {
    // CII allows 4 decimals on BT-146; truncating before multiplying would introduce error.
    expect(format(parseDecimal('0.3333')!)).toBe('0.3333');
  });

  it('rejects rather than coerces malformed input', () => {
    // Reading a malformed amount as 0 would turn a bad document into a plausible one.
    for (const bad of ['', '  ', 'abc', '12,50', '1.2.3', '1e5', '--5', null, undefined]) {
      expect(parseDecimal(bad as string)).toBeNull();
    }
  });
});

describe('exact summation', () => {
  it('sums amounts that float arithmetic gets wrong', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. This is the mechanism behind spurious BR-CO-10 failures.
    expect(0.1 + 0.2).not.toBe(0.3);

    const total = sum([parseDecimal('0.10')!, parseDecimal('0.20')!]);
    expect(format(rescale(total, 2))).toBe('0.30');
  });

  it('stays exact over many awkward amounts', () => {
    // 100 lines of 0.07 is 7.00 exactly; naive float summation drifts.
    const lines = Array.from({ length: 100 }, () => parseDecimal('0.07')!);
    expect(format(rescale(sum(lines), 2))).toBe('7.00');

    const floatSum = Array.from({ length: 100 }, () => 0.07).reduce((a, b) => a + b, 0);
    expect(floatSum).not.toBe(7);
  });

  it('sums an empty list to zero at monetary scale', () => {
    expect(format(sum([]))).toBe('0.00');
  });
});

describe('rescale', () => {
  it('rounds half away from zero, as French accounting expects', () => {
    expect(format(rescale(parseDecimal('2.345')!, 2))).toBe('2.35');
    expect(format(rescale(parseDecimal('-2.345')!, 2))).toBe('-2.35');
    expect(format(rescale(parseDecimal('2.344')!, 2))).toBe('2.34');
  });

  it('is lossless when increasing scale', () => {
    expect(format(rescale(parseDecimal('5.5')!, 4))).toBe('5.5000');
  });

  it('rounds a half-cent up rather than to even', () => {
    // Banker's rounding would give 2.34 here; EN 16931 arithmetic assumes half-up.
    expect(format(rescale(parseDecimal('2.335')!, 2))).toBe('2.34');
  });
});

describe('arithmetic', () => {
  it('aligns operands of differing scale', () => {
    expect(format(add(parseDecimal('1.5')!, parseDecimal('2.25')!))).toBe('3.75');
    expect(format(subtract(parseDecimal('10')!, parseDecimal('0.01')!))).toBe('9.99');
  });

  it('accumulates scale on multiplication', () => {
    const product = multiply(parseDecimal('200.00')!, parseDecimal('20.00')!);
    expect(product.scale).toBe(4);
    expect(format(product)).toBe('4000.0000');
  });
});

describe('equalsAtMonetaryScale', () => {
  it('treats amounts agreeing to the cent as equal', () => {
    // EN 16931 rules are evaluated on rounded values; comparing raw would report false failures.
    expect(equalsAtMonetaryScale(parseDecimal('100.004')!, parseDecimal('100.00')!)).toBe(true);
  });

  it('still catches a one-cent discrepancy', () => {
    expect(equalsAtMonetaryScale(parseDecimal('100.01')!, parseDecimal('100.00')!)).toBe(false);
  });
});

describe('formatFrench', () => {
  it('uses a comma decimal separator and grouped thousands', () => {
    const formatted = formatFrench(parseDecimal('1234567.5')!, 'EUR');
    expect(formatted).toContain(',50');
    expect(formatted).toContain('€');
    expect(formatted).toMatch(/1\s?234\s?567/);
  });

  it('renders negatives and omits the symbol when no currency is given', () => {
    expect(formatFrench(parseDecimal('-42.5')!, 'EUR')).toContain('-42,50');
    expect(formatFrench(parseDecimal('42.5')!)).toBe('42,50');
  });
});

describe('toNumber', () => {
  it('round-trips a displayable value', () => {
    expect(toNumber(parseDecimal('1234.56')!)).toBe(1234.56);
  });
});
