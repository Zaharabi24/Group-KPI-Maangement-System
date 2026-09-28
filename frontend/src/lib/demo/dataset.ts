/**
 * ============================================================================
 *  Demo dataset — the platform running entirely in the browser
 * ============================================================================
 *  A single-page deployment (for example Vercel) cannot host the NestJS API with
 *  PostgreSQL, Redis and BullMQ. When no API is reachable the SPA switches to this
 *  dataset, which reproduces the seeded organisation, users, periods, KPIs,
 *  snapshots, notifications and audit trail — and computes every score with the
 *  SAME calculation engine the server uses, so the numbers match the real system.
 * ============================================================================
 */
import { calculateKpi, formatBdt, roundHalfUp, aggregatePeriod, type CalcDirection, type CalcMeasurementType } from '@/lib/calculation';
import { DEMO_BUSINESS_UNITS } from './organisation';

// --------------------------------------------------------------------- helpers

const uuid = (seed: string): string => {
  // Deterministic UUIDs keep links stable across reloads.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i += 1) {
    h1 = (h1 ^ seed.charCodeAt(i)) * 16777619;
    h2 = (h2 + seed.charCodeAt(i) * (i + 7)) >>> 0;
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  const a = hex(h1);
  const b = hex(h2);
  const c = hex(h1 ^ h2);
  const d = hex((h1 + h2) >>> 0);
  return `${a.slice(0, 8)}-${a.slice(0, 4)}-4${b.slice(1, 4)}-8${c.slice(1, 4)}-${d}${c.slice(0, 4)}`;
};

const dayMs = 86_400_000;
const nowRef = new Date('2026-09-28T10:00:00.000Z');

const iso = (date: Date): string => date.toISOString();
const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);

export const DEMO_PASSWORD = 'Anwar@KPI2026';

// ------------------------------------------------------------------ business units

export interface DemoBusinessUnitRow {
  id: string;
  code: string;
  name: string;
  shortName: string;
  division: string;
  isActive: boolean;
  sortOrder: number;
  departmentCount: number;
}

export interface DemoDepartmentRow {
  id: string;
  code: string;
  name: string;
  businessUnitId: string;
  isActive: boolean;
  businessUnit: { id: string; name: string; code: string };
  employeeCount: number;
  heads: Array<{ id: string; fullName: string; email: string; employeeCode: string }>;
}

export const demoBusinessUnits: DemoBusinessUnitRow[] = DEMO_BUSINESS_UNITS.map((bu, index) => {
  const id = uuid(`bu:${bu.code}`);
  return {
    id,
    code: bu.code,
    name: bu.name,
    shortName: bu.shortName,
    division: bu.division,
    isActive: true,
    sortOrder: index,
    departmentCount: bu.departments.length,
  };
});

export const demoDepartments: DemoDepartmentRow[] = DEMO_BUSINESS_UNITS.flatMap((bu) => {
  const businessUnit = demoBusinessUnits.find((b) => b.code === bu.code)!;
  return bu.departments.map((dept) => ({
    id: uuid(`dept:${bu.code}:${dept.name}`),
    code: dept.code,
    name: dept.name,
    businessUnitId: businessUnit.id,
    isActive: true,
    businessUnit: { id: businessUnit.id, name: businessUnit.name, code: businessUnit.code },
    employeeCount: 0,
    heads: [] as DemoDepartmentRow['heads'],
  }));
});

export const departmentBy = (buCode: string, name: string): DemoDepartmentRow => {
  const businessUnit = demoBusinessUnits.find((b) => b.code === buCode);
  const found = demoDepartments.find((d) => d.businessUnitId === businessUnit?.id && d.name === name);
  if (!found) {
    // Fall back to the first department of the unit so the demo never crashes.
    return demoDepartments.find((d) => d.businessUnitId === businessUnit?.id) ?? demoDepartments[0];
  }
  return found;
};

// ------------------------------------------------------------------------- users

export type DemoRole = 'SUPER_ADMIN' | 'HR_ADMIN' | 'DEPT_HEAD' | 'EMPLOYEE' | 'MGMT_VIEWER' | 'SYS_ADMIN';

export interface DemoUser {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string;
  role: DemoRole;
  designation: string;
  corporatePhone: string | null;
  businessUnitId: string;
  departmentId: string;
  departmentHeadOf: string[];
  organisationConfirmed: boolean;
  emailDigest: boolean;
}

interface SeedUser {
  fullName: string;
  email: string;
  employeeCode: string;
  role: DemoRole;
  bu: string;
  dept: string;
  designation: string;
  phone?: string;
}

