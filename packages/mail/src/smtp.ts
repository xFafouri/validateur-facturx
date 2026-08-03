/**
 * SMTP delivery, via nodemailer.
 *
 * Configured for Brevo by default (`smtp-relay.brevo.com:587`), which is a French provider hosting
 * in the EU. That is not a neutral choice: every address this sends to belongs to a French
 * accountant or one of their clients, and routing that through a US relay would reopen the
 * data-residency question the rest of the architecture is careful to close - the same reasoning
 * that made identity self-hosted rather than delegated. Any RFC-compliant relay works; the
 * defaults just save configuring the common case.
 *
 * ## Timeouts
 *
 * Short and explicit, because nodemailer's defaults are two minutes and a password-reset request
 * sits in front of a person waiting for a page. A relay that is down, or a network that blocks
 * outbound SMTP - which many do - must fail in seconds with something the logs can explain, not
 * hang the request until the browser gives up first.
 *
 * ## Port 587, not 465
 *
 * 587 with STARTTLS is what Brevo documents and what most networks allow outbound. `secure` is
 * therefore false *at connect time* and the connection is upgraded before credentials are sent -
 * which is why `requireTLS` is on: without it, a relay that failed to offer STARTTLS would get the
 * password in clear.
 */

import { createTransport, type Transporter } from 'nodemailer';
import type { MailMessage, MailTransport } from './transport.js';

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** Default `From`. Must be an address at a domain whose DNS carries your SPF and DKIM records. */
  readonly from: string;
  /** True only for implicit TLS on 465. Leave false for 587. */
  readonly secure?: boolean;
  /** Overrides the default timeouts. Milliseconds. */
  readonly timeoutMs?: number;
}

/** Long enough for a slow relay, short enough that a person is not left waiting on a dead one. */
const DEFAULT_TIMEOUT_MS = 10_000;

export class SmtpMailTransport implements MailTransport {
  readonly key = 'smtp';

  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly host: string;
  private readonly port: number;

  constructor(options: SmtpOptions) {
    this.from = options.from;
    this.host = options.host;
    this.port = options.port;
    this.transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? false,
      // Refuse to continue in the clear if the relay does not offer STARTTLS. Without this,
      // nodemailer would happily send the credentials unencrypted.
      requireTLS: options.secure ? false : true,
      auth: { user: options.user, pass: options.password },
      connectionTimeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      greetingTimeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      socketTimeout: (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) * 2,
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.sendMail(message);
    } catch (cause) {
      // Rewritten with the host in it. nodemailer's own message for a blocked port is a bare
      // "Connection timeout", which tells whoever reads the log nothing about what to check.
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `Envoi impossible via ${this.host}:${this.port} — ${detail}. Vérifiez que le relais est joignable (le port SMTP sortant est souvent bloqué) et que les identifiants sont corrects.`,
        { cause },
      );
    }
  }

  private async sendMail(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: message.from ?? this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo,
      // A transactional message must never be treated as a mailing. Some clients and filters key
      // off this header to suppress auto-replies, which is exactly right for a reset link.
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
  }

  /** Opens a connection and authenticates without sending. For a startup check or a CLI probe. */
  async verify(): Promise<void> {
    await this.transporter.verify();
  }
}
