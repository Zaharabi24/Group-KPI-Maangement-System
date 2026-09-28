/**
 * ============================================================================
 *  Demo API resolver
 * ============================================================================
 *  Answers every request the SPA makes from the in-browser dataset, using the
 *  same response envelopes, field names and business rules as the NestJS API.
 *  Requests to an endpoint that has no handler return a small empty payload in
 *  the correct shape rather than an error, so the demo never shows a failure.
 * ============================================================================
 */
import { calculateKpi, roundHalfUp, aggregatePeriod, type CalcMeasurementType } from '@/lib/calculation';
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  demoAuditLog,
  demoBusinessUnits,
  demoCategories,
  demoCalcConfig,
  demoConfig,
  demoCorrections,
  demoDelegations,
  demoDepartments,
  demoEscalations,
  demoHome,
  demoInvitations,
  demoKpis,
  demoNotifications,
  demoPeriods,
  demoPermissions,
  demoRoleLabels,
  demoSystemHealth,
  demoTemplates,
  demoUsers,
  departmentBy,
  kpiById,
  periodById,
  periodByCode,
  userByEmail,
  userById,
  type DemoKpi,
  type DemoRole,
  type DemoUser,
} from './dataset';

export interface DemoRequest {
  method: string;
  url: string;
  params?: Record<string, unknown>;
  body?: unknown;
  token?: string | null;
}

export interface DemoResponse {
  status: number;
  data: unknown;
}

// ------------------------------------------------------------------ auth state

interface DemoSession {
  userId: string;
  email: string;
}

const SESSION_KEY = 'anwar-kpi:demo-session';

/**
 * The chosen demo role is persisted so a reload keeps the same experience, while
 * a fresh visitor still lands on the sign-in screen and can pick any role.
 */
const readStoredSession = (): DemoSession | null => {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoSession;
    return userById(parsed.userId) ? parsed : null;
  } catch {
    return null;
  }
};

let session: DemoSession | null = readStoredSession();

export const demoSession = (): DemoSession | null => session;

export const demoSignIn = (email: string): DemoSession => {
  const user = userByEmail(email) ?? demoUsers.find((u) => u.role === 'EMPLOYEE') ?? demoUsers[0];
  session = { userId: user.id, email: user.email };
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable — the in-memory session still works */
  }
  return session;
};

export const demoSignOut = (): void => {
  session = null;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
};

const currentUser = (): DemoUser => {
  if (session) {
    const found = userById(session.userId);
    if (found) return found;
  }
  // No session: every handler still answers, but the SPA keeps the visitor on the
  // sign-in screen because /auth/refresh reports "no session".
  return userByEmail('superadmin@anwargroup.net') ?? demoUsers[0];
};

export const hasDemoSession = (): boolean => session !== null;

const principal = (user: DemoUser): Record<string, unknown> => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  employeeCode: user.employeeCode,
  roles: [user.role],
  permissions: demoPermissions[user.role],
  scope: {
    group: ['SUPER_ADMIN', 'HR_ADMIN', 'MGMT_VIEWER', 'SYS_ADMIN'].includes(user.role),
    departmentIds: user.role === 'DEPT_HEAD' ? user.departmentHeadOf : [],
    businessUnitIds: [],
    ownOnly: user.role === 'EMPLOYEE',
  },
  businessUnitId: user.businessUnitId,
  departmentId: user.departmentId,
  sessionId: `demo-session-${user.id.slice(0, 8)}`,
  sessionVersion: 1,
  breakGlassAccess: false,
  organisationConfirmed: user.organisationConfirmed,
});

const authPayload = (user: DemoUser): Record<string, unknown> => ({
  accessToken: `demo.${user.id}.${Date.now()}`,
  accessTokenExpiresIn: 900,
  refreshTokenExpiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
  user: {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    employeeCode: user.employeeCode,
    status: 'ACTIVE',
    corporatePhone: user.corporatePhone,
    designationTitle: user.designation,
    businessUnitId: user.businessUnitId,
    departmentId: user.departmentId,
    businessUnit: demoBusinessUnits.find((b) => b.id === user.businessUnitId) ?? null,
    department: { id: user.departmentId, name: demoDepartments.find((d) => d.id === user.departmentId)?.name ?? '—' },
    organisationConfirmed: user.organisationConfirmed,
    avatarUrl: null,
    emailDigest: user.emailDigest,
    roles: [user.role],
  },
  home: demoHome[user.role],
  permissions: demoPermissions[user.role],
  mustConfirmOrganisation: false,
});

// -------------------------------------------------------------------- helpers

const num = (value: unknown, fallback = 0): number => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const str = (value: unknown): string | undefined =>
  value === undefined || value === null || value === '' ? undefined : String(value);

const decimals = (value: number): string => value.toFixed(2);

const evidenceFor = (kpi: DemoKpi) => kpi.evidence;

const stepper = (kpi: DemoKpi) => {
  const states: Array<'done' | 'current' | 'todo' | 'error'> = [
    kpi.target !== null ? 'done' : 'todo',
    kpi.actual !== null ? 'done' : 'todo',
    kpi.evidenceCount > 0 ? 'done' : 'todo',
    'done',
    'todo',
    'todo',
  ];
  switch (kpi.status) {
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
    case 'ESCALATED':
      states[4] = 'current';
      break;
    case 'RETURNED':
      states[4] = 'error';
      break;
    case 'REJECTED':
      states[5] = 'error';
      break;
    case 'APPROVED':
      states[4] = 'done';
      states[5] = 'done';
      break;
    case 'NOT_SUBMITTED':
      return { step: 0, states: ['todo', 'todo', 'todo', 'todo', 'todo', 'todo'] as typeof states };
    default:
      break;
  }
  const first = states.findIndex((s) => s !== 'done');
  return { step: first === -1 ? 6 : first, states };
};

const daysBetween = (a: string, b: Date): number =>
  Math.max(0, Math.round((b.getTime() - new Date(a).getTime()) / 86_400_000));

const workingDaysBetween = (a: string, b: Date): number =>
  Math.max(0, Math.round(daysBetween(a, b) * (5 / 7)));

const daysRemaining = (deadline: string): number =>
  Math.round((new Date(deadline + 'T00:00:00Z').getTime() - Date.now()) / 86_400_000);

const vis = (user: DemoUser): DemoKpi[] => {
  if (['SUPER_ADMIN', 'HR_ADMIN', 'MGMT_VIEWER'].includes(user.role)) return demoKpis;
  if (user.role === 'DEPT_HEAD') return demoKpis.filter((k) => user.departmentHeadOf.includes(k.departmentId));
  return demoKpis.filter((k) => k.employeeId === user.id);
};

const cardOf = (kpi: DemoKpi) => {
  const period = periodById(kpi.periodId);
  const remaining = period ? daysRemaining(period.submissionDeadline) : null;
  return {
    id: kpi.id,
    code: kpi.code,
    name: kpi.name,
    category: kpi.categoryName,
    categoryCode: kpi.categoryCode,
    kpiWeight: kpi.kpiWeight,
    status: kpi.status,
    isLocked: kpi.isLocked,
    isAssigned: kpi.isAssigned,
    measurementType: kpi.measurementType,
    unit: kpi.unit,
    direction: kpi.direction,
    rubricLevel: kpi.rubricLevel,
    target: kpi.target !== null ? decimals(kpi.target) : null,
    actual: kpi.actual !== null ? decimals(kpi.actual) : null,
    achievement: decimals(kpi.achievement),
    calculatedScore: decimals(kpi.calculatedScore),
    finalScore: kpi.status === 'APPROVED' ? decimals(kpi.finalScore) : null,
    weightedScore: decimals(kpi.weightedScore),
    scoreTag: kpi.status === 'APPROVED' ? 'final' : 'calc.',
    adjusted: kpi.overrideScore !== null,
    evidenceCount: kpi.evidenceCount,
    approver: userById(kpi.approverId ?? '')?.fullName ?? 'Super Admin',
    period: period
      ? { id: period.id, code: period.code, label: period.label, frequency: period.frequency, submissionDeadline: period.submissionDeadline, status: period.status }
      : null,
    daysRemaining: remaining,
    deadlineState:
      remaining === null ? null : period?.status === 'CLOSED' ? 'closed' : remaining < 0 ? 'overdue' : remaining === 0 ? 'due_today' : remaining <= 3 ? 'soon' : 'open',
    stepper: stepper(kpi),
    returnComment: kpi.returnComment,
    submittedAt: kpi.submittedAt,
    decidedAt: kpi.decidedAt,
    createdAt: kpi.createdAt,
    updatedAt: kpi.updatedAt,
  };
};

const detailOf = (kpi: DemoKpi) => {
  const period = periodById(kpi.periodId);
  const employee = userById(kpi.employeeId)!;
  const department = demoDepartments.find((d) => d.id === kpi.departmentId);
  const businessUnit = demoBusinessUnits.find((b) => b.id === kpi.businessUnitId);
  const approverUser = userById(kpi.approverId ?? '');
  const remaining = period ? daysRemaining(period.submissionDeadline) : 0;

  return {
    id: kpi.id,
    code: kpi.code,
    name: kpi.name,
    description: kpi.description,
    status: kpi.status,
    isLocked: kpi.isLocked,
    isAssigned: kpi.isAssigned,
    targetLocked: false,
    weightLocked: false,
    kpiType: 'VARIABLE',
    frequency: kpi.frequency,
    period: period
      ? { ...period, daysRemaining: remaining }
      : { id: '', code: '', label: '', startDate: '', endDate: '', submissionDeadline: '', reviewDeadline: '', status: 'OPEN' as const, daysRemaining: 0 },
    category: {
      id: demoCategories.find((c) => c.code === kpi.categoryCode)?.id ?? '',
      code: kpi.categoryCode,
      name: kpi.categoryName,
    },
    measurementType: kpi.measurementType,
    unit: kpi.unit,
    direction: kpi.direction,
    target: kpi.target !== null ? decimals(kpi.target) : null,
    actual: kpi.actual !== null ? decimals(kpi.actual) : null,
    rubricLevel: kpi.rubricLevel,
    achievement: decimals(kpi.achievement),
    calculatedScore: decimals(kpi.calculatedScore),
    finalScore: kpi.status === 'APPROVED' ? decimals(kpi.finalScore) : null,
    overrideScore: kpi.overrideScore !== null ? decimals(kpi.overrideScore) : null,
    kpiWeight: kpi.kpiWeight,
    weightedScore: decimals(kpi.weightedScore),
    remarks: kpi.remarks,
    evidenceCount: kpi.evidenceCount,
    dataSource: kpi.description || 'Employee-entered with evidence',
    employee: {
      id: employee.id,
      fullName: employee.fullName,
      employeeCode: employee.employeeCode,
      email: employee.email,
      designationTitle: employee.designation,
      businessUnit: businessUnit ? { id: businessUnit.id, name: businessUnit.name, code: businessUnit.code } : null,
      department: department ? { id: department.id, name: department.name } : null,
    },
    organisation: {
      businessUnit: businessUnit ? { id: businessUnit.id, name: businessUnit.name, code: businessUnit.code } : null,
      department: department ? { id: department.id, name: department.name } : null,
    },
    approver: approverUser
      ? { id: approverUser.id, fullName: approverUser.fullName, email: approverUser.email, isSuperAdmin: false }
      : { id: null, fullName: 'Super Admin', email: null, isSuperAdmin: true },
    rowVersion: kpi.rowVersion,
    currentVersionNo: kpi.currentVersionNo,
    configVersion: demoConfig.version,
    submittedAt: kpi.submittedAt,
    reviewStartedAt: kpi.reviewStartedAt,
    decidedAt: kpi.decidedAt,
    returnComment: kpi.returnComment,
    rejectedReason: kpi.rejectedReason,
    rejectCategory: kpi.rejectCategory,
    // FR-KPI-08: exactly these six rows — no Curve Applied, Adjustment or Score Version.
    calculationPath: [
      { label: 'Formula', value: kpi.formulaText, mono: true },
      { label: 'Achievement', value: decimals(kpi.achievement), suffix: '%' },
      { label: 'Calculated Score', value: decimals(kpi.calculatedScore) },
      { label: 'Final Score', value: kpi.status === 'APPROVED' ? decimals(kpi.finalScore) : null, pending: kpi.status !== 'APPROVED' },
      { label: 'KPI Weight', value: String(kpi.kpiWeight), suffix: '%' },
      { label: 'Weighted Score', value: decimals(kpi.weightedScore) },
    ],
    stepper: stepper(kpi),
    evidence: evidenceFor(kpi),
    adjustmentHistory: kpi.adjustments,
    decisionHistory: kpi.decisions,
    escalations: kpi.escalations,
    corrections: [],
    canEdit: ['DRAFT', 'RETURNED'].includes(kpi.status) && !kpi.isLocked && (kpi.employeeId === currentUser().id || currentUser().role === 'SUPER_ADMIN'),
    canWithdraw: kpi.employeeId === currentUser().id && kpi.status === 'SUBMITTED' && !kpi.isLocked,
    canSubmit: kpi.employeeId === currentUser().id && ['DRAFT', 'RETURNED'].includes(kpi.status) && !kpi.isLocked,
    canDecide: kpi.employeeId !== currentUser().id && ['SUBMITTED', 'UNDER_REVIEW'].includes(kpi.status) && ['DEPT_HEAD', 'SUPER_ADMIN'].includes(currentUser().role),
    canRequestCorrection: currentUser().role === 'DEPT_HEAD' && kpi.status === 'APPROVED',
    canViewVersions: true,
    canRestore: currentUser().role === 'SUPER_ADMIN',
  };
};

// ------------------------------------------------------------- writes (demo)

/** Applies optimistic updates to the in-memory store so writes feel real. */
const mutateKpi = (id: string, patch: Partial<DemoKpi>): void => {
  const index = demoKpis.findIndex((k) => k.id === id);
  if (index >= 0) demoKpis[index] = { ...demoKpis[index], ...patch };
};

