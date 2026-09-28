import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus, TokenType, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.module';
import { QueueService } from '../../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import {
  BusinessException,
  Conflict,
  ErrorCode,
  Forbidden,
  NotFound,
  Unauthorized,
  Unprocessable,
} from '../../common/errors/error-codes';
import { NT, ROLE, ROLE_HOME, ROLE_PERMISSIONS, RoleKey } from '../../common/constants';
import { hashPassword, verifyPassword, evaluatePasswordPolicy, needsRehash } from './password.util';
import { SCOPE_REBUILD } from '../../common/utils/scope-rebuild.util';

const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'anwargroup.net').toLowerCase();

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ helpers

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private randomToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private assertCompanyEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    const match = /^[a-z0-9._%+-]+@anwargroup\.net$/.test(normalized);
    if (!match) {
      throw Unprocessable(
        ErrorCode.V_EMAIL_01,
        'Please use your official @anwargroup.net e-mail address.',
        [{ field: 'email', code: ErrorCode.V_EMAIL_01, message: 'Only @anwargroup.net addresses can register.' }],
      );
    }
    if (!normalized.endsWith(`@${ALLOWED_DOMAIN}`)) {
      throw Unprocessable(ErrorCode.V_EMAIL_01, `Please use your official @${ALLOWED_DOMAIN} e-mail address.`);
    }
    return normalized;
  }

  private appUrl(path: string): string {
    const base = process.env.APP_URL || 'http://localhost:5173';
    return `${base.replace(/\/$/, '')}${path}`;
  }

  // -------------------------------------------------------------- FR-AUTH-01..04

  /** Self-registration: creates a Pending Activation account and e-mails the setup link. */
  async register(dto: {
    fullName: string;
    email: string;
    employeeCode: string;
    businessUnitId: string;
    departmentId: string;
    designationTitle?: string;
  }, meta: RequestContextMeta) {
    const email = this.assertCompanyEmail(dto.email);
    const employeeCode = dto.employeeCode.trim().toUpperCase();

    // FR-AUTH-03 — neutral duplicate message that does not reveal account data
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { employeeCode }] },
      select: { id: true },
    });
    if (existing) {
      await this.audit.record({
        action: 'auth.register.duplicate',
        entityType: 'user',
        entityId: existing.id,
        actorKind: 'ANONYMOUS',
        meta,
        reason: 'Duplicate registration attempt (neutral response returned)',
      });
      return {
        status: 'PENDING_ACTIVATION',
        message: 'An account with these details already exists. Use Forgot password or contact HR.',
      };
    }

    const department = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, businessUnitId: dto.businessUnitId, isActive: true },
      include: { businessUnit: { select: { name: true, code: true } } },
    });
    if (!department) {
      throw Unprocessable(ErrorCode.V_MISSING, 'The selected department does not belong to the selected business unit.', [
        { field: 'departmentId', code: ErrorCode.V_MISSING, message: 'Department does not match the chosen business unit' },
      ]);
    }

    const employeeRole = await this.prisma.role.findUnique({ where: { code: ROLE.EMPLOYEE } });
    if (!employeeRole) throw new Error('Role catalogue not seeded — run the seed script');

    const user = await this.prisma.user.create({
      data: {
        email,
        employeeCode,
        fullName: dto.fullName.trim(),
        status: UserStatus.PENDING_ACTIVATION,
        businessUnitId: dto.businessUnitId,
        departmentId: dto.departmentId,
        designationTitle: dto.designationTitle?.trim() || null,
        organisationConfirmed: false, // FR-ORG-09 — confirmed before the first submission
        roles: { create: { roleId: employeeRole.id } },
      },
    });

    await this.issueTokenAndSend(user.id, email, TokenType.ACTIVATION, {
      recipientName: user.fullName,
      businessUnit: department.businessUnit.name,
      department: department.name,
    });

    await this.audit.record({
      action: 'auth.register',
      entityType: 'user',
      entityId: user.id,
      actorKind: 'ANONYMOUS',
      employeeId: user.id,
      departmentId: user.departmentId,
      businessUnitId: user.businessUnitId,
      after: { email, employeeCode, businessUnit: department.businessUnit.name, department: department.name },
      meta,
    });

    return {
      status: 'PENDING_ACTIVATION',
      message: 'Check your inbox: a single-use setup link (valid 24 hours) has been sent.',
      userId: user.id,
    };
  }

  /** Issues a single-use token and queues the matching e-mail (NT-01 / NT-02 / NT-03). */
  private async issueTokenAndSend(
    userId: string | null,
    email: string,
    type: TokenType,
    context: Record<string, unknown>,
    ttlMinutes?: number,
  ): Promise<void> {
    const raw = this.randomToken();
    const ttl =
      ttlMinutes ??
      (type === TokenType.ACTIVATION ? 24 * 60 : type === TokenType.INVITATION ? 72 * 60 : 30);

    await this.prisma.token.create({
      data: {
        userId,
        email,
        type,
        tokenHash: this.hashToken(raw),
        expiresAt: new Date(Date.now() + ttl * 60_000),
        meta: context as Prisma.InputJsonValue,
      },
    });

    const path =
      type === TokenType.PASSWORD_RESET ? `/reset-password?token=${raw}` : `/set-password?token=${raw}`;

    const templateCode =
      type === TokenType.ACTIVATION
        ? NT.REGISTRATION_SUBMITTED
        : type === TokenType.INVITATION
          ? NT.INVITATION_CREATED
          : NT.PASSWORD_RESET_OR_LOCKOUT;

    const subject =
      templateCode === NT.REGISTRATION_SUBMITTED
        ? 'Set up your ANWAR KPIFlow password'
        : templateCode === NT.INVITATION_CREATED
          ? `You are invited to ANWAR KPIFlow${context.roleLabel ? ` as ${context.roleLabel}` : ''}`
          : 'Reset your ANWAR KPIFlow password';

    const log = await this.prisma.emailLog.create({
      data: {
        toEmail: email,
        subject,
        templateCode,
        payload: { ...context, setupUrl: this.appUrl(path) } as Prisma.InputJsonValue,
        status: 'QUEUED',
        userId: userId ?? undefined,
      },
    });

    await this.queue.enqueueEmail({
      emailLogId: log.id,
      to: email,
      templateCode,
      subjectOverride: subject,
      context: { ...context, setupUrl: this.appUrl(path) },
    });
  }

  // ------------------------------------------------------------------- FR-AUTH-05/06

  /** Validates the setup token, applies the password policy and activates the account. */
  async setPassword(token: string, password: string, confirmPassword: string, meta: RequestContextMeta) {
    if (password !== confirmPassword) {
      throw Unprocessable(ErrorCode.V_PASSWORD_01, 'The two passwords do not match.', [
        { field: 'confirmPassword', code: ErrorCode.V_PASSWORD_01, message: 'Passwords do not match' },
      ]);
    }

    const tokenHash = this.hashToken(token);
    const record = await this.prisma.token.findUnique({ where: { tokenHash } });
    if (!record || (record.type !== TokenType.ACTIVATION && record.type !== TokenType.INVITATION && record.type !== TokenType.PASSWORD_RESET)) {
      throw Unprocessable(ErrorCode.AUTH_TOKEN_INVALID, 'This link is not valid. Request a new one.');
    }
    if (record.usedAt) {
      throw Unprocessable(ErrorCode.AUTH_TOKEN_INVALID, 'This link has already been used. Request a new one.');
    }
    if (record.expiresAt < new Date()) {
      throw Unprocessable(ErrorCode.AUTH_TOKEN_EXPIRED, 'This link has expired. Request a new one.');
    }

    const user = record.userId
      ? await this.prisma.user.findUnique({ where: { id: record.userId } })
      : await this.prisma.user.findFirst({ where: { email: record.email ?? '' } });
    if (!user) throw NotFound(ErrorCode.NOT_FOUND, 'This link is not valid. Request a new one.');

    const policy = evaluatePasswordPolicy(password, user.email);
    if (!policy.valid) {
      throw Unprocessable(ErrorCode.V_PASSWORD_01, `Password policy: ${policy.failures.join('; ')}`, [
        { field: 'password', code: ErrorCode.V_PASSWORD_01, message: policy.failures.join('; ') },
      ]);
    }

    const passwordHash = await hashPassword(password);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          status: record.type === TokenType.PASSWORD_RESET ? user.status : UserStatus.ACTIVE,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          sessionVersion: { increment: record.type === TokenType.PASSWORD_RESET ? 1 : 0 },
          ...(record.type === TokenType.ACTIVATION || record.type === TokenType.INVITATION
            ? { organisationConfirmed: user.organisationConfirmed }
            : {}),
        },
      });
      await tx.token.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      if (record.type === TokenType.PASSWORD_RESET) {
        await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'Password reset' },
        });
      }
    });

    await this.audit.record({
      action: record.type === TokenType.PASSWORD_RESET ? 'auth.password.reset' : 'auth.activate',
      entityType: 'user',
      entityId: user.id,
      actorKind: 'ANONYMOUS',
      employeeId: user.id,
      meta,
    });

    // Mark the invitation accepted
    if (record.type === TokenType.INVITATION) {
      await this.prisma.invitation.updateMany({
        where: { email: user.email, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
    }

    return {
      email: user.email,
      message: 'Password created. You can now sign in.',
    };
  }

  /** Validates a setup token for the Set Password page (does not consume it). */
  async inspectToken(token: string) {
    const record = await this.prisma.token.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: { select: { email: true, fullName: true, employeeCode: true, status: true, businessUnit: { select: { name: true } }, department: { select: { name: true } }, roles: { select: { role: { select: { code: true, name: true } } } } } } },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      const expired = !!record && !record.usedAt && record.expiresAt < new Date();
      return { valid: false, expired, used: !!record?.usedAt, type: record?.type ?? null };
    }

    const meta = (record.meta ?? {}) as Record<string, unknown>;
    return {
      valid: true,
      type: record.type,
      email: record.user?.email ?? record.email,
      fullName: record.user?.fullName ?? null,
      readOnly: {
        roleLabel: record.type === TokenType.INVITATION ? String(meta.roleLabel ?? record.user?.roles?.[0]?.role.name ?? '') : null,
        businessUnit: record.user?.businessUnit?.name ?? String(meta.businessUnit ?? ''),
        department: record.user?.department?.name ?? String(meta.department ?? ''),
      },
    };
  }

  /** FR-AUTH-04 — resend is allowed after 60 s, up to 5 times per hour. */
  async resendActivation(email: string, meta: RequestContextMeta) {
    const normalized = email.trim().toLowerCase();
    const neutral = { message: 'If an account exists for that address, a new setup link has been sent.' };

    const key = `auth:resend:${normalized}`;
    const count = await this.redis.incrementWindow(key, 3600);
    if (count > 5) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, 'Too many resend attempts. Try again in an hour.', 429);
    }
    const lastKey = `auth:resend:last:${normalized}`;
    const last = await this.redis.getJson<number>(lastKey);
    if (last && Date.now() - last < 60_000) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, 'Please wait 60 seconds before requesting another link.', 429);
    }
    await this.redis.setJson(lastKey, Date.now(), 120);

    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      include: { department: { select: { name: true } }, businessUnit: { select: { name: true } } },
    });
    if (user && user.status === UserStatus.PENDING_ACTIVATION) {
      const raw = this.randomToken();
      await this.prisma.token.create({
        data: {
          userId: user.id,
          email: user.email,
          type: TokenType.ACTIVATION,
          tokenHash: this.hashToken(raw),
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        },
      });
      await this.prisma.invitation.updateMany({ where: { email: user.email }, data: { resendCount: { increment: 1 }, lastSentAt: new Date() } });
      await this.notifications.notify({
        code: NT.REGISTRATION_SUBMITTED,
        recipients: [{ userId: user.id, email: user.email, fullName: user.fullName }],
        title: 'Set up your ANWAR KPIFlow password',
        body: 'A new single-use setup link (valid 24 hours) is ready.',
        channel: 'EMAIL' as never,
        critical: true,
        emailContext: {
          setupUrl: this.appUrl(`/set-password?token=${raw}`),
          businessUnit: user.businessUnit?.name,
          department: user.department?.name,
        },
      });
      await this.audit.record({ action: 'auth.register.resend', entityType: 'user', entityId: user.id, actorKind: 'ANONYMOUS', meta });
    }
    return neutral;
  }

  // ---------------------------------------------------------------- FR-AUTH-07/08

  async login(dto: { email: string; password: string; rememberMe?: boolean }, meta: RequestContextMeta) {
    const email = dto.email.trim().toLowerCase();
    const genericError = () =>
      Unauthorized(ErrorCode.AUTH_INVALID_CREDENTIALS, 'E-mail or password is incorrect.');

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        roles: { select: { role: { select: { code: true } } } },
        scopes: { select: { roleId: true, departmentId: true, businessUnitId: true, role: { select: { code: true } } } },
        department: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true } },
      },
    });

    if (!user || !user.passwordHash) {
      await this.audit.record({
        action: 'auth.login.failure',
        entityType: 'user',
        actorKind: 'ANONYMOUS',
        after: { email, reason: 'unknown-account' },
        meta,
      });
      throw genericError();
    }

    if (user.status === UserStatus.INACTIVE) {
      await this.audit.record({ action: 'auth.login.failure', entityType: 'user', entityId: user.id, actorKind: 'ANONYMOUS', after: { email, reason: 'inactive' }, meta });
      throw Forbidden(ErrorCode.AUTH_ACCOUNT_INACTIVE, 'Your account is inactive. Contact HR.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new BusinessException(
        ErrorCode.AUTH_ACCOUNT_LOCKED,
        `Too many failed attempts. Try again in ${minutes} minute(s).`,
        423,
      );
    }

    if (user.status === UserStatus.PENDING_ACTIVATION) {
      throw Forbidden(
        ErrorCode.AUTH_RESET_REQUIRED,
        'Your account is not activated yet. Open the setup link in your e-mail, or request a new one.',
      );
    }

    const ok = await verifyPassword(user.passwordHash, dto.password);
    if (!ok) {
      const maxFailures = Number(process.env.LOGIN_MAX_FAILURES ?? 5);
      const lockMinutes = Number(process.env.LOGIN_LOCK_MINUTES ?? 15);
      const failures = user.failedLoginCount + 1;
      const lock = failures >= maxFailures;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failures,
          lockedUntil: lock ? new Date(Date.now() + lockMinutes * 60_000) : user.lockedUntil,
          status: lock ? UserStatus.LOCKED : user.status,
        },
      });

      await this.audit.record({
        action: lock ? 'auth.lockout' : 'auth.login.failure',
        entityType: 'user',
        entityId: user.id,
        actorKind: 'ANONYMOUS',
        after: { email, attempt: failures, locked: lock },
        meta,
      });

      if (lock) {
        await this.notifications.notify({
          code: NT.PASSWORD_RESET_OR_LOCKOUT,
          recipients: [{ userId: user.id, email: user.email, fullName: user.fullName }],
          title: 'Your account has been temporarily locked',
          body: `Five consecutive failed sign-in attempts were recorded. The account is locked for ${lockMinutes} minutes.`,
          critical: true,
          channel: 'BOTH' as never,
          severity: 'warning',
          emailContext: {
            lockedUntil: new Date(Date.now() + lockMinutes * 60_000).toISOString(),
          },
        });
      }

      throw genericError();
    }

    // Successful credentials
    const tokens = await this.issueSession(user, dto.rememberMe === true, meta);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        status: UserStatus.ACTIVE,
        lastLoginAt: new Date(),
        ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(dto.password) } : {}),
      },
    });

    await this.audit.record({
      action: 'auth.login.success',
      entityType: 'user',
      entityId: user.id,
      actor: { id: user.id, roles: user.roles.map((r) => r.role.code) as RoleKey[] },
      meta,
    });

    const principal = SCOPE_REBUILD(user, tokens.sessionId);

    return {
      ...tokens.tokens,
      user: this.publicUser(user),
      home: this.homeFor(principal.roles),
      permissions: principal.permissions,
      mustConfirmOrganisation: !user.organisationConfirmed,
    };
  }

  private homeFor(roles: RoleKey[]): string {
    const priority: RoleKey[] = [
      ROLE.SUPER_ADMIN,
      ROLE.HR_ADMIN,
      ROLE.MGMT_VIEWER,
      ROLE.SYS_ADMIN,
      ROLE.DEPT_HEAD,
      ROLE.EMPLOYEE,
    ];
    for (const role of priority) {
      if (roles.includes(role)) return ROLE_HOME[role];
    }
    return '/my-kpi';
  }

  private publicUser(user: {
    id: string;
    email: string;
    fullName: string;
    employeeCode: string;
    businessUnitId: string | null;
    departmentId: string | null;
    designationTitle?: string | null;
    corporatePhone?: string | null;
    status: UserStatus;
    organisationConfirmed?: boolean;
    roles?: Array<{ role: { code: string } }>;
    department?: { id: string; name: string } | null;
    businessUnit?: { id: string; name: string } | null;
    avatarUrl?: string | null;
    emailDigest?: boolean;
  }) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      employeeCode: user.employeeCode,
      status: user.status,
      corporatePhone: user.corporatePhone ?? null,
      designationTitle: user.designationTitle ?? null,
      businessUnitId: user.businessUnitId,
      departmentId: user.departmentId,
      businessUnit: user.businessUnit ?? null,
      department: user.department ?? null,
      organisationConfirmed: user.organisationConfirmed ?? true,
      avatarUrl: user.avatarUrl ?? null,
      emailDigest: user.emailDigest ?? false,
      roles: (user.roles ?? []).map((r) => r.role.code),
    };
  }

  private async issueSession(
    user: {
      id: string;
      email: string;
      fullName: string;
      employeeCode: string;
      businessUnitId: string | null;
      departmentId: string | null;
      breakGlassAccess: boolean;
      organisationConfirmed: boolean;
      sessionVersion: number;
      roles: Array<{ role: { code: string } }>;
      scopes: Array<{ roleId: string; departmentId: string | null; businessUnitId: string | null; role: { code: string } }>;
    },
    rememberMe: boolean,
    meta: RequestContextMeta,
    existingSessionId?: string,
  ): Promise<{ tokens: AuthTokens; sessionId: string }> {
    const accessTtl = process.env.JWT_ACCESS_TTL ?? '15m';
    const refreshTtl = process.env.JWT_REFRESH_TTL ?? '12h';
    const idleMinutes = Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES ?? 30);
    const absoluteHours = Number(process.env.SESSION_ABSOLUTE_TIMEOUT_HOURS ?? 12);

    const roles = user.roles.map((r) => r.role.code) as RoleKey[];
    const permissions = Array.from(new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? [])));

    const refreshToken = this.randomToken();
    const refreshTokenHash = this.hashToken(refreshToken);
    const now = Date.now();

    const absoluteExpiresAt = new Date(now + absoluteHours * 3600 * 1000);

    let sessionId = existingSessionId ?? '';
    if (existingSessionId) {
      await this.prisma.session.update({
        where: { id: existingSessionId },
        data: {
          refreshTokenHash,
          lastSeenAt: new Date(),
          idleExpiresAt: new Date(now + idleMinutes * 60_000),
          userAgent: meta.userAgent?.slice(0, 390),
          ipAddress: meta.ip?.slice(0, 60),
        },
      });
    } else {
      const session = await this.prisma.session.create({
        data: {
          userId: user.id,
          refreshTokenHash,
          userAgent: meta.userAgent?.slice(0, 390),
          ipAddress: meta.ip?.slice(0, 60),
          idleExpiresAt: new Date(now + idleMinutes * 60_000),
          absoluteExpiresAt,
        },
      });
      sessionId = session.id;
    }

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        sid: sessionId,
        sv: user.sessionVersion,
        roles,
        permissions,
      },
      { expiresIn: accessTtl as never, secret: process.env.JWT_ACCESS_SECRET },
    );

    return {
      tokens: {
        accessToken,
        refreshToken,
        accessTokenExpiresIn: parseDurationSeconds(accessTtl),
        refreshTokenExpiresAt: absoluteExpiresAt,
      },
      sessionId,
    };
  }

  /** FR-AUTH : rotating refresh token. Detects reuse of a revoked token (anomaly). */
  async refresh(refreshToken: string, meta: RequestContextMeta) {
    const hash = this.hashToken(refreshToken);
    let session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      include: {
        user: {
          include: {
            roles: { select: { role: { select: { code: true } } } },
            scopes: { select: { roleId: true, departmentId: true, businessUnitId: true, role: { select: { code: true } } } },
          },
        },
      },
    });

    /*
     * Rotation grace window.
     *
     * Refresh tokens rotate on every use, so two legitimate concurrent calls
     * (a double-mounted effect, a retried request, two tabs opening at once)
     * would make the second call look like token reuse. Rather than signing the
     * user out, the previous hash is remembered for a short window and the
     * caller is handed the current token instead.
     */
    let expiredForGraceOnly = false;
    if (!session) {
      const mappedSessionId = await this.redis.getJson<string>(`auth:rtprev:${hash}`);
      if (mappedSessionId) {
        session = await this.prisma.session.findUnique({
          where: { id: mappedSessionId },
          include: {
            user: {
              include: {
                roles: { select: { role: { select: { code: true } } } },
                scopes: { select: { roleId: true, departmentId: true, businessUnitId: true, role: { select: { code: true } } } },
              },
            },
          },
        });
        expiredForGraceOnly = Boolean(session);
      }
    }

    if (!session) {
      await this.audit.record({
        action: 'auth.token.refresh.anomaly',
        entityType: 'session',
        actorKind: 'ANONYMOUS',
        after: { reason: 'unknown-refresh-token' },
        meta,
      });
      throw Unauthorized(ErrorCode.AUTH_TOKEN_INVALID, 'Your session has ended. Please sign in again.');
    }

    if (session.revokedAt) {
      await this.audit.record({
        action: 'auth.token.refresh.anomaly',
        entityType: 'session',
        entityId: session.id,
        actorKind: 'ANONYMOUS',
        after: { reason: 'reuse-of-revoked-token', sessionId: session.id },
        meta,
      });
      throw Unauthorized(ErrorCode.AUTH_TOKEN_INVALID, 'Your session has ended. Please sign in again.');
    }

    if (session.absoluteExpiresAt < new Date()) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: 'Absolute timeout' } });
      throw Unauthorized(ErrorCode.AUTH_TOKEN_INVALID, 'Your session has expired. Please sign in again.');
    }

    if (session.idleExpiresAt < new Date()) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: 'Idle timeout' } });
      throw Unauthorized(ErrorCode.AUTH_TOKEN_INVALID, 'Your session ended after 30 minutes of inactivity. Please sign in again.');
    }

    if (session.user.status !== UserStatus.ACTIVE) {
      throw Forbidden(ErrorCode.AUTH_ACCOUNT_INACTIVE, 'Your account is inactive. Contact HR.');
    }

    if (expiredForGraceOnly) {
      this.logger.debug(`Refresh token rotation grace window used for session ${session.id}`);
    }

    const previousHash = session.refreshTokenHash;
    const { tokens } = await this.issueSession(session.user, false, meta, session.id);

    // Remember the hash we just replaced so a racing caller is not treated as an attacker.
    if (previousHash && previousHash !== this.hashToken(tokens.refreshToken)) {
      await this.redis.setJson(`auth:rtprev:${previousHash}`, session.id, 120);
    }

    return {
      ...tokens,
      user: this.publicUser(session.user),
      home: this.homeFor(session.user.roles.map((r) => r.role.code) as RoleKey[]),
      permissions: Array.from(
        new Set(
          (session.user.roles.map((r) => r.role.code) as RoleKey[]).flatMap((r) => ROLE_PERMISSIONS[r] ?? []),
        ),
      ),
    };
  }

  async logout(refreshToken: string | undefined, userId: string, sessionId: string, meta: RequestContextMeta) {
    if (refreshToken) {
      await this.prisma.session.updateMany({
        where: { refreshTokenHash: this.hashToken(refreshToken) },
        data: { revokedAt: new Date(), revokedReason: 'Logout' },
      });
    } else if (sessionId) {
      await this.prisma.session.updateMany({
        where: { id: sessionId, userId },
        data: { revokedAt: new Date(), revokedReason: 'Logout' },
      });
    }
    await this.audit.record({ action: 'auth.logout', entityType: 'user', entityId: userId, actor: { id: userId, roles: [] }, meta });
    return { message: 'Signed out.' };
  }

  /** FR-AUTH-08 — always a neutral confirmation; the link is valid 30 minutes and single-use. */
  async forgotPassword(email: string, meta: RequestContextMeta) {
    const normalized = email.trim().toLowerCase();
    const neutral = { message: 'If an account exists for that address, a reset link has been sent.' };

    const rateKey = `auth:forgot:${normalized}`;
    const count = await this.redis.incrementWindow(rateKey, 3600);
    if (count > 5) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, 'Too many reset requests. Try again later.', 429);
    }

    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) {
      await this.audit.record({ action: 'auth.password.reset.request', entityType: 'user', actorKind: 'ANONYMOUS', after: { email: normalized, found: false }, meta });
      return neutral;
    }

    const raw = this.randomToken();
    await this.prisma.token.create({
      data: {
        userId: user.id,
        email: user.email,
        type: TokenType.PASSWORD_RESET,
        tokenHash: this.hashToken(raw),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    await this.notifications.notify({
      code: NT.PASSWORD_RESET_OR_LOCKOUT,
      recipients: [{ userId: user.id, email: user.email, fullName: user.fullName }],
      title: 'Reset your ANWAR KPIFlow password',
      body: 'Use the link in this e-mail to choose a new password. It is valid for 30 minutes.',
      critical: true,
      channel: 'BOTH' as never,
      emailContext: { resetUrl: this.appUrl(`/reset-password?token=${raw}`) },
    });

    await this.audit.record({ action: 'auth.password.reset.request', entityType: 'user', entityId: user.id, actorKind: 'ANONYMOUS', meta });
    return neutral;
  }

  /** FR-PRF-04 — change password from the Profile screen. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
    meta: RequestContextMeta,
  ) {
    if (newPassword !== confirmPassword) {
      throw Unprocessable(ErrorCode.V_PASSWORD_01, 'The two passwords do not match.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw Unprocessable(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Your current password is incorrect.', [
        { field: 'currentPassword', code: ErrorCode.AUTH_INVALID_CREDENTIALS, message: 'Current password is incorrect' },
      ]);
    }
    const policy = evaluatePasswordPolicy(newPassword, user.email);
    if (!policy.valid) {
      throw Unprocessable(ErrorCode.V_PASSWORD_01, `Password policy: ${policy.failures.join('; ')}`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), sessionVersion: { increment: 1 } },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'Password changed' },
      });
    });

    await this.audit.record({ action: 'auth.password.change', entityType: 'user', entityId: userId, actor: { id: userId, roles: [] }, meta });
    return { message: 'Password updated. Sign in again with your new password.' };
  }

  async sessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, absoluteExpiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastSeenAt: true, idleExpiresAt: true, absoluteExpiresAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string, meta: RequestContextMeta) {
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw NotFound(ErrorCode.NOT_FOUND, 'Session not found');
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: 'Revoked by user' },
    });
    await this.audit.record({ action: 'auth.session.revoke', entityType: 'session', entityId: sessionId, actor: { id: userId, roles: [] }, meta });
    return { message: 'Session revoked.' };
  }

  /** Password policy preview for the live checklist (FR-AUTH-05). */
  policy(email?: string) {
    const sample = evaluatePasswordPolicy('', email);
    return {
      minLength: Number(process.env.PASSWORD_MIN_LENGTH ?? 10),
      maxLength: Number(process.env.PASSWORD_MAX_LENGTH ?? 64),
      rules: [
        { key: 'length', label: `${sample.checks.length ? '' : ''}10–64 characters` },
        { key: 'upper', label: 'At least one upper-case letter' },
        { key: 'lower', label: 'At least one lower-case letter' },
        { key: 'digit', label: 'At least one digit' },
        { key: 'symbol', label: 'At least one symbol' },
        { key: 'noEmailName', label: 'Must not contain your e-mail name' },
      ],
    };
  }
}

const parseDurationSeconds = (value: string): number => {
  const m = /^(\d+)([smhd])$/.exec(value.trim());
  if (!m) return 900;
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    default:
      return n * 86_400;
  }
};
