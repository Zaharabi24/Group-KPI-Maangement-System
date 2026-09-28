/**
 * ============================================================================
 *  M03 · Users & access administration — FR-ORG-02..09, UC-07
 * ============================================================================
 *  Tabs:
 *    · Users             — server-paged directory with BU / Department / Role /
 *                          Status / search filters, edit, transfer, roles,
 *                          deactivate / reactivate.
 *    · Invitations       — pending invitations with resend + revoke.
 *    · New registrations — FR-ORG-09 confirmation of self-registered users.
 *    · Bulk import       — FR-ORG-07 CSV import with a row-level report.
 *    · Delegations       — FR-ORG-08 approver delegation.
 * ============================================================================
 */
import React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, saveBlob } from '@/lib/api';
import type {
  BusinessUnitItem,
  DelegationItem,
  DepartmentItem,
  InvitationItem,
  Paginated,
  RoleCode,
  UserListItem,
} from '@/lib/types';
import { ROLE_LABELS, ROLE_LONG_LABELS, formatDate, titleCase } from '@/lib/format';
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

type Tab = 'users' | 'invitations' | 'registrations' | 'import' | 'delegations';

const ROLE_CODES: RoleCode[] = ['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD', 'EMPLOYEE', 'MGMT_VIEWER', 'SYS_ADMIN'];

const USER_STATUS_LABELS: Record<string, string> = {
  PENDING_ACTIVATION: 'Pending activation',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  LOCKED: 'Locked',
};

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const userStatusTone = (status: string): BadgeTone =>
  status === 'ACTIVE' ? 'success' : status === 'INACTIVE' ? 'danger' : status === 'LOCKED' ? 'warning' : 'neutral';

const invitationTone = (status: InvitationItem['status']): BadgeTone =>
  status === 'PENDING' ? 'warning' : status === 'ACCEPTED' ? 'success' : status === 'REVOKED' ? 'danger' : 'neutral';

const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'The request could not be completed.';

const roleLabel = (code: RoleCode | string): string =>
  ROLE_LABELS[code as RoleCode] ?? titleCase(String(code));

/** "2 d 4 h left" / "Expired" for the invitation validity window. */
const countdown = (expiresAt: string): { label: string; expired: boolean } => {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(diff) || diff <= 0) return { label: 'Expired', expired: true };
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return { label: `${days} d ${hours} h left`, expired: false };
  if (hours > 0) return { label: `${hours} h ${minutes} m left`, expired: false };
  return { label: `${minutes} m left`, expired: false };
};

/** Shared lookups (React Query de-duplicates by key across the whole page). */
const useBusinessUnits = () =>
  useQuery({
    queryKey: ['organisation', 'business-units', false],
    queryFn: () => api.get<BusinessUnitItem[]>('/organisation/business-units'),
    staleTime: 5 * 60_000,
  });

const useDepartments = (businessUnitId: string) =>
  useQuery({
    queryKey: ['organisation', 'departments', businessUnitId || 'all'],
    queryFn: () =>
      api.get<DepartmentItem[]>('/organisation/departments', businessUnitId ? { businessUnitId } : undefined),
    staleTime: 5 * 60_000,
  });

const RoleBadges: React.FC<{ roles: Array<{ code: RoleCode; name?: string }>; max?: number }> = ({ roles, max = 3 }) => {
  if (!roles.length) return <span className="text-caption text-ink-muted">No role</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.slice(0, max).map((role) => (
        <Badge key={role.code} tone="info">
          {roleLabel(role.code)}
        </Badge>
      ))}
      {roles.length > max ? <Badge tone="neutral">+{roles.length - max}</Badge> : null}
    </span>
  );
};

// -------------------------------------------------------------- reason modal

