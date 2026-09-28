import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import type { Profile } from '@/lib/types';
import { ROLE_LONG_LABELS, formatDateTime, formatRelative } from '@/lib/format';
import {
  Button,
  Card,
  CardHeader,
  DataRow,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PasswordInput,
  SkeletonCard,
  cn,
} from '@/components/ui';
import { Alert, PageHeader } from '@/components/ui/badges';
import { PasswordChecklist, evaluatePasswordChecks } from '@/pages/auth/SetPasswordPage';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

/**
 * M02 — Profile & security (FR-PRF-01..05).
 *
 * Read-only identity, self-service contact details, a password change that
 * signs every session out, and the list of active sessions with revoke.
 */

interface SessionItem {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
}

interface ProfileUpdatePayload {
  corporatePhone?: string;
  designationTitle?: string;
  emailDigest?: boolean;
}

const PHONE_PATTERN = /^(\+8801|01)[3-9]\d{8}$/;

const describeUserAgent = (userAgent: string | null): string => {
  if (!userAgent) return 'Unknown device';
  if (/edg\//i.test(userAgent)) return 'Microsoft Edge';
  if (/opr\//i.test(userAgent)) return 'Opera';
  if (/chrome\//i.test(userAgent) || /crios/i.test(userAgent)) return 'Google Chrome';
  if (/firefox\//i.test(userAgent) || /fxios/i.test(userAgent)) return 'Mozilla Firefox';
  if (/safari\//i.test(userAgent)) return 'Apple Safari';
  return 'Browser session';
};

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, logout, refreshProfile } = useAuth();

  const profileQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Profile>('/me'),
  });

  const sessionsQuery = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.get<SessionItem[]>('/auth/sessions'),
    staleTime: 15_000,
  });

  const profile = profileQuery.data;

  // ------------------------------------------------------------ contact form
  const [phone, setPhone] = React.useState('');
  const [designationTitle, setDesignationTitle] = React.useState('');
  const [emailDigest, setEmailDigest] = React.useState(false);
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<ApiError | null>(null);

  React.useEffect(() => {
    if (!profile) return;
    setPhone(profile.corporatePhone ?? '');
    setDesignationTitle(profile.designationTitle ?? '');
    setEmailDigest(profile.emailDigest);
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: (payload: ProfileUpdatePayload) => api.patch<Profile>('/me', payload),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['me'], updated);
      await refreshProfile();
      setSaveError(null);
      toast.success('Profile updated', 'Your changes have been saved.');
    },
    onError: (error) => {
      const next =
        error instanceof ApiError ? error : new ApiError(0, undefined, 'Your changes could not be saved.');
      setSaveError(next);
      toast.error('Could not save your profile', next.message);
    },
  });

  const submitProfile = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = phone.trim();
    if (value && !PHONE_PATTERN.test(value)) {
      setPhoneError('Enter a valid Bangladeshi mobile number, e.g. 01712345678 or +8801712345678.');
      return;
    }
    setPhoneError(null);
    const payload: ProfileUpdatePayload = {
      designationTitle: designationTitle.trim(),
      emailDigest,
    };
    if (value) payload.corporatePhone = value;
    saveMutation.mutate(payload);
  };

  // -------------------------------------------------------- change password
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [passwordError, setPasswordError] = React.useState<ApiError | null>(null);
  const [passwordChanged, setPasswordChanged] = React.useState(false);

  const passwordEmail = profile?.email ?? user?.email ?? null;
  const passwordPolicyMet = evaluatePasswordChecks(newPassword, passwordEmail).every((check) => check.met);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmitPassword = currentPassword.length > 0 && passwordPolicyMet && passwordsMatch;

  const changePasswordMutation = useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
      api.post<{ message: string }>('/auth/change-password', payload),
    onSuccess: (data) => {
      setPasswordChanged(true);
      setPasswordError(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      toast.warning(
        'Password changed',
        data.message || 'All sessions were signed out. Sign in again with your new password.',
      );
    },
    onError: (error) => {
      const next =
        error instanceof ApiError ? error : new ApiError(0, undefined, 'The password could not be changed.');
      setPasswordError(next);
      toast.error('Could not change your password', next.message);
    },
  });

  const submitPassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);
    if (!canSubmitPassword) return;
    changePasswordMutation.mutate({ currentPassword, newPassword, confirmPassword });
  };

  const signInAgain = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // -------------------------------------------------------------- sessions
  const [sessionToRevoke, setSessionToRevoke] = React.useState<SessionItem | null>(null);

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => api.delete<{ message: string }>(`/auth/sessions/${sessionId}`),
    onSuccess: () => {
      setSessionToRevoke(null);
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      toast.success('Session revoked', 'The device has been signed out.');
    },
    onError: (error) => {
      const next =
        error instanceof ApiError ? error : new ApiError(0, undefined, 'The session could not be revoked.');
      toast.error('Could not revoke the session', next.message);
    },
  });

  if (profileQuery.isPending) {
    return (
      <>
        <PageHeader title="Profile & security" subtitle="Your identity, contact details and sign-in security (M02)." />
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonCard lines={7} />
          <SkeletonCard lines={5} />
        </div>
      </>
    );
  }

  if (profileQuery.isError || !profile) {
    return (
      <>
        <PageHeader title="Profile & security" subtitle="Your identity, contact details and sign-in security (M02)." />
        <ErrorState
          message={profileQuery.error instanceof ApiError ? profileQuery.error.message : 'Your profile could not be loaded.'}
          onRetry={() => void profileQuery.refetch()}
        />
      </>
    );
  }

  const approvers = profile.approvers ?? [];
  const roleLabel = profile.roles.length
    ? profile.roles.map((role) => ROLE_LONG_LABELS[role.code] ?? role.code).join(' · ')
    : '—';

  return (
    <>
      <PageHeader title="Profile & security" subtitle="Your identity, contact details and sign-in security (M02)." />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------------- identity */}
        <Card>
          <CardHeader title="Identity" subtitle="Read-only — an HR Admin maintains these details." />
          <dl>
            <DataRow label="Full name">{profile.fullName}</DataRow>
            <DataRow label="Company e-mail" mono>
              {profile.email}
            </DataRow>
            <DataRow label="Employee ID" mono>
              {profile.employeeCode}
            </DataRow>
            <DataRow label="Business unit">{profile.businessUnit?.name ?? '—'}</DataRow>
            <DataRow label="Department">{profile.department?.name ?? '—'}</DataRow>
            <DataRow label="Role(s)">{roleLabel}</DataRow>
            <DataRow label="Designation">{profile.designationTitle ?? '—'}</DataRow>
            <DataRow label="Approver(s)">
              {approvers.length === 0 ? (
                <span className="font-normal text-ink-muted">No approver assigned yet</span>
              ) : (
                <span className="flex flex-col items-start gap-0.5 sm:items-end">
                  {approvers.map((approver) => (
                    <span key={approver.id} className="font-semibold text-ink">
                      {approver.fullName}{' '}
                      <a href={`mailto:${approver.email}`} className="font-normal text-navy-600 hover:underline">
                        {approver.email}
                      </a>
                    </span>
                  ))}
                </span>
              )}
            </DataRow>
          </dl>
        </Card>

        {/* ------------------------------------------------- contact details */}
        <Card>
          <CardHeader title="Contact details" subtitle="Kept in sync with your corporate directory (FR-PRF-02)." />

          {saveError ? (
            <Alert tone="danger" className="mb-4">
              {saveError.message}
            </Alert>
          ) : null}
          {saveMutation.isSuccess ? (
            <Alert tone="success" className="mb-4">
              Your changes have been saved.
            </Alert>
          ) : null}

          <form className="space-y-4" onSubmit={submitProfile} noValidate>
            <Field
              label="Corporate Phone"
              htmlFor="profile-phone"
              hint="Stored as +8801XXXXXXXXX."
              error={phoneError ?? saveError?.fieldError('corporatePhone')}
            >
              <Input
                id="profile-phone"
                name="corporatePhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="01XXXXXXXXX or +8801XXXXXXXXX"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                invalid={Boolean(phoneError ?? saveError?.fieldError('corporatePhone'))}
              />
            </Field>

            <Field label="Designation title" htmlFor="profile-designation" hint="Shown on your KPI records and reports.">
              <Input
                id="profile-designation"
                name="designationTitle"
                value={designationTitle}
                onChange={(event) => setDesignationTitle(event.target.value)}
              />
            </Field>

            <div className="flex items-start justify-between gap-4 rounded-control border border-edge bg-canvas px-3 py-2.5">
              <div className="min-w-0">
                <p id="email-digest-label" className="text-body text-ink">
                  Send non-critical e-mails as a daily digest
                </p>
                <p className="anwar-helper">Critical notifications are always sent immediately (FR-PRF-03).</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={emailDigest}
                aria-labelledby="email-digest-label"
                onClick={() => setEmailDigest((current) => !current)}
                className={cn(
                  'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-pill transition-colors',
                  emailDigest ? 'bg-navy-900' : 'bg-neutral-tint',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                    emailDigest ? 'translate-x-[22px]' : 'translate-x-0.5',
                  )}
                />
              </button>
            </div>

            <Button type="submit" loading={saveMutation.isPending}>
              Save changes
            </Button>
          </form>
        </Card>

        {/* --------------------------------------------------- change password */}
        <Card>
          <CardHeader
            title="Change password"
            subtitle="After a change every session is signed out and you sign in again (FR-PRF-04)."
          />

          {passwordChanged ? (
            <Alert
              tone="warning"
              className="mb-4"
              title="Password changed"
              actions={
                <Button size="sm" variant="secondary" onClick={() => void signInAgain()}>
                  Sign in again
                </Button>
              }
            >
              All sessions were signed out. Sign in again with your new password to continue.
            </Alert>
          ) : null}
          {passwordError ? (
            <Alert tone="danger" className="mb-4">
              {passwordError.message}
            </Alert>
          ) : null}

          <form className="space-y-4" onSubmit={submitPassword} noValidate>
            <Field
              label="Current password"
              htmlFor="profile-current-password"
              required
              error={passwordError?.fieldError('currentPassword')}
            >
              <PasswordInput
                id="profile-current-password"
                name="currentPassword"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                invalid={Boolean(passwordError?.fieldError('currentPassword'))}
              />
            </Field>
            <Field
              label="New password"
              htmlFor="profile-new-password"
              required
              error={passwordError?.fieldError('newPassword')}
            >
              <PasswordInput
                id="profile-new-password"
                name="newPassword"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                invalid={Boolean(passwordError?.fieldError('newPassword'))}
              />
            </Field>
            <Field
              label="Confirm new password"
              htmlFor="profile-confirm-password"
              required
              error={passwordError?.fieldError('confirmPassword')}
            >
              <PasswordInput
                id="profile-confirm-password"
                name="confirmPassword"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                invalid={Boolean(passwordError?.fieldError('confirmPassword'))}
              />
            </Field>

            <div className="rounded-control border border-edge bg-canvas p-3">
              <p className="mb-2 text-caption font-semibold text-ink-secondary">Password requirements</p>
              <PasswordChecklist password={newPassword} email={passwordEmail} confirmPassword={confirmPassword} />
            </div>

            <Button type="submit" loading={changePasswordMutation.isPending} disabled={!canSubmitPassword}>
              Update password
            </Button>
          </form>
        </Card>

        {/* ----------------------------------------------------- active sessions */}
        <Card>
          <CardHeader title="Active sessions" subtitle="Devices signed in to your account. Revoke anything you do not recognise." />

          {sessionsQuery.isError ? (
            <Alert
              tone="danger"
              actions={
                <Button size="sm" variant="secondary" onClick={() => void sessionsQuery.refetch()}>
                  Retry
                </Button>
              }
            >
              Your sessions could not be loaded.
            </Alert>
          ) : sessionsQuery.isPending ? (
            <div className="space-y-3">
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
            </div>
          ) : !sessionsQuery.data?.length ? (
            <EmptyState
              title="No active sessions"
              description="Sessions appear here once you sign in on a device."
              className="py-8"
            />
          ) : (
            <ul className="divide-y divide-edge/70">
              {sessionsQuery.data.map((session) => (
                <li key={session.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-body font-semibold text-ink">
                      <span className="truncate">{describeUserAgent(session.userAgent)}</span>
                      {session.id === user?.sessionId ? (
                        <span className="anwar-badge bg-info-tint text-info">This device</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-caption text-ink-secondary">
                      IP {session.ipAddress ?? '—'} · signed in {formatDateTime(session.createdAt)} · last active{' '}
                      {formatRelative(session.lastSeenAt)}
                    </p>
                    <p className="text-[11px] text-ink-muted">Idle timeout {formatDateTime(session.idleExpiresAt)}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setSessionToRevoke(session)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={Boolean(sessionToRevoke)}
        onClose={() => setSessionToRevoke(null)}
        title="Revoke this session?"
        description="The device is signed out immediately and must sign in again."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSessionToRevoke(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={revokeMutation.isPending}
              onClick={() => {
                if (sessionToRevoke) revokeMutation.mutate(sessionToRevoke.id);
              }}
            >
              Revoke session
            </Button>
          </>
        }
      >
        {sessionToRevoke ? (
          <div className="text-body text-ink-secondary">
            <p className="font-semibold text-ink">{describeUserAgent(sessionToRevoke.userAgent)}</p>
            <p className="mt-1 text-caption">
              IP {sessionToRevoke.ipAddress ?? '—'} · signed in {formatDateTime(sessionToRevoke.createdAt)}
            </p>
            {sessionToRevoke.id === user?.sessionId ? (
              <p className="mt-2 text-caption font-semibold text-danger">
                This is the device you are using now — you will be signed out.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
};

export default ProfilePage;
