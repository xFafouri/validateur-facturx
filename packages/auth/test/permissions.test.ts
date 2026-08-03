import { describe, expect, it } from 'vitest';
import {
  can,
  isClientOrgAllowed,
  isScopedRole,
  permissionDeniedMessage,
  ROLE_PERMISSIONS,
  type Permission,
} from '../src/permissions.js';

describe('the permission matrix', () => {
  it('gives the owner everything', () => {
    const everything = [...new Set(Object.values(ROLE_PERMISSIONS).flat())] as Permission[];
    for (const permission of everything) {
      expect(can('OWNER', permission), permission).toBe(true);
    }
  });

  /** The one thing that separates an owner from a collaborator. */
  it('reserves user management to the owner', () => {
    expect(can('OWNER', 'user:manage')).toBe(true);
    expect(can('ACCOUNTANT', 'user:manage')).toBe(false);
    expect(can('CLIENT_USER', 'user:manage')).toBe(false);
  });

  /**
   * Issuing writes into a ten-year legal archive under the cabinet's numbering sequence. A login
   * handed to a client is exactly the one that should not be doing that unsupervised.
   */
  it('lets a client user read and receive but never issue', () => {
    expect(can('CLIENT_USER', 'invoice:read')).toBe(true);
    expect(can('CLIENT_USER', 'invoice:receive')).toBe(true);
    expect(can('CLIENT_USER', 'invoice:download')).toBe(true);
    expect(can('CLIENT_USER', 'invoice:issue')).toBe(false);
    expect(can('CLIENT_USER', 'clientOrg:create')).toBe(false);
  });

  it('gives a collaborator everything operational', () => {
    for (const permission of [
      'clientOrg:read',
      'clientOrg:create',
      'invoice:read',
      'invoice:issue',
      'invoice:receive',
      'invoice:download',
    ] as Permission[]) {
      expect(can('ACCOUNTANT', permission), permission).toBe(true);
    }
  });
});

describe('scoping', () => {
  it('scopes only the client role', () => {
    expect(isScopedRole('CLIENT_USER')).toBe(true);
    expect(isScopedRole('OWNER')).toBe(false);
    expect(isScopedRole('ACCOUNTANT')).toBe(false);
  });

  it('lets an unrestricted user reach anything', () => {
    expect(isClientOrgAllowed({ role: 'OWNER', clientOrgIds: null }, 'nimporte-quoi')).toBe(true);
  });

  it('confines a scoped user to their assignment', () => {
    const client = { role: 'CLIENT_USER' as const, clientOrgIds: ['org-a'] };
    expect(isClientOrgAllowed(client, 'org-a')).toBe(true);
    expect(isClientOrgAllowed(client, 'org-b')).toBe(false);
  });

  /**
   * Fails closed. An empty assignment is what a half-finished invitation looks like, and it has to
   * mean "nothing" rather than being mistaken for "unrestricted".
   */
  it('gives a scoped user with no assignment access to nothing', () => {
    expect(isClientOrgAllowed({ role: 'CLIENT_USER', clientOrgIds: [] }, 'org-a')).toBe(false);
  });
});

describe('refusal messages', () => {
  it('says who can do it instead of only that you cannot', () => {
    expect(permissionDeniedMessage('ACCOUNTANT', 'user:manage')).toContain('propriétaire');
    expect(permissionDeniedMessage('CLIENT_USER', 'invoice:issue')).toContain('cabinet');
  });

  it('falls back to naming the role for permissions with no bespoke copy', () => {
    expect(permissionDeniedMessage('CLIENT_USER', 'invoice:read')).toContain('Client');
  });
});
