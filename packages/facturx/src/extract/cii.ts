/**
 * Parses UN/CEFACT Cross Industry Invoice (CII) XML into a typed model.
 *
 * Scope: this reads what the document *says*. It performs no business-rule checking - that is the
 * Mustang sidecar's job, and duplicating it here would create two sources of truth that drift.
 * What this enables is showing the user the invoice in human terms alongside the rule failures,
 * which is the whole point of the receiver-side experience.
 *
 * Business term identifiers (`BT-*`) from EN 16931 are noted against each field, because the
 * validator reports failures in those terms and the UI has to connect the two.
 */

import { XMLParser } from 'fast-xml-parser';
import { type Decimal, parseDecimal } from '../money.js';
import { type FacturxProfile, profileFromUrn } from '../profiles.js';

/**
 * Namespace prefixes are stripped, so `rsm:CrossIndustryInvoice` is reached as
 * `CrossIndustryInvoice`. CII does not reuse local names across its namespaces, so this is
 * unambiguous and removes a great deal of prefix-juggling.
 *
 * `parseTagValue: false` is the load-bearing setting: left on, the parser would turn `"20.10"`
 * into the double `20.1` and `BT-131` sums would be computed from already-lossy values. Every
 * amount must reach `parseDecimal` as the original string.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Guards against a hostile document blowing the stack on deeply nested elements.
  stopNodes: [],
});

export class CiiParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'CiiParseError';
  }
}

export interface CiiAddress {
  readonly line1: string | null;
  readonly line2: string | null;
  readonly postcode: string | null;
  readonly city: string | null;
  /** BT-40 / BT-55: ISO 3166-1 alpha-2. */
  readonly countryCode: string | null;
}

export interface CiiParty {
  /** BT-27 (seller) / BT-44 (buyer). */
  readonly name: string | null;
  /** BT-30 / BT-47: legal registration identifier - the SIREN for French entities. */
  readonly legalId: string | null;
  readonly legalIdScheme: string | null;
  /** BT-31 / BT-48: VAT identifier. */
  readonly vatId: string | null;
  /** BT-29 / BT-46: electronic address used for routing. */
  readonly globalId: string | null;
  readonly globalIdScheme: string | null;
  readonly address: CiiAddress;
}

export interface CiiTaxBreakdown {
  /** BT-116: taxable base for this rate. */
  readonly basisAmount: Decimal | null;
  /** BT-117: VAT amount for this rate. */
  readonly calculatedAmount: Decimal | null;
  /** BT-118: VAT category code (`S` standard, `Z` zero, `E` exempt, `AE` reverse charge...). */
  readonly categoryCode: string | null;
  /** BT-119: rate as a percentage, e.g. `20.00`. */
  readonly ratePercent: Decimal | null;
  /** BT-120: reason the VAT is exempted, when applicable. */
  readonly exemptionReason: string | null;
}

export interface CiiLine {
  /** BT-126. */
  readonly id: string | null;
  /** BT-153. */
  readonly name: string | null;
  /** BT-154. */
  readonly description: string | null;
  /** BT-129. */
  readonly quantity: Decimal | null;
  /** BT-130: UN/ECE Rec 20 unit code, e.g. `C62` (piece), `HUR` (hour). */
  readonly unitCode: string | null;
  /** BT-146: net unit price. */
  readonly netUnitPrice: Decimal | null;
  /** BT-131: line net amount. These must sum to BT-106. */
  readonly netAmount: Decimal | null;
  /** BT-151. */
  readonly vatCategoryCode: string | null;
  /** BT-152. */
  readonly vatRatePercent: Decimal | null;
}

export interface CiiTotals {
  /** BT-106: sum of line net amounts. */
  readonly lineTotalAmount: Decimal | null;
  /** BT-107. */
  readonly allowanceTotalAmount: Decimal | null;
  /** BT-108. */
  readonly chargeTotalAmount: Decimal | null;
  /** BT-109: total excluding VAT. */
  readonly taxBasisTotalAmount: Decimal | null;
  /** BT-110: total VAT. */
  readonly taxTotalAmount: Decimal | null;
  /** BT-112: total including VAT. */
  readonly grandTotalAmount: Decimal | null;
  /** BT-113. */
  readonly prepaidAmount: Decimal | null;
  /** BT-115: amount actually due. */
  readonly duePayableAmount: Decimal | null;
}