const SEED_USERS: SeedUser[] = [
  { fullName: 'Md. Anwar Hossain', email: 'superadmin@anwargroup.net', employeeCode: 'E1001', role: 'SUPER_ADMIN', bu: 'BHB', dept: 'Property Management', designation: 'Deputy Managing Director', phone: '+8801711000001' },
  { fullName: 'Farhana Akter', email: 'hradmin@anwargroup.net', employeeCode: 'E1002', role: 'HR_ADMIN', bu: 'ACL', dept: 'Group HR', designation: 'Head of HR', phone: '+8801711000002' },
  { fullName: 'Group IT Administrator', email: 'sysadmin@anwargroup.net', employeeCode: 'E1003', role: 'SYS_ADMIN', bu: 'AESL', dept: 'Software Development', designation: 'Group IT Manager', phone: '+8801711000003' },
  { fullName: 'Shahriar Kabir', email: 'management.viewer@anwargroup.net', employeeCode: 'E1004', role: 'MGMT_VIEWER', bu: 'BHB', dept: 'Property Management', designation: 'General Manager', phone: '+8801711000004' },

  { fullName: 'Kamrul Hasan', email: 'kamrul.hasan@anwargroup.net', employeeCode: 'E2001', role: 'DEPT_HEAD', bu: 'ACL', dept: 'Sales & Marketing', designation: 'Head of Department', phone: '+8801712000001' },
  { fullName: 'Rafi Ahmed', email: 'rafi.ahmed@anwargroup.net', employeeCode: 'E2002', role: 'EMPLOYEE', bu: 'ACL', dept: 'Sales & Marketing', designation: 'Senior Executive', phone: '+8801712000002' },
  { fullName: 'Nusrat Jahan', email: 'nusrat.jahan@anwargroup.net', employeeCode: 'E2003', role: 'EMPLOYEE', bu: 'ACL', dept: 'Sales & Marketing', designation: 'Executive', phone: '+8801712000003' },
  { fullName: 'Tanvir Islam', email: 'tanvir.islam@anwargroup.net', employeeCode: 'E2004', role: 'EMPLOYEE', bu: 'ACL', dept: 'Sales & Marketing', designation: 'Senior Executive', phone: '+8801712000004' },
  { fullName: 'Sadia Rahman', email: 'sadia.rahman@anwargroup.net', employeeCode: 'E2005', role: 'EMPLOYEE', bu: 'ACL', dept: 'Sales & Marketing', designation: 'Assistant Manager', phone: '+8801712000005' },
  { fullName: 'Imran Chowdhury', email: 'imran.chowdhury@anwargroup.net', employeeCode: 'E2006', role: 'EMPLOYEE', bu: 'ACL', dept: 'Sales & Marketing', designation: 'Manager', phone: '+8801712000006' },
  { fullName: 'Ayesha Siddiqua', email: 'ayesha.siddiqua@anwargroup.net', employeeCode: 'E2007', role: 'EMPLOYEE', bu: 'ACL', dept: 'Sales & Marketing', designation: 'Executive', phone: '+8801712000007' },

  { fullName: 'Rezaul Karim', email: 'rezaul.karim@anwargroup.net', employeeCode: 'E2101', role: 'DEPT_HEAD', bu: 'ACL', dept: 'Marketing & Communication', designation: 'Head of Department', phone: '+8801713000001' },
  { fullName: 'Farzana Yasmin', email: 'farzana.yasmin@anwargroup.net', employeeCode: 'E2102', role: 'EMPLOYEE', bu: 'ACL', dept: 'Marketing & Communication', designation: 'Senior Executive', phone: '+8801713000002' },
  { fullName: 'Mahmudul Hasan', email: 'mahmudul.hasan@anwargroup.net', employeeCode: 'E2103', role: 'EMPLOYEE', bu: 'ACL', dept: 'Marketing & Communication', designation: 'Executive', phone: '+8801713000003' },
  { fullName: 'Sabrina Haque', email: 'sabrina.haque@anwargroup.net', employeeCode: 'E2104', role: 'EMPLOYEE', bu: 'ACL', dept: 'Marketing & Communication', designation: 'Assistant Manager', phone: '+8801713000004' },

  { fullName: 'Abdul Momin', email: 'abdul.momin@anwargroup.net', employeeCode: 'E2201', role: 'DEPT_HEAD', bu: 'ACL', dept: 'Accounts & Finance', designation: 'Head of Department', phone: '+8801714000001' },
  { fullName: 'Sharmin Sultana', email: 'sharmin.sultana@anwargroup.net', employeeCode: 'E2202', role: 'EMPLOYEE', bu: 'ACL', dept: 'Accounts & Finance', designation: 'Senior Executive', phone: '+8801714000002' },
  { fullName: 'Habibur Rahman', email: 'habibur.rahman@anwargroup.net', employeeCode: 'E2203', role: 'EMPLOYEE', bu: 'ACL', dept: 'Accounts & Finance', designation: 'Manager', phone: '+8801714000003' },

  { fullName: 'Jahangir Alam', email: 'jahangir.alam@anwargroup.net', employeeCode: 'E2301', role: 'DEPT_HEAD', bu: 'ACL', dept: 'Operations', designation: 'Head of Department', phone: '+8801715000001' },
  { fullName: 'Mizanur Rahman', email: 'mizanur.rahman@anwargroup.net', employeeCode: 'E2302', role: 'EMPLOYEE', bu: 'ACL', dept: 'Operations', designation: 'Executive', phone: '+8801715000002' },
  { fullName: 'Rubina Akter', email: 'rubina.akter@anwargroup.net', employeeCode: 'E2303', role: 'EMPLOYEE', bu: 'ACL', dept: 'Operations', designation: 'Senior Executive', phone: '+8801715000003' },

  { fullName: 'Nazmul Huda', email: 'nazmul.huda@anwargroup.net', employeeCode: 'E2401', role: 'DEPT_HEAD', bu: 'ACL', dept: 'Group HR', designation: 'Deputy General Manager', phone: '+8801716000001' },
  { fullName: 'Golam Mostafa', email: 'golam.mostafa@anwargroup.net', employeeCode: 'E3001', role: 'DEPT_HEAD', bu: 'ACSL', dept: 'Sales & Marketing', designation: 'Head of Department', phone: '+8801717000001' },
  { fullName: 'Rakibul Hasan', email: 'rakibul.hasan@anwargroup.net', employeeCode: 'E3002', role: 'EMPLOYEE', bu: 'ACSL', dept: 'Sales & Marketing', designation: 'Senior Executive', phone: '+8801717000002' },
  { fullName: 'Tahmina Begum', email: 'tahmina.begum@anwargroup.net', employeeCode: 'E3003', role: 'EMPLOYEE', bu: 'ACSL', dept: 'Sales & Marketing', designation: 'Executive', phone: '+8801717000003' },
  { fullName: 'Asif Mahmud', email: 'asif.mahmud@anwargroup.net', employeeCode: 'E4001', role: 'DEPT_HEAD', bu: 'AESL', dept: 'Software Development', designation: 'Head of Department', phone: '+8801718000001' },
  { fullName: 'Sabbir Ahmed', email: 'sabbir.ahmed@anwargroup.net', employeeCode: 'E4002', role: 'EMPLOYEE', bu: 'AESL', dept: 'Software Development', designation: 'Software Engineer', phone: '+8801718000002' },
];

export const demoUsers: DemoUser[] = SEED_USERS.map((u) => {
  const dept = departmentBy(u.bu, u.dept);
  return {
    id: uuid(`user:${u.email}`),
    fullName: u.fullName,
    email: u.email,
    employeeCode: u.employeeCode,
    role: u.role,
    designation: u.designation,
    corporatePhone: u.phone ?? null,
    businessUnitId: dept.businessUnitId,
    departmentId: dept.id,
    departmentHeadOf: u.role === 'DEPT_HEAD' ? [dept.id] : [],
    organisationConfirmed: true,
    emailDigest: false,
  };
});

export const userByEmail = (email: string): DemoUser | undefined =>
  demoUsers.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());

export const userById = (id: string): DemoUser | undefined => demoUsers.find((u) => u.id === id);

// Attach heads and headcount to the departments now that users exist.
for (const dept of demoDepartments) {
  dept.heads = demoUsers
    .filter((u) => u.departmentHeadOf.includes(dept.id))
    .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, employeeCode: u.employeeCode }));
  dept.employeeCount = demoUsers.filter((u) => u.departmentId === dept.id).length;
}

/** One-click sign-in accounts shown on the login screen. */
export interface DemoAccount {
  key: string;
  role: DemoRole;
  label: string;
  summary: string;
  email: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    key: 'employee',
    role: 'EMPLOYEE',
    label: 'Employee',
    summary: 'My KPI · Performance Summary',
    email: 'rafi.ahmed@anwargroup.net',
  },
  {
    key: 'dept-head',
    role: 'DEPT_HEAD',
    label: 'Department Head',
    summary: 'Dashboard · Pending Requests · Leaderboard',
    email: 'kamrul.hasan@anwargroup.net',
  },
  {
    key: 'super-admin',
    role: 'SUPER_ADMIN',
    label: 'Super Admin',
    summary: 'Group Dashboard · All Requests · Escalations · Admin',
    email: 'superadmin@anwargroup.net',
  },
  {
    key: 'hr-admin',
    role: 'HR_ADMIN',
    label: 'HR Admin',
    summary: 'Users · Organisation · Reports',
    email: 'hradmin@anwargroup.net',
  },
  {
    key: 'viewer',
    role: 'MGMT_VIEWER',
    label: 'Management Viewer',
    summary: 'Group Dashboard (read-only) · Reports',
    email: 'management.viewer@anwargroup.net',
  },
  {
    key: 'sys-admin',
    role: 'SYS_ADMIN',
    label: 'System Administrator',
    summary: 'System Health · technical logs only',
    email: 'sysadmin@anwargroup.net',
  },
];

// ----------------------------------------------------------------------- periods

