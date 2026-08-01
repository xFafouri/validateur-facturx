/**
 * Assembles the PDF/A-3 carrier: the human-readable page, with the CII XML embedded inside it.
 *
 * Factur-X is one document with two renditions, and the fussy half is this one. The requirements
 * that are easy to miss, each of which alone makes a file non-conforming:
 *
 *   - the XML is attached under exactly `factur-x.xml`, with `AFRelationship /Data`;
 *   - XMP declares `pdfaid:part` 3 and describes the Factur-X extension schema, because PDF/A
 *     requires any non-standard metadata namespace to describe itself;
 *   - an OutputIntent with an embedded ICC profile is present (`icc.ts`);
 *   - every font is embedded - PDF/A does not allow the standard 14.
 *
 * The page itself is deliberately plain. It is a legal rendition of the XML, and anything on it
 * that the XML does not say is a discrepancy between the two.
 */

import { createHash } from 'node:crypto';
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
import { formatFrench, format } from '../money.js';
import { CANONICAL_ATTACHMENT_NAME } from '../extract/pdf.js';
import type { ComputedInvoice } from './compute.js';
import type { InvoiceDraft } from './draft.js';
import { buildSrgbIccProfile } from './icc.js';

export class PdfGenerationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PdfGenerationError';
  }
}

export interface EmbeddedFonts {
  readonly regular: Uint8Array;
  readonly bold: Uint8Array;
}

export interface PdfRenderOptions {
  /**
   * The fonts to embed.
   *
   * Required rather than defaulted: PDF/A forbids the standard 14 fonts, so there is no built-in
   * to fall back on, and silently substituting one would produce a file that fails validation for a
   * reason the caller cannot see. `resolveSystemFonts()` covers the common Linux case.
   */
  readonly fonts: EmbeddedFonts;
  /** Shown as the PDF producer. */
  readonly producer?: string;
  /**
   * Timestamp written into the document.
   *
   * Injectable so that generating the same invoice twice produces identical bytes - which is what
   * lets an archived document be identified by its hash.
   */
  readonly now?: Date;
}

const A4: readonly [number, number] = [595.28, 841.89];
const MARGIN = 50;
/** Space kept clear at the foot of every page for the legal mentions. */
const FOOTER_HEIGHT = 74;

const INK = rgb(0.06, 0.12, 0.2);
const MUTED = rgb(0.42, 0.46, 0.53);
const RULE = rgb(0.85, 0.88, 0.92);
const BAND = rgb(0.95, 0.96, 0.98);

const TYPE_LABELS: Record<string, string> = {
  '380': 'FACTURE',
  '381': 'AVOIR',
  '384': 'FACTURE RECTIFICATIVE',
  '386': "FACTURE D'ACOMPTE",
};

const VAT_CATEGORY_LABELS: Record<string, string> = {
  S: 'TVA',
  Z: 'TVA 0 %',
  E: 'Exonéré',
  AE: 'Autoliquidation',
  K: 'Livraison intracommunautaire',
  G: 'Exportation',
};

/** French short date: `2026-09-03` becomes `03/09/2026`. */
function frenchDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return day && month && year ? `${day}/${month}/${year}` : iso;
}

/** Trims `20.00` to `20` and `5.50` to `5,5` for display. */
function ratePercent(value: string): string {
  const trimmed = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return trimmed.replace('.', ',');
}

interface Cursor {
  page: PDFPage;
  y: number;
}

class Renderer {
  private readonly pages: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {}

  get allPages(): readonly PDFPage[] {
    return this.pages;
  }

  newPage(): Cursor {
    const page = this.doc.addPage([...A4] as [number, number]);
    this.pages.push(page);
    return { page, y: A4[1] - MARGIN };
  }

  text(
    cursor: Cursor,
    value: string,
    x: number,
    size = 9,
    options: { bold?: boolean; color?: ReturnType<typeof rgb>; y?: number } = {},
  ): void {
    cursor.page.drawText(value, {
      x,
      y: options.y ?? cursor.y,
      size,
      font: options.bold ? this.bold : this.font,
      color: options.color ?? INK,
    });
  }