export interface CiiInvoice {
  /** Guideline URN declared in the document. */
  readonly guidelineUrn: string | null;
  /** Profile resolved from the URN, or `null` when the URN is unrecognised. */
  readonly profile: FacturxProfile | null;
  /** BT-1: invoice number. */
  readonly invoiceNumber: string | null;
  /** BT-3: document type code - `380` invoice, `381` credit note. */
  readonly typeCode: string | null;
  /** BT-2, as `YYYY-MM-DD`. */
  readonly issueDate: string | null;
  /** BT-9, as `YYYY-MM-DD`. */
  readonly dueDate: string | null;
  /** BT-5: ISO 4217 currency code. */
  readonly currency: string | null;
  /** BT-10: buyer's internal reference. Frequently mandated by large buyers. */
  readonly buyerReference: string | null;
  readonly seller: CiiParty;
  readonly buyer: CiiParty;
  readonly lines: readonly CiiLine[];
  readonly taxBreakdown: readonly CiiTaxBreakdown[];
  readonly totals: CiiTotals;
  /** Free-text notes carried on the document (BT-22). */
  readonly notes: readonly string[];
}

type XmlNode = Record<string, unknown>;

/** Reads a child element, tolerating the parser's collapse of single elements to a scalar. */
function child(node: unknown, name: string): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  return (node as XmlNode)[name];
}

/** Navigates a chain of child element names. */
function path(node: unknown, ...names: readonly string[]): unknown {
  let current: unknown = node;
  for (const name of names) {
    current = child(current, name);
    if (current === undefined || current === null) return undefined;
  }
  return current;
}

/**
 * Normalises a node to an array.
 *
 * fast-xml-parser yields a bare object for a single occurrence and an array for repeats, so every
 * repeatable element (lines, tax breakdowns) has to be normalised or single-line invoices break.
 */
function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Extracts element text, handling both bare scalars and `{ '#text': ..., '@_attr': ... }`. */
function text(node: unknown): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === 'string') return node.trim() === '' ? null : node.trim();
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.length > 0 ? text(node[0]) : null;
  if (typeof node === 'object') {
    const value = (node as XmlNode)['#text'];
    if (value === undefined) return null;
    return text(value);
  }
  return null;
}

