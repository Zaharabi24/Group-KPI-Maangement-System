/**
 * ============================================================================
 *  DepartmentDashboardPage — route `/dashboard` (M10, FR-DHD-01..03, UC-11)
 * ============================================================================
 *  The Department Head console: the metric cards (each opening its filtered
 *  drill-down list), the weight / submission exceptions and the leaderboard.
 * ============================================================================
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  DepartmentDashboard,
  KpiStatus,
  LeaderboardEntry,
  MeasurementType,
  Rag,
} from '@/lib/types';
import {
  Card,
  CardHeader,
  Drawer,
  ErrorState,
  Field,
  Pagination,
  ProgressBar,
  Select,
  Skeleton,
  cn,
} from '@/components/ui';
import { MetricCard, PageHeader, RagBadge, StatusBadge } from '@/components/ui/badges';
import { PeriodSelector, usePeriodSelection } from '@/components/layout/PeriodSelector';
import { formatPercent, formatScore } from '@/lib/format';

// ------------------------------------------------------------- shared pieces

const ragTone = (rag: Rag): 'success' | 'warning' | 'danger' =>
  rag === 'GREEN' ? 'success' : rag === 'AMBER' ? 'warning' : 'danger';

/** Gold / silver / bronze for the top three, navy tint for the rest. */
const rankClass = (rank: number): string =>
  rank === 1
    ? 'bg-[#C99A2E] text-white'
    : rank === 2
      ? 'bg-[#9AA5B1] text-white'
      : rank === 3
        ? 'bg-[#B07B4F] text-white'
        : 'bg-navy-50 text-navy-700';

/**
 * FR-DHD-03 — the ranked leaderboard list. Two columns on desktop, one on
 * mobile, each employee exactly once (the API already de-duplicates and ranks
 * per §4.5). Shared with LeaderboardPage.
 */