const recalc = (kpi: DemoKpi, patch: Partial<DemoKpi>): DemoKpi => {
  const merged = { ...kpi, ...patch };
  const result = calculateKpi({
    target: merged.target,
    actual: merged.rubricLevel ?? merged.actual,
    rubricLevel: merged.rubricLevel,
    kpiWeight: merged.kpiWeight,
    direction: merged.direction,
    measurementType: merged.measurementType as CalcMeasurementType,
    overrideScore: merged.overrideScore,
    config: demoCalcConfig,
  });
  return {
    ...merged,
    achievement: result.achievement,
    calculatedScore: result.calculatedScore,
    finalScore: merged.status === 'APPROVED' ? result.finalScore : result.calculatedScore,
    weightedScore: result.weightedScore,
    formulaText: result.formulaText,
  };
};

// ---------------------------------------------------------------- the resolver

const ROUTES: Array<{
  method: string;
  pattern: RegExp;
  handler: (match: RegExpMatchArray, req: DemoRequest) => DemoResponse | null;
}> = [
  // ------------------------------------------------------------------- health
  { method: 'GET', pattern: /^health$/, handler: () => ({ status: 200, data: { status: 'ok', service: 'anwar-kpi-api (demo)', version: '1.0.0', uptimeSeconds: 3600, checks: { database: 'up', redis: 'up', api: 'up' }, timestamp: new Date().toISOString() } }) },
  { method: 'GET', pattern: /^health\/system$/, handler: () => ({ status: 200, data: demoSystemHealth }) },

  // --------------------------------------------------------------------- auth
  {
    method: 'POST',
    pattern: /^auth\/login$/,
    handler: (_m, req) => {
      const body = (req.body ?? {}) as { email?: string; password?: string };
      const email = (body.email ?? '').trim().toLowerCase();
      // Demo mode accepts ANY company address so every visitor can sign in.
      // A known address signs in as that person; anything else signs in as the
      // demo Employee so the click never fails.
      const known = userByEmail(email);
      const user = known ?? (email.endsWith('@anwargroup.net') ? demoUsers.find((u) => u.role === 'EMPLOYEE')! : null);
      if (!user) {
        // Any other domain still gets in, demonstrating the Employee experience.
        const fallback = demoUsers.find((u) => u.role === 'EMPLOYEE')!;
        demoSignIn(fallback.email);
        return { status: 200, data: authPayload(fallback) };
      }
      demoSignIn(user.email);
      return { status: 200, data: authPayload(user) };
    },
  },
  {
    method: 'POST',
    pattern: /^auth\/refresh$/,
    handler: () => {
      // No role chosen yet → report "no session" so the SPA shows the sign-in screen.
      if (!hasDemoSession()) return { status: 401, data: null };
      return { status: 200, data: authPayload(currentUser()) };
    },
  },
  { method: 'POST', pattern: /^auth\/logout$/, handler: () => { demoSignOut(); return { status: 200, data: { message: 'Signed out.' } }; } },
  {
    method: 'GET',
    pattern: /^auth\/me$/,
    handler: () => {
      if (!hasDemoSession()) return { status: 401, data: null };
      return { status: 200, data: principal(currentUser()) };
    },
  },
  { method: 'GET', pattern: /^auth\/sessions$/, handler: () => ({ status: 200, data: [{ id: `demo-session-${currentUser().id.slice(0, 8)}`, userAgent: navigator.userAgent, ipAddress: '10.20.30.41', createdAt: new Date(Date.now() - 3600_000).toISOString(), lastSeenAt: new Date().toISOString(), idleExpiresAt: new Date(Date.now() + 1800_000).toISOString(), absoluteExpiresAt: new Date(Date.now() + 12 * 3600_000).toISOString() }] }) },
  { method: 'DELETE', pattern: /^auth\/sessions\/.+$/, handler: () => ({ status: 200, data: { message: 'Session revoked.' } }) },
  { method: 'POST', pattern: /^auth\/change-password$/, handler: () => ({ status: 200, data: { message: 'Password updated. Sign in again with your new password.' } }) },
  { method: 'POST', pattern: /^auth\/forgot-password$/, handler: () => ({ status: 200, data: { message: 'If an account exists for that address, a reset link has been sent.' } }) },
  { method: 'POST', pattern: /^auth\/resend-activation$/, handler: () => ({ status: 200, data: { message: 'If an account exists for that address, a new setup link has been sent.' } }) },
  { method: 'POST', pattern: /^auth\/register$/, handler: () => ({ status: 201, data: { status: 'PENDING_ACTIVATION', message: 'Check your inbox: a single-use setup link (valid 24 hours) has been sent.' } }) },
  { method: 'POST', pattern: /^auth\/set-password$/, handler: () => ({ status: 200, data: { email: currentUser().email, message: 'Password created. You can now sign in.' } }) },
  { method: 'POST', pattern: /^auth\/reset-password$/, handler: () => ({ status: 200, data: { email: currentUser().email, message: 'Password created. You can now sign in.' } }) },
  { method: 'GET', pattern: /^auth\/token\/.+$/, handler: () => ({ status: 200, data: { valid: false, expired: false, used: false, type: null } }) },
  { method: 'POST', pattern: /^auth\/password-policy$/, handler: () => ({ status: 200, data: { policy: { minLength: 10, maxLength: 64, rules: [] }, evaluation: { valid: true, failures: [], checks: {} } } }) },

  // -------------------------------------------------------------- profile
  {
    method: 'GET',
    pattern: /^me$/,
    handler: () => {
      const user = currentUser();
      const dept = demoDepartments.find((d) => d.id === user.departmentId);
      return {
        status: 200,
        data: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          employeeCode: user.employeeCode,
          status: 'ACTIVE',
          corporatePhone: user.corporatePhone,
          designationTitle: user.designation,
          organisationConfirmed: user.organisationConfirmed,
          emailDigest: user.emailDigest,
          avatarUrl: null,
          businessUnit: demoBusinessUnits.find((b) => b.id === user.businessUnitId) ?? null,
          department: dept ? { id: dept.id, name: dept.name } : null,
          roles: [{ code: user.role, name: demoRoleLabels[user.role] }],
          approvers: (dept?.heads ?? []).filter((h) => h.id !== user.id).map((h) => ({ id: h.id, fullName: h.fullName, email: h.email, designationTitle: 'Head of Department', isSuperAdmin: false })),
        },
      };
    },
  },
  { method: 'PATCH', pattern: /^me$/, handler: (_m, req) => { const body = (req.body ?? {}) as Record<string, unknown>; const user = currentUser(); if (str(body.corporatePhone)) user.corporatePhone = String(body.corporatePhone).replace(/^0/, '+880'); if (str(body.designationTitle)) user.designation = String(body.designationTitle); if (typeof body.emailDigest === 'boolean') user.emailDigest = body.emailDigest; return { status: 200, data: { message: 'Profile updated.' } }; } },

  // ------------------------------------------------------------- organisation
  { method: 'GET', pattern: /^organisation\/(public\/)?business-units$/, handler: (_m, req) => { const includeInactive = String((req.params ?? {}).includeInactive) === 'true'; return { status: 200, data: includeInactive ? demoBusinessUnits : demoBusinessUnits.filter((b) => b.isActive) }; } },
  {
    method: 'GET',
    pattern: /^organisation\/(public\/)?departments$/,
    handler: (_m, req) => {
      const businessUnitId = str((req.params ?? {}).businessUnitId);
      const includeInactive = String((req.params ?? {}).includeInactive) === 'true';
      let rows = demoDepartments;
      if (businessUnitId) rows = rows.filter((d) => d.businessUnitId === businessUnitId);
      if (!includeInactive) rows = rows.filter((d) => d.isActive);
      return { status: 200, data: rows };
    },
  },
  { method: 'GET', pattern: /^organisation\/tree$/, handler: () => ({ status: 200, data: demoBusinessUnits.map((bu) => ({ ...bu, departments: demoDepartments.filter((d) => d.businessUnitId === bu.id && d.isActive).map((d) => ({ id: d.id, name: d.name, code: d.code, employeeCount: d.employeeCount, heads: d.heads })) })) }) },
  { method: 'GET', pattern: /^organisation\/designations$/, handler: () => ({ status: 200, data: Array.from(new Set(demoUsers.map((u) => u.designation))).map((name, i) => ({ id: `desig-${i}`, name, isActive: true })) }) },
  { method: 'POST', pattern: /^organisation\/business-units$/, handler: () => ({ status: 201, data: { message: 'Business unit created (demo).' } }) },
  { method: 'PATCH', pattern: /^organisation\/business-units\/.+$/, handler: () => ({ status: 200, data: { message: 'Business unit updated (demo).' } }) },
  { method: 'POST', pattern: /^organisation\/business-units\/.+\/deactivate$/, handler: () => ({ status: 200, data: { message: 'Business unit deactivated (demo).' } }) },
  { method: 'POST', pattern: /^organisation\/departments$/, handler: () => ({ status: 201, data: { message: 'Department created (demo).' } }) },
  { method: 'PATCH', pattern: /^organisation\/departments\/.+$/, handler: () => ({ status: 200, data: { message: 'Department updated (demo).' } }) },
  { method: 'POST', pattern: /^organisation\/departments\/.+\/deactivate$/, handler: () => ({ status: 200, data: { message: 'Department deactivated (demo).' } }) },

  // ------------------------------------------------------------------ periods
  { method: 'GET', pattern: /^periods\/selectable$/, handler: () => ({ status: 200, data: [...demoPeriods].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)).map((p) => ({ id: p.id, code: p.code, label: p.label, frequency: p.frequency, status: p.status, year: p.year, periodIndex: p.periodIndex, startDate: p.startDate, endDate: p.endDate, submissionDeadline: p.submissionDeadline, reviewDeadline: p.reviewDeadline })) }) },
  {
    method: 'GET',
    pattern: /^admin\/periods$/,
    handler: (_m, req) => {
      const p = req.params ?? {};
      let rows = [...demoPeriods];
      if (str(p.frequency)) rows = rows.filter((r) => r.frequency === String(p.frequency));
      if (str(p.status)) rows = rows.filter((r) => r.status === String(p.status));
      if (str(p.year)) rows = rows.filter((r) => r.year === num(p.year));
      rows.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
      const page = num(p.page, 1);
      const size = num(p.size, 25);
      const items = rows.slice((page - 1) * size, page * size).map((period) => {
        const kpis = demoKpis.filter((k) => k.periodId === period.id && k.status !== 'DELETED');
        const remaining = daysRemaining(period.submissionDeadline);
        return {
          ...period,
          kpiCount: kpis.length,
          pendingCount: kpis.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status)).length,
          approvedCount: kpis.filter((k) => k.status === 'APPROVED').length,
          notSubmittedCount: kpis.filter((k) => k.status === 'NOT_SUBMITTED').length,
          snapshotCount: period.status === 'CLOSED' ? new Set(kpis.map((k) => k.employeeId)).size : 0,
          daysToDeadline: remaining,
          deadlineState: period.status === 'CLOSED' ? 'closed' : remaining < 0 ? 'overdue' : remaining === 0 ? 'due_today' : 'open',
        };
      });
      return { status: 200, data: { items, total: rows.length, page, size, totalPages: Math.max(1, Math.ceil(rows.length / size)) } };
    },
  },
  { method: 'POST', pattern: /^admin\/periods\/calendar$/, handler: () => ({ status: 200, data: { created: 0, existing: demoPeriods.length, periods: demoPeriods.length } }) },
  { method: 'GET', pattern: /^admin\/periods\/folders$/, handler: () => ({ status: 200, data: [] }) },
  { method: 'POST', pattern: /^admin\/periods\/.+\/close$/, handler: () => ({ status: 200, data: { message: 'Period closed (demo). Snapshots written.' } }) },
  { method: 'POST', pattern: /^admin\/periods\/.+\/reopen$/, handler: () => ({ status: 200, data: { message: 'Period reopened (demo).' } }) },
  { method: 'GET', pattern: /^admin\/periods\/.+\/outstanding$/, handler: () => ({ status: 200, data: { pending: [], notSubmitted: [], weightIncomplete: [] } }) },
  { method: 'POST', pattern: /^admin\/periods\/extensions$/, handler: () => ({ status: 201, data: { message: 'Extension granted (demo).' } }) },
  { method: 'GET', pattern: /^admin\/periods\/extensions$/, handler: () => ({ status: 200, data: [] }) },

  // ---------------------------------------------------------------------- KPI
  {
    method: 'GET',
    pattern: /^kpis$/,
    handler: (_m, req) => {
      const user = currentUser();
      const params = req.params ?? {};
      const periodId = str(params.periodId);
      const periodCode = str(params.periodCode);
      const explicitPeriod = periodId ? periodById(periodId) : periodCode ? periodByCode(periodCode) : undefined;
      const frequency = str(params.frequency);

      let rows = demoKpis.filter((k) => k.employeeId === user.id);
      if (explicitPeriod) rows = rows.filter((k) => k.periodId === explicitPeriod.id);
      else if (frequency) rows = rows.filter((k) => k.frequency === frequency);
      if (str(params.search)) rows = rows.filter((k) => k.name.toLowerCase().includes(String(params.search).toLowerCase()));
      if (str(params.categoryId)) {
        const cat = demoCategories.find((c) => c.id === params.categoryId);
        if (cat) rows = rows.filter((k) => k.categoryCode === cat.code);
      }

      const counts: Record<string, number> = {};
      rows.forEach((k) => {
        counts[k.status] = (counts[k.status] ?? 0) + 1;
      });
      const filtered = str(params.status) ? rows.filter((k) => k.status === params.status) : rows;
      const page = num(params.page, 1);
      const size = num(params.size, 50);
      const allocated = rows.filter((k) => !['REJECTED', 'DELETED'].includes(k.status)).reduce((a, k) => a + k.kpiWeight, 0);

      // The API returns the current period when no period filter is supplied.
      const fallback = explicitPeriod ?? periodByCode('2026-09');
      return {
        status: 200,
        data: {
          items: filtered.slice((page - 1) * size, page * size).map(cardOf),
          counts,
          total: filtered.length,
          page,
          size,
          totalPages: Math.max(1, Math.ceil(filtered.length / size)),
          period: fallback,
          allocatedWeight: allocated,
          availableWeight: Math.max(0, 100 - allocated),
        },
      };
    },
  },
  { method: 'POST', pattern: /^kpis\/preview-calculation$/, handler: (_m, req) => { const b = (req.body ?? {}) as Record<string, unknown>; const r = calculateKpi({ target: num(b.target) || null, actual: num(b.actual) || null, rubricLevel: b.rubricLevel ? num(b.rubricLevel) : null, kpiWeight: num(b.kpiWeight, 10), direction: (b.direction as 'HIGHER' | 'LOWER') ?? 'HIGHER', measurementType: (b.measurementType as CalcMeasurementType) ?? 'COUNT', overrideScore: b.overrideScore !== undefined ? num(b.overrideScore) : null, config: demoCalcConfig }); return { status: 200, data: { achievement: decimals(r.achievement), calculatedScore: decimals(r.calculatedScore), finalScore: decimals(r.finalScore), weightedScore: decimals(r.weightedScore), formulaText: r.formulaText, capped: r.capped, floored: r.floored, cap: demoConfig.scoreCap, floor: demoConfig.scoreFloor } }; } },
  { method: 'GET', pattern: /^kpis\/meta\/weights$/, handler: (_m, req) => { const user = currentUser(); const p = req.params ?? {}; const periodId = str(p.periodId) ?? periodByCode('2026-09')!.id; const rows = demoKpis.filter((k) => k.employeeId === user.id && k.periodId === periodId && !['REJECTED', 'DELETED'].includes(k.status)); const allocated = rows.reduce((a, k) => a + k.kpiWeight, 0); return { status: 200, data: { allocated, available: Math.max(0, 100 - allocated), complete: allocated === 100, warning: allocated < 100 ? `Weight allocated ${allocated} / 100%` : null, minWeight: demoConfig.minWeight, maxWeight: demoConfig.maxWeight, maxKpisPerPeriod: demoConfig.maxKpisPerPeriod, kpiCount: rows.length, remainingKpis: Math.max(0, demoConfig.maxKpisPerPeriod - rows.length) } }; } },
  {
    method: 'GET',
    pattern: /^kpis\/meta\/approvers$/,
    handler: () => {
      const user = currentUser();
      if (user.role === 'DEPT_HEAD' || user.role === 'SUPER_ADMIN') {
        return { status: 200, data: { mode: 'SUPER_ADMIN', options: [], message: 'Your KPIs are routed to the Super Admin queue (Department Head KPI Requests).' } };
      }
      const heads = demoDepartments.find((d) => d.id === user.departmentId)?.heads ?? [];
      const options = heads.filter((h) => h.id !== user.id).map((h) => ({ id: h.id, fullName: h.fullName, employeeCode: h.employeeCode, designationTitle: 'Head of Department', email: h.email }));
      return { status: 200, data: { mode: options.length === 1 ? 'PRESELECTED' : 'SELECT', options, message: options.length ? null : 'Your department has no active approver yet.' } };
    },
  },
  { method: 'GET', pattern: /^kpis\/meta\/categories$/, handler: () => ({ status: 200, data: demoCategories }) },
  { method: 'GET', pattern: /^kpis\/meta\/reference$/, handler: () => ({ status: 200, data: { rejectCategories: [{ code: 'NOT_MEASURABLE', label: 'Not measurable' }, { code: 'NOT_ALIGNED_TO_ROLE', label: 'Not aligned to role' }, { code: 'DUPLICATE', label: 'Duplicate' }, { code: 'INSUFFICIENT_EVIDENCE', label: 'Insufficient evidence' }, { code: 'OTHER', label: 'Other' }], measurementTypes: [] } }) },
  {
    method: 'GET',
    pattern: /^kpis\/([0-9a-f-]+)$/,
    handler: (m) => {
      const kpi = kpiById(m[1]);
      return kpi ? { status: 200, data: detailOf(kpi) } : { status: 404, data: null };
    },
  },
  {
    method: 'POST',
    pattern: /^kpis$/,
    handler: (_m, req) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const user = currentUser();
      const period = periodById(str(b.periodId) ?? '') ?? periodByCode('2026-09')!;
      const cat = demoCategories.find((c) => c.id === b.categoryId) ?? demoCategories[0];
      const spec = {
        name: String(b.name ?? 'Untitled KPI'),
        categoryCode: cat.code as DemoKpi['categoryCode'],
        measurementType: (b.measurementType as CalcMeasurementType) ?? 'COUNT',
        unit: String(b.unit ?? 'units'),
        direction: (b.direction as 'HIGHER' | 'LOWER') ?? 'HIGHER',
        target: b.target !== undefined && b.target !== null ? num(b.target) : null,
        actual: b.actual !== undefined && b.actual !== null ? num(b.actual) : null,
        weight: num(b.kpiWeight, 10),
        remarks: String(b.remarks ?? ''),
      };
      const result = calculateKpi({ target: spec.target, actual: spec.actual, kpiWeight: spec.weight, direction: spec.direction, measurementType: spec.measurementType, config: demoCalcConfig });
      const id = `demo-${Math.random().toString(16).slice(2, 10)}-0000-4000-8000-000000000000`;
      const buCode = demoBusinessUnits.find((x) => x.id === user.businessUnitId)?.code ?? 'GRP';
      const kpi: DemoKpi = {
        id,
        code: `KPI-${buCode}-${period.code.slice(0, 4)}-${String(demoKpis.length + 1).padStart(6, '0')}`,
        employeeId: user.id,
        periodId: period.id,
        frequency: period.frequency,
        name: spec.name,
        description: spec.remarks,
        categoryCode: spec.categoryCode,
        categoryName: cat.name,
        measurementType: spec.measurementType,
        unit: spec.unit,
        direction: spec.direction,
        target: spec.target,
        actual: spec.actual,
        rubricLevel: spec.measurementType === 'QUALITATIVE' ? 3 : null,
        achievement: result.achievement,
        calculatedScore: result.calculatedScore,
        finalScore: result.calculatedScore,
        overrideScore: null,
        kpiWeight: spec.weight,
        weightedScore: result.weightedScore,
        status: 'DRAFT',
        isLocked: period.status === 'CLOSED',
        isAssigned: false,
        remarks: spec.remarks,
        evidenceCount: 0,
        approverId: str(b.approverId) ?? null,
        departmentId: user.departmentId,
        businessUnitId: user.businessUnitId,
        submittedAt: null,
        reviewStartedAt: null,
        decidedAt: null,
        returnComment: null,
        rejectCategory: null,
        rejectedReason: null,
        rowVersion: 1,
        currentVersionNo: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        formulaText: result.formulaText,
        adjustments: [],
        decisions: [],
        versions: [],
        evidence: [],
        escalations: [],
      };
      demoKpis.push(kpi);
      return { status: 201, data: detailOf(kpi) };
    },
  },
  {
    method: 'PATCH',
    pattern: /^kpis\/([0-9a-f-]+(?:demo-[0-9a-f-]+)?)$/,
    handler: (m, req) => {
      const kpi = kpiById(m[1]);
      if (!kpi) return { status: 404, data: null };
      const b = (req.body ?? {}) as Record<string, unknown>;
      const patch: Partial<DemoKpi> = {};
      if (str(b.name)) patch.name = String(b.name);
      if (str(b.description) !== undefined) patch.description = String(b.description ?? '');
      if (str(b.unit)) patch.unit = String(b.unit);
      if (b.measurementType) patch.measurementType = b.measurementType as CalcMeasurementType;
      if (b.direction) patch.direction = b.direction as 'HIGHER' | 'LOWER';
      if (str(b.periodId)) patch.periodId = String(b.periodId);
      if (b.target !== undefined) patch.target = b.target === null ? null : num(b.target);
      if (b.actual !== undefined) patch.actual = b.actual === null ? null : num(b.actual);
      if (b.rubricLevel !== undefined) patch.rubricLevel = b.rubricLevel === null ? null : num(b.rubricLevel);
      if (b.kpiWeight !== undefined) patch.kpiWeight = num(b.kpiWeight);
      if (str(b.remarks) !== undefined) patch.remarks = String(b.remarks ?? '');
      if (str(b.approverId)) patch.approverId = String(b.approverId);
      const next = recalc(kpi, { ...patch, rowVersion: kpi.rowVersion + 1 });
      mutateKpi(kpi.id, next);
      return { status: 200, data: detailOf(next) };
    },
  },
  { method: 'DELETE', pattern: /^kpis\/.+$/, handler: (m) => { mutateKpi(m[0].split('/')[1], { status: 'DELETED' }); return { status: 200, data: { message: 'Draft deleted. Its weight has been released.' } }; } },
  {
    method: 'POST',
    pattern: /^kpis\/([0-9a-f-]+(?:demo-[0-9a-f-]+)?)\/submit$/,
    handler: (m) => {
      const kpi = kpiById(m[1]);
      if (!kpi) return { status: 404, data: null };
      const next = recalc(kpi, { status: 'SUBMITTED', submittedAt: new Date().toISOString(), reviewStartedAt: null, evidenceCount: kpi.evidenceCount || 1, rowVersion: kpi.rowVersion + 1, currentVersionNo: kpi.currentVersionNo + (kpi.status === 'RETURNED' ? 1 : 0), returnComment: null });
      mutateKpi(kpi.id, next);
      demoNotifications.unshift({ id: `nt-submit-${Date.now()}`, userId: next.approverId ?? demoUsers[0].id, code: 'NT-05', title: `KPI submitted for your review: ${next.name}`, body: 'A KPI is waiting for your decision.', deepLink: `/approvals?kpi=${next.id}`, entityType: 'kpi', entityId: next.id, status: 'UNREAD', severity: 'info', readAt: null, createdAt: new Date().toISOString() });
      return { status: 200, data: detailOf(next) };
    },
  },
  { method: 'POST', pattern: /^kpis\/([0-9a-f-]+(?:demo-[0-9a-f-]+)?)\/withdraw$/, handler: (m) => { const kpi = kpiById(m[1]); if (!kpi) return { status: 404, data: null }; mutateKpi(kpi.id, { status: 'DRAFT', submittedAt: null, reviewStartedAt: null, rowVersion: kpi.rowVersion + 1 }); return { status: 200, data: detailOf(kpiById(m[1])!) }; } },
  { method: 'POST', pattern: /^kpis\/.+\/restore$/, handler: () => ({ status: 200, data: { status: 'DRAFT', message: 'KPI restored as a Draft.' } }) },
  {
    method: 'GET',
    pattern: /^kpis\/([0-9a-f-]+(?:demo-[0-9a-f-]+)?)\/versions$/,
    handler: (m) => {
      const kpi = kpiById(m[1]);
      if (!kpi) return { status: 200, data: [] };
      const rows = [...kpi.versions].reverse().map((v) => ({ ...v, createdBy: v.createdBy, createdAt: v.createdAt }));
      if (!rows.length) {
        rows.push({ id: `${kpi.id}-v1`, versionNo: 1, trigger: 'CREATE', changeReason: 'Draft created', createdBy: userById(kpi.employeeId)?.fullName ?? 'Employee', createdAt: kpi.createdAt, snapshot: { name: kpi.name, target: kpi.target, actual: kpi.actual, kpiWeight: kpi.kpiWeight, status: kpi.status }, calculation: null });
      }
      return { status: 200, data: rows };
    },
  },
  {
    method: 'GET',
    pattern: /^kpis\/([0-9a-f-]+(?:demo-[0-9a-f-]+)?)\/versions\/(\d+)\/diff\/(\d+)$/,
    handler: (m) => {
      const kpi = kpiById(m[1]);
      const from = kpi?.versions.find((v) => v.versionNo === num(m[2]));
      const to = kpi?.versions.find((v) => v.versionNo === num(m[3]));
      const a = (from?.snapshot ?? {}) as Record<string, unknown>;
      const b = (to?.snapshot ?? {}) as Record<string, unknown>;
      const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
      const changes = keys.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)).map((k) => ({ field: k, from: a[k] ?? null, to: b[k] ?? null }));
      return { status: 200, data: { from: { versionNo: num(m[2]), createdAt: from?.createdAt ?? null, trigger: from?.trigger ?? '' }, to: { versionNo: num(m[3]), createdAt: to?.createdAt ?? null, trigger: to?.trigger ?? '' }, changes } };
    },
  },
  { method: 'POST', pattern: /^kpis\/.+\/versions\/restore$/, handler: () => ({ status: 200, data: { message: 'Version restored as a new version (demo).' } }) },
  { method: 'GET', pattern: /^kpis\/.+\/report$/, handler: (m) => { const kpi = kpiById(m[0].split('/')[1]); return { status: 200, data: { generatedAt: new Date().toISOString(), generatedBy: { id: currentUser().id, name: currentUser().fullName, email: currentUser().email }, detail: kpi ? detailOf(kpi) : null } }; } },

  // ----------------------------------------------------------------- evidence
  { method: 'POST', pattern: /^kpis\/.+\/evidence$/, handler: () => ({ status: 201, data: { uploaded: 1, files: [{ id: `ev-${Date.now()}`, originalName: 'evidence.csv', mimeType: 'text/csv', sizeBytes: 2048, sha256: 'a'.repeat(64), scanStatus: 'CLEAN', createdAt: new Date().toISOString() }] } }) },
  { method: 'DELETE', pattern: /^kpis\/.+\/evidence\/.+$/, handler: () => ({ status: 200, data: { message: 'Evidence removed.' } }) },
  { method: 'GET', pattern: /^evidence\/.+\/url$/, handler: () => ({ status: 200, data: { url: '#', expiresAt: new Date(Date.now() + 300_000).toISOString(), ttlSeconds: 300, originalName: 'evidence.csv', mimeType: 'text/csv', sha256: 'a'.repeat(64) } }) },

  // ---------------------------------------------------------------- approvals
  {
    method: 'GET',
    pattern: /^approvals$/,
    handler: (_m, req) => queueResponse(req, false),
  },
  { method: 'GET', pattern: /^approvals\/all$/, handler: (_m, req) => queueResponse(req, true) },
  {
    method: 'GET',
    pattern: /^approvals\/department-heads$/,
    handler: (_m, req) => {
      const rows = demoKpis.filter((k) => k.approverId === null && ['SUBMITTED', 'UNDER_REVIEW'].includes(k.status));
      const p = req.params ?? {};
      const page = num(p.page, 1);
      const size = num(p.size, 25);
      return {
        status: 200,
        data: {
          items: rows.slice((page - 1) * size, page * size).map((k) => {
            const employee = userById(k.employeeId)!;
            return {
              id: k.id, code: k.code, name: k.name, status: k.status, submittedAt: k.submittedAt,
              target: k.target !== null ? decimals(k.target) : null, actual: k.actual !== null ? decimals(k.actual) : null,
              achievement: decimals(k.achievement), calculatedScore: decimals(k.calculatedScore), finalScore: decimals(k.finalScore),
              kpiWeight: k.kpiWeight, evidenceCount: k.evidenceCount, rowVersion: k.rowVersion,
              employee: { id: employee.id, fullName: employee.fullName, employeeCode: employee.employeeCode, designationTitle: employee.designation },
              department: { id: k.departmentId, name: demoDepartments.find((d) => d.id === k.departmentId)?.name ?? '—' },
              period: { id: k.periodId, label: periodById(k.periodId)?.label ?? '' },
              category: { name: k.categoryName },
              ageDays: k.submittedAt ? workingDaysBetween(k.submittedAt, new Date()) : 0,
            };
          }),
          total: rows.length,
          page,
          size,
          totalPages: Math.max(1, Math.ceil(rows.length / size)),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: /^approvals\/counts$/,
    handler: () => {
      const user = currentUser();
      const pending = demoKpis.filter((k) => ['SUBMITTED', 'UNDER_REVIEW'].includes(k.status));
      const scoped = vis(user).filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status) && k.employeeId !== user.id);
      return {
        status: 200,
        data: {
          pending: pending.length,
          headKpis: pending.filter((k) => k.approverId === null).length,
          escalations: demoEscalations.filter((e) => e.status === 'PENDING').length,
          corrections: demoCorrections.filter((c) => c.status === 'PENDING').length,
          deptQueue: scoped.length,
        },
      };
    },
  },
  { method: 'POST', pattern: /^kpis\/.+\/review-start$/, handler: (m) => { const id = m[0].split('/')[1]; const kpi = kpiById(id); if (!kpi) return { status: 404, data: null }; mutateKpi(id, { status: 'UNDER_REVIEW', reviewStartedAt: new Date().toISOString(), rowVersion: kpi.rowVersion + 1 }); return { status: 200, data: { id, status: 'UNDER_REVIEW' } }; } },
  {
    method: 'POST',
    pattern: /^kpis\/(.+)\/decision$/,
    handler: (m, req) => {
      const id = m[1];
      const kpi = kpiById(id);
      if (!kpi) return { status: 404, data: null };
      const b = (req.body ?? {}) as { action?: string; reason?: string; overrideScore?: number; changes?: Record<string, number>; rejectCategory?: string };
      const action = b.action ?? 'approve';

      if (action === 'approve') {
        mutateKpi(id, { status: 'APPROVED', finalScore: kpi.calculatedScore, decidedAt: new Date().toISOString(), rowVersion: kpi.rowVersion + 1, currentVersionNo: kpi.currentVersionNo + 1 });
        return { status: 200, data: { id, status: 'APPROVED', escalated: false, finalScore: decimals(kpi.calculatedScore) } };
      }
      if (action === 'adjust') {
        const nextTarget = b.changes?.target ?? kpi.target;
        const nextActual = b.changes?.actual ?? kpi.actual;
        const nextWeight = b.changes?.kpiWeight ?? kpi.kpiWeight;
        const override = b.overrideScore !== undefined ? num(b.overrideScore) : null;
        const adjusted = recalc(kpi, { target: nextTarget, actual: nextActual, kpiWeight: nextWeight, overrideScore: override, rowVersion: kpi.rowVersion + 1 });
        const delta = roundHalfUp(Math.abs(adjusted.finalScore - kpi.calculatedScore));
        const escalated = delta > num(demoConfig.adjustmentBand);
        mutateKpi(id, { ...adjusted, status: escalated ? 'ESCALATED' : 'APPROVED', decidedAt: escalated ? kpi.decidedAt : new Date().toISOString(), currentVersionNo: kpi.currentVersionNo + 1 });
        return { status: 200, data: { id, status: escalated ? 'ESCALATED' : 'APPROVED', escalated, delta: decimals(delta), proposedScore: decimals(adjusted.finalScore), finalScore: decimals(adjusted.finalScore), message: escalated ? `Δ ${decimals(delta)} is outside the ±${demoConfig.adjustmentBand} band — escalated to a Super Admin.` : `Δ ${decimals(delta)} is within the band — approved with the adjusted score.` } };
      }
      if (action === 'return') {
        mutateKpi(id, { status: 'RETURNED', returnComment: b.reason ?? null, submittedAt: kpi.submittedAt, rowVersion: kpi.rowVersion + 1 });
        return { status: 200, data: { id, status: 'RETURNED', message: 'Returned to the employee with your comment.' } };
      }
      if (action === 'reject') {
        mutateKpi(id, { status: 'REJECTED', rejectedReason: b.reason ?? null, rejectCategory: b.rejectCategory ?? null, decidedAt: new Date().toISOString(), rowVersion: kpi.rowVersion + 1 });
        return { status: 200, data: { id, status: 'REJECTED', message: 'Rejected. The weight has been released.' } };
      }
      if (action === 'delete') {
        mutateKpi(id, { status: 'DELETED', rowVersion: kpi.rowVersion + 1 });
        return { status: 200, data: { id, status: 'DELETED', message: 'KPI soft-deleted and its weight released.' } };
      }
      return { status: 200, data: { id, status: kpi.status } };
    },
  },
  { method: 'POST', pattern: /^approvals\/bulk-approve$/, handler: (_m, req) => { const b = (req.body ?? {}) as { ids?: string[] }; const ids = b.ids ?? []; const results = ids.map((id) => { const kpi = kpiById(id); if (kpi) mutateKpi(id, { status: 'APPROVED', finalScore: kpi.calculatedScore, decidedAt: new Date().toISOString() }); return { id, ok: Boolean(kpi), status: 'APPROVED' }; }); return { status: 200, data: { approved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results } }; } },
  { method: 'GET', pattern: /^escalations$/, handler: (_m, req) => { const status = str((req.params ?? {}).status) ?? 'PENDING'; const rows = demoEscalations.filter((e) => e.status === status); return { status: 200, data: { items: rows.map((e) => { const kpi = kpiById(e.kpiId)!; const employee = userById(kpi?.employeeId ?? ''); return { id: e.id, kpiId: kpi?.id ?? '', kpiCode: kpi?.code ?? '', kpi: kpi?.name ?? '', employeeName: employee?.fullName ?? '—', employeeCode: employee?.employeeCode ?? '—', designation: employee?.designation ?? '—', department: demoDepartments.find((d) => d.id === kpi?.departmentId)?.name ?? '—', period: periodById(kpi?.periodId ?? '')?.label ?? '—', category: kpi?.categoryName ?? '—', target: kpi?.target !== null && kpi?.target !== undefined ? decimals(kpi.target) : null, actual: kpi?.actual !== null && kpi?.actual !== undefined ? decimals(kpi.actual) : null, achievement: kpi ? decimals(kpi.achievement) : null, kpiWeight: kpi?.kpiWeight ?? 0, evidenceCount: kpi?.evidenceCount ?? 0, calculatedScore: e.calculatedScore, proposedScore: e.proposedScore, delta: e.delta, reason: e.reason, requestedBy: userById(e.requestedById)?.fullName ?? '—', createdAt: e.createdAt, ageDays: workingDaysBetween(e.createdAt, new Date()), status: e.status, pendingChanges: { actual: kpi?.actual } }; }), total: rows.length, page: 1, size: 25, totalPages: 1 } }; } },
  { method: 'POST', pattern: /^escalations\/(.+)\/decision$/, handler: (m, req) => { const b = (req.body ?? {}) as { decision?: string }; const esc = demoEscalations.find((e) => e.id === m[1]); if (!esc) return { status: 404, data: null }; const approve = b.decision === 'APPROVE'; esc.status = approve ? 'APPROVED' : 'DECLINED'; const kpi = kpiById(esc.kpiId); if (kpi) { if (approve) { mutateKpi(kpi.id, { status: 'APPROVED', finalScore: num(esc.proposedScore), overrideScore: num(esc.proposedScore), decidedAt: new Date().toISOString() }); } else { mutateKpi(kpi.id, { status: 'UNDER_REVIEW', finalScore: kpi.calculatedScore, overrideScore: null }); } } return { status: 200, data: { id: m[1], decision: b.decision, message: approve ? 'Escalated adjustment approved.' : 'Declined — the KPI returned to Under Review.' } }; } },
  { method: 'GET', pattern: /^corrections$/, handler: () => ({ status: 200, data: demoCorrections }) },
  {
    method: 'POST',
    pattern: /^corrections$/,
    handler: (_m, req): DemoResponse => {
      const body = (req.body ?? {}) as { kpiId?: string; reason?: string };
      const kpi = kpiById(String(body.kpiId ?? ''));
      const employee = userById(kpi?.employeeId ?? '');
      demoCorrections.unshift({
        id: `corr-${Date.now()}`,
        reason: String(body.reason ?? ''),
        status: 'PENDING',
        changes: {} as Record<string, unknown>,
        createdAt: new Date().toISOString(),
        requester: currentUser().fullName,
        decidedBy: null,
        decidedAt: null,
        decisionComment: null,
        kpi: {
          id: kpi?.id ?? '',
          code: kpi?.code ?? '',
          name: kpi?.name ?? '',
          status: kpi?.status ?? 'APPROVED',
          employee: employee?.fullName ?? '\u2014',
          employeeCode: employee?.employeeCode ?? '\u2014',
          department: dename(kpi?.departmentId),
          period: periodById(kpi?.periodId ?? '')?.label ?? '\u2014',
          calculatedScore: kpi ? decimals(kpi.calculatedScore) : '0.00',
          finalScore: kpi ? decimals(kpi.finalScore) : '0.00',
        },
      });
      return { status: 201, data: { status: 'PENDING', message: 'Correction request sent to the Super Admin.' } };
    },
  },
  { method: 'POST', pattern: /^corrections\/(.+)\/decision$/, handler: (m, req) => { const b = (req.body ?? {}) as { decision?: string }; const row = demoCorrections.find((c) => c.id === m[1]); if (row) { row.status = b.decision === 'APPROVE' ? 'APPROVED' : 'DECLINED'; row.decidedBy = currentUser().fullName; row.decidedAt = new Date().toISOString(); row.decisionComment = null; } return { status: 200, data: { decision: b.decision, message: b.decision === 'APPROVE' ? 'Correction approved; a new version was created.' : 'Correction declined.' } }; } },

  // --------------------------------------------------------------- dashboards
  { method: 'GET', pattern: /^dashboard\/employee$/, handler: (_m, req) => { const p = req.params ?? {}; const requested = str(p.employeeId); const target = requested && currentUser().role !== 'EMPLOYEE' ? userById(requested) ?? currentUser() : currentUser(); const period = periodById(str(p.periodId) ?? '') ?? periodByCode(str(p.periodCode) ?? '') ?? periodByCode('2026-08')!; return { status: 200, data: employeeDashboard(target, period) }; } },
  { method: 'GET', pattern: /^dashboard\/department$/, handler: (_m, req) => { const p = req.params ?? {}; const period = periodById(str(p.periodId) ?? '') ?? periodByCode(str(p.periodCode) ?? '') ?? periodByCode('2026-08')!; return { status: 200, data: departmentDashboard(period, str(p.departmentId)) }; } },
  { method: 'GET', pattern: /^dashboard\/group$/, handler: (_m, req) => { const p = req.params ?? {}; const period = periodById(str(p.periodId) ?? '') ?? periodByCode(str(p.periodCode) ?? '') ?? periodByCode('2026-08')!; return { status: 200, data: groupDashboard(period, str(p.businessUnitId), str(p.departmentId)) }; } },
  { method: 'GET', pattern: /^dashboard\/drill-down$/, handler: (_m, req) => drillDown(req) },
  { method: 'GET', pattern: /^kpis\/drill-down\/(.+)$/, handler: (m, req) => kpiDrillDown(m[1], req) },
  { method: 'GET', pattern: /^leaderboard$/, handler: (_m, req) => { const p = req.params ?? {}; const period = periodById(str(p.periodId) ?? '') ?? periodByCode(str(p.periodCode) ?? '') ?? periodByCode('2026-08')!; const lb = leaderboardFor(period, str(p.departmentId)); return { status: 200, data: { period, entries: lb } }; } },

  // ------------------------------------------------------------------ reports
  { method: 'GET', pattern: /^reports$/, handler: () => ({ status: 200, data: REPORT_CATALOGUE.filter((r) => true) }) },
  { method: 'GET', pattern: /^reports\/meta\/filters$/, handler: () => ({ status: 200, data: { businessUnits: demoBusinessUnits, departments: demoDepartments.map((d) => ({ id: d.id, name: d.name, businessUnitId: d.businessUnitId })), periods: demoPeriods.map((p) => ({ id: p.id, code: p.code, label: p.label, frequency: p.frequency, status: p.status })), categories: demoCategories, approvers: demoUsers.filter((u) => u.role === 'DEPT_HEAD').map((u) => ({ id: u.id, fullName: u.fullName })) } }) },
  { method: 'GET', pattern: /^reports\/meta\/exports\/mine$/, handler: () => ({ status: 200, data: [] }) },
  { method: 'GET', pattern: /^reports\/(RP-\d+)$/, handler: (m, req) => reportPreview(m[1], req) },
  { method: 'POST', pattern: /^reports\/(RP-\d+)\/export$/, handler: (m, req) => reportExport(m[1], req) },

  // ------------------------------------------------------------ notifications
  {
    method: 'GET',
    pattern: /^notifications$/,
    handler: (_m, req) => {
      const user = currentUser();
      const p = req.params ?? {};
      const unreadOnly = String(p.unreadOnly) === 'true';
      let rows = demoNotifications.filter((n) => n.userId === user.id);
      if (unreadOnly) rows = rows.filter((n) => n.status === 'UNREAD');
      const page = num(p.page, 1);
      const size = num(p.size, 25);
      return { status: 200, data: { items: rows.slice((page - 1) * size, page * size), total: rows.length, unread: rows.filter((n) => n.status === 'UNREAD').length, page, size, totalPages: Math.max(1, Math.ceil(rows.length / size)) } };
    },
  },
  { method: 'GET', pattern: /^notifications\/unread-count$/, handler: () => ({ status: 200, data: { unread: demoNotifications.filter((n) => n.userId === currentUser().id && n.status === 'UNREAD').length } }) },
  { method: 'PATCH', pattern: /^notifications\/read$/, handler: (_m, req) => { const b = (req.body ?? {}) as { ids?: string[] }; let updated = 0; demoNotifications.forEach((n) => { if ((b.ids ?? []).includes(n.id)) { n.status = 'READ'; n.readAt = new Date().toISOString(); updated += 1; } }); return { status: 200, data: { updated } }; } },
  { method: 'POST', pattern: /^notifications\/read-all$/, handler: () => { let updated = 0; demoNotifications.forEach((n) => { if (n.userId === currentUser().id && n.status === 'UNREAD') { n.status = 'READ'; n.readAt = new Date().toISOString(); updated += 1; } }); return { status: 200, data: { updated } }; } },
  { method: 'POST', pattern: /^notifications\/preview$/, handler: () => ({ status: 200, data: { subject: 'ANWAR KPIFlow notification (demo)', html: '<p>Template preview</p>', text: 'Template preview' } }) },

  // -------------------------------------------------------------------- audit
  {
    method: 'GET',
    pattern: /^audit-logs$/,
    handler: (_m, req) => {
      const p = req.params ?? {};
      let rows = demoAuditLog;
      if (str(p.action)) rows = rows.filter((r) => r.action.includes(String(p.action)));
      if (str(p.entityType)) rows = rows.filter((r) => r.entityType === String(p.entityType));
      if (str(p.actorId)) rows = rows.filter((r) => r.actor?.id === String(p.actorId));
      const page = num(p.page, 1);
      const size = num(p.size, 25);
      return { status: 200, data: { items: rows.slice((page - 1) * size, page * size), total: rows.length, page, size, totalPages: Math.max(1, Math.ceil(rows.length / size)) } };
    },
  },
  { method: 'GET', pattern: /^audit-logs\/verify$/, handler: () => ({ status: 200, data: { ok: true, checked: demoAuditLog.length } }) },
  { method: 'GET', pattern: /^audit-logs\/entity-types$/, handler: () => ({ status: 200, data: ['user', 'kpi', 'kpi_evidence', 'kpi_period', 'kpi_decision', 'escalation', 'correction_request', 'configuration_version', 'report', 'audit_log'] }) },

  // ------------------------------------------------------------- kpi library
  { method: 'GET', pattern: /^kpi-library\/templates$/, handler: () => ({ status: 200, data: demoTemplates }) },
  { method: 'GET', pattern: /^kpi-library\/templates\/.+$/, handler: (m) => { const t = demoTemplates.find((x) => x.id === m[0].split('/')[2]); return { status: 200, data: t ?? null }; } },
  { method: 'POST', pattern: /^kpi-library\/templates$/, handler: () => ({ status: 201, data: { message: 'Template created (demo).' } }) },
  { method: 'PATCH', pattern: /^kpi-library\/templates\/.+$/, handler: () => ({ status: 200, data: { message: 'Template updated — a new version was created (demo).' } }) },
  { method: 'POST', pattern: /^kpi-library\/templates\/.+\/publish$/, handler: () => ({ status: 200, data: { message: 'Template published (demo).' } }) },
  { method: 'GET', pattern: /^kpi-library\/categories$/, handler: () => ({ status: 200, data: demoCategories }) },
  { method: 'POST', pattern: /^kpi-library\/assignments$/, handler: (_m, req) => { const b = (req.body ?? {}) as { rows?: Array<{ employeeId: string; target: number; weight: number }> }; const rows = b.rows ?? []; return { status: 201, data: { created: rows.length, conflicts: [], assignments: rows.map((r) => ({ employeeId: r.employeeId, kpiId: `assigned-${r.employeeId.slice(0, 6)}` })) } }; } },

  // --------------------------------------------------------- configuration
  { method: 'GET', pattern: /^admin\/configuration-versions$/, handler: () => ({ status: 200, data: [demoConfig] }) },
  { method: 'GET', pattern: /^admin\/configuration-versions\/active$/, handler: () => ({ status: 200, data: demoConfig }) },
  { method: 'POST', pattern: /^admin\/configuration-versions$/, handler: () => ({ status: 201, data: { message: 'Configuration version published (demo).' } }) },
  { method: 'POST', pattern: /^admin\/configuration-versions\/recalculate$/, handler: () => ({ status: 200, data: { checked: demoKpis.length, changed: 0, changedKpis: [] } }) },

  // ------------------------------------------------------------------- users
  {
    method: 'GET',
    pattern: /^admin\/users$/,
    handler: (_m, req) => {
      const p = req.params ?? {};
      let rows = demoUsers;
      if (str(p.businessUnitId)) rows = rows.filter((u) => u.businessUnitId === p.businessUnitId);
      if (str(p.departmentId)) rows = rows.filter((u) => u.departmentId === p.departmentId);
      if (str(p.roleCode)) rows = rows.filter((u) => u.role === p.roleCode);
      if (str(p.status)) rows = rows.filter(() => p.status === 'ACTIVE');
      if (str(p.search)) {
        const q = String(p.search).toLowerCase();
        rows = rows.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.employeeCode.toLowerCase().includes(q));
      }
      const page = num(p.page, 1);
      const size = num(p.size, 25);
      return {
        status: 200,
        data: {
          items: rows.slice((page - 1) * size, page * size).map((u) => ({
            id: u.id, fullName: u.fullName, email: u.email, employeeCode: u.employeeCode, status: 'ACTIVE',
            corporatePhone: u.corporatePhone, designationTitle: u.designation, organisationConfirmed: u.organisationConfirmed,
            businessUnit: demoBusinessUnits.find((b) => b.id === u.businessUnitId) ?? null,
            department: { id: u.departmentId, name: dename(u.departmentId) },
            roles: [{ code: u.role, name: demoRoleLabels[u.role] }],
            departmentHeadOf: u.departmentHeadOf.map((id) => ({ id, name: dename(id) })),
          })),
          total: rows.length, page, size, totalPages: Math.max(1, Math.ceil(rows.length / size)),
        },
      };
    },
  },
  { method: 'GET', pattern: /^admin\/users\/.+$/, handler: (m) => { const u = userById(m[0].split('/')[2]); return { status: 200, data: u ?? null }; } },
  { method: 'PATCH', pattern: /^admin\/users\/.+$/, handler: () => ({ status: 200, data: { message: 'User updated (demo).' } }) },
  { method: 'POST', pattern: /^admin\/users\/.+\/transfer$/, handler: () => ({ status: 200, data: { message: 'Employee transferred (demo).' } }) },
  { method: 'POST', pattern: /^admin\/users\/.+\/roles$/, handler: () => ({ status: 200, data: { message: 'Roles updated (demo).' } }) },
  { method: 'POST', pattern: /^admin\/users\/.+\/deactivate$/, handler: () => ({ status: 200, data: { message: 'User deactivated (demo).' } }) },
  { method: 'POST', pattern: /^admin\/users\/.+\/reactivate$/, handler: () => ({ status: 200, data: { message: 'User reactivated (demo).' } }) },
  { method: 'POST', pattern: /^admin\/users\/bulk-import$/, handler: (_m, req) => { const b = (req.body ?? {}) as { rows?: unknown[] }; const n = (b.rows ?? []).length; return { status: 201, data: { created: n, skipped: 0, errors: [] } }; } },
  { method: 'GET', pattern: /^admin\/invitations$/, handler: () => ({ status: 200, data: demoInvitations }) },
  { method: 'POST', pattern: /^admin\/invitations$/, handler: () => ({ status: 201, data: { message: 'Invitation sent (demo).' } }) },
  { method: 'POST', pattern: /^admin\/invitations\/.+\/resend$/, handler: () => ({ status: 200, data: { message: 'Invitation resent (demo).' } }) },
  { method: 'POST', pattern: /^admin\/invitations\/.+\/revoke$/, handler: () => ({ status: 200, data: { message: 'Invitation revoked (demo).' } }) },
  { method: 'GET', pattern: /^admin\/registrations$/, handler: () => ({ status: 200, data: [{ id: 'reg-demo-1', fullName: 'New Registrant', email: 'new.registrant@anwargroup.net', employeeCode: 'E9001', designationTitle: 'Executive', businessUnit: demoBusinessUnits[0], department: { id: departmentBy('ACL', 'Growth Analytics').id, name: 'Growth Analytics' }, createdAt: new Date(Date.now() - 12 * 3600_000).toISOString() }] }) },
  { method: 'POST', pattern: /^admin\/registrations\/.+\/confirm$/, handler: () => ({ status: 200, data: { message: 'Registration confirmed (demo).' } }) },
  { method: 'GET', pattern: /^admin\/delegations$/, handler: () => ({ status: 200, data: demoDelegations }) },
  { method: 'POST', pattern: /^admin\/delegations$/, handler: () => ({ status: 201, data: { message: 'Delegation created (demo).' } }) },
  { method: 'DELETE', pattern: /^admin\/delegations\/.+$/, handler: () => ({ status: 200, data: { message: 'Delegation revoked (demo).' } }) },
  { method: 'GET', pattern: /^users\/directory$/, handler: (_m, req) => { const q = str((req.params ?? {}).search); let rows = demoUsers; if (q) rows = rows.filter((u) => u.fullName.toLowerCase().includes(q.toLowerCase()) || u.employeeCode.toLowerCase().includes(q.toLowerCase())); return { status: 200, data: rows.slice(0, 30).map((u) => ({ id: u.id, fullName: u.fullName, employeeCode: u.employeeCode, email: u.email, designation: u.designation, department: dename(u.departmentId), businessUnit: demoBusinessUnits.find((b) => b.id === u.businessUnitId)?.name ?? '—' })) }; } },
  { method: 'GET', pattern: /^users\/approvers$/, handler: () => ({ status: 200, data: demoUsers.filter((u) => u.role === 'DEPT_HEAD').map((u) => ({ id: u.id, fullName: u.fullName, employeeCode: u.employeeCode, email: u.email, designationTitle: u.designation, department: { id: u.departmentId, name: dename(u.departmentId) } })) }) },

  // ------------------------------------------------------------------ search
  {
    method: 'GET',
    pattern: /^search$/,
    handler: (_m, req) => {
      const q = str((req.params ?? {}).q) ?? '';
      if (q.trim().length < 2) return { status: 200, data: { query: q, employees: [], kpis: [] } };
      const needle = q.toLowerCase();
      const employees = demoUsers.filter((u) => u.fullName.toLowerCase().includes(needle) || u.employeeCode.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)).slice(0, 8).map((u) => ({ id: u.id, fullName: u.fullName, employeeCode: u.employeeCode, email: u.email, designation: u.designation, department: dename(u.departmentId), businessUnit: demoBusinessUnits.find((b) => b.id === u.businessUnitId)?.name ?? '—', roles: [u.role], status: 'ACTIVE' }));
      const kpis = vis(currentUser()).filter((k) => k.name.toLowerCase().includes(needle) || k.code.toLowerCase().includes(needle)).slice(0, 8).map((k) => ({ id: k.id, code: k.code, name: k.name, status: k.status, employeeName: userById(k.employeeId)?.fullName ?? '—', employeeCode: userById(k.employeeId)?.employeeCode ?? '—', period: periodById(k.periodId)?.label ?? '—' }));
      return { status: 200, data: { query: q, employees, kpis } };
    },
  },
];

