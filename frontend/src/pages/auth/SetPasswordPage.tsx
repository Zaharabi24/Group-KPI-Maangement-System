import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { Alert } from '@/components/ui/badges';
import {
  Button,
  Card,
  DataRow,
  ErrorState,
  Field,
  Input,
  PasswordInput,
  Skeleton,
  cn,
} from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { AuthShell } from './LoginPage';

/**
 * FR-AUTH-05 / FR-AUTH-06 / FR-AUTH-09 / AC-02 — Set Password and Reset Password.
 *
 * The setup token is inspected before anything is rendered, the live checklist
 * mirrors the server policy, and every password field carries its own eye
 * toggle (PasswordInput keeps `aria-pressed` in sync — AC-02).
 */

export interface TokenInspection {
  valid: boolean;
  type?: 'ACTIVATION' | 'INVITATION' | 'PASSWORD_RESET' | null;
  email?: string | null;
  fullName?: string | null;
  readOnly?: { roleLabel?: string | null; businessUnit?: string | null; department?: string | null } | null;
  expired?: boolean;
  used?: boolean;
}

export interface PasswordCheck {
  key: string;
  label: string;
  met: boolean;
}

/** Client mirror of the server's `evaluatePasswordPolicy` (FR-AUTH-05). */
export const evaluatePasswordChecks = (
  password: string,
  email?: string | null,
  confirmPassword?: string | null,
): PasswordCheck[] => {
  const local = (email ?? '').split('@')[0]?.trim().toLowerCase() ?? '';
  const checks: PasswordCheck[] = [
    { key: 'length', label: '10–64 characters', met: password.length >= 10 && password.length <= 64 },
    { key: 'upper', label: 'At least one upper-case letter', met: /[A-Z]/.test(password) },
    { key: 'lower', label: 'At least one lower-case letter', met: /[a-z]/.test(password) },
    { key: 'digit', label: 'At least one digit', met: /[0-9]/.test(password) },
    { key: 'symbol', label: 'At least one symbol', met: /[^A-Za-z0-9\s]/.test(password) },
    {
      key: 'noEmailName',
      label: 'Must not contain your e-mail name',
      // Short local parts (such as "hr") are ignored to avoid over-matching.
      met: local.length < 4 ? true : !password.toLowerCase().includes(local),
    },
  ];
  if (confirmPassword !== undefined && confirmPassword !== null) {
    checks.push({
      key: 'match',
      label: 'Both passwords match',
      met: password.length > 0 && password === confirmPassword,
    });
  }
  return checks;
};

/** Live policy checklist — a green check when met, a grey dot when outstanding. */
export const PasswordChecklist: React.FC<{
  password: string;
  email?: string | null;
  confirmPassword?: string | null;
  className?: string;
}> = ({ password, email, confirmPassword, className }) => (
  <ul className={cn('space-y-1.5', className)} aria-label="Password requirements">
    {evaluatePasswordChecks(password, email, confirmPassword).map((check) => (
      <li key={check.key} className="flex items-start gap-2 text-caption">
        <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
          {check.met ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-success">
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-ink-muted" />
          )}
        </span>
        <span className={check.met ? 'text-success' : 'text-ink-secondary'}>
          {check.label}
          <span className="sr-only">{check.met ? ' — met' : ' — not met yet'}</span>
        </span>
      </li>
    ))}
  </ul>
);

