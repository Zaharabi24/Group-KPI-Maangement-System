/**
 * ============================================================================
 *  CorrectionsPage — route `/corrections` (UC-12, BR-R09)
 * ============================================================================
 *  An Approved KPI is read-only: the only path to a change is a correction
 *  request, which a Super Admin approves (creating a NEW version that is routed
 *  for re-approval) or declines. Department Heads raise requests and follow the
 *  ones they raised; Super Admins work the queue.
 * ============================================================================
 */
import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { KpiDetail } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { Alert, PageHeader, StatusBadge } from '@/components/ui/badges';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useDebounced } from '@/components/layout/GlobalSearch';
import { formatDateTime, formatScore } from '@/lib/format';

interface CorrectionItem {
  id: string;
  reason: string;
  status: string;
  changes: unknown;
  createdAt: string;
  requester: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  kpi: {
    id: string;
    code: string;
    name: string;
    status: string;
    employee: string;
    employeeCode: string;
    department: string;
    period: string;
    calculatedScore: string | null;
    finalScore: string | null;
  };
}

interface SearchResponse {
  query: string;
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

const statusTone = (status: string): 'warning' | 'success' | 'danger' | 'neutral' =>
  status === 'APPROVED' ? 'success' : status === 'DECLINED' ? 'danger' : status === 'PENDING' ? 'warning' : 'neutral';

const RUBRIC_LEVELS = [1, 2, 3, 4, 5];

interface ChangeValues {
  target?: string;
  actual?: string;
  kpiWeight?: string;
  rubricLevel?: string;
}

export const CorrectionsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasRole } = useAuth();
  const [searchParams] = useSearchParams();

  const isSuperAdmin = hasRole('SUPER_ADMIN');

  const [status, setStatus] = React.useState<'PENDING' | 'ALL'>('PENDING');
  const [decision, setDecision] = React.useState<{ item: CorrectionItem; kind: 'APPROVE' | 'DECLINE' } | null>(null);
  const [comment, setComment] = React.useState('');

  // --------------------------------------------------------------- raise form
  const [selectedKpiId, setSelectedKpiId] = React.useState<string>(searchParams.get('kpi') ?? '');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [changes, setChanges] = React.useState<ChangeValues>({});
  const debouncedTerm = useDebounced(searchTerm, 350);

  // `?kpi=<id>` preselects the KPI, so "Request a correction" can deep-link here.
  const kpiParam = searchParams.get('kpi');
  React.useEffect(() => {
    if (kpiParam) setSelectedKpiId(kpiParam);
  }, [kpiParam]);

  const correctionsQuery = useQuery({
    queryKey: ['corrections', status],
    queryFn: () => api.get<CorrectionItem[]>('/corrections', { status: status === 'PENDING' ? 'PENDING' : undefined }),
    placeholderData: keepPreviousData,
  });

  const searchQuery = useQuery({
    queryKey: ['search', debouncedTerm],
    queryFn: () => api.get<SearchResponse>('/search', { q: debouncedTerm, limit: 10 }),
    enabled: !selectedKpiId && debouncedTerm.trim().length >= 2,
  });

  const selectedKpiQuery = useQuery({
    queryKey: ['kpi', selectedKpiId],
    queryFn: () => api.get<KpiDetail>(`/kpis/${selectedKpiId}`),
    enabled: Boolean(selectedKpiId),
  });
  const selectedKpi = selectedKpiQuery.data;

  const raiseMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string; status: string; message: string }>('/corrections', {
        kpiId: selectedKpiId,
        reason: reason.trim(),
        changes: buildChanges(),
      }),
    onSuccess: (result) => {
      toast.success('Correction request submitted', result.message);
      setReason('');
      setChanges({});
      setSelectedKpiId('');
      setSearchTerm('');
      queryClient.invalidateQueries({ queryKey: ['corrections'] });
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : 'The correction request could not be sent.';
      toast.error('Could not request the correction', message);
    },
  });

  const decideMutation = useMutation({
    mutationFn: (payload: { id: string; kind: 'APPROVE' | 'DECLINE'; comment?: string }) =>
      api.post<{ id: string; decision: string; message: string }>(`/corrections/${payload.id}/decision`, {
        decision: payload.kind,
        comment: payload.comment?.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast.success(result.decision === 'APPROVE' ? 'Correction approved' : 'Correction declined', result.message);
      queryClient.invalidateQueries({ queryKey: ['corrections'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'department'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'group'] });
      setDecision(null);
      setComment('');
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : 'The correction could not be decided.';
      toast.error('Could not record the decision', message);
    },
  });

  const buildChanges = (): Record<string, number> | undefined => {
    const next: Record<string, number> = {};
    const push = (key: keyof ChangeValues, field: string) => {
      const raw = changes[key];
      if (raw === undefined || raw.trim() === '') return;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) next[field] = parsed;
    };
    if (selectedKpi?.measurementType === 'QUALITATIVE') {
      push('rubricLevel', 'rubricLevel');
    } else {
      push('target', 'target');
      push('actual', 'actual');
    }
    push('kpiWeight', 'kpiWeight');
    return Object.keys(next).length ? next : undefined;
  };

  const items = correctionsQuery.data ?? [];
  const pending = items.filter((item) => item.status === 'PENDING');
  const visible = status === 'PENDING' ? pending : items;
  const canRaise = Boolean(selectedKpiId) && reason.trim().length >= 15;

  return (
    <div>
      <PageHeader
        title="Correction requests"
        subtitle="An approved KPI is read-only — a correction request is the only path to a change (BR-R09, UC-12)."
        actions={
          <SegmentedControl
            ariaLabel="Correction status"
            value={status}
            onChange={(key) => setStatus(key === 'ALL' ? 'ALL' : 'PENDING')}
            items={[
              { key: 'PENDING', label: 'Pending', count: pending.length },
              { key: 'ALL', label: 'All' },
            ]}
          />
        }
      />

      <Alert tone="info" title="How corrections work" className="mb-4">
        A correction request records the reason and the proposed values. When a Super Admin approves it, the KPI moves to
        a <span className="font-semibold">new version</span> and is routed for re-approval; declining keeps the approved
        values untouched.
      </Alert>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        {/* ------------------------------------------------------------- queue */}
        <Card>
          <CardHeader
            title={isSuperAdmin ? 'Correction queue' : 'My correction requests'}
            subtitle={
              isSuperAdmin
                ? 'Approve to create a new version and route it for re-approval, or decline with a comment.'
                : 'The requests you raised, including their outcome.'
            }
          />

          {correctionsQuery.error ? (
            <Alert tone="danger" title="Corrections could not be loaded">
              {correctionsQuery.error instanceof Error ? correctionsQuery.error.message : 'Please try again.'}
            </Alert>
          ) : correctionsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              title={status === 'PENDING' ? 'No correction request is waiting' : 'No correction requests recorded'}
              description="Approved KPIs stay read-only until a correction is requested and approved."
            />
          ) : (
            <ul className="space-y-3">
              {visible.map((item) => (
                <li key={item.id} className="rounded-control border border-edge p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/my-kpi/${item.kpi.id}`} className="text-body font-semibold text-navy-700 hover:underline">
                        {item.kpi.name}
                      </Link>
                      <p className="anwar-mono text-caption text-ink-muted">
                        {item.kpi.code} · {item.kpi.employee} ({item.kpi.employeeCode}) · {item.kpi.department} ·{' '}
                        {item.kpi.period}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={item.kpi.status} />
                      <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                    </div>
                  </div>

                  <blockquote className="mt-2 rounded-control border-l-4 border-info bg-info-tint px-3 py-2 text-caption text-ink-secondary">
                    {item.reason}
                  </blockquote>

                  <p className="mt-2 text-caption text-ink-secondary">
                    Raised by {item.requester} · {formatDateTime(item.createdAt)} · CS{' '}
                    <span className="anwar-mono">{formatScore(item.kpi.calculatedScore)}</span> · FS{' '}
                    <span className="anwar-mono">{formatScore(item.kpi.finalScore)}</span>
                  </p>

                  {item.decidedBy ? (
                    <p className="mt-1 text-caption text-ink-secondary">
                      Decided by {item.decidedBy}
                      {item.decidedAt ? ` · ${formatDateTime(item.decidedAt)}` : ''}
                      {item.decisionComment ? ` · ${item.decisionComment}` : ''}
                    </p>
                  ) : null}

                  {isSuperAdmin && item.status === 'PENDING' ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setDecision({ item, kind: 'APPROVE' });
                          setComment('');
                        }}
                      >
                        Approve correction
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          setDecision({ item, kind: 'DECLINE' });
                          setComment('');
                        }}
                      >
                        Decline
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* -------------------------------------------------------- raise form */}
        <Card>
          <CardHeader
            title="Raise a correction request"
            subtitle="Pick the approved KPI, explain why and (optionally) propose the corrected values."
          />

          {selectedKpiId && selectedKpi ? (
            <div className="rounded-control border border-edge bg-canvas p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold text-ink">{selectedKpi.name}</p>
                  <p className="anwar-mono text-caption text-ink-muted">
                    {selectedKpi.code} · {selectedKpi.employee.fullName} ({selectedKpi.employee.employeeCode}) ·{' '}
                    {selectedKpi.period.label}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedKpiId('');
                    setChanges({});
                  }}
                >
                  Change KPI
                </Button>
              </div>
              {selectedKpi.status !== 'APPROVED' ? (
                <Alert tone="warning" className="mt-2" title="Only approved KPIs can be corrected">
                  This KPI is {selectedKpi.status}. Edit it directly while it is still in review.
                </Alert>
              ) : null}
            </div>
          ) : (
            <div>
              <Field label="KPI" htmlFor="correction-search" hint="Search by KPI name, KPI code, employee name or Employee ID.">
                <Input
                  id="correction-search"
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search for an approved KPI…"
                  aria-label="Search for an approved KPI by name or code"
                />
              </Field>
              {debouncedTerm.trim().length >= 2 ? (
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                  {(searchQuery.data?.kpis ?? []).length === 0 ? (
                    <li className="px-1 py-2 text-caption text-ink-secondary">
                      {searchQuery.isFetching ? 'Searching…' : 'No KPI matches this search within your scope.'}
                    </li>
                  ) : (
                    (searchQuery.data?.kpis ?? []).map((kpi) => (
                      <li key={kpi.id}>
                        <button
                          type="button"
                          className="w-full rounded-control border border-edge px-3 py-2 text-left hover:bg-navy-50"
                          onClick={() => {
                            setSelectedKpiId(kpi.id);
                            setChanges({});
                          }}
                        >
                          <span className="block text-body font-semibold text-ink">{kpi.name}</span>
                          <span className="anwar-mono block text-caption text-ink-muted">
                            {kpi.code} · {kpi.employeeName} ({kpi.employeeCode}) · {kpi.period}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>
          )}

          {selectedKpiId ? (
            <>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {selectedKpi?.measurementType === 'QUALITATIVE' ? (
                  <Field label="Corrected rubric level (optional)" htmlFor="correction-rubric">
                    <Select
                      id="correction-rubric"
                      value={changes.rubricLevel ?? ''}
                      onChange={(event) => setChanges((current) => ({ ...current, rubricLevel: event.target.value }))}
                    >
                      <option value="">No change</option>
                      {RUBRIC_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          Level {level}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <>
                    <Field label="Corrected target (optional)" htmlFor="correction-target">
                      <Input
                        id="correction-target"
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        value={changes.target ?? ''}
                        onChange={(event) => setChanges((current) => ({ ...current, target: event.target.value }))}
                      />
                    </Field>
                    <Field label="Corrected actual (optional)" htmlFor="correction-actual">
                      <Input
                        id="correction-actual"
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        value={changes.actual ?? ''}
                        onChange={(event) => setChanges((current) => ({ ...current, actual: event.target.value }))}
                      />
                    </Field>
                  </>
                )}
                <Field label="Corrected KPI weight % (optional)" htmlFor="correction-weight">
                  <Input
                    id="correction-weight"
                    type="number"
                    step="1"
                    inputMode="decimal"
                    value={changes.kpiWeight ?? ''}
                    onChange={(event) => setChanges((current) => ({ ...current, kpiWeight: event.target.value }))}
                  />
                </Field>
              </div>

              <Field
                label="Reason"
                className="mt-3"
                required
                hint={`${reason.trim().length}/15 characters minimum`}
                error={reason.length > 0 && reason.trim().length < 15 ? 'Use at least 15 characters' : undefined}
              >
                <Textarea
                  rows={3}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="What is wrong with the approved values, and why?"
                />
              </Field>

              <div className="mt-3 flex justify-end">
                <Button
                  disabled={!canRaise || selectedKpi?.status !== 'APPROVED'}
                  loading={raiseMutation.isPending}
                  onClick={() => raiseMutation.mutate()}
                >
                  Send correction request
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-3 text-caption text-ink-secondary">
              Approved KPIs are read-only (BR-R09). A correction request routes to the Super Admin queue and, once
              approved, creates a new KPI version that is re-approved before it counts.
            </p>
          )}
        </Card>
      </div>

      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision?.kind === 'APPROVE' ? 'Approve this correction?' : 'Decline this correction?'}
        description={decision ? `${decision.item.kpi.name} · ${decision.item.kpi.employeeCode}` : undefined}
        size="sm"
        destructive={decision?.kind === 'DECLINE'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button
              variant={decision?.kind === 'DECLINE' ? 'danger' : 'primary'}
              loading={decideMutation.isPending}
              onClick={() => {
                if (!decision) return;
                decideMutation.mutate({ id: decision.item.id, kind: decision.kind, comment });
              }}
            >
              {decision?.kind === 'APPROVE' ? 'Approve correction' : 'Decline correction'}
            </Button>
          </>
        }
      >
        {decision ? (
          <div className="space-y-3">
            {decision.kind === 'APPROVE' ? (
              <Alert tone="warning" title="Approving creates a NEW version">
                The corrected values are applied, a new KPI version is created and the KPI is routed for re-approval (or
                kept Approved in a closed period). The employee and the requester are notified (NT-18).
              </Alert>
            ) : (
              <Alert tone="info" title="The approved values stay unchanged">
                Declining closes the request; the KPI remains Approved with its current scores. The requester is notified
                (NT-18).
              </Alert>
            )}
            <Field label="Comment (optional)" hint="Recorded in the audit trail.">
              <Textarea
                rows={3}
                maxLength={1000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Add context for this decision…"
              />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default CorrectionsPage;
