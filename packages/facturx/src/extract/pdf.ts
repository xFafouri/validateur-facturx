/**
 * Extraction of the embedded CII XML from a Factur-X PDF/A-3 container.
 *
 * A Factur-X file is a PDF/A-3 whose XML payload is attached as an embedded file named exactly
 * `factur-x.xml`. Readers locate it through the document catalogue's `Names/EmbeddedFiles` name
 * tree, so that is what this walks.
 *
 * This is deliberately tolerant where the specification is strict. A file attached under a
 * legacy or misspelled name is still *findable*, and telling a user "your XML is there but named
 * `ZUGFeRD-invoice.xml` instead of `factur-x.xml`" is far more useful than "no XML found". The
 * strict verdict comes from the Mustang sidecar; this layer's job is to recover the data and
 * explain the discrepancy.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';

/** The only name a conforming Factur-X file may use. */
export const CANONICAL_ATTACHMENT_NAME = 'factur-x.xml';

/**
 * Names seen in the wild that carry the same CII payload.
 *
 * ZUGFeRD 2.x is technically identical to Factur-X, and Order-X reuses the container, so files
 * arriving under these names are readable even though they are not Factur-X-conforming.
 */
const KNOWN_ATTACHMENT_ALIASES = new Set([
  'factur-x.xml',
  'zugferd-invoice.xml',
  'order-x.xml',
  'xrechnung.xml',
  'cii.xml',
]);

export interface PdfAttachment {
  /** Name as recorded in the PDF. */
  readonly name: string;
  readonly bytes: Uint8Array;
  /**
   * The `AFRelationship` value. Factur-X requires `Data`; `Alternative` appears in older files and
   * some generators emit `Source`.
   */
  readonly relationship: string | null;
  readonly description: string | null;
}

export interface PdfAConformance {
  /** The `pdfaid:part` from XMP - 3 for PDF/A-3, which is what Factur-X requires. */
  readonly part: number | null;
  /** The `pdfaid:conformance` level: `A`, `B` or `U`. */
  readonly level: string | null;
}

export interface PdfExtractionResult {
  /** Every embedded file found, in document order. */
  readonly attachments: readonly PdfAttachment[];
  /** The attachment identified as the CII payload, if any. */
  readonly invoiceXml: PdfAttachment | null;
  /** True when the payload was found under exactly `factur-x.xml`. */
  readonly usesCanonicalName: boolean;
  readonly pdfa: PdfAConformance;
  /** Non-fatal observations worth surfacing to the user, in French. */
  readonly warnings: readonly string[];
}

export class PdfExtractionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PdfExtractionError';
  }
}

/** PDF files start with the `%PDF-` header; used to route an upload before parsing it. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d //  -
  );
}

function decodeTextValue(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }
  return null;
}

/**
 * Walks a PDF name tree, following `Kids` recursively.
 *
 * Small documents inline everything under a single `Names` array, but producers are free to split
 * large trees across `Kids` nodes. Handling only the flat case works until it silently doesn't.
 */
function collectNameTreeEntries(
  node: PDFDict | undefined,
  out: Array<[string, PDFDict]>,
  depth = 0,
): void {
  if (!node || depth > 32) return; // Depth cap guards against a maliciously cyclic tree.

  const names = node.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const key = decodeTextValue(names.lookup(i));
      const value = names.lookupMaybe(i + 1, PDFDict);
      if (key !== null && value) out.push([key, value]);
    }
  }

  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i += 1) {
      collectNameTreeEntries(kids.lookupMaybe(i, PDFDict), out, depth + 1);
    }
  }
}

