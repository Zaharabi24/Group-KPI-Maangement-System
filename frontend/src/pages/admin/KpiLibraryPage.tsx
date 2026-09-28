/**
 * ============================================================================
 *  M04 · KPI library — FR-LIB-01..05, UC-08
 * ============================================================================
 *  · Templates        — list/filter, create, edit (a new version), publish.
 *  · Assign wizard    — template + period → employees with target & weight;
 *                       every rejected row is reported as a conflict (AC-17).
 *  · Categories       — the four BRD KPI categories.
 *
 *  FR-LIB-05: editing a template creates a NEW version; existing KPIs keep the
 *  template version they were created from.
 * ============================================================================
 */
import React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import type {
  BusinessUnitItem,
  DepartmentItem,
  Direction,
  KpiPeriodSummary,
  MeasurementType,
  Paginated,
  TemplateItem,
  UserListItem,
} from '@/lib/types';
import { DEFAULT_UNITS, DIRECTIONS, MEASUREMENT_TYPE_HELPERS, MEASUREMENT_TYPE_LABELS, titleCase } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Pagination,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  cn,
} from '@/components/ui';
import { Alert, PageHeader } from '@/components/ui/badges';
import { useDebounced } from '@/components/layout/GlobalSearch';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

// ------------------------------------------------------------------- helpers

const MEASUREMENT_TYPES: MeasurementType[] = ['COUNT', 'MONETARY', 'PERCENTAGE', 'TIME', 'RATING', 'QUALITATIVE'];
const RUBRIC_LEVELS = [1, 2, 3, 4, 5] as const;
const RUBRIC_WORDS: Record<number, string> = {
  1: 'Far below expectations',
  2: 'Below expectations',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Significantly exceeds expectations',
};

const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'The request could not be completed.';

interface CategoryItem {
  id: string;
  code: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}

interface AssignmentConflict {
  employeeId: string;
  employeeName: string;
  reason: string;
  code: string;
  availableWeight?: number;
}

interface AssignmentResult {
  created: number;
  assignmentId: string;
  conflicts: AssignmentConflict[];
  assignments: Array<{ id: string; code: string; employeeId: string; name: string; weight: number }>;
}

interface WizardRowState {
  selected: boolean;
  target: string;
  weight: string;
}

// ---------------------------------------------------------------- template drawer

interface TemplateForm {
  name: string;
  description: string;
  categoryId: string;
  measurementType: MeasurementType;
  unit: string;
  direction: Direction;
  suggestedWeight: string;
  rubric: Record<string, string>;
  scope: 'GROUP' | 'DEPARTMENT';
}

type TemplateErrors = Partial<Record<'name' | 'categoryId' | 'unit' | 'suggestedWeight', string>>;

