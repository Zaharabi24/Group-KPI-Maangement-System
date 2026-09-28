/**
 * ============================================================================
 *  KpiDetailPage — route `/my-kpi/:id` (FR-KPI-08/09/10, FR-EVD-03..05, §11.4)
 * ============================================================================
 *  Two-column detail view: the target/actual and evidence panels on the left,
 *  the calculation path, adjustment timeline, decision history and remarks on
 *  the right. Every action is driven by the `can*` flags returned by the API so
 *  the UI never offers a transition the server would reject.
 * ============================================================================
 */
import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, apiBaseUrl } from '@/lib/api';
import type { KpiDetail, KpiEvidence } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  KpiStepper,
  Modal,
  ProgressBar,
  SectionTitle,
  Skeleton,
  Textarea,
  Tooltip,
  cn,
} from '@/components/ui';
import { Alert, PageHeader, StatusBadge } from '@/components/ui/badges';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import CreateKpiDrawer from '@/components/kpi/CreateKpiDrawer';
import {
  MEASUREMENT_TYPE_LABELS,
  STATUS_LABELS,
  formatBytes,
  formatDate,
  formatDateTime,
  measured,
  shortHash,
} from '@/lib/format';
import { formatPercent } from '@/lib/calculation';

interface EvidenceUrlPayload {
  url: string;
  expiresAt: string;
  ttlSeconds?: number;
  originalName: string;
  mimeType?: string;
  sha256?: string;
}

interface ReportPayload {
  generatedAt: string;
  generatedBy: { id: string; name: string; email: string };
  detail: KpiDetail;
}

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.xls', '.csv', '.docx'];
const MAX_EVIDENCE_SIZE_MB = 10;

