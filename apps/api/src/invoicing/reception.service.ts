/**
 * Receiving an invoice: analyse, route, record, seal.
 *
 * **This is the mirror image of issuance, and the asymmetry is the whole design.** Issuance
 * refuses to write anything the engine has not accepted, because we are the author and an invoice
 * we cannot verify is one we should not have produced. Reception cannot work that way. A supplier
 * sends what a supplier sends; if it is malformed, we have still received it, and from 1 September
 * 2026 the obligation to be able to receive is unconditional. Refusing to record a non-conforming
 * invoice would mean the one document the accountant most needs to see - the broken one - is the
 * one the system silently drops.
 *
 * So: **a received invoice is stored whether or not it validates**, with the verdict and the rules
 * that fired recorded alongside it. What is refused is narrower and different in kind:
 *
 *  - a file we cannot read as an invoice at all (there is nothing to record);
 *  - an invoice addressed to a business this tenant does not manage (it is not ours to file).
 *
 * Routing is by the *buyer* identity in the document, matched against the tenant's own client
 * orgs. The caller does not get to say which client org an invoice belongs to, for the same
 * reason the seller is not caller-supplied on issuance: the document decides, not the request.
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  analyze,
  money,
  type AnalysisResult,
  type CiiInvoice,
  type CiiParty,
  type Decimal,
  type ValidationEngine,
} from '@facturx/core';
import type { ClientOrg, Prisma } from '@prisma/client';
import { ArchivingService } from '../archiving/archiving.service';
import { PrismaService } from '../prisma/prisma.service';
import { ISSUANCE_ENGINE } from './issuance.service';

export interface ReceiveRequest {
  readonly tenantId: string;
  /**
   * Client businesses the caller may file against, or `null` when unrestricted.
   *
   * Reception routes by the *document's* buyer, so unlike issuance there is no caller-supplied
   * client org to check before the work starts - scope can only be applied once the analysis says
   * where the invoice would land. Passing `undefined` is not the same as `null`: it is treated as
   * unrestricted for internal callers such as a future platform poller, and the parameter is
   * required at the controller so a route cannot omit it by accident.
   */
  readonly allowedClientOrgIds?: readonly string[] | null;
  readonly bytes: Uint8Array;
  readonly filename: string;
  /** Where it came from: `upload` today, a platform adapter key later. */
  readonly sourceChannel?: string;
  readonly actorUserId?: string | null;
  readonly now?: Date;
}

export interface ReceiveResult {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly clientOrgId: string;
  readonly clientOrgName: string;
  readonly supplierName: string | null;
  readonly conforme: boolean;
  /** True when this exact document had already been received; nothing new was written. */
  readonly duplicate: boolean;
  readonly verdict: AnalysisResult['verdict'];
  readonly errorCount: number;
  readonly ruleIds: readonly string[];
}

export class UnreadableDocumentError extends Error {
  constructor(detail: string) {
    super(
      `Ce fichier n'a pas pu être lu comme une facture électronique. ${detail} Vérifiez qu'il s'agit bien d'un PDF Factur-X ou d'un XML CII.`,
    );
    this.name = 'UnreadableDocumentError';
  }
}

/**
 * The invoice does not name any of this tenant's businesses as the buyer.
 *
 * Deliberately not a silent "file it somewhere": an invoice landing in the wrong client's books
 * is an accounting error that is very hard to notice later and very easy to notice now.
 */
export class UnroutableInvoiceError extends Error {
  readonly buyerName: string | null;
  readonly buyerIdentifiers: readonly string[];

  constructor(buyer: CiiParty) {
    const identifiers = [buyer.globalId, buyer.legalId, buyer.vatId].filter(
      (value): value is string => Boolean(value),
    );
    super(
      `Cette facture est adressée à « ${buyer.name ?? 'destinataire inconnu'} »${
        identifiers.length > 0 ? ` (${identifiers.join(', ')})` : ''
      }, qui ne correspond à aucune de vos entreprises clientes. Ajoutez cette entreprise, ou vérifiez que la facture vous était bien destinée.`,
    );
    this.name = 'UnroutableInvoiceError';
    this.buyerName = buyer.name;
    this.buyerIdentifiers = identifiers;
  }
}