  /** Right-aligns against `right`, which is what a column of amounts needs. */
  textRight(
    cursor: Cursor,
    value: string,
    right: number,
    size = 9,
    options: { bold?: boolean; color?: ReturnType<typeof rgb>; y?: number } = {},
  ): void {
    const font = options.bold ? this.bold : this.font;
    this.text(cursor, value, right - font.widthOfTextAtSize(value, size), size, options);
  }

  rule(cursor: Cursor, y: number, thickness = 0.4): void {
    cursor.page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4[0] - MARGIN, y },
      thickness,
      color: RULE,
    });
  }

  /**
   * Breaks a string to fit a column.
   *
   * Product descriptions come from users and are routinely longer than the column. Without
   * wrapping they run under the amounts and off the page - the amounts being the part of an invoice
   * that must never be ambiguous.
   */
  wrap(value: string, maxWidth: number, size: number, bold = false): string[] {
    const font = bold ? this.bold : this.font;
    const words = value.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
  }
}

function drawHeader(
  renderer: Renderer,
  cursor: Cursor,
  draft: InvoiceDraft,
  continuation: boolean,
): void {
  const title = TYPE_LABELS[draft.typeCode ?? '380'] ?? 'FACTURE';
  const right = A4[0] - MARGIN;

  renderer.text(cursor, title, MARGIN, 22, { bold: true, y: cursor.y - 6 });
  renderer.textRight(cursor, draft.invoiceNumber, right, 12, { bold: true, y: cursor.y - 4 });
  cursor.y -= 30;

  const dates = draft.dueDate
    ? `Émise le ${frenchDate(draft.issueDate)}  ·  Échéance le ${frenchDate(draft.dueDate)}`
    : `Émise le ${frenchDate(draft.issueDate)}`;
  renderer.text(cursor, continuation ? `${dates}  ·  suite` : dates, MARGIN, 9, { color: MUTED });
  cursor.y -= 20;

  renderer.rule(cursor, cursor.y, 0.7);
  cursor.y -= 22;
}

function drawParties(renderer: Renderer, cursor: Cursor, draft: InvoiceDraft): void {
  const columnRight = A4[0] / 2 + 10;

  renderer.text(cursor, 'VENDEUR', MARGIN, 7.5, { bold: true, color: MUTED });
  renderer.text(cursor, 'CLIENT', columnRight, 7.5, { bold: true, color: MUTED });
  cursor.y -= 14;

  const block = (party: InvoiceDraft['seller'], x: number): number => {
    let y = cursor.y;
    renderer.text(cursor, party.name, x, 10, { bold: true, y });
    y -= 13;
    const rows = [
      party.address.line1,
      party.address.line2,
      `${party.address.postcode ?? ''} ${party.address.city ?? ''}`.trim(),
      party.siret ? `SIRET ${party.siret}` : null,
      party.vatId ? `TVA ${party.vatId}` : null,
    ].filter((row): row is string => Boolean(row));

    for (const row of rows) {
      renderer.text(cursor, row, x, 8.5, { color: MUTED, y });
      y -= 11;
    }
    return y;
  };

  const sellerBottom = block(draft.seller, MARGIN);
  const buyerBottom = block(draft.buyer, columnRight);
  cursor.y = Math.min(sellerBottom, buyerBottom) - 10;

  const references = [
    draft.buyerReference ? `Référence acheteur : ${draft.buyerReference}` : null,
    draft.purchaseOrderReference ? `Bon de commande : ${draft.purchaseOrderReference}` : null,
  ].filter((row): row is string => Boolean(row));

  for (const reference of references) {
    renderer.text(cursor, reference, MARGIN, 8.5, { color: MUTED });
    cursor.y -= 11;
  }
  if (references.length > 0) cursor.y -= 6;
}

interface Columns {
  readonly description: number;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly vat: number;
  readonly total: number;
}

