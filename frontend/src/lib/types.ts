/**
 * Shared frontend types mirrored from the API contract (§13.2).
 * Decimals are typed as `string` because the API serialises them as strings (§13.1).
 */

export type RoleCode = 'SUPER_ADMIN' | 'HR_ADMIN' | 'DEPT_HEAD' | 'EMPLOYEE' | 'MGMT_VIEWER' | 'SYS_ADMIN';

export type KpiStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'RETURNED'
  | 'ESCALATED'
  | 'APPROVED'
  | 'REJECTED'
  | 'NOT_SUBMITTED'
  | 'DELETED';

export type Frequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type MeasurementType = 'COUNT' | 'MONETARY' | 'PERCENTAGE' | 'TIME' | 'RATING' | 'QUALITATIVE';
export type Direction = 'HIGHER' | 'LOWER';
export type Rag = 'GREEN' | 'AMBER' | 'RED';
export type PeriodStatus = 'OPEN' | 'CLOSED' | 'REOPENED';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  employeeCode: string;
  roles: RoleCode[];
  permissions: string[];
  scope: {
    group: boolean;
    departmentIds: string[];
    businessUnitIds: string[];
    ownOnly: boolean;
  };
  businessUnitId: string | null;
  departmentId: string | null;
  sessionId: string;
  organisationConfirmed: boolean;
  breakGlassAccess: boolean;
}

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string;
  status: string;
  corporatePhone: string | null;
  designationTitle: string | null;
  organisationConfirmed: boolean;
  emailDigest: boolean;
  avatarUrl: string | null;
  businessUnit: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  roles: Array<{ code: RoleCode; name: string }>;
  approvers: Array<{ id: string; fullName: string; email: string; designationTitle?: string | null; isSuperAdmin?: boolean }>;
}

export interface AuthResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    employeeCode: string;
    status: string;
    corporatePhone: string | null;
    designationTitle: string | null;
    businessUnitId: string | null;
    departmentId: string | null;
    businessUnit: { id: string; name: string } | null;
    department: { id: string; name: string } | null;
    organisationConfirmed: boolean;
    avatarUrl: string | null;
    emailDigest: boolean;
    roles: RoleCode[];
  };
  home: string;
  permissions: string[];
  mustConfirmOrganisation?: boolean;
}

export interface KpiPeriodSummary {
  id: string;
  code: string;
  label: string;
  frequency: Frequency;
  status: PeriodStatus;
  year: number;
  periodIndex: number;
  startDate: string;
  endDate: string;
  submissionDeadline: string;
  reviewDeadline: string;
  closedAt?: string | null;
  kpiCount?: number;
  pendingCount?: number;
  approvedCount?: number;
  notSubmittedCount?: number;
  snapshotCount?: number;
  daysToDeadline?: number;
  deadlineState?: 'open' | 'due_today' | 'overdue' | 'closed';
}

