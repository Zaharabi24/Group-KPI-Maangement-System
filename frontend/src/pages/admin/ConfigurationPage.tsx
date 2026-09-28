/**
 * ============================================================================
 *  M15 · Configuration versions — FR-CFG-02, §4.9
 * ============================================================================
 *  · The active version is shown prominently with every scoring parameter.
 *  · Publishing creates a new immutable version; client validation mirrors the
 *    server ranges and the confirmation states the §4.9 impact: configuration
 *    applies only to periods opened afterwards — there is no retroactive change.
 *  · Version history diffs each version against the active one.
 *  · "Recalculate open period" is audited and lists the changed KPIs.
 * ============================================================================
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import type { ConfigurationVersionItem, KpiPeriodSummary } from '@/lib/types';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataRow,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  ProgressBar,
  SectionTitle,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { Alert, PageHeader } from '@/components/ui/badges';
import { useToast } from '@/context/ToastContext';

// ------------------------------------------------------------------- helpers

const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'The request could not be completed.';

interface ActiveConfiguration extends Omit<ConfigurationVersionItem, 'id' | 'effectiveFrom' | 'createdAt'> {
  id: string | null;
  effectiveFrom: string | null;
  createdAt: string | null;
  allowedMimeTypes?: string[];
}

interface ConfigurationVersionRow extends ConfigurationVersionItem {
  publishedBy?: { id: string; fullName: string; email: string } | null;
}

interface ChangedKpi {
  id: string;
  code: string;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
}

interface RecalculateResult {
  checked: number;
  changed: number;
  changedKpis: ChangedKpi[];
}

const RUBRIC_LEVELS = [1, 2, 3, 4, 5] as const;
const RUBRIC_WORDS: Record<number, string> = {
  1: 'Far below expectations',
  2: 'Below expectations',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Significantly exceeds expectations',
};

interface PublishForm {
  effectiveFrom: string;
  scoreCap: string;
  scoreFloor: string;
  adjustmentBand: string;
  minWeight: string;
  maxWeight: string;
  maxKpisPerPeriod: string;
  submissionGraceDays: string;
  reviewWindowDays: string;
  reviewSlaDays: string;
  extensionMaxDays: string;
  minReasonLength: string;
  maxEvidenceFiles: string;
  maxEvidenceSizeMb: string;
  rubric1: string;
  rubric2: string;
  rubric3: string;
  rubric4: string;
  rubric5: string;
  ragGreen: string;
  ragAmber: string;
  notes: string;
}

type FormErrors = Partial<Record<keyof PublishForm, string>>;

const toForm = (config: ActiveConfiguration): PublishForm => ({
  effectiveFrom: new Date().toISOString().slice(0, 10),
  scoreCap: String(config.scoreCap),
  scoreFloor: String(config.scoreFloor),
  adjustmentBand: String(config.adjustmentBand),
  minWeight: String(config.minWeight),
  maxWeight: String(config.maxWeight),
  maxKpisPerPeriod: String(config.maxKpisPerPeriod),
  submissionGraceDays: String(config.submissionGraceDays),
  reviewWindowDays: String(config.reviewWindowDays),
  reviewSlaDays: String(config.reviewSlaDays),
  extensionMaxDays: String(config.extensionMaxDays),
  minReasonLength: String(config.minReasonLength),
  maxEvidenceFiles: String(config.maxEvidenceFiles),
  maxEvidenceSizeMb: String(config.maxEvidenceSizeMb),
  rubric1: String(config.qualitativeMap?.['1'] ?? 1),
  rubric2: String(config.qualitativeMap?.['2'] ?? 2),
  rubric3: String(config.qualitativeMap?.['3'] ?? 3),
  rubric4: String(config.qualitativeMap?.['4'] ?? 4),
  rubric5: String(config.qualitativeMap?.['5'] ?? 5),
  ragGreen: String(config.ragThresholds?.green ?? 95),
  ragAmber: String(config.ragThresholds?.amber ?? 75),
  notes: '',
});

const inRange = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max;

/** Mirrors ConfigurationService.publish validation (§4.9). */
const validateForm = (form: PublishForm): FormErrors => {
  const errors: FormErrors = {};
  const num = (key: keyof PublishForm): number => Number(form[key]);

  if (!inRange(num('scoreCap'), 100, 200)) errors.scoreCap = 'Score cap must be between 100 and 200.';
  if (!(num('scoreFloor') >= 0)) errors.scoreFloor = 'Score floor must be 0 or greater.';
  if (!inRange(num('adjustmentBand'), 0, 50)) errors.adjustmentBand = 'Adjustment band must be between 0 and 50.';
  if (!inRange(num('minWeight'), 1, 50)) errors.minWeight = 'Minimum weight must be between 1 and 50.';
  if (!(num('maxWeight') >= num('minWeight') && num('maxWeight') <= 100)) {
    errors.maxWeight = 'Maximum weight must be ≥ minimum weight and at most 100.';
  }
  if (!inRange(num('maxKpisPerPeriod'), 1, 50)) errors.maxKpisPerPeriod = 'Max KPIs must be between 1 and 50.';
  if (!inRange(num('submissionGraceDays'), 0, 30)) errors.submissionGraceDays = 'Grace days must be between 0 and 30.';
  if (!inRange(num('reviewWindowDays'), 0, 30)) errors.reviewWindowDays = 'Review window must be between 0 and 30.';
  if (!inRange(num('reviewSlaDays'), 1, 30)) errors.reviewSlaDays = 'Review SLA must be between 1 and 30 days.';
  if (!inRange(num('extensionMaxDays'), 1, 30)) errors.extensionMaxDays = 'Extension maximum must be between 1 and 30.';
  if (!inRange(num('minReasonLength'), 5, 100)) errors.minReasonLength = 'Minimum reason length must be between 5 and 100.';
  if (!inRange(num('maxEvidenceFiles'), 1, 10)) errors.maxEvidenceFiles = 'Evidence file limit must be between 1 and 10.';
  if (!inRange(num('maxEvidenceSizeMb'), 1, 50)) errors.maxEvidenceSizeMb = 'Evidence size limit must be between 1 and 50 MB.';

  RUBRIC_LEVELS.forEach((level) => {
    const value = num(`rubric${level}` as keyof PublishForm);
    if (!Number.isFinite(value)) {
      errors[`rubric${level}` as keyof PublishForm] = `Rubric level ${level} must be a number.`;
    }
  });

  if (!(num('ragGreen') > num('ragAmber'))) {
    errors.ragGreen = 'The green threshold must be greater than the amber threshold.';
  }

  return errors;
};

