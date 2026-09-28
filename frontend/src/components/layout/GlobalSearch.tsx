import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Input, cn } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { STATUS_LABELS } from '@/lib/format';

interface SearchResults {
  query: string;
  employees: Array<{
    id: string;
    fullName: string;
    employeeCode: string;
    email: string;
    designation: string;
    department: string;
    businessUnit: string;
    roles: string[];
    status: string;
  }>;
  kpis: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    employeeName: string;
    employeeCode: string;
    period: string;
  }>;
}

/**
 * Global search — FR-SRC-01. Department Head within scope, Super Admin across the
 * group. Searches employee name, Employee ID, KPI name and KPI code.
 */
export const GlobalSearch: React.FC<{ className?: string }> = ({ className }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [term, setTerm] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const debounced = useDebounced(term, 280);

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => api.get<SearchResults>('/search', { q: debounced, limit: 8 }),
    enabled: debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const isEmployeeOnly = user?.permissions.includes('kpi:view-others') === false && !user?.scope?.group;

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <div className="relative">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <Input
          type="search"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search employee, ID or KPI…"
          aria-label="Global search"
          className="h-9 w-[160px] pl-9 text-caption transition-all focus:w-[240px] sm:w-[200px] sm:focus:w-[300px]"
        />
        {isFetching ? (
          <span className="absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border-2 border-navy-200 border-t-navy-600" aria-hidden="true" />
        ) : null}
      </div>

      {open && debounced.trim().length >= 2 ? (
        <div className="absolute right-0 z-40 mt-1 w-[380px] max-w-[92vw] animate-slide-up overflow-hidden rounded-card border border-edge bg-surface shadow-raised">
          {!data || (data.employees.length === 0 && data.kpis.length === 0) ? (
            <p className="px-3 py-6 text-center text-caption text-ink-secondary">
              {isFetching ? 'Searching…' : `No results for “${debounced}”.`}
            </p>
          ) : (
            <div className="anwar-scroll max-h-[420px]">
              {data.employees.length ? (
                <section>
                  <p className="border-b border-edge bg-canvas px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
                    Employees
                  </p>
                  <ul>
                    {data.employees.map((employee) => (
                      <li key={employee.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            navigate(`/performance-summary?employeeId=${employee.id}`);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-navy-50"
                        >
                          <p className="truncate text-caption font-semibold text-ink">
                            {employee.fullName}
                            <span className="ml-2 font-normal text-ink-secondary">{employee.employeeCode}</span>
                          </p>
                          <p className="truncate text-[11px] text-ink-secondary">
                            {employee.designation} · {employee.department} · {employee.businessUnit}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {data.kpis.length ? (
                <section>
                  <p className="border-b border-edge bg-canvas px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
                    KPIs
                  </p>
                  <ul>
                    {data.kpis.map((kpi) => (
                      <li key={kpi.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            navigate(`/my-kpi/${kpi.id}`);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-navy-50"
                        >
                          <p className="truncate text-caption font-semibold text-ink">{kpi.name}</p>
                          <p className="flex items-center gap-2 truncate text-[11px] text-ink-secondary">
                            <span className="anwar-mono">{kpi.code}</span>
                            <Badge tone="neutral">{STATUS_LABELS[kpi.status as never] ?? kpi.status}</Badge>
                            {kpi.employeeName} · {kpi.period}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

/** Small debounce hook used by the search box and the filter inputs. */
export const useDebounced = <T,>(value: T, delayMs = 300): T => {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};
