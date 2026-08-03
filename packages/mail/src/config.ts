/**
 * Choosing a transport from the environment.
 *
 * One place, so the web app and the API cannot end up disagreeing about whether mail is on.
 *
 * The default when `SMTP_HOST` is unset is the console driver, not a failure. A developer running
 * the stack for the first time should be able to complete a password reset by reading the link out
 * of their terminal, without an account at any provider. Production sets `SMTP_HOST` and gets real
 * delivery; a deployment that wants a missing relay to be fatal sets `MAIL_TRANSPORT=unavailable`.
 */

import { SmtpMailTransport } from './smtp.js';
import { ConsoleMailTransport, UnavailableMailTransport, type MailTransport } from './transport.js';

/** Fallback sender. Overridden by `MAIL_FROM`, and must be a domain you control. */
const DEFAULT_FROM = 'Factur-X <noreply@localhost>';

export interface MailConfig {
  readonly transport: MailTransport;
  /** The `From` in use, so a diagnostics page can show it without reaching into the transport. */
  readonly from: string;
  /** Absolute base for links in emails. A reset link is useless as a relative path. */
  readonly baseUrl: string;
}

export function resolveMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const from = env.MAIL_FROM?.trim() || DEFAULT_FROM;
  const baseUrl = (env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');

  if (env.MAIL_TRANSPORT === 'unavailable') {
    return { transport: new UnavailableMailTransport(), from, baseUrl };
  }
  if (env.MAIL_TRANSPORT === 'console') {
    return { transport: new ConsoleMailTransport(), from, baseUrl };
  }

  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD ?? '';

  // A host with no credentials is a half-finished setup, and silently sending unauthenticated
  // would fail at the relay in a way that is tedious to diagnose. Say so here instead.
  if (host && (!user || password === '')) {
    throw new Error(
      'SMTP_HOST est défini mais SMTP_USER ou SMTP_PASSWORD manque. Complétez la configuration, ou retirez SMTP_HOST pour revenir à l’affichage en console.',
    );
  }

  if (!host || !user) {
    return { transport: new ConsoleMailTransport(), from, baseUrl };
  }

  const port = Number(env.SMTP_PORT ?? 587);
  return {
    transport: new SmtpMailTransport({
      host,
      port: Number.isFinite(port) ? port : 587,
      user,
      password,
      from,
      // 465 is implicit TLS; everything else (587, 2525) upgrades with STARTTLS.
      secure: port === 465,
    }),
    from,
    baseUrl,
  };
}