export interface KpiCard {
  id: string;
  code: string;
  name: string;
  category: string;
  categoryCode: string;
  kpiWeight: number;
  status: KpiStatus;
  isLocked: boolean;
  isAssigned: boolean;
  measurementType: MeasurementType;
  unit: string;
  direction: Direction;
  rubricLevel: number | null;
  target: string | null;
  actual: string | null;
  achievement: string | null;
  calculatedScore: string | null;
  finalScore: string | null;
  weightedScore: string | null;
  scoreTag: 'calc.' | 'final' | null;
  adjusted: boolean;
  evidenceCount: number;
  approver: string;
  period: { id: string; code: string; label: string; frequency: Frequency; submissionDeadline: string; status: string } | null;
  daysRemaining: number | null;
  deadlineState: 'closed' | 'overdue' | 'due_today' | 'soon' | 'open' | null;
  stepper: { step: number; states: Array<'done' | 'current' | 'todo' | 'error'> };
  returnComment: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KpiEvidence {
  id: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: string;
  isCurrent: boolean;
  versionNo: number;
  createdAt: string;
  previewable: boolean;
}

export interface KpiAdjustmentEntry {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  actor: string;
  actorRoles: string[];
  at: string;
}

export interface KpiDecisionEntry {
  id: string;
  action: string;
  actor: string;
  reason: string | null;
  rejectCategory: string | null;
  scoreBefore: string | null;
  scoreAfter: string | null;
  statusBefore: KpiStatus | null;
  statusAfter: KpiStatus | null;
  at: string;
}

export interface CalculationPathRow {
  label: string;
  value: string | null;
  suffix?: string;
  mono?: boolean;
  pending?: boolean;
}

export interface KpiDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: KpiStatus;
  isLocked: boolean;
  isAssigned: boolean;
  targetLocked: boolean;
  weightLocked: boolean;
  kpiType: string;
  frequency: Frequency;
  period: { id: string; code: string; label: string; startDate: string; endDate: string; submissionDeadline: string; reviewDeadline: string; status: PeriodStatus; daysRemaining: number };
  category: { id: string; code: string; name: string };
  measurementType: MeasurementType;
  unit: string;
  direction: Direction;
  target: string | null;
  actual: string | null;
  rubricLevel: number | null;
  achievement: string | null;
  calculatedScore: string | null;
  finalScore: string | null;
  overrideScore: string | null;
  kpiWeight: number;
  weightedScore: string | null;
  remarks: string | null;
  evidenceCount: number;
  dataSource: string;
  employee: {
    id: string;
    fullName: string;
    employeeCode: string;
    email: string;
    designationTitle: string | null;
    businessUnit: { id: string; name: string; code: string } | null;
    department: { id: string; name: string } | null;
  };
  organisation: {
    businessUnit: { id: string; name: string; code?: string } | null;
    department: { id: string; name: string } | null;
  };
  approver: { id: string | null; fullName: string; email: string | null; isSuperAdmin: boolean };
  rowVersion: number;
  currentVersionNo: number;
  configVersion: number | null;
  submittedAt: string | null;
  reviewStartedAt: string | null;
  decidedAt: string | null;
  returnComment: string | null;
  rejectedReason: string | null;
  rejectCategory: string | null;
  calculationPath: CalculationPathRow[];
  stepper: { step: number; states: Array<'done' | 'current' | 'todo' | 'error'> };
  evidence: KpiEvidence[];
  adjustmentHistory: KpiAdjustmentEntry[];
  decisionHistory: KpiDecisionEntry[];
  escalations: Array<{ id: string; calculatedScore: string | null; proposedScore: string | null; delta: string | null; reason: string; status: string; createdAt: string }>;
  corrections: Array<{ id: string; reason: string; status: string; createdAt: string }>;
  canEdit: boolean;
  canWithdraw: boolean;
  canSubmit: boolean;
  canDecide: boolean;
  canRequestCorrection: boolean;
  canViewVersions: boolean;
  canRestore: boolean;
}

export interface WeightAvailability {
  allocated: number;
  available: number;
  complete: boolean;
  warning: string | null;
  minWeight: number;
  maxWeight: number;
  maxKpisPerPeriod: number;
  kpiCount: number;
  remainingKpis: number;
}

export interface ApproverOptions {
  mode: 'SUPER_ADMIN' | 'PRESELECTED' | 'SELECT';
  options: Array<{ id: string; fullName: string; employeeCode: string; designationTitle?: string | null; email?: string }>;
  message: string | null;
}

export interface ApprovalQueueItem {
  id: string;
  code: string;
  kpi: string;
  status: KpiStatus;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  employeeEmail: string;
  designation: string;
  department: string;
  departmentId: string | null;
  businessUnit: string;
  frequency: Frequency;
  period: string;
  periodId: string;
  category: string;
  categoryCode: string;
  submittedAt: string | null;
  ageDays: number;
  slaState: 'within' | 'at_risk' | 'breached';
  target: string | null;
  actual: string | null;
  achievement: string | null;
  calculatedScore: string | null;
  finalScore: string | null;
  kpiWeight: number;
  weightedScore: string | null;
  measurementType: MeasurementType;
  direction: Direction;
  unit: string;
  remarks: string | null;
  evidenceCount: number;
  approver: string;
  rowVersion: number;
  isAssigned: boolean;
  escalation: { id: string; delta: string; proposedScore: string; calculatedScore: string; reason: string } | null;
}

