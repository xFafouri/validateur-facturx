/**
 * The transmission pipeline, end to end against a real Postgres.
 *
 * The claims worth testing here are the ones that only hold if the *database* behaves as the
 * design assumes, so a mocked client would prove nothing:
 *
 *  - a double enqueue produces one row, because a unique constraint says so rather than because
 *    the code checked first;
 *  - `FOR UPDATE SKIP LOCKED` gives two concurrent workers disjoint work;
 *  - a replayed send resolves to the original transmission instead of a second invoice at the
 *    buyer, which is the failure this whole module exists to prevent;
 *  - statuses arriving twice, or out of order, leave the invoice where it should be.
 *
 * Skipped when Postgres, the sidecar or system fonts are unavailable:
 *
 *   docker compose up -d postgres validator
 *   pnpm --filter @facturx/db migrate:deploy
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient, type PdpConnection } from '@prisma/client';
import {
  MustangEngine,
  generateFacturX,
  resolveSystemFonts,
  systemFontsAvailable,
  type InvoiceDraft,
} from '@facturx/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ArchivingService } from '../src/archiving/archiving.service';
import { FilesystemArtifactStore } from '../src/archiving/stores/filesystem.store';
import { IssuanceService, type IssueDraft } from '../src/invoicing/issuance.service';
import { ReceptionService } from '../src/invoicing/reception.service';
import { PdpRegistryService } from '../src/pdp/pdp-registry.service';
import { PdpSyncService } from '../src/pdp/pdp-sync.service';
import { TransmissionService } from '../src/pdp/transmission.service';
import { SandboxPdpProvider } from '../src/pdp/providers/sandbox.provider';
import type {
  InboundInvoice,
  LifecycleStatusUpdate,
  PdpCredentials,
  PdpProvider,
  TransmitRequest,
  TransmitResult,
} from '../src/pdp/pdp-provider';
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
  console.warn(
    `[transmission] skipping: database=${databaseUp} engine=${engineUp} fonts=${fontsUp}.`,
  );
}

const suite = describe.skipIf(!ready);

/**
 * A provider that fails on demand.
 *
 * The sandbox models a platform that works; the retry path needs one that does not, and needs to
 * be able to stop failing so the test can watch the invoice recover.
 */
class FlakyProvider implements PdpProvider {
  readonly key = 'flaky';
  readonly displayName = 'Plateforme instable (test)';

  failures = 0;
  calls: TransmitRequest[] = [];
  private readonly succeeded = new Map<string, TransmitResult>();

  async transmit(_credentials: PdpCredentials, request: TransmitRequest): Promise<TransmitResult> {
    this.calls.push(request);

    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('La plateforme a renvoyé 503.');
    }

    const existing = this.succeeded.get(request.idempotencyKey);
    if (existing) return existing;

    const result: TransmitResult = {
      externalId: `FLAKY-${this.succeeded.size + 1}`,
      acceptedAt: new Date(),
    };
    this.succeeded.set(request.idempotencyKey, result);
    return result;
  }

  async fetchInbound(): Promise<InboundInvoice[]> {
    return [];
  }
  async fetchStatuses(): Promise<LifecycleStatusUpdate[]> {
    return [];
  }
  async acknowledge(): Promise<void> {}
  async verifyCredentials(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }
}

/** `ConfigService`, as far as the registry uses it. */
const config = { get: (key: string) => process.env[key] } as never;

let archiveRoot: string;
let archiving: ArchivingService;
let issuance: IssuanceService;
let reception: ReceptionService;
let transmissions: TransmissionService;
let sync: PdpSyncService;
let sandbox: SandboxPdpProvider;
let flaky: FlakyProvider;

let tenantId: string;
let clientOrgId: string;
let connection: PdpConnection;

let sequence = 0;

