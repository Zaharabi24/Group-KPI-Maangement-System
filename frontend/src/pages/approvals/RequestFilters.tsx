/**
 * ============================================================================
 *  RequestFilters — shared approval-queue pieces (FR-APR-01/02, FR-APR-12)
 * ============================================================================
 *  Used by ApprovalsPage (the Department Head queue) and AllRequestsPage (the
 *  Super Admin group-wide queue). The filter state lives in the URL query
 *  string, so every queue view is deep-linkable and "Clear all" resets it in
 *  one action (FR-SRC-02).
 * ============================================================================
 */
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  ApprovalQueueItem,
  BusinessUnitItem,
  DepartmentItem,
  Frequency,
  KpiPeriodSummary,
  KpiStatus,
} from '@/lib/types';
import { Button, Card, EmptyState, Field, Input, Select, cn } from '@/components/ui';
import { SlaBadge, StatusBadge } from '@/components/ui/badges';
import { STATUS_LABELS, formatDate, formatPercent, measured } from '@/lib/format';

// ------------------------------------------------------------------ constants

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};

export const frequencyLabel = (value: string | null | undefined): string =>
  value ? FREQUENCY_LABELS[value as Frequency] ?? value : '—';

const STATUS_OPTIONS: KpiStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'ESCALATED',
  'RETURNED',
  'APPROVED',
  'REJECTED',
  'NOT_SUBMITTED',
];

export const ORDER_BY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'submittedAt:asc', label: 'Oldest first' },
  { value: 'submittedAt:desc', label: 'Newest first' },
  { value: 'employee:asc', label: 'Employee A–Z' },
  { value: 'employee:desc', label: 'Employee Z–A' },
  { value: 'achievement:desc', label: 'Achievement high → low' },
  { value: 'achievement:asc', label: 'Achievement low → high' },
];

export interface ApprovalQueueResponse {
  items: ApprovalQueueItem[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
  escalatedCount: number;
  headline: string;
}

// -------------------------------------------------------------------- filters

export interface ApprovalFiltersState {
  employee: string;
  frequency: string;
  periodId: string;
  status: string;
  categoryId: string;
  sort: string;
  order: string;
  businessUnitId: string;
  departmentId: string;
  page: number;
}

export const EMPTY_APPROVAL_FILTERS: ApprovalFiltersState = {
  employee: '',
  frequency: '',
  periodId: '',
  status: '',
  categoryId: '',
  sort: 'submittedAt',
  order: 'asc',
  businessUnitId: '',
  departmentId: '',
  page: 1,
};

export const parseApprovalFilters = (params: URLSearchParams): ApprovalFiltersState => ({
  employee: params.get('employee') ?? '',
  frequency: params.get('frequency') ?? '',
  periodId: params.get('periodId') ?? '',
  status: params.get('status') ?? '',
  categoryId: params.get('categoryId') ?? '',
  sort: params.get('sort') ?? 'submittedAt',
  order: params.get('order') ?? 'asc',
  businessUnitId: params.get('businessUnitId') ?? '',
  departmentId: params.get('departmentId') ?? '',
  page: Math.max(1, Number(params.get('page') ?? '1') || 1),
});

export const buildApprovalParams = (filters: ApprovalFiltersState): URLSearchParams => {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number): void => {
    if (value === '' || value === null || value === undefined) return;
    params.set(key, String(value));
  };
  set('employee', filters.employee.trim());
  set('frequency', filters.frequency);
  set('periodId', filters.periodId);
  set('status', filters.status);
  set('categoryId', filters.categoryId);
  if (filters.sort !== 'submittedAt') set('sort', filters.sort);
  if (filters.order !== 'asc') set('order', filters.order);
  set('businessUnitId', filters.businessUnitId);
  set('departmentId', filters.departmentId);
  if (filters.page > 1) set('page', filters.page);
  return params;
};

/** The query object handed to `GET /approvals` and `GET /approvals/all`. */
export const approvalFilterQuery = (filters: ApprovalFiltersState): Record<string, unknown> => ({
  employee: filters.employee.trim() || undefined,
  frequency: filters.frequency || undefined,
  periodId: filters.periodId || undefined,
  status: filters.status || undefined,
  categoryId: filters.categoryId || undefined,
  sort: filters.sort,
  order: filters.order,
  businessUnitId: filters.businessUnitId || undefined,
  departmentId: filters.departmentId || undefined,
});

