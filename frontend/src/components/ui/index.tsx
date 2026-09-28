import React from 'react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...classes: Array<string | false | null | undefined>): string =>
  twMerge(clsx(classes));

// ------------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  block?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'anwar-btn-primary',
  secondary: 'anwar-btn-secondary',
  ghost: 'anwar-btn-ghost',
  danger: 'anwar-btn-danger',
  link: 'text-navy-600 hover:underline px-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, iconLeft, iconRight, block, className, children, disabled, type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'anwar-btn',
        VARIANT_CLASS[variant],
        size === 'sm' && 'anwar-btn-sm',
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  ),
);
Button.displayName = 'Button';

// ------------------------------------------------------------------- Spinner

export const Spinner: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg
    className={cn('animate-spin', className)}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

// ---------------------------------------------------------------- IconButton

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'default' | 'danger';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, tone = 'default', className, children, type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      className={cn(
        'anwar-btn anwar-btn-icon',
        tone === 'danger' && 'hover:bg-danger-tint hover:text-danger',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = 'IconButton';

// -------------------------------------------------------------------- Card

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }> = ({
  className,
  padded = true,
  children,
  ...rest
}) => (
  <div className={cn('anwar-card', padded && 'anwar-card-pad', className)} {...rest}>
    {children}
  </div>
);

export const CardHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, actions, className }) => (
  <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
    <div className="min-w-0">
      <h3 className="text-h3 text-navy-900">{title}</h3>
      {subtitle ? <p className="mt-0.5 text-caption text-ink-secondary">{subtitle}</p> : null}
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </div>
);

// ------------------------------------------------------------------ Badge

export interface BadgeProps {
  className?: string;
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  outline?: boolean;
  dashed?: boolean;
  icon?: React.ReactNode;
}

const BADGE_TONES: Record<string, string> = {
  neutral: 'bg-neutral-tint text-neutral',
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
  info: 'bg-info-tint text-info',
};

export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', outline, dashed, icon, className, children }) => (
  <span
    className={cn(
      'anwar-badge',
      outline ? 'border bg-white' : BADGE_TONES[tone],
      outline && tone === 'success' && 'border-success text-success',
      outline && tone === 'warning' && 'border-warning text-warning',
      outline && tone === 'danger' && 'border-danger text-danger',
      outline && tone === 'neutral' && 'border-neutral text-neutral',
      outline && tone === 'info' && 'border-info text-info',
      dashed && 'border-dashed',
      className,
    )}
  >
    {icon}
    {children}
  </span>
);

// ------------------------------------------------------------------- Inputs

export interface FieldProps {
  label?: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, required, hint, error, htmlFor, className, children }) => (
  <div className={cn('w-full', className)}>
    {label ? (
      <label htmlFor={htmlFor} className="anwar-label">
        {label}
        {required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
    ) : null}
    {children}
    {error ? (
      <p className="anwar-error" role="alert">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>{error}</span>
      </p>
    ) : hint ? (
      <p className="anwar-helper">{hint}</p>
    ) : null}
  </div>
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ className, invalid, ...rest }, ref) => (
  <input
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn('anwar-input', invalid && 'anwar-input-error', className)}
    {...rest}
  />
));
Input.displayName = 'Input';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(({ className, invalid, children, ...rest }, ref) => (
  <select
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn('anwar-input', invalid && 'anwar-input-error', className)}
    {...rest}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, rows = 3, ...rest }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    aria-invalid={invalid || undefined}
    className={cn('anwar-input h-auto py-2', invalid && 'anwar-input-error', className)}
    {...rest}
  />
));
Textarea.displayName = 'Textarea';

