/**
 * Receiving an invoice, end to end against a real Postgres and the real engine.
 *
 * The test that matters most here is the one asserting a **non-conforming invoice is stored**.
 * Issuance refuses to record what it cannot verify; reception must do the opposite, because the
 * document already exists and is already ours to file. Getting that backwards would mean the
 * broken invoice - the one an accountant most needs to see - is the one that silently vanishes.
 *
 * Skipped when Postgres, the sidecar or system fonts are unavailable:
 *
 *   docker compose up -d postgres validator
 *   pnpm --filter @facturx/db migrate:deploy
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  MustangEngine,
  generateCiiXml,
  generateFacturX,
  resolveSystemFonts,
  systemFontsAvailable,
  type InvoiceDraft,
} from '@facturx/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArchivingService } from '../src/archiving/archiving.service';
import { FilesystemArtifactStore } from '../src/archiving/stores/filesystem.store';
import { IssuanceService, type IssueDraft } from '../src/invoicing/issuance.service';
import {
  ReceptionService,
  UnreadableDocumentError,
  UnroutableInvoiceError,
} from '../src/invoicing/reception.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://facturx:facturx_dev_only@localhost:5432/facturx';
const VALIDATOR_URL = process.env.VALIDATOR_URL ?? 'http://127.0.0.1:8081';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const databaseUp = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const engineUp = (await new MustangEngine({ baseUrl: VALIDATOR_URL }).health()).ok;
const fontsUp = systemFontsAvailable();
const ready = databaseUp && engineUp && fontsUp;

if (!ready) {
  console.warn(`[reception] skipping: database=${databaseUp} engine=${engineUp} fonts=${fontsUp}.`);
}

const suite = describe.skipIf(!ready);

/** The business receiving the invoices; the buyer on every fixture below. */
const CLIENT = {
  name: 'Plomberie Diderot SARL',
  siren: '552081317',
  siret: '55208131700018',
  vatNumber: 'FR03552081317',
};

let archiveRoot: string;
let archiving: ArchivingService;
let reception: ReceptionService;
let issuance: IssuanceService;
let tenantId: string;
let clientOrgId: string;
let supplierOrgId: string;

const RECEIVED_AT = new Date('2026-09-15T09:00:00.000Z');

/**
 * A supplier's invoice addressed to our client business.
 *
 * Generated rather than hand-written so it is a genuine Factur-X document, and so the buyer
 * carries the identifiers routing depends on.
 */
function supplierDraft(invoiceNumber: string, override: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    invoiceNumber,
    typeCode: '380',
    issueDate: '2026-09-10',
    dueDate: '2026-10-10',
    currency: 'EUR',
    paymentMeansCode: '30',
    iban: 'FR7630006000011234567890189',
    seller: {
      name: 'Fournitures Rhône SAS',
      siret: '44306184100005',
      vatId: 'FR64443061841',
      address: {
        line1: '5 quai Perrache',
        postcode: '69002',
        city: 'Lyon',
        countryCode: 'FR',
      },
    },
    buyer: {
      name: CLIENT.name,
      siret: CLIENT.siret,
      vatId: CLIENT.vatNumber,
      address: {
        line1: '14 rue Diderot',
        postcode: '69001',
        city: 'Lyon',
        countryCode: 'FR',
      },
    },
    lines: [
      {
        name: 'Robinetterie sanitaire',
        quantity: '4',
        unitCode: 'C62',
        unitPrice: '62.50',
        vatCategory: 'S',
        vatRatePercent: '20.00',
      },
    ],
    ...override,
  };
}

const xmlBytes = (draft: InvoiceDraft): Uint8Array =>
  new TextEncoder().encode(generateCiiXml(draft));

/**
 * A supplier invoice whose declared line total disagrees with its lines.
 *
 * BR-CO-10, the commonest real rejection. Produced by corrupting a generated document, so
 * everything else about it - including the buyer identifiers - stays valid.
 */
function brokenTotalBytes(invoiceNumber: string): Uint8Array {
  const xml = generateCiiXml(supplierDraft(invoiceNumber));
  const corrupted = xml.replace(
    '<ram:LineTotalAmount>250.00</ram:LineTotalAmount>',
    '<ram:LineTotalAmount>249.00</ram:LineTotalAmount>',
  );
  expect(corrupted, 'fixture must actually be corrupted').not.toBe(xml);
  return new TextEncoder().encode(corrupted);
}