export interface DemoPeriod {
  id: string;
  code: string;
  label: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  year: number;
  periodIndex: number;
  startDate: string;
  endDate: string;
  submissionDeadline: string;
  reviewDeadline: string;
  status: 'OPEN' | 'CLOSED' | 'REOPENED';
  closedAt: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const buildPeriods = (): DemoPeriod[] => {
  const out: DemoPeriod[] = [];
  for (const year of [2025, 2026, 2027]) {
    for (let month = 1; month <= 12; month += 1) {
      const start = utcDate(year, month, 1);
      const end = utcDate(year, month + 1, 0);
      const deadline = new Date(end.getTime() + 7 * dayMs);
      const reviewDeadline = new Date(deadline.getTime() + 7 * dayMs);
      const closed = reviewDeadline < nowRef;
      out.push({
        id: uuid(`period:MONTHLY:${year}-${String(month).padStart(2, '0')}`),
        code: `${year}-${String(month).padStart(2, '0')}`,
        label: `${MONTHS[month - 1]} ${year}`,
        frequency: 'MONTHLY',
        year,
        periodIndex: month,
        startDate: dateOnly(start),
        endDate: dateOnly(end),
        submissionDeadline: dateOnly(deadline),
        reviewDeadline: dateOnly(reviewDeadline),
        status: closed ? 'CLOSED' : 'OPEN',
        closedAt: closed ? iso(reviewDeadline) : null,
      });
    }
    for (let q = 1; q <= 4; q += 1) {
      const startMonth = (q - 1) * 3 + 1;
      const start = utcDate(year, startMonth, 1);
      const end = utcDate(year, startMonth + 3, 0);
      const deadline = new Date(end.getTime() + 7 * dayMs);
      const reviewDeadline = new Date(deadline.getTime() + 7 * dayMs);
      const closed = reviewDeadline < nowRef;
      out.push({
        id: uuid(`period:QUARTERLY:${year}-Q${q}`),
        code: `${year}-Q${q}`,
        label: `Q${q} ${year}`,
        frequency: 'QUARTERLY',
        year,
        periodIndex: q,
        startDate: dateOnly(start),
        endDate: dateOnly(end),
        submissionDeadline: dateOnly(deadline),
        reviewDeadline: dateOnly(reviewDeadline),
        status: closed ? 'CLOSED' : 'OPEN',
        closedAt: closed ? iso(reviewDeadline) : null,
      });
    }
    const start = utcDate(year, 1, 1);
    const end = utcDate(year, 12, 31);
    const deadline = new Date(end.getTime() + 7 * dayMs);
    const reviewDeadline = new Date(deadline.getTime() + 7 * dayMs);
    const closed = reviewDeadline < nowRef;
    out.push({
      id: uuid(`period:YEARLY:${year}`),
      code: `${year}`,
      label: `${year}`,
      frequency: 'YEARLY',
      year,
      periodIndex: 1,
      startDate: dateOnly(start),
      endDate: dateOnly(end),
      submissionDeadline: dateOnly(deadline),
      reviewDeadline: dateOnly(reviewDeadline),
      status: closed ? 'CLOSED' : 'OPEN',
      closedAt: closed ? iso(reviewDeadline) : null,
    });
  }
  return out;
};

export const demoPeriods: DemoPeriod[] = buildPeriods();

export const periodByCode = (code: string): DemoPeriod | undefined => demoPeriods.find((p) => p.code === code);
export const periodById = (id: string): DemoPeriod | undefined => demoPeriods.find((p) => p.id === id);

export const demoCategories = [
  { id: uuid('cat:FINANCIAL'), code: 'FINANCIAL', name: 'Financial', isActive: true, sortOrder: 1 },
  { id: uuid('cat:CUSTOMER'), code: 'CUSTOMER', name: 'Customer', isActive: true, sortOrder: 2 },
  { id: uuid('cat:INTERNAL_PROCESS'), code: 'INTERNAL_PROCESS', name: 'Internal Process', isActive: true, sortOrder: 3 },
  { id: uuid('cat:PEOPLE_LEARNING'), code: 'PEOPLE_LEARNING', name: 'People & Learning', isActive: true, sortOrder: 4 },
];

export const categoryByCode = (code: string) => demoCategories.find((c) => c.code === code)!;

/** Numeric view used by the calculation engine. */
export const demoCalcConfig = {
  scoreCap: 120,
  scoreFloor: 0,
  qualitativeMap: { '1': 50, '2': 75, '3': 100, '4': 110, '5': 120 } as Record<string, number>,
};

export const demoConfig = {
  id: uuid('config:v1'),
  version: 1,
  effectiveFrom: '2026-01-01',
  scoreCap: '120.00',
  scoreFloor: '0.00',
  adjustmentBand: '10.00',
  minWeight: 5,
  maxWeight: 50,
  maxKpisPerPeriod: 10,
  submissionGraceDays: 7,
  reviewWindowDays: 7,
  reviewSlaDays: 5,
  extensionMaxDays: 7,
  minReasonLength: 15,
  maxEvidenceFiles: 5,
  maxEvidenceSizeMb: 10,
  qualitativeMap: { '1': 50, '2': 75, '3': 100, '4': 110, '5': 120 },
  ragThresholds: { green: 95, amber: 75 },
  categories: ['FINANCIAL', 'CUSTOMER', 'INTERNAL_PROCESS', 'PEOPLE_LEARNING'],
  isActive: true,
  notes: 'Phase 01 defaults from BRD v1.0 §4, §3.7 and §21.4 (D-01, D-07, D-08, D-09).',
  createdAt: iso(new Date('2026-01-01T00:00:00Z')),
  publishedBy: null,
};

// ---------------------------------------------------------------------- templates

const TEMPLATE_SPECS = [
  { code: 'TPL-MONTHLY-SALES', name: 'Monthly Sales Revenue', description: 'Revenue booked through the corporate sales channel for the month.', category: 'FINANCIAL', measurementType: 'MONETARY', unit: 'BDT', direction: 'HIGHER', suggestedWeight: 30 },
  { code: 'TPL-UPSELL-REVENUE', name: 'Upsell Revenue', description: 'Incremental revenue from existing accounts (upsell and cross-sell).', category: 'FINANCIAL', measurementType: 'MONETARY', unit: 'BDT', direction: 'HIGHER', suggestedWeight: 15 },
  { code: 'TPL-PROPOSAL-TURNAROUND', name: 'Proposal Turnaround', description: 'Average working days from client request to proposal submission.', category: 'INTERNAL_PROCESS', measurementType: 'TIME', unit: 'days', direction: 'LOWER', suggestedWeight: 10 },
  { code: 'TPL-NEW-CLIENTS', name: 'New Client Acquisitions', description: 'Number of new client accounts signed in the period.', category: 'CUSTOMER', measurementType: 'COUNT', unit: 'clients', direction: 'HIGHER', suggestedWeight: 25 },
  { code: 'TPL-CUSTOMER-RATING', name: 'Customer Satisfaction Rating', description: 'Average customer satisfaction rating on a 1–5 scale.', category: 'CUSTOMER', measurementType: 'RATING', unit: 'rating', direction: 'HIGHER', suggestedWeight: 20 },
  { code: 'TPL-COMPLAINT-RATE', name: 'Complaint Rate per 100 Deliveries', description: 'Customer complaints per 100 deliveries. Lower is better.', category: 'CUSTOMER', measurementType: 'PERCENTAGE', unit: 'per 100', direction: 'LOWER', suggestedWeight: 15 },
  { code: 'TPL-ON-TIME-DELIVERY', name: 'On-time Delivery %', description: 'Share of orders delivered on or before the committed date.', category: 'INTERNAL_PROCESS', measurementType: 'PERCENTAGE', unit: '%', direction: 'HIGHER', suggestedWeight: 20 },
  { code: 'TPL-LOST-TIME-INCIDENTS', name: 'Lost-time Safety Incidents', description: 'Lost-time incidents in the period. Zero tolerance.', category: 'INTERNAL_PROCESS', measurementType: 'COUNT', unit: 'incidents', direction: 'LOWER', suggestedWeight: 10 },
  { code: 'TPL-TRAINING-HOURS', name: 'Team Learning Hours', description: 'Average learning and development hours per team member.', category: 'PEOPLE_LEARNING', measurementType: 'TIME', unit: 'hours', direction: 'HIGHER', suggestedWeight: 10 },
  { code: 'TPL-COLLABORATION', name: 'Collaboration & Values', description: 'Rubric assessment of collaboration and group values.', category: 'PEOPLE_LEARNING', measurementType: 'QUALITATIVE', unit: 'level', direction: 'HIGHER', suggestedWeight: 10 },
] as const;

export const demoTemplates = TEMPLATE_SPECS.map((t) => ({
  id: uuid(`tpl:${t.code}`),
  code: t.code,
  name: t.name,
  description: t.description,
  kpiType: 'VARIABLE',
  category: { id: categoryByCode(t.category).id, code: t.category, name: categoryByCode(t.category).name },
  measurementType: t.measurementType,
  unit: t.unit,
  direction: t.direction,
  suggestedWeight: t.suggestedWeight,
  rubricDescriptors:
    t.measurementType === 'QUALITATIVE'
      ? { '1': 'Below expectations', '2': 'Partially meets', '3': 'Meets expectations', '4': 'Exceeds expectations', '5': 'Outstanding' }
      : null,
  scope: 'GROUP' as const,
  department: null as null | { id: string; name: string },
  version: 1,
  isPublished: true,
}));

// --------------------------------------------------------------------------- KPIs

export interface DemoKpi {
  id: string;
  code: string;
  employeeId: string;
  periodId: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  name: string;
  description: string;
  categoryCode: keyof typeof CATEGORY_NAMES;
  categoryName: string;
  measurementType: CalcMeasurementType;
  unit: string;
  direction: CalcDirection;
  target: number | null;
  actual: number | null;
  rubricLevel: number | null;
  achievement: number;
  calculatedScore: number;
  finalScore: number;
  overrideScore: number | null;
  kpiWeight: number;
  weightedScore: number;
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'RETURNED' | 'ESCALATED' | 'APPROVED' | 'REJECTED' | 'NOT_SUBMITTED' | 'DELETED';
  isLocked: boolean;
  isAssigned: boolean;
  remarks: string;
  evidenceCount: number;
  approverId: string | null;
  departmentId: string;
  businessUnitId: string;
  submittedAt: string | null;
  reviewStartedAt: string | null;
  decidedAt: string | null;
  returnComment: string | null;
  rejectCategory: string | null;
  rejectedReason: string | null;
  rowVersion: number;
  currentVersionNo: number;
  createdAt: string;
  updatedAt: string;
  formulaText: string;
  adjustments: Array<{ id: string; field: string; oldValue: string | null; newValue: string | null; reason: string; actor: string; actorRoles: string[]; at: string }>;
  decisions: Array<{ id: string; action: string; actor: string; reason: string | null; rejectCategory: string | null; scoreBefore: string | null; scoreAfter: string | null; statusBefore: string | null; statusAfter: string | null; at: string }>;
  versions: Array<{ id: string; versionNo: number; trigger: string; changeReason: string | null; createdBy: string; createdAt: string; snapshot: Record<string, unknown>; calculation: Record<string, unknown> | null }>;
  evidence: Array<{ id: string; originalName: string; fileName: string; mimeType: string; extension: string; sizeBytes: number; sha256: string; scanStatus: string; isCurrent: boolean; versionNo: number; createdAt: string; previewable: boolean }>;
  escalations: Array<{ id: string; calculatedScore: string | null; proposedScore: string | null; delta: string | null; reason: string; status: string; createdAt: string }>;
}

const CATEGORY_NAMES = {
  FINANCIAL: 'Financial',
  CUSTOMER: 'Customer',
  INTERNAL_PROCESS: 'Internal Process',
  PEOPLE_LEARNING: 'People & Learning',
} as const;

interface KpiSpec {
  name: string;
  categoryCode: keyof typeof CATEGORY_NAMES;
  measurementType: CalcMeasurementType;
  unit: string;
  direction: CalcDirection;
  target: number | null;
  actual: number | null;
  weight: number;
  remarks: string;
}

const baseSpecs = (profile: 'strong' | 'solid' | 'steady' | 'improving'): KpiSpec[] => {
  const specs: KpiSpec[] = [
    { name: 'Monthly Sales', categoryCode: 'FINANCIAL', measurementType: 'MONETARY', unit: 'BDT', direction: 'HIGHER', target: 10_000_000, actual: 9_833_486.62, weight: 30, remarks: 'Revenue booked through the corporate sales channel for the month, reconciled with the general ledger.' },
    { name: 'Upsell Revenue', categoryCode: 'FINANCIAL', measurementType: 'MONETARY', unit: 'BDT', direction: 'HIGHER', target: 500_000, actual: 610_000, weight: 15, remarks: 'Incremental revenue from existing accounts, verified against the invoiced-orders extract.' },
    { name: 'Proposal Turnaround', categoryCode: 'INTERNAL_PROCESS', measurementType: 'TIME', unit: 'days', direction: 'LOWER', target: 5, actual: 4, weight: 10, remarks: 'Average working days from client request to proposal submission across the month.' },
    { name: 'New Client Acquisitions', categoryCode: 'CUSTOMER', measurementType: 'COUNT', unit: 'clients', direction: 'HIGHER', target: 12, actual: 10, weight: 25, remarks: 'New client accounts signed and registered in the CRM during the month.' },
    { name: 'Customer Rating', categoryCode: 'CUSTOMER', measurementType: 'RATING', unit: 'rating', direction: 'HIGHER', target: 4, actual: 3, weight: 20, remarks: 'Average customer satisfaction rating collected through the post-delivery survey.' },
  ];

  switch (profile) {
    case 'strong':
      return [
        { ...specs[0], actual: 10_624_000 },
        { ...specs[1], actual: 640_000 },
        { ...specs[2], actual: 3.5 },
        { ...specs[3], actual: 14 },
        { ...specs[4], actual: 4.5 },
      ];
    case 'steady':
      return [
        { ...specs[0], actual: 9_120_000 },
        { ...specs[1], actual: 540_000 },
        { ...specs[2], actual: 5.5 },
        { ...specs[3], actual: 9 },
        { ...specs[4], actual: 3.6 },
      ];
    case 'improving':
      return specs.map((s) => ({
        ...s,
        target: s.target !== null ? Math.round(s.target * 0.85 * 100) / 100 : null,
        actual: s.actual !== null ? Math.round(s.actual * 0.82 * 100) / 100 : null,
      }));
    case 'solid':
    default:
      return specs;
  }
};

export const DEMO_EVIDENCE_NAMES = [
  'Monthly_Sales_evidence.csv',
  'Upsell_Revenue_evidence.csv',
  'Proposal_Turnaround_evidence.csv',
  'New_Client_Acquisitions_evidence.csv',
  'Customer_Rating_evidence.csv',
];

const APPROVER_BY_DEPARTMENT = (departmentId: string): string | null =>
  demoUsers.find((u) => u.role === 'DEPT_HEAD' && u.departmentHeadOf.includes(departmentId))?.id ?? null;

const CLOSED_MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08'];
const OPEN_MONTH = '2026-09';
const PROFILES: Array<'strong' | 'solid' | 'steady' | 'improving'> = ['strong', 'solid', 'steady', 'improving'];

const scoreOf = (spec: KpiSpec, override: number | null = null) =>
  calculateKpi({
    target: spec.target,
    actual: spec.actual,
    rubricLevel: spec.measurementType === 'QUALITATIVE' ? 3 : null,
    kpiWeight: spec.weight,
    direction: spec.direction,
    measurementType: spec.measurementType,
    overrideScore: override,
    config: demoCalcConfig,
  });

const buildKpis = (): DemoKpi[] => {
  const out: DemoKpi[] = [];
  const employees = demoUsers.filter((u) => u.role === 'EMPLOYEE');
  let sequence = 0;

  const push = (
    employee: DemoUser,
    periodCode: string,
    spec: KpiSpec,
    status: DemoKpi['status'],
    opts: { adjusted?: boolean; approverId?: string | null; submittedOffsetDays?: number } = {},
  ) => {
    const period = periodByCode(periodCode);
    if (!period) return;

    sequence += 1;
    const base = scoreOf(spec);
    const override = opts.adjusted ? roundHalfUp(Math.min(base.calculatedScore + 5, 120)) : null;
    const result = scoreOf(spec, override);

    const approverId =
      opts.approverId !== undefined ? opts.approverId : APPROVER_BY_DEPARTMENT(employee.departmentId);
    const submittedAt =
      status === 'DRAFT'
        ? null
        : new Date(new Date(period.endDate + 'T09:00:00Z').getTime() - (opts.submittedOffsetDays ?? 2) * dayMs).toISOString();
    const decidedAt = status === 'APPROVED' && submittedAt ? new Date(new Date(submittedAt).getTime() + 2 * dayMs).toISOString() : null;
    const buCode = demoBusinessUnits.find((b) => b.id === employee.businessUnitId)?.code ?? 'GRP';
    const hasEvidence = status !== 'DRAFT';

    const id = uuid(`kpi:${employee.email}:${periodCode}:${spec.name}`);
    const sha256 = uuid(`sha:${id}`).replace(/-/g, '').padEnd(64, 'a').slice(0, 64);

    out.push({
      id,
      code: `KPI-${buCode}-${periodCode.slice(0, 4)}-${String(sequence).padStart(6, '0')}`,
      employeeId: employee.id,
      periodId: period.id,
      frequency: period.frequency,
      name: spec.name,
      description: spec.remarks,
      categoryCode: spec.categoryCode,
      categoryName: CATEGORY_NAMES[spec.categoryCode],
      measurementType: spec.measurementType,
      unit: spec.unit,
      direction: spec.direction,
      target: spec.target,
      actual: spec.actual,
      rubricLevel: spec.measurementType === 'QUALITATIVE' ? 3 : null,
      achievement: result.achievement,
      calculatedScore: result.calculatedScore,
      finalScore: status === 'APPROVED' ? result.finalScore : result.calculatedScore,
      overrideScore: override,
      kpiWeight: spec.weight,
      weightedScore: result.weightedScore,
      status,
      isLocked: period.status === 'CLOSED',
      isAssigned: false,
      remarks: spec.remarks,
      evidenceCount: hasEvidence ? 1 : 0,
      approverId,
      departmentId: employee.departmentId,
      businessUnitId: employee.businessUnitId,
      submittedAt,
      reviewStartedAt: submittedAt,
      decidedAt,
      returnComment: null,
      rejectCategory: null,
      rejectedReason: null,
      rowVersion: status === 'DRAFT' ? 1 : 4,
      currentVersionNo: status === 'DRAFT' ? 1 : status === 'APPROVED' ? 2 : 1,
      createdAt: new Date(new Date(period.startDate + 'T08:00:00Z').getTime() + 2 * dayMs).toISOString(),
      updatedAt: decidedAt ?? submittedAt ?? new Date(period.startDate + 'T08:00:00Z').toISOString(),
      formulaText: result.formulaText,
      adjustments:
        override !== null && decidedAt
          ? [
              {
                id: uuid(`adj:${id}`),
                field: 'finalScore',
                oldValue: base.calculatedScore.toFixed(2),
                newValue: override.toFixed(2),
                reason: 'Adjusted after reviewing the supporting evidence.',
                actor: demoUsers.find((u) => u.id === approverId)?.fullName ?? 'Super Admin',
                actorRoles: ['DEPT_HEAD'],
                at: new Date(new Date(decidedAt).getTime() - dayMs).toISOString(),
              },
            ]
          : [],
      decisions:
        status === 'DRAFT'
          ? []
          : [
              {
                id: uuid(`dec:${id}`),
                action: status === 'APPROVED' ? (override !== null ? 'ADJUST' : 'APPROVE') : 'APPROVE',
                actor: demoUsers.find((u) => u.id === approverId)?.fullName ?? 'Super Admin',
                reason: status === 'APPROVED' ? (override !== null ? 'Adjusted after reviewing the supporting evidence.' : 'Approve calculated') : 'Review started',
                rejectCategory: null,
                scoreBefore: base.calculatedScore.toFixed(2),
                scoreAfter: (override ?? base.calculatedScore).toFixed(2),
                statusBefore: 'UNDER_REVIEW',
                statusAfter: status,
                at: decidedAt ?? submittedAt ?? iso(nowRef),
              },
            ],
      versions:
        status === 'DRAFT'
          ? [
              {
                id: uuid(`ver:${id}:1`),
                versionNo: 1,
                trigger: 'CREATE',
                changeReason: 'Draft created',
                createdBy: employee.fullName,
                createdAt: new Date(new Date(period.startDate + 'T08:00:00Z').getTime() + 2 * dayMs).toISOString(),
                snapshot: { name: spec.name, target: spec.target, actual: spec.actual, kpiWeight: spec.weight, status: 'DRAFT' },
                calculation: null,
              },
            ]
          : [
              {
                id: uuid(`ver:${id}:1`),
                versionNo: 1,
                trigger: 'SUBMIT',
                changeReason: 'Submitted by the owner',
                createdBy: employee.fullName,
                createdAt: submittedAt ?? iso(nowRef),
                snapshot: { name: spec.name, target: spec.target, actual: spec.actual, kpiWeight: spec.weight, achievement: base.achievement, calculatedScore: base.calculatedScore, status: 'SUBMITTED' },
                calculation: { achievement: base.achievement, calculatedScore: base.calculatedScore, weightedScore: base.weightedScore },
              },
              ...(status === 'APPROVED'
                ? [
                    {
                      id: uuid(`ver:${id}:2`),
                      versionNo: 2,
                      trigger: override !== null ? 'ADJUST' : 'APPROVE',
                      changeReason: override !== null ? 'Adjusted after reviewing the supporting evidence.' : 'Approved calculated',
                      createdBy: demoUsers.find((u) => u.id === approverId)?.fullName ?? 'Super Admin',
                      createdAt: decidedAt ?? iso(nowRef),
                      snapshot: { name: spec.name, target: spec.target, actual: spec.actual, kpiWeight: spec.weight, achievement: result.achievement, calculatedScore: result.calculatedScore, finalScore: result.finalScore, status: 'APPROVED' },
                      calculation: { achievement: result.achievement, calculatedScore: result.calculatedScore, finalScore: result.finalScore, weightedScore: result.weightedScore },
                    },
                  ]
                : []),
            ],
      evidence: hasEvidence
        ? [
            {
              id: uuid(`ev:${id}`),
              originalName: `${spec.name.replace(/[^A-Za-z0-9]+/g, '_')}_evidence.csv`,
              fileName: `${sha256.slice(0, 12)}.csv`,
              mimeType: 'text/csv',
              extension: 'csv',
              sizeBytes: 1024 + (sequence % 800),
              sha256,
              scanStatus: 'CLEAN',
              isCurrent: true,
              versionNo: 1,
              createdAt: submittedAt ?? iso(nowRef),
              previewable: false,
            },
          ]
        : [],
      escalations: [],
    });
  };

  // Closed months: every KPI approved (history, leaderboard, trends)
  for (const monthCode of CLOSED_MONTHS) {
    for (const [index, employee] of employees.entries()) {
      const profile = PROFILES[index % PROFILES.length];
      for (const spec of baseSpecs(profile)) {
        push(employee, monthCode, spec, 'APPROVED', {
          adjusted: profile === 'improving' && spec.name === 'Customer Rating',
        });
      }
    }
  }

  // Open month: a realistic mix so every screen has something to show
  for (const [index, employee] of employees.entries()) {
    if (employee.email === 'ayesha.siddiqua@anwargroup.net') continue;
    const profile = PROFILES[index % PROFILES.length];
    for (const [specIndex, spec] of baseSpecs(profile).entries()) {
      const mod = (index + specIndex) % 5;
      const status: DemoKpi['status'] = mod === 0 ? 'DRAFT' : mod === 1 ? 'SUBMITTED' : mod === 2 ? 'UNDER_REVIEW' : 'APPROVED';
      push(employee, OPEN_MONTH, spec, status, { submittedOffsetDays: 1 + (index % 4) });
    }
  }

  // An incomplete Draft so the empty state and validation paths are visible
  const ayesha = userByEmail('ayesha.siddiqua@anwargroup.net')!;
  push(
    ayesha,
    OPEN_MONTH,
    { name: 'Digital Campaign Reach', categoryCode: 'CUSTOMER', measurementType: 'COUNT', unit: 'impressions', direction: 'HIGHER', target: 250_000, actual: null, weight: 10, remarks: '' },
    'DRAFT',
  );

  // Department Head KPIs routed to the Super Admin queue (FR-APR-08)
  const kamrul = userByEmail('kamrul.hasan@anwargroup.net')!;
  push(
    kamrul,
    OPEN_MONTH,
    { name: 'Department Revenue Target', categoryCode: 'FINANCIAL', measurementType: 'MONETARY', unit: 'BDT', direction: 'HIGHER', target: 45_000_000, actual: 41_800_000, weight: 40, remarks: 'Department revenue for the month, reconciled with the finance close. Routed to the Super Admin queue.' },
    'SUBMITTED',
    { approverId: null, submittedOffsetDays: 1 },
  );
  const rezaul = userByEmail('rezaul.karim@anwargroup.net')!;
  push(
    rezaul,
    OPEN_MONTH,
    { name: 'Marketing Qualified Leads', categoryCode: 'CUSTOMER', measurementType: 'COUNT', unit: 'leads', direction: 'HIGHER', target: 800, actual: 742, weight: 35, remarks: 'Marketing qualified leads generated in the month. Routed to the Super Admin queue.' },
    'SUBMITTED',
    { approverId: null, submittedOffsetDays: 2 },
  );

  return out;
};

export const demoKpis: DemoKpi[] = buildKpis();

export const kpiById = (id: string): DemoKpi | undefined => demoKpis.find((k) => k.id === id);

/** A submitted KPI that the Department Head can act on, used to seed one escalation. */
const escalationCandidate = demoKpis.find(
  (k) => k.status === 'UNDER_REVIEW' && k.employeeId === userByEmail('rafi.ahmed@anwargroup.net')?.id,
);

export const demoEscalations = escalationCandidate
  ? [
      {
        id: uuid(`esc:${escalationCandidate.id}`),
        kpiId: escalationCandidate.id,
        requestedById: escalationCandidate.approverId ?? '',
        calculatedScore: escalationCandidate.calculatedScore.toFixed(2),
        proposedScore: roundHalfUp(Math.min(escalationCandidate.calculatedScore + 12, 120)).toFixed(2),
        delta: '12.00',
        reason: 'Actual revised after the finance extract was reconciled; the correction moves the score outside the band.',
        status: 'PENDING',
        decidedById: null,
        decidedAt: null,
        decisionComment: null,
        createdAt: new Date(nowRef.getTime() - 2 * dayMs).toISOString(),
      },
    ]
  : [];

// ---------------------------------------------------------------- notifications

export interface DemoNotification {
  id: string;
  userId: string;
  code: string;
  title: string;
  body: string;
  deepLink: string | null;
  entityType: string | null;
  entityId: string | null;
  status: 'UNREAD' | 'READ';
  severity: 'info' | 'success' | 'warning' | 'danger';
  readAt: string | null;
  createdAt: string;
}

const buildNotifications = (): DemoNotification[] => {
  const out: DemoNotification[] = [];
  const add = (userId: string, code: string, title: string, body: string, deepLink: string, severity: DemoNotification['severity'], hoursAgo: number) => {
    out.push({
      id: uuid(`nt:${userId}:${code}:${hoursAgo}`),
      userId,
      code,
      title,
      body,
      deepLink,
      entityType: 'kpi',
      entityId: null,
      status: hoursAgo < 20 ? 'UNREAD' : 'READ',
      severity,
      readAt: hoursAgo < 20 ? null : iso(new Date(nowRef.getTime() - hoursAgo * 3600_000)),
      createdAt: new Date(nowRef.getTime() - hoursAgo * 3600_000).toISOString(),
    });
  };

  for (const user of demoUsers) {
    if (user.role === 'EMPLOYEE' || user.role === 'DEPT_HEAD') {
      add(user.id, 'NT-13', 'Reminder: 5 day(s) left to submit your KPIs', `You have 5 days left in the ${'September 2026'} submission window. Weight allocated below 100% for some employees.`, '/my-kpi', 'warning', 6);
      add(user.id, 'NT-07', 'Your KPI was approved: Monthly Sales', 'Final Score 98.33 · Weighted Score 29.50.', '/my-kpi', 'success', 30);
      add(user.id, 'NT-09', 'Your KPI was returned for correction: New Client Acquisitions', 'Please attach the signed finance extract to the evidence.', '/my-kpi', 'warning', 52);
    }
    if (user.role === 'DEPT_HEAD') {
      add(user.id, 'NT-05', 'KPI submitted for your review', 'Rafi Ahmed (E2002) submitted "Monthly Sales" — Achievement 98.33%.', '/approvals', 'info', 3);
      add(user.id, 'NT-05', 'KPI submitted for your review', 'Nusrat Jahan (E2003) submitted "Upsell Revenue" — Achievement 122.00%.', '/approvals', 'info', 9);
      add(user.id, 'NT-15', 'Review SLA breached: 2 request(s) waiting 6 working days', 'The review SLA of 5 working days has been breached.', '/approvals', 'warning', 26);
    }
    if (user.role === 'SUPER_ADMIN') {
      add(user.id, 'NT-11', 'Escalation: adjustment outside the ±10.00 band', 'Calculated 83.33 → proposed 95.00 (Δ 11.67). A Super Admin decision is required.', '/escalations', 'warning', 2);
      add(user.id, 'NT-05', 'Department Head KPI awaiting your decision', 'Kamrul Hasan submitted "Department Revenue Target".', '/head-kpi-requests', 'info', 5);
      add(user.id, 'NT-16', 'Results published for August 2026', 'The period is closed and its results are final.', '/performance-summary', 'success', 200);
    }
    if (user.role === 'HR_ADMIN') {
      add(user.id, 'NT-02', 'Invitation accepted', 'Nazmul Huda activated the Department Head account for Group HR.', '/admin/users', 'success', 40);
      add(user.id, 'NT-01', 'New self-registration awaiting confirmation', 'An employee registered and selected a department that needs confirmation.', '/admin/users', 'info', 12);
    }
    if (user.role === 'SYS_ADMIN') {
      add(user.id, 'NT-15', 'Nightly calculation verification: 0 mismatches', 'Checked 118 open-period KPIs; every stored value matches the engine output.', '/admin/system-health', 'success', 8);
    }
  }
  return out;
};

export const demoNotifications: DemoNotification[] = buildNotifications();

// ---------------------------------------------------------------------- audit

export interface DemoAuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorRole: string | null;
  reason: string | null;
  ipAddress: string;
  correlationId: string;
  previousHash: string;
  recordHash: string;
  before: unknown;
  after: unknown;
  changedFields: unknown;
  createdAt: string;
  actor: { id: string; fullName: string; email: string; employeeCode: string } | null;
  department: { id: string; name: string } | null;
}

