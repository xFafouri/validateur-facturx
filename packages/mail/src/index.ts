/**
 * `@facturx/mail` - outbound transactional mail.
 *
 * A transport port with three drivers, and the French messages this product sends. Shared by the
 * web app (password reset, which belongs with the sign-in flows it neighbours) and the API (user
 * invitations, which belong with user management).
 */

export {
  ConsoleMailTransport,
  MemoryMailTransport,
  UnavailableMailTransport,
} from './transport.js';
export type { MailMessage, MailTransport } from './transport.js';

export { SmtpMailTransport } from './smtp.js';
export type { SmtpOptions } from './smtp.js';

export { resolveMailConfig } from './config.js';
export type { MailConfig } from './config.js';

export { invitationMessage, passwordChangedMessage, passwordResetMessage } from './templates.js';
export type { LinkMessageInput } from './templates.js';
