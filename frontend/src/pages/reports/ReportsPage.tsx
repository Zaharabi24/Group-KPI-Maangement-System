/**
 * ============================================================================
 *  M12 · Reports — FR-RPT-01 / FR-RPT-02, UC-10
 * ============================================================================
 *  · Catalogue         — the reports the caller's role may run (§5.2 / §14).
 *  · Workspace         — common + report-specific filters, a server-paged
 *                        preview with generic column rendering and totals, and
 *                        the AC-19 footer.
 *  · Export            — CSV / XLSX / PDF. Large results answer
 *                        `{ async: true, exportJobId, message }` and deliver a
 *                        notification link valid for 24 hours (FR-RPT-02).
 *  · My exports        — history with a download button per completed job.
 * ============================================================================
 */
import React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, saveBlob } from '@/lib/api';
import type { ReportColumn, ReportResult } from '@/lib/types';
import { STATUS_LABELS, formatBdt, formatDate, formatDateTime, formatPercent } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Pagination,
  Select,
  Skeleton,
} from '@/components/ui';
import { Alert, PageHeader, RagBadge, StatusBadge } from '@/components/ui/badges';
import { useToast } from '@/context/ToastContext';

// ------------------------------------------------------------------- types

interface ReportCatalogueItem {
  code: string;
  name: string;
  purpose: string;
  audience: string;
  extraFilters: string[];
  columnCount: number;
}

interface ReportMetaFilters {
  businessUnits: Array<{ id: string; code: string; name: string }>;
  departments: Array<{ id: string; name: string; businessUnitId: string }>;
  periods: Array<{ id: string; code: string; label: string; frequency: string; status: string }>;
  categories: Array<{ id: string; code: string; name: string }>;
  approvers: Array<{ id: string; fullName: string }>;
}

interface DirectoryEntry {
  id: string;
  fullName: string;
  employeeCode: string;
  department: { id: string; code: string; name: string } | null;
}

interface ExportSyncResult {
  async: false;
  code: string;
  format: string;
  rowCount: number;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  footer: string;
  meta: ReportResult['meta'];
}

interface ExportAsyncResult {
  async: true;
  exportJobId: string;
  message: string;
}

type ExportResult = ExportSyncResult | ExportAsyncResult;

interface MyExport {
  id: string;
  reportCode: string;
  format: string;
  status: string;
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  expiresAt: string | null;
  downloadUrl: string | null;
}

interface FilterState {
  businessUnitId: string;
  departmentId: string;
  frequency: string;
  periodId: string;
  employeeId: string;
  status: string;
  categoryId: string;
  measurementType: string;
  rag: string;
  approverId: string;
  exceptionType: string;
  type: string;
  entity: string;
  entityId: string;
  yearFrom: string;
  yearTo: string;
  age: string;
}

const EMPTY_FILTERS: FilterState = {
  businessUnitId: '',
  departmentId: '',
  frequency: '',
  periodId: '',
  employeeId: '',
  status: '',
  categoryId: '',
  measurementType: '',
  rag: '',
  approverId: '',
  exceptionType: '',
  type: '',
  entity: '',
  entityId: '',
  yearFrom: '',
  yearTo: '',
  age: '',
};

const STATUS_OPTIONS = Object.keys(STATUS_LABELS);
const EXCEPTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: 'All exceptions' },
  { value: 'NOT_SUBMITTED', label: 'Not submitted' },
  { value: 'OVERRIDE', label: 'Score override' },
  { value: 'ESCALATION', label: 'Escalation' },
  { value: 'RETURNED_TWICE', label: 'Returned more than twice' },
  { value: 'ACH_ABOVE_150', label: 'Achievement above 150%' },
  { value: 'TARGET_CHANGED', label: 'Target changed after submission' },
  { value: 'EXTENSION', label: 'Extension granted' },
];
const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ESCALATION', label: 'Escalation' },
  { value: 'CORRECTION', label: 'Correction request' },
  { value: 'DEPARTMENT_HEAD_KPI', label: 'Department Head KPI' },
];
const RAG_OPTIONS = ['GREEN', 'AMBER', 'RED'];
const FREQUENCY_OPTIONS = ['MONTHLY', 'QUARTERLY', 'YEARLY'];

