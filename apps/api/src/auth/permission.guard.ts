/**
 * What the caller may do, once `SessionGuard` has established who they are.
 *
 * Two guards rather than one because they answer different questions and fail differently: an
 * unauthenticated request is a 401 and should sign in, an authenticated one without the permission
 * is a 403 and signing in again will not help.
 *
 * Permission is only half of authorisation. It says a role may issue invoices in general; it says
 * nothing about *which* client businesses. Scope is a predicate on every query - see
 * `clientOrgScope` - and both are always required.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, permissionDeniedMessage, type Permission } from '@facturx/auth';
import type { Request } from 'express';
import { CURRENT_USER, type AuthenticatedRequest } from './session.guard';

const PERMISSION_KEY = 'facturx:permission';

/** Declares the permission a route requires. Read by `PermissionGuard`. */
export const RequirePermission = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_KEY, permission);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No declaration means no permission requirement. Deliberate: the guard is opt-in per route,
    // and a route that needs one says so. `SessionGuard` still applies.
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const user = request[CURRENT_USER];
    if (!user) {
      // Reachable only by wiring PermissionGuard without SessionGuard, which is a programming
      // error rather than a request the caller can fix.
      throw new Error('PermissionGuard requires SessionGuard to have run first.');
    }

    if (!can(user.role, required)) {
      throw new ForbiddenException(permissionDeniedMessage(user.role, required));
    }
    return true;
  }
}
