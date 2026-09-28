/**
 * ============================================================================
 *  ApprovalsPage — route `/approvals` (M07, FR-APR-01..07, FR-APR-11, UC-04)
 * ============================================================================
 *  The Department Head / approver console: the KPI Pending Requests queue,
 *  oldest first, with the FR-APR-02 filters (kept in the URL), a card grid and
 *  a table view, bulk approve (FR-APR-11) and the shared DecisionDrawer.
 * ============================================================================
 */
import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { ApprovalQueueItem } from '@/lib/types';
import { Button, Modal, Pagination, SegmentedControl, Skeleton } from '@/components/ui';
import { Alert, PageHeader } from '@/components/ui/badges';
import { usePeriodSelection } from '@/components/layout/PeriodSelector';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { DecisionDrawer, useReviewStart, type BulkApproveResult } from './DecisionDrawer';
import {
  RequestCardGrid,
  RequestFilters,
  RequestQueueTable,
  approvalFilterQuery,
  useApprovalFilters,
  type ApprovalQueueResponse,
} from './RequestFilters';

const DEFAULT_SIZE = 25;
const BULK_LIMIT = 20;

/** FR-APR-11 — bulk approve only covers requests that were never adjusted. */
const isUnadjusted = (item: ApprovalQueueItem): boolean =>
  item.status !== 'ESCALATED' &&
  item.escalation === null &&
  (item.finalScore === null || item.finalScore === item.calculatedScore);