// ------------------------------------------------------- derived view builders

const dename = (departmentId: string | undefined): string =>
  demoDepartments.find((d) => d.id === departmentId)?.name ?? '—';

const queueResponse = (req: DemoRequest, groupWide: boolean): DemoResponse => {
  const user = currentUser();
  const p = req.params ?? {};
  const statuses = str(p.status) ? String(p.status).split(',') : ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'];

  let rows = groupWide ? [...demoKpis] : vis(user);
  rows = rows.filter((k) => statuses.includes(k.status) && k.employeeId !== user.id);
  if (!groupWide && user.role === 'DEPT_HEAD') rows = rows.filter((k) => userById(k.employeeId)?.role !== 'DEPT_HEAD');
  if (str(p.employee)) {
    const needle = String(p.employee).toLowerCase();
    rows = rows.filter((k) => {
      const e = userById(k.employeeId);
      return e?.fullName.toLowerCase().includes(needle) || e?.employeeCode.toLowerCase().includes(needle);
    });
  }
  if (str(p.frequency)) rows = rows.filter((k) => k.frequency === p.frequency);
  if (str(p.periodId)) rows = rows.filter((k) => k.periodId === p.periodId);
  if (str(p.departmentId)) rows = rows.filter((k) => k.departmentId === p.departmentId);
  if (str(p.businessUnitId)) rows = rows.filter((k) => k.businessUnitId === p.businessUnitId);
  if (str(p.categoryId)) {
    const cat = demoCategories.find((c) => c.id === p.categoryId);
    if (cat) rows = rows.filter((k) => k.categoryCode === cat.code);
  }

  rows.sort((a, b) => (a.submittedAt ?? a.createdAt < (b.submittedAt ?? b.createdAt) ? -1 : 1));

  const page = num(p.page, 1);
  const size = num(p.size, 25);
  const items = rows.slice((page - 1) * size, page * size).map((k) => {
    const employee = userById(k.employeeId)!;
    const ageDays = k.submittedAt ? workingDaysBetween(k.submittedAt, new Date()) : 0;
    const escalation = demoEscalations.find((e) => e.kpiId === k.id && e.status === 'PENDING');
    return {
      id: k.id, code: k.code, kpi: k.name, status: k.status,
      employeeId: employee.id, employeeName: employee.fullName, employeeCode: employee.employeeCode, employeeEmail: employee.email,
      designation: employee.designation, department: dename(k.departmentId), departmentId: k.departmentId,
      businessUnit: demoBusinessUnits.find((b) => b.id === k.businessUnitId)?.name ?? '—',
      frequency: k.frequency, period: periodById(k.periodId)?.label ?? '—', periodId: k.periodId,
      category: k.categoryName, categoryCode: k.categoryCode,
      submittedAt: k.submittedAt, ageDays, slaState: ageDays <= 3 ? 'within' : ageDays <= 5 ? 'at_risk' : 'breached',
      target: k.target !== null ? decimals(k.target) : null, actual: k.actual !== null ? decimals(k.actual) : null,
      achievement: decimals(k.achievement), calculatedScore: decimals(k.calculatedScore), finalScore: decimals(k.finalScore),
      kpiWeight: k.kpiWeight, weightedScore: decimals(k.weightedScore),
      measurementType: k.measurementType, direction: k.direction, unit: k.unit, remarks: k.remarks,
      evidenceCount: k.evidenceCount, approver: userById(k.approverId ?? '')?.fullName ?? 'Super Admin',
      rowVersion: k.rowVersion, isAssigned: k.isAssigned,
      escalation: escalation ? { id: escalation.id, delta: escalation.delta, proposedScore: escalation.proposedScore, calculatedScore: escalation.calculatedScore, reason: escalation.reason } : null,
    };
  });

  return {
    status: 200,
    data: {
      items, total: rows.length, page, size, totalPages: Math.max(1, Math.ceil(rows.length / size)),
      escalatedCount: demoEscalations.filter((e) => e.status === 'PENDING').length,
      headline: `KPI submission requests — ${rows.length} waiting, oldest first`,
    },
  };
};

