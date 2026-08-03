/**
 * The invoicing API.
 *
 * Every route is behind `SessionGuard`, and every query is scoped by the tenant the guard
 * resolved - never by one named in the request. The distinction is the whole of tenant isolation
 * in a product where one cabinet holds many businesses' books.
 *
 * Domain failures are translated into HTTP here rather than in the service, so that the service
 * stays usable from a worker or a script that has no notion of a status code. The mapping is not
 * mechanical: a reused invoice number is a 409 because it is a real fiscal conflict the user must
 * resolve, and a self-validation failure is a 502 or 500 rather than a 400 because the caller's
 * draft was accepted - it is our generator or the engine that did not hold up its end.
 */

import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { DraftInvalidError } from '@facturx/core';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { AuthenticatedUser } from '@facturx/auth';
import { PermissionGuard, RequirePermission } from '../auth/permission.guard';
import { assertClientOrgWritable, clientOrgScope } from '../auth/scope';
import { CurrentUser, SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ArchivingService } from '../archiving/archiving.service';
import {
  ClientOrgNotFoundError,
  InvoiceNumberTakenError,
  IssuanceService,
  SelfValidationFailedError,
  type IssueDraft,
} from './issuance.service';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';

/** Artifact kinds a client may ask for, mapped to how they should be served. */
const DOWNLOADABLE = {
  pdf: { artifactKind: 'facturx-pdf', mimeType: 'application/pdf', extension: 'pdf' },
  xml: { artifactKind: 'cii-xml', mimeType: 'application/xml', extension: 'xml' },
} as const;

type DownloadKind = keyof typeof DOWNLOADABLE;

const MAX_PAGE_SIZE = 100;

/**
 * A NUMERIC column as an exact string, preserving null.
 *
 * Totals are nullable since reception landed: a supplier's invoice that omits BT-112 is recorded
 * as omitting it. Coercing that to `0.00` here would put a figure an accountant could act on in
 * front of them, invented by us.
 */
