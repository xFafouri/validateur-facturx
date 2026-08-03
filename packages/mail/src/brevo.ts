/**
 * Brevo's transactional HTTP API.
 *
 * An alternative to SMTP, over plain HTTPS, and usually the better one:
 *
 *  - **It works where SMTP does not.** Outbound 25/465/587 is blocked on most CI runners, many
 *    container platforms and a fair number of ISPs. Port 443 is open essentially everywhere, so
 *    the same configuration works in development, in CI and in production.
 *  - **The errors are legible.** A refused sender comes back as a JSON code and a sentence rather
 *    than a socket that times out, so a misconfiguration says what it is.
 *  - **No connection to hold.** One request, one response; nothing to pool or keep alive.
 *
 * SMTP remains supported and unchanged, because a self-hosted relay is a legitimate thing to want
 * and because this endpoint is Brevo-specific while SMTP is not.
 *
 * Note the path: `/v3/smtp/email` is the *transactional* endpoint despite the name. The campaign
 * API (`/v3/emailCampaigns`) is for marketing sends to contact lists, which is not what a password
 * reset is - using it would put reset links through a marketing pipeline with unsubscribe
 * footers and list membership.
 */

import type { MailMessage, MailTransport } from './transport.js';

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** Matches the SMTP driver: long enough for a slow API, short enough not to hang a page. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface BrevoOptions {
  readonly apiKey: string;
  /** Default sender, as `Name <address>` or a bare address. */
  readonly from: string;
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export interface MailAddress {
  readonly email: string;
  readonly name?: string;
}

/**
 * Splits `Factur-X <noreply@exemple.fr>` into its parts.
 *
 * The API wants them separately, unlike SMTP which takes the composed header. A bare address with
 * no display name is equally valid and stays nameless rather than being given an invented one.
 */
export function parseAddress(value: string): MailAddress {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return { email: value.trim() };

  const name = match[1]!.replace(/^["']|["']$/g, '').trim();
  const email = match[2]!.trim();
  return name === '' ? { email } : { email, name };
}

interface BrevoError {
  readonly code?: string;
  readonly message?: string;
}

/** What to check, per Brevo's documented error codes. */
function hintFor(status: number, body: BrevoError | null): string {
  if (status === 401) {
    // Brevo returns 401 both for a bad key and for a good key from an unlisted address, and the
    // two need opposite actions. Its message names the IP, so the distinction is readable.
    if (/ip address/i.test(body?.message ?? '')) {
      return "La clé est valide mais l'adresse IP sortante n'est pas autorisée sur le compte Brevo. Ajoutez-la dans Sécurité > Adresses IP autorisées (https://app.brevo.com/security/authorised_ips), ou désactivez la restriction par IP.";
    }
    return "Clé d'API refusée. Vérifiez BREVO_API_KEY : la clé d'API (xkeysib-…) n'est pas la clé SMTP (xsmtpsib-…).";
  }
  if (body?.code === 'invalid_parameter' && /sender/i.test(body.message ?? '')) {
    return "Expéditeur refusé. Brevo ne relaie que pour un expéditeur validé : validez l'adresse de MAIL_FROM dans « Senders, Domains & IPs », ou authentifiez le domaine.";
  }
  if (status === 402 || body?.code === 'not_enough_credits') {
    return "Crédits d'envoi épuisés sur le compte Brevo.";
  }
  if (status === 429) {
    return "Trop de requêtes : la limite d'envoi du compte est atteinte.";
  }
  return 'Vérifiez la clé d’API, l’expéditeur validé et les quotas du compte.';
}

export class BrevoHttpTransport implements MailTransport {
  readonly key = 'brevo-http';

  private readonly apiKey: string;
  private readonly from: MailAddress;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BrevoOptions) {
    this.apiKey = options.apiKey;
    this.from = parseAddress(options.from);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: MailMessage): Promise<void> {
    const sender = message.from ? parseAddress(message.from) : this.from;

    // `AbortSignal.timeout` rather than a manual race: it aborts the request itself, so a hung
    // response does not leave a socket open behind a promise nobody is waiting on any more.
    let response: Response;
    try {
      response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender,
          to: [parseAddress(message.to)],
          subject: message.subject,
          textContent: message.text,
          ...(message.html ? { htmlContent: message.html } : {}),
          ...(message.replyTo ? { replyTo: parseAddress(message.replyTo) } : {}),
          // Same intent as the SMTP driver's header: this is transactional, never a mailing.
          headers: { 'Auto-Submitted': 'auto-generated' },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `Envoi impossible via l'API Brevo — ${detail}. Vérifiez la connectivité sortante en HTTPS.`,
        { cause },
      );
    }

    if (response.ok) return;

    let body: BrevoError | null = null;
    try {
      body = (await response.json()) as BrevoError;
    } catch {
      // A non-JSON body (a gateway's HTML error page) is not worth surfacing verbatim.
    }

    throw new Error(
      `Envoi refusé par Brevo (HTTP ${response.status}${body?.code ? `, ${body.code}` : ''})` +
        `${body?.message ? ` : ${body.message}` : ''}. ${hintFor(response.status, body)}`,
    );
  }
}
