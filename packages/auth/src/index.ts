/**
 * `@facturx/auth` - password hashing and server-side sessions.
 *
 * Shared by the Next.js web app and the NestJS API. Both resolve a caller the same way, against
 * the same table, so the API never has to trust an identity asserted by the web tier.
 */

export {
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyPassword,
  WeakPasswordError,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SCRYPT_PARAMS,
} from './password.js';

export {
  clearSessionCookies,
  readSessionToken,
  secureCookiesEnabled,
  serialiseSessionCookie,
  sessionCookieName,
} from './cookie.js';
export type { CookieOptions } from './cookie.js';

export {
  createSession,
  hashSessionToken,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  tokensEqual,
  SESSION_ABSOLUTE_MAX_AGE_MS,
  SESSION_MAX_AGE_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from './session.js';
export type { AuthenticatedUser, IssuedSession, SessionDb, SessionOrigin } from './session.js';

export {
  checkCredentialToken,
  consumeCredentialToken,
  hashCredentialToken,
  issueCredentialToken,
  purgeExpiredCredentialTokens,
  ttlFor,
  INVITATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
} from './credential-tokens.js';
export type {
  CredentialTokenCheck,
  CredentialTokenFailure,
  CredentialTokenHolder,
  IssuedCredentialToken,
} from './credential-tokens.js';

export {
  requestPasswordReset,
  setPasswordWithToken,
  CREDENTIAL_FAILURE_MESSAGES,
} from './password-reset.js';
export type { ResetRequest, SetPasswordOutcome } from './password-reset.js';

export {
  can,
  isClientOrgAllowed,
  isScopedRole,
  permissionDeniedMessage,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
} from './permissions.js';
export type { Authorisable, Permission } from './permissions.js';

export {
  authenticate,
  looksLikeEmail,
  normaliseEmail,
  registerTenant,
  RegistrationError,
} from './accounts.js';
export type { AuthenticatedAccount, RegisteredAccount, RegisterRequest } from './accounts.js';