/** Password input with the FR-AUTH-05 eye toggle (aria-pressed always in sync). */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ className, invalid, ...rest }, ref) => {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? 'text' : 'password'}
        aria-invalid={invalid || undefined}
        className={cn('anwar-input pr-11', invalid && 'anwar-input-error', className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-control text-ink-secondary hover:bg-navy-50 hover:text-navy-900"
      >
        {visible ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M10.6 10.6a2 2 0 002.8 2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M6.7 6.9C4.6 8.2 3 10.2 2 12c1.7 3.2 5.4 6 10 6 1.7 0 3.3-.4 4.7-1.1M9.9 5.2A10 10 0 0112 5c4.6 0 8.3 2.8 10 7-.5 1-1.3 2-2.2 2.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M2 12c1.7-3.2 5.4-6 10-6s8.3 2.8 10 6c-1.7 3.2-5.4 6-10 6S3.7 15.2 2 12z" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        )}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';

/** Checkbox with an accessible label. */
export const Checkbox: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; hint?: React.ReactNode }
> = ({ label, hint, className, id, ...rest }) => {
  const inputId = id ?? `cb-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-edge text-navy-900 focus:ring-2 focus:ring-navy-600/30"
        {...rest}
      />
      <div className="min-w-0">
        <label htmlFor={inputId} className="cursor-pointer text-body text-ink">
          {label}
        </label>
        {hint ? <p className="anwar-helper">{hint}</p> : null}
      </div>
    </div>
  );
};

// -------------------------------------------------------------------- Modal

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  destructive?: boolean;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, description, children, footer, size = 'md' }) => {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-900/45 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className={cn(
          'relative z-10 max-h-[92vh] w-full animate-slide-up overflow-y-auto rounded-t-card bg-surface shadow-raised sm:rounded-card',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
        )}
      >
        <div className="border-b border-edge px-6 py-4">
          <h2 className="text-h2 text-navy-900">{title}</h2>
          {description ? <p className="mt-1 text-body text-ink-secondary">{description}</p> : null}
        </div>
        {children ? <div className="px-6 py-5">{children}</div> : null}
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-edge bg-canvas px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------- Drawer

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'md' | 'lg';
  /** Guards unsaved changes before the drawer closes (FR-KPI-04). */
  confirmBeforeClose?: boolean;
  confirmMessage?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'md',
  confirmBeforeClose,
  confirmMessage = 'You have unsaved changes. Close without saving?',
}) => {
  const attemptClose = React.useCallback(() => {
    if (confirmBeforeClose && !window.confirm(confirmMessage)) return;
    onClose();
  }, [confirmBeforeClose, confirmMessage, onClose]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') attemptClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, attemptClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-navy-900/40" onClick={attemptClose} aria-hidden="true" />
      <div
        className={cn(
          'relative ml-auto flex h-full w-full animate-slide-in-right flex-col bg-surface shadow-drawer',
          width === 'md' ? 'sm:max-w-[560px]' : 'sm:max-w-[860px]',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate text-h2 text-navy-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-caption text-ink-secondary">{subtitle}</p> : null}
          </div>
          <IconButton label="Close" onClick={attemptClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </IconButton>
        </header>
        <div className="anwar-scroll flex-1 px-5 py-5 sm:px-6">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-edge bg-canvas px-5 py-4 sm:px-6">{footer}</footer> : null}
      </div>
    </div>
  );
};

// -------------------------------------------------------------- Empty / Error

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}> = ({ icon, title, description, action, className }) => (
  <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-navy-600" aria-hidden="true">
      {icon ?? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 9h18M8 14h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
    </div>
    <p className="text-h3 text-navy-900">{title}</p>
    {description ? <p className="mt-1 max-w-md text-body text-ink-secondary">{description}</p> : null}
    {action ? <div className="mt-4">{action}</div> : null}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void; referenceId?: string | null }> = ({
  message,
  onRetry,
  referenceId,
}) => (
  <div className="anwar-card anwar-card-pad text-center">
    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-tint text-danger" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
    <p className="text-h3 text-navy-900">Something went wrong</p>
    <p className="mt-1 text-body text-ink-secondary">{message}</p>
    {referenceId ? <p className="mt-1 text-caption text-ink-muted">Reference: {referenceId}</p> : null}
    {onRetry ? (
      <div className="mt-4 flex justify-center">
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    ) : null}
  </div>
);

// ---------------------------------------------------------------- Skeletons

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('anwar-skeleton h-4 w-full', className)} aria-hidden="true" />
);

export const SkeletonCard: React.FC<{ lines?: number }> = ({ lines = 4 }) => (
  <div className="anwar-card anwar-card-pad space-y-3">
    <Skeleton className="h-5 w-1/3" />
    {Array.from({ length: lines }).map((_, index) => (
      <Skeleton key={index} className={index % 2 ? 'w-5/6' : 'w-full'} />
    ))}
  </div>
);

// --------------------------------------------------------------- Progress bar

export const ProgressBar: React.FC<{
  value: number;
  max?: number;
  tone?: 'navy' | 'success' | 'warning' | 'danger';
  showLabel?: boolean;
  label?: string;
  className?: string;
  height?: number;
}> = ({ value, max = 100, tone = 'navy', showLabel, label, className, height = 8 }) => {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  const toneClass =
    tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : tone === 'danger' ? 'bg-danger' : 'bg-navy-700';
  return (
    <div className={cn('w-full', className)}>
      {label || showLabel ? (
        <div className="mb-1 flex items-center justify-between text-caption text-ink-secondary">
          <span>{label}</span>
          {showLabel ? <span className="tnum font-semibold text-ink">{value.toFixed(2)}</span> : null}
        </div>
      ) : null}
      <div
        className="w-full overflow-hidden rounded-pill bg-neutral-tint"
        style={{ height }}
        role="progressbar"
        aria-valuenow={Number(value.toFixed(2))}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className={cn('h-full rounded-pill transition-all', toneClass)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

// -------------------------------------------------------------- Tabs / chips

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

export const SegmentedControl: React.FC<{
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}> = ({ items, value, onChange, size = 'md', className, ariaLabel }) => (
  <div
    role="tablist"
    aria-label={ariaLabel}
    className={cn('inline-flex rounded-control border border-edge bg-surface p-0.5', className)}
  >
    {items.map((item) => (
      <button
        key={item.key}
        role="tab"
        type="button"
        aria-selected={value === item.key}
        onClick={() => onChange(item.key)}
        className={cn(
          'rounded-[6px] font-medium transition-colors',
          size === 'sm' ? 'px-3 py-1 text-caption' : 'px-4 py-1.5 text-body',
          value === item.key ? 'bg-navy-900 text-white' : 'text-ink-secondary hover:bg-navy-50 hover:text-navy-900',
        )}
      >
        {item.label}
        {item.count !== undefined ? (
          <span className={cn('ml-1.5 tnum text-caption', value === item.key ? 'text-white/80' : 'text-ink-muted')}>
            {item.count}
          </span>
        ) : null}
      </button>
    ))}
  </div>
);

export const FilterChip: React.FC<{
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  count?: number;
}> = ({ active, onClick, children, count }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-caption font-medium transition-colors',
      active ? 'border-navy-900 bg-navy-900 text-white' : 'border-edge bg-surface text-ink-secondary hover:border-navy-300 hover:text-navy-900',
    )}
  >
    {children}
    {count !== undefined ? <span className={cn('tnum', active ? 'text-white/80' : 'text-ink-muted')}>{count}</span> : null}
  </button>
);

// -------------------------------------------------------------------- Stepper

const STEP_LABELS = ['Target', 'Actual', 'Evidence', 'Score', 'Review', 'Approval'] as const;

/**
 * The six-step KPI stepper — BRD §3.6 / §11.4.
 * done = navy check · current = amber number · returned/rejected = red.
 */
export const KpiStepper: React.FC<{
  states: Array<'done' | 'current' | 'todo' | 'error'>;
  compact?: boolean;
  className?: string;
}> = ({ states, compact, className }) => (
  <ol className={cn('flex items-center gap-1', className)} aria-label="KPI progress">
    {states.map((state, index) => (
      <li key={STEP_LABELS[index]} className="flex items-center gap-1">
        <div className="flex flex-col items-center">
          <span
            className={cn(
              'anwar-stepper-dot',
              state === 'done' && 'border-navy-900 bg-navy-900 text-white',
              state === 'current' && 'border-warning bg-warning-tint text-warning',
              state === 'todo' && 'border-edge bg-surface text-ink-muted',
              state === 'error' && 'border-danger bg-danger-tint text-danger',
            )}
            aria-hidden="true"
          >
            {state === 'done' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : state === 'error' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              index + 1
            )}
          </span>
          {!compact ? (
            <span
              className={cn(
                'mt-1 hidden text-[10px] font-medium uppercase tracking-wide sm:block',
                state === 'done' ? 'text-navy-900' : state === 'current' ? 'text-warning' : state === 'error' ? 'text-danger' : 'text-ink-muted',
              )}
            >
              {STEP_LABELS[index]}
            </span>
          ) : null}
        </div>
        {index < states.length - 1 ? (
          <span
            className={cn('h-0.5 w-3 sm:w-6', state === 'done' ? 'bg-navy-900' : 'bg-edge')}
            aria-hidden="true"
          />
        ) : null}
      </li>
    ))}
  </ol>
);

// ------------------------------------------------------------------ Tooltip

export const Tooltip: React.FC<{ content: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  content,
  children,
  className,
}) => (
  <span className={cn('group relative inline-flex', className)}>
    {children}
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-max max-w-xs -translate-x-1/2 rounded-control bg-navy-900 px-2.5 py-1.5 text-caption text-white shadow-raised group-hover:block group-focus-within:block"
    >
      {content}
    </span>
  </span>
);

// ------------------------------------------------------------------ Section

export const SectionTitle: React.FC<{ children: React.ReactNode; hint?: React.ReactNode; className?: string }> = ({
  children,
  hint,
  className,
}) => (
  <div className={cn('mb-3', className)}>
    <h3 className="anwar-section-title">{children}</h3>
    {hint ? <p className="mt-0.5 text-caption text-ink-secondary">{hint}</p> : null}
  </div>
);

/** Definition row used across the KPI detail and profile screens. */
export const DataRow: React.FC<{ label: React.ReactNode; children: React.ReactNode; mono?: boolean; className?: string }> = ({
  label,
  children,
  mono,
  className,
}) => (
  <div className={cn('flex flex-wrap items-baseline justify-between gap-2 border-b border-edge/70 py-2 last:border-0', className)}>
    <dt className="text-caption text-ink-secondary">{label}</dt>
    <dd className={cn('text-body font-semibold text-ink', mono && 'anwar-mono')}>{children}</dd>
  </div>
);

/** Pagination control used by every server-paged list (§11). */
export const Pagination: React.FC<{
  page: number;
  size: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
  onSize?: (size: number) => void;
  className?: string;
}> = ({ page, size, total, totalPages, onPage, onSize, className }) => (
  <div className={cn('flex flex-wrap items-center justify-between gap-3 pt-3', className)}>
    <p className="text-caption text-ink-secondary">
      {total === 0 ? 'No results' : `${(page - 1) * size + 1}–${Math.min(page * size, total)} of ${total.toLocaleString()}`}
    </p>
    <div className="flex items-center gap-2">
      {onSize ? (
        <select
          className="anwar-input h-8 w-auto py-0 text-caption"
          value={size}
          onChange={(event) => onSize(Number(event.target.value))}
          aria-label="Rows per page"
        >
          {[25, 50, 100].map((option) => (
            <option key={option} value={option}>
              {option} / page
            </option>
          ))}
        </select>
      ) : null}
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-caption text-ink-secondary">
        Page {page} of {totalPages}
      </span>
      <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  </div>
);
