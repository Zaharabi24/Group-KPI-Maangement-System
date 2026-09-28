/**
 * ============================================================================
 *  PerformanceSummaryPage — route `/performance-summary` (M09, FR-PSM-01..04)
 * ============================================================================
 *  Monthly / Quarterly / Yearly filter, six metric cards, the ten-column KPI
 *  performance records table (AC-15) and the three Total KPI Score bar charts
 *  (12 months · 4 quarters · 5 years) with a dashed 100 reference line
 *  (FR-PSM-04). Periods without data are labelled "No data" instead of being
 *  plotted as 0.
 * ============================================================================
 */
import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import type { ChartPoint, EmployeeDashboard, Frequency } from '@/lib/types';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  ProgressBar,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonCard,
  cn,
} from '@/components/ui';
import { DifferenceIndicator, MetricCard, PageHeader, StatusBadge } from '@/components/ui/badges';
import { usePeriodSelection } from '@/components/layout/PeriodSelector';
import { formatPercent, formatScore } from '@/lib/calculation';
import { formatDate, measured, ragStyle } from '@/lib/format';

const CHART_COLOURS = {
  monthly: '#1F4E79',
  quarterly: '#1A7F86',
  yearly: '#C98A1B',
} as const;

interface ScoreDatum {
  label: string;
  value: number | null;
  hasData: boolean;
  periodId: string | null;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: ScoreDatum }>;
  label?: string | number;
  unitLabel: string;
}

const ChartTooltip: React.FC<ChartTooltipProps> = ({ active, payload, label, unitLabel }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <div className="rounded-control border border-edge bg-surface px-3 py-2 shadow-raised">
      <p className="text-caption font-semibold text-ink">{label}</p>
      <p className="text-caption text-ink-secondary">
        {point?.hasData ? `${unitLabel}: ${formatScore(point.value)}` : 'No data for this period'}
      </p>
    </div>
  );
};

const toData = (points: ChartPoint[] | undefined): ScoreDatum[] =>
  (points ?? []).map((point) => ({
    label: point.label || '—',
    value: point.hasData ? point.value : null,
    hasData: point.hasData,
    periodId: point.periodId,
  }));

const noDataCaption = (points: ChartPoint[] | undefined): string | null => {
  const missing = (points ?? []).filter((point) => !point.hasData).map((point) => point.label || 'unnamed period');
  if (!missing.length) return null;
  return `No data: ${missing.join(', ')}`;
};

const ChartCard: React.FC<{
  title: string;
  subtitle: string;
  colour: string;
  points: ChartPoint[] | undefined;
}> = ({ title, subtitle, colour, points }) => {
  const data = React.useMemo(() => toData(points), [points]);
  const caption = noDataCaption(points);

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E6ECF2" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} height={36} interval="preserveStartEnd" />
            <YAxis domain={[0, 120]} tick={{ fontSize: 11 }} width={36} />
            <RechartsTooltip content={<ChartTooltip unitLabel="Total KPI Score" />} />
            <ReferenceLine y={100} stroke="#B42318" strokeDasharray="4 4" />
            <Bar dataKey="value" fill={colour} radius={[4, 4, 0, 0]} maxBarSize={42} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {caption ? <p className="mt-2 text-caption text-ink-muted">{caption}</p> : null}
    </Card>
  );
};

