import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from './index';
import type { KpiStatus, Rag } from '@/lib/types';

/**
 * Status badges — BRD §11.2. Colour is never the only signal: every badge
 * carries its label, and a padlock appears on locked rows (§11.6).
 */
const STATUS_CLASS: Record<KpiStatus, string> = {
  DRAFT: 'bg-neutral-tint text-neutral',
  SUBMITTED: 'border border-warning bg-white text-warning',
  UNDER_REVIEW: 'bg-warning text-white',
  RETURNED: 'border border-danger bg-white text-danger',
  ESCALATED: 'border border-dashed border-warning bg-warning-tint text-warning',
  APPROVED: 'bg-success text-white',
  REJECTED: 'bg-danger text-white',
  NOT_SUBMITTED: 'border border-neutral bg-white text-neutral',
  DELETED: 'border border-dashed border-neutral bg-neutral-tint text-ink-muted',
};

const STATUS_TEXT: Record<KpiStatus, string> = {
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

export const StatusBadge: React.FC<{ status: KpiStatus | string; locked?: boolean; className?: string }> = ({
  status,
  locked,
  className,
}) => {
  const key = (status as KpiStatus) in STATUS_CLASS ? (status as KpiStatus) : 'DRAFT';
  return (
    <span className={cn('anwar-badge', STATUS_CLASS[key], className)}>
      {locked ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
          <path d="M8 10V7a4 4 0 118 0v3" stroke="currentColor" strokeWidth="2.2" />
        </svg>
      ) : null}
      <span className="sr-only">Status:</span>
      {STATUS_TEXT[key]}
      {locked ? <span className="sr-only"> (period locked)</span> : null}
    </span>
  );
};

const RAG_CLASS: Record<Rag, string> = {
  GREEN: 'bg-success-tint text-success',
  AMBER: 'bg-warning-tint text-warning',
  RED: 'bg-danger-tint text-danger',
};

/** RAG pill with an arrow glyph as well as the colour (§4.5, §11.6). */
export const RagBadge: React.FC<{ rag: Rag; label?: string; className?: string }> = ({ rag, label, className }) => (
  <span className={cn('anwar-badge', RAG_CLASS[rag], className)}>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {rag === 'GREEN' ? (
        <path d="M12 5v14M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      ) : rag === 'AMBER' ? (
        <path d="M5 12h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      ) : (
        <path d="M12 19V5M12 19l-6-6M12 19l6-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      )}
    </svg>
    {label ?? (rag === 'GREEN' ? 'Green' : rag === 'AMBER' ? 'Amber' : 'Red')}
  </span>
);

/** Weight chip used on cards and tables (W-2 / W-3). */
export const WeightBadge: React.FC<{ weight: number; className?: string }> = ({ weight, className }) => (
  <span className={cn('anwar-badge bg-navy-50 text-navy-700', className)}>
    Weight {weight}%
  </span>
);

/** "Adjusted" tag shown after an approver change (FR-KPI-09). */
export const AdjustedTag: React.FC<{ className?: string }> = ({ className }) => (
  <span className={cn('anwar-badge bg-warning-tint text-warning', className)} title="An approver changed this value">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
    Adjusted
  </span>
);

export const AssignedTag: React.FC<{ className?: string }> = ({ className }) => (
  <span className={cn('anwar-badge bg-info-tint text-info', className)} title="Assigned by your Department Head">
    Assigned
  </span>
);

/** Days-remaining label with the correct tone (§3.5, §11.4). */
export const DeadlineLabel: React.FC<{
  days: number | null | undefined;
  state: 'closed' | 'overdue' | 'due_today' | 'soon' | 'open' | null | undefined;
  className?: string;
}> = ({ days, state, className }) => {
  if (days === null || days === undefined) return null;
  let text: string;
  if (state === 'closed') text = 'Period closed';
  else if (days < 0) text = `Overdue by ${Math.abs(days)} d`;
  else if (days === 0) text = 'Due today';
  else text = `${days} day${days === 1 ? '' : 's'} remaining`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-caption',
        state === 'overdue' ? 'font-semibold text-danger' : state === 'due_today' || state === 'soon' ? 'font-semibold text-warning' : 'text-ink-secondary',
        className,
      )}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {text}
    </span>
  );
};

