import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MustangEngine } from '@facturx/core';
import { ArchivingModule } from '../archiving/archiving.module';
import { ClientOrgsController } from './client-orgs.controller';
import { InvoicesController } from './invoices.controller';
import { ISSUANCE_ENGINE, IssuanceService } from './issuance.service';
import { ReceptionController } from './reception.controller';
import { ReceptionService } from './reception.service';

/**
 * Invoicing, both directions.
 *
 * Generation reuses the totals logic in `@facturx/core` rather than recomputing amounts, so that
 * what we emit is checked by the same arithmetic that validates what we receive.
 *
 * The controllers were held back until there was an authentication layer to scope them by, since
 * issuing writes into a tenant's ten-year legal archive. They are now behind `SessionGuard`,
 * which resolves the acting tenant from a session row rather than from anything in the request.
 *
 * Issuance and reception share this module because they share a table and an archive, but they
 * are opposites in the one way that matters: issuance refuses to record what it cannot verify,
 * reception records what it cannot verify *and says so*. See `ReceptionService`.
 */
@Module({
  imports: [ArchivingModule],
  controllers: [InvoicesController, ReceptionController, ClientOrgsController],
  providers: [
    IssuanceService,
    ReceptionService,
    {
      provide: ISSUANCE_ENGINE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new MustangEngine({
          baseUrl: config.get<string>('VALIDATOR_URL') ?? 'http://127.0.0.1:8081',
        }),
    },
  ],
  exports: [IssuanceService, ReceptionService],
})
export class InvoicingModule {}
