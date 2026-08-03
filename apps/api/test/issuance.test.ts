/**
 * End-to-end issuance: draft in, sealed invoice in the database and the archive.
 *
 * Runs against a real Postgres and the real validation engine, because the properties under test
 * are properties of the whole path. A mocked Prisma would happily accept a `number` where the
 * schema wants `NUMERIC` and prove nothing about the cent that matters; a mocked engine would
 * accept whatever we generated.
 *
 * Skipped when either is unavailable, so `pnpm test` works on a machine with neither:
 *
 *   docker compose up -d postgres validator
 *   pnpm --filter @facturx/db migrate:deploy
 *   DATABASE_URL=postgresql://facturx:facturx_dev_only@localhost:5432/facturx pnpm --filter @facturx/api test
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { MustangEngine, parseCii, extractFromPdf, systemFontsAvailable } from '@facturx/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArchivingService } from '../src/archiving/archiving.service';
import { FilesystemArtifactStore } from '../src/archiving/stores/filesystem.store';
import {
  ClientOrgNotFoundError,
  InvoiceNumberTakenError,
  IssuanceService,
  SelfValidationFailedError,
  type IssueDraft,
} from '../src/invoicing/issuance.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://facturx:facturx_dev_only@localhost:5432/facturx';
const VALIDATOR_URL = process.env.VALIDATOR_URL ?? 'http://127.0.0.1:8081';

/**
 * Availability is probed at module load.
 *
 * `describe.skipIf` is evaluated during collection, before any hook runs, so a flag set in
 * `beforeAll` is still false when the decision is made - the same trap the core integration suite
 * documents.
 */
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const databaseUp = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const engineUp = (await new MustangEngine({ baseUrl: VALIDATOR_URL }).health()).ok;
const fontsUp = systemFontsAvailable();

const ready = databaseUp && engineUp && fontsUp;
if (!ready) {
  console.warn(
    `[issuance] skipping: database=${databaseUp} engine=${engineUp} fonts=${fontsUp}. ` +
      'Start them with: docker compose up -d postgres validator && pnpm --filter @facturx/db migrate:deploy',
  );
}

const suite = describe.skipIf(!ready);

let archiveRoot: string;
let issuance: IssuanceService;
let archiving: ArchivingService;
let tenantId: string;
let clientOrgId: string;

const ISSUED_AT = new Date('2026-09-03T09:00:00.000Z');

/** A draft with no seller: the issuing party is read from the client org, never from the caller. */
function draft(invoiceNumber: string, override: Partial<IssueDraft> = {}): IssueDraft {
  return {
    invoiceNumber,
    typeCode: '380',
    issueDate: '2026-09-03',
    dueDate: '2026-10-03',
    currency: 'EUR',
    buyerReference: 'SERVICE-ACHATS',
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
    ],
    paymentMeansCode: '30',
    iban: 'FR7630006000011234567890189',
    ...override,
  };
}

beforeAll(async () => {
  if (!ready) return;

  archiveRoot = await mkdtemp(join(tmpdir(), 'facturx-issuance-'));
  archiving = new ArchivingService(
    prisma as unknown as PrismaService,
    new FilesystemArtifactStore(archiveRoot),
  );
  issuance = new IssuanceService(
    prisma as unknown as PrismaService,
    archiving,
    new MustangEngine({ baseUrl: VALIDATOR_URL }),
  );

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Cabinet Test',
      clientOrgs: {
        create: {
          name: 'Plomberie Diderot SARL',
          siren: '552081317',
          siret: '55208131700018',
          vatNumber: 'FR03552081317',
          addressLine1: '14 rue Diderot',
          postcode: '69001',
          city: 'Lyon',
          countryCode: 'FR',
        },
      },
    },
    include: { clientOrgs: true },
  });

  tenantId = tenant.id;
  clientOrgId = tenant.clientOrgs[0]!.id;
});

afterAll(async () => {
  if (ready) {
    // Cascades to client orgs, invoices, lines, archive entries and audit logs.
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await rm(archiveRoot, { recursive: true, force: true });
  }
  await prisma.$disconnect();
});