const employeeDashboard = (employee: DemoUser, period: ReturnType<typeof periodByCode> extends infer P ? NonNullable<P> : never) => {
  const rows = demoKpis.filter((k) => k.employeeId === employee.id && k.periodId === period.id && k.status !== 'DELETED');
  const agg = aggregatePeriod(rows.map((k) => ({ achievement: k.achievement, weightedScore: k.weightedScore, kpiWeight: k.kpiWeight, status: k.status })), demoConfig.ragThresholds);

  const prevDescriptor = (() => {
    if (period.frequency === 'MONTHLY') return period.periodIndex === 1 ? { year: period.year - 1, index: 12 } : { year: period.year, index: period.periodIndex - 1 };
    if (period.frequency === 'QUARTERLY') return period.periodIndex === 1 ? { year: period.year - 1, index: 4 } : { year: period.year, index: period.periodIndex - 1 };
    return { year: period.year - 1, index: 1 };
  })();
  const prevPeriod = demoPeriods.find((p) => p.frequency === period.frequency && p.year === prevDescriptor.year && p.periodIndex === prevDescriptor.index);
  const prevRows = prevPeriod ? demoKpis.filter((k) => k.employeeId === employee.id && k.periodId === prevPeriod.id && k.status === 'APPROVED') : [];
  const prevScore = prevRows.length ? roundHalfUp(prevRows.reduce((a, k) => a + k.weightedScore, 0)) : null;
  const difference = prevScore !== null ? roundHalfUp(agg.totalKpiScore - prevScore) : null;
  const differenceLabel =
    difference === null
      ? 'No previous period'
      : difference === 0
        ? 'No change'
        : `${difference > 0 ? '▲' : '▼'} ${Math.abs(difference).toFixed(2)} ${difference > 0 ? 'above' : 'below'} previous period`;

  const series = (frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY', count: number, backFromYear = false) => {
    const list = demoPeriods.filter((p) => p.frequency === frequency && (backFromYear ? p.year <= period.year && p.year > period.year - count : p.year === period.year)).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
    return Array.from({ length: count }).map((_, i) => {
      const p = list[i];
      if (!p) return { label: '', periodId: null, value: null, hasData: false, target: 100 };
      const kpis = demoKpis.filter((k) => k.employeeId === employee.id && k.periodId === p.id && k.status === 'APPROVED');
      const value = kpis.length ? roundHalfUp(kpis.reduce((a, k) => a + k.weightedScore, 0)) : null;
      return { label: p.label, periodId: p.id, value, hasData: kpis.length > 0, target: 100 };
    });
  };

  return {
    metrics: {
      periodId: period.id,
      periodCode: period.code,
      periodLabel: period.label,
      frequency: period.frequency,
      employeeId: employee.id,
      totalKpiScore: decimals(agg.totalKpiScore),
      averageAchievement: decimals(agg.averageAchievement),
      allocatedWeight: agg.allocatedWeight,
      approvedCount: agg.approvedCount,
      totalCount: agg.totalCount,
      belowTargetCount: agg.belowTargetCount,
      rag: agg.rag,
      previousScore: prevScore !== null ? decimals(prevScore) : null,
      difference: difference !== null ? decimals(difference) : null,
      differenceLabel,
      rank: rankOf(employee, period),
    },
    records: rows.map((k) => ({
      id: k.id, code: k.code, kpi: k.name, category: k.categoryName,
      target: k.target !== null ? decimals(k.target) : null, actual: k.actual !== null ? decimals(k.actual) : null,
      achievement: decimals(k.achievement), kpiWeight: k.kpiWeight,
      score: decimals(k.finalScore), displayScore: k.status === 'APPROVED' ? decimals(k.finalScore) : 'Pending',
      weightedScore: decimals(k.weightedScore), evidence: k.evidence.map((e) => e.originalName), evidenceCount: k.evidenceCount,
      remarks: k.remarks || '—', status: k.status, approver: userById(k.approverId ?? '')?.fullName ?? 'Super Admin',
      measurementType: k.measurementType, unit: k.unit, direction: k.direction,
    })),
    charts: { monthly: series('MONTHLY', 12), quarterly: series('QUARTERLY', 4), yearly: series('YEARLY', 5, true), frequency: period.frequency },
    period,
  };
};

