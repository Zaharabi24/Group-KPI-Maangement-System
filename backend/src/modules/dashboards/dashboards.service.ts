/**
 * M09–M11 — Employee Performance Summary, Department Dashboard, Group Dashboard
 * and the Leaderboard. Every number follows §4.5; closed periods read snapshots.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, Frequency, RagStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { PerformanceService } from '../performance/performance.service';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { Forbidden, NotFound, ErrorCode, Unprocessable } from '../../common/errors/error-codes';
import { PERM } from '../../common/constants';
import { Decimal, dec, decOrNull, num, round2 } from '../../common/utils/decimal.util';
import { currentPeriodDescriptor, previousPeriodDescriptor, workingDaysBetween } from '../../common/utils/period.util';

@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly performance: PerformanceService,
  ) {}

  // ------------------------------------------------------------------ periods

  async resolvePeriod(periodId?: string, periodCode?: string, frequency?: Frequency) {
    if (periodId) {
      const p = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });
      if (p) return p;
    }
    if (periodCode) {
      const p = await this.prisma.kpiPeriod.findUnique({ where: { code: periodCode } });
      if (p) return p;
    }
    const descriptor = currentPeriodDescriptor((frequency ?? 'MONTHLY') as never);
    const current = await this.prisma.kpiPeriod.findUnique({
      where: { frequency_startDate: { frequency: (frequency ?? 'MONTHLY') as Frequency, startDate: descriptor.startDate } },
    });
    if (current) return current;
    return this.prisma.kpiPeriod.findFirst({
      where: frequency ? { frequency } : {},
      orderBy: { startDate: 'desc' },
    });
  }

  // ------------------------------------------------------- M09 FR-PSM-01..04

  /** Employee Performance Summary — metric cards, the 10-column table, 3 charts. */
  async employeeSummary(user: AuthUser, query: Record<string, string>) {
    const frequency = (query.frequency as Frequency) ?? 'MONTHLY';
    const period = await this.resolvePeriod(query.periodId, query.periodCode, frequency);
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'No period matches the selected filter.');

    const targetEmployeeId =
      query.employeeId && (this.scope.isGroupScoped(user) || user.roles.includes('DEPT_HEAD'))
        ? query.employeeId
        : user.id;

    if (targetEmployeeId !== user.id) {
      const employee = await this.prisma.user.findUnique({
        where: { id: targetEmployeeId },
        select: { departmentId: true, businessUnitId: true },
      });
      if (!employee) throw NotFound(ErrorCode.NOT_FOUND, 'Employee not found');
      if (!this.scope.isGroupScoped(user) && employee.departmentId && !user.scope.departmentIds.includes(employee.departmentId)) {
        throw Forbidden('OUT-OF-SCOPE', 'This employee is outside your scope');
      }
    }

    return this.performance.employeeDashboard(user, period.id, targetEmployeeId);
  }

  // ------------------------------------------------ M10 FR-DHD-01..03, UC-11

  /** Department dashboard + leaderboard. */
  async departmentDashboard(user: AuthUser, query: Record<string, string>) {
    if (!user.permissions.includes(PERM.DASHBOARD_DEPT) && !this.scope.isGroupScoped(user)) {
      throw Forbidden('FORBIDDEN', 'Your role does not permit the department dashboard.');
    }

    const frequency = (query.frequency as Frequency) ?? 'MONTHLY';
    const period = await this.resolvePeriod(query.periodId, query.periodCode, frequency);
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'No period matches the selected filter.');

    const allowedDepartments = this.scope.departmentFilter(user);
    const departments = await this.prisma.department.findMany({
      where: {
        isActive: true,
        ...(query.departmentId ? { id: query.departmentId } : {}),
        ...(allowedDepartments ? { id: { in: allowedDepartments } } : {}),
      },
      include: { businessUnit: { select: { id: true, name: true, code: true } } },
      orderBy: { name: 'asc' },
    });

    const departmentIds = departments.map((d) => d.id);

    const kpis = await this.prisma.kpi.findMany({
      where: {
        periodId: period.id,
        departmentId: { in: departmentIds.length ? departmentIds : ['__none__'] },
        status: { notIn: ['DELETED'] },
      },
      select: {
        id: true,
        status: true,
        achievement: true,
        finalScore: true,
        weightedScore: true,
        kpiWeight: true,
        employeeId: true,
        departmentId: true,
      },
      take: 200_000,
    });

    const approved = kpis.filter((k) => k.status === 'APPROVED');
    const pending = kpis.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status));

    const perEmployee = new Map<string, { weights: number; achNum: Decimal; achDen: number; score: Decimal; approved: number; total: number }>();
    kpis.forEach((k) => {
      const agg = perEmployee.get(k.employeeId) ?? { weights: 0, achNum: new Decimal(0), achDen: 0, score: new Decimal(0), approved: 0, total: 0 };
      agg.total += 1;
      if (k.status !== 'REJECTED') agg.weights += k.kpiWeight;
      if (k.status === 'APPROVED') {
        agg.approved += 1;
        agg.score = agg.score.plus(new Decimal(k.weightedScore?.toString() ?? 0));
        agg.achNum = agg.achNum.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight));
        agg.achDen += k.kpiWeight;
      }
      perEmployee.set(k.employeeId, agg);
    });

    const withScores = Array.from(perEmployee.values()).filter((e) => e.approved > 0);
    const averageAchievement = withScores.length
      ? round2(withScores.reduce((a, e) => a.plus(e.achDen ? e.achNum.div(e.achDen) : new Decimal(0)), new Decimal(0)).div(withScores.length))
      : new Decimal(0);

    const thresholds = await this.performance.ragThresholds();
    const weightIncomplete = Array.from(perEmployee.values()).filter((e) => e.weights !== 100).length;

    // SLA: the oldest pending request and its age in working days
    const oldestPending = pending.length
      ? await this.prisma.kpi.findFirst({
          where: { id: { in: pending.map((p) => p.id) }, submittedAt: { not: null } },
          orderBy: { submittedAt: 'asc' },
          select: { submittedAt: true },
        })
      : null;

    const counts = {
      averageAchievement: dec(averageAchievement),
      averageAchievementValue: Number(averageAchievement.toFixed(2)),
      pendingEvaluations: pending.length,
      totalApproved: approved.length,
      rejected: kpis.filter((k) => k.status === 'REJECTED').length,
      belowTarget: approved.filter((k) => num(k.achievement) < 100).length,
      weightIncomplete,
      notSubmitted: kpis.filter((k) => k.status === 'NOT_SUBMITTED').length,
      totalKpis: kpis.length,
      oldestPendingAgeDays: oldestPending?.submittedAt ? workingDaysBetween(oldestPending.submittedAt, new Date()) : 0,
      slaBreaches: pending.filter((p) => p.status === 'ESCALATED').length,
    };

    const leaderboard = await this.performance.leaderboard(user, period.id, query.departmentId ?? (departments.length === 1 ? departments[0].id : undefined), 200);

    // Employees on the leaderboard, enriched with the approved x/y and RAG bar
    const employeeIds = (leaderboard as Array<{ employeeId: string }>).map((l) => l.employeeId);
    const employees = await this.prisma.user.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, fullName: true, employeeCode: true, designationTitle: true, status: true },
    });

    const leaderboardOut = (leaderboard as Array<Record<string, unknown>>).map((l) => {
      const emp = employees.find((e) => e.id === l.employeeId);
      return {
        ...l,
        employeeName: emp?.fullName ?? l.employeeName,
        employeeCode: emp?.employeeCode ?? l.employeeCode,
        designation: emp?.designationTitle ?? l.designation,
        ragBarPercent: Math.min(Number(l.totalKpiScore ?? 0), 100),
      };
    });

    // weight-incomplete employee list (drill-down preview)
    const incompleteIds = Array.from(perEmployee.entries())
      .filter(([, v]) => v.weights !== 100)
      .slice(0, 10)
      .map(([id]) => id);
    const incompleteUsers = await this.prisma.user.findMany({
      where: { id: { in: incompleteIds } },
      select: { id: true, fullName: true, employeeCode: true, department: { select: { name: true } } },
    });

    return {
      period,
      frequency,
      departments: departments.map((d) => ({ id: d.id, name: d.name, businessUnit: d.businessUnit })),
      cards: counts,
      leaderboard: leaderboardOut,
      thresholds,
      belowTargetList: approved
        .filter((k) => num(k.achievement) < 100)
        .slice(0, 10)
        .map((k) => ({ kpiId: k.id, employeeId: k.employeeId, achievement: decOrNull(k.achievement) })),
      weightIncompleteList: incompleteUsers.map((u) => ({
        employeeId: u.id,
        employeeName: u.fullName,
        employeeCode: u.employeeCode,
        department: u.department?.name ?? '—',
        allocatedWeight: perEmployee.get(u.id)?.weights ?? 0,
      })),
    };
  }

  // ------------------------------------------------ M11 FR-SAD-01..02, US-19

  /** Group dashboard with BU → Department → Employee → KPI drill-down. */
  async groupDashboard(user: AuthUser, query: Record<string, string>) {
    if (!user.permissions.includes(PERM.DASHBOARD_GROUP) && !user.roles.includes('SUPER_ADMIN')) {
      throw Forbidden('FORBIDDEN', 'The Group Dashboard is a management view.');
    }
    const frequency = (query.frequency as Frequency) ?? 'MONTHLY';
    const period = await this.resolvePeriod(query.periodId, query.periodCode, frequency);
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'No period matches the selected filter.');

    const kpis = await this.prisma.kpi.findMany({
      where: {
        periodId: period.id,
        status: { notIn: ['DELETED'] },
        ...(query.businessUnitId ? { businessUnitId: query.businessUnitId } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      },
      select: {
        id: true,
        status: true,
        achievement: true,
        weightedScore: true,
        kpiWeight: true,
        employeeId: true,
        departmentId: true,
        businessUnitId: true,
        submittedAt: true,
        decidedAt: true,
      },
      take: 500_000,
    });

    const businessUnits = await this.prisma.businessUnit.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, division: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const departments = await this.prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true, businessUnitId: true },
    });

    const approved = kpis.filter((k) => k.status === 'APPROVED');
    const pending = kpis.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status));
    const decided = kpis.filter((k) => k.submittedAt && k.decidedAt);
    const slaBreaches = decided.filter((k) => workingDaysBetween(k.submittedAt!, k.decidedAt!) > 5).length;

    const groupAchNum = approved.reduce((a, k) => a.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight)), new Decimal(0));
    const groupAchDen = approved.reduce((a, k) => a + k.kpiWeight, 0);
    const groupScore = approved.reduce((a, k) => a.plus(new Decimal(k.weightedScore?.toString() ?? 0)), new Decimal(0));
    const scoredEmployees = new Set(approved.map((k) => k.employeeId));

    const byBu = businessUnits.map((bu) => {
      const list = approved.filter((k) => k.businessUnitId === bu.id);
      const all = kpis.filter((k) => k.businessUnitId === bu.id);
      const num1 = list.reduce((a, k) => a.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight)), new Decimal(0));
      const den1 = list.reduce((a, k) => a + k.kpiWeight, 0);
      const score = list.reduce((a, k) => a.plus(new Decimal(k.weightedScore?.toString() ?? 0)), new Decimal(0));
      const empCount = new Set(list.map((k) => k.employeeId)).size;
      return {
        id: bu.id,
        code: bu.code,
        name: bu.name,
        division: bu.division,
        averageAchievement: den1 ? dec(round2(num1.div(den1))) : '0.00',
        averageTotalScore: empCount ? dec(round2(score.div(empCount))) : '0.00',
        approved: list.length,
        pending: all.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status)).length,
        rejected: all.filter((k) => k.status === 'REJECTED').length,
        belowTarget: list.filter((k) => num(k.achievement) < 100).length,
        weightIncomplete: countWeightIncomplete(all),
        headcount: empCount,
      };
    }).filter((b) => b.approved > 0 || b.pending > 0 || b.rejected > 0);

    const deptHeat = departments.map((d) => {
      const all = kpis.filter((k) => k.departmentId === d.id);
      if (!all.length) return null;
      const list = all.filter((k) => k.status === 'APPROVED');
      const num1 = list.reduce((a, k) => a.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight)), new Decimal(0));
      const den1 = list.reduce((a, k) => a + k.kpiWeight, 0);
      const dDecided = all.filter((k) => k.submittedAt && k.decidedAt);
      return {
        departmentId: d.id,
        department: d.name,
        businessUnitId: d.businessUnitId,
        averageAchievement: den1 ? dec(round2(num1.div(den1))) : '0.00',
        approved: list.length,
        pending: all.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status)).length,
        rejected: all.filter((k) => k.status === 'REJECTED').length,
        belowTarget: list.filter((k) => num(k.achievement) < 100).length,
        slaBreaches: dDecided.filter((k) => workingDaysBetween(k.submittedAt!, k.decidedAt!) > 5).length,
        weightIncomplete: countWeightIncomplete(all),
        participation: all.length ? dec(round2(new Decimal(list.length).div(all.length).mul(100))) : '0.00',
      };
    }).filter(Boolean);

    const escalations = await this.prisma.escalation.findMany({
      where: { status: 'PENDING' },
      take: 10,
      orderBy: { createdAt: 'asc' },
      include: {
        kpi: { select: { id: true, name: true, employee: { select: { fullName: true } }, department: { select: { name: true } } } },
        requestedBy: { select: { fullName: true } },
      },
    });

    return {
      period,
      headline: {
        groupAverageAchievement: groupAchDen ? dec(round2(groupAchNum.div(groupAchDen))) : '0.00',
        groupAverageTotalScore: scoredEmployees.size ? dec(round2(groupScore.div(scoredEmployees.size))) : '0.00',
        totalKpis: kpis.length,
        approved: approved.length,
        pending: pending.length,
        rejected: kpis.filter((k) => k.status === 'REJECTED').length,
        notSubmitted: kpis.filter((k) => k.status === 'NOT_SUBMITTED').length,
        slaCompliance: decided.length ? dec(round2(new Decimal(decided.length - slaBreaches).div(decided.length).mul(100))) : '100.00',
        slaBreaches,
        participatingEmployees: scoredEmployees.size,
        openEscalations: escalations.length,
        weightIncomplete: countWeightIncomplete(kpis),
      },
      businessUnits: byBu,
      departments: deptHeat,
      escalations: escalations.map((e) => ({
        id: e.id,
        kpiId: e.kpi.id,
        kpi: e.kpi.name,
        employee: e.kpi.employee.fullName,
        department: e.kpi.department?.name ?? '—',
        calculatedScore: decOrNull(e.calculatedScore),
        proposedScore: decOrNull(e.proposedScore),
        delta: decOrNull(e.delta),
        requestedBy: e.requestedBy.fullName,
        ageDays: workingDaysBetween(e.createdAt, new Date()),
      })),
    };
  }

  /** FR-DHD-03 — a standalone leaderboard endpoint. */
  async leaderboard(user: AuthUser, query: Record<string, string>) {
    const frequency = (query.frequency as Frequency) ?? 'MONTHLY';
    const period = await this.resolvePeriod(query.periodId, query.periodCode, frequency);
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'No period matches the selected filter.');
    if (!user.permissions.includes(PERM.DASHBOARD_DEPT) && !user.permissions.includes(PERM.DASHBOARD_GROUP)) {
      throw Forbidden('FORBIDDEN', 'The leaderboard is available to Department Heads and management.');
    }

    const rows = await this.performance.leaderboard(user, period.id, query.departmentId, Number(query.limit ?? 200));
    const employeeIds = (rows as Array<{ employeeId: string }>).map((r) => r.employeeId);
    const employees = await this.prisma.user.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, fullName: true, employeeCode: true, designationTitle: true, department: { select: { name: true } } },
    });

    return {
      period,
      entries: (rows as Array<Record<string, unknown>>).map((r) => {
        const emp = employees.find((e) => e.id === r.employeeId);
        return {
          ...r,
          employeeName: emp?.fullName ?? r.employeeName,
          employeeCode: emp?.employeeCode ?? r.employeeCode,
          designation: emp?.designationTitle ?? r.designation,
          department: emp?.department?.name ?? r.department,
          ragBarPercent: Math.min(Number(r.totalKpiScore ?? 0), 100),
        };
      }),
    };
  }

  /** Group-level drill-down: BU → Department → Employee → KPI (FR-SAD-01). */
  async drillDown(user: AuthUser, query: Record<string, string>) {
    const level = query.level ?? 'business_unit';
    const frequency = (query.frequency as Frequency) ?? 'MONTHLY';
    const period = await this.resolvePeriod(query.periodId, query.periodCode, frequency);
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'No period matches the selected filter.');

    if (level === 'business_unit') {
      const bus = await this.prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true } });
      return { level, period, items: bus };
    }

    if (level === 'department') {
      if (!query.businessUnitId) throw Unprocessable(ErrorCode.V_MISSING, 'businessUnitId is required.');
      const depts = await this.prisma.department.findMany({
        where: { businessUnitId: query.businessUnitId, isActive: true },
        select: { id: true, name: true, businessUnitId: true },
      });
      return { level, period, items: depts };
    }

    if (level === 'employee') {
      const where: Prisma.KpiWhereInput = {
        periodId: period.id,
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.businessUnitId ? { businessUnitId: query.businessUnitId } : {}),
        status: { notIn: ['DELETED'] },
        AND: [this.scope.kpiScopeWhere(user)],
      };
      const kpis = await this.prisma.kpi.findMany({
        where,
        select: {
          employeeId: true,
          status: true,
          achievement: true,
          weightedScore: true,
          kpiWeight: true,
          employee: { select: { id: true, fullName: true, employeeCode: true, designationTitle: true } },
        },
        take: 200_000,
      });
      const grouped = new Map<string, typeof kpis>();
      kpis.forEach((k) => {
        const list = grouped.get(k.employeeId) ?? [];
        list.push(k);
        grouped.set(k.employeeId, list);
      });
      const items = Array.from(grouped.values()).map((list) => {
        const approved = list.filter((k) => k.status === 'APPROVED');
        const score = approved.reduce((a, k) => a.plus(new Decimal(k.weightedScore?.toString() ?? 0)), new Decimal(0));
        const num1 = approved.reduce((a, k) => a.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight)), new Decimal(0));
        const den1 = approved.reduce((a, k) => a + k.kpiWeight, 0);
        return {
          employeeId: list[0].employee.id,
          employeeName: list[0].employee.fullName,
          employeeCode: list[0].employee.employeeCode,
          designation: list[0].employee.designationTitle ?? '—',
          totalKpiScore: dec(round2(score)),
          averageAchievement: den1 ? dec(round2(num1.div(den1))) : '0.00',
          approved: approved.length,
          total: list.length,
          allocatedWeight: list.filter((k) => k.status !== 'REJECTED').reduce((a, k) => a + k.kpiWeight, 0),
        };
      });
      items.sort((a, b) => num(b.totalKpiScore) - num(a.totalKpiScore));
      return { level, period, items };
    }

    // KPI level
    const where: Prisma.KpiWhereInput = {
      periodId: period.id,
      status: { notIn: ['DELETED'] },
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.businessUnitId ? { businessUnitId: query.businessUnitId } : {}),
    };
    const kpis = await this.prisma.kpi.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        target: true,
        actual: true,
        achievement: true,
        calculatedScore: true,
        finalScore: true,
        weightedScore: true,
        kpiWeight: true,
        measurementType: true,
        unit: true,
        category: { select: { name: true } },
        employee: { select: { fullName: true, employeeCode: true } },
        department: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take: 5000,
    });
    return {
      level: 'kpi',
      period,
      items: kpis.map((k) => ({
        id: k.id,
        code: k.code,
        name: k.name,
        status: k.status,
        category: k.category.name,
        target: decOrNull(k.target),
        actual: decOrNull(k.actual),
        achievement: decOrNull(k.achievement),
        calculatedScore: decOrNull(k.calculatedScore),
        finalScore: decOrNull(k.finalScore),
        weightedScore: decOrNull(k.weightedScore),
        kpiWeight: k.kpiWeight,
        measurementType: k.measurementType,
        unit: k.unit,
        employeeName: k.employee.fullName,
        employeeCode: k.employee.employeeCode,
        department: k.department?.name ?? '—',
        rag: ((): RagStatus => {
          const v = num(k.achievement);
          return v >= 95 ? 'GREEN' : v >= 75 ? 'AMBER' : 'RED';
        })(),
      })),
    };
  }

  /** Used by the Employee → Performance Summary "previous period" comparison. */
  async previousPeriodScore(employeeId: string, frequency: Frequency, year: number, index: number) {
    const prev = previousPeriodDescriptor(frequency, year, index);
    if (!prev) return null;
    const period = await this.prisma.kpiPeriod.findUnique({
      where: { frequency_startDate: { frequency, startDate: prev.startDate } },
    });
    if (!period) return null;
    const snapshot = await this.prisma.performanceSnapshot.findUnique({
      where: { employeeId_periodId_frequency: { employeeId, periodId: period.id, frequency } },
    });
    return snapshot;
  }
}

const countWeightIncomplete = (rows: Array<{ employeeId: string; kpiWeight: number; status: string }>): number => {
  const perEmployee = new Map<string, number>();
  rows
    .filter((r) => r.status !== 'REJECTED' && r.status !== 'DELETED')
    .forEach((r) => perEmployee.set(r.employeeId, (perEmployee.get(r.employeeId) ?? 0) + r.kpiWeight));
  return Array.from(perEmployee.values()).filter((w) => w !== 100).length;
};