function attr(node: unknown, name: string): string | null {
  if (node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.length > 0 ? attr(node[0], name) : null;
  const value = (node as XmlNode)[`@_${name}`];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function amount(node: unknown): Decimal | null {
  return parseDecimal(text(node));
}

/**
 * Converts a CII date to ISO `YYYY-MM-DD`.
 *
 * CII dates are `<udt:DateTimeString format="102">20260115</udt:DateTimeString>`; format 102 is
 * `CCYYMMDD` and is effectively universal in Factur-X. Other formats are returned untouched
 * rather than mangled into a wrong date.
 */
function parseCiiDate(node: unknown): string | null {
  const dateNode = child(node, 'DateTimeString') ?? node;
  const raw = text(dateNode);
  if (!raw) return null;

  const format = attr(dateNode, 'format');
  if (format === '102' || /^\d{8}$/.test(raw)) {
    if (!/^\d{8}$/.test(raw)) return raw;
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

function parseAddress(node: unknown): CiiAddress {
  return {
    line1: text(child(node, 'LineOne')),
    line2: text(child(node, 'LineTwo')),
    postcode: text(child(node, 'PostcodeCode')),
    city: text(child(node, 'CityName')),
    countryCode: text(child(node, 'CountryID')),
  };
}

/**
 * Reads a trade party.
 *
 * VAT registration needs care: `SpecifiedTaxRegistration` repeats, and the VAT identifier is the
 * entry whose `schemeID` is `VA`. Taking the first entry unconditionally picks up the `FC` tax
 * number instead on documents that carry both.
 */
function parseParty(node: unknown): CiiParty {
  const legalOrg = child(node, 'SpecifiedLegalOrganization');

  const registrations = asArray(child(node, 'SpecifiedTaxRegistration'));
  const vatRegistration =
    registrations.find((reg) => attr(child(reg, 'ID'), 'schemeID') === 'VA') ?? null;

  const globalId = child(node, 'GlobalID');

  return {
    name: text(child(node, 'Name')),
    legalId: text(child(legalOrg, 'ID')),
    legalIdScheme: attr(child(legalOrg, 'ID'), 'schemeID'),
    vatId: vatRegistration ? text(child(vatRegistration, 'ID')) : null,
    globalId: text(globalId),
    globalIdScheme: attr(globalId, 'schemeID'),
    address: parseAddress(child(node, 'PostalTradeAddress')),
  };
}

function parseLine(node: unknown): CiiLine {
  const agreement = child(node, 'SpecifiedLineTradeAgreement');
  const delivery = child(node, 'SpecifiedLineTradeDelivery');
  const settlement = child(node, 'SpecifiedLineTradeSettlement');
  const product = child(node, 'SpecifiedTradeProduct');

  const billedQuantity = child(delivery, 'BilledQuantity');
  // A line carries at most one tax entry in every profile up to EXTENDED.
  const lineTax = asArray(child(settlement, 'ApplicableTradeTax'))[0];

  return {
    id: text(path(node, 'AssociatedDocumentLineDocument', 'LineID')),
    name: text(child(product, 'Name')),
    description: text(child(product, 'Description')),
    quantity: amount(billedQuantity),
    unitCode: attr(billedQuantity, 'unitCode'),
    netUnitPrice: amount(path(agreement, 'NetPriceProductTradePrice', 'ChargeAmount')),
    netAmount: amount(
      path(settlement, 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount'),
    ),
    vatCategoryCode: text(child(lineTax, 'CategoryCode')),
    vatRatePercent: amount(child(lineTax, 'RateApplicablePercent')),
  };
}

function parseTaxBreakdown(node: unknown): CiiTaxBreakdown {
  return {
    basisAmount: amount(child(node, 'BasisAmount')),
    calculatedAmount: amount(child(node, 'CalculatedAmount')),
    categoryCode: text(child(node, 'CategoryCode')),
    ratePercent: amount(child(node, 'RateApplicablePercent')),
    exemptionReason: text(child(node, 'ExemptionReason')),
  };
}

const CII_ROOT_MARKER = new TextEncoder().encode('CrossIndustryInvoice');

/** Byte-level substring search, so detection needs no full decode of a large document. */
function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  const first = needle[0]!;
  const limit = haystack.length - needle.length;

  outer: for (let i = 0; i <= limit; i += 1) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Detects the CII root element without a full parse, to route an upload.
 *
 * Scans the whole buffer rather than a fixed-size head. Real Factur-X files routinely open with a
 * multi-kilobyte licence comment before the root element - the ZUGFeRD reference samples put
 * `CrossIndustryInvoice` almost 6 KB in - so a small window rejects perfectly valid invoices as
 * "not a CII file". Uploads are size-capped upstream, so a full scan is bounded work.
 */
export function looksLikeCiiXml(bytes: Uint8Array): boolean {
  return containsBytes(bytes, CII_ROOT_MARKER);
}

/**
 * Parses CII XML into the typed model.
 *
 * Individual fields are read leniently - a missing element yields `null` rather than an error -
 * because an incomplete document is exactly what a user brings to a validator, and it still has
 * to be displayed. Only a document that is not CII at all is rejected outright.
 */
export function parseCii(xml: string | Uint8Array): CiiInvoice {
  const source = typeof xml === 'string' ? xml : new TextDecoder('utf-8').decode(xml);

  let parsed: unknown;
  try {
    parsed = parser.parse(source);
  } catch (error) {
    throw new CiiParseError(
      "Le XML n'a pas pu être analysé : il est mal formé (balise non fermée, caractère interdit ou encodage incorrect).",
      error,
    );
  }

  const root = child(parsed, 'CrossIndustryInvoice');
  if (!root) {
    throw new CiiParseError(
      "Ce fichier XML n'est pas une facture CII : l'élément racine « CrossIndustryInvoice » est absent.",
    );
  }

  const document = child(root, 'ExchangedDocument');
  const transaction = child(root, 'SupplyChainTradeTransaction');
  const agreement = child(transaction, 'ApplicableHeaderTradeAgreement');
  const settlement = child(transaction, 'ApplicableHeaderTradeSettlement');
  const summation = child(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');

  const guidelineUrn = text(
    path(root, 'ExchangedDocumentContext', 'GuidelineSpecifiedDocumentContextParameter', 'ID'),
  );

  const paymentTerms = asArray(child(settlement, 'SpecifiedTradePaymentTerms'))[0];

  const notes = asArray(child(document, 'IncludedNote'))
    .map((note) => text(child(note, 'Content')))
    .filter((note): note is string => note !== null);

  return {
    guidelineUrn,
    profile: profileFromUrn(guidelineUrn),
    invoiceNumber: text(child(document, 'ID')),
    typeCode: text(child(document, 'TypeCode')),
    issueDate: parseCiiDate(child(document, 'IssueDateTime')),
    dueDate: parseCiiDate(child(paymentTerms, 'DueDateDateTime')),
    currency: text(child(settlement, 'InvoiceCurrencyCode')),
    buyerReference: text(child(agreement, 'BuyerReference')),
    seller: parseParty(child(agreement, 'SellerTradeParty')),
    buyer: parseParty(child(agreement, 'BuyerTradeParty')),
    lines: asArray(child(transaction, 'IncludedSupplyChainTradeLineItem')).map(parseLine),
    taxBreakdown: asArray(child(settlement, 'ApplicableTradeTax')).map(parseTaxBreakdown),
    totals: {
      lineTotalAmount: amount(child(summation, 'LineTotalAmount')),
      allowanceTotalAmount: amount(child(summation, 'AllowanceTotalAmount')),
      chargeTotalAmount: amount(child(summation, 'ChargeTotalAmount')),
      taxBasisTotalAmount: amount(child(summation, 'TaxBasisTotalAmount')),
      taxTotalAmount: amount(child(summation, 'TaxTotalAmount')),
      grandTotalAmount: amount(child(summation, 'GrandTotalAmount')),
      prepaidAmount: amount(child(summation, 'TotalPrepaidAmount')),
      duePayableAmount: amount(child(summation, 'DuePayableAmount')),
    },
    notes,
  };
}
