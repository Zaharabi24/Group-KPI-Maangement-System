/**
 * Users & access administration — BRD §5, §6.2, §6.3
 * (FR-PRF-01..05, FR-ORG-02..09).
 *
 * Every read applies the caller's data scope (§5.3) through ScopeService and
 * every mutation is written to the append-only audit trail (BR-R11).
 */
import { Injectable, Logger } from '@nestjs/common';
import { InvitationStatus, KpiStatus, Prisma, RoleCode, TokenType, UserStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../../queue/queue.service';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { Conflict, ErrorCode, Forbidden, NotFound, Unprocessable } from '../../common/errors/error-codes';
import { AUDIT_ACTIONS, DEFAULT_PAGE_SIZE, NT, ROLE, ROLE_LABELS, RoleKey } from '../../common/constants';
import { startOfDayUtc } from '../../common/utils/period.util';

/** Roles that are not tied to a single department (§5.3 — departmentId = null). */
const GROUP_ROLES: RoleKey[] = [ROLE.SUPER_ADMIN, ROLE.HR_ADMIN, ROLE.MGMT_VIEWER, ROLE.SYS_ADMIN];

const COMPANY_EMAIL = /^[a-z0-9._%+-]+@anwargroup\.net$/;
const MOBILE_PHONE = /^(01[3-9]\d{8}|\+8801[3-9]\d{8})$/;
const INVITATION_TTL_HOURS = 72;
const HOUR_MS = 3_600_000;

// ----------------------------------------------------------------- interfaces

export interface ListUsersQuery {
  page?: string;
  size?: string;
  businessUnitId?: string;
  departmentId?: string;
  roleCode?: string;
  status?: string;
  search?: string;
  sort?: string;
  order?: string;
}

export interface UpdateProfileInput {
  corporatePhone?: string;
  emailDigest?: boolean;
  designationTitle?: string;
}

export interface InviteUserInput {
  fullName: string;
  email: string;
  employeeCode: string;
  businessUnitId: string;
  departmentId: string;
  roleCode: string;
  designationId?: string;
  designationTitle?: string;
}

export interface UpdateUserInput {
  fullName?: string;
  businessUnitId?: string;
  departmentId?: string;
  designationTitle?: string;
  designationId?: string;
}

export interface TransferUserInput {
  departmentId: string;
  reason: string;
}

export interface DeactivateUserInput {
  reason: string;
}

export interface BulkImportRow {
  fullName?: string;
  email?: string;
  employeeCode?: string;
  businessUnitCode?: string;
  departmentName?: string;
  roleCode?: string;
  designationTitle?: string;
}

export interface CreateDelegationInput {
  toUserId: string;
  departmentId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface ListDelegationsQuery {
  page?: string;
  size?: string;
  departmentId?: string;
  activeOnly?: string;
}

export interface DirectoryQuery {
  search?: string;
  departmentId?: string;
  limit?: string;
}

export interface ListInvitationsQuery {
  page?: string;
  size?: string;
  status?: string;
  search?: string;
}

/** Structural shape of a user row loaded with the profile relations. */
interface UserViewSource {
  id: string;
  email: string;
  fullName: string;
  employeeCode: string;
  status: UserStatus;
  corporatePhone: string | null;
  designationId: string | null;
  designationTitle: string | null;
  businessUnitId: string | null;
  departmentId: string | null;
  organisationConfirmed: boolean;
  emailDigest: boolean;
  avatarUrl: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  roles: Array<{ roleId: string; role: { code: RoleCode; name: string } }>;
  department: { id: string; code: string; name: string } | null;
  businessUnit: { id: string; code: string; name: string; shortName: string | null } | null;
  designation: { id: string; name: string } | null;
}

export interface ApproverView {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string;
  designationTitle: string | null;
  isPrimary: boolean;
  isSuperAdmin: boolean;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  // ------------------------------------------------------------- FR-PRF-01 · me

  /** Full profile + the approvers of the caller's department (FR-PRF-01). */
  async me(userId: string) {
    const user = await this.loadUser(userId);
    if (!user) throw NotFound(ErrorCode.NOT_FOUND, 'User not found.');

    const isDepartmentHead = user.roles.some((r) => r.role.code === ROLE.DEPT_HEAD);
    const departmentHeads = user.departmentId ? await this.approvers(user.departmentId, user.id) : [];

    let approvers = departmentHeads;
    if (isDepartmentHead) {
      // BR-R03 — a Department Head's own KPIs are approved by a Super Admin.
      const superAdmins = await this.superAdminApprovers();
      const superAdminIds = new Set(superAdmins.map((a) => a.id));
      approvers = [...superAdmins, ...departmentHeads.filter((head) => !superAdminIds.has(head.id))];
    }

    return { ...this.toUserView(user), isDepartmentHead, approvers };
  }

  /** FR-PRF-02..04 — self-service profile edits. */
  async updateProfile(userId: string, dto: UpdateProfileInput, meta: RequestContextMeta) {
    const user = await this.loadUser(userId);
    if (!user) throw NotFound(ErrorCode.NOT_FOUND, 'User not found.');

    const data: Prisma.UserUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (dto.corporatePhone !== undefined) {
      const corporatePhone = this.normalisePhone(dto.corporatePhone);
      if (corporatePhone !== user.corporatePhone) {
        data.corporatePhone = corporatePhone;
        before.corporatePhone = user.corporatePhone;
        after.corporatePhone = corporatePhone;
      }
    }
    if (dto.emailDigest !== undefined && dto.emailDigest !== user.emailDigest) {
      data.emailDigest = dto.emailDigest;
      before.emailDigest = user.emailDigest;
      after.emailDigest = dto.emailDigest;
    }
    if (dto.designationTitle !== undefined) {
      const designationTitle = dto.designationTitle.trim() || null;
      if (designationTitle !== user.designationTitle) {
        data.designationTitle = designationTitle;
        before.designationTitle = user.designationTitle;
        after.designationTitle = designationTitle;
      }
    }

    if (!Object.keys(data).length) return this.toUserView(user);

    const updated = await this.prisma.user.update({ where: { id: userId }, data });

    await this.audit.record({
      action: AUDIT_ACTIONS.USER_UPDATE,
      entityType: 'user',
      entityId: userId,
      actor: { id: user.id, roles: user.roles.map((r) => r.role.code) as RoleKey[] },
      employeeId: userId,
      departmentId: user.departmentId,
      businessUnitId: user.businessUnitId,
      before,
      after,
      changedFields: Object.keys(after),
      reason: 'Self-service profile update',
      meta,
    });

    const fresh = await this.loadUser(userId);
    return this.toUserView(fresh ?? user);
  }

  // -------------------------------------------------------------- FR-ORG-02/03

  /** Paginated user directory for the admin screens, scope-filtered. */
  async list(query: ListUsersQuery, actor: AuthUser) {
    const { page, size, skip, take } = this.paging(query.page, query.size);
    const filters: Prisma.UserWhereInput[] = [];

    if (query.businessUnitId) filters.push({ businessUnitId: query.businessUnitId });
    if (query.departmentId) filters.push({ departmentId: query.departmentId });

    if (query.roleCode) {
      const roleCode = query.roleCode.trim().toUpperCase() as RoleCode;
      if (!Object.values(RoleCode).includes(roleCode)) {
        throw Unprocessable(ErrorCode.V_MISSING, `Unknown role code ${query.roleCode}.`);
      }
      filters.push({ roles: { some: { role: { code: roleCode } } } });
    }

    if (query.status) {
      const status = query.status.trim().toUpperCase() as UserStatus;
      if (!Object.values(UserStatus).includes(status)) {
        throw Unprocessable(ErrorCode.V_MISSING, `Unknown user status ${query.status}.`);
      }
      filters.push({ status });
    }

    const search = query.search?.trim();
    if (search) {
      filters.push({
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { employeeCode: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.UserWhereInput = { AND: [this.scope.userScopeWhere(actor), ...filters] };
    const order: Prisma.SortOrder = query.order === 'desc' ? 'desc' : 'asc';
    const sort = query.sort ?? 'fullName';
    const orderBy: Prisma.UserOrderByWithRelationInput =
      sort === 'email'
        ? { email: order }
        : sort === 'employeeCode'
          ? { employeeCode: order }
          : sort === 'createdAt'
            ? { createdAt: order }
            : sort === 'status'
              ? { status: order }
              : { fullName: order };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          roles: { include: { role: true } },
          department: { select: { id: true, code: true, name: true } },
          businessUnit: { select: { id: true, code: true, name: true, shortName: true } },
          designation: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((user) => this.toUserView(user)),
      page,
      size,
      total,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  /** Single profile; 403 when the caller is outside their data scope (§5.3). */
  async get(id: string, actor: AuthUser) {
    const user = await this.loadUser(id);
    if (!user) throw NotFound(ErrorCode.NOT_FOUND, 'User not found.');
    this.assertInScope(actor, user);
    return this.toUserView(user);
  }

  /**
   * FR-ORG-02/03 — invite a user with a role.
   * UC-07 E1: when the e-mail already has an account the UI is told to offer
   * "add the role to that user instead".
   */
  async invite(dto: InviteUserInput, actor: AuthUser, meta: RequestContextMeta) {
    const email = dto.email.trim().toLowerCase();
    if (!COMPANY_EMAIL.test(email)) {
      throw Unprocessable(ErrorCode.V_EMAIL_01, 'Please use an official @anwargroup.net e-mail address.', [
        { field: 'email', code: ErrorCode.V_EMAIL_01, message: 'Only @anwargroup.net addresses can be invited.' },
      ]);
    }
    const employeeCode = dto.employeeCode.trim().toUpperCase();
    const role = await this.resolveRole(dto.roleCode);
    this.assertCanGrant(actor, role.code);

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return {
        existingUser: true,
        userId: existingUser.id,
        message: 'This e-mail already has an account. Add the role to that user instead.',
      };
    }
    const codeOwner = await this.prisma.user.findUnique({ where: { employeeCode }, select: { id: true } });
    if (codeOwner) throw Conflict(ErrorCode.CONFLICT, 'This employee code is already in use.');

    const department = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, businessUnitId: dto.businessUnitId, isActive: true },
      include: { businessUnit: { select: { id: true, code: true, name: true } } },
    });
    if (!department) {
      throw Unprocessable(ErrorCode.V_MISSING, 'The selected department does not belong to the selected business unit.', [
        {
          field: 'departmentId',
          code: ErrorCode.V_MISSING,
          message: 'Department does not match the chosen business unit',
        },
      ]);
    }
    if (dto.designationId) {
      const designation = await this.prisma.designation.findUnique({ where: { id: dto.designationId } });
      if (!designation) throw Unprocessable(ErrorCode.V_MISSING, 'The selected designation does not exist.');
    }

    const roleLabel = this.roleLabel(role.code);
    const rawToken = this.rawToken();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * HOUR_MS);
    const fullName = dto.fullName.trim();

    const created = await this.prisma.transaction(async (tx) => {
      // Supersede any earlier pending invitation for the same address.
      await tx.invitation.updateMany({
        where: { email, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.EXPIRED },
      });

      const user = await tx.user.create({
        data: {
          email,
          employeeCode,
          fullName,
          status: UserStatus.PENDING_ACTIVATION,
          organisationConfirmed: false, // FR-ORG-09 — confirmed before the first submission
          businessUnitId: department.businessUnitId,
          departmentId: department.id,
          designationId: dto.designationId ?? null,
          designationTitle: dto.designationTitle?.trim() || null,
          roles: { create: { roleId: role.id, grantedById: actor.id } },
        },
        select: { id: true },
      });

      const invitation = await tx.invitation.create({
        data: {
          email,
          employeeCode,
          fullName,
          businessUnitId: department.businessUnitId,
          departmentId: department.id,
          roleId: role.id,
          designation: dto.designationTitle?.trim() || null,
          status: InvitationStatus.PENDING,
          tokenHash,
          expiresAt,
          invitedById: actor.id,
          lastSentAt: new Date(),
        },
      });

      // Single-use INVITATION token, 72 hours (NT-02).
      await tx.token.create({
        data: {
          userId: user.id,
          email,
          type: TokenType.INVITATION,
          tokenHash,
          expiresAt,
          meta: { invitationId: invitation.id, roleLabel } as Prisma.InputJsonValue,
        },
      });

      // FR-ORG-02 — keep the approver helper and the data scope in sync.
      await this.syncDepartmentHeads(tx, user.id, [role.code], department.id);
      await this.syncRoleScopes(
        tx,
        user.id,
        [{ id: role.id, code: role.code }],
        department.businessUnitId,
        department.id,
      );

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.INVITE_CREATE,
          entityType: 'user',
          entityId: user.id,
          actor: { id: actor.id, roles: actor.roles },
          employeeId: user.id,
          departmentId: department.id,
          businessUnitId: department.businessUnitId,
          after: {
            email,
            employeeCode,
            fullName,
            roleCode: role.code,
            roleLabel,
            businessUnit: department.businessUnit.name,
            department: department.name,
          },
          meta,
        },
        tx,
      );

      return { userId: user.id, invitationId: invitation.id };
    });

    const sent = await this.sendInvitationEmail({
      userId: created.userId,
      email,
      fullName,
      roleLabel,
      businessUnit: department.businessUnit.name,
      department: department.name,
      rawToken,
    });
    if (!sent) this.logger.warn(`Invitation e-mail for ${email} could not be queued; a resend will be required.`);

    return {
      existingUser: false,
      userId: created.userId,
      invitationId: created.invitationId,
      message: 'Invitation sent. The setup link is valid for 72 hours.',
    };
  }

  async listInvitations(query: ListInvitationsQuery, actor: AuthUser) {
    const { page, size, skip, take } = this.paging(query.page, query.size);
    const filters: Prisma.InvitationWhereInput[] = [];

    if (query.status) {
      const status = query.status.trim().toUpperCase() as InvitationStatus;
      if (!Object.values(InvitationStatus).includes(status)) {
        throw Unprocessable(ErrorCode.V_MISSING, `Unknown invitation status ${query.status}.`);
      }
      filters.push({ status });
    }
    const search = query.search?.trim();
    if (search) {
      filters.push({
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { fullName: { contains: search, mode: 'insensitive' } },
          { employeeCode: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.InvitationWhereInput = {
      AND: [this.invitationScopeWhere(actor), ...filters],
    };

    const [rows, total] = await Promise.all([
      this.prisma.invitation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          businessUnit: { select: { id: true, code: true, name: true } },
          department: { select: { id: true, code: true, name: true } },
          invitedBy: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.invitation.count({ where }),
    ]);

    // Invitation.roleId has no relation in the schema — resolve labels separately.
    const roleIds = Array.from(new Set(rows.map((row) => row.roleId)));
    const roles = roleIds.length
      ? await this.prisma.role.findMany({ where: { id: { in: roleIds } } })
      : [];
    const roleMap = new Map(roles.map((role) => [role.id, role]));

    return {
      items: rows.map((row) => {
        const role = roleMap.get(row.roleId);
        return {
          ...row,
          role: role ? { code: role.code, label: this.roleLabel(role.code) } : null,
        };
      }),
      page,
      size,
      total,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  /** Regenerates the token, invalidates the previous link and re-sends NT-02. */
  async resendInvitation(id: string, actor: AuthUser, meta: RequestContextMeta) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id },
      include: {
        businessUnit: { select: { name: true } },
        department: { select: { name: true } },
      },
    });
    if (!invitation) throw NotFound(ErrorCode.NOT_FOUND, 'Invitation not found.');
    this.assertInvitationInScope(actor, invitation);

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw Conflict(ErrorCode.CONFLICT, 'This invitation has already been accepted.');
    }
    if (invitation.status === InvitationStatus.REVOKED) {
      throw Conflict(ErrorCode.CONFLICT, 'This invitation was revoked. Create a new invitation instead.');
    }

    const user = await this.prisma.user.findUnique({ where: { email: invitation.email } });
    if (user && user.status === UserStatus.INACTIVE) {
      throw Conflict(ErrorCode.CONFLICT, 'The linked account is inactive. Reactivate it or create a new invitation.');
    }

    const role = await this.prisma.role.findUnique({ where: { id: invitation.roleId } });
    const roleLabel = role ? this.roleLabel(role.code) : 'your role';
    const rawToken = this.rawToken();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * HOUR_MS);

    await this.prisma.transaction(async (tx) => {
      // Only the newest link may be used.
      await tx.token.updateMany({
        where: { email: invitation.email, type: TokenType.INVITATION, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.invitation.update({
        where: { id },
        data: {
          tokenHash,
          expiresAt,
          status: InvitationStatus.PENDING,
          resendCount: { increment: 1 },
          lastSentAt: new Date(),
        },
      });

      if (user) {
        await tx.token.create({
          data: {
            userId: user.id,
            email: invitation.email,
            type: TokenType.INVITATION,
            tokenHash,
            expiresAt,
            meta: { invitationId: id, roleLabel, resend: true } as Prisma.InputJsonValue,
          },
        });
      }

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.INVITE_RESEND,
          entityType: 'invitation',
          entityId: id,
          actor: { id: actor.id, roles: actor.roles },
          employeeId: user?.id ?? null,
          departmentId: invitation.departmentId,
          businessUnitId: invitation.businessUnitId,
          after: { resendCount: invitation.resendCount + 1, expiresAt },
          meta,
        },
        tx,
      );
    });

    await this.sendInvitationEmail({
      userId: user?.id ?? null,
      email: invitation.email,
      fullName: invitation.fullName,
      roleLabel,
      businessUnit: invitation.businessUnit?.name ?? null,
      department: invitation.department?.name ?? null,
      rawToken,
    });

    return {
      id,
      status: InvitationStatus.PENDING,
      message: 'Invitation re-sent. The new link is valid for 72 hours.',
    };
  }

  /** Revokes the invitation and deactivates the not-yet-activated account. */
  async revokeInvitation(id: string, actor: AuthUser, meta: RequestContextMeta) {
    const invitation = await this.prisma.invitation.findUnique({ where: { id } });
    if (!invitation) throw NotFound(ErrorCode.NOT_FOUND, 'Invitation not found.');
    this.assertInvitationInScope(actor, invitation);

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw Conflict(ErrorCode.CONFLICT, 'This invitation has already been accepted and cannot be revoked.');
    }
    if (invitation.status === InvitationStatus.REVOKED) {
      return { id, status: InvitationStatus.REVOKED, message: 'Invitation was already revoked.' };
    }

    const user = await this.prisma.user.findUnique({ where: { email: invitation.email } });

    await this.prisma.transaction(async (tx) => {
      await tx.invitation.update({
        where: { id },
        data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
      });
      await tx.token.updateMany({
        where: { email: invitation.email, type: TokenType.INVITATION, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (user && user.status === UserStatus.PENDING_ACTIVATION) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            status: UserStatus.INACTIVE,
            deactivatedAt: new Date(),
            deactivationReason: 'Invitation revoked',
            sessionVersion: { increment: 1 },
          },
        });
      }
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.INVITE_REVOKE,
          entityType: 'invitation',
          entityId: id,
          actor: { id: actor.id, roles: actor.roles },
          employeeId: user?.id ?? null,
          departmentId: invitation.departmentId,
          businessUnitId: invitation.businessUnitId,
          before: { status: invitation.status },
          after: { status: InvitationStatus.REVOKED },
          meta,
        },
        tx,
      );
    });

    return { id, status: InvitationStatus.REVOKED, message: 'Invitation revoked.' };
  }

  // ------------------------------------------------------------------ FR-ORG-03

  /** Updates identity + organisation mapping, keeping heads and scopes in sync. */
  async update(id: string, dto: UpdateUserInput, actor: AuthUser, meta: RequestContextMeta) {
    const target = await this.loadUser(id);
    if (!target) throw NotFound(ErrorCode.NOT_FOUND, 'User not found.');
    this.assertInScope(actor, target);

    const roleCodes = target.roles.map((r) => r.role.code);
    const data: Prisma.UserUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (dto.fullName !== undefined) {
      const fullName = dto.fullName.trim();
      if (fullName !== target.fullName) {
        data.fullName = fullName;
        before.fullName = target.fullName;
        after.fullName = fullName;
      }
    }

    if (dto.designationTitle !== undefined) {
      const designationTitle = dto.designationTitle.trim() || null;
      if (designationTitle !== target.designationTitle) {
        data.designationTitle = designationTitle;
        before.designationTitle = target.designationTitle;
        after.designationTitle = designationTitle;
      }
    }

    if (dto.designationId !== undefined && dto.designationId !== '') {
      const designation = await this.prisma.designation.findUnique({ where: { id: dto.designationId } });
      if (!designation) throw Unprocessable(ErrorCode.V_MISSING, 'The selected designation does not exist.');
      if (designation.id !== target.designationId) {
        data.designation = { connect: { id: designation.id } };
        before.designationId = target.designationId;
        after.designationId = designation.id;
      }
    }

    let newBusinessUnitId = target.businessUnitId;
    let newDepartmentId = target.departmentId;

    if (dto.departmentId) {
      const department = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
      if (!department || !department.isActive) {
        throw Unprocessable(ErrorCode.V_MISSING, 'The selected department is not available.');
      }
      if (dto.businessUnitId && department.businessUnitId !== dto.businessUnitId) {
        throw Unprocessable(ErrorCode.V_MISSING, 'The selected department does not belong to the selected business unit.', [
          { field: 'departmentId', code: ErrorCode.V_MISSING, message: 'Department does not match the chosen business unit' },
        ]);
      }
      newDepartmentId = department.id;
      newBusinessUnitId = department.businessUnitId;
    } else if (dto.businessUnitId) {
      const businessUnit = await this.prisma.businessUnit.findUnique({ where: { id: dto.businessUnitId } });
      if (!businessUnit || !businessUnit.isActive) {
        throw Unprocessable(ErrorCode.V_MISSING, 'The selected business unit is not available.');
      }
      if (target.departmentId) {
        const currentDepartment = await this.prisma.department.findUnique({ where: { id: target.departmentId } });
        if (currentDepartment && currentDepartment.businessUnitId !== businessUnit.id) {
          throw Unprocessable(ErrorCode.V_MISSING, 'Select a department in the new business unit as well.', [
            { field: 'departmentId', code: ErrorCode.V_MISSING, message: 'A department is required for the new business unit' },
          ]);
        }
      }
      newBusinessUnitId = businessUnit.id;
    }

    if (newBusinessUnitId !== target.businessUnitId) {
      data.businessUnit = { connect: { id: newBusinessUnitId as string } };
      before.businessUnitId = target.businessUnitId;
      after.businessUnitId = newBusinessUnitId;
    }
    if (newDepartmentId !== target.departmentId) {
      data.department = { connect: { id: newDepartmentId as string } };
      before.departmentId = target.departmentId;
      after.departmentId = newDepartmentId;
    }

    if (!Object.keys(data).length) return this.toUserView(target);

    const organisationChanged =
      newBusinessUnitId !== target.businessUnitId || newDepartmentId !== target.departmentId;

    await this.prisma.transaction(async (tx) => {
      await tx.user.update({ where: { id }, data });

      if (organisationChanged) {
        await this.syncDepartmentHeads(tx, id, roleCodes, newDepartmentId);
        await this.syncRoleScopes(
          tx,
          id,
          target.roles.map((r) => ({ id: r.roleId, code: r.role.code })),
          newBusinessUnitId,
          newDepartmentId,
        );
      }

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.USER_UPDATE,
          entityType: 'user',
          entityId: id,
          actor: { id: actor.id, roles: actor.roles },
          employeeId: id,
          departmentId: newDepartmentId,
          businessUnitId: newBusinessUnitId,
          before,
          after,
          changedFields: Object.keys(after),
          meta,
        },
        tx,
      );
    });

    return this.get(id, actor);
  }

  /**
   * FR-ORG-04 + EC-01 — department transfer.
   *
   * The user, their DepartmentHead rows and their role scopes move to the new
   * department. Approved KPIs are deliberately left untouched: they keep the
   * organisation snapshot (businessUnitId / departmentId) captured at submit
   * (§5.3), so historical reporting never rewrites the past.
   */
  async transfer(id: string, dto: TransferUserInput, actor: AuthUser, meta: RequestContextMeta) {
    const target = await this.loadUser(id);
    if (!target) throw NotFound(ErrorCode.NOT_FOUND, 'User not found.');
    this.assertInScope(actor, target);

    const department = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, isActive: true },
      include: { businessUnit: { select: { id: true, name: true } } },
    });
    if (!department) throw Unprocessable(ErrorCode.V_MISSING, 'The selected department is not available.');
    if (department.id === target.departmentId) {
      throw Conflict(ErrorCode.CONFLICT, 'This user already belongs to the selected department.');
    }

    const roleCodes = target.roles.map((r) => r.role.code);
    const previous = {
      departmentId: target.departmentId,
      department: target.department?.name ?? null,
      businessUnitId: target.businessUnitId,
      businessUnit: target.businessUnit?.name ?? null,
    };

    await this.prisma.transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          department: { connect: { id: department.id } },
          businessUnit: { connect: { id: department.businessUnitId } },
        },
      });

      await this.syncDepartmentHeads(tx, id, roleCodes, department.id);
      await this.syncRoleScopes(
        tx,
        id,
        target.roles.map((r) => ({ id: r.roleId, code: r.role.code })),
        department.businessUnitId,
        department.id,
      );

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.USER_TRANSFER,
          entityType: 'user',
          entityId: id,
          actor: { id: actor.id, roles: actor.roles },
          employeeId: id,
          departmentId: department.id,
          businessUnitId: department.businessUnitId,
          before: previous,
          after: {
            departmentId: department.id,
            department: department.name,
            businessUnitId: department.businessUnitId,
            businessUnit: department.businessUnit.name,
          },
          reason: dto.reason,
          meta,
        },
        tx,
      );
    });

    return this.get(id, actor);
  }

  /** FR-ORG-03 — grant / revoke roles without ever locking out the group. */
  async assignRoles(id: string, roleCodes: string[], actor: AuthUser, meta: RequestContextMeta) {
    const target = await this.loadUser(id);
    if (!target) throw NotFound(ErrorCode.NOT_FOUND, 'User not found.');
    this.assertInScope(actor, target);

    const codes = Array.from(
      new Set(roleCodes.map((code) => code.trim().toUpperCase()).filter(Boolean)),
    ) as RoleCode[];
    if (!codes.length) throw Unprocessable(ErrorCode.V_MISSING, 'At least one role must remain assigned.');

    const roles = await this.prisma.role.findMany({ where: { code: { in: codes } } });
    if (roles.length !== codes.length) {
      throw Unprocessable(ErrorCode.V_MISSING, 'One or more role codes are not recognised.');
    }

    const currentRoleRows = target.roles.map((r) => ({ id: r.roleId, code: r.role.code }));
    const currentCodes = new Set(currentRoleRows.map((r) => r.code));
    const nextCodes = new Set(roles.map((r) => r.code));
    const added = roles.filter((role) => !currentCodes.has(role.code));
    const removed = currentRoleRows.filter((role) => !nextCodes.has(role.code));

    for (const role of added) this.assertCanGrant(actor, role.code);
    for (const role of removed) this.assertCanRevoke(actor, role.code);

    if (removed.some((role) => role.code === ROLE.SUPER_ADMIN)) {
      if (target.id === actor.id) {
        throw Forbidden(ErrorCode.FORBIDDEN, 'You cannot remove your own Super Admin role.');
      }
      const otherSuperAdmins = await this.prisma.user.count({
        where: {
          id: { not: id },
          status: UserStatus.ACTIVE,
          roles: { some: { role: { code: ROLE.SUPER_ADMIN } } },
        },
      });
      if (otherSuperAdmins === 0) {
        throw Forbidden(ErrorCode.FORBIDDEN, 'There must always be at least one active Super Admin.');
      }
    }

    if (!added.length && !removed.length) {
      return { ...this.toUserView(target), changed: false };
    }

    await this.prisma.transaction(async (tx) => {
      for (const role of added) {
        const existing = await tx.userRole.findUnique({
          where: { userId_roleId: { userId: id, roleId: role.id } },
        });
        if (existing) {
          await tx.userRole.update({
            where: { id: existing.id },
            data: { revokedAt: null, grantedAt: new Date(), grantedById: actor.id },
          });
        } else {
          await tx.userRole.create({ data: { userId: id, roleId: role.id, grantedById: actor.id } });
        }
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.ROLE_GRANT,
            entityType: 'user',
            entityId: id,
            actor: { id: actor.id, roles: actor.roles },
            employeeId: id,
            departmentId: target.departmentId,
            businessUnitId: target.businessUnitId,
            after: { roleCode: role.code, label: this.roleLabel(role.code) },
            meta,
          },
          tx,
        );
      }

      for (const role of removed) {
        // UserRole is hard-deleted: the unique key [userId, roleId] would otherwise
        // resurrect a soft-revoked row on re-grant.
        await tx.userRole.deleteMany({ where: { userId: id, roleId: role.id } });
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.ROLE_REVOKE,
            entityType: 'user',
            entityId: id,
            actor: { id: actor.id, roles: actor.roles },
            employeeId: id,
            departmentId: target.departmentId,
            businessUnitId: target.businessUnitId,
            before: { roleCode: role.code, label: this.roleLabel(role.code) },
            meta,
          },
          tx,
        );
      }

      const finalRoles = roles.map((role) => ({ id: role.id, code: role.code }));
      await this.syncDepartmentHeads(tx, id, finalRoles.map((r) => r.code), target.departmentId);
      await this.syncRoleScopes(tx, id, finalRoles, target.businessUnitId, target.departmentId);
    });

    return this.get(id, actor);
  }

  // ------------------------------------------------------- FR-ORG-05 · EC-04/EC-17

  /** Deactivation: revokes sessions and cancels the user's DRAFT KPIs (leaver). */
  async deactivate(id: string, dto: DeactivateUserInput, actor: AuthUser, meta: RequestContextMeta) {
    const target = await this.loadUser(id);
    if (!target) throw NotFound(ErrorCode.NOT_FOUND, 'User not found.');
    this.assertInScope(actor, target);

    if (target.id === actor.id) {
      throw Forbidden(ErrorCode.FORBIDDEN, 'You cannot deactivate your own account.');
    }
    if (target.status === UserStatus.INACTIVE) {
      throw Conflict(ErrorCode.CONFLICT, 'This account is already inactive.');
    }

    // EC-04 / EC-17 — never leave a department with employees but no approver.
    const headRows = await this.prisma.departmentHead.findMany({
      where: { userId: id, isActive: true },
      select: { departmentId: true },
    });
    for (const head of headRows) {
      const [employees, otherHeads] = await Promise.all([
        this.prisma.user.count({
          where: { departmentId: head.departmentId, status: UserStatus.ACTIVE, id: { not: id } },
        }),
        this.prisma.departmentHead.count({
          where: {
            departmentId: head.departmentId,
            isActive: true,
            userId: { not: id },
            user: { status: UserStatus.ACTIVE },
          },
        }),
      ]);
      if (employees > 0 && otherHeads === 0) {
        throw Conflict(
          ErrorCode.AUTH_LAST_APPROVER,
          'This is the last active Department Head of a department that still has employees. Assign another approver first.',
        );
      }
    }

    const now = new Date();

    const cancelledDraftKpis = await this.prisma.transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          status: UserStatus.INACTIVE,
          deactivatedAt: now,
          deactivationReason: dto.reason,
          sessionVersion: { increment: 1 }, // revoke refresh tokens (NFR-SEC-05)
        },
      });

      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'Account deactivated' },
      });

      await tx.departmentHead.updateMany({
        where: { userId: id, isActive: true },
        data: { isActive: false },
      });

      const drafts = await tx.kpi.updateMany({
        where: { employeeId: id, status: KpiStatus.DRAFT },
        data: {
          status: KpiStatus.DELETED,
          deletedAt: now,
          deletedById: actor.id,
          deletedReason: 'Leaver',
          rowVersion: { increment: 1 },
        },
      });

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.USER_DEACTIVATE,
          entityType: 'user',
          entityId: id,
          actor: { id: actor.id, roles: actor.roles },
          employeeId: id,
          departmentId: target.departmentId,
          businessUnitId: target.businessUnitId,
          before: { status: target.status },
          after: { status: UserStatus.INACTIVE, cancelledDraftKpis: drafts.count },
          reason: dto.reason,
          meta,
        },
        tx,
      );

      return drafts.count;
    });

    return {
      id,
      status: UserStatus.INACTIVE,
      cancelledDraftKpis,
      message: 'Account deactivated.',
    };
  }

  async reactivate(id: string, actor: AuthUser, meta: RequestContextMeta) {
    const target = await this.loadUser(id);
    if (!target) throw NotFound(ErrorCode.NOT_FOUND, 'User not found.');
    this.assertInScope(actor, target);

    if (target.status === UserStatus.ACTIVE) {
      throw Conflict(ErrorCode.CONFLICT, 'This account is already active.');
    }

    const roleCodes = target.roles.map((r) => r.role.code);

    await this.prisma.transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          status: UserStatus.ACTIVE,
          deactivatedAt: null,
          deactivationReason: null,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });

      // Restore the approver helper when the user is still a Department Head.
      await this.syncDepartmentHeads(tx, id, roleCodes, target.departmentId);

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.USER_REACTIVATE,
          entityType: 'user',
          entityId: id,
          actor: { id: actor.id, roles: actor.roles },
          employeeId: id,
          departmentId: target.departmentId,
          businessUnitId: target.businessUnitId,
          before: { status: target.status },
          after: { status: UserStatus.ACTIVE },
          meta,
        },
        tx,
      );
    });

    return this.get(id, actor);
  }

  // --------------------------------------------------------------- FR-ORG-07

  /** Bulk create from a spreadsheet. Users start PENDING_ACTIVATION, no e-mails. */
  async bulkImport(rows: BulkImportRow[], actor: AuthUser, meta: RequestContextMeta) {
    const result: {
      created: number;
      skipped: number;
      errors: Array<{ row: number; field: string; message: string }>;
    } = { created: 0, skipped: 0, errors: [] };

    const [roleRows, units] = await Promise.all([
      this.prisma.role.findMany(),
      this.prisma.businessUnit.findMany({
        select: { id: true, code: true, name: true, isActive: true },
      }),
    ]);
    const roleByCode = new Map(roleRows.map((role) => [role.code as string, role]));
    const unitByCode = new Map(units.map((unit) => [unit.code.toUpperCase(), unit]));

    const seenEmails = new Set<string>();
    const seenCodes = new Set<string>();

    for (let index = 0; index < rows.length; index += 1) {
      const rowNo = index + 1;
      const row = rows[index] ?? {};
      const fail = (field: string, message: string) =>
        result.errors.push({ row: rowNo, field, message });

      const fullName = String(row.fullName ?? '').trim();
      const email = String(row.email ?? '').trim().toLowerCase();
      const employeeCode = String(row.employeeCode ?? '').trim().toUpperCase();
      const businessUnitCode = String(row.businessUnitCode ?? '').trim().toUpperCase();
      const departmentName = String(row.departmentName ?? '').trim();
      const roleCode = String(row.roleCode ?? ROLE.EMPLOYEE).trim().toUpperCase();

      if (fullName.length < 3) {
        fail('fullName', 'Full name is required (min 3 characters).');
        continue;
      }
      if (!COMPANY_EMAIL.test(email)) {
        fail('email', 'Only @anwargroup.net addresses are accepted.');
        continue;
      }
      if (!employeeCode) {
        fail('employeeCode', 'Employee code is required.');
        continue;
      }
      if (seenEmails.has(email)) {
        fail('email', 'Duplicate e-mail in the import file.');
        continue;
      }
      if (seenCodes.has(employeeCode)) {
        fail('employeeCode', 'Duplicate employee code in the import file.');
        continue;
      }

      const role = roleByCode.get(roleCode);
      if (!role) {
        fail('roleCode', `Unknown role ${roleCode}.`);
        continue;
      }
      if (
        role.code === ROLE.SUPER_ADMIN &&
        actor.roles.includes(ROLE.HR_ADMIN) &&
        !actor.roles.includes(ROLE.SUPER_ADMIN)
      ) {
        fail('roleCode', 'HR Admin cannot grant the Super Admin role.');
        continue;
      }

      const unit = unitByCode.get(businessUnitCode);
      if (!unit || !unit.isActive) {
        fail('businessUnitCode', `Business unit ${businessUnitCode || '(blank)'} was not found.`);
        continue;
      }

      const department = await this.prisma.department.findFirst({
        where: { businessUnitId: unit.id, name: departmentName, isActive: true },
      });
      if (!department) {
        fail('departmentName', `Department ${departmentName || '(blank)'} was not found in ${unit.code}.`);
        continue;
      }

      const existing = await this.prisma.user.findFirst({
        where: { OR: [{ email }, { employeeCode }] },
        select: { id: true },
      });
      if (existing) {
        result.skipped += 1;
        continue;
      }

      seenEmails.add(email);
      seenCodes.add(employeeCode);

      try {
        await this.prisma.transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              email,
              employeeCode,
              fullName,
              status: UserStatus.PENDING_ACTIVATION,
              organisationConfirmed: false,
              businessUnitId: unit.id,
              departmentId: department.id,
              designationTitle: String(row.designationTitle ?? '').trim() || null,
              roles: { create: { roleId: role.id, grantedById: actor.id } },
            },
            select: { id: true },
          });
          await this.syncDepartmentHeads(tx, created.id, [role.code], department.id);
          await this.syncRoleScopes(
            tx,
            created.id,
            [{ id: role.id, code: role.code }],
            unit.id,
            department.id,
          );
        });
        result.created += 1;
      } catch {
        fail('row', 'Could not create this user (duplicate e-mail or employee code).');
      }
    }

    if (result.created > 0) {
      await this.audit.record({
        action: AUDIT_ACTIONS.INVITE_CREATE,
        entityType: 'user',
        actor: { id: actor.id, roles: actor.roles },
        after: {
          source: 'bulk-import',
          created: result.created,
          skipped: result.skipped,
          errors: result.errors.length,
        },
        reason: 'Bulk user import (FR-ORG-07)',
        meta,
      });
    }

    return result;
  }

  // ------------------------------------------------- FR-ORG-08 · approver delegation

  /** Both sides must be active Department Heads of the same department. */
  async createDelegation(dto: CreateDelegationInput, actor: AuthUser, meta: RequestContextMeta) {
    if (dto.toUserId === actor.id) {
      throw Unprocessable(ErrorCode.APPROVER_INVALID, 'You cannot delegate to yourself.');
    }

    const start = startOfDayUtc(dto.startDate);
    const end = startOfDayUtc(dto.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw Unprocessable(ErrorCode.V_MISSING, 'Provide valid start and end dates.');
    }
    if (end.getTime() < start.getTime()) {
      throw Unprocessable(ErrorCode.V_MISSING, 'The end date must be on or after the start date.');
    }
    if (end.getTime() < startOfDayUtc(new Date()).getTime()) {
      throw Unprocessable(ErrorCode.V_MISSING, 'The delegation period is already in the past.');
    }

    const heads = await this.prisma.departmentHead.findMany({
      where: {
        departmentId: dto.departmentId,
        isActive: true,
        userId: { in: [actor.id, dto.toUserId] },
      },
      include: { user: { select: { id: true, fullName: true, status: true } } },
    });
    const fromHead = heads.find((head) => head.userId === actor.id);
    const toHead = heads.find((head) => head.userId === dto.toUserId);
    if (!fromHead || fromHead.user.status !== UserStatus.ACTIVE) {
      throw Unprocessable(ErrorCode.APPROVER_INVALID, 'You are not an active Department Head of that department.');
    }
    if (!toHead || toHead.user.status !== UserStatus.ACTIVE) {
      throw Unprocessable(
        ErrorCode.APPROVER_INVALID,
        'The selected colleague is not an active Department Head of that department.',
      );
    }

    const overlap = await this.prisma.approverDelegation.findFirst({
      where: {
        fromUserId: actor.id,
        departmentId: dto.departmentId,
        isActive: true,
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (overlap) {
      throw Conflict(ErrorCode.CONFLICT, 'An active delegation for this department already covers part of that period.');
    }

    const delegation = await this.prisma.approverDelegation.create({
      data: {
        fromUserId: actor.id,
        toUserId: dto.toUserId,
        departmentId: dto.departmentId,
        startDate: start,
        endDate: end,
        reason: dto.reason?.trim() || null,
        createdById: actor.id,
      },
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.DELEGATION_CREATE,
      entityType: 'approver_delegation',
      entityId: delegation.id,
      actor: { id: actor.id, roles: actor.roles },
      employeeId: actor.id,
      departmentId: dto.departmentId,
      after: {
        toUserId: dto.toUserId,
        startDate: start,
        endDate: end,
        reason: delegation.reason,
      },
      meta,
    });

    return delegation;
  }

  async listDelegations(query: ListDelegationsQuery, actor: AuthUser) {
    const { page, size, skip, take } = this.paging(query.page, query.size);
    const where: Prisma.ApproverDelegationWhereInput = {};

    if (!this.scope.isGroupScoped(actor)) {
      const or: Prisma.ApproverDelegationWhereInput[] = [
        { fromUserId: actor.id },
        { toUserId: actor.id },
      ];
      if (actor.scope.departmentIds.length) {
        or.push({ departmentId: { in: actor.scope.departmentIds } });
      }
      where.OR = or;
    }
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.activeOnly === 'true') where.isActive = true;

    const [items, total] = await Promise.all([
      this.prisma.approverDelegation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          fromUser: { select: { id: true, fullName: true, email: true } },
          toUser: { select: { id: true, fullName: true, email: true } },
          department: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.approverDelegation.count({ where }),
    ]);

    return {
      items,
      page,
      size,
      total,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  async revokeDelegation(id: string, actor: AuthUser, meta: RequestContextMeta) {
    const delegation = await this.prisma.approverDelegation.findUnique({
      where: { id },
      include: {
        fromUser: { select: { id: true, fullName: true } },
        toUser: { select: { id: true, fullName: true } },
        department: { select: { id: true, name: true } },
      },
    });
    if (!delegation) throw NotFound(ErrorCode.NOT_FOUND, 'Delegation not found.');

    const isMine = delegation.fromUserId === actor.id || delegation.toUserId === actor.id;
    const inScope =
      this.scope.isGroupScoped(actor) ||
      (!!delegation.departmentId && actor.scope.departmentIds.includes(delegation.departmentId));
    if (!isMine && !inScope) {
      throw Forbidden(ErrorCode.OUT_OF_SCOPE, 'This delegation belongs to another department.');
    }

    if (delegation.isActive) {
      await this.prisma.approverDelegation.update({ where: { id }, data: { isActive: false } });

      await this.audit.record({
        // AUDIT_ACTIONS has no dedicated revoke key; the action name follows the
        // same user.delegation.* convention.
        action: 'user.delegation.revoke',
        entityType: 'approver_delegation',
        entityId: id,
        actor: { id: actor.id, roles: actor.roles },
        employeeId: delegation.fromUserId,
        departmentId: delegation.departmentId,
        before: { isActive: true },
        after: { isActive: false },
        reason: `Delegation to ${delegation.toUser.fullName} revoked`,
        meta,
      });
    }

    return { id, isActive: false, message: 'Delegation revoked.' };
  }

  // --------------------------------------------------------------- FR-ORG-09

  /** Users who activated but have not yet confirmed their organisation details. */
  async pendingRegistrations(actor: AuthUser) {
    const where: Prisma.UserWhereInput = {
      AND: [
        this.scope.userScopeWhere(actor),
        { status: UserStatus.ACTIVE, organisationConfirmed: false },
      ],
    };

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        roles: { include: { role: true } },
        department: { select: { id: true, code: true, name: true } },
        businessUnit: { select: { id: true, code: true, name: true, shortName: true } },
        designation: { select: { id: true, name: true } },
      },
    });

    return users.map((user) => this.toUserView(user));
  }

  /** SUPER_ADMIN / HR_ADMIN, or the Department Head of that department. */
  async confirmRegistration(userId: string, actor: AuthUser, meta: RequestContextMeta) {
    const target = await this.loadUser(userId);
    if (!target) throw NotFound(ErrorCode.NOT_FOUND, 'User not found.');

    let allowed = actor.roles.includes(ROLE.SUPER_ADMIN) || actor.roles.includes(ROLE.HR_ADMIN);
    if (!allowed && target.departmentId) {
      const headRow = await this.prisma.departmentHead.findFirst({
        where: { departmentId: target.departmentId, userId: actor.id, isActive: true },
      });
      allowed = !!headRow;
    }
    if (!allowed) {
      throw Forbidden(
        ErrorCode.FORBIDDEN,
        'Only Group HR, a Super Admin or the Department Head of that department can confirm these details.',
      );
    }

    if (!target.organisationConfirmed) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { organisationConfirmed: true },
      });

      await this.audit.record({
        action: AUDIT_ACTIONS.USER_UPDATE,
        entityType: 'user',
        entityId: userId,
        actor: { id: actor.id, roles: actor.roles },
        employeeId: userId,
        departmentId: target.departmentId,
        businessUnitId: target.businessUnitId,
        before: { organisationConfirmed: false },
        after: { organisationConfirmed: true },
        reason: 'Organisation details confirmed',
        meta,
      });
    }

    return { id: userId, organisationConfirmed: true };
  }

  // ------------------------------------------------------------- shared lookups

  /** Active Department Heads of a department (KPI approver drop-down). */
  async approvers(departmentId: string, excludeUserId?: string): Promise<ApproverView[]> {
    const heads = await this.prisma.departmentHead.findMany({
      where: {
        departmentId,
        isActive: true,
        user: {
          status: UserStatus.ACTIVE,
          ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { user: { fullName: 'asc' } }],
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            employeeCode: true,
            designationTitle: true,
          },
        },
      },
    });

    return heads.map((head) => ({
      id: head.user.id,
      fullName: head.user.fullName,
      email: head.user.email,
      employeeCode: head.user.employeeCode,
      designationTitle: head.user.designationTitle,
      isPrimary: head.isPrimary,
      isSuperAdmin: false,
    }));
  }

  /** Light-weight, scope-filtered people picker for the global search. */
  async directory(query: DirectoryQuery, actor: AuthUser) {
    const take = Math.min(50, Math.max(1, Math.floor(Number(query.limit) || 20)));
    const filters: Prisma.UserWhereInput[] = [{ status: UserStatus.ACTIVE }];

    const search = query.search?.trim();
    if (search) {
      filters.push({
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { employeeCode: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (query.departmentId) filters.push({ departmentId: query.departmentId });

    return this.prisma.user.findMany({
      where: { AND: [this.scope.userScopeWhere(actor), ...filters] },
      orderBy: { fullName: 'asc' },
      take,
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        designationTitle: true,
        department: { select: { id: true, code: true, name: true } },
      },
    });
  }

  // -------------------------------------------------------------------- helpers

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private rawToken(): string {
    return randomBytes(48).toString('base64url');
  }

  /** Accepts 01XXXXXXXXX or +8801XXXXXXXXX and stores +8801XXXXXXXXX. */
  private normalisePhone(input: string): string {
    const raw = input.trim().replace(/[\s-]/g, '');
    if (!MOBILE_PHONE.test(raw)) {
      throw Unprocessable(ErrorCode.V_PHONE_01, 'Enter a valid Bangladeshi mobile number, e.g. 01712345678.', [
        { field: 'corporatePhone', code: ErrorCode.V_PHONE_01, message: 'Use 01XXXXXXXXX or +8801XXXXXXXXX' },
      ]);
    }
    return raw.startsWith('+880') ? raw : `+880${raw.slice(1)}`;
  }

  private paging(pageRaw?: string | number, sizeRaw?: string | number) {
    const page = Math.max(1, Math.floor(Number(pageRaw) || 1));
    const size = Math.min(100, Math.max(1, Math.floor(Number(sizeRaw) || DEFAULT_PAGE_SIZE)));
    return { page, size, skip: (page - 1) * size, take: size };
  }

  private async loadUser(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        roles: { include: { role: true } },
        department: { select: { id: true, code: true, name: true } },
        businessUnit: { select: { id: true, code: true, name: true, shortName: true } },
        designation: { select: { id: true, name: true } },
      },
    });
  }

  private toUserView(user: UserViewSource) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      employeeCode: user.employeeCode,
      status: user.status,
      corporatePhone: user.corporatePhone,
      designationId: user.designationId,
      designationTitle: user.designationTitle,
      designation: user.designation,
      businessUnitId: user.businessUnitId,
      departmentId: user.departmentId,
      businessUnit: user.businessUnit,
      department: user.department,
      organisationConfirmed: user.organisationConfirmed,
      emailDigest: user.emailDigest,
      avatarUrl: user.avatarUrl,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      deactivatedAt: user.deactivatedAt,
      deactivationReason: user.deactivationReason,
      roles: user.roles.map((row) => ({
        code: row.role.code,
        label: this.roleLabel(row.role.code),
      })),
    };
  }

  private roleLabel(code: string): string {
    return ROLE_LABELS[code as RoleKey] ?? code;
  }

  private async resolveRole(roleCode: string): Promise<{ id: string; code: RoleCode }> {
    const code = roleCode.trim().toUpperCase() as RoleCode;
    if (!Object.values(RoleCode).includes(code)) {
      throw Unprocessable(ErrorCode.V_MISSING, `Unknown role code ${roleCode}.`);
    }
    const role = await this.prisma.role.findUnique({ where: { code } });
    if (!role) throw Unprocessable(ErrorCode.V_MISSING, 'Role catalogue not seeded — run the seed script.');
    return role;
  }

  /** BR-R03 / §5.2 — HR Admin can never create another Super Admin. */
  private assertCanGrant(actor: AuthUser, roleCode: string): void {
    if (
      roleCode === ROLE.SUPER_ADMIN &&
      actor.roles.includes(ROLE.HR_ADMIN) &&
      !actor.roles.includes(ROLE.SUPER_ADMIN)
    ) {
      throw Forbidden(ErrorCode.HR_ROLE_ESCALATION, 'HR Admin cannot grant the Super Admin role.');
    }
  }

  /** §5.2 — HR Admin can never revoke a Super Admin either. */
  private assertCanRevoke(actor: AuthUser, roleCode: string): void {
    if (
      roleCode === ROLE.SUPER_ADMIN &&
      actor.roles.includes(ROLE.HR_ADMIN) &&
      !actor.roles.includes(ROLE.SUPER_ADMIN)
    ) {
      throw Forbidden(ErrorCode.HR_ROLE_ESCALATION, 'HR Admin cannot revoke the Super Admin role.');
    }
  }

  private assertInScope(
    actor: AuthUser,
    target: { id: string; departmentId: string | null; businessUnitId: string | null },
  ): void {
    if (this.scope.isGroupScoped(actor)) return;
    if (target.id === actor.id) return;
    if (target.departmentId && actor.scope.departmentIds.includes(target.departmentId)) return;
    if (target.businessUnitId && actor.scope.businessUnitIds.includes(target.businessUnitId)) return;
    throw Forbidden(ErrorCode.OUT_OF_SCOPE, 'This user belongs to another department.');
  }

  private invitationScopeWhere(actor: AuthUser): Prisma.InvitationWhereInput {
    if (this.scope.isGroupScoped(actor)) return {};
    const or: Prisma.InvitationWhereInput[] = [{ invitedById: actor.id }];
    if (actor.scope.businessUnitIds.length) {
      or.push({ businessUnitId: { in: actor.scope.businessUnitIds } });
    }
    if (actor.scope.departmentIds.length) {
      or.push({ departmentId: { in: actor.scope.departmentIds } });
    }
    return { OR: or };
  }

  private assertInvitationInScope(
    actor: AuthUser,
    invitation: { invitedById: string | null; departmentId: string | null; businessUnitId: string | null },
  ): void {
    if (this.scope.isGroupScoped(actor)) return;
    if (invitation.invitedById === actor.id) return;
    if (invitation.departmentId && actor.scope.departmentIds.includes(invitation.departmentId)) return;
    if (invitation.businessUnitId && actor.scope.businessUnitIds.includes(invitation.businessUnitId)) return;
    throw Forbidden(ErrorCode.OUT_OF_SCOPE, 'This invitation belongs to another department.');
  }

  private async superAdminApprovers(): Promise<ApproverView[]> {
    const admins = await this.prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        roles: { some: { role: { code: ROLE.SUPER_ADMIN } } },
      },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        employeeCode: true,
        designationTitle: true,
      },
    });

    return admins.map((admin) => ({
      id: admin.id,
      fullName: admin.fullName,
      email: admin.email,
      employeeCode: admin.employeeCode,
      designationTitle: admin.designationTitle,
      isPrimary: false,
      isSuperAdmin: true,
    }));
  }

  /**
   * Keeps the DepartmentHead helper table in sync (FR-ORG-02 — several heads
   * per department are allowed; the first one becomes primary).
   */
  private async syncDepartmentHeads(
    tx: Prisma.TransactionClient,
    userId: string,
    roleCodes: string[],
    departmentId: string | null,
  ): Promise<void> {
    if (!roleCodes.includes(ROLE.DEPT_HEAD) || !departmentId) {
      await tx.departmentHead.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });
      return;
    }

    await tx.departmentHead.updateMany({
      where: { userId, isActive: true, departmentId: { not: departmentId } },
      data: { isActive: false },
    });

    const existing = await tx.departmentHead.findUnique({
      where: { departmentId_userId: { departmentId, userId } },
    });
    if (existing) {
      if (!existing.isActive) {
        await tx.departmentHead.update({ where: { id: existing.id }, data: { isActive: true } });
      }
      return;
    }

    const activePeers = await tx.departmentHead.count({ where: { departmentId, isActive: true } });
    await tx.departmentHead.create({
      data: { departmentId, userId, isPrimary: activePeers === 0, isActive: true },
    });
  }

  /**
   * Keeps user_role_scope aligned with the user's roles and organisation:
   * group roles stay at group scope (departmentId = null, §5.3) while
   * department-bound roles point at the current department.
   */
  private async syncRoleScopes(
    tx: Prisma.TransactionClient,
    userId: string,
    roles: Array<{ id: string; code: RoleCode }>,
    businessUnitId: string | null,
    departmentId: string | null,
  ): Promise<void> {
    const roleIds = roles.map((role) => role.id);
    await tx.userRoleScope.deleteMany({
      where: roleIds.length ? { userId, roleId: { notIn: roleIds } } : { userId },
    });

    for (const role of roles) {
      const groupScoped = GROUP_ROLES.includes(role.code as RoleKey);
      const wantedDepartmentId = groupScoped ? null : departmentId;
      const wantedBusinessUnitId = groupScoped ? null : businessUnitId;

      await tx.userRoleScope.deleteMany({
        where: {
          userId,
          roleId: role.id,
          departmentId: wantedDepartmentId === null ? { not: null } : { not: wantedDepartmentId },
        },
      });

      const existing = await tx.userRoleScope.findFirst({
        where: { userId, roleId: role.id, departmentId: wantedDepartmentId },
      });
      if (existing) {
        if (existing.businessUnitId !== wantedBusinessUnitId) {
          await tx.userRoleScope.update({
            where: { id: existing.id },
            data: { businessUnitId: wantedBusinessUnitId },
          });
        }
      } else {
        await tx.userRoleScope.create({
          data: {
            userId,
            roleId: role.id,
            departmentId: wantedDepartmentId,
            businessUnitId: wantedBusinessUnitId,
          },
        });
      }
    }
  }

  /** Creates the EmailLog row and queues the NT-02 invitation e-mail. */
  private async sendInvitationEmail(params: {
    userId: string | null;
    email: string;
    fullName: string;
    roleLabel: string;
    businessUnit: string | null;
    department: string | null;
    rawToken: string;
  }): Promise<boolean> {
    const base = process.env.APP_URL ?? 'http://localhost:5173';
    const setupUrl = `${base.replace(/\/$/, '')}/set-password?token=${params.rawToken}`;
    const context = {
      recipientName: params.fullName,
      roleLabel: params.roleLabel,
      businessUnit: params.businessUnit,
      department: params.department,
      setupUrl,
    };
    const subject = `You are invited to ANWAR KPIFlow as ${params.roleLabel}`;

    const log = await this.prisma.emailLog.create({
      data: {
        toEmail: params.email,
        subject,
        templateCode: NT.INVITATION_CREATED,
        payload: context as Prisma.InputJsonValue,
        status: 'QUEUED',
        userId: params.userId ?? undefined,
      },
    });

    const job = await this.queue.enqueueEmail({
      emailLogId: log.id,
      to: params.email,
      templateCode: NT.INVITATION_CREATED,
      subjectOverride: subject,
      context,
    });

    return job !== null;
  }
}
