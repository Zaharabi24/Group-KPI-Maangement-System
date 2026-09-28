/**
 * ============================================================================
 *  AllRequestsPage — route `/all-kpi-requests` (FR-APR-12, US-16)
 * ============================================================================
 *  The Super Admin group-wide queue: every pending request, with the FR-APR-02
 *  filters plus Business Unit and Department. A Super Admin may view, edit and
 *  decide any request (US-16).
 * ============================================================================
 */
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ApprovalQueueItem, BusinessUnitItem, DepartmentItem } from '@/lib/types';
import { Pagination, SegmentedControl, Skeleton } from '@/components/ui';
import { Alert, PageHeader } from '@/components/ui/badges';
import { usePeriodSelection } from '@/components/layout/PeriodSelector';
import { useToast } from '@/context/ToastContext';
import { DecisionDrawer, useReviewStart } from './DecisionDrawer';
import {
  RequestCardGrid,
  RequestFilters,
  RequestQueueTable,
  approvalFilterQuery,
  useApprovalFilters,
  type ApprovalQueueResponse,
} from './RequestFilters';

const DEFAULT_SIZE = 25;

export const AllRequestsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { periods } = usePeriodSelection();
  const { filters, patch, clear } = useApprovalFilters();
  const [searchParams] = useSearchParams();

  const [view, setView] = React.useState<'cards' | 'table'>('cards');
  const [size, setSize] = React.useState(DEFAULT_SIZE);
  const [kpiId, setKpiId] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const { start, openingId } = useReviewStart();

  const businessUnitsQuery = useQuery({
    queryKey: ['organisation', 'business-units'],
    queryFn: () => api.get<BusinessUnitItem[]>('/organisation/business-units'),
    staleTime: 10 * 60_000,
  });

  const departmentsQuery = useQuery({
    queryKey: ['organisation', 'departments', filters.businessUnitId],
    queryFn: () =>
      api.get<DepartmentItem[]>('/organisation/departments', {
        businessUnitId: filters.businessUnitId || undefined,
      }),
    enabled: Boolean(filters.businessUnitId),
    staleTime: 5 * 60_000,
  });

  const categoriesQuery = useQuery({
    queryKey: ['kpi-categories'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/kpis/meta/categories'),
    staleTime: 10 * 60_000,
  });

  const queueQuery = useQuery({
    queryKey: [
      'approvals',
      'all',
      filters.employee,
      filters.frequency,
      filters.periodId,
      filters.status,
      filters.categoryId,
      filters.sort,
      filters.order,
      filters.businessUnitId,
      filters.departmentId,
      filters.page,
      size,
    ],
    queryFn: () =>
      api.get<ApprovalQueueResponse>('/approvals/all', {
        ...approvalFilterQuery(filters),
        page: filters.page,
        size,
      }),
    placeholderData: keepPreviousData,
  });

  const data = queueQuery.data;
  const items = data?.items ?? [];

  const openRequest = React.useCallback(
    (item: ApprovalQueueItem | string) => {
      const id = typeof item === 'string' ? item : item.id;
      setKpiId(id);
      setDrawerOpen(true);
      void start(id);
    },
    [start],
  );

  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    const target = searchParams.get('kpi');
    if (!target || autoOpened.current) return;
    autoOpened.current = true;
    openRequest(target);
  }, [searchParams, openRequest]);

  return (
    <div>
      <PageHeader
        title={data?.headline ?? 'All KPI requests'}
        subtitle="Every pending request in the group, oldest first. The Super Admin may view, edit and decide any of them (US-16, FR-APR-12)."
        actions={
          <SegmentedControl
            ariaLabel="Queue view"
            value={view}
            onChange={(key) => setView(key === 'table' ? 'table' : 'cards')}
            items={[
              { key: 'cards', label: 'Cards' },
              { key: 'table', label: 'Table' },
            ]}
          />
        }
      />

      <RequestFilters
        value={filters}
        onChange={patch}
        onClear={clear}
        periods={periods}
        categories={categoriesQuery.data ?? []}
        businessUnits={businessUnitsQuery.data ?? []}
        departments={departmentsQuery.data ?? []}
        showScope
      />

      {queueQuery.error ? (
        <Alert
          tone="danger"
          title="The group-wide queue could not be loaded"
          actions={
            <button type="button" className="anwar-btn anwar-btn-secondary anwar-btn-sm" onClick={() => queueQuery.refetch()}>
              Retry
            </button>
          }
        >
          {queueQuery.error instanceof Error ? queueQuery.error.message : 'Please try again.'}
          {filters.status === ''
            ? ' Choose a single status above (Submitted, Under Review or Escalated) to load the queue.'
            : ''}
        </Alert>
      ) : queueQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full" />
          ))}
        </div>
      ) : view === 'cards' ? (
        <RequestCardGrid items={items} onOpen={openRequest} busyId={openingId} showScope />
      ) : (
        <div className="anwar-card anwar-card-pad">
          <RequestQueueTable items={items} onOpen={openRequest} busyId={openingId} showScope />
        </div>
      )}

      {data ? (
        <Pagination
          page={data.page}
          size={data.size}
          total={data.total}
          totalPages={data.totalPages}
          onPage={(page) => patch({ page })}
          onSize={(next) => {
            setSize(next);
            patch({ page: 1 });
          }}
        />
      ) : null}

      <DecisionDrawer
        kpiId={kpiId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onDecided={(message) => {
          queryClient.invalidateQueries({ queryKey: ['approvals'] });
          toast.info('Queue updated', message);
        }}
      />
    </div>
  );
};

export default AllRequestsPage;