export const ApprovalsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasRole } = useAuth();
  const { periods } = usePeriodSelection();
  const { filters, patch, clear } = useApprovalFilters();
  const [searchParams] = useSearchParams();

  const [view, setView] = React.useState<'cards' | 'table'>('cards');
  const [size, setSize] = React.useState(DEFAULT_SIZE);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkResult, setBulkResult] = React.useState<BulkApproveResult | null>(null);
  const [kpiId, setKpiId] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const { start, openingId } = useReviewStart();

  const categoriesQuery = useQuery({
    queryKey: ['kpi-categories'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/kpis/meta/categories'),
    staleTime: 10 * 60_000,
  });

  const queueQuery = useQuery({
    queryKey: [
      'approvals',
      'queue',
      filters.employee,
      filters.frequency,
      filters.periodId,
      filters.status,
      filters.categoryId,
      filters.sort,
      filters.order,
      filters.page,
      size,
    ],
    queryFn: () =>
      api.get<ApprovalQueueResponse>('/approvals', {
        ...approvalFilterQuery(filters),
        page: filters.page,
        size,
      }),
    placeholderData: keepPreviousData,
  });

  const data = queueQuery.data;
  const items = data?.items ?? [];

  const itemById = React.useMemo(() => {
    const map = new Map<string, ApprovalQueueItem>();
    items.forEach((item) => map.set(item.id, item));
    return map;
  }, [items]);

  // FR-APR-04 — open the request (start the review) and show the full detail.
  const openRequest = React.useCallback(
    (item: ApprovalQueueItem | string) => {
      const id = typeof item === 'string' ? item : item.id;
      setKpiId(id);
      setDrawerOpen(true);
      void start(id);
    },
    [start],
  );

  // Deep link support: `/approvals?kpi=<id>` opens that request on mount.
  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    const target = searchParams.get('kpi');
    if (!target || autoOpened.current) return;
    autoOpened.current = true;
    openRequest(target);
  }, [searchParams, openRequest]);

  // Selection is not carried across filter changes.
  React.useEffect(() => {
    setSelected([]);
    setBulkResult(null);
  }, [filters.employee, filters.frequency, filters.periodId, filters.status, filters.categoryId, filters.businessUnitId, filters.departmentId, filters.page]);

  const bulkMutation = useMutation({
    mutationFn: () => api.post<BulkApproveResult>('/approvals/bulk-approve', { ids: selected }),
    onSuccess: (result) => {
      setBulkResult(result);
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'department'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'group'] });
      if (result.failed > 0) {
        toast.warning(`${result.approved} approved, ${result.failed} failed`, 'Review the per-request results below.');
      } else {
        toast.success(`${result.approved} request${result.approved === 1 ? '' : 's'} approved`, 'Each employee was notified (NT-07).');
      }
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : 'The bulk approval could not be completed.';
      toast.error('Bulk approve failed', message);
    },
  });

  const closeBulk = () => {
    setBulkOpen(false);
    setBulkResult(null);
  };

  const escalatedCount = data?.escalatedCount ?? 0;
  const showEscalations = hasRole('SUPER_ADMIN');

  const bulkRows: Array<{ id: string; ok?: boolean; message?: string }> = bulkResult
    ? bulkResult.results.map((entry) => ({ id: entry.id, ok: entry.ok, message: entry.message }))
    : selected.map((id) => ({ id }));

  return (
    <div>
      <PageHeader
        title={data?.headline ?? 'KPI submission requests'}
        subtitle={`${data?.total ?? 0} request${(data?.total ?? 0) === 1 ? '' : 's'} matching the filters · oldest first (FR-APR-01)`}
      />

      {showEscalations && escalatedCount > 0 ? (
        <Alert
          tone="warning"
          title={`${escalatedCount} escalated adjustment${escalatedCount === 1 ? '' : 's'} waiting`}
          className="mb-4"
          actions={
            <Link to="/escalations" className="anwar-btn anwar-btn-secondary anwar-btn-sm">
              Open escalations
            </Link>
          }
        >
          An adjustment whose Δ falls outside the configured ± band is decided by a Super Admin (ADJ-2, UC-05).
        </Alert>
      ) : null}

      <RequestFilters
        value={filters}
        onChange={patch}
        onClear={clear}
        periods={periods}
        categories={categoriesQuery.data ?? []}
        toggle={
          <SegmentedControl
            size="sm"
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

      {queueQuery.error ? (
        <Alert tone="danger" title="The queue could not be loaded">
          {queueQuery.error instanceof Error ? queueQuery.error.message : 'Please try again.'}
        </Alert>
      ) : queueQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-56 w-full" />
          ))}
        </div>
      ) : view === 'cards' ? (
        <RequestCardGrid items={items} onOpen={openRequest} busyId={openingId} />
      ) : (
        <div className="anwar-card anwar-card-pad">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption text-ink-secondary">
              {selected.length === 0
                ? `Tick up to ${BULK_LIMIT} unadjusted requests to approve them together (FR-APR-11).`
                : `${selected.length} of ${BULK_LIMIT} selected`}
            </p>
            <div className="flex items-center gap-2">
              {selected.length > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                  Clear selection
                </Button>
              ) : null}
              <Button size="sm" disabled={selected.length === 0} onClick={() => setBulkOpen(true)}>
                Bulk approve ({selected.length})
              </Button>
            </div>
          </div>

          <RequestQueueTable
            items={items}
            onOpen={openRequest}
            busyId={openingId}
            selectable
            selected={selected}
            onSelectedChange={(ids) => setSelected(ids.slice(0, BULK_LIMIT))}
            isSelectable={isUnadjusted}
          />

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
        </div>
      )}

      {view === 'cards' && data ? (
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

      <Modal
        open={bulkOpen}
        onClose={closeBulk}
        title="Bulk approve requests"
        description={
          bulkResult
            ? `${bulkResult.approved} approved · ${bulkResult.failed} failed`
            : `${selected.length} unadjusted request${selected.length === 1 ? '' : 's'} will be approved with their calculated score. Bulk approve accepts up to ${BULK_LIMIT} at a time.`
        }
        size="md"
        footer={
          bulkResult ? (
            <Button onClick={closeBulk}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={closeBulk}>
                Cancel
              </Button>
              <Button
                disabled={selected.length === 0 || selected.length > BULK_LIMIT}
                loading={bulkMutation.isPending}
                onClick={() => bulkMutation.mutate()}
              >
                Approve {selected.length} request{selected.length === 1 ? '' : 's'}
              </Button>
            </>
          )
        }
      >
        <ul className="space-y-2">
          {bulkRows.map((row) => {
            const source = itemById.get(row.id);
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-control border border-edge px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold text-ink">{source?.kpi ?? row.id}</p>
                  <p className="text-caption text-ink-muted">
                    {source ? `${source.employeeName} · ${source.employeeCode}` : 'Not on this page'}
                  </p>
                  {row.message ? <p className="text-caption text-danger">{row.message}</p> : null}
                </div>
                {row.ok === undefined ? null : (
                  <span
                    className={
                      row.ok
                        ? 'text-caption font-semibold text-success'
                        : 'text-caption font-semibold text-danger'
                    }
                  >
                    {row.ok ? 'Approved' : 'Failed'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Modal>

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

export default ApprovalsPage;
