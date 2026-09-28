import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { AuthUser, RequestContextMeta } from '../interfaces/auth-user.interface';
import { PERM, PermissionKey, ROLE, RoleKey } from '../constants';
import { Forbidden, Unauthorized } from '../errors/error-codes';
// ---------------------------------------------------------------- decorators

export const IS_PUBLIC_KEY = 'anwar:isPublic';
/** Marks a route as reachable without a JWT (login, register, set-password…). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'anwar:roles';
/** Restricts a route to the given role codes (any-of). */
export const Roles = (...roles: RoleKey[]) => SetMetadata(ROLES_KEY, roles);

export const PERMISSIONS_KEY = 'anwar:permissions';
/** Restricts a route to users holding every listed permission. */
export const Permissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSION_KEY = 'anwar:anyPermission';
export const AnyPermission = (...permissions: PermissionKey[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);

export const SKIP_AUDIT_KEY = 'anwar:skipAudit';
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);

/** Marks an endpoint where a System Administrator may break glass (audited). */
export const BREAK_GLASS_KEY = 'anwar:breakGlass';
export const BreakGlass = () => SetMetadata(BREAK_GLASS_KEY, true);

// ------------------------------------------------------------- param helpers

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | unknown => {
    const request = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);

export const RequestMeta = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContextMeta => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ||
      (request as unknown as { correlationId?: string }).correlationId;
    return {
      ip:
        (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
        request.ip ||
        undefined,
      userAgent: request.headers['user-agent'],
      correlationId,
    };
  },
);

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.headers['idempotency-key'] as string | undefined;
  },
);

export const IfMatch = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.headers['if-match'] as string | undefined;
  },
);

// ------------------------------------------------------------------- guards

/**
 * JWT authentication guard.
 *
 * Extends the Passport guard so the `jwt` strategy actually runs and populates
 * `request.user`; `@Public()` routes bypass it. It also enforces the §5.2 rule
 * that a System Administrator has no access to KPI content unless break-glass
 * access was explicitly granted (and audited).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser; path?: string; url?: string; baseUrl?: string }>();
    const user = request.user;
    if (!user) return false;

    // §5.2 — the System Administrator role holds no KPI permissions. KPI content
    // is reachable only through an explicitly granted, audited break-glass route.
    const onlySystemAdmin = user.roles.length > 0 && user.roles.every((r) => r === ROLE.SYS_ADMIN);
    const breakGlass = this.reflector.getAllAndOverride<boolean>(BREAK_GLASS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (onlySystemAdmin && breakGlass !== true) {
      const target = `${request.baseUrl ?? ''}${request.path ?? request.url ?? ''}`;
      const forbiddenPaths = ['/kpis', '/approvals', '/escalations', '/dashboard', '/reports', '/corrections', '/evidence', '/leaderboard'];
      if (forbiddenPaths.some((p) => target.includes(p))) {
        throw Forbidden('FORBIDDEN', 'System Administrators have no access to KPI content');
      }
    }

    return true;
  }

  handleRequest<TUser = AuthUser>(err: unknown, user: TUser | false, info: unknown): TUser {
    if (err || !user) {
      const message =
        info && typeof info === 'object' && 'message' in info
          ? String((info as { message?: string }).message)
          : 'Authentication required';
      throw Unauthorized(
        'AUTH-UNAUTHENTICATED',
        message.includes('expired') ? 'Your session has expired. Please sign in again.' : 'Authentication required',
      );
    }
    return user;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleKey[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) throw Unauthorized('AUTH-UNAUTHENTICATED', 'Authentication required');
    if (!required.some((role) => user.roles.includes(role))) {
      throw Forbidden('FORBIDDEN', 'Your role does not permit this action');
    }
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const all = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const any = this.reflector.getAllAndOverride<PermissionKey[]>(ANY_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if ((!all || all.length === 0) && (!any || any.length === 0)) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) throw Unauthorized('AUTH-UNAUTHENTICATED', 'Authentication required');

    if (all && all.length && !all.every((p) => user.permissions.includes(p))) {
      throw Forbidden('FORBIDDEN', 'Your role does not permit this action');
    }
    if (any && any.length && !any.some((p) => user.permissions.includes(p))) {
      throw Forbidden('FORBIDDEN', 'Your role does not permit this action');
    }
    return true;
  }
}

/** Guard used by the queue dashboard / health endpoints that require a raw token. */
@Injectable()
export class OpsTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.OPS_TOKEN;
    if (!expected) return false;
    const request = context.switchToHttp().getRequest<Request>();
    const provided = (request.headers['x-ops-token'] as string) || '';
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid operations token');
    }
    return true;
  }
}

export const APPROVER_ROLES: RoleKey[] = [ROLE.DEPT_HEAD, ROLE.SUPER_ADMIN];
export const ADMIN_ROLES: RoleKey[] = [ROLE.SUPER_ADMIN, ROLE.HR_ADMIN];
export const REPORTING_PERMISSIONS = PERM.REPORT_VIEW;