const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'The request could not be completed.';

// -------------------------------------------------------------- formatting

const numericType = (type: ReportColumn['type']): boolean =>
  type === 'number' || type === 'decimal' || type === 'integer' || type === 'percent' || type === 'money';

const isRightAligned = (column: ReportColumn): boolean =>
  column.align === 'right' || (column.align === undefined && numericType(column.type));

const formatCellText = (column: ReportColumn, value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  switch (column.type) {
    case 'decimal':
      return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : String(value);
    case 'number':
      return Number.isFinite(Number(value)) ? String(Number(value)) : String(value);
    case 'integer':
      return Number.isFinite(Number(value)) ? String(Math.trunc(Number(value))) : String(value);
    case 'percent':
      return formatPercent(value as string | number);
    case 'money':
      return formatBdt(value as string | number, true);
    case 'date':
      return formatDate(String(value));
    case 'datetime':
      return formatDateTime(String(value));
    default:
      return String(value);
  }
};

const badgeTone = (text: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  const value = text.toLowerCase();
  if (value.includes('breach') || value.includes('reject') || value.includes('red')) return 'danger';
  if (value.includes('risk') || value.includes('pending') || value.includes('amber') || value.includes('escalat')) {
    return 'warning';
  }
  if (value.includes('approved') || value.includes('green') || value.includes('within')) return 'success';
  return 'neutral';
};

const ReportCell: React.FC<{ column: ReportColumn; value: unknown }> = ({ column, value }) => {
  if (column.type === 'badge') {
    if (value === null || value === undefined || value === '') return <span className="text-ink-muted">—</span>;
    const text = String(value);
    const upper = text.toUpperCase();
    if (upper === 'GREEN' || upper === 'AMBER' || upper === 'RED') {
      return <RagBadge rag={upper === 'GREEN' ? 'GREEN' : upper === 'AMBER' ? 'AMBER' : 'RED'} label={text} />;
    }
    if (upper in STATUS_LABELS) return <StatusBadge status={upper} />;
    return <Badge tone={badgeTone(text)}>{text}</Badge>;
  }
  const text = formatCellText(column, value);
  return <span className={numericType(column.type) ? 'tnum' : undefined}>{text}</span>;
};

// ------------------------------------------------------------------ exports

const csvEscape = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const buildCsv = (
  columns: ReportColumn[],
  rows: Array<Record<string, unknown>>,
  totals: Record<string, unknown> | undefined,
  footer: string,
): string => {
  const lines: string[] = [];
  lines.push(columns.map((column) => csvEscape(column.label)).join(','));
  rows.forEach((row) => {
    lines.push(columns.map((column) => csvEscape(formatCellText(column, row[column.key]))).join(','));
  });
  if (totals) {
    lines.push(columns.map((column) => csvEscape(formatCellText(column, totals[column.key]))).join(','));
  }
  lines.push('');
  lines.push(csvEscape(footer));
  return lines.join('\n');
};

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Minimal, correct SpreadsheetML 2003 workbook (opens in Excel/LibreOffice). */
const buildWorkbookXml = (
  title: string,
  columns: ReportColumn[],
  rows: Array<Record<string, unknown>>,
  totals: Record<string, unknown> | undefined,
  footer: string,
): string => {
  const cell = (column: ReportColumn, value: unknown, style?: string): string => {
    const text = formatCellText(column, value);
    const numeric = numericType(column.type) && text !== '—' && Number.isFinite(Number(value));
    const styleAttr = style ? ` ss:StyleID="${style}"` : '';
    return `<Cell${styleAttr}><Data ss:Type="${numeric ? 'Number' : 'String'}">${xmlEscape(text)}</Data></Cell>`;
  };
  const header = columns.map((column) => cell({ ...column, type: 'text' }, column.label, 'Header')).join('');
  const body = rows.map((row) => `<Row>${columns.map((column) => cell(column, row[column.key])).join('')}</Row>`).join('');
  const totalsRow = totals
    ? `<Row>${columns
        .map((column, index) => (index === 0 ? cell({ ...column, type: 'text' }, 'Totals', 'Header') : cell(column, totals[column.key])))
        .join('')}</Row>`
    : '';
  return [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    '<Styles>',
    '<Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#DDEBF7" ss:Pattern="Solid"/></Style>',
    '</Styles>',
    `<Worksheet ss:Name="${xmlEscape(title.slice(0, 31))}">`,
    '<Table>',
    `<Row>${header}</Row>`,
    body,
    totalsRow,
    `<Row><Cell><Data ss:Type="String">${xmlEscape(footer)}</Data></Cell></Row>`,
    '</Table>',
    '</Worksheet>',
    '</Workbook>',
  ].join('\n');
};