function amount(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

@Controller('invoices')
@UseGuards(SessionGuard, PermissionGuard)
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(
    private readonly issuance: IssuanceService,
    private readonly archiving: ArchivingService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Issues an invoice: generate, self-validate, persist, seal.
   *
   * 201 with the sealed identifiers, or nothing written at all. There is no partial success here
   * by construction - see `IssuanceService`.
   */
  @Post()
  @HttpCode(201)
  @RequirePermission('invoice:issue')
  async issue(@CurrentUser() user: AuthenticatedUser, @Body() body: IssueInvoiceDto) {
    const { clientOrgId, ...draft } = body;

    // Permission says this role may issue; scope says on whose behalf. Checked before the
    // generator runs, so a refused request costs nothing.
    assertClientOrgWritable(user, clientOrgId);

    try {
      const result = await this.issuance.issue({
        tenantId: user.tenantId,
        clientOrgId,
        draft: draft as IssueDraft,
        actorUserId: user.userId,
      });

      return {
        invoiceId: result.invoiceId,
        invoiceNumber: result.invoiceNumber,
        contentHash: result.contentHash,
        warnings: result.warnings,
      };
    } catch (error) {
      throw this.asHttpError(error);
    }
  }

  @Get()
  @RequirePermission('invoice:read')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('clientOrgId') clientOrgId?: string,
    @Query('direction') direction?: string,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take = 50,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip = 0,
  ) {
    // Unrecognised values are ignored rather than rejected: `direction` narrows a list, and the
    // safe reading of a filter nobody understands is "no filter", not an error page.
    const wanted = direction === 'ISSUED' || direction === 'RECEIVED' ? direction : undefined;

    // Annotated rather than inferred: the conditional spreads otherwise produce a union that
    // Prisma's overloads cannot narrow, and the silent consequence is `select` being ignored and
    // the whole row returned.
    const where: Prisma.InvoiceWhereInput = {
      tenantId: user.tenantId,
      // Scope nests under `AND`, so a caller-supplied `clientOrgId` can only narrow within it.
      // Spreading a bare `clientOrgId` key here previously overwrote the scope predicate outright.
      ...clientOrgScope(user),
      ...(clientOrgId ? { clientOrgId } : {}),
      ...(wanted ? { direction: wanted } : {}),
    };

    const [total, invoices] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: Math.min(Math.max(take, 1), MAX_PAGE_SIZE),
        skip: Math.max(skip, 0),
        select: {
          id: true,
          invoiceNumber: true,
          typeCode: true,
          direction: true,
          state: true,
          issueDate: true,
          dueDate: true,
          currency: true,
          grandTotalAmount: true,
          duePayableAmount: true,
          lastValidationValid: true,
          validationErrorCount: true,
          receivedAt: true,
          clientOrg: { select: { id: true, name: true } },
          seller: { select: { name: true } },
          buyer: { select: { name: true } },
        },
      }),
    ]);

    return {
      total,
      invoices: invoices.map((invoice) => ({
        ...invoice,
        // Prisma returns Decimal objects; serialising them as strings keeps the exact value that
        // the NUMERIC column holds, which `JSON.stringify` of a Decimal would not. Null passes
        // through as null: a received invoice that omitted a total must not be shown a zero.
        grandTotalAmount: amount(invoice.grandTotalAmount),
        duePayableAmount: amount(invoice.duePayableAmount),
        issueDate: invoice.issueDate.toISOString().slice(0, 10),
        dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
        receivedAt: invoice.receivedAt?.toISOString() ?? null,
        // The party that is not us: whom we billed, or who billed us.
        counterpartyName:
          invoice.direction === 'RECEIVED' ? invoice.seller.name : invoice.buyer.name,
      })),
    };
  }

  @Get(':id')
  @RequirePermission('invoice:read')
  async detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId: user.tenantId, ...clientOrgScope(user) },
      include: {
        clientOrg: { select: { id: true, name: true, siren: true } },
        seller: true,
        buyer: true,
        lines: { orderBy: { lineId: 'asc' } },
        taxBreakdown: true,
        archiveEntries: {
          select: {
            id: true,
            artifactKind: true,
            contentHash: true,
            sizeBytes: true,
            sealedAt: true,
            retentionUntil: true,
          },
        },
      },
    });

    if (!invoice) throw new NotFoundException('Facture introuvable.');

    return {
      ...invoice,
      issueDate: invoice.issueDate.toISOString().slice(0, 10),
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
      receivedAt: invoice.receivedAt?.toISOString() ?? null,
      validationRuleIds: Array.isArray(invoice.validationRuleIds)
        ? (invoice.validationRuleIds as string[])
        : [],
      lineTotalAmount: amount(invoice.lineTotalAmount),
      allowanceTotalAmount: amount(invoice.allowanceTotalAmount),
      chargeTotalAmount: amount(invoice.chargeTotalAmount),
      taxBasisTotalAmount: amount(invoice.taxBasisTotalAmount),
      taxTotalAmount: amount(invoice.taxTotalAmount),
      grandTotalAmount: amount(invoice.grandTotalAmount),
      prepaidAmount: amount(invoice.prepaidAmount),
      duePayableAmount: amount(invoice.duePayableAmount),
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: line.quantity.toFixed(4),
        netUnitPrice: line.netUnitPrice.toFixed(4),
        netAmount: line.netAmount.toFixed(2),
        vatRatePercent: line.vatRatePercent.toFixed(2),
      })),
      taxBreakdown: invoice.taxBreakdown.map((group) => ({
        ...group,
        basisAmount: group.basisAmount.toFixed(2),
        calculatedAmount: group.calculatedAmount.toFixed(2),
        ratePercent: group.ratePercent.toFixed(2),
      })),
    };
  }

  /**
   * Serves a sealed artifact, verified against the hash recorded when it was sealed.
   *
   * The download is the archive's user-facing purpose, so it goes through `ArchivingService`
   * rather than reading storage directly: if the bytes no longer match their recorded hash, the
   * user must be told the archive is compromised, not handed a document that silently changed.
   */
  @Get(':id/artifacts/:kind')
  @RequirePermission('invoice:download')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Res() response: Response,
  ): Promise<void> {
    const descriptor = DOWNLOADABLE[kind as DownloadKind];
    if (!descriptor) {
      throw new NotFoundException("Type d'artefact inconnu. Attendu : « pdf » ou « xml ».");
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId: user.tenantId, ...clientOrgScope(user) },
      select: { id: true, invoiceNumber: true },
    });
    if (!invoice) throw new NotFoundException('Facture introuvable.');

    const entry = await this.prisma.archiveEntry.findFirst({
      where: {
        invoiceId: invoice.id,
        tenantId: user.tenantId,
        artifactKind: descriptor.artifactKind,
      },
      orderBy: { sealedAt: 'desc' },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException("Cet artefact n'a pas été archivé pour cette facture.");

    let bytes: Uint8Array;
    try {
      ({ bytes } = await this.archiving.retrieve(user.tenantId, entry.id));
    } catch (error) {
      this.logger.error(
        `Lecture de l'archive impossible pour la facture ${invoice.id} : ${String(error)}`,
      );
      throw new InternalServerErrorException(
        "L'artefact archivé n'a pas pu être relu et vérifié. L'incident a été enregistré.",
      );
    }

    // The invoice number is the only user-controlled part of the filename, so it is stripped to a
    // conservative set before it reaches a Content-Disposition header.
    const safeNumber = invoice.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_');

    response.setHeader('Content-Type', descriptor.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeNumber}.${descriptor.extension}"`,
    );
    response.setHeader('Content-Length', String(bytes.byteLength));
    // A sealed artifact is immutable, but it is also someone's tax record: private, not public.
    response.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    response.end(Buffer.from(bytes));
  }

  /**
   * Domain error to HTTP status.
   *
   * `SelfValidationFailedError` is the interesting case. It means we generated a document our own
   * engine rejected, or could not reach the engine to ask - neither of which is the caller's
   * fault, and both of which must be loud rather than reported as a bad request.
   */
  private asHttpError(error: unknown): Error {
    if (error instanceof ClientOrgNotFoundError) {
      return new NotFoundException(error.message);
    }
    if (error instanceof InvoiceNumberTakenError) {
      return new ConflictException(error.message);
    }
    if (error instanceof DraftInvalidError) {
      return new BadRequestException({
        message: 'La facture ne peut pas être émise en l’état.',
        issues: error.issues,
      });
    }
    if (error instanceof SelfValidationFailedError) {
      this.logger.error(`Auto-validation en échec : ${error.message}`);
      return error.analysis.verdict === 'indeterminé'
        ? new BadGatewayException(error.message)
        : new InternalServerErrorException(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