const buildAudit = (): DemoAuditEntry[] => {
  const rows: DemoAuditEntry[] = [];
  const actorPool = demoUsers.slice(0, 12);
  const actions: Array<[string, string, string]> = [
    ['auth.login.success', 'user', 'Signed in from a recognised device'],
    ['kpi.submit', 'kpi', 'KPI submitted for approval'],
    ['workflow.review.start', 'kpi', 'Review started'],
    ['workflow.approve', 'kpi', 'Approve calculated'],
    ['workflow.adjust', 'kpi', 'Adjusted after reviewing the supporting evidence'],
    ['evidence.upload', 'kpi_evidence', 'Evidence uploaded (SHA-256 recorded)'],
    ['period.close', 'kpi_period', 'Review window ended'],
    ['configuration.publish', 'configuration_version', 'Phase 01 defaults'],
    ['user.invite.create', 'user', 'Department Head invited'],
    ['report.export', 'report', 'RP-03 exported as CSV'],
    ['kpi.create', 'kpi', 'Draft created'],
    ['workflow.escalate', 'escalation', 'Adjustment outside the ±10 band'],
  ];

  let previous = '0'.repeat(64);
  for (let i = 0; i < 120; i += 1) {
    const [action, entityType, reason] = actions[i % actions.length];
    const actor = actorPool[i % actorPool.length];
    const recordHash = uuid(`audit:${i}:${action}`).replace(/-/g, '').padEnd(64, '0').slice(0, 64);
    rows.push({
      id: uuid(`audit-row:${i}`),
      action,
      entityType,
      entityId: uuid(`entity:${i}`),
      actorRole: actor.role,
      reason,
      ipAddress: `10.20.30.${(i % 200) + 10}`,
      correlationId: uuid(`corr:${i}`),
      previousHash: previous,
      recordHash,
      before: i % 3 === 0 ? { status: 'UNDER_REVIEW', finalScore: null } : null,
      after: i % 3 === 0 ? { status: 'APPROVED', finalScore: '98.33' } : { status: 'SUBMITTED' },
      changedFields: i % 3 === 0 ? [{ field: 'finalScore', from: null, to: '98.33' }] : null,
      createdAt: new Date(nowRef.getTime() - i * 3 * 3600_000).toISOString(),
      actor: { id: actor.id, fullName: actor.fullName, email: actor.email, employeeCode: actor.employeeCode },
      department: demoDepartments.find((d) => d.id === actor.departmentId)
        ? { id: actor.departmentId, name: demoDepartments.find((d) => d.id === actor.departmentId)!.name }
        : null,
    });
    previous = recordHash;
  }
  return rows;
};