const htmlEscape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const openPrintWindow = (
  result: ExportSyncResult,
  footer: string,
): boolean => {
  const win = window.open('', '_blank', 'width=1080,height=800');
  if (!win) return false;

  const headCells = result.columns
    .map((column) => `<th style="text-align:${isRightAligned(column) ? 'right' : 'left'}">${htmlEscape(column.label)}</th>`)
    .join('');
  const bodyRows = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map(
            (column) =>
              `<td style="text-align:${isRightAligned(column) ? 'right' : 'left'}">${htmlEscape(
                formatCellText(column, row[column.key]),
              )}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  const totalsRow = result.totals
    ? `<tfoot><tr>${result.columns
        .map((column, index) =>
          index === 0
            ? '<td><strong>Totals</strong></td>'
            : `<td style="text-align:${isRightAligned(column) ? 'right' : 'left'}"><strong>${htmlEscape(
                formatCellText(column, result.totals?.[column.key]),
              )}</strong></td>`,
        )
        .join('')}</tr></tfoot>`
    : '';

  win.document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(result.code)} · ${htmlEscape(result.code)} report</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 24px; color: #12263F; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { font-size: 12px; color: #52627A; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #C9D3E0; padding: 4px 6px; }
    th { background: #F5F7FA; text-transform: uppercase; font-size: 11px; letter-spacing: 0.02em; }
    tfoot td { background: #F5F7FA; }
    .footer { margin-top: 16px; font-size: 11px; color: #52627A; }
    .toolbar { margin-bottom: 16px; }
    button { padding: 8px 16px; font-size: 13px; cursor: pointer; }
    @media print { .toolbar { display: none; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">Print</button>
    <span class="meta" style="margin-left:8px">Print-to-PDF view — choose “Save as PDF” in the print dialog.</span>
  </div>
  <h1>${htmlEscape(result.code)} · ${htmlEscape(result.code)} — ${htmlEscape(result.rowCount.toLocaleString())} row(s)</h1>
  <p class="meta">Filters: ${htmlEscape(
    Object.entries(result.meta?.filters ?? {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ') || 'none',
  )} · Generated ${htmlEscape(formatDateTime(result.meta?.generatedAt))} by ${htmlEscape(
    result.meta?.generatedBy?.name ?? '',
  )}</p>
  <table>
    <thead><tr>${headCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
    ${totalsRow}
  </table>
  <p class="footer">${htmlEscape(footer)}</p>
</body>
</html>`);
  win.document.close();
  win.focus();
  return true;
};

// ------------------------------------------------------------ employee picker

