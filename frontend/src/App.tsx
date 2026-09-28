import React, { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui';
import type { RoleCode } from '@/lib/types';

// ------------------------------------------------------------------ lazy pages
const LoginPage = React.lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = React.lazy(() => import('@/pages/auth/RegisterPage'));
const SetPasswordPage = React.lazy(() => import('@/pages/auth/SetPasswordPage'));
const ForgotPasswordPage = React.lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = React.lazy(() => import('@/pages/auth/ResetPasswordPage'));

const MyKpiPage = React.lazy(() => import('@/pages/kpi/MyKpiPage'));
const KpiDetailPage = React.lazy(() => import('@/pages/kpi/KpiDetailPage'));
const PerformanceSummaryPage = React.lazy(() => import('@/pages/kpi/PerformanceSummaryPage'));

const ApprovalsPage = React.lazy(() => import('@/pages/approvals/ApprovalsPage'));
const EscalationsPage = React.lazy(() => import('@/pages/approvals/EscalationsPage'));
const AllRequestsPage = React.lazy(() => import('@/pages/approvals/AllRequestsPage'));
const HeadKpiRequestsPage = React.lazy(() => import('@/pages/approvals/HeadKpiRequestsPage'));
const CorrectionsPage = React.lazy(() => import('@/pages/approvals/CorrectionsPage'));

const DepartmentDashboardPage = React.lazy(() => import('@/pages/dashboards/DepartmentDashboardPage'));
const GroupDashboardPage = React.lazy(() => import('@/pages/dashboards/GroupDashboardPage'));
const LeaderboardPage = React.lazy(() => import('@/pages/dashboards/LeaderboardPage'));

const ReportsPage = React.lazy(() => import('@/pages/reports/ReportsPage'));
const NotificationsPage = React.lazy(() => import('@/pages/NotificationsPage'));
const ProfilePage = React.lazy(() => import('@/pages/ProfilePage'));
const VersionHistoryPage = React.lazy(() => import('@/pages/kpi/VersionHistoryPage'));

const UsersAdminPage = React.lazy(() => import('@/pages/admin/UsersAdminPage'));
const OrganisationPage = React.lazy(() => import('@/pages/admin/OrganisationPage'));
const PeriodsPage = React.lazy(() => import('@/pages/admin/PeriodsPage'));
const ConfigurationPage = React.lazy(() => import('@/pages/admin/ConfigurationPage'));
const KpiLibraryPage = React.lazy(() => import('@/pages/admin/KpiLibraryPage'));
const AuditLogPage = React.lazy(() => import('@/pages/admin/AuditLogPage'));
const SystemHealthPage = React.lazy(() => import('@/pages/admin/SystemHealthPage'));

const NotFoundPage = React.lazy(() => import('@/pages/NotFoundPage'));

// ------------------------------------------------------------------ fallbacks

const RouteFallback: React.FC = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <div className="flex flex-col items-center gap-3 text-ink-secondary">
      <Spinner size={26} />
      <p className="text-caption">Loading…</p>
    </div>
  </div>
);

const FullPageLoader: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center bg-navy-900">
    <div className="flex flex-col items-center gap-3 text-white">
      <Spinner size={28} />
      <p className="text-caption text-navy-200">Preparing your workspace…</p>
    </div>
  </div>
);

/** Redirects unauthenticated users to /login, preserving the intended route. */
const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { authenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader />;
  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
};

/** Redirects authenticated users away from the auth screens. */
const RedirectIfAuthenticated: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { authenticated, loading, home } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (authenticated) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? home} replace />;
  }
  return <>{children}</>;
};

/** Role-based route guard (§5.2). */
const RequireRole: React.FC<{ roles: RoleCode[]; permission?: string; children: React.ReactNode }> = ({
  roles,
  permission,
  children,
}) => {
  const { hasRole, hasPermission, loading } = useAuth();
  if (loading) return <RouteFallback />;
  const allowed = hasRole(...roles) || (permission ? hasPermission(permission) : false);
  if (!allowed) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
};

const ForbiddenPage: React.FC = () => (
  <div className="anwar-card anwar-card-pad text-center">
    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-tint text-danger" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
    <h1 className="text-h2 text-navy-900">You do not have access to this screen</h1>
    <p className="mt-1 text-body text-ink-secondary">
      Your role does not include the permission required by this page. If you believe this is wrong, contact Group HR
      or Group IT.
    </p>
  </div>
);

