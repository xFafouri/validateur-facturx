/**
 * Serialises a draft to Cross Industry Invoice XML, BASIC profile.
 *
 * BASIC is the emitted profile (see `profiles.ts` for why). Its constraint is not only which
 * elements are *required* but which are *permitted*: the BASIC XSD is a restriction of the full CII
 * schema, and populating a field it does not declare - a trade contact, say, which is perfectly
 * sensible data - makes the document schema-invalid. Declaring one profile and populating another
 * is the classic Factur-X trap, so everything emitted here stays inside BASIC.
 *
 * Amounts are written from the computed values (`compute.ts`), never from the draft, and always at
 * exactly two decimals. `1730` and `1730.00` are the same number, but receiving systems parse them
 * with varying tolerance and there is nothing to gain from finding out which.
 */

import { sirenFromSiret, vatNumberFromSiren } from '../identifiers.js';
import { type Decimal, MONETARY_SCALE, format, rescale } from '../money.js';
import { PROFILE_URNS } from '../profiles.js';
import type { ComputedInvoice, ComputedLine, ComputedTaxGroup } from './compute.js';
import type { DraftParty, InvoiceDraft } from './draft.js';
import { el, leaf, renderXml, type XmlNode } from './xml.js';

const NS = {
  'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  'xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
} as const;

/**
 * Identifier scheme codes, from the ISO/IEC 6523 list.
 *
 * `0002` is INSEE's SIRENE register, the scheme a SIREN is expressed in. `0009` is the SIRET, which
 * is what the Annuaire routes on under the 5-corner model, so it is also what goes in the
 * electronic address (BT-34 / BT-49).
 */
const SCHEME_SIREN = '0002';
const SCHEME_SIRET = '0009';

/**
 * Mandatory mentions on a French B2B invoice (article L441-9 of the Code de commerce).
 *
 * Carried as structured notes rather than printed only on the PDF page: the XML is the legal
 * original under the mandate, and a mention that exists solely in the visual layer is absent from
 * the document that actually gets archived and read by the buyer's system.
 */
export const FRENCH_LEGAL_NOTES: ReadonlyArray<{ readonly code: string; readonly text: string }> = [
  {
    code: 'PMD',
    text: "Pénalités de retard : taux d'intérêt légal majoré de 10 points, exigibles sans rappel.",
  },
  {
    code: 'PMT',
    text: 'Indemnité forfaitaire pour frais de recouvrement en cas de retard : 40 euros.',
  },
  { code: 'AAB', text: 'Escompte pour paiement anticipé : néant.' },
];

/** CII writes dates as `CCYYMMDD` under format code 102. */
function ciiDate(iso: string): string {
  return iso.replace(/-/g, '');
}

/** `<ram:IssueDateTime><udt:DateTimeString format="102">20260903</udt:...></ram:...>` */
function dateNode(name: string, iso: string): XmlNode {
  return el(name, [leaf('udt:DateTimeString', ciiDate(iso), { format: '102' })]);
}

function money(amount: Decimal): string {
  return format(rescale(amount, MONETARY_SCALE));
}

function digitsOnly(value: string | null | undefined): string | null {
  const stripped = value?.replace(/[\s.\-/]/g, '');
  return stripped ? stripped : null;
}

