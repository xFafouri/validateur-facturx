'use server';

import { headers } from 'next/headers';
import { passwordResetMessage } from '@facturx/mail';
import { PASSWORD_RESET_TTL_MS, requestPasswordReset } from '@facturx/auth';
import { getPrisma, isDatabaseConfigured } from '@/lib/db';
import { getMail, mailLink } from '@/lib/mail';
import { checkRateLimit, clientKeyFromHeaders, type RateLimitConfig } from '@/lib/rate-limit';
import type { ResetRequestState } from '@/lib/form-state';

/**
 * Tighter than sign-in, because each attempt sends an email.
 *
 * The cost of abuse here is not guessing a password — it is using us to post mail to whoever the
 * attacker names, which burns our sending reputation as well as bothering a stranger.
 */
const RESET_LIMIT: RateLimitConfig = { capacity: 3, refillPerSecond: 1 / 300 };

/**
 * Starts a password reset.
 *
 * **Reports success unconditionally.** Whether the address has an account, is disabled, or was
 * never seen, the page says the same thing — otherwise the form becomes a way to ask "does this
 * business use that cabinet?", which for an accountancy product is the client list itself.
 *
 * A rate-limit refusal is the one visible difference, and it is keyed on the *caller* rather than
 * on the address, so it discloses nothing about the account either.
 */
export async function requestReset(
  _state: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = String(formData.get('email') ?? '').trim();
  if (email === '') return { error: 'Renseignez votre adresse e-mail.', submitted: false };

  const requestHeaders = await headers();
  if (!checkRateLimit(`reset:${clientKeyFromHeaders(requestHeaders)}`, RESET_LIMIT).allowed) {
    return { error: 'Trop de demandes. Réessayez dans quelques minutes.', submitted: false };
  }

  if (!isDatabaseConfigured()) {
    return {
      error: 'Le service est momentanément indisponible. Réessayez plus tard.',
      submitted: false,
    };
  }

  try {
    const { issued } = await requestPasswordReset(getPrisma(), email);
    if (issued) {
      const mail = getMail();
      await mail.transport.send(
        passwordResetMessage({
          to: issued.email,
          recipientName: issued.name,
          url: mailLink(`/reinitialiser-mot-de-passe?token=${encodeURIComponent(issued.token)}`),
          expiresInHours: Math.round(PASSWORD_RESET_TTL_MS / 3_600_000),
        }),
      );
    }
  } catch (error) {
    // Logged, never surfaced. Telling the caller that sending failed would distinguish "we tried"
    // — and therefore "this address has an account" — from "we did nothing".
    console.error('[reset] could not issue or send', error);
  }

  return { error: null, submitted: true };
}