const COLUMNS: Columns = {
  description: MARGIN + 6,
  quantity: A4[0] - MARGIN - 250,
  unitPrice: A4[0] - MARGIN - 185,
  vat: A4[0] - MARGIN - 110,
  total: A4[0] - MARGIN - 6,
};

function drawTableHead(renderer: Renderer, cursor: Cursor): void {
  cursor.page.drawRectangle({
    x: MARGIN,
    y: cursor.y - 4,
    width: A4[0] - 2 * MARGIN,
    height: 18,
    color: BAND,
  });
  renderer.text(cursor, 'DÉSIGNATION', COLUMNS.description, 7.5, {
    bold: true,
    color: MUTED,
    y: cursor.y + 2,
  });
  renderer.textRight(cursor, 'QTÉ', COLUMNS.quantity, 7.5, {
    bold: true,
    color: MUTED,
    y: cursor.y + 2,
  });
  renderer.textRight(cursor, 'P.U. HT', COLUMNS.unitPrice, 7.5, {
    bold: true,
    color: MUTED,
    y: cursor.y + 2,
  });
  renderer.textRight(cursor, 'TVA', COLUMNS.vat, 7.5, {
    bold: true,
    color: MUTED,
    y: cursor.y + 2,
  });
  renderer.textRight(cursor, 'TOTAL HT', COLUMNS.total, 7.5, {
    bold: true,
    color: MUTED,
    y: cursor.y + 2,
  });
  cursor.y -= 18;
}

function drawLines(
  renderer: Renderer,
  cursor: Cursor,
  draft: InvoiceDraft,
  computed: ComputedInvoice,
  currency: string,
): Cursor {
  let current = cursor;
  drawTableHead(renderer, current);

  const descriptionWidth = COLUMNS.quantity - COLUMNS.description - 40;

  for (const line of computed.lines) {
    const nameLines = renderer.wrap(line.source.name, descriptionWidth, 9);
    const descriptionLines = line.source.description
      ? renderer.wrap(line.source.description, descriptionWidth, 7.5)
      : [];
    const height = nameLines.length * 11 + descriptionLines.length * 9 + 7;

    // Break before drawing, never mid-row: a line item split across a page boundary is how a
    // quantity ends up on one page and its amount on another.
    if (current.y - height < MARGIN + FOOTER_HEIGHT) {
      current = renderer.newPage();
      drawHeader(renderer, current, draft, true);
      drawTableHead(renderer, current);
    }

    const top = current.y;
    let y = top;
    for (const text of nameLines) {
      renderer.text(current, text, COLUMNS.description, 9, { y });
      y -= 11;
    }
    for (const text of descriptionLines) {
      renderer.text(current, text, COLUMNS.description, 7.5, { color: MUTED, y });
      y -= 9;
    }

    const unit = line.source.unitCode === 'HUR' ? 'h' : line.source.unitCode === 'C62' ? 'u' : '';
    renderer.textRight(current, `${format(line.quantity)} ${unit}`.trim(), COLUMNS.quantity, 9, {
      y: top,
    });
    renderer.textRight(current, formatFrench(line.unitPrice, currency), COLUMNS.unitPrice, 9, {
      y: top,
    });
    renderer.textRight(
      current,
      line.vatCategory === 'S'
        ? `${ratePercent(format(line.vatRatePercent))} %`
        : (VAT_CATEGORY_LABELS[line.vatCategory] ?? line.vatCategory),
      COLUMNS.vat,
      line.vatCategory === 'S' ? 9 : 7,
      { y: top },
    );
    renderer.textRight(current, formatFrench(line.netAmount, currency), COLUMNS.total, 9, {
      y: top,
    });

    current.y = y - 7;
    renderer.rule(current, current.y + 6);
  }

  return current;
}

