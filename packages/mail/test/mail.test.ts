import { describe, expect, it } from 'vitest';
import { resolveMailConfig } from '../src/config.js';
import {
  ConsoleMailTransport,
  MemoryMailTransport,
  UnavailableMailTransport,
} from '../src/transport.js';
import {
  invitationMessage,
  passwordChangedMessage,
  passwordResetMessage,
} from '../src/templates.js';

const env = (values: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  values as NodeJS.ProcessEnv;

describe('choosing a transport', () => {
  /** A developer with no provider account must still be able to complete a reset. */
  it('falls back to the console when no relay is configured', () => {
    expect(resolveMailConfig(env({})).transport.key).toBe('console');
  });

  it('uses SMTP once a host and credentials are present', () => {
    const config = resolveMailConfig(
      env({
        SMTP_HOST: 'smtp-relay.brevo.com',
        SMTP_PORT: '587',
        SMTP_USER: 'user@smtp-brevo.com',
        SMTP_PASSWORD: 'secret',
      }),
    );
    expect(config.transport.key).toBe('smtp');
  });

  /**
   * A half-finished setup fails at the relay in a way that is tedious to diagnose. Better to
   * refuse at construction, where the message can say which variable is missing.
   */
  it('refuses a host with no credentials', () => {
    expect(() => resolveMailConfig(env({ SMTP_HOST: 'smtp.example.com' }))).toThrow(/SMTP_USER/);
    expect(() => resolveMailConfig(env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u' }))).toThrow(
      /SMTP_PASSWORD/,
    );
  });

  it('can be forced to fail rather than fall back', () => {
    expect(resolveMailConfig(env({ MAIL_TRANSPORT: 'unavailable' })).transport.key).toBe(
      'unavailable',
    );
  });

  it('takes the link base from the site URL, without a trailing slash', () => {
    expect(resolveMailConfig(env({ NEXT_PUBLIC_SITE_URL: 'https://exemple.fr/' })).baseUrl).toBe(
      'https://exemple.fr',
    );
  });
});

describe('the unavailable transport', () => {
  it('refuses loudly instead of silently dropping the message', async () => {
    await expect(
      new UnavailableMailTransport().send({ to: 'a@b.fr', subject: 's', text: 't' }),
    ).rejects.toThrow(/SMTP_HOST/);
  });
});

describe('the console transport', () => {
  /** A link that vanished without trace is indistinguishable from a broken flow. */
  it('prints the message body, so a developer can follow the link', async () => {
    const lines: string[] = [];
    await new ConsoleMailTransport((line) => lines.push(line)).send({
      to: 'marie@cabinet.fr',
      subject: 'Réinitialisation',
      text: 'https://exemple.fr/reinitialiser-mot-de-passe?token=abc',
    });

    const output = lines.join('\n');
    expect(output).toContain('marie@cabinet.fr');
    expect(output).toContain('token=abc');
  });
});

describe('the memory transport', () => {
  it('keeps what it was given, most recent per address', async () => {
    const transport = new MemoryMailTransport();
    await transport.send({ to: 'a@b.fr', subject: 'un', text: '1' });
    await transport.send({ to: 'a@b.fr', subject: 'deux', text: '2' });
    await transport.send({ to: 'c@d.fr', subject: 'trois', text: '3' });

    expect(transport.sent).toHaveLength(3);
    expect(transport.lastTo('a@b.fr')?.subject).toBe('deux');
    expect(transport.lastTo('A@B.FR')?.subject).toBe('deux');
    expect(transport.lastTo('inconnu@x.fr')).toBeNull();
  });
});

describe('the messages', () => {
  const link = 'https://exemple.fr/reinitialiser-mot-de-passe?token=abc123';

  /** Some clients strip HTML, and the link has to survive that. */
  it('always carries the link in the plain-text part', () => {
    const reset = passwordResetMessage({ to: 'a@b.fr', url: link, expiresInHours: 2 });
    expect(reset.text).toContain(link);
    expect(reset.html).toContain(link);

    const invite = invitationMessage({
      to: 'a@b.fr',
      url: link,
      expiresInHours: 168,
      invitedByName: 'Marie Durand',
    });
    expect(invite.text).toContain(link);
  });

  it('states how long the link lasts, in the units a human would use', () => {
    expect(passwordResetMessage({ to: 'a@b.fr', url: link, expiresInHours: 2 }).text).toContain(
      '2 heures',
    );
    expect(
      invitationMessage({ to: 'a@b.fr', url: link, expiresInHours: 168, invitedByName: null }).text,
    ).toContain('7 jours');
  });

  /** Names and tenant names are user-controlled and reach the HTML part. */
  it('escapes interpolated names', () => {
    const message = invitationMessage({
      to: 'a@b.fr',
      url: link,
      expiresInHours: 168,
      invitedByName: '<script>alert(1)</script>',
      tenantName: 'Cabinet & Associés',
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).toContain('&amp;');
  });

  it('tells the recipient what to do if it was not them', () => {
    const reset = passwordResetMessage({ to: 'a@b.fr', url: link, expiresInHours: 2 });
    expect(reset.text).toContain("n'êtes pas à l'origine");
  });

  /**
   * A "was this you?" message with a button is the shape of a phishing mail. Training people to
   * click those is the opposite of helpful, so this one carries no link at all.
   */
  it('sends the password-changed notice without any link', () => {
    const notice = passwordChangedMessage({ to: 'a@b.fr', recipientName: 'Marie' });
    expect(notice.text).toContain('Marie');
    expect(notice.text).not.toContain('http');
    expect(notice.html).toBeUndefined();
  });

  /**
   * No images, no web fonts, no tracking pixel. Opening one of these discloses nothing to us, and
   * the only URL in the whole message is the one the recipient is meant to click.
   */
  it('loads no remote resource', () => {
    const html = passwordResetMessage({ to: 'a@b.fr', url: link, expiresInHours: 2 }).html!;

    expect(html).not.toContain('<img');
    expect(html).not.toContain('src=');
    expect(html).not.toContain('@import');

    const urls = [...new Set(html.match(/https?:\/\/[^"'\s<]+/g) ?? [])];
    expect(urls).toEqual([link]);
  });
});
