/**
 * Period aggregates, dashboard metrics and snapshots — BRD §4.5, §4.9.
 *
 * S is the set of the employee's Approved KPIs in the selected period.
 *   Total KPI Score       Σ WS over S                      (official period score)
 *   Average Achievement   Σ(ACH × W) ÷ Σ W over S          (weighted, uncapped)
 *   Allocated Weight      Σ W, excluding Rejected/Deleted  (shown as x / 100%)
 *   Approved KPIs         count(S) / count(all except Deleted)
 *   Previous KPI Score    Total KPI Score of the preceding period
 *   RAG                   Green ≥ 95 · Amber 75–94.99 · Red < 75
 */
import { Injectable } from '@nestjs/common';
import { Prisma, Frequency, RagStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { ScopeService } from '../../common/scope/scope.service';
import { Decimal, dec, num, round2 } from '../../common/utils/decimal.util';
import { aggregatePeriod, ragFor } from '../calculation/calculation.engine';
import { previousPeriodDescriptor } from '../../common/utils/period.util';

export interface EmployeePeriodMetrics {
  periodId: string;
  periodCode: string;
  periodLabel: string;
  frequency: Frequency;
  employeeId: string;
  totalKpiScore: string;
  averageAchievement: string;
  allocatedWeight: number;
  approvedCount: number;
  totalCount: number;
  belowTargetCount: number;
  rag: RagStatus;
  previousScore: string | null;
  difference: string | null;
  differenceLabel: string;
  rank: number | null;
}

export interface RagThresholds {
  green: number;
  amber: number;
}

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async ragThresholds(): Promise<RagThresholds> {
    const config = await this.prisma.configurationVersion.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
      select: { ragThresholds: true },
    });
    const raw = (config?.ragThresholds ?? { green: 95, amber: 75 }) as Record<string, number>;
    return { green: raw.green ?? 95, amber: raw.amber ?? 75 };
  }

  /** Aggregates one employee's KPIs for one period. */
  async employeePeriod(employeeId: string, periodId: string): Promise<EmployeePeriodMetrics> {
    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new Error(`Period ${periodId} not found`);

    const kpis = await this.prisma.kpi.findMany({
      where: { employeeId, periodId },
      select: {
        status: true,
        achievement: true,
        finalScore: true,
        weightedScore: true,
        kpiWeight: true,
      },
    });

    const thresholds = await this.ragThresholds();
    const agg = aggregatePeriod(
      kpis.map((k) => ({
        achievement: k.achievement,
        finalScore: k.finalScore,
        weightedScore: k.weightedScore,
        kpiWeight: k.kpiWeight,
        status: k.status,
      })),
      thresholds,
    );

    const previous = previousPeriodDescriptor(period.frequency, period.year, period.periodIndex);
    let previousScore: Decimal | null = null;
    if (previous) {
      const prevPeriod = await this.prisma.kpiPeriod.findUnique({
        where: { frequency_startDate: { frequency: period.frequency, startDate: previous.startDate } },
        select: { id: true },
      });
      if (prevPeriod) {
        const snapshot = await this.prisma.performanceSnapshot.findUnique({
          where: { employeeId_periodId_frequency: { employeeId, periodId: prevPeriod.id, frequency: period.frequency } },
          select: { totalKpiScore: true },
        });
        if (snapshot) {
          previousScore = new Decimal(snapshot.totalKpiScore.toString());
        } else {
          const prevAgg = await this.aggregateLive(employeeId, prevPeriod.id, thresholds);
          previousScore = prevAgg.totalKpiScore;
        }
      }
    }

    const difference = previousScore ? round2(agg.totalKpiScore.minus(previousScore)) : null;

    return {
      periodId,
      periodCode: period.code,
      periodLabel: period.label,
      frequency: period.frequency,
      employeeId,
      totalKpiScore: dec(agg.totalKpiScore)!,
      averageAchievement: dec(agg.averageAchievement)!,
      allocatedWeight: agg.allocatedWeight,
      approvedCount: agg.approvedCount,
      totalCount: agg.totalCount,
      belowTargetCount: agg.belowTargetCount,
      rag: agg.rag as RagStatus,
      previousScore: previousScore ? dec(previousScore) : null,
      difference: difference ? dec(difference) : null,
      differenceLabel: this.differenceLabel(difference),
      rank: null,
    };
  }

  differenceLabel(difference: Decimal | null): string {
    if (!difference) return 'No previous period';
    if (difference.eq(0)) return 'No change';
    const arrow = difference.gt(0) ? '▲' : '▼';
    const word = difference.gt(0) ? 'above' : 'below';
    return `${arrow} ${Math.abs(Number(difference.toFixed(2))).toFixed(2)} ${word} previous period`;
  }

  private async aggregateLive(employeeId: string, periodId: string, thresholds: RagThresholds) {
    const kpis = await this.prisma.kpi.findMany({
      where: { employeeId, periodId },
      select: { status: true, achievement: true, finalScore: true, weightedScore: true, kpiWeight: true },
    });
    return aggregatePeriod(kpis, thresholds);
  }

  /** Ranked leaderboard — §4.5 (order by Total KPI Score desc, then Average Achievement desc; ties share a rank). */
  async leaderboard(
    user: AuthUser,
    periodId: string,
    departmentId?: string,
    limit = 100,
  ): Promise<unknown[]> {
    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) return [];

    const where: Prisma.KpiWhereInput = { periodId, status: { notIn: ['DELETED'] } };
    if (departmentId) where.departmentId = departmentId;
    const scopeWhere = this.scope.kpiScopeWhere(user);
    const finalWhere: Prisma.KpiWhereInput = scopeWhere.OR ? { AND: [scopeWhere, where] } : where;

    const kpis = await this.prisma.kpi.findMany({
      where: finalWhere,
      select: {
        employeeId: true,
        status: true,
        achievement: true,
        finalScore: true,
        weightedScore: true,
        kpiWeight: true,
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            designationTitle: true,
            status: true,
            department: { select: { id: true, name: true } },
          },
        },
      },
      take: 20_000,
    });

    const byEmployee = new Map<string, typeof kpis>();
    kpis.forEach((k) => {
      const list = byEmployee.get(k.employeeId) ?? [];
      list.push(k);
      byEmployee.set(k.employeeId, list);
    });

    const thresholds = await this.ragThresholds();
    const entries = Array.from(byEmployee.values()).map((list) => {
      const agg = aggregatePeriod(list, thresholds);
      return {
        employeeId: list[0].employee.id,
        employeeName: list[0].employee.fullName,
        employeeCode: list[0].employee.employeeCode,
        designation: list[0].employee.designationTitle ?? '—',
        department: list[0].employee.department?.name ?? '—',
        departmentId: list[0].employee.department?.id ?? null,
        totalKpiScore: num(agg.totalKpiScore),
        averageAchievement: num(agg.averageAchievement),
        approvedCount: agg.approvedCount,
        totalCount: agg.totalCount,
        allocatedWeight: agg.allocatedWeight,
        rag: agg.rag,
        score: dec(agg.totalKpiScore),
        averageAchievementDisplay: dec(agg.averageAchievement),
      };
    });

    entries.sort((a, b) => {
      if (b.totalKpiScore !== a.totalKpiScore) return b.totalKpiScore - a.totalKpiScore;
      if (b.averageAchievement !== a.averageAchievement) return b.averageAchievement - a.averageAchievement;
      return a.employeeName.localeCompare(b.employeeName);
    });

    // Ties share a rank: 1, 2, 2, 4
    let rank = 0;
    let lastScore: number | null = null;
    let lastAch: number | null = null;
    const ranked = entries.map((e, index) => {
      if (lastScore === null || e.totalKpiScore !== lastScore || e.averageAchievement !== lastAch) {
        rank = index + 1;
        lastScore = e.totalKpiScore;
        lastAch = e.averageAchievement;
      }
      return { ...e, rank };
    });

    return ranked.slice(0, limit);
  }

  /** Employee dashboard payload — §4.5 + the 10-column records list + chart series. */
  async employeeDashboard(user: AuthUser, periodId: string, employeeId?: string) {
    const target = employeeId && this.scope.isGroupScoped(user) ? employeeId : user.id;
    const metrics = await this.employeePeriod(target, periodId);
    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });

    const kpis = await this.prisma.kpi.findMany({
      where: { employeeId: target, periodId, status: { not: 'DELETED' } },
      include: {
        category: { select: { code: true, name: true } },
        approver: { select: { fullName: true } },
        period: { select: { label: true } },
        evidence: { where: { isCurrent: true }, select: { id: true, originalName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const records = kpis.map((k) => ({
      id: k.id,
      code: k.code,
      kpi: k.name,
      category: k.category.name,
      target: k.target ? dec(k.target) : null,
      actual: k.actual ? dec(k.actual) : null,
      achievement: k.achievement ? dec(k.achievement) : null,
      kpiWeight: k.kpiWeight,
      score: k.status === 'APPROVED' ? dec(k.finalScore) : k.finalScore ? dec(k.finalScore) : null,
      displayScore: k.status === 'APPROVED' ? dec(k.finalScore) : 'Pending',
      weightedScore: k.weightedScore ? dec(k.weightedScore) : null,
      evidence: k.evidence.map((e) => e.originalName),
      evidenceCount: k.evidenceCount,
      remarks: k.remarks ?? '—',
      status: k.status,
      approver: k.approver?.fullName ?? 'Super Admin',
      measurementType: k.measurementType,
      unit: k.unit,
      direction: k.direction,
    }));

    const charts = await this.chartSeries(target, period?.frequency ?? 'MONTHLY', period?.year ?? new Date().getFullYear());

    return { metrics, records, charts, period };
  }

  /** Monthly ×12 / Quarterly ×4 / Yearly ×5 series with `has_data` flags (§4.5, FR-PSM-04). */
  async chartSeries(employeeId: string, frequency: Frequency, year: number) {
    const monthly = await this.seriesFor(employeeId, 'MONTHLY', year, 12);
    const quarterly = await this.seriesFor(employeeId, 'QUARTERLY', year, 4);
    const yearly = await this.seriesFor(employeeId, 'YEARLY', year, 5, true);
    return { monthly, quarterly, yearly, frequency };
  }

  private async seriesFor(
    employeeId: string,
    frequency: Frequency,
    year: number,
    count: number,
    backFromYear = false,
  ) {
    const periods = await this.prisma.kpiPeriod.findMany({
      where: backFromYear ? { frequency, year: { lte: year, gt: year - 5 } } : { frequency, year },
      orderBy: { startDate: 'asc' },
    });
    const thresholds = await this.ragThresholds();

    const out: Array<{ label: string; periodId: string | null; value: number | null; hasData: boolean; target: number }> = [];
    for (let i = 0; i < count; i += 1) {
      const period = periods[i];
      if (!period) {
        out.push({ label: '', periodId: null, value: null, hasData: false, target: 100 });
        continue;
      }
      const snapshot = await this.prisma.performanceSnapshot.findUnique({
        where: { employeeId_periodId_frequency: { employeeId, periodId: period.id, frequency } },
        select: { totalKpiScore: true },
      });
      const agg = snapshot
        ? { totalKpiScore: new Decimal(snapshot.totalKpiScore.toString()), approvedCount: 1 }
        : await this.aggregateLive(employeeId, period.id, thresholds);

      const hasData = snapshot ? true : agg.approvedCount > 0;
      out.push({
        label: period.label,
        periodId: period.id,
        value: hasData ? Number(agg.totalKpiScore.toFixed(2)) : null,
        hasData,
        target: 100,
      });
    }

    return out.map((o) => ({ ...o, value: o.value }));
  }

  /**
   * Period snapshot generation — §4.9, FR-CFG-03. Called when a period closes and
   * idempotently re-runnable; snapshots are what reports read for closed periods.
   */
  async generateSnapshots(periodId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? this.prisma;
    const period = await client.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) return 0;

    const thresholds = await this.ragThresholds();

    const kpis = await client.kpi.findMany({
      where: { periodId, status: { notIn: ['DELETED'] } },
      select: {
        employeeId: true,
        status: true,
        achievement: true,
        finalScore: true,
        weightedScore: true,
        kpiWeight: true,
        departmentId: true,
        businessUnitId: true,
      },
      take: 500_000,
    });

    const byEmployee = new Map<string, typeof kpis>();
    kpis.forEach((k) => {
      const list = byEmployee.get(k.employeeId) ?? [];
      list.push(k);
      byEmployee.set(k.employeeId, list);
    });

    const computed: Array<{
      employeeId: string;
      totalScore: Decimal;
      ach: Decimal;
      allocated: number;
      approved: number;
      totalCount: number;
      rag: RagStatus;
      departmentId: string | null;
      businessUnitId: string | null;
    }> = [];

    for (const [employeeId, list] of byEmployee) {
      const agg = aggregatePeriod(list, thresholds);
      computed.push({
        employeeId,
        totalScore: agg.totalKpiScore,
        ach: agg.averageAchievement,
        allocated: agg.allocatedWeight,
        approved: agg.approvedCount,
        totalCount: agg.totalCount,
        rag: agg.rag as RagStatus,
        departmentId: list[0].departmentId,
        businessUnitId: list[0].businessUnitId,
      });
    }

    computed.sort((a, b) => {
      const t = b.totalScore.minus(a.totalScore);
      if (!t.eq(0)) return t.gt(0) ? 1 : -1;
      const a2 = b.ach.minus(a.ach);
      if (!a2.eq(0)) return a2.gt(0) ? 1 : -1;
      return 0;
    });

    const previous = previousPeriodDescriptor(period.frequency, period.year, period.periodIndex);
    let prevPeriodId: string | null = null;
    if (previous) {
      const p = await client.kpiPeriod.findUnique({
        where: { frequency_startDate: { frequency: period.frequency, startDate: previous.startDate } },
        select: { id: true },
      });
      prevPeriodId = p?.id ?? null;
    }

    let rank = 0;
    let lastKey = '';
    let written = 0;

    for (let i = 0; i < computed.length; i += 1) {
      const c = computed[i];
      const key = `${c.totalScore.toFixed(2)}|${c.ach.toFixed(2)}`;
      if (key !== lastKey) {
        rank = i + 1;
        lastKey = key;
      }

      let previousScore: Decimal | null = null;
      if (prevPeriodId) {
        const prevSnap = await client.performanceSnapshot.findUnique({
          where: { employeeId_periodId_frequency: { employeeId: c.employeeId, periodId: prevPeriodId, frequency: period.frequency } },
          select: { totalKpiScore: true },
        });
        if (prevSnap) previousScore = new Decimal(prevSnap.totalKpiScore.toString());
      }
      const difference = previousScore ? round2(c.totalScore.minus(previousScore)) : null;

      await client.performanceSnapshot.upsert({
        where: { employeeId_periodId_frequency: { employeeId: c.employeeId, periodId, frequency: period.frequency } },
        create: {
          employeeId: c.employeeId,
          periodId,
          frequency: period.frequency,
          departmentId: c.departmentId,
          businessUnitId: c.businessUnitId,
          totalKpiScore: c.totalScore.toString(),
          averageAchievement: c.ach.toString(),
          allocatedWeight: c.allocated,
          approvedCount: c.approved,
          totalCount: c.totalCount,
          rag: c.rag,
          rank,
          previousScore: previousScore?.toString() ?? null,
          difference: difference?.toString() ?? null,
          payload: {
            generatedAt: new Date().toISOString(),
            period: period.code,
          } as Prisma.InputJsonValue,
        },
        update: {
          totalKpiScore: c.totalScore.toString(),
          averageAchievement: c.ach.toString(),
          allocatedWeight: c.allocated,
          approvedCount: c.approved,
          totalCount: c.totalCount,
          rag: c.rag,
          rank,
          previousScore: previousScore?.toString() ?? null,
          difference: difference?.toString() ?? null,
        },
      });
      written += 1;
    }

    return written;
  }
}
