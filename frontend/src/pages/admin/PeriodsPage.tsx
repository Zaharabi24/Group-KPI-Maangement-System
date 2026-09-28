/**
 * ============================================================================
 *  M15 · Period calendar & close workflow — FR-CFG-01, FR-CFG-03, FR-CFG-04, UC-09
 * ============================================================================
 *  · Calendar generated for a year with configuration-derived deadlines.
 *  · Close is blocked while any KPI is Submitted / Under Review / Escalated
 *    (AC-18) — the checklist is fetched before the confirmation.
 *  · Reopen requires a reason ≥ 15 characters and is audited + notified (BR-R12).
 *  · Extensions are granted per KPI (EC-09) with a KPI picker from /search.
 * ============================================================================
 */
import React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import type { Frequency, KpiPeriodSummary, KpiStatus, Paginated, PeriodStatus } from '@/lib/types';
import { formatDate, titleCase } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { Alert, DeadlineLabel, PageHeader, StatusBadge } from '@/components/ui/badges';
import { useDebounced } from '@/components/layout/GlobalSearch';
import { useToast } from '@/context/ToastContext';

// ------------------------------------------------------------------- helpers

const FREQUENCY_LABELS: Record<Frequency, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};

const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
};

const periodStatusTone = (status: PeriodStatus): 'success' | 'neutral' | 'warning' =>
  status === 'OPEN' ? 'success' : status === 'CLOSED' ? 'neutral' : 'warning';

const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'The request could not be completed.';

interface OutstandingKpi {
  id: string;
  code: string;
  name: string;
  status: KpiStatus;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string | null;
  weight: number;
}

interface OutstandingResult {
  counts: { pending: number; notSubmitted: number; weightIncomplete: number; total: number };
  pending: OutstandingKpi[];
  notSubmitted: OutstandingKpi[];
  weightIncomplete: Array<{
    employeeId: string;
    employeeName: string;
    employeeCode: string;
    department: string | null;
    allocatedWeight: number;
    remaining: number;
  }>;
}

interface SearchResponse {
  kpis: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    employeeName: string;
    employeeCode: string;
    period: string;
  }>;
}

// -------------------------------------------------------------- close modal

