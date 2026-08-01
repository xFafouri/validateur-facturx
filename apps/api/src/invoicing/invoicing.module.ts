import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MustangEngine } from '@facturx/core';
import { ArchivingModule } from '../archiving/archiving.module';
import { ISSUANCE_ENGINE, IssuanceService } from './issuance.service';

/**
 * Phase 1: invoice creation, Factur-X generation, self-validation.
 *
 * Generation reuses the totals logic in `@facturx/core` rather than recomputing amounts, so that
 * what we emit is checked by the same arithmetic that validates what we receive.
 *
 * No controller yet, deliberately. Issuing an invoice is an authenticated, tenant-scoped action,
 * and there is no authentication layer to scope it by - exposing an unauthenticated route that
 * writes to a tenant's archive would be the wrong seam to leave open.
 */
@Module({
  imports: [ArchivingModule],
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