const rankOf = (employee: DemoUser, period: ReturnType<typeof periodByCode> extends infer P ? NonNullable<P> : never): number | null => {
  const entries = leaderboardFor(period).filter((e) => e.departmentId === employee.departmentId);
  const found = entries.find((e) => e.employeeId === employee.id);
  return found ? found.rank : null;
};

interface LeaderboardRow {
  rank: number;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  departmentId: string | null;
  totalKpiScore: number;
  averageAchievement: number;
  approvedCount: number;
  totalCount: number;
  allocatedWeight: number;
  rag: 'GREEN' | 'AMBER' | 'RED';
  score: string | null;
  ragBarPercent: number;
}

const leaderboardFor = (period: NonNullable<ReturnType<typeof periodByCode>>, departmentId?: string): LeaderboardRow[] => {
  const rows = demoKpis.filter((k) => k.periodId === period.id && k.status !== 'DELETED' && (!departmentId || k.departmentId === departmentId));
  const byEmployee = new Map<string, DemoKpi[]>();
  rows.forEach((k) => byEmployee.set(k.employeeId, [...(byEmployee.get(k.employeeId) ?? []), k]));

  const entries = Array.from(byEmployee.entries()).map(([employeeId, list]) => {
    const agg = aggregatePeriod(list.map((k) => ({ achievement: k.achievement, weightedScore: k.weightedScore, kpiWeight: k.kpiWeight, status: k.status })), demoConfig.ragThresholds);
    const employee = userById(employeeId)!;
    return {
      employeeId,
      employeeName: employee.fullName,
      employeeCode: employee.employeeCode,
      designation: employee.designation,
      department: dename(employee.departmentId),
      departmentId: employee.departmentId,
      totalKpiScore: agg.totalKpiScore,
      averageAchievement: agg.averageAchievement,
      approvedCount: agg.approvedCount,
      totalCount: agg.totalCount,
      allocatedWeight: agg.allocatedWeight,
      rag: agg.rag as 'GREEN' | 'AMBER' | 'RED',
      score: decimals(agg.totalKpiScore),
      ragBarPercent: Math.min(agg.totalKpiScore, 100),
    };
  });

  entries.sort((a, b) => (b.totalKpiScore !== a.totalKpiScore ? b.totalKpiScore - a.totalKpiScore : b.averageAchievement - a.averageAchievement || a.employeeName.localeCompare(b.employeeName)));

  let rank = 0;
  let lastScore: number | null = null;
  let lastAch: number | null = null;
  return entries.map((entry, index) => {
    if (lastScore === null || entry.totalKpiScore !== lastScore || entry.averageAchievement !== lastAch) {
      rank = index + 1;
      lastScore = entry.totalKpiScore;
      lastAch = entry.averageAchievement;
    }
    return { ...entry, rank };
  });
};

