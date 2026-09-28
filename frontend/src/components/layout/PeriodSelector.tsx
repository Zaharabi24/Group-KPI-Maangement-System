import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, toQuery } from '@/lib/api';
import type { KpiPeriodSummary } from '@/lib/types';
import { Select, cn } from '@/components/ui';

/**
 * Global period selection (BRD §11.3).
 *
 * The selection lives in ONE React context so the top-bar selector, the page
 * selector and every data hook always agree on the same frequency + period. It
 * is mirrored to localStorage so a reload keeps the user's working period.
 */
export interface PeriodSelection {
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  periodId: string;
  periodCode: string;
  label: string;
}

const STORAGE_KEY = 'anwar-kpi:period';

export const readPeriodSelection = (): PeriodSelection | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PeriodSelection) : null;
  } catch {
    return null;
  }
};

export const writePeriodSelection = (selection: PeriodSelection): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    /* storage unavailable — in-memory state still works */
  }
};

interface PeriodContextValue {
  selection: PeriodSelection | null;
  periods: KpiPeriodSummary[];
  loading: boolean;
  setPeriod: (periodId: string) => void;
  setFrequency: (frequency: PeriodSelection['frequency']) => void;
}

const PeriodContext = React.createContext<PeriodContextValue | undefined>(undefined);

/**
 * Picks the most useful default: the current month in Asia/Dhaka, otherwise the
 * newest open period, otherwise the newest period available.
 */
const pickDefault = (periods: KpiPeriodSummary[]): KpiPeriodSummary | undefined => {
  if (!periods.length) return undefined;

  const currentCode = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date()); // en-CA renders as YYYY-MM

  const exact = periods.find((p) => p.frequency === 'MONTHLY' && p.code === currentCode);
  if (exact) return exact;

  const open = periods.filter((p) => p.status !== 'CLOSED');
  if (open.length) return open[0];
  return periods[0];
};

export const PeriodProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selection, setSelection] = React.useState<PeriodSelection | null>(() => readPeriodSelection());

  const { data, isLoading } = useQuery({
    queryKey: ['periods', 'selectable'],
    queryFn: () => api.get<KpiPeriodSummary[]>('/periods/selectable'),
    staleTime: 5 * 60_000,
  });

  const periods = data ?? [];

  React.useEffect(() => {
    if (!periods.length) return;
    const match = selection ? periods.find((p) => p.id === selection.periodId) : undefined;
    if (match) return;
    const preferred = pickDefault(periods);
    if (!preferred) return;
    const next: PeriodSelection = {
      frequency: preferred.frequency,
      periodId: preferred.id,
      periodCode: preferred.code,
      label: preferred.label,
    };
    setSelection(next);
    writePeriodSelection(next);
  }, [periods, selection]);

  const setPeriod = React.useCallback(
    (periodId: string) => {
      const period = periods.find((p) => p.id === periodId);
      if (!period) return;
      const next: PeriodSelection = {
        frequency: period.frequency,
        periodId: period.id,
        periodCode: period.code,
        label: period.label,
      };
      setSelection(next);
      writePeriodSelection(next);
    },
    [periods],
  );

  const setFrequency = React.useCallback(
    (frequency: PeriodSelection['frequency']) => {
      const candidates = periods.filter((p) => p.frequency === frequency);
      if (!candidates.length) return;
      const next: PeriodSelection = {
        frequency,
        periodId: candidates[0].id,
        periodCode: candidates[0].code,
        label: candidates[0].label,
      };
      setSelection(next);
      writePeriodSelection(next);
    },
    [periods],
  );

  const value = React.useMemo<PeriodContextValue>(
    () => ({ selection, periods, loading: isLoading, setPeriod, setFrequency }),
    [selection, periods, isLoading, setPeriod, setFrequency],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
};

/** Fallback used when a component renders outside the provider (e.g. tests). */
const useStandalonePeriod = (): PeriodContextValue => {
  const [selection, setSelection] = React.useState<PeriodSelection | null>(() => readPeriodSelection());
  const { data, isLoading } = useQuery({
    queryKey: ['periods', 'selectable'],
    queryFn: () => api.get<KpiPeriodSummary[]>('/periods/selectable'),
    staleTime: 5 * 60_000,
  });
  const periods = data ?? [];
  return React.useMemo(
    () => ({
      selection,
      periods,
      loading: isLoading,
      setPeriod: (periodId: string) => {
        const period = periods.find((p) => p.id === periodId);
        if (!period) return;
        const next: PeriodSelection = { frequency: period.frequency, periodId, periodCode: period.code, label: period.label };
        setSelection(next);
        writePeriodSelection(next);
      },
      setFrequency: (frequency: PeriodSelection['frequency']) => {
        const first = periods.find((p) => p.frequency === frequency);
        if (!first) return;
        setSelection({ frequency, periodId: first.id, periodCode: first.code, label: first.label });
      },
    }),
    [selection, periods, isLoading],
  );
};

/** Shared period selection hook used by every page and the top bar. */
export const usePeriodSelection = (): PeriodContextValue => {
  const context = React.useContext(PeriodContext);
  const standalone = useStandalonePeriod();
  return context ?? standalone;
};

export const PeriodSelector: React.FC<{ className?: string; compact?: boolean; idPrefix?: string }> = ({
  className,
  compact,
  idPrefix = 'global',
}) => {
  const { selection, periods, setPeriod, setFrequency } = usePeriodSelection();

  const frequencyOptions = React.useMemo(() => Array.from(new Set(periods.map((p) => p.frequency))), [periods]);
  const visiblePeriods = React.useMemo(
    () => periods.filter((p) => (selection ? p.frequency === selection.frequency : true)),
    [periods, selection],
  );

  const frequencyId = `${idPrefix}-frequency`;
  const periodId = `${idPrefix}-period`;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label className="sr-only" htmlFor={frequencyId}>
        Period type
      </label>
      <Select
        id={frequencyId}
        className="h-9 w-[124px] text-caption"
        value={selection?.frequency ?? 'MONTHLY'}
        onChange={(event) => setFrequency(event.target.value as PeriodSelection['frequency'])}
      >
        {(frequencyOptions.length ? frequencyOptions : (['MONTHLY'] as const)).map((freq) => (
          <option key={freq} value={freq}>
            {freq === 'MONTHLY' ? 'Monthly' : freq === 'QUARTERLY' ? 'Quarterly' : 'Yearly'}
          </option>
        ))}
      </Select>

      <label className="sr-only" htmlFor={periodId}>
        Period
      </label>
      <Select
        id={periodId}
        className={cn('h-9 text-caption', compact ? 'w-[150px]' : 'w-[190px]')}
        value={selection?.periodId ?? ''}
        onChange={(event) => setPeriod(event.target.value)}
      >
        {visiblePeriods.length === 0 ? <option value="">No periods</option> : null}
        {visiblePeriods.map((period) => (
          <option key={period.id} value={period.id}>
            {period.label}
            {period.status === 'CLOSED' ? ' (closed)' : ''}
          </option>
        ))}
      </Select>
    </div>
  );
};

/** Query string helper for pages that fetch by the global selection. */
export const periodQuery = (selection: PeriodSelection | null): string =>
  selection ? toQuery({ frequency: selection.frequency, periodId: selection.periodId }) : '';