suite('issuing an invoice', () => {
  it('persists the invoice, its lines, its VAT breakdown and its archive entries', async () => {
    const result = await issuance.issue({
      tenantId,
      clientOrgId,
      draft: draft('FA-2026-1001'),
      now: ISSUED_AT,
    });

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: { lines: true, taxBreakdown: true, archiveEntries: true, seller: true, buyer: true },
    });

    expect(invoice.state).toBe('VALIDATED');
    expect(invoice.direction).toBe('ISSUED');
    expect(invoice.lastValidationValid).toBe(true);
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.taxBreakdown).toHaveLength(1);
    expect(invoice.archiveEntries).toHaveLength(2);
    expect(invoice.archiveEntries.map((entry) => entry.artifactKind).sort()).toEqual([
      'cii-xml',
      'facturx-pdf',
    ]);
  });

  it('stores amounts exactly, with no floating-point drift', async () => {
    // 3.5 x 12.3456 = 43.2096, which rounds to 43.21. A pipeline that passed through a double
    // would be a cent out here, and that cent is what BR-CO-10 rejects.
    const result = await issuance.issue({
      tenantId,
      clientOrgId,
      now: ISSUED_AT,
      draft: draft('FA-2026-1002', {
        lines: [
          {
            name: 'Tuyau cuivre au mètre',
            quantity: '3.5',
            unitCode: 'MTR',
            unitPrice: '12.3456',
            vatCategory: 'S',
            vatRatePercent: '20.00',
          },
        ],
      }),
    });

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: { lines: true },
    });

    expect(invoice.lines[0]!.netAmount.toString()).toBe('43.21');
    expect(invoice.lines[0]!.netUnitPrice.toString()).toBe('12.3456');
    // Non-null asserted, not defaulted: the totals became nullable so a malformed *received*
    // invoice can be recorded honestly, and an issued one having them is the property under test.
    // A CHECK constraint enforces the same thing in the database.
    expect(invoice.lineTotalAmount!.toString()).toBe('43.21');
    expect(invoice.taxTotalAmount!.toString()).toBe('8.64');
    expect(invoice.grandTotalAmount!.toString()).toBe('51.85');
  });

  it('takes the seller from the client org, not from the request', async () => {
    const result = await issuance.issue({
      tenantId,
      clientOrgId,
      draft: draft('FA-2026-1003'),
      now: ISSUED_AT,
    });

    const { bytes } = await archiving.retrieve(
      tenantId,
      (
        await prisma.archiveEntry.findFirstOrThrow({
          where: { invoiceId: result.invoiceId, artifactKind: 'cii-xml' },
        })
      ).id,
    );

    const parsed = parseCii(bytes);
    expect(parsed.seller.name).toBe('Plomberie Diderot SARL');
    expect(parsed.seller.legalId).toBe('552081317');
    // The buyer is the caller's to state; the seller is not.
    expect(parsed.buyer.name).toBe('Boulangerie Martin SAS');
  });

  it('archives the exact bytes that were issued, verifiable by hash', async () => {
    const result = await issuance.issue({
      tenantId,
      clientOrgId,
      draft: draft('FA-2026-1004'),
      now: ISSUED_AT,
    });

    // `retrieve` re-hashes the stored bytes and refuses to return them if they no longer match.
    const { entry, bytes } = await archiving.retrieve(tenantId, result.pdfArchiveEntryId);

    expect(entry.contentHash).toBe(result.contentHash);
    expect(entry.sizeBytes).toBe(bytes.byteLength);

    // Still a readable Factur-X document after the round trip through storage.
    const extracted = await extractFromPdf(bytes);
    expect(extracted.usesCanonicalName).toBe(true);
    expect(parseCii(extracted.invoiceXml!.bytes).invoiceNumber).toBe('FA-2026-1004');
  });

  it('sets a ten-year retention from the issue date on every artifact', async () => {
    const result = await issuance.issue({
      tenantId,
      clientOrgId,
      draft: draft('FA-2026-1005'),
      now: ISSUED_AT,
    });

    const entries = await prisma.archiveEntry.findMany({ where: { invoiceId: result.invoiceId } });
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.retentionUntil.toISOString()).toBe('2036-09-03T00:00:00.000Z');
    }
  });

  it('writes an audit entry naming the document it sealed', async () => {
    const result = await issuance.issue({
      tenantId,
      clientOrgId,
      draft: draft('FA-2026-1006'),
      now: ISSUED_AT,
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, entityType: 'Invoice', entityId: result.invoiceId },
    });

    expect(audit.action).toBe('invoice.issued');
    expect(audit.metadata).toMatchObject({
      invoiceNumber: 'FA-2026-1006',
      contentHash: result.contentHash,
    });
  });
});