export const PerformanceSummaryPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const employeeId = searchParams.get('employeeId');
  const { selection, periods, setPeriod, setFrequency } = usePeriodSelection();

  const frequency: Frequency = selection?.frequency ?? 'MONTHLY';
  const periodId = selection?.periodId ?? '';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'employee', frequency, periodId, employeeId],
    queryFn: () =>
      api.get<EmployeeDashboard>('/dashboard/employee', {
        frequency,
        periodId,
        employeeId: employeeId ?? undefined,
      }),
    enabled: Boolean(periodId),
  });

  const visiblePeriods = React.useMemo(
    () => periods.filter((period) => period.frequency === frequency),
    [frequency, periods],
  );

  const metrics = data?.metrics;
  const records = data?.records ?? [];
  const period = data?.period ?? null;

  const ragTone: 'success' | 'warning' | 'danger' =
    metrics?.rag === 'GREEN' ? 'success' : metrics?.rag === 'AMBER' ? 'warning' : 'danger';

  return (
    <div>
      <PageHeader
        title="Performance Summary"
        subtitle={
          period
            ? `${period.label} · ${formatDate(period.startDate)} – ${formatDate(period.endDate)}${employeeId ? ' · viewing another employee' : ''}`
            : 'Your KPI score, achievement and evidence for the selected period'
        }
        actions={
          <Link to="/my-kpi" className="anwar-btn anwar-btn-secondary h-10 px-4 text-body">
            My KPI
          </Link>
        }
      />

      {/* ------------------------------------------------------------- filters */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="anwar-label">Frequency</p>
            <SegmentedControl
              ariaLabel="Frequency"
              value={frequency}
              onChange={(key) => setFrequency(key as Frequency)}
              items={[
                { key: 'MONTHLY', label: 'Monthly' },
                { key: 'QUARTERLY', label: 'Quarterly' },
                { key: 'YEARLY', label: 'Yearly' },
              ]}
            />
          </div>
          <Field label="Period" className="w-full sm:w-[240px]">
            <Select
              value={periodId}
              onChange={(event) => setPeriod(event.target.value)}
              aria-label="Performance period"
            >
              {visiblePeriods.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {option.status === 'CLOSED' ? ' (closed)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {error ? (
        <ErrorState
          message={error instanceof Error ? error.message : 'The performance summary could not be loaded.'}
          onRetry={() => refetch()}
        />
      ) : isLoading && !data ? (
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <SkeletonCard key={index} lines={2} />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </>
      ) : !metrics ? null : (
        <>
          {/* ------------------------------------------------------ metric cards */}
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Total KPI Score"
              value={formatScore(metrics.totalKpiScore)}
              tone={ragTone}
              hint={<span className={cn('font-semibold', ragStyle(metrics.rag).text)}>{metrics.rag === 'GREEN' ? 'Green' : metrics.rag === 'AMBER' ? 'Amber' : 'Red'} · approved KPIs only</span>}
            />
            <MetricCard label="Average Achievement" value={formatPercent(metrics.averageAchievement)} hint="Weighted across approved KPIs" />
            <MetricCard
              label="Previous KPI Score"
              value={metrics.previousScore ? formatScore(metrics.previousScore) : '—'}
              hint={metrics.previousScore ? 'Previous period' : 'No previous period'}
            />
            <MetricCard
              label="Difference vs previous"
              value={<DifferenceIndicator difference={metrics.difference} />}
              hint="Compared with the previous period's snapshot"
            />
            <MetricCard
              label="Approved KPIs"
              value={`${metrics.approvedCount} / ${metrics.totalCount}`}
              hint={metrics.belowTargetCount > 0 ? `${metrics.belowTargetCount} below target` : 'All approved KPIs on or above target'}
              footer={<ProgressBar value={metrics.approvedCount} max={Math.max(1, metrics.totalCount)} height={6} />}
            />
            <MetricCard
              label="Allocated Weight"
              value={`${metrics.allocatedWeight} / 100%`}
              tone={metrics.allocatedWeight >= 100 ? 'success' : 'warning'}
              hint={metrics.allocatedWeight >= 100 ? 'Period weight complete' : 'Weight is still available (W-3)'}
              footer={<ProgressBar value={Math.min(100, metrics.allocatedWeight)} max={100} height={6} tone={metrics.allocatedWeight >= 100 ? 'success' : 'warning'} />}
            />
          </div>

          {/* --------------------------------------------------- records table */}
          <Card className="mb-4" padded={false}>
            <div className="px-4 pt-4 sm:px-6">
              <CardHeader
                title="KPI Performance Records"
                subtitle={`${records.length} KPI${records.length === 1 ? '' : 's'} in ${period?.label ?? 'the selected period'} · the table scrolls horizontally on narrow screens`}
              />
            </div>
            {records.length === 0 ? (
              <EmptyState
                title="No KPI records for this period"
                description="Create your first KPI for the selected period to start recording performance."
                action={
                  <Link to="/my-kpi" className="anwar-btn anwar-btn-primary h-10 px-4 text-body">
                    Create KPI
                  </Link>
                }
              />
            ) : (
              <div className="overflow-x-auto px-4 pb-4 sm:px-6">
                <table className="anwar-table sticky-first-col">
                  <thead>
                    <tr>
                      <th scope="col">KPI</th>
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
                        KPI Weight
                      </th>
                      <th scope="col" className="text-right">
                        Score
                      </th>
                      <th scope="col">Evidence Report</th>
                      <th scope="col">Remarks</th>
                      <th scope="col">KPI Status</th>
                      <th scope="col">Approval Person</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.id}>
                        <td className="min-w-[220px]">
                          <Link to={`/my-kpi/${record.id}`} className="font-semibold text-navy-700 hover:underline">
                            {record.kpi}
                          </Link>
                          <p className="anwar-mono text-caption text-ink-muted">{record.code}</p>
                        </td>
                        <td className="tnum text-right">{measured(record.target, record.measurementType, record.unit)}</td>
                        <td className="tnum text-right">{measured(record.actual, record.measurementType, record.unit)}</td>
                        <td className="tnum text-right">{formatPercent(record.achievement)}</td>
                        <td className="tnum text-right">{record.kpiWeight}%</td>
                        <td className="tnum text-right">
                          {record.displayScore ?? 'Pending'}
                        </td>
                        <td className="min-w-[180px]">
                          {record.evidenceCount === 0 ? (
                            <span className="text-ink-muted">No evidence</span>
                          ) : (
                            <span title={record.evidence.join(', ')}>
                              {record.evidenceCount} file{record.evidenceCount === 1 ? '' : 's'}
                              {record.evidence[0] ? ` · ${record.evidence[0]}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="max-w-[240px] whitespace-pre-line">{record.remarks}</td>
                        <td>
                          <StatusBadge status={record.status} />
                        </td>
                        <td className="min-w-[160px]">{record.approver}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ------------------------------------------------------- bar charts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard
              title="Monthly — Total KPI Score"
              subtitle={`Twelve months of ${period?.year ?? ''}`}
              colour={CHART_COLOURS.monthly}
              points={data?.charts.monthly}
            />
            <ChartCard
              title="Quarterly — Total KPI Score"
              subtitle={`Four quarters of ${period?.year ?? ''}`}
              colour={CHART_COLOURS.quarterly}
              points={data?.charts.quarterly}
            />
            <ChartCard
              title="Yearly — Total KPI Score"
              subtitle="Last five years"
              colour={CHART_COLOURS.yearly}
              points={data?.charts.yearly}
            />
          </div>

          <p className="mt-3 text-caption text-ink-muted">
            Approved KPIs only. The dashed red line marks the 100 target; the score cap is 120 (BRD §4.5).
          </p>
        </>
      )}
    </div>
  );
};

export default PerformanceSummaryPage;