function readAttachment(name: string, filespec: PDFDict): PdfAttachment | null {
  const ef = filespec.lookupMaybe(PDFName.of('EF'), PDFDict);
  if (!ef) return null;

  // `UF` (Unicode) takes precedence over `F` for the display name when both are present.
  const unicodeName = decodeTextValue(filespec.get(PDFName.of('UF')));
  const asciiName = decodeTextValue(filespec.get(PDFName.of('F')));
  const effectiveName = unicodeName ?? asciiName ?? name;

  const relationshipRaw = ef.context ? filespec.get(PDFName.of('AFRelationship')) : undefined;
  const relationship =
    relationshipRaw instanceof PDFName ? relationshipRaw.asString().replace(/^\//, '') : null;

  const stream = ef.lookup(PDFName.of('F')) ?? ef.lookup(PDFName.of('UF'));
  if (!(stream instanceof PDFRawStream)) return null;

  let bytes: Uint8Array;
  try {
    bytes = decodePDFRawStream(stream).decode();
  } catch (error) {
    throw new PdfExtractionError(
      `La pièce jointe « ${effectiveName} » n'a pas pu être décompressée.`,
      error,
    );
  }

  return {
    name: effectiveName,
    bytes,
    relationship,
    description: decodeTextValue(filespec.get(PDFName.of('Desc'))),
  };
}

/**
 * Reads PDF/A identification out of the XMP metadata stream.
 *
 * Parsed with regexes rather than a full RDF parser: only two values are needed, and XMP producers
 * vary enough in namespace prefixes and attribute-vs-element form that targeted matching is more
 * robust here than schema-driven parsing.
 */
function readPdfAConformance(doc: PDFDocument): PdfAConformance {
  try {
    // `lookupMaybe`'s typed overloads do not cover PDFRawStream, so this narrows by hand.
    const metadata = doc.catalog.lookup(PDFName.of('Metadata'));
    if (!(metadata instanceof PDFRawStream)) return { part: null, level: null };

    const xmp = new TextDecoder('utf-8').decode(decodePDFRawStream(metadata).decode());

    const partMatch =
      xmp.match(/pdfaid:part\s*=\s*["'](\d+)["']/i) ??
      xmp.match(/<pdfaid:part>\s*(\d+)\s*<\/pdfaid:part>/i);
    const levelMatch =
      xmp.match(/pdfaid:conformance\s*=\s*["']([A-Za-z])["']/i) ??
      xmp.match(/<pdfaid:conformance>\s*([A-Za-z])\s*<\/pdfaid:conformance>/i);

    return {
      part: partMatch?.[1] ? Number(partMatch[1]) : null,
      level: levelMatch?.[1] ? levelMatch[1].toUpperCase() : null,
    };
  } catch {
    // Metadata is advisory here; its absence must not prevent extracting the invoice.
    return { part: null, level: null };
  }
}

function pickInvoiceAttachment(attachments: readonly PdfAttachment[]): PdfAttachment | null {
  const byName = (target: string) =>
    attachments.find((a) => a.name.toLowerCase() === target) ?? null;

  const canonical = byName(CANONICAL_ATTACHMENT_NAME);
  if (canonical) return canonical;

  const alias = attachments.find((a) => KNOWN_ATTACHMENT_ALIASES.has(a.name.toLowerCase()));
  if (alias) return alias;

  // Last resort: any XML attachment that actually looks like a CII invoice. Prevents an
  // unrelated attached XML (a purchase order, a signature manifest) from being mistaken for one.
  return (
    attachments.find((a) => {
      if (!a.name.toLowerCase().endsWith('.xml')) return false;
      const head = new TextDecoder('utf-8', { fatal: false }).decode(a.bytes.subarray(0, 2048));
      return head.includes('CrossIndustryInvoice');
    }) ?? null
  );
}

/**
 * Extracts embedded files and PDF/A identification from a Factur-X PDF.
 *
 * Throws only when the PDF itself cannot be parsed. A structurally sound PDF with no attachments
 * returns a result with `invoiceXml: null` and an explanatory warning, because that is a
 * validation finding rather than a processing failure.
 */
export async function extractFromPdf(bytes: Uint8Array): Promise<PdfExtractionResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      // Encrypted PDFs still expose their attachment tree; refusing to open them would reject
      // files that are merely password-protected for printing.
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (error) {
    throw new PdfExtractionError(
      "Le fichier PDF n'a pas pu être ouvert : il est peut-être corrompu ou tronqué.",
      error,
    );
  }

  const warnings: string[] = [];

  const namesDict = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embeddedFiles = namesDict?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);

  const entries: Array<[string, PDFDict]> = [];
  collectNameTreeEntries(embeddedFiles, entries);

  const attachments: PdfAttachment[] = [];
  for (const [name, filespec] of entries) {
    const attachment = readAttachment(name, filespec);
    if (attachment) attachments.push(attachment);
  }

  const pdfa = readPdfAConformance(doc);
  const invoiceXml = pickInvoiceAttachment(attachments);
  const usesCanonicalName = invoiceXml?.name.toLowerCase() === CANONICAL_ATTACHMENT_NAME;

  if (attachments.length === 0) {
    warnings.push(
      "Ce PDF ne contient aucun fichier joint. Un PDF classique, même généré par un logiciel de facturation, n'est pas une facture Factur-X : le XML doit être embarqué dans le PDF.",
    );
  } else if (!invoiceXml) {
    warnings.push(
      `Ce PDF contient ${attachments.length} fichier(s) joint(s), mais aucun ne correspond à une facture CII : ${attachments
        .map((a) => `« ${a.name} »`)
        .join(', ')}.`,
    );
  } else if (!usesCanonicalName) {
    warnings.push(
      `Le XML est joint sous le nom « ${invoiceXml.name} » alors que Factur-X impose exactement « ${CANONICAL_ATTACHMENT_NAME} ». De nombreuses plateformes ne trouveront pas la pièce jointe.`,
    );
  }

  if (invoiceXml && invoiceXml.relationship !== 'Data') {
    warnings.push(
      invoiceXml.relationship === null
        ? "La pièce jointe XML ne déclare pas d'attribut AFRelationship. Factur-X impose la valeur « Data »."
        : `La pièce jointe XML déclare AFRelationship « ${invoiceXml.relationship} » au lieu de « Data » exigé par Factur-X.`,
    );
  }

  if (pdfa.part === null) {
    warnings.push(
      "Ce PDF ne déclare aucune conformité PDF/A dans ses métadonnées XMP. Factur-X impose le format PDF/A-3, nécessaire à l'archivage légal.",
    );
  } else if (pdfa.part !== 3) {
    warnings.push(
      `Ce PDF se déclare PDF/A-${pdfa.part} alors que Factur-X impose PDF/A-3, seule version autorisant les fichiers joints.`,
    );
  }

  return { attachments, invoiceXml, usesCanonicalName, pdfa, warnings };
}