suite('issuance refusals', () => {
  it('refuses to reuse an invoice number, and leaves nothing behind when it does', async () => {
    await issuance.issue({
      tenantId,
      clientOrgId,
      draft: draft('FA-2026-2001'),
      now: ISSUED_AT,
    });

    await expect(
      issuance.issue({
        tenantId,
        clientOrgId,
        draft: draft('FA-2026-2001', { buyerReference: 'AUTRE' }),
        now: ISSUED_AT,
      }),
    ).rejects.toThrow(InvoiceNumberTakenError);

    // The failed attempt must not leave a second invoice, nor orphaned party snapshots attached
    // to one: the transaction either produces a whole invoice or none.
    const invoices = await prisma.invoice.findMany({
      where: { clientOrgId, invoiceNumber: 'FA-2026-2001' },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.buyerReference).toBe('SERVICE-ACHATS');
  });

  it('refuses a client org belonging to another tenant', async () => {
    const other = await prisma.tenant.create({ data: { name: 'Autre cabinet' } });
    try {
      await expect(
        issuance.issue({
          tenantId: other.id,
          clientOrgId, // belongs to the first tenant
          draft: draft('FA-2026-2002'),
          now: ISSUED_AT,
        }),
      ).rejects.toThrow(ClientOrgNotFoundError);

      expect(await prisma.invoice.count({ where: { tenantId: other.id } })).toBe(0);
    } finally {
      await prisma.tenant.delete({ where: { id: other.id } });
    }
  });

  it('refuses to archive an invoice it could not have verified', async () => {
    // The engine being down is not permission to skip the check. An invoice is a legal act, and
    // sealing one into a ten-year archive without having confirmed it is compliant is worse than
    // making the user wait for the validator to come back.
    const blind = new IssuanceService(
      prisma as unknown as PrismaService,
      archiving,
      new MustangEngine({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 2000 }),
    );
    const before = await prisma.invoice.count({ where: { tenantId } });

    await expect(
      blind.issue({ tenantId, clientOrgId, draft: draft('FA-2026-2004'), now: ISSUED_AT }),
    ).rejects.toThrow(SelfValidationFailedError);

    expect(await prisma.invoice.count({ where: { tenantId } })).toBe(before);
    expect(
      await prisma.archiveEntry.count({
        where: { tenantId, invoice: { invoiceNumber: 'FA-2026-2004' } },
      }),
    ).toBe(0);
  });

  it('refuses a draft the generator knows is wrong, before touching the database', async () => {
    const before = await prisma.invoice.count({ where: { tenantId } });

    await expect(
      issuance.issue({
        tenantId,
        clientOrgId,
        now: ISSUED_AT,
        draft: draft('FA-2026-2003', {
          lines: [
            {
              name: 'Prestation exonérée',
              quantity: '1',
              unitCode: 'C62',
              unitPrice: '100.00',
              vatCategory: 'E',
              vatRatePercent: '0',
              // No exemption reason: BR-E-10 would reject this document.
            },
          ],
        }),
      }),
    ).rejects.toThrow(/exonér/i);

    expect(await prisma.invoice.count({ where: { tenantId } })).toBe(before);
  });
});
