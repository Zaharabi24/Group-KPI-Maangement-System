/**
 * ============================================================================
 *  MyKpiPage — route `/my-kpi` (FR-KPI-01..07, FR-KPI-11, BRD §11.4)
 * ============================================================================
 *  One container card: a sticky header holding the Create KPI (+) tile pinned
 *  to the right, the weight meter and the status chips, then a vertically
 *  scrollable grid of KPI cards with its own scrollbar. The page header stays
 *  fixed above the card.
 * ============================================================================
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { KpiCard, KpiPeriodSummary, KpiStatus } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FilterChip,
  Input,
  KpiStepper,
  ProgressBar,
  SkeletonCard,
} from '@/components/ui';
import {
  AdjustedTag,
  Alert,
  AssignedTag,
  DeadlineLabel,
  PageHeader,
  StatusBadge,
} from '@/components/ui/badges';
import { PeriodSelector, usePeriodSelection } from '@/components/layout/PeriodSelector';
import { useDebounced } from '@/components/layout/GlobalSearch';
import CreateKpiDrawer from '@/components/kpi/CreateKpiDrawer';
import { STATUS_LABELS, formatScore, measured } from '@/lib/format';

interface KpiListResponse {
  items: KpiCard[];
  counts: Record<string, number>;
  total: number;
  page: number;
  size: number;
  totalPages: number;
  period: KpiPeriodSummary | null;
  allocatedWeight: number;
  availableWeight: number;
}

/** Chip order — §11.4 keeps Draft → Submitted → Under Review → Returned → Approved → Rejected. */
const STATUS_ORDER: KpiStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'RETURNED',
  'ESCALATED',
  'APPROVED',
  'REJECTED',
];

const PAGE_SIZE = 50;

const plusIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const MyKpiPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selection } = usePeriodSelection();

  const [status, setStatus] = React.useState<'ALL' | KpiStatus>('ALL');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const debouncedSearch = useDebounced(search, 300);

  React.useEffect(() => {
    setPage(1);
  }, [status, debouncedSearch, selection?.periodId]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['kpis', selection?.frequency, selection?.periodId, status, debouncedSearch, page],
    queryFn: () =>
      api.get<KpiListResponse>('/kpis', {
        frequency: selection?.frequency,
        periodId: selection?.periodId,
        status: status === 'ALL' ? undefined : status,
        search: debouncedSearch.trim() || undefined,
        page,
        size: PAGE_SIZE,
      }),
    enabled: Boolean(selection?.periodId),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const counts = data?.counts ?? {};
  const allCount = React.useMemo(
    () => Object.values(counts).reduce((sum, value) => sum + Number(value), 0),
    [counts],
  );
  const allocated = data?.allocatedWeight ?? 0;
  const available = data?.availableWeight ?? Math.max(0, 100 - allocated);
  const periodLabel = data?.period?.label ?? selection?.label ?? 'this period';

  const statusChips = React.useMemo(
    () => STATUS_ORDER.filter((code) => (counts[code] ?? 0) > 0),
    [counts],
  );

  const openCreate = () => {
    setEditId(null);
    setDrawerOpen(true);
  };

  const openEdit = (id: string) => {
    setEditId(id);
    setDrawerOpen(true);
  };

  const clearFilters = () => {
    setStatus('ALL');
    setSearch('');
  };

  return (
    <div>
      <PageHeader
        title="My KPI"
        subtitle={selection ? `${periodLabel} · ${selection.frequency === 'MONTHLY' ? 'Monthly' : selection.frequency === 'QUARTERLY' ? 'Quarterly' : 'Yearly'} frequency` : 'Select a period to begin'}
        actions={<PeriodSelector compact />}
      />

      {allocated < 100 ? (
        <Alert tone="warning" title={`Weight allocated ${allocated} / 100%`} className="mb-4">
          You can allocate <span className="tnum font-semibold">{available}%</span> more weight this period. A KPI can
          only be submitted while the period total stays within 100% (W-3).
        </Alert>
      ) : null}

      <Card padded={false} className="overflow-hidden">
        {/* ----------------------------------------------- sticky card header */}
        <div className="sticky top-0 z-20 border-b border-edge bg-surface px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-h3 text-navy-900">Your KPI cards</h2>
                <Badge tone="neutral">{data?.total ?? 0} KPIs</Badge>
                {isFetching ? <Badge tone="info">Refreshing…</Badge> : null}
              </div>
              <div className="mt-2 max-w-md">
                <ProgressBar
                  value={Math.min(100, allocated)}
                  max={100}
                  tone={allocated >= 100 ? 'success' : 'warning'}
                  label={`Weight allocated ${allocated} / 100%`}
                />
                <p className="mt-1 text-caption text-ink-secondary">
                  {available}% still available · a full period totals exactly 100%.
                </p>
              </div>
            </div>

            {/* Create KPI (+) tile pinned to the right of the card header */}
            <div className="sticky right-0 flex shrink-0 items-center gap-2">
              <Button onClick={openCreate} iconLeft={plusIcon} aria-label="Create KPI">
                Create KPI
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FilterChip active={status === 'ALL'} onClick={() => setStatus('ALL')} count={allCount}>
              All
            </FilterChip>
            {statusChips.map((code) => (
              <FilterChip key={code} active={status === code} onClick={() => setStatus(code)} count={counts[code]}>
                {STATUS_LABELS[code]}
              </FilterChip>
            ))}

            <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search your KPIs…"
                aria-label="Search your KPIs by name"
                className="h-9 w-full text-caption sm:w-[220px]"
              />
              {status !== 'ALL' || search ? (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------- scrollable body */}
        <div className="anwar-scroll max-h-[calc(100vh-22rem)] min-h-[280px] p-4 sm:p-6">
          {error ? (
            <ErrorState
              message={error instanceof Error ? error.message : 'Your KPIs could not be loaded.'}
              onRetry={() => refetch()}
            />
          ) : !selection?.periodId || (isLoading && !data) ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <SkeletonCard key={index} lines={5} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title={`You have no KPIs for ${periodLabel}`}
              description={
                status !== 'ALL' || search
                  ? 'No KPI matches the current filter. Clear the filter to see the rest of the period.'
                  : 'Create your first KPI for this period, allocate the weight and submit it with evidence for approval.'
              }
              action={
                status !== 'ALL' || search ? (
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={openCreate} iconLeft={plusIcon}>
                    Create KPI
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
              {items.map((card) => (
                <KpiCardTile
                  key={card.id}
                  card={card}
                  onOpen={() => navigate(`/my-kpi/${card.id}`)}
                  onEdit={() => openEdit(card.id)}
                />
              ))}
            </div>
          )}

          {items.length === 0 && !isLoading && !error && Boolean(selection?.periodId) && status === 'ALL' && !search.trim() ? (
            <ol className="mx-auto mt-8 max-w-2xl space-y-2 text-left">
              {[
                'Define the KPI — name, category, measurement type, unit and direction.',
                'Set the target and weight, then record the actual for the period.',
                'Attach the evidence files, add your remarks and submit for approval.',
              ].map((step, index) => (
                <li key={step} className="flex items-start gap-3 rounded-control border border-edge bg-canvas px-3 py-2">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900 text-caption font-semibold text-white">
                    {index + 1}
                  </span>
                  <span className="text-body text-ink-secondary">{step}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </Card>

      <CreateKpiDrawer
        open={drawerOpen}
        kpiId={editId}
        defaultPeriodId={selection?.periodId ?? null}
        defaultFrequency={selection?.frequency ?? null}
        onClose={() => {
          setDrawerOpen(false);
          setEditId(null);
        }}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['kpis'] });
        }}
      />
    </div>
  );
};

// ------------------------------------------------------------------ KPI card

const KpiCardTile: React.FC<{ card: KpiCard; onOpen: () => void; onEdit: () => void }> = ({
  card,
  onOpen,
  onEdit,
}) => {
  const scoreValue = card.finalScore ?? card.calculatedScore;
  const canEdit = (card.status === 'DRAFT' || card.status === 'RETURNED') && !card.isLocked;

  return (
    <article className="anwar-card anwar-card-pad flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold leading-6 text-navy-900">
            <Link to={`/my-kpi/${card.id}`} className="hover:underline" title={card.name}>
              {card.name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-caption text-ink-secondary" title={`${card.category} · Weight ${card.kpiWeight}%`}>
            {card.category} · Weight {card.kpiWeight}%
          </p>
          <p className="mt-0.5 anwar-mono text-caption text-ink-muted">{card.code}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={card.status} locked={card.isLocked} />
          <div className="flex flex-wrap justify-end gap-1">
            {card.isAssigned ? <AssignedTag /> : null}
            {card.adjusted ? <AdjustedTag /> : null}
          </div>
        </div>
      </div>

      {card.status === 'RETURNED' && card.returnComment ? (
        <Alert tone="warning" title="Returned">
          {card.returnComment}
        </Alert>
      ) : null}

      <dl className="grid grid-cols-3 gap-2 rounded-control bg-canvas p-2 text-center">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">Target</dt>
          <dd className="anwar-mono mt-0.5 font-semibold text-ink">
            {measured(card.target, card.measurementType, card.unit, true)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">Actual</dt>
          <dd className="anwar-mono mt-0.5 font-semibold text-ink">
            {measured(card.actual, card.measurementType, card.unit, true)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">Score</dt>
          <dd className="mt-0.5">
            <span className="anwar-mono font-semibold text-ink">{formatScore(scoreValue)}</span>
            {card.scoreTag ? (
              <span className="ml-1 text-[10px] font-semibold text-ink-muted">{card.scoreTag}</span>
            ) : null}
          </dd>
        </div>
      </dl>

      <KpiStepper states={card.stepper.states} className="justify-between" />

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <DeadlineLabel days={card.daysRemaining} state={card.deadlineState} />
        <div className="flex items-center gap-2">
          {canEdit ? (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              {card.status === 'RETURNED' ? 'Edit and resubmit' : 'Edit'}
            </Button>
          ) : null}
          <Button size="sm" variant="primary" onClick={onOpen} aria-label={`View details for ${card.name}`}>
            View Details
          </Button>
        </div>
      </div>
    </article>
  );
};

export default MyKpiPage;