beforeAll(async () => {
  if (!ready) return;

  archiveRoot = await mkdtemp(join(tmpdir(), 'facturx-reception-'));
  const engine = new MustangEngine({ baseUrl: VALIDATOR_URL });
  archiving = new ArchivingService(
    prisma as unknown as PrismaService,
    new FilesystemArtifactStore(archiveRoot),
  );
  reception = new ReceptionService(prisma as unknown as PrismaService, archiving, engine);
  issuance = new IssuanceService(prisma as unknown as PrismaService, archiving, engine);

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Cabinet Réception',
      clientOrgs: {
        create: [
          {
            ...CLIENT,
            addressLine1: '14 rue Diderot',
            postcode: '69001',
            city: 'Lyon',
            countryCode: 'FR',
          },
          // The supplier on every fixture below, also managed by this cabinet. That is the
          // ordinary accountant case, and it is what makes one PDF two invoices.
          {
            name: 'Fournitures Rhône SAS',
            siren: '443061841',
            siret: '44306184100005',
            vatNumber: 'FR64443061841',
            addressLine1: '5 quai Perrache',
            postcode: '69002',
            city: 'Lyon',
            countryCode: 'FR',
          },
        ],
      },
    },
    include: { clientOrgs: true },
  });

  tenantId = tenant.id;
  clientOrgId = tenant.clientOrgs.find((org) => org.siren === CLIENT.siren)!.id;
  supplierOrgId = tenant.clientOrgs.find((org) => org.siren === '443061841')!.id;
});

afterAll(async () => {
  if (ready) {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await rm(archiveRoot, { recursive: true, force: true });
  }
  await prisma.$disconnect();
});

suite('receiving a conforming invoice', () => {
  it('records it against the right client business and seals the bytes', async () => {
    const bytes = xmlBytes(supplierDraft('FR-2026-0001'));
    const result = await reception.receive({
      tenantId,
      bytes,
      filename: 'fournisseur.xml',
      now: RECEIVED_AT,
    });

    expect(result.conforme).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.clientOrgId).toBe(clientOrgId);
    expect(result.supplierName).toBe('Fournitures Rhône SAS');

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: { lines: true, taxBreakdown: true, archiveEntries: true, seller: true, buyer: true },
    });

    expect(invoice.direction).toBe('RECEIVED');
    expect(invoice.state).toBe('DELIVERED');
    expect(invoice.lastValidationValid).toBe(true);
    expect(invoice.receivedAt?.toISOString()).toBe(RECEIVED_AT.toISOString());
    expect(invoice.sourceChannel).toBe('upload');
    // The supplier's SIREN, denormalised so uniqueness can be enforced per supplier.
    expect(invoice.counterpartyLegalId).toBe('443061841');
    expect(invoice.seller.name).toBe('Fournitures Rhône SAS');
    expect(invoice.buyer.name).toBe(CLIENT.name);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.grandTotalAmount?.toString()).toBe('300');

    // The archived bytes are the ones that arrived, unmodified.
    expect(invoice.archiveEntries).toHaveLength(1);
    expect(invoice.archiveEntries[0]!.contentHash).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(invoice.archiveEntries[0]!.artifactKind).toBe('cii-xml');
  });

  it('records a lifecycle status and an audit entry', async () => {
    const result = await reception.receive({
      tenantId,
      bytes: xmlBytes(supplierDraft('FR-2026-0002')),
      filename: 'f.xml',
      actorUserId: null,
      now: RECEIVED_AT,
    });

    const statuses = await prisma.lifecycleStatus.findMany({
      where: { invoiceId: result.invoiceId },
    });
    expect(statuses[0]?.code).toBe('RECEIVED');
    expect(statuses[0]?.source).toBe('INTERNAL');

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId, action: 'invoice.received', entityId: result.invoiceId },
    });
    expect(audit).not.toBeNull();
  });

  it('accepts a Factur-X PDF and seals it as one', async () => {
    const generated = await generateFacturX(supplierDraft('FR-2026-0003'), {
      fonts: resolveSystemFonts(),
      now: RECEIVED_AT,
    });

    const result = await reception.receive({
      tenantId,
      bytes: generated.pdf,
      filename: 'fournisseur.pdf',
      now: RECEIVED_AT,
    });

    expect(result.conforme).toBe(true);
    const entry = await prisma.archiveEntry.findFirstOrThrow({
      where: { invoiceId: result.invoiceId },
    });
    expect(entry.artifactKind).toBe('facturx-pdf');
    expect(entry.mimeType).toBe('application/pdf');
  });
});