export const demoAuditLog: DemoAuditEntry[] = buildAudit();

// ----------------------------------------------------------------- corrections

// Loosely typed on purpose: the demo appends rows when a correction is requested.
export const demoCorrections: Array<{
  id: string;
  reason: string;
  status: string;
  changes: Record<string, unknown>;
  createdAt: string;
  requester: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  kpi: {
    id: string;
    code: string;
    name: string;
    status: string;
    employee: string;
    employeeCode: string;
    department: string;
    period: string;
    calculatedScore: string;
    finalScore: string;
  };
}> = [
  {
    id: uuid('correction:1'),
    reason: 'The August actual was captured before the final finance close; the number should be 10,120,000.',
    status: 'PENDING',
    changes: { actual: 10_120_000 },
    createdAt: new Date(nowRef.getTime() - 30 * 3600_000).toISOString(),
    requester: 'Kamrul Hasan',
    decidedBy: null,
    decidedAt: null,
    decisionComment: null,
    kpi: (() => {
      const kpi = demoKpis.find((k) => k.status === 'APPROVED' && k.name === 'Monthly Sales');
      return {
        id: kpi?.id ?? uuid('correction:kpi'),
        code: kpi?.code ?? 'KPI-ACL-2026-000001',
        name: kpi?.name ?? 'Monthly Sales',
        status: kpi?.status ?? 'APPROVED',
        employee: userById(kpi?.employeeId ?? '')?.fullName ?? 'Rafi Ahmed',
        employeeCode: userById(kpi?.employeeId ?? '')?.employeeCode ?? 'E2002',
        department: 'Sales & Marketing',
        period: 'August 2026',
        calculatedScore: kpi ? kpi.calculatedScore.toFixed(2) : '98.33',
        finalScore: kpi ? kpi.finalScore.toFixed(2) : '98.33',
      };
    })(),
  },
];

