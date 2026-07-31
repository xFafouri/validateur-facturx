/**
 * Exact decimal arithmetic for invoice amounts.
 *
 * Invoice totals are a legal statement, and the single most common real-world Factur-X rejection is
 * `BR-CO-10` - the sum of line net amounts (`BT-131`) not matching the invoice line total
 * (`BT-106`). IEEE-754 doubles cannot represent most monetary decimals exactly, so summing them
 * produces drift that shows up precisely as this error. Everything here is therefore backed by
 * `bigint` scaled integers; no `number` arithmetic is performed on amounts anywhere in this module.
 *
 * Amounts are not fixed at 2 decimals on purpose: CII carries unit prices (`BT-146`) at up to 4
 * decimal places, and truncating those before multiplying would itself introduce error.
 */

export interface Decimal {
  /** Unscaled value: the decimal shifted left by `scale` digits. */
  readonly value: bigint;
  /** Number of digits after the decimal point. */
  readonly scale: number;
}

/** Currency amounts are stated to 2 decimals in EN 16931. */
export const MONETARY_SCALE = 2;

const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

export function decimal(value: bigint, scale: number): Decimal {
  return { value, scale };
}

export const ZERO: Decimal = decimal(0n, 0);

/**
 * Parses a decimal string as it appears in CII XML.
 *
 * Returns `null` rather than throwing or coercing to zero for anything unparseable: a malformed
 * amount is a validation finding to be reported, and silently reading it as 0 would turn a bad
 * document into a plausible-looking one.
 */
export function parseDecimal(raw: string | null | undefined): Decimal | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || !DECIMAL_PATTERN.test(trimmed)) return null;

  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const dot = unsigned.indexOf('.');

  if (dot === -1) {
    const value = BigInt(unsigned);
    return decimal(negative ? -value : value, 0);
  }

  const integerPart = unsigned.slice(0, dot);
  const fractionPart = unsigned.slice(dot + 1);
  const digits = `${integerPart}${fractionPart}` || '0';
  const value = BigInt(digits === '' ? '0' : digits);
  return decimal(negative ? -value : value, fractionPart.length);
}

const TEN = 10n;

function pow10(exponent: number): bigint {
  let result = 1n;
  for (let i = 0; i < exponent; i += 1) result *= TEN;
  return result;
}

/**
 * Re-expresses a decimal at a different scale.
 *
 * Increasing scale is lossless. Decreasing scale rounds half away from zero, which is the
 * convention EN 16931 rounding rules assume (and what a French accountant expects: 2.345 -> 2.35,
 * -2.345 -> -2.35).
 */
export function rescale(d: Decimal, scale: number): Decimal {
  if (d.scale === scale) return d;

  if (scale > d.scale) {
    return decimal(d.value * pow10(scale - d.scale), scale);
  }

  const divisor = pow10(d.scale - scale);
  const quotient = d.value / divisor;
  const remainder = d.value % divisor;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;

  if (twiceRemainder >= divisor) {
    return decimal(quotient + (d.value < 0n ? -1n : 1n), scale);
  }
  return decimal(quotient, scale);
}

/** Aligns two decimals to their common (higher) scale so they can be combined exactly. */
function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [rescale(a, scale).value, rescale(b, scale).value, scale];
}

export function add(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return decimal(x + y, scale);
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return decimal(x - y, scale);
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  return decimal(a.value * b.value, a.scale + b.scale);
}

/** Exact sum. An empty list sums to zero at monetary scale, not to a scale-0 zero. */
export function sum(values: readonly Decimal[]): Decimal {
  return values.reduce<Decimal>((acc, value) => add(acc, value), decimal(0n, MONETARY_SCALE));
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

export function equals(a: Decimal, b: Decimal): boolean {
  return compare(a, b) === 0;
}

export function isZero(d: Decimal): boolean {
  return d.value === 0n;
}

export function negate(d: Decimal): Decimal {
  return decimal(-d.value, d.scale);
}

export function abs(d: Decimal): Decimal {
  return d.value < 0n ? negate(d) : d;
}

/**
 * Compares two amounts after rounding both to monetary scale.
 *
 * EN 16931 arithmetic rules are evaluated on rounded 2-decimal values, so a document whose raw
 * figures differ in the third decimal but agree once rounded is compliant. Comparing the raw
 * values instead would report failures that no conforming validator raises.
 */
export function equalsAtMonetaryScale(a: Decimal, b: Decimal): boolean {
  return equals(rescale(a, MONETARY_SCALE), rescale(b, MONETARY_SCALE));
}

/** Renders in plain form, e.g. `1234.50`. Always includes `scale` decimal places. */
export function format(d: Decimal): string {
  const negative = d.value < 0n;
  const digits = (negative ? -d.value : d.value).toString().padStart(d.scale + 1, '0');
  const sign = negative ? '-' : '';
  if (d.scale === 0) return `${sign}${digits}`;
  const cut = digits.length - d.scale;
  return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

/** Formats for a French-locale UI, e.g. `1 234,50 €`. */
export function formatFrench(d: Decimal, currency?: string | null): string {
  const rounded = rescale(d, MONETARY_SCALE);
  const plain = format(rounded);
  const negative = plain.startsWith('-');
  const [integerPart = '0', fractionPart = '00'] = plain.replace('-', '').split('.');
  // Narrow no-break space is the French thousands separator.
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const amount = `${negative ? '-' : ''}${grouped},${fractionPart}`;
  if (!currency) return amount;
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${amount} ${symbol}`;
}

/**
 * Escape hatch to a JS number, for display and charting only.
 *
 * Never round-trip an amount through this on a path that produces or validates a document.
 */
export function toNumber(d: Decimal): number {
  return Number(format(d));
}