export const LeaderboardList: React.FC<{
  entries: LeaderboardEntry[];
  emptyTitle?: string;
  emptyDescription?: string;
}> = ({ entries, emptyTitle = 'No ranked employees yet', emptyDescription = 'A rank appears once at least one KPI is approved.' }) => {
  if (!entries.length) {
    return (
      <div className="py-8 text-center">
        <p className="text-h3 text-navy-900">{emptyTitle}</p>
        <p className="mt-1 text-body text-ink-secondary">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {entries.map((entry) => (
        <li key={entry.employeeId} className="flex items-start gap-3 rounded-control border border-edge p-3">
          <span
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
              rankClass(entry.rank),
            )}
            title={entry.rank <= 3 ? `Top three — rank ${entry.rank}` : `Rank ${entry.rank}`}
            aria-label={`Rank ${entry.rank}`}
          >
            {entry.rank}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="truncate text-body font-semibold text-ink" title={entry.employeeName}>
                {entry.employeeName}
              </p>
              <p className="tnum whitespace-nowrap text-body font-semibold text-navy-900">
                {formatPercent(entry.totalKpiScore)}
              </p>
            </div>
            <p className="truncate text-caption text-ink-secondary">
              {entry.designation} · <span className="anwar-mono">{entry.employeeCode}</span>
              {entry.department ? ` · ${entry.department}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="min-w-[120px] flex-1">
                <ProgressBar
                  value={Math.min(Math.max(entry.ragBarPercent, 0), 100)}
                  max={100}
                  tone={ragTone(entry.rag)}
                  height={6}
                />
              </div>
              <RagBadge rag={entry.rag} />
              <span className="whitespace-nowrap text-caption text-ink-secondary">
                {entry.approvedCount}/{entry.totalCount} approved
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
};

// ------------------------------------------------------------------- drill-down

type DrillKind = 'below_target' | 'pending' | 'approved' | 'rejected' | 'not_submitted' | 'weight_incomplete';

const DRILL_KINDS: Record<DrillKind, { label: string; description: string }> = {
  below_target: { label: 'KPIs below target', description: 'Approved KPIs whose achievement is under 100%.' },
  pending: { label: 'Pending evaluations', description: 'Submitted, Under Review or Escalated KPIs.' },
  approved: { label: 'Approved KPIs', description: 'Every approved KPI of the period.' },
  rejected: { label: 'Rejected KPIs', description: 'Rejected KPIs — the weight was released.' },
  not_submitted: { label: 'Not submitted', description: 'KPIs with no submission for this period.' },
  weight_incomplete: {
    label: 'Weight incomplete',
    description: 'Employees whose allocated weight is not exactly 100%.',
  },
};

interface DrillDownKpiItem {
  id: string;
  code: string;
  name: string;
  status: KpiStatus;
  target: string | null;
  actual: string | null;
  achievement: string | null;
  finalScore: string | null;
  weightedScore: string | null;
  kpiWeight: number;
  measurementType: MeasurementType;
  unit: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  departmentId: string | null;
  businessUnit: string;
  approver: string;
  period: string;
  periodId: string;
  updatedAt: string;
}

interface DrillDownWeightItem {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  businessUnit: string;
  allocatedWeight: number;
}

interface DrillDownResponse<T> {
  kind: string;
  items: T[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

// ---------------------------------------------------------------------- page

export const DepartmentDashboardPage: React.FC = () => {
  const { selection, setFrequency, setPeriod } = usePeriodSelection();
  const [departmentId, setDepartmentId] = React.useState('');
  const [drillKind, setDrillKind] = React.useState<DrillKind | null>(null);
  const [drillPage, setDrillPage] = React.useState(1);
  const [drillSize, setDrillSize] = React.useState(25);

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', 'department', selection?.frequency, selection?.periodId, departmentId],
    queryFn: () =>
      api.get<DepartmentDashboard>('/dashboard/department', {
        frequency: selection?.frequency,
        periodId: selection?.periodId,
        departmentId: departmentId || undefined,
      }),
    enabled: Boolean(selection?.periodId),
    placeholderData: keepPreviousData,
  });

  const data = dashboardQuery.data;
  const cards = data?.cards;
  const departmentOptions = data?.departments ?? [];

  const drillQuery = useQuery({
    queryKey: ['kpis', 'drill-down', drillKind, selection?.periodId, departmentId, drillPage, drillSize],
    queryFn: () =>
      api.get<DrillDownResponse<DrillDownKpiItem | DrillDownWeightItem>>(`/kpis/drill-down/${drillKind}`, {
        periodId: selection?.periodId,
        departmentId: departmentId || undefined,
        page: drillPage,
        size: drillSize,
      }),
    enabled: Boolean(drillKind && selection?.periodId),
    placeholderData: keepPreviousData,
  });

  const openDrill = (kind: DrillKind) => {
    setDrillKind(kind);
    setDrillPage(1);
  };

  // A period that carries no data must not leave a stale drill-down open.
  React.useEffect(() => {
    setDrillPage(1);
  }, [drillKind, departmentId, selection?.periodId]);

  if (dashboardQuery.error) {
    return (
      <div>
        <PageHeader title="Department dashboard" />
        <ErrorState
          message={dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'The dashboard could not be loaded.'}
          onRetry={() => dashboardQuery.refetch()}
        />
      </div>
    );
  }

  const drillItems = drillQuery.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Department dashboard"
        subtitle={
          data
            ? `${data.period.label} · ${data.frequency === 'MONTHLY' ? 'Monthly' : data.frequency === 'QUARTERLY' ? 'Quarterly' : 'Yearly'} · ${departmentOptions.length} department${departmentOptions.length === 1 ? '' : 's'} in scope`
            : 'Loading the selected period…'
        }
        actions={
          <div className="flex flex-wrap items-end gap-2">
            {departmentOptions.length > 1 ? (
              <Field label="Department" htmlFor="dash-department" className="w-[210px]">
                <Select
                  id="dash-department"
                  className="h-9 text-caption"
                  value={departmentId}
                  onChange={(event) => setDepartmentId(event.target.value)}
                >
                  <option value="">All my departments</option>
                  {departmentOptions.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <div className="mb-0.5">
              <PeriodSelector compact />
            </div>
          </div>
        }
      />

      {!selection?.periodId || dashboardQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : data && cards ? (
        <>
          {/* ------------------------------------------------------- metric cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Average achievement"
              value={formatPercent(cards.averageAchievement)}
              tone={Number(cards.averageAchievement) >= 100 ? 'success' : 'warning'}
              hint="Weighted across the approved KPIs · opens the approved list"
              footer={
                <ProgressBar
                  value={Math.min(Math.max(cards.averageAchievementValue, 0), 100)}
                  max={100}
                  height={6}
                  tone={cards.averageAchievementValue >= 100 ? 'success' : 'warning'}
                  label={`Average achievement ${formatPercent(cards.averageAchievement)}`}
                />
              }
              onClick={() => openDrill('approved')}
            />

            <MetricCard
              label="Pending evaluations"
              value={cards.pendingEvaluations}
              tone={cards.pendingEvaluations > 0 ? 'warning' : 'default'}
              hint={`Oldest pending: ${cards.oldestPendingAgeDays} working day${cards.oldestPendingAgeDays === 1 ? '' : 's'}${
                cards.slaBreaches > 0 ? ` · ${cards.slaBreaches} escalated` : ''
              }`}
              onClick={() => openDrill('pending')}
            />

            <MetricCard
              label="Total approved KPI"
              value={cards.totalApproved}
              tone="success"
              hint={`${cards.totalKpis} KPI${cards.totalKpis === 1 ? '' : 's'} in the period`}
              onClick={() => openDrill('approved')}
            />

            <MetricCard
              label="Rejected KPI"
              value={cards.rejected}
              tone={cards.rejected > 0 ? 'danger' : 'default'}
              hint="Weight released back to the period"
              onClick={() => openDrill('rejected')}
            />

            <MetricCard
              label="KPI below target"
              value={cards.belowTarget}
              tone={cards.belowTarget > 0 ? 'warning' : 'default'}
              hint="Approved KPIs with achievement under 100%"
              onClick={() => openDrill('below_target')}
            />

            <MetricCard
              label="Weight incomplete"
              value={cards.weightIncomplete}
              tone={cards.weightIncomplete > 0 ? 'warning' : 'success'}
              hint="Employees whose allocated weight is not 100%"
              onClick={() => openDrill('weight_incomplete')}
            />

            <MetricCard
              label="Not submitted"
              value={cards.notSubmitted}
              tone={cards.notSubmitted > 0 ? 'warning' : 'default'}
              hint="KPIs with no submission for this period"
              onClick={() => openDrill('not_submitted')}
            />

            <MetricCard
              label="SLA breaches"
              value={cards.slaBreaches}
              tone={cards.slaBreaches > 0 ? 'danger' : 'success'}
              hint="Escalated adjustments waiting for a Super Admin"
              onClick={() => openDrill('pending')}
            />
          </div>

          {/* --------------------------------------------------------- leaderboard */}
          <Card className="mt-4">
            <CardHeader
              title="Leaderboard"
              subtitle="Ranked by Total KPI Score (§4.5) — each employee appears once, approved KPIs only."
              actions={
                <Link to="/leaderboard" className="anwar-btn anwar-btn-secondary anwar-btn-sm h-9 px-3">
                  Full leaderboard
                </Link>
              }
            />
            <LeaderboardList entries={data.leaderboard} />
            <p className="mt-3 text-caption text-ink-muted">
              The RAG bar uses the Total KPI Score against the configured thresholds (green ≥ {data.thresholds.green},
              amber ≥ {data.thresholds.amber}).
            </p>
          </Card>
        </>
      ) : null}

      {/* ---------------------------------------------------------- drill-down */}
      <Drawer
        open={drillKind !== null}
        onClose={() => setDrillKind(null)}
        width="lg"
        title={drillKind ? DRILL_KINDS[drillKind].label : 'Drill-down'}
        subtitle={
          drillKind
            ? `${DRILL_KINDS[drillKind].description} ${data ? `· ${data.period.label}` : ''}`
            : undefined
        }
      >
        {drillQuery.error ? (
          <ErrorState
            message={drillQuery.error instanceof Error ? drillQuery.error.message : 'The list could not be loaded.'}
            onRetry={() => drillQuery.refetch()}
          />
        ) : drillQuery.isLoading || (drillQuery.data !== undefined && drillQuery.data.kind !== drillKind) ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : drillKind === 'weight_incomplete' ? (
          <div className="overflow-x-auto">
            <table className="anwar-table sticky-first-col">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Employee ID</th>
                  <th scope="col">Department</th>
                  <th scope="col" className="text-right">
                    Allocated weight
                  </th>
                </tr>
              </thead>
              <tbody>
                {(drillItems as DrillDownWeightItem[]).map((item) => (
                  <tr key={item.employeeId}>
                    <td className="min-w-[180px]">
                      <p className="font-semibold text-ink">{item.employeeName}</p>
                      <p className="text-caption text-ink-muted">{item.designation}</p>
                    </td>
                    <td className="anwar-mono">{item.employeeCode}</td>
                    <td>{item.department}</td>
                    <td className="tnum text-right font-semibold">{item.allocatedWeight}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="anwar-table sticky-first-col">
              <thead>
                <tr>
                  <th scope="col">KPI</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Department</th>
                  <th scope="col" className="text-right">
                    Target
                  </th>
                  <th scope="col" className="text-right">
                    Actual
                  </th>
                  <th scope="col" className="text-right">
                    Achievement
                  </th>
                  <th scope="col" className="text-right">
                    Weight
                  </th>
                  <th scope="col" className="text-right">
                    Score
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {(drillItems as DrillDownKpiItem[]).map((item) => (
                  <tr key={item.id}>
                    <td className="min-w-[200px]">
                      <Link to={`/my-kpi/${item.id}`} className="font-semibold text-navy-700 hover:underline">
                        {item.name}
                      </Link>
                      <p className="anwar-mono text-caption text-ink-muted">{item.code}</p>
                    </td>
                    <td className="min-w-[160px]">
                      <p className="font-semibold text-ink">{item.employeeName}</p>
                      <p className="anwar-mono text-caption text-ink-muted">{item.employeeCode}</p>
                    </td>
                    <td className="min-w-[140px]">{item.department}</td>
                    <td className="anwar-mono whitespace-nowrap text-right">
                      {item.target ?? '—'}
                      {item.unit ? ` ${item.unit}` : ''}
                    </td>
                    <td className="anwar-mono whitespace-nowrap text-right">
                      {item.actual ?? '—'}
                      {item.unit ? ` ${item.unit}` : ''}
                    </td>
                    <td className="anwar-mono whitespace-nowrap text-right">{formatPercent(item.achievement)}</td>
                    <td className="tnum whitespace-nowrap text-right">{item.kpiWeight}%</td>
                    <td className="anwar-mono whitespace-nowrap text-right">
                      {formatScore(item.finalScore ?? item.weightedScore)}
                    </td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {drillQuery.data ? (
          <Pagination
            page={drillQuery.data.page}
            size={drillQuery.data.size}
            total={drillQuery.data.total}
            totalPages={drillQuery.data.totalPages}
            onPage={setDrillPage}
            onSize={(next) => {
              setDrillSize(next);
              setDrillPage(1);
            }}
            className="border-t border-edge"
          />
        ) : null}
      </Drawer>
    </div>
  );
};

export default DepartmentDashboardPage;