function drawTotals(
  renderer: Renderer,
  cursor: Cursor,
  draft: InvoiceDraft,
  computed: ComputedInvoice,
  currency: string,
): Cursor {
  const { totals, taxGroups } = computed;
  const rows: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: 'Total HT', value: formatFrench(totals.lineTotalAmount, currency) },
    ...taxGroups.map((group) => ({
      label:
        group.categoryCode === 'S'
          ? `TVA ${ratePercent(format(group.ratePercent))} %`
          : (VAT_CATEGORY_LABELS[group.categoryCode] ?? group.categoryCode),
      value: formatFrench(group.calculatedAmount, currency),
    })),
    { label: 'Total TTC', value: formatFrench(totals.grandTotalAmount, currency) },
    ...(totals.prepaidAmount.value !== 0n
      ? [{ label: 'Acompte déjà versé', value: formatFrench(totals.prepaidAmount, currency) }]
      : []),
    { label: 'Net à payer', value: formatFrench(totals.duePayableAmount, currency), strong: true },
  ];

  const height = rows.length * 15 + 30;
  let current = cursor;
  if (current.y - height < MARGIN + FOOTER_HEIGHT) {
    current = renderer.newPage();
    drawHeader(renderer, current, draft, true);
  }

  current.y -= 12;
  for (const row of rows) {
    const size = row.strong ? 11 : 9;
    renderer.textRight(current, row.label, COLUMNS.vat, size, { bold: row.strong });
    renderer.textRight(current, row.value, COLUMNS.total, size, { bold: row.strong });
    current.y -= row.strong ? 18 : 14;
  }

  // The exemption reason belongs on the page as well as in the XML: it is the sentence a tax
  // inspector looks for, and BT-120 is not visible to a human reading the PDF.
  const reasons = [...new Set(taxGroups.map((group) => group.exemptionReason).filter(Boolean))];
  for (const reason of reasons) {
    current.y -= 4;
    renderer.text(current, reason as string, MARGIN, 8, { color: MUTED });
    current.y -= 11;
  }

  current.y -= 8;
  if (draft.iban) {
    renderer.text(
      current,
      `Paiement par virement — IBAN ${draft.iban.replace(/(.{4})/g, '$1 ').trim()}`,
      MARGIN,
      8.5,
      { color: MUTED },
    );
    current.y -= 11;
  }
  if (draft.paymentTerms) {
    renderer.text(current, draft.paymentTerms, MARGIN, 8.5, { color: MUTED });
    current.y -= 11;
  }

  return current;
}

/** The mandatory mentions, on every page's foot so they survive a page being read alone. */
function drawFooters(renderer: Renderer, notes: readonly string[]): void {
  const pages = renderer.allPages;
  pages.forEach((page, index) => {
    const cursor: Cursor = { page, y: MARGIN + FOOTER_HEIGHT - 24 };
    for (const note of notes) {
      renderer.text(cursor, note, MARGIN, 7, { color: MUTED });
      cursor.y -= 9;
    }
    renderer.text(
      cursor,
      'Facture électronique au format Factur-X (PDF/A-3, XML factur-x.xml intégré).',
      MARGIN,
      7,
      { color: MUTED, y: MARGIN - 12 },
    );
    if (pages.length > 1) {
      renderer.textRight(cursor, `Page ${index + 1} / ${pages.length}`, A4[0] - MARGIN, 7, {
        color: MUTED,
        y: MARGIN - 12,
      });
    }
  });
}

/**
 * XMP packet declaring PDF/A-3B and the Factur-X extension schema.
 *
 * The extension schema block is not decoration. PDF/A requires every non-standard metadata
 * namespace used in a document to describe its own properties, and Factur-X readers use
 * `fx:DocumentFileName` to find the attachment. Omitting it is a common reason a file "looks fine"
 * but is not recognised as an e-invoice.
 */
