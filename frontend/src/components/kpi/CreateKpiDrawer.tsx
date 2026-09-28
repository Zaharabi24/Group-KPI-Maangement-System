/**
 * ============================================================================
 *  CreateKpiDrawer — FR-KPI-04 / FR-KPI-05 / FR-KPI-11, BRD §3.3
 * ============================================================================
 *  A four-section right drawer that creates or edits a Draft/Returned KPI:
 *    1. Definition     (name, description, category, measurement, weight rules)
 *    2. Target & Weight (target, rubric level, weight, live weight meter)
 *    3. Actual & Evidence (actual, remarks, drag-and-drop evidence upload)
 *    4. Approval        (Approval Person from BR-R03)
 *  The live result panel runs `calculateKpi` — the same algorithm the server
 *  uses (AC-05). Evidence is uploaded against the saved Draft because every
 *  file needs a KPI id (FR-EVD-01).
 * ============================================================================
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type {
  ApproverOptions,
  Direction,
  Frequency,
  KpiDetail,
  MeasurementType,
  TemplateItem,
} from '@/lib/types';
import {
  Badge,
  Button,
  Drawer,
  Field,
  IconButton,
  Input,
  ProgressBar,
  SectionTitle,
  Select,
  Textarea,
  Tooltip,
  cn,
} from '@/components/ui';
import { Alert } from '@/components/ui/badges';
import { usePeriodSelection } from '@/components/layout/PeriodSelector';
import { useToast } from '@/context/ToastContext';
import { DEFAULT_QUALITATIVE_MAP, calculateKpi, formatScore } from '@/lib/calculation';
import {
  DEFAULT_UNITS,
  DIRECTIONS,
  MEASUREMENT_PRECISION,
  MEASUREMENT_TYPE_HELPERS,
  MEASUREMENT_TYPE_LABELS,
  formatBytes,
  shortHash,
} from '@/lib/format';

// ------------------------------------------------------------------ constants

const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'xls', 'csv', 'docx'];
const MAX_EVIDENCE_FILES = 5;
const MAX_EVIDENCE_SIZE_MB = 10;
const NAME_MIN = 3;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 500;
const REMARKS_MIN = 10;
const REMARKS_MAX = 1000;
const RUBRIC_LEVELS = [1, 2, 3, 4, 5];
const RUBRIC_WORDS: Record<number, string> = {
  1: 'Far below expectations',
  2: 'Below expectations',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Significantly exceeds expectations',
};

const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

interface CategoryOption {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
  sortOrder?: number;
}

interface WeightPayload {
  allocated: number;
  available: number;
  complete: boolean;
  warning: string | null;
  minWeight: number;
  maxWeight: number;
  maxKpisPerPeriod: number;
  kpiCount: number;
  remainingKpis: number;
}

interface UploadedEvidence {
  id: string;
  originalName: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: string;
}

type FieldKey =
  | 'name'
  | 'description'
  | 'categoryId'
  | 'measurementType'
  | 'unit'
  | 'direction'
  | 'frequency'
  | 'periodId'
  | 'target'
  | 'rubricLevel'
  | 'kpiWeight'
  | 'actual'
  | 'remarks'
  | 'approverId'
  | 'evidence';

type FormErrors = Partial<Record<FieldKey, string>>;

/** DOM order — the first invalid field receives focus on submit. */
const FIELD_ORDER: FieldKey[] = [
  'name',
  'description',
  'categoryId',
  'measurementType',
  'unit',
  'direction',
  'frequency',
  'periodId',
  'target',
  'rubricLevel',
  'kpiWeight',
  'actual',
  'remarks',
  'approverId',
  'evidence',
];

interface FormState {
  name: string;
  description: string;
  categoryId: string;
  measurementType: MeasurementType;
  unit: string;
  direction: Direction;
  frequency: Frequency;
  periodId: string;
  target: string;
  rubricLevel: string;
  kpiWeight: string;
  actual: string;
  remarks: string;
  approverId: string;
  templateId: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  categoryId: '',
  measurementType: 'COUNT',
  unit: DEFAULT_UNITS.COUNT,
  direction: 'HIGHER',
  frequency: 'MONTHLY',
  periodId: '',
  target: '',
  rubricLevel: '',
  kpiWeight: '',
  actual: '',
  remarks: '',
  approverId: '',
  templateId: '',
};

interface QueuedFile {
  id: string;
  file: File;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  sha256?: string;
  evidenceId?: string;
  error?: string;
}

// -------------------------------------------------------------------- helpers

const countDecimals = (value: string): number => {
  const match = /^\d+(?:\.(\d+))?$/.exec(value.trim());
  return match?.[1]?.length ?? 0;
};

const rubricLabel = (level: number, map: Record<string, number>): string => {
  const score = map[String(level)] ?? DEFAULT_QUALITATIVE_MAP[String(level)] ?? 0;
  return `Level ${level} — ${RUBRIC_WORDS[level] ?? ''} (${score}% of target)`;
};

const decimalStep = (precision: number): string => (precision === 0 ? '1' : precision === 1 ? '0.1' : '0.01');

const weightExceededCopy = (overBy: number, available: number): string =>
  `Weight exceeds 100% by ${overBy.toFixed(2)}%. Available: ${available.toFixed(0)}% (W-EXCEED).`;

const toNumberOrNull = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

// ------------------------------------------------------------------- component

export interface CreateKpiDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Existing Draft/Returned KPI to edit. `null`/omitted creates a new one. */
  kpiId?: string | null;
  /** Global period defaults supplied by the page (falls back to the global selection). */
  defaultPeriodId?: string | null;
  defaultFrequency?: Frequency | null;
  /** Called after a successful create/update/submit with the saved KPI. */
  onSaved?: (kpi: KpiDetail) => void;
}

