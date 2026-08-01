/**
 * Issuing an invoice: generate, self-validate, persist, seal.
 *
 * The order is the guarantee. Nothing is written to the database until the engine has confirmed
 * that the document we produced is compliant, so the invoice table cannot come to hold records of
 * documents that would be rejected downstream. An invoice is a legal act; recording one we could
 * not verify is worse than refusing to issue it.
 *
 * Three properties are enforced here rather than trusted:
 *
 *  - **The seller is not supplied by the caller.** It is read from the client org being invoiced
 *    on behalf of. A request cannot claim to be a business it does not belong to, whatever it puts
 *    in its payload.
 *  - **Tenant scoping is a predicate on every query**, never a filter applied afterwards.
 *  - **Amounts move as exact decimal strings.** `Decimal` to `number` to Postgres `NUMERIC` would
 *    reintroduce the drift the whole pipeline avoids, one cast from the finish line.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  analyze,
  generateFacturX,
  money,
  resolveSystemFonts,
  type AnalysisResult,
  type ComputedInvoice,
  type Decimal,
  type DraftIssue,
  type EmbeddedFonts,
  type InvoiceDraft,
  type DraftParty,
  type ValidationEngine,
} from '@facturx/core';
import type { ClientOrg, Prisma } from '@prisma/client';
import { ArchivingService } from '../archiving/archiving.service';
import { PrismaService } from '../prisma/prisma.service';

/** Everything about an invoice except who is issuing it - that comes from the client org. */
export type IssueDraft = Omit<InvoiceDraft, 'seller'>;

export interface IssueRequest {
  readonly tenantId: string;
  /** The business issuing the invoice. Must belong to the tenant. */
  readonly clientOrgId: string;
  readonly draft: IssueDraft;
  /** Who performed the action, for the audit log. Null for system actions. */
  readonly actorUserId?: string | null;
  /** Injectable clock, so an issuance is reproducible in tests. */
  readonly now?: Date;
}

export interface IssueResult {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly pdfArchiveEntryId: string;
  readonly xmlArchiveEntryId: string;
  readonly contentHash: string;
  /** Non-blocking observations about the draft; errors would have refused the issuance. */
  readonly warnings: readonly DraftIssue[];
}

export class ClientOrgNotFoundError extends Error {
  constructor(clientOrgId: string) {
    super(`Aucune entreprise cliente « ${clientOrgId} » pour ce compte.`);
    this.name = 'ClientOrgNotFoundError';
  }
}

export class InvoiceNumberTakenError extends Error {
  constructor(invoiceNumber: string) {
    super(
      `Le numéro de facture « ${invoiceNumber} » a déjà été utilisé par cette entreprise. La numérotation doit être continue et sans doublon (article 242 nonies A de l'annexe II au CGI).`,
    );
    this.name = 'InvoiceNumberTakenError';
  }
}

/**
 * Raised when our own engine does not accept the document we just produced.
 *
 * This should be unreachable - the generator derives its totals and refuses a bad draft - which is
 * exactly why it is checked. If it ever fires, the generator has a defect and the right response
 * is to stop, not to issue the invoice anyway.
 */
export class SelfValidationFailedError extends Error {
  readonly analysis: AnalysisResult;

  constructor(analysis: AnalysisResult) {
    const reasons = analysis.findings
      .filter((finding) => finding.severity === 'error' || finding.severity === 'fatal')
      .map((finding) => `${finding.ruleId ?? '?'} : ${finding.message}`)
      .join(' | ');
    super(
      analysis.verdict === 'indeterminé'
        ? "La facture n'a pas pu être émise : le service de validation est injoignable, et une facture ne peut pas être archivée sans avoir été vérifiée."
        : `La facture générée n'est pas conforme, l'émission est annulée. ${reasons}`,
    );
    this.name = 'SelfValidationFailedError';
    this.analysis = analysis;
  }
}

/** Exact decimal string for a Postgres NUMERIC column. Never goes via `number`. */
function dec(value: Decimal, scale: number): string {
  return money.format(money.rescale(value, scale));
}

