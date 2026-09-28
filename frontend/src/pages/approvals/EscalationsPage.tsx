/**
 * ============================================================================
 *  EscalationsPage — route `/escalations` (UC-05, FR-APR-09)
 * ============================================================================
 *  A Super Admin decides every adjustment whose Δ falls outside the configured
 *  band (ADJ-2). Approving applies the proposed Final Score; declining returns
 *  the KPI to Under Review with the adjustment reversed.
 * ============================================================================
 */
import React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { EscalationItem } from '@/lib/types';
import { Button, Badge, Card, EmptyState, Field, Modal, Pagination, SegmentedControl, Skeleton, Textarea } from '@/components/ui';
import { Alert, PageHeader, SlaBadge, StatusBadge } from '@/components/ui/badges';
import { useToast } from '@/context/ToastContext';
import { formatDate, formatPercent, formatScore, measured } from '@/lib/format';

interface EscalationListResponse {
  items: EscalationItem[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

interface PendingChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

const statusTone = (status: string): 'warning' | 'success' | 'danger' =>
  status === 'APPROVED' ? 'success' : status === 'DECLINED' ? 'danger' : 'warning';

const slaStateFor = (ageDays: number): 'within' | 'at_risk' | 'breached' =>
  ageDays <= 3 ? 'within' : ageDays <= 5 ? 'at_risk' : 'breached';

export const EscalationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [status, setStatus] = React.useState<'PENDING' | 'APPROVED' | 'DECLINED'>('PENDING');
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(25);
  const [decision, setDecision] = React.useState<{ item: EscalationItem; kind: 'APPROVE' | 'DECLINE' } | null>(null);
  const [comment, setComment] = React.useState('');

  React.useEffect(() => {
    setPage(1);
  }, [status, size]);

  const escalationsQuery = useQuery({
    queryKey: ['escalations', status, page, size],
    queryFn: () =>
      api.get<EscalationListResponse>('/escalations', {
        status,
        page,
        size,
      }),
    placeholderData: keepPreviousData,
  });

  const decideMutation = useMutation({
    mutationFn: (payload: { id: string; kind: 'APPROVE' | 'DECLINE'; comment?: string }) =>
      api.post<{ id: string; decision: string; message: string }>(`/escalations/${payload.id}/decision`, {
        decision: payload.kind,
        comment: payload.comment?.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast.success(result.decision === 'APPROVE' ? 'Escalation approved' : 'Escalation declined', result.message);
      queryClient.invalidateQueries({ queryKey: ['escalations'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'department'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'group'] });
      setDecision(null);
      setComment('');
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : 'The escalation could not be decided.';
      toast.error('Could not record the decision', message);
    },
  });

  const data = escalationsQuery.data;
  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Escalated adjustments"
        subtitle="An adjustment whose Δ falls outside the configured band is decided by a Super Admin (ADJ-2, UC-05)."
        actions={
          <SegmentedControl
            ariaLabel="Escalation status"
            value={status}
            onChange={(key) => setStatus(key as typeof status)}
            items={[
              { key: 'PENDING', label: 'Pending' },
              { key: 'APPROVED', label: 'Approved' },
              { key: 'DECLINED', label: 'Declined' },
            ]}
          />
        }
      />

      {escalationsQuery.error ? (
        <Alert tone="danger" title="Escalations could not be loaded">
          {escalationsQuery.error instanceof Error ? escalationsQuery.error.message : 'Please try again.'}
        </Alert>
      ) : escalationsQuery.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title={status === 'PENDING' ? 'No escalations waiting' : 'Nothing to show for this status'}
            description={
              status === 'PENDING'
                ? 'Adjustments inside the band are approved directly by the approver — they never reach this queue.'
                : 'Switch to another status to see decided escalations.'
            }
          />
        </Card>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => {
            const pendingChanges: PendingChange[] = Array.isArray(item.pendingChanges)
              ? (item.pendingChanges as PendingChange[])
              : [];
            const isPending = item.status === 'PENDING';
            return (
              <li key={item.id} className="anwar-card anwar-card-pad">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={isPending ? 'ESCALATED' : item.status === 'APPROVED' ? 'APPROVED' : 'UNDER_REVIEW'} />
                      <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                      {item.ageDays > 3 ? (
                        <span className="anwar-badge bg-warning-tint text-warning" title="UC-05 E1 — flagged on the Group Dashboard">
                          Waiting more than 3 working days
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-h3 text-navy-900">{item.kpi}</p>
                    <p className="anwar-mono text-caption text-ink-muted">
                      {item.kpiCode} · {item.category} · Weight {item.kpiWeight}% · {item.evidenceCount} evidence file
                      {item.evidenceCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <SlaBadge days={item.ageDays} state={slaStateFor(item.ageDays)} />
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                  <div className="space-y-3">
                    <dl className="grid grid-cols-1 gap-1 text-caption text-ink-secondary sm:grid-cols-2">
                      <div>
                        <dt className="text-ink-muted">Employee</dt>
                        <dd className="font-semibold text-ink">{item.employeeName}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Employee ID</dt>
                        <dd className="anwar-mono">{item.employeeCode}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Designation</dt>
                        <dd>{item.designation}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Department · period</dt>
                        <dd>
                          {item.department} · {item.period}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Target</dt>
                        <dd className="anwar-mono">{measured(item.target, undefined)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Actual</dt>
                        <dd className="anwar-mono">{measured(item.actual, undefined)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Achievement</dt>
                        <dd className="anwar-mono">{formatPercent(item.achievement)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Requested</dt>
                        <dd>
                          {item.requestedBy} · {formatDate(item.createdAt)}
                        </dd>
                      </div>
                    </dl>

                    <div>
                      <p className="text-caption font-medium uppercase tracking-wide text-ink-secondary">Reason</p>
                      <blockquote className="mt-1 rounded-control border-l-4 border-warning bg-warning-tint px-3 py-2 text-body text-ink-secondary">
                        {item.reason}
                      </blockquote>
                    </div>

                    {pendingChanges.length ? (
                      <div>
                        <p className="text-caption font-medium uppercase tracking-wide text-ink-secondary">
                          Adjustment requested
                        </p>
                        <ul className="mt-1 space-y-1 text-caption text-ink-secondary">
                          {pendingChanges.map((change) => (
                            <li key={`${item.id}-${change.field}`}>
                              <span className="font-semibold text-ink">{change.field}</span>:{' '}
                              <span className="anwar-mono">{change.oldValue ?? '—'}</span> →{' '}
                              <span className="anwar-mono">{change.newValue ?? '—'}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>

                  {/* ------------------------------------- compare CS and override */}
                  <div className="rounded-control border border-edge bg-canvas p-3">
                    <p className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-secondary">
                      Compare CS and the override
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-control border border-edge bg-surface p-2 text-center">
                        <p className="text-caption text-ink-secondary">Calculated Score</p>
                        <p className="anwar-mono text-h2 text-navy-900">{formatScore(item.calculatedScore)}</p>
                      </div>
                      <div className="rounded-control border border-warning bg-surface p-2 text-center">
                        <p className="text-caption text-ink-secondary">Proposed final score</p>
                        <p className="anwar-mono text-h2 text-warning">{formatScore(item.proposedScore)}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-center text-body">
                      Δ <span className="anwar-mono font-semibold text-ink">{formatScore(item.delta)}</span>
                    </p>
                    <p className="mt-1 text-caption text-ink-secondary">
                      Δ = |proposed final score − calculated score as submitted|. A Δ outside the band requires your
                      decision (ADJ-2).
                    </p>

                    {isPending ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          onClick={() => {
                            setDecision({ item, kind: 'APPROVE' });
                            setComment('');
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => {
                            setDecision({ item, kind: 'DECLINE' });
                            setComment('');
                          }}
                        >
                          Decline
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-3 text-caption text-ink-secondary">
                        This escalation is closed — the KPI is no longer waiting for your decision.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data ? (
        <Pagination
          page={data.page}
          size={data.size}
          total={data.total}
          totalPages={data.totalPages}
          onPage={setPage}
          onSize={setSize}
        />
      ) : null}

      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision?.kind === 'APPROVE' ? 'Approve the escalated adjustment?' : 'Decline the escalated adjustment?'}
        description={
          decision?.item
            ? `${decision.item.kpi} · ${decision.item.employeeName} (${decision.item.employeeCode})`
            : undefined
        }
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
              {decision?.kind === 'APPROVE' ? 'Approve escalation' : 'Decline escalation'}
            </Button>
          </>
        }
      >
        {decision ? (
          <div className="space-y-3">
            {decision.kind === 'APPROVE' ? (
              <Alert tone="info" title="Approving applies the proposed score">
                The KPI becomes Approved with Final Score{' '}
                <span className="anwar-mono font-semibold">{formatScore(decision.item.proposedScore)}</span> (CS{' '}
                {formatScore(decision.item.calculatedScore)} · Δ {formatScore(decision.item.delta)}). The employee and the
                requesting approver are notified (NT-12).
              </Alert>
            ) : (
              <Alert tone="warning" title="Declining reverses the adjustment">
                The KPI returns to Under Review with the adjustment reversed and the calculated score restored. The
                approver can decide again (NT-12).
              </Alert>
            )}
            <Field label="Comment (optional)" hint="Recorded in the audit trail and sent to both parties.">
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

export default EscalationsPage;
