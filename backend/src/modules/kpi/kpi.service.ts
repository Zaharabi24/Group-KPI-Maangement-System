/**
 * M05 — My KPI: creation, submission, detail, versions and corrections.
 * Implements BR-R01…BR-R12, §3.3–§3.8, §4 and the UC-03 / UC-12 flows.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, KpiStatus, Frequency, MeasurementType, Direction, KpiType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PerformanceService } from '../performance/performance.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../../queue/queue.service';
import { EvidenceStorageService } from '../evidence/evidence-storage.service';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import {
  Conflict,
  ErrorCode,
  Forbidden,
  NotFound,
  Unprocessable,
  weightExceededMessage,
} from '../../common/errors/error-codes';
import { AUDIT_ACTIONS, NT, REJECT_CATEGORIES } from '../../common/constants';
import {
  CalculationError,
  calculateKpi,
  stepperFor,
} from '../calculation/calculation.engine';
import { dec, decOrNull, Decimal, decimalPlaces } from '../../common/utils/decimal.util';
import { daysRemaining, formatDate, formatDateTime } from '../../common/utils/period.util';
import { CreateKpiDto, UpdateKpiDto } from './dto/kpi.dto';

/** Per-measurement-type numeric precision and bounds (§3.4, V-NUM-02). */
const PRECISION: Record<string, { decimals: number; max?: number }> = {
  COUNT: { decimals: 0 },
  MONETARY: { decimals: 2, max: 999_999_999_999_999 },
  PERCENTAGE: { decimals: 2, max: 1000 },
  TIME: { decimals: 2 },
  RATING: { decimals: 1 },
  QUALITATIVE: { decimals: 0 },
};

@Injectable()
export class KpiService {
  private readonly logger = new Logger(KpiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly notifications: NotificationsService,
    private readonly performance: PerformanceService,
    private readonly audit: AuditService,
    private readonly storage: EvidenceStorageService,
    private readonly queue: QueueService,
  ) {}

  // ===================================================================== config

  async activeConfig() {
    const config = await this.prisma.configurationVersion.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    if (config) return config;
    // Fall back to the documented defaults so a fresh install works (§21.4 D-07/08/09)
    return {
      id: null as string | null,
      version: 0,
      scoreCap: new Decimal(120),
      scoreFloor: new Decimal(0),
      adjustmentBand: new Decimal(10),
      minWeight: 5,
      maxWeight: 50,
      maxKpisPerPeriod: 10,
      submissionGraceDays: 7,
      reviewWindowDays: 7,
      reviewSlaDays: 5,
      extensionMaxDays: 7,
      minReasonLength: 15,
      maxEvidenceFiles: 5,
      maxEvidenceSizeMb: 10,
      qualitativeMap: { '1': 50, '2': 75, '3': 100, '4': 110, '5': 120 },
      ragThresholds: { green: 95, amber: 75 },
      categories: ['FINANCIAL', 'CUSTOMER', 'INTERNAL_PROCESS', 'PEOPLE_LEARNING'],
      allowedMimeTypes: [],
      isActive: true,
      effectiveFrom: new Date(),
      notes: null,
      publishedById: null,
      createdAt: new Date(),
    };
  }

  // ================================================================ read models

  /** FR-KPI-01/02/03 — My KPI list with status chip counts. */
  async myKpis(user: AuthUser, query: { frequency?: string; periodId?: string; periodCode?: string; status?: string; search?: string; categoryId?: string; page?: string; size?: string }) {
    const page = Math.max(1, Number(query.page ?? 1));
    const size = Math.min(100, Math.max(1, Number(query.size ?? 50)));

    const period = await this.resolvePeriod(query);
    const where: Prisma.KpiWhereInput = { employeeId: user.id };

    if (query.frequency) where.frequency = query.frequency as Frequency;
    if (period) where.periodId = period.id;
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };
    if (query.categoryId) where.categoryId = query.categoryId;