// ------------------------------------------------------------------- routing

const AnimatedPage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
  >
    {children}
  </motion.div>
);

export const App: React.FC = () => {
  const location = useLocation();

  return (
    <Suspense fallback={<RouteFallback />}>
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>
          {/* Public: authentication (M01) */}
          <Route path="/login" element={<RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>} />
          <Route path="/register" element={<RedirectIfAuthenticated><RegisterPage /></RedirectIfAuthenticated>} />
          <Route path="/set-password" element={<SetPasswordPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Authenticated shell */}
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Navigate to="/my-kpi" replace />} />

            {/* Employee workspace */}
            <Route path="/profile" element={<AnimatedPage><ProfilePage /></AnimatedPage>} />
            <Route path="/my-kpi" element={<AnimatedPage><MyKpiPage /></AnimatedPage>} />
            <Route path="/my-kpi/:id" element={<AnimatedPage><KpiDetailPage /></AnimatedPage>} />
            <Route path="/my-kpi/:id/versions" element={<AnimatedPage><VersionHistoryPage /></AnimatedPage>} />
            <Route path="/performance-summary" element={<AnimatedPage><PerformanceSummaryPage /></AnimatedPage>} />
            <Route path="/notifications" element={<AnimatedPage><NotificationsPage /></AnimatedPage>} />

            {/* Department Head console */}
            <Route
              path="/dashboard"
              element={
                <RequireRole roles={['DEPT_HEAD', 'SUPER_ADMIN']} permission="dashboard:dept">
                  <AnimatedPage><DepartmentDashboardPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/leaderboard"
              element={
                <RequireRole roles={['DEPT_HEAD', 'SUPER_ADMIN', 'MGMT_VIEWER']} permission="dashboard:dept">
                  <AnimatedPage><LeaderboardPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/approvals"
              element={
                <RequireRole roles={['DEPT_HEAD', 'SUPER_ADMIN']} permission="kpi:review">
                  <AnimatedPage><ApprovalsPage /></AnimatedPage>
                </RequireRole>
              }
            />

            {/* Super Admin console */}
            <Route
              path="/group-dashboard"
              element={
                <RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'MGMT_VIEWER']} permission="dashboard:group">
                  <AnimatedPage><GroupDashboardPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/all-kpi-requests"
              element={
                <RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN']} permission="kpi:approve-head">
                  <AnimatedPage><AllRequestsPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/head-kpi-requests"
              element={
                <RequireRole roles={['SUPER_ADMIN']} permission="kpi:approve-head">
                  <AnimatedPage><HeadKpiRequestsPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/escalations"
              element={
                <RequireRole roles={['SUPER_ADMIN']} permission="kpi:approve-head">
                  <AnimatedPage><EscalationsPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/corrections"
              element={
                <RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD']} permission="kpi:approve-correction">
                  <AnimatedPage><CorrectionsPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/admin/organisation"
              element={
                <RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN']} permission="org:manage">
                  <AnimatedPage><OrganisationPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/admin/periods"
              element={
                <RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN']} permission="period:manage">
                  <AnimatedPage><PeriodsPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/admin/configuration"
              element={
                <RequireRole roles={['SUPER_ADMIN']} permission="config:manage">
                  <AnimatedPage><ConfigurationPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/admin/audit-log"
              element={
                <RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD']} permission="audit:view-all">
                  <AnimatedPage><AuditLogPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/admin/system-health"
              element={
                <RequireRole roles={['SYS_ADMIN', 'SUPER_ADMIN']} permission="system:settings">
                  <AnimatedPage><SystemHealthPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route
              path="/corrections"
              element={
                <RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD']} permission="kpi:approve-correction">
                  <AnimatedPage><CorrectionsPage /></AnimatedPage>
                </RequireRole>
              }
            />

            {/* Shared */}
            <Route path="/reports" element={<AnimatedPage><ReportsPage /></AnimatedPage>} />
            <Route
              path="/kpi-library"
              element={
                <RequireRole roles={['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD', 'EMPLOYEE']} permission="report:view">
                  <AnimatedPage><KpiLibraryPage /></AnimatedPage>
                </RequireRole>
              }
            />
            <Route path="/forbidden" element={<ForbiddenPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
};