function partyNode(name: string, party: DraftParty): XmlNode {
  const siret = digitsOnly(party.siret);
  const siren = digitsOnly(party.siren) ?? sirenFromSiret(siret);
  // A French party that states a SIREN but no VAT number almost always has the derivable one, and
  // omitting BT-31 costs the seller the VAT-registration rules the buyer's system checks.
  const vatId =
    party.vatId?.replace(/\s/g, '').toUpperCase() ??
    ((party.address.countryCode ?? '').toUpperCase() === 'FR' ? vatNumberFromSiren(siren) : null);

  return el(name, [
    leaf('ram:Name', party.name),
    siren
      ? el('ram:SpecifiedLegalOrganization', [leaf('ram:ID', siren, { schemeID: SCHEME_SIREN })])
      : null,
    el('ram:PostalTradeAddress', [
      party.address.postcode ? leaf('ram:PostcodeCode', party.address.postcode) : null,
      party.address.line1 ? leaf('ram:LineOne', party.address.line1) : null,
      party.address.line2 ? leaf('ram:LineTwo', party.address.line2) : null,
      party.address.city ? leaf('ram:CityName', party.address.city) : null,
      leaf('ram:CountryID', (party.address.countryCode ?? 'FR').toUpperCase()),
    ]),
    siret
      ? el('ram:URIUniversalCommunication', [leaf('ram:URIID', siret, { schemeID: SCHEME_SIRET })])
      : null,
    vatId ? el('ram:SpecifiedTaxRegistration', [leaf('ram:ID', vatId, { schemeID: 'VA' })]) : null,
  ]);
}

function lineNode(line: ComputedLine): XmlNode {
  return el('ram:IncludedSupplyChainTradeLineItem', [
    el('ram:AssociatedDocumentLineDocument', [leaf('ram:LineID', line.lineId)]),
    el('ram:SpecifiedTradeProduct', [
      leaf('ram:Name', line.source.name),
      line.source.description ? leaf('ram:Description', line.source.description) : null,
    ]),
    el('ram:SpecifiedLineTradeAgreement', [
      el('ram:NetPriceProductTradePrice', [leaf('ram:ChargeAmount', format(line.unitPrice))]),
    ]),
    el('ram:SpecifiedLineTradeDelivery', [
      leaf('ram:BilledQuantity', format(line.quantity), { unitCode: line.source.unitCode }),
    ]),
    el('ram:SpecifiedLineTradeSettlement', [
      el('ram:ApplicableTradeTax', [
        leaf('ram:TypeCode', 'VAT'),
        leaf('ram:CategoryCode', line.vatCategory),
        leaf('ram:RateApplicablePercent', money(line.vatRatePercent)),
      ]),
      el('ram:SpecifiedTradeSettlementLineMonetarySummation', [
        leaf('ram:LineTotalAmount', money(line.netAmount)),
      ]),
    ]),
  ]);
}

/**
 * A VAT breakdown group (BG-23).
 *
 * `TradeTaxType` is an `xsd:sequence`: CalculatedAmount, TypeCode, ExemptionReason, BasisAmount,
 * CategoryCode, RateApplicablePercent. The order is not negotiable even though the names make each
 * element unambiguous.
 */
function taxNode(group: ComputedTaxGroup): XmlNode {
  return el('ram:ApplicableTradeTax', [
    leaf('ram:CalculatedAmount', money(group.calculatedAmount)),
    leaf('ram:TypeCode', 'VAT'),
    group.exemptionReason ? leaf('ram:ExemptionReason', group.exemptionReason) : null,
    leaf('ram:BasisAmount', money(group.basisAmount)),
    leaf('ram:CategoryCode', group.categoryCode),
    leaf('ram:RateApplicablePercent', money(group.ratePercent)),
  ]);
}

export interface SerialiseOptions {
  /**
   * Whether to append the mandatory French mentions as structured notes. On by default.
   *
   * Off is for the rare non-French invoice, not for saving space: printing the mentions on the page
   * while omitting them from the XML makes the two renditions of one invoice disagree.
   */
  readonly includeFrenchLegalNotes?: boolean;
}