const EmployeePicker: React.FC<{
  value: string;
  onChange: (employee: { id: string; fullName: string } | null) => void;
  selected: { id: string; fullName: string } | null;
}> = ({ value, onChange, selected }) => {
  const [term, setTerm] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const debounced = React.useDeferredValue(term);

  const query = useQuery({
    queryKey: ['users', 'directory', 'report-picker', debounced],
    queryFn: () => api.get<DirectoryEntry[]>('/users/directory', { search: debounced.trim(), limit: 10 }),
    enabled: open && debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-control border border-edge bg-surface px-3 py-2">
        <span className="min-w-0 truncate text-body">{selected.fullName}</span>
        <IconButton label="Clear employee filter" onClick={() => onChange(null)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </IconButton>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        type="search"
        value={term}
        placeholder="Search name or Employee ID…"
        aria-label="Search employee"
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && debounced.trim().length >= 2 ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-control border border-edge bg-surface shadow-raised">
          {query.isPending ? (
            <p className="px-3 py-3 text-caption text-ink-secondary">Searching…</p>
          ) : !query.data?.length ? (
            <p className="px-3 py-3 text-caption text-ink-secondary">No match.</p>
          ) : (
            <ul className="anwar-scroll max-h-56 divide-y divide-edge/70">
              {query.data.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-navy-50"
                    onClick={() => {
                      onChange({ id: entry.id, fullName: entry.fullName });
                      setOpen(false);
                    }}
                  >
                    <p className="text-caption font-semibold text-ink">{entry.fullName}</p>
                    <p className="text-[11px] text-ink-secondary">
                      <span className="anwar-mono">{entry.employeeCode}</span>
                      {entry.department ? ` · ${entry.department.name}` : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <input type="hidden" value={value} readOnly />
    </div>
  );
};

// ------------------------------------------------------------------- page

const ReportsPage: React.FC = () => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [selectedCode, setSelectedCode] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS);
  const [selectedEmployee, setSelectedEmployee] = React.useState<{ id: string; fullName: string } | null>(null);
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(25);
  const [asyncMessage, setAsyncMessage] = React.useState<string | null>(null);

  const catalogueQuery = useQuery({
    queryKey: ['reports', 'catalogue'],
    queryFn: () => api.get<ReportCatalogueItem[]>('/reports'),
  });

  const metaQuery = useQuery({
    queryKey: ['reports', 'meta', 'filters'],
    queryFn: () => api.get<ReportMetaFilters>('/reports/meta/filters'),
    enabled: Boolean(selectedCode),
    staleTime: 5 * 60_000,
  });

  const report = catalogueQuery.data?.find((entry) => entry.code === selectedCode) ?? null;

  // Reset filters whenever the workspace switches reports.
  React.useEffect(() => {
    setFilters(EMPTY_FILTERS);
    setSelectedEmployee(null);
    setPage(1);
    setAsyncMessage(null);
  }, [selectedCode]);

  const params = React.useMemo(() => {
    const build = (state: FilterState): Record<string, string | number> => {
      const entries: Record<string, string | number | undefined> = {
        businessUnitId: state.businessUnitId || undefined,
        departmentId: state.departmentId || undefined,
        frequency: state.frequency || undefined,
        periodId: state.periodId || undefined,
        employeeId: state.employeeId || undefined,
        status: state.status || undefined,
        categoryId: state.categoryId || undefined,
        measurementType: state.measurementType || undefined,
        rag: state.rag || undefined,
        approverId: state.approverId || undefined,
        exceptionType: state.exceptionType || undefined,
        type: state.type || undefined,
        entity: state.entity || undefined,
        entityId: state.entityId || undefined,
        yearFrom: state.yearFrom ? Number(state.yearFrom) : undefined,
        yearTo: state.yearTo ? Number(state.yearTo) : undefined,
        age: state.age ? Number(state.age) : undefined,
      };
      return Object.entries(entries).reduce<Record<string, string | number>>((result, [key, value]) => {
        if (value !== undefined && value !== '') result[key] = value;
        return result;
      }, {});
    };
    return build(filters);
  }, [filters]);

  const previewQuery = useQuery({
    queryKey: ['reports', 'preview', selectedCode, { page, size, params }],
    queryFn: () => api.get<ReportResult>(`/reports/${selectedCode}`, { page, size, ...params }),
    enabled: Boolean(selectedCode),
    placeholderData: keepPreviousData,
  });

  const setFilter = (key: keyof FilterState, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const previewFooter = (result: ReportResult): string =>
    [
      `${result.code} · ${result.name}`,
      `Filters: ${
        Object.entries(result.meta.filters)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(', ') || 'none'
      }`,
      `Generated by ${result.meta.generatedBy.name} (${result.meta.generatedBy.email}) at ${formatDateTime(result.meta.generatedAt)}`,
      `Rows: ${result.meta.rowCount.toLocaleString()}`,
      'Anwar Group of Industries · Internal & Confidential',
    ].join('  |  ');

  // ------------------------------------------------------------------ export
  const exportMutation = useMutation({
    mutationFn: (format: 'XLSX' | 'CSV' | 'PDF') =>
      api.post<ExportResult>(`/reports/${selectedCode}/export`, { format, filters: params }),
    onSuccess: (result, format) => {
      if (result.async) {
        setAsyncMessage(result.message);
        toast.info('Export queued', 'You will receive a notification with the download link (valid 24 hours).');
        queryClient.invalidateQueries({ queryKey: ['reports', 'exports', 'mine'] });
        return;
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      if (format === 'CSV') {
        const csv = buildCsv(result.columns, result.rows, result.totals, result.footer);
        saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${result.code}-${stamp}.csv`);
        toast.success('CSV export ready', `${result.rowCount.toLocaleString()} row(s) downloaded.`);
      } else if (format === 'XLSX') {
        const xml = buildWorkbookXml(result.code, result.columns, result.rows, result.totals, result.footer);
        saveBlob(
          new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }),
          `${result.code}-${stamp}.xls`,
        );
        toast.success('Excel export ready', `${result.rowCount.toLocaleString()} row(s) downloaded.`);
      } else {
        const opened = openPrintWindow(result, result.footer);
        if (opened) {
          toast.success('Print view opened', 'Use Print → Save as PDF in the new window.');
        } else {
          toast.error(
            'The print window was blocked',
            'Allow pop-ups for this site, then choose PDF again — this view prints to PDF.',
          );
        }
      }
      queryClient.invalidateQueries({ queryKey: ['reports', 'exports', 'mine'] });
    },
    onError: (error) => toast.error('The export could not be generated', messageOf(error)),
  });

  // --------------------------------------------------------------- my exports
  const exportsQuery = useQuery({
    queryKey: ['reports', 'exports', 'mine'],
    queryFn: () => api.get<MyExport[]>('/reports/meta/exports/mine'),
    staleTime: 30_000,
  });

  const downloadMutation = useMutation({
    mutationFn: async (job: MyExport) => {
      const blob = await api.download(`/reports/${job.reportCode}/download/${job.id}`);
      return { blob, job };
    },
    onSuccess: ({ blob, job }) => {
      const extension = job.format === 'PDF' ? 'pdf' : job.format === 'CSV' ? 'csv' : 'xls';
      saveBlob(blob, `${job.reportCode}-${job.id.slice(0, 8)}.${extension}`);
      toast.success('Download started', `${job.reportCode} · ${job.format}`);
    },
    onError: (error) => toast.error('Could not download the export', messageOf(error)),
  });

  // ---------------------------------------------------------------- helpers
  const has = (token: string): boolean =>
    (report?.extraFilters ?? []).some((entry) => entry.toLowerCase().includes(token));

  const showEmployee = has('employee');
  const showStatus = has('status');
  const showCategory = has('category');
  const showRag = has('rag');
  const showApprover = has('approver');
  const showException = has('exception');
  const showEntity = has('entity');
  const showTypeSelect = has('type') && !showException;
  const showAge = has('age');
  const showYearRange = has('year');
  const measurementTypeAsType = report?.code === 'RP-05';

  const meta = metaQuery.data;
  const departments = (meta?.departments ?? []).filter(
    (department) => !filters.businessUnitId || department.businessUnitId === filters.businessUnitId,
  );

  const result = previewQuery.data;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="M12 — run, preview and export the group reports. Previews are server-paged; exports carry the AC-19 footer."
      />

      {/* --------------------------------------------------------- catalogue */}
      {!selectedCode ? (
        <Card className="mb-4">
          <CardHeader
            title="Report catalogue"
            subtitle="Only the reports your role may run are listed (§5.2 / §14). Select one to open the workspace."
          />
          {catalogueQuery.isError ? (
            <ErrorState message={messageOf(catalogueQuery.error)} onRetry={() => void catalogueQuery.refetch()} />
          ) : catalogueQuery.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-28 w-full" />
              ))}
            </div>
          ) : !catalogueQuery.data?.length ? (
            <EmptyState title="No reports available" description="Your role does not include any report." />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {catalogueQuery.data.map((entry) => (
                <li key={entry.code}>
                  <button
                    type="button"
                    onClick={() => setSelectedCode(entry.code)}
                    className="anwar-card anwar-card-pad h-full w-full text-left transition-shadow hover:shadow-raised"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="anwar-mono text-caption text-ink-secondary">{entry.code}</p>
                      <Badge tone="info">{entry.columnCount} columns</Badge>
                    </div>
                    <p className="mt-1 text-h3 text-navy-900">{entry.name}</p>
                    <p className="mt-1 text-caption text-ink-secondary">{entry.purpose}</p>
                    <p className="mt-2 text-[11px] text-ink-muted">Audience: {entry.audience}</p>
                    {entry.extraFilters.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {entry.extraFilters.map((filter) => (
                          <Badge key={filter} tone="neutral">
                            {filter}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <>
          {/* ------------------------------------------------------ workspace */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setSelectedCode(null)}>
              ← All reports
            </Button>
            {report ? (
              <div className="text-right">
                <p className="text-h3 text-navy-900">
                  <span className="anwar-mono mr-2 text-caption text-ink-secondary">{report.code}</span>
                  {report.name}
                </p>
                <p className="text-caption text-ink-secondary">{report.purpose}</p>
              </div>
            ) : null}
          </div>

          <Card className="mb-4">
            <CardHeader
              title="Filters"
              subtitle={
                report?.extraFilters.length
                  ? `Report-specific filters: ${report.extraFilters.join(', ')}.`
                  : 'This report uses the common filters only.'
              }
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFilters(EMPTY_FILTERS);
                    setSelectedEmployee(null);
                    setPage(1);
                  }}
                >
                  Reset filters
                </Button>
              }
            />

            {metaQuery.isError ? (
              <ErrorState message={messageOf(metaQuery.error)} onRetry={() => void metaQuery.refetch()} />
            ) : !meta ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Business unit" htmlFor="report-bu">
                  <Select
                    id="report-bu"
                    value={filters.businessUnitId}
                    onChange={(event) => {
                      setFilters((current) => ({ ...current, businessUnitId: event.target.value, departmentId: '' }));
                      setPage(1);
                    }}
                  >
                    <option value="">All business units</option>
                    {meta.businessUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.code} · {unit.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Department" htmlFor="report-department" hint="Filtered by the chosen business unit.">
                  <Select
                    id="report-department"
                    value={filters.departmentId}
                    onChange={(event) => setFilter('departmentId', event.target.value)}
                  >
                    <option value="">All departments</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Frequency" htmlFor="report-frequency">
                  <Select
                    id="report-frequency"
                    value={filters.frequency}
                    onChange={(event) => setFilter('frequency', event.target.value)}
                  >
                    <option value="">All frequencies</option>
                    {FREQUENCY_OPTIONS.map((frequency) => (
                      <option key={frequency} value={frequency}>
                        {frequency.charAt(0) + frequency.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Period" htmlFor="report-period">
                  <Select id="report-period" value={filters.periodId} onChange={(event) => setFilter('periodId', event.target.value)}>
                    <option value="">All periods (last 60)</option>
                    {meta.periods.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.label} · {period.status}
                      </option>
                    ))}
                  </Select>
                </Field>

                {showEmployee ? (
                  <Field label="Employee" htmlFor="report-employee" hint="Search the people directory.">
                    <EmployeePicker
                      value={filters.employeeId}
                      selected={selectedEmployee}
                      onChange={(employee) => {
                        setSelectedEmployee(employee);
                        setFilters((current) => ({
                          ...current,
                          employeeId: employee?.id ?? '',
                          ...(filters.entity === 'employee' ? { entityId: employee?.id ?? '' } : {}),
                        }));
                        setPage(1);
                      }}
                    />
                  </Field>
                ) : null}

                {showStatus ? (
                  <Field label="KPI status" htmlFor="report-status">
                    <Select id="report-status" value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
                      <option value="">All statuses</option>
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status as keyof typeof STATUS_LABELS]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                {showCategory ? (
                  <Field label="Category" htmlFor="report-category">
                    <Select
                      id="report-category"
                      value={filters.categoryId}
                      onChange={(event) => setFilter('categoryId', event.target.value)}
                    >
                      <option value="">All categories</option>
                      {meta.categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                {showRag ? (
                  <Field label="RAG" htmlFor="report-rag">
                    <Select id="report-rag" value={filters.rag} onChange={(event) => setFilter('rag', event.target.value)}>
                      <option value="">All RAG bands</option>
                      {RAG_OPTIONS.map((rag) => (
                        <option key={rag} value={rag}>
                          {rag.charAt(0) + rag.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                {showApprover ? (
                  <Field label="Approver" htmlFor="report-approver">
                    <Select id="report-approver" value={filters.approverId} onChange={(event) => setFilter('approverId', event.target.value)}>
                      <option value="">All approvers</option>
                      {meta.approvers.map((approver) => (
                        <option key={approver.id} value={approver.id}>
                          {approver.fullName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                {showException ? (
                  <Field label="Exception type" htmlFor="report-exception">
                    <Select
                      id="report-exception"
                      value={filters.exceptionType}
                      onChange={(event) => setFilter('exceptionType', event.target.value)}
                    >
                      {EXCEPTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                {showTypeSelect && measurementTypeAsType ? (
                  <Field label="Measurement type" htmlFor="report-measurement" hint="The distribution report groups by measurement type.">
                    <Select
                      id="report-measurement"
                      value={filters.measurementType}
                      onChange={(event) => setFilter('measurementType', event.target.value)}
                    >
                      <option value="">All measurement types</option>
                      {(['COUNT', 'MONETARY', 'PERCENTAGE', 'TIME', 'RATING', 'QUALITATIVE'] as const).map((type) => (
                        <option key={type} value={type}>
                          {type.charAt(0) + type.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                {showTypeSelect && !measurementTypeAsType ? (
                  <Field label="Type" htmlFor="report-type">
                    <Select id="report-type" value={filters.type} onChange={(event) => setFilter('type', event.target.value)}>
                      <option value="">All types</option>
                      {TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                {showEntity ? (
                  <>
                    <Field label="Entity" htmlFor="report-entity">
                      <Select
                        id="report-entity"
                        value={filters.entity}
                        onChange={(event) => {
                          setFilters((current) => ({ ...current, entity: event.target.value, entityId: '' }));
                          setPage(1);
                        }}
                      >
                        <option value="">Department (default)</option>
                        <option value="department">Department</option>
                        <option value="business_unit">Business unit</option>
                      </Select>
                    </Field>
                    <Field label="Entity record" htmlFor="report-entity-id" hint="Optional — narrow to one record.">
                      <Select
                        id="report-entity-id"
                        value={filters.entityId}
                        onChange={(event) => setFilter('entityId', event.target.value)}
                      >
                        <option value="">All</option>
                        {filters.entity === 'business_unit'
                          ? meta.businessUnits.map((unit) => (
                              <option key={unit.id} value={unit.id}>
                                {unit.name}
                              </option>
                            ))
                          : meta.departments.map((department) => (
                              <option key={department.id} value={department.id}>
                                {department.name}
                              </option>
                            ))}
                      </Select>
                    </Field>
                  </>
                ) : null}

                {showAge ? (
                  <Field label="Minimum age (working days)" htmlFor="report-age">
                    <Input
                      id="report-age"
                      type="number"
                      min={0}
                      value={filters.age}
                      onChange={(event) => setFilter('age', event.target.value)}
                    />
                  </Field>
                ) : null}

                {showYearRange ? (
                  <>
                    <Field label="Year from" htmlFor="report-year-from">
                      <Input
                        id="report-year-from"
                        type="number"
                        min={2000}
                        max={2100}
                        value={filters.yearFrom}
                        onChange={(event) => setFilter('yearFrom', event.target.value)}
                      />
                    </Field>
                    <Field label="Year to" htmlFor="report-year-to">
                      <Input
                        id="report-year-to"
                        type="number"
                        min={2000}
                        max={2100}
                        value={filters.yearTo}
                        onChange={(event) => setFilter('yearTo', event.target.value)}
                      />
                    </Field>
                  </>
                ) : null}
              </div>
            )}
          </Card>

          {/* -------------------------------------------------------- preview */}
          {asyncMessage ? (
            <Alert tone="info" className="mb-4" title="Export is being generated" actions={
              <Button size="sm" variant="secondary" onClick={() => setAsyncMessage(null)}>
                Dismiss
              </Button>
            }>
              {asyncMessage} The download link arrives by notification and is valid for 24 hours (FR-RPT-02).
            </Alert>
          ) : null}

          <Card className="mb-4">
            <CardHeader
              title="Preview"
              subtitle="Server-paged. Numeric, percent and money columns are right-aligned; the totals row uses the report's own totals."
              actions={
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={exportMutation.isPending && exportMutation.variables === 'XLSX'}
                    onClick={() => exportMutation.mutate('XLSX')}
                  >
                    Export XLSX
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={exportMutation.isPending && exportMutation.variables === 'CSV'}
                    onClick={() => exportMutation.mutate('CSV')}
                  >
                    Export CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={exportMutation.isPending && exportMutation.variables === 'PDF'}
                    onClick={() => exportMutation.mutate('PDF')}
                  >
                    Print / PDF
                  </Button>
                </div>
              }
            />

            <p className="mb-3 text-caption text-ink-muted">
              PDF is delivered as a print-ready view — choose “Save as PDF” in the print dialog.
            </p>

            {previewQuery.isError ? (
              <ErrorState message={messageOf(previewQuery.error)} onRetry={() => void previewQuery.refetch()} />
            ) : previewQuery.isPending || !result ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : !result.rows.length ? (
              <EmptyState
                title="No rows match the filters"
                description="Widen the filters or change the period to see data."
              />
            ) : (
              <>
                <div className="-mx-4 overflow-x-auto sm:mx-0">
                  <table className="anwar-table sticky-first-col">
                    <thead>
                      <tr>
                        {result.columns.map((column) => (
                          <th key={column.key} className={isRightAligned(column) ? 'text-right' : undefined}>
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {result.columns.map((column) => (
                            <td key={column.key} className={isRightAligned(column) ? 'text-right' : undefined}>
                              <ReportCell column={column} value={row[column.key]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {result.totals ? (
                      <tfoot>
                        <tr className="bg-canvas font-semibold">
                          {result.columns.map((column, index) => (
                            <td
                              key={column.key}
                              className={`border-t border-edge ${isRightAligned(column) ? 'text-right' : ''}`}
                            >
                              {index === 0 ? (
                                'Totals'
                              ) : (
                                <ReportCell column={column} value={result.totals?.[column.key]} />
                              )}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>

                <div className="mt-3 rounded-control border border-edge bg-canvas px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">Footer (AC-19)</p>
                  <p className="mt-0.5 break-words text-caption text-ink-secondary">{previewFooter(result)}</p>
                </div>

                <Pagination
                  page={result.meta.page}
                  size={result.meta.size}
                  total={result.meta.rowCount}
                  totalPages={result.meta.totalPages}
                  onPage={setPage}
                  onSize={(next) => {
                    setSize(next);
                    setPage(1);
                  }}
                />
              </>
            )}
          </Card>
        </>
      )}

      {/* ------------------------------------------------------- my exports */}
      <Card>
        <CardHeader
          title="My exports"
          subtitle="Async exports arrive here when the job completes. Files expire 24 hours after they are generated."
          actions={
            <Button size="sm" variant="ghost" onClick={() => void exportsQuery.refetch()}>
              Refresh
            </Button>
          }
        />
        {exportsQuery.isError ? (
          <ErrorState message={messageOf(exportsQuery.error)} onRetry={() => void exportsQuery.refetch()} />
        ) : exportsQuery.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : !exportsQuery.data?.length ? (
          <EmptyState title="No exports yet" description="The exports you generate appear here." />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="anwar-table sticky-first-col">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Format</th>
                  <th>Status</th>
                  <th className="text-right">Rows</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th className="text-right">Download</th>
                </tr>
              </thead>
              <tbody>
                {exportsQuery.data.map((job) => (
                  <tr key={job.id}>
                    <td className="anwar-mono">{job.reportCode}</td>
                    <td>{job.format}</td>
                    <td>
                      <Badge
                        tone={
                          job.status === 'COMPLETED'
                            ? 'success'
                            : job.status === 'FAILED'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {job.status}
                      </Badge>
                      {job.error ? <p className="mt-1 text-caption text-danger">{job.error}</p> : null}
                    </td>
                    <td className="tnum text-right">{job.rowCount?.toLocaleString() ?? '—'}</td>
                    <td>{formatDateTime(job.createdAt)}</td>
                    <td>{job.expiresAt ? formatDateTime(job.expiresAt) : '—'}</td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={job.status !== 'COMPLETED'}
                        loading={downloadMutation.isPending && downloadMutation.variables?.id === job.id}
                        onClick={() => downloadMutation.mutate(job)}
                      >
                        Download
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
};

export default ReportsPage;
