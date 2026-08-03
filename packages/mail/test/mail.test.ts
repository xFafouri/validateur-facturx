import { describe, expect, it } from 'vitest';
import { BrevoHttpTransport, parseAddress } from '../src/brevo.js';
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

describe('parsing a sender', () => {
  it('splits a display name from the address, which the HTTP API wants separately', () => {
    expect(parseAddress('Factur-X <noreply@exemple.fr>')).toEqual({
      name: 'Factur-X',
      email: 'noreply@exemple.fr',
    });
  });

  /** A bare address stays nameless rather than being given an invented display name. */
  it('handles a bare address', () => {
    expect(parseAddress('noreply@exemple.fr')).toEqual({ email: 'noreply@exemple.fr' });
    expect(parseAddress('  <noreply@exemple.fr> ')).toEqual({ email: 'noreply@exemple.fr' });
  });

  it('strips quotes some clients put around a display name', () => {
    expect(parseAddress('"Cabinet Durand" <a@b.fr>')).toEqual({
      name: 'Cabinet Durand',
      email: 'a@b.fr',
    });
  });
});

describe('the Brevo HTTP transport', () => {
  const ok = () => new Response(JSON.stringify({ messageId: '<x@brevo>' }), { status: 201 });

  function transportWith(respond: () => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return respond();
    }) as unknown as typeof fetch;

    return {
      calls,
      transport: new BrevoHttpTransport({
        apiKey: 'xkeysib-test',
        from: 'Factur-X <noreply@exemple.fr>',
        fetchImpl,
      }),
    };
  }

  it('posts to the transactional endpoint, not the campaign one', async () => {
    const { transport, calls } = transportWith(ok);
    await transport.send({ to: 'marie@cabinet.fr', subject: 'Objet', text: 'Corps' });

    // `/v3/emailCampaigns` would put a reset link through a marketing pipeline, complete with
    // unsubscribe footer and list membership.
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0]!.url).not.toContain('emailCampaigns');
  });

  it('sends the key as a header and the message as Brevo expects it', async () => {
    const { transport, calls } = transportWith(ok);
    await transport.send({
      to: 'marie@cabinet.fr',
      subject: 'Réinitialisation',
      text: 'lien',
      html: '<p>lien</p>',
    });

    const { init } = calls[0]!;
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');

    const body = JSON.parse(String(init.body));
    expect(body.sender).toEqual({ name: 'Factur-X', email: 'noreply@exemple.fr' });
    expect(body.to).toEqual([{ email: 'marie@cabinet.fr' }]);
    expect(body.textContent).toBe('lien');
    expect(body.htmlContent).toBe('<p>lien</p>');
    expect(body.headers['Auto-Submitted']).toBe('auto-generated');
  });

  it('omits the HTML part when there is none', async () => {
    const { transport, calls } = transportWith(ok);
    await transport.send({ to: 'a@b.fr', subject: 's', text: 't' });
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty('htmlContent');
  });

  /**
   * Brevo answers 401 both for a bad key and for a good key from an unlisted address, and the two
   * need opposite actions - regenerating a key would not help the second at all.
   */
  it('tells an unlisted IP apart from a bad key', async () => {
    const unlisted = () =>
      new Response(
        JSON.stringify({
          code: 'unauthorized',
          message: 'We have detected you are using an unrecognised IP address 203.0.113.7.',
        }),
        { status: 401 },
      );
    await expect(
      transportWith(unlisted).transport.send({ to: 'a@b.fr', subject: 's', text: 't' }),
    ).rejects.toThrow(/adresse IP sortante n'est pas autorisée/);

    const badKey = () =>
      new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), {
        status: 401,
      });
    await expect(
      transportWith(badKey).transport.send({ to: 'a@b.fr', subject: 's', text: 't' }),
    ).rejects.toThrow(/xkeysib/);
  });

  it('names an unvalidated sender as the cause', async () => {
    const refused = () =>
      new Response(JSON.stringify({ code: 'invalid_parameter', message: 'Invalid sender email' }), {
        status: 400,
      });
    await expect(
      transportWith(refused).transport.send({ to: 'a@b.fr', subject: 's', text: 't' }),
    ).rejects.toThrow(/expéditeur validé/);
  });

  it('survives an error body that is not JSON', async () => {
    const html = () => new Response('<html>502 Bad Gateway</html>', { status: 502 });
    await expect(
      transportWith(html).transport.send({ to: 'a@b.fr', subject: 's', text: 't' }),
    ).rejects.toThrow(/HTTP 502/);
  });
});