export const CreateKpiDrawer: React.FC<CreateKpiDrawerProps> = ({
  open,
  onClose,
  kpiId,
  defaultPeriodId,
  defaultFrequency,
  onSaved,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { selection, periods } = usePeriodSelection();

  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [files, setFiles] = React.useState<QueuedFile[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [touched, setTouched] = React.useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const [serverErrors, setServerErrors] = React.useState<FormErrors>({});
  const [templateLocked, setTemplateLocked] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<'draft' | 'submit' | null>(null);
  const [persistedId, setPersistedId] = React.useState<string | null>(null);

  const nameRef = React.useRef<HTMLInputElement>(null);
  const categoryRef = React.useRef<HTMLSelectElement>(null);
  const typeRef = React.useRef<HTMLSelectElement>(null);
  const unitRef = React.useRef<HTMLInputElement>(null);
  const directionRef = React.useRef<HTMLSelectElement>(null);
  const frequencyRef = React.useRef<HTMLSelectElement>(null);
  const periodRef = React.useRef<HTMLSelectElement>(null);
  const targetRef = React.useRef<HTMLInputElement>(null);
  const rubricRef = React.useRef<HTMLSelectElement>(null);
  const weightRef = React.useRef<HTMLInputElement>(null);
  const actualRef = React.useRef<HTMLInputElement>(null);
  const remarksRef = React.useRef<HTMLTextAreaElement>(null);
  const approverRef = React.useRef<HTMLSelectElement>(null);
  const evidenceRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const refMap: Partial<Record<FieldKey, React.RefObject<HTMLElement>>> = {
    name: nameRef,
    categoryId: categoryRef,
    measurementType: typeRef,
    unit: unitRef,
    direction: directionRef,
    frequency: frequencyRef,
    periodId: periodRef,
    target: targetRef,
    rubricLevel: rubricRef,
    kpiWeight: weightRef,
    actual: actualRef,
    remarks: remarksRef,
    approverId: approverRef,
    evidence: evidenceRef,
  };

  const effectiveId = persistedId ?? kpiId ?? null;
  const isEdit = Boolean(kpiId);

  // ------------------------------------------------------------------ queries

  const { data: detail } = useQuery({
    queryKey: ['kpi', kpiId],
    queryFn: () => api.get<KpiDetail>(`/kpis/${kpiId}`),
    enabled: open && Boolean(kpiId),
  });

  const { data: categories } = useQuery({
    queryKey: ['kpi-categories'],
    queryFn: () => api.get<CategoryOption[]>('/kpis/meta/categories'),
    enabled: open,
    staleTime: 10 * 60_000,
  });

  const { data: approvers } = useQuery({
    queryKey: ['kpi-approvers'],
    queryFn: () => api.get<ApproverOptions>('/kpis/meta/approvers'),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const { data: weights } = useQuery({
    queryKey: ['kpi-weights', form.periodId, form.frequency, effectiveId],
    queryFn: () =>
      api.get<WeightPayload>('/kpis/meta/weights', {
        periodId: form.periodId,
        frequency: form.frequency,
        excludeKpiId: effectiveId ?? undefined,
      }),
    enabled: open && Boolean(form.periodId) && Boolean(form.frequency),
    staleTime: 15_000,
  });

  const { data: templates } = useQuery({
    queryKey: ['kpi-templates', 'published'],
    queryFn: async () => {
      const result = await api.get<TemplateItem[] | { items: TemplateItem[] }>('/kpi-library/templates', {
        isPublished: true,
        size: 100,
      });
      return Array.isArray(result) ? result : result.items;
    },
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const templateMap = React.useMemo(() => {
    const map = new Map<string, TemplateItem>();
    (templates ?? []).forEach((template) => map.set(template.id, template));
    return map;
  }, [templates]);

  const qualitativeMap = React.useMemo(() => {
    const descriptors = form.templateId ? templateMap.get(form.templateId)?.rubricDescriptors : null;
    const map: Record<string, number> = { ...DEFAULT_QUALITATIVE_MAP };
    if (descriptors) {
      Object.entries(descriptors).forEach(([level, score]) => {
        const numeric = typeof score === 'number' ? score : Number(score);
        if (Number.isFinite(numeric)) map[level] = numeric;
      });
    }
    return map;
  }, [form.templateId, templateMap]);

  // -------------------------------------------------------------- form seeding

  const defaults = React.useMemo(
    () => ({
      frequency: (defaultFrequency ?? selection?.frequency ?? 'MONTHLY') as Frequency,
      periodId: defaultPeriodId ?? selection?.periodId ?? '',
    }),
    [defaultFrequency, defaultPeriodId, selection],
  );

  const previousOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !previousOpen.current) {
      setServerErrors({});
      setSubmitted(false);
      setTouched({});
      setTemplateLocked(false);
      setPersistedId(null);
      setPendingAction(null);
      if (!kpiId) {
        setForm({ ...EMPTY_FORM, frequency: defaults.frequency, periodId: defaults.periodId });
        setFiles([]);
      }
    }
    previousOpen.current = open;
  }, [open, kpiId, defaults]);

  // The global period may arrive after the drawer opened.
  React.useEffect(() => {
    if (!open || kpiId) return;
    setForm((current) =>
      current.periodId ? current : { ...current, periodId: defaults.periodId, frequency: defaults.frequency },
    );
  }, [open, kpiId, defaults]);

  // Prefill from the existing KPI.
  React.useEffect(() => {
    if (!open || !detail) return;
    setForm({
      name: detail.name,
      description: detail.description ?? '',
      categoryId: detail.category.id,
      measurementType: detail.measurementType,
      unit: detail.unit,
      direction: detail.direction,
      frequency: detail.frequency,
      periodId: detail.period.id,
      target: detail.target ?? '',
      rubricLevel: detail.rubricLevel ? String(detail.rubricLevel) : '',
      kpiWeight: String(detail.kpiWeight),
      actual: detail.actual ?? '',
      remarks: detail.remarks ?? '',
      approverId: detail.approver.id ?? '',
      templateId: '',
    });
    setFiles([]);
    setTemplateLocked(false);
  }, [open, detail]);

  // Preselect the single approver when the department has exactly one head.
  React.useEffect(() => {
    if (!approvers || approvers.mode !== 'PRESELECTED' || !approvers.options[0]) return;
    const preselected = approvers.options[0].id;
    setForm((current) => (current.approverId ? current : { ...current, approverId: preselected }));
  }, [approvers]);

  // ---------------------------------------------------------------- validation

  const precision = MEASUREMENT_PRECISION[form.measurementType] ?? 2;

  const validateNumeric = React.useCallback(
    (raw: string, label: string, opts: { required: boolean }): string | undefined => {
      const value = raw.trim();
      if (!value) return opts.required ? `${label} is required` : undefined;
      if (!/^\d+(\.\d+)?$/.test(value)) return `${label} must be a number — negative values are not allowed (V-NUM-02)`;
      if (countDecimals(value) > precision) return `${label} accepts at most ${precision} decimal place(s)`;
      const numeric = Number(value);
      if (form.measurementType === 'PERCENTAGE' && numeric > 1000) return 'Percentage values above 1,000 are rejected (V-NUM-02)';
      if (form.measurementType === 'RATING' && (numeric < 1 || numeric > 5)) return 'A Rating value must be within the scale 1–5';
      return undefined;
    },
    [form.measurementType, precision],
  );

  const validate = React.useCallback(
    (intent: 'draft' | 'submit'): FormErrors => {
      const errors: FormErrors = {};
      const minWeight = weights?.minWeight ?? 5;
      const maxWeight = weights?.maxWeight ?? 50;

      const name = form.name.trim();
      if (!name) errors.name = 'KPI name is required';
      else if (name.length < NAME_MIN) errors.name = `Use at least ${NAME_MIN} characters`;
      else if (name.length > NAME_MAX) errors.name = `Use at most ${NAME_MAX} characters`;

      if (form.description.trim().length > DESCRIPTION_MAX) errors.description = `Use at most ${DESCRIPTION_MAX} characters`;
      if (!form.categoryId) errors.categoryId = 'Select a KPI category';
      if (!form.unit.trim()) errors.unit = 'Unit is required (for example units, BDT, %, days)';
      else if (form.unit.trim().length > 32) errors.unit = 'Use at most 32 characters';
      if (!form.periodId) errors.periodId = 'Select a period';

      if (form.measurementType === 'QUALITATIVE') {
        if (!form.rubricLevel) errors.rubricLevel = 'Choose a rubric level (1–5)';
      } else {
        const targetError = validateNumeric(form.target, 'Target', { required: intent === 'submit' });
        if (targetError) errors.target = targetError;
        else if (form.target.trim() && Number(form.target) === 0 && form.direction === 'HIGHER') {
          errors.target = 'Target must be greater than 0 for higher-is-better KPIs (V-TGT-01)';
        }
        const actualError = validateNumeric(form.actual, 'Actual', { required: intent === 'submit' });
        if (actualError) errors.actual = actualError;
      }

      const weightRaw = form.kpiWeight.trim();
      if (!weightRaw) errors.kpiWeight = 'KPI Weight is required';
      else if (!/^\d+$/.test(weightRaw)) errors.kpiWeight = 'KPI Weight must be a whole number';
      else {
        const numeric = Number(weightRaw);
        if (numeric < minWeight || numeric > maxWeight) errors.kpiWeight = `Use ${minWeight}–${maxWeight}% (W-MIN)`;
      }

      const remarks = form.remarks.trim();
      if (remarks.length > REMARKS_MAX) errors.remarks = `Use at most ${REMARKS_MAX} characters`;
      else if (intent === 'submit' && remarks.length < REMARKS_MIN) {
        errors.remarks = `Remarks must be ${REMARKS_MIN}–${REMARKS_MAX} characters (V-TEXT-01)`;
      }

      if (intent === 'submit' && approvers && approvers.mode === 'SELECT' && !form.approverId) {
        errors.approverId = 'Choose your Approval Person';
      }

      if (intent === 'submit') {
        const hasExistingEvidence = (detail?.evidenceCount ?? 0) > 0;
        if (!files.length && !hasExistingEvidence) {
          errors.evidence = 'Attach at least one evidence file before submitting (EVIDENCE-REQUIRED)';
        }
      }

      return errors;
    },
    [approvers, detail?.evidenceCount, files.length, form, validateNumeric, weights?.maxWeight, weights?.minWeight],
  );

  const liveErrors = React.useMemo(() => validate('submit'), [validate]);

  const weightValue = /^\d+$/.test(form.kpiWeight.trim()) ? Number(form.kpiWeight) : 0;
  const allocated = weights?.allocated ?? 0;
  const projected = allocated + weightValue;
  const overBy = projected - 100;
  const weightExceeded = weightValue > 0 && projected > 100;

  const mandatoryOk = React.useMemo(
    () => Object.keys(validate('submit')).filter((key) => key !== 'evidence').length === 0,
    [validate],
  );
  const hasEvidence = files.length > 0 || (detail?.evidenceCount ?? 0) > 0;
  const canSubmit = mandatoryOk && hasEvidence && !weightExceeded && !detail?.isLocked;

  const errorFor = (field: FieldKey): string | undefined => {
    if (serverErrors[field]) return serverErrors[field];
    if (!touched[field] && !submitted) return undefined;
    return liveErrors[field];
  };

  const focusFirst = (errors: FormErrors) => {
    for (const key of FIELD_ORDER) {
      if (!errors[key]) continue;
      const node = refMap[key]?.current;
      if (node) {
        node.focus();
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }
  };

  // ------------------------------------------------------------- form setters

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => ({ ...current, [key]: undefined }));
  };

  const blur = (field: FieldKey) => setTouched((current) => ({ ...current, [field]: true }));

  const handleMeasurementType = (next: MeasurementType) => {
    setForm((current) => ({
      ...current,
      measurementType: next,
      unit: DEFAULT_UNITS[next],
      rubricLevel: next === 'QUALITATIVE' ? current.rubricLevel || '3' : '',
      target: next === 'QUALITATIVE' ? '' : current.target,
    }));
  };

  const handleTemplate = (templateId: string) => {
    if (!templateId) {
      setField('templateId', '');
      setTemplateLocked(false);
      return;
    }
    const template = templateMap.get(templateId);
    if (!template) return;
    setForm((current) => ({
      ...current,
      templateId,
      name: template.name,
      description: template.description ?? current.description,
      categoryId: template.category.id,
      measurementType: template.measurementType,
      unit: template.unit,
      direction: template.direction,
      kpiWeight: String(template.suggestedWeight),
      rubricLevel: template.measurementType === 'QUALITATIVE' ? current.rubricLevel || '3' : '',
      target: template.measurementType === 'QUALITATIVE' ? '' : current.target,
    }));
    setTemplateLocked(true);
    toast.info('Template applied', `${template.code} · ${template.name} — type, unit and direction are locked (FR-LIB-02).`);
  };

  // -------------------------------------------------------------------- files

  const addFiles = (incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    const next: QueuedFile[] = [];
    const problems: string[] = [];

    list.forEach((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        problems.push(`${file.name}: only ${ALLOWED_EXTENSIONS.join(', ').toUpperCase()} are accepted`);
        return;
      }
      if (file.size > MAX_EVIDENCE_SIZE_MB * 1024 * 1024) {
        problems.push(`${file.name}: larger than ${MAX_EVIDENCE_SIZE_MB} MB`);
        return;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        progress: 0,
        status: 'queued',
      });
    });

    setFiles((current) => {
      const combined = [...current, ...next];
      if (combined.length > MAX_EVIDENCE_FILES) {
        problems.push(`A KPI may hold at most ${MAX_EVIDENCE_FILES} evidence files`);
        return combined.slice(0, MAX_EVIDENCE_FILES);
      }
      return combined;
    });

    if (problems.length) toast.error('Some files were not added', problems.join(' · '));
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
  };

  const removeFile = (id: string) =>
    setFiles((current) => current.filter((entry) => entry.id !== id));

  // ------------------------------------------------------------------ mutation

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      categoryId: form.categoryId,
      measurementType: form.measurementType,
      unit: form.unit.trim(),
      direction: form.direction,
      frequency: form.frequency,
      periodId: form.periodId,
      kpiWeight: Number(form.kpiWeight),
    };
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.remarks.trim()) payload.remarks = form.remarks.trim();
    if (form.approverId) payload.approverId = form.approverId;
    if (form.measurementType === 'QUALITATIVE') {
      if (form.rubricLevel) payload.rubricLevel = Number(form.rubricLevel);
    } else {
      const target = toNumberOrNull(form.target);
      const actual = toNumberOrNull(form.actual);
      if (target !== null) payload.target = target;
      if (actual !== null) payload.actual = actual;
    }
    if (!effectiveId && form.templateId) payload.templateId = form.templateId;
    return payload;
  };

  const mutation = useMutation({
    mutationFn: async (intent: 'draft' | 'submit') => {
      setPendingAction(intent);
      setServerErrors({});

      const saved = effectiveId
        ? await api.patch<KpiDetail>(`/kpis/${effectiveId}`, buildPayload())
        : await api.post<KpiDetail>('/kpis', buildPayload());
      setPersistedId(saved.id);

      // Evidence needs a KPI id: upload every queued file against the saved Draft.
      for (const entry of files) {
        if (entry.status === 'done') continue;
        const formData = new FormData();
        formData.append('files', entry.file);
        setFiles((current) =>
          current.map((item) => (item.id === entry.id ? { ...item, status: 'uploading', progress: 0 } : item)),
        );
        try {
          const result = await api.upload<{ files: UploadedEvidence[] }>(
            `/kpis/${saved.id}/evidence`,
            formData,
            (percent) =>
              setFiles((current) =>
                current.map((item) => (item.id === entry.id ? { ...item, progress: percent } : item)),
              ),
          );
          const uploaded = result.files?.[0];
          setFiles((current) =>
            current.map((item) =>
              item.id === entry.id
                ? { ...item, status: 'done', progress: 100, sha256: uploaded?.sha256, evidenceId: uploaded?.id }
                : item,
            ),
          );
        } catch (uploadError) {
          const message = uploadError instanceof ApiError ? uploadError.message : 'The upload failed.';
          setFiles((current) =>
            current.map((item) => (item.id === entry.id ? { ...item, status: 'error', error: message } : item)),
          );
          throw uploadError;
        }
      }

      // Always read the fresh rowVersion before submitting (optimistic locking).
      const fresh = await api.get<KpiDetail>(`/kpis/${saved.id}`);
      if (intent === 'submit') {
        await api.post<KpiDetail>(`/kpis/${saved.id}/submit`, {}, { ifMatch: fresh.rowVersion });
      }
      return api.get<KpiDetail>(`/kpis/${saved.id}`).catch(() => fresh);
    },
    onSuccess: (saved, intent) => {
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
      queryClient.invalidateQueries({ queryKey: ['kpi', saved.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'employee'] });
      queryClient.invalidateQueries({ queryKey: ['kpi-weights'] });
      if (intent === 'submit') {
        toast.success('KPI submitted', `${saved.name} is now with ${saved.approver.fullName} for review.`);
      } else {
        toast.success('Draft saved', `${saved.code} · ${saved.name} saved as a Draft.`);
      }
      onSaved?.(saved);
      setPendingAction(null);
      onClose();
    },
    onError: (error) => {
      setPendingAction(null);
      if (error instanceof ApiError) {
        const fieldErrors: FormErrors = {};
        error.fieldErrors.forEach((fieldError) => {
          if (fieldError.field) fieldErrors[fieldError.field as FieldKey] = fieldError.message;
        });
        setServerErrors(fieldErrors);
        setSubmitted(true);
        if (error.isStale) {
          queryClient.invalidateQueries({ queryKey: ['kpi', effectiveId ?? undefined] });
          toast.error('Out of date', 'This KPI changed while you were editing. Reload and try again (STALE-VERSION).');
          return;
        }
        if (error.code === 'W-EXCEED') {
          toast.error('Weight exceeds 100%', error.message);
          return;
        }
        toast.error('Could not save the KPI', error.message);
        return;
      }
      toast.error('Could not save the KPI', 'An unexpected error occurred. Please try again.');
    },
  });

  const handleAction = (intent: 'draft' | 'submit') => {
    setSubmitted(true);
    const errors = validate(intent);
    if (Object.keys(errors).length) {
      setTouched((current) => {
        const next = { ...current };
        (Object.keys(errors) as FieldKey[]).forEach((key) => {
          next[key] = true;
        });
        return next;
      });
      focusFirst(errors);
      toast.error('Check the form', 'Some fields still need your attention.');
      return;
    }
    if (weightExceeded) {
      toast.error('Weight exceeds 100%', weightExceededCopy(overBy, Math.max(0, 100 - allocated)));
      return;
    }
    mutation.mutate(intent);
  };

  // ------------------------------------------------------------------- render

  const dirty = React.useMemo(() => {
    if (files.length) return true;
    if (!detail) return Boolean(form.name || form.remarks || form.target || form.actual);
    return (
      form.name !== detail.name ||
      form.description !== (detail.description ?? '') ||
      form.target !== (detail.target ?? '') ||
      form.actual !== (detail.actual ?? '') ||
      form.remarks !== (detail.remarks ?? '') ||
      form.kpiWeight !== String(detail.kpiWeight) ||
      form.categoryId !== detail.category.id
    );
  }, [detail, files.length, form]);

  const preview = React.useMemo(
    () =>
      calculateKpi({
        target: form.measurementType === 'QUALITATIVE' ? null : toNumberOrNull(form.target),
        actual: form.measurementType === 'QUALITATIVE' ? null : toNumberOrNull(form.actual),
        rubricLevel:
          form.measurementType === 'QUALITATIVE' && form.rubricLevel ? Number(form.rubricLevel) : null,
        kpiWeight: weightValue,
        direction: form.direction,
        measurementType: form.measurementType,
        config: { qualitativeMap },
      }),
    [form.actual, form.direction, form.measurementType, form.rubricLevel, form.target, qualitativeMap, weightValue],
  );

  const periodOptions = React.useMemo(
    () => periods.filter((period) => period.frequency === form.frequency),
    [periods, form.frequency],
  );

  const approverHint =
    approvers?.mode === 'SELECT'
      ? 'Choose the Department Head who will review and approve this KPI (BR-R03).'
      : approvers?.mode === 'PRESELECTED'
        ? 'Your department has a single active approver — they are preselected.'
        : undefined;

  const busy = mutation.isPending;
  const locked = Boolean(detail?.isLocked);

  return (
    <Drawer
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={isEdit ? 'Edit KPI' : 'Create KPI'}
      subtitle={
        isEdit
          ? `${detail?.code ?? ''} · ${detail?.status ? `status ${detail.status}` : 'loading…'}`
          : 'A KPI stays editable while it is a Draft or has been Returned.'
      }
      confirmBeforeClose={dirty && !busy}
      confirmMessage="You have unsaved changes. Close without saving?"
      footer={
        <>
          <Button variant="secondary" onClick={() => handleAction('draft')} loading={pendingAction === 'draft'} disabled={busy || locked}>
            Save Draft
          </Button>
          <Button onClick={() => handleAction('submit')} loading={pendingAction === 'submit'} disabled={busy || !canSubmit || locked}>
            Submit KPI
          </Button>
        </>
      }
    >
      {locked ? (
        <Alert tone="warning" title="This period is closed" className="mb-4">
          A Super Admin must reopen the period before you can change this KPI.
        </Alert>
      ) : null}

      {detail?.status === 'RETURNED' && detail.returnComment ? (
        <Alert tone="warning" title="Returned by your approver" className="mb-4">
          “{detail.returnComment}” — fix the inputs below and resubmit.
        </Alert>
      ) : null}

      {/* ============================================ 1. Definition */}
      <section className="mb-6">
        <SectionTitle hint="FR-KPI-04 · the definition drives the measurement and the calculation.">1. Definition</SectionTitle>

        <div className="space-y-4">
          {!isEdit ? (
            <Field
              label="Start from a template"
              htmlFor="kpi-template"
              hint="Published templates prefill the definition and lock the measurement type, unit and direction (FR-LIB-02)."
            >
              <Select id="kpi-template" value={form.templateId} onChange={(event) => handleTemplate(event.target.value)}>
                <option value="">Start from scratch</option>
                {(templates ?? []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.code} · {template.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="KPI name" required error={errorFor('name')} htmlFor="kpi-name" hint={`${form.name.trim().length}/${NAME_MAX} characters`}>
            <Input
              id="kpi-name"
              ref={nameRef}
              value={form.name}
              maxLength={NAME_MAX}
              invalid={Boolean(errorFor('name'))}
              onBlur={() => blur('name')}
              onChange={(event) => setField('name', event.target.value)}
              placeholder="e.g. Retail outlet collection target"
            />
          </Field>

          <Field
            label="Description"
            error={errorFor('description')}
            hint={`Optional, up to ${DESCRIPTION_MAX} characters. ${form.description.length}/${DESCRIPTION_MAX}`}
          >
            <Textarea
              value={form.description}
              rows={3}
              maxLength={DESCRIPTION_MAX}
              invalid={Boolean(errorFor('description'))}
              onBlur={() => blur('description')}
              onChange={(event) => setField('description', event.target.value)}
              placeholder="What is being measured, and how?"
            />
          </Field>

          <Field
            label="KPI Category"
            required
            error={errorFor('categoryId')}
            htmlFor="kpi-category"
          >
            <Select
              id="kpi-category"
              ref={categoryRef}
              value={form.categoryId}
              invalid={Boolean(errorFor('categoryId'))}
              onBlur={() => blur('categoryId')}
              onChange={(event) => setField('categoryId', event.target.value)}
            >
              <option value="">Select a category…</option>
              {(categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Measurement Type"
              required
              error={errorFor('measurementType')}
              hint={MEASUREMENT_TYPE_HELPERS[form.measurementType]}
              htmlFor="kpi-measurement-type"
            >
              <Select
                id="kpi-measurement-type"
                ref={typeRef}
                value={form.measurementType}
                disabled={templateLocked}
                onChange={(event) => handleMeasurementType(event.target.value as MeasurementType)}
              >
                {(Object.keys(MEASUREMENT_TYPE_LABELS) as MeasurementType[]).map((type) => (
                  <option key={type} value={type}>
                    {MEASUREMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Unit"
              required
              error={errorFor('unit')}
              hint={templateLocked ? 'Locked by the selected template.' : 'Shown next to every value, for example units or BDT.'}
              htmlFor="kpi-unit"
            >
              <Input
                id="kpi-unit"
                ref={unitRef}
                value={form.unit}
                maxLength={32}
                disabled={templateLocked}
                invalid={Boolean(errorFor('unit'))}
                onBlur={() => blur('unit')}
                onChange={(event) => setField('unit', event.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Direction"
            required
            error={errorFor('direction')}
            hint={DIRECTIONS.find((d) => d.code === form.direction)?.helper}
            htmlFor="kpi-direction"
          >
            <Select
              id="kpi-direction"
              ref={directionRef}
              value={form.direction}
              disabled={templateLocked}
              onChange={(event) => setField('direction', event.target.value as Direction)}
            >
              {DIRECTIONS.map((direction) => (
                <option key={direction.code} value={direction.code}>
                  {direction.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Frequency" required htmlFor="kpi-frequency">
              <Select
                id="kpi-frequency"
                ref={frequencyRef}
                value={form.frequency}
                onChange={(event) => {
                  const next = event.target.value as Frequency;
                  const match = periods.find((period) => period.frequency === next);
                  setForm((current) => ({
                    ...current,
                    frequency: next,
                    periodId: match ? match.id : '',
                  }));
                }}
              >
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
              </Select>
            </Field>

            <Field label="Period" required error={errorFor('periodId')} htmlFor="kpi-period">
              <Select
                id="kpi-period"
                ref={periodRef}
                value={form.periodId}
                invalid={Boolean(errorFor('periodId'))}
                onBlur={() => blur('periodId')}
                onChange={(event) => setField('periodId', event.target.value)}
              >
                <option value="">Select a period…</option>
                {periodOptions.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}
                    {period.status === 'CLOSED' ? ' (closed)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </section>

      {/* ============================================ 2. Target & Weight */}
      <section className="mb-6">
        <SectionTitle hint="FR-KPI-05 · the target is compared with the actual using the formula shown below.">
          2. Target &amp; Weight
        </SectionTitle>

        <div className="space-y-4">
          {form.measurementType === 'QUALITATIVE' ? (
            <>
              <Field
                label="Rubric Level"
                required
                error={errorFor('rubricLevel')}
                hint="Qualitative KPIs are scored from the rubric level (Level 3 = 100% of target)."
                htmlFor="kpi-rubric-target"
              >
                <Select
                  id="kpi-rubric-target"
                  ref={rubricRef}
                  value={form.rubricLevel}
                  invalid={Boolean(errorFor('rubricLevel'))}
                  onBlur={() => blur('rubricLevel')}
                  onChange={(event) => setField('rubricLevel', event.target.value)}
                >
                  <option value="">Select a level…</option>
                  {RUBRIC_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {rubricLabel(level, qualitativeMap)}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="rounded-control bg-navy-50 px-3 py-2 text-caption text-navy-700">
                Rubric map in use: {RUBRIC_LEVELS.map((level) => `${level} → ${qualitativeMap[String(level)] ?? '—'}%`).join(' · ')}
              </p>
            </>
          ) : (
            <Field
              label="Target"
              required
              error={errorFor('target')}
              htmlFor="kpi-target"
              hint={
                form.measurementType === 'RATING'
                  ? 'Rating targets use the 1–5 scale.'
                  : `Precision: ${precision} decimal place(s). Target must be greater than 0 when higher is better (V-TGT-01).`
              }
            >
              <Input
                id="kpi-target"
                ref={targetRef}
                type="number"
                inputMode="decimal"
                min={0}
                step={decimalStep(precision)}
                value={form.target}
                invalid={Boolean(errorFor('target'))}
                onBlur={() => blur('target')}
                onChange={(event) => setField('target', event.target.value)}
              />
            </Field>
          )}

          <Field
            label="KPI Weight"
            required
            error={errorFor('kpiWeight')}
            htmlFor="kpi-weight"
            hint={`Integer 5–50%. The period total must stay ≤ 100%.${
              weights ? ` Remaining KPIs allowed this period: ${weights.remainingKpis} of ${weights.maxKpisPerPeriod}.` : ''
            }`}
          >
            <Input
              id="kpi-weight"
              ref={weightRef}
              type="number"
              inputMode="numeric"
              min={weights?.minWeight ?? 5}
              max={weights?.maxWeight ?? 50}
              step={1}
              value={form.kpiWeight}
              invalid={Boolean(errorFor('kpiWeight'))}
              onBlur={() => blur('kpiWeight')}
              onChange={(event) => setField('kpiWeight', event.target.value)}
            />
          </Field>

          <div className="rounded-card border border-edge bg-canvas p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-caption font-semibold text-ink">
                Weight allocated {allocated} / 100%
              </p>
              <span className="text-caption text-ink-secondary">
                Available {Math.max(0, 100 - allocated)}%{weightValue > 0 ? ` · this KPI would leave ${Math.max(0, 100 - projected)}%` : ''}
              </span>
            </div>
            <ProgressBar
              value={Math.min(100, allocated)}
              max={100}
              tone={allocated >= 100 ? 'success' : weightExceeded ? 'danger' : 'warning'}
              height={8}
            />
            {weights?.warning ? (
              <p className="mt-1 text-caption text-warning">{weights.warning} — the period total must reach 100% before submission (W-3).</p>
            ) : null}
            {weightExceeded ? (
              <Alert tone="danger" title="Weight exceeds 100%" className="mt-2">
                {weightExceededCopy(overBy, Math.max(0, 100 - allocated))} Reduce this KPI&apos;s weight or delete
                another KPI from the period.
              </Alert>
            ) : null}
            {weights && weights.kpiCount >= weights.maxKpisPerPeriod && !effectiveId ? (
              <Alert tone="warning" className="mt-2">
                You already have {weights.kpiCount} active KPIs in this period; the maximum is {weights.maxKpisPerPeriod} (MAX-KPI).
              </Alert>
            ) : null}
          </div>

          <div className="rounded-card border border-edge bg-navy-50 p-3">
            <p className="text-caption font-semibold uppercase tracking-wide text-navy-700">Formula preview</p>
            <p className="anwar-mono mt-1 text-navy-900">{preview.formulaText}</p>
          </div>
        </div>
      </section>

      {/* ============================================ 3. Actual & Evidence */}
      <section className="mb-6">
        <SectionTitle hint="FR-KPI-06 / FR-EVD-01 · at least one evidence file is required before submission (AC-04).">
          3. Actual &amp; Evidence
        </SectionTitle>

        <div className="space-y-4">
          {form.measurementType === 'QUALITATIVE' ? (
            <Field
              label="Actual (Rubric Level)"
              required
              error={errorFor('rubricLevel')}
              htmlFor="kpi-rubric-actual"
              hint="For a Qualitative KPI the rubric level is the actual value — it is the same field as above."
            >
              <Select
                id="kpi-rubric-actual"
                value={form.rubricLevel}
                invalid={Boolean(errorFor('rubricLevel'))}
                onChange={(event) => setField('rubricLevel', event.target.value)}
              >
                <option value="">Select a level…</option>
                {RUBRIC_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {rubricLabel(level, qualitativeMap)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field
              label="Actual"
              required
              error={errorFor('actual')}
              htmlFor="kpi-actual"
              hint={`The measured result for this period, with at most ${precision} decimal place(s).`}
            >
              <Input
                id="kpi-actual"
                ref={actualRef}
                type="number"
                inputMode="decimal"
                min={0}
                step={decimalStep(precision)}
                value={form.actual}
                invalid={Boolean(errorFor('actual'))}
                onBlur={() => blur('actual')}
                onChange={(event) => setField('actual', event.target.value)}
              />
            </Field>
          )}

          <Field
            label="Remarks"
            error={errorFor('remarks')}
            htmlFor="kpi-remarks"
            hint={`10–1,000 characters are required before submission. ${form.remarks.trim().length}/${REMARKS_MAX}`}
          >
            <Textarea
              id="kpi-remarks"
              ref={remarksRef}
              value={form.remarks}
              rows={3}
              maxLength={REMARKS_MAX}
              invalid={Boolean(errorFor('remarks'))}
              onBlur={() => blur('remarks')}
              onChange={(event) => setField('remarks', event.target.value)}
              placeholder="Explain how the actual was achieved and which evidence proves it."
            />
          </Field>

          <div
            ref={evidenceRef}
            tabIndex={-1}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              'rounded-card border-2 border-dashed p-4 text-center transition-colors',
              dragging ? 'border-navy-600 bg-navy-50' : 'border-edge bg-canvas',
              errorFor('evidence') && 'border-danger/60',
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(event) => {
                if (event.target.files?.length) addFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <p className="text-body font-semibold text-navy-900">Drag &amp; drop evidence here</p>
            <p className="mt-1 text-caption text-ink-secondary">
              1–{MAX_EVIDENCE_FILES} files · PDF, JPG, PNG, XLSX, XLS, CSV or DOCX · up to {MAX_EVIDENCE_SIZE_MB} MB each
            </p>
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                Choose files
              </Button>
            </div>
            {errorFor('evidence') ? (
              <p className="anwar-error mt-2 justify-center" role="alert">
                {errorFor('evidence')}
              </p>
            ) : null}
            {!isEdit ? (
              <p className="mt-2 text-caption text-ink-muted">
                Uploads start after the Draft is saved — every file needs a KPI id (FR-EVD-01).
              </p>
            ) : null}
          </div>

          {files.length ? (
            <ul className="space-y-2">
              {files.map((entry) => (
                <li key={entry.id} className="rounded-control border border-edge bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-body font-semibold text-ink" title={entry.file.name}>
                        {entry.file.name}
                      </p>
                      <p className="text-caption text-ink-secondary">
                        {formatBytes(entry.file.size)}
                        {entry.status === 'done' ? ' · uploaded' : entry.status === 'error' ? ' · upload failed' : ' · queued'}
                      </p>
                    </div>
                    <IconButton
                      label={`Remove ${entry.file.name} from the upload queue`}
                      onClick={() => removeFile(entry.id)}
                      disabled={busy}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </IconButton>
                  </div>
                  <ProgressBar
                    className="mt-2"
                    value={entry.progress}
                    max={100}
                    height={6}
                    tone={entry.status === 'error' ? 'danger' : entry.status === 'done' ? 'success' : 'navy'}
                  />
                  {entry.sha256 ? (
                    <p className="mt-1 flex items-center gap-1 text-caption text-ink-secondary">
                      <span className="text-ink-muted">SHA-256</span>
                      <Tooltip content={entry.sha256}>
                        <span className="anwar-mono">{shortHash(entry.sha256, 16)}</span>
                      </Tooltip>
                    </p>
                  ) : null}
                  {entry.error ? <p className="anwar-error mt-1">{entry.error}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {isEdit && detail?.evidenceCount ? (
            <p className="text-caption text-ink-secondary">
              {detail.evidenceCount} evidence file{detail.evidenceCount === 1 ? '' : 's'} already attached to this KPI.
            </p>
          ) : null}
        </div>
      </section>

      {/* ============================================ 4. Approval */}
      <section className="mb-6">
        <SectionTitle hint="BR-R03 · your Approval Person must be a Department Head of your own department.">
          4. Approval
        </SectionTitle>

        {approvers?.mode === 'SUPER_ADMIN' ? (
          <Alert tone="info" title="Routed to the Super Admin">
            {approvers.message ?? 'Your KPIs are routed to the Super Admin queue (Department Head KPI Requests).'}
          </Alert>
        ) : (
          <Field
            label="Approval Person"
            required={approvers?.mode === 'SELECT'}
            error={errorFor('approverId')}
            hint={approverHint}
            htmlFor="kpi-approver"
          >
            <Select
              id="kpi-approver"
              ref={approverRef}
              value={form.approverId}
              disabled={approvers?.mode === 'PRESELECTED'}
              invalid={Boolean(errorFor('approverId'))}
              onBlur={() => blur('approverId')}
              onChange={(event) => setField('approverId', event.target.value)}
            >
              <option value="">Select an approver…</option>
              {(approvers?.options ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.fullName}
                  {option.designationTitle ? ` — ${option.designationTitle}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {form.approverId && approvers?.options.length ? (
          <p className="mt-2 text-caption text-ink-secondary">
            Reviewer:{' '}
            <span className="font-semibold text-ink">
              {approvers.options.find((option) => option.id === form.approverId)?.fullName ?? detail?.approver.fullName}
            </span>{' '}
            · {approvers.options.find((option) => option.id === form.approverId)?.designationTitle ?? 'Department Head'}
          </p>
        ) : approvers?.mode === 'SUPER_ADMIN' ? (
          <p className="mt-2 text-caption text-ink-secondary">Reviewer: Super Admin (Upper Management)</p>
        ) : null}

        {approvers?.message && approvers.mode !== 'SUPER_ADMIN' ? (
          <Alert tone="warning" className="mt-3">
            {approvers.message}
          </Alert>
        ) : null}
      </section>

      {/* ============================================ live result panel */}
      <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-edge bg-canvas/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="text-caption font-semibold uppercase tracking-wide text-ink-secondary">Live result</p>
          <p className="text-caption text-ink-secondary">
            Achievement <span className="tnum font-semibold text-ink">{formatScore(preview.achievement)}%</span>
          </p>
          <p className="text-caption text-ink-secondary">
            Score <span className="tnum font-semibold text-ink">{formatScore(preview.calculatedScore)}</span>
          </p>
          <p className="text-caption text-ink-secondary">
            Weighted Score <span className="tnum font-semibold text-ink">{formatScore(preview.weightedScore)}</span>
          </p>
          {preview.capped ? <Badge tone="warning">Capped at {formatScore(preview.finalScore)}</Badge> : null}
        </div>
        <p className="anwar-mono mt-1 text-caption text-ink-secondary">{preview.formulaText}</p>
        <p className="mt-1 text-[11px] text-ink-muted">
          Computed with the same engine as the server (AC-05). The server recalculates on save.
        </p>
      </div>
    </Drawer>
  );
};

export default CreateKpiDrawer;
