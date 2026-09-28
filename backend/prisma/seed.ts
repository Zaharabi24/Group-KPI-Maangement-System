/**
 * ============================================================================
 *  ANWAR KPIFlow — database seed
 * ============================================================================
 *  Seeds the complete working platform:
 *    1. Roles and the role catalogue (§5.1)
 *    2. Business Units and Departments from "Business Unit & Department List.xlsx"
 *    3. Designations, KPI categories, configuration version 1
 *    4. The period calendar (monthly / quarterly / yearly)
 *    5. Administrator accounts and a realistic demo organisation
 *    6. KPI Library templates and a full set of KPIs for the demo months
 *    7. Performance snapshots for the closed periods
 *
 *  Run:  npm run seed
 * ============================================================================
 */
import 'dotenv/config';
import { PrismaClient, Frequency, PeriodStatus, UserStatus, KpiStatus } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { createHash, randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { BUSINESS_UNITS } from './seed-data';

const prisma = new PrismaClient();

/** Evidence storage matches the API default (STORAGE_LOCAL_PATH). */
const EVIDENCE_DIR = resolve(process.env.STORAGE_LOCAL_PATH || './storage/evidence');

const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 };
const DEFAULT_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Anwar@KPI2026';
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'Anwar@KPI2026';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------- calculation
// Mirrors backend/src/modules/calculation/calculation.engine.ts (§4.2, §4.3)
const CAP = 120;

interface CalcInput {
  target: number | null;
  actual: number | null;
  rubricLevel?: number | null;
  kpiWeight: number;
  direction: 'HIGHER' | 'LOWER';
  measurementType: 'COUNT' | 'MONETARY' | 'PERCENTAGE' | 'TIME' | 'RATING' | 'QUALITATIVE';
  overrideScore?: number | null;
}

const QUALITATIVE_MAP: Record<string, number> = { '1': 50, '2': 75, '3': 100, '4': 110, '5': 120 };

function calculate(input: CalcInput) {
  const { target: t, actual: a, direction, measurementType } = input;
  let ach = 0;
  let formula = '';

  if (measurementType === 'QUALITATIVE') {
    ach = QUALITATIVE_MAP[String(input.rubricLevel ?? 3)] ?? 100;
    formula = `rubric_map[Level ${input.rubricLevel ?? 3}] = ${ach}`;
  } else if (measurementType === 'RATING') {
    ach = ((a ?? 0) / (t || 1)) * 100;
    formula = `(actual ${a} / target ${t}) × 100`;
  } else if (direction === 'HIGHER') {
    ach = ((a ?? 0) / (t || 1)) * 100;
    formula = `(actual ${a} / target ${t}) × 100`;
  } else if ((t ?? 0) === 0) {
    ach = (a ?? 0) === 0 ? 100 : 0;
    formula = 'target 0 (zero tolerance)';
  } else {
    ach = (((2 * (t as number)) - (a ?? 0)) / (t as number)) * 100;
    formula = `((2 × target ${t} − actual ${a}) / target ${t}) × 100`;
  }

  ach = Math.max(round2(ach), 0);
  const cs = Math.min(ach, CAP);
  const fs = input.overrideScore !== null && input.overrideScore !== undefined ? Math.min(input.overrideScore, CAP) : cs;
  const ws = round2((fs * input.kpiWeight) / 100);
  return { achievement: ach, calculatedScore: round2(cs), finalScore: round2(fs), weightedScore: ws, formulaText: formula };
}

// ------------------------------------------------------------------ reference

const ROLES = [
  { code: 'SUPER_ADMIN', name: 'Super Admin (Upper Management)', description: 'Full group-wide control; approves Department Head KPIs and escalated adjustments.', sortOrder: 1 },
  { code: 'HR_ADMIN', name: 'HR Admin', description: 'Maintains users, organisation master data, the period calendar and KPI Library standards. No approvals.', sortOrder: 2 },
  { code: 'DEPT_HEAD', name: 'Department Head (Admin / Approver)', description: 'Reviews, adjusts, approves, returns and rejects the KPIs of their department.', sortOrder: 3 },
  { code: 'EMPLOYEE', name: 'Employee', description: 'Creates, evidences and submits their own variable KPIs.', sortOrder: 4 },
  { code: 'MGMT_VIEWER', name: 'Management Viewer', description: 'Read-only access to group dashboards and reports.', sortOrder: 5 },
  { code: 'SYS_ADMIN', name: 'System Administrator (IT)', description: 'Infrastructure, backups, e-mail settings and monitoring. No KPI content access.', sortOrder: 6 },
] as const;

const DESIGNATIONS = [
  'Deputy Managing Director', 'Head of HR', 'General Manager', 'Deputy General Manager',
  'Senior Manager', 'Manager', 'Assistant Manager', 'Senior Executive', 'Executive',
  'Junior Executive', 'Officer', 'Engineer', 'Senior Engineer', 'Team Lead',
  'Head of Department', 'Group IT Manager', 'Software Engineer', 'Analyst',
];

const CATEGORIES = [
  { code: 'FINANCIAL', name: 'Financial', sortOrder: 1 },
  { code: 'CUSTOMER', name: 'Customer', sortOrder: 2 },
  { code: 'INTERNAL_PROCESS', name: 'Internal Process', sortOrder: 3 },
  { code: 'PEOPLE_LEARNING', name: 'People & Learning', sortOrder: 4 },
] as const;

