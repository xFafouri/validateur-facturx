/**
 * Registration and sign-in.
 *
 * These live beside the session code rather than in the web app because they are the two places
 * where a password is handled, and both the web app and any future admin tooling must handle it
 * identically. The web layer's job is HTTP: cookies, redirects, French error copy.
 */

import type { PrismaClient, UserRole } from '@prisma/client';
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from './password.js';

/**
 * Canonical form of an email address for storage and lookup.
 *
 * Lowercased and trimmed, and nothing more. Stripping dots or `+tags` is a Gmail-specific
 * convention that silently merges genuinely distinct addresses at other providers - and a
 * bookkeeping product is exactly where one firm legitimately uses `facturation+clientA@`.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deliberately permissive: the authoritative test of an address is that mail arrives at it. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationError';
  }
}

export interface RegisterRequest {
  /** The cabinet or business opening the account. */
  readonly tenantName: string;
  readonly email: string;
  readonly password: string;
  readonly name?: string | null;
  /** The tenant's own SIREN, when it has one. */
  readonly siren?: string | null;
}

export interface RegisteredAccount {
  readonly tenantId: string;
  readonly userId: string;
}

/**
 * Creates a tenant and its first user, who is always the OWNER.
 *
 * One transaction: a tenant with no user cannot be signed into and cannot be cleaned up through
 * the product, so a partial failure here would leave an orphan row that nobody can reach.
 */
export async function registerTenant(
  db: PrismaClient,
  request: RegisterRequest,
): Promise<RegisteredAccount> {
  const email = normaliseEmail(request.email);
  const tenantName = request.tenantName.trim();

  if (!looksLikeEmail(email)) throw new RegistrationError("L'adresse e-mail n'est pas valide.");
  if (tenantName === '') throw new RegistrationError('Le nom du compte est obligatoire.');

  const problem = passwordProblem(request.password);
  if (problem) throw new RegistrationError(problem);

  // Hashed before the transaction opens: scrypt takes ~100 ms by design, and holding a database
  // transaction open across it would be holding a connection for the duration of a deliberate
  // slowdown, on the one endpoint an attacker can call at will.
  const passwordHash = await hashPassword(request.password);

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new RegistrationError(
      'Un compte existe déjà pour cette adresse e-mail. Connectez-vous, ou utilisez une autre adresse.',
    );
  }

  try {
    return await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: tenantName, siren: request.siren?.trim() || null },
        select: { id: true },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          name: request.name?.trim() || null,
          role: 'OWNER',
          passwordHash,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          action: 'tenant.registered',
          entityType: 'Tenant',
          entityId: tenant.id,
          metadata: { email },
        },
      });

      return { tenantId: tenant.id, userId: user.id };
    });
  } catch (error) {
    // The uniqueness check above races: two submissions of the same form land together and both
    // see no existing row. The index is what actually decides, so its verdict is translated here
    // rather than surfacing as a Prisma error.
    if ((error as { code?: string }).code === 'P2002') {
      throw new RegistrationError('Un compte existe déjà pour cette adresse e-mail.');
    }
    throw error;
  }
}

export interface AuthenticatedAccount {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: UserRole;
}

/**
 * Checks an email and password.
 *
 * Returns null for every failure - no such address, wrong password, account disabled, no password
 * set - and always performs a full scrypt computation first, so the response says nothing about
 * which case it was. See `verifyPassword` for why that matters here specifically.
 */
export async function authenticate(
  db: PrismaClient,
  emailInput: string,
  password: string,
  now: Date = new Date(),
): Promise<AuthenticatedAccount | null> {
  const email = normaliseEmail(emailInput);

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      tenantId: true,
      role: true,
      passwordHash: true,
      disabledAt: true,
    },
  });

  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!ok || !user || user.disabledAt !== null) return null;

  // Opportunistic upgrade: the plaintext is in hand exactly once per sign-in, so this is the only
  // moment a digest made under weaker parameters can be strengthened without asking the user for
  // anything. Failure here must not fail the sign-in.
  const rehash =
    user.passwordHash && needsRehash(user.passwordHash) ? await hashPassword(password) : null;

  await db.user
    .update({
      where: { id: user.id },
      data: { lastLoginAt: now, ...(rehash ? { passwordHash: rehash } : {}) },
    })
    .catch(() => undefined);

  return { userId: user.id, tenantId: user.tenantId, role: user.role };
}
