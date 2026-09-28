import React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { api, toQuery } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, Button, IconButton, cn } from '@/components/ui';
import type { NotificationItem, RoleCode } from '@/lib/types';
import { ROLE_LONG_LABELS, formatRelative, initialsOf, primaryRole } from '@/lib/format';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { PeriodSelector } from '@/components/layout/PeriodSelector';
import { NotificationBell } from '@/components/layout/NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles?: RoleCode[];
  permission?: string;
  badgeKey?: 'approvals' | 'escalations' | 'headKpis' | 'corrections';
}

const I = (path: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
    {path}
  </svg>
);

const ICONS = {
  dashboard: I(<><rect x="3" y="3" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="14" y="11" width="7" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="3" y="15" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" /></>),
  inbox: I(<><path d="M4 5h16v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" stroke="currentColor" strokeWidth="1.8" /><path d="M4 12h4l2 3h4l2-3h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>),
  trophy: I(<><path d="M8 4h8v5a4 4 0 11-8 0V4z" stroke="currentColor" strokeWidth="1.8" /><path d="M8 6H5v2a3 3 0 003 3M16 6h3v2a3 3 0 01-3 3M10 17h4M12 13v4M9 20h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>),
  kpi: I(<><path d="M4 19V5M4 19h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M8 16l3-5 3 3 5-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>),
  chart: I(<><path d="M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><rect x="6" y="10" width="3" height="7" rx="1" stroke="currentColor" strokeWidth="1.8" /><rect x="11" y="6" width="3" height="11" rx="1" stroke="currentColor" strokeWidth="1.8" /><rect x="16" y="13" width="3" height="4" rx="1" stroke="currentColor" strokeWidth="1.8" /></>),
  library: I(<><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M8 9h8M8 13h8M8 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>),
  report: I(<><path d="M7 3h7l4 4v14H7z" stroke="currentColor" strokeWidth="1.8" /><path d="M14 3v5h4M10 13h6M10 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>),
  users: I(<><circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" /><path d="M3 20a6 6 0 0112 0M16.5 11a3 3 0 100-6M18 20a5.6 5.6 0 00-2-4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>),
  org: I(<><rect x="4" y="3" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="13" y="3" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="8.5" y="15" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><path d="M7.5 9v3h9V9M12 12v3" stroke="currentColor" strokeWidth="1.8" /></>),
  calendar: I(<><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>),
  config: I(<><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>),
  audit: I(<><path d="M12 3l8 4v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4z" stroke="currentColor" strokeWidth="1.8" /><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>),
  heart: I(<><path d="M3 11h4l2-3 3 6 2-3h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" /></>),
  profile: I(<><circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" /><path d="M5 20a7 7 0 0114 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>),
  bell: I(<><path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" stroke="currentColor" strokeWidth="1.8" /><path d="M10 20a2 2 0 004 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>),
  history: I(<><path d="M3 12a9 9 0 1010-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M3 4v5h5M12 8v4l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>),
  escalation: I(<><path d="M12 3l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 9v5M12 17h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>),
};

/**
 * Sidebar menus — BRD §11.3. The item list is role-dependent and every entry is
 * additionally guarded by a permission where one applies.
 */
const NAV: NavItem[] = [
  // Employee
  { to: '/profile', label: 'Profile', icon: ICONS.profile, roles: ['EMPLOYEE', 'DEPT_HEAD', 'SUPER_ADMIN', 'HR_ADMIN', 'MGMT_VIEWER', 'SYS_ADMIN'] },
  { to: '/my-kpi', label: 'My KPI', icon: ICONS.kpi, roles: ['EMPLOYEE', 'DEPT_HEAD', 'SUPER_ADMIN', 'HR_ADMIN'] },
  { to: '/performance-summary', label: 'Performance Summary', icon: ICONS.chart, roles: ['EMPLOYEE', 'DEPT_HEAD', 'SUPER_ADMIN', 'HR_ADMIN', 'MGMT_VIEWER'] },
  { to: '/notifications', label: 'Notifications', icon: ICONS.bell, roles: ['EMPLOYEE', 'DEPT_HEAD', 'SUPER_ADMIN', 'HR_ADMIN', 'MGMT_VIEWER', 'SYS_ADMIN'] },

  // Department Head
  { to: '/dashboard', label: 'Dashboard', icon: ICONS.dashboard, permission: 'dashboard:dept', roles: ['DEPT_HEAD'] },
  { to: '/approvals', label: 'KPI Pending Requests', icon: ICONS.inbox, permission: 'kpi:review', badgeKey: 'approvals' },
  { to: '/leaderboard', label: 'Leaderboard', icon: ICONS.trophy, permission: 'dashboard:dept' },
  { to: '/kpi-library', label: 'KPI Library', icon: ICONS.library, permission: 'template:dept-manage' },
  { to: '/reports', label: 'Reports', icon: ICONS.report, permission: 'report:view' },

  // Super Admin / HR
  { to: '/group-dashboard', label: 'Group Dashboard', icon: ICONS.dashboard, permission: 'dashboard:group' },
  { to: '/all-kpi-requests', label: 'All KPI Requests', icon: ICONS.inbox, permission: 'kpi:approve-head' },
  { to: '/head-kpi-requests', label: 'Department Head KPI Requests', icon: ICONS.inbox, permission: 'kpi:approve-head', badgeKey: 'headKpis' },
  { to: '/escalations', label: 'Escalations', icon: ICONS.escalation, permission: 'kpi:approve-head', badgeKey: 'escalations' },
  { to: '/admin/users', label: 'Users & Invitations', icon: ICONS.users, permission: 'user:manage' },
  { to: '/admin/organisation', label: 'Organisation', icon: ICONS.org, permission: 'org:manage' },
  { to: '/admin/periods', label: 'Periods', icon: ICONS.calendar, permission: 'period:manage' },
  { to: '/admin/configuration', label: 'Configuration', icon: ICONS.config, permission: 'config:manage' },
  { to: '/admin/audit-log', label: 'Audit Log', icon: ICONS.audit, permission: 'audit:view-all' },
  { to: '/admin/system-health', label: 'System Health', icon: ICONS.heart, permission: 'system:settings' },
];

interface QueueCounts {
  pending: number;
  headKpis: number;
  escalations: number;
  corrections: number;
  deptQueue: number;
}

export const AppShell: React.FC = () => {
  const { user, profile, logout, demo } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [profileMenu, setProfileMenu] = React.useState(false);

  const roles = user?.roles ?? [];
  const permissions = user?.permissions ?? [];

  const visibleNav = React.useMemo(
    () =>
      NAV.filter((item) => {
        if (item.permission && !permissions.includes(item.permission)) return false;
        if (item.roles && !item.roles.some((r) => roles.includes(r))) return false;
        return true;
      }),
    [permissions, roles],
  );

  // Sidebar badge counts — refreshed after every mutation that changes a queue.
  const { data: counts } = useQuery({
    queryKey: ['queue-counts'],
    queryFn: () => api.get<QueueCounts>('/approvals/counts'),
    enabled: permissions.includes('kpi:review') || permissions.includes('kpi:approve-head') || permissions.includes('report:view-all'),
    refetchInterval: 60_000,
    staleTime: 20_000,
  });

  const badgeFor = (key?: NavItem['badgeKey']): number | undefined => {
    if (!key || !counts) return undefined;
    if (key === 'approvals') return counts.deptQueue || undefined;
    if (key === 'escalations') return counts.escalations || undefined;
    if (key === 'headKpis') return counts.headKpis || undefined;
    if (key === 'corrections') return counts.corrections || undefined;
    return undefined;
  };

  React.useEffect(() => {
    setSidebarOpen(false);
    setProfileMenu(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    toast.info('Signed out', 'Your session has been closed.');
    navigate('/login', { replace: true });
  };

  /** Returns to the sign-in screen so another demo role can be explored. */
  const handleSwitchRole = async () => {
    await logout();
    queryClient.clear();
    navigate('/login', { replace: true });
  };

  const roleLabel = ROLE_LONG_LABELS[primaryRole(roles)];

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Skip link — WCAG 2.1 AA (§11.6) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-control focus:bg-navy-900 focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>

      {/* ------------------------------------------------------------- sidebar */}
      <AnimatePresence>
        {sidebarOpen ? (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-navy-900/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        ) : null}
      </AnimatePresence>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col bg-navy-900 text-white transition-transform lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed && 'lg:w-[72px]',
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-white/10 px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-white/10" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
              <path d="M7 23 L13 11 L18 20 L25 8" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          {!collapsed ? (
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold leading-5">ANWAR KPI</p>
              <p className="truncate text-[10px] uppercase tracking-wider text-navy-200">KPIFlow · Phase 01</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto rounded p-1 text-navy-200 hover:bg-white/10 lg:hidden"
            aria-label="Close navigation"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="anwar-scroll flex-1 px-2 py-3" aria-label="Main navigation">
          <ul className="space-y-0.5">
            {visibleNav.map((item) => {
              const badge = badgeFor(item.badgeKey);
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-control px-3 py-2 text-body transition-colors',
                        isActive ? 'bg-white/15 font-semibold text-white' : 'text-navy-100 hover:bg-white/10 hover:text-white',
                        collapsed && 'lg:justify-center lg:px-2',
                      )
                    }
                    title={collapsed ? item.label : undefined}
                  >
                    {item.icon}
                    {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
                    {badge && !collapsed ? (
                      <span className="rounded-pill bg-warning px-1.5 text-[11px] font-semibold text-white tnum">{badge}</span>
                    ) : null}
                    {badge && collapsed ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-warning" aria-hidden="true" /> : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="hidden w-full items-center gap-2 rounded-control px-2 py-1.5 text-caption text-navy-200 hover:bg-white/10 lg:flex"
            aria-pressed={collapsed}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {!collapsed ? 'Collapse' : null}
          </button>
          {!collapsed ? (
            <p className="mt-2 px-2 text-[10px] leading-4 text-navy-300">
              Anwar Group of Industries · Internal &amp; Confidential
            </p>
          ) : null}
        </div>
      </aside>

      {/* -------------------------------------------------------------- content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-edge bg-surface/95 px-3 glass-topbar sm:px-5">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-control p-2 text-ink-secondary hover:bg-navy-50 lg:hidden"
            aria-label="Open navigation"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
            <PeriodSelector />
          </div>

          <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
            {permissions.includes('search:global') || permissions.includes('kpi:view-others') ? <GlobalSearch /> : null}
            <NotificationBell />
            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileMenu((v) => !v)}
                className="flex items-center gap-2 rounded-control p-1 pr-2 hover:bg-navy-50"
                aria-haspopup="menu"
                aria-expanded={profileMenu}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-caption font-semibold text-white" aria-hidden="true">
                  {initialsOf(user?.fullName ?? '')}
                </span>
                <span className="hidden min-w-0 text-left sm:block">
                  <span className="block truncate text-caption font-semibold text-ink">{user?.fullName}</span>
                  <span className="block truncate text-[11px] text-ink-secondary">{roleLabel}</span>
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="hidden text-ink-muted sm:block">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>

              <AnimatePresence>
                {profileMenu ? (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute right-0 z-40 mt-1 w-60 rounded-card border border-edge bg-surface p-1 shadow-raised"
                    role="menu"
                  >
                    <div className="border-b border-edge px-3 py-2">
                      <p className="truncate text-body font-semibold text-ink">{user?.fullName}</p>
                      <p className="truncate text-caption text-ink-secondary">{user?.email}</p>
                      <p className="mt-1 truncate text-[11px] text-ink-muted">
                        {profile?.businessUnit?.name ?? '—'} · {profile?.department?.name ?? '—'}
                      </p>
                    </div>
                    <Link to="/profile" className="block rounded-control px-3 py-2 text-body text-ink hover:bg-navy-50" role="menuitem">
                      Profile &amp; security
                    </Link>
                    <Link to="/notifications" className="block rounded-control px-3 py-2 text-body text-ink hover:bg-navy-50" role="menuitem">
                      Notifications
                    </Link>
                    {demo ? (
                      <button
                        type="button"
                        onClick={handleSwitchRole}
                        className="block w-full rounded-control px-3 py-2 text-left text-body text-navy-700 hover:bg-navy-50"
                        role="menuitem"
                      >
                        Switch demo role
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="block w-full rounded-control px-3 py-2 text-left text-body text-danger hover:bg-danger-tint"
                      role="menuitem"
                    >
                      Sign out
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {demo ? (
          <div className="border-b border-info/30 bg-info-tint px-4 py-2 text-caption text-info sm:px-6">
            <strong>Demo mode</strong> — this deployment runs entirely in your browser on the seeded Anwar Group
            dataset (9 business units, 104 departments, 402 KPIs). Use “Switch demo role” in the profile menu to
            explore another role.
          </div>
        ) : null}

        {!user?.organisationConfirmed ? (
          <div className="border-b border-warning/30 bg-warning-tint px-4 py-2 text-caption text-warning sm:px-6">
            Your business unit and department are awaiting confirmation (FR-ORG-09). You can prepare Drafts, but you
            cannot submit a KPI until an approver confirms your organisation.
          </div>
        ) : null}

        <main id="main-content" className="mx-auto w-full max-w-content flex-1 px-3 py-5 sm:px-5 lg:px-6">
          <Outlet />
        </main>

        <footer className="border-t border-edge bg-surface px-4 py-3 text-[11px] text-ink-muted sm:px-6">
          ANWAR KPIFlow · Variable KPI Phase 01 · Anwar Group of Industries — Internal &amp; Confidential
        </footer>
      </div>
    </div>
  );
};

/** Simple in-shell page placeholder used while a route is under development. */
export const PagePlaceholder: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
  <div className="anwar-card anwar-card-pad">
    <h1 className="text-h1 text-navy-900">{title}</h1>
    {description ? <p className="mt-1 text-body text-ink-secondary">{description}</p> : null}
    <div className="mt-4">
      <Badge tone="info">Screen ready</Badge>
    </div>
  </div>
);
