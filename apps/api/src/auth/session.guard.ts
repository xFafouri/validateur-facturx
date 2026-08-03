/**
 * Who is calling.
 *
 * The guard resolves the session cookie against the `Session` table itself, using the same
 * `@facturx/auth` code the web app uses. It does not accept an identity asserted by a header, and
 * there is no shared secret between the two tiers. That matters because the web app is a
 * privileged client but not a trusted one: if the API is ever reachable directly - a misconfigured
 * ingress, a pod-to-pod call, someone port-forwarding in production - the only thing that gets a
 * caller a tenant is a live session row.
 *
 * The tenant id therefore never comes from the request. A body may say `tenantId` all it likes;
 * nothing downstream reads it.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { readSessionToken, resolveSession, type AuthenticatedUser } from '@facturx/auth';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/** Property the guard writes the resolved caller onto. */
const CURRENT_USER = Symbol('facturx.currentUser');

type AuthenticatedRequest = Request & { [CURRENT_USER]?: AuthenticatedUser };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token = readSessionToken(request.headers.cookie);
    const user = await resolveSession(this.prisma, token);
    if (!user) {
      // One message for every failure - absent, expired, revoked, disabled. The distinction is of
      // no use to a legitimate client and of considerable use to an attacker.
      throw new UnauthorizedException('Authentification requise.');
    }

    request[CURRENT_USER] = user;
    return true;
  }
}

/**
 * The authenticated caller, for a handler behind `SessionGuard`.
 *
 * Throws rather than returning undefined when the guard has not run: a handler that reads this
 * without being guarded is a hole, and it should fail loudly in development rather than quietly
 * treat the request as anonymous.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request[CURRENT_USER];
    if (!user) {
      throw new Error(
        'CurrentUser used on a route that is not behind SessionGuard. Add @UseGuards(SessionGuard).',
      );
    }
    return user;
  },
);
