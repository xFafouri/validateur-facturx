/**
 * Generates the demonstration invoices used for demos and manual testing.
 *
 * This was the first sketch of the Phase 1 generator; now that the generator exists, the script is
 * a thin caller of it. That is the point: the demo files are produced by exactly the code path a
 * customer's invoice goes through, so a defect in generation shows up in the demo rather than
 * hiding behind a bespoke script that happens to get it right.
 *
 * Run: pnpm --filter @facturx/core demo
 *
 * Output lands in `test/corpus/demo/`. These are our own documents, not official samples; the
 * fetched corpus in `test/corpus/vendor/` is what provides independent verification.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeInvoice } from '../src/generate/compute.js';
import type { InvoiceDraft } from '../src/generate/draft.js';
import { resolveSystemFonts } from '../src/generate/fonts.js';
import { generateFacturX } from '../src/generate/index.js';
import { renderPdfA3 } from '../src/generate/pdf.js';
import { serialiseCii } from '../src/generate/cii.js';
import { parseDecimal, rescale, MONETARY_SCALE } from '../src/money.js';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'corpus', 'demo');

/** Fixed, so re-running the script produces identical files and leaves a clean diff. */
const ISSUED_AT = new Date('2026-09-03T09:00:00.000Z');

/** A plausible French B2B invoice: a plumber billing a bakery in Lyon. */
const DEMO: InvoiceDraft = {
  invoiceNumber: 'FA-2026-0087',
  typeCode: '380',
  issueDate: '2026-09-03',
  dueDate: '2026-10-03',
  currency: 'EUR',
  buyerReference: 'SERVICE-ACHATS',
  seller: {
    name: 'Plomberie Diderot SARL',
    // Identifiers are consistent: the SIRET passes the Luhn check and the VAT number carries the
    // key computed from its SIREN. The generator refuses a draft where they disagree.
    siret: '55208131700018',
    vatId: 'FR03552081317',
    address: { line1: '14 rue Diderot', postcode: '69001', city: 'Lyon', countryCode: 'FR' },
  },
  buyer: {
    name: 'Boulangerie Martin SAS',
    siret: '44306184100005',
    vatId: 'FR64443061841',
    address: {
      line1: '12 rue de la République',
      postcode: '69002',
      city: 'Lyon',
      countryCode: 'FR',
    },
  },
  lines: [
    {
      name: 'Remplacement chauffe-eau 200 L',
      quantity: '1',
      unitCode: 'C62',
      unitPrice: '1250.00',
      vatCategory: 'S',
      vatRatePercent: '20.00',
    },
    {
      name: "Main-d'œuvre installation",
      quantity: '6',
      unitCode: 'HUR',
      unitPrice: '65.00',
      vatCategory: 'S',
      vatRatePercent: '20.00',
    },
    {
      name: 'Déplacement et mise en service',
      quantity: '1',
      unitCode: 'C62',
      unitPrice: '90.00',
      vatCategory: 'S',
      vatRatePercent: '20.00',
    },
  ],
  paymentMeansCode: '30',
  iban: 'FR7630006000011234567890189',
};

const amount = (value: string) => rescale(parseDecimal(value)!, MONETARY_SCALE);

/**
 * Builds the deliberately broken variant.
 *
 * The generator cannot produce this: it derives totals from the lines, so the declared total and
 * the sum of the lines can never disagree. The defect has to be injected afterwards - which is
 * itself the argument for deriving them. Here the third line (90,00 €) is dropped from the
 * declared totals while the lines stay intact, exactly as a billing system that recomputes totals
 * separately would produce, and the printed page shows the wrong figures too.
 */
async function buildBroken(fonts: ReturnType<typeof resolveSystemFonts>): Promise<{
  xml: string;
  pdf: Uint8Array;
}> {
  const draft: InvoiceDraft = { ...DEMO, invoiceNumber: 'FA-2026-0088' };
  const correct = computeInvoice(draft);

  const broken = {
    ...correct,
    taxGroups: correct.taxGroups.map((group) => ({
      ...group,
      basisAmount: amount('1640.00'),
      calculatedAmount: amount('328.00'),
    })),
    totals: {
      ...correct.totals,
      lineTotalAmount: amount('1640.00'),
      taxBasisTotalAmount: amount('1640.00'),
      taxTotalAmount: amount('328.00'),
      grandTotalAmount: amount('1968.00'),
      duePayableAmount: amount('1968.00'),
    },
  };

  const xml = serialiseCii(draft, broken);
  return { xml, pdf: await renderPdfA3(draft, broken, xml, { fonts, now: ISSUED_AT }) };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const fonts = resolveSystemFonts();

  const conforme = await generateFacturX(DEMO, { fonts, now: ISSUED_AT });
  writeFileSync(join(OUT_DIR, 'demo-conforme.pdf'), conforme.pdf);
  writeFileSync(join(OUT_DIR, 'demo-conforme.xml'), conforme.xml);

  const erreurs = await buildBroken(fonts);
  writeFileSync(join(OUT_DIR, 'demo-erreurs.pdf'), erreurs.pdf);
  writeFileSync(join(OUT_DIR, 'demo-erreurs.xml'), erreurs.xml);

  console.log(`Demo invoices written to ${OUT_DIR}`);
  console.log('  demo-conforme.pdf  facture correcte');
  console.log('  demo-erreurs.pdf   total HT ne correspond pas à la somme des lignes (BR-CO-10)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
