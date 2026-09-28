/**
 * ============================================================================
 *  DecisionDrawer — the approver's decision surface (FR-APR-03/04/05/06/07)
 * ============================================================================
 *  Shared by every review queue: the KPI Pending Requests queue (ApprovalsPage),
 *  the group-wide queue (AllRequestsPage) and the Department Head queue
 *  (HeadKpiRequestsPage).
 *
 *  It fetches the full KPI (`GET /kpis/:id`) and posts exactly one decision to
 *  `POST /kpis/:id/decision`. The calculation path is rendered verbatim from
 *  `detail.calculationPath` — the UI never invents Curve, Adjustment or Score
 *  Version rows (AC-05).
 * ============================================================================
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { ConfigurationVersionItem, KpiDetail } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  Drawer,
  ErrorState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { Alert } from '@/components/ui/badges';
import { useToast } from '@/context/ToastContext';
import { DEFAULT_QUALITATIVE_MAP, bandTest, calculateKpi } from '@/lib/calculation';
import {
  MEASUREMENT_TYPE_LABELS,
  REJECT_CATEGORIES,
  formatBytes,
  formatDateTime,
  formatScore,
  measured,
  shortHash,
} from '@/lib/format';

// ------------------------------------------------------------------- helpers

export interface BulkApproveResult {
  approved: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; status?: string; message?: string }>;
}

interface DecisionResponse {
  id: string;
  status?: string;
  message?: string;
  escalated?: boolean;
  delta?: string;
  proposedScore?: string;
  finalScore?: string;
}

interface EvidenceUrlPayload {
  url: string;
  expiresAt?: string;
  originalName?: string;
}

const toNumberOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const RUBRIC_LEVELS = [1, 2, 3, 4, 5];

/**
 * FR-APR-04 — opening a request starts the review and notifies the employee.
 * Failures are surfaced (already under review is a 200) but never block the
 * drawer, so the approver can still read the record.
 */
export const useReviewStart = (): {
  start: (id: string) => Promise<void>;
  openingId: string | null;
} => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [openingId, setOpeningId] = React.useState<string | null>(null);

  const start = React.useCallback(
    async (id: string) => {
      setOpeningId(id);
      try {
        await api.post<{ id: string; status: string; message?: string }>(`/kpis/${id}/review-start`);
        queryClient.invalidateQueries({ queryKey: ['approvals'] });
        queryClient.invalidateQueries({ queryKey: ['kpi', id] });
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'The review could not be started.';
        toast.warning('Review not started', message);
      } finally {
        setOpeningId(null);
      }
    },
    [queryClient, toast],
  );

  return { start, openingId };
};

// ------------------------------------------------------------------- drawer

export interface DecisionDrawerProps {
  kpiId: string | null;
  open: boolean;
  onClose: () => void;
  /** Called after a decision so the queue can tell the approver what happened. */
  onDecided?: (message: string) => void;
  /** Delete is offered by default; hidden when the caller cannot delete. */
  canDelete?: boolean;
}

