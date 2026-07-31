import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ValidationModule } from './validation/validation.module';
import { InvoicingModule } from './invoicing/invoicing.module';
import { PdpModule } from './pdp/pdp.module';
import { ArchivingModule } from './archiving/archiving.module';
import { BillingModule } from './billing/billing.module';

/**
 * Bounded contexts, one module each.
 *
 * Only ValidationModule is implemented - it is the Phase 0 capability and is already exercised by
 * the public validator. The rest are wired as empty modules on purpose: it fixes the seams now,
 * while they are cheap to move, and makes the Phase 1-3 boundaries explicit rather than emergent.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ValidationModule,
    InvoicingModule,
    PdpModule,
    ArchivingModule,
    BillingModule,
  ],
})
export class AppModule {}