export interface EscalationItem {
  id: string;
  kpiId: string;
  kpiCode: string;
  kpi: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  period: string;
  category: string;
  target: string | null;
  actual: string | null;
  achievement: string | null;
  kpiWeight: number;
  evidenceCount: number;
  calculatedScore: string | null;
  proposedScore: string | null;
  delta: string | null;
  reason: string;
  requestedBy: string;
  createdAt: string;
  ageDays: number;
  status: string;
  pendingChanges: unknown;
}

export interface EmployeeMetrics {
  periodId: string;
  periodCode: string;
  periodLabel: string;
  frequency: Frequency;
  employeeId: string;
  totalKpiScore: string;
  averageAchievement: string;
  allocatedWeight: number;
  approvedCount: number;
  totalCount: number;
  belowTargetCount: number;
  rag: Rag;
  previousScore: string | null;
  difference: string | null;
  differenceLabel: string;
  rank: number | null;
}

export interface ChartPoint {
  label: string;
  periodId: string | null;
  value: number | null;
  hasData: boolean;
  target: number;
}

export interface EmployeeDashboard {
  metrics: EmployeeMetrics;
  records: Array<{
    id: string;
    code: string;
    kpi: string;
    category: string;
    target: string | null;
    actual: string | null;
    achievement: string | null;
    kpiWeight: number;
    score: string | null;
    displayScore: string | null;
    weightedScore: string | null;
    evidence: string[];
    evidenceCount: number;
    remarks: string;
    status: KpiStatus;
    approver: string;
    measurementType: MeasurementType;
    unit: string;
    direction: Direction;
  }>;
  charts: {
    monthly: ChartPoint[];
    quarterly: ChartPoint[];
    yearly: ChartPoint[];
    frequency: Frequency;
  };
  period: KpiPeriodSummary | null;
}

export interface LeaderboardEntry {
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
  rag: Rag;
  score: string | null;
  ragBarPercent: number;
}

export interface DepartmentDashboard {
  period: KpiPeriodSummary;
  frequency: Frequency;
  departments: Array<{ id: string; name: string; businessUnit: { id: string; name: string; code: string } }>;
  cards: {
    averageAchievement: string;
    averageAchievementValue: number;
    pendingEvaluations: number;
    totalApproved: number;
    rejected: number;
    belowTarget: number;
    weightIncomplete: number;
    notSubmitted: number;
    totalKpis: number;
    oldestPendingAgeDays: number;
    slaBreaches: number;
  };
  leaderboard: LeaderboardEntry[];
  thresholds: { green: number; amber: number };
  belowTargetList: Array<{ kpiId: string; employeeId: string; achievement: string | null }>;
  weightIncompleteList: Array<{ employeeId: string; employeeName: string; employeeCode: string; department: string; allocatedWeight: number }>;
}

export interface GroupDashboard {
  period: KpiPeriodSummary;
  headline: {
    groupAverageAchievement: string;
    groupAverageTotalScore: string;
    totalKpis: number;
    approved: number;
    pending: number;
    rejected: number;
    notSubmitted: number;
    slaCompliance: string;
    slaBreaches: number;
    participatingEmployees: number;
    openEscalations: number;
    weightIncomplete: number;
  };
  businessUnits: Array<{
    id: string;
    code: string;
    name: string;
    division: string | null;
    averageAchievement: string;
    averageTotalScore: string;
    approved: number;
    pending: number;
    rejected: number;
    belowTarget: number;
    weightIncomplete: number;
    headcount: number;
  }>;
  departments: Array<{
    departmentId: string;
    department: string;
    businessUnitId: string;
    averageAchievement: string;
    approved: number;
    pending: number;
    rejected: number;
    belowTarget: number;
    slaBreaches: number;
    weightIncomplete: number;
    participation: string;
  }>;
  escalations: Array<{
    id: string;
    kpiId: string;
    kpi: string;
    employee: string;
    department: string;
    calculatedScore: string | null;
    proposedScore: string | null;
    delta: string | null;
    requestedBy: string;
    ageDays: number;
  }>;
}