const ClosePeriodModal: React.FC<{ period: KpiPeriodSummary | null; onClose: () => void }> = ({ period, onClose }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState('');

  const outstandingQuery = useQuery({
    queryKey: ['admin', 'periods', 'outstanding', period?.id],
    queryFn: () => api.get<OutstandingResult>(`/admin/periods/${period?.id}/outstanding`),
    enabled: Boolean(period),
  });

  React.useEffect(() => {
    if (period) setReason('');
  }, [period]);

  const mutation = useMutation({
    mutationFn: (payload: { id: string; reason: string }) =>
      api.post<{ snapshotsWritten: number; lockedKpis: number }>(`/admin/periods/${payload.id}/close`, {
        ...(payload.reason.trim() ? { reason: payload.reason.trim() } : {}),
      }),
    onSuccess: (result) => {
      toast.success(
        'Period closed',
        `${result.lockedKpis} KPI(s) locked · ${result.snapshotsWritten} performance snapshot(s) written.`,
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'periods'] });
      queryClient.invalidateQueries({ queryKey: ['periods'] });
      onClose();
    },
    onError: (error) => toast.error('Could not close the period', messageOf(error)),
  });

  const outstanding = outstandingQuery.data;
  const pending = outstanding?.counts.pending ?? 0;
  const blocked = pending > 0;

  const list = (items: OutstandingKpi[], emptyText: string) =>
    items.length ? (
      <ul className="anwar-scroll max-h-40 divide-y divide-edge/70 rounded-control border border-edge">
        {items.map((item) => (
          <li key={item.id} className="px-3 py-1.5 text-caption">
            <span className="anwar-mono mr-2">{item.code}</span>
            <span className="font-medium text-ink">{item.name}</span>
            <span className="text-ink-muted"> · {item.employeeName} · </span>
            <StatusBadge status={item.status} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-caption text-success">{emptyText}</p>
    );

  return (
    <Modal
      open={Boolean(period)}
      onClose={onClose}
      title="Close period"
      description={period ? `${period.label} · ${FREQUENCY_LABELS[period.frequency]}` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={mutation.isPending}
            disabled={blocked || outstandingQuery.isPending || outstandingQuery.isError}
            onClick={() => {
              if (period && !blocked) mutation.mutate({ id: period.id, reason });
            }}
          >
            Close period
          </Button>
        </>
      }
    >
      <Alert tone="warning" className="mb-4">
        Closing locks every KPI of the period, writes performance snapshots and publishes the results to employees
        (NT-16). A closed period can only be changed through a reasoned reopen (BR-R12).
      </Alert>

      {outstandingQuery.isError ? (
        <Alert
          tone="danger"
          title="The close checklist could not be loaded"
          actions={
            <Button size="sm" variant="secondary" onClick={() => void outstandingQuery.refetch()}>
              Retry
            </Button>
          }
        >
          {messageOf(outstandingQuery.error)}
        </Alert>
      ) : outstandingQuery.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : outstanding ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-control border border-edge px-3 py-2">
              <p className="text-caption text-ink-secondary">Pending decisions</p>
              <p className={`tnum text-h3 ${outstanding.counts.pending ? 'text-danger' : 'text-success'}`}>
                {outstanding.counts.pending}
              </p>
            </div>
            <div className="rounded-control border border-edge px-3 py-2">
              <p className="text-caption text-ink-secondary">Not submitted</p>
              <p className="tnum text-h3 text-navy-900">{outstanding.counts.notSubmitted}</p>
            </div>
            <div className="rounded-control border border-edge px-3 py-2">
              <p className="text-caption text-ink-secondary">Weight incomplete</p>
              <p className="tnum text-h3 text-navy-900">{outstanding.counts.weightIncomplete}</p>
            </div>
          </div>

          {blocked ? (
            <Alert tone="danger" title="A period with pending requests cannot be closed">
              {pending} item(s) are still Submitted, Under Review or Escalated (AC-18). Decide every request before
              closing the period.
            </Alert>
          ) : (
            <Alert tone="success" title="No pending requests">
              The close checklist has no submitted, under-review or escalated KPIs. The period can be closed.
            </Alert>
          )}

          <div>
            <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-secondary">
              Pending items (submitted / under review / escalated)
            </p>
            {list(outstanding.pending, 'No pending decisions.')}
          </div>

          <div>
            <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-secondary">
              Not-submitted KPIs (locked and scored 0 on close)
            </p>
            {list(outstanding.notSubmitted, 'Every KPI was submitted.')}
          </div>

          <div>
            <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-secondary">
              Employees with incomplete weight
            </p>
            {outstanding.weightIncomplete.length ? (
              <ul className="anwar-scroll max-h-32 divide-y divide-edge/70 rounded-control border border-edge">
                {outstanding.weightIncomplete.map((row) => (
                  <li key={row.employeeId} className="flex items-center justify-between gap-2 px-3 py-1.5 text-caption">
                    <span>
                      <span className="font-medium text-ink">{row.employeeName}</span>{' '}
                      <span className="text-ink-muted">· {row.department ?? '—'}</span>
                    </span>
                    <span className="tnum text-ink-secondary">
                      {row.allocatedWeight}% allocated · {row.remaining}% free
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-success">Every employee allocated 100% weight.</p>
            )}
          </div>

          <Field label="Reason" htmlFor="close-reason" hint="Optional — recorded in the audit trail with the close.">
            <Textarea
              id="close-reason"
              value={reason}
              rows={2}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
};

// ------------------------------------------------------------- reopen modal

const ReopenPeriodModal: React.FC<{ period: KpiPeriodSummary | null; onClose: () => void }> = ({ period, onClose }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (period) {
      setReason('');
      setTouched(false);
    }
  }, [period]);

  const mutation = useMutation({
    mutationFn: (payload: { id: string; reason: string }) =>
      api.post<{ unlockedKpis: number }>(`/admin/periods/${payload.id}/reopen`, { reason: payload.reason }),
    onSuccess: (result) => {
      toast.success('Period reopened', `${result.unlockedKpis} KPI(s) were unlocked for corrections.`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'periods'] });
      queryClient.invalidateQueries({ queryKey: ['periods'] });
      onClose();
    },
    onError: (error) => toast.error('Could not reopen the period', messageOf(error)),
  });

  const tooShort = reason.trim().length < 15;

  return (
    <Modal
      open={Boolean(period)}
      onClose={onClose}
      title="Reopen period"
      description={period ? `${period.label} · currently ${PERIOD_STATUS_LABELS[period.status]}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={mutation.isPending}
            disabled={tooShort}
            onClick={() => {
              setTouched(true);
              if (period && !tooShort) mutation.mutate({ id: period.id, reason: reason.trim() });
            }}
          >
            Reopen period
          </Button>
        </>
      }
    >
      <Alert tone="warning" className="mb-4" title="Closing is locked; reopening is audited and notified">
        Reopening unlocks only the KPIs that are Draft, Returned, Rejected or Not Submitted so they can be corrected.
        Approved KPIs stay locked and audited. Every Super Admin is notified and the reopen reason is written to the
        audit trail (BR-R12).
      </Alert>
      <Field
        label="Reason"
        htmlFor="reopen-reason"
        required
        hint="At least 15 characters."
        error={touched && tooShort ? 'Enter at least 15 characters.' : null}
      >
        <Textarea
          id="reopen-reason"
          value={reason}
          rows={3}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          invalid={touched && tooShort}
        />
      </Field>
    </Modal>
  );
};

// ----------------------------------------------------------- extension modal

const GrantExtensionModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [term, setTerm] = React.useState('');
  const debounced = useDebounced(term, 300);
  const [kpiId, setKpiId] = React.useState('');
  const [days, setDays] = React.useState(7);
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTerm('');
      setKpiId('');
      setDays(7);
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const searchQuery = useQuery({
    queryKey: ['global-search', debounced, 'extension-picker'],
    queryFn: () => api.get<SearchResponse>('/search', { q: debounced, limit: 8 }),
    enabled: open && debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (payload: { kpiId: string; days: number; reason: string }) =>
      api.post<{ statusAfter: KpiStatus; until: string }>('/admin/periods/extensions', payload),
    onSuccess: (result) => {
      toast.success(
        'Extension granted',
        result.statusAfter === 'DRAFT'
          ? 'The Not Submitted KPI is back in Draft so the employee can finish it (EC-09).'
          : 'The employee was notified with the new deadline.',
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'periods'] });
      onClose();
    },
    onError: (error) => toast.error('Could not grant the extension', messageOf(error)),
  });

  const reasonTooShort = reason.trim().length < 15;
  const daysInvalid = days < 1 || days > 7;
  const kpis = searchQuery.data?.kpis ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Grant an extension"
      description="FR-CFG-04 / EC-09 — extend one KPI's submission deadline."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!kpiId || daysInvalid || reasonTooShort}
            onClick={() => {
              setTouched(true);
              if (kpiId && !daysInvalid && !reasonTooShort) {
                mutation.mutate({ kpiId, days, reason: reason.trim() });
              }
            }}
          >
            Grant extension
          </Button>
        </>
      }
    >
      <Alert tone="info" className="mb-4">
        Extensions are up to 7 days by default (the active configuration defines the maximum). A Not Submitted KPI goes
        back to Draft so the employee can finish the submission (EC-09); the employee is notified with the new deadline.
      </Alert>

      <div className="space-y-4">
        <Field label="Find KPI" htmlFor="extension-search" hint="Search by KPI name, KPI code, employee name or Employee ID.">
          <Input
            id="extension-search"
            type="search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setKpiId('');
            }}
            placeholder="Type at least 2 characters…"
          />
        </Field>

        {debounced.trim().length >= 2 ? (
          searchQuery.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : kpis.length ? (
            <ul className="anwar-scroll max-h-48 divide-y divide-edge/70 rounded-control border border-edge">
              {kpis.map((kpi) => (
                <li key={kpi.id}>
                  <button
                    type="button"
                    onClick={() => setKpiId(kpi.id)}
                    className={`w-full px-3 py-2 text-left hover:bg-navy-50 ${kpiId === kpi.id ? 'bg-navy-50' : ''}`}
                  >
                    <p className="text-caption font-semibold text-ink">
                      <span className="anwar-mono mr-2">{kpi.code}</span>
                      {kpi.name}
                    </p>
                    <p className="text-[11px] text-ink-secondary">
                      {kpi.employeeName} · {kpi.employeeCode} · {kpi.period} ·{' '}
                      {titleCase(kpi.status)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-ink-secondary">No KPI matched “{debounced}”.</p>
          )
        ) : null}

        {kpiId ? (
          <p className="text-caption text-success">KPI selected. Choose the extension length and give a reason.</p>
        ) : null}

        <Field
          label="Extension days"
          htmlFor="extension-days"
          required
          hint="1–7 by default."
          error={daysInvalid ? 'Enter between 1 and 7 days.' : null}
        >
          <Input
            id="extension-days"
            type="number"
            min={1}
            max={7}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            invalid={daysInvalid}
          />
        </Field>

        <Field
          label="Reason"
          htmlFor="extension-reason"
          required
          hint="At least 15 characters — recorded in the audit trail."
          error={touched && reasonTooShort ? 'Enter at least 15 characters.' : null}
        >
          <Textarea
            id="extension-reason"
            value={reason}
            rows={3}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
            invalid={touched && reasonTooShort}
          />
        </Field>
      </div>
    </Modal>
  );
};

// ------------------------------------------------------------------- page

const PeriodsPage: React.FC = () => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const currentYear = new Date().getFullYear();
  const [frequency, setFrequency] = React.useState('');
  const [year, setYear] = React.useState(String(currentYear));
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(25);

  const [closeTarget, setCloseTarget] = React.useState<KpiPeriodSummary | null>(null);
  const [reopenTarget, setReopenTarget] = React.useState<KpiPeriodSummary | null>(null);
  const [extensionOpen, setExtensionOpen] = React.useState(false);
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const [calendarYear, setCalendarYear] = React.useState(String(currentYear));

  const query = useQuery({
    queryKey: ['admin', 'periods', { frequency, year, status, page, size }],
    queryFn: () =>
      api.get<Paginated<KpiPeriodSummary>>('/admin/periods', {
        frequency: frequency || undefined,
        year: year || undefined,
        status: status || undefined,
        page,
        size,
      }),
    placeholderData: keepPreviousData,
  });

  const calendarMutation = useMutation({
    mutationFn: (payload: number) => api.post<{ created: number; existing: number }>('/admin/periods/calendar', { year: payload }),
    onSuccess: (result) => {
      toast.success(
        'Calendar generated',
        `${result.created} period(s) created · ${result.existing} already existed and were re-aligned.`,
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'periods'] });
      queryClient.invalidateQueries({ queryKey: ['periods'] });
      setCalendarOpen(false);
    },
    onError: (error) => toast.error('Could not generate the calendar', messageOf(error)),
  });

  const data = query.data;

  return (
    <>
      <PageHeader
        title="Period calendar"
        subtitle="M15 — generate the calendar, monitor deadlines, close a period and reopen it when corrections are needed."
        actions={
          <>
            <Button variant="secondary" onClick={() => setExtensionOpen(true)}>
              Grant extension
            </Button>
            <Button
              onClick={() => {
                setCalendarYear(year || String(currentYear));
                setCalendarOpen(true);
              }}
            >
              Generate calendar for {year || currentYear}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader
          title="Periods"
          subtitle="Server-paged at 25 / 50 / 100 rows. Pending counts come from the close-blocking statuses (Submitted, Under Review, Escalated)."
        />

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Frequency" htmlFor="periods-frequency-filter">
            <Select
              id="periods-frequency-filter"
              value={frequency}
              onChange={(event) => {
                setFrequency(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All frequencies</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="YEARLY">Yearly</option>
            </Select>
          </Field>

          <Field label="Year" htmlFor="periods-year-filter" hint="Leave blank to include every year.">
            <Input
              id="periods-year-filter"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(event) => {
                setYear(event.target.value);
                setPage(1);
              }}
            />
          </Field>

          <Field label="Status" htmlFor="periods-status-filter">
            <Select
              id="periods-status-filter"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
              <option value="REOPENED">Reopened</option>
            </Select>
          </Field>
        </div>

        {query.isError ? (
          <ErrorState message={messageOf(query.error)} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            title="No periods match your filters"
            description="Generate the calendar for a year to create the monthly, quarterly and yearly periods."
            action={
              <Button
                onClick={() => {
                  setCalendarYear(year || String(currentYear));
                  setCalendarOpen(true);
                }}
              >
                Generate calendar
              </Button>
            }
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="anwar-table sticky-first-col">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Frequency</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Submission deadline</th>
                    <th>Review deadline</th>
                    <th>Status</th>
                    <th className="text-right">KPIs</th>
                    <th className="text-right">Pending</th>
                    <th className="text-right">Approved</th>
                    <th className="text-right">Not submitted</th>
                    <th className="text-right">Snapshots</th>
                    <th>Days to deadline</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((period) => (
                    <tr key={period.id}>
                      <td>
                        <p className="font-semibold text-ink">{period.label}</p>
                        <p className="anwar-mono text-caption text-ink-secondary">{period.code}</p>
                      </td>
                      <td>{FREQUENCY_LABELS[period.frequency]}</td>
                      <td>{formatDate(period.startDate)}</td>
                      <td>{formatDate(period.endDate)}</td>
                      <td>{formatDate(period.submissionDeadline)}</td>
                      <td>{formatDate(period.reviewDeadline)}</td>
                      <td>
                        <Badge tone={periodStatusTone(period.status)}>{PERIOD_STATUS_LABELS[period.status]}</Badge>
                      </td>
                      <td className="tnum text-right">{period.kpiCount ?? 0}</td>
                      <td className="tnum text-right">
                        <span className={(period.pendingCount ?? 0) > 0 ? 'font-semibold text-danger' : ''}>
                          {period.pendingCount ?? 0}
                        </span>
                      </td>
                      <td className="tnum text-right">{period.approvedCount ?? 0}</td>
                      <td className="tnum text-right">{period.notSubmittedCount ?? 0}</td>
                      <td className="tnum text-right">{period.snapshotCount ?? 0}</td>
                      <td>
                        <DeadlineLabel days={period.daysToDeadline} state={period.deadlineState ?? null} />
                      </td>
                      <td className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {period.status === 'CLOSED' ? (
                            <Button size="sm" variant="secondary" onClick={() => setReopenTarget(period)}>
                              Reopen
                            </Button>
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => setCloseTarget(period)}>
                              Close
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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
          </>
        )}
      </Card>

      <ClosePeriodModal period={closeTarget} onClose={() => setCloseTarget(null)} />
      <ReopenPeriodModal period={reopenTarget} onClose={() => setReopenTarget(null)} />
      <GrantExtensionModal open={extensionOpen} onClose={() => setExtensionOpen(false)} />

      <Modal
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        title="Generate the period calendar"
        description="FR-CFG-01 — creates every period of the year with deadlines derived from the active configuration."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCalendarOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={calendarMutation.isPending}
              onClick={() => calendarMutation.mutate(Number(calendarYear))}
            >
              Generate calendar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Year" htmlFor="calendar-year" required hint="Between 2000 and 2100.">
            <Input
              id="calendar-year"
              type="number"
              min={2000}
              max={2100}
              value={calendarYear}
              onChange={(event) => setCalendarYear(event.target.value)}
            />
          </Field>
          <Alert tone="info">
            Generation is idempotent: existing periods are kept and their deadlines are re-aligned while they are still
            open. Monthly, quarterly and yearly calendars are all generated.
          </Alert>
        </div>
      </Modal>
    </>
  );
};

export default PeriodsPage;
