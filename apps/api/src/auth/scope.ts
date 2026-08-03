/**
 * Restricting a query to the client businesses a caller may reach.
 *
 * Scope is applied as a **predicate on the query**, never as a filter over results, for exactly
 * the reason the schema note gives about `tenantId`: a filter one level down a relation chain is
 * something a refactor can drop without any test noticing, and what it drops is one client's books
 * appearing in another's list.
 *
 * `null` scope means unrestricted, and produces no predicate. An *empty* scope means a restricted
 * user with nothing assigned, and must match nothing - so it produces `{ in: [] }` rather than
 * being treated as "no restriction". That distinction is the difference between a half-finished
 * invitation seeing nothing and seeing everything.
 *
 * ## Why these nest under `AND` rather than returning a bare key
 *
 * The first version returned `{ clientOrgId: { in: [...] } }` and `{ id: { in: [...] } }`, to be
 * spread into a `where`. Object spread means the last key wins, and both collided - each producing
 * something strictly worse than having no check:
 *
 *   - `{ id, tenantId, ...scope }` replaced the id being looked up, so asking for a business
 *     outside scope returned a *different* business with a 200;
 *   - `{ ...scope, ...(clientOrgId ? { clientOrgId } : {}) }` let a caller-supplied filter
 *     overwrite the scope predicate, which is a privilege escalation in three characters.
 *
 * Nesting under `AND` cannot collide with whatever the caller already put in the object.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { isClientOrgAllowed, type AuthenticatedUser } from '@facturx/auth';

/** A `where` fragment confining a query to the caller's client businesses. */
export function clientOrgScope(user: AuthenticatedUser): {
  AND?: { clientOrgId: { in: string[] } }[];
} {
  if (user.clientOrgIds === null) return {};
  return { AND: [{ clientOrgId: { in: [...user.clientOrgIds] } }] };
}

/** The same, for querying `ClientOrg` itself, where the column is the primary key. */
export function clientOrgIdScope(user: AuthenticatedUser): { AND?: { id: { in: string[] } }[] } {
  if (user.clientOrgIds === null) return {};
  return { AND: [{ id: { in: [...user.clientOrgIds] } }] };
}

/**
 * Refuses a caller acting on a client business outside their scope.
 *
 * 404 rather than 403 when the caller cannot see it at all: telling a restricted user that an id
 * exists but is not theirs confirms the existence of a business they have no business knowing
 * about. Reserved 403 for cases where they can already see the org and the *action* is refused.
 */
export function assertClientOrgInScope(user: AuthenticatedUser, clientOrgId: string): void {
  if (!isClientOrgAllowed(user, clientOrgId)) {
    throw new NotFoundException('Entreprise cliente introuvable.');
  }
}

/** Same check, phrased as a refusal for a write the caller can see but may not perform. */
export function assertClientOrgWritable(user: AuthenticatedUser, clientOrgId: string): void {
  if (!isClientOrgAllowed(user, clientOrgId)) {
    throw new ForbiddenException(
      'Cette entreprise ne fait pas partie de celles qui vous sont attribuées.',
    );
  }
}