/** FR-AUTH-04 — re-sends the single-use setup link for an expired token. */
const ResendActivationForm: React.FC = () => {
  const [email, setEmail] = React.useState('');
  const [clientError, setClientError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<string | null>(null);
  const [apiError, setApiError] = React.useState<ApiError | null>(null);

  const resendMutation = useMutation({
    mutationFn: (value: string) => api.post<{ message: string }>('/auth/resend-activation', { email: value }),
    onSuccess: (data) => {
      setSent(data.message);
      setApiError(null);
    },
    onError: (error) => {
      setApiError(error instanceof ApiError ? error : new ApiError(0, undefined, 'The request could not be completed.'));
      setSent(null);
    },
  });

  if (sent) {
    return (
      <Alert tone="success" className="mt-4">
        {sent}
      </Alert>
    );
  }

  return (
    <form
      className="mt-4 space-y-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!email.trim()) {
          setClientError('Enter your company e-mail address.');
          return;
        }
        setClientError(null);
        resendMutation.mutate(email.trim());
      }}
    >
      {apiError ? (
        <Alert tone="danger">
          {apiError.message}
        </Alert>
      ) : null}
      <Field label="Company Email" htmlFor="resend-activation-email" required error={clientError ?? apiError?.fieldError('email')}>
        <Input
          id="resend-activation-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="name@anwargroup.net"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          invalid={Boolean(clientError ?? apiError?.fieldError('email'))}
        />
      </Field>
      <Button type="submit" block variant="secondary" loading={resendMutation.isPending}>
        Resend setup link
      </Button>
    </form>
  );
};

const SetupLoading: React.FC = () => (
  <div className="space-y-3" aria-busy="true">
    <Skeleton className="h-6 w-2/3" />
    <Skeleton className="h-4 w-1/2" />
    <Skeleton className="h-10 w-full" />
    <Skeleton className="h-10 w-full" />
    <Skeleton className="h-24 w-full" />
  </div>
);

/**
 * Shared body for `/set-password` (mode "setup") and `/reset-password` (mode
 * "reset"). Both screens inspect the token, mirror the policy and post the
 * matching endpoint; the copy and the fallback differ.
 */