const ReasonModal: React.FC<{
  open: boolean;
  title: string;
  description?: React.ReactNode;
  impact: React.ReactNode;
  confirmLabel: string;
  minLength?: number;
  tone?: 'primary' | 'danger';
  loading: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}> = ({ open, title, description, impact, confirmLabel, minLength = 15, tone = 'danger', loading, onClose, onConfirm }) => {
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const tooShort = reason.trim().length < minLength;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={tone}
            loading={loading}
            disabled={tooShort}
            onClick={() => {
              setTouched(true);
              if (!tooShort) onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Alert tone="warning" className="mb-4">
        {impact}
      </Alert>
      <Field
        label="Reason"
        htmlFor="reason-modal-reason"
        required
        hint={`At least ${minLength} characters. Recorded in the audit trail (BR-R11).`}
        error={touched && tooShort ? `Enter at least ${minLength} characters.` : null}
      >
        <Textarea
          id="reason-modal-reason"
          value={reason}
          rows={3}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          invalid={touched && tooShort}
        />
      </Field>
      <p className="mt-1 text-caption text-ink-muted">{reason.trim().length} / {minLength} characters</p>
    </Modal>
  );
};

// ------------------------------------------------------------------- roles

const AssignRolesModal: React.FC<{
  target: { user: UserListItem; initial: RoleCode[] } | null;
  onClose: () => void;
}> = ({ target, onClose }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState<RoleCode[]>([]);

  React.useEffect(() => {
    if (target) {
      setSelected(Array.from(new Set([...target.user.roles.map((r) => r.code), ...target.initial])));
    }
  }, [target]);

  const mutation = useMutation({
    mutationFn: (payload: { id: string; roleCodes: RoleCode[] }) =>
      api.post<UserListItem>(`/admin/users/${payload.id}/roles`, { roleCodes: payload.roleCodes }),
    onSuccess: () => {
      toast.success('Roles updated', 'The role change is recorded in the audit trail.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
    onError: (error) => toast.error('Could not update the roles', messageOf(error)),
  });

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title="Assign roles"
      description={target ? `${target.user.fullName} · ${target.user.employeeCode}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={selected.length === 0}
            onClick={() => {
              if (target) mutation.mutate({ id: target.user.id, roleCodes: selected });
            }}
          >
            Save roles
          </Button>
        </>
      }
    >
      <Alert tone="info" className="mb-4">
        At least one role must remain assigned. The group can never be left without an active Super Admin.
      </Alert>
      <div className="space-y-3">
        {ROLE_CODES.map((code) => (
          <Checkbox
            key={code}
            label={ROLE_LONG_LABELS[code]}
            hint={code}
            checked={selected.includes(code)}
            onChange={(event) =>
              setSelected((current) =>
                event.target.checked ? [...current, code] : current.filter((entry) => entry !== code),
              )
            }
          />
        ))}
      </div>
      {selected.length === 0 ? (
        <p className="mt-3 text-caption font-semibold text-danger">Select at least one role.</p>
      ) : null}
    </Modal>
  );
};

// ----------------------------------------------------------------- transfer

const TransferModal: React.FC<{ user: UserListItem | null; onClose: () => void }> = ({ user, onClose }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: businessUnits } = useBusinessUnits();
  const [businessUnitId, setBusinessUnitId] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const { data: departments } = useDepartments(businessUnitId);

  React.useEffect(() => {
    if (user) {
      setBusinessUnitId(user.businessUnit?.id ?? '');
      setDepartmentId('');
      setReason('');
      setTouched(false);
    }
  }, [user]);

  const mutation = useMutation({
    mutationFn: (payload: { id: string; departmentId: string; reason: string }) =>
      api.post<UserListItem>(`/admin/users/${payload.id}/transfer`, {
        departmentId: payload.departmentId,
        reason: payload.reason,
      }),
    onSuccess: () => {
      toast.success('User transferred', 'Approved KPIs keep the organisation snapshot captured at submission.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['organisation', 'departments'] });
      onClose();
    },
    onError: (error) => toast.error('Could not transfer the user', messageOf(error)),
  });

  const reasonTooShort = reason.trim().length < 15;

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title="Transfer department"
      description={user ? `${user.fullName} · currently ${user.department?.name ?? 'no department'}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={mutation.isPending}
            disabled={!departmentId || reasonTooShort}
            onClick={() => {
              setTouched(true);
              if (user && departmentId && !reasonTooShort) {
                mutation.mutate({ id: user.id, departmentId, reason: reason.trim() });
              }
            }}
          >
            Transfer
          </Button>
        </>
      }
    >
      <Alert tone="warning" className="mb-4">
        Transferring moves the user, their approver rows and their role scope to the new department. Open and submitted
        KPIs follow the new department; approved KPIs keep their original organisation snapshot (EC-01).
      </Alert>

      <div className="space-y-4">
        <Field label="Business unit" htmlFor="transfer-bu" required>
          <Select
            id="transfer-bu"
            value={businessUnitId}
            onChange={(event) => {
              setBusinessUnitId(event.target.value);
              setDepartmentId('');
            }}
          >
            <option value="">Select a business unit…</option>
            {(businessUnits ?? []).map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} · {unit.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="New department" htmlFor="transfer-dept" required hint="Only active departments are shown.">
          <Select
            id="transfer-dept"
            value={departmentId}
            disabled={!businessUnitId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">{businessUnitId ? 'Select a department…' : 'Select a business unit first'}</option>
            {(departments ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} · {department.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Reason"
          htmlFor="transfer-reason"
          required
          hint="At least 15 characters — recorded in the audit trail."
          error={touched && reasonTooShort ? 'Enter at least 15 characters.' : null}
        >
          <Textarea
            id="transfer-reason"
            value={reason}
            rows={3}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
            invalid={touched && reasonTooShort}
          />
        </Field>
      </div>
    </Modal>
  );
};

// -------------------------------------------------------------- edit drawer

const EditUserDrawer: React.FC<{ user: UserListItem | null; onClose: () => void }> = ({ user, onClose }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: businessUnits } = useBusinessUnits();
  const [fullName, setFullName] = React.useState('');
  const [designationTitle, setDesignationTitle] = React.useState('');
  const [businessUnitId, setBusinessUnitId] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');
  const { data: departments } = useDepartments(businessUnitId);

  React.useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setDesignationTitle(user.designationTitle ?? '');
      setBusinessUnitId(user.businessUnit?.id ?? '');
      setDepartmentId(user.department?.id ?? '');
    }
  }, [user]);

  const mutation = useMutation({
    mutationFn: (payload: {
      id: string;
      fullName: string;
      designationTitle: string;
      businessUnitId: string;
      departmentId: string;
    }) =>
      api.patch<UserListItem>(`/admin/users/${payload.id}`, {
        fullName: payload.fullName.trim(),
        ...(payload.designationTitle.trim() ? { designationTitle: payload.designationTitle.trim() } : {}),
        ...(payload.businessUnitId ? { businessUnitId: payload.businessUnitId } : {}),
        ...(payload.departmentId ? { departmentId: payload.departmentId } : {}),
      }),
    onSuccess: () => {
      toast.success('User updated', 'Identity and organisation mapping saved.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
    onError: (error) => toast.error('Could not save the user', messageOf(error)),
  });

  const nameError = fullName.trim().length < 3 ? 'Full name must be at least 3 characters.' : null;

  return (
    <Drawer
      open={Boolean(user)}
      onClose={onClose}
      title="Edit user"
      subtitle={user ? `${user.email} · ${user.employeeCode}` : undefined}
      confirmBeforeClose
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={Boolean(nameError)}
            onClick={() => {
              if (user && !nameError) {
                mutation.mutate({ id: user.id, fullName, designationTitle, businessUnitId, departmentId });
              }
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Full name" htmlFor="edit-user-name" required error={nameError}>
          <Input
            id="edit-user-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            invalid={Boolean(nameError)}
          />
        </Field>

        <Field label="Company e-mail" htmlFor="edit-user-email" hint="The e-mail address cannot be changed here.">
          <Input id="edit-user-email" value={user?.email ?? ''} readOnly disabled />
        </Field>

        <Field label="Employee ID" htmlFor="edit-user-code" hint="Employee IDs are immutable once issued.">
          <Input id="edit-user-code" value={user?.employeeCode ?? ''} readOnly disabled />
        </Field>

        <Field label="Designation" htmlFor="edit-user-designation" hint="Optional — shown on KPI records and reports.">
          <Input
            id="edit-user-designation"
            value={designationTitle}
            maxLength={160}
            onChange={(event) => setDesignationTitle(event.target.value)}
          />
        </Field>

        <Field label="Business unit" htmlFor="edit-user-bu">
          <Select
            id="edit-user-bu"
            value={businessUnitId}
            onChange={(event) => {
              setBusinessUnitId(event.target.value);
              setDepartmentId('');
            }}
          >
            <option value="">Not assigned</option>
            {(businessUnits ?? []).map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} · {unit.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Department"
          htmlFor="edit-user-dept"
          hint="Department must belong to the selected business unit. Use Transfer for a reason-logged move."
        >
          <Select
            id="edit-user-dept"
            value={departmentId}
            disabled={!businessUnitId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">Not assigned</option>
            {(departments ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} · {department.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Drawer>
  );
};

// -------------------------------------------------------------- invite drawer

interface InviteResult {
  existingUser: boolean;
  userId: string;
  invitationId?: string;
  message: string;
}

const InviteDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  onExistingUser: (userId: string, roleCode: RoleCode) => void;
}> = ({ open, onClose, onExistingUser }) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: businessUnits } = useBusinessUnits();

  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [employeeCode, setEmployeeCode] = React.useState('');
  const [businessUnitId, setBusinessUnitId] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');
  const [roleCode, setRoleCode] = React.useState<RoleCode>('EMPLOYEE');
  const [designationTitle, setDesignationTitle] = React.useState('');
  const [existing, setExisting] = React.useState<{ userId: string; message: string } | null>(null);

  const { data: departments } = useDepartments(businessUnitId);

  React.useEffect(() => {
    if (open) {
      setFullName('');
      setEmail('');
      setEmployeeCode('');
      setBusinessUnitId('');
      setDepartmentId('');
      setRoleCode('EMPLOYEE');
      setDesignationTitle('');
      setExisting(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: (payload: {
      fullName: string;
      email: string;
      employeeCode: string;
      businessUnitId: string;
      departmentId: string;
      roleCode: RoleCode;
      designationTitle?: string;
    }) => api.post<InviteResult>('/admin/invitations', payload),
    onSuccess: (result) => {
      if (result.existingUser) {
        setExisting({ userId: result.userId, message: result.message });
        return;
      }
      toast.success('Invitation sent', result.message);
      queryClient.invalidateQueries({ queryKey: ['admin', 'invitations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
    onError: (error) => toast.error('Could not send the invitation', messageOf(error)),
  });

  const emailInvalid = email.trim().length > 0 && !/^[^@\s]+@anwargroup\.net$/i.test(email.trim());
  const canSubmit =
    fullName.trim().length >= 3 &&
    /^[^@\s]+@anwargroup\.net$/i.test(email.trim()) &&
    employeeCode.trim().length >= 2 &&
    Boolean(businessUnitId) &&
    Boolean(departmentId) &&
    !emailInvalid;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Invite a user"
      subtitle="The invitation link is valid for 72 hours (NT-02)."
      confirmBeforeClose
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) return;
              mutation.mutate({
                fullName: fullName.trim(),
                email: email.trim().toLowerCase(),
                employeeCode: employeeCode.trim(),
                businessUnitId,
                departmentId,
                roleCode,
                ...(designationTitle.trim() ? { designationTitle: designationTitle.trim() } : {}),
              });
            }}
          >
            Send invitation
          </Button>
        </>
      }
    >
      {existing ? (
        <Alert
          tone="warning"
          className="mb-4"
          title="This e-mail already has an account"
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onExistingUser(existing.userId, roleCode);
                onClose();
              }}
            >
              Add this role to the existing user instead
            </Button>
          }
        >
          {existing.message}
        </Alert>
      ) : null}

      <div className="space-y-4">
        <Field label="Full name" htmlFor="invite-name" required>
          <Input
            id="invite-name"
            value={fullName}
            maxLength={160}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="e.g. Rahim Uddin"
          />
        </Field>

        <Field
          label="Company e-mail"
          htmlFor="invite-email"
          required
          hint="Only @anwargroup.net addresses can be invited."
          error={emailInvalid ? 'Use an official @anwargroup.net e-mail address.' : null}
        >
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@anwargroup.net"
            invalid={emailInvalid}
          />
        </Field>

        <Field label="Employee ID" htmlFor="invite-code" required hint="Must be unique across the group.">
          <Input
            id="invite-code"
            value={employeeCode}
            maxLength={32}
            onChange={(event) => setEmployeeCode(event.target.value)}
            placeholder="e.g. AGL-1042"
          />
        </Field>

        <Field label="Business unit" htmlFor="invite-bu" required>
          <Select
            id="invite-bu"
            value={businessUnitId}
            onChange={(event) => {
              setBusinessUnitId(event.target.value);
              setDepartmentId('');
            }}
          >
            <option value="">Select a business unit…</option>
            {(businessUnits ?? []).map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} · {unit.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Department"
          htmlFor="invite-dept"
          required
          hint="Filtered by the selected business unit — the BU → Department link is enforced by the API."
        >
          <Select
            id="invite-dept"
            value={departmentId}
            disabled={!businessUnitId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">{businessUnitId ? 'Select a department…' : 'Select a business unit first'}</option>
            {(departments ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} · {department.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Role" htmlFor="invite-role" required hint="Shown with its full BRD label.">
          <Select id="invite-role" value={roleCode} onChange={(event) => setRoleCode(event.target.value as RoleCode)}>
            {ROLE_CODES.map((code) => (
              <option key={code} value={code}>
                {ROLE_LONG_LABELS[code]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Designation" htmlFor="invite-designation" hint="Optional — shown on KPI records and reports.">
          <Input
            id="invite-designation"
            value={designationTitle}
            maxLength={160}
            onChange={(event) => setDesignationTitle(event.target.value)}
            placeholder="e.g. Senior Officer"
          />
        </Field>
      </div>
    </Drawer>
  );
};

// -------------------------------------------------------- invitations panel

const InvitationsPanel: React.FC = () => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState('PENDING');
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebounced(search, 300);
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(25);
  const [revokeTarget, setRevokeTarget] = React.useState<InvitationItem | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'invitations', { page, size, status, search: debouncedSearch }],
    queryFn: () =>
      api.get<Paginated<InvitationItem>>('/admin/invitations', {
        page,
        size,
        status: status || undefined,
        search: debouncedSearch.trim() || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'invitations'] });

  const resendMutation = useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/admin/invitations/${id}/resend`),
    onSuccess: (result) => {
      toast.success('Invitation re-sent', result.message);
      void invalidate();
    },
    onError: (error) => toast.error('Could not resend the invitation', messageOf(error)),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/admin/invitations/${id}/revoke`),
    onSuccess: (result) => {
      toast.success('Invitation revoked', result.message);
      setRevokeTarget(null);
      void invalidate();
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error('Could not revoke the invitation', messageOf(error)),
  });

  const data = query.data;

  return (
    <Card>
      <CardHeader
        title="Pending invitations"
        subtitle="Invitations expire 72 hours after they are sent. Resending invalidates the previous link."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Status" htmlFor="invitation-status">
          <Select
            id="invitation-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="EXPIRED">Expired</option>
            <option value="REVOKED">Revoked</option>
          </Select>
        </Field>
        <Field label="Search" htmlFor="invitation-search" className="sm:col-span-1 lg:col-span-2">
          <Input
            id="invitation-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Name, e-mail or employee ID…"
          />
        </Field>
      </div>

      {query.isError ? (
        <ErrorState message={messageOf(query.error)} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : !data?.items.length ? (
        <EmptyState
          title="No invitations match your filters"
          description="Invitations you send appear here until they are accepted, revoked or expire."
        />
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="anwar-table sticky-first-col">
              <thead>
                <tr>
                  <th>Invitee</th>
                  <th>Employee ID</th>
                  <th>Business unit</th>
                  <th>Department</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Expiry</th>
                  <th>Resends</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((invitation) => {
                  const expiry = countdown(invitation.expiresAt);
                  return (
                    <tr key={invitation.id}>
                      <td>
                        <p className="font-semibold text-ink">{invitation.fullName}</p>
                        <p className="text-caption text-ink-secondary">{invitation.email}</p>
                      </td>
                      <td className="anwar-mono">{invitation.employeeCode}</td>
                      <td>{invitation.businessUnit?.name ?? '—'}</td>
                      <td>{invitation.department?.name ?? '—'}</td>
                      <td>{invitation.role ? roleLabel(invitation.role.code) : '—'}</td>
                      <td>
                        <Badge tone={invitationTone(invitation.status)}>{titleCase(invitation.status)}</Badge>
                      </td>
                      <td>
                        <span className={cn('text-caption', expiry.expired ? 'text-danger font-semibold' : 'text-ink-secondary')}>
                          {expiry.label}
                        </span>
                        <p className="text-[11px] text-ink-muted">{formatDate(invitation.expiresAt)}</p>
                      </td>
                      <td className="tnum">{invitation.resendCount}</td>
                      <td className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={resendMutation.isPending && resendMutation.variables === invitation.id}
                            disabled={invitation.status !== 'PENDING' && invitation.status !== 'EXPIRED'}
                            onClick={() => resendMutation.mutate(invitation.id)}
                          >
                            Resend
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={invitation.status === 'ACCEPTED' || invitation.status === 'REVOKED'}
                            onClick={() => setRevokeTarget(invitation)}
                          >
                            Revoke
                          </Button>
                        </div>
                      </td>
                    </tr>
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

      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title="Revoke this invitation?"
        description={revokeTarget ? `${revokeTarget.fullName} · ${revokeTarget.email}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={revokeMutation.isPending}
              onClick={() => {
                if (revokeTarget) revokeMutation.mutate(revokeTarget.id);
              }}
            >
              Revoke invitation
            </Button>
          </>
        }
      >
        <Alert tone="danger">
          The setup link stops working immediately and the not-yet-activated account is set to Inactive. The person must
          be invited again.
        </Alert>
      </Modal>
    </Card>
  );
};

// ------------------------------------------------------- registrations panel

const RegistrationsPanel: React.FC = () => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['admin', 'registrations'],
    queryFn: () => api.get<UserListItem[]>('/admin/registrations'),
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => api.post<{ id: string; organisationConfirmed: boolean }>(`/admin/registrations/${id}/confirm`),
    onSuccess: () => {
      toast.success('Organisation details confirmed', 'The employee can now submit KPIs (FR-ORG-09).');
      queryClient.invalidateQueries({ queryKey: ['admin', 'registrations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error('Could not confirm the registration', messageOf(error)),
  });

  return (
    <Card>
      <CardHeader
        title="New registrations"
        subtitle="Self-registered users whose organisation details are not confirmed yet (FR-ORG-09). A confirmed record is required before the first submission."
      />

      {query.isError ? (
        <ErrorState message={messageOf(query.error)} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : !query.data?.length ? (
        <EmptyState
          title="No registrations waiting"
          description="Every self-registered employee has confirmed organisation details."
        />
      ) : (
        <ul className="divide-y divide-edge/70">
          {query.data.map((user) => (
            <li key={user.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-body font-semibold text-ink">
                  {user.fullName}
                  <Badge tone="warning">Organisation not confirmed</Badge>
                </p>
                <p className="mt-0.5 text-caption text-ink-secondary">
                  <span className="anwar-mono">{user.employeeCode}</span> · {user.email} ·{' '}
                  {user.businessUnit?.name ?? '—'} · {user.department?.name ?? '—'}
                </p>
                <p className="text-[11px] text-ink-muted">
                  Roles: {user.roles.map((role) => roleLabel(role.code)).join(', ') || '—'}
                </p>
              </div>
              <Button
                size="sm"
                loading={confirmMutation.isPending && confirmMutation.variables === user.id}
                onClick={() => confirmMutation.mutate(user.id)}
              >
                Confirm details
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

// ------------------------------------------------------------ bulk import

interface BulkImportRow {
  fullName: string;
  email: string;
  employeeCode: string;
  businessUnitCode: string;
  departmentName: string;
  roleCode: string;
  designationTitle: string;
}

interface BulkImportResult {
  created: number;
  skipped: number;
  errors: Array<{ row: number; field: string; message: string }>;
}

const TEMPLATE_HEADER = [
  'fullName',
  'email',
  'employeeCode',
  'businessUnitCode',
  'departmentName',
  'roleCode',
  'designationTitle',
];

const CSV_TEMPLATE = `${TEMPLATE_HEADER.join(',')}
Rahim Uddin,rahim.uddin@anwargroup.net,AGL-1042,AGL,Garments Marketing,EMPLOYEE,Senior Officer
Ferdous Ara,ferdous.ara@anwargroup.net,AGL-1043,AGL,Corporate HR,HR_ADMIN,Deputy Manager`;

/** Minimal RFC-4180 CSV reader — quoted fields, escaped quotes, CRLF. */
const parseCsvText = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
      started = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
      started = true;
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      started = false;
    } else if (char === '\r') {
      /* handled by the \n branch */
    } else {
      field += char;
      started = true;
    }
  }
  if (started || field.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ''));
};

const mapBulkRows = (table: string[][]): { rows: BulkImportRow[]; error: string | null } => {
  if (table.length < 2) return { rows: [], error: 'Add a header row and at least one data row.' };
  const header = table[0].map((cell) => cell.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const find = (names: string[]): number => {
    for (const name of names) {
      const index = header.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  };
  const columns = {
    fullName: find(['fullname', 'name']),
    email: find(['email', 'companyemail']),
    employeeCode: find(['employeecode', 'employeeid', 'empid']),
    businessUnitCode: find(['businessunitcode', 'businessunit', 'bu', 'bucode']),
    departmentName: find(['departmentname', 'department', 'dept']),
    roleCode: find(['rolecode', 'role']),
    designationTitle: find(['designationtitle', 'designation']),
  };
  if (columns.fullName < 0 || columns.email < 0 || columns.employeeCode < 0 || columns.businessUnitCode < 0 || columns.departmentName < 0) {
    return {
      rows: [],
      error: 'The header must include fullName, email, employeeCode, businessUnitCode and departmentName.',
    };
  }
  const pick = (cells: string[], index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
  const rows = table
    .slice(1)
    .map((cells) => ({
      fullName: pick(cells, columns.fullName),
      email: pick(cells, columns.email),
      employeeCode: pick(cells, columns.employeeCode),
      businessUnitCode: pick(cells, columns.businessUnitCode),
      departmentName: pick(cells, columns.departmentName),
      roleCode: pick(cells, columns.roleCode) || 'EMPLOYEE',
      designationTitle: pick(cells, columns.designationTitle),
    }))
    .filter((entry) => entry.fullName || entry.email || entry.employeeCode);
  if (!rows.length) return { rows: [], error: 'No data rows were found after the header.' };
  return { rows, error: null };
};

const BulkImportPanel: React.FC = () => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [csvText, setCsvText] = React.useState('');
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<BulkImportRow[]>([]);
  const [result, setResult] = React.useState<BulkImportResult | null>(null);

  const applyText = (text: string, source: string | null) => {
    setCsvText(text);
    setFileName(source);
    setResult(null);
    if (!text.trim()) {
      setRows([]);
      setParseError(null);
      return;
    }
    const parsed = mapBulkRows(parseCsvText(text));
    setRows(parsed.rows);
    setParseError(parsed.error);
  };

  const importMutation = useMutation({
    mutationFn: (payload: BulkImportRow[]) => api.post<BulkImportResult>('/admin/users/bulk-import', { rows: payload }),
    onSuccess: (report) => {
      setResult(report);
      if (report.created > 0) {
        toast.success(
          `${report.created} user${report.created === 1 ? '' : 's'} imported`,
          `${report.skipped} skipped · ${report.errors.length} row error${report.errors.length === 1 ? '' : 's'}.`,
        );
        queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'registrations'] });
      } else {
        toast.warning('No users were imported', `${report.skipped} skipped · ${report.errors.length} row errors.`);
      }
    },
    onError: (error) => toast.error('The bulk import failed', messageOf(error)),
  });

  const downloadTemplate = () => {
    saveBlob(new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' }), 'user-bulk-import-template.csv');
    toast.success('CSV template downloaded', 'Fill it in and import it back as CSV.');
  };

  return (
    <Card>
      <CardHeader
        title="Bulk user import"
        subtitle="FR-ORG-07 — create many users from a CSV file. Imported users start as Pending activation and no invitation e-mail is sent."
        actions={
          <Button size="sm" variant="secondary" onClick={downloadTemplate}>
            Download CSV template
          </Button>
        }
      />

      <Alert tone="info" className="mb-4" title="Expected columns">
        <p className="anwar-mono text-[12px]">{TEMPLATE_HEADER.join(', ')}</p>
        <p className="mt-1">
          The business unit is matched by <strong>code</strong> and the department by name inside that unit. Role codes
          are {ROLE_CODES.join(', ')}; when omitted the row defaults to EMPLOYEE.
        </p>
      </Alert>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => applyText(String(reader.result ?? ''), file.name);
            reader.onerror = () => setParseError('The file could not be read.');
            reader.readAsText(file);
            event.target.value = '';
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
          Choose CSV file
        </Button>
        {fileName ? <span className="text-caption text-ink-secondary">{fileName}</span> : null}
        {csvText ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              applyText('', null);
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      <Field
        label="CSV content"
        htmlFor="bulk-csv"
        hint="Paste the rows here or upload a file above."
        error={parseError}
      >
        <Textarea
          id="bulk-csv"
          value={csvText}
          rows={8}
          className="anwar-mono"
          placeholder={TEMPLATE_HEADER.join(',')}
          onChange={(event) => applyText(event.target.value, fileName)}
          invalid={Boolean(parseError)}
        />
      </Field>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-ink-secondary">
          {rows.length ? `${rows.length} row${rows.length === 1 ? '' : 's'} ready to import.` : 'No rows parsed yet.'}
        </p>
        <Button
          loading={importMutation.isPending}
          disabled={rows.length === 0 || Boolean(parseError)}
          onClick={() => importMutation.mutate(rows)}
        >
          Import {rows.length ? `${rows.length} row${rows.length === 1 ? '' : 's'}` : ''}
        </Button>
      </div>

      {rows.length ? (
        <div className="mt-4 max-h-64 overflow-x-auto rounded-control border border-edge">
          <table className="anwar-table sticky-first-col">
            <thead>
              <tr>
                <th>#</th>
                <th>Full name</th>
                <th>E-mail</th>
                <th>Employee ID</th>
                <th>BU code</th>
                <th>Department</th>
                <th>Role</th>
                <th>Designation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.employeeCode}-${index}`}>
                  <td className="tnum">{index + 1}</td>
                  <td>{row.fullName || <span className="text-danger">missing</span>}</td>
                  <td>{row.email}</td>
                  <td className="anwar-mono">{row.employeeCode}</td>
                  <td className="anwar-mono">{row.businessUnitCode}</td>
                  <td>{row.departmentName}</td>
                  <td>{row.roleCode}</td>
                  <td>{row.designationTitle || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 border-t border-edge pt-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge tone="success">{result.created} created</Badge>
            <Badge tone="neutral">{result.skipped} skipped</Badge>
            <Badge tone={result.errors.length ? 'danger' : 'neutral'}>{result.errors.length} errors</Badge>
          </div>
          {result.errors.length ? (
            <div className="overflow-x-auto rounded-control border border-edge">
              <table className="anwar-table sticky-first-col">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Field</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((error, index) => (
                    <tr key={`${error.row}-${error.field}-${index}`}>
                      <td className="tnum">{error.row}</td>
                      <td className="anwar-mono">{error.field}</td>
                      <td>{error.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-caption text-success">Every row passed validation.</p>
          )}
        </div>
      ) : null}
    </Card>
  );
};

// ------------------------------------------------------------- delegations

const DelegationsPanel: React.FC = () => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, hasRole } = useAuth();
  const canManage = hasRole('DEPT_HEAD', 'SUPER_ADMIN');

  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(25);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<DelegationItem | null>(null);

  const delegationsQuery = useQuery({
    queryKey: ['admin', 'delegations', { page, size }],
    queryFn: () => api.get<Paginated<DelegationItem>>('/admin/delegations', { page, size }),
    placeholderData: keepPreviousData,
    enabled: canManage,
  });

  const { data: businessUnits } = useBusinessUnits();
  const [businessUnitId, setBusinessUnitId] = React.useState('');
  const { data: departments } = useDepartments(businessUnitId);
  const [departmentId, setDepartmentId] = React.useState('');
  const [toUserId, setToUserId] = React.useState('');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [reason, setReason] = React.useState('');

  const headsQuery = useQuery({
    queryKey: ['admin', 'users', 'dept-heads', departmentId],
    queryFn: () => api.get<Paginated<UserListItem>>('/admin/users', { departmentId, roleCode: 'DEPT_HEAD', size: 100 }),
    enabled: Boolean(departmentId),
  });

  React.useEffect(() => {
    if (createOpen) {
      setBusinessUnitId('');
      setDepartmentId('');
      setToUserId('');
      setStartDate('');
      setEndDate('');
      setReason('');
    }
  }, [createOpen]);

  const createMutation = useMutation({
    mutationFn: (payload: {
      toUserId: string;
      departmentId: string;
      startDate: string;
      endDate: string;
      reason: string;
    }) => api.post<unknown>('/admin/delegations', payload),
    onSuccess: () => {
      toast.success('Delegation created', 'Approval rights are shared for the chosen dates.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'delegations'] });
      setCreateOpen(false);
    },
    onError: (error) => toast.error('Could not create the delegation', messageOf(error)),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete<{ message: string }>(`/admin/delegations/${id}`),
    onSuccess: (data) => {
      toast.success('Delegation revoked', data.message);
      setRevokeTarget(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'delegations'] });
    },
    onError: (error) => toast.error('Could not revoke the delegation', messageOf(error)),
  });

  const datesValid =
    Boolean(startDate && endDate) && new Date(endDate).getTime() >= new Date(startDate).getTime();
  const canSubmit = Boolean(departmentId && toUserId) && datesValid;

  return (
    <Card>
      <CardHeader
        title="Approver delegation"
        subtitle="FR-ORG-08 — a Department Head can delegate approvals to another active Department Head of the same department while away."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              New delegation
            </Button>
          ) : null
        }
      />

      {!canManage ? (
        <Alert tone="info">
          Only a Department Head or a Super Admin can create or list delegations. HR Admin has read-only access to the
          rest of this screen.
        </Alert>
      ) : delegationsQuery.isError ? (
        <ErrorState message={messageOf(delegationsQuery.error)} onRetry={() => void delegationsQuery.refetch()} />
      ) : delegationsQuery.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : !delegationsQuery.data?.items.length ? (
        <EmptyState
          title="No delegations yet"
          description="Create a delegation to share approval rights for a date range."
        />
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="anwar-table sticky-first-col">
              <thead>
                <tr>
                  <th>From → To</th>
                  <th>Department</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {delegationsQuery.data.items.map((delegation) => (
                  <tr key={delegation.id}>
                    <td>
                      <span className="font-semibold text-ink">{delegation.fromUser.fullName}</span>
                      <span className="text-ink-muted"> → </span>
                      <span className="font-semibold text-ink">{delegation.toUser.fullName}</span>
                    </td>
                    <td>{delegation.department?.name ?? '—'}</td>
                    <td>{formatDate(delegation.startDate)}</td>
                    <td>{formatDate(delegation.endDate)}</td>
                    <td className="max-w-[240px] truncate" title={delegation.reason ?? undefined}>
                      {delegation.reason ?? '—'}
                    </td>
                    <td>
                      <Badge tone={delegation.isActive ? 'success' : 'neutral'}>
                        {delegation.isActive ? 'Active' : 'Revoked'}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!delegation.isActive}
                        onClick={() => setRevokeTarget(delegation)}
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={delegationsQuery.data.page}
            size={delegationsQuery.data.size}
            total={delegationsQuery.data.total}
            totalPages={delegationsQuery.data.totalPages}
            onPage={setPage}
            onSize={(next) => {
              setSize(next);
              setPage(1);
            }}
          />
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New approver delegation"
        description="Both people must be active Department Heads of the selected department."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createMutation.isPending}
              disabled={!canSubmit}
              onClick={() => {
                if (!canSubmit) return;
                createMutation.mutate({
                  toUserId,
                  departmentId,
                  startDate,
                  endDate,
                  reason: reason.trim(),
                });
              }}
            >
              Create delegation
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Business unit" htmlFor="delegation-bu" required>
            <Select
              id="delegation-bu"
              value={businessUnitId}
              onChange={(event) => {
                setBusinessUnitId(event.target.value);
                setDepartmentId('');
                setToUserId('');
              }}
            >
              <option value="">Select a business unit…</option>
              {(businessUnits ?? []).map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.code} · {unit.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Department" htmlFor="delegation-dept" required>
            <Select
              id="delegation-dept"
              value={departmentId}
              disabled={!businessUnitId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setToUserId('');
              }}
            >
              <option value="">{businessUnitId ? 'Select a department…' : 'Select a business unit first'}</option>
              {(departments ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.code} · {department.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Delegate to"
            htmlFor="delegation-to"
            required
            hint="Active Department Heads of the selected department only."
          >
            <Select id="delegation-to" value={toUserId} disabled={!departmentId} onChange={(event) => setToUserId(event.target.value)}>
              <option value="">{departmentId ? 'Select a colleague…' : 'Select a department first'}</option>
              {(headsQuery.data?.items ?? [])
                .filter((head) => head.id !== user?.id)
                .map((head) => (
                  <option key={head.id} value={head.id}>
                    {head.fullName} · {head.employeeCode}
                  </option>
                ))}
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start date" htmlFor="delegation-start" required>
              <Input
                id="delegation-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label="End date" htmlFor="delegation-end" required error={!datesValid && startDate && endDate ? 'End date must be on or after the start date.' : null}>
              <Input id="delegation-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </Field>
          </div>

          <Field label="Reason" htmlFor="delegation-reason" hint="Optional — recorded in the audit trail.">
            <Textarea
              id="delegation-reason"
              value={reason}
              rows={2}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>

          <Alert tone="info">
            The colleague can approve KPIs of this department for the chosen dates. Revoke at any time to end it early.
          </Alert>
        </div>
      </Modal>

      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title="Revoke this delegation?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={revokeMutation.isPending}
              onClick={() => {
                if (revokeTarget) revokeMutation.mutate(revokeTarget.id);
              }}
            >
              Revoke delegation
            </Button>
          </>
        }
      >
        {revokeTarget ? (
          <Alert tone="danger">
            {revokeTarget.toUser.fullName} loses the delegated approval rights for {revokeTarget.department?.name}{' '}
            immediately. The revocation is audited.
          </Alert>
        ) : null}
      </Modal>
    </Card>
  );
};

// ---------------------------------------------------------------- main page

const UsersAdminPage: React.FC = () => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<Tab>('users');

  // ---------------------------------------------------------------- users tab
  const [buFilter, setBuFilter] = React.useState('');
  const [deptFilter, setDeptFilter] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [searchTerm, setSearchTerm] = React.useState('');
  const search = useDebounced(searchTerm, 300);
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(25);

  const { data: businessUnits } = useBusinessUnits();
  const { data: filterDepartments } = useDepartments(buFilter);

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', { page, size, buFilter, deptFilter, roleFilter, statusFilter, search }],
    queryFn: () =>
      api.get<Paginated<UserListItem>>('/admin/users', {
        page,
        size,
        businessUnitId: buFilter || undefined,
        departmentId: deptFilter || undefined,
        roleCode: roleFilter || undefined,
        status: statusFilter || undefined,
        search: search.trim() || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserListItem | null>(null);
  const [transferTarget, setTransferTarget] = React.useState<UserListItem | null>(null);
  const [roleTarget, setRoleTarget] = React.useState<{ user: UserListItem; initial: RoleCode[] } | null>(null);
  const [deactivateTarget, setDeactivateTarget] = React.useState<UserListItem | null>(null);
  const [reactivateTarget, setReactivateTarget] = React.useState<UserListItem | null>(null);

  const openExistingMutation = useMutation({
    mutationFn: (payload: { userId: string; roleCode: RoleCode }) =>
      api.get<UserListItem>(`/admin/users/${payload.userId}`),
    onSuccess: (found, variables) => {
      setRoleTarget({ user: found, initial: [variables.roleCode] });
    },
    onError: (error) => toast.error('Could not load the existing user', messageOf(error)),
  });

  const deactivateMutation = useMutation({
    mutationFn: (payload: { id: string; reason: string }) =>
      api.post<{ id: string; cancelledDraftKpis: number; message: string }>(`/admin/users/${payload.id}/deactivate`, {
        reason: payload.reason,
      }),
    onSuccess: (data) => {
      toast.success('Account deactivated', `${data.message} ${data.cancelledDraftKpis} draft KPI(s) cancelled.`);
      setDeactivateTarget(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => {
      // FR-ORG-05 / EC-17 — "last active approver" and similar 409s verbatim.
      toast.error('Could not deactivate the account', messageOf(error));
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => api.post<UserListItem>(`/admin/users/${id}/reactivate`),
    onSuccess: () => {
      toast.success('Account reactivated', 'The user can sign in again.');
      setReactivateTarget(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error('Could not reactivate the account', messageOf(error)),
  });

  const data = usersQuery.data;

  const resetPage = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Users & access"
        subtitle="M03 — maintain the user directory, organisation mapping, roles, invitations, registrations, bulk import and approver delegation."
        actions={
          <Button
            onClick={() => setInviteOpen(true)}
            iconLeft={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
          >
            Invite user
          </Button>
        }
      />

      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          items={[
            { key: 'users', label: 'Users' },
            { key: 'invitations', label: 'Invitations' },
            { key: 'registrations', label: 'New registrations' },
            { key: 'import', label: 'Bulk import' },
            { key: 'delegations', label: 'Delegations' },
          ]}
          value={tab}
          onChange={(key) => setTab(key as Tab)}
          ariaLabel="User administration sections"
        />
      </div>

      {tab === 'users' ? (
        <Card>
          <CardHeader
            title="User directory"
            subtitle="Server-paged at 25 / 50 / 100 rows. Search matches name, e-mail and Employee ID."
          />

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Business unit" htmlFor="users-bu-filter">
              <Select
                id="users-bu-filter"
                value={buFilter}
                onChange={(event) => {
                  setBuFilter(event.target.value);
                  setDeptFilter('');
                  resetPage();
                }}
              >
                <option value="">All business units</option>
                {(businessUnits ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} · {unit.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Department" htmlFor="users-dept-filter" hint="Filtered by the chosen business unit.">
              <Select
                id="users-dept-filter"
                value={deptFilter}
                onChange={(event) => {
                  setDeptFilter(event.target.value);
                  resetPage();
                }}
              >
                <option value="">All departments</option>
                {(filterDepartments ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Role" htmlFor="users-role-filter">
              <Select
                id="users-role-filter"
                value={roleFilter}
                onChange={(event) => {
                  setRoleFilter(event.target.value);
                  resetPage();
                }}
              >
                <option value="">All roles</option>
                {ROLE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {ROLE_LABELS[code]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Status" htmlFor="users-status-filter">
              <Select
                id="users-status-filter"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  resetPage();
                }}
              >
                <option value="">All statuses</option>
                {Object.entries(USER_STATUS_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Search" htmlFor="users-search">
              <Input
                id="users-search"
                type="search"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  resetPage();
                }}
                placeholder="Name, e-mail or Employee ID…"
              />
            </Field>
          </div>

          {usersQuery.isError ? (
            <ErrorState message={messageOf(usersQuery.error)} onRetry={() => void usersQuery.refetch()} />
          ) : usersQuery.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : !data?.items.length ? (
            <EmptyState
              title="No users match your filters"
              description="Adjust the filters or invite a new user."
              action={
                <Button variant="secondary" onClick={() => setInviteOpen(true)}>
                  Invite user
                </Button>
              }
            />
          ) : (
            <>
              <div className="-mx-4 overflow-x-auto sm:mx-0">
                <table className="anwar-table sticky-first-col">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Designation</th>
                      <th>Business unit</th>
                      <th>Department</th>
                      <th>Roles</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <p className="font-semibold text-ink">{user.fullName}</p>
                          <p className="text-caption text-ink-secondary">
                            <span className="anwar-mono">{user.employeeCode}</span> · {user.email}
                          </p>
                          {!user.organisationConfirmed ? (
                            <Badge tone="warning" className="mt-1">
                              Organisation not confirmed
                            </Badge>
                          ) : null}
                        </td>
                        <td>{user.designationTitle ?? '—'}</td>
                        <td>{user.businessUnit?.name ?? '—'}</td>
                        <td>{user.department?.name ?? '—'}</td>
                        <td>
                          <RoleBadges roles={user.roles} />
                        </td>
                        <td>
                          <Badge tone={userStatusTone(user.status)}>
                            {USER_STATUS_LABELS[user.status] ?? titleCase(user.status)}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="secondary" onClick={() => setEditing(user)}>
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setTransferTarget(user)}>
                              Transfer
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setRoleTarget({ user, initial: [] })}
                            >
                              Roles
                            </Button>
                            {user.status === 'INACTIVE' ? (
                              <Button size="sm" variant="ghost" onClick={() => setReactivateTarget(user)}>
                                Reactivate
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => setDeactivateTarget(user)}>
                                Deactivate
                              </Button>
                            )}
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
      ) : tab === 'invitations' ? (
        <InvitationsPanel />
      ) : tab === 'registrations' ? (
        <RegistrationsPanel />
      ) : tab === 'import' ? (
        <BulkImportPanel />
      ) : (
        <DelegationsPanel />
      )}

      <InviteDrawer
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onExistingUser={(userId, roleCode) => openExistingMutation.mutate({ userId, roleCode })}
      />

      <EditUserDrawer user={editing} onClose={() => setEditing(null)} />
      <TransferModal user={transferTarget} onClose={() => setTransferTarget(null)} />
      <AssignRolesModal target={roleTarget} onClose={() => setRoleTarget(null)} />

      <ReasonModal
        open={Boolean(deactivateTarget)}
        title="Deactivate this account?"
        description={deactivateTarget ? `${deactivateTarget.fullName} · ${deactivateTarget.employeeCode}` : undefined}
        impact={
          <>
            The account is set to Inactive, every session is signed out and the user&apos;s Draft KPIs are cancelled
            (leaver flow, EC-04). Approved and submitted KPIs are untouched. Deactivation is blocked when this is the
            last active approver of a department that still has employees (FR-ORG-05).
          </>
        }
        confirmLabel="Deactivate account"
        loading={deactivateMutation.isPending}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={(reason) => {
          if (deactivateTarget) deactivateMutation.mutate({ id: deactivateTarget.id, reason });
        }}
      />

      <Modal
        open={Boolean(reactivateTarget)}
        onClose={() => setReactivateTarget(null)}
        title="Reactivate this account?"
        description={reactivateTarget ? `${reactivateTarget.fullName} · ${reactivateTarget.employeeCode}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReactivateTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={reactivateMutation.isPending}
              onClick={() => {
                if (reactivateTarget) reactivateMutation.mutate(reactivateTarget.id);
              }}
            >
              Reactivate
            </Button>
          </>
        }
      >
        <Alert tone="info">
          The user can sign in again and the approver assignment is restored when they still hold the Department Head
          role. The action is recorded in the audit trail.
        </Alert>
      </Modal>
    </>
  );
};

export default UsersAdminPage;
