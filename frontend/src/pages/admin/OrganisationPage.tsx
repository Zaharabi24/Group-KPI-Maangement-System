/**
 * ============================================================================
 *  M03 · Organisation master data — FR-ORG-01, FR-ORG-05
 * ============================================================================
 *  · Business units        — create / rename / deactivate, department counts.
 *  · Departments           — filtered by business unit (BU → Department link),
 *                            employees, approvers (the `heads` array).
 *  · Organisation tree     — BU → Department with counts and approver names.
 *
 *  Hard delete is blocked once a record is referenced: the API answers 409 and
 *  that message is shown verbatim so HR sees exactly what must be moved first.
 * ============================================================================
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import type { BusinessUnitItem, DepartmentItem } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  SectionTitle,
  SegmentedControl,
  Select,
  Skeleton,
} from '@/components/ui';
import { Alert, PageHeader } from '@/components/ui/badges';
import { useToast } from '@/context/ToastContext';

// ------------------------------------------------------------------- helpers

type Tab = 'units' | 'departments' | 'tree';

interface OrgTreeUnit {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  division: string | null;
  sortOrder: number;
  isActive: boolean;
  departments: Array<{ id: string; code: string; name: string; isActive: boolean }>;
}

const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'The request could not be completed.';

const isConflict = (error: unknown): error is ApiError => error instanceof ApiError && error.status === 409;

const useBusinessUnits = () =>
  useQuery({
    queryKey: ['organisation', 'business-units', 'all'],
    queryFn: () => api.get<BusinessUnitItem[]>('/organisation/business-units', { includeInactive: true }),
    staleTime: 60_000,
  });

const useDepartments = (businessUnitId: string) =>
  useQuery({
    queryKey: ['organisation', 'departments', 'admin', businessUnitId || 'all'],
    queryFn: () =>
      api.get<DepartmentItem[]>('/organisation/departments', {
        ...(businessUnitId ? { businessUnitId } : {}),
        includeInactive: true,
      }),
    staleTime: 60_000,
  });

const ApproverList: React.FC<{ heads: DepartmentItem['heads'] }> = ({ heads }) => {
  if (!heads?.length) return <span className="text-caption text-danger">No active approver</span>;
  return (
    <ul className="space-y-0.5">
      {heads.map((head) => (
        <li key={head.id} className="text-caption text-ink-secondary">
          <span className="font-medium text-ink">{head.fullName}</span>
          <span className="text-ink-muted"> · {head.email}</span>
        </li>
      ))}
    </ul>
  );
};

// ------------------------------------------------------- business unit modal

const BusinessUnitModal: React.FC<{ unit: BusinessUnitItem | null; open: boolean; onClose: () => void }> = ({
  unit,
  open,
  onClose,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = Boolean(unit);
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [shortName, setShortName] = React.useState('');
  const [division, setDivision] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setName(unit?.name ?? '');
    setCode(unit?.code ?? '');
    setShortName(unit?.shortName ?? '');
    setDivision(unit?.division ?? '');
  }, [open, unit]);

  const mutation = useMutation({
    mutationFn: (payload: { name: string; code: string; shortName?: string; division?: string }) =>
      unit
        ? api.patch<BusinessUnitItem>(`/organisation/business-units/${unit.id}`, payload)
        : api.post<BusinessUnitItem>('/organisation/business-units', payload),
    onSuccess: () => {
      toast.success(isEdit ? 'Business unit updated' : 'Business unit created', 'Organisation master data saved.');
      queryClient.invalidateQueries({ queryKey: ['organisation'] });
      onClose();
    },
    onError: (error) => toast.error('Could not save the business unit', messageOf(error)),
  });

  const nameError = name.trim().length < 2 ? 'Name must be at least 2 characters.' : null;
  const codeError = code.trim().length < 1 || code.trim().length > 16 ? 'Code must be 1–16 characters.' : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Rename business unit' : 'New business unit'}
      description={isEdit ? unit?.name : 'Business units are the top level of the organisation tree.'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={Boolean(nameError || codeError)}
            onClick={() => {
              if (nameError || codeError) return;
              mutation.mutate({
                name: name.trim(),
                code: code.trim().toUpperCase(),
                shortName: shortName.trim(),
                division: division.trim(),
              });
            }}
          >
            {isEdit ? 'Save changes' : 'Create business unit'}
          </Button>
        </>
      }
    >
      {mutation.error ? (
        <Alert tone={isConflict(mutation.error) ? 'warning' : 'danger'} className="mb-4" title="The API rejected this change">
          {messageOf(mutation.error)}
        </Alert>
      ) : null}
      <div className="space-y-4">
        <Field label="Name" htmlFor="bu-name" required error={nameError}>
          <Input id="bu-name" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} invalid={Boolean(nameError)} />
        </Field>
        <Field label="Code" htmlFor="bu-code" required hint="Short, stable code used in KPI codes and the bulk import." error={codeError}>
          <Input
            id="bu-code"
            value={code}
            maxLength={16}
            className="anwar-mono"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            invalid={Boolean(codeError)}
          />
        </Field>
        <Field label="Short name" htmlFor="bu-short" hint="Optional.">
          <Input id="bu-short" value={shortName} maxLength={64} onChange={(event) => setShortName(event.target.value)} />
        </Field>
        <Field label="Division" htmlFor="bu-division" hint="Optional grouping used on the group dashboard.">
          <Input id="bu-division" value={division} maxLength={80} onChange={(event) => setDivision(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
};

// --------------------------------------------------------- department modal

const DepartmentModal: React.FC<{
  department: DepartmentItem | null;
  open: boolean;
  defaultBusinessUnitId: string;
  onClose: () => void;
}> = ({ department, open, defaultBusinessUnitId, onClose }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = Boolean(department);
  const { data: businessUnits } = useBusinessUnits();
  const [businessUnitId, setBusinessUnitId] = React.useState('');
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setBusinessUnitId(department?.businessUnitId ?? department?.businessUnit?.id ?? defaultBusinessUnitId);
    setName(department?.name ?? '');
    setCode(department?.code ?? '');
  }, [open, department, defaultBusinessUnitId]);

  const mutation = useMutation({
    mutationFn: (payload: { businessUnitId: string; name: string; code?: string }) =>
      department
        ? api.patch<DepartmentItem>(`/organisation/departments/${department.id}`, payload)
        : api.post<DepartmentItem>('/organisation/departments', payload),
    onSuccess: () => {
      toast.success(isEdit ? 'Department updated' : 'Department created', 'Organisation master data saved.');
      queryClient.invalidateQueries({ queryKey: ['organisation'] });
      onClose();
    },
    onError: (error) => toast.error('Could not save the department', messageOf(error)),
  });

  const nameError = name.trim().length < 2 ? 'Name must be at least 2 characters.' : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Rename department' : 'New department'}
      description={isEdit ? department?.name : 'A department always belongs to exactly one business unit.'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={Boolean(nameError) || !businessUnitId}
            onClick={() => {
              if (nameError || !businessUnitId) return;
              mutation.mutate({
                businessUnitId,
                name: name.trim(),
                ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
              });
            }}
          >
            {isEdit ? 'Save changes' : 'Create department'}
          </Button>
        </>
      }
    >
      {mutation.error ? (
        <Alert tone={isConflict(mutation.error) ? 'warning' : 'danger'} className="mb-4" title="The API rejected this change">
          {messageOf(mutation.error)}
        </Alert>
      ) : null}
      <div className="space-y-4">
        <Field label="Business unit" htmlFor="dept-bu" required hint="The BU → Department link is enforced by the API.">
          <Select id="dept-bu" value={businessUnitId} onChange={(event) => setBusinessUnitId(event.target.value)}>
            <option value="">Select a business unit…</option>
            {(businessUnits ?? []).map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} · {unit.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" htmlFor="dept-name" required error={nameError}>
          <Input id="dept-name" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} invalid={Boolean(nameError)} />
        </Field>
        <Field
          label="Code"
          htmlFor="dept-code"
          hint={isEdit ? 'Must be unique inside the business unit.' : 'Optional — generated from the name when left blank.'}
        >
          <Input
            id="dept-code"
            value={code}
            maxLength={24}
            className="anwar-mono"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </Field>
      </div>
    </Modal>
  );
};

// ------------------------------------------------------------------- page

const OrganisationPage: React.FC = () => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<Tab>('units');
  const [selectedUnitId, setSelectedUnitId] = React.useState('');
  const [unitModal, setUnitModal] = React.useState<{ open: boolean; unit: BusinessUnitItem | null }>({
    open: false,
    unit: null,
  });
  const [deptModal, setDeptModal] = React.useState<{ open: boolean; department: DepartmentItem | null }>({
    open: false,
    department: null,
  });
  const [unitToDeactivate, setUnitToDeactivate] = React.useState<BusinessUnitItem | null>(null);
  const [deptToDeactivate, setDeptToDeactivate] = React.useState<DepartmentItem | null>(null);

  const unitsQuery = useBusinessUnits();
  const departmentsQuery = useDepartments(selectedUnitId);

  const treeQuery = useQuery({
    queryKey: ['organisation', 'tree'],
    queryFn: () => api.get<OrgTreeUnit[]>('/organisation/tree'),
    enabled: tab === 'tree',
  });

  // Approver names + employee counts for the tree come from the department list.
  const treeDepartmentsQuery = useQuery({
    queryKey: ['organisation', 'departments', 'tree-source'],
    queryFn: () => api.get<DepartmentItem[]>('/organisation/departments', { includeInactive: true }),
    enabled: tab === 'tree',
  });

  const units = unitsQuery.data ?? [];
  const departments = departmentsQuery.data ?? [];
  const totalDepartments = units.reduce((sum, unit) => sum + (unit.departmentCount ?? 0), 0);

  const deactivateUnitMutation = useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/organisation/business-units/${id}/deactivate`),
    onSuccess: (data) => {
      toast.success('Business unit deactivated', data.message);
      setUnitToDeactivate(null);
      queryClient.invalidateQueries({ queryKey: ['organisation'] });
    },
    onError: (error) => toast.error('Could not deactivate the business unit', messageOf(error)),
  });

  const deactivateDeptMutation = useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/organisation/departments/${id}/deactivate`),
    onSuccess: (data) => {
      toast.success('Department deactivated', data.message);
      setDeptToDeactivate(null);
      queryClient.invalidateQueries({ queryKey: ['organisation'] });
    },
    onError: (error) => toast.error('Could not deactivate the department', messageOf(error)),
  });

  const approverByDepartment = new Map(
    (treeDepartmentsQuery.data ?? []).map((department) => [department.id, department]),
  );

  return (
    <>
      <PageHeader
        title="Organisation"
        subtitle="FR-ORG-01 — the Business Unit & Department List master data every KPI, scope rule and report depends on."
        actions={
          tab === 'units' ? (
            <Button onClick={() => setUnitModal({ open: true, unit: null })}>New business unit</Button>
          ) : tab === 'departments' ? (
            <Button onClick={() => setDeptModal({ open: true, department: null })}>New department</Button>
          ) : null
        }
      />

      {/* -------------------------------------------------------- summary strip */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center justify-between gap-3">
          <div>
            <p className="text-caption uppercase tracking-wide text-ink-secondary">Total business units</p>
            <p className="tnum text-h2 text-navy-900">{units.length}</p>
          </div>
          <Badge tone="info">{units.filter((unit) => unit.isActive).length} active</Badge>
        </Card>
        <Card className="flex items-center justify-between gap-3">
          <div>
            <p className="text-caption uppercase tracking-wide text-ink-secondary">Total departments</p>
            <p className="tnum text-h2 text-navy-900">{totalDepartments}</p>
          </div>
          <Badge tone="neutral">
            {departments.filter((department) => department.isActive).length || 0} in current filter
          </Badge>
        </Card>
        <Card>
          <p className="text-caption uppercase tracking-wide text-ink-secondary">Source of truth</p>
          <p className="mt-1 text-caption text-ink-secondary">
            Both counts come from the uploaded “Business Unit &amp; Department List” master data. Keep this list current:
            scope rules, approver routing and report filters are driven from it.
          </p>
        </Card>
      </div>

      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          items={[
            { key: 'units', label: 'Business units' },
            { key: 'departments', label: 'Departments' },
            { key: 'tree', label: 'Organisation tree' },
          ]}
          value={tab}
          onChange={(key) => setTab(key as Tab)}
          ariaLabel="Organisation views"
        />
      </div>

      {tab === 'units' ? (
        <Card>
          <CardHeader
            title="Business units"
            subtitle="Deactivating is blocked while the unit still holds active departments or users (FR-ORG-01 — hard delete is blocked once a record is referenced)."
          />
          {unitsQuery.isError ? (
            <ErrorState message={messageOf(unitsQuery.error)} onRetry={() => void unitsQuery.refetch()} />
          ) : unitsQuery.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : !units.length ? (
            <EmptyState title="No business units yet" description="Create the first business unit to get started." />
          ) : (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="anwar-table sticky-first-col">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Division</th>
                    <th className="text-right">Departments</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => (
                    <tr key={unit.id}>
                      <td className="anwar-mono">{unit.code}</td>
                      <td>
                        <p className="font-semibold text-ink">{unit.name}</p>
                        {unit.shortName ? <p className="text-caption text-ink-secondary">{unit.shortName}</p> : null}
                      </td>
                      <td>{unit.division ?? '—'}</td>
                      <td className="tnum text-right">{unit.departmentCount ?? 0}</td>
                      <td>
                        <Badge tone={unit.isActive ? 'success' : 'neutral'}>
                          {unit.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setUnitModal({ open: true, unit })}>
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!unit.isActive}
                            onClick={() => {
                              deactivateUnitMutation.reset();
                              setUnitToDeactivate(unit);
                            }}
                          >
                            Deactivate
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : tab === 'departments' ? (
        <Card>
          <CardHeader
            title="Departments"
            subtitle="The BU → Department relationship the platform must always maintain. Choose a business unit to filter the list."
            actions={
              <div className="w-[240px]">
                <Select
                  aria-label="Filter departments by business unit"
                  value={selectedUnitId}
                  onChange={(event) => setSelectedUnitId(event.target.value)}
                >
                  <option value="">All business units</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code} · {unit.name}
                    </option>
                  ))}
                </Select>
              </div>
            }
          />
          {departmentsQuery.isError ? (
            <ErrorState message={messageOf(departmentsQuery.error)} onRetry={() => void departmentsQuery.refetch()} />
          ) : departmentsQuery.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : !departments.length ? (
            <EmptyState
              title="No departments"
              description={selectedUnitId ? 'This business unit has no departments yet.' : 'No departments match this filter.'}
            />
          ) : (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="anwar-table sticky-first-col">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Business unit</th>
                    <th className="text-right">Employees</th>
                    <th>Approvers</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((department) => (
                    <tr key={department.id}>
                      <td className="anwar-mono">{department.code}</td>
                      <td className="font-semibold text-ink">{department.name}</td>
                      <td>{department.businessUnit?.name ?? '—'}</td>
                      <td className="tnum text-right">{department.employeeCount ?? 0}</td>
                      <td>
                        <ApproverList heads={department.heads} />
                      </td>
                      <td>
                        <Badge tone={department.isActive ? 'success' : 'neutral'}>
                          {department.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDeptModal({ open: true, department })}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!department.isActive}
                            onClick={() => {
                              deactivateDeptMutation.reset();
                              setDeptToDeactivate(department);
                            }}
                          >
                            Deactivate
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Organisation tree"
              subtitle="Active business units and their active departments, with employee counts and the active approvers."
            />
            {treeQuery.isError ? (
              <ErrorState message={messageOf(treeQuery.error)} onRetry={() => void treeQuery.refetch()} />
            ) : treeQuery.isPending ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : !treeQuery.data?.length ? (
              <EmptyState title="Nothing to show" description="No active business units were found." />
            ) : (
              <ul className="space-y-4">
                {treeQuery.data.map((unit) => {
                  const employeeTotal = unit.departments.reduce(
                    (sum, department) => sum + (approverByDepartment.get(department.id)?.employeeCount ?? 0),
                    0,
                  );
                  return (
                    <li key={unit.id} className="rounded-control border border-edge">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge bg-canvas px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-body font-semibold text-navy-900">
                            <span className="anwar-mono mr-2">{unit.code}</span>
                            {unit.name}
                          </p>
                          <p className="text-caption text-ink-secondary">
                            {unit.division ?? 'No division'} · {unit.departments.length} department
                            {unit.departments.length === 1 ? '' : 's'} · {employeeTotal} employee
                            {employeeTotal === 1 ? '' : 's'}
                          </p>
                        </div>
                        <Badge tone="info">{unit.departments.length} dept</Badge>
                      </div>
                      {unit.departments.length ? (
                        <ul className="divide-y divide-edge/70">
                          {unit.departments.map((department) => {
                            const detail = approverByDepartment.get(department.id);
                            return (
                              <li key={department.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                                <div className="min-w-0">
                                  <p className="text-body text-ink">
                                    <span className="anwar-mono mr-2 text-caption">{department.code}</span>
                                    {department.name}
                                  </p>
                                  <p className="text-caption text-ink-secondary">
                                    Approvers:{' '}
                                    {detail?.heads?.length
                                      ? detail.heads.map((head) => head.fullName).join(', ')
                                      : 'none assigned'}
                                  </p>
                                </div>
                                <span className="tnum text-caption text-ink-secondary">
                                  {detail?.employeeCount ?? 0} employees
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="px-3 py-3 text-caption text-ink-muted">No active departments.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle hint="FR-ORG-05 — a department must always keep at least one active approver while it has employees.">
              Maintenance rules
            </SectionTitle>
            <ul className="space-y-3 text-body text-ink-secondary">
              <li className="flex gap-2">
                <Badge tone="danger" className="h-fit shrink-0">
                  Blocked
                </Badge>
                <span>
                  Hard delete is blocked once a record is referenced. A business unit with active departments or users
                  and a department with active employees answer <strong>409 Conflict</strong>, and the API message is
                  shown verbatim so you know exactly what to move first.
                </span>
              </li>
              <li className="flex gap-2">
                <Badge tone="warning" className="h-fit shrink-0">
                  Approver
                </Badge>
                <span>
                  Deactivating the last active Department Head of a department that still has employees is refused
                  (FR-ORG-05 / EC-17). Assign another approver first.
                </span>
              </li>
              <li className="flex gap-2">
                <Badge tone="info" className="h-fit shrink-0">
                  Scope
                </Badge>
                <span>
                  Every scope rule (§5.3) reads this tree: Department Heads see their department, HR sees the group and
                  Super Admins see everything. Moving a department between business units is refused once it holds users
                  or KPIs so historical snapshots stay intact.
                </span>
              </li>
            </ul>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------- modals */}
      <BusinessUnitModal
        open={unitModal.open}
        unit={unitModal.unit}
        onClose={() => setUnitModal({ open: false, unit: null })}
      />

      <DepartmentModal
        open={deptModal.open}
        department={deptModal.department}
        defaultBusinessUnitId={selectedUnitId}
        onClose={() => setDeptModal({ open: false, department: null })}
      />

      <Modal
        open={Boolean(unitToDeactivate)}
        onClose={() => setUnitToDeactivate(null)}
        title="Deactivate this business unit?"
        description={unitToDeactivate ? `${unitToDeactivate.code} · ${unitToDeactivate.name}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnitToDeactivate(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deactivateUnitMutation.isPending}
              onClick={() => {
                if (unitToDeactivate) deactivateUnitMutation.mutate(unitToDeactivate.id);
              }}
            >
              Deactivate
            </Button>
          </>
        }
      >
        <Alert tone="warning" className="mb-3">
          Deactivation hides the unit from pickers and reports. Hard delete is blocked once a record is referenced.
        </Alert>
        {deactivateUnitMutation.error ? (
          <Alert tone="danger" title="Deactivation blocked">
            {messageOf(deactivateUnitMutation.error)}
          </Alert>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(deptToDeactivate)}
        onClose={() => setDeptToDeactivate(null)}
        title="Deactivate this department?"
        description={deptToDeactivate ? `${deptToDeactivate.code} · ${deptToDeactivate.name}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeptToDeactivate(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deactivateDeptMutation.isPending}
              onClick={() => {
                if (deptToDeactivate) deactivateDeptMutation.mutate(deptToDeactivate.id);
              }}
            >
              Deactivate
            </Button>
          </>
        }
      >
        <Alert tone="warning" className="mb-3">
          Deactivation is blocked while the department still has active employees. Transfer them first (FR-ORG-01).
        </Alert>
        {deptToDeactivate && (deptToDeactivate.employeeCount ?? 0) > 0 ? (
          <p className="mb-3 text-caption text-ink-secondary">
            Current active employees:{' '}
            <span className="tnum font-semibold text-danger">{deptToDeactivate.employeeCount}</span>
          </p>
        ) : null}
        {deactivateDeptMutation.error ? (
          <Alert tone="danger" title="Deactivation blocked">
            {messageOf(deactivateDeptMutation.error)}
          </Alert>
        ) : null}
      </Modal>
    </>
  );
};

export default OrganisationPage;
