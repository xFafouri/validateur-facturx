/**
 * Builds CII invoice XML for tests.
 *
 * A builder rather than a directory of near-identical XML files: most tests differ from a valid
 * invoice in exactly one way, and expressing that difference as an override makes the intent of
 * each test legible. With static files, the one line that matters is buried in 60 lines of
 * boilerplate and drifts out of sync as the fixtures are copied around.
 *
 * The default output is a deliberately realistic French invoice: two lines, 20% VAT, consistent
 * totals, valid SIREN and VAT number.
 */

import { PROFILE_URNS, type FacturxProfile } from '../../src/profiles.js';

export interface LineSpec {
  readonly id: string;
  readonly name: string;
  readonly quantity: string;
  readonly unitCode?: string;
  readonly unitPrice: string;
  /** Line net amount (BT-131). Set independently of quantity x price so tests can break it. */
  readonly netAmount: string;
  readonly vatRate?: string;
  readonly vatCategory?: string;
}

export interface TaxSpec {
  readonly basisAmount: string;
  readonly calculatedAmount: string;
  readonly ratePercent: string;
  readonly categoryCode?: string;
  readonly exemptionReason?: string;
}

export interface InvoiceSpec {
  readonly profile?: FacturxProfile;
  readonly invoiceNumber?: string;
  readonly typeCode?: string;
  readonly issueDate?: string;
  readonly dueDate?: string;
  readonly currency?: string;
  readonly buyerReference?: string;
  readonly sellerName?: string;
  readonly sellerSiren?: string;
  readonly sellerVat?: string;
  readonly buyerName?: string;
  readonly lines?: readonly LineSpec[];
  readonly taxes?: readonly TaxSpec[];
  readonly lineTotalAmount?: string;
  readonly taxBasisTotalAmount?: string;
  readonly taxTotalAmount?: string;
  readonly grandTotalAmount?: string;
  readonly duePayableAmount?: string;
  readonly prepaidAmount?: string;
}

const DEFAULT_LINES: readonly LineSpec[] = [
  {
    id: '1',
    name: 'Prestation de conseil',
    quantity: '2',
    unitCode: 'HUR',
    unitPrice: '100.00',
    netAmount: '200.00',
  },
  {
    id: '2',
    name: 'Frais de déplacement',
    quantity: '1',
    unitCode: 'C62',
    unitPrice: '50.00',
    netAmount: '50.00',
  },
];

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLine(line: LineSpec): string {
  return `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${escape(line.id)}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${escape(line.name)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${escape(line.unitPrice)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${escape(line.unitCode ?? 'C62')}">${escape(line.quantity)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${escape(line.vatCategory ?? 'S')}</ram:CategoryCode>
          <ram:RateApplicablePercent>${escape(line.vatRate ?? '20.00')}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${escape(line.netAmount)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
}

function renderTax(tax: TaxSpec): string {
  const exemption = tax.exemptionReason
    ? `\n        <ram:ExemptionReason>${escape(tax.exemptionReason)}</ram:ExemptionReason>`
    : '';
  return `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${escape(tax.calculatedAmount)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>${exemption}
        <ram:BasisAmount>${escape(tax.basisAmount)}</ram:BasisAmount>
        <ram:CategoryCode>${escape(tax.categoryCode ?? 'S')}</ram:CategoryCode>
        <ram:RateApplicablePercent>${escape(tax.ratePercent)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`;
}

/** Builds CII XML. Every field has a valid default; pass only what the test needs to change. */
export function buildInvoiceXml(spec: InvoiceSpec = {}): string {
  const lines = spec.lines ?? DEFAULT_LINES;
  const taxes =
    spec.taxes ??
    ([{ basisAmount: '250.00', calculatedAmount: '50.00', ratePercent: '20.00' }] as const);

  const profileUrn = PROFILE_URNS[spec.profile ?? 'BASIC'];

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${escape(profileUrn)}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escape(spec.invoiceNumber ?? 'FA-2026-0042')}</ram:ID>
    <ram:TypeCode>${escape(spec.typeCode ?? '380')}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${escape(spec.issueDate ?? '20260901')}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines.map(renderLine).join('')}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${escape(spec.buyerReference ?? 'SERVICE-ACHATS')}</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>${escape(spec.sellerName ?? 'ACME Conseil SARL')}</ram:Name>
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${escape(spec.sellerSiren ?? '552081317')}</ram:ID>
        </ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>75001</ram:PostcodeCode>
          <ram:LineOne>1 rue de la Paix</ram:LineOne>
          <ram:CityName>Paris</ram:CityName>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${escape(spec.sellerVat ?? 'FR38552081317')}</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${escape(spec.buyerName ?? 'Boulangerie Martin SAS')}</ram:Name>
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">443061841</ram:ID>
        </ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>69002</ram:PostcodeCode>
          <ram:LineOne>12 rue de la République</ram:LineOne>
          <ram:CityName>Lyon</ram:CityName>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${escape(spec.currency ?? 'EUR')}</ram:InvoiceCurrencyCode>${taxes.map(renderTax).join('')}
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${escape(spec.dueDate ?? '20261001')}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${escape(spec.lineTotalAmount ?? '250.00')}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${escape(spec.taxBasisTotalAmount ?? '250.00')}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${escape(spec.currency ?? 'EUR')}">${escape(spec.taxTotalAmount ?? '50.00')}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${escape(spec.grandTotalAmount ?? '300.00')}</ram:GrandTotalAmount>${
          spec.prepaidAmount
            ? `\n        <ram:TotalPrepaidAmount>${escape(spec.prepaidAmount)}</ram:TotalPrepaidAmount>`
            : ''
        }
        <ram:DuePayableAmount>${escape(spec.duePayableAmount ?? '300.00')}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

export function buildInvoiceBytes(spec: InvoiceSpec = {}): Uint8Array {
  return new TextEncoder().encode(buildInvoiceXml(spec));
}