export const PasswordSetupScreen: React.FC<{ mode: 'setup' | 'reset' }> = ({ mode }) => {
  const isReset = mode === 'reset';
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const inspectionQuery = useQuery({
    queryKey: ['auth', 'token', token],
    queryFn: () => api.get<TokenInspection>(`/auth/token/${encodeURIComponent(token)}`),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
  });

  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [apiError, setApiError] = React.useState<ApiError | null>(null);

  const inspection = inspectionQuery.data;
  const email = inspection?.email ?? null;
  const checks = evaluatePasswordChecks(password, email, confirmPassword);
  const ready = checks.every((check) => check.met);

  const saveMutation = useMutation({
    mutationFn: (payload: { token: string; password: string; confirmPassword: string }) =>
      api.post<{ email: string; message: string }>(isReset ? '/auth/reset-password' : '/auth/set-password', payload),
    onSuccess: () => {
      toast.success(isReset ? 'Password reset' : 'Password created', 'Sign in with your new password.');
      navigate('/login?activated=1', { replace: true });
    },
    onError: (error) => {
      const next =
        error instanceof ApiError
          ? error
          : new ApiError(0, undefined, 'The password could not be saved. Please try again.');
      setApiError(next);
      toast.error('Could not save the password', next.message);
    },
  });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApiError(null);
    if (!ready || saveMutation.isPending) return;
    saveMutation.mutate({ token, password, confirmPassword });
  };

  const invalidLink = (() => {
    if (!token) {
      return (
        <>
          <h1 className="text-h1 text-navy-900">This link is not valid</h1>
          <p className="mt-1 text-body text-ink-secondary">
            The address is missing its setup token. Open the link from your e-mail again, or request a new one.
          </p>
          <Link to="/login" className="mt-5 inline-block text-body font-semibold text-navy-600 hover:underline">
            Back to sign in
          </Link>
        </>
      );
    }

    if (inspection?.used) {
      return (
        <>
          <h1 className="text-h1 text-navy-900">Link already used</h1>
          <p className="mt-1 text-body text-ink-secondary">
            This single-use link has already been used. If you have not set a password yet, request a new link or
            contact Group HR.
          </p>
          {!isReset ? <ResendActivationForm /> : null}
          {isReset ? (
            <Button block className="mt-4" onClick={() => navigate('/forgot-password')}>
              Request a new reset link
            </Button>
          ) : null}
          <Link to="/login" className="mt-5 inline-block text-body font-semibold text-navy-600 hover:underline">
            Back to sign in
          </Link>
        </>
      );
    }

    return (
      <>
        <h1 className="text-h1 text-navy-900">Link expired</h1>
        <p className="mt-1 text-body text-ink-secondary">
          {isReset
            ? 'This reset link is no longer valid. Request a new one to continue.'
            : 'This setup link is no longer valid. Request a new one and check your company inbox.'}
        </p>
        {!isReset ? <ResendActivationForm /> : null}
        {isReset ? (
          <Button block className="mt-4" onClick={() => navigate('/forgot-password')}>
            Request a new reset link
          </Button>
        ) : null}
        <Link to="/login" className="mt-5 inline-block text-body font-semibold text-navy-600 hover:underline">
          Back to sign in
        </Link>
      </>
    );
  })();

  const validForm = (
    <>
      <h1 className="text-h1 text-navy-900">{isReset ? 'Choose a new password' : 'Create your password'}</h1>
      <p className="mt-1 text-body text-ink-secondary">
        {isReset
          ? 'Set a new password for your ANWAR KPIFlow account.'
          : 'Set the password that will sign you in to KPIFlow.'}
      </p>

      {isReset ? (
        <Alert tone="info" className="mt-4">
          For your security, all other sessions will be signed out once your password is changed.
        </Alert>
      ) : null}
      {apiError ? (
        <Alert tone="danger" className="mt-4">
          {apiError.message}
        </Alert>
      ) : null}

      {email || inspection?.fullName ? (
        <dl className="mt-4 rounded-control border border-edge bg-canvas px-3 py-1">
          {email ? (
            <DataRow label="Company e-mail" mono>
              {email}
            </DataRow>
          ) : null}
          {inspection?.fullName ? <DataRow label="Full name">{inspection.fullName}</DataRow> : null}
          {inspection?.type === 'INVITATION' && inspection.readOnly?.roleLabel ? (
            <DataRow label="Role">{inspection.readOnly.roleLabel}</DataRow>
          ) : null}
          {inspection?.readOnly?.businessUnit ? (
            <DataRow label="Business unit">{inspection.readOnly.businessUnit}</DataRow>
          ) : null}
          {inspection?.readOnly?.department ? (
            <DataRow label="Department">{inspection.readOnly.department}</DataRow>
          ) : null}
        </dl>
      ) : null}

      <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
        <Field label="New Password" htmlFor="set-password-new" required error={apiError?.fieldError('password')}>
          <PasswordInput
            id="set-password-new"
            name="new-password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={Boolean(apiError?.fieldError('password'))}
          />
        </Field>
        <Field label="Confirm Password" htmlFor="set-password-confirm" required error={apiError?.fieldError('confirmPassword')}>
          <PasswordInput
            id="set-password-confirm"
            name="confirm-password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            invalid={Boolean(apiError?.fieldError('confirmPassword'))}
          />
        </Field>

        <div className="rounded-control border border-edge bg-canvas p-3">
          <p className="mb-2 text-caption font-semibold text-ink-secondary">Password requirements</p>
          <PasswordChecklist password={password} email={email} confirmPassword={confirmPassword} />
        </div>

        <Button type="submit" block loading={saveMutation.isPending} disabled={!ready}>
          {isReset ? 'Reset password' : 'Create Password'}
        </Button>
      </form>

      <p className="mt-5 text-center text-caption text-ink-secondary">
        <Link to="/login" className="font-medium text-navy-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );

  const body = (() => {
    if (inspectionQuery.isError) {
      return (
        <ErrorState
          message="We could not check this link. Check your connection and try again."
          onRetry={() => void inspectionQuery.refetch()}
        />
      );
    }
    if (!token) return <Card className="shadow-raised">{invalidLink}</Card>;
    if (inspectionQuery.isPending) return <Card className="shadow-raised"><SetupLoading /></Card>;
    if (!inspection?.valid) return <Card className="shadow-raised">{invalidLink}</Card>;
    return <Card className="shadow-raised">{validForm}</Card>;
  })();

  return <AuthShell>{body}</AuthShell>;
};

const SetPasswordPage: React.FC = () => <PasswordSetupScreen mode="setup" />;

export default SetPasswordPage;
