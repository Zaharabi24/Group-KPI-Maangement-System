import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: 'success' | 'error' | 'warning' | 'info';
  duration: number;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/**
 * Toasts — BRD §11.5: success is a 4-second toast plus a visible state change.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<ToastContextValue['push']>(
    ({ tone, title, description, duration }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: Toast = { id, tone, title, description, duration: duration ?? (tone === 'error' ? 8000 : 4000) };
      setToasts((current) => [...current.slice(-4), toast]);
      return id;
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      push,
      dismiss,
      success: (title, description) => push({ tone: 'success', title, description }),
      error: (title, description) => push({ tone: 'error', title, description }),
      warning: (title, description) => push({ tone: 'warning', title, description }),
      info: (title, description) => push({ tone: 'info', title, description }),
    }),
    [toasts, push, dismiss],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
};

/** Tracks a simple boolean with an optional auto-reset (used by banners). */
export const useTransientFlag = (timeoutMs = 4000): [boolean, () => void] => {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    if (!flag) return undefined;
    const timer = window.setTimeout(() => setFlag(false), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [flag, timeoutMs]);
  return [flag, () => setFlag(true)];
};
