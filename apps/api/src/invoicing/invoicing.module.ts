import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MustangEngine } from '@facturx/core';
import { ArchivingModule } from '../archiving/archiving.module';
import { ClientOrgsController } from './client-orgs.controller';
import { InvoicesController } from './invoices.controller';
import { ISSUANCE_ENGINE, IssuanceService } from './issuance.service';

/**
 * Phase 1: invoice creation, Factur-X generation, self-validation.
 *
 * Generation reuses the totals logic in `@facturx/core` rather than recomputing amounts, so that
 * what we emit is checked by the same arithmetic that validates what we receive.
 *
 * The controllers were held back until there was an authentication layer to scope them by, since
 * issuing writes into a tenant's ten-year legal archive. They are now behind `SessionGuard`,
 * which resolves the acting tenant from a session row rather than from anything in the request.
 */
@Module({
  imports: [ArchivingModule],
  controllers: [InvoicesController, ClientOrgsController],
  providers: [
    IssuanceService,
    {
      provide: ISSUANCE_ENGINE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new MustangEngine({
          baseUrl: config.get<string>('VALIDATOR_URL') ?? 'http://127.0.0.1:8081',
        }),
    },
  ],
  exports: [IssuanceService],
})
export class InvoicingModule {}
