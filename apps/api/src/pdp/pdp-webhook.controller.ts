/**
 * The one route in this application that a stranger is expected to call.
 *
 * Everything else sits behind `SessionGuard`. This does not - a certified platform has no session
 * with us - so the rules it follows are different and worth stating plainly:
 *
 *  - **It authenticates on a token it can only recognise, never read.** Only the SHA-256 is
 *    stored; see `webhook-token.ts`.
 *  - **It reads nothing from the body.** The payload is not parsed, not stored and not trusted. A
 *    webhook says only *poll sooner*; the poll then reads the truth from the platform's own API
 *    over an authenticated channel. That caps what a forged call can do at "made us do work we
 *    were going to do anyway", instead of "wrote a payment status onto a real invoice".
 *  - **It answers before it works.** Platforms time webhooks out and retry, and a retry storm is
 *    the last thing a slow poll needs. The poll is fired and not awaited.
 *  - **It is debounced**, because a public endpoint that triggers outbound work is otherwise an
 *    amplifier.
 *
 * None of this makes the webhook load-bearing, and that is the design. Polling on a timer remains
 * the mechanism; this only shortens the wait. If every webhook were dropped on the floor the
 * system would be slower and still correct.
 */

import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdpSyncService } from './pdp-sync.service';
import { shouldPoll, webhookTokenMatches } from './webhook-token';

@Controller('pdp/webhooks')
export class PdpWebhookController {
  private readonly logger = new Logger(PdpWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: PdpSyncService,
  ) {}

  /**
   * Notification from a platform that there is something to fetch.
   *
   * 202, always, for anything authentic: we have accepted the notice, and whether it produced a
   * poll is our business rather than the platform's. Reporting "already polled" as an error would
   * have a well-behaved platform retrying a call that succeeded.
   *
   * The token is read from a header, falling back to a query parameter, because plenty of webhook
   * configurations offer only a URL. The header is preferred and documented as such: a token in a
   * URL lands in access logs and proxy logs on the way here.
   */
  @Post(':connectionId')
  @HttpCode(202)
  async receive(
    @Param('connectionId') connectionId: string,
    @Headers('x-webhook-token') headerToken: string | undefined,
    @Query('token') queryToken: string | undefined,
  ): Promise<{ accepted: true; polled: boolean }> {
    const presented = headerToken ?? queryToken ?? '';

    const connection = await this.prisma.pdpConnection.findUnique({
      where: { id: connectionId },
    });

    // No such connection, or one nobody has configured a webhook for. Indistinguishable on
    // purpose: "exists but has no webhook" is not a fact worth confirming to an unauthenticated
    // caller, and the operator configuring it is looking at the settings screen, not at this.
    if (!connection || !connection.webhookSecretHash) {
      throw new NotFoundException('Aucun webhook configuré pour ce raccordement.');
    }

    if (!webhookTokenMatches(presented, connection.webhookSecretHash)) {
      // 401 rather than another 404. The caller already holds an unguessable connection id, so
      // there is no secret left to protect by being vague - and "your token is wrong" is the one
      // thing that makes a misconfigured webhook debuggable from the platform's own logs.
      this.logger.warn(`Webhook refusé pour ${connectionId} : jeton invalide.`);
      throw new UnauthorizedException('Jeton de webhook invalide.');
    }

    // An inactive connection is one whose invoices are not going anywhere. Accepted so the
    // platform stops retrying, and deliberately not polled.
    if (!connection.active) {
      return { accepted: true, polled: false };
    }

    if (!shouldPoll(connection.lastWebhookAt)) {
      return { accepted: true, polled: false };
    }

    // Stamped before the poll, not after. The debounce exists to collapse a burst, and a burst
    // arrives while the first poll is still running - so the window has to open at the moment we
    // decide to act, not when the acting finishes.
    await this.prisma.pdpConnection.update({
      where: { id: connection.id },
      data: { lastWebhookAt: new Date() },
    });

    // Deliberately not awaited; see the file header. The catch is not optional - an unhandled
    // rejection here would take the process down, and `pollConnection` already records its own
    // failures on the connection.
    void this.sync
      .pollConnection(connection)
      .catch((error: unknown) =>
        this.logger.error(`Interrogation déclenchée par webhook en échec : ${String(error)}`),
      );

    return { accepted: true, polled: true };
  }
}
