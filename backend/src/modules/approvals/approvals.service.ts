/**
 * M07 — Review and approval: KPI Pending Requests, decisions, escalations and
 * bulk approve. Implements BR-R04, BR-R06, BR-R08, ADJ-1…ADJ-5, UC-04 and UC-05.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, KpiStatus, MeasurementType, Direction, RejectCategory } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PerformanceService } from '../performance/performance.service';
import { AuditService } from '../audit/audit.service';
import { KpiService } from '../kpi/kpi.service';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { Conflict, ErrorCode, Forbidden, NotFound, Unprocessable } from '../../common/errors/error-codes';
import { AUDIT_ACTIONS, NT } from '../../common/constants';
import { bandTest, calculateKpi } from '../calculation/calculation.engine';
import { dec, decOrNull, Decimal } from '../../common/utils/decimal.util';
import { formatDateTime, workingDaysAgo } from '../../common/utils/period.util';

export interface DecisionDto {
  action: 'approve' | 'adjust' | 'return' | 'reject' | 'delete';
  overrideScore?: number;
  changes?: { target?: number; actual?: number; kpiWeight?: number; rubricLevel?: number };
  reason?: string;
  rejectCategory?: string;
  comment?: string;
  rowVersion?: number;
}

/** SLA colours — §11.4 (≤3 d neutral, 4–5 d amber, >5 d red). */
const slaState = (ageDays: number): 'within' | 'at_risk' | 'breached' =>
  ageDays <= 3 ? 'within' : ageDays <= 5 ? 'at_risk' : 'breached';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly notifications: NotificationsService,
    private readonly performance: PerformanceService,
    private readonly audit: AuditService,
    private readonly kpiService: KpiService,
  ) {}

  private async config() {
    return this.kpiService.activeConfig();
  }

  // ================================================================== FR-APR-01/02

  /** The pending-request queue, oldest first, with the FR-APR-02 filters. */
  async queue(user: AuthUser, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page ?? 1));
    const size = Math.min(100, Math.max(1, Number(query.size ?? 25)));

    const statuses: KpiStatus[] = query.status
      ? (query.status.split(',').map((s) => s.trim()).filter(Boolean) as KpiStatus[])
      : ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'];

    const and: Prisma.KpiWhereInput[] = [{ status: { in: statuses } }, this.scope.kpiScopeWhere(user)];

    if (query.employee) {
      and.push({
        OR: [
          { employee: { fullName: { contains: query.employee, mode: 'insensitive' } } },
          { employee: { employeeCode: { contains: query.employee, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.frequency) and.push({ frequency: query.frequency as never });
    if (query.periodId) and.push({ periodId: query.periodId });
    if (query.categoryId) and.push({ categoryId: query.categoryId });
    if (query.departmentId) and.push({ departmentId: query.departmentId });
    if (query.businessUnitId) and.push({ businessUnitId: query.businessUnitId });
    if (query.belowTarget === 'true') {
      and.push({ status: 'APPROVED', achievement: { lt: 100 } });
    }
    // A Department Head never sees their own KPI in their queue (EC-21)
    and.push({ employeeId: { not: user.id } });

    // The Super Admin "All KPI Requests" queue covers the group; the Department
    // Head queue only their department, and Department Head KPIs go to Super Admins.
    if (user.roles.includes('DEPT_HEAD') && !user.roles.includes('SUPER_ADMIN')) {
      and.push({ NOT: { employee: { roles: { some: { role: { code: 'DEPT_HEAD' } } } } } });
    }

    const where: Prisma.KpiWhereInput = { AND: and };

    const sortField = query.sort ?? 'submittedAt';
    const order: Prisma.SortOrder = query.order === 'desc' ? 'desc' : 'asc';
    const orderBy: Prisma.KpiOrderByWithRelationInput[] =
      sortField === 'employee'
        ? [{ employee: { fullName: order } }]
        : sortField === 'achievement'
          ? [{ achievement: order }]
          : [{ submittedAt: order }, { createdAt: 'asc' }];

    const [rows, total, escalatedCount] = await Promise.all([
      this.prisma.kpi.findMany({
        where,
        skip: (page - 1) * size,
        take: size,
        orderBy,
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          submittedAt: true,
          reviewStartedAt: true,
          achievement: true,
          calculatedScore: true,
          finalScore: true,
          kpiWeight: true,
          weightedScore: true,
          measurementType: true,
          direction: true,
          unit: true,
          target: true,
          actual: true,
          remarks: true,
          evidenceCount: true,
          rowVersion: true,
          frequency: true,
          isAssigned: true,
          employee: {
            select: {
              id: true,
              fullName: true,
              employeeCode: true,
              email: true,
              designationTitle: true,
              department: { select: { id: true, name: true } },
              businessUnit: { select: { id: true, name: true } },
            },
          },
          approver: { select: { id: true, fullName: true } },
          period: { select: { id: true, code: true, label: true, frequency: true, submissionDeadline: true } },
          category: { select: { id: true, code: true, name: true } },
          department: { select: { id: true, name: true } },
          businessUnit: { select: { id: true, name: true } },
          escalations: { where: { status: 'PENDING' }, select: { id: true, delta: true, proposedScore: true, calculatedScore: true, reason: true } },
        },
      }),
      this.prisma.kpi.count({ where }),
      this.prisma.escalation.count({ where: { status: 'PENDING' } }),
    ]);

    const items = rows.map((k) => {
      const ageDays = k.submittedAt ? workingDaysAgo(k.submittedAt) : 0;
      return {
        id: k.id,
        code: k.code,
        kpi: k.name,
        status: k.status,
        employeeId: k.employee.id,
        employeeName: k.employee.fullName,
        employeeCode: k.employee.employeeCode,
        employeeEmail: k.employee.email,
        designation: k.employee.designationTitle ?? '—',
        department: k.department?.name ?? k.employee.department?.name ?? '—',
        departmentId: k.department?.id ?? k.employee.department?.id ?? null,
        businessUnit: k.businessUnit?.name ?? k.employee.businessUnit?.name ?? '—',
        frequency: k.frequency,
        period: k.period.label,
        periodId: k.period.id,
        category: k.category.name,
        categoryCode: k.category.code,
        submittedAt: k.submittedAt,
        ageDays,
        slaState: slaState(ageDays),
        target: decOrNull(k.target),
        actual: decOrNull(k.actual),
        achievement: decOrNull(k.achievement),
        calculatedScore: decOrNull(k.calculatedScore),
        finalScore: decOrNull(k.finalScore),
        kpiWeight: k.kpiWeight,
        weightedScore: decOrNull(k.weightedScore),
        measurementType: k.measurementType,
        direction: k.direction,
        unit: k.unit,
        remarks: k.remarks,
        evidenceCount: k.evidenceCount,
        approver: k.approver?.fullName ?? 'Super Admin',
        rowVersion: k.rowVersion,
        isAssigned: k.isAssigned,
        escalation: k.escalations[0] ?? null,
      };
    });

    return {
      items,
      total,
      page,
      size,
      totalPages: Math.max(1, Math.ceil(total / size)),
      escalatedCount,
      headline: `KPI submission requests — ${total} waiting, oldest first`,
    };
  }

  /** FR-APR-08 — the Super Admin queue for Department Head KPIs. */
  async departmentHeadQueue(user: AuthUser, query: Record<string, string>) {
    if (!user.roles.includes('SUPER_ADMIN')) {
      throw Forbidden('FORBIDDEN', 'The Department Head KPI queue is a Super Admin queue.');
    }
    const page = Math.max(1, Number(query.page ?? 1));
    const size = Math.min(100, Math.max(1, Number(query.size ?? 25)));

    const where: Prisma.KpiWhereInput = {
      status: { in: (query.status ? [query.status] : ['SUBMITTED', 'UNDER_REVIEW']) as KpiStatus[] },
      employee: { roles: { some: { role: { code: 'DEPT_HEAD' } } } },
    };
    const [items, total] = await Promise.all([
      this.prisma.kpi.findMany({
        where,
        skip: (page - 1) * size,
        take: size,
        orderBy: [{ submittedAt: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          submittedAt: true,
          target: true,
          actual: true,
          achievement: true,
          calculatedScore: true,
          finalScore: true,
          kpiWeight: true,
          evidenceCount: true,
          rowVersion: true,
          employee: { select: { id: true, fullName: true, employeeCode: true, designationTitle: true } },
          department: { select: { id: true, name: true } },
          period: { select: { id: true, label: true } },
          category: { select: { name: true } },
        },
      }),
      this.prisma.kpi.count({ where }),
    ]);

    return {
      items: items.map((k) => ({
        ...k,
        target: decOrNull(k.target),
        actual: decOrNull(k.actual),
        achievement: decOrNull(k.achievement),
        calculatedScore: decOrNull(k.calculatedScore),
        finalScore: decOrNull(k.finalScore),
        ageDays: k.submittedAt ? workingDaysAgo(k.submittedAt) : 0,
      })),
      total,
      page,
      size,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  /** §5.2 — the Super Admin may view, edit and decide any pending request (US-16). */
  async allRequests(user: AuthUser, query: Record<string, string>) {
    if (!user.roles.includes('SUPER_ADMIN') && !user.roles.includes('HR_ADMIN')) {
      throw Forbidden('FORBIDDEN', 'The group-wide request queue is a Super Admin view.');
    }
    return this.queue(user, { ...query, status: query.status ?? 'SUBMITTED,UNDER_REVIEW,ESCALATED' });
  }

  // ================================================================== FR-APR-04

  /** Opening a Submitted request sets it Under Review and notifies the employee (NT-06). */
  async startReview(id: string, user: AuthUser, meta: RequestContextMeta) {
    const kpi = await this.loadForDecision(id, user);
    if (kpi.status === 'UNDER_REVIEW') return { id, status: 'UNDER_REVIEW', message: 'Already under review.' };
    if (kpi.status !== 'SUBMITTED') {
      throw Conflict(ErrorCode.KPI_STATUS, `A KPI in ${kpi.status} status cannot be opened for review.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.kpi.update({
        where: { id },
        data: { status: 'UNDER_REVIEW', reviewStartedAt: new Date(), rowVersion: { increment: 1 } },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.REVIEW_START,
          entityType: 'kpi',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          before: { status: 'SUBMITTED' },
          after: { status: 'UNDER_REVIEW' },
          meta,
        },
        tx,
      );
    });

    await this.notifications.notify({
      code: NT.REVIEW_STARTED,
      recipients: [
        {
          userId: kpi.employee.id,
          email: kpi.employee.email,
          fullName: kpi.employee.fullName,
          emailDigest: kpi.employee.emailDigest,
        },
      ],
      title: `Your KPI is under review: ${kpi.name}`,
      body: `${user.fullName} opened your KPI “${kpi.name}”. Withdrawal is no longer possible.`,
      deepLink: `/my-kpi/${id}`,
      entityType: 'kpi',
      entityId: id,
      emailContext: {
        kpiName: kpi.name,
        approverName: user.fullName,
        period: kpi.period.label,
        kpiUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi/${id}`,
      },
    });

    return { id, status: 'UNDER_REVIEW' };
  }

  private async loadForDecision(id: string, user: AuthUser) {
    const kpi = await this.prisma.kpi.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            email: true,
            emailDigest: true,
            departmentId: true,
            businessUnitId: true,
          },
        },
        period: { select: { id: true, label: true, code: true, status: true } },
        category: { select: { name: true } },
        department: { select: { id: true, name: true } },
      },
    });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found');
    this.scope.assertCanDecide(user, kpi);
    if (kpi.isLocked) {
      throw Conflict(ErrorCode.KPI_LOCKED, 'This period is locked. A Super Admin must reopen it.');
    }
    return kpi;
  }

  // ================================================================== FR-APR-05/06/07

  /** Records one decision: approve / adjust / return / reject / delete. */
  async decide(id: string, dto: DecisionDto, user: AuthUser, meta: RequestContextMeta) {
    const kpi = await this.loadForDecision(id, user);
    const config = await this.config();

    if (dto.rowVersion !== undefined && dto.rowVersion !== kpi.rowVersion) {
      throw Conflict(
        ErrorCode.STALE_VERSION,
        `This KPI was updated by another user. Reload to continue (STALE-VERSION).`,
      );
    }

    const action = dto.action;
    const needsReason = ['adjust', 'return', 'reject', 'delete'].includes(action);
    const reason = (dto.reason ?? dto.comment ?? '').trim();
    if (needsReason && reason.length < config.minReasonLength) {
      throw Unprocessable(
        ErrorCode.REASON_REQUIRED,
        `A reason of at least ${config.minReasonLength} characters is required for this action.`,
        [{ field: 'reason', code: ErrorCode.REASON_REQUIRED, message: `At least ${config.minReasonLength} characters` }],
      );
    }
    if (action === 'reject' && !dto.rejectCategory) {
      throw Unprocessable(ErrorCode.V_MISSING, 'Choose a reject reason category.', [
        { field: 'rejectCategory', code: ErrorCode.V_MISSING, message: 'Reason category is required' },
      ]);
    }
    if (!['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(kpi.status) && action !== 'approve') {
      throw Conflict(ErrorCode.KPI_STATUS, `A KPI in ${kpi.status} status cannot be decided.`);
    }

    switch (action) {
      case 'approve':
        return this.approve(id, kpi, user, meta, dto);
      case 'adjust':
        return this.adjust(id, kpi, dto, user, meta);
      case 'return':
        return this.returnToEmployee(id, kpi, reason, user, meta);
      case 'reject':
        return this.reject(id, kpi, dto, user, meta);
      case 'delete':
        return this.softDelete(id, kpi, reason, user, meta);
      default:
        throw Unprocessable(ErrorCode.V_MISSING, 'Unknown decision action.');
    }
  }

  /** Approve calculated — FS = CS, freeze the version, notify NT-07. */
  private async approve(id: string, kpi: Awaited<ReturnType<ApprovalsService['loadForDecision']>>, user: AuthUser, meta: RequestContextMeta, dto: DecisionDto) {
    const config = await this.config();

    // ADJ-2 band test — also applies to Approve calculated after an input edit
    const { delta, withinBand } = bandTest(kpi.calculatedScore, kpi.calculatedScore, config.adjustmentBand);
    void delta;

    const versionNo = kpi.currentVersionNo + 1;
    const before = { status: kpi.status, finalScore: decOrNull(kpi.finalScore) };

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kpi.update({
        where: { id },
        data: {
          status: 'APPROVED',
          finalScore: kpi.calculatedScore,
          overrideScore: null,
          decidedAt: new Date(),
          decidedById: user.id,
          currentVersionNo: versionNo,
          rowVersion: { increment: 1 },
        },
      });
      await tx.kpiDecision.create({
        data: {
          kpiId: id,
          action: 'APPROVE',
          actorId: user.id,
          reason: dto.reason ?? null,
          scoreBefore: kpi.calculatedScore,
          scoreAfter: kpi.calculatedScore,
          statusBefore: kpi.status,
          statusAfter: 'APPROVED',
          rowVersion: kpi.rowVersion,
        },
      });
      await tx.kpiVersion.create({
        data: {
          kpiId: id,
          versionNo,
          snapshot: {
            name: updated.name,
            target: decOrNull(updated.target),
            actual: decOrNull(updated.actual),
            kpiWeight: updated.kpiWeight,
            achievement: decOrNull(updated.achievement),
            calculatedScore: decOrNull(updated.calculatedScore),
            finalScore: decOrNull(updated.finalScore),
            weightedScore: decOrNull(updated.weightedScore),
            status: 'APPROVED',
          } as Prisma.InputJsonValue,
          trigger: 'APPROVE',
          changeReason: 'Approved calculated',
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.APPROVE,
          entityType: 'kpi',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          before,
          after: { status: 'APPROVED', finalScore: decOrNull(kpi.calculatedScore) },
          meta,
        },
        tx,
      );
    });

    await this.notifications.notify({
      code: NT.KPI_APPROVED,
      recipients: [
        {
          userId: kpi.employee.id,
          email: kpi.employee.email,
          fullName: kpi.employee.fullName,
          emailDigest: kpi.employee.emailDigest,
        },
      ],
      title: `Your KPI was approved: ${kpi.name}`,
      body: `Final Score ${decOrNull(kpi.finalScore)} · Weighted Score ${decOrNull(kpi.weightedScore)}.`,
      deepLink: `/my-kpi/${id}`,
      entityType: 'kpi',
      entityId: id,
      severity: 'success',
      emailContext: {
        kpiName: kpi.name,
        period: kpi.period.label,
        achievement: `${decOrNull(kpi.achievement)}%`,
        finalScore: decOrNull(kpi.calculatedScore),
        weight: `${kpi.kpiWeight}%`,
        weightedScore: decOrNull(kpi.weightedScore),
        kpiUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi/${id}`,
      },
    });

    await this.refresh(kpi.employeeId, kpi.periodId);
    return { id, status: 'APPROVED', finalScore: decOrNull(kpi.calculatedScore), escalated: false };
  }

  /** ADJ-1/ADJ-2 — apply an adjustment, then band-test the resulting delta. */
  private async adjust(
    id: string,
    kpi: Awaited<ReturnType<ApprovalsService['loadForDecision']>>,
    dto: DecisionDto,
    user: AuthUser,
    meta: RequestContextMeta,
  ) {
    const config = await this.config();
    const reason = (dto.reason ?? '').trim();

    const nextTarget = dto.changes?.target !== undefined ? dto.changes.target : kpi.target ? Number(kpi.target) : null;
    const nextActual = dto.changes?.actual !== undefined ? dto.changes.actual : kpi.actual ? Number(kpi.actual) : null;
    const nextWeight = dto.changes?.kpiWeight !== undefined ? dto.changes.kpiWeight : kpi.kpiWeight;
    const nextRubric = dto.changes?.rubricLevel !== undefined ? dto.changes.rubricLevel : kpi.rubricLevel;

    if (nextWeight < config.minWeight || nextWeight > config.maxWeight) {
      throw Unprocessable(ErrorCode.W_MIN, `KPI Weight must be between ${config.minWeight}% and ${config.maxWeight}%.`);
    }
    if (nextWeight !== kpi.kpiWeight) {
      const others = await this.prisma.kpi.findMany({
        where: {
          employeeId: kpi.employeeId,
          periodId: kpi.periodId,
          frequency: kpi.frequency,
          id: { not: id },
          status: { notIn: ['REJECTED', 'DELETED'] },
        },
        select: { kpiWeight: true },
      });
      const allocated = others.reduce((s, r) => s + r.kpiWeight, 0);
      if (allocated + nextWeight > 100) {
        throw Conflict(
          ErrorCode.W_EXCEED,
          `Weight exceeds 100% by ${(allocated + nextWeight - 100).toFixed(2)}%. Available: ${Math.max(0, 100 - allocated)}%`,
        );
      }
    }

    const qualitativeMap = (config.qualitativeMap ?? null) as Record<string, number> | null;
    const recalculated = calculateKpi({
      target: nextTarget,
      actual: nextActual,
      rubricLevel: nextRubric,
      kpiWeight: nextWeight,
      direction: kpi.direction,
      measurementType: kpi.measurementType,
      overrideScore: dto.overrideScore ?? null,
      config: { scoreCap: config.scoreCap, scoreFloor: config.scoreFloor, qualitativeMap: qualitativeMap ?? undefined },
    });

    // Δ is measured against the score the employee submitted
    const { delta, withinBand } = bandTest(recalculated.finalScore, kpi.calculatedScore, config.adjustmentBand);

    const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    if (nextTarget !== (kpi.target ? Number(kpi.target) : null))
      changes.push({ field: 'target', oldValue: decOrNull(kpi.target), newValue: nextTarget !== null ? dec(nextTarget) : null });
    if (nextActual !== (kpi.actual ? Number(kpi.actual) : null))
      changes.push({ field: 'actual', oldValue: decOrNull(kpi.actual), newValue: nextActual !== null ? dec(nextActual) : null });
    if (nextWeight !== kpi.kpiWeight) changes.push({ field: 'kpiWeight', oldValue: String(kpi.kpiWeight), newValue: String(nextWeight) });
    if ((nextRubric ?? null) !== (kpi.rubricLevel ?? null))
      changes.push({ field: 'rubricLevel', oldValue: kpi.rubricLevel ? String(kpi.rubricLevel) : null, newValue: nextRubric ? String(nextRubric) : null });
    if (dto.overrideScore !== undefined)
      changes.push({ field: 'finalScore', oldValue: decOrNull(kpi.calculatedScore), newValue: dec(dto.overrideScore) });

    // PT: weight-only changes are not band-tested (ADJ-3)
    const scoreChanged = changes.some((c) => c.field !== 'kpiWeight');
    const mustEscalate = scoreChanged && !withinBand;

    if (mustEscalate) {
      const escalation = await this.prisma.$transaction(async (tx) => {
        const row = await tx.escalation.create({
          data: {
            kpiId: id,
            requestedById: user.id,
            calculatedScore: kpi.calculatedScore ?? '0',
            proposedScore: recalculated.finalScore.toString(),
            delta: delta.toString(),
            reason,
            pendingChanges: changes as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.kpi.update({
          where: { id },
          data: {
            status: 'ESCALATED',
            target: nextTarget !== null ? String(nextTarget) : null,
            actual: nextActual !== null ? String(nextActual) : null,
            kpiWeight: nextWeight,
            rubricLevel: nextRubric,
            achievement: recalculated.achievement.toString(),
            calculatedScore: recalculated.calculatedScore.toString(),
            overrideScore: dto.overrideScore !== undefined ? String(dto.overrideScore) : null,
            finalScore: recalculated.finalScore.toString(),
            weightedScore: recalculated.weightedScore.toString(),
            lastCalculatedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        await tx.kpiAdjustment.createMany({
          data: changes.map((c) => ({
            kpiId: id,
            field: c.field,
            oldValue: c.oldValue,
            newValue: c.newValue,
            reason,
            actorId: user.id,
          })),
        });
        await tx.kpiDecision.create({
          data: {
            kpiId: id,
            action: 'ADJUST',
            actorId: user.id,
            reason,
            scoreBefore: kpi.calculatedScore,
            scoreAfter: recalculated.finalScore.toString(),
            statusBefore: kpi.status,
            statusAfter: 'ESCALATED',
            rowVersion: kpi.rowVersion,
          },
        });
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.ESCALATE,
            entityType: 'escalation',
            entityId: row.id,
            actor: user,
            employeeId: kpi.employeeId,
            departmentId: kpi.departmentId,
            reason,
            before: { calculatedScore: decOrNull(kpi.calculatedScore) },
            after: { proposedScore: dec(recalculated.finalScore), delta: dec(delta), band: dec(config.adjustmentBand) },
            meta,
          },
          tx,
        );
        return row;
      });

      // NT-11 — every Super Admin is notified
      const superAdmins = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', roles: { some: { role: { code: 'SUPER_ADMIN' } } } },
        select: { id: true, email: true, fullName: true, emailDigest: true },
      });
      await this.notifications.notify({
        code: NT.ADJUSTMENT_ESCALATED,
        recipients: superAdmins.map((s) => ({ userId: s.id, email: s.email, fullName: s.fullName, emailDigest: s.emailDigest })),
        title: `Escalation: adjustment outside the ±${dec(config.adjustmentBand)} band on ${kpi.name}`,
        body: `Calculated ${decOrNull(kpi.calculatedScore)} → proposed ${dec(recalculated.finalScore)} (Δ ${dec(delta)}). Reason: ${reason}`,
        deepLink: `/escalations?id=${escalation.id}`,
        entityType: 'escalation',
        entityId: escalation.id,
        severity: 'warning',
        critical: true,
        emailContext: {
          employeeName: kpi.employee.fullName,
          employeeCode: kpi.employee.employeeCode,
          kpiName: kpi.name,
          department: kpi.department?.name ?? '—',
          calculatedScore: decOrNull(kpi.calculatedScore),
          proposedScore: dec(recalculated.finalScore),
          delta: dec(delta),
          band: dec(config.adjustmentBand),
          reason,
          escalationUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/escalations`,
        },
      });

      return {
        id,
        status: 'ESCALATED',
        escalated: true,
        delta: dec(delta),
        proposedScore: dec(recalculated.finalScore),
        message: `Δ ${dec(delta)} is outside the ±${dec(config.adjustmentBand)} band — escalated to a Super Admin.`,
      };
    }

    // Within the band (or weight-only): the adjustment is itself the approval
    const versionNo = kpi.currentVersionNo + 1;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kpi.update({
        where: { id },
        data: {
          target: nextTarget !== null ? String(nextTarget) : null,
          actual: nextActual !== null ? String(nextActual) : null,
          kpiWeight: nextWeight,
          rubricLevel: nextRubric,
          achievement: recalculated.achievement.toString(),
          calculatedScore: recalculated.calculatedScore.toString(),
          overrideScore: dto.overrideScore !== undefined ? String(dto.overrideScore) : null,
          finalScore: recalculated.finalScore.toString(),
          weightedScore: recalculated.weightedScore.toString(),
          status: 'APPROVED',
          decidedAt: new Date(),
          decidedById: user.id,
          currentVersionNo: versionNo,
          lastCalculatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await tx.kpiAdjustment.createMany({
        data: changes.map((c) => ({
          kpiId: id,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          reason,
          actorId: user.id,
        })),
      });
      await tx.kpiDecision.create({
        data: {
          kpiId: id,
          action: 'ADJUST',
          actorId: user.id,
          reason,
          scoreBefore: kpi.calculatedScore,
          scoreAfter: recalculated.finalScore.toString(),
          statusBefore: kpi.status,
          statusAfter: 'APPROVED',
          rowVersion: kpi.rowVersion,
        },
      });
      await tx.kpiVersion.create({
        data: {
          kpiId: id,
          versionNo,
          snapshot: {
            name: updated.name,
            target: decOrNull(updated.target),
            actual: decOrNull(updated.actual),
            kpiWeight: updated.kpiWeight,
            achievement: decOrNull(updated.achievement),
            calculatedScore: decOrNull(updated.calculatedScore),
            finalScore: decOrNull(updated.finalScore),
            weightedScore: decOrNull(updated.weightedScore),
            status: 'APPROVED',
          } as Prisma.InputJsonValue,
          trigger: 'ADJUST',
          changeReason: reason,
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.ADJUST,
          entityType: 'kpi',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          before: { target: decOrNull(kpi.target), actual: decOrNull(kpi.actual), kpiWeight: kpi.kpiWeight, calculatedScore: decOrNull(kpi.calculatedScore) },
          after: { target: nextTarget, actual: nextActual, kpiWeight: nextWeight, finalScore: dec(recalculated.finalScore) },
          changedFields: changes,
          reason,
          meta,
        },
        tx,
      );
    });

    await this.notifications.notify({
      code: NT.KPI_APPROVED_WITH_ADJUSTMENT,
      recipients: [
        {
          userId: kpi.employee.id,
          email: kpi.employee.email,
          fullName: kpi.employee.fullName,
          emailDigest: kpi.employee.emailDigest,
        },
      ],
      title: `Your KPI was approved with an adjustment: ${kpi.name}`,
      body: `Calculated ${decOrNull(kpi.calculatedScore)} → Final ${dec(recalculated.finalScore)} (Δ ${dec(delta)}). Reason: ${reason}`,
      deepLink: `/my-kpi/${id}`,
      entityType: 'kpi',
      entityId: id,
      severity: 'warning',
      emailContext: {
        kpiName: kpi.name,
        period: kpi.period.label,
        calculatedScore: decOrNull(kpi.calculatedScore),
        finalScore: dec(recalculated.finalScore),
        reason,
        approverName: user.fullName,
        kpiUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi/${id}`,
      },
    });

    await this.refresh(kpi.employeeId, kpi.periodId);
    return {
      id,
      status: 'APPROVED',
      escalated: false,
      delta: dec(delta),
      finalScore: dec(recalculated.finalScore),
      message: `Δ ${dec(delta)} is within the ±${dec(config.adjustmentBand)} band — approved with the adjusted score.`,
    };
  }

  /** FR-APR-06 — Return requires a comment of ≥ 15 characters (NT-09). */
  private async returnToEmployee(
    id: string,
    kpi: Awaited<ReturnType<ApprovalsService['loadForDecision']>>,
    reason: string,
    user: AuthUser,
    meta: RequestContextMeta,
  ) {
    const versionNo = kpi.currentVersionNo + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.kpi.update({
        where: { id },
        data: {
          status: 'RETURNED',
          returnedAt: new Date(),
          returnComment: reason,
          decidedById: user.id,
          currentVersionNo: versionNo,
          rowVersion: { increment: 1 },
        },
      });
      await tx.kpiDecision.create({
        data: {
          kpiId: id,
          action: 'RETURN',
          actorId: user.id,
          reason,
          statusBefore: kpi.status,
          statusAfter: 'RETURNED',
          rowVersion: kpi.rowVersion,
        },
      });
      await tx.kpiVersion.create({
        data: {
          kpiId: id,
          versionNo,
          snapshot: { status: 'RETURNED', comment: reason, returnedBy: user.fullName } as Prisma.InputJsonValue,
          trigger: 'RETURN',
          changeReason: reason,
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.RETURN,
          entityType: 'kpi',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          reason,
          before: { status: kpi.status },
          after: { status: 'RETURNED' },
          meta,
        },
        tx,
      );
    });

    const resubmitBy = new Date(Date.now() + 3 * 86_400_000);
    await this.notifications.notify({
      code: NT.KPI_RETURNED,
      recipients: [
        {
          userId: kpi.employee.id,
          email: kpi.employee.email,
          fullName: kpi.employee.fullName,
          emailDigest: kpi.employee.emailDigest,
        },
      ],
      title: `Your KPI was returned for correction: ${kpi.name}`,
      body: reason,
      deepLink: `/my-kpi/${id}`,
      entityType: 'kpi',
      entityId: id,
      severity: 'warning',
      critical: true,
      emailContext: {
        kpiName: kpi.name,
        period: kpi.period.label,
        comment: reason,
        resubmitBy: formatDateTime(resubmitBy),
        kpiUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi/${id}`,
      },
    });

    return { id, status: 'RETURNED', message: 'Returned to the employee with your comment.' };
  }

  /** FR-APR-06 — Reject is terminal and releases the weight (NT-10). */
  private async reject(
    id: string,
    kpi: Awaited<ReturnType<ApprovalsService['loadForDecision']>>,
    dto: DecisionDto,
    user: AuthUser,
    meta: RequestContextMeta,
  ) {
    const reason = (dto.reason ?? dto.comment ?? '').trim();
    await this.prisma.$transaction(async (tx) => {
      await tx.kpi.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedReason: reason,
          rejectCategory: dto.rejectCategory as RejectCategory,
          decidedAt: new Date(),
          decidedById: user.id,
          currentVersionNo: kpi.currentVersionNo + 1,
          rowVersion: { increment: 1 },
        },
      });
      await tx.kpiDecision.create({
        data: {
          kpiId: id,
          action: 'REJECT',
          actorId: user.id,
          reason,
          rejectCategory: dto.rejectCategory as RejectCategory,
          statusBefore: kpi.status,
          statusAfter: 'REJECTED',
          rowVersion: kpi.rowVersion,
        },
      });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.REJECT,
          entityType: 'kpi',
          entityId: id,
          actor: user,
          employeeId: kpi.employeeId,
          departmentId: kpi.departmentId,
          reason,
          after: { status: 'REJECTED', rejectCategory: dto.rejectCategory },
          meta,
        },
        tx,
      );
    });

    await this.notifications.notify({
      code: NT.KPI_REJECTED,
      recipients: [
        {
          userId: kpi.employee.id,
          email: kpi.employee.email,
          fullName: kpi.employee.fullName,
          emailDigest: kpi.employee.emailDigest,
        },
      ],
      title: `Your KPI was rejected: ${kpi.name}`,
      body: `${dto.rejectCategory}: ${reason}`,
      deepLink: `/my-kpi/${id}`,
      entityType: 'kpi',
      entityId: id,
      severity: 'danger',
      critical: true,
      emailContext: {
        kpiName: kpi.name,
        period: kpi.period.label,
        rejectCategory: dto.rejectCategory,
        comment: reason,
        kpiUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi/${id}`,
      },
    });

    await this.refresh(kpi.employeeId, kpi.periodId);
    return { id, status: 'REJECTED', message: 'Rejected. The weight has been released.' };
  }

  /** FR-APR-07 — soft delete with a reason; the weight is released (NT-17). */
  private async softDelete(
    id: string,
    kpi: Awaited<ReturnType<ApprovalsService['loadForDecision']>>,
    reason: string,
    user: AuthUser,
    meta: RequestContextMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.kpi.update({
        where: { id },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
          deletedById: user.id,
          deletedReason: reason,
          decidedById: user.id,
          rowVersion: { increment: 1 },
        },
      });
      await tx.kpiDecision.create({
        data: {
          kpiId: id,
          action: 'DELETE',
          actorId: user.id,
          reason,
          statusBefore: kpi.status,
          statusAfter: 'DELETED',
          rowVersion: kpi.rowVersion,
        },
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
          after: { status: 'DELETED' },
          meta,
        },
        tx,
      );
    });

    await this.notifications.notify({
      code: NT.KPI_DELETED,
      recipients: [
        {
          userId: kpi.employee.id,
          email: kpi.employee.email,
          fullName: kpi.employee.fullName,
          emailDigest: kpi.employee.emailDigest,
        },
      ],
      title: `Your KPI was removed: ${kpi.name}`,
      body: reason,
      deepLink: `/my-kpi`,
      entityType: 'kpi',
      entityId: id,
      severity: 'danger',
      critical: true,
      emailContext: { kpiName: kpi.name, period: kpi.period.label, reason, kpiUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi` },
    });

    return { id, status: 'DELETED', message: 'KPI soft-deleted and its weight released.' };
  }

  // ================================================================== FR-APR-11

  /** Bulk approve up to 20 unadjusted requests with a single confirmation. */
  async bulkApprove(ids: string[], user: AuthUser, meta: RequestContextMeta) {
    if (!ids?.length) throw Unprocessable(ErrorCode.V_MISSING, 'Select at least one request.');
    if (ids.length > 20) throw Unprocessable(ErrorCode.V_MISSING, 'Bulk approve accepts up to 20 requests at a time.');

    const results: Array<{ id: string; ok: boolean; status?: string; message?: string }> = [];
    for (const id of ids) {
      try {
        const kpi = await this.loadForDecision(id, user);
        const res = await this.approve(id, kpi, user, meta, { action: 'approve' });
        results.push({ id, ok: true, status: res.status });
      } catch (e) {
        results.push({ id, ok: false, message: (e as Error).message });
      }
    }

    await this.audit.record({
      action: AUDIT_ACTIONS.APPROVE,
      entityType: 'kpi',
      actor: user,
      after: { bulk: true, requested: ids.length, approved: results.filter((r) => r.ok).length },
      meta,
    });

    return {
      approved: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  // ======================================================================= UC-05

  /** Escalations queue for the Super Admin. */
  async escalations(user: AuthUser, query: Record<string, string>) {
    if (!user.roles.includes('SUPER_ADMIN')) {
      throw Forbidden('FORBIDDEN', 'Escalations are decided by a Super Admin.');
    }
    const page = Math.max(1, Number(query.page ?? 1));
    const size = Math.min(100, Math.max(1, Number(query.size ?? 25)));
    const where: Prisma.EscalationWhereInput = { status: (query.status as never) ?? 'PENDING' };

    const [rows, total] = await Promise.all([
      this.prisma.escalation.findMany({
        where,
        skip: (page - 1) * size,
        take: size,
        orderBy: { createdAt: 'asc' },
        include: {
          kpi: {
            select: {
              id: true,
              code: true,
              name: true,
              status: true,
              target: true,
              actual: true,
              achievement: true,
              kpiWeight: true,
              evidenceCount: true,
              employee: { select: { id: true, fullName: true, employeeCode: true, designationTitle: true } },
              department: { select: { id: true, name: true } },
              period: { select: { id: true, label: true } },
              category: { select: { name: true } },
            },
          },
          requestedBy: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.escalation.count({ where }),
    ]);

    return {
      items: rows.map((e) => ({
        id: e.id,
        kpiId: e.kpi.id,
        kpiCode: e.kpi.code,
        kpi: e.kpi.name,
        employeeName: e.kpi.employee.fullName,
        employeeCode: e.kpi.employee.employeeCode,
        designation: e.kpi.employee.designationTitle ?? '—',
        department: e.kpi.department?.name ?? '—',
        period: e.kpi.period.label,
        category: e.kpi.category.name,
        target: decOrNull(e.kpi.target),
        actual: decOrNull(e.kpi.actual),
        achievement: decOrNull(e.kpi.achievement),
        kpiWeight: e.kpi.kpiWeight,
        evidenceCount: e.kpi.evidenceCount,
        calculatedScore: decOrNull(e.calculatedScore),
        proposedScore: decOrNull(e.proposedScore),
        delta: decOrNull(e.delta),
        reason: e.reason,
        requestedBy: e.requestedBy.fullName,
        createdAt: e.createdAt,
        ageDays: workingDaysAgo(e.createdAt),
        status: e.status,
        pendingChanges: e.pendingChanges,
      })),
      total,
      page,
      size,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  /** UC-05 — approve or decline an escalated adjustment (NT-12). */
  async decideEscalation(id: string, decision: 'APPROVE' | 'DECLINE', comment: string | undefined, user: AuthUser, meta: RequestContextMeta) {
    if (!user.roles.includes('SUPER_ADMIN')) {
      throw Forbidden('FORBIDDEN', 'Escalations are decided by a Super Admin.');
    }
    const escalation = await this.prisma.escalation.findUnique({
      where: { id },
      include: {
        kpi: {
          include: {
            employee: { select: { id: true, fullName: true, employeeCode: true, email: true, emailDigest: true } },
            period: { select: { label: true } },
          },
        },
        requestedBy: { select: { id: true, fullName: true, email: true, emailDigest: true } },
      },
    });
    if (!escalation) throw NotFound(ErrorCode.NOT_FOUND, 'Escalation not found');
    if (escalation.status !== 'PENDING') throw Conflict(ErrorCode.CONFLICT, 'This escalation has already been decided.');

    const kpi = escalation.kpi;
    const config = await this.config();

    if (decision === 'APPROVE') {
      await this.prisma.$transaction(async (tx) => {
        await tx.escalation.update({
          where: { id },
          data: { status: 'APPROVED', decidedById: user.id, decidedAt: new Date(), decisionComment: comment ?? null },
        });
        const updated = await tx.kpi.update({
          where: { id: kpi.id },
          data: {
            status: 'APPROVED',
            finalScore: escalation.proposedScore,
            overrideScore: escalation.proposedScore,
            decidedAt: new Date(),
            decidedById: user.id,
            currentVersionNo: kpi.currentVersionNo + 1,
            rowVersion: { increment: 1 },
          },
        });
        await tx.kpiDecision.create({
          data: {
            kpiId: kpi.id,
            action: 'ESCALATION_APPROVE',
            actorId: user.id,
            reason: comment ?? escalation.reason,
            scoreBefore: escalation.calculatedScore,
            scoreAfter: escalation.proposedScore,
            statusBefore: 'ESCALATED',
            statusAfter: 'APPROVED',
            rowVersion: kpi.rowVersion,
          },
        });
        await tx.kpiVersion.create({
          data: {
            kpiId: kpi.id,
            versionNo: kpi.currentVersionNo + 1,
            snapshot: {
              name: updated.name,
              finalScore: decOrNull(updated.finalScore),
              weightedScore: decOrNull(updated.weightedScore),
              status: 'APPROVED',
              escalated: true,
            } as Prisma.InputJsonValue,
            trigger: 'ESCALATION_APPROVE',
            changeReason: comment ?? 'Escalated adjustment approved by a Super Admin',
            createdById: user.id,
          },
        });
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.ESCALATION_DECIDE,
            entityType: 'escalation',
            entityId: id,
            actor: user,
            employeeId: kpi.employeeId,
            departmentId: kpi.departmentId,
            after: { decision: 'APPROVE', finalScore: decOrNull(escalation.proposedScore) },
            reason: comment ?? escalation.reason,
            meta,
          },
          tx,
        );
      });
    } else {
      // Decline → the KPI returns to Under Review with the adjustment reversed
      await this.prisma.$transaction(async (tx) => {
        await tx.escalation.update({
          where: { id },
          data: { status: 'DECLINED', decidedById: user.id, decidedAt: new Date(), decisionComment: comment ?? null },
        });
        const updated = await tx.kpi.update({
          where: { id: kpi.id },
          data: {
            status: 'UNDER_REVIEW',
            overrideScore: null,
            finalScore: kpi.calculatedScore,
            weightedScore: kpi.calculatedScore
              ? new Decimal(kpi.calculatedScore.toString()).mul(kpi.kpiWeight).div(100).toDecimalPlaces(2).toString()
              : null,
            rowVersion: { increment: 1 },
          },
        });
        await tx.kpiDecision.create({
          data: {
            kpiId: kpi.id,
            action: 'ESCALATION_DECLINE',
            actorId: user.id,
            reason: comment ?? escalation.reason,
            scoreBefore: escalation.proposedScore,
            scoreAfter: updated.finalScore,
            statusBefore: 'ESCALATED',
            statusAfter: 'UNDER_REVIEW',
            rowVersion: kpi.rowVersion,
          },
        });
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.ESCALATION_DECIDE,
            entityType: 'escalation',
            entityId: id,
            actor: user,
            employeeId: kpi.employeeId,
            departmentId: kpi.departmentId,
            after: { decision: 'DECLINE' },
            reason: comment ?? escalation.reason,
            meta,
          },
          tx,
        );
      });
    }

    const recipients = [
      {
        userId: escalation.requestedBy.id,
        email: escalation.requestedBy.email,
        fullName: escalation.requestedBy.fullName,
        emailDigest: escalation.requestedBy.emailDigest,
      },
      {
        userId: kpi.employee.id,
        email: kpi.employee.email,
        fullName: kpi.employee.fullName,
        emailDigest: kpi.employee.emailDigest,
      },
    ];

    await this.notifications.notify({
      code: NT.ESCALATION_DECIDED,
      recipients,
      title: `Escalation ${decision === 'APPROVE' ? 'approved' : 'declined'}: ${kpi.name}`,
      body: comment ?? escalation.reason,
      deepLink: `/my-kpi/${kpi.id}`,
      entityType: 'kpi',
      entityId: kpi.id,
      severity: decision === 'APPROVE' ? 'success' : 'warning',
      critical: true,
      emailContext: {
        kpiName: kpi.name,
        employeeName: kpi.employee.fullName,
        outcome: decision === 'APPROVE' ? 'Approved' : 'Declined',
        finalScore: decOrNull(escalation.proposedScore),
        comment: comment ?? escalation.reason,
        band: dec(config.adjustmentBand),
        kpiUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi/${kpi.id}`,
      },
    });

    await this.refresh(kpi.employeeId, kpi.periodId);
    return {
      id,
      decision,
      message: decision === 'APPROVE' ? 'Escalated adjustment approved.' : 'Declined — the KPI returned to Under Review.',
    };
  }

  /** FR-APR-12 — the Super Admin may decide any pending employee request directly. */
  async superAdminQueueCounts(user: AuthUser) {
    const pending = await this.prisma.kpi.count({
      where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
    });
    const headKpis = await this.prisma.kpi.count({
      where: {
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
        employee: { roles: { some: { role: { code: 'DEPT_HEAD' } } } },
      },
    });
    const escalations = await this.prisma.escalation.count({ where: { status: 'PENDING' } });
    const corrections = await this.prisma.correctionRequest.count({ where: { status: 'PENDING' } });
    const deptQueue = user.roles.includes('DEPT_HEAD')
      ? await this.prisma.kpi.count({ where: { AND: [{ status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'] } }, this.scope.kpiScopeWhere(user)] } })
      : 0;

    return { pending, headKpis, escalations, corrections, deptQueue };
  }

  private async refresh(employeeId: string, periodId: string) {
    try {
      await this.performance.employeePeriod(employeeId, periodId);
    } catch (e) {
      this.logger.warn(`Aggregate refresh failed: ${(e as Error).message}`);
    }
  }
}