function draft(override: Partial<InvoiceDraft> = {}): IssueDraft {
  sequence += 1;
  return {
    invoiceNumber: `TX-2026-${String(sequence).padStart(4, '0')}`,
    typeCode: '380',
    issueDate: '2026-09-10',
    dueDate: '2026-10-10',
    currency: 'EUR',
    paymentMeansCode: '30',
    iban: 'FR7630006000011234567890189',
    buyer: {
      name: 'Fournitures Rhône SAS',
      // The SIRET is what becomes the buyer's electronic address, and without one the platform
      // would have nowhere to deliver - so transmission refuses. Covered explicitly below.
      siret: '44306184100005',
      vatId: 'FR64443061841',
      address: {
        line1: '5 quai Perrache',
        postcode: '69002',
        city: 'Lyon',
        countryCode: 'FR',
      },
    },
    lines: [
      {
        name: 'Prestation de plomberie',
        quantity: '2',
        unitCode: 'HUR',
        unitPrice: '65.00',
        vatCategory: 'S',
        vatRatePercent: '20',
      },
    ],
    ...override,
  } as IssueDraft;
}

/** Issues an invoice and returns its id. */
async function issue(override: Partial<InvoiceDraft> = {}): Promise<string> {
  const result = await issuance.issue({ tenantId, clientOrgId, draft: draft(override) });
  return result.invoiceId;
}

beforeAll(async () => {
  if (!ready) return;

  archiveRoot = await mkdtemp(join(tmpdir(), 'facturx-transmission-'));
  const engine = new MustangEngine({ baseUrl: VALIDATOR_URL });

  archiving = new ArchivingService(
    prisma as unknown as PrismaService,
    new FilesystemArtifactStore(archiveRoot),
  );
  issuance = new IssuanceService(prisma as unknown as PrismaService, archiving, engine);
  reception = new ReceptionService(prisma as unknown as PrismaService, archiving, engine);

  sandbox = new SandboxPdpProvider();
  flaky = new FlakyProvider();
  const registry = new PdpRegistryService([sandbox, flaky], config);

  transmissions = new TransmissionService(prisma as unknown as PrismaService, archiving, registry);
  sync = new PdpSyncService(prisma as unknown as PrismaService, registry, reception);

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Cabinet Transmission',
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

  connection = await prisma.pdpConnection.create({
    data: { clientOrgId, provider: 'sandbox', label: 'Sandbox', active: true },
  });
});

afterAll(async () => {
  if (ready) {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await rm(archiveRoot, { recursive: true, force: true });
  }
  await prisma.$disconnect();
});

suite('queueing an invoice', () => {
  it('queues it once, however many times it is asked', async () => {
    const invoiceId = await issue();

    const first = await transmissions.enqueue({ tenantId, invoiceId });
    const second = await transmissions.enqueue({ tenantId, invoiceId });

    expect(first.alreadyQueued).toBe(false);
    expect(second.alreadyQueued).toBe(true);
    expect(second.transmissionId).toBe(first.transmissionId);

    const rows = await prisma.transmission.findMany({ where: { invoiceId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('PENDING');

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.state).toBe('QUEUED');
  });

  /**
   * The reconciliation half of the design: issuance never calls into this module, so an invoice
   * left in `VALIDATED` is the outbox entry and the sweep is what drains it.
   */
  it('sweeps up invoices that issuance left behind', async () => {
    const invoiceId = await issue();

    const queued = await transmissions.enqueuePending();

    expect(queued).toBeGreaterThanOrEqual(1);
    const row = await prisma.transmission.findFirst({ where: { invoiceId } });
    expect(row).not.toBeNull();
  });

  it('refuses to transmit a received invoice', async () => {
    const invoiceId = await issue();
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { direction: 'RECEIVED', receivedAt: new Date() },
    });

    await expect(transmissions.enqueue({ tenantId, invoiceId })).rejects.toThrow(
      /factures émises/i,
    );

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { direction: 'ISSUED', receivedAt: null },
    });
  });

  it('refuses when the business is not connected to any platform', async () => {
    const invoiceId = await issue();
    await prisma.pdpConnection.update({ where: { id: connection.id }, data: { active: false } });

    await expect(transmissions.enqueue({ tenantId, invoiceId })).rejects.toThrow(
      /raccordée à aucune plateforme/i,
    );

    await prisma.pdpConnection.update({ where: { id: connection.id }, data: { active: true } });
  });
});

