/**
 * KPI library — templates, categories and assignments — BRD M04, FR-LIB-01..05.
 *
 * Visibility: GROUP templates are visible to everyone; DEPARTMENT templates are
 * visible to the owning department(s) only. Editing a template creates a new
 * version (same code, version + 1). Assignments (FR-LIB-03 / UC-08) apply the
 * weight-capacity (W-EXCEED), duplicate-name (KPI-DUP) and max-KPI (MAX-KPI)
 * rules and report every rejected row as a conflict.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  Direction,
  KpiCategoryCode,
  KpiType,
  MeasurementType,
  Prisma,
  TemplateScope,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { AUDIT_ACTIONS, KPI_CATEGORIES, NT, ROLE } from '../../common/constants';
import {
  BadRequest,
  Conflict,
  ErrorCode,
  Forbidden,
  NotFound,
  weightExceededMessage,
} from '../../common/errors/error-codes';
import { dec, formatByMeasurementType } from '../../common/utils/decimal.util';
import { daysRemaining, formatDate } from '../../common/utils/period.util';
import { DEFAULT_QUALITATIVE_MAP } from '../calculation/calculation.engine';

interface PagingQuery {
  page?: string | number;
  size?: string | number;
}

interface TemplateListQuery extends PagingQuery {
  search?: string;
  categoryId?: string;
  measurementType?: string;
  scope?: string;
  isPublished?: string | boolean;
}

interface CreateTemplateInput {
  name: string;
  description?: string;
  categoryId: string;
  kpiType?: string;
  measurementType: string;
  unit: string;
  direction: string;
  suggestedWeight: number;
  rubricDescriptors?: unknown;
  isPublished?: boolean;
}

interface UpdateTemplateInput {
  name?: string;
  description?: string;
  categoryId?: string;
  kpiType?: string;
  measurementType?: string;
  unit?: string;
  direction?: string;
  suggestedWeight?: number;
  rubricDescriptors?: unknown;
}

interface FromTemplateOverrides {
  name?: string;
  description?: string | null;
  unit?: string;
  direction?: string;
  suggestedWeight?: number;
  rubricDescriptors?: unknown;
}

interface AssignmentRowInput {
  employeeId: string;
  target?: string | number | null;
  weight: number;
}

interface AssignInput {
  templateId: string;
  periodId: string;
  rows: AssignmentRowInput[];
}

export interface AssignmentConflict {
  employeeId: string;
  employeeName: string;
  reason: string;
  code: string;
  availableWeight?: number;
}

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ helpers

  private appUrl(path: string): string {
    const base = process.env.APP_URL || 'http://localhost:5173';
    return `${base.replace(/\/$/, '')}${path}`;
  }

  private paging(query: PagingQuery | undefined) {
    const page = Math.max(1, Math.trunc(Number(query?.page)) || 1);
    const raw = Math.trunc(Number(query?.size)) || 25;
    const size = Math.min(100, Math.max(1, raw));
    return { page, size, skip: (page - 1) * size, take: size };
  }

  private departmentIds(user: AuthUser): string[] {
    return Array.from(
      new Set([...(user.departmentId ? [user.departmentId] : []), ...user.scope.departmentIds]),
    );
  }

  private isGroupAdmin(user: AuthUser): boolean {
    return user.roles.includes(ROLE.SUPER_ADMIN) || user.roles.includes(ROLE.HR_ADMIN);
  }

  private assertVisible(
    template: { scope: TemplateScope; departmentId: string | null },
    user: AuthUser,
  ): void {
    if (user.scope.group) return;
    if (template.scope === 'GROUP') return;
    const deptIds = this.departmentIds(user);
    if (template.departmentId && deptIds.includes(template.departmentId)) return;
    throw Forbidden(ErrorCode.OUT_OF_SCOPE, 'This template belongs to another department.');
  }

  /** FR-LIB-05 — Department Heads may only manage their own department's templates. */
  private assertCanEdit(
    template: { scope: TemplateScope; departmentId: string | null },
    user: AuthUser,
  ): void {
    if (this.isGroupAdmin(user) || user.scope.group) return;
    if (template.scope === 'DEPARTMENT') {
      const deptIds = this.departmentIds(user);
      if (template.departmentId && deptIds.includes(template.departmentId)) return;
    }
    throw Forbidden(ErrorCode.OUT_OF_SCOPE, 'You may only manage templates of your own department.');
  }

  private employeeInScope(
    user: AuthUser,
    employee: { id: string; departmentId: string | null },
  ): boolean {
    if (user.scope.group) return true;
    if (employee.id === user.id) return true;
    const deptIds = this.departmentIds(user);
    return !!employee.departmentId && deptIds.includes(employee.departmentId);
  }

  /** KpiCategory seed — the four BRD categories are created on demand. */
  private async ensureCategories(): Promise<void> {
    const existing = await this.prisma.kpiCategory.findMany({ select: { code: true } });
    const have = new Set(existing.map((row) => row.code as string));
    for (let index = 0; index < KPI_CATEGORIES.length; index += 1) {
      const category = KPI_CATEGORIES[index];
      if (have.has(category.code)) continue;
      await this.prisma.kpiCategory.upsert({
        where: { code: category.code as KpiCategoryCode },
        create: { code: category.code as KpiCategoryCode, name: category.name, sortOrder: index },
        update: { name: category.name, sortOrder: index },
      });
    }
  }

  /** `TPL-` + uppercase slug, max 32 chars, numeric suffix when taken. */
  private async uniqueTemplateCode(name: string): Promise<string> {
    const slug = name
      .toUpperCase()
      .normalize('NFKD')
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28);
    const base = `TPL-${slug || Date.now().toString(36).toUpperCase()}`;
    let candidate = base.slice(0, 32);
    let suffix = 2;
    for (;;) {
      const taken = await this.prisma.kpiTemplate.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
      const tail = `-${suffix}`;
      candidate = `${base.slice(0, Math.max(1, 32 - tail.length))}${tail}`;
      suffix += 1;
    }
  }

  /** `KPI-{BU}-{YYYY}-{000000}` — next free sequence for the BU/year. */
  private async nextKpiCode(businessUnitCode: string, year: number): Promise<string> {
    const prefix = `KPI-${businessUnitCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || 'GRP'}-${year}-`;
    const last = await this.prisma.kpi.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    let sequence = last ? Number.parseInt(last.code.slice(prefix.length), 10) || 0 : 0;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      sequence += 1;
      const candidate = `${prefix}${String(sequence).padStart(6, '0')}`;
      const taken = await this.prisma.kpi.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${prefix}${Date.now().toString().slice(-6)}`;
  }

  // ------------------------------------------------------- FR-LIB-01 list / get

  /** Templates visible to the caller: GROUP + the caller's DEPARTMENT templates. */
  async list(query: TemplateListQuery, user: AuthUser) {
    const { page, size, skip, take } = this.paging(query);

    const where: Prisma.KpiTemplateWhereInput = {};
    if (!user.scope.group) {
      const deptIds = this.departmentIds(user);
      where.OR = [
        { scope: 'GROUP' },
        { scope: 'DEPARTMENT', departmentId: { in: deptIds.length ? deptIds : ['__none__'] } },
      ];
    }

    if (query?.scope && Object.values(TemplateScope).includes(query.scope as TemplateScope)) {
      where.scope = query.scope as TemplateScope;
    }
    if (
      query?.measurementType &&
      Object.values(MeasurementType).includes(query.measurementType as MeasurementType)
    ) {
      where.measurementType = query.measurementType as MeasurementType;
    }
    if (query?.categoryId) where.categoryId = query.categoryId;

    if (query?.isPublished !== undefined && query.isPublished !== '') {
      where.isPublished = String(query.isPublished) === 'true';
    }

    const search = query?.search?.trim();
    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.kpiTemplate.count({ where }),
      this.prisma.kpiTemplate.findMany({
        where,
        orderBy: [{ scope: 'asc' }, { name: 'asc' }],
        skip,
        take,
        include: {
          category: { select: { id: true, code: true, name: true } },
          department: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);

    const items = rows.map((row) => ({
      ...row,
      departmentName: row.department?.name ?? 'Group-wide',
    }));

    return {
      items,
      page,
      size,
      total,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  /** Single template with its category and owning department. */
  async get(id: string, user: AuthUser) {
    const template = await this.prisma.kpiTemplate.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, name: true, code: true } },
      },
    });
    if (!template) throw NotFound(ErrorCode.NOT_FOUND, 'Template not found.');
    this.assertVisible(template, user);
    return { ...template, departmentName: template.department?.name ?? 'Group-wide' };
  }

  // ------------------------------------------------------- FR-LIB-01 create / edit

  /** FR-LIB-01 — Super Admin / HR Admin create GROUP templates; Department Heads own DEPARTMENT ones. */
  async create(dto: CreateTemplateInput, user: AuthUser, meta: RequestContextMeta) {
    await this.ensureCategories();

    const scope: TemplateScope = this.isGroupAdmin(user) ? 'GROUP' : 'DEPARTMENT';
    let departmentId: string | null = null;
    let businessUnitId: string | null = null;
    if (scope === 'DEPARTMENT') {
      if (!user.departmentId) {
        throw Forbidden(ErrorCode.OUT_OF_SCOPE, 'You are not assigned to a department.');
      }
      departmentId = user.departmentId;
      businessUnitId = user.businessUnitId;
    }

    const category = await this.prisma.kpiCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw NotFound(ErrorCode.NOT_FOUND, 'KPI category not found.');

    const code = await this.uniqueTemplateCode(dto.name);

    const created = await this.prisma.kpiTemplate.create({
      data: {
        code,
        name: dto.name.trim(),
        description: dto.description?.trim() ?? null,
        kpiType: (dto.kpiType as KpiType) ?? 'VARIABLE',
        categoryId: dto.categoryId,
        measurementType: dto.measurementType as MeasurementType,
        unit: dto.unit,
        direction: dto.direction as Direction,
        suggestedWeight: Math.trunc(dto.suggestedWeight),
        rubricDescriptors:
          dto.rubricDescriptors === undefined || dto.rubricDescriptors === null
            ? undefined
            : (dto.rubricDescriptors as Prisma.InputJsonValue),
        scope,
        businessUnitId,
        departmentId,
        version: 1,
        isPublished: dto.isPublished ?? true,
        createdById: user.id,
      },
      include: {
        category: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.TEMPLATE_CREATE,
      entityType: 'kpi_template',
      entityId: created.id,
      actor: user,
      departmentId,
      businessUnitId,
      after: {
        code: created.code,
        name: created.name,
        scope: created.scope,
        measurementType: created.measurementType,
        direction: created.direction,
        suggestedWeight: created.suggestedWeight,
      },
      meta,
    });

    return created;
  }

  /** FR-LIB-05 — editing creates a new template version (same code, version + 1). */
  async update(id: string, dto: UpdateTemplateInput, user: AuthUser, meta: RequestContextMeta) {
    const before = await this.prisma.kpiTemplate.findUnique({ where: { id } });
    if (!before) throw NotFound(ErrorCode.NOT_FOUND, 'Template not found.');
    this.assertVisible(before, user);
    this.assertCanEdit(before, user);

    const data: Prisma.KpiTemplateUpdateInput = { version: { increment: 1 } };
    const changedFields: string[] = [];

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
      changedFields.push('name');
    }
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() ?? null;
      changedFields.push('description');
    }
    if (dto.categoryId !== undefined && dto.categoryId !== before.categoryId) {
      await this.ensureCategories();
      const category = await this.prisma.kpiCategory.findUnique({ where: { id: dto.categoryId } });
      if (!category) throw NotFound(ErrorCode.NOT_FOUND, 'KPI category not found.');
      data.category = { connect: { id: dto.categoryId } };
      changedFields.push('categoryId');
    }
    if (dto.kpiType !== undefined) {
      data.kpiType = dto.kpiType as KpiType;
      changedFields.push('kpiType');
    }
    if (dto.measurementType !== undefined) {
      data.measurementType = dto.measurementType as MeasurementType;
      changedFields.push('measurementType');
    }
    if (dto.unit !== undefined) {
      data.unit = dto.unit;
      changedFields.push('unit');
    }
    if (dto.direction !== undefined) {
      data.direction = dto.direction as Direction;
      changedFields.push('direction');
    }
    if (dto.suggestedWeight !== undefined) {
      data.suggestedWeight = Math.trunc(dto.suggestedWeight);
      changedFields.push('suggestedWeight');
    }
    if (dto.rubricDescriptors !== undefined) {
      data.rubricDescriptors =
        dto.rubricDescriptors === null
          ? Prisma.DbNull
          : (dto.rubricDescriptors as Prisma.InputJsonValue);
      changedFields.push('rubricDescriptors');
    }

    if (!changedFields.length) {
      throw BadRequest(ErrorCode.V_MISSING, 'Nothing to update: provide at least one template field.');
    }

    const after = await this.prisma.kpiTemplate.update({
      where: { id },
      data,
      include: {
        category: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.TEMPLATE_UPDATE,
      entityType: 'kpi_template',
      entityId: id,
      actor: user,
      departmentId: before.departmentId,
      businessUnitId: before.businessUnitId,
      before: {
        code: before.code,
        version: before.version,
        name: before.name,
        description: before.description,
        measurementType: before.measurementType,
        unit: before.unit,
        direction: before.direction,
        suggestedWeight: before.suggestedWeight,
        rubricDescriptors: before.rubricDescriptors,
      },
      after: {
        code: after.code,
        version: after.version,
        name: after.name,
        description: after.description,
        measurementType: after.measurementType,
        unit: after.unit,
        direction: after.direction,
        suggestedWeight: after.suggestedWeight,
        rubricDescriptors: after.rubricDescriptors,
      },
      changedFields,
      meta,
    });

    return after;
  }

  /** Publish / unpublish a template. */
  async publish(id: string, isPublished: boolean, user: AuthUser, meta: RequestContextMeta) {
    const before = await this.prisma.kpiTemplate.findUnique({ where: { id } });
    if (!before) throw NotFound(ErrorCode.NOT_FOUND, 'Template not found.');
    this.assertVisible(before, user);
    this.assertCanEdit(before, user);

    const after = await this.prisma.kpiTemplate.update({
      where: { id },
      data: { isPublished },
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.TEMPLATE_PUBLISH,
      entityType: 'kpi_template',
      entityId: id,
      actor: user,
      departmentId: before.departmentId,
      businessUnitId: before.businessUnitId,
      before: { isPublished: before.isPublished, version: before.version },
      after: { isPublished: after.isPublished, version: after.version },
      meta,
    });

    return after;
  }

  // --------------------------------------------------- FR-LIB-02 create from template

  /** Pre-fills a KPI form from a published template (called by the KPI module). */
  async createFromTemplate(
    templateId: string,
    employeeId: string,
    periodId: string,
    overrides: FromTemplateOverrides | undefined,
    user: AuthUser,
    meta: RequestContextMeta,
  ) {
    const template = await this.prisma.kpiTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw NotFound(ErrorCode.NOT_FOUND, 'Template not found.');
    if (!template.isPublished) {
      throw Conflict(ErrorCode.CONFLICT, 'This template is not published and cannot be used.');
    }

    const employee = await this.prisma.user.findUnique({
      where: { id: employeeId },
      select: { id: true, departmentId: true, businessUnitId: true },
    });
    if (!employee) throw NotFound(ErrorCode.NOT_FOUND, 'Employee not found.');

    const period = await this.prisma.kpiPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, code: true, label: true, status: true },
    });
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'Period not found.');

    const visibleToEmployee =
      template.scope === 'GROUP' ||
      (!!template.departmentId && template.departmentId === employee.departmentId);
    if (!visibleToEmployee) {
      throw Forbidden(ErrorCode.OUT_OF_SCOPE, 'This template is not available to the employee’s department.');
    }

    return {
      name: overrides?.name?.trim() || template.name,
      description:
        overrides?.description !== undefined ? overrides.description : (template.description ?? null),
      categoryId: template.categoryId,
      measurementType: template.measurementType,
      unit: overrides?.unit ?? template.unit,
      direction: overrides?.direction ?? template.direction,
      suggestedWeight: overrides?.suggestedWeight ?? template.suggestedWeight,
      rubricDescriptors:
        overrides?.rubricDescriptors !== undefined
          ? overrides.rubricDescriptors
          : (template.rubricDescriptors ?? null),
      templateId: template.id,
      templateVersion: template.version,
    };
  }

  // ------------------------------------------------------------- FR-LIB-03 / UC-08 assign

  /**
   * Assign a template to a list of employees. Every rejected row is reported as a
   * conflict with its BRD code (W-EXCEED / KPI-DUP / MAX-KPI / OUT-OF-SCOPE).
   */
  async assign(dto: AssignInput, user: AuthUser, meta: RequestContextMeta) {
    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: dto.periodId } });
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'Period not found.');
    if (period.status === 'CLOSED') {
      throw Conflict(ErrorCode.PERIOD_CLOSED, `${period.label} is closed; assignments are not allowed.`);
    }
    if (daysRemaining(period.submissionDeadline) < 0) {
      throw Conflict(
        ErrorCode.DEADLINE_PASSED,
        `The submission deadline (${formatDate(period.submissionDeadline)}) has passed.`,
      );
    }

    const template = await this.prisma.kpiTemplate.findUnique({ where: { id: dto.templateId } });
    if (!template) throw NotFound(ErrorCode.NOT_FOUND, 'Template not found.');
    if (!template.isPublished) {
      throw Conflict(ErrorCode.CONFLICT, 'This template is not published and cannot be assigned.');
    }
    await this.ensureCategories();

    const rows = Array.isArray(dto.rows) ? dto.rows : [];
    if (!rows.length) throw BadRequest(ErrorCode.V_MISSING, 'At least one employee row is required.');

    const config = await this.prisma.configurationVersion.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    const maxKpis = config?.maxKpisPerPeriod ?? 10;
    const minWeight = config?.minWeight ?? 1;
    const maxWeight = config?.maxWeight ?? 100;
    const qualitativeMap = (config?.qualitativeMap ?? DEFAULT_QUALITATIVE_MAP) as Record<string, number>;

    const employeeIds = Array.from(new Set(rows.map((row) => row.employeeId)));
    const employees = await this.prisma.user.findMany({
      where: { id: { in: employeeIds } },
      select: {
        id: true,
        fullName: true,
        email: true,
        emailDigest: true,
        employeeCode: true,
        departmentId: true,
        businessUnitId: true,
        businessUnit: { select: { code: true } },
        department: { select: { name: true } },
      },
    });
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

    const allocationRows = await this.prisma.kpi.groupBy({
      by: ['employeeId'],
      where: {
        employeeId: { in: employeeIds },
        periodId: period.id,
        frequency: period.frequency,
        status: { notIn: ['REJECTED', 'DELETED'] },
      },
      _sum: { kpiWeight: true },
    });
    const allocated = new Map<string, number>(
      allocationRows.map((row) => [row.employeeId, row._sum.kpiWeight ?? 0]),
    );

    const existingKpis = await this.prisma.kpi.findMany({
      where: { employeeId: { in: employeeIds }, periodId: period.id, status: { not: 'DELETED' } },
      select: { employeeId: true, name: true },
    });
    const namesByEmployee = new Map<string, Set<string>>();
    const countByEmployee = new Map<string, number>();
    for (const row of existingKpis) {
      const names = namesByEmployee.get(row.employeeId) ?? new Set<string>();
      names.add(row.name.toLowerCase());
      namesByEmployee.set(row.employeeId, names);
      countByEmployee.set(row.employeeId, (countByEmployee.get(row.employeeId) ?? 0) + 1);
    }

    const conflicts: AssignmentConflict[] = [];
    const createdList: Array<{ id: string; code: string; employeeId: string; name: string; weight: number }> = [];

    for (const row of rows) {
      const employee = employeeMap.get(row.employeeId);
      if (!employee) {
        conflicts.push({
          employeeId: row.employeeId,
          employeeName: '—',
          reason: 'Employee not found.',
          code: ErrorCode.NOT_FOUND,
        });
        continue;
      }

      if (!this.employeeInScope(user, employee)) {
        conflicts.push({
          employeeId: employee.id,
          employeeName: employee.fullName,
          reason: `${employee.fullName} is outside your department scope.`,
          code: ErrorCode.OUT_OF_SCOPE,
        });
        continue;
      }

      const weight = Math.trunc(Number(row.weight));
      if (!Number.isFinite(weight) || weight < minWeight) {
        conflicts.push({
          employeeId: employee.id,
          employeeName: employee.fullName,
          reason: `Weight must be at least ${minWeight}%.`,
          code: ErrorCode.W_MIN,
        });
        continue;
      }
      if (weight > maxWeight) {
        conflicts.push({
          employeeId: employee.id,
          employeeName: employee.fullName,
          reason: `Weight must not exceed ${maxWeight}%.`,
          code: ErrorCode.W_MAX,
        });
        continue;
      }

      const currentAllocated = allocated.get(employee.id) ?? 0;
      const available = Math.max(0, 100 - currentAllocated);
      if (weight > available) {
        conflicts.push({
          employeeId: employee.id,
          employeeName: employee.fullName,
          reason: weightExceededMessage(Math.max(0, weight - available), available),
          code: ErrorCode.W_EXCEED,
          availableWeight: available,
        });
        continue;
      }

      const nameKey = template.name.trim().toLowerCase();
      const names = namesByEmployee.get(employee.id) ?? new Set<string>();
      if (names.has(nameKey)) {
        conflicts.push({
          employeeId: employee.id,
          employeeName: employee.fullName,
          reason: `“${template.name}” already exists for ${employee.fullName} in ${period.label}.`,
          code: ErrorCode.KPI_DUP,
        });
        continue;
      }

      const count = countByEmployee.get(employee.id) ?? 0;
      if (count >= maxKpis) {
        conflicts.push({
          employeeId: employee.id,
          employeeName: employee.fullName,
          reason: `${employee.fullName} already has ${count} KPIs in ${period.label} (maximum ${maxKpis}).`,
          code: ErrorCode.MAX_KPI,
        });
        continue;
      }

      const target =
        row.target === undefined || row.target === null || row.target === ''
          ? null
          : String(row.target);
      const code = await this.nextKpiCode(employee.businessUnit?.code ?? 'GRP', period.year);

      const kpi = await this.prisma.kpi.create({
        data: {
          code,
          employeeId: employee.id,
          periodId: period.id,
          frequency: period.frequency,
          kpiType: template.kpiType,
          templateId: template.id,
          name: template.name,
          description: template.description ? template.description.slice(0, 500) : null,
          categoryId: template.categoryId,
          measurementType: template.measurementType,
          unit: template.unit,
          direction: template.direction,
          target,
          kpiWeight: weight,
          status: 'DRAFT',
          isAssigned: true,
          assignedById: user.id,
          targetLocked: true,
          weightLocked: true,
          businessUnitId: employee.businessUnitId,
          departmentId: employee.departmentId,
          currentVersionNo: 1,
          configVersionId: config?.id ?? null,
          qualitativeMapSnapshot:
            template.measurementType === 'QUALITATIVE'
              ? (qualitativeMap as Prisma.InputJsonValue)
              : undefined,
          versions: {
            create: {
              versionNo: 1,
              snapshot: {
                trigger: 'ASSIGN',
                name: template.name,
                target,
                actual: null,
                kpiWeight: weight,
                achievement: null,
                calculatedScore: null,
                finalScore: null,
                weightedScore: null,
                status: 'DRAFT',
                templateId: template.id,
                templateVersion: template.version,
              } as Prisma.InputJsonValue,
              changeReason: `Assigned from template ${template.code} v${template.version}`,
              trigger: 'ASSIGN',
              createdById: user.id,
            },
          },
        },
      });

      names.add(nameKey);
      namesByEmployee.set(employee.id, names);
      countByEmployee.set(employee.id, count + 1);
      allocated.set(employee.id, currentAllocated + weight);
      createdList.push({
        id: kpi.id,
        code: kpi.code,
        employeeId: employee.id,
        name: kpi.name,
        weight: kpi.kpiWeight,
      });

      await this.audit.record({
        action: AUDIT_ACTIONS.ASSIGNMENT_CREATE,
        entityType: 'kpi',
        entityId: kpi.id,
        actor: user,
        employeeId: employee.id,
        departmentId: employee.departmentId,
        after: {
          templateId: template.id,
          templateCode: template.code,
          templateVersion: template.version,
          period: period.code,
          target: dec(target),
          weight,
        },
        meta,
      });

      await this.notifications.notify({
        code: NT.KPI_ASSIGNED,
        recipients: [
          {
            userId: employee.id,
            email: employee.email,
            fullName: employee.fullName,
            emailDigest: employee.emailDigest,
          },
        ],
        title: `A KPI has been assigned to you: ${template.name}`,
        body: `Your Department Head assigned “${template.name}” for ${period.label}. Target ${formatByMeasurementType(target, template.measurementType, template.unit)}, weight ${weight}%.`,
        deepLink: `/my-kpi?kpi=${kpi.id}`,
        entityType: 'kpi',
        entityId: kpi.id,
        emailContext: {
          kpiUrl: this.appUrl(`/my-kpi?kpi=${kpi.id}`),
          kpiName: template.name,
          period: period.label,
          target: formatByMeasurementType(target, template.measurementType, template.unit),
          weight: `${weight}%`,
          deadline: formatDate(period.submissionDeadline),
        },
      });
    }

    const assignmentDepartmentId =
      template.departmentId ?? user.departmentId ?? user.scope.departmentIds[0] ?? null;
    if (!assignmentDepartmentId) {
      throw BadRequest(ErrorCode.V_MISSING, 'Cannot resolve the department for this assignment.');
    }

    const assignment = await this.prisma.kpiAssignment.create({
      data: {
        templateId: template.id,
        departmentId: assignmentDepartmentId,
        periodId: period.id,
        assignedById: user.id,
        employeeCount: rows.length,
        createdCount: createdList.length,
        conflictCount: conflicts.length,
        conflicts: conflicts.length
          ? (conflicts as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });

    return {
      created: createdList.length,
      assignmentId: assignment.id,
      conflicts,
      assignments: createdList,
    };
  }

  // ----------------------------------------------------------------- categories

  /** GET /kpi-library/categories — ensures the four BRD categories exist. */
  async categories() {
    await this.ensureCategories();
    return this.prisma.kpiCategory.findMany({ orderBy: { sortOrder: 'asc' } });
  }
}
