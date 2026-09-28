import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import type { BusinessUnitItem, DepartmentItem } from '@/lib/types';
import { Alert } from '@/components/ui/badges';
import { Button, Card, Field, Input, Select } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { AuthShell } from './LoginPage';

/**
 * FR-AUTH-01..04 / UC-01 — self-registration.
 *
 * Business units and departments come from the PUBLIC organisation endpoints,
 * and the department list is reloaded and reset whenever the business unit
 * changes (the BU → Department relationship is mandatory).
 */

const COMPANY_EMAIL = /^[a-z0-9._%+-]+@anwargroup\.net$/i;

interface RegisterResponse {
  status: string;
  message: string;
  userId?: string;
}

interface RegisterPayload {
  fullName: string;
  email: string;
  employeeCode: string;
  businessUnitId: string;
  departmentId: string;
  designationTitle?: string;
}

interface FormErrors {
  fullName?: string;
  email?: string;
  employeeCode?: string;
  businessUnitId?: string;
  departmentId?: string;
}

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();

  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [employeeCode, setEmployeeCode] = React.useState('');
  const [businessUnitId, setBusinessUnitId] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');
  const [designationTitle, setDesignationTitle] = React.useState('');
  const [clientErrors, setClientErrors] = React.useState<FormErrors>({});
  const [apiError, setApiError] = React.useState<ApiError | null>(null);
  const [result, setResult] = React.useState<RegisterResponse | null>(null);

  const unitsQuery = useQuery({
    queryKey: ['organisation', 'public', 'business-units'],
    queryFn: () => api.get<BusinessUnitItem[]>('/organisation/public/business-units'),
    staleTime: 10 * 60_000,
  });

  const departmentsQuery = useQuery({
    queryKey: ['organisation', 'public', 'departments', businessUnitId],
    queryFn: () => api.get<DepartmentItem[]>('/organisation/public/departments', { businessUnitId }),
    enabled: businessUnitId.length > 0,
    staleTime: 10 * 60_000,
  });

  const units = unitsQuery.data ?? [];
  const departments = departmentsQuery.data ?? [];

  const registerMutation = useMutation({
    mutationFn: (payload: RegisterPayload) => api.post<RegisterResponse>('/auth/register', payload),
    onSuccess: (response) => setResult(response),
    onError: (error) => {
      const next =
        error instanceof ApiError
          ? error
          : new ApiError(0, undefined, 'Registration could not be completed. Please try again.');
      setApiError(next);
      toast.error('Registration could not be completed', next.message);
    },
  });

  /** BU → Department: the dependent list refetches and the selection resets. */
  const changeBusinessUnit = (value: string) => {
    setBusinessUnitId(value);
    setDepartmentId('');
    setClientErrors((current) => ({ ...current, businessUnitId: undefined, departmentId: undefined }));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: FormErrors = {};
    if (!fullName.trim()) next.fullName = 'Full name is required.';
    if (!email.trim()) next.email = 'Company e-mail is required.';
    else if (!COMPANY_EMAIL.test(email.trim())) next.email = 'Please use your official @anwargroup.net e-mail address.';
    if (!employeeCode.trim()) next.employeeCode = 'Employee ID is required.';
    if (!businessUnitId) next.businessUnitId = 'Select your business unit.';
    if (!departmentId) next.departmentId = 'Select your department.';
    setClientErrors(next);
    setApiError(null);
    if (Object.keys(next).length > 0) return;
    registerMutation.mutate({
      fullName: fullName.trim(),
      email: email.trim(),
      employeeCode: employeeCode.trim(),
      businessUnitId,
      departmentId,
      ...(designationTitle.trim() ? { designationTitle: designationTitle.trim() } : {}),
    });
  };

  if (result) {
    return (
      <AuthShell maxWidth="max-w-[520px]">
        <Card className="text-center shadow-raised">
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-tint text-success"
            aria-hidden="true"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-h2 text-navy-900">Registration received</h1>
          <p className="mt-2 text-body text-ink-secondary">{result.message}</p>
          <p className="mt-2 text-caption text-ink-muted">
            Your account stays pending until you open the single-use setup link in your company inbox and create a
            password.
          </p>
          <Button block className="mt-5" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell maxWidth="max-w-[520px]">
      <Card className="shadow-raised">
        <h1 className="text-h1 text-navy-900">Create your account</h1>
        <p className="mt-1 text-body text-ink-secondary">
          Self-registration is open to Anwar Group employees with a company e-mail address.
        </p>

        {apiError ? (
          <Alert tone="danger" className="mt-4">
            {apiError.message}
          </Alert>
        ) : null}
        {unitsQuery.isError ? (
          <Alert
            tone="danger"
            className="mt-4"
            actions={
              <Button size="sm" variant="secondary" onClick={() => void unitsQuery.refetch()}>
                Retry
              </Button>
            }
          >
            The business unit list could not be loaded.
          </Alert>
        ) : null}
        {departmentsQuery.isError && businessUnitId ? (
          <Alert
            tone="danger"
            className="mt-4"
            actions={
              <Button size="sm" variant="secondary" onClick={() => void departmentsQuery.refetch()}>
                Retry
              </Button>
            }
          >
            The department list for the selected business unit could not be loaded.
          </Alert>
        ) : null}

        <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
          <Field label="Full Name" htmlFor="register-name" required error={clientErrors.fullName ?? apiError?.fieldError('fullName')}>
            <Input
              id="register-name"
              name="fullName"
              autoComplete="name"
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              invalid={Boolean(clientErrors.fullName ?? apiError?.fieldError('fullName'))}
            />
          </Field>

          <Field
            label="Company Email"
            htmlFor="register-email"
            required
            hint="Only @anwargroup.net addresses can self-register."
            error={clientErrors.email ?? apiError?.fieldError('email')}
          >
            <Input
              id="register-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@anwargroup.net"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              invalid={Boolean(clientErrors.email ?? apiError?.fieldError('email'))}
            />
          </Field>

          <Field label="Employee ID" htmlFor="register-employee-code" required error={clientErrors.employeeCode ?? apiError?.fieldError('employeeCode')}>
            <Input
              id="register-employee-code"
              name="employeeCode"
              required
              value={employeeCode}
              onChange={(event) => setEmployeeCode(event.target.value)}
              invalid={Boolean(clientErrors.employeeCode ?? apiError?.fieldError('employeeCode'))}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business Unit" htmlFor="register-business-unit" required error={clientErrors.businessUnitId ?? apiError?.fieldError('businessUnitId')}>
              <Select
                id="register-business-unit"
                name="businessUnitId"
                required
                value={businessUnitId}
                onChange={(event) => changeBusinessUnit(event.target.value)}
                disabled={unitsQuery.isPending}
                invalid={Boolean(clientErrors.businessUnitId ?? apiError?.fieldError('businessUnitId'))}
              >
                <option value="">{unitsQuery.isPending ? 'Loading business units…' : 'Select a business unit'}</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Department"
              htmlFor="register-department"
              required
              hint={businessUnitId ? undefined : 'Choose a business unit first.'}
              error={clientErrors.departmentId ?? apiError?.fieldError('departmentId')}
            >
              <Select
                id="register-department"
                name="departmentId"
                required
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                disabled={!businessUnitId || departmentsQuery.isPending}
                invalid={Boolean(clientErrors.departmentId ?? apiError?.fieldError('departmentId'))}
              >
                <option value="">
                  {!businessUnitId
                    ? 'Select a business unit first'
                    : departmentsQuery.isPending
                      ? 'Loading departments…'
                      : 'Select your department'}
                </option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Designation" htmlFor="register-designation" hint="Optional — e.g. Senior Executive, Finance.">
            <Input
              id="register-designation"
              name="designationTitle"
              value={designationTitle}
              onChange={(event) => setDesignationTitle(event.target.value)}
            />
          </Field>

          <Button type="submit" block loading={registerMutation.isPending}>
            Create account
          </Button>
        </form>

        <p className="mt-5 text-center text-body text-ink-secondary">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-navy-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </AuthShell>
  );
};

export default RegisterPage;
