/**
 * The boundary between "what we want to say" and "how it leaves the building".
 *
 * A port, for the same reason as `ArtifactStore` and `PdpProvider`: production sends through a
 * real relay, development must not, and tests must be able to read what was sent. None of those
 * three should be able to leak into the code that composes a message.
 *
 * The one property worth stating plainly: **mail carries personal data**. Every address in here
 * belongs to a real person, and for this product the recipients are French accountants and their
 * clients. The rest of the architecture is deliberate about keeping that data in the EU, and the
 * relay is the last mile where it can quietly leave - see the note on `SmtpTransport`.
 */

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text. Always present: some clients refuse HTML, and a reset link must survive that. */
  readonly text: string;
  readonly html?: string;
  /** Overrides the transport's default sender. Rarely wanted. */
  readonly from?: string;
  readonly replyTo?: string;
}

export interface MailTransport {
  /** Implementation key, for logs and diagnostics. */
  readonly key: string;

  /**
   * Sends a message.
   *
   * Rejects on failure. Callers decide whether that is fatal: a password reset that could not be
   * delivered must not report success, while a notification usually should not fail the action
   * that triggered it.
   */
  send(message: MailMessage): Promise<void>;
}

/**
 * Development driver. Writes the message to the log and delivers nothing.
 *
 * The default when no relay is configured, and deliberately not a silent no-op: a reset link that
 * vanished without trace is indistinguishable from a broken flow, so the link is printed where a
 * developer will find it.
 */
export class ConsoleMailTransport implements MailTransport {
  readonly key = 'console';

  constructor(private readonly log: (line: string) => void = console.info) {}

  async send(message: MailMessage): Promise<void> {
    this.log(
      [
        '',
        '──────────────── courriel (non envoyé) ────────────────',
        `À       : ${message.to}`,
        `Objet   : ${message.subject}`,
        '',
        message.text,
        '───────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
}

/** Test driver. Keeps everything it was given so a test can assert on what was sent. */
export class MemoryMailTransport implements MailTransport {
  readonly key = 'memory';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** The most recent message to an address, or null. */
  lastTo(address: string): MailMessage | null {
    for (let index = this.sent.length - 1; index >= 0; index -= 1) {
      const message = this.sent[index]!;
      if (message.to.toLowerCase() === address.toLowerCase()) return message;
    }
    return null;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/**
 * A transport that refuses to send.
 *
 * For a deployment that has mail-dependent features enabled but no relay configured: failing
 * loudly at the point of send beats appearing to work. Not the default, because the default has
 * to keep a developer's machine usable.
 */
export class UnavailableMailTransport implements MailTransport {
  readonly key = 'unavailable';

  // The parameter is unused but declared, so this is callable wherever a `MailTransport` is - an
  // implementation that narrows its own signature is not a drop-in for the thing it replaces.
  async send(_message: MailMessage): Promise<void> {
    throw new Error(
      "Aucun service d'envoi d'e-mails n'est configuré (SMTP_HOST). Le message n'a pas été envoyé.",
    );
  }
}