export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'decimal' | 'integer' | 'percent' | 'money' | 'date' | 'datetime' | 'badge';
  width?: number;
  align?: 'left' | 'center' | 'right';
}

export interface ReportResult {
  code: string;
  name: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  meta: {
    filters: Record<string, unknown>;
    generatedAt: string;
    generatedBy: { id: string; name: string; email: string };
    rowCount: number;
    page: number;
    size: number;
    totalPages: number;
  };
}

export interface NotificationItem {
  id: string;
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

export interface BusinessUnitItem {
  id: string;
  code: string;
  name: string;
  shortName?: string | null;
  division?: string | null;
  isActive: boolean;
  departmentCount?: number;
}

export interface DepartmentItem {
  id: string;
  name: string;
  code: string;
  businessUnitId: string;
  isActive: boolean;
  businessUnit?: { id: string; name: string; code: string };
  employeeCount?: number;
  heads?: Array<{ id: string; fullName: string; email: string; employeeCode: string }>;
}

export interface UserListItem {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string;
  status: string;
  corporatePhone: string | null;
  designationTitle: string | null;
  organisationConfirmed: boolean;
  businessUnit: { id: string; name: string; code?: string } | null;
  department: { id: string; name: string } | null;
  roles: Array<{ code: RoleCode; name: string }>;
  departmentHeadOf?: Array<{ id: string; name: string }>;
}

export interface TemplateItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kpiType: string;
  category: { id: string; code: string; name: string };
  measurementType: MeasurementType;
  unit: string;
  direction: Direction;
  suggestedWeight: number;
  rubricDescriptors: Record<string, string> | null;
  scope: 'GROUP' | 'DEPARTMENT';
  department: { id: string; name: string } | null;
  version: number;
  isPublished: boolean;
}

export interface ConfigurationVersionItem {
  id: string;
  version: number;
  effectiveFrom: string;
  scoreCap: string;
  scoreFloor: string;
  adjustmentBand: string;
  minWeight: number;
  maxWeight: number;
  maxKpisPerPeriod: number;
  submissionGraceDays: number;
  reviewWindowDays: number;
  reviewSlaDays: number;
  extensionMaxDays: number;
  minReasonLength: number;
  maxEvidenceFiles: number;
  maxEvidenceSizeMb: number;
  qualitativeMap: Record<string, number>;
  ragThresholds: { green: number; amber: number };
  categories: string[];
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

export interface AuditLogItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorRole: string | null;
  reason: string | null;
  ipAddress: string | null;
  correlationId: string | null;
  previousHash: string | null;
  recordHash: string;
  before: unknown;
  after: unknown;
  changedFields: unknown;
  createdAt: string;
  actor: { id: string; fullName: string; email: string; employeeCode: string } | null;
  department: { id: string; name: string } | null;
}

export interface KpiVersionItem {
  id: string;
  versionNo: number;
  trigger: string;
  changeReason: string | null;
  createdBy: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
  calculation: Record<string, unknown> | null;
}

export interface DelegationItem {
  id: string;
  fromUser: { id: string; fullName: string };
  toUser: { id: string; fullName: string };
  department: { id: string; name: string };
  startDate: string;
  endDate: string;
  reason: string | null;
  isActive: boolean;
}

export interface InvitationItem {
  id: string;
  email: string;
  fullName: string;
  employeeCode: string;
  designation: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  businessUnit: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  role: { id: string; code: RoleCode; name: string };
  resendCount: number;
  lastSentAt: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}
