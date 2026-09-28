/**
 * ============================================================================
 *  M15 · System health — NFR-LOG-01, §5.2
 * ============================================================================
 *  Super Admin / System Administrator diagnostics: database, Redis, the three
 *  Bull queues, e-mail, storage, the last scheduled job runs and the
 *  environment. No KPI content is ever exposed here.
 *
 *  There is deliberately no "run a job now" control — the seven scheduled jobs
 *  run automatically on the scheduler.
 * ============================================================================
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  SectionTitle,
  Skeleton,
} from '@/components/ui';
import { Alert, PageHeader } from '@/components/ui/badges';

// ------------------------------------------------------------------- helpers

interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  backlog: number;
}

interface QueueFailure {
  id: string | number;
  name: string;
  failedReason: string;
  attemptsMade: number;
  timestamp: string | null;
}

interface ScheduledJobRun {
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

interface SystemHealth {
  status: string;
  responseMs: number;
  database: { connected: boolean; users: number; kpis: number; auditRecords: number };
  redis: { connected: boolean };
  queues: { email: QueueCounts; export: QueueCounts; scheduled: QueueCounts };
  queueFailures: { email: QueueFailure[]; export: QueueFailure[]; scheduled: QueueFailure[] };
  email: { enabled: boolean; smtpReachable: boolean; failedMessages: number };
  storage: {
    evidencePath: string;
    evidenceWritable: boolean;
    exportPath: string;
    exportWritable: boolean;
    encryptionAtRest: boolean;
    malwareScan: boolean;
  };
  scheduledJobs: ScheduledJobRun[];
  environment: { nodeEnv: string | null; timezone: string; workingWeek: string; allowedEmailDomain: string };
}

const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'The request could not be completed.';

const jobStatusTone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  const normalised = status.toUpperCase();
  if (normalised === 'SUCCESS' || normalised === 'COMPLETED' || normalised === 'OK') return 'success';
  if (normalised === 'RUNNING' || normalised === 'PENDING' || normalised === 'QUEUED') return 'warning';
  if (normalised === 'FAILED' || normalised === 'ERROR') return 'danger';
  return 'neutral';
};

const durationLabel = (run: ScheduledJobRun): string => {
  if (!run.endedAt) return 'still running';
  const ms = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
};

const healthTone = (ok: boolean | undefined): 'success' | 'danger' => (ok ? 'success' : 'danger');

const AUTO_REFRESH_MS = 60_000;

const SCHEDULED_JOBS: Array<{ name: string; detail: string }> = [
  { name: 'Deadline reminders (NT-13 / NT-14)', detail: 'Reminds employees before the submission deadline and approvers before the review deadline.' },
  { name: 'Overdue sweep (EC-09)', detail: 'Marks KPIs Not Submitted after the deadline and releases the escalation flow.' },
  { name: 'SLA check (NT-15)', detail: 'Flags approval requests approaching or breaching the review SLA.' },
  { name: 'Nightly calculation verification (FR-CAL-04)', detail: 'Re-runs the calculation engine and reports any drift.' },
  { name: 'Audit hash-chain verification', detail: 'Recalculates the audit chain and alerts when a link is broken (§18).' },
  { name: 'Daily digest', detail: 'Sends the non-critical notification digest to opted-in users.' },
  { name: 'Retention purge', detail: 'Deletes expired exports, sessions and tokens per the retention policy.' },
];

const QueueCard: React.FC<{ queue: QueueCounts; label: string }> = ({ queue, label }) => {
  const cells: Array<{ label: string; value: number; tone?: 'danger' | 'warning' }> = [
    { label: 'Waiting', value: queue.waiting },
    { label: 'Active', value: queue.active },
    { label: 'Completed', value: queue.completed },
    { label: 'Failed', value: queue.failed, tone: queue.failed > 0 ? 'danger' : undefined },
    { label: 'Delayed', value: queue.delayed },
    { label: 'Backlog', value: queue.backlog, tone: queue.backlog > 0 ? 'warning' : undefined },
  ];
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-caption uppercase tracking-wide text-ink-secondary">{label}</p>
          <p className="anwar-mono text-body text-navy-900">{queue.name}</p>
        </div>
        <Badge tone={queue.failed > 0 ? 'danger' : queue.backlog > 0 ? 'warning' : 'success'}>
          {queue.failed > 0 ? `${queue.failed} failed` : queue.backlog > 0 ? `${queue.backlog} backlog` : 'Healthy'}
        </Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-control border border-edge px-2 py-1.5">
            <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">{cell.label}</dt>
            <dd
              className={`tnum text-body font-semibold ${
                cell.tone === 'danger' ? 'text-danger' : cell.tone === 'warning' ? 'text-warning' : 'text-ink'
              }`}
            >
              {cell.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
};

// ------------------------------------------------------------------- page

const SystemHealthPage: React.FC = () => {
  const query = useQuery({
    queryKey: ['health', 'system'],
    queryFn: () => api.get<SystemHealth>('/health/system'),
    refetchInterval: AUTO_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const data = query.data;

  return (
    <>
      <PageHeader
        title="System health"
        subtitle="NFR-LOG-01 / §5.2 — infrastructure and scheduler diagnostics for the Super Admin and System Administrator."
        actions={
          <Button variant="secondary" loading={query.isFetching && !query.isPending} onClick={() => void query.refetch()}>
            Refresh
          </Button>
        }
      />

      <p className="mb-4 text-caption text-ink-secondary">
        Auto-refreshes every 60 seconds.
        {query.dataUpdatedAt ? <> Last updated {formatRelative(new Date(query.dataUpdatedAt))}.</> : null}
      </p>

      {query.isError ? (
        <ErrorState message={messageOf(query.error)} onRetry={() => void query.refetch()} />
      ) : query.isPending || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <>
          {/* --------------------------------------------------- infrastructure */}
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Database"
                subtitle={`Responded in ${data.responseMs} ms.`}
                actions={<Badge tone={healthTone(data.database.connected)}>{data.database.connected ? 'Connected' : 'Down'}</Badge>}
              />
              <dl className="grid grid-cols-3 gap-3">
                <div>
                  <dt className="text-caption text-ink-secondary">Users</dt>
                  <dd className="tnum text-h3 text-navy-900">{data.database.users.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-caption text-ink-secondary">KPIs</dt>
                  <dd className="tnum text-h3 text-navy-900">{data.database.kpis.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-caption text-ink-secondary">Audit records</dt>
                  <dd className="tnum text-h3 text-navy-900">{data.database.auditRecords.toLocaleString()}</dd>
                </div>
              </dl>
            </Card>

            <Card>
              <CardHeader
                title="Cache & e-mail"
                subtitle="Redis backs sessions, rate limits and the queues."
                actions={<Badge tone={healthTone(data.redis.connected)}>{data.redis.connected ? 'Redis up' : 'Redis down'}</Badge>}
              />
              <dl className="space-y-2">
                <div className="flex items-center justify-between gap-3 border-b border-edge/70 pb-2">
                  <dt className="text-caption text-ink-secondary">Mail sending</dt>
                  <dd>
                    <Badge tone={data.email.enabled ? 'success' : 'warning'}>
                      {data.email.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-edge/70 pb-2">
                  <dt className="text-caption text-ink-secondary">SMTP reachability</dt>
                  <dd>
                    <Badge tone={data.email.smtpReachable ? 'success' : 'danger'}>
                      {data.email.smtpReachable ? 'Reachable' : 'Unreachable'}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-caption text-ink-secondary">Failed messages</dt>
                  <dd className={`tnum font-semibold ${data.email.failedMessages > 0 ? 'text-danger' : 'text-ink'}`}>
                    {data.email.failedMessages.toLocaleString()}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>

          {/* --------------------------------------------------------- queues */}
          <SectionTitle hint="Bull queues for outbound e-mail, report exports and scheduled work.">
            Queue health
          </SectionTitle>
          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <QueueCard queue={data.queues.email} label="E-mail queue" />
            <QueueCard queue={data.queues.export} label="Export queue" />
            <QueueCard queue={data.queues.scheduled} label="Scheduled queue" />
          </div>

          {/* ----------------------------------------------- queue failures */}
          <Card className="mb-4">
            <CardHeader title="Recent queue failures" subtitle="The last 10 failures per queue — no KPI content is shown." />
            <div className="grid gap-4 lg:grid-cols-3">
              {(['email', 'export', 'scheduled'] as const).map((key) => {
                const failures = data.queueFailures[key] ?? [];
                return (
                  <div key={key}>
                    <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-secondary">
                      {key} · {failures.length}
                    </p>
                    {!failures.length ? (
                      <p className="text-caption text-success">No failures recorded.</p>
                    ) : (
                      <ul className="anwar-scroll max-h-56 space-y-2">
                        {failures.map((failure) => (
                          <li key={`${key}-${failure.id}`} className="rounded-control border border-edge px-3 py-2">
                            <p className="anwar-mono text-caption font-semibold text-ink">{failure.name}</p>
                            <p className="mt-0.5 break-words text-caption text-danger">{failure.failedReason}</p>
                            <p className="text-[11px] text-ink-muted">
                              {failure.attemptsMade} attempt(s)
                              {failure.timestamp ? ` · ${formatDateTime(failure.timestamp)}` : ''}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* -------------------------------------------------------- storage */}
          <Card className="mb-4">
            <CardHeader title="Storage" subtitle="Evidence and export directories with their security flags." />
            <div className="grid gap-4 lg:grid-cols-2">
              <dl>
                <div className="flex items-center justify-between gap-3 border-b border-edge/70 py-2">
                  <dt className="text-caption text-ink-secondary">Evidence path</dt>
                  <dd className="anwar-mono max-w-[70%] truncate text-caption text-ink" title={data.storage.evidencePath}>
                    {data.storage.evidencePath}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-edge/70 py-2">
                  <dt className="text-caption text-ink-secondary">Evidence writable</dt>
                  <dd>
                    <Badge tone={healthTone(data.storage.evidenceWritable)}>
                      {data.storage.evidenceWritable ? 'Writable' : 'Not writable'}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-edge/70 py-2">
                  <dt className="text-caption text-ink-secondary">Export path</dt>
                  <dd className="anwar-mono max-w-[70%] truncate text-caption text-ink" title={data.storage.exportPath}>
                    {data.storage.exportPath}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-caption text-ink-secondary">Export writable</dt>
                  <dd>
                    <Badge tone={healthTone(data.storage.exportWritable)}>
                      {data.storage.exportWritable ? 'Writable' : 'Not writable'}
                    </Badge>
                  </dd>
                </div>
              </dl>
              <div className="space-y-3">
                <Alert tone={data.storage.encryptionAtRest ? 'success' : 'warning'} title="Encryption at rest">
                  {data.storage.encryptionAtRest
                    ? 'Evidence files are encrypted at rest (NFR-SEC-04).'
                    : 'Encryption at rest is disabled — enable EVIDENCE_ENCRYPT_AT_REST before storing evidence.'}
                </Alert>
                <Alert tone={data.storage.malwareScan ? 'success' : 'warning'} title="Malware scan">
                  {data.storage.malwareScan
                    ? 'Uploaded evidence is scanned before it is released.'
                    : 'The malware scanner is disabled (MALWARE_SCAN_ENABLED=false).'}
                </Alert>
              </div>
            </div>
          </Card>

          {/* ---------------------------------------------------- scheduled jobs */}
          <Card className="mb-4">
            <CardHeader
              title="Scheduled job runs"
              subtitle="The last 15 runs recorded by the scheduler, with status and duration."
            />
            <Alert tone="info" className="mb-4" title="Jobs run automatically — there is no manual trigger">
              Seven scheduled jobs keep the platform in order: deadline reminders (NT-13 / NT-14), the overdue sweep
              (EC-09), the SLA check (NT-15), the nightly calculation verification (FR-CAL-04), the audit hash-chain
              verification, the daily digest and the retention purge. The scheduler owns their cadence; running them by
              hand could breach the notification and audit guarantees, so this screen is read-only.
            </Alert>

            {!data.scheduledJobs.length ? (
              <EmptyState title="No job runs recorded" description="Runs appear here as soon as the scheduler executes." />
            ) : (
              <div className="-mx-4 overflow-x-auto sm:mx-0">
                <table className="anwar-table sticky-first-col">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Ended</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.scheduledJobs.map((run, index) => (
                      <tr key={`${run.name}-${run.startedAt}-${index}`}>
                        <td className="anwar-mono">{run.name}</td>
                        <td>
                          <Badge tone={jobStatusTone(run.status)}>{run.status}</Badge>
                        </td>
                        <td>{formatDateTime(run.startedAt)}</td>
                        <td>{run.endedAt ? formatDateTime(run.endedAt) : '—'}</td>
                        <td className="tnum">{durationLabel(run)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-5 border-t border-edge pt-4">
              <SectionTitle>What these jobs do</SectionTitle>
              <ul className="grid gap-2 sm:grid-cols-2">
                {SCHEDULED_JOBS.map((job) => (
                  <li key={job.name} className="rounded-control border border-edge px-3 py-2">
                    <p className="text-caption font-semibold text-ink">{job.name}</p>
                    <p className="text-[11px] text-ink-secondary">{job.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          {/* --------------------------------------------------- environment */}
          <Card>
            <CardHeader title="Environment" subtitle="Runtime configuration used by this instance." />
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-control border border-edge px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">Node environment</dt>
                <dd className="anwar-mono mt-0.5 text-body text-ink">{data.environment.nodeEnv ?? '—'}</dd>
              </div>
              <div className="rounded-control border border-edge px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">Timezone</dt>
                <dd className="mt-0.5 text-body text-ink">{data.environment.timezone}</dd>
              </div>
              <div className="rounded-control border border-edge px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">Working week</dt>
                <dd className="mt-0.5 text-caption text-ink">{data.environment.workingWeek}</dd>
              </div>
              <div className="rounded-control border border-edge px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">Allowed e-mail domain</dt>
                <dd className="anwar-mono mt-0.5 text-body text-ink">{data.environment.allowedEmailDomain}</dd>
              </div>
            </dl>
          </Card>
        </>
      )}
    </>
  );
};

export default SystemHealthPage;
