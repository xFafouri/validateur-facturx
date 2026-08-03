/**
 * What each role may do.
 *
 * The three roles were modelled from the start and enforced nowhere, which meant every signed-in
 * user of a tenant could see and do everything. For a product where one cabinet holds several
 * unrelated businesses' books, that is not a missing feature but a liability: the whole point of
 * `CLIENT_USER` is a login you can hand to a client without handing them their neighbours' books.
 *
 * Two separate mechanisms, deliberately not conflated:
 *
 *  - **Permissions** answer "may this role perform this kind of action at all". Coarse, static,
 *    and expressed as one table below so the answer is readable rather than scattered across
 *    twenty `if` statements.
 *  - **Scope** answers "on which client businesses". Only `CLIENT_USER` is scoped, and scope is a
 *    predicate applied to every query - never a filter applied to results afterwards, for the same
 *    reason tenant isolation is not.
 *
 * A permission check that passes still tells you nothing about scope. Both are always required.
 */

import type { UserRole } from '@prisma/client';

/**
 * Every distinct thing a caller can attempt.
 *
 * Named for the action rather than the route, so that adding a second way to issue an invoice
 * cannot accidentally arrive with different rules from the first.
 */
export type Permission =
  | 'clientOrg:read'
  | 'clientOrg:create'
  | 'invoice:read'
  | 'invoice:issue'
  | 'invoice:receive'
  | 'invoice:download'
  | 'user:manage';

/**
 * The matrix.
 *
 * - `OWNER` — the cabinet's principal. Everything, and the only role that can manage users:
 *   granting access to a tenant's books is not a routine act.
 * - `ACCOUNTANT` — staff. Everything operational, across all of the tenant's client businesses,
 *   but cannot create logins or change what anyone else can see.
 * - `CLIENT_USER` — a login handed to an end client. Confined to the businesses it is assigned,
 *   and cannot issue: issuing writes an entry into a ten-year legal archive under the cabinet's
 *   numbering sequence, and a restricted login doing that unsupervised is the risk this role
 *   exists to avoid. Receiving is allowed, because dropping in a supplier's invoice is exactly
 *   the errand you want a client doing for themselves.
 */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  OWNER: [
    'clientOrg:read',
    'clientOrg:create',
    'invoice:read',
    'invoice:issue',
    'invoice:receive',
    'invoice:download',
    'user:manage',
  ],
  ACCOUNTANT: [
    'clientOrg:read',
    'clientOrg:create',
    'invoice:read',
    'invoice:issue',
    'invoice:receive',
    'invoice:download',
  ],
  CLIENT_USER: ['clientOrg:read', 'invoice:read', 'invoice:receive', 'invoice:download'],
};

/** Roles that see every client business of their tenant. */
const UNSCOPED_ROLES: readonly UserRole[] = ['OWNER', 'ACCOUNTANT'];

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** French labels, for a user-management screen and for error copy. */
export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  OWNER: 'Propriétaire',
  ACCOUNTANT: 'Collaborateur',
  CLIENT_USER: 'Client',
};

export const ROLE_DESCRIPTIONS: Readonly<Record<UserRole, string>> = {
  OWNER:
    'Accès complet, y compris la gestion des utilisateurs et des accès. Réservé aux responsables du cabinet.',
  ACCOUNTANT:
    'Accès à toutes les entreprises clientes du compte : émission, réception, archives. Ne gère pas les utilisateurs.',
  CLIENT_USER:
    'Accès limité aux entreprises qui lui sont attribuées. Peut consulter et déposer des factures reçues, mais pas en émettre.',
};

/**
 * Whether a role's access is limited to specific client businesses.
 *
 * Kept as a function of the role rather than "has scope rows", so that a `CLIENT_USER` with no
 * assignment sees nothing rather than everything. Failing closed matters here: the empty case is
 * exactly what a half-finished invitation looks like.
 */
export function isScopedRole(role: UserRole): boolean {
  return !UNSCOPED_ROLES.includes(role);
}

/** The acting user, as far as authorisation is concerned. */
export interface Authorisable {
  readonly role: UserRole;
  /**
   * Client businesses this user may reach, or `null` when unrestricted.
   *
   * An empty array is meaningfully different from `null`: it means a scoped user with nothing
   * assigned yet, who must see nothing.
   */
  readonly clientOrgIds: readonly string[] | null;
}

/** Whether this user may touch a particular client business. */
export function isClientOrgAllowed(user: Authorisable, clientOrgId: string): boolean {
  if (user.clientOrgIds === null) return true;
  return user.clientOrgIds.includes(clientOrgId);
}

/**
 * The French refusal shown when a permission check fails.
 *
 * Says what is missing rather than only that something is - a collaborator who cannot invite a
 * colleague should learn that they need the owner, not just that they were refused.
 */
export function permissionDeniedMessage(role: UserRole, permission: Permission): string {
  const explanations: Partial<Record<Permission, string>> = {
    'user:manage':
      "La gestion des utilisateurs est réservée au propriétaire du compte. Demandez-lui d'effectuer cette action.",
    'invoice:issue':
      "Votre accès ne permet pas d'émettre des factures. Contactez le cabinet qui gère votre compte.",
    'clientOrg:create':
      "Votre accès ne permet pas d'ajouter une entreprise. Contactez le cabinet qui gère votre compte.",
  };

  return (
    explanations[permission] ?? `Votre rôle (${ROLE_LABELS[role]}) ne permet pas cette action.`
  );
}
