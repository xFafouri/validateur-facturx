'use server';

import { redirect } from 'next/navigation';
import { passwordChangedMessage } from '@facturx/mail';
import { setPasswordWithToken } from '@facturx/auth';
import { getPrisma, isDatabaseConfigured } from '@/lib/db';
import { getMail } from '@/lib/mail';
import type { SetPasswordState } from '@/lib/form-state';

/**
 * Sets a password from an emailed link.
 *
 * Serves both purposes — a forgotten password and a new user's first one — because they are the
 * same act with different copy. The purpose travels in the form rather than being inferred, so a
 * reset link cannot activate an invitation or the reverse; `setPasswordWithToken` checks it
 * against what the token was issued for.
 *
 * No session is opened on success. Someone who has just changed a password because they think
 * they were compromised should sign in deliberately, and a reset link that logs you straight in is
 * a reset link that logs *whoever holds it* straight in.
 *
 * Success **redirects** rather than rendering a confirmation in place. It has to: this page's
 * server component re-checks the token on every render, and by the time the success state came
 * back the token had been consumed - so the page rendered "ce lien a déjà été utilisé" over a
 * password change that had just worked. Post-redirect-get removes the contradiction rather than
 * papering over it, and it lands the user where they need to go next.
 */
export async function setPassword(
  _state: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const purpose = formData.get('purpose') === 'INVITATION' ? 'INVITATION' : 'PASSWORD_RESET';

  if (password !== String(formData.get('passwordConfirm') ?? '')) {
    return { error: 'Les deux mots de passe ne correspondent pas.', done: false };
  }

  if (!isDatabaseConfigured()) {
    return {
      error: 'Le service est momentanément indisponible. Réessayez plus tard.',
      done: false,
    };
  }

  const outcome = await setPasswordWithToken(getPrisma(), { token, password, purpose });
  if (!outcome.ok) return { error: outcome.message, done: false };

  // After the fact, and never with a link in it: a "was this you?" email with a button is the
  // shape of a phishing message, and training people to click those is the opposite of helpful.
  if (purpose === 'PASSWORD_RESET') {
    try {
      await getMail().transport.send(
        passwordChangedMessage({ to: outcome.email, recipientName: outcome.name }),
      );
    } catch (error) {
      // The password is already changed. Failing the action now would tell the user it did not
      // work, which is worse than a missing notification.
      console.error('[reset] confirmation mail failed', error);
    }
  }

  // Throws to unwind, so it must be the last thing here and outside any catch.
  redirect(purpose === 'INVITATION' ? '/connexion?acces=active' : '/connexion?motdepasse=modifie');
}