/** Serialises a draft and its computed totals to BASIC-profile CII XML. */
export function serialiseCii(
  draft: InvoiceDraft,
  computed: ComputedInvoice,
  options: SerialiseOptions = {},
): string {
  const currency = draft.currency ?? 'EUR';
  const notes = [
    ...(draft.notes ?? []).map((text) => ({ code: null as string | null, text })),
    ...(options.includeFrenchLegalNotes === false ? [] : FRENCH_LEGAL_NOTES),
  ];

  const root = el(
    'rsm:CrossIndustryInvoice',
    [
      el('rsm:ExchangedDocumentContext', [
        el('ram:GuidelineSpecifiedDocumentContextParameter', [leaf('ram:ID', PROFILE_URNS.BASIC)]),
      ]),
      el('rsm:ExchangedDocument', [
        leaf('ram:ID', draft.invoiceNumber),
        leaf('ram:TypeCode', draft.typeCode ?? '380'),
        dateNode('ram:IssueDateTime', draft.issueDate),
        ...notes.map((note) =>
          el('ram:IncludedNote', [
            leaf('ram:Content', note.text),
            note.code ? leaf('ram:SubjectCode', note.code) : null,
          ]),
        ),
      ]),
      el('rsm:SupplyChainTradeTransaction', [
        ...computed.lines.map(lineNode),
        el('ram:ApplicableHeaderTradeAgreement', [
          draft.buyerReference ? leaf('ram:BuyerReference', draft.buyerReference) : null,
          partyNode('ram:SellerTradeParty', draft.seller),
          partyNode('ram:BuyerTradeParty', draft.buyer),
          draft.purchaseOrderReference
            ? el('ram:BuyerOrderReferencedDocument', [
                leaf('ram:IssuerAssignedID', draft.purchaseOrderReference),
              ])
            : null,
        ]),
        el('ram:ApplicableHeaderTradeDelivery', [
          // BG-13. Carried only when a delivery country is stated: BR-IC-12 needs it for an
          // intra-community supply, and an empty ship-to party would be noise on every other
          // invoice. `ShipToTradeParty` precedes the delivery event in the schema sequence.
          draft.deliveryCountryCode
            ? el('ram:ShipToTradeParty', [
                el('ram:PostalTradeAddress', [
                  leaf('ram:CountryID', draft.deliveryCountryCode.toUpperCase()),
                ]),
              ])
            : null,
          el('ram:ActualDeliverySupplyChainEvent', [
            dateNode('ram:OccurrenceDateTime', draft.deliveryDate ?? draft.issueDate),
          ]),
        ]),
        el('ram:ApplicableHeaderTradeSettlement', [
          leaf('ram:InvoiceCurrencyCode', currency),
          el('ram:SpecifiedTradeSettlementPaymentMeans', [
            leaf('ram:TypeCode', draft.paymentMeansCode ?? '30'),
            draft.iban
              ? el('ram:PayeePartyCreditorFinancialAccount', [
                  leaf('ram:IBANID', draft.iban.replace(/[\s-]/g, '').toUpperCase()),
                ])
              : null,
          ]),
          ...computed.taxGroups.map(taxNode),
          draft.paymentTerms || draft.dueDate
            ? el('ram:SpecifiedTradePaymentTerms', [
                draft.paymentTerms ? leaf('ram:Description', draft.paymentTerms) : null,
                draft.dueDate ? dateNode('ram:DueDateDateTime', draft.dueDate) : null,
              ])
            : null,
          el('ram:SpecifiedTradeSettlementHeaderMonetarySummation', [
            leaf('ram:LineTotalAmount', money(computed.totals.lineTotalAmount)),
            leaf('ram:TaxBasisTotalAmount', money(computed.totals.taxBasisTotalAmount)),
            leaf('ram:TaxTotalAmount', money(computed.totals.taxTotalAmount), {
              currencyID: currency,
            }),
            leaf('ram:GrandTotalAmount', money(computed.totals.grandTotalAmount)),
            computed.totals.prepaidAmount.value !== 0n
              ? leaf('ram:TotalPrepaidAmount', money(computed.totals.prepaidAmount))
              : null,
            leaf('ram:DuePayableAmount', money(computed.totals.duePayableAmount)),
          ]),
        ]),
      ]),
    ],
    NS,
  );

  return renderXml(root);
}
