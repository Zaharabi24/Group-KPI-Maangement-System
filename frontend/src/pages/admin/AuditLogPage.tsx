/**
 * ============================================================================
 *  M15 · Audit log viewer — FR-AUD-04, §18
 * ============================================================================
 *  Append-only, hash-chained trail. Filters feed GET /audit-logs; each row can
 *  be expanded into a before/after diff; CSV export and the hash-chain
 *  verification round the screen off (§18, AC-23).
 *
 *  §5.2 access rule:
 *    Super Admin         → everything
 *    HR Admin            → read-only (their scope)
 *    Department Head     → read-only for their department
 *    System Administrator→ technical/security events only
 * ============================================================================
 */
import React from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, api, saveBlob } from '@/lib/api';
import type { AuditLogItem, Paginated } from '@/lib/types';
import { ROLE_LABELS, formatDateTime, shortHash } from '@/lib/format';
import type { RoleCode } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Pagination,
  Select,
  Skeleton,
  Tooltip,
} from '@/components/ui';
import { Alert, PageHeader } from '@/components/ui/badges';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

// ------------------------------------------------------------------- helpers

interface AuditListResult extends Paginated<AuditLogItem> {
  notice?: string;
}

interface VerifyResult {
  ok: boolean;
  checked: number;
  brokenAt?: { id: string; action: string; createdAt: string };
}

interface DirectoryEntry {
  id: string;
  fullName: string;
  employeeCode: string;
  designationTitle: string | null;
  department: { id: string; code: string; name: string } | null;
}

const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'The request could not be completed.';

const pretty = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const sameValue = (a: unknown, b: unknown): boolean => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
};

/** Reads the actor role string ("SUPER_ADMIN,HR_ADMIN") into BRD labels. */
const actorRoleLabel = (actorRole: string | null): string => {
  if (!actorRole) return 'System';
  return actorRole
    .split(',')
    .map((code) => ROLE_LABELS[code.trim() as RoleCode] ?? code.trim())
    .join(' · ');
};