/**
 * The asymmetry with issuance, stated as a test.
 *
 * If this ever starts failing by refusing the document, the product has stopped being able to do
 * the one thing every French business is obliged to do from 1 September 2026.
 */
suite('receiving a non-conforming invoice', () => {
  it('records it rather than refusing it, and says what is wrong', async () => {
    const result = await reception.receive({
      tenantId,
      bytes: brokenTotalBytes('FR-2026-0010'),
      filename: 'cassee.xml',
      now: RECEIVED_AT,
    });

    expect(result.conforme).toBe(false);
    expect(result.verdict).toBe('non-conforme');
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.ruleIds).toContain('BR-CO-10');

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: { archiveEntries: true },
    });

    // Stored, and stored as delivered - not as REJECTED. Rejecting a supplier's invoice is a
    // business decision with its own lifecycle status, not something to infer from Schematron.
    expect(invoice.state).toBe('DELIVERED');
    expect(invoice.lastValidationValid).toBe(false);
    expect(invoice.validationErrorCount).toBeGreaterThan(0);
    expect(invoice.validationRuleIds).toContain('BR-CO-10');

    // The non-conforming original is archived too: it is the evidence of what the supplier sent.
    expect(invoice.archiveEntries).toHaveLength(1);
  });
});

suite('refusals', () => {
  it('refuses an invoice addressed to a business this tenant does not manage', async () => {
    const draft = supplierDraft('FR-2026-0020', {
      buyer: {
        name: 'Une Autre Société SAS',
        // Checksum-valid, and deliberately not one of our client businesses.
        siret: '39006335200004',
        address: {
          line1: '1 rue Ailleurs',
          postcode: '75001',
          city: 'Paris',
          countryCode: 'FR',
        },
      },
    });

    await expect(
      reception.receive({ tenantId, bytes: xmlBytes(draft), filename: 'x.xml', now: RECEIVED_AT }),
    ).rejects.toBeInstanceOf(UnroutableInvoiceError);

    // Nothing written: a misrouted invoice must not land in someone's books.
    expect(await prisma.invoice.count({ where: { tenantId, invoiceNumber: 'FR-2026-0020' } })).toBe(
      0,
    );
  });

  it('refuses a file that is not an invoice at all', async () => {
    await expect(
      reception.receive({
        tenantId,
        bytes: new TextEncoder().encode('bonjour, ceci est un mot'),
        filename: 'note.txt',
        now: RECEIVED_AT,
      }),
    ).rejects.toBeInstanceOf(UnreadableDocumentError);
  });
});