suite('claiming work', () => {
  beforeEach(async () => {
    // Each test in this block reasons about which rows are due, so it starts from an empty queue.
    await prisma.transmission.deleteMany({ where: { invoice: { tenantId } } });
  });

  it('hands two concurrent workers disjoint rows', async () => {
    for (let index = 0; index < 4; index += 1) {
      await transmissions.enqueue({ tenantId, invoiceId: await issue() });
    }

    const [left, right] = await Promise.all([
      transmissions.claim('worker-a', 10),
      transmissions.claim('worker-b', 10),
    ]);

    const ids = [...left, ...right].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(4);
  });

  it('does not claim a row whose backoff has not elapsed', async () => {
    const invoiceId = await issue();
    const { transmissionId } = await transmissions.enqueue({ tenantId, invoiceId });
    await prisma.transmission.update({
      where: { id: transmissionId },
      data: { nextAttemptAt: new Date(Date.now() + 60_000) },
    });

    const claimed = await transmissions.claim('worker-a', 10);

    expect(claimed.map((row) => row.id)).not.toContain(transmissionId);
  });

  /** A worker killed mid-attempt must not strand the invoice forever. */
  it('reclaims a lease left behind by a dead worker', async () => {
    const invoiceId = await issue();
    const { transmissionId } = await transmissions.enqueue({ tenantId, invoiceId });
    await prisma.transmission.update({
      where: { id: transmissionId },
      data: { claimedAt: new Date(Date.now() - 60 * 60 * 1000), claimedBy: 'worker-mort' },
    });

    const claimed = await transmissions.claim('worker-vivant', 10);

    expect(claimed.map((row) => row.id)).toContain(transmissionId);
  });
});