// ---------------------------------------------------------------- main page

const ConfigurationPage: React.FC = () => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const activeQuery = useQuery({
    queryKey: ['admin', 'configuration-versions', 'active'],
    queryFn: () => api.get<ActiveConfiguration>('/admin/configuration-versions/active'),
    staleTime: 60_000,
  });

  const historyQuery = useQuery({
    queryKey: ['admin', 'configuration-versions'],
    queryFn: () => api.get<ConfigurationVersionRow[]>('/admin/configuration-versions'),
  });

  const periodsQuery = useQuery({
    queryKey: ['periods', 'selectable'],
    queryFn: () => api.get<KpiPeriodSummary[]>('/periods/selectable'),
    staleTime: 5 * 60_000,
  });

  const active = activeQuery.data;

  // ------------------------------------------------------------ publish form
  const [form, setForm] = React.useState<PublishForm | null>(null);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  React.useEffect(() => {
    if (active && !form) setForm(toForm(active));
  }, [active, form]);

  const set = (key: keyof PublishForm, value: string) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const publishMutation = useMutation({
    mutationFn: (payload: PublishForm) =>
      api.post<ConfigurationVersionItem>('/admin/configuration-versions', {
        effectiveFrom: payload.effectiveFrom || undefined,
        scoreCap: Number(payload.scoreCap),
        scoreFloor: Number(payload.scoreFloor),
        adjustmentBand: Number(payload.adjustmentBand),
        minWeight: Number(payload.minWeight),
        maxWeight: Number(payload.maxWeight),
        maxKpisPerPeriod: Number(payload.maxKpisPerPeriod),
        submissionGraceDays: Number(payload.submissionGraceDays),
        reviewWindowDays: Number(payload.reviewWindowDays),
        reviewSlaDays: Number(payload.reviewSlaDays),
        extensionMaxDays: Number(payload.extensionMaxDays),
        minReasonLength: Number(payload.minReasonLength),
        maxEvidenceFiles: Number(payload.maxEvidenceFiles),
        maxEvidenceSizeMb: Number(payload.maxEvidenceSizeMb),
        qualitativeMap: RUBRIC_LEVELS.reduce<Record<string, number>>((map, level) => {
          map[String(level)] = Number(payload[`rubric${level}` as keyof PublishForm]);
          return map;
        }, {}),
        ragThresholds: { green: Number(payload.ragGreen), amber: Number(payload.ragAmber) },
        categories: active?.categories,
        notes: payload.notes.trim() || undefined,
      }),
    onSuccess: (created) => {
      toast.success(
        `Configuration version ${created.version} published`,
        'It applies only to periods opened after the effective date — no retroactive change (§4.9).',
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'configuration-versions'] });
      setConfirmOpen(false);
      setForm(null);
    },
    onError: (error) => toast.error('Could not publish the configuration', messageOf(error)),
  });

  const submit = () => {
    if (!form) return;
    const nextErrors = validateForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      toast.warning('Fix the highlighted fields', 'The server validates exactly the same ranges.');
      return;
    }
    setConfirmOpen(true);
  };

  // ------------------------------------------------------------- recalculation
  const [recalcOpen, setRecalcOpen] = React.useState(false);
  const [recalcPeriodId, setRecalcPeriodId] = React.useState('');
  const [recalcReason, setRecalcReason] = React.useState('');
  const [recalcResult, setRecalcResult] = React.useState<RecalculateResult | null>(null);

  React.useEffect(() => {
    if (recalcOpen) {
      setRecalcPeriodId(periodsQuery.data?.[0]?.id ?? '');
      setRecalcReason('');
    }
  }, [recalcOpen, periodsQuery.data]);

  const recalcMutation = useMutation({
    mutationFn: (payload: { periodId: string; reason: string }) =>
      api.post<RecalculateResult>('/admin/configuration-versions/recalculate', payload),
    onSuccess: (result) => {
      setRecalcResult(result);
      setRecalcOpen(false);
      toast.success(
        'Recalculation complete',
        `${result.checked} KPI(s) checked · ${result.changed} score(s) changed. The run is audited.`,
      );
    },
    onError: (error) => toast.error('Could not recalculate the period', messageOf(error)),
  });

  // --------------------------------------------------------------- diff expander
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const diffRows = (row: ConfigurationVersionRow): Array<{ label: string; current: string; version: string; changed: boolean }> => {
    if (!active) return [];
    const fields: Array<{ label: string; current: string; version: string }> = [
      { label: 'Score cap', current: String(active.scoreCap), version: String(row.scoreCap) },
      { label: 'Score floor', current: String(active.scoreFloor), version: String(row.scoreFloor) },
      { label: 'Adjustment band', current: String(active.adjustmentBand), version: String(row.adjustmentBand) },
      { label: 'Min weight', current: String(active.minWeight), version: String(row.minWeight) },
      { label: 'Max weight', current: String(active.maxWeight), version: String(row.maxWeight) },
      { label: 'Max KPIs', current: String(active.maxKpisPerPeriod), version: String(row.maxKpisPerPeriod) },
      { label: 'Submission grace (days)', current: String(active.submissionGraceDays), version: String(row.submissionGraceDays) },
      { label: 'Review window (days)', current: String(active.reviewWindowDays), version: String(row.reviewWindowDays) },
      { label: 'Review SLA (days)', current: String(active.reviewSlaDays), version: String(row.reviewSlaDays) },
      { label: 'Extension max (days)', current: String(active.extensionMaxDays), version: String(row.extensionMaxDays) },
      { label: 'Min reason length', current: String(active.minReasonLength), version: String(row.minReasonLength) },
      { label: 'Max evidence files', current: String(active.maxEvidenceFiles), version: String(row.maxEvidenceFiles) },
      { label: 'Max evidence size (MB)', current: String(active.maxEvidenceSizeMb), version: String(row.maxEvidenceSizeMb) },
      {
        label: 'RAG green / amber',
        current: `${active.ragThresholds?.green} / ${active.ragThresholds?.amber}`,
        version: `${row.ragThresholds?.green} / ${row.ragThresholds?.amber}`,
      },
      ...RUBRIC_LEVELS.map((level) => ({
        label: `Rubric L${level}`,
        current: String(active.qualitativeMap?.[String(level)] ?? '—'),
        version: String(row.qualitativeMap?.[String(level)] ?? '—'),
      })),
    ];
    return fields.map((field) => ({ ...field, changed: field.current !== field.version }));
  };

  if (activeQuery.isError) {
    return (
      <>
        <PageHeader title="Configuration versions" subtitle="FR-CFG-02 — scoring parameters, rubric and RAG thresholds." />
        <ErrorState message={messageOf(activeQuery.error)} onRetry={() => void activeQuery.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Configuration versions"
        subtitle="FR-CFG-02 / §4.9 — the active configuration is immutable, versioned and never applied retroactively."
        actions={
          <>
            <Button variant="secondary" onClick={() => setRecalcOpen(true)}>
              Recalculate open period
            </Button>
            <Button
              onClick={() => {
                setErrors({});
                document.getElementById('publish-configuration')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              Publish new version
            </Button>
          </>
        }
      />

      {/* ------------------------------------------------------- active version */}
      <Card className="mb-4">
        <CardHeader
          title={`Active version${active ? ` — v${active.version}` : ''}`}
          subtitle={
            active?.effectiveFrom
              ? `Effective from ${formatDate(active.effectiveFrom)}`
              : 'No configuration version has been published yet — the platform defaults are in force.'
          }
          actions={<Badge tone={active?.id ? 'success' : 'warning'}>{active?.id ? 'Published' : 'Platform defaults'}</Badge>}
        />
        {activeQuery.isPending || !active ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <dl>
              <DataRow label="Score cap" mono>
                {active.scoreCap}
              </DataRow>
              <DataRow label="Score floor" mono>
                {active.scoreFloor}
              </DataRow>
              <DataRow label="Adjustment band (±)" mono>
                {active.adjustmentBand}
              </DataRow>
              <DataRow label="Weight limits">
                {active.minWeight}% – {active.maxWeight}%
              </DataRow>
              <DataRow label="Max KPIs per period" mono>
                {active.maxKpisPerPeriod}
              </DataRow>
              <DataRow label="Submission grace days" mono>
                {active.submissionGraceDays}
              </DataRow>
              <DataRow label="Review window (days)" mono>
                {active.reviewWindowDays}
              </DataRow>
              <DataRow label="Review SLA (working days)" mono>
                {active.reviewSlaDays}
              </DataRow>
              <DataRow label="Extension max days" mono>
                {active.extensionMaxDays}
              </DataRow>
              <DataRow label="Min reason length" mono>
                {active.minReasonLength}
              </DataRow>
              <DataRow label="Evidence files / size">
                {active.maxEvidenceFiles} files · {active.maxEvidenceSizeMb} MB
              </DataRow>
              <DataRow label="Notes">{active.notes ?? '—'}</DataRow>
            </dl>

            <div>
              <SectionTitle hint="A-10 — all five levels are mandatory and drive qualitative scoring (§4.2).">
                Qualitative rubric map
              </SectionTitle>
              <ul className="mb-4 space-y-2">
                {RUBRIC_LEVELS.map((level) => {
                  const value = Number(active.qualitativeMap?.[String(level)] ?? 0);
                  return (
                    <li key={level} className="flex items-center gap-3">
                      <span className="anwar-badge w-10 justify-center bg-navy-50 text-navy-700">L{level}</span>
                      <ProgressBar value={value} max={5} className="flex-1" tone={level >= 4 ? 'success' : level === 3 ? 'navy' : 'warning'} />
                      <span className="tnum w-10 text-right text-caption font-semibold text-ink">{value.toFixed(1)}</span>
                      <span className="hidden w-56 text-caption text-ink-secondary sm:block">{RUBRIC_WORDS[level]}</span>
                    </li>
                  );
                })}
              </ul>

              <SectionTitle hint="§4.5 — green must stay above amber.">RAG thresholds</SectionTitle>
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge tone="success">Green ≥ {active.ragThresholds?.green}%</Badge>
                <Badge tone="warning">Amber ≥ {active.ragThresholds?.amber}%</Badge>
                <Badge tone="danger">Red &lt; {active.ragThresholds?.amber}%</Badge>
              </div>

              <SectionTitle hint="Only these category codes may be used on KPIs and templates.">Categories</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {active.categories?.map((category) => (
                  <Badge key={category} tone="info">
                    {titleCase(category)}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------- recalculate result */}
      {recalcResult ? (
        <Card className="mb-4">
          <CardHeader
            title="Recalculation result"
            subtitle={`${recalcResult.checked} KPI(s) checked · ${recalcResult.changed} score(s) changed. This run is audited (§4.9).`}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setRecalcResult(null)}>
                Dismiss
              </Button>
            }
          />
          {recalcResult.changedKpis.length ? (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="anwar-table sticky-first-col">
                <thead>
                  <tr>
                    <th>KPI</th>
                    <th>Achievement</th>
                    <th>Calculated score</th>
                    <th>Final score</th>
                    <th>Weighted score</th>
                  </tr>
                </thead>
                <tbody>
                  {recalcResult.changedKpis.map((kpi) => (
                    <tr key={kpi.id}>
                      <td className="anwar-mono">{kpi.code}</td>
                      {(['achievement', 'calculatedScore', 'finalScore', 'weightedScore'] as const).map((field) => (
                        <td key={field} className="tnum">
                          <span className="text-ink-muted line-through">{kpi.before[field] ?? '—'}</span>{' '}
                          <span className="font-semibold text-ink">{kpi.after[field] ?? '—'}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-body text-success">No scores changed with the active configuration.</p>
          )}
        </Card>
      ) : null}

      {/* ------------------------------------------------------ publish form */}
      <Card className="mb-4" id="publish-configuration">
        <CardHeader
          title="Publish a new version"
          subtitle="Every parameter is editable. The same ranges the server enforces are validated here before publishing."
        />

        {!form ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Effective from" htmlFor="cfg-effective" required hint="Configuration applies only to periods opened afterwards.">
                <Input
                  id="cfg-effective"
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(event) => set('effectiveFrom', event.target.value)}
                />
              </Field>
              <Field label="Score cap (100–200)" htmlFor="cfg-cap" required error={errors.scoreCap}>
                <Input id="cfg-cap" type="number" value={form.scoreCap} onChange={(event) => set('scoreCap', event.target.value)} invalid={Boolean(errors.scoreCap)} />
              </Field>
              <Field label="Score floor (≥ 0)" htmlFor="cfg-floor" required error={errors.scoreFloor}>
                <Input id="cfg-floor" type="number" value={form.scoreFloor} onChange={(event) => set('scoreFloor', event.target.value)} invalid={Boolean(errors.scoreFloor)} />
              </Field>
              <Field label="Adjustment band (0–50)" htmlFor="cfg-band" required error={errors.adjustmentBand}>
                <Input id="cfg-band" type="number" value={form.adjustmentBand} onChange={(event) => set('adjustmentBand', event.target.value)} invalid={Boolean(errors.adjustmentBand)} />
              </Field>
              <Field label="Min weight (1–50)" htmlFor="cfg-min-weight" required error={errors.minWeight}>
                <Input id="cfg-min-weight" type="number" value={form.minWeight} onChange={(event) => set('minWeight', event.target.value)} invalid={Boolean(errors.minWeight)} />
              </Field>
              <Field label="Max weight (≥ min, ≤ 100)" htmlFor="cfg-max-weight" required error={errors.maxWeight}>
                <Input id="cfg-max-weight" type="number" value={form.maxWeight} onChange={(event) => set('maxWeight', event.target.value)} invalid={Boolean(errors.maxWeight)} />
              </Field>
              <Field label="Max KPIs per period (1–50)" htmlFor="cfg-max-kpis" required error={errors.maxKpisPerPeriod}>
                <Input id="cfg-max-kpis" type="number" value={form.maxKpisPerPeriod} onChange={(event) => set('maxKpisPerPeriod', event.target.value)} invalid={Boolean(errors.maxKpisPerPeriod)} />
              </Field>
              <Field label="Submission grace days (0–30)" htmlFor="cfg-grace" required error={errors.submissionGraceDays}>
                <Input id="cfg-grace" type="number" value={form.submissionGraceDays} onChange={(event) => set('submissionGraceDays', event.target.value)} invalid={Boolean(errors.submissionGraceDays)} />
              </Field>
              <Field label="Review window days (0–30)" htmlFor="cfg-window" required error={errors.reviewWindowDays}>
                <Input id="cfg-window" type="number" value={form.reviewWindowDays} onChange={(event) => set('reviewWindowDays', event.target.value)} invalid={Boolean(errors.reviewWindowDays)} />
              </Field>
              <Field label="Review SLA days (1–30)" htmlFor="cfg-sla" required error={errors.reviewSlaDays}>
                <Input id="cfg-sla" type="number" value={form.reviewSlaDays} onChange={(event) => set('reviewSlaDays', event.target.value)} invalid={Boolean(errors.reviewSlaDays)} />
              </Field>
              <Field label="Extension max days (1–30)" htmlFor="cfg-extension" required error={errors.extensionMaxDays}>
                <Input id="cfg-extension" type="number" value={form.extensionMaxDays} onChange={(event) => set('extensionMaxDays', event.target.value)} invalid={Boolean(errors.extensionMaxDays)} />
              </Field>
              <Field label="Min reason length (5–100)" htmlFor="cfg-reason-length" required error={errors.minReasonLength}>
                <Input id="cfg-reason-length" type="number" value={form.minReasonLength} onChange={(event) => set('minReasonLength', event.target.value)} invalid={Boolean(errors.minReasonLength)} />
              </Field>
              <Field label="Max evidence files (1–10)" htmlFor="cfg-evidence-files" required error={errors.maxEvidenceFiles}>
                <Input id="cfg-evidence-files" type="number" value={form.maxEvidenceFiles} onChange={(event) => set('maxEvidenceFiles', event.target.value)} invalid={Boolean(errors.maxEvidenceFiles)} />
              </Field>
              <Field label="Max evidence size MB (1–50)" htmlFor="cfg-evidence-size" required error={errors.maxEvidenceSizeMb}>
                <Input id="cfg-evidence-size" type="number" value={form.maxEvidenceSizeMb} onChange={(event) => set('maxEvidenceSizeMb', event.target.value)} invalid={Boolean(errors.maxEvidenceSizeMb)} />
              </Field>
            </div>

            <div className="mt-6">
              <SectionTitle hint="All five levels are required (A-10).">Qualitative rubric map</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {RUBRIC_LEVELS.map((level) => {
                  const key = `rubric${level}` as keyof PublishForm;
                  return (
                    <Field key={level} label={`L${level} — ${RUBRIC_WORDS[level]}`} htmlFor={`cfg-rubric-${level}`} required error={errors[key]}>
                      <Input
                        id={`cfg-rubric-${level}`}
                        type="number"
                        step="0.1"
                        value={form[key]}
                        onChange={(event) => set(key, event.target.value)}
                        invalid={Boolean(errors[key])}
                      />
                    </Field>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="RAG green threshold" htmlFor="cfg-rag-green" required hint="Green must be greater than amber." error={errors.ragGreen}>
                <Input id="cfg-rag-green" type="number" value={form.ragGreen} onChange={(event) => set('ragGreen', event.target.value)} invalid={Boolean(errors.ragGreen)} />
              </Field>
              <Field label="RAG amber threshold" htmlFor="cfg-rag-amber" required error={errors.ragAmber}>
                <Input id="cfg-rag-amber" type="number" value={form.ragAmber} onChange={(event) => set('ragAmber', event.target.value)} invalid={Boolean(errors.ragAmber)} />
              </Field>
              <Field label="Notes" htmlFor="cfg-notes" hint="Shown in the version history and written to the audit trail.">
                <Input id="cfg-notes" value={form.notes} maxLength={1000} onChange={(event) => set('notes', event.target.value)} />
              </Field>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-caption text-ink-secondary">
                Categories and allowed evidence MIME types are carried over from the active version.
              </p>
              <Button loading={publishMutation.isPending} onClick={submit}>
                Review &amp; publish
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* ------------------------------------------------------ version history */}
      <Card>
        <CardHeader
          title="Version history"
          subtitle="Newest first. Each version is immutable — editing means publishing the next version."
        />
        {historyQuery.isError ? (
          <ErrorState message={messageOf(historyQuery.error)} onRetry={() => void historyQuery.refetch()} />
        ) : historyQuery.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : !historyQuery.data?.length ? (
          <EmptyState title="No versions published" description="The platform defaults are in force until the first version is published." />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="anwar-table sticky-first-col">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Effective from</th>
                  <th>Published by</th>
                  <th>Published at</th>
                  <th>Notes</th>
                  <th className="text-right">Diff</th>
                </tr>
              </thead>
              <tbody>
                {historyQuery.data.map((version) => (
                  <React.Fragment key={version.id}>
                    <tr>
                      <td>
                        <span className="font-semibold text-ink">v{version.version}</span>{' '}
                        {version.isActive ? <Badge tone="success">Active</Badge> : null}
                      </td>
                      <td>{formatDate(version.effectiveFrom)}</td>
                      <td>{version.publishedBy?.fullName ?? '—'}</td>
                      <td>{formatDateTime(version.createdAt)}</td>
                      <td className="max-w-[260px] truncate" title={version.notes ?? undefined}>
                        {version.notes ?? '—'}
                      </td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={expanded === version.id}
                          onClick={() => setExpanded(expanded === version.id ? null : version.id)}
                        >
                          {expanded === version.id ? 'Hide diff' : 'Diff against current'}
                        </Button>
                      </td>
                    </tr>
                    {expanded === version.id ? (
                      <tr>
                        <td colSpan={6} className="bg-canvas">
                          <table className="anwar-table">
                            <thead>
                              <tr>
                                <th>Parameter</th>
                                <th>Active version</th>
                                <th>
                                  v{version.version}
                                  {version.isActive ? ' (this is the active version)' : ''}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {diffRows(version).map((row) => (
                                <tr key={row.label} className={row.changed ? 'bg-warning-tint/40' : undefined}>
                                  <td>{row.label}</td>
                                  <td className="tnum">{row.current}</td>
                                  <td className="tnum">
                                    {row.version}
                                    {row.changed ? (
                                      <span className="ml-2 text-[11px] font-semibold uppercase text-warning">changed</span>
                                    ) : null}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* --------------------------------------------------- confirm publish */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Publish this configuration version?"
        description="The previous version is deactivated in the same transaction. The new version is immutable."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={publishMutation.isPending}
              onClick={() => {
                if (form) publishMutation.mutate(form);
              }}
            >
              Publish version
            </Button>
          </>
        }
      >
        <Alert tone="warning" title="Configuration applies only to periods opened afterwards">
          No retroactive configuration (§4.9): periods that are already open keep the configuration they were opened
          with until an explicit recalculation is run. Publishing is audited and notifies the affected roles.
        </Alert>
      </Modal>

      {/* ------------------------------------------------- recalculate modal */}
      <Modal
        open={recalcOpen}
        onClose={() => setRecalcOpen(false)}
        title="Recalculate an open period"
        description="Re-runs the calculation engine for every non-deleted KPI with the active configuration."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRecalcOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={recalcMutation.isPending}
              disabled={!recalcPeriodId || recalcReason.trim().length < 15}
              onClick={() => {
                if (recalcPeriodId && recalcReason.trim().length >= 15) {
                  recalcMutation.mutate({ periodId: recalcPeriodId, reason: recalcReason.trim() });
                }
              }}
            >
              Recalculate
            </Button>
          </>
        }
      >
        <Alert tone="warning" className="mb-4">
          This run is audited and writes a calculation log for every KPI. Only open or reopened periods can be
          recalculated — closed (historical) periods are never touched.
        </Alert>
        <div className="space-y-4">
          <Field label="Period" htmlFor="recalc-period" required hint="Only open or reopened periods are listed.">
            <Select id="recalc-period" value={recalcPeriodId} onChange={(event) => setRecalcPeriodId(event.target.value)}>
              <option value="">Select a period…</option>
              {(periodsQuery.data ?? []).map((period) => (
                <option key={period.id} value={period.id}>
                  {period.label} · {titleCase(period.frequency)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Reason"
            htmlFor="recalc-reason"
            required
            hint="At least 15 characters."
            error={recalcReason.length > 0 && recalcReason.trim().length < 15 ? 'Enter at least 15 characters.' : null}
          >
            <Textarea
              id="recalc-reason"
              value={recalcReason}
              rows={3}
              maxLength={1000}
              onChange={(event) => setRecalcReason(event.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
};

export default ConfigurationPage;