suite('duplicates and numbering', () => {
  it('is idempotent: the same document twice is one invoice', async () => {
    const bytes = xmlBytes(supplierDraft('FR-2026-0030'));

    const first = await reception.receive({
      tenantId,
      bytes,
      filename: 'a.xml',
      now: RECEIVED_AT,
    });
    const second = await reception.receive({
      tenantId,
      bytes,
      filename: 'a-encore.xml',
      now: RECEIVED_AT,
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.invoiceId).toBe(first.invoiceId);
    expect(await prisma.invoice.count({ where: { tenantId, invoiceNumber: 'FR-2026-0030' } })).toBe(
      1,
    );
  });

  /**
   * The constraint this replaced spanned `(clientOrgId, direction, invoiceNumber)`, which made
   * two suppliers using the same number a database error. Suppliers number their own invoices;
   * `FA-2026-001` from two of them is entirely ordinary.
   */
  it('accepts the same invoice number from two different suppliers', async () => {
    const shared = 'FA-2026-001';

    const first = await reception.receive({
      tenantId,
      bytes: xmlBytes(supplierDraft(shared)),
      filename: 'un.xml',
      now: RECEIVED_AT,
    });

    const other = supplierDraft(shared, {
      seller: {
        name: 'Autre Fournisseur SARL',
        siret: '39012670400001',
        vatId: 'FR46390126704',
        address: {
          line1: '2 rue Neuve',
          postcode: '75002',
          city: 'Paris',
          countryCode: 'FR',
        },
      },
    });
    const second = await reception.receive({
      tenantId,
      bytes: xmlBytes(other),
      filename: 'deux.xml',
      now: RECEIVED_AT,
    });

    expect(second.invoiceId).not.toBe(first.invoiceId);
    expect(second.duplicate).toBe(false);
    expect(await prisma.invoice.count({ where: { tenantId, invoiceNumber: shared } })).toBe(2);
  });

  /** The same supplier reusing a number is a different matter, and the index catches it. */
  it('refuses the same number twice from one supplier', async () => {
    const number = 'FA-2026-777';
    await reception.receive({
      tenantId,
      bytes: xmlBytes(supplierDraft(number)),
      filename: 'un.xml',
      now: RECEIVED_AT,
    });

    // Same supplier, same number, different content - so hash deduplication does not apply and
    // the partial unique index is what has to refuse it.
    const varied = supplierDraft(number, { buyerReference: 'AUTRE-REF' });
    await expect(
      reception.receive({
        tenantId,
        bytes: xmlBytes(varied),
        filename: 'deux.xml',
        now: RECEIVED_AT,
      }),
    ).rejects.toThrow();
  });
});

/**
 * One cabinet, both sides of the trade.
 *
 * `Fournitures Rhône` invoices `Plomberie Diderot`, and this tenant manages both. The identical
 * PDF is therefore two invoices - a receivable for one business and a payable for the other - and
 * both are entitled to their own sealed artifact and their own ten-year retention.
 *
 * This is the case the archive's old `(tenantId, contentHash)` uniqueness got wrong. `seal` found
 * the issuer's entry and returned it, so the received invoice was written with no artifact at all:
 * its download 404ed, and receiving it a second time hit the invoice-number index as a 500 instead
 * of being recognised as a redelivery.
 */
suite('intercompany: the same document on both sides', () => {
  it('files a payable for the buyer, with its own archive entry', async () => {
    const issued = await issuance.issue({
      tenantId,
      clientOrgId: supplierOrgId,
      draft: {
        invoiceNumber: 'INTERCO-2026-001',
        typeCode: '380',
        issueDate: '2026-09-10',
        dueDate: '2026-10-10',
        currency: 'EUR',
        paymentMeansCode: '30',
        iban: 'FR7630006000011234567890189',
        buyer: {
          name: CLIENT.name,
          siret: CLIENT.siret,
          vatId: CLIENT.vatNumber,
          address: {
            line1: '14 rue Diderot',
            postcode: '69001',
            city: 'Lyon',
            countryCode: 'FR',
          },
        },
        lines: [
          {
            name: 'Robinetterie sanitaire',
            quantity: '4',
            unitCode: 'C62',
            unitPrice: '62.50',
            vatCategory: 'S',
            vatRatePercent: '20.00',
          },
        ],
      } as IssueDraft,
    });

    // Exactly the bytes we sealed as the issuer - which is what the platform would deliver back.
    const issuedEntry = await prisma.archiveEntry.findFirstOrThrow({
      where: { invoiceId: issued.invoiceId, artifactKind: 'facturx-pdf' },
    });
    const { bytes } = await archiving.retrieve(tenantId, issuedEntry.id);

    const received = await reception.receive({
      tenantId,
      bytes,
      filename: 'interco.pdf',
      now: RECEIVED_AT,
    });

    // Filed for the *buyer*, not treated as a duplicate of the issuer's own invoice.
    expect(received.duplicate).toBe(false);
    expect(received.clientOrgId).toBe(clientOrgId);
    expect(received.invoiceId).not.toBe(issued.invoiceId);

    // Two entries, same bytes, one per invoice - each with its own retention deadline.
    const entries = await prisma.archiveEntry.findMany({
      where: { tenantId, contentHash: issuedEntry.contentHash },
    });
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.invoiceId))).toEqual(
      new Set([issued.invoiceId, received.invoiceId]),
    );
    // The blob itself is stored once: the store is content-addressed.
    expect(new Set(entries.map((entry) => entry.storageKey)).size).toBe(1);

    // And the payable's artifact is genuinely retrievable, verified against its hash.
    const receivedEntry = entries.find((entry) => entry.invoiceId === received.invoiceId)!;
    const readBack = await archiving.retrieve(tenantId, receivedEntry.id);
    expect(Buffer.from(readBack.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  /** Redelivery of an intercompany invoice is still just a redelivery. */
  it('still deduplicates when the buyer receives it twice', async () => {
    const issued = await issuance.issue({
      tenantId,
      clientOrgId: supplierOrgId,
      draft: {
        invoiceNumber: 'INTERCO-2026-002',
        typeCode: '380',
        issueDate: '2026-09-11',
        dueDate: '2026-10-11',
        currency: 'EUR',
        paymentMeansCode: '30',
        iban: 'FR7630006000011234567890189',
        buyer: {
          name: CLIENT.name,
          siret: CLIENT.siret,
          vatId: CLIENT.vatNumber,
          address: {
            line1: '14 rue Diderot',
            postcode: '69001',
            city: 'Lyon',
            countryCode: 'FR',
          },
        },
        lines: [
          {
            name: 'Robinetterie sanitaire',
            quantity: '1',
            unitCode: 'C62',
            unitPrice: '50.00',
            vatCategory: 'S',
            vatRatePercent: '20.00',
          },
        ],
      } as IssueDraft,
    });

    const entry = await prisma.archiveEntry.findFirstOrThrow({
      where: { invoiceId: issued.invoiceId, artifactKind: 'facturx-pdf' },
    });
    const { bytes } = await archiving.retrieve(tenantId, entry.id);

    const first = await reception.receive({
      tenantId,
      bytes,
      filename: 'interco.pdf',
      now: RECEIVED_AT,
    });
    const second = await reception.receive({
      tenantId,
      bytes,
      filename: 'interco-encore.pdf',
      now: RECEIVED_AT,
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.invoiceId).toBe(first.invoiceId);
  });
});

suite('routing', () => {
  it('routes on the SIREN when the invoice carries no SIRET for the buyer', async () => {
    const draft = supplierDraft('FR-2026-0040', {
      buyer: {
        name: CLIENT.name,
        siren: CLIENT.siren,
        address: {
          line1: '14 rue Diderot',
          postcode: '69001',
          city: 'Lyon',
          countryCode: 'FR',
        },
      },
    });

    const result = await reception.receive({
      tenantId,
      bytes: xmlBytes(draft),
      filename: 'siren.xml',
      now: RECEIVED_AT,
    });

    expect(result.clientOrgId).toBe(clientOrgId);
  });

  /**
   * A SIRET names an establishment. An invoice sent to a different establishment of the same
   * company still belongs to the business we hold, so the first nine digits are enough.
   */
  it('routes a different establishment of the same company to that company', async () => {
    const draft = supplierDraft('FR-2026-0041', {
      buyer: {
        name: CLIENT.name,
        // Same SIREN, different establishment suffix.
        siret: `${CLIENT.siren}00042`,
        address: {
          line1: '2 rue Autre',
          postcode: '69003',
          city: 'Lyon',
          countryCode: 'FR',
        },
      },
    });

    const result = await reception.receive({
      tenantId,
      bytes: xmlBytes(draft),
      filename: 'etablissement.xml',
      now: RECEIVED_AT,
    });

    expect(result.clientOrgId).toBe(clientOrgId);
  });

  it("does not route on the buyer's name", async () => {
    const draft = supplierDraft('FR-2026-0042', {
      buyer: {
        name: CLIENT.name,
        address: {
          line1: '14 rue Diderot',
          postcode: '69001',
          city: 'Lyon',
          countryCode: 'FR',
        },
      },
    });

    // Two businesses share a name far more often than a SIREN; filing by name would put an
    // invoice in the wrong client's books, which is very hard to notice later.
    await expect(
      reception.receive({
        tenantId,
        bytes: xmlBytes(draft),
        filename: 'nom.xml',
        now: RECEIVED_AT,
      }),
    ).rejects.toBeInstanceOf(UnroutableInvoiceError);
  });
});