export const demoInvitations = [
  {
    id: uuid('invitation:1'),
    email: 'nazmul.huda@anwargroup.net',
    fullName: 'Nazmul Huda',
    employeeCode: 'E2401',
    designation: 'Deputy General Manager',
    status: 'ACCEPTED' as const,
    expiresAt: iso(new Date(nowRef.getTime() + 48 * 3600_000)),
    createdAt: iso(new Date(nowRef.getTime() - 72 * 3600_000)),
    businessUnit: { id: demoBusinessUnits.find((b) => b.code === 'ACL')!.id, name: 'Anwar Cement Limited' },
    department: { id: departmentBy('ACL', 'Group HR').id, name: 'Group HR' },
    role: { id: uuid('role:DEPT_HEAD'), code: 'DEPT_HEAD' as const, name: 'Department Head (Admin / Approver)' },
    resendCount: 0,
    lastSentAt: iso(new Date(nowRef.getTime() - 72 * 3600_000)),
  },
  {
    id: uuid('invitation:2'),
    email: 'new.approver@anwargroup.net',
    fullName: 'Pending Approver',
    employeeCode: 'E2501',
    designation: 'Manager',
    status: 'PENDING' as const,
    expiresAt: iso(new Date(nowRef.getTime() + 60 * 3600_000)),
    createdAt: iso(new Date(nowRef.getTime() - 12 * 3600_000)),
    businessUnit: { id: demoBusinessUnits.find((b) => b.code === 'ACL')!.id, name: 'Anwar Cement Limited' },
    department: { id: departmentBy('ACL', 'Internal Audit').id, name: 'Internal Audit' },
    role: { id: uuid('role:DEPT_HEAD'), code: 'DEPT_HEAD' as const, name: 'Department Head (Admin / Approver)' },
    resendCount: 1,
    lastSentAt: iso(new Date(nowRef.getTime() - 6 * 3600_000)),
  },
];

