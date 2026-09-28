import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { Alert } from '@/components/ui/badges';
import { Button, Card, Field, Input } from '@/components/ui';
import { AuthShell } from './LoginPage';

/**
 * FR-AUTH-08 — forgot password.
 *
 * The endpoint is deliberately neutral, so the confirmation is always the same:
 * "If an account exists for that address, a reset link has been sent." The link
 * is valid for 30 minutes and single-use.
 */

const NEUTRAL_CONFIRMATION = 'If an account exists for that address, a reset link has been sent.';

const ForgotPasswordPage: React.FC = () => {
  const navigate = useNavigate();

  const [email, setEmail] = React.useState('');
  const [clientError, setClientError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState(NEUTRAL_CONFIRMATION);
  const [apiError, setApiError] = React.useState<ApiError | null>(null);

  const forgotMutation = useMutation({
    mutationFn: (value: string) => api.post<{ message: string }>('/auth/forgot-password', { email: value }),
    onSuccess: (data) => {
      setConfirmation(data.message || NEUTRAL_CONFIRMATION);
      setApiError(null);
      setSubmitted(true);
    },
    onError: (error) => {
      // The neutral confirmation is shown regardless of the outcome (FR-AUTH-08).
      setApiError(
        error instanceof ApiError ? error : new ApiError(0, undefined, 'The request could not be completed.'),
      );
      setSubmitted(true);
    },
  });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) {
      setClientError('Enter your company e-mail address.');
      return;
    }
    setClientError(null);
    setApiError(null);
    forgotMutation.mutate(email.trim());
  };

  if (submitted) {
    return (
      <AuthShell>
        <Card className="shadow-raised">
          <div
            className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-info-tint text-info"
            aria-hidden="true"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path d="M3.5 7l8.5 6 8.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-h1 text-navy-900">Check your inbox</h1>
          <p className="mt-2 text-body text-ink-secondary">{confirmation}</p>
          <p className="mt-2 text-caption text-ink-muted">
            For your security the reset link is valid for 30 minutes and can be used once.
          </p>

          {apiError ? (
            <Alert tone={apiError.status === 429 ? 'warning' : 'danger'} className="mt-4">
              {apiError.message}
            </Alert>
          ) : null}

          <Button block className="mt-5" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
          <button
            type="button"
            className="mt-3 w-full text-center text-caption font-medium text-navy-600 hover:underline"
            onClick={() => {
              setSubmitted(false);
              setApiError(null);
            }}
          >
            Use a different e-mail address
          </button>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Card className="shadow-raised">
        <h1 className="text-h1 text-navy-900">Forgot your password?</h1>
        <p className="mt-1 text-body text-ink-secondary">
          Enter your company e-mail address and we will send a single-use reset link.
        </p>

        {apiError ? (
          <Alert tone="danger" className="mt-4">
            {apiError.message}
          </Alert>
        ) : null}

        <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
          <Field label="Company Email" htmlFor="forgot-email" required error={clientError ?? apiError?.fieldError('email')}>
            <Input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@anwargroup.net"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              invalid={Boolean(clientError ?? apiError?.fieldError('email'))}
            />
          </Field>
          <Button type="submit" block loading={forgotMutation.isPending}>
            Send reset link
          </Button>
        </form>

        <p className="mt-5 text-center text-body text-ink-secondary">
          Remembered it?{' '}
          <Link to="/login" className="font-semibold text-navy-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    </AuthShell>
  );
};

export default ForgotPasswordPage;