export const DecisionDrawer: React.FC<DecisionDrawerProps> = ({
  kpiId,
  open,
  onClose,
  onDecided,
  canDelete = true,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [adjustOpen, setAdjustOpen] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [staleMessage, setStaleMessage] = React.useState<string | null>(null);
  const [busyEvidence, setBusyEvidence] = React.useState<string | null>(null);
  const [escalationNote, setEscalationNote] = React.useState<string | null>(null);

  const [target, setTarget] = React.useState('');
  const [actual, setActual] = React.useState('');
  const [weight, setWeight] = React.useState('');
  const [rubric, setRubric] = React.useState('');
  const [overrideScore, setOverrideScore] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [returnComment, setReturnComment] = React.useState('');
  const [rejectCategory, setRejectCategory] = React.useState('');
  const [rejectComment, setRejectComment] = React.useState('');
  const [deleteReason, setDeleteReason] = React.useState('');

  const detailQuery = useQuery({
    queryKey: ['kpi', kpiId],
    queryFn: () => api.get<KpiDetail>(`/kpis/${kpiId}`),
    enabled: open && Boolean(kpiId),
  });
  const detail = detailQuery.data;

  const configQuery = useQuery({
    queryKey: ['configuration', 'active'],
    queryFn: () => api.get<ConfigurationVersionItem>('/admin/configuration-versions/active'),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const config = configQuery.data;

  const minReason = Math.max(15, config?.minReasonLength ?? 15);
  const band = Number(config?.adjustmentBand ?? 10);
  const cap = Number(config?.scoreCap ?? 120);
  const floor = Number(config?.scoreFloor ?? 0);
  const minWeight = Number(config?.minWeight ?? 5);
  const maxWeight = Number(config?.maxWeight ?? 30);

  // --------------------------------------------------------- reset on open

  React.useEffect(() => {
    if (!open) return;
    setAdjustOpen(false);
    setReturnOpen(false);
    setRejectOpen(false);
    setDeleteOpen(false);
    setMenuOpen(false);
    setStaleMessage(null);
    setEscalationNote(null);
    setReason('');
    setReturnComment('');
    setRejectCategory('');
    setRejectComment('');
    setDeleteReason('');
    if (kpiId) setBusyEvidence(null);
  }, [open, kpiId]);

  React.useEffect(() => {
    if (!detail) return;
    setTarget(detail.target ?? '');
    setActual(detail.actual ?? '');
    setWeight(String(detail.kpiWeight));
    setRubric(detail.rubricLevel !== null && detail.rubricLevel !== undefined ? String(detail.rubricLevel) : '');
    setOverrideScore(detail.overrideScore ?? '');
    // Re-seed only when a different record (or a newer version) arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, detail?.rowVersion]);

  // --------------------------------------------------------------- invalidation

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['approvals'] });
    queryClient.invalidateQueries({ queryKey: ['kpi', kpiId] });
    queryClient.invalidateQueries({ queryKey: ['escalations'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'department'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'group'] });
  }, [queryClient, kpiId]);

  // ----------------------------------------------------------------- mutation

  const decisionMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<DecisionResponse>(`/kpis/${kpiId}/decision`, {
        ...payload,
        rowVersion: detail?.rowVersion,
      }),
    onSuccess: (result, payload) => {
      const action = String((payload as { action?: string }).action ?? '');
      const message = result.message ?? 'The decision was recorded.';
      const titles: Record<string, string> = {
        approve: 'KPI approved',
        adjust: result.escalated ? 'Adjustment escalated' : 'KPI approved with an adjustment',
        return: 'KPI returned',
        reject: 'KPI rejected',
        delete: 'KPI deleted',
      };
      toast.success(titles[action] ?? 'Decision recorded', message);
      setStaleMessage(null);
      setReturnOpen(false);
      setRejectOpen(false);
      setDeleteOpen(false);
      onDecided?.(message);
      invalidate();
      if (action === 'adjust' && result.escalated) {
        setEscalationNote(message);
        setAdjustOpen(false);
        return;
      }
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.isStale) {
        setStaleMessage(error.message);
        toast.error('This request changed', error.message);
        return;
      }
      const message = error instanceof ApiError ? error.message : 'The decision could not be recorded.';
      toast.error('Could not record the decision', message);
    },
  });

  const handleEvidenceDownload = async (evidenceId: string, name: string) => {
    setBusyEvidence(evidenceId);
    try {
      const payload = await api.get<EvidenceUrlPayload>(`/evidence/${evidenceId}/url`);
      window.open(payload.url, '_blank', 'noopener');
      toast.info('Download started', name);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'The signed link could not be created.';
      toast.error('Could not open the file', message);
    } finally {
      setBusyEvidence(null);
    }
  };

  // ------------------------------------------------------------- live recalculation

  const isQualitative = detail?.measurementType === 'QUALITATIVE';
  const targetNumber = toNumberOrNull(target);
  const actualNumber = toNumberOrNull(actual);
  const rubricNumber = toNumberOrNull(rubric);
  const weightNumber = toNumberOrNull(weight);
  const overrideNumber = toNumberOrNull(overrideScore);

  const live = React.useMemo(() => {
    if (!detail) return null;
    return calculateKpi({
      target: targetNumber,
      actual: actualNumber,
      rubricLevel: rubricNumber,
      kpiWeight: weightNumber ?? detail.kpiWeight,
      direction: detail.direction,
      measurementType: detail.measurementType,
      overrideScore: overrideNumber,
      config: {
        scoreCap: cap,
        scoreFloor: floor,
        qualitativeMap: config?.qualitativeMap ?? DEFAULT_QUALITATIVE_MAP,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, targetNumber, actualNumber, rubricNumber, weightNumber, overrideNumber, config, cap, floor]);

  const scoreAsSubmitted = Number(detail?.calculatedScore ?? 0);
  const proposedFinal = live ? live.finalScore : scoreAsSubmitted;
  const { delta, withinBand } = bandTest(
    proposedFinal,
    Number.isFinite(scoreAsSubmitted) ? scoreAsSubmitted : 0,
    Number.isFinite(band) ? band : 10,
  );

  // --------------------------------------------------------------- validation

  const buildChanges = (): Record<string, number> | undefined => {
    if (!detail) return undefined;
    const changes: Record<string, number> = {};
    if (detail.measurementType === 'QUALITATIVE') {
      if (rubricNumber !== null && rubricNumber !== (detail.rubricLevel ?? Number.NaN)) changes.rubricLevel = rubricNumber;
    } else {
      if (targetNumber !== null && targetNumber !== Number(detail.target ?? Number.NaN)) changes.target = targetNumber;
      if (actualNumber !== null && actualNumber !== Number(detail.actual ?? Number.NaN)) changes.actual = actualNumber;
    }
    if (weightNumber !== null && weightNumber !== detail.kpiWeight) changes.kpiWeight = weightNumber;
    return Object.keys(changes).length ? changes : undefined;
  };

  const changes = buildChanges();
  const hasChanges = Object.keys(changes ?? {}).length > 0 || overrideNumber !== null;
  const weightError =
    weightNumber === null
      ? 'A KPI weight is required'
      : weightNumber < minWeight || weightNumber > maxWeight
        ? `KPI Weight must be between ${minWeight}% and ${maxWeight}%`
        : undefined;
  const overrideError =
    overrideNumber !== null && (overrideNumber < 0 || overrideNumber > cap)
      ? `The score must be between 0 and ${cap}`
      : undefined;
  const reasonTooShort = reason.trim().length < minReason;
  const canApplyAdjustment = Boolean(detail?.canDecide) && !reasonTooShort && !weightError && !overrideError && hasChanges;
  const canReturn = returnComment.trim().length >= minReason;
  const canReject = rejectCategory !== '' && rejectComment.trim().length >= minReason;

  const approve = () => {
    if (!detail) return;
    setStaleMessage(null);
    decisionMutation.mutate({ action: 'approve' });
  };

  const applyAdjustment = () => {
    if (!detail) return;
    setStaleMessage(null);
    const payload: Record<string, unknown> = {
      action: 'adjust',
      reason: reason.trim(),
    };
    if (changes) payload.changes = changes;
    if (overrideNumber !== null) payload.overrideScore = overrideNumber;
    decisionMutation.mutate(payload);
  };

  const submitReturn = () => {
    setStaleMessage(null);
    decisionMutation.mutate({ action: 'return', comment: returnComment.trim(), reason: returnComment.trim() });
  };

  const submitReject = () => {
    setStaleMessage(null);
    decisionMutation.mutate({
      action: 'reject',
      reason: rejectComment.trim(),
      comment: rejectComment.trim(),
      rejectCategory,
    });
  };

  const submitDelete = () => {
    setStaleMessage(null);
    decisionMutation.mutate({ action: 'delete', reason: deleteReason.trim() });
  };

  // -------------------------------------------------------------------- render

  const pending = decisionMutation.isPending;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        width="lg"
        title={detail ? detail.name : 'Loading request…'}
        subtitle={
          detail
            ? `${detail.code} · ${detail.employee.fullName} (${detail.employee.employeeCode}) · ${detail.period.label} · Weight ${detail.kpiWeight}%`
            : kpiId ?? undefined
        }
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Link
              to={kpiId ? `/my-kpi/${kpiId}` : '/my-kpi'}
              className="anwar-btn anwar-btn-secondary h-10 px-4 text-body"
            >
              Open full record
            </Link>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        }
      >
        {detailQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : detailQuery.error || !detail ? (
          <ErrorState
            message={detailQuery.error instanceof Error ? detailQuery.error.message : 'This request could not be loaded.'}
            onRetry={() => detailQuery.refetch()}
          />
        ) : (
          <div className="space-y-4">
            {staleMessage ? (
              <Alert
                tone="danger"
                title="Someone else changed this request"
                actions={
                  <Button size="sm" variant="secondary" onClick={() => detailQuery.refetch()} loading={detailQuery.isFetching}>
                    Reload
                  </Button>
                }
              >
                {staleMessage}
              </Alert>
            ) : null}

            {escalationNote ? (
              <Alert tone="warning" title="This will be escalated to a Super Admin">
                {escalationNote}
              </Alert>
            ) : null}

            {/* ------------------------------------------------------ three tiles */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-control border border-edge p-3">
                <p className="text-caption font-medium uppercase tracking-wide text-ink-secondary">Target</p>
                <p className="anwar-mono mt-1 text-body font-semibold text-ink">
                  {measured(detail.target, detail.measurementType, detail.unit)}
                </p>
              </div>
              <div className="rounded-control border border-edge p-3">
                <p className="text-caption font-medium uppercase tracking-wide text-ink-secondary">Actual</p>
                <p className="anwar-mono mt-1 text-body font-semibold text-ink">
                  {measured(detail.actual, detail.measurementType, detail.unit)}
                </p>
              </div>
              <div className="rounded-control border border-edge p-3">
                <p className="text-caption font-medium uppercase tracking-wide text-ink-secondary">
                  Evidence ({detail.evidenceCount})
                </p>
                {detail.evidence.length === 0 ? (
                  <p className="mt-1 text-caption text-ink-secondary">No evidence attached.</p>
                ) : (
                  <ul className="mt-1 space-y-2">
                    {detail.evidence
                      .filter((file) => file.isCurrent)
                      .map((file) => (
                        <li key={file.id} className="min-w-0">
                          <p className="truncate text-caption font-semibold text-ink" title={file.originalName}>
                            {file.originalName}
                          </p>
                          <p className="text-caption text-ink-muted">
                            {formatBytes(file.sizeBytes)} · v{file.versionNo} · <span className="anwar-mono">{shortHash(file.sha256)}</span>
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-0.5 px-0"
                            loading={busyEvidence === file.id}
                            onClick={() => handleEvidenceDownload(file.id, file.originalName)}
                            aria-label={`Download ${file.originalName}`}
                          >
                            Download
                          </Button>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>

            {/* --------------------------------------------------------- remarks */}
            <div>
              <p className="mb-1 text-caption font-medium uppercase tracking-wide text-ink-secondary">
                Employee remarks
              </p>
              <blockquote className="rounded-control border-l-4 border-navy-600 bg-canvas px-3 py-2 text-body text-ink-secondary">
                {detail.remarks ?? 'No remarks were recorded.'}
              </blockquote>
            </div>

            {/* -------------------------------------------------- calculation path */}
            <Card>
              <CardHeader
                title="Calculation path"
                subtitle="Exactly the rows the server calculated — nothing is added or edited here (AC-05)"
              />
              <dl>
                {detail.calculationPath.map((row) => (
                  <DataRow key={row.label} label={row.label} mono={row.mono}>
                    {row.pending ? (
                      <Badge tone="warning">Pending approval</Badge>
                    ) : (
                      <>
                        {row.value ?? '—'}
                        {row.suffix ? <span className="ml-0.5">{row.suffix}</span> : null}
                      </>
                    )}
                  </DataRow>
                ))}
              </dl>
              <p className="mt-3 text-caption text-ink-muted">
                {MEASUREMENT_TYPE_LABELS[detail.measurementType]} · {detail.unit} ·{' '}
                {detail.direction === 'HIGHER' ? 'Higher is better' : 'Lower is better'} · score cap {cap}.
              </p>
            </Card>

            {/* ---------------------------------------------------------- adjust */}
            {adjustOpen ? (
              <Card className="border-navy-200">
                <CardHeader
                  title="Apply adjustment"
                  subtitle="ADJ-1/ADJ-2 — the server recalculates ACH, CS and WS; a Δ outside the band escalates to a Super Admin."
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  {isQualitative ? (
                    <Field
                      label="Rubric level"
                      htmlFor="adjust-rubric"
                      hint={`Mapped score: ${
                        rubricNumber !== null
                          ? (config?.qualitativeMap ?? DEFAULT_QUALITATIVE_MAP)[String(rubricNumber)] ?? '—'
                          : '—'
                      }%`}
                    >
                      <Select
                        id="adjust-rubric"
                        value={rubric}
                        onChange={(event) => setRubric(event.target.value)}
                        disabled={!detail.canDecide}
                      >
                        <option value="">Not set</option>
                        {RUBRIC_LEVELS.map((level) => (
                          <option key={level} value={level}>
                            Level {level}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : (
                    <>
                      <Field label="Target" htmlFor="adjust-target" hint={`Currently ${measured(detail.target, detail.measurementType, detail.unit)}`}>
                        <Input
                          id="adjust-target"
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          value={target}
                          onChange={(event) => setTarget(event.target.value)}
                          disabled={!detail.canDecide}
                        />
                      </Field>
                      <Field label="Actual" htmlFor="adjust-actual" hint={`Currently ${measured(detail.actual, detail.measurementType, detail.unit)}`}>
                        <Input
                          id="adjust-actual"
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          value={actual}
                          onChange={(event) => setActual(event.target.value)}
                          disabled={!detail.canDecide}
                        />
                      </Field>
                    </>
                  )}

                  <Field
                    label="KPI weight %"
                    htmlFor="adjust-weight"
                    required
                    hint={`Between ${minWeight}% and ${maxWeight}%`}
                    error={weightError}
                  >
                    <Input
                      id="adjust-weight"
                      type="number"
                      step="1"
                      inputMode="decimal"
                      value={weight}
                      onChange={(event) => setWeight(event.target.value)}
                      invalid={Boolean(weightError)}
                      disabled={!detail.canDecide}
                    />
                  </Field>

                  <Field
                    label="Final Score override (optional)"
                    htmlFor="adjust-override"
                    hint={`Leave empty to approve the calculated score. The engine caps every score at ${cap}.`}
                    error={overrideError}
                  >
                    <Input
                      id="adjust-override"
                      type="number"
                      step="0.01"
                      min={0}
                      max={cap}
                      inputMode="decimal"
                      value={overrideScore}
                      onChange={(event) => setOverrideScore(event.target.value)}
                      invalid={Boolean(overrideError)}
                      disabled={!detail.canDecide}
                    />
                  </Field>
                </div>

                {/* live recalculation + band indicator */}
                {live ? (
                  <div className="mt-4 rounded-control border border-edge bg-canvas p-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div>
                        <p className="text-caption text-ink-muted">Achievement</p>
                        <p className="anwar-mono font-semibold text-ink">{formatScore(live.achievement)}%</p>
                      </div>
                      <div>
                        <p className="text-caption text-ink-muted">Calculated Score</p>
                        <p className="anwar-mono font-semibold text-ink">{formatScore(live.calculatedScore)}</p>
                      </div>
                      <div>
                        <p className="text-caption text-ink-muted">Proposed Final Score</p>
                        <p className="anwar-mono font-semibold text-navy-900">{formatScore(proposedFinal)}</p>
                      </div>
                      <div>
                        <p className="text-caption text-ink-muted">Weighted Score</p>
                        <p className="anwar-mono font-semibold text-ink">{formatScore(live.weightedScore)}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-caption text-ink-secondary">
                      {live.formulaText} · CS as submitted {formatScore(detail.calculatedScore)} · proposed FS{' '}
                      {formatScore(proposedFinal)} · Δ {formatScore(delta)}
                    </p>
                  </div>
                ) : null}

                {withinBand ? (
                  <Alert tone="success" className="mt-3" title={`Within the ±${band} band — this will be approved directly`}>
                    Δ {formatScore(delta)} ≤ ±{band}. The adjustment is recorded as the approval.
                  </Alert>
                ) : (
                  <Alert tone="warning" className="mt-3" title="This will be escalated to a Super Admin">
                    Δ {formatScore(delta)} is outside the ±{band} band (ADJ-2). The KPI moves to Escalated and a Super
                    Admin decides.
                  </Alert>
                )}

                <div className="mt-3">
                  <Field
                    label="Reason"
                    htmlFor="adjust-reason"
                    required
                    hint={`${reason.trim().length}/${minReason} characters minimum — this is written to the audit trail (ADJ-4).`}
                    error={reason.length > 0 && reasonTooShort ? `Use at least ${minReason} characters` : undefined}
                  >
                    <Textarea
                      id="adjust-reason"
                      rows={3}
                      maxLength={1000}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Why is this value being changed?"
                      disabled={!detail.canDecide}
                    />
                  </Field>
                  {!hasChanges ? (
                    <p className="mt-1 text-caption text-warning">
                      Change at least one value (or set a Final Score override) before applying the adjustment.
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => setAdjustOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!canApplyAdjustment}
                    loading={pending}
                    onClick={applyAdjustment}
                  >
                    Apply adjustment
                  </Button>
                </div>
              </Card>
            ) : null}

            {/* ------------------------------------------------------------ decision */}
            <Card>
              <CardHeader
                title="Decision"
                subtitle={`Submitted ${formatDateTime(detail.submittedAt)} · approver ${detail.approver.fullName}`}
                actions={
                  canDelete ? (
                    <div className="relative">
                      <IconButton
                        label="More actions"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen((value) => !value)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="5" r="1.6" fill="currentColor" />
                          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                          <circle cx="12" cy="19" r="1.6" fill="currentColor" />
                        </svg>
                      </IconButton>
                      {menuOpen ? (
                        <>
                          <button
                            type="button"
                            className="fixed inset-0 z-10 cursor-default"
                            aria-label="Close the actions menu"
                            onClick={() => setMenuOpen(false)}
                          />
                          <div
                            role="menu"
                            className="absolute right-0 z-20 mt-1 w-52 rounded-control border border-edge bg-surface py-1 shadow-raised"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              className="w-full px-3 py-2 text-left text-body text-danger hover:bg-danger-tint"
                              onClick={() => {
                                setMenuOpen(false);
                                setDeleteOpen(true);
                              }}
                            >
                              Delete KPI
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={approve}
                  loading={pending}
                  disabled={!detail.canDecide || detail.isLocked}
                >
                  Approve calculated
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setAdjustOpen((value) => !value)}
                  disabled={!detail.canDecide || detail.isLocked}
                  aria-expanded={adjustOpen}
                >
                  Apply adjustment
                </Button>
                <Button variant="secondary" onClick={() => setReturnOpen(true)} disabled={!detail.canDecide || detail.isLocked}>
                  Return to employee
                </Button>
                <Button variant="danger" onClick={() => setRejectOpen(true)} disabled={!detail.canDecide || detail.isLocked}>
                  Reject
                </Button>
              </div>
              {!detail.canDecide ? (
                <p className="mt-2 text-caption text-ink-secondary">
                  You cannot decide this request: {detail.isLocked ? 'the period is closed.' : 'it is outside your scope or already decided.'}
                </p>
              ) : null}
            </Card>
          </div>
        )}
      </Drawer>

      {/* -------------------------------------------------------------- modals */}
      <Modal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Return to the employee"
        description="The KPI goes back to the employee with your comment. It is no longer in your queue until it is resubmitted (FR-APR-06)."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReturnOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canReturn} loading={pending} onClick={submitReturn}>
              Return KPI
            </Button>
          </>
        }
      >
        <Field
          label="Comment"
          required
          hint={`${returnComment.trim().length}/${minReason} characters minimum`}
          error={returnComment.length > 0 && !canReturn ? `Use at least ${minReason} characters` : undefined}
        >
          <Textarea
            rows={3}
            maxLength={1000}
            value={returnComment}
            onChange={(event) => setReturnComment(event.target.value)}
            placeholder="What must the employee change before resubmitting?"
          />
        </Field>
      </Modal>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject this KPI?"
        description="Rejecting is terminal: the KPI cannot be resubmitted and its weight is released back to the period (FR-APR-06)."
        size="sm"
        destructive
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!canReject} loading={pending} onClick={submitReject}>
              Reject KPI
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Reason category" required>
            <Select value={rejectCategory} onChange={(event) => setRejectCategory(event.target.value)}>
              <option value="">Select a category…</option>
              {REJECT_CATEGORIES.map((category) => (
                <option key={category.code} value={category.code}>
                  {category.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Comment"
            required
            hint={`${rejectComment.trim().length}/${minReason} characters minimum`}
            error={rejectComment.length > 0 && rejectComment.trim().length < minReason ? `Use at least ${minReason} characters` : undefined}
          >
            <Textarea
              rows={3}
              maxLength={1000}
              value={rejectComment}
              onChange={(event) => setRejectComment(event.target.value)}
              placeholder="Why is this KPI rejected?"
            />
          </Field>
          <Alert tone="danger" title="This is terminal">
            The employee is notified, the KPI is closed as Rejected and its weight becomes available again.
          </Alert>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this KPI?"
        description="The KPI is soft-deleted: it disappears from the dashboards, stays in the audit trail, and its weight is released (FR-APR-07)."
        size="sm"
        destructive
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleteReason.trim().length < minReason}
              loading={pending}
              onClick={submitDelete}
            >
              Delete KPI
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          required
          hint={`${deleteReason.trim().length}/${minReason} characters minimum`}
          error={deleteReason.length > 0 && deleteReason.trim().length < minReason ? `Use at least ${minReason} characters` : undefined}
        >
          <Textarea
            rows={3}
            maxLength={1000}
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
            placeholder="Why is this KPI being removed?"
          />
        </Field>
      </Modal>
    </>
  );
};
