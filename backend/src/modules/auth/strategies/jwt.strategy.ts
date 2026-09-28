import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.module';
import { AuthUser } from '../../../common/interfaces/auth-user.interface';
import { ROLE_PERMISSIONS, RoleKey, PERM } from '../../../common/constants';
import { UserStatus } from '@prisma/client';

interface JwtPayload {
  sub: string;
  email: string;
  sid: string;
  sv: number;
  roles: RoleKey[];
  permissions: string[];
}

/** Reads the bearer token, or the access cookie as a fallback for browser flows. */
const cookieExtractor = (req: Request): string | null => {
  if (req?.cookies && typeof req.cookies['anwar_at'] === 'string') return req.cookies['anwar_at'];
  return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'change-me-access-secret-min-32-characters-long',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<AuthUser> {
    // Session revocation check — cheap Redis cache in front of PostgreSQL.
    const cacheKey = `auth:sess:${payload.sid}`;
    const cached = await this.redis.getJson<{ revoked: boolean; v: number }>(cacheKey);
    let revoked = cached?.revoked ?? false;

    if (cached === null) {
      const session = await this.prisma.session.findUnique({
        where: { id: payload.sid },
        select: { revokedAt: true, absoluteExpiresAt: true, idleExpiresAt: true },
      });
      revoked =
        !session ||
        session.revokedAt !== null ||
        session.absoluteExpiresAt < new Date() ||
        session.idleExpiresAt < new Date();
      await this.redis.setJson(cacheKey, { revoked, v: 1 }, revoked ? 300 : 60);
    }

    if (revoked) throw new UnauthorizedException('Session ended');

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, status: UserStatus.ACTIVE },
      include: {
        roles: { select: { role: { select: { code: true } } } },
        scopes: {
          select: {
            roleId: true,
            departmentId: true,
            businessUnitId: true,
            role: { select: { code: true } },
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException('Account is not active');
    if (user.sessionVersion !== payload.sv) throw new UnauthorizedException('Session ended');

    // Sliding idle timeout (§NFR-SEC-05): a request extends the session.
    const idleMinutes = Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES ?? 30);
    void this.prisma.session
      .update({
        where: { id: payload.sid },
        data: { lastSeenAt: new Date(), idleExpiresAt: new Date(Date.now() + idleMinutes * 60_000) },
      })
      .catch(() => undefined);

    const roles = user.roles.map((r) => r.role.code) as RoleKey[];
    const permissions = Array.from(new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? [])));

    const group = roles.some((r) =>
      ([PERM.DASHBOARD_GROUP] as string[]).length > 0 &&
      (r === ('SUPER_ADMIN' as RoleKey) || r === ('HR_ADMIN' as RoleKey) || r === ('MGMT_VIEWER' as RoleKey)),
    );

    const departmentIds = new Set<string>();
    const businessUnitIds = new Set<string>();
    if (!group) {
      user.scopes.forEach((s) => {
        if (s.departmentId) departmentIds.add(s.departmentId);
        if (s.businessUnitId) businessUnitIds.add(s.businessUnitId);
      });
      if (roles.includes('DEPT_HEAD' as RoleKey) && user.departmentId) departmentIds.add(user.departmentId);
    }

    const ownOnly =
      !group &&
      departmentIds.size === 0 &&
      businessUnitIds.size === 0 &&
      !permissions.includes(PERM.KPI_VIEW_OTHERS);

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      employeeCode: user.employeeCode,
      roles,
      permissions,
      scope: {
        group,
        departmentIds: Array.from(departmentIds),
        businessUnitIds: Array.from(businessUnitIds),
        ownOnly,
      },
      businessUnitId: user.businessUnitId,
      departmentId: user.departmentId,
      sessionId: payload.sid,
      sessionVersion: user.sessionVersion,
      breakGlassAccess: user.breakGlassAccess,
      organisationConfirmed: user.organisationConfirmed,
    };
  }
}

