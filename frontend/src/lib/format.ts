/**
 * Presentation helpers — labels, colours and formatting shared across screens.
 * BRD §11.2 (design tokens), §11.5 (state standards), §4.5 (RAG).
 */
import type { KpiStatus, Rag, RoleCode, MeasurementType } from './types';
import { formatBdt, formatBdtShort, formatMeasured, formatPercent, formatScore, ragFor } from './calculation';
import type { CalcMeasurementType } from './calculation';

// --------------------------------------------------------------------- status

export const STATUS_LABELS: Record<KpiStatus, string> = {
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

/**
 * Status badges — BRD §11.2:
 * Draft grey · Submitted amber outline · Under Review amber solid ·
 * Returned red outline · Escalated amber dashed · Approved green solid ·
 * Rejected red solid · Not Submitted grey outline.
 * §11.6: status is never conveyed by colour alone — every badge carries text.
 */
export const STATUS_STYLES: Record<KpiStatus, string> = {
  DRAFT: 'bg-neutral-tint text-neutral border border-transparent',
  SUBMITTED: 'bg-white text-warning border border-warning',
  UNDER_REVIEW: 'bg-warning text-white border border-warning',
  RETURNED: 'bg-white text-danger border border-danger',
  ESCALATED: 'bg-warning-tint text-warning border border-dashed border-warning',
  APPROVED: 'bg-success text-white border border-success',
  REJECTED: 'bg-danger text-white border border-danger',
  NOT_SUBMITTED: 'bg-white text-neutral border border-neutral',
  DELETED: 'bg-neutral-tint text-ink-muted border border-dashed border-neutral',
};

export const RAG_STYLES: Record<Rag, { bg: string; text: string; solid: string; label: string }> = {
  GREEN: { bg: 'bg-success-tint', text: 'text-success', solid: 'bg-success', label: 'Green' },
  AMBER: { bg: 'bg-warning-tint', text: 'text-warning', solid: 'bg-warning', label: 'Amber' },
  RED: { bg: 'bg-danger-tint', text: 'text-danger', solid: 'bg-danger', label: 'Red' },
};

export const ragStyle = (rag: Rag) => RAG_STYLES[rag] ?? RAG_STYLES.AMBER;

export const ragFromScore = (score: number | string | null | undefined, thresholds = { green: 95, amber: 75 }): Rag =>
  ragFor(Number(score ?? 0), thresholds);

// ---------------------------------------------------------------------- roles

export const ROLE_LABELS: Record<RoleCode, string> = {
  SUPER_ADMIN: 'Super Admin',
  HR_ADMIN: 'HR Admin',
  DEPT_HEAD: 'Department Head',
  EMPLOYEE: 'Employee',
  MGMT_VIEWER: 'Management Viewer',
  SYS_ADMIN: 'System Administrator',
};

export const ROLE_LONG_LABELS: Record<RoleCode, string> = {
  SUPER_ADMIN: 'Super Admin (Upper Management)',
  HR_ADMIN: 'HR Admin',
  DEPT_HEAD: 'Department Head (Admin / Approver)',
  EMPLOYEE: 'Employee',
  MGMT_VIEWER: 'Management Viewer',
  SYS_ADMIN: 'System Administrator (IT)',
};

export const primaryRole = (roles: RoleCode[] | undefined): RoleCode => {
  const priority: RoleCode[] = ['SUPER_ADMIN', 'HR_ADMIN', 'MGMT_VIEWER', 'SYS_ADMIN', 'DEPT_HEAD', 'EMPLOYEE'];
  for (const role of priority) {
    if (roles?.includes(role)) return role;
  }
  return 'EMPLOYEE';
};

export const ROLE_HOME: Record<RoleCode, string> = {
  SUPER_ADMIN: '/group-dashboard',
  HR_ADMIN: '/admin/users',
  DEPT_HEAD: '/dashboard',
  EMPLOYEE: '/my-kpi',
  MGMT_VIEWER: '/group-dashboard',
  SYS_ADMIN: '/admin/system-health',
};

// -------------------------------------------------------------- measurement

export const MEASUREMENT_TYPE_LABELS: Record<MeasurementType, string> = {
  COUNT: 'Count',
  MONETARY: 'Monetary (BDT)',
  PERCENTAGE: 'Percentage',
  TIME: 'Time',
  RATING: 'Rating',
  QUALITATIVE: 'Qualitative',
};

export const MEASUREMENT_TYPE_HELPERS: Record<MeasurementType, string> = {
  COUNT: 'Whole numbers such as clients, outlets or visits.',
  MONETARY: 'BDT amount with lakh/crore grouping.',
  PERCENTAGE: 'A ratio of percentages, not percentage points.',
  TIME: 'Minutes, hours or days.',
  RATING: 'A decimal rating on a defined scale (default 1–5).',
  QUALITATIVE: 'Rubric Level 1–5 with a written descriptor per level.',
};

export const DIRECTIONS: Array<{ code: 'HIGHER' | 'LOWER'; label: string; helper: string }> = [
  { code: 'HIGHER', label: 'Higher is better', helper: 'Achieving above target scores above 100%.' },
  { code: 'LOWER', label: 'Lower is better', helper: 'Lower actual than target scores above 100%.' },
];

export const MEASUREMENT_PRECISION: Record<MeasurementType, number> = {
  COUNT: 0,
  MONETARY: 2,
  PERCENTAGE: 2,
  TIME: 2,
  RATING: 1,
  QUALITATIVE: 0,
};

export const DEFAULT_UNITS: Record<MeasurementType, string> = {
  COUNT: 'units',
  MONETARY: 'BDT',
  PERCENTAGE: '%',
  TIME: 'days',
  RATING: 'rating',
  QUALITATIVE: 'level',
};

export const REJECT_CATEGORIES: Array<{ code: string; label: string }> = [
  { code: 'NOT_MEASURABLE', label: 'Not measurable' },
  { code: 'NOT_ALIGNED_TO_ROLE', label: 'Not aligned to role' },
  { code: 'DUPLICATE', label: 'Duplicate' },
  { code: 'INSUFFICIENT_EVIDENCE', label: 'Insufficient evidence' },
  { code: 'OTHER', label: 'Other' },
];

// ------------------------------------------------------------------ formatting

export { formatBdt, formatBdtShort, formatMeasured, formatPercent, formatScore };

export const bdt = (value: number | string | null | undefined, short = false): string =>
  short ? formatBdtShort(value, true) : formatBdt(value, true);

export const measured = (
  value: number | string | null | undefined,
  measurementType: MeasurementType | string | undefined,
  unit?: string | null,
  short = false,
): string => formatMeasured(value, measurementType as CalcMeasurementType, unit, { short });

// -------------------------------------------------------------------- dates

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** DD MMM YYYY in Asia/Dhaka (BRD §11.6 localisation). */
export const formatDate = (value: string | Date | null | undefined): string => {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
  return parts;
};

export const formatDateTime = (value: string | Date | null | undefined): string => {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(',', '');
};

export const formatRelative = (value: string | Date | null | undefined): string => {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diff = Date.now() - d.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(d);
};

/** "N days remaining", "Due today", "Overdue — locked" (§3.5). */
export const deadlineLabel = (days: number | null | undefined, state: string | null | undefined): string => {
  if (days === null || days === undefined) return '—';
  if (state === 'closed') return 'Period closed';
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  return `${days} day${days === 1 ? '' : 's'} remaining`;
};

export const deadlineTone = (state: string | null | undefined): string => {
  switch (state) {
    case 'overdue':
      return 'text-danger font-semibold';
    case 'due_today':
    case 'soon':
      return 'text-warning font-semibold';
    case 'closed':
      return 'text-ink-muted';
    default:
      return 'text-ink-secondary';
  }
};

// ------------------------------------------------------------------- files

export const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const shortHash = (hash: string | null | undefined, length = 12): string =>
  hash ? `${hash.slice(0, length)}…` : '—';

// ------------------------------------------------------------------- misc

export const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const initialsOf = (fullName: string): string =>
  fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

export const contractLabel = (value: string | null | undefined): string => {
  if (!value) return '—';
  return value
    .split('_')
    .map((word) => (MONTH_SHORT.includes(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(' ');
};

/** Month names for the period pickers. */
export const monthLabel = (index1: number, year: number): string =>
  `${MONTH_SHORT[index1 - 1] ?? ''} ${year}`;