/** The issuing party, built from the client org's own record rather than from the request. */
function sellerFrom(clientOrg: ClientOrg): DraftParty {
  return {
    name: clientOrg.name,
    siret: clientOrg.siret,
    siren: clientOrg.siren,
    vatId: clientOrg.vatNumber,
    address: {
      line1: clientOrg.addressLine1 ?? '',
      line2: clientOrg.addressLine2,
      postcode: clientOrg.postcode ?? '',
      city: clientOrg.city ?? '',
      countryCode: clientOrg.countryCode,
    },
  };
}

/** Party details as they stood at issue time; see the schema note on snapshotting. */
function partySnapshot(party: DraftParty): Prisma.PartyCreateInput {
  return {
    name: party.name,
    legalId: party.siren ?? null,
    legalScheme: party.siren ? '0002' : null,
    vatNumber: party.vatId ?? null,
    eAddress: party.siret ?? null,
    eScheme: party.siret ? '0009' : null,
    addressLine1: party.address.line1,
    addressLine2: party.address.line2 ?? null,
    postcode: party.address.postcode,
    city: party.address.city,
    countryCode: party.address.countryCode,
  };
}

/** Injection token: `ValidationEngine` is an interface and cannot be one itself. */
export const ISSUANCE_ENGINE = Symbol('ISSUANCE_ENGINE');

@Injectable()
export class IssuanceService {
  private readonly logger = new Logger(IssuanceService.name);