export const demoDelegations = [
  {
    id: uuid('delegation:1'),
    fromUser: { id: demoUsers[4].id, fullName: 'Kamrul Hasan' },
    toUser: { id: demoUsers[12].id, fullName: 'Nazmul Huda' },
    department: { id: departmentBy('ACL', 'Sales & Marketing').id, name: 'Sales & Marketing' },
    startDate: '2026-09-20',
    endDate: '2026-09-30',
    reason: 'Annual leave cover — decisions recorded on behalf of the Department Head.',
    isActive: true,
  },
];

export const demoSystemHealth = {
  status: 'ok',
  responseMs: 12,
  database: { connected: true, users: demoUsers.length, kpis: demoKpis.length, auditRecords: demoAuditLog.length },
  redis: { connected: true },
  queues: {
    email: { name: 'email', waiting: 0, active: 0, completed: 214, failed: 0, delayed: 0, backlog: 0 },
    export: { name: 'export', waiting: 0, active: 0, completed: 12, failed: 0, delayed: 0, backlog: 0 },
    scheduled: { name: 'scheduled', waiting: 1, active: 0, completed: 96, failed: 0, delayed: 6, backlog: 7 },
  },
  queueFailures: { email: [], export: [], scheduled: [] },
  email: { enabled: true, smtpReachable: true, failedMessages: 0 },
  storage: {
    evidencePath: 'in-browser demo storage',
    evidenceWritable: true,
    exportPath: 'in-browser demo storage',
    exportWritable: true,
    encryptionAtRest: true,
    malwareScan: false,
  },
  scheduledJobs: [
    { name: 'deadline-reminders', status: 'SUCCEEDED', startedAt: iso(new Date(nowRef.getTime() - 6 * 3600_000)), endedAt: iso(new Date(nowRef.getTime() - 6 * 3600_000 + 4200)) },
    { name: 'overdue-sweep', status: 'SUCCEEDED', startedAt: iso(new Date(nowRef.getTime() - 10 * 3600_000)), endedAt: iso(new Date(nowRef.getTime() - 10 * 3600_000 + 900)) },
    { name: 'sla-check', status: 'SUCCEEDED', startedAt: iso(new Date(nowRef.getTime() - 5 * 3600_000)), endedAt: iso(new Date(nowRef.getTime() - 5 * 3600_000 + 1500)) },
    { name: 'nightly-verification', status: 'SUCCEEDED', startedAt: iso(new Date(nowRef.getTime() - 8 * 3600_000)), endedAt: iso(new Date(nowRef.getTime() - 8 * 3600_000 + 3200)) },
    { name: 'hash-chain-verify', status: 'SUCCEEDED', startedAt: iso(new Date(nowRef.getTime() - 40 * 3600_000)), endedAt: iso(new Date(nowRef.getTime() - 40 * 3600_000 + 6100)) },
    { name: 'digest-emails', status: 'SUCCEEDED', startedAt: iso(new Date(nowRef.getTime() - 4 * 3600_000)), endedAt: iso(new Date(nowRef.getTime() - 4 * 3600_000 + 800)) },
    { name: 'purge-expired', status: 'SUCCEEDED', startedAt: iso(new Date(nowRef.getTime() - 7 * 3600_000)), endedAt: iso(new Date(nowRef.getTime() - 7 * 3600_000 + 300)) },
  ],
  environment: {
    nodeEnv: 'demo (in-browser)',
    timezone: 'Asia/Dhaka',
    workingWeek: 'Saturday–Thursday (Friday is the weekly holiday)',
    allowedEmailDomain: 'anwargroup.net',
  },
};