const departmentDashboard = (period: NonNullable<ReturnType<typeof periodByCode>>, departmentId?: string) => {
  const user = currentUser();
  const departments = demoDepartments.filter((d) => (departmentId ? d.id === departmentId : user.role === 'DEPT_HEAD' ? user.departmentHeadOf.includes(d.id) : true)).slice(0, 40);
  const ids = departments.map((d) => d.id);
  const rows = demoKpis.filter((k) => k.periodId === period.id && ids.includes(k.departmentId) && k.status !== 'DELETED');
  const approved = rows.filter((k) => k.status === 'APPROVED');
  const pending = rows.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status));
  const agg = aggregatePeriod(approved.map((k) => ({ achievement: k.achievement, weightedScore: k.weightedScore, kpiWeight: k.kpiWeight, status: k.status })), demoConfig.ragThresholds);

  const perEmployee = new Map<string, number>();
  rows.filter((k) => k.status !== 'REJECTED').forEach((k) => perEmployee.set(k.employeeId, (perEmployee.get(k.employeeId) ?? 0) + k.kpiWeight));
  const incomplete = Array.from(perEmployee.entries()).filter(([, w]) => w !== 100);

  return {
    period,
    frequency: period.frequency,
    departments: departments.map((d) => ({ id: d.id, name: d.name, businessUnit: d.businessUnit })),
    cards: {
      averageAchievement: decimals(agg.averageAchievement),
      averageAchievementValue: agg.averageAchievement,
      pendingEvaluations: pending.length,
      totalApproved: approved.length,
      rejected: rows.filter((k) => k.status === 'REJECTED').length,
      belowTarget: approved.filter((k) => k.achievement < 100).length,
      weightIncomplete: incomplete.length,
      notSubmitted: rows.filter((k) => k.status === 'NOT_SUBMITTED').length,
      totalKpis: rows.length,
      oldestPendingAgeDays: pending.length ? Math.max(...pending.map((k) => (k.submittedAt ? workingDaysBetween(k.submittedAt, new Date()) : 0))) : 0,
      slaBreaches: pending.filter((k) => k.status === 'ESCALATED').length,
    },
    leaderboard: leaderboardFor(period, departmentId ?? (departments.length === 1 ? departments[0].id : undefined)).slice(0, 200),
    thresholds: demoConfig.ragThresholds,
    belowTargetList: approved.filter((k) => k.achievement < 100).slice(0, 10).map((k) => ({ kpiId: k.id, employeeId: k.employeeId, achievement: decimals(k.achievement) })),
    weightIncompleteList: incomplete.slice(0, 10).map(([employeeId, weight]) => ({ employeeId, employeeName: userById(employeeId)?.fullName ?? '—', employeeCode: userById(employeeId)?.employeeCode ?? '—', department: dename(userById(employeeId)?.departmentId), allocatedWeight: weight })),
  };
};

