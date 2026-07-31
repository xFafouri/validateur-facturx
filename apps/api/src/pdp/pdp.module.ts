import { Module } from '@nestjs/common';
import { SandboxPdpProvider } from './providers/sandbox.provider';
import { PDP_PROVIDERS } from './pdp-provider';

/**
 * Phase 2: transmission, inbound reception, lifecycle statuses.
 *
 * Providers are registered as a collection so a tenant's client orgs can sit on different
 * platforms simultaneously - the normal case for an accountant.
 */
@Module({
  providers: [
    SandboxPdpProvider,
    {
      provide: PDP_PROVIDERS,
      useFactory: (sandbox: SandboxPdpProvider) => [sandbox],
      inject: [SandboxPdpProvider],
    },
  ],
  exports: [PDP_PROVIDERS],
})
export class PdpModule {}