export const countActiveFilters = (filters: ApprovalFiltersState): number =>
  [
    filters.employee,
    filters.frequency,
    filters.periodId,
    filters.status,
    filters.categoryId,
    filters.businessUnitId,
    filters.departmentId,
  ].filter(Boolean).length;

/** Keeps the filter state in the URL so deep links and the back button work. */
export const useApprovalFilters = (): {
  filters: ApprovalFiltersState;
  patch: (next: Partial<ApprovalFiltersState>) => void;
  clear: () => void;
} => {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = React.useMemo(() => parseApprovalFilters(searchParams), [searchParams]);

  const patch = React.useCallback(
    (next: Partial<ApprovalFiltersState>) => {
      setSearchParams(
        (current) => buildApprovalParams({ ...parseApprovalFilters(current), ...next }),
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clear = React.useCallback(() => {
    setSearchParams(
      (current) => {
        const next = buildApprovalParams({ ...EMPTY_APPROVAL_FILTERS });
        const kpi = current.get('kpi');
        if (kpi) next.set('kpi', kpi);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return { filters, patch, clear };
};

// -------------------------------------------------------------- filter bar

export interface RequestFiltersProps {
  value: ApprovalFiltersState;
  onChange: (patch: Partial<ApprovalFiltersState>) => void;
  onClear: () => void;
  periods: KpiPeriodSummary[];
  categories?: Array<{ id: string; name: string }>;
  businessUnits?: BusinessUnitItem[];
  departments?: DepartmentItem[];
  /** FR-APR-12 — the group-wide queue adds Business Unit and Department. */
  showScope?: boolean;
  /** Extra control rendered next to "Clear all" (the Cards / Table toggle). */
  toggle?: React.ReactNode;
}

export const RequestFilters: React.FC<RequestFiltersProps> = ({
  value,
  onChange,
  onClear,
  periods,
  categories = [],
  businessUnits = [],
  departments = [],
  showScope = false,
  toggle,
}) => {
  const [term, setTerm] = React.useState(value.employee);
  const timer = React.useRef<number | null>(null);
  const previous = React.useRef(value.employee);

  // The input is debounced; the URL is only rewritten once typing pauses.
  const handleEmployee = (next: string) => {
    setTerm(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      previous.current = next.trim();
      onChange({ employee: next.trim(), page: 1 });
    }, 350);
  };

  // An external change (Clear all, back button) wins over a pending keystroke.
  React.useEffect(() => {
    if (previous.current === value.employee) return;
    previous.current = value.employee;
    if (timer.current) window.clearTimeout(timer.current);
    setTerm(value.employee);
  }, [value.employee]);

  React.useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const visiblePeriods = React.useMemo(
    () => (value.frequency ? periods.filter((period) => period.frequency === value.frequency) : periods),
    [periods, value.frequency],
  );

  const activeCount = countActiveFilters(value);
  const orderValue = `${value.sort}:${value.order}`;

  return (
    <Card className="mb-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-secondary">
          {activeCount === 0 ? 'No filters applied' : `${activeCount} filter${activeCount === 1 ? '' : 's'} applied`}
          {' · '}
          filters are kept in the URL so this view can be shared (FR-SRC-02).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {toggle}
          <Button variant="ghost" size="sm" onClick={onClear} disabled={activeCount === 0}>
            Clear all
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Field label="Employee" htmlFor="filter-employee" className="xl:col-span-2">
          <Input
            id="filter-employee"
            type="search"
            value={term}
            onChange={(event) => handleEmployee(event.target.value)}
            placeholder="Name or Employee ID"
            aria-label="Search requests by employee name or Employee ID"
            className="h-9 text-caption"
          />
        </Field>

        <Field label="Frequency" htmlFor="filter-frequency">
          <Select
            id="filter-frequency"
            className="h-9 text-caption"
            value={value.frequency}
            onChange={(event) => onChange({ frequency: event.target.value, periodId: '', page: 1 })}
          >
            <option value="">All frequencies</option>
            {(['MONTHLY', 'QUARTERLY', 'YEARLY'] as Frequency[]).map((frequency) => (
              <option key={frequency} value={frequency}>
                {FREQUENCY_LABELS[frequency]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Period" htmlFor="filter-period">
          <Select
            id="filter-period"
            className="h-9 text-caption"
            value={value.periodId}
            onChange={(event) => onChange({ periodId: event.target.value, page: 1 })}
          >
            <option value="">All periods</option>
            {visiblePeriods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label}
                {period.status === 'CLOSED' ? ' (closed)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status" htmlFor="filter-status">
          <Select
            id="filter-status"
            className="h-9 text-caption"
            value={value.status}
            onChange={(event) => onChange({ status: event.target.value, page: 1 })}
          >
            <option value="">Pending (default)</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="KPI category" htmlFor="filter-category">
          <Select
            id="filter-category"
            className="h-9 text-caption"
            value={value.categoryId}
            onChange={(event) => onChange({ categoryId: event.target.value, page: 1 })}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Order by" htmlFor="filter-order">
          <Select
            id="filter-order"
            className="h-9 text-caption"
            value={orderValue}
            onChange={(event) => {
              const [sort, order] = event.target.value.split(':');
              onChange({ sort, order, page: 1 });
            }}
          >
            {ORDER_BY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        {showScope ? (
          <>
            <Field label="Business Unit" htmlFor="filter-bu">
              <Select
                id="filter-bu"
                className="h-9 text-caption"
                value={value.businessUnitId}
                onChange={(event) => onChange({ businessUnitId: event.target.value, departmentId: '', page: 1 })}
              >
                <option value="">All Business Units</option>
                {businessUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Department" htmlFor="filter-department">
              <Select
                id="filter-department"
                className="h-9 text-caption"
                value={value.departmentId}
                onChange={(event) => onChange({ departmentId: event.target.value, page: 1 })}
                disabled={!value.businessUnitId}
              >
                <option value="">All departments</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : null}
      </div>
    </Card>
  );
};

// ------------------------------------------------------------------- cards

export interface RequestCardGridProps {
  items: ApprovalQueueItem[];
  onOpen: (item: ApprovalQueueItem) => void;
  busyId?: string | null;
  showScope?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export const RequestCardGrid: React.FC<RequestCardGridProps> = ({
  items,
  onOpen,
  busyId,
  showScope = false,
  emptyTitle = 'No requests match these filters',
  emptyDescription = 'Clear a filter or widen the period to see more requests.',
}) => {
  if (!items.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.id} className="anwar-card anwar-card-pad flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge status={item.status} />
            <SlaBadge days={item.ageDays} state={item.slaState} />
          </div>

          <div className="min-w-0">
            <p className="text-h3 text-navy-900" title={item.kpi}>
              {item.kpi}
            </p>
            <p className="anwar-mono text-caption text-ink-muted">
              {item.code} · {item.category}
            </p>
          </div>

          <dl className="grid grid-cols-1 gap-1 text-caption text-ink-secondary sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-ink-muted">Employee</dt>
              <dd className="truncate font-semibold text-ink" title={item.employeeName}>
                {item.employeeName}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-ink-muted">Employee ID</dt>
              <dd className="anwar-mono truncate">{item.employeeCode}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-ink-muted">Designation</dt>
              <dd className="truncate">{item.designation}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-ink-muted">Frequency · period</dt>
              <dd className="truncate">
                {frequencyLabel(item.frequency)} · {item.period}
              </dd>
            </div>
            {showScope ? (
              <>
                <div className="min-w-0">
                  <dt className="text-ink-muted">Business Unit</dt>
                  <dd className="truncate">{item.businessUnit}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-ink-muted">Department</dt>
                  <dd className="truncate">{item.department}</dd>
                </div>
              </>
            ) : null}
            <div className="min-w-0">
              <dt className="text-ink-muted">Submitted</dt>
              <dd>{formatDate(item.submittedAt)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-ink-muted">Evidence</dt>
              <dd>
                {item.evidenceCount} file{item.evidenceCount === 1 ? '' : 's'}
              </dd>
            </div>
          </dl>

          <div className="grid grid-cols-2 gap-2 rounded-control bg-canvas p-2 text-caption">
            <div>
              <p className="text-ink-muted">Target</p>
              <p className="anwar-mono font-semibold text-ink">
                {measured(item.target, item.measurementType, item.unit)}
              </p>
            </div>
            <div>
              <p className="text-ink-muted">Achievement</p>
              <p className="anwar-mono font-semibold text-ink">{formatPercent(item.achievement)}</p>
            </div>
          </div>

          {item.escalation ? (
            <p className="rounded-control border border-dashed border-warning bg-warning-tint px-2 py-1 text-caption text-warning">
              Escalated adjustment · Δ {item.escalation.delta} · proposed {item.escalation.proposedScore}
            </p>
          ) : null}

          <div className="mt-auto flex items-center justify-between gap-2">
            <span className="text-caption text-ink-muted">Weight {item.kpiWeight}%</span>
            <Button
              size="sm"
              onClick={() => onOpen(item)}
              loading={busyId === item.id}
              aria-label={`View request for ${item.kpi}`}
            >
              View Request
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
};

// ------------------------------------------------------------------- table

export interface RequestQueueTableProps {
  items: ApprovalQueueItem[];
  onOpen: (item: ApprovalQueueItem) => void;
  busyId?: string | null;
  showScope?: boolean;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  /** FR-APR-11 — only unadjusted requests can be bulk approved. */
  isSelectable?: (item: ApprovalQueueItem) => boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export const RequestQueueTable: React.FC<RequestQueueTableProps> = ({
  items,
  onOpen,
  busyId,
  showScope = false,
  selectable = false,
  selected = [],
  onSelectedChange,
  isSelectable,
  emptyTitle = 'No requests match these filters',
  emptyDescription = 'Clear a filter or widen the period to see more requests.',
}) => {
  if (!items.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const eligible = (item: ApprovalQueueItem): boolean => (isSelectable ? isSelectable(item) : true);
  const pageEligible = items.filter(eligible).map((item) => item.id);
  const allSelected = pageEligible.length > 0 && pageEligible.every((id) => selected.includes(id));

  const toggle = (id: string, checked: boolean) => {
    if (!onSelectedChange) return;
    onSelectedChange(checked ? Array.from(new Set([...selected, id])) : selected.filter((value) => value !== id));
  };

  const toggleAll = (checked: boolean) => {
    if (!onSelectedChange) return;
    onSelectedChange(checked ? Array.from(new Set([...selected, ...pageEligible])) : selected.filter((id) => !pageEligible.includes(id)));
  };

  return (
    <div className="overflow-x-auto">
      <table className="anwar-table sticky-first-col">
        <thead>
          <tr>
            {selectable ? (
              <th scope="col" className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-edge"
                  checked={allSelected}
                  onChange={(event) => toggleAll(event.target.checked)}
                  aria-label="Select every eligible request on this page"
                />
              </th>
            ) : null}
            <th scope="col">Status</th>
            <th scope="col">KPI</th>
            <th scope="col">Employee</th>
            <th scope="col">Designation</th>
            {showScope ? <th scope="col">Business Unit</th> : null}
            {showScope ? <th scope="col">Department</th> : null}
            <th scope="col">Period</th>
            <th scope="col">Submitted</th>
            <th scope="col">Age (SLA)</th>
            <th scope="col" className="text-right">
              Target
            </th>
            <th scope="col" className="text-right">
              Achievement
            </th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const selectableRow = selectable && eligible(item);
            return (
              <tr key={item.id}>
                {selectable ? (
                  <td>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-edge disabled:opacity-40"
                      checked={selected.includes(item.id)}
                      disabled={!selectableRow}
                      onChange={(event) => toggle(item.id, event.target.checked)}
                      aria-label={`Select ${item.kpi} for bulk approval`}
                      title={selectableRow ? undefined : 'Already adjusted or escalated — bulk approve only covers unadjusted requests'}
                    />
                  </td>
                ) : null}
                <td>
                  <StatusBadge status={item.status} />
                </td>
                <td className="min-w-[200px]">
                  <p className="font-semibold text-navy-700">{item.kpi}</p>
                  <p className="anwar-mono text-caption text-ink-muted">{item.code}</p>
                </td>
                <td className="min-w-[160px]">
                  <p className="font-semibold text-ink">{item.employeeName}</p>
                  <p className="anwar-mono text-caption text-ink-muted">{item.employeeCode}</p>
                </td>
                <td className="min-w-[150px]">{item.designation}</td>
                {showScope ? <td className="min-w-[140px]">{item.businessUnit}</td> : null}
                {showScope ? <td className="min-w-[140px]">{item.department}</td> : null}
                <td className="min-w-[140px]">
                  <p>{item.period}</p>
                  <p className="text-caption text-ink-muted">{frequencyLabel(item.frequency)}</p>
                </td>
                <td className="min-w-[120px]">{formatDate(item.submittedAt)}</td>
                <td>
                  <SlaBadge days={item.ageDays} state={item.slaState} />
                </td>
                <td className="anwar-mono whitespace-nowrap text-right">
                  {measured(item.target, item.measurementType, item.unit)}
                </td>
                <td className="anwar-mono whitespace-nowrap text-right">{formatPercent(item.achievement)}</td>
                <td>
                  <Button
                    size="sm"
                    variant="secondary"
                    className={cn('whitespace-nowrap')}
                    onClick={() => onOpen(item)}
                    loading={busyId === item.id}
                    aria-label={`View request for ${item.kpi}`}
                  >
                    View Request
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