const extractToken = (url: string): string => {
  const match = /[?&]token=([^&]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : '';
};

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Client-side printable report — FR-KPI-10 (no server PDF endpoint in Phase 01). */
const buildReportHtml = (payload: ReportPayload): string => {
  const detail = payload.detail;
  const rows = detail.calculationPath
    .map((row) => {
      const value = row.pending ? 'Pending approval' : `${row.value ?? '—'}${row.suffix ?? ''}`;
      return `<tr><th>${escapeHtml(row.label)}</th><td${row.mono ? ' class="mono"' : ''}>${escapeHtml(value)}</td></tr>`;
    })
    .join('');

  const evidence = detail.evidence.length
    ? detail.evidence
        .map(
          (file) =>
            `<tr><td>${escapeHtml(file.originalName)}</td><td>${escapeHtml(formatBytes(file.sizeBytes))}</td><td>v${file.versionNo}</td><td>${escapeHtml(file.scanStatus)}</td><td class="mono">${escapeHtml(file.sha256)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5">No evidence attached.</td></tr>';

  const adjustments = detail.adjustmentHistory.length
    ? detail.adjustmentHistory
        .map(
          (entry) =>
            `<tr><td>${escapeHtml(entry.field)}</td><td>${escapeHtml(entry.oldValue ?? '—')}</td><td>${escapeHtml(entry.newValue ?? '—')}</td><td>${escapeHtml(entry.actor)}</td><td>${escapeHtml(formatDateTime(entry.at))}</td><td>${escapeHtml(entry.reason)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6">No adjustments recorded.</td></tr>';

  const decisions = detail.decisionHistory.length
    ? detail.decisionHistory
        .map(
          (entry) =>
            `<tr><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.actor)}</td><td>${escapeHtml(entry.statusBefore ?? '—')} → ${escapeHtml(entry.statusAfter ?? '—')}</td><td>${escapeHtml(entry.scoreBefore ?? '—')} → ${escapeHtml(entry.scoreAfter ?? '—')}</td><td>${escapeHtml(formatDateTime(entry.at))}</td><td>${escapeHtml(entry.reason ?? '—')}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6">No decisions recorded.</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>KPI report — ${escapeHtml(detail.code)}</title>
<style>
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #1A1A1A; margin: 32px; font-size: 13px; }
  h1 { font-size: 20px; color: #0B2545; margin: 0 0 4px; }
  h2 { font-size: 15px; color: #0B2545; margin: 24px 0 8px; border-bottom: 1px solid #D9E1EA; padding-bottom: 4px; }
  p.meta { color: #5B6770; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { text-align: left; border-bottom: 1px solid #E6ECF2; padding: 6px 8px; vertical-align: top; }
  thead th { background: #F5F7FA; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #5B6770; }
  tbody th { width: 240px; color: #5B6770; font-weight: 600; }
  .mono { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; font-size: 12px; }
  .badge { display: inline-block; border: 1px solid #0B2545; border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
  footer { margin-top: 28px; border-top: 1px solid #D9E1EA; padding-top: 8px; color: #8A96A1; font-size: 11px; }
  .actions { margin: 16px 0 0; }
  @media print { .actions { display: none; } }
</style>
</head>
<body>
  <h1>${escapeHtml(detail.name)}</h1>
  <p class="meta">
    <span class="badge">${escapeHtml(STATUS_LABELS[detail.status] ?? detail.status)}</span>
    ${escapeHtml(detail.code)} · ${escapeHtml(detail.employee.fullName)} (${escapeHtml(detail.employee.employeeCode)}) ·
    ${escapeHtml(detail.category.name)} · Weight ${escapeHtml(detail.kpiWeight)}% ·
    ${escapeHtml(detail.period.label)} (${escapeHtml(formatDate(detail.period.startDate))} – ${escapeHtml(formatDate(detail.period.endDate))})
  </p>

  <h2>Definition</h2>
  <table><tbody>
    <tr><th>Description</th><td>${escapeHtml(detail.description ?? '—')}</td></tr>
    <tr><th>Measurement type</th><td>${escapeHtml(MEASUREMENT_TYPE_LABELS[detail.measurementType] ?? detail.measurementType)} (${escapeHtml(detail.unit)})</td></tr>
    <tr><th>Direction</th><td>${detail.direction === 'HIGHER' ? 'Higher is better' : 'Lower is better'}</td></tr>
    <tr><th>Target</th><td class="mono">${escapeHtml(measured(detail.target, detail.measurementType, detail.unit))}</td></tr>
    <tr><th>Latest actual</th><td class="mono">${escapeHtml(measured(detail.actual, detail.measurementType, detail.unit))}</td></tr>
    <tr><th>Achievement</th><td class="mono">${escapeHtml(formatPercent(detail.achievement))}</td></tr>
    <tr><th>Approval person</th><td>${escapeHtml(detail.approver.fullName)}</td></tr>
    <tr><th>Remarks</th><td>${escapeHtml(detail.remarks ?? '—')}</td></tr>
  </tbody></table>

  <h2>Calculation path</h2>
  <table><tbody>${rows}</tbody></table>

  <h2>Evidence and SHA-256 hashes</h2>
  <table>
    <thead><tr><th>File</th><th>Size</th><th>Version</th><th>Scan</th><th>SHA-256</th></tr></thead>
    <tbody>${evidence}</tbody>
  </table>

  <h2>Adjustment history</h2>
  <table>
    <thead><tr><th>Field</th><th>Old</th><th>New</th><th>Actor</th><th>When</th><th>Reason</th></tr></thead>
    <tbody>${adjustments}</tbody>
  </table>

  <h2>Decision history</h2>
  <table>
    <thead><tr><th>Action</th><th>Actor</th><th>Status</th><th>Score</th><th>When</th><th>Reason</th></tr></thead>
    <tbody>${decisions}</tbody>
  </table>

  <p class="actions"><button type="button" onclick="window.print()">Print / save as PDF</button></p>
  <footer>Generated by ${escapeHtml(payload.generatedBy.name)} at ${escapeHtml(formatDateTime(payload.generatedAt))} · ANWAR KPIFlow · Internal &amp; Confidential</footer>
</body>
</html>`;
};

export const KpiDetailPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteReason, setDeleteReason] = React.useState('');
  const [correctionOpen, setCorrectionOpen] = React.useState(false);
  const [correctionReason, setCorrectionReason] = React.useState('');
  const [uploadPercent, setUploadPercent] = React.useState<number | null>(null);
  const [replaceTarget, setReplaceTarget] = React.useState<string | null>(null);
  const [busyEvidence, setBusyEvidence] = React.useState<string | null>(null);

  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const replaceInputRef = React.useRef<HTMLInputElement>(null);

  const { data: detail, isLoading, error, refetch } = useQuery({
    queryKey: ['kpi', id],
    queryFn: () => api.get<KpiDetail>(`/kpis/${id}`),
    enabled: Boolean(id),
  });

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['kpi', id] });
    queryClient.invalidateQueries({ queryKey: ['kpis'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'employee'] });
    queryClient.invalidateQueries({ queryKey: ['kpi-versions', id] });
  }, [id, queryClient]);

  // ------------------------------------------------------------------ actions

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post<KpiDetail>(`/kpis/${id}/submit`, {}, { ifMatch: detail?.rowVersion }),
    onSuccess: () => {
      toast.success('KPI submitted', 'Your approver has been notified (NT-05).');
      invalidate();
    },
    onError: (mutationError) => {
      const message = mutationError instanceof ApiError ? mutationError.message : 'The KPI could not be submitted.';
      toast.error('Could not submit', message);
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: () => api.post<KpiDetail>(`/kpis/${id}/withdraw`),
    onSuccess: () => {
      toast.success('KPI withdrawn', 'The KPI is a Draft again and can be edited.');
      invalidate();
    },
    onError: (mutationError) => {
      const message = mutationError instanceof ApiError ? mutationError.message : 'The KPI could not be withdrawn.';
      toast.error('Could not withdraw', message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete<{ message: string }>(`/kpis/${id}`, { reason: deleteReason.trim() }),
    onSuccess: () => {
      toast.success('Draft deleted', 'Its weight has been released back to the period.');
      invalidate();
      navigate('/my-kpi');
    },
    onError: (mutationError) => {
      const message = mutationError instanceof ApiError ? mutationError.message : 'The Draft could not be deleted.';
      toast.error('Could not delete', message);
    },
  });

  const correctionMutation = useMutation({
    mutationFn: () => api.post(`/corrections`, { kpiId: id, reason: correctionReason.trim() }),
    onSuccess: () => {
      toast.success('Correction requested', 'The Super Admin queue has been notified.');
      setCorrectionOpen(false);
      setCorrectionReason('');
      invalidate();
    },
    onError: (mutationError) => {
      const message = mutationError instanceof ApiError ? mutationError.message : 'The request could not be sent.';
      toast.error('Could not request a correction', message);
    },
  });

  const reportMutation = useMutation({
    mutationFn: () => api.get<ReportPayload>(`/kpis/${id}/report`),
    onSuccess: (payload) => {
      const win = window.open('', '_blank', 'width=980,height=1000');
      if (!win) {
        toast.error('Popup blocked', 'Allow popups for this site to open the report.');
        return;
      }
      win.document.write(buildReportHtml(payload));
      win.document.close();
      toast.success('Report generated', 'Use Print in the new window to save it as PDF.');
    },
    onError: (mutationError) => {
      const message = mutationError instanceof ApiError ? mutationError.message : 'The report could not be generated.';
      toast.error('Could not generate the report', message);
    },
  });

  const evidenceMutations = {
    upload: useMutation({
      mutationFn: async (file: File) => {
        const formData = new FormData();
        formData.append('files', file);
        setUploadPercent(0);
        return api.upload<{ uploaded: number }>(`/kpis/${id}/evidence`, formData, setUploadPercent);
      },
      onSuccess: () => {
        toast.success('Evidence uploaded', 'The file was scanned and hashed (SHA-256).');
        setUploadPercent(null);
        invalidate();
      },
      onError: (mutationError) => {
        setUploadPercent(null);
        const message = mutationError instanceof ApiError ? mutationError.message : 'The file could not be uploaded.';
        toast.error('Upload failed', message);
      },
    }),
    replace: useMutation({
      mutationFn: async ({ evidenceId, file }: { evidenceId: string; file: File }) => {
        const formData = new FormData();
        formData.append('file', file);
        setUploadPercent(0);
        return api.upload(`/kpis/${id}/evidence/${evidenceId}/replace`, formData, setUploadPercent);
      },
      onSuccess: () => {
        toast.success('Evidence replaced', 'A new file version was created — the old file is kept (FR-EVD-03).');
        setUploadPercent(null);
        invalidate();
      },
      onError: (mutationError) => {
        setUploadPercent(null);
        const message = mutationError instanceof ApiError ? mutationError.message : 'The file could not be replaced.';
        toast.error('Replace failed', message);
      },
    }),
    remove: useMutation({
      mutationFn: (evidenceId: string) => api.delete(`/kpis/${id}/evidence/${evidenceId}`),
      onSuccess: () => {
        toast.success('Evidence removed', 'The file was detached from this KPI.');
        invalidate();
      },
      onError: (mutationError) => {
        const message = mutationError instanceof ApiError ? mutationError.message : 'The file could not be removed.';
        toast.error('Remove failed', message);
      },
    }),
  };

  const handleUpload = (file: File | undefined) => {
    if (!file) return;
    const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      toast.error('File type not allowed', `Use ${ALLOWED_EXTENSIONS.join(', ')}.`);
      return;
    }
    if (file.size > MAX_EVIDENCE_SIZE_MB * 1024 * 1024) {
      toast.error('File too large', `The maximum size is ${MAX_EVIDENCE_SIZE_MB} MB.`);
      return;
    }
    evidenceMutations.upload.mutate(file);
  };

  const handleReplace = (file: File | undefined) => {
    if (!file || !replaceTarget) return;
    evidenceMutations.replace.mutate({ evidenceId: replaceTarget, file });
    setReplaceTarget(null);
  };

  const openEvidenceUrl = async (evidence: KpiEvidence, mode: 'download' | 'preview') => {
    setBusyEvidence(evidence.id);
    try {
      const payload = await api.get<EvidenceUrlPayload>(`/evidence/${evidence.id}/url`);
      if (mode === 'download') {
        window.open(payload.url, '_blank', 'noopener');
      } else {
        const token = extractToken(payload.url);
        window.open(`${apiBaseUrl}/evidence/${evidence.id}/preview?token=${encodeURIComponent(token)}`, '_blank', 'noopener');
      }
      toast.info(
        mode === 'download' ? 'Download started' : 'Preview opened',
        `Signed link valid until ${formatDateTime(payload.expiresAt)} (FR-EVD-04).`,
      );
    } catch (urlError) {
      const message = urlError instanceof ApiError ? urlError.message : 'The signed link could not be created.';
      toast.error('Could not open the file', message);
    } finally {
      setBusyEvidence(null);
    }
  };

  // ------------------------------------------------------------------- render

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'This KPI could not be loaded.'}
        onRetry={() => refetch()}
      />
    );
  }

  const metaLine = [
    detail.employee.fullName,
    detail.code,
    detail.category.name,
    `Weight ${detail.kpiWeight}%`,
    `${formatDate(detail.period.startDate)} – ${formatDate(detail.period.endDate)}`,
  ].join(' · ');

  return (
    <div>
      <PageHeader
        title={detail.name}
        subtitle={metaLine}
        breadcrumb={[
          { label: 'My KPI', to: '/my-kpi' },
          { label: detail.code },
        ]}
        actions={
          <>
            <StatusBadge status={detail.status} locked={detail.isLocked} />
            <Button
              variant="secondary"
              onClick={() => reportMutation.mutate()}
              loading={reportMutation.isPending}
              iconLeft={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
            >
              Download report
            </Button>
          </>
        }
      />

      {detail.isLocked ? (
        <Alert tone="warning" title="This period is closed" className="mb-4">
          <span className="inline-flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
              <path d="M8 10V7a4 4 0 118 0v3" stroke="currentColor" strokeWidth="2.2" />
            </svg>
            This period is closed. A Super Admin must reopen it before any change.
          </span>
        </Alert>
      ) : null}

      {detail.status === 'RETURNED' && detail.returnComment ? (
        <Alert tone="warning" title="Returned by your approver" className="mb-4">
          {detail.returnComment}
        </Alert>
      ) : null}

      {detail.status === 'REJECTED' && detail.rejectedReason ? (
        <Alert tone="danger" title={`Rejected${detail.rejectCategory ? ` · ${detail.rejectCategory}` : ''}`} className="mb-4">
          {detail.rejectedReason}
        </Alert>
      ) : null}

      {/* ------------------------------------------------------- stepper card */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <KpiStepper states={detail.stepper.states} />
          <div className="flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
            <Badge tone="neutral">Version {detail.currentVersionNo}</Badge>
            <Badge tone="neutral">Config v{detail.configVersion ?? '—'}</Badge>
            <Badge tone="info">{MEASUREMENT_TYPE_LABELS[detail.measurementType]}</Badge>
            {detail.isAssigned ? <Badge tone="info">Assigned by your Department Head</Badge> : null}
          </div>
        </div>
      </Card>

      {/* -------------------------------------------------------- action bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {detail.canEdit ? (
          <Button onClick={() => setDrawerOpen(true)}>Edit</Button>
        ) : null}
        {detail.canSubmit ? (
          <Button
            variant="primary"
            onClick={() => submitMutation.mutate()}
            loading={submitMutation.isPending}
          >
            {detail.status === 'RETURNED' ? 'Resubmit' : 'Submit'}
          </Button>
        ) : null}
        {detail.canWithdraw ? (
          <Button variant="secondary" onClick={() => withdrawMutation.mutate()} loading={withdrawMutation.isPending}>
            Withdraw
          </Button>
        ) : null}
        {detail.canDecide ? (
          <Button variant="secondary" onClick={() => navigate(`/approvals?kpi=${detail.id}`)}>
            Review in the approvals queue
          </Button>
        ) : null}
        {detail.canRequestCorrection ? (
          <Button variant="secondary" onClick={() => setCorrectionOpen(true)}>
            Request a correction
          </Button>
        ) : null}
        {detail.canViewVersions ? (
          <Link
            to={`/my-kpi/${detail.id}/versions`}
            className="anwar-btn anwar-btn-secondary anwar-btn-sm h-10 px-4 text-body"
          >
            Version history
          </Link>
        ) : null}
        {detail.status === 'DRAFT' && user?.id === detail.employee.id ? (
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            Delete draft
          </Button>
        ) : null}
      </div>

      {/* ----------------------------------------------------- two-column body */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Target and actual" subtitle="What was agreed and what was measured" />
            <dl>
              <DataRow label="Description">{detail.description ?? '—'}</DataRow>
              <DataRow label="Target" mono>
                {measured(detail.target, detail.measurementType, detail.unit)}
              </DataRow>
              <DataRow label="Latest actual" mono>
                {measured(detail.actual, detail.measurementType, detail.unit)}
              </DataRow>
              <DataRow label="Achievement" mono>
                {formatPercent(detail.achievement)}
              </DataRow>
              <DataRow label="Data source">{detail.dataSource}</DataRow>
              <DataRow label="Reviewer / approver">
                {detail.approver.fullName}
                {detail.approver.isSuperAdmin ? ' (Super Admin)' : ''}
              </DataRow>
              <DataRow label="Unit">
                {detail.unit} · {detail.direction === 'HIGHER' ? 'Higher is better' : 'Lower is better'}
              </DataRow>
            </dl>
            {detail.remarks ? (
              <p className="mt-3 rounded-control bg-canvas p-3 text-body text-ink-secondary">{detail.remarks}</p>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Evidence"
              subtitle={`${detail.evidenceCount} current file${detail.evidenceCount === 1 ? '' : 's'} · immutable once submitted (FR-EVD-03)`}
              actions={
                detail.canEdit ? (
                  <>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      accept={ALLOWED_EXTENSIONS.join(',')}
                      className="sr-only"
                      onChange={(event) => {
                        handleUpload(event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                    <Button size="sm" variant="secondary" onClick={() => uploadInputRef.current?.click()} disabled={uploadPercent !== null}>
                      Upload
                    </Button>
                  </>
                ) : null
              }
            />

            {uploadPercent !== null ? (
              <ProgressBar className="mb-3" value={uploadPercent} max={100} label="Uploading evidence…" tone="navy" />
            ) : null}

            <input
              ref={replaceInputRef}
              type="file"
              accept={ALLOWED_EXTENSIONS.join(',')}
              className="sr-only"
              onChange={(event) => {
                handleReplace(event.target.files?.[0]);
                event.target.value = '';
              }}
            />

            {detail.evidence.length === 0 ? (
              <EmptyState
                title="No evidence attached"
                description="Attach at least one file before the KPI can be submitted (EVIDENCE-REQUIRED)."
              />
            ) : (
              <ul className="space-y-3">
                {detail.evidence.map((file) => (
                  <li
                    key={file.id}
                    className={cn('rounded-control border border-edge p-3', !file.isCurrent && 'opacity-60')}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-body font-semibold text-ink" title={file.originalName}>
                          {file.originalName}
                        </p>
                        <p className="text-caption text-ink-secondary">
                          {formatBytes(file.sizeBytes)} · {formatDateTime(file.createdAt)} · v{file.versionNo}
                          {file.isCurrent ? '' : ' · replaced'}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
                          <span className="text-ink-muted">SHA-256</span>
                          <Tooltip content={file.sha256}>
                            <span className="anwar-mono">{shortHash(file.sha256, 16)}</span>
                          </Tooltip>
                          <Badge tone={file.scanStatus === 'CLEAN' ? 'success' : file.scanStatus === 'PENDING' ? 'warning' : 'danger'}>
                            {file.scanStatus}
                          </Badge>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {file.previewable ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openEvidenceUrl(file, 'preview')}
                            disabled={busyEvidence === file.id}
                          >
                            Preview
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openEvidenceUrl(file, 'download')}
                          disabled={busyEvidence === file.id}
                        >
                          Download
                        </Button>
                        {detail.canEdit && file.isCurrent ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setReplaceTarget(file.id);
                                replaceInputRef.current?.click();
                              }}
                              disabled={uploadPercent !== null}
                            >
                              Replace
                            </Button>
                            <IconButton
                              label={`Remove ${file.originalName}`}
                              tone="danger"
                              onClick={() => evidenceMutations.remove.mutate(file.id)}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </IconButton>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {detail.canEdit ? (
              <p className="mt-3 text-caption text-ink-muted">
                Replacing a file while the KPI is Returned creates a new file version — nothing is overwritten (FR-EVD-03).
              </p>
            ) : null}
          </Card>
        </div>

        {/* RIGHT */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Calculation path" subtitle="Exactly the rows the server calculated (FR-KPI-08)" />
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
              Final Score and Weighted Score become final only after approval. Formula, Achievement, Calculated Score,
              KPI Weight and Weighted Score are never edited by the UI — the server recalculates on every save (AC-05).
            </p>
          </Card>

          <Card>
            <SectionTitle hint="FR-KPI-09 · every approver change is recorded with the reason (ADJ-4).">
              Adjustment history
            </SectionTitle>
            {detail.adjustmentHistory.length === 0 ? (
              <p className="text-caption text-ink-secondary">No adjustments recorded.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-edge pl-4">
                {detail.adjustmentHistory.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span
                      className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-warning"
                      aria-hidden="true"
                    />
                    <p className="text-caption font-semibold text-ink">
                      {entry.field}: <span className="anwar-mono">{entry.oldValue ?? '—'}</span> →{' '}
                      <span className="anwar-mono">{entry.newValue ?? '—'}</span>
                    </p>
                    <p className="text-caption text-ink-secondary">
                      {entry.actor}
                      {entry.actorRoles.length ? ` · ${entry.actorRoles.join(', ')}` : ''} · {formatDateTime(entry.at)}
                    </p>
                    <p className="mt-1 text-caption text-ink-secondary">{entry.reason}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <SectionTitle hint="Every status transition, who made it and why.">Decision history</SectionTitle>
            {detail.decisionHistory.length === 0 ? (
              <p className="text-caption text-ink-secondary">No decisions recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {detail.decisionHistory.map((entry) => (
                  <li key={entry.id} className="rounded-control border border-edge p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge tone={entry.action === 'APPROVE' ? 'success' : entry.action === 'REJECT' ? 'danger' : 'neutral'}>
                        {entry.action}
                      </Badge>
                      <span className="text-caption text-ink-secondary">{formatDateTime(entry.at)}</span>
                    </div>
                    <p className="mt-1 text-caption text-ink-secondary">
                      {entry.actor}
                      {entry.statusBefore && entry.statusAfter
                        ? ` · ${STATUS_LABELS[entry.statusBefore] ?? entry.statusBefore} → ${STATUS_LABELS[entry.statusAfter] ?? entry.statusAfter}`
                        : ''}
                      {entry.scoreBefore !== null && entry.scoreAfter !== null
                        ? ` · score ${entry.scoreBefore ?? '—'} → ${entry.scoreAfter ?? '—'}`
                        : ''}
                    </p>
                    {entry.rejectCategory ? (
                      <p className="mt-1 text-caption text-danger">Category: {entry.rejectCategory}</p>
                    ) : null}
                    {entry.reason ? <p className="mt-1 text-caption text-ink-secondary">{entry.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <SectionTitle>Remarks</SectionTitle>
            <p className="text-body text-ink-secondary">
              {detail.remarks ?? 'No remarks recorded. Remarks are mandatory (10–1,000 characters) before submission.'}
            </p>
          </Card>

          {detail.escalations.length ? (
            <Card>
              <SectionTitle>Escalations</SectionTitle>
              <ul className="space-y-2">
                {detail.escalations.map((escalation) => (
                  <li key={escalation.id} className="rounded-control border border-warning/40 bg-warning-tint p-3">
                    <p className="text-caption font-semibold text-warning">
                      {escalation.status} · Δ {escalation.delta ?? '—'} · {formatDateTime(escalation.createdAt)}
                    </p>
                    <p className="text-caption text-ink-secondary">{escalation.reason}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------------------- modals */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this Draft?"
        description="A reason of at least 15 characters is required and is written to the audit trail."
        size="sm"
        destructive
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleteReason.trim().length < 15}
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete Draft
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          required
          hint={`${deleteReason.trim().length}/15 characters minimum`}
          error={deleteReason.trim().length > 0 && deleteReason.trim().length < 15 ? 'Use at least 15 characters' : undefined}
        >
          <Textarea
            value={deleteReason}
            rows={3}
            maxLength={1000}
            onChange={(event) => setDeleteReason(event.target.value)}
            placeholder="Why is this Draft no longer needed?"
          />
        </Field>
      </Modal>

      <Modal
        open={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        title="Request a correction"
        description="An approved KPI is read-only. A correction request goes to the Super Admin queue (BR-R09)."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCorrectionOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={correctionReason.trim().length < 15}
              loading={correctionMutation.isPending}
              onClick={() => correctionMutation.mutate()}
            >
              Send request
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          required
          hint={`${correctionReason.trim().length}/15 characters minimum`}
          error={
            correctionReason.trim().length > 0 && correctionReason.trim().length < 15
              ? 'Use at least 15 characters'
              : undefined
          }
        >
          <Textarea
            value={correctionReason}
            rows={3}
            maxLength={1000}
            onChange={(event) => setCorrectionReason(event.target.value)}
            placeholder="What needs to be corrected, and why?"
          />
        </Field>
      </Modal>

      <CreateKpiDrawer
        open={drawerOpen}
        kpiId={detail.id}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => invalidate()}
      />
    </div>
  );
};

export default KpiDetailPage;
