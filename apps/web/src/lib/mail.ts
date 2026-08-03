/**
 * The mail transport for the web app, resolved once.
 *
 * Lazily, and cached on `globalThis` in development for the same reason as the Prisma client: hot
 * reload would otherwise open a new SMTP connection pool on every edit.
 *
 * Resolution can throw — a half-configured relay is a startup mistake worth surfacing — so it is
 * deliberately not done at module load. The public validator and the marketing pages share this
 * process and must not fail to render because a mail setting is wrong.
 */

import { resolveMailConfig, type MailConfig } from '@facturx/mail';

const globalForMail = globalThis as unknown as { facturxMail?: MailConfig };

export function getMail(): MailConfig {
  globalForMail.facturxMail ??= resolveMailConfig();
  return globalForMail.facturxMail;
}

/** Absolute URL for a link in an email. A relative path is useless once it has left the building. */
export function mailLink(path: string): string {
  return `${getMail().baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