/** SLA age tone for the approval queue (§11.4). */
export const SlaBadge: React.FC<{ days: number; state: 'within' | 'at_risk' | 'breached'; className?: string }> = ({
  days,
  state,
  className,
}) => (
  <span
    className={cn(
      'anwar-badge',
      state === 'within' && 'bg-neutral-tint text-neutral',
      state === 'at_risk' && 'bg-warning-tint text-warning',
      state === 'breached' && 'bg-danger-tint text-danger',
      className,
    )}
    title={state === 'breached' ? 'Review SLA breached (> 5 working days)' : state === 'at_risk' ? 'Approaching the SLA' : 'Within SLA'}
  >
    {days} d waiting
  </span>
);

/** Delta indicator with the text required by §11.5 (never an arrow alone). */
export const DifferenceIndicator: React.FC<{ difference: string | number | null; label?: string; className?: string }> = ({
  difference,
  label,
  className,
}) => {
  const value = difference === null || difference === undefined ? null : Number(difference);
  if (value === null || Number.isNaN(value)) {
    return <span className={cn('text-caption text-ink-muted', className)}>No previous period</span>;
  }
  const up = value > 0;
  const flat = value === 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-caption font-semibold',
        up ? 'text-success' : flat ? 'text-ink-secondary' : 'text-danger',
        className,
      )}
    >
      <span aria-hidden="true">{up ? '▲' : flat ? '=' : '▼'}</span>
      {label ?? `${Math.abs(value).toFixed(2)} ${up ? 'above' : flat ? 'no change' : 'below'} previous period`}
    </span>
  );
};

/** Small helper for dashboard metric cards. */
export const MetricCard: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  footer?: React.ReactNode;
}> = ({ label, value, hint, tone = 'default', icon, onClick, className, footer }) => {
  const toneRing =
    tone === 'success' ? 'before:bg-success' : tone === 'warning' ? 'before:bg-warning' : tone === 'danger' ? 'before:bg-danger' : tone === 'info' ? 'before:bg-info' : 'before:bg-navy-700';
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-caption font-medium uppercase tracking-wide text-ink-secondary">{label}</p>
        {icon ? <span className="text-navy-600">{icon}</span> : null}
      </div>
      <p className="mt-2 tnum text-[26px] font-semibold leading-8 text-navy-900">{value}</p>
      {hint ? <div className="mt-1 text-caption text-ink-secondary">{hint}</div> : null}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </>
  );

  const base = cn(
    'anwar-card anwar-card-pad relative overflow-hidden',
    'before:absolute before:left-0 before:top-0 before:h-full before:w-1',
    toneRing,
    onClick && 'cursor-pointer text-left transition-shadow hover:shadow-raised',
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={base}>
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
};

/** Consistent page heading. */
export const PageHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  breadcrumb?: Array<{ label: string; to?: string }>;
  actions?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, breadcrumb, actions, className }) => (
  <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', className)}>
    <div className="min-w-0">
      {breadcrumb?.length ? (
        <nav aria-label="Breadcrumb" className="mb-1">
          <ol className="flex flex-wrap items-center gap-1 text-caption text-ink-secondary">
            {breadcrumb.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {crumb.to ? (
                  <Link to={crumb.to} className="text-navy-600 hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
                {index < breadcrumb.length - 1 ? <span aria-hidden="true">/</span> : null}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1 className="text-h1 text-navy-900">{title}</h1>
      {subtitle ? <p className="mt-1 text-body text-ink-secondary">{subtitle}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

/** Inline alert used for warnings and escalations. */
export const Alert: React.FC<{
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}> = ({ tone = 'info', title, children, className, actions }) => {
  const toneClass =
    tone === 'success'
      ? 'border-success/30 bg-success-tint text-success'
      : tone === 'warning'
        ? 'border-warning/30 bg-warning-tint text-warning'
        : tone === 'danger'
          ? 'border-danger/30 bg-danger-tint text-danger'
          : 'border-info/30 bg-info-tint text-info';
  return (
    <div className={cn('flex flex-wrap items-start gap-3 rounded-control border px-3 py-2.5', toneClass, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="min-w-0 flex-1">
        {title ? <p className="text-body font-semibold">{title}</p> : null}
        {children ? <div className="text-caption text-ink-secondary">{children}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
};
