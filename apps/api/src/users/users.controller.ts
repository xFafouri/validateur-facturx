/**
 * Managing who may reach a tenant's books.
 *
 * Owner-only, and every write is audited. Granting access to several unrelated businesses'
 * accounting records is not a routine setting, so this is the one area where `ACCOUNTANT` - who
 * can otherwise do everything operational - is refused.
 *
 * Three invariants are enforced here rather than trusted, because each of them is a way to lock a
 * tenant out of its own account or to quietly widen someone's access:
 *
 *  - a tenant always keeps at least one enabled owner, the last one included;
 *  - you cannot disable your own account;
 *  - client-org assignments are validated against the tenant's own orgs, so an id from another
 *    tenant cannot be attached to a user.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  hashPassword,
  isScopedRole,
  normaliseEmail,
  passwordProblem,
  revokeAllSessions,
  type AuthenticatedUser,
} from '@facturx/auth';
import type { UserRole } from '@prisma/client';
import { PermissionGuard, RequirePermission } from '../auth/permission.guard';
import { CurrentUser, SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Controller('users')
@UseGuards(SessionGuard, PermissionGuard)
@RequirePermission('user:manage')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) {
    const users = await this.prisma.user.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        disabledAt: true,
        lastLoginAt: true,
        createdAt: true,
        scopedClientOrgs: { select: { clientOrg: { select: { id: true, name: true } } } },
      },
    });

    return users.map((user) => ({
      ...user,
      scopedClientOrgs: user.scopedClientOrgs.map((scope) => scope.clientOrg),
      // Never exposed, and worth being explicit about: this endpoint returns no credential
      // material of any kind, not even a hint that one is set.
      isSelf: user.id === actor.userId,
    }));
  }

  @Post()
  @HttpCode(201)
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() body: CreateUserDto) {
    const email = normaliseEmail(body.email);

    const problem = passwordProblem(body.password);
    if (problem) throw new BadRequestException(problem);

    const clientOrgIds = await this.validateClientOrgs(
      actor.tenantId,
      body.role,
      body.clientOrgIds,
    );

    // Hashed before the transaction opens: scrypt takes ~100 ms by design, and holding a database
    // transaction across it holds a connection for the duration of a deliberate slowdown.
    const passwordHash = await hashPassword(body.password);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            email,
            name: body.name?.trim() || null,
            role: body.role,
            passwordHash,
            ...(clientOrgIds.length > 0
              ? { scopedClientOrgs: { create: clientOrgIds.map((id) => ({ clientOrgId: id })) } }
              : {}),
          },
          select: { id: true, email: true, role: true },
        });

        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'user.created',
            entityType: 'User',
            entityId: user.id,
            metadata: { email, role: body.role, clientOrgIds },
          },
        });

        return user;
      });

      return created;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        // The address is unique across the whole platform, not per tenant, because it is the
        // sign-in identifier. Say so rather than leaking whether it belongs to another tenant.
        throw new ConflictException(
          'Cette adresse e-mail est déjà utilisée. Choisissez-en une autre.',
        );
      }
      throw error;
    }
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
  ) {
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId: actor.tenantId },
      select: { id: true, role: true, disabledAt: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable.');

    // Disabling your own account locks you out and gains nothing; another owner can always do it
    // for you. Changing your *own* role is a different matter - handing over ownership is a real
    // thing people do - so it is allowed, subject to the invariant below.
    if (target.id === actor.userId && body.disabled === true) {
      throw new ForbiddenException(
        'Vous ne pouvez pas désactiver votre propre compte. Demandez à un autre propriétaire.',
      );
    }

    // Whether by demotion or by being disabled, the tenant must keep someone able to administer
    // it. Applies to the actor as much as to anyone else: the last owner cannot demote themselves.
    const losingOwner =
      target.role === 'OWNER' && ((body.role && body.role !== 'OWNER') || body.disabled === true);
    if (losingOwner) await this.assertAnotherOwnerRemains(actor.tenantId, target.id);

    const nextRole: UserRole = body.role ?? target.role;
    const clientOrgIds =
      body.clientOrgIds === undefined
        ? null
        : await this.validateClientOrgs(actor.tenantId, nextRole, body.clientOrgIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Replaced wholesale rather than merged: the caller sends the assignment they want, and a
      // merge would make removing an org impossible through this endpoint.
      if (clientOrgIds !== null) {
        await tx.clientOrgUser.deleteMany({ where: { userId: target.id } });
        if (clientOrgIds.length > 0) {
          await tx.clientOrgUser.createMany({
            data: clientOrgIds.map((clientOrgId) => ({ userId: target.id, clientOrgId })),
          });
        }
      }

      // Promoting to an unscoped role drops the assignments, so a later demotion cannot silently
      // restore access to businesses somebody has since decided they should not see.
      if (body.role !== undefined && !isScopedRole(body.role)) {
        await tx.clientOrgUser.deleteMany({ where: { userId: target.id } });
      }

      const user = await tx.user.update({
        where: { id: target.id },
        data: {
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.disabled !== undefined ? { disabledAt: body.disabled ? new Date() : null } : {}),
        },
        select: { id: true, email: true, role: true, disabledAt: true },
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'user.updated',
          entityType: 'User',
          entityId: user.id,
          metadata: {
            role: body.role ?? null,
            disabled: body.disabled ?? null,
            clientOrgIds: clientOrgIds ?? null,
          },
        },
      });

      return user;
    });

    // Access just changed, so any session the user already holds is now wrong. Sessions carry
    // scope resolved at request time, but a disabled user must be out immediately and a demoted
    // one must not keep a page open against the old rules.
    if (body.role !== undefined || body.disabled !== undefined || clientOrgIds !== null) {
      await revokeAllSessions(this.prisma, target.id);
    }

    return updated;
  }

  /** Refuses an operation that would leave the tenant with no enabled owner. */
  private async assertAnotherOwnerRemains(
    tenantId: string,
    excludingUserId: string,
  ): Promise<void> {
    const others = await this.prisma.user.count({
      where: { tenantId, role: 'OWNER', disabledAt: null, id: { not: excludingUserId } },
    });
    if (others === 0) {
      throw new ConflictException(
        "Ce compte doit conserver au moins un propriétaire actif. Nommez d'abord un autre propriétaire.",
      );
    }
  }

  /**
   * Checks that every assigned client org belongs to this tenant.
   *
   * Without this, an owner could attach another tenant's client org id to one of their users and
   * the scope predicate would happily let them read it - the predicate proves the user may see
   * *those ids*, not that the ids were legitimately theirs to grant.
   */
  private async validateClientOrgs(
    tenantId: string,
    role: UserRole,
    ids: readonly string[] | undefined,
  ): Promise<string[]> {
    if (!isScopedRole(role)) return [];
    if (!ids || ids.length === 0) return [];

    const unique = [...new Set(ids)];
    const found = await this.prisma.clientOrg.count({
      where: { tenantId, id: { in: unique } },
    });
    if (found !== unique.length) {
      throw new BadRequestException(
        "Une des entreprises sélectionnées n'existe pas dans votre compte.",
      );
    }
    return unique;
  }
}