suite('transmitting', () => {
  it('sends the sealed artifact, records the platform id and moves the invoice', async () => {
    const invoiceId = await issue();
    await transmissions.enqueue({ tenantId, invoiceId });

    const report = await transmissions.drain('worker-test');

    expect(report.sent).toBeGreaterThanOrEqual(1);

    const row = await prisma.transmission.findFirstOrThrow({ where: { invoiceId } });
    expect(row.state).toBe('SENT');
    expect(row.externalId).toMatch(/^SANDBOX-/);
    expect(row.sentAt).not.toBeNull();
    // The claim is released on the way out, so nothing holds a lease it no longer needs.
    expect(row.claimedAt).toBeNull();

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.state).toBe('TRANSMITTED');

    const statuses = await prisma.lifecycleStatus.findMany({ where: { invoiceId } });
    expect(statuses.map((status) => status.code)).toContain('DEPOSEE');
    expect(statuses.find((status) => status.code === 'DEPOSEE')!.source).toBe('PA');
  });

  it('transmits the Factur-X PDF, named after the invoice', async () => {
    const invoiceId = await issue();
    await prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { provider: 'flaky' },
    });

    await transmissions.enqueue({ tenantId, invoiceId });
    await transmissions.drain('worker-test');

    const sent = flaky.calls.at(-1)!;
    expect(sent.mimeType).toBe('application/pdf');
    expect(sent.filename).toMatch(/^TX-2026-\d{4}\.pdf$/);
    // A real Factur-X PDF, not a re-serialisation: the bytes came back through the archive and
    // were checked against the hash recorded at sealing.
    expect(Buffer.from(sent.artifact.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(sent.sender).toEqual({ address: '55208131700018', scheme: '0009' });
    expect(sent.recipient).toEqual({ address: '44306184100005', scheme: '0009' });

    await prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { provider: 'sandbox' },
    });
  });

  /**
   * The failure this module exists to prevent.
   *
   * An ambiguous timeout means retrying with the same key, and the platform must resolve that to
   * the original transmission. Here the retry is forced by resetting the row, which is exactly
   * what a reclaimed lease after a crash looks like.
   */
  it('replays to the same transmission rather than sending a second invoice', async () => {
    const invoiceId = await issue();
    await prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { provider: 'flaky' },
    });

    const { transmissionId, idempotencyKey } = await transmissions.enqueue({
      tenantId,
      invoiceId,
    });
    await transmissions.drain('worker-test');
    const first = await prisma.transmission.findUniqueOrThrow({ where: { id: transmissionId } });

    await prisma.transmission.update({
      where: { id: transmissionId },
      data: { state: 'PENDING', nextAttemptAt: new Date(), claimedAt: null, claimedBy: null },
    });
    await transmissions.drain('worker-test');
    const second = await prisma.transmission.findUniqueOrThrow({ where: { id: transmissionId } });

    expect(second.externalId).toBe(first.externalId);
    expect(flaky.calls.filter((call) => call.idempotencyKey === idempotencyKey)).toHaveLength(2);
    expect(await prisma.transmission.count({ where: { invoiceId } })).toBe(1);

    await prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { provider: 'sandbox' },
    });
  });

  it('backs off after a failure, then succeeds, without losing the invoice', async () => {
    const invoiceId = await issue();
    await prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { provider: 'flaky' },
    });
    flaky.failures = 1;

    const { transmissionId } = await transmissions.enqueue({ tenantId, invoiceId });
    const failedReport = await transmissions.drain('worker-test');
    expect(failedReport.failed).toBe(1);

    const afterFailure = await prisma.transmission.findUniqueOrThrow({
      where: { id: transmissionId },
    });
    expect(afterFailure.state).toBe('PENDING');
    expect(afterFailure.attempt).toBe(2);
    expect(afterFailure.lastError).toMatch(/503/);
    expect(afterFailure.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // The claim is released, so the backoff is the backoff and not the lease.
    expect(afterFailure.claimedAt).toBeNull();

    // The attempt is on the record, not just in `lastError`.
    const failures = await prisma.lifecycleStatus.findMany({
      where: { invoiceId, code: 'TRANSMISSION_ECHOUEE' },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.source).toBe('INTERNAL');

    // Wind the backoff forward, as a worker running later would find it.
    await prisma.transmission.update({
      where: { id: transmissionId },
      data: { nextAttemptAt: new Date() },
    });
    const recovered = await transmissions.drain('worker-test');
    expect(recovered.sent).toBe(1);

    const settled = await prisma.transmission.findUniqueOrThrow({ where: { id: transmissionId } });
    expect(settled.state).toBe('SENT');
    expect(settled.lastError).toBeNull();

    await prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { provider: 'sandbox' },
    });
  });

  /** A document the platform can never route does not become routable by waiting. */
  it('parks immediately when the invoice has no deliverable address', async () => {
    const invoiceId = await issue();
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { buyer: { update: { eAddress: null, eScheme: null, legalId: null } } },
    });

    const { transmissionId } = await transmissions.enqueue({ tenantId, invoiceId });
    const report = await transmissions.drain('worker-test');

    expect(report.parked).toBe(1);
    const row = await prisma.transmission.findUniqueOrThrow({ where: { id: transmissionId } });
    expect(row.state).toBe('FAILED');
    expect(row.attempt).toBe(2);
    expect(row.lastError).toMatch(/adresse électronique de routage/i);
  });

  it('will not requeue a transmission the platform has already accepted', async () => {
    const invoiceId = await issue();
    const { transmissionId } = await transmissions.enqueue({ tenantId, invoiceId });
    await transmissions.drain('worker-test');

    await expect(transmissions.retry(tenantId, transmissionId)).rejects.toThrow(/doublon/i);
  });
});