function buildXmp(title: string, producer: string, profile: string, timestamp: string): string {
  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escape(title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${escape(producer)}</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${escape(producer)}</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${escape(producer)}</xmp:CreatorTool>
      <xmp:CreateDate>${timestamp}</xmp:CreateDate>
      <xmp:ModifyDate>${timestamp}</xmp:ModifyDate>
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
      <fx:DocumentFileName>${CANONICAL_ATTACHMENT_NAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${profile}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Attaches the ICC profile as an OutputIntent.
 *
 * PDF/A requires a device-independent definition of colour; without an OutputIntent the file is
 * non-conforming regardless of what colours it actually uses.
 */
function addOutputIntent(doc: PDFDocument, icc: Uint8Array): void {
  const iccStream = doc.context.stream(icc, { N: PDFNumber.of(3) }); // sRGB has three components.
  const intent = doc.context.obj({
    Type: PDFName.of('OutputIntent'),
    S: PDFName.of('GTS_PDFA1'),
    OutputConditionIdentifier: PDFString.of('sRGB'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: doc.context.register(iccStream),
  });
  doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([intent]));
}

/**
 * Writes the file identifier into the trailer.
 *
 * ISO 19005-3 clause 6.1.3 requires it, and pdf-lib does not emit one - which makes every file it
 * produces fail PDF/A validation on that clause alone, with no visible symptom in any ordinary PDF
 * reader. Found by putting a generated invoice through our own engine.
 *
 * The identifier is derived from the document's own content rather than randomly, so regenerating
 * an unchanged invoice yields identical bytes. The two entries are equal because this is the file's
 * first version; a later revision would keep the first and replace the second.
 */
function addFileIdentifier(doc: PDFDocument, seed: string): void {
  const digest = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  const id = PDFHexString.of(digest);
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);
}

function addXmpMetadata(doc: PDFDocument, xmp: string): void {
  const stream = doc.context.stream(xmp, {
    Type: PDFName.of('Metadata'),
    Subtype: PDFName.of('XML'),
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
}

/** Renders the invoice and returns the finished PDF/A-3 bytes with the XML embedded. */
export async function renderPdfA3(
  draft: InvoiceDraft,
  computed: ComputedInvoice,
  xml: string,
  options: PdfRenderOptions,
): Promise<Uint8Array> {
  const currency = draft.currency ?? 'EUR';
  const producer = options.producer ?? 'Factur-X';
  const now = options.now ?? new Date();

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  let font: PDFFont;
  let bold: PDFFont;
  try {
    // `subset: false` keeps the embedded font straightforward; PDF/A only requires embedding.
    font = await doc.embedFont(options.fonts.regular, { subset: false });
    bold = await doc.embedFont(options.fonts.bold, { subset: false });
  } catch (error) {
    throw new PdfGenerationError(
      "La police fournie n'a pas pu être intégrée au PDF. PDF/A exige une police TrueType ou OpenType intégrable.",
      error,
    );
  }

  const renderer = new Renderer(doc, font, bold);
  let cursor = renderer.newPage();
  drawHeader(renderer, cursor, draft, false);
  drawParties(renderer, cursor, draft);
  cursor = drawLines(renderer, cursor, draft, computed, currency);
  cursor = drawTotals(renderer, cursor, draft, computed, currency);
  drawFooters(renderer, draft.notes ?? []);

  const title = `${TYPE_LABELS[draft.typeCode ?? '380'] ?? 'Facture'} ${draft.invoiceNumber}`;
  doc.setTitle(title);
  doc.setProducer(producer);
  doc.setCreator(producer);
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  doc.setLanguage('fr-FR');

  // The name is exact and load-bearing: readers look for `factur-x.xml` and nothing else.
  await doc.attach(new TextEncoder().encode(xml), CANONICAL_ATTACHMENT_NAME, {
    mimeType: 'text/xml',
    description: 'Facture électronique Factur-X',
    creationDate: now,
    modificationDate: now,
    afRelationship: AFRelationship.Data,
  });

  addOutputIntent(doc, buildSrgbIccProfile());
  addXmpMetadata(
    doc,
    buildXmp(title, producer, 'BASIC', now.toISOString().replace(/\.\d+Z$/, 'Z')),
  );
  addFileIdentifier(doc, `${draft.invoiceNumber}|${now.toISOString()}|${xml}`);

  return doc.save();
}
