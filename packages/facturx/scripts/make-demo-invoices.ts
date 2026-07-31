/**
 * Generates demonstration Factur-X invoices.
 *
 * Purpose is twofold: it produces realistic French documents for demoing and manually testing the
 * validator, and it is the first working sketch of the Phase 1 generator. Assembling a genuine
 * PDF/A-3 is the fussy part of Factur-X, and doing it here surfaces the requirements early:
 *
 *   - the XML must be embedded under exactly `factur-x.xml` with `AFRelationship /Data`;
 *   - XMP must declare `pdfaid:part=3` plus the Factur-X extension schema;
 *   - PDF/A requires an OutputIntent with an ICC profile;
 *   - PDF/A requires every font to be embedded - the standard 14 are not allowed.
 *
 * Run: pnpm --filter @facturx/core demo
 *
 * Output lands in `test/corpus/demo/`. These are our own documents, not official samples; the
 * fetched corpus in `test/corpus/vendor/` is what provides independent verification.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import {
  AFRelationship,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFFont,
  type PDFPage,
  rgb,
} from 'pdf-lib';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'corpus', 'demo');

/** DejaVu covers French diacritics and is freely licensed. */
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
];
const BOLD_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];

function firstExisting(paths: string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

// ---------------------------------------------------------------------------
// Invoice data
// ---------------------------------------------------------------------------

interface DemoLine {
  readonly id: string;
  readonly name: string;
  readonly quantity: string;
  readonly unitCode: string;
  readonly unitLabel: string;
  readonly unitPrice: string;
  readonly netAmount: string;
}

interface DemoInvoice {
  readonly number: string;
  readonly issueDate: string; // CCYYMMDD
  readonly dueDate: string;
  readonly seller: {
    name: string;
    siret: string;
    siren: string;
    vat: string;
    address: string;
    postcode: string;
    city: string;
  };
  readonly buyer: {
    name: string;
    siret: string;
    siren: string;
    vat: string;
    address: string;
    postcode: string;
    city: string;
  };
  readonly lines: readonly DemoLine[];
  readonly vatRate: string;
  /** Declared line total. Overridden in the broken variant to trigger BR-CO-10. */
  readonly declaredLineTotal: string;
  readonly declaredVat: string;
  readonly declaredGrandTotal: string;
}

/** A plausible French B2B invoice: a plumber billing a bakery in Lyon. */
const BASE: DemoInvoice = {
  number: 'FA-2026-0087',
  issueDate: '20260903',
  dueDate: '20261003',
  seller: {
    name: 'Plomberie Diderot SARL',
    siret: '55208131766522',
    siren: '552081317',
    vat: 'FR38552081317',
    address: '14 rue Diderot',
    postcode: '69001',
    city: 'Lyon',
  },
  buyer: {
    name: 'Boulangerie Martin SAS',
    siret: '44306184100029',
    siren: '443061841',
    vat: 'FR91443061841',
    address: '12 rue de la République',
    postcode: '69002',
    city: 'Lyon',
  },
  lines: [
    {
      id: '1',
      name: 'Remplacement chauffe-eau 200 L',
      quantity: '1',
      unitCode: 'C62',
      unitLabel: 'u',
      unitPrice: '1250.00',
      netAmount: '1250.00',
    },
    {
      id: '2',
      name: "Main-d'œuvre installation",
      quantity: '6',
      unitCode: 'HUR',
      unitLabel: 'h',
      unitPrice: '65.00',
      netAmount: '390.00',
    },
    {
      id: '3',
      name: 'Déplacement et mise en service',
      quantity: '1',
      unitCode: 'C62',
      unitLabel: 'u',
      unitPrice: '90.00',
      netAmount: '90.00',
    },
  ],
  vatRate: '20.00',
  declaredLineTotal: '1730.00',
  declaredVat: '346.00',
  declaredGrandTotal: '2076.00',
};

/** French mentions that BR-FR-05 requires to be structured in the XML, not only printed. */
const LEGAL_NOTES = [
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

// ---------------------------------------------------------------------------
// CII XML
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCii(invoice: DemoInvoice): string {
  const lines = invoice.lines
    .map(
      (line) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${line.id}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${escapeXml(line.name)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${line.unitPrice}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${line.unitCode}">${line.quantity}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>S</ram:CategoryCode>
          <ram:RateApplicablePercent>${invoice.vatRate}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${line.netAmount}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join('');

  const notes = LEGAL_NOTES.map(
    (note) => `
    <ram:IncludedNote>
      <ram:Content>${escapeXml(note.text)}</ram:Content>
      <ram:SubjectCode>${note.code}</ram:SubjectCode>
    </ram:IncludedNote>`,
  ).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXml(invoice.number)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${invoice.issueDate}</udt:DateTimeString></ram:IssueDateTime>${notes}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>SERVICE-ACHATS</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>${escapeXml(invoice.seller.name)}</ram:Name>
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${invoice.seller.siren}</ram:ID>
        </ram:SpecifiedLegalOrganization>
        <!--
          No DefinedTradeContact (BG-6) here on purpose. The BASIC profile's XSD does not permit
          it on a trade party - it is an EN 16931-level element - so including it makes the
          document fail schema validation even though the data itself is perfectly sensible.
          This is the classic Factur-X trap: declaring one profile and populating another.
          Note that the German XRechnung rule BR-DE-2 *demands* a seller contact; that rule does
          not apply to a French invoice, which is exactly why those findings are separated out.
        -->
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${invoice.seller.postcode}</ram:PostcodeCode>
          <ram:LineOne>${escapeXml(invoice.seller.address)}</ram:LineOne>
          <ram:CityName>${escapeXml(invoice.seller.city)}</ram:CityName>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:URIUniversalCommunication>
          <ram:URIID schemeID="0009">${invoice.seller.siret}</ram:URIID>
        </ram:URIUniversalCommunication>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${invoice.seller.vat}</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${escapeXml(invoice.buyer.name)}</ram:Name>
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${invoice.buyer.siren}</ram:ID>
        </ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${invoice.buyer.postcode}</ram:PostcodeCode>
          <ram:LineOne>${escapeXml(invoice.buyer.address)}</ram:LineOne>
          <ram:CityName>${escapeXml(invoice.buyer.city)}</ram:CityName>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:URIUniversalCommunication>
          <ram:URIID schemeID="0009">${invoice.buyer.siret}</ram:URIID>
        </ram:URIUniversalCommunication>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${invoice.buyer.vat}</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime><udt:DateTimeString format="102">${invoice.issueDate}</udt:DateTimeString></ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>30</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>FR7630006000011234567890189</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${invoice.declaredVat}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${invoice.declaredLineTotal}</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>${invoice.vatRate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime><udt:DateTimeString format="102">${invoice.dueDate}</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${invoice.declaredLineTotal}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${invoice.declaredLineTotal}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${invoice.declaredVat}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${invoice.declaredGrandTotal}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${invoice.declaredGrandTotal}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

// ---------------------------------------------------------------------------
// PDF/A-3 assembly
// ---------------------------------------------------------------------------

/**
 * XMP packet declaring PDF/A-3B and the Factur-X extension schema.
 *
 * The extension schema block is not decoration: PDF/A requires any non-standard metadata
 * namespace to describe itself, and Factur-X readers use `fx:DocumentFileName` to locate the
 * attachment. Omitting it is a common reason a file "looks fine" but is not recognised.
 */
function buildXmp(invoiceNumber: string, profile = 'BASIC'): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Facture ${invoiceNumber}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>Validateur Factur-X</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>Validateur Factur-X (démonstration)</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>Validateur Factur-X</xmp:CreatorTool>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>Name of the embedded XML invoice file</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>INVOICE</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The version of the standard</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The conformance level of the embedded data</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${profile}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function euro(value: string): string {
  const [whole = '0', cents = '00'] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${cents} €`;
}

function drawInvoicePage(page: PDFPage, invoice: DemoInvoice, font: PDFFont, bold: PDFFont): void {
  const navy = rgb(0.06, 0.12, 0.2);
  const grey = rgb(0.42, 0.46, 0.53);
  const line = rgb(0.85, 0.88, 0.92);
  const { width, height } = page.getSize();
  const M = 50;
  let y = height - M;

  const text = (
    value: string,
    x: number,
    yPos: number,
    size = 9,
    f: PDFFont = font,
    color = navy,
  ) => page.drawText(value, { x, y: yPos, size, font: f, color });

  text('FACTURE', M, y - 6, 22, bold);
  text(invoice.number, width - M - bold.widthOfTextAtSize(invoice.number, 12), y - 4, 12, bold);
  y -= 30;

  const issued = `${invoice.issueDate.slice(6, 8)}/${invoice.issueDate.slice(4, 6)}/${invoice.issueDate.slice(0, 4)}`;
  const due = `${invoice.dueDate.slice(6, 8)}/${invoice.dueDate.slice(4, 6)}/${invoice.dueDate.slice(0, 4)}`;
  text(`Émise le ${issued}  ·  Échéance le ${due}`, M, y, 9, font, grey);
  y -= 28;

  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.7, color: line });
  y -= 22;

  // Parties, side by side.
  const colR = width / 2 + 10;
  text('VENDEUR', M, y, 7.5, bold, grey);
  text('CLIENT', colR, y, 7.5, bold, grey);
  y -= 14;

  const party = (p: DemoInvoice['seller'], x: number, startY: number) => {
    let yy = startY;
    text(p.name, x, yy, 10, bold);
    yy -= 13;
    for (const row of [p.address, `${p.postcode} ${p.city}`, `SIRET ${p.siret}`, `TVA ${p.vat}`]) {
      text(row, x, yy, 8.5, font, grey);
      yy -= 11;
    }
  };
  party(invoice.seller, M, y);
  party(invoice.buyer, colR, y);
  y -= 72;

  // Line table.
  page.drawRectangle({
    x: M,
    y: y - 4,
    width: width - 2 * M,
    height: 18,
    color: rgb(0.95, 0.96, 0.98),
  });
  const colQty = width - M - 210;
  const colPu = width - M - 140;
  const colTot = width - M - 60;
  text('DÉSIGNATION', M + 6, y + 2, 7.5, bold, grey);
  text('QTÉ', colQty, y + 2, 7.5, bold, grey);
  text('P.U. HT', colPu, y + 2, 7.5, bold, grey);
  text('TOTAL HT', colTot, y + 2, 7.5, bold, grey);
  y -= 18;

  for (const item of invoice.lines) {
    text(item.name, M + 6, y, 9);
    text(`${item.quantity} ${item.unitLabel}`, colQty, y, 9);
    text(euro(item.unitPrice), colPu, y, 9);
    text(euro(item.netAmount), colTot, y, 9);
    y -= 16;
    page.drawLine({
      start: { x: M, y: y + 6 },
      end: { x: width - M, y: y + 6 },
      thickness: 0.4,
      color: line,
    });
  }

  y -= 12;
  const totals: Array<[string, string, boolean]> = [
    ['Total HT', euro(invoice.declaredLineTotal), false],
    [`TVA ${invoice.vatRate.replace('.00', '')} %`, euro(invoice.declaredVat), false],
    ['Net à payer', euro(invoice.declaredGrandTotal), true],
  ];
  for (const [label, value, strong] of totals) {
    const f = strong ? bold : font;
    const size = strong ? 11 : 9;
    text(label, colPu, y, size, f);
    text(value, colTot, y, size, f);
    y -= strong ? 18 : 14;
  }

  y -= 10;
  text('Paiement par virement — IBAN FR76 3000 6000 0112 3456 7890 189', M, y, 8.5, font, grey);
  y -= 24;

  // The mentions BR-FR-05 requires, printed and also structured in the XML.
  for (const note of LEGAL_NOTES) {
    text(note.text, M, y, 7.5, font, grey);
    y -= 10;
  }

  page.drawText(
    'Facture électronique au format Factur-X (PDF/A-3 avec XML factur-x.xml intégré).',
    { x: M, y: M - 12, size: 7, font, color: grey },
  );
}

/**
 * Attaches the ICC profile as an OutputIntent.
 *
 * PDF/A requires a device-independent definition of colour. Without an OutputIntent, a file is
 * rejected as non-conforming no matter how correct everything else is.
 */
function addOutputIntent(doc: PDFDocument, icc: Uint8Array): void {
  const iccStream = doc.context.stream(icc, {
    N: PDFNumber.of(3), // sRGB is a three-component space.
  });
  const iccRef = doc.context.register(iccStream);

  const intent = doc.context.obj({
    Type: PDFName.of('OutputIntent'),
    S: PDFName.of('GTS_PDFA1'),
    OutputConditionIdentifier: PDFString.of('sRGB'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: iccRef,
  });

  doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([intent]));
}

function addXmpMetadata(doc: PDFDocument, xmp: string): void {
  const stream = doc.context.stream(xmp, {
    Type: PDFName.of('Metadata'),
    Subtype: PDFName.of('XML'),
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
}

async function buildPdf(invoice: DemoInvoice, xml: string, icc: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const regularPath = firstExisting(FONT_CANDIDATES);
  const boldPath = firstExisting(BOLD_CANDIDATES);
  if (!regularPath || !boldPath) {
    throw new Error(
      `No embeddable TrueType font found. PDF/A forbids the standard 14 fonts, so a real font file is required. Looked in: ${[...FONT_CANDIDATES, ...BOLD_CANDIDATES].join(', ')}`,
    );
  }

  // `subset: false` keeps the embedded font simple; PDF/A only requires that it is embedded.
  const font = await doc.embedFont(readFileSync(regularPath), { subset: false });
  const bold = await doc.embedFont(readFileSync(boldPath), { subset: false });

  const page = doc.addPage([595.28, 841.89]); // A4
  drawInvoicePage(page, invoice, font, bold);

  doc.setTitle(`Facture ${invoice.number}`);
  doc.setProducer('Validateur Factur-X (démonstration)');
  doc.setCreator('Validateur Factur-X');
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  // The attachment name is exact and load-bearing: readers look for `factur-x.xml`.
  await doc.attach(new TextEncoder().encode(xml), 'factur-x.xml', {
    mimeType: 'text/xml',
    description: 'Facture électronique Factur-X',
    creationDate: new Date(),
    modificationDate: new Date(),
    afRelationship: AFRelationship.Data,
  });

  addOutputIntent(doc, icc);
  addXmpMetadata(doc, buildXmp(invoice.number));

  return doc.save();
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const iccPath = process.env.ICC_PROFILE ?? '/tmp/srgb.icc';
  if (!existsSync(iccPath)) {
    throw new Error(
      `sRGB ICC profile not found at ${iccPath}. Generate one with:\n` +
        `  python3 -c "from PIL import ImageCms; open('/tmp/srgb.icc','wb').write(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())"`,
    );
  }
  const icc = new Uint8Array(readFileSync(iccPath));

  // 1. A conforming invoice.
  const validXml = buildCii(BASE);
  writeFileSync(join(OUT_DIR, 'demo-conforme.pdf'), await buildPdf(BASE, validXml, icc));
  writeFileSync(join(OUT_DIR, 'demo-conforme.xml'), validXml);

  // 2. The same invoice with the single most common real-world defect: the declared line total
  //    does not match the sum of the lines (BR-CO-10). The printed page shows the wrong total
  //    too, exactly as a miscalculating billing system would produce.
  const broken: DemoInvoice = {
    ...BASE,
    number: 'FA-2026-0088',
    declaredLineTotal: '1640.00', // third line (90,00 €) omitted from the total
    declaredVat: '328.00',
    declaredGrandTotal: '1968.00',
  };
  const brokenXml = buildCii(broken);
  writeFileSync(join(OUT_DIR, 'demo-erreurs.pdf'), await buildPdf(broken, brokenXml, icc));
  writeFileSync(join(OUT_DIR, 'demo-erreurs.xml'), brokenXml);

  console.log(`Demo invoices written to ${OUT_DIR}`);
  console.log('  demo-conforme.pdf  facture correcte');
  console.log('  demo-erreurs.pdf   total HT ne correspond pas à la somme des lignes (BR-CO-10)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