const TemplateDrawer: React.FC<{
  open: boolean;
  template: TemplateItem | null;
  categories: CategoryItem[];
  canEdit: boolean;
  onClose: () => void;
}> = ({ open, template, categories, canEdit, onClose }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = Boolean(template);
  const [form, setForm] = React.useState<TemplateForm>({
    name: '',
    description: '',
    categoryId: '',
    measurementType: 'COUNT',
    unit: DEFAULT_UNITS.COUNT,
    direction: 'HIGHER',
    suggestedWeight: '10',
    rubric: { '1': '', '2': '', '3': '', '4': '', '5': '' },
    scope: 'GROUP',
  });
  const [errors, setErrors] = React.useState<TemplateErrors>({});

  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    if (template) {
      setForm({
        name: template.name,
        description: template.description ?? '',
        categoryId: template.category.id,
        measurementType: template.measurementType,
        unit: template.unit,
        direction: template.direction,
        suggestedWeight: String(template.suggestedWeight),
        rubric: RUBRIC_LEVELS.reduce<Record<string, string>>((map, level) => {
          map[String(level)] = template.rubricDescriptors?.[String(level)] ?? '';
          return map;
        }, {}),
        scope: template.scope,
      });
    } else {
      setForm({
        name: '',
        description: '',
        categoryId: categories[0]?.id ?? '',
        measurementType: 'COUNT',
        unit: DEFAULT_UNITS.COUNT,
        direction: 'HIGHER',
        suggestedWeight: '10',
        rubric: { '1': '', '2': '', '3': '', '4': '', '5': '' },
        scope: 'GROUP',
      });
    }
  }, [open, template, categories]);

  const mutation = useMutation({
    mutationFn: (payload: TemplateForm) => {
      const body = {
        name: payload.name.trim(),
        description: payload.description.trim(),
        categoryId: payload.categoryId,
        measurementType: payload.measurementType,
        unit: payload.unit.trim(),
        direction: payload.direction,
        suggestedWeight: Number(payload.suggestedWeight),
        rubricDescriptors:
          payload.measurementType === 'QUALITATIVE'
            ? RUBRIC_LEVELS.reduce<Record<string, string>>((map, level) => {
                const descriptor = (payload.rubric[String(level)] ?? '').trim();
                if (descriptor) map[String(level)] = descriptor;
                return map;
              }, {})
            : undefined,
      };
      return template
        ? api.patch<TemplateItem>(`/kpi-library/templates/${template.id}`, body)
        : api.post<TemplateItem>('/kpi-library/templates', body);
    },
    onSuccess: () => {
      toast.success(
        isEdit ? 'Template version created' : 'Template created',
        isEdit
          ? 'Existing KPIs keep the template version they were created from (FR-LIB-05).'
          : 'The template is now available in the library.',
      );
      queryClient.invalidateQueries({ queryKey: ['kpi-library'] });
      onClose();
    },
    onError: (error) => toast.error('Could not save the template', messageOf(error)),
  });

  const validate = (): TemplateErrors => {
    const next: TemplateErrors = {};
    if (form.name.trim().length < 3) next.name = 'Name must be at least 3 characters.';
    if (!form.categoryId) next.categoryId = 'Select a category.';
    if (!form.unit.trim()) next.unit = 'A unit is required.';
    const weight = Number(form.suggestedWeight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
      next.suggestedWeight = 'Suggested weight must be a whole number between 1 and 100.';
    }
    return next;
  };

  const submit = () => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) return;
    mutation.mutate(form);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={isEdit ? 'Edit template' : 'New KPI template'}
      subtitle={
        isEdit
          ? `${template?.code} · current version ${template?.version}`
          : 'Super Admin / HR Admin create group templates; Department Heads create department templates.'
      }
      confirmBeforeClose
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} disabled={!canEdit} onClick={submit}>
            {isEdit ? 'Save as new version' : 'Create template'}
          </Button>
        </>
      }
    >
      {!canEdit ? (
        <Alert tone="info" className="mb-4">
          Your role can browse the library but cannot create or edit templates.
        </Alert>
      ) : null}

      {isEdit ? (
        <Alert tone="warning" className="mb-4" title="Editing creates a new template version">
          Existing KPIs keep the version they were created from, so historical scoring never changes (FR-LIB-05). Assign
          the updated version to employees to use the new definition.
        </Alert>
      ) : null}

      <div className="space-y-4">
        <Field label="Name" htmlFor="template-name" required error={errors.name}>
          <Input
            id="template-name"
            value={form.name}
            maxLength={160}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            invalid={Boolean(errors.name)}
          />
        </Field>

        <Field label="Description" htmlFor="template-description" hint="Optional — up to 1000 characters.">
          <Textarea
            id="template-description"
            value={form.description}
            rows={3}
            maxLength={1000}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="template-category" required error={errors.categoryId}>
            <Select
              id="template-category"
              value={form.categoryId}
              onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
              invalid={Boolean(errors.categoryId)}
            >
              <option value="">Select a category…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {titleCase(category.code)} · {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Measurement type" htmlFor="template-measurement" required hint={MEASUREMENT_TYPE_HELPERS[form.measurementType]}>
            <Select
              id="template-measurement"
              value={form.measurementType}
              onChange={(event) => {
                const measurementType = event.target.value as MeasurementType;
                setForm((current) => ({
                  ...current,
                  measurementType,
                  unit: DEFAULT_UNITS[measurementType],
                }));
              }}
            >
              {MEASUREMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MEASUREMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Unit" htmlFor="template-unit" required error={errors.unit}>
            <Input
              id="template-unit"
              value={form.unit}
              maxLength={32}
              onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))}
              invalid={Boolean(errors.unit)}
            />
          </Field>

          <Field label="Direction" htmlFor="template-direction" required hint={DIRECTIONS.find((d) => d.code === form.direction)?.helper}>
            <Select
              id="template-direction"
              value={form.direction}
              onChange={(event) => setForm((current) => ({ ...current, direction: event.target.value as Direction }))}
            >
              {DIRECTIONS.map((direction) => (
                <option key={direction.code} value={direction.code}>
                  {direction.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Suggested weight (%)" htmlFor="template-weight" required error={errors.suggestedWeight}>
            <Input
              id="template-weight"
              type="number"
              min={1}
              max={100}
              value={form.suggestedWeight}
              onChange={(event) => setForm((current) => ({ ...current, suggestedWeight: event.target.value }))}
              invalid={Boolean(errors.suggestedWeight)}
            />
          </Field>

          <Field
            label="Scope"
            htmlFor="template-scope"
            hint={
              form.scope === 'GROUP'
                ? 'Group-wide: visible to every department.'
                : 'Department scope: visible to the owning department only.'
            }
          >
            <Input
              id="template-scope"
              value={form.scope === 'GROUP' ? 'Group (set by your role)' : 'Department (set by your role)'}
              readOnly
              disabled
            />
          </Field>
        </div>

        <div>
          <p className="anwar-label">Rubric descriptors (Level 1–5)</p>
          <p className="anwar-helper mb-2">
            Required for qualitative templates — each level needs a written descriptor (§4.2).
          </p>
          <div className="space-y-2">
            {RUBRIC_LEVELS.map((level) => (
              <div key={level} className="flex items-start gap-2">
                <span className="anwar-badge mt-2 w-20 shrink-0 justify-center bg-navy-50 text-navy-700">
                  L{level} · {RUBRIC_WORDS[level].split(' ')[0]}
                </span>
                <Input
                  aria-label={`Rubric level ${level} descriptor`}
                  value={form.rubric[String(level)] ?? ''}
                  placeholder={RUBRIC_WORDS[level]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rubric: { ...current.rubric, [String(level)]: event.target.value },
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
};

// ------------------------------------------------------------- assign wizard

const AssignWizardDrawer: React.FC<{
  open: boolean;
  templates: TemplateItem[];
  onClose: () => void;
}> = ({ open, templates, onClose }) => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = React.useState<1 | 2>(1);
  const [templateId, setTemplateId] = React.useState('');
  const [periodId, setPeriodId] = React.useState('');
  const [businessUnitId, setBusinessUnitId] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');
  const [rows, setRows] = React.useState<Record<string, WizardRowState>>({});
  const [result, setResult] = React.useState<AssignmentResult | null>(null);

  const periodsQuery = useQuery({
    queryKey: ['periods', 'selectable'],
    queryFn: () => api.get<KpiPeriodSummary[]>('/periods/selectable'),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const businessUnitsQuery = useQuery({
    queryKey: ['organisation', 'business-units', false],
    queryFn: () => api.get<BusinessUnitItem[]>('/organisation/business-units'),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const departmentsQuery = useQuery({
    queryKey: ['organisation', 'departments', businessUnitId || 'all'],
    queryFn: () =>
      api.get<DepartmentItem[]>('/organisation/departments', businessUnitId ? { businessUnitId } : undefined),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const employeesQuery = useQuery({
    queryKey: ['admin', 'users', 'assign-picker', departmentId],
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/admin/users', { departmentId, status: 'ACTIVE', size: 100 }),
    enabled: open && Boolean(departmentId),
  });

  React.useEffect(() => {
    if (!open) return;
    setStep(1);
    setTemplateId('');
    setPeriodId('');
    setBusinessUnitId('');
    setDepartmentId('');
    setRows({});
    setResult(null);
  }, [open]);

  const template = templates.find((entry) => entry.id === templateId) ?? null;

  const toggleEmployee = (employeeId: string) => {
    setRows((current) => {
      const existing = current[employeeId];
      if (existing) return { ...current, [employeeId]: { ...existing, selected: !existing.selected } };
      return {
        ...current,
        [employeeId]: {
          selected: true,
          target: '',
          weight: String(template?.suggestedWeight ?? 10),
        },
      };
    });
  };

  const selectedRows = Object.entries(rows).filter(([, row]) => row.selected);
  const selectedCount = selectedRows.length;
  const rowsInvalid = selectedRows.some(([, row]) => {
    const weight = Number(row.weight);
    return !Number.isInteger(weight) || weight < 1 || weight > 100;
  });

  const mutation = useMutation({
    mutationFn: (payload: {
      templateId: string;
      periodId: string;
      rows: Array<{ employeeId: string; target: string | null; weight: number }>;
    }) => api.post<AssignmentResult>('/kpi-library/assignments', payload),
    onSuccess: (response) => {
      setResult(response);
      if (response.created > 0) {
        toast.success(
          `${response.created} KPI(s) assigned`,
          response.conflicts.length
            ? `${response.conflicts.length} row(s) were rejected — see the conflicts below.`
            : 'Every selected employee received the KPI.',
        );
        queryClient.invalidateQueries({ queryKey: ['kpi-library'] });
      } else {
        toast.warning('No KPI was assigned', 'Every selected row was rejected — see the conflicts below.');
      }
    },
    onError: (error) => toast.error('Could not assign the template', messageOf(error)),
  });

  const conflictFor = (employeeId: string): AssignmentConflict | undefined =>
    result?.conflicts.find((conflict) => conflict.employeeId === employeeId);

  const assignmentFor = (employeeId: string) =>
    result?.assignments.find((assignment) => assignment.employeeId === employeeId);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Assign a template to employees"
      subtitle="FR-LIB-03 / UC-08 — pick a template and period, then a target and weight per employee."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {step === 1 ? (
            <Button disabled={!templateId || !periodId} onClick={() => setStep(2)}>
              Next: choose employees
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                loading={mutation.isPending}
                disabled={!templateId || !periodId || selectedCount === 0 || rowsInvalid}
                onClick={() => {
                  mutation.mutate({
                    templateId,
                    periodId,
                    rows: selectedRows.map(([employeeId, row]) => ({
                      employeeId,
                      target: row.target.trim() ? row.target.trim() : null,
                      weight: Number(row.weight),
                    })),
                  });
                }}
              >
                Assign to {selectedCount} employee{selectedCount === 1 ? '' : 's'}
              </Button>
            </>
          )}
        </>
      }
    >
      <ol className="mb-5 flex items-center gap-2 text-caption" aria-label="Assignment steps">
        <li className={cn('rounded-pill px-2.5 py-1', step === 1 ? 'bg-navy-900 text-white' : 'bg-neutral-tint text-ink-secondary')}>
          1 · Template &amp; period
        </li>
        <li className="text-ink-muted" aria-hidden="true">
          →
        </li>
        <li className={cn('rounded-pill px-2.5 py-1', step === 2 ? 'bg-navy-900 text-white' : 'bg-neutral-tint text-ink-secondary')}>
          2 · Employees, target &amp; weight
        </li>
      </ol>

      {step === 1 ? (
        <div className="space-y-4">
          <Alert tone="info">
            Only published templates can be assigned. The period must be open and its submission deadline must not have
            passed.
          </Alert>

          <Field label="Template" htmlFor="assign-template" required hint="Published templates visible to you.">
            <Select id="assign-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              <option value="">Select a template…</option>
              {templates.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · v{entry.version} · {entry.scope === 'GROUP' ? 'Group' : entry.department?.name ?? 'Department'}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Period" htmlFor="assign-period" required hint="Open and reopened periods only.">
            <Select id="assign-period" value={periodId} onChange={(event) => setPeriodId(event.target.value)}>
              <option value="">Select a period…</option>
              {(periodsQuery.data ?? []).map((period) => (
                <option key={period.id} value={period.id}>
                  {period.label} · {titleCase(period.frequency)}
                </option>
              ))}
            </Select>
          </Field>

          {template ? (
            <div className="rounded-control border border-edge bg-canvas p-3">
              <p className="text-body font-semibold text-ink">{template.name}</p>
              <p className="mt-0.5 text-caption text-ink-secondary">{template.description ?? 'No description.'}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="info">{titleCase(template.category.code)}</Badge>
                <Badge tone="neutral">{MEASUREMENT_TYPE_LABELS[template.measurementType]}</Badge>
                <Badge tone="neutral">Unit: {template.unit}</Badge>
                <Badge tone="warning">Suggested weight {template.suggestedWeight}%</Badge>
                <Badge tone="neutral">Version {template.version}</Badge>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business unit" htmlFor="assign-bu">
              <Select
                id="assign-bu"
                value={businessUnitId}
                onChange={(event) => {
                  setBusinessUnitId(event.target.value);
                  setDepartmentId('');
                }}
              >
                <option value="">All business units</option>
                {(businessUnitsQuery.data ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} · {unit.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Department" htmlFor="assign-department" required hint="Employees are listed from the user directory.">
              <Select
                id="assign-department"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">Select a department…</option>
                {(departmentsQuery.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.code} · {department.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {!departmentId ? (
            <Alert tone="info">Choose a department to list its active employees.</Alert>
          ) : employeesQuery.isError ? (
            <ErrorState message={messageOf(employeesQuery.error)} onRetry={() => void employeesQuery.refetch()} />
          ) : employeesQuery.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : !employeesQuery.data?.items.length ? (
            <EmptyState title="No active employees" description="This department has no active employees to assign." />
          ) : (
            <div className="overflow-x-auto rounded-control border border-edge">
              <table className="anwar-table sticky-first-col">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Employee</th>
                    <th>Target</th>
                    <th>Weight (%)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {employeesQuery.data.items.map((employee) => {
                    const row = rows[employee.id];
                    const conflict = conflictFor(employee.id);
                    const assignment = assignmentFor(employee.id);
                    return (
                      <tr key={employee.id}>
                        <td>
                          <Checkbox
                            label={<span className="sr-only">Select {employee.fullName}</span>}
                            checked={row?.selected ?? false}
                            onChange={() => toggleEmployee(employee.id)}
                          />
                        </td>
                        <td>
                          <p className="font-semibold text-ink">{employee.fullName}</p>
                          <p className="text-caption text-ink-secondary">
                            <span className="anwar-mono">{employee.employeeCode}</span> · {employee.designationTitle ?? '—'}
                          </p>
                        </td>
                        <td>
                          <Input
                            aria-label={`Target for ${employee.fullName}`}
                            value={row?.target ?? ''}
                            disabled={!row?.selected}
                            placeholder={template ? `e.g. ${template.unit}` : 'Optional'}
                            onChange={(event) =>
                              setRows((current) => ({
                                ...current,
                                [employee.id]: { ...(current[employee.id] ?? { selected: true, weight: '10', target: '' }), target: event.target.value },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <Input
                            aria-label={`Weight for ${employee.fullName}`}
                            type="number"
                            min={1}
                            max={100}
                            value={row?.weight ?? ''}
                            disabled={!row?.selected}
                            invalid={
                              row?.selected === true &&
                              (!Number.isInteger(Number(row.weight)) || Number(row.weight) < 1 || Number(row.weight) > 100)
                            }
                            onChange={(event) =>
                              setRows((current) => ({
                                ...current,
                                [employee.id]: { ...(current[employee.id] ?? { selected: true, target: '' }), weight: event.target.value },
                              }))
                            }
                          />
                        </td>
                        <td>
                          {conflict ? (
                            <div>
                              <Badge tone="danger">Conflict · {conflict.code}</Badge>
                              <p className="mt-1 max-w-[260px] text-caption text-danger">{conflict.reason}</p>
                              {conflict.availableWeight !== undefined ? (
                                <p className="text-[11px] text-ink-muted">Available weight: {conflict.availableWeight}%</p>
                              ) : null}
                            </div>
                          ) : assignment ? (
                            <div>
                              <Badge tone="success">Created</Badge>
                              <p className="anwar-mono mt-1 text-caption text-ink-secondary">{assignment.code}</p>
                            </div>
                          ) : row?.selected ? (
                            <span className="text-caption text-ink-secondary">Ready to assign</span>
                          ) : (
                            <span className="text-caption text-ink-muted">Not selected</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {result ? (
            <div className="rounded-control border border-edge p-3">
              <p className="mb-2 text-body font-semibold text-ink">
                Result: {result.created} created
                {result.conflicts.length ? ` · ${result.conflicts.length} conflict(s)` : ''}
              </p>
              {result.conflicts.length ? (
                <ul className="space-y-1.5">
                  {result.conflicts.map((conflict) => (
                    <li key={`${conflict.employeeId}-${conflict.code}`} className="text-caption">
                      <span className="font-semibold text-danger">{conflict.employeeName}</span>
                      <span className="text-ink-muted"> · {conflict.code} · </span>
                      <span className="text-ink-secondary">{conflict.reason}</span>
                      {conflict.availableWeight !== undefined ? (
                        <span className="text-ink-muted"> (available {conflict.availableWeight}%)</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-caption text-success">Every selected row was created.</p>
              )}
            </div>
          ) : null}

          {rowsInvalid ? (
            <Alert tone="warning">
              Every selected row needs a whole-number weight between 1 and 100 before assigning.
            </Alert>
          ) : null}
        </div>
      )}
    </Drawer>
  );
};

// ------------------------------------------------------------------- page

const KpiLibraryPage: React.FC = () => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('template:manage') || hasPermission('template:dept-manage');
  const canPublish = hasPermission('template:manage');
  const canAssign = hasPermission('kpi:assign');

  const [tab, setTab] = React.useState<'templates' | 'categories'>('templates');
  const [searchTerm, setSearchTerm] = React.useState('');
  const search = useDebounced(searchTerm, 300);
  const [categoryId, setCategoryId] = React.useState('');
  const [measurementType, setMeasurementType] = React.useState('');
  const [scope, setScope] = React.useState('');
  const [isPublished, setIsPublished] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(25);

  const [drawer, setDrawer] = React.useState<{ open: boolean; template: TemplateItem | null }>({
    open: false,
    template: null,
  });
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [unpublishTarget, setUnpublishTarget] = React.useState<TemplateItem | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['kpi-library', 'categories'],
    queryFn: () => api.get<CategoryItem[]>('/kpi-library/categories'),
    staleTime: 5 * 60_000,
  });

  const templatesQuery = useQuery({
    queryKey: ['kpi-library', 'templates', { search, categoryId, measurementType, scope, isPublished, page, size }],
    queryFn: () =>
      api.get<Paginated<TemplateItem>>('/kpi-library/templates', {
        search: search.trim() || undefined,
        categoryId: categoryId || undefined,
        measurementType: measurementType || undefined,
        scope: scope || undefined,
        isPublished: isPublished || undefined,
        page,
        size,
      }),
    placeholderData: keepPreviousData,
  });

  const publishedQuery = useQuery({
    queryKey: ['kpi-library', 'templates', 'published-picker'],
    queryFn: () => api.get<Paginated<TemplateItem>>('/kpi-library/templates', { isPublished: true, size: 100 }),
    enabled: assignOpen,
    staleTime: 60_000,
  });

  const publishMutation = useMutation({
    mutationFn: (payload: { id: string; isPublished: boolean }) =>
      api.post<TemplateItem>(`/kpi-library/templates/${payload.id}/publish`, { isPublished: payload.isPublished }),
    onSuccess: (updated) => {
      toast.success(updated.isPublished ? 'Template published' : 'Template unpublished', `“${updated.name}” updated.`);
      setUnpublishTarget(null);
      queryClient.invalidateQueries({ queryKey: ['kpi-library'] });
    },
    onError: (error) => toast.error('Could not change the publish state', messageOf(error)),
  });

  const categories = categoriesQuery.data ?? [];
  const data = templatesQuery.data;

  return (
    <>
      <PageHeader
        title="KPI library"
        subtitle="M04 — reusable KPI templates, the category list and bulk assignment to employees."
        actions={
          <>
            {canAssign ? (
              <Button variant="secondary" onClick={() => setAssignOpen(true)}>
                Assign to employees
              </Button>
            ) : null}
            {canEdit ? (
              <Button onClick={() => setDrawer({ open: true, template: null })}>New template</Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          items={[
            { key: 'templates', label: 'Templates' },
            { key: 'categories', label: 'Categories', count: categories.length },
          ]}
          value={tab}
          onChange={(key) => setTab(key as 'templates' | 'categories')}
          ariaLabel="KPI library sections"
        />
      </div>

      {tab === 'templates' ? (
        <Card>
          <CardHeader
            title="Templates"
            subtitle="Filter by category, measurement type, scope and publish state. Editing a template creates a new version."
          />

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Search" htmlFor="library-search">
              <Input
                id="library-search"
                type="search"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setPage(1);
                }}
                placeholder="Name, code or description…"
              />
            </Field>
            <Field label="Category" htmlFor="library-category">
              <Select
                id="library-category"
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {titleCase(category.code)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Measurement type" htmlFor="library-measurement">
              <Select
                id="library-measurement"
                value={measurementType}
                onChange={(event) => {
                  setMeasurementType(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All measurement types</option>
                {MEASUREMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {MEASUREMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Scope" htmlFor="library-scope">
              <Select
                id="library-scope"
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All scopes</option>
                <option value="GROUP">Group</option>
                <option value="DEPARTMENT">Department</option>
              </Select>
            </Field>
            <Field label="Published" htmlFor="library-published">
              <Select
                id="library-published"
                value={isPublished}
                onChange={(event) => {
                  setIsPublished(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All</option>
                <option value="true">Published</option>
                <option value="false">Unpublished</option>
              </Select>
            </Field>
          </div>

          {templatesQuery.isError ? (
            <ErrorState message={messageOf(templatesQuery.error)} onRetry={() => void templatesQuery.refetch()} />
          ) : templatesQuery.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : !data?.items.length ? (
            <EmptyState
              title="No templates match your filters"
              description="Adjust the filters or create a new template."
            />
          ) : (
            <>
              <div className="-mx-4 overflow-x-auto sm:mx-0">
                <table className="anwar-table sticky-first-col">
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Category</th>
                      <th>Measurement</th>
                      <th>Unit</th>
                      <th>Direction</th>
                      <th className="text-right">Weight</th>
                      <th>Scope</th>
                      <th className="text-right">Version</th>
                      <th>Published</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((template) => (
                      <tr key={template.id}>
                        <td>
                          <p className="font-semibold text-ink">{template.name}</p>
                          <p className="anwar-mono text-caption text-ink-secondary">{template.code}</p>
                          {template.description ? (
                            <p className="max-w-[320px] truncate text-caption text-ink-muted" title={template.description}>
                              {template.description}
                            </p>
                          ) : null}
                        </td>
                        <td>{titleCase(template.category.code)}</td>
                        <td>{MEASUREMENT_TYPE_LABELS[template.measurementType]}</td>
                        <td>{template.unit}</td>
                        <td>{DIRECTIONS.find((direction) => direction.code === template.direction)?.label ?? template.direction}</td>
                        <td className="tnum text-right">{template.suggestedWeight}%</td>
                        <td>
                          <Badge tone={template.scope === 'GROUP' ? 'info' : 'neutral'}>
                            {template.scope === 'GROUP' ? 'Group' : template.department?.name ?? 'Department'}
                          </Badge>
                        </td>
                        <td className="tnum text-right">v{template.version}</td>
                        <td>
                          <Badge tone={template.isPublished ? 'success' : 'neutral'}>
                            {template.isPublished ? 'Published' : 'Draft'}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {canEdit ? (
                              <Button size="sm" variant="secondary" onClick={() => setDrawer({ open: true, template })}>
                                Edit
                              </Button>
                            ) : null}
                            {canPublish ? (
                              template.isPublished ? (
                                <Button size="sm" variant="ghost" onClick={() => setUnpublishTarget(template)}>
                                  Unpublish
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  loading={publishMutation.isPending}
                                  onClick={() => publishMutation.mutate({ id: template.id, isPublished: true })}
                                >
                                  Publish
                                </Button>
                              )
                            ) : null}
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
      ) : (
        <Card>
          <CardHeader
            title="KPI categories"
            subtitle="The four BRD categories every KPI and template belongs to. They are seeded automatically."
          />
          {categoriesQuery.isError ? (
            <ErrorState message={messageOf(categoriesQuery.error)} onRetry={() => void categoriesQuery.refetch()} />
          ) : categoriesQuery.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : !categories.length ? (
            <EmptyState title="No categories" description="Categories are seeded on first read." />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {categories.map((category) => (
                <li key={category.id} className="rounded-control border border-edge px-4 py-3">
                  <p className="text-body font-semibold text-navy-900">{category.name}</p>
                  <p className="anwar-mono text-caption text-ink-secondary">{category.code}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <TemplateDrawer
        open={drawer.open}
        template={drawer.template}
        categories={categories}
        canEdit={canEdit}
        onClose={() => setDrawer({ open: false, template: null })}
      />

      <AssignWizardDrawer
        open={assignOpen}
        templates={publishedQuery.data?.items ?? []}
        onClose={() => setAssignOpen(false)}
      />

      <Modal
        open={Boolean(unpublishTarget)}
        onClose={() => setUnpublishTarget(null)}
        title="Unpublish this template?"
        description={unpublishTarget ? `${unpublishTarget.name} · ${unpublishTarget.code}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnpublishTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={publishMutation.isPending}
              onClick={() => {
                if (unpublishTarget) publishMutation.mutate({ id: unpublishTarget.id, isPublished: false });
              }}
            >
              Unpublish
            </Button>
          </>
        }
      >
        <Alert tone="warning">
          An unpublished template cannot be assigned to employees. KPIs already created from it are not affected.
        </Alert>
      </Modal>
    </>
  );
};

export default KpiLibraryPage;
