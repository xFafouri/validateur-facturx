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
import { clientOrgIdScope } from '../auth/scope';
import { CurrentUser, SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientOrgDto } from './dto/client-org.dto';

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
