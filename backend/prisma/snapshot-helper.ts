/**
 * Snapshot helper for the seed — mirrors PerformanceService.generateSnapshots so
 * the seeded closed periods behave exactly like periods closed through the API
 * (BRD §4.9, §4.5).
 */
import { PrismaClient, Frequency, RagStatus } from '@prisma/client';

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const previousPeriod = (
  frequency: Frequency,
  year: number,
  index: number,
): { year: number; index: number } | null => {
  if (frequency === 'MONTHLY') {
    if (index === 1) return year > 1900 ? { year: year - 1, index: 12 } : null;
    return { year, index: index - 1 };
  }
  if (frequency === 'QUARTERLY') {
    if (index === 1) return year > 1900 ? { year: year - 1, index: 4 } : null;
    return { year, index: index - 1 };
  }
  return year > 1900 ? { year: year - 1, index: 1 } : null;
};

const ragFor = (value: number, thresholds: { green: number; amber: number }): RagStatus =>
  value >= thresholds.green ? 'GREEN' : value >= thresholds.amber ? 'AMBER' : 'RED';

export async function generateSnapshots(prisma: PrismaClient, periodId: string): Promise<number> {
  const period = await prisma.kpiPeriod.findUnique({ where: { id: periodId } });
  if (!period) return 0;

  const thresholds = { green: 95, amber: 75 };

  const kpis = await prisma.kpi.findMany({
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
  });

  const byEmployee = new Map<string, typeof kpis>();
  kpis.forEach((k) => {
    const list = byEmployee.get(k.employeeId) ?? [];
    list.push(k);
    byEmployee.set(k.employeeId, list);
  });

  interface Computed {
    employeeId: string;
    totalScore: number;
    ach: number;
    allocated: number;
    approved: number;
    totalCount: number;
    rag: RagStatus;
    departmentId: string | null;
    businessUnitId: string | null;
  }

  const computed: Computed[] = [];

  for (const [employeeId, list] of byEmployee) {
    const approved = list.filter((k) => k.status === 'APPROVED');
    const totalScore = round2(approved.reduce((a, k) => a + Number(k.weightedScore ?? 0), 0));
    const achNum = approved.reduce((a, k) => a + Number(k.achievement ?? 0) * k.kpiWeight, 0);
    const achDen = approved.reduce((a, k) => a + k.kpiWeight, 0);
    const ach = achDen ? round2(achNum / achDen) : 0;
    const allocated = list.filter((k) => k.status !== 'REJECTED').reduce((a, k) => a + k.kpiWeight, 0);

    computed.push({
      employeeId,
      totalScore,
      ach,
      allocated,
      approved: approved.length,
      totalCount: list.filter((k) => k.status !== 'DELETED').length,
      rag: ragFor(totalScore, thresholds),
      departmentId: list[0].departmentId,
      businessUnitId: list[0].businessUnitId,
    });
  }

  computed.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.ach !== a.ach) return b.ach - a.ach;
    return 0;
  });

  const prev = previousPeriod(period.frequency, period.year, period.periodIndex);
  let prevPeriodId: string | null = null;
  if (prev) {
    const p = await prisma.kpiPeriod.findFirst({
      where: { frequency: period.frequency, year: prev.year, periodIndex: prev.index },
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

    let previousScore: number | null = null;
    if (prevPeriodId) {
      const prevSnap = await prisma.performanceSnapshot.findUnique({
        where: { employeeId_periodId_frequency: { employeeId: c.employeeId, periodId: prevPeriodId, frequency: period.frequency } },
        select: { totalKpiScore: true },
      });
      if (prevSnap) previousScore = Number(prevSnap.totalKpiScore);
    }
    const difference = previousScore !== null ? round2(c.totalScore - previousScore) : null;

    await prisma.performanceSnapshot.upsert({
      where: { employeeId_periodId_frequency: { employeeId: c.employeeId, periodId, frequency: period.frequency } },
      create: {
        employeeId: c.employeeId,
        periodId,
        frequency: period.frequency,
        departmentId: c.departmentId,
        businessUnitId: c.businessUnitId,
        totalKpiScore: c.totalScore.toFixed(2),
        averageAchievement: c.ach.toFixed(2),
        allocatedWeight: c.allocated,
        approvedCount: c.approved,
        totalCount: c.totalCount,
        rag: c.rag,
        rank,
        previousScore: previousScore !== null ? previousScore.toFixed(2) : null,
        difference: difference !== null ? difference.toFixed(2) : null,
        payload: { generatedAt: new Date().toISOString(), period: period.code, source: 'seed' },
      },
      update: {
        totalKpiScore: c.totalScore.toFixed(2),
        averageAchievement: c.ach.toFixed(2),
        allocatedWeight: c.allocated,
        approvedCount: c.approved,
        totalCount: c.totalCount,
        rag: c.rag,
        rank,
        previousScore: previousScore !== null ? previousScore.toFixed(2) : null,
        difference: difference !== null ? difference.toFixed(2) : null,
      },
    });
    written += 1;
  }

  return written;
}