const groupDashboard = (period: NonNullable<ReturnType<typeof periodByCode>>, businessUnitId?: string, departmentId?: string) => {
  const rows = demoKpis.filter((k) => k.periodId === period.id && k.status !== 'DELETED' && (!businessUnitId || k.businessUnitId === businessUnitId) && (!departmentId || k.departmentId === departmentId));
  const approved = rows.filter((k) => k.status === 'APPROVED');
  const pending = rows.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status));
  const agg = aggregatePeriod(approved.map((k) => ({ achievement: k.achievement, weightedScore: k.weightedScore, kpiWeight: k.kpiWeight, status: k.status })), demoConfig.ragThresholds);
  const scoredEmployees = new Set(approved.map((k) => k.employeeId));

  const perEmployee = new Map<string, number>();
  rows.filter((k) => k.status !== 'REJECTED').forEach((k) => perEmployee.set(k.employeeId, (perEmployee.get(k.employeeId) ?? 0) + k.kpiWeight));

  return {
    period,
    headline: {
      groupAverageAchievement: decimals(agg.averageAchievement),
      groupAverageTotalScore: scoredEmployees.size ? decimals(roundHalfUp(approved.reduce((a, k) => a + k.weightedScore, 0) / scoredEmployees.size)) : '0.00',
      totalKpis: rows.length,
      approved: approved.length,
      pending: pending.length,
      rejected: rows.filter((k) => k.status === 'REJECTED').length,
      notSubmitted: rows.filter((k) => k.status === 'NOT_SUBMITTED').length,
      slaCompliance: '96.40',
      slaBreaches: pending.filter((k) => k.status === 'ESCALATED').length,
      participatingEmployees: scoredEmployees.size,
      openEscalations: demoEscalations.filter((e) => e.status === 'PENDING').length,
      weightIncomplete: Array.from(perEmployee.values()).filter((w) => w !== 100).length,
    },
    businessUnits: demoBusinessUnits
      .map((bu) => {
        const all = rows.filter((k) => k.businessUnitId === bu.id);
        const list = all.filter((k) => k.status === 'APPROVED');
        const buAgg = aggregatePeriod(list.map((k) => ({ achievement: k.achievement, weightedScore: k.weightedScore, kpiWeight: k.kpiWeight, status: k.status })), demoConfig.ragThresholds);
        const employees = new Set(list.map((k) => k.employeeId));
        const weights = new Map<string, number>();
        all.filter((k) => k.status !== 'REJECTED').forEach((k) => weights.set(k.employeeId, (weights.get(k.employeeId) ?? 0) + k.kpiWeight));
        return {
          id: bu.id, code: bu.code, name: bu.name, division: bu.division,
          averageAchievement: decimals(buAgg.averageAchievement),
          averageTotalScore: employees.size ? decimals(roundHalfUp(list.reduce((a, k) => a + k.weightedScore, 0) / employees.size)) : '0.00',
          approved: list.length,
          pending: all.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status)).length,
          rejected: all.filter((k) => k.status === 'REJECTED').length,
          belowTarget: list.filter((k) => k.achievement < 100).length,
          weightIncomplete: Array.from(weights.values()).filter((w) => w !== 100).length,
          headcount: employees.size,
        };
      })
      .filter((b) => b.approved > 0 || b.pending > 0 || b.rejected > 0),
    departments: demoDepartments
      .map((d) => {
        const all = rows.filter((k) => k.departmentId === d.id);
        if (!all.length) return null;
        const list = all.filter((k) => k.status === 'APPROVED');
        const dAgg = aggregatePeriod(list.map((k) => ({ achievement: k.achievement, weightedScore: k.weightedScore, kpiWeight: k.kpiWeight, status: k.status })), demoConfig.ragThresholds);
        const weights = new Map<string, number>();
        all.filter((k) => k.status !== 'REJECTED').forEach((k) => weights.set(k.employeeId, (weights.get(k.employeeId) ?? 0) + k.kpiWeight));
        return {
          departmentId: d.id, department: d.name, businessUnitId: d.businessUnitId,
          averageAchievement: decimals(dAgg.averageAchievement),
          approved: list.length,
          pending: all.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status)).length,
          rejected: all.filter((k) => k.status === 'REJECTED').length,
          belowTarget: list.filter((k) => k.achievement < 100).length,
          slaBreaches: 0,
          weightIncomplete: Array.from(weights.values()).filter((w) => w !== 100).length,
          participation: decimals((list.length / all.length) * 100),
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .slice(0, 60),
    escalations: demoEscalations
      .filter((e) => e.status === 'PENDING')
      .map((e) => {
        const kpi = kpiById(e.kpiId);
        return {
          id: e.id, kpiId: e.kpiId, kpi: kpi?.name ?? '', employee: userById(kpi?.employeeId ?? '')?.fullName ?? '—',
          department: dename(kpi?.departmentId), calculatedScore: e.calculatedScore, proposedScore: e.proposedScore,
          delta: e.delta, requestedBy: userById(e.requestedById)?.fullName ?? '—', ageDays: workingDaysBetween(e.createdAt, new Date()),
        };
      }),
  };
};

const drillDown = (req: DemoRequest) => {
  const p = req.params ?? {};
  const level = str(p.level) ?? 'business_unit';
  const period = periodById(str(p.periodId) ?? '') ?? periodByCode('2026-08')!;

  if (level === 'business_unit') return { status: 200, data: { level, period, items: demoBusinessUnits.map((b) => ({ id: b.id, name: b.name, code: b.code })) } };
  if (level === 'department') {
    const buId = str(p.businessUnitId);
    return { status: 200, data: { level, period, items: demoDepartments.filter((d) => !buId || d.businessUnitId === buId).map((d) => ({ id: d.id, name: d.name, businessUnitId: d.businessUnitId })) } };
  }
  if (level === 'employee') {
    const deptId = str(p.departmentId);
    const rows = demoKpis.filter((k) => k.periodId === period.id && (!deptId || k.departmentId === deptId));
    const byEmployee = new Map<string, DemoKpi[]>();
    rows.forEach((k) => byEmployee.set(k.employeeId, [...(byEmployee.get(k.employeeId) ?? []), k]));
    const items = Array.from(byEmployee.entries()).map(([employeeId, list]) => {
      const agg = aggregatePeriod(list.map((k) => ({ achievement: k.achievement, weightedScore: k.weightedScore, kpiWeight: k.kpiWeight, status: k.status })), demoConfig.ragThresholds);
      const employee = userById(employeeId)!;
      return { employeeId, employeeName: employee.fullName, employeeCode: employee.employeeCode, designation: employee.designation, totalKpiScore: decimals(agg.totalKpiScore), averageAchievement: decimals(agg.averageAchievement), approved: agg.approvedCount, total: agg.totalCount, allocatedWeight: agg.allocatedWeight };
    });
    items.sort((a, b) => Number(b.totalKpiScore) - Number(a.totalKpiScore));
    return { status: 200, data: { level, period, items } };
  }
  const employeeId = str(p.employeeId);
  const rows = demoKpis.filter((k) => k.periodId === period.id && (!employeeId || k.employeeId === employeeId) && (!str(p.departmentId) || k.departmentId === p.departmentId));
  return {
    status: 200,
    data: {
      level: 'kpi', period,
      items: rows.map((k) => ({
        id: k.id, code: k.code, name: k.name, status: k.status, category: k.categoryName,
        target: k.target !== null ? decimals(k.target) : null, actual: k.actual !== null ? decimals(k.actual) : null,
        achievement: decimals(k.achievement), calculatedScore: decimals(k.calculatedScore), finalScore: decimals(k.finalScore),
        weightedScore: decimals(k.weightedScore), kpiWeight: k.kpiWeight, measurementType: k.measurementType, unit: k.unit,
        employeeName: userById(k.employeeId)?.fullName ?? '—', employeeCode: userById(k.employeeId)?.employeeCode ?? '—',
        department: dename(k.departmentId), rag: k.achievement >= 95 ? 'GREEN' : k.achievement >= 75 ? 'AMBER' : 'RED',
      })),
    },
  };
};

const kpiDrillDown = (kind: string, req: DemoRequest): DemoResponse => {
  const p = req.params ?? {};
  const period = periodById(str(p.periodId) ?? '') ?? periodByCode('2026-09')!;
  const user = currentUser();
  const rows = vis(user).filter((k) => k.periodId === period.id && (!str(p.departmentId) || k.departmentId === p.departmentId));

  const map = (k: DemoKpi) => ({
    id: k.id, code: k.code, name: k.name, status: k.status,
    target: k.target !== null ? decimals(k.target) : null, actual: k.actual !== null ? decimals(k.actual) : null,
    achievement: decimals(k.achievement), finalScore: decimals(k.finalScore), weightedScore: decimals(k.weightedScore),
    kpiWeight: k.kpiWeight, measurementType: k.measurementType, unit: k.unit,
    employeeId: k.employeeId, employeeName: userById(k.employeeId)?.fullName ?? '—', employeeCode: userById(k.employeeId)?.employeeCode ?? '—',
    designation: userById(k.employeeId)?.designation ?? '—', department: dename(k.departmentId), departmentId: k.departmentId,
    businessUnit: demoBusinessUnits.find((b) => b.id === k.businessUnitId)?.name ?? '—',
    approver: userById(k.approverId ?? '')?.fullName ?? 'Super Admin', period: period.label, periodId: period.id, updatedAt: k.updatedAt,
  });

  if (kind === 'weight_incomplete') {
    const perEmployee = new Map<string, number>();
    rows.filter((k) => !['REJECTED', 'DELETED'].includes(k.status)).forEach((k) => perEmployee.set(k.employeeId, (perEmployee.get(k.employeeId) ?? 0) + k.kpiWeight));
    const items = Array.from(perEmployee.entries()).filter(([, w]) => w !== 100).map(([employeeId, weight]) => {
      const employee = userById(employeeId);
      return { employeeId, employeeName: employee?.fullName ?? '—', employeeCode: employee?.employeeCode ?? '—', designation: employee?.designation ?? '—', department: dename(employee?.departmentId), businessUnit: demoBusinessUnits.find((b) => b.id === employee?.businessUnitId)?.name ?? '—', allocatedWeight: weight };
    });
    return { status: 200, data: { kind, items, total: items.length, page: 1, size: 25, totalPages: 1 } };
  }

  const filtered =
    kind === 'below_target'
      ? rows.filter((k) => k.status === 'APPROVED' && k.achievement < 100)
      : kind === 'pending'
        ? rows.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status))
        : kind === 'approved'
          ? rows.filter((k) => k.status === 'APPROVED')
          : kind === 'rejected'
            ? rows.filter((k) => k.status === 'REJECTED')
            : kind === 'not_submitted'
              ? rows.filter((k) => k.status === 'NOT_SUBMITTED')
              : rows;

  return { status: 200, data: { kind, items: filtered.map(map), total: filtered.length, page: 1, size: 25, totalPages: 1 } };
};

// ------------------------------------------------------------------- reports

const REPORT_CATALOGUE = [
  { code: 'RP-01', name: 'Employee KPI Report', purpose: 'Full KPI-level record for one or more employees.', audience: 'Employee (own), Dept Head, Super Admin, HR', extraFilters: ['employee', 'status', 'category'], columnCount: 16 },
  { code: 'RP-02', name: 'Employee Performance Report', purpose: 'Period results per employee.', audience: 'Dept Head, Super Admin, HR', extraFilters: ['employee', 'RAG'], columnCount: 14 },
  { code: 'RP-03', name: 'Department Performance Report', purpose: 'Compare departments.', audience: 'Super Admin, HR, Mgmt Viewer', extraFilters: ['department'], columnCount: 11 },
  { code: 'RP-04', name: 'Manager (Approver) Performance Report', purpose: 'Approver timeliness and consistency.', audience: 'Super Admin, HR', extraFilters: ['approver'], columnCount: 11 },
  { code: 'RP-05', name: 'KPI Achievement Report', purpose: 'Distribution of achievement.', audience: 'Super Admin, HR, Dept Head', extraFilters: ['category', 'type'], columnCount: 5 },
  { code: 'RP-06', name: 'Variable KPI Report', purpose: 'Master extract of variable KPIs for HR and management.', audience: 'Super Admin, HR', extraFilters: ['status'], columnCount: 19 },
  { code: 'RP-07', name: 'KPI Trend Report', purpose: 'Performance over time.', audience: 'All roles within scope', extraFilters: ['entity'], columnCount: 6 },
  { code: 'RP-08', name: 'Monthly / Quarterly / Annual Performance Report', purpose: 'Period close pack.', audience: 'Super Admin, Mgmt Viewer, HR', extraFilters: ['frequency'], columnCount: 6 },
  { code: 'RP-09', name: 'Pending Review Report', purpose: 'Queue health.', audience: 'Dept Head, Super Admin', extraFilters: ['approver', 'age'], columnCount: 10 },
  { code: 'RP-10', name: 'Pending Approval Report', purpose: 'Items waiting for a Super Admin.', audience: 'Super Admin', extraFilters: ['type'], columnCount: 10 },
  { code: 'RP-11', name: 'KPI Exception Report', purpose: 'Control and audit.', audience: 'Super Admin, HR, internal audit', extraFilters: ['exception type'], columnCount: 8 },
  { code: 'RP-12', name: 'Historical Performance Report', purpose: 'Multi-period history from snapshots.', audience: 'Super Admin, HR (Employee: own)', extraFilters: ['year range'], columnCount: 8 },
  { code: 'RP-13', name: 'Management Summary Report', purpose: 'One-page executive pack.', audience: 'Super Admin, Mgmt Viewer', extraFilters: ['frequency'], columnCount: 3 },
];

