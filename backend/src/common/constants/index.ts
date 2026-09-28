/**
 * Cross-cutting domain constants — roles, notification codes, permission keys,
 * queue names, reject categories and the seed taxonomy of the ANWAR KPI platform.
 */

export const ROLE = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HR_ADMIN: 'HR_ADMIN',
  DEPT_HEAD: 'DEPT_HEAD',
  EMPLOYEE: 'EMPLOYEE',
  MGMT_VIEWER: 'MGMT_VIEWER',
  SYS_ADMIN: 'SYS_ADMIN',
} as const;

export type RoleKey = (typeof ROLE)[keyof typeof ROLE];

export const ROLE_LABELS: Record<RoleKey, string> = {
  SUPER_ADMIN: 'Super Admin (Upper Management)',
  HR_ADMIN: 'HR Admin',
  DEPT_HEAD: 'Department Head (Admin / Approver)',
  EMPLOYEE: 'Employee',
  MGMT_VIEWER: 'Management Viewer',
  SYS_ADMIN: 'System Administrator (IT)',
};

/** §11.3 — the role home screen after login/routing. */
export const ROLE_HOME: Record<RoleKey, string> = {
  SUPER_ADMIN: '/group-dashboard',
  HR_ADMIN: '/admin/users',
  DEPT_HEAD: '/dashboard',
  EMPLOYEE: '/my-kpi',
  MGMT_VIEWER: '/group-dashboard',
  SYS_ADMIN: '/admin/system-health',
};

/**
 * Permission keys used by the declarative RBAC guard (§5.2 role–permission matrix).
 * Scope codes: `:group`, `:dept`, `:own`, `:read`.
 */
export const PERM = {
  KPI_VIEW_OTHERS: 'kpi:view-others',
  KPI_REVIEW: 'kpi:review',
  KPI_EDIT_UNDER_REVIEW: 'kpi:edit-under-review',
  KPI_APPROVE_HEAD: 'kpi:approve-head',
  KPI_APPROVE_CORRECTION: 'kpi:approve-correction',
  PERIOD_CLOSE: 'period:close',
  USER_INVITE: 'user:invite',
  USER_MANAGE: 'user:manage',
  ORG_MANAGE: 'org:manage',
  TEMPLATE_MANAGE: 'template:manage',
  TEMPLATE_DEPT_MANAGE: 'template:dept-manage',
  KPI_ASSIGN: 'kpi:assign',
  CONFIG_MANAGE: 'config:manage',
  PERIOD_MANAGE: 'period:manage',
  EXTENSION_GRANT: 'period:extension-grant',
  DASHBOARD_GROUP: 'dashboard:group',
  DASHBOARD_DEPT: 'dashboard:dept',
  REPORT_VIEW: 'report:view',
  REPORT_VIEW_ALL: 'report:view-all',
  VERSION_HISTORY: 'version:history',
  VERSION_RESTORE: 'version:restore',
  AUDIT_VIEW: 'audit:view',
  AUDIT_VIEW_ALL: 'audit:view-all',
  AUDIT_TECHNICAL: 'audit:technical',
  SYSTEM_SETTINGS: 'system:settings',
  SEARCH_GLOBAL: 'search:global',
} as const;

export type PermissionKey = (typeof PERM)[keyof typeof PERM];

