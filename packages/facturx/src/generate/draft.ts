/**
 * The invoice a user submits, before it becomes a Factur-X document.
 *
 * The defining property of this model is what it *omits*: no totals. A draft carries lines, rates
 * and parties, and every monetary total on the emitted document is derived from them
 * (`compute.ts`). That is the whole point. `BR-CO-10` - the declared line total disagreeing with
 * the sum of the lines - is the most common rejection in the wild precisely because senders carry a
 * total that some earlier system computed separately. A total that cannot be supplied cannot
 * disagree.
 *
 * Amounts arrive as strings, not numbers. A `number` field here would put IEEE-754 back on the
 * ingest path that `money.ts` exists to keep it off; the string is parsed straight to `Decimal`.
 */

/**
 * EN 16931 VAT category codes (UNTDID 5305 subset), limited to those a French invoice uses.
 *
 * - `S`  standard rate
 * - `Z`  zero-rated
 * - `E`  exempt (requires a stated reason - BR-E-10)
 * - `AE` reverse charge, "autoliquidation" (requires a reason - BR-AE-10)
 * - `K`  intra-community supply (requires a reason - BR-IC-10, and a delivery country - BR-IC-12)
 * - `G`  export outside the EU (requires a reason - BR-G-10)
 */
export const VAT_CATEGORIES = ['S', 'Z', 'E', 'AE', 'K', 'G'] as const;

export type VatCategory = (typeof VAT_CATEGORIES)[number];

/** Categories that charge no VAT, and whose rate must therefore be zero. */
export const ZERO_RATED_CATEGORIES: readonly VatCategory[] = ['Z', 'E', 'AE', 'K', 'G'];

/**
 * Categories that must state *why* no VAT is charged.
 *
 * `Z` is deliberately absent, and the distinction is not a technicality. Zero-rated means VAT
 * applies at a rate of 0 %, not that the supply is outside VAT - so there is nothing to justify,
 * and BR-Z-10 forbids a reason rather than requiring one. Treating `Z` like the exempt categories
 * produces a document that fails validation for supplying an explanation nobody asked for.
 * Confirmed against the engine.
 */
export const REASON_REQUIRED_CATEGORIES: readonly VatCategory[] = ['E', 'AE', 'K', 'G'];

export interface DraftAddress {
  readonly line1: string;
  readonly line2?: string | null;
  readonly postcode: string;
  readonly city: string;
  /** ISO 3166-1 alpha-2. `FR` for a domestic invoice. */
  readonly countryCode: string;
}

export interface DraftParty {
  /** BT-27 / BT-44. */
  readonly name: string;
  /**
   * The 14-digit SIRET.
   *
   * Doubles as the electronic address (BT-34 / BT-49, scheme `0009`) that the Annuaire routes on
   * under the 5-corner model, which is why it is the identifier asked for rather than the SIREN:
   * the SIREN is derivable from it, the reverse is not.
   */
  readonly siret?: string | null;
  /** BT-30 / BT-47. Derived from the SIRET when omitted. */
  readonly siren?: string | null;
  /** BT-31 / BT-48. Derived from the SIREN for French parties when omitted. */
  readonly vatId?: string | null;
  readonly address: DraftAddress;
}

export interface DraftLine {
  /** BT-153. */
  readonly name: string;
  /** BT-154. */
  readonly description?: string | null;
  /** BT-129. Up to 4 decimals. */
  readonly quantity: string;
  /** BT-130: UN/ECE Recommendation 20 code - `C62` piece, `HUR` hour, `DAY` day, `MTQ` m³. */
  readonly unitCode: string;
  /** BT-146: net unit price, VAT excluded. Up to 4 decimals. */
  readonly unitPrice: string;
  /** BT-151. */
  readonly vatCategory: VatCategory;
  /** BT-152, as a percentage: `20.00`, `10.00`, `5.50`, `2.10`, or `0` when not charged. */
  readonly vatRatePercent: string;
  /** BT-120: why VAT is not charged. Required for every category except `S`. */
  readonly exemptionReason?: string | null;
}

/** UNTDID 1001 document types we emit. */
export const DRAFT_TYPE_CODES = ['380', '381', '384', '386'] as const;

export type DraftTypeCode = (typeof DRAFT_TYPE_CODES)[number];

export interface InvoiceDraft {
  /** BT-1. */
  readonly invoiceNumber: string;
  /** BT-3. Defaults to `380` (commercial invoice). */
  readonly typeCode?: DraftTypeCode;
  /** BT-2, as `YYYY-MM-DD`. */
  readonly issueDate: string;
  /** BT-9, as `YYYY-MM-DD`. */
  readonly dueDate?: string | null;
  /** BT-72, as `YYYY-MM-DD`. Defaults to the issue date. */
  readonly deliveryDate?: string | null;
  /**
   * BT-80: the country the goods are delivered to.
   *
   * Only meaningful when it differs from the buyer's own country, which is exactly the
   * intra-community case: BR-IC-12 requires it on any invoice carrying a `K` line, because the
   * destination is what establishes the exemption.
   */
  readonly deliveryCountryCode?: string | null;
  /** BT-5. Defaults to `EUR`. */
  readonly currency?: string;
  /**
   * BT-10: the buyer's own reference.
   *
   * Optional in EN 16931 but demanded by most large French buyers and by the public sector, whose
   * systems reject an invoice they cannot attach to a commitment.
   */
  readonly buyerReference?: string | null;
  /** BT-13: purchase order number. */
  readonly purchaseOrderReference?: string | null;
  readonly seller: DraftParty;
  readonly buyer: DraftParty;
  readonly lines: readonly DraftLine[];
  /** BT-81: UNTDID 4461 payment means. `30` credit transfer, `48` card, `49` direct debit. */
  readonly paymentMeansCode?: string;
  /** BT-84: the account to be credited. */
  readonly iban?: string | null;
  /** BT-20: payment terms, in words. */
  readonly paymentTerms?: string | null;
  /**
   * BT-113: already paid, typically a deposit.
   *
   * Subtracted from the total to give the amount actually due (BT-115). Stated here rather than
   * computed because only the sender knows what has been received.
   */
  readonly prepaidAmount?: string | null;
  /** BT-22: free-text notes. The mandatory French mentions are added automatically. */
  readonly notes?: readonly string[];
}
