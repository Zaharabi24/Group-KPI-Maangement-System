import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useToast } from '@/context/ToastContext';
import { cn } from '@/components/ui';

/** Toast viewport — BRD §11.5 (success = toast for 4 s plus a visible state change). */
export const ToastViewport: React.FC = () => {
  const { toasts, dismiss } = useToast();

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-2 p-3 sm:inset-x-auto sm:right-4 sm:top-20 sm:items-end sm:bottom-auto"
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border bg-surface p-3 shadow-raised',
              toast.tone === 'success' && 'border-success/30',
              toast.tone === 'error' && 'border-danger/30',
              toast.tone === 'warning' && 'border-warning/30',
              toast.tone === 'info' && 'border-info/30',
            )}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <span
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white',
                toast.tone === 'success' && 'bg-success',
                toast.tone === 'error' && 'bg-danger',
                toast.tone === 'warning' && 'bg-warning',
                toast.tone === 'info' && 'bg-info',
              )}
              aria-hidden="true"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                {toast.tone === 'success' ? (
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                ) : toast.tone === 'error' ? (
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                ) : (
                  <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                )}
              </svg>
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-ink">{toast.title}</p>
              {toast.description ? <p className="mt-0.5 text-caption text-ink-secondary">{toast.description}</p> : null}
            </div>

            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="shrink-0 rounded p-1 text-ink-muted hover:bg-navy-50 hover:text-navy-900"
              aria-label="Dismiss notification"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
