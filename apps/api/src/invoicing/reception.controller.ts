/**
 * Receiving invoices.
 *
 * Separate from `InvoicesController` because the two directions are different operations that
 * happen to share a table: issuing authors a document and refuses anything it cannot verify,
 * receiving records a document someone else authored and refuses almost nothing. Putting them on
 * one controller would invite the error mapping to be shared, and it must not be - a validation
 * failure means opposite things on the two paths.
 *
 * The upload is read straight from the request body rather than through a multipart parser: one
 * file, no fields, and adding Multer to the dependency tree to move a single blob is not a trade
 * worth making. The content type tells us which of the two forms it is.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Logger,
  PayloadTooLargeException,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@facturx/auth';
import { CurrentUser, SessionGuard } from '../auth/session.guard';
import {
  ReceptionService,
  UnreadableDocumentError,
  UnroutableInvoiceError,
} from './reception.service';

/** Matches the public validator's limit; a Factur-X PDF is normally well under a megabyte. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@Controller('invoices')
@UseGuards(SessionGuard)
export class ReceptionController {
  private readonly logger = new Logger(ReceptionController.name);

  constructor(private readonly reception: ReceptionService) {}

  /**
   * Records a received invoice.
   *
   * 200 rather than 201 when the document had already been received: nothing was created, and a
   * caller retrying after a timeout should be able to tell the difference.
   */
  @Post('reception')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async receive(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Buffer,
    @Query('filename') filename?: string,
    @Headers('x-source-channel') sourceChannel?: string,
  ) {
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    if (body.byteLength > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `Le fichier dépasse la taille maximale de ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} Mo.`,
      );
    }

    try {
      const result = await this.reception.receive({
        tenantId: user.tenantId,
        bytes: new Uint8Array(body),
        // Only ever used to label the document; never used to open a path.
        filename: (filename ?? 'facture').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120),
        sourceChannel: sourceChannel?.slice(0, 40) ?? 'upload',
        actorUserId: user.userId,
      });
      return result;
    } catch (error) {
      // 422, not 400: the request was well-formed, the *document* is the problem. Both cases are
      // things the user can act on, and both carry a French explanation of what to do.
      if (error instanceof UnreadableDocumentError) {
        throw new UnprocessableEntityException({ message: error.message, reason: 'unreadable' });
      }
      if (error instanceof UnroutableInvoiceError) {
        throw new UnprocessableEntityException({
          message: error.message,
          reason: 'unroutable',
          buyerName: error.buyerName,
          buyerIdentifiers: error.buyerIdentifiers,
        });
      }
      throw error;
    }
  }
}
