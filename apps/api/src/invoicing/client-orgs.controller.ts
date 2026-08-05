/**
 * The businesses a tenant invoices on behalf of.
 *
 * Every read and write carries `tenantId` from the session as a query predicate, never as a
 * filter applied to results afterwards - the schema note explains why that distinction is the one
 * that survives a refactor.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { sirenFromSiret, validateSiren, validateSiret } from '@facturx/core';
import type { AuthenticatedUser } from '@facturx/auth';
import { PermissionGuard, RequirePermission } from '../auth/permission.guard';
import { clientOrgIdScope, clientOrgScope } from '../auth/scope';
import { CurrentUser, SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientOrgDto } from './dto/client-org.dto';

/** Collapses a Prisma `groupBy` result into a lookup, so the merge below is a map read. */
function countBy(rows: readonly { clientOrgId: string; _count: { _all: number } }[]) {
  return new Map(rows.map((row) => [row.clientOrgId, row._count._all]));
}

function sum<T>(rows: readonly T[], of: (row: T) => number): number {
  return rows.reduce((total, row) => total + of(row), 0);
}

@Controller('client-orgs')
@UseGuards(SessionGuard, PermissionGuard)
export class ClientOrgsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('clientOrg:read')
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.clientOrg.findMany({
      // Scope as a predicate, not a filter over results - see `scope.ts`.
      where: { tenantId: user.tenantId, archivedAt: null, ...clientOrgIdScope(user) },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        siren: true,
        siret: true,
        vatNumber: true,
        addressLine1: true,
        addressLine2: true,
        postcode: true,
        city: true,
        countryCode: true,
        defaultProfile: true,
        _count: { select: { invoices: true } },
      },
    });
  }

  /**
   * What needs attention, across every business at once.
   *
   * The screens this backs were built for a tenant with three client businesses, and an accountant
   * has two hundred. At that size a list of names and a total invoice count answers nothing: the
   * question is "which of my clients needs me today", and answering it by opening each one in turn
   * is the manual work this product is supposed to remove.
   *
   * **Declared before `:id`, and it has to stay there.** Routes match in declaration order, so a
   * `@Get(':id')` above this one would swallow `/overview` and try to load a business with that id.
   *
   * ## A fixed number of queries
   *
   * Six aggregates, whatever the client count. The obvious implementation - loop the businesses and
   * count each one's invoices - is the one that works in development against three rows and falls
   * over in front of the customer this feature exists for. Grouping in the database keeps the cost
   * flat.
   *
   * ## Where the scoping actually bites
   *
   * Every aggregate carries the tenant and scope predicates, but that is defence in depth rather
   * than the thing that makes this safe. What makes it safe is that **`orgs` is the only list**:
   * each count is read out of a map keyed by an id from it, and the totals are summed from the
   * merged rows rather than from the raw `groupBy` results. A count belonging to a business out of
   * scope is therefore never read, even if a future predicate goes missing.
   *
   * That ordering is deliberate and worth preserving. Summing `_count` straight off a `groupBy` -
   * the shorter thing to write - would make every total silently depend on a predicate six lines
   * away, and a total is a disclosure too: "12 non-conforming invoices" tells a client user about
   * eleven documents they may not open.
   */
  @Get('overview')
  @RequirePermission('clientOrg:read')
  async overview(@CurrentUser() user: AuthenticatedUser) {
    const scope = { tenantId: user.tenantId, ...clientOrgIdScope(user) };
    const invoiceScope = { tenantId: user.tenantId, ...clientOrgScope(user) };

    const [orgs, byDirection, nonConforming, queued, stuck, connections] = await Promise.all([
      this.prisma.clientOrg.findMany({
        where: { ...scope, archivedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          siren: true,
          siret: true,
          addressLine1: true,
          postcode: true,
          city: true,
        },
      }),
      this.prisma.invoice.groupBy({
        by: ['clientOrgId', 'direction'],
        where: invoiceScope,
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['clientOrgId'],
        // All of them, not a sample of the most recent. The dashboard previously counted
        // non-conforming invoices among the last five it happened to fetch and presented that as
        // the total, which reads as "nothing is wrong" for any tenant with a sixth invoice.
        where: { ...invoiceScope, direction: 'RECEIVED', lastValidationValid: false },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['clientOrgId'],
        where: { ...invoiceScope, direction: 'ISSUED', state: 'QUEUED' },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['clientOrgId'],
        // Counted as *invoices with a parked transmission* rather than as transmission rows: a
        // document that failed six times is one problem to chase, not six.
        where: { ...invoiceScope, transmissions: { some: { state: 'FAILED' } } },
        _count: { _all: true },
      }),
      this.prisma.pdpConnection.findMany({
        where: { active: true, clientOrg: { ...scope } },
        select: { clientOrgId: true, provider: true, lastVerifiedAt: true, lastError: true },
      }),
    ]);

    const issued = countBy(byDirection.filter((row) => row.direction === 'ISSUED'));
    const received = countBy(byDirection.filter((row) => row.direction === 'RECEIVED'));
    const nonConformingBy = countBy(nonConforming);
    const queuedBy = countBy(queued);
    const stuckBy = countBy(stuck);
    const connectionBy = new Map(connections.map((row) => [row.clientOrgId, row]));

    const clientOrgs = orgs.map((org) => {
      const connection = connectionBy.get(org.id) ?? null;

      // Stated as reasons rather than as a boolean, because "not ready" without the reason just
      // moves the investigation somewhere else. Both are things the user can go and fix.
      const blockers: string[] = [];
      if (!org.addressLine1 || !org.postcode || !org.city) blockers.push('ADRESSE_INCOMPLETE');
      if (!connection) blockers.push('AUCUN_RACCORDEMENT');

      return {
        id: org.id,
        name: org.name,
        siren: org.siren,
        issued: issued.get(org.id) ?? 0,
        received: received.get(org.id) ?? 0,
        nonConforming: nonConformingBy.get(org.id) ?? 0,
        queued: queuedBy.get(org.id) ?? 0,
        stuck: stuckBy.get(org.id) ?? 0,
        connection: connection
          ? {
              provider: connection.provider,
              verified: connection.lastVerifiedAt !== null,
              lastError: connection.lastError,
            }
          : null,
        blockers,
      };
    });

    return {
      totals: {
        clientOrgs: clientOrgs.length,
        issued: sum(clientOrgs, (org) => org.issued),
        received: sum(clientOrgs, (org) => org.received),
        nonConforming: sum(clientOrgs, (org) => org.nonConforming),
        queued: sum(clientOrgs, (org) => org.queued),
        stuck: sum(clientOrgs, (org) => org.stuck),
        notConnected: clientOrgs.filter((org) => org.connection === null).length,
        connectionsInError: clientOrgs.filter((org) => org.connection?.lastError).length,
        incomplete: clientOrgs.filter((org) => org.blockers.includes('ADRESSE_INCOMPLETE')).length,
      },
      clientOrgs,
    };
  }

  @Get(':id')
  @RequirePermission('clientOrg:read')
  async detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const clientOrg = await this.prisma.clientOrg.findFirst({
      where: { id, tenantId: user.tenantId, ...clientOrgIdScope(user) },
    });
    if (!clientOrg) throw new NotFoundException('Entreprise cliente introuvable.');
    return clientOrg;
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('clientOrg:create')
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateClientOrgDto) {
    const siret = body.siret?.trim() || null;
    const siren = body.siren.trim();

    // Checksums, not just shape. A mistyped SIREN passes a nine-digit regex and then fails at the
    // platform months later, on an invoice that has already been sent - catching it at the point
    // where someone is looking at the paperwork is worth the two lines.
    const sirenCheck = validateSiren(siren);
    if (!sirenCheck.valid) {
      throw new BadRequestException(`SIREN invalide : ${sirenCheck.reason ?? 'clé incorrecte'}.`);
    }

    if (siret) {
      const siretCheck = validateSiret(siret);
      if (!siretCheck.valid) {
        throw new BadRequestException(`SIRET invalide : ${siretCheck.reason ?? 'clé incorrecte'}.`);
      }
      // A SIRET whose first nine digits are a different company is a data-entry error that would
      // otherwise produce invoices routed to the wrong establishment.
      if (sirenFromSiret(siret) !== siren) {
        throw new BadRequestException(
          'Le SIRET ne correspond pas au SIREN : les neuf premiers chiffres du SIRET doivent être le SIREN.',
        );
      }
    }

    try {
      return await this.prisma.clientOrg.create({
        data: {
          tenantId: user.tenantId,
          name: body.name.trim(),
          siren,
          siret,
          vatNumber: body.vatNumber?.trim() || null,
          addressLine1: body.addressLine1?.trim() || null,
          addressLine2: body.addressLine2?.trim() || null,
          postcode: body.postcode?.trim() || null,
          city: body.city?.trim() || null,
          countryCode: body.countryCode ?? 'FR',
          defaultProfile: body.defaultProfile ?? 'BASIC',
          // The SIRET doubles as the routing address under the 5-corner model, scheme 0009.
          eInvoicingAddress: siret,
          eInvoicingScheme: siret ? '0009' : null,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Une entreprise avec ce SIREN existe déjà dans votre compte.');
      }
      throw error;
    }
  }
}
