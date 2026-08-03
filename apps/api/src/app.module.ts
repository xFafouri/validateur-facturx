import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
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
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Resolved against the working directory, first match wins. The workspace root is where the
      // shared settings live - database, validator, archive, mail - and the API is normally run
      // from its own directory, so both are listed rather than assuming one.
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AuthModule,
    MailModule,
    UsersModule,
    ValidationModule,
    InvoicingModule,
    PdpModule,
    ArchivingModule,
    BillingModule,
  ],
})
export class AppModule {}
