/**
 * ============================================================================
 *  VersionHistoryPage — route `/my-kpi/:id/versions` (FR-AUD-02/03, AC-21)
 * ============================================================================
 *  Lists every KPI version, compares two of them side by side with the changed
 *  fields highlighted, and (for a Super Admin) restores an older version —
 *  which always creates a NEW version: nothing is ever overwritten.
 * ============================================================================
 */
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { KpiDetail, KpiVersionItem } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Select,
  Skeleton,
  Textarea,
  cn,
} from '@/components/ui';
import { Alert, PageHeader } from '@/components/ui/badges';
import { useToast } from '@/context/ToastContext';
import { STATUS_LABELS, formatDateTime, titleCase } from '@/lib/format';

interface VersionDiff {
  from: { versionNo: number; createdAt: string; trigger: string };
  to: { versionNo: number; createdAt: string; trigger: string };
  changes: Array<{ field: string; from: unknown; to: unknown }>;
}

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const statusOf = (version: KpiVersionItem): string | null => {
  const snapshot = version.snapshot as Record<string, unknown> | null;
  const status = snapshot?.status;
  return typeof status === 'string' ? status : null;
};

export const VersionHistoryPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [from, setFrom] = React.useState<number | null>(null);
  const [to, setTo] = React.useState<number | null>(null);
  const [restoreVersion, setRestoreVersion] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState('');

  const { data: versions, isLoading, error, refetch } = useQuery({
    queryKey: ['kpi-versions', id],
    queryFn: () => api.get<KpiVersionItem[]>(`/kpis/${id}/versions`),
    enabled: Boolean(id),
  });

  const { data: detail } = useQuery({
    queryKey: ['kpi', id],
    queryFn: () => api.get<KpiDetail>(`/kpis/${id}`),
    enabled: Boolean(id),
  });

  // Seed the comparison selectors: oldest vs newest.
  React.useEffect(() => {
    if (!versions?.length || from !== null || to !== null) return;
    setTo(versions[0].versionNo);
    setFrom(versions[1]?.versionNo ?? versions[0].versionNo);
  }, [versions, from, to]);

  const diffEnabled = from !== null && to !== null && from !== to;

  const { data: diff, isFetching: diffLoading } = useQuery({
    queryKey: ['kpi-version-diff', id, from, to],
    queryFn: () => api.get<VersionDiff>(`/kpis/${id}/versions/${from}/diff/${to}`),
    enabled: Boolean(id) && diffEnabled,
  });

  const restoreMutation = useMutation({
    mutationFn: (versionNo: number) =>
      api.post(`/kpis/${id}/versions/restore`, { versionNo, reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Version restored', 'A new version was created — the earlier versions are untouched (FR-AUD-03).');
      setRestoreVersion(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['kpi-versions', id] });
      queryClient.invalidateQueries({ queryKey: ['kpi-version-diff', id] });
      queryClient.invalidateQueries({ queryKey: ['kpi', id] });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'employee'] });
    },
    onError: (mutationError) => {
      const message = mutationError instanceof ApiError ? mutationError.message : 'The version could not be restored.';
      toast.error('Could not restore', message);
    },
  });

  // The full field table: changed fields highlighted, unchanged fields dimmed.
  const rows = React.useMemo(() => {
    if (!versions || from === null || to === null) return [];
    const fromVersion = versions.find((version) => version.versionNo === from);
    const toVersion = versions.find((version) => version.versionNo === to);
    if (!fromVersion || !toVersion) return diff?.changes ?? [];
    const a = (fromVersion.snapshot ?? {}) as Record<string, unknown>;
    const b = (toVersion.snapshot ?? {}) as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
    return keys.map((field) => ({
      field,
      from: a[field] ?? null,
      to: b[field] ?? null,
    }));
  }, [diff?.changes, from, to, versions]);

  const changedCount = rows.filter(
    (row) => JSON.stringify(row.from ?? null) !== JSON.stringify(row.to ?? null),
  ).length;

  return (
    <div>
      <PageHeader
        title="Version history"
        subtitle="Every change of a submitted KPI is frozen as a new version — nothing is ever overwritten (FR-AUD-03)."
        breadcrumb={[
          { label: 'My KPI', to: '/my-kpi' },
          { label: detail?.name ?? 'KPI', to: `/my-kpi/${id}` },
          { label: 'Versions' },
        ]}
        actions={
          <Link to={`/my-kpi/${id}`} className="anwar-btn anwar-btn-secondary h-10 px-4 text-body">
            Back to the KPI
          </Link>
        }
      />

      {error ? (
        <ErrorState
          message={error instanceof Error ? error.message : 'The version history could not be loaded.'}
          onRetry={() => refetch()}
        />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Versions" subtitle={`${versions?.length ?? 0} version(s) recorded`} />
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-8 w-full" />
                ))}
              </div>
            ) : !versions?.length ? (
              <EmptyState title="No versions yet" description="A version is created on the first save." />
            ) : (
              <div className="overflow-x-auto">
                <table className="anwar-table sticky-first-col">
                  <thead>
                    <tr>
                      <th scope="col">Version</th>
                      <th scope="col">Trigger</th>
                      <th scope="col">Change reason</th>
                      <th scope="col">Created by</th>
                      <th scope="col">Date</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((version) => {
                      const status = statusOf(version);
                      const restorable = status !== 'APPROVED';
                      return (
                        <tr key={version.id}>
                          <td className="anwar-mono">v{version.versionNo}</td>
                          <td>
                            <Badge tone="neutral">{titleCase(version.trigger)}</Badge>
                          </td>
                          <td className="max-w-[280px]">{version.changeReason ?? '—'}</td>
                          <td>{version.createdBy}</td>
                          <td>{formatDateTime(version.createdAt)}</td>
                          <td>
                            {status ? (
                              <Badge tone={status === 'APPROVED' ? 'success' : 'neutral'}>
                                {STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}
                              </Badge>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            {restorable && detail?.canRestore ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setRestoreVersion(version.versionNo);
                                  setReason('');
                                }}
                              >
                                Restore this version
                              </Button>
                            ) : restorable ? (
                              <span className="text-caption text-ink-muted">Super Admin only</span>
                            ) : (
                              <span className="text-caption text-ink-muted">Approved — read-only</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Compare versions"
              subtitle="Changed fields are highlighted — everything else is shown for context (AC-21)."
            />
            <div className="flex flex-wrap items-end gap-3">
              <Field label="From version" className="w-[160px]">
                <Select
                  value={from ?? ''}
                  onChange={(event) => setFrom(Number(event.target.value))}
                  aria-label="From version"
                >
                  {(versions ?? []).map((version) => (
                    <option key={version.id} value={version.versionNo}>
                      v{version.versionNo}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To version" className="w-[160px]">
                <Select value={to ?? ''} onChange={(event) => setTo(Number(event.target.value))} aria-label="To version">
                  {(versions ?? []).map((version) => (
                    <option key={version.id} value={version.versionNo}>
                      v{version.versionNo}
                    </option>
                  ))}
                </Select>
              </Field>
              {from !== null && to !== null && from === to ? (
                <p className="text-caption text-warning">Choose two different versions to compare.</p>
              ) : (
                <p className="text-caption text-ink-secondary">
                  {diffLoading ? 'Comparing…' : `${changedCount} changed field(s)`}
                </p>
              )}
            </div>

            {rows.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="anwar-table sticky-first-col">
                  <thead>
                    <tr>
                      <th scope="col">Field</th>
                      <th scope="col">v{from ?? '—'}</th>
                      <th scope="col">v{to ?? '—'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const changed = JSON.stringify(row.from ?? null) !== JSON.stringify(row.to ?? null);
                      return (
                        <tr
                          key={row.field}
                          className={cn(changed ? 'bg-warning-tint/60' : 'text-ink-secondary')}
                        >
                          <td className="font-semibold">
                            {titleCase(row.field)}
                            {changed ? (
                              <Badge tone="warning" className="ml-2">
                                Changed
                              </Badge>
                            ) : null}
                          </td>
                          <td className="anwar-mono">{formatValue(row.from)}</td>
                          <td className="anwar-mono">{formatValue(row.to)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>

          <Alert tone="info" title="A restore creates a NEW version">
            Restoring copies an older snapshot into a brand-new version. The existing versions stay in the audit trail
            and no record is ever overwritten (FR-AUD-03).
          </Alert>
        </div>
      )}

      <Modal
        open={restoreVersion !== null}
        onClose={() => setRestoreVersion(null)}
        title={`Restore version v${restoreVersion ?? ''}?`}
        description="A restore creates a NEW version — nothing is ever overwritten. A reason of at least 15 characters is required."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRestoreVersion(null)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length < 15}
              loading={restoreMutation.isPending}
              onClick={() => {
                if (restoreVersion !== null) restoreMutation.mutate(restoreVersion);
              }}
            >
              Restore version
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          required
          hint={`${reason.trim().length}/15 characters minimum`}
          error={reason.trim().length > 0 && reason.trim().length < 15 ? 'Use at least 15 characters' : undefined}
        >
          <Textarea
            value={reason}
            rows={3}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this version being restored?"
          />
        </Field>
      </Modal>
    </div>
  );
};

export default VersionHistoryPage;