/** Role → permission grants. Data scope is resolved separately (§5.3). */
export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  SUPER_ADMIN: Object.values(PERM),
  HR_ADMIN: [
    PERM.KPI_VIEW_OTHERS,
    PERM.USER_INVITE,
    PERM.USER_MANAGE,
    PERM.ORG_MANAGE,
    PERM.TEMPLATE_MANAGE,
    PERM.PERIOD_MANAGE,
    PERM.DASHBOARD_GROUP,
    PERM.DASHBOARD_DEPT,
    PERM.REPORT_VIEW,
    PERM.REPORT_VIEW_ALL,
    PERM.VERSION_HISTORY,
    PERM.AUDIT_VIEW,
    PERM.AUDIT_VIEW_ALL,
    PERM.SEARCH_GLOBAL,
  ],
  DEPT_HEAD: [
    PERM.KPI_VIEW_OTHERS,
    PERM.KPI_REVIEW,
    PERM.KPI_EDIT_UNDER_REVIEW,
    PERM.TEMPLATE_DEPT_MANAGE,
    PERM.KPI_ASSIGN,
    PERM.EXTENSION_GRANT,
    PERM.DASHBOARD_DEPT,
    PERM.REPORT_VIEW,
    PERM.VERSION_HISTORY,
    PERM.AUDIT_VIEW,
    PERM.SEARCH_GLOBAL,
    PERM.KPI_APPROVE_CORRECTION,
  ],
  EMPLOYEE: [PERM.REPORT_VIEW],
  MGMT_VIEWER: [
    PERM.KPI_VIEW_OTHERS,
    PERM.DASHBOARD_GROUP,
    PERM.DASHBOARD_DEPT,
    PERM.REPORT_VIEW,
    PERM.REPORT_VIEW_ALL,
    PERM.SEARCH_GLOBAL,
  ],
  SYS_ADMIN: [PERM.SYSTEM_SETTINGS, PERM.AUDIT_TECHNICAL],
};

/** §15 — notification codes. */
export const NT = {
  REGISTRATION_SUBMITTED: 'NT-01',
  INVITATION_CREATED: 'NT-02',
  PASSWORD_RESET_OR_LOCKOUT: 'NT-03',
  KPI_ASSIGNED: 'NT-04',
  KPI_SUBMITTED: 'NT-05',
  REVIEW_STARTED: 'NT-06',
  KPI_APPROVED: 'NT-07',
  KPI_APPROVED_WITH_ADJUSTMENT: 'NT-08',
  KPI_RETURNED: 'NT-09',
  KPI_REJECTED: 'NT-10',
  ADJUSTMENT_ESCALATED: 'NT-11',
  ESCALATION_DECIDED: 'NT-12',
  DEADLINE_APPROACHING: 'NT-13',
  DEADLINE_MISSED: 'NT-14',
  REVIEW_SLA_BREACHED: 'NT-15',
  PERIOD_CLOSED: 'NT-16',
  KPI_DELETED: 'NT-17',
  CORRECTION_OR_REOPEN: 'NT-18',
  KPI_INPUTS_EDITED: 'NT-19',
} as const;

export type NotificationCode = (typeof NT)[keyof typeof NT];

/** Critical events that can never be switched off (FR-PRF-05). */
export const CRITICAL_NOTIFICATIONS: NotificationCode[] = [
  NT.PASSWORD_RESET_OR_LOCKOUT,
  NT.KPI_RETURNED,
  NT.KPI_REJECTED,
  NT.KPI_DELETED,
  NT.ADJUSTMENT_ESCALATED,
  NT.ESCALATION_DECIDED,
  NT.PERIOD_CLOSED,
];

/** BullMQ queue names. */
export const QUEUE = {
  EMAIL: 'email',
  EXPORT: 'export',
  SCHEDULED: 'scheduled',
  AUDIT: 'audit',
  NOTIFICATION: 'notification',
} as const;

/** Reject categories — FR-APR-06. */
export const REJECT_CATEGORIES = [
  { code: 'NOT_MEASURABLE', label: 'Not measurable' },
  { code: 'NOT_ALIGNED_TO_ROLE', label: 'Not aligned to role' },
  { code: 'DUPLICATE', label: 'Duplicate' },
  { code: 'INSUFFICIENT_EVIDENCE', label: 'Insufficient evidence' },
  { code: 'OTHER', label: 'Other' },
] as const;