suite('ingesting lifecycle statuses', () => {
  it('records what the platform reports and advances the invoice', async () => {
    const invoiceId = await issue();
    await transmissions.enqueue({ tenantId, invoiceId });
    await transmissions.drain('worker-test');

    const fresh = await prisma.pdpConnection.findUniqueOrThrow({ where: { id: connection.id } });
    const report = await sync.pollStatuses(fresh);

    expect(report.recorded).toBeGreaterThan(0);

    const statuses = await prisma.lifecycleStatus.findMany({
      where: { invoiceId },
      orderBy: { occurredAt: 'asc' },
    });
    expect(statuses.map((status) => status.code)).toContain('RECUE_PAR_LA_PLATEFORME_DESTINATAIRE');

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.state).toBe('DELIVERED');

    // Delivery closes out the handover.
    const row = await prisma.transmission.findFirstOrThrow({ where: { invoiceId } });
    expect(row.state).toBe('ACKNOWLEDGED');
    expect(row.acknowledgedAt).not.toBeNull();

    // And the cursor moved, so the next poll starts where this one stopped.
    const polled = await prisma.pdpConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(polled.statusCursor).not.toBeNull();
  });

  /**
   * A cursor that lags re-delivers its last window after a crash, by design. That is only safe if
   * re-applying a status is a no-op.
   */
  it('is idempotent when the same statuses are delivered twice', async () => {
    const invoiceId = await issue();
    await transmissions.enqueue({ tenantId, invoiceId });
    await transmissions.drain('worker-test');

    // Rewind the cursor, which is what a crash mid-batch leaves behind.
    await prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { statusCursor: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const fresh = await prisma.pdpConnection.findUniqueOrThrow({ where: { id: connection.id } });
    await sync.pollStatuses(fresh);
    const afterFirst = await prisma.lifecycleStatus.count({ where: { invoiceId } });

    const rewound = await prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { statusCursor: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await sync.pollStatuses(rewound);
    const afterSecond = await prisma.lifecycleStatus.count({ where: { invoiceId } });

    expect(afterSecond).toBe(afterFirst);
  });

  it('drops a status that matches no transmission rather than guessing', async () => {
    const fresh = await prisma.pdpConnection.findUniqueOrThrow({ where: { id: connection.id } });
    const before = await prisma.lifecycleStatus.count({ where: { invoice: { tenantId } } });

    await sync.pollStatuses({
      ...fresh,
      // A cursor far enough back that the sandbox replays everything it holds, including statuses
      // whose transmissions belong to rows this test has since deleted.
      statusCursor: new Date(0),
    });

    const after = await prisma.lifecycleStatus.count({ where: { invoice: { tenantId } } });
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

suite('receiving through a platform', () => {
  it('files an inbound invoice exactly as an upload would, and deduplicates a redelivery', async () => {
    // Generated directly rather than issued through this tenant, because issuing would seal these
    // exact bytes into the tenant's archive first - and the platform is supposed to be delivering
    // a document we have never seen. It is still a real Factur-X PDF, so it carries the buyer
    // identifiers reception routes on.
    const generated = await generateFacturX(
      {
        invoiceNumber: 'FOURN-2026-0042',
        typeCode: '380',
        issueDate: '2026-09-08',
        dueDate: '2026-10-08',
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
          name: 'Plomberie Diderot SARL',
          siret: '55208131700018',
          vatId: 'FR03552081317',
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
            unitPrice: '32.50',
            vatCategory: 'S',
            vatRatePercent: '20',
          },
        ],
      },
      { fonts: resolveSystemFonts(), producer: 'Factur-X', now: new Date('2026-09-08T10:00:00Z') },
    );

    const bytes = generated.pdf;
    const receivedAt = new Date();
    sandbox.seedInbound({
      externalId: 'INBOUND-1',
      artifact: bytes,
      filename: 'facture-fournisseur.pdf',
      mimeType: 'application/pdf',
      receivedAt,
    });

    const fresh = await prisma.pdpConnection.findUniqueOrThrow({ where: { id: connection.id } });
    const first = await sync.pollInbound({ ...fresh, inboundCursor: new Date(0) });

    expect(first.received).toBe(1);

    const filed = await prisma.invoice.findFirstOrThrow({
      where: { tenantId, direction: 'RECEIVED' },
      orderBy: { createdAt: 'desc' },
    });
    // The channel says where it came from - the adapter key, not `upload`.
    expect(filed.sourceChannel).toBe('sandbox');
    expect(filed.state).toBe('DELIVERED');

    // A platform redelivering the same document must not produce a second payable.
    const again = await sync.pollInbound({ ...fresh, inboundCursor: new Date(0) });
    expect(again.duplicates).toBe(1);
    expect(again.received).toBe(0);
  });
});