  private fonts: EmbeddedFonts | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly archiving: ArchivingService,
    /**
     * Injected rather than constructed here, so a test can point issuance at an engine that is
     * down and assert on what happens - which is the behaviour that keeps unverified documents
     * out of the archive.
     */
    @Inject(ISSUANCE_ENGINE) private readonly engine: ValidationEngine,
  ) {}

  /** Resolved once and cached; the files do not change while the process runs. */
  private embeddableFonts(): EmbeddedFonts {
    this.fonts ??= resolveSystemFonts();
    return this.fonts;
  }

  async issue(request: IssueRequest): Promise<IssueResult> {
    const now = request.now ?? new Date();

    const clientOrg = await this.prisma.clientOrg.findFirst({
      where: { id: request.clientOrgId, tenantId: request.tenantId, archivedAt: null },
    });
    if (!clientOrg) throw new ClientOrgNotFoundError(request.clientOrgId);

    const draft: InvoiceDraft = { ...request.draft, seller: sellerFrom(clientOrg) };

    // Throws DraftInvalidError, listing every problem, before anything is generated.
    const generated = await generateFacturX(draft, {
      fonts: this.embeddableFonts(),
      producer: 'Factur-X',
      now,
    });

    // The engine call is deliberately outside the transaction: it crosses a network and takes
    // seconds, and holding a database transaction open across it would be a lock held on a remote
    // service's latency.
    const filename = `${draft.invoiceNumber}.pdf`;
    const analysis = await analyze(generated.pdf, filename, { engine: this.engine });
    if (analysis.verdict !== 'conforme') {
      throw new SelfValidationFailedError(analysis);
    }

    const issued = await this.persist(request, clientOrg, draft, generated, analysis, now);

    this.logger.log(
      `Facture ${draft.invoiceNumber} émise pour ${clientOrg.name} (${issued.invoiceId}).`,
    );
    return { ...issued, warnings: generated.warnings };
  }

  private async persist(
    request: IssueRequest,
    clientOrg: ClientOrg,
    draft: InvoiceDraft,
    generated: { pdf: Uint8Array; xml: string; computed: ComputedInvoice },
    analysis: AnalysisResult,
    now: Date,
  ): Promise<Omit<IssueResult, 'warnings'>> {
    const { computed } = generated;
    const issueDate = new Date(`${draft.issueDate}T00:00:00.000Z`);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const seller = await tx.party.create({ data: partySnapshot(draft.seller) });
        const buyer = await tx.party.create({ data: partySnapshot(draft.buyer) });

        const invoice = await tx.invoice.create({
          data: {
            tenantId: request.tenantId,
            clientOrgId: clientOrg.id,
            direction: 'ISSUED',
            // Not `ARCHIVED`: that is the end of the lifecycle, after transmission. The invoice is
            // generated and verified, and its archive entries are the evidence that it is sealed.
            state: 'VALIDATED',
            invoiceNumber: draft.invoiceNumber,
            typeCode: draft.typeCode ?? '380',
            issueDate,
            dueDate: draft.dueDate ? new Date(`${draft.dueDate}T00:00:00.000Z`) : null,
            currency: draft.currency ?? 'EUR',
            buyerReference: draft.buyerReference ?? null,
            profile: 'BASIC',
            sellerPartyId: seller.id,
            buyerPartyId: buyer.id,
            lineTotalAmount: dec(computed.totals.lineTotalAmount, 2),
            taxBasisTotalAmount: dec(computed.totals.taxBasisTotalAmount, 2),
            taxTotalAmount: dec(computed.totals.taxTotalAmount, 2),
            grandTotalAmount: dec(computed.totals.grandTotalAmount, 2),
            prepaidAmount: dec(computed.totals.prepaidAmount, 2),
            duePayableAmount: dec(computed.totals.duePayableAmount, 2),
            lastValidationValid: true,
            lastValidatedAt: now,
            lines: {
              create: computed.lines.map((line) => ({
                lineId: line.lineId,
                name: line.source.name,
                description: line.source.description ?? null,
                quantity: dec(line.quantity, 4),
                unitCode: line.source.unitCode,
                netUnitPrice: dec(line.unitPrice, 4),
                netAmount: dec(line.netAmount, 2),
                vatCategoryCode: line.vatCategory,
                vatRatePercent: dec(line.vatRatePercent, 2),
              })),
            },
            taxBreakdown: {
              create: computed.taxGroups.map((group) => ({
                basisAmount: dec(group.basisAmount, 2),
                calculatedAmount: dec(group.calculatedAmount, 2),
                categoryCode: group.categoryCode,
                ratePercent: dec(group.ratePercent, 2),
                exemptionReason: group.exemptionReason,
              })),
            },
          },
        });

        // Both renditions are sealed. The XML is the legal original under the mandate; the PDF is
        // what a human reads. Archiving only one leaves the other unprovable.
        const pdfEntry = await this.archiving.seal(
          {
            tenantId: request.tenantId,
            invoiceId: invoice.id,
            bytes: generated.pdf,
            mimeType: 'application/pdf',
            artifactKind: 'facturx-pdf',
            extension: 'pdf',
            issuedAt: issueDate,
          },
          tx,
        );

        const xmlEntry = await this.archiving.seal(
          {
            tenantId: request.tenantId,
            invoiceId: invoice.id,
            bytes: new TextEncoder().encode(generated.xml),
            mimeType: 'application/xml',
            artifactKind: 'cii-xml',
            extension: 'xml',
            issuedAt: issueDate,
          },
          tx,
        );

        await tx.auditLog.create({
          data: {
            tenantId: request.tenantId,
            userId: request.actorUserId ?? null,
            action: 'invoice.issued',
            entityType: 'Invoice',
            entityId: invoice.id,
            metadata: {
              invoiceNumber: invoice.invoiceNumber,
              clientOrgId: clientOrg.id,
              contentHash: pdfEntry.contentHash,
              engineRulesFired: analysis.validation?.rulesFired ?? null,
            },
          },
        });

        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          pdfArchiveEntryId: pdfEntry.id,
          xmlArchiveEntryId: xmlEntry.id,
          contentHash: pdfEntry.contentHash,
        };
      });
    } catch (error) {
      // P2002 on the (clientOrgId, direction, invoiceNumber) index. Reported as a domain error
      // rather than a database one: reusing a number is a fiscal problem the user can fix.
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw new InvoiceNumberTakenError(draft.invoiceNumber);
      }
      throw error;
    }
  }
}
