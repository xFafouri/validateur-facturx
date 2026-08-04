import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArchivingModule } from '../archiving/archiving.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { PdpController } from './pdp.controller';
import { PdpRegistryService } from './pdp-registry.service';
import { PdpSyncService } from './pdp-sync.service';
import { PdpWorker } from './pdp.worker';
import { TransmissionService } from './transmission.service';
import { SandboxPdpProvider } from './providers/sandbox.provider';
import { PDP_PROVIDERS } from './pdp-provider';

/**
 * Phase 2: transmission, inbound reception, lifecycle statuses.
 *
 * Providers are registered as a collection so a tenant's client orgs can sit on different
 * platforms simultaneously - the normal case for an accountant.
 *
 * ## The dependency runs one way
 *
 * This module imports `InvoicingModule`, and not the reverse. Inbound polling needs
 * `ReceptionService`, so the arrow has to point this way; the temptation is then to have issuance
 * call back into `TransmissionService.enqueue`, which would close the loop and need a
 * `forwardRef` to compile - the usual sign that two modules have been merged by accident.
 *
 * Instead, issuance knows nothing about platforms. It leaves an invoice in `VALIDATED`, and
 * `enqueuePending` sweeps for exactly that. The invoice's own state is the outbox. It also means
 * an invoice queued by a request that then died still gets sent, which a direct call would not
 * have given us.
 */
@Module({
  imports: [ArchivingModule, InvoicingModule],
  controllers: [PdpController],
  providers: [
    SandboxPdpProvider,
    {
      provide: PDP_PROVIDERS,
      // The sandbox accepts everything and delivers nothing. In production that is not a test
      // double, it is a silent hole where a client's invoices go - so it is kept out unless the
      // environment says otherwise, and says so loudly when it is in.
      useFactory: (config: ConfigService, sandbox: SandboxPdpProvider) => {
        const production = config.get<string>('NODE_ENV') === 'production';
        const forced = config.get<string>('PDP_SANDBOX_ENABLED') === 'true';
        if (!production || forced) {
          if (production) {
            new Logger('PdpModule').warn(
              'PDP_SANDBOX_ENABLED=true en production : les factures « transmises » ne quittent pas ce processus.',
            );
          }
          return [sandbox];
        }
        return [];
      },
      inject: [ConfigService, SandboxPdpProvider],
    },
    PdpRegistryService,
    TransmissionService,
    PdpSyncService,
    PdpWorker,
  ],
  exports: [PDP_PROVIDERS, PdpRegistryService, TransmissionService, PdpSyncService],
})
export class PdpModule {}
