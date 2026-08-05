/**
 * The platform-connection and transmission API.
 *
 * Same rules as the invoicing controller: `SessionGuard` resolves the tenant, scope is a
 * predicate on every query, and domain errors become HTTP here rather than in the services, which
 * are also called from the worker where a status code would mean nothing.
 *
 * One rule is specific to this file. **Credentials go in and never come out.** No route returns
 * `credentialsEncrypted`, or its decrypted form, or which keys it contains. A user who has
 * forgotten a platform secret must get it from the platform, not from us - the value of encrypting
 * it at rest is undone by an endpoint that reads it back for anyone with a session.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@facturx/auth';
import { PermissionGuard, RequirePermission } from '../auth/permission.guard';
import { assertClientOrgInScope, assertClientOrgWritable, clientOrgScope } from '../auth/scope';
import { CurrentUser, SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCryptoError } from './credentials';
import { lifecycleLabel } from './lifecycle';
import { PdpRegistryService, UnknownProviderError } from './pdp-registry.service';
import {
  NoActiveConnectionError,
  NotTransmittableError,
  TransmissionService,
} from './transmission.service';
import { UpsertPdpConnectionDto } from './dto/pdp-connection.dto';
import { generateWebhookToken, hashWebhookToken } from './webhook-token';

/** The connection fields that are safe to return. Enumerated, so a schema change cannot leak. */
const CONNECTION_FIELDS = {
  id: true,
  clientOrgId: true,
  provider: true,
  label: true,
  apiBaseUrl: true,
  peppolAddress: true,
  active: true,
  lastPolledAt: true,
  lastVerifiedAt: true,
  lastError: true,
  statusCursor: true,
  inboundCursor: true,
  lastWebhookAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Controller('pdp')
@UseGuards(SessionGuard, PermissionGuard)
export class PdpController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PdpRegistryService,
    private readonly transmissions: TransmissionService,
  ) {}

  /** Adapters this build can talk to, for the platform picker. */
  @Get('providers')
  @RequirePermission('pdp:read')
  providers() {
    return { providers: this.registry.list() };
  }

  @Get('connections')
  @RequirePermission('pdp:read')
  async connections(@CurrentUser() user: AuthenticatedUser) {
    const connections = await this.prisma.pdpConnection.findMany({
      where: { clientOrg: { tenantId: user.tenantId }, ...clientOrgScope(user) },
      orderBy: { createdAt: 'asc' },
      select: {
        ...CONNECTION_FIELDS,
        credentialsEncrypted: true,
        webhookSecretHash: true,
        clientOrg: { select: { id: true, name: true, siren: true } },
      },
    });

    return {
      connections: connections.map(
        ({ credentialsEncrypted, webhookSecretHash, ...connection }) => ({
          ...connection,
          // Whether a secret is set, never what it is - enough for a settings screen to show
          // "credentials configured" and to prompt when they are not. Both secrets are
          // destructured out rather than deleted afterwards, so a future field cannot be added to
          // the response by forgetting to remove it.
          hasCredentials: credentialsEncrypted !== null,
          hasWebhook: webhookSecretHash !== null,
        }),
      ),
    };
  }

  /**
   * Creates or replaces a business's connection.
   *
   * `PUT` on the client org rather than `POST` to a collection, because a business has one active
   * connection - the database enforces it - so there is nothing to add to, only something to set.
   */
  @Put('connections/:clientOrgId')
  @RequirePermission('pdp:manage')
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientOrgId') clientOrgId: string,
    @Body() body: UpsertPdpConnectionDto,
  ) {
    assertClientOrgWritable(user, clientOrgId);

    const clientOrg = await this.prisma.clientOrg.findFirst({
      where: { id: clientOrgId, tenantId: user.tenantId, archivedAt: null },
      select: { id: true },
    });
    if (!clientOrg) throw new NotFoundException('Entreprise cliente introuvable.');

    if (!this.registry.has(body.provider)) {
      throw new BadRequestException(
        `Plateforme « ${body.provider} » inconnue. Plateformes disponibles : ${this.registry
          .list()
          .map((provider) => provider.key)
          .join(', ')}.`,
      );
    }

    let credentialsEncrypted: Uint8Array<ArrayBuffer> | undefined;
    if (body.secrets && Object.keys(body.secrets).length > 0) {
      try {
        credentialsEncrypted = this.registry.seal(body.secrets);
      } catch (error) {
        if (error instanceof CredentialCryptoError) {
          // A deployment problem, not the caller's: they supplied a secret we are not equipped to
          // store. Refusing is the only safe answer, and the message says what is missing.
          throw new ConflictException(error.message);
        }
        throw error;
      }
    }

    const active = body.active ?? true;

    // Activating this connection deactivates any other for the same business. The partial unique
    // index would otherwise refuse the write, and "switch platform" is the ordinary reason to be
    // here - so it is handled rather than reported as a constraint violation.
    const connection = await this.prisma.$transaction(async (tx) => {
      if (active) {
        await tx.pdpConnection.updateMany({
          where: { clientOrgId, active: true, provider: { not: body.provider } },
          data: { active: false },
        });
      }

      return tx.pdpConnection.upsert({
        where: { clientOrgId_provider: { clientOrgId, provider: body.provider } },
        create: {
          clientOrgId,
          provider: body.provider,
          label: body.label ?? null,
          apiBaseUrl: body.apiBaseUrl ?? null,
          peppolAddress: body.peppolAddress ?? null,
          credentialsEncrypted,
          active,
        },
        update: {
          label: body.label ?? null,
          apiBaseUrl: body.apiBaseUrl ?? null,
          peppolAddress: body.peppolAddress ?? null,
          // Absent secrets leave the stored ones alone; see the DTO.
          ...(credentialsEncrypted ? { credentialsEncrypted } : {}),
          active,
          // A changed endpoint or credential invalidates the last verdict. Leaving a stale "ok"
          // on screen after an edit is worse than showing nothing.
          ...(credentialsEncrypted || body.apiBaseUrl !== undefined
            ? { lastVerifiedAt: null, lastError: null }
            : {}),
        },
        select: CONNECTION_FIELDS,
      });
    });

    return connection;
  }

  /**
   * Checks a connection against the platform.
   *
   * Deliberately a write: the verdict is stored, so the settings screen can show a connection is
   * broken without every page load calling a third party.
   */
  @Post('connections/:id/verify')
  @HttpCode(200)
  @RequirePermission('pdp:manage')
  async verify(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const connection = await this.findConnection(user, id);

    try {
      const resolved = this.registry.resolve(connection);
      const result = await resolved.provider.verifyCredentials(resolved.credentials);

      await this.prisma.pdpConnection.update({
        where: { id: connection.id },
        data: {
          lastVerifiedAt: result.ok ? new Date() : null,
          lastError: result.ok
            ? null
            : (result.detail ?? 'Vérification refusée par la plateforme.'),
        },
      });

      return { ok: result.ok, detail: result.detail ?? null };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.prisma.pdpConnection.update({
        where: { id: connection.id },
        data: { lastVerifiedAt: null, lastError: detail.slice(0, 1000) },
      });

      if (error instanceof UnknownProviderError || error instanceof CredentialCryptoError) {
        throw new ConflictException(detail);
      }
      // The platform is unreachable or refused us. Reported as a result rather than a 5xx: the
      // request succeeded, and its answer is "no".
      return { ok: false, detail };
    }
  }

  /**
   * Mints a webhook token for a connection, replacing any existing one.
   *
   * **The only route in this file that returns a secret**, and the exception proves the rule: the
   * credentials rule exists because those secrets belong to the platform and we hold a reversible
   * copy. This one is ours, we keep only a hash, and there is no second chance to read it - so
   * returning it here is the sole moment it can be handed over at all.
   *
   * Regenerating invalidates the previous token immediately, which is what makes this the remedy
   * for a leak as well as the way to get a first one.
   */
  @Post('connections/:id/webhook')
  @HttpCode(201)
  @RequirePermission('pdp:manage')
  async createWebhookToken(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const connection = await this.findConnection(user, id);

    const token = generateWebhookToken();
    await this.prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { webhookSecretHash: hashWebhookToken(token), lastWebhookAt: null },
    });

    return {
      connectionId: connection.id,
      // Shown once and never retrievable. The caller must copy it into the platform now.
      token,
      path: `/pdp/webhooks/${connection.id}`,
      headerName: 'X-Webhook-Token',
    };
  }

  /** Revokes the webhook token. The endpoint then refuses every call for this connection. */
  @Delete('connections/:id/webhook')
  @HttpCode(200)
  @RequirePermission('pdp:manage')
  async revokeWebhookToken(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const connection = await this.findConnection(user, id);

    await this.prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { webhookSecretHash: null, lastWebhookAt: null },
    });

    return { connectionId: connection.id, revoked: true };
  }

  /** Deactivates a connection. Never deletes: its transmissions are evidence and must survive. */
  @Delete('connections/:id')
  @HttpCode(200)
  @RequirePermission('pdp:manage')
  async deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const connection = await this.findConnection(user, id);
    return this.prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { active: false },
      select: CONNECTION_FIELDS,
    });
  }

  /**
   * Queues an invoice for transmission.
   *
   * 202, not 201: the platform has not seen it yet. The worker will send it, and the status
   * timeline is where the caller finds out what happened - pretending otherwise would be claiming
   * a delivery we have no evidence for.
   */
  @Post('invoices/:invoiceId/transmit')
  @HttpCode(202)
  @RequirePermission('invoice:transmit')
  async transmit(@CurrentUser() user: AuthenticatedUser, @Param('invoiceId') invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId: user.tenantId, ...clientOrgScope(user) },
      select: { id: true, clientOrgId: true },
    });
    if (!invoice) throw new NotFoundException('Facture introuvable.');
    assertClientOrgWritable(user, invoice.clientOrgId);

    try {
      const result = await this.transmissions.enqueue({
        tenantId: user.tenantId,
        invoiceId: invoice.id,
        actorUserId: user.userId,
      });
      return result;
    } catch (error) {
      throw this.asHttpError(error);
    }
  }

  /** The handover history and the status timeline for one invoice. */
  @Get('invoices/:invoiceId/transmissions')
  @RequirePermission('pdp:read')
  async history(@CurrentUser() user: AuthenticatedUser, @Param('invoiceId') invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId: user.tenantId, ...clientOrgScope(user) },
      select: {
        id: true,
        invoiceNumber: true,
        state: true,
        transmissions: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            state: true,
            attempt: true,
            externalId: true,
            lastError: true,
            nextAttemptAt: true,
            createdAt: true,
            sentAt: true,
            acknowledgedAt: true,
            pdpConnection: { select: { id: true, provider: true, label: true } },
          },
        },
        lifecycleStatuses: {
          orderBy: { occurredAt: 'asc' },
          select: {
            id: true,
            code: true,
            label: true,
            source: true,
            occurredAt: true,
            recordedAt: true,
          },
        },
      },
    });

    if (!invoice) throw new NotFoundException('Facture introuvable.');

    return {
      ...invoice,
      // A status stored before its code had a label, or one a platform sent that we do not know,
      // still gets the best name we can give it at read time.
      lifecycleStatuses: invoice.lifecycleStatuses.map((status) => ({
        ...status,
        label: status.label ?? lifecycleLabel(status.code),
      })),
    };
  }

  /** Puts a parked transmission back in the queue, keeping its key so it cannot duplicate. */
  @Post('transmissions/:id/retry')
  @HttpCode(202)
  @RequirePermission('invoice:transmit')
  async retry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const transmission = await this.prisma.transmission.findFirst({
      where: { id, invoice: { tenantId: user.tenantId, ...clientOrgScope(user) } },
      select: { id: true, invoice: { select: { clientOrgId: true } } },
    });
    if (!transmission) throw new NotFoundException('Transmission introuvable.');
    assertClientOrgWritable(user, transmission.invoice.clientOrgId);

    try {
      await this.transmissions.retry(user.tenantId, transmission.id);
      return { transmissionId: transmission.id, requeued: true };
    } catch (error) {
      throw this.asHttpError(error);
    }
  }

  /** A connection the caller may act on, or a 404 that does not confirm it exists. */
  private async findConnection(user: AuthenticatedUser, id: string) {
    const connection = await this.prisma.pdpConnection.findFirst({
      where: { id, clientOrg: { tenantId: user.tenantId } },
    });
    if (!connection) throw new NotFoundException('Raccordement introuvable.');
    assertClientOrgInScope(user, connection.clientOrgId);
    return connection;
  }

  private asHttpError(error: unknown): Error {
    if (error instanceof NoActiveConnectionError) {
      // 409 rather than 400: the request was well-formed, and what is missing is configuration
      // the caller can go and supply.
      return new ConflictException(error.message);
    }
    if (error instanceof NotTransmittableError) {
      return new ConflictException(error.message);
    }
    if (error instanceof CredentialCryptoError || error instanceof UnknownProviderError) {
      return new ConflictException(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
