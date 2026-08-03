import { Global, Module } from '@nestjs/common';
import { resolveMailConfig, type MailConfig } from '@facturx/mail';

/** Injection token: `MailConfig` is an interface and cannot be one itself. */
export const MAIL_CONFIG = Symbol('MAIL_CONFIG');

/**
 * Outbound mail.
 *
 * Global, because more than one context will send eventually - invitations today, transmission
 * failures and status notifications later - and having each re-provide it invites one of them to
 * quietly construct its own with different settings.
 *
 * Resolved once at boot rather than per call, so a misconfigured relay fails where a deployment
 * notices it instead of on the first invitation somebody sends.
 */
@Global()
@Module({
  providers: [{ provide: MAIL_CONFIG, useFactory: (): MailConfig => resolveMailConfig() }],
  exports: [MAIL_CONFIG],
})
export class MailModule {}
