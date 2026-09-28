/**
 * ============================================================================
 *  LeaderboardPage — route `/leaderboard` (FR-DHD-03)
 * ============================================================================
 *  The standalone leaderboard for the selected period: ranked by Total KPI
 *  Score (§4.5), each employee exactly once, with RAG bars and a client-side
 *  CSV export.
 * ============================================================================
 */
import React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, saveBlob } from '@/lib/api';
import type { KpiPeriodSummary, LeaderboardEntry } from '@/lib/types';
import { Button, Card, CardHeader, ErrorState, Field, Select, Skeleton } from '@/components/ui';
import { PageHeader } from '@/components/ui/badges';
import { PeriodSelector, usePeriodSelection } from '@/components/layout/PeriodSelector';
import { LeaderboardList } from './DepartmentDashboardPage';
import { useToast } from '@/context/ToastContext';

interface LeaderboardResponse {
  period: KpiPeriodSummary;
  entries: LeaderboardEntry[];
}

const csvCell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;

export const LeaderboardPage: React.FC = () => {
  const toast = useToast();
  const { selection } = usePeriodSelection();
  const [departmentId, setDepartmentId] = React.useState('');

  const leaderboardQuery = useQuery({
    queryKey: ['leaderboard', selection?.frequency, selection?.periodId, departmentId],
    queryFn: () =>
      api.get<LeaderboardResponse>('/leaderboard', {
        frequency: selection?.frequency,
        periodId: selection?.periodId,
        departmentId: departmentId || undefined,
        limit: 200,
      }),
    enabled: Boolean(selection?.periodId),
    placeholderData: keepPreviousData,
  });

  const entries = leaderboardQuery.data?.entries ?? [];
  const period = leaderboardQuery.data?.period;

  const departmentOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    entries.forEach((entry) => {
      if (entry.departmentId && entry.department) map.set(entry.departmentId, entry.department);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [entries]);

  const downloadCsv = () => {
    if (!entries.length) return;
    const headers = [
      'Rank',
      'Employee',
      'Employee ID',
      'Designation',
      'Department',
      'Total KPI Score %',
      'Average Achievement %',
      'Approved',
      'Total KPIs',
      'Allocated Weight %',
      'RAG',
    ];
    const rows = entries.map((entry) => [
      entry.rank,
      entry.employeeName,
      entry.employeeCode,
      entry.designation,
      entry.department,
      entry.totalKpiScore,
      entry.averageAchievement,
      entry.approvedCount,
      entry.totalCount,
      entry.allocatedWeight,
      entry.rag,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    saveBlob(
      new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }),
      `leaderboard-${period?.code ?? 'period'}.csv`,
    );
    toast.success('CSV downloaded', `${entries.length} ranked employee${entries.length === 1 ? '' : 's'} exported.`);
  };

  return (
    <div>
      <PageHeader
        title="Leaderboard"
        subtitle={
          period
            ? `${period.label} · ranked by Total KPI Score · approved KPIs only (§4.5)`
            : 'Ranked by Total KPI Score · approved KPIs only (§4.5)'
        }
        actions={
          <>
            <PeriodSelector compact />
            <Button
              variant="secondary"
              onClick={downloadCsv}
              disabled={!entries.length}
              iconLeft={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              }
            >
              Download CSV
            </Button>
          </>
        }
      />

      {departmentOptions.length > 1 ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Department" htmlFor="leaderboard-department" className="w-full sm:w-[260px]">
              <Select
                id="leaderboard-department"
                className="h-9 text-caption"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">All departments in scope</option>
                {departmentOptions.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-caption text-ink-secondary">
              {entries.length} ranked employee{entries.length === 1 ? '' : 's'} in the selected period.
            </p>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Ranked employees"
          subtitle="Gold, silver and bronze mark the top three. The bar length is the Total KPI Score (capped at 100% for display)."
        />
        {leaderboardQuery.error ? (
          <ErrorState
            message={leaderboardQuery.error instanceof Error ? leaderboardQuery.error.message : 'The leaderboard could not be loaded.'}
            onRetry={() => leaderboardQuery.refetch()}
          />
        ) : leaderboardQuery.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <LeaderboardList entries={entries} />
        )}
      </Card>
    </div>
  );
};

export default LeaderboardPage;
