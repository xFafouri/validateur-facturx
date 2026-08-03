/**
 * Forgetting a password, and setting a new one.
 *
 * The two halves are deliberately shaped differently, because they face different ways.
 *
 * **Requesting** faces the whole internet and must disclose nothing. Whether or not the address
 * has an account, the caller gets the same answer and the same work is done - the same discipline
 * as `authenticate`, and for the same reason: a cabinet's client list is exactly what an
 * enumeration oracle would hand over.
 *
 * **Completing** faces someone already holding a 256-bit secret from their own mailbox. There is
 * nothing left to protect by being vague, so failures are named: an expired link should say so.
 */

import type { PrismaClient } from '@prisma/client';
import {
  checkCredentialToken,
  consumeCredentialToken,
  issueCredentialToken,
  type CredentialTokenFailure,
  type IssuedCredentialToken,
} from './credential-tokens.js';
import { normaliseEmail } from './accounts.js';
import { hashPassword, passwordProblem } from './password.js';
import { revokeAllSessions } from './session.js';

export interface ResetRequest {
  /** Present only when there is an account to send to. Null otherwise, and the caller says nothing. */
  readonly issued:
    | (IssuedCredentialToken & {
        readonly email: string;
        readonly name: string | null;
      })
    | null;
}

/**
 * Starts a reset.
 *
 * Returns what to send, or null. **The caller must respond identically either way** - see the
 * route that uses this.
 *
 * A disabled account gets no link: it is not a way back in, and sending one would suggest it is.
 */
export async function requestPasswordReset(
  db: PrismaClient,
  emailInput: string,
  now: Date = new Date(),
): Promise<ResetRequest> {
  const email = normaliseEmail(emailInput);

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, disabledAt: true, passwordHash: true },
  });

  if (!user || user.disabledAt !== null) return { issued: null };

  const issued = await issueCredentialToken(db, {
    userId: user.id,
    purpose: 'PASSWORD_RESET',
    now,
  });

  return { issued: { ...issued, email: user.email, name: user.name } };
}

export type SetPasswordOutcome =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly email: string;
      readonly name: string | null;
    }
  | {
      readonly ok: false;
      readonly reason: CredentialTokenFailure | 'weak';
      readonly message: string;
    };

const FAILURE_MESSAGES: Record<CredentialTokenFailure, string> = {
  unknown:
    "Ce lien n'est pas valide. Il a peut-être été mal recopié, ou il a expiré depuis longtemps. Demandez-en un nouveau.",
  expired: 'Ce lien a expiré. Demandez-en un nouveau depuis la page de connexion.',
  used: 'Ce lien a déjà été utilisé. Si ce n’était pas vous, demandez immédiatement un nouveau lien.',
  superseded:
    'Ce lien a été remplacé par un plus récent. Utilisez le dernier e-mail reçu, ou demandez-en un nouveau.',
  disabled:
    'Ce compte est désactivé. Contactez le responsable du compte : réinitialiser le mot de passe ne le réactivera pas.',
};

/**
 * Sets a password from a one-time link, for either purpose.
 *
 * Three things happen together, and the order matters. The token is consumed *first*, so that two
 * simultaneous submissions cannot both set a password. Then the hash is written. Then every
 * session for that user is revoked - because a reset is what someone does when they think their
 * account is compromised, and leaving the attacker's session alive would defeat the entire point.
 */
export async function setPasswordWithToken(
  db: PrismaClient,
  input: {
    readonly token: string;
    readonly password: string;
    readonly purpose: 'PASSWORD_RESET' | 'INVITATION';
    readonly now?: Date;
  },
): Promise<SetPasswordOutcome> {
  const now = input.now ?? new Date();

  const check = await checkCredentialToken(db, input.token, input.purpose, now);
  if (!check.ok) {
    return { ok: false, reason: check.reason, message: FAILURE_MESSAGES[check.reason] };
  }

  // Checked before consuming: a weak password should leave the link usable, or the user is locked
  // out for a typo and has to start over from their mailbox.
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, reason: 'weak', message: problem };

  const passwordHash = await hashPassword(input.password);

  const consumed = await consumeCredentialToken(db, check.holder.tokenId, now);
  if (!consumed) {
    // Lost the race against a concurrent submission of the same link.
    return { ok: false, reason: 'used', message: FAILURE_MESSAGES.used };
  }

  await db.user.update({
    where: { id: check.holder.userId },
    data: { passwordHash },
  });

  await revokeAllSessions(db, check.holder.userId, now);

  return {
    ok: true,
    userId: check.holder.userId,
    email: check.holder.email,
    name: check.holder.name,
  };
}

export { FAILURE_MESSAGES as CREDENTIAL_FAILURE_MESSAGES };