/** Exact decimal string for a NUMERIC column, or null when the document did not state one. */
function dec(value: Decimal | null | undefined, scale: number): string | null {
  if (!value) return null;
  return money.format(money.rescale(value, scale));
}

/** Party details exactly as the received document stated them. */
function partySnapshot(party: CiiParty): Prisma.PartyCreateInput {
  return {
    name: party.name ?? 'Inconnu',
    legalId: party.legalId,
    legalScheme: party.legalIdScheme,
    vatNumber: party.vatId,
    eAddress: party.globalId,
    eScheme: party.globalIdScheme,
    addressLine1: party.address.line1,
    addressLine2: party.address.line2,
    postcode: party.address.postcode,
    city: party.address.city,
    countryCode: party.address.countryCode,
  };
}

/** Digits only, so `FR 443 061 841` and `443061841` compare equal. */
function digits(value: string | null | undefined): string | null {
  if (!value) return null;
  const only = value.replace(/\D/g, '');
  return only === '' ? null : only;
}

@Injectable()
export class ReceptionService {
  private readonly logger = new Logger(ReceptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly archiving: ArchivingService,
    @Inject(ISSUANCE_ENGINE) private readonly engine: ValidationEngine,
  ) {}

  async receive(request: ReceiveRequest): Promise<ReceiveResult> {
    const now = request.now ?? new Date();

    const analysis = await analyze(request.bytes, request.filename, { engine: this.engine });

    // Unreadable is different from invalid. Invalid we record; unreadable there is nothing to
    // record - no number, no parties, no amounts.
    if (!analysis.invoice) {
      throw new UnreadableDocumentError(analysis.parseError ?? '');
    }
    const invoice = analysis.invoice;

    const clientOrg = await this.routeToClientOrg(request.tenantId, invoice);

    // Scope, applied after routing. A restricted user may deposit invoices for the businesses
    // assigned to them and no others; the same refusal as an unroutable invoice, because from the
    // caller's side an org they cannot see and an org that does not exist are the same thing.
    const allowed = request.allowedClientOrgIds;
    if (allowed !== undefined && allowed !== null && !allowed.includes(clientOrg.id)) {
      throw new UnroutableInvoiceError(invoice.buyer);
    }

    // Content hash before anything is written: re-receiving the same bytes is normal (a retry, a
    // forwarded email, a platform redelivering) and must not produce a second invoice.
    const contentHash = createHash('sha256').update(request.bytes).digest('hex');
    const existing = await this.findAlreadyReceived(request.tenantId, contentHash);
    if (existing) {
      return { ...existing, duplicate: true };
    }

    return this.persist(request, clientOrg, invoice, analysis, contentHash, now);
  }

  /**
   * Finds which of the tenant's businesses the invoice is addressed to.
   *
   * Tried strongest identifier first. A SIRET identifies an establishment and is what the Annuaire
   * routes on; a SIREN identifies the company. Name is never used - two businesses share a name
   * far more often than they share a SIREN, and misrouting into the wrong client's books is worse
   * than refusing.
   */
  private async routeToClientOrg(tenantId: string, invoice: CiiInvoice): Promise<ClientOrg> {
    const candidates = await this.prisma.clientOrg.findMany({
      where: { tenantId, archivedAt: null },
    });

    const buyerSiret = digits(invoice.buyer.globalId);
    const buyerSiren = digits(invoice.buyer.legalId);
    const buyerVat = invoice.buyer.vatId?.replace(/\s/g, '').toUpperCase() ?? null;

    const match =
      (buyerSiret && candidates.find((org) => digits(org.siret) === buyerSiret)) ||
      // A SIRET whose first nine digits are the company: an invoice addressed to one
      // establishment still belongs to the business we hold.
      (buyerSiret && candidates.find((org) => digits(org.siren) === buyerSiret.slice(0, 9))) ||
      (buyerSiren && candidates.find((org) => digits(org.siren) === buyerSiren)) ||
      (buyerVat && candidates.find((org) => org.vatNumber?.toUpperCase() === buyerVat)) ||
      null;

    if (!match) throw new UnroutableInvoiceError(invoice.buyer);
    return match;
  }