interface DiffRow {
  field: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

/** Union of the before/after object keys, plus a raw row when they are scalars. */
const buildDiff = (before: unknown, after: unknown): DiffRow[] => {
  const beforeObject = before && typeof before === 'object' && !Array.isArray(before)
    ? (before as Record<string, unknown>)
    : null;
  const afterObject = after && typeof after === 'object' && !Array.isArray(after)
    ? (after as Record<string, unknown>)
    : null;
  if (!beforeObject && !afterObject) {
    if (!before && !after) return [];
    return [
      { field: 'value', before: before ?? null, after: after ?? null, changed: !sameValue(before, after) },
    ];
  }
  const keys = Array.from(new Set([...Object.keys(beforeObject ?? {}), ...Object.keys(afterObject ?? {})])).sort();
  return keys.map((key) => {
    const from = beforeObject ? beforeObject[key] : undefined;
    const to = afterObject ? afterObject[key] : undefined;
    return { field: key, before: from, after: to, changed: !sameValue(from, to) };
  });
};

// ------------------------------------------------------------------- page

const AuditLogPage: React.FC = () => {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const canExportOrVerify = hasPermission('audit:view-all');

  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(25);
  const [action, setAction] = React.useState('');
  const [entityType, setEntityType] = React.useState('');
  const [entityId, setEntityId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [actor, setActor] = React.useState<DirectoryEntry | null>(null);
  const [actorSearch, setActorSearch] = React.useState('');
  const [actorOpen, setActorOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const actorTerm = actorSearch.trim();

  const entityTypesQuery = useQuery({
    queryKey: ['audit-logs', 'entity-types'],
    queryFn: () => api.get<string[]>('/audit-logs/entity-types'),
    staleTime: 5 * 60_000,
  });

  const directoryQuery = useQuery({
    queryKey: ['users', 'directory', actorTerm],
    queryFn: () => api.get<DirectoryEntry[]>('/users/directory', { search: actorTerm, limit: 10 }),
    enabled: actorOpen && actorTerm.length >= 2,
    staleTime: 30_000,
  });

  const filters = {
    action: action.trim() || undefined,
    entityType: entityType || undefined,
    entityId: entityId.trim() || undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    actorId: actor?.id,
  };

  const query = useQuery({
    queryKey: ['audit-logs', { page, size, ...filters }],
    queryFn: () => api.get<AuditListResult>('/audit-logs', { page, size, ...filters }),
    placeholderData: keepPreviousData,
  });

  const verifyMutation = useMutation({
    mutationFn: () => api.get<VerifyResult>('/audit-logs/verify'),
    onError: (error) => toast.error('Could not verify the hash chain', messageOf(error)),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const blob = await api.download('/audit-logs/export', filters);
      return blob;
    },
    onSuccess: (blob) => {
      saveBlob(blob, `audit-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`);
      toast.success('Audit log exported', 'The CSV download has started.');
    },
    onError: (error) => toast.error('Could not export the audit log', messageOf(error)),
  });

  const data = query.data;

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="FR-AUD-04 / §18 — append-only, hash-chained trail of every state change."
        actions={
          <>
            <Button
              variant="secondary"
              loading={exportMutation.isPending}
              disabled={!canExportOrVerify}
              onClick={() => exportMutation.mutate()}
            >
              Export CSV
            </Button>
            <Button
              loading={verifyMutation.isPending}
              disabled={!canExportOrVerify}
              onClick={() => verifyMutation.mutate()}
            >
              Verify hash chain
            </Button>
          </>
        }
      />

      <Alert tone="info" className="mb-4" title="Access rule (BRD §5.2)">
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Super Admin sees everything.</li>
          <li>HR Admin has read-only access.</li>
          <li>Department Head has read-only access for their own department.</li>
          <li>System Administrator sees technical and security events only.</li>
        </ul>
        <p className="mt-1">CSV export and hash-chain verification are restricted to Super Admin (AC-23).</p>
      </Alert>

      {verifyMutation.data ? (
        <Alert
          tone={verifyMutation.data.ok ? 'success' : 'danger'}
          className="mb-4"
          title={verifyMutation.data.ok ? 'Hash chain intact' : 'Hash chain broken'}
        >
          {verifyMutation.data.ok ? (
            <p>
              {verifyMutation.data.checked.toLocaleString()} audit record(s) recalculated and every link matched its
              predecessor. No record was edited or removed.
            </p>
          ) : (
            <p>
              The chain broke after {verifyMutation.data.checked.toLocaleString()} checked record(s)
              {verifyMutation.data.brokenAt ? (
                <>
                  : <span className="anwar-mono">{verifyMutation.data.brokenAt.action}</span> on{' '}
                  {formatDateTime(verifyMutation.data.brokenAt.createdAt)} (
                  <span className="anwar-mono">{verifyMutation.data.brokenAt.id}</span>)
                </>
              ) : null}
              . Investigate before trusting the trail.
            </p>
          )}
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Records" subtitle="Newest first. Expand a row for the before/after diff." />

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Action" htmlFor="audit-action" hint="Partial match, e.g. user.role">
            <Input
              id="audit-action"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
              placeholder="e.g. kpi.approve"
            />
          </Field>

          <Field label="Entity type" htmlFor="audit-entity-type">
            <Select
              id="audit-entity-type"
              value={entityType}
              onChange={(event) => {
                setEntityType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All entity types</option>
              {(entityTypesQuery.data ?? []).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Entity ID" htmlFor="audit-entity-id" hint="Exact record id.">
            <Input
              id="audit-entity-id"
              value={entityId}
              className="anwar-mono"
              onChange={(event) => {
                setEntityId(event.target.value);
                setPage(1);
              }}
            />
          </Field>

          <Field label="Actor" htmlFor="audit-actor">
            <div className="relative">
              {actor ? (
                <div className="flex items-center justify-between gap-2 rounded-control border border-edge bg-surface px-3 py-2">
                  <span className="min-w-0 truncate text-body">
                    {actor.fullName} <span className="anwar-mono text-caption text-ink-secondary">{actor.employeeCode}</span>
                  </span>
                  <IconButton
                    label="Clear actor filter"
                    onClick={() => {
                      setActor(null);
                      setActorSearch('');
                      setPage(1);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </IconButton>
                </div>
              ) : (
                <>
                  <Input
                    id="audit-actor"
                    type="search"
                    value={actorSearch}
                    placeholder="Search name or Employee ID…"
                    onChange={(event) => {
                      setActorSearch(event.target.value);
                      setActorOpen(true);
                    }}
                    onFocus={() => setActorOpen(true)}
                  />
                  {actorOpen && actorTerm.length >= 2 ? (
                    <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-control border border-edge bg-surface shadow-raised">
                      {directoryQuery.isPending ? (
                        <p className="px-3 py-3 text-caption text-ink-secondary">Searching…</p>
                      ) : !directoryQuery.data?.length ? (
                        <p className="px-3 py-3 text-caption text-ink-secondary">No match for “{actorTerm}”.</p>
                      ) : (
                        <ul className="anwar-scroll max-h-56 divide-y divide-edge/70">
                          {directoryQuery.data.map((entry) => (
                            <li key={entry.id}>
                              <button
                                type="button"
                                className="w-full px-3 py-2 text-left hover:bg-navy-50"
                                onClick={() => {
                                  setActor(entry);
                                  setActorOpen(false);
                                  setPage(1);
                                }}
                              >
                                <p className="text-caption font-semibold text-ink">{entry.fullName}</p>
                                <p className="text-[11px] text-ink-secondary">
                                  <span className="anwar-mono">{entry.employeeCode}</span>
                                  {entry.department ? ` · ${entry.department.name}` : ''}
                                </p>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </Field>

          <Field label="From" htmlFor="audit-from">
            <Input
              id="audit-from"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </Field>

          <Field label="To" htmlFor="audit-to" hint="The whole day is included.">
            <Input
              id="audit-to"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
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
          <EmptyState title="No audit records match your filters" description="Widen the date range or clear the filters." />
        ) : (
          <>
            {data.notice ? (
              <Alert tone="info" className="mb-3">
                {data.notice}
              </Alert>
            ) : null}
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="anwar-table sticky-first-col">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity type</th>
                    <th>Entity ID</th>
                    <th>Reason</th>
                    <th>IP</th>
                    <th>Previous hash</th>
                    <th>Record hash</th>
                    <th className="text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((entry) => {
                    const open = expanded === entry.id;
                    const diff = open ? buildDiff(entry.before, entry.after) : [];
                    const changedFields = open && Array.isArray(entry.changedFields)
                      ? (entry.changedFields as unknown[]).map(String)
                      : [];
                    return (
                      <React.Fragment key={entry.id}>
                        <tr>
                          <td className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</td>
                          <td>
                            <p className="font-semibold text-ink">{entry.actor?.fullName ?? 'System'}</p>
                            <p className="text-caption text-ink-secondary">{actorRoleLabel(entry.actorRole)}</p>
                          </td>
                          <td className="anwar-mono">{entry.action}</td>
                          <td>
                            <Badge tone="neutral">{entry.entityType}</Badge>
                          </td>
                          <td className="anwar-mono max-w-[160px] truncate" title={entry.entityId ?? undefined}>
                            {entry.entityId ?? '—'}
                          </td>
                          <td className="max-w-[220px] truncate" title={entry.reason ?? undefined}>
                            {entry.reason ?? '—'}
                          </td>
                          <td className="anwar-mono">{entry.ipAddress ?? '—'}</td>
                          <td>
                            <span className="anwar-mono">{shortHash(entry.previousHash, 10)}</span>
                          </td>
                          <td>
                            <Tooltip content={<span className="anwar-mono break-all">{entry.recordHash}</span>}>
                              <span className="anwar-mono cursor-help">{shortHash(entry.recordHash, 10)}</span>
                            </Tooltip>
                          </td>
                          <td className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-expanded={open}
                              onClick={() => setExpanded(open ? null : entry.id)}
                            >
                              {open ? 'Hide' : 'Details'}
                            </Button>
                          </td>
                        </tr>
                        {open ? (
                          <tr>
                            <td colSpan={10} className="bg-canvas">
                              <div className="space-y-3 p-2">
                                {changedFields.length ? (
                                  <div>
                                    <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-secondary">
                                      Changed fields
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {changedFields.map((field) => (
                                        <Badge key={field} tone="warning">
                                          {field}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}

                                {diff.length ? (
                                  <div className="overflow-x-auto rounded-control border border-edge bg-surface">
                                    <table className="anwar-table">
                                      <thead>
                                        <tr>
                                          <th className="w-[180px]">Field</th>
                                          <th>Before</th>
                                          <th>After</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {diff.map((row) => (
                                          <tr key={row.field} className={row.changed ? 'bg-warning-tint/40' : undefined}>
                                            <td className="align-top font-semibold text-ink">{row.field}</td>
                                            <td className="align-top">
                                              <pre className="anwar-mono max-w-[420px] whitespace-pre-wrap break-words text-caption text-ink-secondary">
                                                {pretty(row.before)}
                                              </pre>
                                            </td>
                                            <td className="align-top">
                                              <pre className="anwar-mono max-w-[420px] whitespace-pre-wrap break-words text-caption text-ink-secondary">
                                                {pretty(row.after)}
                                              </pre>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <p className="text-caption text-ink-secondary">No before/after payload was recorded.</p>
                                )}

                                <details>
                                  <summary className="cursor-pointer text-caption font-medium text-navy-600">
                                    Raw JSON
                                  </summary>
                                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                                    <div>
                                      <p className="text-caption font-semibold text-ink-secondary">Before</p>
                                      <pre className="anwar-scroll mt-1 max-h-56 rounded-control bg-navy-900 p-3 text-[12px] text-white">
                                        {pretty(entry.before)}
                                      </pre>
                                    </div>
                                    <div>
                                      <p className="text-caption font-semibold text-ink-secondary">After</p>
                                      <pre className="anwar-scroll mt-1 max-h-56 rounded-control bg-navy-900 p-3 text-[12px] text-white">
                                        {pretty(entry.after)}
                                      </pre>
                                    </div>
                                  </div>
                                </details>

                                <p className="text-[11px] text-ink-muted">
                                  Correlation ID: <span className="anwar-mono">{entry.correlationId ?? '—'}</span>
                                  {entry.department ? (
                                    <>
                                      {' '}· Department: {entry.department.name}
                                    </>
                                  ) : null}
                                </p>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
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
    </>
  );
};

export default AuditLogPage;