const COLUMNS: Record<string, Array<{ key: string; label: string; type: string; align?: string }>> = {
  'RP-01': [
    { key: 'kpiCode', label: 'KPI Code', type: 'text' }, { key: 'kpi', label: 'KPI', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' }, { key: 'type', label: 'Type', type: 'text' },
    { key: 'target', label: 'Target', type: 'decimal', align: 'right' }, { key: 'actual', label: 'Actual', type: 'decimal', align: 'right' },
    { key: 'achievement', label: 'ACH %', type: 'percent', align: 'right' }, { key: 'weight', label: 'Weight', type: 'integer', align: 'right' },
    { key: 'calculatedScore', label: 'CS', type: 'decimal', align: 'right' }, { key: 'finalScore', label: 'FS', type: 'decimal', align: 'right' },
    { key: 'weightedScore', label: 'WS', type: 'decimal', align: 'right' }, { key: 'evidenceCount', label: 'Evidence', type: 'integer', align: 'right' },
    { key: 'remarks', label: 'Remarks', type: 'text' }, { key: 'status', label: 'Status', type: 'badge' },
    { key: 'approver', label: 'Approver', type: 'text' }, { key: 'decisionDate', label: 'Decision Date', type: 'date' },
  ],
  'RP-02': [
    { key: 'employeeCode', label: 'Employee ID', type: 'text' }, { key: 'employeeName', label: 'Employee', type: 'text' },
    { key: 'department', label: 'Department', type: 'text' }, { key: 'designation', label: 'Designation', type: 'text' },
    { key: 'period', label: 'Period', type: 'text' }, { key: 'totalKpiScore', label: 'Total KPI Score', type: 'decimal', align: 'right' },
    { key: 'averageAchievement', label: 'Average Achievement', type: 'percent', align: 'right' },
    { key: 'allocatedWeight', label: 'Allocated Weight', type: 'integer', align: 'right' },
    { key: 'approvedCount', label: 'Approved', type: 'integer', align: 'right' }, { key: 'totalCount', label: 'Total KPIs', type: 'integer', align: 'right' },
    { key: 'rag', label: 'RAG', type: 'badge' }, { key: 'rank', label: 'Rank', type: 'integer', align: 'right' },
    { key: 'previousScore', label: 'Previous Score', type: 'decimal', align: 'right' }, { key: 'difference', label: 'Difference', type: 'decimal', align: 'right' },
  ],
  'RP-03': [
    { key: 'businessUnit', label: 'Business Unit', type: 'text' }, { key: 'department', label: 'Department', type: 'text' },
    { key: 'headcount', label: 'Headcount', type: 'integer', align: 'right' }, { key: 'participation', label: 'Participation %', type: 'percent', align: 'right' },
    { key: 'averageAchievement', label: 'Dept Avg Achievement', type: 'percent', align: 'right' },
    { key: 'averageTotalScore', label: 'Avg Total Score', type: 'decimal', align: 'right' },
    { key: 'approved', label: 'Approved', type: 'integer', align: 'right' }, { key: 'pending', label: 'Pending', type: 'integer', align: 'right' },
    { key: 'rejected', label: 'Rejected', type: 'integer', align: 'right' }, { key: 'belowTarget', label: 'Below Target', type: 'integer', align: 'right' },
    { key: 'weightIncomplete', label: 'Weight Incomplete', type: 'integer', align: 'right' },
  ],
  'RP-05': [
    { key: 'band', label: 'ACH Band', type: 'text' }, { key: 'category', label: 'Category', type: 'text' },
    { key: 'measurementType', label: 'Measurement Type', type: 'text' }, { key: 'kpiCount', label: 'KPI Count', type: 'integer', align: 'right' },
    { key: 'kpiPct', label: 'KPI %', type: 'percent', align: 'right' },
  ],
  'RP-09': [
    { key: 'employeeCode', label: 'Employee ID', type: 'text' }, { key: 'employeeName', label: 'Employee', type: 'text' },
    { key: 'designation', label: 'Designation', type: 'text' }, { key: 'kpi', label: 'KPI', type: 'text' },
    { key: 'department', label: 'Department', type: 'text' }, { key: 'approver', label: 'Approver', type: 'text' },
    { key: 'submittedAt', label: 'Submitted', type: 'datetime' }, { key: 'ageDays', label: 'Age (working days)', type: 'integer', align: 'right' },
    { key: 'slaStatus', label: 'SLA Status', type: 'badge' }, { key: 'status', label: 'Status', type: 'badge' },
  ],
  'RP-11': [
    { key: 'exceptionType', label: 'Exception', type: 'text' }, { key: 'employeeCode', label: 'Employee ID', type: 'text' },
    { key: 'employeeName', label: 'Employee', type: 'text' }, { key: 'department', label: 'Department', type: 'text' },
    { key: 'kpi', label: 'KPI', type: 'text' }, { key: 'detail', label: 'Detail', type: 'text' },
    { key: 'period', label: 'Period', type: 'text' }, { key: 'detectedAt', label: 'Detected', type: 'datetime' },
  ],
};

const rowsForReport = (code: string, periodCode: string) => {
  const period = periodByCode(periodCode) ?? periodByCode('2026-08')!;
  const rows = demoKpis.filter((k) => k.periodId === period.id && k.status !== 'DELETED');
  const kpiRow = (k: DemoKpi) => ({
    kpiCode: k.code, kpi: k.name, category: k.categoryName, type: k.measurementType,
    target: k.target !== null ? decimals(k.target) : '—', actual: k.actual !== null ? decimals(k.actual) : '—',
    achievement: decimals(k.achievement), weight: k.kpiWeight, calculatedScore: decimals(k.calculatedScore),
    finalScore: decimals(k.finalScore), weightedScore: decimals(k.weightedScore), evidenceCount: k.evidenceCount,
    remarks: k.remarks || '—', status: k.status, approver: userById(k.approverId ?? '')?.fullName ?? 'Super Admin',
    decisionDate: k.decidedAt ?? '—', employeeCode: userById(k.employeeId)?.employeeCode ?? '—',
    employeeName: userById(k.employeeId)?.fullName ?? '—', period: period.label,
  });

  if (code === 'RP-01' || code === 'RP-06') return rows.map(kpiRow);

  if (code === 'RP-02' || code === 'RP-12') {
    const byEmployee = new Map<string, DemoKpi[]>();
    rows.forEach((k) => byEmployee.set(k.employeeId, [...(byEmployee.get(k.employeeId) ?? []), k]));
    const items = Array.from(byEmployee.entries()).map(([employeeId, list]) => {
      const agg = aggregatePeriod(list.map((k) => ({ achievement: k.achievement, weightedScore: k.weightedScore, kpiWeight: k.kpiWeight, status: k.status })), demoConfig.ragThresholds);
      const employee = userById(employeeId)!;
      return {
        employeeCode: employee.employeeCode, employeeName: employee.fullName, department: dename(employee.departmentId),
        designation: employee.designation, period: period.label, totalKpiScore: decimals(agg.totalKpiScore),
        averageAchievement: decimals(agg.averageAchievement), allocatedWeight: agg.allocatedWeight,
        approvedCount: agg.approvedCount, totalCount: agg.totalCount, rag: agg.rag, rank: null,
        previousScore: null, difference: null, versionCount: list.reduce((a, k) => a + k.versions.length, 0),
      };
    });
    items.sort((a, b) => Number(b.totalKpiScore) - Number(a.totalKpiScore));
    items.forEach((r, i) => { r.rank = i + 1 as never; });
    return items;
  }

  if (code === 'RP-03') {
    return demoDepartments.map((d) => {
      const all = rows.filter((k) => k.departmentId === d.id);
      if (!all.length) return null;
      const list = all.filter((k) => k.status === 'APPROVED');
      const agg = aggregatePeriod(list.map((k) => ({ achievement: k.achievement, weightedScore: k.weightedScore, kpiWeight: k.kpiWeight, status: k.status })), demoConfig.ragThresholds);
      const headcount = d.employeeCount;
      const weights = new Map<string, number>();
      all.filter((k) => k.status !== 'REJECTED').forEach((k) => weights.set(k.employeeId, (weights.get(k.employeeId) ?? 0) + k.kpiWeight));
      return {
        businessUnit: d.businessUnit.name, department: d.name, headcount,
        participation: headcount ? decimals((new Set(list.map((k) => k.employeeId)).size / headcount) * 100) : '0.00',
        averageAchievement: decimals(agg.averageAchievement), averageTotalScore: decimals(agg.totalKpiScore),
        approved: list.length, pending: all.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status)).length,
        rejected: all.filter((k) => k.status === 'REJECTED').length, belowTarget: list.filter((k) => k.achievement < 100).length,
        weightIncomplete: Array.from(weights.values()).filter((w) => w !== 100).length,
      };
    }).filter(Boolean) as Array<Record<string, unknown>>;
  }

  if (code === 'RP-05') {
    const bands = [
      { code: '<75', test: (v: number) => v < 75 },
      { code: '75-94.99', test: (v: number) => v >= 75 && v < 95 },
      { code: '95-99.99', test: (v: number) => v >= 95 && v < 100 },
      { code: '100-120', test: (v: number) => v >= 100 && v <= 120 },
      { code: '>120', test: (v: number) => v > 120 },
    ];
    const approved = rows.filter((k) => k.status === 'APPROVED');
    const total = approved.length || 1;
    return bands.flatMap((band) => {
      const matching = approved.filter((k) => band.test(k.achievement));
      const cats = new Map<string, number>();
      matching.forEach((k) => cats.set(k.categoryName, (cats.get(k.categoryName) ?? 0) + 1));
      if (!cats.size) return [{ band: band.code, category: '—', measurementType: '—', kpiCount: 0, kpiPct: '0.00' }];
      return Array.from(cats.entries()).map(([category, count]) => ({ band: band.code, category, measurementType: matching[0].measurementType, kpiCount: count, kpiPct: decimals((count / total) * 100) }));
    });
  }

  if (code === 'RP-09') {
    return rows.filter((k) => ['SUBMITTED', 'UNDER_REVIEW'].includes(k.status)).map((k) => {
      const age = k.submittedAt ? workingDaysBetween(k.submittedAt, new Date()) : 0;
      return { employeeCode: userById(k.employeeId)?.employeeCode ?? '—', employeeName: userById(k.employeeId)?.fullName ?? '—', designation: userById(k.employeeId)?.designation ?? '—', kpi: k.name, department: dename(k.departmentId), approver: userById(k.approverId ?? '')?.fullName ?? 'Super Admin', submittedAt: k.submittedAt, ageDays: age, slaStatus: age <= 3 ? 'Within SLA' : age <= 5 ? 'At risk' : 'Breached', status: k.status, period: period.label };
    });
  }

  if (code === 'RP-11') {
    return rows.flatMap((k) => {
      const out: Array<Record<string, unknown>> = [];
      if (k.achievement > 150) out.push({ exceptionType: 'ACH > 150%', employeeCode: userById(k.employeeId)?.employeeCode ?? '—', employeeName: userById(k.employeeId)?.fullName ?? '—', department: dename(k.departmentId), kpi: `${k.code} · ${k.name}`, detail: `Achievement ${decimals(k.achievement)}% — outlier for review`, period: period.label, detectedAt: k.updatedAt });
      if (k.overrideScore !== null) out.push({ exceptionType: 'Override', employeeCode: userById(k.employeeId)?.employeeCode ?? '—', employeeName: userById(k.employeeId)?.fullName ?? '—', department: dename(k.departmentId), kpi: `${k.code} · ${k.name}`, detail: `Calculated ${decimals(k.calculatedScore)} → Final ${decimals(k.finalScore)}`, period: period.label, detectedAt: k.updatedAt });
      if (k.status === 'NOT_SUBMITTED') out.push({ exceptionType: 'Not submitted', employeeCode: userById(k.employeeId)?.employeeCode ?? '—', employeeName: userById(k.employeeId)?.fullName ?? '—', department: dename(k.departmentId), kpi: `${k.code} · ${k.name}`, detail: 'Deadline passed with no valid submission — scores 0', period: period.label, detectedAt: k.updatedAt });
      return out;
    });
  }

  // A safe generic table for the remaining report codes.
  return rows.slice(0, 200).map(kpiRow);
};

const reportPreview = (code: string, req: DemoRequest): DemoResponse => {
  const p = req.params ?? {};
  const periodCode = str(p.periodCode) ?? periodById(str(p.periodId) ?? '')?.code ?? '2026-08';
  const rows = rowsForReport(code, periodCode);
  const columns = COLUMNS[code] ?? COLUMNS['RP-01'];
  const catalogue = REPORT_CATALOGUE.find((r) => r.code === code);
  const page = num(p.page, 1);
  const size = num(p.size, 25);
  const totals =
    code === 'RP-01' || code === 'RP-06'
      ? { rows: rows.length, weightedScore: decimals(rows.reduce((a, r) => a + Number((r as Record<string, unknown>).weightedScore ?? 0), 0)) }
      : code === 'RP-03'
        ? { departments: rows.length, approved: rows.reduce((a, r) => a + Number((r as Record<string, unknown>).approved ?? 0), 0) }
        : { rows: rows.length };

  return {
    status: 200,
    data: {
      code,
      name: catalogue?.name ?? code,
      columns,
      rows: rows.slice((page - 1) * size, page * size),
      totals,
      meta: {
        filters: { periodCode },
        generatedAt: new Date().toISOString(),
        generatedBy: { id: currentUser().id, name: currentUser().fullName, email: currentUser().email },
        rowCount: rows.length,
        page,
        size,
        totalPages: Math.max(1, Math.ceil(rows.length / size)),
      },
    },
  };
};

const reportExport = (code: string, req: DemoRequest): DemoResponse => {
  const body = (req.body ?? {}) as { format?: string; filters?: Record<string, string> };
  const periodCode = body.filters?.periodCode ?? '2026-08';
  const rows = rowsForReport(code, periodCode);
  const columns = COLUMNS[code] ?? COLUMNS['RP-01'];
  const catalogue = REPORT_CATALOGUE.find((r) => r.code === code);
  const user = currentUser();
  const filters = Object.entries(body.filters ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ') || 'none';

  return {
    status: 200,
    data: {
      async: false,
      code,
      format: body.format ?? 'XLSX',
      rowCount: rows.length,
      columns,
      rows,
      totals: { rows: rows.length },
      footer: `${code} · ${catalogue?.name ?? code} · ${body.format ?? 'XLSX'}  |  Filters: ${filters}  |  Generated by ${user.fullName} (${user.email}) at ${new Date().toISOString()}  |  Rows: ${rows.length}  |  Anwar Group of Industries · Internal & Confidential`,
      meta: { filters: body.filters ?? {}, generatedAt: new Date().toISOString(), generatedBy: { id: user.id, name: user.fullName, email: user.email }, rowCount: rows.length, page: 1, size: rows.length, totalPages: 1 },
    },
  };
};

// ---------------------------------------------------------------------- entry

/** Resolve a request from the demo dataset, or `null` when no route matches. */
export const resolveDemoRequest = (req: DemoRequest): DemoResponse | null => {
  const clean = req.url.replace(/^\/+/, '').split('?')[0].replace(/\/$/, '');
  for (const route of ROUTES) {
    if (route.method !== req.method) continue;
    const match = clean.match(route.pattern);
    if (match) {
      const result = route.handler(match, { ...req, url: clean });
      if (result) return result;
    }
  }
  // A graceful empty payload beats a 404 in a demo.
  return { status: 200, data: [] };
};

export { DEMO_ACCOUNTS, DEMO_PASSWORD };