/** §3.4 — measurement types with their precision and default direction. */
export const MEASUREMENT_TYPES = [
  {
    code: 'COUNT',
    label: 'Count',
    precision: 0,
    defaultDirection: 'HIGHER',
    defaultUnit: 'units',
    helper: 'Whole numbers such as clients, outlets or visits.',
    inputType: 'integer',
  },
  {
    code: 'MONETARY',
    label: 'Monetary',
    precision: 2,
    defaultDirection: 'HIGHER',
    defaultUnit: 'BDT',
    helper: 'BDT amount with lakh/crore grouping.',
    inputType: 'decimal',
  },
  {
    code: 'PERCENTAGE',
    label: 'Percentage',
    precision: 2,
    defaultDirection: 'HIGHER',
    defaultUnit: '%',
    helper: 'A ratio of percentages, not percentage points.',
    inputType: 'decimal',
  },
  {
    code: 'TIME',
    label: 'Time',
    precision: 2,
    defaultDirection: 'LOWER',
    defaultUnit: 'days',
    helper: 'Minutes, hours or days. Lower actual than target scores above 100%.',
    inputType: 'decimal',
  },
  {
    code: 'RATING',
    label: 'Rating',
    precision: 1,
    defaultDirection: 'HIGHER',
    defaultUnit: 'rating',
    helper: 'A decimal rating on a defined scale (default 1–5).',
    inputType: 'decimal',
  },
  {
    code: 'QUALITATIVE',
    label: 'Qualitative',
    precision: 0,
    defaultDirection: 'HIGHER',
    defaultUnit: 'level',
    helper: 'Rubric Level 1–5 with a written descriptor per level.',
    inputType: 'rubric',
  },
] as const;

export const KPI_CATEGORIES = [
  { code: 'FINANCIAL', name: 'Financial', colour: '#1F4E79' },
  { code: 'CUSTOMER', name: 'Customer', colour: '#1A7F86' },
  { code: 'INTERNAL_PROCESS', name: 'Internal Process', colour: '#C98A1B' },
  { code: 'PEOPLE_LEARNING', name: 'People & Learning', colour: '#7A5BA6' },
] as const;

export const KPI_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  RETURNED: 'Returned',
  ESCALATED: 'Escalated',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  NOT_SUBMITTED: 'Not Submitted',
  DELETED: 'Deleted',
};

/** Statuses that count as "pending evaluation" on the department dashboard. */
export const PENDING_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'] as const;

/** Statuses that block a period close (FR-CFG-03). */
export const CLOSE_BLOCKING_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'] as const;

/** Statuses in which the owner may still edit the KPI. */
export const OWNER_EDITABLE_STATUSES = ['DRAFT', 'RETURNED'] as const;

/** Statuses that release the allocated weight. */
export const WEIGHT_RELEASING_STATUSES = ['REJECTED', 'DELETED'] as const;

export const ALLOWED_EVIDENCE_EXTENSIONS = [
  'pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'xls', 'csv', 'docx',
] as const;

/** Macro-enabled Office files are always rejected (FR-EVD-02). */
export const BLOCKED_EVIDENCE_EXTENSIONS = ['docm', 'xlsm', 'pptm', 'exe', 'bat', 'cmd', 'sh', 'js', 'vbs', 'dll', 'msi', 'scr', 'com', 'ps1'] as const;

export const MAX_EXPORT_ROWS_SYNC = 10_000;
export const EXPORT_LINK_TTL_HOURS = 24;
export const EVIDENCE_SIGNED_URL_TTL_SECONDS = 300;

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [25, 50, 100];

