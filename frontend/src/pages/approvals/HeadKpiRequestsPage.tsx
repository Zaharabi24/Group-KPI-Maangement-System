/**
 * ============================================================================
 *  HeadKpiRequestsPage — route `/head-kpi-requests` (FR-APR-08, US-16)
 * ============================================================================
 *  Department Head KPIs are routed to the Super Admin queue (BR-R03): a
 *  Department Head can never approve their own KPI. The queue reuses the shared
 *  DecisionDrawer, so the decision behaves exactly like every other review.
 * ============================================================================
 */
import React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Frequency, KpiStatus, MeasurementType } from '@/lib/types';
import { Pagination, Skeleton, cn } from '@/components/ui';
import { Alert, PageHeader, SlaBadge, StatusBadge } from '@/components/ui/badges';
import { DecisionDrawer, useReviewStart } from './DecisionDrawer';
import { frequencyLabel } from './RequestFilters';
import { formatDate, formatPercent, measured } from '@/lib/format';

interface HeadQueueItem {
  id: string;
  code: string;
  name: string;
  status: KpiStatus;
  submittedAt: string | null;
  target: string | null;
  actual: string | null;
  achievement: string | null;
  calculatedScore: string | null;
  finalScore: string | null;
  kpiWeight: number;
  evidenceCount: number;
  rowVersion: number;
  ageDays: number;
  employee: {
    id: string;
    fullName: string;
    employeeCode: string;
    designationTitle: string | null;
  };
  department: { id: string; name: string } | null;
  period: { id: string; label: string };
  category: { name: string };
  frequency?: Frequency;
  measurementType?: MeasurementType;
  unit?: string;
}

interface HeadQueueResponse {
  items: HeadQueueItem[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

const slaStateFor = (ageDays: number): 'within' | 'at_risk' | 'breached' =>
  ageDays <= 3 ? 'within' : ageDays <= 5 ? 'at_risk' : 'breached';

export const HeadKpiRequestsPage: React.FC = () => {
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(25);
  const [kpiId, setKpiId] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const { start, openingId } = useReviewStart();

  const queueQuery = useQuery({
    queryKey: ['approvals', 'department-heads', page, size],
    queryFn: () => api.get<HeadQueueResponse>('/approvals/department-heads', { page, size }),
    placeholderData: keepPreviousData,
  });

  const data = queueQuery.data;
  const items = data?.items ?? [];

  const openRequest = React.useCallback(
    (id: string) => {
      setKpiId(id);
      setDrawerOpen(true);
      void start(id);
    },
    [start],
  );

  return (
    <div>
      <PageHeader
        title="Department Head KPI requests"
        subtitle="These KPIs are routed to the Super Admin: a Department Head cannot decide their own request (BR-R03)."
      />

      <Alert tone="info" title="Approved by a Super Admin" className="mb-4">
        Department Head KPIs are always approved by a Super Admin, and self-decision is impossible (BR-R03). Every
        decision is recorded in the audit trail with your name.
      </Alert>

      {queueQuery.error ? (
        <Alert tone="danger" title="The Department Head queue could not be loaded">
          {queueQuery.error instanceof Error ? queueQuery.error.message : 'Please try again.'}
        </Alert>
      ) : (
        <div className="anwar-card anwar-card-pad">
          {queueQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-h3 text-navy-900">No Department Head KPI is waiting</p>
              <p className="mt-1 text-body text-ink-secondary">
                Submitted Department Head KPIs appear here until a Super Admin decides them.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="anwar-table sticky-first-col">
                <thead>
                  <tr>
                    <th scope="col">KPI</th>
                    <th scope="col">Department Head</th>
                    <th scope="col">Department</th>
                    <th scope="col">Period</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">Age (SLA)</th>
                    <th scope="col" className="text-right">
                      Target
                    </th>
                    <th scope="col" className="text-right">
                      Actual
                    </th>
                    <th scope="col" className="text-right">
                      Achievement
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="min-w-[220px]">
                        <p className="font-semibold text-navy-700">{item.name}</p>
                        <p className="anwar-mono text-caption text-ink-muted">
                          {item.code} · {item.category.name} · Weight {item.kpiWeight}%
                        </p>
                      </td>
                      <td className="min-w-[180px]">
                        <p className="font-semibold text-ink">{item.employee.fullName}</p>
                        <p className="anwar-mono text-caption text-ink-muted">{item.employee.employeeCode}</p>
                        <p className="text-caption text-ink-secondary">{item.employee.designationTitle ?? '—'}</p>
                      </td>
                      <td className="min-w-[140px]">{item.department?.name ?? '—'}</td>
                      <td className="min-w-[140px]">
                        <p>{item.period.label}</p>
                        {item.frequency ? <p className="text-caption text-ink-muted">{frequencyLabel(item.frequency)}</p> : null}
                      </td>
                      <td className="min-w-[120px]">{formatDate(item.submittedAt)}</td>
                      <td>
                        <SlaBadge days={item.ageDays} state={slaStateFor(item.ageDays)} />
                      </td>
                      <td className="anwar-mono whitespace-nowrap text-right">
                        {measured(item.target, item.measurementType, item.unit)}
                      </td>
                      <td className="anwar-mono whitespace-nowrap text-right">
                        {measured(item.actual, item.measurementType, item.unit)}
                      </td>
                      <td className="anwar-mono whitespace-nowrap text-right">{formatPercent(item.achievement)}</td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className={cn('anwar-btn anwar-btn-secondary anwar-btn-sm whitespace-nowrap')}
                          onClick={() => openRequest(item.id)}
                          disabled={openingId === item.id}
                          aria-label={`Review ${item.name}`}
                        >
                          {openingId === item.id ? 'Opening…' : 'Review'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data ? (
            <Pagination
              page={data.page}
              size={data.size}
              total={data.total}
              totalPages={data.totalPages}
              onPage={setPage}
              onSize={(next) => {
                setSize(next);
                setPage(1);
              }}
            />
          ) : null}
        </div>
      )}

      <DecisionDrawer kpiId={kpiId} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
};

export default HeadKpiRequestsPage;