  /** An invoice already sealed under this hash for this tenant. */
  private async findAlreadyReceived(
    tenantId: string,
    contentHash: string,
  ): Promise<Omit<ReceiveResult, 'duplicate'> | null> {
    const entry = await this.prisma.archiveEntry.findUnique({
      where: { tenantId_contentHash: { tenantId, contentHash } },
      select: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            direction: true,
            lastValidationValid: true,
            validationErrorCount: true,
            validationRuleIds: true,
            clientOrg: { select: { id: true, name: true } },
            seller: { select: { name: true } },
          },
        },
      },
    });

    const found = entry?.invoice;
    if (!found || found.direction !== 'RECEIVED') return null;

    return {
      invoiceId: found.id,
      invoiceNumber: found.invoiceNumber,
      clientOrgId: found.clientOrg.id,
      clientOrgName: found.clientOrg.name,
      supplierName: found.seller.name,
      conforme: found.lastValidationValid === true,
      verdict: found.lastValidationValid === true ? 'conforme' : 'non-conforme',
      errorCount: found.validationErrorCount ?? 0,
      ruleIds: Array.isArray(found.validationRuleIds) ? (found.validationRuleIds as string[]) : [],
    };
  }

  private async persist(
    request: ReceiveRequest,
    clientOrg: ClientOrg,
    invoice: CiiInvoice,
    analysis: AnalysisResult,
    contentHash: string,
    now: Date,
  ): Promise<ReceiveResult> {
    const conforme = analysis.verdict === 'conforme';
    const ruleIds = [
      ...new Set(
        analysis.findings
          .filter((finding) => finding.severity === 'error' || finding.severity === 'fatal')
          .map((finding) => finding.ruleId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    // A document with no BT-2 still has to be filed under some date; the day it arrived is the
    // only honest stand-in, and `receivedAt` records that it is one.
    const issueDate = invoice.issueDate
      ? new Date(`${invoice.issueDate}T00:00:00.000Z`)
      : new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');

    const isPdf = analysis.kind === 'facturx-pdf';

    const created = await this.prisma.$transaction(async (tx) => {
      const seller = await tx.party.create({ data: partySnapshot(invoice.seller) });
      const buyer = await tx.party.create({ data: partySnapshot(invoice.buyer) });

      const row = await tx.invoice.create({
        data: {
          tenantId: request.tenantId,
          clientOrgId: clientOrg.id,
          direction: 'RECEIVED',
          // Not REJECTED when it fails validation. Rejecting a supplier's invoice is a business
          // act with its own lifecycle status under the mandate, and it is the accountant's to
          // take - not something to infer from a Schematron result.
          state: 'DELIVERED',
          invoiceNumber: invoice.invoiceNumber ?? `SANS-NUMERO-${contentHash.slice(0, 8)}`,
          typeCode: invoice.typeCode ?? '380',
          issueDate,
          dueDate: invoice.dueDate ? new Date(`${invoice.dueDate}T00:00:00.000Z`) : null,
          currency: invoice.currency ?? 'EUR',
          buyerReference: invoice.buyerReference,
          profile: invoice.profile ?? 'INCONNU',
          counterpartyLegalId: digits(invoice.seller.legalId),
          receivedAt: now,
          sourceChannel: request.sourceChannel ?? 'upload',
          sellerPartyId: seller.id,
          buyerPartyId: buyer.id,
          // Null where the document did not state a total. See the schema note: a fabricated zero
          // in front of an accountant is worse than a visible gap.
          lineTotalAmount: dec(invoice.totals.lineTotalAmount, 2),
          allowanceTotalAmount: dec(invoice.totals.allowanceTotalAmount, 2),
          chargeTotalAmount: dec(invoice.totals.chargeTotalAmount, 2),
          taxBasisTotalAmount: dec(invoice.totals.taxBasisTotalAmount, 2),
          taxTotalAmount: dec(invoice.totals.taxTotalAmount, 2),
          grandTotalAmount: dec(invoice.totals.grandTotalAmount, 2),
          prepaidAmount: dec(invoice.totals.prepaidAmount, 2),
          duePayableAmount: dec(invoice.totals.duePayableAmount, 2),
          lastValidationValid: conforme,
          lastValidatedAt: analysis.validation ? now : null,
          validationErrorCount: analysis.counts.errors,
          validationRuleIds: ruleIds,
          lines: {
            create: invoice.lines.map((line, index) => ({
              lineId: line.id ?? String(index + 1),
              name: line.name ?? 'Ligne sans désignation',
              description: line.description,
              quantity: dec(line.quantity, 4) ?? '0',
              unitCode: line.unitCode ?? 'C62',
              netUnitPrice: dec(line.netUnitPrice, 4) ?? '0',
              netAmount: dec(line.netAmount, 2) ?? '0',
              vatCategoryCode: line.vatCategoryCode ?? 'S',
              vatRatePercent: dec(line.vatRatePercent, 2) ?? '0',
            })),
          },
          taxBreakdown: {
            create: invoice.taxBreakdown.map((group) => ({
              basisAmount: dec(group.basisAmount, 2) ?? '0',
              calculatedAmount: dec(group.calculatedAmount, 2) ?? '0',
              categoryCode: group.categoryCode ?? 'S',
              ratePercent: dec(group.ratePercent, 2) ?? '0',
              exemptionReason: group.exemptionReason,
            })),
          },
        },
      });

      // The bytes exactly as they arrived. A received invoice is evidence, and the ten-year
      // retention applies to it just as much as to one we issued - so it is sealed unmodified,
      // even when it is the non-conforming original that proves what the supplier sent.
      await this.archiving.seal(
        {
          tenantId: request.tenantId,
          invoiceId: row.id,
          bytes: request.bytes,
          mimeType: isPdf ? 'application/pdf' : 'application/xml',
          artifactKind: isPdf ? 'facturx-pdf' : 'cii-xml',
          extension: isPdf ? 'pdf' : 'xml',
          issuedAt: issueDate,
        },
        tx,
      );

      await tx.lifecycleStatus.create({
        data: {
          invoiceId: row.id,
          code: 'RECEIVED',
          label: 'Facture reçue et déposée',
          source: 'INTERNAL',
          occurredAt: now,
          payload: { verdict: analysis.verdict, errors: analysis.counts.errors, ruleIds },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: request.tenantId,
          userId: request.actorUserId ?? null,
          action: 'invoice.received',
          entityType: 'Invoice',
          entityId: row.id,
          metadata: {
            invoiceNumber: row.invoiceNumber,
            clientOrgId: clientOrg.id,
            contentHash,
            verdict: analysis.verdict,
            errorCount: analysis.counts.errors,
            sourceChannel: request.sourceChannel ?? 'upload',
          },
        },
      });

      return row;
    });

    this.logger.log(
      `Facture ${created.invoiceNumber} reçue pour ${clientOrg.name} (${analysis.verdict}).`,
    );

    return {
      invoiceId: created.id,
      invoiceNumber: created.invoiceNumber,
      clientOrgId: clientOrg.id,
      clientOrgName: clientOrg.name,
      supplierName: invoice.seller.name,
      conforme,
      duplicate: false,
      verdict: analysis.verdict,
      errorCount: analysis.counts.errors,
      ruleIds,
    };
  }
}
