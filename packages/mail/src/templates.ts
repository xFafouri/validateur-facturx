/**
 * The messages this product sends.
 *
 * Plain text is written first and is never optional. A reset link has to work in a client that
 * strips HTML, in a text-only reader, and when forwarded by someone whose mail client mangles
 * markup - and it is the version that reaches a screen reader cleanly.
 *
 * The HTML is deliberately plain: inline styles, a table-free layout, no images, no web fonts, no
 * tracking pixel. Mail clients render a small and inconsistent subset of CSS, and a transactional
 * message has one job. Nothing here loads a remote resource, so opening one of these emails
 * discloses nothing to us.
 *
 * All copy is French, like the rest of the product.
 */

import type { MailMessage } from './transport.js';

/** How long a user has to act, stated in the message so the deadline is not a surprise. */
export interface LinkMessageInput {
  readonly to: string;
  readonly url: string;
  readonly expiresInHours: number;
  /** The account the link belongs to, for a recipient who manages several. */
  readonly tenantName?: string | null;
  readonly recipientName?: string | null;
}

/** Escapes text interpolated into the HTML part. Names and tenant names are user-controlled. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(
  heading: string,
  paragraphs: readonly string[],
  button: { url: string; label: string },
): string {
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 16px;line-height:1.6;color:#1e3a63;">${text}</p>`)
    .join('');

  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1e3a63;max-width:520px;margin:0 auto;padding:24px;">',
    `<h1 style="font-size:18px;margin:0 0 20px;color:#0f1e33;">${escapeHtml(heading)}</h1>`,
    body,
    `<p style="margin:24px 0;"><a href="${button.url}" style="background:#152a48;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:4px;display:inline-block;font-weight:600;">${escapeHtml(button.label)}</a></p>`,
    `<p style="margin:0 0 16px;line-height:1.6;color:#5682b6;font-size:13px;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><span style="word-break:break-all;">${button.url}</span></p>`,
    '<hr style="border:0;border-top:1px solid #e3eaf4;margin:24px 0;">',
    '<p style="margin:0;color:#5682b6;font-size:12px;line-height:1.6;">Ce message est automatique, merci de ne pas y répondre.</p>',
    '</div>',
  ].join('');
}

/**
 * Password reset.
 *
 * Sent to an address that asked for one. Says what to do if it was not them, because the one
 * person who must not be left guessing is someone whose account is being probed.
 */
export function passwordResetMessage(input: LinkMessageInput): MailMessage {
  const hours = input.expiresInHours;
  const greeting = input.recipientName ? `Bonjour ${input.recipientName},` : 'Bonjour,';

  const text = [
    greeting,
    '',
    'Vous avez demandé à réinitialiser le mot de passe de votre compte Factur-X.',
    '',
    'Ouvrez ce lien pour choisir un nouveau mot de passe :',
    input.url,
    '',
    `Ce lien est valable ${hours} heure${hours > 1 ? 's' : ''} et ne peut servir qu'une seule fois.`,
    '',
    "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message : votre mot de passe reste inchangé. Si cela se répète, changez-le par précaution.",
    '',
    'Ce message est automatique, merci de ne pas y répondre.',
  ].join('\n');

  return {
    to: input.to,
    subject: 'Réinitialisation de votre mot de passe',
    text,
    html: layout(
      'Réinitialisation de votre mot de passe',
      [
        escapeHtml(greeting),
        'Vous avez demandé à réinitialiser le mot de passe de votre compte Factur-X.',
        `Ce lien est valable <strong>${hours} heure${hours > 1 ? 's' : ''}</strong> et ne peut servir qu'une seule fois.`,
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
      ],
      { url: input.url, label: 'Choisir un nouveau mot de passe' },
    ),
  };
}

/**
 * Invitation to an account.
 *
 * Replaces the owner setting a password and reading it out over the phone. The invitee chooses
 * their own, which means the password is never known to anyone else and never sits in a chat log.
 */
export function invitationMessage(
  input: LinkMessageInput & { readonly invitedByName: string | null },
): MailMessage {
  const days = Math.round(input.expiresInHours / 24);
  const validity =
    input.expiresInHours >= 48
      ? `${days} jours`
      : `${input.expiresInHours} heure${input.expiresInHours > 1 ? 's' : ''}`;
  const account = input.tenantName ? ` « ${input.tenantName} »` : '';
  const inviter = input.invitedByName ? `${input.invitedByName} vous` : 'Vous';

  const text = [
    'Bonjour,',
    '',
    `${inviter} a donné accès au compte Factur-X${account}.`,
    '',
    'Ouvrez ce lien pour choisir votre mot de passe et activer votre accès :',
    input.url,
    '',
    `Ce lien est valable ${validity} et ne peut servir qu'une seule fois.`,
    '',
    "Si vous ne vous attendiez pas à cette invitation, ignorez ce message : aucun accès ne sera activé tant que le lien n'aura pas été utilisé.",
    '',
    'Ce message est automatique, merci de ne pas y répondre.',
  ].join('\n');

  return {
    to: input.to,
    subject: `Votre accès au compte Factur-X${account}`,
    text,
    html: layout(
      'Votre accès Factur-X',
      [
        `${escapeHtml(inviter)} a donné accès au compte Factur-X${escapeHtml(account)}.`,
        'Choisissez votre mot de passe pour activer votre accès.',
        `Ce lien est valable <strong>${validity}</strong> et ne peut servir qu'une seule fois.`,
        'Si vous ne vous attendiez pas à cette invitation, ignorez ce message : aucun accès ne sera activé.',
      ],
      { url: input.url, label: 'Choisir mon mot de passe' },
    ),
  };
}

/**
 * Confirmation that a password changed.
 *
 * Sent after the fact and to the address on the account, so that a change the owner did not make
 * is noticed by the person who can do something about it. Carries no link: a message saying
 * "was this you?" with a button is the shape of a phishing mail, and training people to click it
 * is the opposite of helpful.
 */
export function passwordChangedMessage(input: {
  readonly to: string;
  readonly recipientName?: string | null;
}): MailMessage {
  const greeting = input.recipientName ? `Bonjour ${input.recipientName},` : 'Bonjour,';

  const text = [
    greeting,
    '',
    'Le mot de passe de votre compte Factur-X vient d’être modifié, et toutes vos sessions ont été fermées.',
    '',
    "Si vous êtes à l'origine de ce changement, il n'y a rien à faire.",
    '',
    'Sinon, votre compte est peut-être compromis : réinitialisez immédiatement votre mot de passe depuis la page de connexion, et prévenez le responsable de votre compte.',
    '',
    'Ce message est automatique, merci de ne pas y répondre.',
  ].join('\n');

  return { to: input.to, subject: 'Votre mot de passe a été modifié', text };
}