    const all = await this.prisma.kpi.findMany({
      where,
      include: {
        category: { select: { id: true, code: true, name: true } },
        period: { select: { id: true, code: true, label: true, frequency: true, submissionDeadline: true, status: true } },
        approver: { select: { id: true, fullName: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 2000,
    });

    const counts: Record<string, number> = {};
    all.forEach((k) => {
      counts[k.status] = (counts[k.status] ?? 0) + 1;
    });

    const filtered = query.status
      ? all.filter((k) => k.status === query.status)
      : all;

    const items = filtered.slice((page - 1) * size, page * size).map((k) => this.toCard(k, period));

    const allocated = await this.allocatedWeight(user.id, period?.id ?? null, (query.frequency as Frequency) ?? period?.frequency ?? null, null);

    return {
      items,
      counts,
      total: filtered.length,
      page,
      size,
      totalPages: Math.max(1, Math.ceil(filtered.length / size)),
      period,
      allocatedWeight: allocated,
      availableWeight: Math.max(0, 100 - allocated),
    };
  }

  /** Builds the KPI card payload used by the My KPI grid (FR-KPI-03). */
  private toCard(
    k: {
      id: string;
      code: string;
      name: string;
      status: KpiStatus;
      target: Prisma.Decimal | null;
      actual: Prisma.Decimal | null;
      achievement: Prisma.Decimal | null;
      calculatedScore: Prisma.Decimal | null;
      finalScore: Prisma.Decimal | null;
      overrideScore: Prisma.Decimal | null;
      kpiWeight: number;
      weightedScore: Prisma.Decimal | null;
      measurementType: MeasurementType;
      unit: string;
      direction: Direction;
      isLocked: boolean;
      isAssigned: boolean;
      evidenceCount: number;
      rubricLevel: number | null;
      returnComment: string | null;
      submittedAt: Date | null;
      decidedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      category: { id: string; code: string; name: string };
      period: { id: string; code: string; label: string; frequency: Frequency; submissionDeadline: Date; status: string } | null;
      approver: { id: string; fullName: string } | null;
      department: { id: string; name: string } | null;
    },
    period: { id: string; submissionDeadline: Date; status: string } | null,
  ) {
    const deadline = k.period?.submissionDeadline ?? period?.submissionDeadline ?? null;
    const remaining = deadline ? daysRemaining(deadline) : null;
    const stepper = stepperFor({
      status: k.status,
      target: k.target,
      actual: k.actual,
      evidenceCount: k.evidenceCount,
      calculatedScore: k.calculatedScore,
      reviewStartedAt: k.submittedAt,
      decidedAt: k.decidedAt,
    });

    return {
      id: k.id,
      code: k.code,
      name: k.name,
      category: k.category.name,
      categoryCode: k.category.code,
      kpiWeight: k.kpiWeight,
      status: k.status,
      isLocked: k.isLocked,
      isAssigned: k.isAssigned,
      measurementType: k.measurementType,
      unit: k.unit,
      direction: k.direction,
      rubricLevel: k.rubricLevel,
      target: decOrNull(k.target),
      actual: decOrNull(k.actual),
      achievement: decOrNull(k.achievement),
      calculatedScore: decOrNull(k.calculatedScore),
      finalScore: decOrNull(k.finalScore),
      weightedScore: decOrNull(k.weightedScore),
      scoreTag: k.status === 'APPROVED' ? 'final' : k.calculatedScore ? 'calc.' : null,
      adjusted: k.overrideScore !== null,
      evidenceCount: k.evidenceCount,
      approver: k.approver?.fullName ?? 'Super Admin',
      period: k.period,
      daysRemaining: remaining,
      deadlineState:
        remaining === null
          ? null
          : k.period?.status === 'CLOSED'
            ? 'closed'
            : remaining < 0
              ? 'overdue'
              : remaining === 0
                ? 'due_today'
                : remaining <= 3
                  ? 'soon'
                  : 'open',
      stepper,
      returnComment: k.returnComment,
      submittedAt: k.submittedAt,
      decidedAt: k.decidedAt,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
    };
  }

  /** FR-KPI-08 — the full KPI detail view including the calculation path. */
  async detail(id: string, user: AuthUser) {
    const kpi = await this.prisma.kpi.findUnique({
      where: { id },
      include: {
        category: true,
        period: true,
        approver: { select: { id: true, fullName: true, email: true, employeeCode: true, designationTitle: true } },
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            email: true,
            designationTitle: true,
            businessUnit: { select: { id: true, name: true, code: true } },
            department: { select: { id: true, name: true } },
          },
        },
        department: { select: { id: true, name: true } },
        businessUnit: { select: { id: true, name: true, code: true } },
        configVersion: true,
        evidence: {
          orderBy: [{ createdAt: 'asc' }],
        },
        adjustments: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { id: true, fullName: true, roles: { select: { role: { select: { code: true } } } } } } },
        },
        decisions: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { id: true, fullName: true } } },
        },
        escalations: { orderBy: { createdAt: 'desc' }, take: 5 },
        corrections: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');

    this.scope.assertKpiInScope(user, {
      employeeId: kpi.employeeId,
      departmentId: kpi.departmentId,
      businessUnitId: kpi.businessUnitId,
    });

    // FR-KPI-08: the calculation path has exactly Formula, Achievement,
    // Calculated Score, Final Score, KPI Weight and Weighted Score.
    const latestLog = await this.prisma.calculationLog.findFirst({
      where: { kpiId: id },
      orderBy: { createdAt: 'desc' },
    });

    const calculationPath = [
      { label: 'Formula', value: latestLog?.formulaText ?? this.formulaTextFor(kpi), mono: true },
      { label: 'Achievement', value: decOrNull(kpi.achievement), suffix: '%' },
      { label: 'Calculated Score', value: decOrNull(kpi.calculatedScore) },
      {
        label: 'Final Score',
        value: kpi.status === 'APPROVED' ? decOrNull(kpi.finalScore) : null,
        pending: kpi.status !== 'APPROVED',
      },
      { label: 'KPI Weight', value: String(kpi.kpiWeight), suffix: '%' },
      { label: 'Weighted Score', value: decOrNull(kpi.weightedScore) },
    ];

    const deadlineRemaining = daysRemaining(kpi.period.submissionDeadline);

    return {
      id: kpi.id,
      code: kpi.code,
      name: kpi.name,
      description: kpi.description,
      status: kpi.status,
      isLocked: kpi.isLocked,
      isAssigned: kpi.isAssigned,
      targetLocked: kpi.targetLocked,
      weightLocked: kpi.weightLocked,
      kpiType: kpi.kpiType,
      frequency: kpi.frequency,
      period: {
        ...kpi.period,
        daysRemaining: deadlineRemaining,
      },
      category: kpi.category,
      measurementType: kpi.measurementType,
      unit: kpi.unit,
      direction: kpi.direction,
      target: decOrNull(kpi.target),
      actual: decOrNull(kpi.actual),
      rubricLevel: kpi.rubricLevel,
      achievement: decOrNull(kpi.achievement),
      calculatedScore: decOrNull(kpi.calculatedScore),
      finalScore: decOrNull(kpi.finalScore),
      overrideScore: decOrNull(kpi.overrideScore),
      kpiWeight: kpi.kpiWeight,
      weightedScore: decOrNull(kpi.weightedScore),
      remarks: kpi.remarks,
      evidenceCount: kpi.evidenceCount,
      dataSource: kpi.description ?? 'Employee-entered with evidence',
      employee: kpi.employee,
      organisation: {
        businessUnit: kpi.businessUnit ?? kpi.employee.businessUnit,
        department: kpi.department ?? kpi.employee.department,
      },
      approver: kpi.approver
        ? { id: kpi.approver.id, fullName: kpi.approver.fullName, email: kpi.approver.email, isSuperAdmin: false }
        : { id: null, fullName: 'Super Admin', email: null, isSuperAdmin: true },
      rowVersion: kpi.rowVersion,
      currentVersionNo: kpi.currentVersionNo,
      configVersion: kpi.configVersion ? kpi.configVersion.version : null,
      submittedAt: kpi.submittedAt,
      reviewStartedAt: kpi.reviewStartedAt,
      decidedAt: kpi.decidedAt,
      returnComment: kpi.returnComment,
      rejectedReason: kpi.rejectedReason,
      rejectCategory: kpi.rejectCategory,
      calculationPath,
      stepper: stepperFor({
        status: kpi.status,
        target: kpi.target,
        actual: kpi.actual,
        evidenceCount: kpi.evidenceCount,
        calculatedScore: kpi.calculatedScore,
        reviewStartedAt: kpi.reviewStartedAt,
        decidedAt: kpi.decidedAt,
      }),
      evidence: kpi.evidence.map((e) => ({
        id: e.id,
        originalName: e.originalName,
        fileName: e.fileName,
        mimeType: e.mimeType,
        extension: e.extension,
        sizeBytes: e.sizeBytes,
        sha256: e.sha256,
        scanStatus: e.scanStatus,
        isCurrent: e.isCurrent,
        versionNo: e.versionNo,
        createdAt: e.createdAt,
        previewable: ['pdf', 'jpg', 'jpeg', 'png'].includes(e.extension),
      })),
      adjustmentHistory: kpi.adjustments.map((a) => ({
        id: a.id,
        field: a.field,
        oldValue: a.oldValue,
        newValue: a.newValue,
        reason: a.reason,
        actor: a.actor.fullName,
        actorRoles: a.actor.roles.map((r) => r.role.code),
        at: a.createdAt,
      })),
      decisionHistory: kpi.decisions.map((d) => ({
        id: d.id,
        action: d.action,
        actor: d.actor.fullName,
        reason: d.reason,
        rejectCategory: d.rejectCategory,
        scoreBefore: decOrNull(d.scoreBefore),
        scoreAfter: decOrNull(d.scoreAfter),
        statusBefore: d.statusBefore,
        statusAfter: d.statusAfter,
        at: d.createdAt,
      })),
      escalations: kpi.escalations.map((e) => ({
        id: e.id,
        calculatedScore: decOrNull(e.calculatedScore),
        proposedScore: decOrNull(e.proposedScore),
        delta: decOrNull(e.delta),
        reason: e.reason,
        status: e.status,
        createdAt: e.createdAt,
      })),
      corrections: kpi.corrections.map((c) => ({
        id: c.id,
        reason: c.reason,
        status: c.status,
        createdAt: c.createdAt,
      })),
      canEdit:
        (kpi.employeeId === user.id || user.roles.includes('SUPER_ADMIN')) &&
        ['DRAFT', 'RETURNED'].includes(kpi.status) &&
        !kpi.isLocked,
      canWithdraw: kpi.employeeId === user.id && kpi.status === 'SUBMITTED' && !kpi.isLocked,
      canSubmit: kpi.employeeId === user.id && ['DRAFT', 'RETURNED'].includes(kpi.status) && !kpi.isLocked,
      canDecide: this.scope.canDecide(user, kpi),
      canRequestCorrection: user.roles.includes('DEPT_HEAD') && kpi.status === 'APPROVED',
      canViewVersions: user.id === kpi.employeeId || user.roles.includes('SUPER_ADMIN') || user.roles.includes('DEPT_HEAD') || user.roles.includes('HR_ADMIN'),
      canRestore: user.roles.includes('SUPER_ADMIN'),
    };
  }

  private formulaTextFor(kpi: { measurementType: MeasurementType; direction: Direction; target: Prisma.Decimal | null; actual: Prisma.Decimal | null }): string {
    const t = kpi.target ? Number(kpi.target) : 0;
    const a = kpi.actual ? Number(kpi.actual) : 0;
    if (kpi.measurementType === 'QUALITATIVE') return 'rubric_map[level] (L1=50, L2=75, L3=100, L4=110, L5=120)';
    if (kpi.direction === 'LOWER') return `((2 × target ${t} − actual ${a}) / target ${t}) × 100`;
    return `(actual ${a} / target ${t}) × 100`;
  }

  // =================================================================== helpers

  private async resolvePeriod(query: { periodId?: string; periodCode?: string; frequency?: string }) {
    if (query.periodId) return this.prisma.kpiPeriod.findUnique({ where: { id: query.periodId } });
    if (query.periodCode) return this.prisma.kpiPeriod.findUnique({ where: { code: query.periodCode } });
    if (query.frequency) {
      return this.prisma.kpiPeriod.findFirst({
        where: { frequency: query.frequency as Frequency },
        orderBy: { startDate: 'desc' },
      });
    }
    return null;
  }

  /** W-2 — allocated weight for one employee, frequency and period. */
  async allocatedWeight(
    employeeId: string,
    periodId: string | null,
    frequency: Frequency | null,
    excludeKpiId: string | null,
  ): Promise<number> {
    if (!periodId && !frequency) return 0;
    const where: Prisma.KpiWhereInput = {
      employeeId,
      status: { notIn: ['REJECTED', 'DELETED'] },
    };
    if (periodId) where.periodId = periodId;
    if (frequency) where.frequency = frequency;
    if (excludeKpiId) where.id = { not: excludeKpiId };

    const rows = await this.prisma.kpi.findMany({ where, select: { kpiWeight: true } });
    return rows.reduce((sum, r) => sum + r.kpiWeight, 0);
  }

  private assertWeightCapacity(allocated: number, weight: number, minWeight: number, maxWeight: number) {
    if (weight < minWeight || weight > maxWeight) {
      throw Unprocessable(
        ErrorCode.W_MIN,
        `KPI Weight must be a whole number between ${minWeight}% and ${maxWeight}%.`,
        [{ field: 'kpiWeight', code: ErrorCode.W_MIN, message: `Use ${minWeight}–${maxWeight}%.` }],
      );
    }
    if (allocated + weight > 100) {
      const overBy = allocated + weight - 100;
      const available = Math.max(0, 100 - allocated);
      throw Conflict(ErrorCode.W_EXCEED, weightExceededMessage(overBy, available), [
        { field: 'kpiWeight', code: ErrorCode.W_EXCEED, message: weightExceededMessage(overBy, available) },
      ]);
    }
  }

  /** §3.4 / §4.8 — precision, negativity and target rules. */
  private assertNumeric(value: number | undefined | null, type: MeasurementType, field: string, opts: { required?: boolean; allowZero?: boolean } = {}) {
    if (value === null || value === undefined) {
      if (opts.required) {
        throw Unprocessable(ErrorCode.V_MISSING, `${field} is required.`, [
          { field, code: ErrorCode.V_MISSING, message: `${field} is required` },
        ]);
      }
      return;
    }
    if (value < 0) {
      throw Unprocessable(ErrorCode.V_NUM_02, `${field} cannot be negative in Phase 01 (V-NUM-02).`, [
        { field, code: ErrorCode.V_NUM_02, message: 'Negative values are not allowed' },
      ]);
    }
    const meta = PRECISION[type] ?? { decimals: 2 };
    if (decimalPlaces(value) > meta.decimals) {
      throw Unprocessable(ErrorCode.V_NUM_02, `${field} accepts at most ${meta.decimals} decimal place(s) for ${type}.`, [
        { field, code: ErrorCode.V_NUM_02, message: `Use at most ${meta.decimals} decimal place(s)` },
      ]);
    }
    if (meta.max !== undefined && value > meta.max) {
      throw Unprocessable(ErrorCode.V_NUM_02, `${field} exceeds the maximum allowed value (${meta.max}).`, [
        { field, code: ErrorCode.V_NUM_02, message: `Maximum ${meta.max}` },
      ]);
    }
    if (opts.allowZero === false && value === 0) {
      throw Unprocessable(ErrorCode.V_NUM_02, `${field} must be greater than 0.`, [
        { field, code: ErrorCode.V_NUM_02, message: 'Must be greater than 0' },
      ]);
    }
  }

  private assertTargetRule(target: number | null | undefined, direction: Direction, type: MeasurementType) {
    if (type === 'QUALITATIVE') return;
    if (direction === 'HIGHER' && (target === null || target === undefined || target <= 0)) {
      throw Unprocessable(ErrorCode.V_TGT_01, 'Target must be greater than 0 for higher-is-better KPIs.', [
        { field: 'target', code: ErrorCode.V_TGT_01, message: 'Target must be greater than 0' },
      ]);
    }
    if (type === 'RATING' && (target === null || target === undefined || target <= 0)) {
      throw Unprocessable(ErrorCode.V_TGT_01, 'Target must be greater than 0 for a Rating KPI.', [
        { field: 'target', code: ErrorCode.V_TGT_01, message: 'Target must be greater than 0' },
      ]);
    }
  }

  /** EC-15 / KPI-DUP — name uniqueness per employee, period and frequency (case-insensitive). */
  private async assertUniqueName(employeeId: string, periodId: string, name: string, excludeKpiId?: string) {
    const clash = await this.prisma.kpi.findFirst({
      where: {
        employeeId,
        periodId,
        name: { equals: name, mode: 'insensitive' },
        status: { notIn: ['DELETED', 'REJECTED'] },
        ...(excludeKpiId ? { id: { not: excludeKpiId } } : {}),
      },
      select: { id: true, name: true },
    });
    if (clash) {
      throw Conflict(ErrorCode.KPI_DUP, 'A KPI with this name already exists for this period.', [
        { field: 'name', code: ErrorCode.KPI_DUP, message: 'Duplicate KPI name for this period' },
      ]);
    }
  }

  /** W-6 — maximum active KPIs per employee, period and frequency. */
  private async assertMaxKpis(employeeId: string, periodId: string, frequency: Frequency, maxKpis: number, excludeKpiId?: string) {
    const count = await this.prisma.kpi.count({
      where: {
        employeeId,
        periodId,
        frequency,
        status: { notIn: ['DELETED', 'REJECTED'] },
        ...(excludeKpiId ? { id: { not: excludeKpiId } } : {}),
      },
    });
    if (count >= maxKpis) {
      throw Conflict(ErrorCode.MAX_KPI, `You already have ${count} active KPIs for this period; the maximum is ${maxKpis}.`, [
        { field: 'name', code: ErrorCode.MAX_KPI, message: `Maximum ${maxKpis} KPIs per period` },
      ]);
    }
  }

  private async assertPeriodOpen(periodId: string, opts: { forSubmit: boolean }) {
    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'The selected period does not exist.');
    if (period.status === 'CLOSED') {
      throw Conflict(ErrorCode.PERIOD_CLOSED, 'This period is closed and locked. A Super Admin must reopen it.', [
        { field: 'periodId', code: ErrorCode.PERIOD_CLOSED, message: 'The period is closed' },
      ]);
    }
    if (opts.forSubmit && period.submissionDeadline < new Date()) {
      throw Conflict(
        ErrorCode.DEADLINE_PASSED,
        `The submission deadline (${formatDate(period.submissionDeadline)}) has passed. Request an extension from your Department Head.`,
        [{ field: 'periodId', code: ErrorCode.DEADLINE_PASSED, message: 'Submission deadline passed' }],
      );
    }
    return period;
  }

  /**
   * BR-R03 — approves must be an active Department Head of the employee's own
   * department, excluding the requester. A Department Head's own KPI is approved
   * by a Super Admin (approverId = null).
   */
  async resolveApprover(employeeId: string, departmentId: string | null, requestedId?: string | null) {
    if (requestedId) {
      const candidate = await this.prisma.user.findUnique({
        where: { id: requestedId },
        select: {
          id: true,
          status: true,
          departmentId: true,
          roles: { select: { role: { select: { code: true } } } },
        },
      });
      const roles = candidate?.roles.map((r) => r.role.code) ?? [];
      if (!candidate || candidate.status !== 'ACTIVE') {
        throw Forbidden(ErrorCode.APPROVER_INVALID, 'The selected approver is not an active user.');
      }
      if (candidate.id === employeeId) {
        throw Forbidden(ErrorCode.SELF_DECISION, 'You cannot be your own approver.');
      }
      if (roles.includes('SUPER_ADMIN')) return requestedId;
      if (!departmentId || candidate.departmentId !== departmentId) {
        throw Forbidden(
          ErrorCode.APPROVER_INVALID,
          'Your Approval Person must be an active Department Head of your own department.',
        );
      }
      if (!roles.includes('DEPT_HEAD')) {
        throw Forbidden(
          ErrorCode.APPROVER_INVALID,
          'Your Approval Person must be an active Department Head of your own department.',
        );
      }
      return requestedId;
    }

    // Department Head or Super Admin? → Super Admin decides (FR-APR-08)
    const employee = await this.prisma.user.findUnique({
      where: { id: employeeId },
      select: { roles: { select: { role: { select: { code: true } } } } },
    });
    const employeeRoles = employee?.roles.map((r) => r.role.code) ?? [];
    if (employeeRoles.includes('DEPT_HEAD') || employeeRoles.includes('SUPER_ADMIN')) return null;

    const heads = await this.availableApprovers(employeeId, departmentId);
    if (!heads.length) {
      throw Conflict(
        ErrorCode.APPROVER_REQUIRED,
        'Your department has no active approver yet. Ask Group HR or a Super Admin to invite a Department Head.',
      );
    }
    if (heads.length === 1) return heads[0].id;
    return null; // the employee must choose
  }

  async availableApprovers(excludeUserId?: string, departmentId?: string | null) {
    const department = departmentId
      ? await this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } })
      : null;
    const rows = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        ...(department ? { departmentId: department.id } : {}),
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        roles: { some: { role: { code: 'DEPT_HEAD' } } },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        employeeCode: true,
        designationTitle: true,
        department: { select: { id: true, name: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    return rows;
  }

  /** `KPI-{BU}-{YYYY}-{000000}` (§3.3 S7). */
  private async nextKpiCode(businessUnitCode: string, year: number, tx: Prisma.TransactionClient): Promise<string> {
    const prefix = `KPI-${businessUnitCode.toUpperCase()}-${year}-`;
    const last = await tx.kpi.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const lastSeq = last ? Number(last.code.slice(prefix.length)) : 0;
    const next = String(lastSeq + 1).padStart(6, '0');
    return `${prefix}${next}`;
  }

  private snapshotOf(kpi: Record<string, unknown>) {
    return {
      name: kpi.name,
      description: kpi.description,
      categoryId: kpi.categoryId,
      measurementType: kpi.measurementType,
      unit: kpi.unit,
      direction: kpi.direction,
      target: kpi.target ? String(kpi.target) : null,
      actual: kpi.actual ? String(kpi.actual) : null,
      rubricLevel: kpi.rubricLevel,
      achievement: kpi.achievement ? String(kpi.achievement) : null,
      calculatedScore: kpi.calculatedScore ? String(kpi.calculatedScore) : null,
      finalScore: kpi.finalScore ? String(kpi.finalScore) : null,
      overrideScore: kpi.overrideScore ? String(kpi.overrideScore) : null,
      kpiWeight: kpi.kpiWeight,
      weightedScore: kpi.weightedScore ? String(kpi.weightedScore) : null,
      status: kpi.status,
      remarks: kpi.remarks,
      approvalPerson: kpi.approverId,
      configVersion: kpi.configVersionId,
    } as Prisma.InputJsonValue;
  }

  // ==================================================================== create

  /** FR-KPI-04/05/11 — create a Draft with server-side validation. */
  async create(dto: CreateKpiDto, user: AuthUser, meta: RequestContextMeta) {
    const config = await this.activeConfig();
    const period = await this.assertPeriodOpen(dto.periodId, { forSubmit: false });
    if (period.frequency !== dto.frequency) {
      throw Unprocessable(ErrorCode.V_MISSING, 'The selected period does not match the chosen frequency.');
    }

    const measurementType = dto.measurementType as MeasurementType;
    const direction = dto.direction as Direction;

    this.assertNumeric(dto.target, measurementType, 'Target');
    this.assertNumeric(dto.actual, measurementType, 'Actual');
    this.assertTargetRule(dto.target, direction, measurementType);

    if (measurementType === 'QUALITATIVE' && !dto.rubricLevel) {
      throw Unprocessable(ErrorCode.V_MISSING, 'A rubric level (1–5) is required for a Qualitative KPI.', [
        { field: 'rubricLevel', code: ErrorCode.V_MISSING, message: 'Choose a rubric level' },
      ]);
    }
    if (measurementType === 'RATING' && dto.target !== undefined && dto.target !== null && (dto.target < 1 || dto.target > 5)) {
      throw Unprocessable(ErrorCode.V_NUM_02, 'A Rating target must be within the scale 1–5.');
    }

    await this.assertUniqueName(user.id, dto.periodId, dto.name);

    const allocated = await this.allocatedWeight(user.id, dto.periodId, dto.frequency as Frequency, null);
    this.assertWeightCapacity(allocated, dto.kpiWeight, config.minWeight, config.maxWeight);
    await this.assertMaxKpis(user.id, dto.periodId, dto.frequency as Frequency, config.maxKpisPerPeriod);

    const category = await this.prisma.kpiCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw Unprocessable(ErrorCode.V_MISSING, 'Select a valid KPI category.');

    const employee = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { businessUnit: { select: { id: true, code: true } }, department: { select: { id: true } } },
    });

    const approverId = await this.resolveApprover(user.id, employee.departmentId, dto.approverId ?? null);
    if (!approverId && !(await this.isHeadOrSuperAdmin(user.id))) {
      throw Unprocessable(ErrorCode.APPROVER_REQUIRED, 'Select your Approval Person.', [
        { field: 'approverId', code: ErrorCode.APPROVER_REQUIRED, message: 'Choose an approver' },
      ]);
    }

    const qualitativeMap = (config.qualitativeMap ?? null) as Record<string, number> | null;
    const result = this.safeCalculate({
      target: dto.target ?? null,
      actual: dto.actual ?? null,
      rubricLevel: dto.rubricLevel ?? null,
      kpiWeight: dto.kpiWeight,
      direction,
      measurementType,
      config: { scoreCap: config.scoreCap, scoreFloor: config.scoreFloor, qualitativeMap: qualitativeMap ?? undefined },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const code = await this.nextKpiCode(employee.businessUnit?.code ?? 'GRP', period.year, tx);

      const kpi = await tx.kpi.create({
        data: {
          code,
          employeeId: user.id,
          periodId: dto.periodId,
          frequency: dto.frequency as Frequency,
          kpiType: (dto.kpiType as KpiType) ?? 'VARIABLE',
          templateId: dto.templateId ?? null,
          name: dto.name,
          description: dto.description ?? null,
          categoryId: dto.categoryId,
          measurementType,
          unit: dto.unit || 'units',
          direction,
          target: dto.target !== undefined && dto.target !== null ? String(dto.target) : null,
          actual: dto.actual !== undefined && dto.actual !== null ? String(dto.actual) : null,
          rubricLevel: dto.rubricLevel ?? null,
          qualitativeMapSnapshot: qualitativeMap as Prisma.InputJsonValue,
          achievement: result?.achievement.toString() ?? null,
          calculatedScore: result?.calculatedScore.toString() ?? null,
          finalScore: result?.finalScore.toString() ?? null,
          kpiWeight: dto.kpiWeight,
          weightedScore: result?.weightedScore.toString() ?? null,
          status: 'DRAFT',
          remarks: dto.remarks ?? null,
          businessUnitId: employee.businessUnitId,
          departmentId: employee.departmentId,
          approverId,
          configVersionId: config.id,
          currentVersionNo: 1,
          rowVersion: 0,
          lastCalculatedAt: result ? new Date() : null,
        },
      });

      await tx.kpiVersion.create({
        data: {
          kpiId: kpi.id,
          versionNo: 1,
          snapshot: this.snapshotOf({ ...kpi, status: 'DRAFT' }),
          trigger: 'CREATE',
          changeReason: 'Draft created',
          createdById: user.id,
          calculation: result ? this.calcJson(result) : undefined,
        },
      });

      if (result) {
        await tx.calculationLog.create({
          data: {
            kpiId: kpi.id,
            inputs: {
              target: dto.target ?? null,
              actual: dto.actual ?? null,
              rubricLevel: dto.rubricLevel ?? null,
              kpiWeight: dto.kpiWeight,
              direction,
              measurementType,
            } as Prisma.InputJsonValue,
            outputs: this.calcJson(result) as Prisma.InputJsonValue,
            formulaText: result.formulaText,
            configVersionId: config.id,
            trigger: 'CREATE',
            actorId: user.id,
            correlationId: meta.correlationId ?? null,
          },
        });
      }

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.KPI_CREATE,
          entityType: 'kpi',
          entityId: kpi.id,
          actor: user,
          employeeId: user.id,
          departmentId: kpi.departmentId,
          businessUnitId: kpi.businessUnitId,
          after: { code, name: kpi.name, kpiWeight: kpi.kpiWeight, target: decOrNull(kpi.target) },
          meta,
        },
        tx,
      );

      return kpi;
    });

    return this.detail(created.id, user);
  }

  private async isHeadOrSuperAdmin(userId: string): Promise<boolean> {
    const roles = await this.prisma.userRole.findMany({
      where: { userId, revokedAt: null, role: { code: { in: ['DEPT_HEAD', 'SUPER_ADMIN'] } } },
      select: { id: true },
    });
    return roles.length > 0;
  }

  private safeCalculate(input: Parameters<typeof calculateKpi>[0]) {
    try {
      return calculateKpi(input);
    } catch (e) {
      if (e instanceof CalculationError) {
        throw Unprocessable(e.code, e.message);
      }
      throw e;
    }
  }

  private calcJson(result: ReturnType<typeof calculateKpi>) {
    return {
      achievement: result.achievement.toFixed(2),
      calculatedScore: result.calculatedScore.toFixed(2),
      finalScore: result.finalScore.toFixed(2),
      weightedScore: result.weightedScore.toFixed(2),
      capped: result.capped,
      floored: result.floored,
      hasOverride: result.hasOverride,
    };
  }

  // ==================================================================== update

  /** FR-KPI-07 — the owner may edit Draft and Returned KPIs. */
  async update(id: string, dto: UpdateKpiDto, user: AuthUser, meta: RequestContextMeta) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    if (kpi.isLocked) {
      throw Conflict(ErrorCode.KPI_LOCKED, 'This period is locked. A Super Admin must reopen it before any change.');
    }
    const isOwner = kpi.employeeId === user.id;
    const isApprover = this.scope.canDecide(user, kpi);
    const isReviewerEdit = isApprover && ['SUBMITTED', 'UNDER_REVIEW'].includes(kpi.status);
    const isOwnerEdit = isOwner && ['DRAFT', 'RETURNED'].includes(kpi.status);

    if (!isOwnerEdit && !isReviewerEdit && !user.roles.includes('SUPER_ADMIN')) {
      throw Forbidden('FORBIDDEN', 'This KPI can no longer be edited. Raise a correction request instead.');
    }
    if (kpi.status === 'APPROVED' && !user.roles.includes('SUPER_ADMIN')) {
      throw Conflict(ErrorCode.CORRECTION_REQUIRED, 'Approved KPIs are read-only. A correction request is required (BR-R09).');
    }

    const config = await this.activeConfig();
    const period = await this.prisma.kpiPeriod.findUniqueOrThrow({ where: { id: dto.periodId ?? kpi.periodId } });

    if (isReviewerEdit && (!dto.reason || dto.reason.trim().length < config.minReasonLength)) {
      throw Unprocessable(
        ErrorCode.REASON_REQUIRED,
        `A reason of at least ${config.minReasonLength} characters is required when an approver edits a KPI.`,
        [{ field: 'reason', code: ErrorCode.REASON_REQUIRED, message: `At least ${config.minReasonLength} characters` }],
      );
    }

    const before = { ...kpi };
    const nextName = dto.name ?? kpi.name;
    const nextPeriodId = dto.periodId ?? kpi.periodId;
    const nextFrequency = (dto.frequency as Frequency) ?? kpi.frequency;
    const nextMeasurementType = (dto.measurementType as MeasurementType) ?? kpi.measurementType;
    const nextDirection = (dto.direction as Direction) ?? kpi.direction;
    const nextWeight = dto.kpiWeight ?? kpi.kpiWeight;
    const nextTarget = dto.target !== undefined ? dto.target : kpi.target ? Number(kpi.target) : null;
    const nextActual = dto.actual !== undefined ? dto.actual : kpi.actual ? Number(kpi.actual) : null;
    const nextRubric = dto.rubricLevel ?? kpi.rubricLevel;

    if (nextName !== kpi.name || nextPeriodId !== kpi.periodId) {
      await this.assertUniqueName(kpi.employeeId, nextPeriodId, nextName, kpi.id);
    }
    if (kpi.isAssigned && kpi.targetLocked && nextTarget !== (kpi.target ? Number(kpi.target) : null) && !isReviewerEdit) {
      throw Forbidden('FORBIDDEN', 'The target of an assigned KPI is locked by your Department Head.');
    }
    if (kpi.isAssigned && kpi.weightLocked && nextWeight !== kpi.kpiWeight && !isReviewerEdit) {
      throw Forbidden('FORBIDDEN', 'The weight of an assigned KPI is locked by your Department Head.');
    }

    this.assertNumeric(nextTarget, nextMeasurementType, 'Target');
    this.assertNumeric(nextActual, nextMeasurementType, 'Actual');
    this.assertTargetRule(nextTarget, nextDirection, nextMeasurementType);
    if (nextMeasurementType === 'RATING' && nextTarget !== null && (nextTarget < 1 || nextTarget > 5)) {
      throw Unprocessable(ErrorCode.V_NUM_02, 'A Rating target must be within the scale 1–5.');
    }

    if (nextWeight !== kpi.kpiWeight || nextPeriodId !== kpi.periodId || nextFrequency !== kpi.frequency) {
      const allocated = await this.allocatedWeight(kpi.employeeId, nextPeriodId, nextFrequency, kpi.id);
      this.assertWeightCapacity(allocated, nextWeight, config.minWeight, config.maxWeight);
    }

    let approverId = kpi.approverId;
    if (dto.approverId !== undefined && dto.approverId !== kpi.approverId) {
      approverId = await this.resolveApprover(kpi.employeeId, kpi.departmentId, dto.approverId);
    }

    const qualitativeMap = (config.qualitativeMap ?? null) as Record<string, number> | null;
    const result = this.safeCalculate({
      target: nextTarget,
      actual: nextActual,
      rubricLevel: nextRubric,
      kpiWeight: nextWeight,
      direction: nextDirection,
      measurementType: nextMeasurementType,
      overrideScore: kpi.overrideScore,
      config: { scoreCap: config.scoreCap, scoreFloor: config.scoreFloor, qualitativeMap: qualitativeMap ?? undefined },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.kpi.update({
        where: { id, rowVersion: kpi.rowVersion },
        data: {
          name: nextName,
          description: dto.description ?? kpi.description,
          categoryId: dto.categoryId ?? kpi.categoryId,
          measurementType: nextMeasurementType,
          unit: dto.unit ?? kpi.unit,
          direction: nextDirection,
          frequency: nextFrequency,
          periodId: nextPeriodId,
          target: nextTarget !== null ? String(nextTarget) : null,
          actual: nextActual !== null ? String(nextActual) : null,
          rubricLevel: nextRubric,
          kpiWeight: nextWeight,
          remarks: dto.remarks ?? kpi.remarks,
          approverId,
          achievement: result.achievement.toString(),
          calculatedScore: result.calculatedScore.toString(),
          finalScore: result.finalScore.toString(),
          weightedScore: result.weightedScore.toString(),
          lastCalculatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });

      // Record per-field adjustments (ADJ-4, FR-APR-05)
      const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
      if (String(before.target ?? '') !== String(nextTarget ?? '')) changes.push({ field: 'target', oldValue: decOrNull(before.target), newValue: nextTarget !== null ? dec(nextTarget) : null });
      if (String(before.actual ?? '') !== String(nextActual ?? '')) changes.push({ field: 'actual', oldValue: decOrNull(before.actual), newValue: nextActual !== null ? dec(nextActual) : null });
      if (before.kpiWeight !== nextWeight) changes.push({ field: 'kpiWeight', oldValue: String(before.kpiWeight), newValue: String(nextWeight) });
      if ((before.rubricLevel ?? null) !== (nextRubric ?? null)) changes.push({ field: 'rubricLevel', oldValue: before.rubricLevel ? String(before.rubricLevel) : null, newValue: nextRubric ? String(nextRubric) : null });

      for (const change of changes) {
        await tx.kpiAdjustment.create({
          data: {
            kpiId: id,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            reason: dto.reason ?? dto.changeNote ?? 'Owner edit',
            actorId: user.id,
          },
        });
      }

      await tx.calculationLog.create({
        data: {
          kpiId: id,
          inputs: { target: nextTarget, actual: nextActual, rubricLevel: nextRubric, kpiWeight: nextWeight, direction: nextDirection, measurementType: nextMeasurementType } as Prisma.InputJsonValue,
          outputs: this.calcJson(result) as Prisma.InputJsonValue,
          formulaText: result.formulaText,
          configVersionId: config.id,
          trigger: isReviewerEdit ? 'REVIEW_EDIT' : 'OWNER_EDIT',
          actorId: user.id,
          correlationId: meta.correlationId ?? null,
        },
      });

      // §3.8 — changes after submission create a new kpi_version
      if (isReviewerEdit) {
        const versionNo = kpi.currentVersionNo + 1;
        await tx.kpiVersion.create({
          data: {
            kpiId: id,
            versionNo,
            snapshot: this.snapshotOf({ ...row, status: row.status }),
            trigger: 'REVIEW_EDIT',
            changeReason: dto.reason ?? 'Approver edit during review',
            createdById: user.id,
            calculation: this.calcJson(result),
          },
        });
        await tx.kpi.update({ where: { id }, data: { currentVersionNo: versionNo } });
      }

      await this.audit.record(
        {
          action: isReviewerEdit ? AUDIT_ACTIONS.ADJUST : AUDIT_ACTIONS.KPI_UPDATE,
          entityType: 'kpi',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          businessUnitId: kpi.businessUnitId,
          before: { target: decOrNull(before.target), actual: decOrNull(before.actual), kpiWeight: before.kpiWeight, rubricLevel: before.rubricLevel },
          after: { target: nextTarget, actual: nextActual, kpiWeight: nextWeight, rubricLevel: nextRubric },
          changedFields: changes,
          reason: dto.reason ?? null,
          meta,
        },
        tx,
      );

      return row;
    });

    // FR-KPI-09 / NT-19 — the employee sees approver changes at once
    if (isReviewerEdit) {
      const employee = await this.prisma.user.findUnique({
        where: { id: kpi.employeeId },
        select: { id: true, email: true, fullName: true, emailDigest: true },
      });
      if (employee) {
        await this.notifications.notify({
          code: NT.KPI_INPUTS_EDITED,
          recipients: [{ userId: employee.id, email: employee.email, fullName: employee.fullName, emailDigest: employee.emailDigest }],
          title: `Your KPI inputs were updated during review: ${kpi.name}`,
          body: `${changesSummary(dto)} Reason: ${dto.reason}`,
          deepLink: `/my-kpi/${id}`,
          entityType: 'kpi',
          entityId: id,
          emailContext: {
            kpiName: kpi.name,
            changeSummary: changesSummary(dto),
            approverName: user.fullName,
            kpiUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi/${id}`,
          },
        });
      }
    }

    return this.detail(updated.id, user);
  }

  // ==================================================================== submit

  /** FR-KPI-06, UC-03 — freeze version n, set Submitted and notify the approver (NT-05). */
  async submit(id: string, user: AuthUser, ifMatch: string | undefined, meta: RequestContextMeta) {
    const kpi = await this.prisma.kpi.findUnique({
      where: { id },
      include: { period: true, employee: { select: { id: true, fullName: true, employeeCode: true, departmentId: true, businessUnitId: true } } },
    });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    if (kpi.employeeId !== user.id) throw Forbidden('FORBIDDEN', 'Only the owner can submit this KPI.');
    if (!['DRAFT', 'RETURNED'].includes(kpi.status)) {
      throw Conflict(ErrorCode.KPI_STATUS, `A KPI in ${kpi.status} status cannot be submitted.`);
    }
    if (kpi.isLocked) {
      throw Conflict(ErrorCode.KPI_LOCKED, 'This period is locked. A Super Admin must reopen it before submission.');
    }
    this.assertIfMatch(kpi.rowVersion, ifMatch);

    const config = await this.activeConfig();
    await this.assertPeriodOpen(kpi.periodId, { forSubmit: true });

    // BR-R02 — all mandatory fields
    const missing: Array<{ field: string; code: string; message: string }> = [];
    if (kpi.target === null && kpi.measurementType !== 'QUALITATIVE') missing.push({ field: 'target', code: ErrorCode.V_MISSING, message: 'Target is required' });
    if (kpi.actual === null && kpi.measurementType !== 'QUALITATIVE') missing.push({ field: 'actual', code: ErrorCode.EVIDENCE_REQUIRED, message: 'Actual is required' });
    if (kpi.measurementType === 'QUALITATIVE' && !kpi.rubricLevel) missing.push({ field: 'rubricLevel', code: ErrorCode.V_MISSING, message: 'Rubric level is required' });
    if (!kpi.remarks || kpi.remarks.trim().length < 10) missing.push({ field: 'remarks', code: ErrorCode.V_TEXT_01, message: 'Remarks must be 10–1,000 characters' });
    if (kpi.evidenceCount < 1) missing.push({ field: 'evidence', code: ErrorCode.EVIDENCE_REQUIRED, message: 'Attach at least one evidence file' });
    if (missing.length) {
      throw Unprocessable(ErrorCode.V_MISSING, `Cannot submit: ${missing.map((m) => m.message).join('; ')}`, missing);
    }

    // Verify the evidence is scanned clean
    const unclean = await this.prisma.kpiEvidence.count({
      where: { kpiId: id, isCurrent: true, scanStatus: { in: ['INFECTED', 'FAILED'] } },
    });
    if (unclean) {
      throw Unprocessable(ErrorCode.FILE_REJECTED, 'One or more evidence files failed the malware scan. Replace them and try again.');
    }

    // Approver eligibility (BR-R03)
    const isHead = await this.isHeadOrSuperAdmin(user.id);
    if (!kpi.approverId && !isHead) {
      const candidate = await this.resolveApprover(user.id, kpi.departmentId, null);
      if (!candidate) {
        throw Unprocessable(ErrorCode.APPROVER_REQUIRED, 'Select your Approval Person before submitting.', [
          { field: 'approverId', code: ErrorCode.APPROVER_REQUIRED, message: 'Choose an approver' },
        ]);
      }
    }

    const allocated = await this.allocatedWeight(user.id, kpi.periodId, kpi.frequency, id);
    if (allocated + kpi.kpiWeight > 100) {
      throw Conflict(ErrorCode.W_EXCEED, weightExceededMessage(allocated + kpi.kpiWeight - 100, Math.max(0, 100 - allocated)));
    }

    const qualitativeMap = (config.qualitativeMap ?? null) as Record<string, number> | null;
    const result = this.safeCalculate({
      target: kpi.target,
      actual: kpi.actual,
      rubricLevel: kpi.rubricLevel,
      kpiWeight: kpi.kpiWeight,
      direction: kpi.direction,
      measurementType: kpi.measurementType,
      config: { scoreCap: config.scoreCap, scoreFloor: config.scoreFloor, qualitativeMap: qualitativeMap ?? undefined },
    });

    const isResubmit = kpi.status === 'RETURNED';
    const versionNo = kpi.currentVersionNo + (isResubmit ? 1 : 0);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.kpi.update({
        where: { id, rowVersion: kpi.rowVersion },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          reviewStartedAt: null,
          achievement: result.achievement.toString(),
          calculatedScore: result.calculatedScore.toString(),
          finalScore: result.calculatedScore.toString(),
          weightedScore: result.weightedScore.toString(),
          lastCalculatedAt: new Date(),
          businessUnitId: kpi.employee.businessUnitId,
          departmentId: kpi.employee.departmentId,
          currentVersionNo: versionNo,
          rowVersion: { increment: 1 },
          returnComment: null,
        },
      });

      await tx.kpiVersion.upsert({
        where: { kpiId_versionNo: { kpiId: id, versionNo } },
        create: {
          kpiId: id,
          versionNo,
          snapshot: this.snapshotOf({ ...row, status: 'SUBMITTED' }),
          trigger: isResubmit ? 'RESUBMIT' : 'SUBMIT',
          changeReason: isResubmit ? 'Resubmitted after return' : 'Submitted by the owner',
          createdById: user.id,
          calculation: this.calcJson(result),
        },
        update: {
          snapshot: this.snapshotOf({ ...row, status: 'SUBMITTED' }),
          calculation: this.calcJson(result),
        },
      });

      await tx.calculationLog.create({
        data: {
          kpiId: id,
          inputs: { target: decOrNull(kpi.target), actual: decOrNull(kpi.actual), rubricLevel: kpi.rubricLevel, kpiWeight: kpi.kpiWeight, direction: kpi.direction, measurementType: kpi.measurementType } as Prisma.InputJsonValue,
          outputs: this.calcJson(result) as Prisma.InputJsonValue,
          formulaText: result.formulaText,
          configVersionId: config.id,
          trigger: isResubmit ? 'RESUBMIT' : 'SUBMIT',
          actorId: user.id,
          correlationId: meta.correlationId ?? null,
        },
      });

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.KPI_SUBMIT,
          entityType: 'kpi',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          businessUnitId: kpi.businessUnitId,
          after: { status: 'SUBMITTED', versionNo, achievement: dec(result.achievement), weightedScore: dec(result.weightedScore) },
          meta,
        },
        tx,
      );

      return row;
    });

    // NT-05 — notify the selected approver (Super Admins when approverId is null)
    await this.notifyApprovers(updated, kpi, user);

    return this.detail(updated.id, user);
  }

  private async notifyApprovers(
    kpi: { id: string; name: string; approverId: string | null; periodId: string; finalScore?: unknown },
    original: { periodId: string },
    submitter: AuthUser,
  ) {
    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: original.periodId } });
    const recipients = await this.approverRecipients(kpi.approverId);
    if (!recipients.length) return;

    const row = await this.prisma.kpi.findUnique({
      where: { id: kpi.id },
      select: { achievement: true, kpiWeight: true, submittedAt: true, employee: { select: { fullName: true, employeeCode: true } } },
    });

    await this.notifications.notify({
      code: NT.KPI_SUBMITTED,
      recipients,
      title: `KPI submitted for your review: ${row?.employee.fullName} · ${kpi.name}`,
      body: `${row?.employee.fullName} (${row?.employee.employeeCode}) submitted “${kpi.name}” — Achievement ${decOrNull(row?.achievement)}%.`,
      deepLink: `/approvals?kpi=${kpi.id}`,
      entityType: 'kpi',
      entityId: kpi.id,
      emailContext: {
        employeeName: row?.employee.fullName,
        employeeCode: row?.employee.employeeCode,
        kpiName: kpi.name,
        period: period?.label,
        achievement: `${decOrNull(row?.achievement)}%`,
        weight: `${row?.kpiWeight}%`,
        submittedAt: formatDateTime(row?.submittedAt ?? new Date()),
        reviewUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/approvals?kpi=${kpi.id}`,
      },
    });
  }

  /** Approver recipients: the named approver, or every Super Admin when null (Dept Head KPI). */
  async approverRecipients(approverId: string | null) {
    if (approverId) {
      const approver = await this.prisma.user.findUnique({
        where: { id: approverId },
        select: { id: true, email: true, fullName: true, emailDigest: true },
      });
      return approver ? [{ userId: approver.id, email: approver.email, fullName: approver.fullName, emailDigest: approver.emailDigest }] : [];
    }
    const superAdmins = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', roles: { some: { role: { code: 'SUPER_ADMIN' } } } },
      select: { id: true, email: true, fullName: true, emailDigest: true },
    });
    return superAdmins.map((s) => ({ userId: s.id, email: s.email, fullName: s.fullName, emailDigest: s.emailDigest }));
  }

  /** FR-KPI-07 — withdraw before the approver opens the request. */
  async withdraw(id: string, user: AuthUser, meta: RequestContextMeta) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    if (kpi.employeeId !== user.id) throw Forbidden('FORBIDDEN', 'Only the owner can withdraw this KPI.');
    if (kpi.status !== 'SUBMITTED') {
      throw Conflict(ErrorCode.KPI_STATUS, 'Only a Submitted KPI can be withdrawn, and only before the approver opens it.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.kpi.update({
        where: { id, rowVersion: kpi.rowVersion },
        data: { status: 'DRAFT', submittedAt: null, reviewStartedAt: null, finalScore: kpi.calculatedScore, rowVersion: { increment: 1 } },
      });
      await tx.kpiDecision.create({
        data: {
          kpiId: id,
          action: 'WITHDRAW',
          actorId: user.id,
          statusBefore: 'SUBMITTED',
          statusAfter: 'DRAFT',
          reason: 'Withdrawn by the owner before review',
        },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.KPI_WITHDRAW,
          entityType: 'kpi',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          before: { status: 'SUBMITTED' },
          after: { status: 'DRAFT' },
          meta,
        },
        tx,
      );
    });

    return this.detail(id, user);
  }

  /** FR-KPI-07 — the owner deletes their own Draft (soft delete). */
  async remove(id: string, user: AuthUser, reason: string, meta: RequestContextMeta) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    if (kpi.employeeId !== user.id) throw Forbidden('FORBIDDEN', 'Only the owner can delete their own Draft.');
    if (!['DRAFT'].includes(kpi.status)) {
      throw Conflict(ErrorCode.KPI_STATUS, 'Only a Draft can be deleted. Ask your approver to delete a submitted KPI.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.kpi.update({
        where: { id },
        data: { status: 'DELETED', deletedAt: new Date(), deletedById: user.id, deletedReason: reason, rowVersion: { increment: 1 } },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.KPI_DELETE,
          entityType: 'kpi',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          reason,
          before: { status: kpi.status },
          after: { status: 'DELETED' },
          meta,
        },
        tx,
      );
    });

    return { id, status: 'DELETED', message: 'Draft deleted. Its weight has been released.' };
  }

  /** Emergency restore (Super Admin) — §3.6 Deleted. */
  async restore(id: string, user: AuthUser, reason: string, meta: RequestContextMeta) {
    if (!user.roles.includes('SUPER_ADMIN')) throw Forbidden('FORBIDDEN', 'Only a Super Admin can restore a deleted KPI.');
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    if (kpi.status !== 'DELETED') throw Conflict(ErrorCode.KPI_STATUS, 'This KPI is not deleted.');

    await this.prisma.$transaction(async (tx) => {
      await tx.kpi.update({
        where: { id },
        data: { status: 'DRAFT', deletedAt: null, deletedById: null, deletedReason: null, rowVersion: { increment: 1 } },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.KPI_RESTORE,
          entityType: 'kpi',
          entityId: id,
          actor: user,
          reason,
          before: { status: 'DELETED' },
          after: { status: 'DRAFT' },
          meta,
        },
        tx,
      );
    });
    return { id, status: 'DRAFT', message: 'KPI restored as a Draft.' };
  }

  // ================================================================== evidence

  /** FR-EVD-01/02 — upload, validate, hash and store. */
  async uploadEvidence(
    kpiId: string,
    file: { originalname: string; buffer: Buffer; size: number },
    user: AuthUser,
    meta: RequestContextMeta,
  ) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id: kpiId } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');

    const isOwner = kpi.employeeId === user.id;
    const isReviewer = this.scope.canDecide(user, kpi);
    if (!isOwner && !isReviewer) throw Forbidden('FORBIDDEN', 'You cannot attach evidence to this KPI.');
    if (kpi.isLocked) throw Conflict(ErrorCode.KPI_LOCKED, 'This period is locked.');
    if (isOwner && !['DRAFT', 'RETURNED'].includes(kpi.status)) {
      throw Conflict(ErrorCode.KPI_STATUS, 'Evidence is immutable once submitted (FR-EVD-03). Ask your approver to return the KPI.');
    }

    const config = await this.activeConfig();
    const current = await this.prisma.kpiEvidence.count({ where: { kpiId, isCurrent: true } });
    if (current >= config.maxEvidenceFiles) {
      throw Unprocessable(ErrorCode.FILE_REJECTED, `A KPI may hold at most ${config.maxEvidenceFiles} evidence files.`);
    }

    const sniffed = this.storage.validate(file.buffer, file.originalname, config.maxEvidenceSizeMb);
    const scan = await this.storage.malwareScan(file.buffer);
    if (!scan.clean) {
      throw Unprocessable(ErrorCode.FILE_REJECTED, 'The file failed the malware scan and was rejected.');
    }

    const stored = await this.storage.store(file.buffer, file.originalname, sniffed, kpiId);

    const evidence = await this.prisma.$transaction(async (tx) => {
      const row = await tx.kpiEvidence.create({
        data: {
          kpiId,
          versionNo: kpi.currentVersionNo,
          originalName: stored.originalName,
          fileName: stored.fileName,
          mimeType: stored.mimeType,
          extension: stored.extension,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          storageKey: stored.storageKey,
          scanStatus: 'CLEAN',
          scanDetail: scan.detail ?? null,
          isCurrent: true,
          uploadedById: user.id,
        },
      });
      const count = await tx.kpiEvidence.count({ where: { kpiId, isCurrent: true } });
      await tx.kpi.update({ where: { id: kpiId }, data: { evidenceCount: count, rowVersion: { increment: 1 } } });

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.EVIDENCE_UPLOAD,
          entityType: 'kpi_evidence',
          entityId: row.id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          after: { kpiId, originalName: stored.originalName, sizeBytes: stored.sizeBytes, sha256: stored.sha256, mimeType: stored.mimeType },
          meta,
        },
        tx,
      );

      return row;
    });

    return {
      id: evidence.id,
      originalName: evidence.originalName,
      mimeType: evidence.mimeType,
      sizeBytes: evidence.sizeBytes,
      sha256: evidence.sha256,
      scanStatus: evidence.scanStatus,
      createdAt: evidence.createdAt,
    };
  }

  /** FR-EVD-03 — replacing a file while Returned adds a new file version. */
  async replaceEvidence(
    kpiId: string,
    evidenceId: string,
    file: { originalname: string; buffer: Buffer },
    user: AuthUser,
    meta: RequestContextMeta,
  ) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id: kpiId } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    const existing = await this.prisma.kpiEvidence.findFirst({ where: { id: evidenceId, kpiId } });
    if (!existing) throw NotFound(ErrorCode.NOT_FOUND, 'Evidence not found');
    if (kpi.employeeId !== user.id && !this.scope.canDecide(user, kpi)) {
      throw Forbidden('FORBIDDEN', 'You cannot replace this file.');
    }
    if (kpi.status === 'APPROVED') {
      throw Conflict(ErrorCode.CORRECTION_REQUIRED, 'Approved KPIs are read-only (BR-R09).');
    }

    const config = await this.activeConfig();
    const sniffed = this.storage.validate(file.buffer, file.originalname, config.maxEvidenceSizeMb);
    const scan = await this.storage.malwareScan(file.buffer);
    if (!scan.clean) throw Unprocessable(ErrorCode.FILE_REJECTED, 'The file failed the malware scan.');

    const stored = await this.storage.store(file.buffer, file.originalname, sniffed, kpiId);

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.kpiEvidence.update({ where: { id: evidenceId }, data: { isCurrent: false, replacedById: user.id } });
      const created = await tx.kpiEvidence.create({
        data: {
          kpiId,
          versionNo: kpi.currentVersionNo + 1,
          originalName: stored.originalName,
          fileName: stored.fileName,
          mimeType: stored.mimeType,
          extension: stored.extension,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          storageKey: stored.storageKey,
          scanStatus: 'CLEAN',
          scanDetail: scan.detail ?? null,
          isCurrent: true,
          uploadedById: user.id,
        },
      });
      await tx.kpi.update({ where: { id: kpiId }, data: { rowVersion: { increment: 1 } } });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.EVIDENCE_REPLACE,
          entityType: 'kpi_evidence',
          entityId: created.id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          before: { originalName: existing.originalName, sha256: existing.sha256 },
          after: { originalName: created.originalName, sha256: created.sha256 },
          meta,
        },
        tx,
      );
      return created;
    });

    return { id: row.id, originalName: row.originalName, sha256: row.sha256, versionNo: row.versionNo };
  }

  async removeEvidence(kpiId: string, evidenceId: string, user: AuthUser, meta: RequestContextMeta) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id: kpiId } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    if (kpi.employeeId !== user.id && !user.roles.includes('SUPER_ADMIN')) {
      throw Forbidden('FORBIDDEN', 'Only the owner can remove evidence.');
    }
    if (!['DRAFT', 'RETURNED'].includes(kpi.status)) {
      throw Conflict(ErrorCode.KPI_STATUS, 'Evidence cannot be removed after submission.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.kpiEvidence.update({ where: { id: evidenceId }, data: { deletedAt: new Date(), isCurrent: false } });
      const count = await tx.kpiEvidence.count({ where: { kpiId, isCurrent: true, deletedAt: null } });
      await tx.kpi.update({ where: { id: kpiId }, data: { evidenceCount: count, rowVersion: { increment: 1 } } });
      await this.audit.record(
        {
          action: 'evidence.remove',
          entityType: 'kpi_evidence',
          entityId: evidenceId,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          meta,
        },
        tx,
      );
    });

    return { message: 'Evidence removed.' };
  }

  /** FR-EVD-04 — a 5-minute signed URL; every download is audited. */
  async evidenceUrl(evidenceId: string, user: AuthUser, meta: RequestContextMeta) {
    const evidence = await this.prisma.kpiEvidence.findUnique({
      where: { id: evidenceId },
      include: { kpi: { select: { id: true, employeeId: true, departmentId: true, businessUnitId: true } } },
    });
    if (!evidence) throw NotFound(ErrorCode.NOT_FOUND, 'Evidence not found');

    this.scope.assertKpiInScope(user, {
      employeeId: evidence.kpi.employeeId,
      departmentId: evidence.kpi.departmentId,
      businessUnitId: evidence.kpi.businessUnitId,
    });

    const signed = this.storage.sign(evidenceId);

    await this.audit.record({
      action: AUDIT_ACTIONS.EVIDENCE_DOWNLOAD,
      entityType: 'kpi_evidence',
      entityId: evidenceId,
      actor: user,
      employeeId: evidence.kpi.employeeId,
      departmentId: evidence.kpi.departmentId,
      after: { kpiId: evidence.kpiId, originalName: evidence.originalName, ttlSeconds: 300 },
      meta,
    });

    return {
      url: `/api/v1/evidence/${evidenceId}/download?token=${signed.token}`,
      expiresAt: new Date(signed.expiresAt).toISOString(),
      ttlSeconds: 300,
      originalName: evidence.originalName,
      mimeType: evidence.mimeType,
      sha256: evidence.sha256,
    };
  }

  /** Streams the file for the signed download route. */
  async streamEvidence(evidenceId: string, token: string) {
    this.storage.verifySignature(evidenceId, token);
    const evidence = await this.prisma.kpiEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence || evidence.deletedAt) throw NotFound(ErrorCode.NOT_FOUND, 'Evidence not found');
    const buffer = await this.storage.read(evidence.storageKey, false);
    return { buffer, evidence };
  }

  // ================================================================== versions

  /** FR-AUD-02 — version history with a side-by-side comparison. */
  async versions(id: string, user: AuthUser) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id }, select: { id: true, employeeId: true, departmentId: true, businessUnitId: true } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    this.scope.assertKpiInScope(user, kpi);

    const rows = await this.prisma.kpiVersion.findMany({
      where: { kpiId: id },
      orderBy: { versionNo: 'desc' },
      include: { createdBy: { select: { id: true, fullName: true } } },
    });

    return rows.map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      trigger: v.trigger,
      changeReason: v.changeReason,
      createdBy: v.createdBy?.fullName ?? 'System',
      createdAt: v.createdAt,
      snapshot: v.snapshot,
      calculation: v.calculation,
    }));
  }

  /** FR-AUD-02 — highlights the changed fields between two versions. */
  async versionDiff(id: string, fromVersion: number, toVersion: number, user: AuthUser) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id }, select: { id: true, employeeId: true, departmentId: true, businessUnitId: true } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    this.scope.assertKpiInScope(user, kpi);

    const [from, to] = await Promise.all([
      this.prisma.kpiVersion.findUnique({ where: { kpiId_versionNo: { kpiId: id, versionNo: fromVersion } } }),
      this.prisma.kpiVersion.findUnique({ where: { kpiId_versionNo: { kpiId: id, versionNo: toVersion } } }),
    ]);
    if (!from || !to) throw NotFound(ErrorCode.NOT_FOUND, 'One of the requested versions does not exist.');

    const a = (from.snapshot ?? {}) as Record<string, unknown>;
    const b = (to.snapshot ?? {}) as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
    const changes = keys
      .filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
      .map((k) => ({ field: k, from: a[k] ?? null, to: b[k] ?? null }));

    return { from: { versionNo: from.versionNo, createdAt: from.createdAt, trigger: from.trigger }, to: { versionNo: to.versionNo, createdAt: to.createdAt, trigger: to.trigger }, changes };
  }

  /** FR-AUD-03 — a restore creates a NEW version; nothing is ever overwritten. */
  async restoreVersion(id: string, versionNo: number, reason: string, user: AuthUser, meta: RequestContextMeta) {
    if (!user.roles.includes('SUPER_ADMIN')) throw Forbidden('FORBIDDEN', 'Only a Super Admin can restore a version.');
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    if (kpi.status === 'APPROVED') {
      throw Conflict(
        ErrorCode.CORRECTION_REQUIRED,
        'An approved KPI must go through the correction flow so the score is re-approved (BR-R09).',
      );
    }
    const source = await this.prisma.kpiVersion.findUnique({ where: { kpiId_versionNo: { kpiId: id, versionNo } } });
    if (!source) throw NotFound(ErrorCode.NOT_FOUND, 'That version does not exist.');

    const snapshot = (source.snapshot ?? {}) as Record<string, string | number | null>;
    const config = await this.activeConfig();
    const qualitativeMap = (config.qualitativeMap ?? null) as Record<string, number> | null;

    const target = snapshot.target !== null && snapshot.target !== undefined ? Number(snapshot.target) : null;
    const actual = snapshot.actual !== null && snapshot.actual !== undefined ? Number(snapshot.actual) : null;
    const measurementType = (snapshot.measurementType as MeasurementType) ?? kpi.measurementType;

    const result = this.safeCalculate({
      target,
      actual,
      rubricLevel: snapshot.rubricLevel ? Number(snapshot.rubricLevel) : null,
      kpiWeight: Number(snapshot.kpiWeight ?? kpi.kpiWeight),
      direction: (snapshot.direction as Direction) ?? kpi.direction,
      measurementType,
      config: { scoreCap: config.scoreCap, scoreFloor: config.scoreFloor, qualitativeMap: qualitativeMap ?? undefined },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const versionNoNew = kpi.currentVersionNo + 1;
      const row = await tx.kpi.update({
        where: { id },
        data: {
          name: String(snapshot.name ?? kpi.name),
          description: (snapshot.description as string) ?? kpi.description,
          categoryId: String(snapshot.categoryId ?? kpi.categoryId),
          measurementType,
          unit: String(snapshot.unit ?? kpi.unit),
          direction: (snapshot.direction as Direction) ?? kpi.direction,
          target: target !== null ? String(target) : null,
          actual: actual !== null ? String(actual) : null,
          rubricLevel: snapshot.rubricLevel ? Number(snapshot.rubricLevel) : null,
          kpiWeight: Number(snapshot.kpiWeight ?? kpi.kpiWeight),
          remarks: (snapshot.remarks as string) ?? kpi.remarks,
          achievement: result.achievement.toString(),
          calculatedScore: result.calculatedScore.toString(),
          finalScore: result.calculatedScore.toString(),
          weightedScore: result.weightedScore.toString(),
          currentVersionNo: versionNoNew,
          rowVersion: { increment: 1 },
        },
      });

      await tx.kpiVersion.create({
        data: {
          kpiId: id,
          versionNo: versionNoNew,
          snapshot: this.snapshotOf({ ...row, status: row.status }),
          trigger: 'RESTORE',
          changeReason: `Restored from version ${versionNo}: ${reason}`,
          createdById: user.id,
          calculation: this.calcJson(result),
        },
      });

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.VERSION_RESTORE,
          entityType: 'kpi_version',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          reason,
          after: { restoredFrom: versionNo, newVersion: versionNoNew },
          meta,
        },
        tx,
      );

      return row;
    });

    return this.detail(updated.id, user);
  }

  // ================================================================ corrections

  /** BR-R09 / UC-12 — a Department Head raises a correction request on an approved KPI. */
  async requestCorrection(dto: { kpiId: string; reason: string; changes?: Record<string, unknown> }, user: AuthUser, meta: RequestContextMeta) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id: dto.kpiId } });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    if (!this.scope.canDecide(user, kpi) && !user.roles.includes('HR_ADMIN')) {
      throw Forbidden('FORBIDDEN', 'Only the department approver can raise a correction request.');
    }
    if (kpi.status !== 'APPROVED') {
      throw Conflict(ErrorCode.KPI_STATUS, 'Corrections apply to Approved KPIs. Edit the KPI directly while it is in review.');
    }
    const existing = await this.prisma.correctionRequest.findFirst({ where: { kpiId: dto.kpiId, status: 'PENDING' } });
    if (existing) throw Conflict(ErrorCode.CONFLICT, 'A correction request for this KPI is already waiting for a Super Admin.');

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.correctionRequest.create({
        data: {
          kpiId: dto.kpiId,
          requestedById: user.id,
          departmentId: kpi.departmentId,
          reason: dto.reason,
          changes: (dto.changes ?? {}) as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.CORRECTION_REQUEST,
          entityType: 'correction_request',
          entityId: created.id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          reason: dto.reason,
          after: { kpiId: dto.kpiId },
          meta,
        },
        tx,
      );
      return created;
    });

    await this.notifySuperAdmins(
      'Correction request submitted',
      `${user.fullName} requested a correction on “${kpi.name}”. Reason: ${dto.reason}`,
      '/corrections',
      NT.CORRECTION_OR_REOPEN,
    );

    return { id: row.id, status: row.status, message: 'Correction request sent to the Super Admin.' };
  }

  /** UC-12 — the Super Admin decides; approving creates a new version and re-approval. */
  async decideCorrection(id: string, decision: 'APPROVE' | 'DECLINE', comment: string | undefined, user: AuthUser, meta: RequestContextMeta) {
    if (!user.roles.includes('SUPER_ADMIN')) throw Forbidden('FORBIDDEN', 'Only a Super Admin can decide a correction request.');
    const request = await this.prisma.correctionRequest.findUnique({
      where: { id },
      include: { kpi: true, requestedBy: { select: { id: true, fullName: true, email: true, emailDigest: true } } },
    });
    if (!request) throw NotFound(ErrorCode.NOT_FOUND, 'Correction request not found');
    if (request.status !== 'PENDING') throw Conflict(ErrorCode.CONFLICT, 'This request has already been decided.');

    const kpi = request.kpi;
    const config = await this.activeConfig();
    const qualitativeMap = (config.qualitativeMap ?? null) as Record<string, number> | null;
    const patch = (request.changes ?? {}) as Record<string, unknown>;

    const nextTarget = patch.target !== undefined ? Number(patch.target) : kpi.target ? Number(kpi.target) : null;
    const nextActual = patch.actual !== undefined ? Number(patch.actual) : kpi.actual ? Number(kpi.actual) : null;
    const nextWeight = patch.kpiWeight !== undefined ? Number(patch.kpiWeight) : kpi.kpiWeight;
    const nextRubric = patch.rubricLevel !== undefined ? Number(patch.rubricLevel) : kpi.rubricLevel;

    const result = this.safeCalculate({
      target: nextTarget,
      actual: nextActual,
      rubricLevel: nextRubric,
      kpiWeight: nextWeight,
      direction: kpi.direction,
      measurementType: kpi.measurementType,
      config: { scoreCap: config.scoreCap, scoreFloor: config.scoreFloor, qualitativeMap: qualitativeMap ?? undefined },
    });

    const newVersionNo = kpi.currentVersionNo + 1;
    const periodWasClosed = await this.prisma.kpiPeriod
      .findUnique({ where: { id: kpi.periodId }, select: { status: true } })
      .then((p) => p?.status === 'CLOSED');

    await this.prisma.$transaction(async (tx) => {
      await tx.correctionRequest.update({
        where: { id },
        data: {
          status: decision === 'APPROVE' ? 'APPROVED' : 'DECLINED',
          decidedById: user.id,
          decidedAt: new Date(),
          decisionComment: comment ?? null,
          newVersionNo: decision === 'APPROVE' ? newVersionNo : null,
        },
      });

      if (decision === 'APPROVE') {
        const updated = await tx.kpi.update({
          where: { id: kpi.id },
          data: {
            target: nextTarget !== null ? String(nextTarget) : null,
            actual: nextActual !== null ? String(nextActual) : null,
            kpiWeight: nextWeight,
            rubricLevel: nextRubric,
            achievement: result.achievement.toString(),
            calculatedScore: result.calculatedScore.toString(),
            finalScore: result.calculatedScore.toString(),
            weightedScore: result.weightedScore.toString(),
            status: periodWasClosed ? 'APPROVED' : 'UNDER_REVIEW',
            isLocked: false,
            overrideScore: null,
            currentVersionNo: newVersionNo,
            rowVersion: { increment: 1 },
          },
        });

        await tx.kpiVersion.create({
          data: {
            kpiId: kpi.id,
            versionNo: newVersionNo,
            snapshot: this.snapshotOf(updated),
            trigger: 'CORRECTION',
            changeReason: `Correction approved: ${request.reason}`,
            createdById: user.id,
            calculation: this.calcJson(result),
          },
        });

        await tx.kpiAdjustment.create({
          data: {
            kpiId: kpi.id,
            field: 'correction',
            oldValue: decOrNull(kpi.finalScore),
            newValue: dec(result.finalScore),
            reason: request.reason,
            actorId: user.id,
          },
        });
      }

      await this.audit.record(
        {
          action: AUDIT_ACTIONS.CORRECTION_DECIDE,
          entityType: 'correction_request',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          reason: comment ?? request.reason,
          after: { decision, newVersionNo: decision === 'APPROVE' ? newVersionNo : null },
          meta,
        },
        tx,
      );
    });

    // Notify the requester and the employee (NT-18)
    const employee = await this.prisma.user.findUnique({
      where: { id: kpi.employeeId },
      select: { id: true, email: true, fullName: true, emailDigest: true },
    });
    const recipients = [
      { userId: request.requestedBy.id, email: request.requestedBy.email, fullName: request.requestedBy.fullName, emailDigest: request.requestedBy.emailDigest },
      ...(employee ? [{ userId: employee.id, email: employee.email, fullName: employee.fullName, emailDigest: employee.emailDigest }] : []),
    ];

    await this.notifications.notify({
      code: NT.CORRECTION_OR_REOPEN,
      recipients,
      title: `Correction request ${decision === 'APPROVE' ? 'approved' : 'declined'} for “${kpi.name}”`,
      body: comment ?? request.reason,
      deepLink: `/my-kpi/${kpi.id}`,
      entityType: 'kpi',
      entityId: kpi.id,
      severity: decision === 'APPROVE' ? 'success' : 'warning',
      critical: true,
      emailContext: {
        eventTitle: `Correction request ${decision === 'APPROVE' ? 'approved' : 'declined'}`,
        subject: kpi.name,
        detail: comment ?? request.reason,
        rows: [
          { label: 'KPI', value: kpi.name },
          { label: 'Decision', value: decision === 'APPROVE' ? 'Approved' : 'Declined' },
          { label: 'New version', value: decision === 'APPROVE' ? String(newVersionNo) : '—' },
        ],
        ctaLabel: 'Open the KPI',
        linkUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi/${kpi.id}`,
      },
    });

    if (decision === 'APPROVE' && periodWasClosed) {
      // EC-20 — a re-closed period regenerates its snapshot; the previous one stays as history
      await this.performance.generateSnapshots(kpi.periodId).catch(() => undefined);
    }

    return { id, decision, message: decision === 'APPROVE' ? 'Correction approved; a new version was created.' : 'Correction declined.' };
  }

  async listCorrections(user: AuthUser, status?: string) {
    const where: Prisma.CorrectionRequestWhereInput = {};
    if (status) where.status = status as never;
    if (!user.roles.includes('SUPER_ADMIN') && !user.roles.includes('HR_ADMIN')) {
      const deptIds = this.scope.departmentFilter(user);
      where.OR = [{ requestedById: user.id }, ...(deptIds ? [{ departmentId: { in: deptIds } }] : [{ departmentId: null }])];
    }
    const rows = await this.prisma.correctionRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        kpi: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            calculatedScore: true,
            finalScore: true,
            period: { select: { label: true } },
            employee: { select: { fullName: true, employeeCode: true } },
            department: { select: { name: true } },
          },
        },
        requestedBy: { select: { id: true, fullName: true } },
        decidedBy: { select: { id: true, fullName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      status: r.status,
      changes: r.changes,
      createdAt: r.createdAt,
      requester: r.requestedBy.fullName,
      decidedBy: r.decidedBy?.fullName ?? null,
      decidedAt: r.decidedAt,
      decisionComment: r.decisionComment,
      kpi: {
        id: r.kpi.id,
        code: r.kpi.code,
        name: r.kpi.name,
        status: r.kpi.status,
        employee: r.kpi.employee.fullName,
        employeeCode: r.kpi.employee.employeeCode,
        department: r.kpi.department?.name ?? '—',
        period: r.kpi.period.label,
        calculatedScore: decOrNull(r.kpi.calculatedScore),
        finalScore: decOrNull(r.kpi.finalScore),
      },
    }));
  }

  // ============================================================== calculation

  /** FR-CAL-01 — stateless preview used by the create/edit drawer. */
  async preview(dto: { target?: number; actual?: number; rubricLevel?: number; measurementType: string; direction: string; kpiWeight: number; overrideScore?: number }, user: AuthUser) {
    const config = await this.activeConfig();
    const qualitativeMap = (config.qualitativeMap ?? null) as Record<string, number> | null;
    const result = this.safeCalculate({
      target: dto.target ?? null,
      actual: dto.actual ?? null,
      rubricLevel: dto.rubricLevel ?? null,
      kpiWeight: dto.kpiWeight,
      direction: dto.direction as Direction,
      measurementType: dto.measurementType as MeasurementType,
      overrideScore: dto.overrideScore ?? null,
      config: { scoreCap: config.scoreCap, scoreFloor: config.scoreFloor, qualitativeMap: qualitativeMap ?? undefined },
    });
    void user;
    return {
      achievement: dec(result.achievement),
      calculatedScore: dec(result.calculatedScore),
      finalScore: dec(result.finalScore),
      weightedScore: dec(result.weightedScore),
      formulaText: result.formulaText,
      capped: result.capped,
      floored: result.floored,
      cap: dec(config.scoreCap),
      floor: dec(config.scoreFloor),
    };
  }

  /** Weight availability for the create/edit drawer meter (W-2/W-3). */
  async weightAvailability(user: AuthUser, periodId: string, frequency: string, excludeKpiId?: string) {
    const config = await this.activeConfig();
    const allocated = await this.allocatedWeight(user.id, periodId, frequency as Frequency, excludeKpiId ?? null);
    const kpiCount = await this.prisma.kpi.count({
      where: { employeeId: user.id, periodId, frequency: frequency as Frequency, status: { notIn: ['DELETED', 'REJECTED'] }, ...(excludeKpiId ? { id: { not: excludeKpiId } } : {}) },
    });
    return {
      allocated,
      available: Math.max(0, 100 - allocated),
      complete: allocated === 100,
      warning: allocated < 100 ? `Weight allocated ${allocated} / 100%` : null,
      minWeight: config.minWeight,
      maxWeight: config.maxWeight,
      maxKpisPerPeriod: config.maxKpisPerPeriod,
      kpiCount,
      remainingKpis: Math.max(0, config.maxKpisPerPeriod - kpiCount),
    };
  }

  /** Approver drop-down data for the KPI form (FR-KPI-04, BR-R03). */
  async approverOptions(user: AuthUser) {
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { departmentId: true, roles: { select: { role: { select: { code: true } } } } },
    });
    const roles = me.roles.map((r) => r.role.code);
    if (roles.includes('DEPT_HEAD') || roles.includes('SUPER_ADMIN')) {
      return {
        mode: 'SUPER_ADMIN' as const,
        options: [] as Array<{ id: string; fullName: string; employeeCode: string; designationTitle: string | null }>,
        message: 'Your KPIs are routed to the Super Admin queue (Department Head KPI Requests).',
      };
    }
    const options = await this.availableApprovers(user.id, me.departmentId);
    return {
      mode: options.length === 1 ? ('PRESELECTED' as const) : ('SELECT' as const),
      options,
      message: options.length === 0 ? 'Your department has no active approver yet.' : null,
    };
  }

  private assertIfMatch(rowVersion: number, ifMatch: string | undefined) {
    if (!ifMatch) return; // header is optional in Phase 01 client; the rowVersion check still guards
    const provided = Number(String(ifMatch).replace(/"/g, ''));
    if (Number.isFinite(provided) && provided !== rowVersion) {
      throw Conflict(
        ErrorCode.STALE_VERSION,
        'This KPI was updated by another user. Reload to continue (STALE-VERSION).',
        [{ field: 'If-Match', code: ErrorCode.STALE_VERSION, message: 'Reload the record' }],
      );
    }
  }

  private async notifySuperAdmins(title: string, body: string, deepLink: string, code: string) {
    const superAdmins = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', roles: { some: { role: { code: 'SUPER_ADMIN' } } } },
      select: { id: true, email: true, fullName: true, emailDigest: true },
    });
    await this.notifications.notify({
      code,
      recipients: superAdmins.map((s) => ({ userId: s.id, email: s.email, fullName: s.fullName, emailDigest: s.emailDigest })),
      title,
      body,
      deepLink,
      severity: 'warning',
      emailContext: {
        eventTitle: title,
        subject: body,
        detail: body,
        ctaLabel: 'Open ANWAR KPIFlow',
        linkUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}${deepLink}`,
      },
    });
  }

  /** Shared by the approvals module for the decision drawer. */
  referenceData() {
    return {
      rejectCategories: REJECT_CATEGORIES,
      measurementTypes: Object.entries(PRECISION).map(([code, meta]) => ({ code, decimals: meta.decimals, max: meta.max ?? null })),
    };
  }

  async categories() {
    return this.prisma.kpiCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  /** Used by the global search (FR-SRC-01). */
  async searchByCodeOrName(term: string, user: AuthUser, limit = 10) {
    const where: Prisma.KpiWhereInput = {
      AND: [
        this.scope.kpiScopeWhere(user),
        {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { code: { contains: term, mode: 'insensitive' } },
          ],
        },
        { status: { not: 'DELETED' } },
      ],
    };
    const rows = await this.prisma.kpi.findMany({
      where,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        employee: { select: { fullName: true, employeeCode: true } },
        period: { select: { label: true } },
      },
    });
    return rows;
  }

  /** Used by the dashboards to build drill-down lists (FR-DHD-02). */
  async drillDown(
    user: AuthUser,
    filters: { periodId?: string; departmentId?: string; businessUnitId?: string; kind: 'below_target' | 'pending' | 'approved' | 'rejected' | 'not_submitted' | 'weight_incomplete' },
    page = 1,
    size = 25,
  ) {
    const statusMap: Record<string, KpiStatus[]> = {
      below_target: ['APPROVED'],
      pending: ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'],
      approved: ['APPROVED'],
      rejected: ['REJECTED'],
      not_submitted: ['NOT_SUBMITTED'],
      weight_incomplete: [],
    };

    const where: Prisma.KpiWhereInput = {
      AND: [
        this.scope.kpiScopeWhere(user),
        filters.periodId ? { periodId: filters.periodId } : {},
        filters.departmentId ? { departmentId: filters.departmentId } : {},
        filters.businessUnitId ? { businessUnitId: filters.businessUnitId } : {},
        filters.kind === 'weight_incomplete' ? {} : { status: { in: statusMap[filters.kind] } },
        filters.kind === 'below_target' ? { achievement: { lt: 100 } } : {},
      ],
    };

    if (filters.kind === 'weight_incomplete') {
      // group employees whose allocated weight != 100 for the period
      const rows = await this.prisma.kpi.groupBy({
        by: ['employeeId'],
        where: { ...where, status: { notIn: ['REJECTED', 'DELETED'] } },
        _sum: { kpiWeight: true },
      });
      const incomplete = rows.filter((r) => (r._sum.kpiWeight ?? 0) !== 100);
      const total = incomplete.length;
      const paged = incomplete.slice((page - 1) * size, page * size);
      const users = await this.prisma.user.findMany({
        where: { id: { in: paged.map((p) => p.employeeId) } },
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          designationTitle: true,
          department: { select: { id: true, name: true } },
          businessUnit: { select: { id: true, name: true } },
        },
      });
      return {
        kind: filters.kind,
        items: paged.map((p) => {
          const u = users.find((x) => x.id === p.employeeId);
          return {
            employeeId: p.employeeId,
            employeeName: u?.fullName ?? '—',
            employeeCode: u?.employeeCode ?? '—',
            designation: u?.designationTitle ?? '—',
            department: u?.department?.name ?? '—',
            businessUnit: u?.businessUnit?.name ?? '—',
            allocatedWeight: p._sum.kpiWeight ?? 0,
          };
        }),
        total,
        page,
        size,
        totalPages: Math.max(1, Math.ceil(total / size)),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.kpi.findMany({
        where,
        skip: (page - 1) * size,
        take: size,
        orderBy: [{ updatedAt: 'desc' }],
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          target: true,
          actual: true,
          achievement: true,
          finalScore: true,
          weightedScore: true,
          kpiWeight: true,
          measurementType: true,
          unit: true,
          updatedAt: true,
          employee: { select: { id: true, fullName: true, employeeCode: true, designationTitle: true } },
          department: { select: { id: true, name: true } },
          businessUnit: { select: { id: true, name: true } },
          approver: { select: { id: true, fullName: true } },
          period: { select: { id: true, label: true } },
        },
      }),
      this.prisma.kpi.count({ where }),
    ]);

    return {
      kind: filters.kind,
      items: items.map((k) => ({
        id: k.id,
        code: k.code,
        name: k.name,
        status: k.status,
        target: decOrNull(k.target),
        actual: decOrNull(k.actual),
        achievement: decOrNull(k.achievement),
        finalScore: decOrNull(k.finalScore),
        weightedScore: decOrNull(k.weightedScore),
        kpiWeight: k.kpiWeight,
        measurementType: k.measurementType,
        unit: k.unit,
        employeeId: k.employee.id,
        employeeName: k.employee.fullName,
        employeeCode: k.employee.employeeCode,
        designation: k.employee.designationTitle ?? '—',
        department: k.department?.name ?? '—',
        departmentId: k.department?.id ?? null,
        businessUnit: k.businessUnit?.name ?? '—',
        approver: k.approver?.fullName ?? 'Super Admin',
        period: k.period.label,
        periodId: k.period.id,
        updatedAt: k.updatedAt,
      })),
      total,
      page,
      size,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  /** Unused-but-exported helper kept for the PDF report (FR-KPI-10). */
  async reportPayload(id: string, user: AuthUser) {
    const detail = await this.detail(id, user);
    return {
      generatedAt: new Date().toISOString(),
      generatedBy: { id: user.id, name: user.fullName, email: user.email },
      detail,
    };
  }
}

/** Human-readable summary of an approver's input change (NT-19). */
const changesSummary = (dto: { target?: number; actual?: number; kpiWeight?: number; rubricLevel?: number }): string => {
  const parts: string[] = [];
  if (dto.target !== undefined) parts.push(`Target → ${dto.target}`);
  if (dto.actual !== undefined) parts.push(`Actual → ${dto.actual}`);
  if (dto.kpiWeight !== undefined) parts.push(`Weight → ${dto.kpiWeight}%`);
  if (dto.rubricLevel !== undefined) parts.push(`Rubric level → ${dto.rubricLevel}`);
  return parts.length ? parts.join(', ') : 'No field values changed';
};