export const demoRoleLabels: Record<DemoRole, string> = {
  SUPER_ADMIN: 'Super Admin (Upper Management)',
  HR_ADMIN: 'HR Admin',
  DEPT_HEAD: 'Department Head (Admin / Approver)',
  EMPLOYEE: 'Employee',
  MGMT_VIEWER: 'Management Viewer',
  SYS_ADMIN: 'System Administrator (IT)',
};

export const demoHome: Record<DemoRole, string> = {
  SUPER_ADMIN: '/group-dashboard',
  HR_ADMIN: '/admin/users',
  DEPT_HEAD: '/dashboard',
  EMPLOYEE: '/my-kpi',
  MGMT_VIEWER: '/group-dashboard',
  SYS_ADMIN: '/admin/system-health',
};

export const demoPermissions: Record<DemoRole, string[]> = {
  SUPER_ADMIN: [
    'kpi:view-others', 'kpi:review', 'kpi:edit-under-review', 'kpi:approve-head', 'kpi:approve-correction',
    'period:close', 'user:invite', 'user:manage', 'org:manage', 'template:manage', 'template:dept-manage',
    'kpi:assign', 'config:manage', 'period:manage', 'period:extension-grant', 'dashboard:group', 'dashboard:dept',
    'report:view', 'report:view-all', 'version:history', 'version:restore', 'audit:view', 'audit:view-all',
    'audit:technical', 'system:settings', 'search:global',
  ],
  HR_ADMIN: [
    'kpi:view-others', 'user:invite', 'user:manage', 'org:manage', 'template:manage', 'period:manage',
    'dashboard:group', 'dashboard:dept', 'report:view', 'report:view-all', 'version:history', 'audit:view',
    'audit:view-all', 'search:global',
  ],
  DEPT_HEAD: [
    'kpi:view-others', 'kpi:review', 'kpi:edit-under-review', 'template:dept-manage', 'kpi:assign',
    'period:extension-grant', 'dashboard:dept', 'report:view', 'version:history', 'audit:view', 'search:global',
    'kpi:approve-correction',
  ],
  EMPLOYEE: ['report:view'],
  MGMT_VIEWER: ['kpi:view-others', 'dashboard:group', 'dashboard:dept', 'report:view', 'report:view-all', 'search:global'],
  SYS_ADMIN: ['system:settings', 'audit:technical'],
};

export const DEMO_ORGANISATION = {
  businessUnits: demoBusinessUnits.length,
  departments: demoDepartments.length,
  users: demoUsers.length,
  kpis: demoKpis.length,
  periods: demoPeriods.length,
};

void formatBdt;
void aggregatePeriod;
void DEMO_EVIDENCE_NAMES;
