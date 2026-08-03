import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ValidationModule } from './validation/validation.module';
import { InvoicingModule } from './invoicing/invoicing.module';
import { PdpModule } from './pdp/pdp.module';
import { ArchivingModule } from './archiving/archiving.module';
import { BillingModule } from './billing/billing.module';

/**
 * Bounded contexts, one module each.
 *
 * Validation (Phase 0), authentication, invoicing and archiving (Phase 1) are implemented.
 * PdpModule and BillingModule are still wired as empty modules on purpose: it fixes the seams
 * now, while they are cheap to move, and makes the Phase 2-3 boundaries explicit rather than
 * emergent.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    PrismaModule,
    AuthModule,
    ValidationModule,
    InvoicingModule,
    PdpModule,
    ArchivingModule,
    BillingModule,
  ],
})
export class AppModule {}