const TEMPLATES = [
  {
    code: 'TPL-MONTHLY-SALES',
    name: 'Monthly Sales Revenue',
    description: 'Incremental revenue from new and existing accounts for the month.',
    categoryCode: 'FINANCIAL',
    measurementType: 'MONETARY',
    unit: 'BDT',
    direction: 'HIGHER',
    suggestedWeight: 30,
  },
  {
    code: 'TPL-UPSELL-REVENUE',
    name: 'Upsell Revenue',
    description: 'Incremental revenue from existing accounts (upsell and cross-sell).',
    categoryCode: 'FINANCIAL',
    measurementType: 'MONETARY',
    unit: 'BDT',
    direction: 'HIGHER',
    suggestedWeight: 15,
  },
  {
    code: 'TPL-PROPOSAL-TURNAROUND',
    name: 'Proposal Turnaround',
    description: 'Average working days from client request to proposal submission.',
    categoryCode: 'INTERNAL_PROCESS',
    measurementType: 'TIME',
    unit: 'days',
    direction: 'LOWER',
    suggestedWeight: 10,
  },
  {
    code: 'TPL-NEW-CLIENTS',
    name: 'New Client Acquisitions',
    description: 'Number of new client accounts signed in the period.',
    categoryCode: 'CUSTOMER',
    measurementType: 'COUNT',
    unit: 'clients',
    direction: 'HIGHER',
    suggestedWeight: 25,
  },
  {
    code: 'TPL-CUSTOMER-RATING',
    name: 'Customer Satisfaction Rating',
    description: 'Average customer satisfaction rating on a 1–5 scale.',
    categoryCode: 'CUSTOMER',
    measurementType: 'RATING',
    unit: 'rating',
    direction: 'HIGHER',
    suggestedWeight: 20,
  },
  {
    code: 'TPL-COMPLAINT-RATE',
    name: 'Complaint Rate per 100 Deliveries',
    description: 'Customer complaints recorded per 100 deliveries. Lower is better.',
    categoryCode: 'CUSTOMER',
    measurementType: 'PERCENTAGE',
    unit: 'per 100',
    direction: 'LOWER',
    suggestedWeight: 15,
  },
  {
    code: 'TPL-ON-TIME-DELIVERY',
    name: 'On-time Delivery %',
    description: 'Share of orders delivered on or before the committed date.',
    categoryCode: 'INTERNAL_PROCESS',
    measurementType: 'PERCENTAGE',
    unit: '%',
    direction: 'HIGHER',
    suggestedWeight: 20,
  },
  {
    code: 'TPL-LOST-TIME-INCIDENTS',
    name: 'Lost-time Safety Incidents',
    description: 'Number of lost-time incidents in the period. Zero tolerance.',
    categoryCode: 'INTERNAL_PROCESS',
    measurementType: 'COUNT',
    unit: 'incidents',
    direction: 'LOWER',
    suggestedWeight: 10,
  },
  {
    code: 'TPL-TRAINING-HOURS',
    name: 'Team Learning Hours',
    description: 'Average learning and development hours per team member.',
    categoryCode: 'PEOPLE_LEARNING',
    measurementType: 'TIME',
    unit: 'hours',
    direction: 'HIGHER',
    suggestedWeight: 10,
  },
  {
    code: 'TPL-COLLABORATION',
    name: 'Collaboration & Values',
    description: 'Rubric assessment of collaboration and group values in the period.',
    categoryCode: 'PEOPLE_LEARNING',
    measurementType: 'QUALITATIVE',
    unit: 'level',
    direction: 'HIGHER',
    suggestedWeight: 10,
  },
] as const;

// ------------------------------------------------------------------- helpers

async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2);
}

