/**
 * ============================================================================
 *  GroupDashboardPage — route `/group-dashboard` (M11, FR-SAD-01/02, US-19)
 * ============================================================================
 *  The group-wide view: headline metrics, the Business Unit comparison chart and
 *  table, the department heat table, the escalations widget and an interactive
 *  BU → Department → Employee → KPI drill-down with a client-side CSV export.
 * ============================================================================
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, saveBlob } from '@/lib/api';
import type {
  GroupDashboard,
  KpiPeriodSummary,
  KpiStatus,
  MeasurementType,
  Rag,
} from '@/lib/types';
import { Button, Card, CardHeader, ErrorState, ProgressBar, Skeleton, cn } from '@/components/ui';
import { Alert, MetricCard, PageHeader, RagBadge, StatusBadge } from '@/components/ui/badges';
import { PeriodSelector, usePeriodSelection } from '@/components/layout/PeriodSelector';
import { useToast } from '@/context/ToastContext';
import { formatPercent, formatScore, ragFromScore, ragStyle } from '@/lib/format';

// ------------------------------------------------------------------ constants

const BU_COLOUR = '#1F4E79';
const REFERENCE_COLOUR = '#B42318';

type DrillLevel = 'business_unit' | 'department' | 'employee' | 'kpi';

interface DrillBuItem {
  id: string;
  name: string;
  code: string;
}

interface DrillDeptItem {
  id: string;
  name: string;
  businessUnitId: string;
}

interface DrillEmployeeItem {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  totalKpiScore: string;
  averageAchievement: string;
  approved: number;
  total: number;
  allocatedWeight: number;
}

interface DrillKpiItem {
  id: string;
  code: string;
  name: string;
  status: KpiStatus;
  category: string;
  target: string | null;
  actual: string | null;
  achievement: string | null;
  calculatedScore: string | null;
  finalScore: string | null;
  weightedScore: string | null;
  kpiWeight: number;
  measurementType: MeasurementType;
  unit: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  rag: Rag;
}

type DrillItem = DrillBuItem | DrillDeptItem | DrillEmployeeItem | DrillKpiItem;

interface DrillDownResponse {
  level: string;
  period: KpiPeriodSummary;
  items: DrillItem[];
}

const csvCell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;

const toCsv = (headers: string[], rows: unknown[][]): string =>
  [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

const achievementTint = (value: string | number): string => {
  const rag = ragFromScore(value);
  const style = ragStyle(rag);
  return cn(style.bg, style.text);
};

// ---------------------------------------------------------------------- page

export const GroupDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { selection } = usePeriodSelection();

  const [businessUnit, setBusinessUnit] = React.useState<{ id: string; name: string } | null>(null);
  const [department, setDepartment] = React.useState<{ id: string; name: string } | null>(null);
  const [employee, setEmployee] = React.useState<{ id: string; name: string } | null>(null);
  const [level, setLevel] = React.useState<DrillLevel>('business_unit');

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', 'group', selection?.frequency, selection?.periodId, businessUnit?.id, department?.id],
    queryFn: () =>
      api.get<GroupDashboard>('/dashboard/group', {
        frequency: selection?.frequency,
        periodId: selection?.periodId,
        businessUnitId: businessUnit?.id,
        departmentId: department?.id,
      }),
    enabled: Boolean(selection?.periodId),
    placeholderData: keepPreviousData,
  });

  const data = dashboardQuery.data;

  const drillQuery = useQuery({
    queryKey: [
      'dashboard',
      'group',
      'drill-down',
      level,
      selection?.frequency,
      selection?.periodId,
      businessUnit?.id,
      department?.id,
      employee?.id,
    ],
    queryFn: () =>
      api.get<DrillDownResponse>('/dashboard/drill-down', {
        level,
        frequency: selection?.frequency,
        periodId: selection?.periodId,
        businessUnitId: businessUnit?.id,
        departmentId: department?.id,
        employeeId: employee?.id,
      }),
    enabled: Boolean(selection?.periodId),
    placeholderData: keepPreviousData,
  });

  const drillItems = drillQuery.data?.items ?? [];

  // ---------------------------------------------------------------- breadcrumb

  const goToLevel = (next: DrillLevel) => {
    if (next === 'business_unit') {
      setBusinessUnit(null);
      setDepartment(null);
      setEmployee(null);
    }
    if (next === 'department') {
      setDepartment(null);
      setEmployee(null);
    }
    if (next === 'employee') {
      setEmployee(null);
    }
    setLevel(next);
  };

  const exportCurrentLevel = () => {
    if (!drillItems.length) return;
    let headers: string[] = [];
    let rows: unknown[][] = [];

    if (level === 'business_unit') {
      headers = ['Business Unit', 'Code'];
      rows = (drillItems as DrillBuItem[]).map((item) => [item.name, item.code]);
    } else if (level === 'department') {
      headers = ['Department', 'Business Unit ID'];
      rows = (drillItems as DrillDeptItem[]).map((item) => [item.name, item.businessUnitId]);
    } else if (level === 'employee') {
      headers = ['Employee', 'Employee ID', 'Designation', 'Total KPI Score %', 'Average Achievement %', 'Approved', 'Total KPIs', 'Allocated Weight %'];
      rows = (drillItems as DrillEmployeeItem[]).map((item) => [
        item.employeeName,
        item.employeeCode,
        item.designation,
        item.totalKpiScore,
        item.averageAchievement,
        item.approved,
        item.total,
        item.allocatedWeight,
      ]);
    } else {
      headers = ['KPI', 'KPI Code', 'Employee', 'Employee ID', 'Department', 'Category', 'Target', 'Actual', 'Achievement %', 'Weight %', 'Final Score', 'Status'];
      rows = (drillItems as DrillKpiItem[]).map((item) => [
        item.name,
        item.code,
        item.employeeName,
        item.employeeCode,
        item.department,
        item.category,
        item.target,
        item.actual,
        item.achievement,
        item.kpiWeight,
        item.finalScore ?? item.weightedScore,
        item.status,
      ]);
    }

    const csv = toCsv(headers, rows);
    saveBlob(
      new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }),
      `group-drilldown-${level}-${selection?.periodCode ?? 'period'}.csv`,
    );
    toast.success('CSV downloaded', `${rows.length} row${rows.length === 1 ? '' : 's'} exported from the ${level.replace('_', ' ')} level.`);
  };

  // ---------------------------------------------------------------- headline

  const headline = data?.headline;

  const chartRows = React.useMemo(
    () =>
      (data?.businessUnits ?? []).map((unit) => ({
        name: unit.name,
        achievement: Number(unit.averageAchievement),
      })),
    [data],
  );

  if (dashboardQuery.error) {
    return (
      <div>
        <PageHeader title="Group dashboard" />
        <ErrorState
          message={dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'The group dashboard could not be loaded.'}
          onRetry={() => dashboardQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Group dashboard"
        subtitle={
          data
            ? `${data.period.label} · group-wide KPIs, Business Unit comparison and drill-down (FR-SAD-01)`
            : 'Group-wide KPIs, Business Unit comparison and drill-down (FR-SAD-01)'
        }
        actions={<PeriodSelector compact />}
      />

      {!selection?.periodId || dashboardQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : data && headline ? (
        <>
          {/* ------------------------------------------------------- headline */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Group average achievement"
              value={formatPercent(headline.groupAverageAchievement)}
              tone={Number(headline.groupAverageAchievement) >= 100 ? 'success' : 'warning'}
              hint="Weighted across every approved KPI"
              footer={
                <ProgressBar
                  value={Math.min(Math.max(Number(headline.groupAverageAchievement), 0), 100)}
                  max={100}
                  height={6}
                  tone={Number(headline.groupAverageAchievement) >= 100 ? 'success' : 'warning'}
                  label={`Average achievement ${formatPercent(headline.groupAverageAchievement)}`}
                />
              }
            />
            <MetricCard
              label="Group average total score"
              value={formatScore(headline.groupAverageTotalScore)}
              hint="Average Total KPI Score across participating employees"
            />
            <MetricCard label="Total KPIs" value={headline.totalKpis} hint="Excluding soft-deleted KPIs" />
            <MetricCard label="Approved" value={headline.approved} tone="success" hint="Final scores frozen in a version" />
            <MetricCard
              label="Pending"
              value={headline.pending}
              tone={headline.pending > 0 ? 'warning' : 'default'}
              hint="Submitted, Under Review or Escalated"
            />
            <MetricCard label="Rejected" value={headline.rejected} tone={headline.rejected > 0 ? 'danger' : 'default'} hint="Weight released" />
            <MetricCard label="Not submitted" value={headline.notSubmitted} hint="No submission for this period" />
            <MetricCard
              label="SLA compliance"
              value={formatPercent(headline.slaCompliance)}
              tone={Number(headline.slaCompliance) >= 95 ? 'success' : 'warning'}
              hint="Reviews decided within 5 working days"
            />
            <MetricCard
              label="SLA breaches"
              value={headline.slaBreaches}
              tone={headline.slaBreaches > 0 ? 'danger' : 'success'}
              hint="Decided after more than 5 working days"
            />
            <MetricCard
              label="Participating employees"
              value={headline.participatingEmployees}
              hint="At least one approved KPI in the period"
            />
            <MetricCard
              label="Open escalations"
              value={headline.openEscalations}
              tone={headline.openEscalations > 0 ? 'warning' : 'success'}
              hint="Decided by a Super Admin — open the escalations queue"
              onClick={() => navigate('/escalations')}
            />
            <MetricCard
              label="Weight incomplete"
              value={headline.weightIncomplete}
              tone={headline.weightIncomplete > 0 ? 'warning' : 'success'}
              hint="Employees whose allocated weight is not 100%"
            />
          </div>

          {/* --------------------------------------------- BU comparison chart */}
          <Card className="mt-4">
            <CardHeader
              title="Business Unit comparison"
              subtitle="Average achievement per Business Unit · the dashed line marks 100% and the score cap is 120%."
            />
            {data.businessUnits.length === 0 ? (
              <p className="text-caption text-ink-secondary">No approved KPI is recorded for this period.</p>
            ) : (
              <div className="w-full" style={{ height: Math.max(240, data.businessUnits.length * 48) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartRows} layout="vertical" margin={{ top: 8, right: 32, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E6ECF2" horizontal={false} />
                    <XAxis type="number" domain={[0, 120]} tick={{ fontSize: 12 }} tickFormatter={(value: number) => `${value}%`} />
                    <YAxis type="category" dataKey="name" width={190} tick={{ fontSize: 12 }} />
                    <ChartTooltip
                      formatter={(value: number | string) => [`${Number(value).toFixed(2)}%`, 'Average achievement']}
                    />
                    <ReferenceLine x={100} stroke={REFERENCE_COLOUR} strokeDasharray="6 4" />
                    <Bar dataKey="achievement" fill={BU_COLOUR} radius={[0, 4, 4, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* --------------------------------------------- BU comparison table */}
          <Card className="mt-4">
            <CardHeader title="Business Unit table" subtitle="The same numbers, plus pending, rejected and weight-incomplete counts." />
            <div className="overflow-x-auto">
              <table className="anwar-table sticky-first-col">
                <thead>
                  <tr>
                    <th scope="col">Business Unit</th>
                    <th scope="col" className="text-right">
                      Average achievement
                    </th>
                    <th scope="col" className="text-right">
                      Average total score
                    </th>
                    <th scope="col" className="text-right">
                      Approved
                    </th>
                    <th scope="col" className="text-right">
                      Pending
                    </th>
                    <th scope="col" className="text-right">
                      Rejected
                    </th>
                    <th scope="col" className="text-right">
                      Below target
                    </th>
                    <th scope="col" className="text-right">
                      Weight incomplete
                    </th>
                    <th scope="col" className="text-right">
                      Headcount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.businessUnits.map((unit) => (
                    <tr key={unit.id}>
                      <td className="min-w-[200px]">
                        <button
                          type="button"
                          className="text-left font-semibold text-navy-700 hover:underline"
                          onClick={() => {
                            setBusinessUnit({ id: unit.id, name: unit.name });
                            setDepartment(null);
                            setEmployee(null);
                            setLevel('department');
                          }}
                        >
                          {unit.name}
                        </button>
                        <p className="anwar-mono text-caption text-ink-muted">
                          {unit.code}
                          {unit.division ? ` · ${unit.division}` : ''}
                        </p>
                      </td>
                      <td className={cn('tnum whitespace-nowrap text-right font-semibold', achievementTint(unit.averageAchievement))}>
                        {formatPercent(unit.averageAchievement)}
                      </td>
                      <td className="tnum whitespace-nowrap text-right">{formatScore(unit.averageTotalScore)}</td>
                      <td className="tnum text-right">{unit.approved}</td>
                      <td className="tnum text-right">{unit.pending}</td>
                      <td className="tnum text-right">{unit.rejected}</td>
                      <td className="tnum text-right">{unit.belowTarget}</td>
                      <td className="tnum text-right">{unit.weightIncomplete}</td>
                      <td className="tnum text-right">{unit.headcount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* --------------------------------------------------- heat table */}
          <Card className="mt-4">
            <CardHeader
              title="Department heat table"
              subtitle="Average achievement is tinted with the RAG colour — the number is always shown (never colour alone)."
            />
            <div className="overflow-x-auto">
              <table className="anwar-table sticky-first-col">
                <thead>
                  <tr>
                    <th scope="col">Department</th>
                    <th scope="col" className="text-right">
                      Average achievement
                    </th>
                    <th scope="col" className="text-right">
                      Approved
                    </th>
                    <th scope="col" className="text-right">
                      Pending
                    </th>
                    <th scope="col" className="text-right">
                      Rejected
                    </th>
                    <th scope="col" className="text-right">
                      Below target
                    </th>
                    <th scope="col" className="text-right">
                      SLA breaches
                    </th>
                    <th scope="col" className="text-right">
                      Weight incomplete
                    </th>
                    <th scope="col" className="text-right">
                      Participation
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.departments.map((row) => (
                    <tr key={row.departmentId}>
                      <td className="min-w-[220px]">
                        <button
                          type="button"
                          className="text-left font-semibold text-navy-700 hover:underline"
                          onClick={() => {
                            const unit = data.businessUnits.find((candidate) => candidate.id === row.businessUnitId);
                            setBusinessUnit(unit ? { id: unit.id, name: unit.name } : null);
                            setDepartment({ id: row.departmentId, name: row.department });
                            setEmployee(null);
                            setLevel('employee');
                          }}
                        >
                          {row.department}
                        </button>
                      </td>
                      <td className={cn('tnum whitespace-nowrap text-right font-semibold', achievementTint(row.averageAchievement))}>
                        {formatPercent(row.averageAchievement)}
                      </td>
                      <td className="tnum text-right">{row.approved}</td>
                      <td className="tnum text-right">{row.pending}</td>
                      <td className="tnum text-right">{row.rejected}</td>
                      <td className="tnum text-right">{row.belowTarget}</td>
                      <td className="tnum text-right">{row.slaBreaches}</td>
                      <td className="tnum text-right">{row.weightIncomplete}</td>
                      <td className="tnum text-right">{formatPercent(row.participation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ------------------------------------------------ escalations widget */}
          <Card className="mt-4">
            <CardHeader
              title="Open escalations"
              subtitle="Adjustments outside the ±band waiting for a Super Admin (UC-05)."
              actions={
                <Link to="/escalations" className="anwar-btn anwar-btn-secondary anwar-btn-sm h-9 px-3">
                  View all
                </Link>
              }
            />
            {data.escalations.length === 0 ? (
              <p className="text-caption text-ink-secondary">No escalation is waiting.</p>
            ) : (
              <ul className="space-y-2">
                {data.escalations.map((escalation) => (
                  <li key={escalation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-edge px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-body font-semibold text-ink">{escalation.kpi}</p>
                      <p className="text-caption text-ink-secondary">
                        {escalation.employee} · {escalation.department} · requested by {escalation.requestedBy}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-caption">
                      <span className="anwar-mono">
                        {formatScore(escalation.calculatedScore)} → {formatScore(escalation.proposedScore)}
                      </span>
                      <span className="anwar-badge bg-warning-tint text-warning">Δ {formatScore(escalation.delta)}</span>
                      <span className="text-ink-secondary">{escalation.ageDays} d waiting</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ------------------------------------------------------ drill-down */}
          <Card className="mt-4">
            <CardHeader
              title="Drill-down"
              subtitle="Business Unit → Department → Employee → KPI. Select a row to narrow the next level."
              actions={
                <Button variant="secondary" size="sm" onClick={exportCurrentLevel} disabled={!drillItems.length}>
                  Export this level (CSV)
                </Button>
              }
            />

            <nav aria-label="Drill-down path" className="mb-3 flex flex-wrap items-center gap-1 text-caption">
              <button
                type="button"
                className={cn('rounded-pill px-3 py-1 font-medium', level === 'business_unit' ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50')}
                onClick={() => goToLevel('business_unit')}
              >
                Group
              </button>
              {businessUnit ? (
                <>
                  <span aria-hidden="true" className="text-ink-muted">
                    /
                  </span>
                  <button
                    type="button"
                    className={cn('rounded-pill px-3 py-1 font-medium', level === 'department' ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50')}
                    onClick={() => goToLevel('department')}
                  >
                    {businessUnit.name}
                  </button>
                </>
              ) : null}
              {department ? (
                <>
                  <span aria-hidden="true" className="text-ink-muted">
                    /
                  </span>
                  <button
                    type="button"
                    className={cn('rounded-pill px-3 py-1 font-medium', level === 'employee' ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50')}
                    onClick={() => goToLevel('employee')}
                  >
                    {department.name}
                  </button>
                </>
              ) : null}
              {employee ? (
                <>
                  <span aria-hidden="true" className="text-ink-muted">
                    /
                  </span>
                  <button
                    type="button"
                    className={cn('rounded-pill px-3 py-1 font-medium', level === 'kpi' ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50')}
                    onClick={() => goToLevel('kpi')}
                  >
                    {employee.name}
                  </button>
                </>
              ) : null}
            </nav>

            {drillQuery.error ? (
              <Alert tone="danger" title="The drill-down could not be loaded">
                {drillQuery.error instanceof Error ? drillQuery.error.message : 'Please try again.'}
              </Alert>
            ) : drillQuery.isLoading || (drillQuery.data !== undefined && drillQuery.data.level !== level) ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : drillItems.length === 0 ? (
              <p className="text-caption text-ink-secondary">Nothing to show at this level for the selected period.</p>
            ) : (
              <div className="overflow-x-auto">
                {level === 'business_unit' ? (
                  <table className="anwar-table sticky-first-col">
                    <thead>
                      <tr>
                        <th scope="col">Business Unit</th>
                        <th scope="col">Code</th>
                        <th scope="col">Drill down</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(drillItems as DrillBuItem[]).map((item) => (
                        <tr key={item.id}>
                          <td className="min-w-[240px] font-semibold text-ink">{item.name}</td>
                          <td className="anwar-mono">{item.code}</td>
                          <td>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setBusinessUnit({ id: item.id, name: item.name });
                                setDepartment(null);
                                setEmployee(null);
                                setLevel('department');
                              }}
                            >
                              Departments
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : level === 'department' ? (
                  <table className="anwar-table sticky-first-col">
                    <thead>
                      <tr>
                        <th scope="col">Department</th>
                        <th scope="col">Drill down</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(drillItems as DrillDeptItem[]).map((item) => (
                        <tr key={item.id}>
                          <td className="min-w-[260px] font-semibold text-ink">{item.name}</td>
                          <td>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDepartment({ id: item.id, name: item.name });
                                setEmployee(null);
                                setLevel('employee');
                              }}
                            >
                              Employees
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : level === 'employee' ? (
                  <table className="anwar-table sticky-first-col">
                    <thead>
                      <tr>
                        <th scope="col">Employee</th>
                        <th scope="col">Employee ID</th>
                        <th scope="col">Designation</th>
                        <th scope="col" className="text-right">
                          Total KPI score
                        </th>
                        <th scope="col" className="text-right">
                          Average achievement
                        </th>
                        <th scope="col" className="text-right">
                          Approved
                        </th>
                        <th scope="col" className="text-right">
                          Allocated weight
                        </th>
                        <th scope="col">Drill down</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(drillItems as DrillEmployeeItem[]).map((item) => (
                        <tr key={item.employeeId}>
                          <td className="min-w-[190px] font-semibold text-ink">{item.employeeName}</td>
                          <td className="anwar-mono">{item.employeeCode}</td>
                          <td className="min-w-[150px]">{item.designation}</td>
                          <td className="tnum whitespace-nowrap text-right font-semibold">
                            {formatPercent(item.totalKpiScore)}
                          </td>
                          <td className="tnum whitespace-nowrap text-right">
                            {formatPercent(item.averageAchievement)}
                          </td>
                          <td className="tnum text-right">
                            {item.approved}/{item.total}
                          </td>
                          <td className="tnum whitespace-nowrap text-right">{item.allocatedWeight}%</td>
                          <td>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEmployee({ id: item.employeeId, name: item.employeeName });
                                setLevel('kpi');
                              }}
                            >
                              KPIs
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
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
                          Final score
                        </th>
                        <th scope="col">Status</th>
                        <th scope="col">RAG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(drillItems as DrillKpiItem[]).map((item) => (
                        <tr key={item.id}>
                          <td className="min-w-[220px]">
                            <Link to={`/my-kpi/${item.id}`} className="font-semibold text-navy-700 hover:underline">
                              {item.name}
                            </Link>
                            <p className="anwar-mono text-caption text-ink-muted">
                              {item.code} · {item.category}
                            </p>
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
                          <td>
                            <RagBadge rag={item.rag} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
};

export default GroupDashboardPage;