export const AUDIT_ACTIONS = {
  REGISTER: 'auth.register',
  ACTIVATE: 'auth.activate',
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  LOCKOUT: 'auth.lockout',
  PASSWORD_RESET_REQUEST: 'auth.password.reset.request',
  PASSWORD_RESET: 'auth.password.reset',
  PASSWORD_CHANGE: 'auth.password.change',
  TOKEN_REFRESH_ANOMALY: 'auth.token.refresh.anomaly',
  INVITE_CREATE: 'user.invite.create',
  INVITE_RESEND: 'user.invite.resend',
  INVITE_REVOKE: 'user.invite.revoke',
  ROLE_GRANT: 'user.role.grant',
  ROLE_REVOKE: 'user.role.revoke',
  USER_TRANSFER: 'user.transfer',
  USER_DEACTIVATE: 'user.deactivate',
  USER_REACTIVATE: 'user.reactivate',
  USER_UPDATE: 'user.update',
  DELEGATION_CREATE: 'user.delegation.create',
  ORG_CREATE: 'org.create',
  ORG_UPDATE: 'org.update',
  ORG_DEACTIVATE: 'org.deactivate',
  KPI_CREATE: 'kpi.create',
  KPI_UPDATE: 'kpi.update',
  KPI_SUBMIT: 'kpi.submit',
  KPI_WITHDRAW: 'kpi.withdraw',
  KPI_DELETE: 'kpi.delete',
  KPI_RESTORE: 'kpi.restore',
  EVIDENCE_UPLOAD: 'evidence.upload',
  EVIDENCE_REPLACE: 'evidence.replace',
  EVIDENCE_DOWNLOAD: 'evidence.download',
  REVIEW_START: 'workflow.review.start',
  APPROVE: 'workflow.approve',
  ADJUST: 'workflow.adjust',
  RETURN: 'workflow.return',
  REJECT: 'workflow.reject',
  ESCALATE: 'workflow.escalate',
  ESCALATION_DECIDE: 'workflow.escalation.decide',
  CORRECTION_REQUEST: 'workflow.correction.request',
  CORRECTION_DECIDE: 'workflow.correction.decide',
  EXTENSION_GRANT: 'workflow.extension.grant',
  PERIOD_OPEN: 'period.open',
  PERIOD_CLOSE: 'period.close',
  PERIOD_REOPEN: 'period.reopen',
  SNAPSHOT_GENERATE: 'period.snapshot.generate',
  CONFIG_PUBLISH: 'configuration.publish',
  CONFIG_RECALCULATE: 'configuration.recalculate',
  TEMPLATE_CREATE: 'template.create',
  TEMPLATE_UPDATE: 'template.update',
  TEMPLATE_PUBLISH: 'template.publish',
  ASSIGNMENT_CREATE: 'template.assignment.create',
  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',
  ACCESS_DENIED: 'security.access.denied',
  AUDIT_VIEW: 'audit.view',
  BREAK_GLASS: 'security.break-glass',
  VERSION_RESTORE: 'kpi.version.restore',
} as const;

/** §5.2 — report access matrix (report code → permitted role codes). */
export const REPORT_ACCESS: Record<string, RoleKey[]> = {
  'RP-01': ['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD', 'EMPLOYEE', 'MGMT_VIEWER'],
  'RP-02': ['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD', 'MGMT_VIEWER'],
  'RP-03': ['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD', 'MGMT_VIEWER'],
  'RP-04': ['SUPER_ADMIN', 'HR_ADMIN'],
  'RP-05': ['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD', 'MGMT_VIEWER'],
  'RP-06': ['SUPER_ADMIN', 'HR_ADMIN'],
  'RP-07': ['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD', 'EMPLOYEE', 'MGMT_VIEWER'],
  'RP-08': ['SUPER_ADMIN', 'HR_ADMIN', 'MGMT_VIEWER'],
  'RP-09': ['SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD', 'MGMT_VIEWER'],
  'RP-10': ['SUPER_ADMIN'],
  'RP-11': ['SUPER_ADMIN', 'HR_ADMIN'],
  'RP-12': ['SUPER_ADMIN', 'HR_ADMIN', 'EMPLOYEE'],
  'RP-13': ['SUPER_ADMIN', 'MGMT_VIEWER'],
};
