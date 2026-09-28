import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Alert } from '@/components/ui/badges';
import { Button, Card, Checkbox, Field, Input, PasswordInput, cn } from '@/components/ui';

/**
 * M01 — Sign in (BRD §11.4 "Login / Register / Set Password").
 *
 * Security cases stay neutral (the API returns the wording), the form submits
 * on Enter, and the collapsed demo panel lets evaluators fill an account in one
 * click. `/login?reason=expired` and `/login?activated=1` render the matching
 * notice above the form.
 */

const DEMO_PASSWORD = 'Anwar@KPI2026';

const DEMO_ACCOUNTS: Array<{ label: string; email: string }> = [
  { label: 'Super Admin', email: 'superadmin@anwargroup.net' },
  { label: 'HR Admin', email: 'hradmin@anwargroup.net' },
  { label: 'Department Head', email: 'kamrul.hasan@anwargroup.net' },
  { label: 'Employee', email: 'rafi.ahmed@anwargroup.net' },
  { label: 'Management Viewer', email: 'management.viewer@anwargroup.net' },
  { label: 'System Admin', email: 'sysadmin@anwargroup.net' },
];

/**
 * Shared navy canvas + ANWAR KPI lock-up used by every public auth screen
 * (login, register, set/reset password, forgot password). Kept here so the auth
 * screens stay visually identical without introducing another component file.
 */
export const AuthShell: React.FC<{ children: React.ReactNode; maxWidth?: string }> = ({
  children,
  maxWidth = 'max-w-[440px]',
}) => (
  <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-900 px-4 py-10">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -top-32 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-navy-700/50 blur-3xl"
    />
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn('relative w-full', maxWidth)}
    >
      <div className="mb-5 flex items-center justify-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-card bg-white/10" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <path
              d="M7 23 L13 11 L18 20 L25 8"
              stroke="#FFFFFF"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
        <span>
          <span className="block text-h2 text-white">ANWAR KPI</span>
          <span className="block text-[11px] uppercase tracking-wider text-navy-200">KPIFlow · Phase 01</span>
        </span>
      </div>

      {children}

      <p className="mt-5 text-center text-caption text-navy-300">
        Internal &amp; Confidential · Anwar Group of Industries
      </p>
    </motion.div>
  </div>
);

const LoginPage: React.FC = () => {
  const { login, home } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const sessionExpired = searchParams.get('reason') === 'expired';
  const activated = searchParams.get('activated') === '1';

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [rememberMe, setRememberMe] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [apiError, setApiError] = React.useState<ApiError | null>(null);

  /** 423 = the account is temporarily locked (FR-AUTH-07) — shown as a warning. */
  const locked = apiError?.status === 423;

  const fillDemoAccount = (account: { email: string }) => {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    setApiError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setApiError(null);
    setSubmitting(true);
    try {
      const result = await login(email.trim(), password, rememberMe);
      if (result.mustConfirmOrganisation) {
        toast.info(
          'Confirm your organisation',
          'Your business unit and department are awaiting confirmation (FR-ORG-09). You can prepare Draft KPIs in the meantime.',
        );
      }
      navigate(result.home || home, { replace: true });
    } catch (error) {
      const next = error instanceof ApiError ? error : new ApiError(0, undefined, 'Sign-in failed. Please try again.');
      setApiError(next);
      if (next.status === 423) toast.warning('Account temporarily locked', next.message);
      else toast.error('Could not sign you in', next.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <Card className="shadow-raised">
        <h1 className="text-h1 text-navy-900">Sign in</h1>
        <p className="mt-1 text-body text-ink-secondary">Use your company e-mail address to continue.</p>

        {activated ? (
          <Alert tone="success" className="mt-4">
            Your password has been created. Sign in with your new password.
          </Alert>
        ) : null}
        {sessionExpired ? (
          <Alert tone="info" className="mt-4">
            Your session ended. Please sign in again.
          </Alert>
        ) : null}
        {apiError ? (
          <Alert
            tone={locked ? 'warning' : 'danger'}
            className="mt-4"
            title={locked ? 'Account temporarily locked' : undefined}
          >
            {apiError.message}
          </Alert>
        ) : null}

        <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
          <Field label="Company Email" htmlFor="login-email" required error={apiError?.fieldError('email')}>
            <Input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@anwargroup.net"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              invalid={Boolean(apiError?.fieldError('email'))}
            />
          </Field>

          <Field label="Password" htmlFor="login-password" required error={apiError?.fieldError('password')}>
            <PasswordInput
              id="login-password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              invalid={Boolean(apiError?.fieldError('password'))}
            />
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Checkbox
              label="Remember me"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            <Link to="/forgot-password" className="text-caption font-medium text-navy-600 hover:underline">
              Forgot password?
            </Link>
          </div>

          <Button type="submit" block loading={submitting}>
            Sign in
          </Button>
        </form>

        <p className="mt-5 text-center text-body text-ink-secondary">
          New to KPIFlow?{' '}
          <Link to="/register" className="font-semibold text-navy-600 hover:underline">
            Create an account
          </Link>
        </p>

        <details className="mt-5 rounded-control border border-edge bg-canvas">
          <summary className="cursor-pointer px-3 py-2 text-caption font-medium text-ink-secondary hover:text-navy-900">
            Demo accounts
          </summary>
          <div className="border-t border-edge p-1.5">
            <p className="px-2 py-1 text-[11px] text-ink-muted">
              Password for every demo account: <span className="anwar-mono">{DEMO_PASSWORD}</span>
            </p>
            <ul className="space-y-0.5">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => fillDemoAccount(account)}
                    className="flex w-full flex-wrap items-center justify-between gap-1 rounded-control px-2 py-1.5 text-left hover:bg-navy-50"
                  >
                    <span className="text-caption font-medium text-ink">{account.label}</span>
                    <span className="truncate text-[11px] text-ink-secondary">{account.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </Card>
    </AuthShell>
  );
};

export default LoginPage;
