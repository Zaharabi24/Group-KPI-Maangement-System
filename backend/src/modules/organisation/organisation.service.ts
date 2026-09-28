/**
 * Organisation master data — BRD §6 (FR-ORG-01).
 *
 * Business units and departments are the backbone of data scope (§5.3): the
 * BU → Department relationship must always be maintained, and every mutation is
 * written to the audit trail (BR-R11).
 */
import { Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { Conflict, ErrorCode, NotFound } from '../../common/errors/error-codes';
import { AUDIT_ACTIONS } from '../../common/constants';

export interface CreateBusinessUnitInput {
  name: string;
  code: string;
  shortName?: string;
  division?: string;
  sortOrder?: number;
}

export interface UpdateBusinessUnitInput {
  name?: string;
  code?: string;
  shortName?: string;
  division?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface CreateDepartmentInput {
  businessUnitId: string;
  name: string;
  code?: string;
}

export interface UpdateDepartmentInput {
  businessUnitId?: string;
  name?: string;
  code?: string;
  isActive?: boolean;
}

@Injectable()
export class OrganisationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- FR-ORG-01 · BU

  /** Business units with a department count, for the Organisation screen. */
  async listBusinessUnits(includeInactive = false) {
    const units = await this.prisma.businessUnit.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { departments: includeInactive ? true : { where: { isActive: true } } },
        },
      },
    });

    return units.map(({ _count, ...unit }) => ({
      ...unit,
      departmentCount: _count.departments,
    }));
  }

  async createBusinessUnit(dto: CreateBusinessUnitInput, user: AuthUser, meta: RequestContextMeta) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.businessUnit.findUnique({ where: { code } });
    if (existing) {
      throw Conflict(ErrorCode.CONFLICT, `The business unit code ${code} is already in use.`);
    }

    const created = await this.prisma.businessUnit.create({
      data: {
        code,
        name: dto.name.trim(),
        shortName: dto.shortName?.trim() || null,
        division: dto.division?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.ORG_CREATE,
      entityType: 'business_unit',
      entityId: created.id,
      actor: { id: user.id, roles: user.roles },
      businessUnitId: created.id,
      after: { code: created.code, name: created.name, shortName: created.shortName, division: created.division },
      meta,
    });

    return created;
  }

  async updateBusinessUnit(id: string, dto: UpdateBusinessUnitInput, user: AuthUser, meta: RequestContextMeta) {
    const unit = await this.prisma.businessUnit.findUnique({ where: { id } });
    if (!unit) throw NotFound(ErrorCode.NOT_FOUND, 'Business unit not found.');

    const data: Prisma.BusinessUnitUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.shortName !== undefined) data.shortName = dto.shortName.trim() || null;
    if (dto.division !== undefined) data.division = dto.division.trim() || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.code !== undefined) {
      const code = dto.code.trim().toUpperCase();
      if (code !== unit.code) {
        const clash = await this.prisma.businessUnit.findUnique({ where: { code } });
        if (clash) throw Conflict(ErrorCode.CONFLICT, `The business unit code ${code} is already in use.`);
        data.code = code;
      }
    }

    const before = {
      code: unit.code,
      name: unit.name,
      shortName: unit.shortName,
      division: unit.division,
      isActive: unit.isActive,
      sortOrder: unit.sortOrder,
    };

    const updated = await this.prisma.businessUnit.update({ where: { id }, data });

    await this.audit.record({
      action: AUDIT_ACTIONS.ORG_UPDATE,
      entityType: 'business_unit',
      entityId: id,
      actor: { id: user.id, roles: user.roles },
      businessUnitId: id,
      before,
      after: {
        code: updated.code,
        name: updated.name,
        shortName: updated.shortName,
        division: updated.division,
        isActive: updated.isActive,
        sortOrder: updated.sortOrder,
      },
      changedFields: Object.keys(dto),
      meta,
    });

    return updated;
  }

  /** A business unit cannot be retired while it still holds active master data. */
  async deactivateBusinessUnit(id: string, user: AuthUser, meta: RequestContextMeta) {
    const unit = await this.prisma.businessUnit.findUnique({ where: { id } });
    if (!unit) throw NotFound(ErrorCode.NOT_FOUND, 'Business unit not found.');

    const [activeDepartments, activeUsers] = await Promise.all([
      this.prisma.department.count({ where: { businessUnitId: id, isActive: true } }),
      this.prisma.user.count({ where: { businessUnitId: id, status: { not: UserStatus.INACTIVE } } }),
    ]);
    if (activeDepartments > 0 || activeUsers > 0) {
      throw Conflict(
        ErrorCode.CONFLICT,
        `This business unit still has ${activeDepartments} active department(s) and ${activeUsers} user(s). Move them before deactivating.`,
      );
    }

    await this.prisma.businessUnit.update({ where: { id }, data: { isActive: false } });

    await this.audit.record({
      action: AUDIT_ACTIONS.ORG_DEACTIVATE,
      entityType: 'business_unit',
      entityId: id,
      actor: { id: user.id, roles: user.roles },
      businessUnitId: id,
      before: { isActive: unit.isActive },
      after: { isActive: false },
      meta,
    });

    return { id, isActive: false, message: 'Business unit deactivated.' };
  }

  // ------------------------------------------------------- FR-ORG-01 · Department

  /**
   * Departments of a business unit (BU → Department relationship preserved).
   * Used by HR screens and — without auth — by the registration/profile forms.
   */
  async listDepartments(businessUnitId?: string, includeInactive = false) {
    const where: Prisma.DepartmentWhereInput = {};
    if (businessUnitId) where.businessUnitId = businessUnitId;
    if (!includeInactive) where.isActive = true;

    const departments = await this.prisma.department.findMany({
      where,
      orderBy: [{ businessUnit: { sortOrder: 'asc' } }, { name: 'asc' }],
      include: {
        businessUnit: { select: { id: true, code: true, name: true, shortName: true } },
        heads: {
          where: { isActive: true, user: { status: UserStatus.ACTIVE } },
          orderBy: { isPrimary: 'desc' },
          include: { user: { select: { id: true, fullName: true, email: true, employeeCode: true } } },
        },
        _count: { select: { users: { where: { status: UserStatus.ACTIVE } } } },
      },
    });

    return departments.map(({ _count, heads, ...department }) => ({
      ...department,
      employeeCount: _count.users,
      heads: heads.map((head) => ({
        id: head.user.id,
        fullName: head.user.fullName,
        email: head.user.email,
        employeeCode: head.user.employeeCode,
        isPrimary: head.isPrimary,
      })),
    }));
  }

  async createDepartment(dto: CreateDepartmentInput, user: AuthUser, meta: RequestContextMeta) {
    const businessUnit = await this.prisma.businessUnit.findUnique({ where: { id: dto.businessUnitId } });
    if (!businessUnit) throw NotFound(ErrorCode.NOT_FOUND, 'Business unit not found.');

    const name = dto.name.trim();
    const nameClash = await this.prisma.department.findFirst({
      where: { businessUnitId: businessUnit.id, name },
    });
    if (nameClash) {
      throw Conflict(ErrorCode.CONFLICT, 'A department with this name already exists in the business unit.');
    }

    let code: string;
    if (dto.code && dto.code.trim()) {
      code = dto.code.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 24);
      const codeClash = await this.prisma.department.findFirst({
        where: { businessUnitId: businessUnit.id, code },
      });
      if (codeClash) {
        throw Conflict(ErrorCode.CONFLICT, `The department code ${code} is already used in this business unit.`);
      }
    } else {
      code = await this.generateDepartmentCode(businessUnit.id, name);
    }

    const created = await this.prisma.department.create({
      data: { businessUnitId: businessUnit.id, name, code },
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.ORG_CREATE,
      entityType: 'department',
      entityId: created.id,
      actor: { id: user.id, roles: user.roles },
      departmentId: created.id,
      businessUnitId: created.businessUnitId,
      after: { code: created.code, name: created.name, businessUnit: businessUnit.name },
      meta,
    });

    return created;
  }

  async updateDepartment(id: string, dto: UpdateDepartmentInput, user: AuthUser, meta: RequestContextMeta) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      include: { businessUnit: { select: { id: true, name: true } } },
    });
    if (!department) throw NotFound(ErrorCode.NOT_FOUND, 'Department not found.');

    const data: Prisma.DepartmentUpdateInput = {};
    const targetBusinessUnitId = dto.businessUnitId ?? department.businessUnitId;

    if (dto.name !== undefined && dto.name.trim() !== department.name) {
      const name = dto.name.trim();
      const clash = await this.prisma.department.findFirst({
        where: { businessUnitId: targetBusinessUnitId, name, id: { not: id } },
      });
      if (clash) throw Conflict(ErrorCode.CONFLICT, 'A department with this name already exists in the business unit.');
      data.name = name;
    }

    if (dto.code !== undefined) {
      const code = dto.code.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 24);
      if (code !== department.code) {
        const clash = await this.prisma.department.findFirst({
          where: { businessUnitId: targetBusinessUnitId, code, id: { not: id } },
        });
        if (clash) throw Conflict(ErrorCode.CONFLICT, `The department code ${code} is already used in this business unit.`);
        data.code = code;
      }
    }

    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (dto.businessUnitId && dto.businessUnitId !== department.businessUnitId) {
      // Moving a department that already has KPIs or users would orphan their
      // organisation snapshot — refuse instead (409, "in use").
      const [kpiCount, userCount] = await Promise.all([
        this.prisma.kpi.count({ where: { departmentId: id } }),
        this.prisma.user.count({ where: { departmentId: id } }),
      ]);
      if (kpiCount > 0 || userCount > 0) {
        throw Conflict(
          ErrorCode.CONFLICT,
          `This department is in use (${userCount} user(s), ${kpiCount} KPI(s)) and cannot be moved to another business unit.`,
        );
      }
      const target = await this.prisma.businessUnit.findUnique({ where: { id: dto.businessUnitId } });
      if (!target) throw NotFound(ErrorCode.NOT_FOUND, 'Target business unit not found.');
      data.businessUnit = { connect: { id: target.id } };
    }

    const before = {
      code: department.code,
      name: department.name,
      businessUnitId: department.businessUnitId,
      businessUnit: department.businessUnit.name,
      isActive: department.isActive,
    };

    const updated = await this.prisma.department.update({ where: { id }, data });

    await this.audit.record({
      action: AUDIT_ACTIONS.ORG_UPDATE,
      entityType: 'department',
      entityId: id,
      actor: { id: user.id, roles: user.roles },
      departmentId: id,
      businessUnitId: updated.businessUnitId,
      before,
      after: { code: updated.code, name: updated.name, businessUnitId: updated.businessUnitId, isActive: updated.isActive },
      changedFields: Object.keys(dto),
      meta,
    });

    return updated;
  }

  async deactivateDepartment(id: string, user: AuthUser, meta: RequestContextMeta) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) throw NotFound(ErrorCode.NOT_FOUND, 'Department not found.');

    const activeUsers = await this.prisma.user.count({
      where: { departmentId: id, status: { not: UserStatus.INACTIVE } },
    });
    if (activeUsers > 0) {
      throw Conflict(
        ErrorCode.CONFLICT,
        `This department still has ${activeUsers} active employee(s). Transfer them before deactivating.`,
      );
    }

    await this.prisma.department.update({ where: { id }, data: { isActive: false } });

    await this.audit.record({
      action: AUDIT_ACTIONS.ORG_DEACTIVATE,
      entityType: 'department',
      entityId: id,
      actor: { id: user.id, roles: user.roles },
      departmentId: id,
      businessUnitId: department.businessUnitId,
      before: { isActive: department.isActive },
      after: { isActive: false },
      meta,
    });

    return { id, isActive: false, message: 'Department deactivated.' };
  }

  // -------------------------------------------------------------- composite reads

  /** BU → nested active departments, for the Organisation screen tree. */
  async tree() {
    const units = await this.prisma.businessUnit.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        departments: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true, isActive: true },
        },
      },
    });

    return units.map((unit) => ({
      id: unit.id,
      code: unit.code,
      name: unit.name,
      shortName: unit.shortName,
      division: unit.division,
      sortOrder: unit.sortOrder,
      isActive: unit.isActive,
      departments: unit.departments,
    }));
  }

  async designations() {
    return this.prisma.designation.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, level: true },
    });
  }

  // ------------------------------------------------------------------- helpers

  /**
   * Auto-generated code: upper-case snake_case from the name, max 24 characters,
   * unique within the business unit (numeric suffix on collision).
   */
  private async generateDepartmentCode(businessUnitId: string, name: string): Promise<string> {
    const base =
      name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24) || 'DEPT';

    const existing = new Set(
      (
        await this.prisma.department.findMany({ where: { businessUnitId }, select: { code: true } })
      ).map((d) => d.code),
    );
    if (!existing.has(base)) return base;

    for (let i = 2; i < 1000; i += 1) {
      const suffix = `_${i}`;
      const candidate = `${base.slice(0, 24 - suffix.length)}${suffix}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${base.slice(0, 19)}_${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }
}