async function main(): Promise<void> {
  const started = Date.now();
  console.log('▶ ANWAR KPIFlow seed starting…');

  // ---------------------------------------------------------------- 1. roles
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      create: { code: role.code, name: role.name, description: role.description, sortOrder: role.sortOrder },
      update: { name: role.name, description: role.description, sortOrder: role.sortOrder },
    });
  }
  const roleMap = new Map((await prisma.role.findMany()).map((r) => [r.code as string, r.id]));
  console.log(`  ✓ ${ROLES.length} roles`);

  // ------------------------------------------- 2. business units & departments
  let departmentCount = 0;
  const departmentIndex = new Map<string, { id: string; name: string; businessUnitId: string; businessUnitCode: string }>();

  for (const [index, bu] of BUSINESS_UNITS.entries()) {
    const businessUnit = await prisma.businessUnit.upsert({
      where: { code: bu.code },
      create: {
        code: bu.code,
        name: bu.name,
        shortName: bu.shortName,
        division: bu.division,
        sortOrder: index,
      },
      update: { name: bu.name, shortName: bu.shortName, division: bu.division, sortOrder: index, isActive: true },
    });

    for (const dept of bu.departments) {
      const department = await prisma.department.upsert({
        where: { businessUnitId_name: { businessUnitId: businessUnit.id, name: dept.name } },
        create: { businessUnitId: businessUnit.id, name: dept.name, code: dept.code },
        update: { code: dept.code, isActive: true },
      });
      departmentCount += 1;
      departmentIndex.set(`${bu.code}::${dept.name}`, {
        id: department.id,
        name: dept.name,
        businessUnitId: businessUnit.id,
        businessUnitCode: bu.code,
      });
    }
  }
  console.log(`  ✓ ${BUSINESS_UNITS.length} business units · ${departmentCount} departments (from the Excel list)`);

  // ----------------------------------------------------------- 3. designations
  for (const name of DESIGNATIONS) {
    await prisma.designation.upsert({ where: { name }, create: { name }, update: {} });
  }
  const designationMap = new Map((await prisma.designation.findMany()).map((d) => [d.name, d.id]));
  console.log(`  ✓ ${DESIGNATIONS.length} designations`);

  // --------------------------------------------------------- 4. KPI categories
  for (const category of CATEGORIES) {
    await prisma.kpiCategory.upsert({
      where: { code: category.code },
      create: { code: category.code, name: category.name, sortOrder: category.sortOrder },
      update: { name: category.name, sortOrder: category.sortOrder, isActive: true },
    });
  }
  const categoryMap = new Map((await prisma.kpiCategory.findMany()).map((c) => [c.code as string, c.id]));
  console.log(`  ✓ ${CATEGORIES.length} KPI categories`);

  // ------------------------------------------------------- 5. configuration v1
  const config = await prisma.configurationVersion.upsert({
    where: { version: 1 },
    create: {
      version: 1,
      effectiveFrom: utc(2026, 1, 1),
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
      qualitativeMap: QUALITATIVE_MAP,
      ragThresholds: { green: 95, amber: 75 },
      categories: ['FINANCIAL', 'CUSTOMER', 'INTERNAL_PROCESS', 'PEOPLE_LEARNING'],
      notes: 'Phase 01 defaults adopted from BRD v1.0 §4, §3.7 and §21.4 (D-01, D-07, D-08, D-09).',
      isActive: true,
    },
    update: { isActive: true },
  });
  console.log('  ✓ configuration version 1 (cap 120, band ±10, weights 5–50, max 10 KPIs)');

  // ---------------------------------------------------------------- 6. periods
  const YEARS = [2025, 2026, 2027];
  const now = new Date();
  const periodIndex = new Map<string, { id: string; label: string; frequency: Frequency; startDate: Date; endDate: Date; submissionDeadline: Date }>();

  for (const year of YEARS) {
    for (let month = 1; month <= 12; month += 1) {
      const start = utc(year, month, 1);
      const end = utc(year, month + 1, 0);
      const deadline = addDays(end, config.submissionGraceDays);
      const reviewDeadline = addDays(deadline, config.reviewWindowDays);
      const isPast = reviewDeadline < now;
      const status: PeriodStatus = isPast ? 'CLOSED' : 'OPEN';
      const code = `${year}-${String(month).padStart(2, '0')}`;
      const period = await prisma.kpiPeriod.upsert({
        where: { code },
        create: {
          frequency: 'MONTHLY',
          code,
          label: `${MONTHS[month - 1]} ${year}`,
          year,
          periodIndex: month,
          startDate: start,
          endDate: end,
          submissionDeadline: deadline,
          reviewDeadline,
          status,
          closedAt: isPast ? reviewDeadline : null,
        },
        update: { submissionDeadline: deadline, reviewDeadline },
      });
      periodIndex.set(code, { id: period.id, label: period.label, frequency: 'MONTHLY', startDate: start, endDate: end, submissionDeadline: deadline });
    }

    for (let q = 1; q <= 4; q += 1) {
      const startMonth = (q - 1) * 3 + 1;
      const start = utc(year, startMonth, 1);
      const end = utc(year, startMonth + 3, 0);
      const deadline = addDays(end, config.submissionGraceDays);
      const reviewDeadline = addDays(deadline, config.reviewWindowDays);
      const isPast = reviewDeadline < now;
      const code = `${year}-Q${q}`;
      const period = await prisma.kpiPeriod.upsert({
        where: { code },
        create: {
          frequency: 'QUARTERLY', code, label: `Q${q} ${year}`, year, periodIndex: q,
          startDate: start, endDate: end, submissionDeadline: deadline, reviewDeadline,
          status: isPast ? 'CLOSED' : 'OPEN',
          closedAt: isPast ? reviewDeadline : null,
        },
        update: { submissionDeadline: deadline, reviewDeadline },
      });
      periodIndex.set(code, { id: period.id, label: period.label, frequency: 'QUARTERLY', startDate: start, endDate: end, submissionDeadline: deadline });
    }

    const start = utc(year, 1, 1);
    const end = utc(year, 12, 31);
    const deadline = addDays(end, config.submissionGraceDays);
    const reviewDeadline = addDays(deadline, config.reviewWindowDays);
    const isPast = reviewDeadline < now;
    const code = `${year}`;
    const period = await prisma.kpiPeriod.upsert({
      where: { code },
      create: {
        frequency: 'YEARLY', code, label: `${year}`, year, periodIndex: 1,
        startDate: start, endDate: end, submissionDeadline: deadline, reviewDeadline,
        status: isPast ? 'CLOSED' : 'OPEN',
        closedAt: isPast ? reviewDeadline : null,
      },
      update: { submissionDeadline: deadline, reviewDeadline },
    });
    periodIndex.set(code, { id: period.id, label: period.label, frequency: 'YEARLY', startDate: start, endDate: end, submissionDeadline: deadline });
  }
  console.log(`  ✓ period calendar (${YEARS.join(', ')} · monthly + quarterly + yearly)`);

  // ------------------------------------------------------------------ 7. users
  const password = await hashPassword(DEFAULT_PASSWORD);
  const superPassword = await hashPassword(SUPER_ADMIN_PASSWORD);

  const pickDept = (buCode: string, name: string) => {
    const dept = departmentIndex.get(`${buCode}::${name}`);
    if (!dept) throw new Error(`Seed error: department "${name}" not found under ${buCode}`);
    return dept;
  };

  interface SeedUser {
    fullName: string;
    email: string;
    employeeCode: string;
    roleCode: string;
    businessUnitCode: string;
    departmentName: string;
    designation: string;
    phone?: string;
  }

  const ADMIN_USERS: SeedUser[] = [
    { fullName: 'Md. Anwar Hossain', email: process.env.SEED_SUPER_ADMIN_EMAIL ?? 'superadmin@anwargroup.net', employeeCode: 'E1001', roleCode: 'SUPER_ADMIN', businessUnitCode: 'BHB', departmentName: 'Property Management', designation: 'Deputy Managing Director', phone: '+8801711000001' },
    { fullName: 'Farhana Akter', email: 'hradmin@anwargroup.net', employeeCode: 'E1002', roleCode: 'HR_ADMIN', businessUnitCode: 'ACL', departmentName: 'Group HR', designation: 'Head of HR', phone: '+8801711000002' },
    { fullName: 'Group IT Administrator', email: 'sysadmin@anwargroup.net', employeeCode: 'E1003', roleCode: 'SYS_ADMIN', businessUnitCode: 'AESL', departmentName: 'Software Development', designation: 'Group IT Manager', phone: '+8801711000003' },
    { fullName: 'Shahriar Kabir', email: 'management.viewer@anwargroup.net', employeeCode: 'E1004', roleCode: 'MGMT_VIEWER', businessUnitCode: 'BHB', departmentName: 'Property Management', designation: 'General Manager', phone: '+8801711000004' },
  ];

  const DEMO_USERS: SeedUser[] = [
    // Sales & Marketing · ACL
    { fullName: 'Kamrul Hasan', email: 'kamrul.hasan@anwargroup.net', employeeCode: 'E2001', roleCode: 'DEPT_HEAD', businessUnitCode: 'ACL', departmentName: 'Sales & Marketing', designation: 'Head of Department', phone: '+8801712000001' },
    { fullName: 'Rafi Ahmed', email: 'rafi.ahmed@anwargroup.net', employeeCode: 'E2002', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Sales & Marketing', designation: 'Senior Executive', phone: '+8801712000002' },
    { fullName: 'Nusrat Jahan', email: 'nusrat.jahan@anwargroup.net', employeeCode: 'E2003', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Sales & Marketing', designation: 'Executive', phone: '+8801712000003' },
    { fullName: 'Tanvir Islam', email: 'tanvir.islam@anwargroup.net', employeeCode: 'E2004', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Sales & Marketing', designation: 'Senior Executive', phone: '+8801712000004' },
    { fullName: 'Sadia Rahman', email: 'sadia.rahman@anwargroup.net', employeeCode: 'E2005', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Sales & Marketing', designation: 'Assistant Manager', phone: '+8801712000005' },
    { fullName: 'Imran Chowdhury', email: 'imran.chowdhury@anwargroup.net', employeeCode: 'E2006', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Sales & Marketing', designation: 'Manager', phone: '+8801712000006' },
    { fullName: 'Ayesha Siddiqua', email: 'ayesha.siddiqua@anwargroup.net', employeeCode: 'E2007', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Sales & Marketing', designation: 'Executive', phone: '+8801712000007' },

    // Marketing & Communication · ACL
    { fullName: 'Rezaul Karim', email: 'rezaul.karim@anwargroup.net', employeeCode: 'E2101', roleCode: 'DEPT_HEAD', businessUnitCode: 'ACL', departmentName: 'Marketing & Communication', designation: 'Head of Department', phone: '+8801713000001' },
    { fullName: 'Farzana Yasmin', email: 'farzana.yasmin@anwargroup.net', employeeCode: 'E2102', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Marketing & Communication', designation: 'Senior Executive', phone: '+8801713000002' },
    { fullName: 'Mahmudul Hasan', email: 'mahmudul.hasan@anwargroup.net', employeeCode: 'E2103', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Marketing & Communication', designation: 'Executive', phone: '+8801713000003' },
    { fullName: 'Sabrina Haque', email: 'sabrina.haque@anwargroup.net', employeeCode: 'E2104', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Marketing & Communication', designation: 'Assistant Manager', phone: '+8801713000004' },

    // Accounts & Finance · ACL
    { fullName: 'Abdul Momin', email: 'abdul.momin@anwargroup.net', employeeCode: 'E2201', roleCode: 'DEPT_HEAD', businessUnitCode: 'ACL', departmentName: 'Accounts & Finance', designation: 'Head of Department', phone: '+8801714000001' },
    { fullName: 'Sharmin Sultana', email: 'sharmin.sultana@anwargroup.net', employeeCode: 'E2202', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Accounts & Finance', designation: 'Senior Executive', phone: '+8801714000002' },
    { fullName: 'Habibur Rahman', email: 'habibur.rahman@anwargroup.net', employeeCode: 'E2203', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Accounts & Finance', designation: 'Manager', phone: '+8801714000003' },

    // Operations · ACL
    { fullName: 'Jahangir Alam', email: 'jahangir.alam@anwargroup.net', employeeCode: 'E2301', roleCode: 'DEPT_HEAD', businessUnitCode: 'ACL', departmentName: 'Operations', designation: 'Head of Department', phone: '+8801715000001' },
    { fullName: 'Mizanur Rahman', email: 'mizanur.rahman@anwargroup.net', employeeCode: 'E2302', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Operations', designation: 'Executive', phone: '+8801715000002' },
    { fullName: 'Rubina Akter', email: 'rubina.akter@anwargroup.net', employeeCode: 'E2303', roleCode: 'EMPLOYEE', businessUnitCode: 'ACL', departmentName: 'Operations', designation: 'Senior Executive', phone: '+8801715000003' },

    // Group HR · ACL (second approver for HR — FR-ORG-02 "several per department")
    { fullName: 'Nazmul Huda', email: 'nazmul.huda@anwargroup.net', employeeCode: 'E2401', roleCode: 'DEPT_HEAD', businessUnitCode: 'ACL', departmentName: 'Group HR', designation: 'Deputy General Manager', phone: '+8801716000001' },

    // Sales & Marketing · ACSL (cross-BU approver demo)
    { fullName: 'Golam Mostafa', email: 'golam.mostafa@anwargroup.net', employeeCode: 'E3001', roleCode: 'DEPT_HEAD', businessUnitCode: 'ACSL', departmentName: 'Sales & Marketing', designation: 'Head of Department', phone: '+8801717000001' },
    { fullName: 'Rakibul Hasan', email: 'rakibul.hasan@anwargroup.net', employeeCode: 'E3002', roleCode: 'EMPLOYEE', businessUnitCode: 'ACSL', departmentName: 'Sales & Marketing', designation: 'Senior Executive', phone: '+8801717000002' },
    { fullName: 'Tahmina Begum', email: 'tahmina.begum@anwargroup.net', employeeCode: 'E3003', roleCode: 'EMPLOYEE', businessUnitCode: 'ACSL', departmentName: 'Sales & Marketing', designation: 'Executive', phone: '+8801717000003' },

    // Software Development · AESL
    { fullName: 'Asif Mahmud', email: 'asif.mahmud@anwargroup.net', employeeCode: 'E4001', roleCode: 'DEPT_HEAD', businessUnitCode: 'AESL', departmentName: 'Software Development', designation: 'Head of Department', phone: '+8801718000001' },
    { fullName: 'Sabbir Ahmed', email: 'sabbir.ahmed@anwargroup.net', employeeCode: 'E4002', roleCode: 'EMPLOYEE', businessUnitCode: 'AESL', departmentName: 'Software Development', designation: 'Software Engineer', phone: '+8801718000002' },
  ];

  const allSeedUsers = [...ADMIN_USERS, ...DEMO_USERS];
  const userIndex = new Map<string, { id: string; departmentId: string | null; businessUnitId: string | null; fullName: string; email: string }>();

  for (const u of allSeedUsers) {
    const dept = pickDept(u.businessUnitCode, u.departmentName);
    const isSuperAdmin = u.roleCode === 'SUPER_ADMIN';
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        employeeCode: u.employeeCode,
        fullName: u.fullName,
        passwordHash: isSuperAdmin ? superPassword : password,
        status: UserStatus.ACTIVE,
        corporatePhone: u.phone ?? null,
        designationId: designationMap.get(u.designation) ?? null,
        designationTitle: u.designation,
        businessUnitId: dept.businessUnitId,
        departmentId: dept.id,
        organisationConfirmed: true,
        passwordChangedAt: new Date(),
      },
      update: {
        fullName: u.fullName,
        status: UserStatus.ACTIVE,
        designationId: designationMap.get(u.designation) ?? null,
        designationTitle: u.designation,
        businessUnitId: dept.businessUnitId,
        departmentId: dept.id,
        organisationConfirmed: true,
      },
    });
    userIndex.set(u.email, { id: user.id, departmentId: user.departmentId, businessUnitId: user.businessUnitId, fullName: user.fullName, email: user.email });

    const roleId = roleMap.get(u.roleCode);
    if (roleId) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        create: { userId: user.id, roleId, grantedAt: new Date() },
        update: { revokedAt: null },
      });

      // Department Heads and Employees are also Employees (roles are additive, §5.1)
      if (u.roleCode !== 'EMPLOYEE' && u.roleCode !== 'SUPER_ADMIN' && u.roleCode !== 'SYS_ADMIN' && u.roleCode !== 'MGMT_VIEWER' && u.roleCode !== 'HR_ADMIN') {
        const employeeRoleId = roleMap.get('EMPLOYEE');
        if (employeeRoleId) {
          await prisma.userRole.upsert({
            where: { userId_roleId: { userId: user.id, roleId: employeeRoleId } },
            create: { userId: user.id, roleId: employeeRoleId },
            update: { revokedAt: null },
          });
        }
      }

      const groupScoped = ['SUPER_ADMIN', 'HR_ADMIN', 'MGMT_VIEWER', 'SYS_ADMIN'].includes(u.roleCode);
      const scopeDepartmentId = groupScoped ? null : dept.id;
      const existingScope = await prisma.userRoleScope.findFirst({
        where: { userId: user.id, roleId, departmentId: scopeDepartmentId },
      });
      if (!existingScope) {
        await prisma.userRoleScope.create({
          data: {
            userId: user.id,
            roleId,
            businessUnitId: groupScoped ? null : dept.businessUnitId,
            departmentId: scopeDepartmentId,
          },
        });
      }

      if (u.roleCode === 'DEPT_HEAD') {
        const employeeRoleId = roleMap.get('EMPLOYEE')!;
        const employeeScope = await prisma.userRoleScope.findFirst({
          where: { userId: user.id, roleId: employeeRoleId, departmentId: dept.id },
        });
        if (!employeeScope) {
          await prisma.userRoleScope.create({
            data: { userId: user.id, roleId: employeeRoleId, businessUnitId: dept.businessUnitId, departmentId: dept.id },
          });
        }
        await prisma.departmentHead.upsert({
          where: { departmentId_userId: { departmentId: dept.id, userId: user.id } },
          create: { departmentId: dept.id, userId: user.id, isPrimary: true, isActive: true },
          update: { isActive: true },
        });
      }
    }
  }
  console.log(`  ✓ ${allSeedUsers.length} users (1 Super Admin, 1 HR Admin, 1 Mgmt Viewer, 1 Sys Admin, ${DEMO_USERS.filter((d) => d.roleCode === 'DEPT_HEAD').length} Department Heads, ${DEMO_USERS.filter((d) => d.roleCode === 'EMPLOYEE').length} employees)`);

  // ----------------------------------------------------------- 8. KPI templates
  for (const t of TEMPLATES) {
    const categoryId = categoryMap.get(t.categoryCode);
    if (!categoryId) continue;
    const existing = await prisma.kpiTemplate.findFirst({ where: { code: t.code } });
    if (existing) {
      await prisma.kpiTemplate.update({
        where: { id: existing.id },
        data: { name: t.name, description: t.description, categoryId, measurementType: t.measurementType, unit: t.unit, direction: t.direction, suggestedWeight: t.suggestedWeight, isPublished: true },
      });
    } else {
      await prisma.kpiTemplate.create({
        data: {
          code: t.code,
          name: t.name,
          description: t.description,
          categoryId,
          measurementType: t.measurementType,
          unit: t.unit,
          direction: t.direction,
          suggestedWeight: t.suggestedWeight,
          scope: 'GROUP',
          version: 1,
          isPublished: true,
          rubricDescriptors:
            t.measurementType === 'QUALITATIVE'
              ? {
                  '1': 'Below expectations',
                  '2': 'Partially meets',
                  '3': 'Meets expectations',
                  '4': 'Exceeds expectations',
                  '5': 'Outstanding',
                }
              : undefined,
        },
      });
    }
  }
  const templateMap = new Map((await prisma.kpiTemplate.findMany()).map((t) => [t.code, t]));
  console.log(`  ✓ ${TEMPLATES.length} KPI Library templates`);

  // --------------------------------------------------------------- 9. demo KPIs
  interface KpiSpec {
    name: string;
    templateCode?: string;
    categoryCode: string;
    measurementType: 'COUNT' | 'MONETARY' | 'PERCENTAGE' | 'TIME' | 'RATING' | 'QUALITATIVE';
    unit: string;
    direction: 'HIGHER' | 'LOWER';
    target: number | null;
    actual: number | null;
    rubricLevel?: number;
    weight: number;
    remarks: string;
  }

  const buildPeriodKpis = (profile: 'strong' | 'solid' | 'steady' | 'improving'): KpiSpec[] => {
    const base: KpiSpec[] = [
      {
        name: 'Monthly Sales', templateCode: 'TPL-MONTHLY-SALES', categoryCode: 'FINANCIAL', measurementType: 'MONETARY', unit: 'BDT', direction: 'HIGHER',
        target: 10_000_000, actual: 9_833_486.62, weight: 30,
        remarks: 'Revenue booked through the corporate sales channel for the month, reconciled with the general ledger.',
      },
      {
        name: 'Upsell Revenue', templateCode: 'TPL-UPSELL-REVENUE', categoryCode: 'FINANCIAL', measurementType: 'MONETARY', unit: 'BDT', direction: 'HIGHER',
        target: 500_000, actual: 610_000, weight: 15,
        remarks: 'Incremental revenue from existing accounts, verified against the finance extract of invoiced orders.',
      },
      {
        name: 'Proposal Turnaround', templateCode: 'TPL-PROPOSAL-TURNAROUND', categoryCode: 'INTERNAL_PROCESS', measurementType: 'TIME', unit: 'days', direction: 'LOWER',
        target: 5, actual: 4, weight: 10,
        remarks: 'Average working days from client request to proposal submission across the month.',
      },
      {
        name: 'New Client Acquisitions', templateCode: 'TPL-NEW-CLIENTS', categoryCode: 'CUSTOMER', measurementType: 'COUNT', unit: 'clients', direction: 'HIGHER',
        target: 12, actual: 10, weight: 25,
        remarks: 'New client accounts signed and registered in the CRM during the month.',
      },
      {
        name: 'Customer Rating', templateCode: 'TPL-CUSTOMER-RATING', categoryCode: 'CUSTOMER', measurementType: 'RATING', unit: 'rating', direction: 'HIGHER',
        target: 4, actual: 3, weight: 20,
        remarks: 'Average customer satisfaction rating collected through the post-delivery survey.',
      },
    ];

    const scale = (factor: number, actualAdjust: (v: number | null) => number | null): KpiSpec[] =>
      base.map((k) => ({
        ...k,
        target: k.target !== null ? Math.round(k.target * factor * 100) / 100 : null,
        actual: k.actual !== null ? actualAdjust(k.actual) : null,
      }));

    switch (profile) {
      case 'strong':
        return [
          { ...base[0], actual: 10_624_000 },
          { ...base[1], actual: 640_000 },
          { ...base[2], actual: 3.5 },
          { ...base[3], actual: 14 },
          { ...base[4], actual: 4.5 },
        ];
      case 'solid':
        return base;
      case 'steady':
        return [
          { ...base[0], actual: 9_120_000 },
          { ...base[1], actual: 540_000 },
          { ...base[2], actual: 5.5 },
          { ...base[3], actual: 9 },
          { ...base[4], actual: 3.6 },
        ];
      case 'improving':
      default:
        return scale(0.85, (v) => (v as number) * 0.82);
    }
  };

  interface SeedKpiRow {
    id: string;
    employeeId: string;
    status: KpiStatus;
    achievement: number;
    weightedScore: number;
    kpiWeight: number;
    finalScore: number;
  }

  const CLOSED_MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08'];
  const OPEN_MONTH = '2026-09';

  const employeesForKpis = DEMO_USERS.filter((u) => u.roleCode === 'EMPLOYEE');
  const profiles: Array<'strong' | 'solid' | 'steady' | 'improving'> = ['strong', 'solid', 'steady', 'improving'];

  let kpiCount = 0;

  const createKpi = async (
    employeeEmail: string,
    periodCode: string,
    spec: KpiSpec,
    status: KpiStatus,
    approverEmail: string | null,
    opts: { decided?: boolean; submittedAt?: Date; adjusted?: boolean } = {},
  ) => {
    const employee = userIndex.get(employeeEmail);
    if (!employee) return null;
    const period = periodIndex.get(periodCode);
    if (!period) return null;

    const categoryId = categoryMap.get(spec.categoryCode);
    if (!categoryId) return null;

    const baseResult = calculate({
      target: spec.target,
      actual: spec.actual,
      rubricLevel: spec.rubricLevel ?? null,
      kpiWeight: spec.weight,
      direction: spec.direction,
      measurementType: spec.measurementType,
    });

    // An adjusted KPI carries an approved override of +5 points (ADJ-2: Δ ≤ 10 band)
    const overrideForAdjusted = opts.adjusted ? Math.min(baseResult.calculatedScore + 5, CAP) : null;

    const result = calculate({
      target: spec.target,
      actual: spec.actual,
      rubricLevel: spec.rubricLevel ?? null,
      kpiWeight: spec.weight,
      direction: spec.direction,
      measurementType: spec.measurementType,
      overrideScore: overrideForAdjusted,
    });

    const existing = await prisma.kpi.findFirst({
      where: { employeeId: employee.id, periodId: period.id, name: spec.name },
    });
    if (existing) return existing;

    const approverId = approverEmail ? userIndex.get(approverEmail)?.id ?? null : null;
    const templateId = spec.templateCode ? templateMap.get(spec.templateCode)?.id ?? null : null;
    const bu = await prisma.businessUnit.findFirst({ where: { id: employee.businessUnitId ?? undefined } });

    const seq = String((await prisma.kpi.count()) + 1).padStart(6, '0');
    const code = `KPI-${(bu?.code ?? 'GRP').toUpperCase()}-${periodCode.slice(0, 4)}-${seq}`;

    const submittedAt = opts.submittedAt ?? new Date(period.endDate.getTime() - 2 * 86_400_000);
    const decidedAt = opts.decided ? new Date(submittedAt.getTime() + 2 * 86_400_000) : null;

    const kpi = await prisma.kpi.create({
      data: {
        code,
        employeeId: employee.id,
        periodId: period.id,
        frequency: period.frequency,
        kpiType: 'VARIABLE',
        templateId,
        name: spec.name,
        description: spec.remarks.slice(0, 200),
        categoryId,
        measurementType: spec.measurementType,
        unit: spec.unit,
        direction: spec.direction,
        target: spec.target !== null ? String(spec.target) : null,
        actual: spec.actual !== null ? String(spec.actual) : null,
        rubricLevel: spec.rubricLevel ?? null,
        achievement: String(result.achievement),
        calculatedScore: String(result.calculatedScore),
        finalScore: String(result.finalScore),
        overrideScore: opts.adjusted ? String(result.finalScore) : null,
        kpiWeight: spec.weight,
        weightedScore: String(result.weightedScore),
        status,
        remarks: spec.remarks,
        businessUnitId: employee.businessUnitId,
        departmentId: employee.departmentId,
        approverId,
        evidenceCount: status === 'DRAFT' ? 0 : 1,
        currentVersionNo: status === 'DRAFT' ? 1 : 2,
        rowVersion: status === 'DRAFT' ? 1 : 3,
        submittedAt: status === 'DRAFT' ? null : submittedAt,
        reviewStartedAt: status === 'UNDER_REVIEW' || status === 'APPROVED' ? new Date(submittedAt.getTime() + 86_400_000) : null,
        decidedAt,
        decidedById: decidedAt ? approverId : null,
        configVersionId: config.id,
        lastCalculatedAt: new Date(),
      },
    });

    await prisma.kpiVersion.create({
      data: {
        kpiId: kpi.id,
        versionNo: 1,
        snapshot: {
          name: spec.name,
          target: spec.target,
          actual: spec.actual,
          kpiWeight: spec.weight,
          achievement: result.achievement,
          calculatedScore: result.calculatedScore,
          status: 'SUBMITTED',
        },
        trigger: 'SUBMIT',
        changeReason: 'Submitted by the owner',
        createdById: employee.id,
        calculation: { achievement: result.achievement, calculatedScore: result.calculatedScore, weightedScore: result.weightedScore },
      },
    });

    await prisma.calculationLog.create({
      data: {
        kpiId: kpi.id,
        inputs: { target: spec.target, actual: spec.actual, kpiWeight: spec.weight, direction: spec.direction, measurementType: spec.measurementType },
        outputs: { achievement: result.achievement, calculatedScore: result.calculatedScore, finalScore: result.finalScore, weightedScore: result.weightedScore },
        formulaText: result.formulaText,
        configVersionId: config.id,
        trigger: 'SUBMIT',
        actorId: employee.id,
      },
    });

    if (status === 'APPROVED') {
      await prisma.kpiDecision.create({
        data: {
          kpiId: kpi.id,
          action: opts.adjusted ? 'ADJUST' : 'APPROVE',
          actorId: approverId ?? userIndex.get(ADMIN_USERS[0].email)!.id,
          reason: opts.adjusted ? 'Adjusted after reviewing the supporting evidence.' : 'Approve calculated',
          scoreBefore: String(result.calculatedScore),
          scoreAfter: String(result.finalScore),
          statusBefore: 'UNDER_REVIEW',
          statusAfter: 'APPROVED',
        },
      });
      await prisma.kpiVersion.create({
        data: {
          kpiId: kpi.id,
          versionNo: 2,
          snapshot: { ...spec, status: 'APPROVED', finalScore: result.finalScore },
          trigger: 'APPROVE',
          changeReason: 'Approved calculated',
          createdById: approverId ?? userIndex.get(ADMIN_USERS[0].email)!.id,
        },
      });
      if (opts.adjusted) {
        await prisma.kpiAdjustment.create({
          data: {
            kpiId: kpi.id,
            field: 'finalScore',
            oldValue: String(result.calculatedScore),
            newValue: String(result.finalScore),
            reason: 'Adjusted after reviewing the supporting evidence.',
            actorId: approverId ?? userIndex.get(ADMIN_USERS[0].email)!.id,
          },
        });
      }
    }
    if (status === 'UNDER_REVIEW') {
      await prisma.kpiDecision.create({
        data: {
          kpiId: kpi.id,
          action: 'APPROVE',
          actorId: approverId ?? userIndex.get(ADMIN_USERS[0].email)!.id,
          reason: 'Review started',
          statusBefore: 'SUBMITTED',
          statusAfter: 'UNDER_REVIEW',
        },
      }).catch(() => undefined);
    }

    // Attach genuine evidence for every submitted KPI (Drafts stay empty)
    if (status !== 'DRAFT') {
      await attachEvidence(kpi.id, employee.id, spec, period.label ?? periodCode, employee.fullName);
      await prisma.kpi.update({ where: { id: kpi.id }, data: { evidenceCount: 1 } });
    }

    kpiCount += 1;
    return kpi;
  };

  /**
   * Writes a real evidence file to the storage directory and creates the
   * KpiEvidence row with its genuine SHA-256, so downloads, hashes and inline
   * previews behave exactly as they do for a real upload (FR-EVD-01/02/04).
   */
  const attachEvidence = async (
    kpiId: string,
    uploadedById: string,
    spec: KpiSpec,
    periodLabel: string,
    employeeName: string,
  ): Promise<void> => {
    const content = [
      'ANWAR KPIFlow — evidence extract',
      '=================================',
      `KPI                 : ${spec.name}`,
      `Reporting period    : ${periodLabel}`,
      `Prepared by         : ${employeeName}`,
      `Measurement type    : ${spec.measurementType} (${spec.unit})`,
      `Direction           : ${spec.direction === 'HIGHER' ? 'Higher is better' : 'Lower is better'}`,
      `Target              : ${spec.target ?? 'n/a'}`,
      `Actual              : ${spec.actual ?? 'n/a'}`,
      '',
      'Source              : general ledger / CRM / survey extract reconciled with the department records',
      `Generated           : ${new Date().toISOString()}`,
      '',
      'Note: this file is demonstration evidence generated by the seed script.',
    ].join('\r\n');

    const buffer = Buffer.from(content, 'utf8');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const objectKey = `${kpiId}/${randomUUID()}.csv`;
    const absolute = join(EVIDENCE_DIR, objectKey);

    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, buffer);

    await prisma.kpiEvidence.create({
      data: {
        kpiId,
        versionNo: 1,
        originalName: `${spec.name.replace(/[^A-Za-z0-9]+/g, '_')}_evidence.csv`,
        fileName: `${sha256.slice(0, 12)}.csv`,
        mimeType: 'text/csv',
        extension: 'csv',
        sizeBytes: buffer.length,
        sha256,
        storageKey: objectKey,
        scanStatus: 'CLEAN',
        scanDetail: 'seed-generated',
        isCurrent: true,
        uploadedById,
      },
    });
  };

  const approverFor = (departmentName: string, buCode = 'ACL'): string | null => {
    const head = DEMO_USERS.find((u) => u.roleCode === 'DEPT_HEAD' && u.departmentName === departmentName && u.businessUnitCode === buCode);
    return head?.email ?? null;
  };

  // Closed months → all Approved (history, leaderboard, trends)
  for (const monthCode of CLOSED_MONTHS) {
    for (const [index, employee] of employeesForKpis.entries()) {
      const profile = profiles[index % profiles.length];
      const specs = buildPeriodKpis(profile);
      const approverEmail = approverFor(employee.departmentName, employee.businessUnitCode);
      for (const spec of specs) {
        await createKpi(employee.email, monthCode, spec, 'APPROVED', approverEmail, {
          decided: true,
          adjusted: profile === 'improving' && spec.name === 'Customer Rating',
        });
      }
    }
  }

  // Open month (September 2026) → a realistic mix of Drafts, Submitted, Under Review and approved
  for (const [index, employee] of employeesForKpis.entries()) {
    // Ayesha keeps only an incomplete Draft so the "empty state", the
    // weight-allocated warning (W-3) and the BR-R04 self-approver guard can all
    // be demonstrated with spare weight capacity.
    if (employee.email === 'ayesha.siddiqua@anwargroup.net') continue;

    const profile = profiles[index % profiles.length];
    const specs = buildPeriodKpis(profile);
    const approverEmail = approverFor(employee.departmentName, employee.businessUnitCode);

    for (const [specIndex, spec] of specs.entries()) {
      const mod = (index + specIndex) % 5;
      const status: KpiStatus = mod === 0 ? 'DRAFT' : mod === 1 ? 'SUBMITTED' : mod === 2 ? 'UNDER_REVIEW' : 'APPROVED';
      await createKpi(employee.email, OPEN_MONTH, spec, status, approverEmail, {
        decided: status === 'APPROVED',
        submittedAt: new Date(Date.UTC(2026, 8, 20 + (index % 5))),
      });
    }
  }

  // A Draft with incomplete data so the "empty state" and validation paths are visible
  await createKpi(
    'ayesha.siddiqua@anwargroup.net',
    OPEN_MONTH,
    {
      name: 'Digital Campaign Reach',
      categoryCode: 'CUSTOMER',
      measurementType: 'COUNT',
      unit: 'impressions',
      direction: 'HIGHER',
      target: 250_000,
      actual: null,
      weight: 10,
      remarks: '',
    },
    'DRAFT',
    approverFor('Sales & Marketing'),
  );

  // A KPI belonging to a Department Head → routes to the Super Admin queue (FR-APR-08)
  const headKpiApprover = null;
  await createKpi(
    'kamrul.hasan@anwargroup.net',
    OPEN_MONTH,
    {
      name: 'Department Revenue Target',
      templateCode: 'TPL-MONTHLY-SALES',
      categoryCode: 'FINANCIAL',
      measurementType: 'MONETARY',
      unit: 'BDT',
      direction: 'HIGHER',
      target: 45_000_000,
      actual: 41_800_000,
      weight: 40,
      remarks: 'Department revenue for the month, reconciled with the finance close. Routed to the Super Admin queue.',
    },
    'SUBMITTED',
    headKpiApprover,
    { submittedAt: new Date(Date.UTC(2026, 8, 24)) },
  );
  await createKpi(
    'rezaul.karim@anwargroup.net',
    OPEN_MONTH,
    {
      name: 'Marketing Qualified Leads',
      categoryCode: 'CUSTOMER',
      measurementType: 'COUNT',
      unit: 'leads',
      direction: 'HIGHER',
      target: 800,
      actual: 742,
      weight: 35,
      remarks: 'Marketing qualified leads generated in the month. Routed to the Super Admin queue.',
    },
    'SUBMITTED',
    headKpiApprover,
    { submittedAt: new Date(Date.UTC(2026, 8, 23)) },
  );

  console.log(`  ✓ ${kpiCount} KPIs across ${CLOSED_MONTHS.length} closed months + ${OPEN_MONTH} open month`);

  // ------------------------------------------------------------- 10. snapshots
  const { generateSnapshots } = await import('./snapshot-helper');
  let snapshotTotal = 0;
  for (const monthCode of CLOSED_MONTHS) {
    const period = periodIndex.get(monthCode);
    if (!period) continue;
    snapshotTotal += await generateSnapshots(prisma, period.id);
  }
  console.log(`  ✓ ${snapshotTotal} performance snapshots for the closed periods`);

  // -------------------------------------------------------------- 11. invitations
  const hrDept = pickDept('ACL', 'Group HR');
  const existingInvitation = await prisma.invitation.findFirst({ where: { email: 'nazmul.huda@anwargroup.net' } });
  if (!existingInvitation) {
    await prisma.invitation.create({
      data: {
        email: 'nazmul.huda@anwargroup.net',
        employeeCode: 'E2401',
        fullName: 'Nazmul Huda',
        businessUnitId: hrDept.businessUnitId,
        departmentId: hrDept.id,
        roleId: roleMap.get('DEPT_HEAD')!,
        designation: 'Deputy General Manager',
        status: 'ACCEPTED',
        tokenHash: `seed-invitation-${Date.now()}`,
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        invitedById: userIndex.get(ADMIN_USERS[0].email)!.id,
        acceptedAt: new Date(),
      },
    });
  }

  // ------------------------------------------------------------------ summary
  const [userTotal, buTotal, deptTotal, kpiTotal, periodTotal] = await Promise.all([
    prisma.user.count(),
    prisma.businessUnit.count(),
    prisma.department.count(),
    prisma.kpi.count(),
    prisma.kpiPeriod.count(),
  ]);

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  ANWAR KPIFlow seed complete');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Business units ....... ${buTotal}`);
  console.log(`  Departments .......... ${deptTotal}`);
  console.log(`  Users ................ ${userTotal}`);
  console.log(`  Periods .............. ${periodTotal}`);
  console.log(`  KPIs ................. ${kpiTotal}`);
  console.log(`  Snapshots ............ ${snapshotTotal}`);
  console.log('──────────────────────────────────────────────────────────────────');
  console.log('  Sign-in accounts (development only)');
  console.log(`    Super Admin ......... ${ADMIN_USERS[0].email} / ${SUPER_ADMIN_PASSWORD}`);
  console.log(`    HR Admin ............ hradmin@anwargroup.net / ${DEFAULT_PASSWORD}`);
  console.log(`    Department Head ..... kamrul.hasan@anwargroup.net / ${DEFAULT_PASSWORD}`);
  console.log(`    Employee ............ rafi.ahmed@anwargroup.net / ${DEFAULT_PASSWORD}`);
  console.log(`    Management Viewer ... management.viewer@anwargroup.net / ${DEFAULT_PASSWORD}`);
  console.log(`    System Admin ........ sysadmin@anwargroup.net / ${DEFAULT_PASSWORD}`);
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Finished in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
