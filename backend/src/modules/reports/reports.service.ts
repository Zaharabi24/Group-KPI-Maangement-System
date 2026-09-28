/**
 * Report catalogue — BRD §14 (RP-01 … RP-13).
 *
 * Common rules: open periods use live data from approved KPIs; closed periods use
 * performance snapshots. Every report enforces the viewer's data scope (§5.3).
 * All metrics use the §4.5 formulas.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { NotFound, Forbidden } from '../../common/errors/error-codes';
import { REPORT_ACCESS, RoleKey } from '../../common/constants';
import {
  dec,
  decOrNull,
  formatBdt,
  num,
  round2,
  Decimal,
} from '../../common/utils/decimal.util';
import { ragFor } from '../calculation/calculation.engine';
import { workingDaysBetween } from '../../common/utils/period.util';

export type ReportColumnType = 'text' | 'number' | 'decimal' | 'integer' | 'percent' | 'money' | 'date' | 'datetime' | 'badge';

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
  width?: number;
  align?: 'left' | 'center' | 'right';
}

export interface ReportDefinition {
  code: string;
  name: string;
  purpose: string;
  audience: string;
  extraFilters: string[];
  columns: ReportColumn[];
}

export interface ReportFilters {
  businessUnitId?: string;
  departmentId?: string;
  frequency?: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  periodId?: string;
  periodCode?: string;
  year?: number;
  yearFrom?: number;
  yearTo?: number;
  employeeId?: string;
  status?: string;
  categoryId?: string;
  measurementType?: string;
  rag?: string;
  approverId?: string;
  exceptionType?: string;
  type?: string;
  entity?: 'employee' | 'department' | 'business_unit';
  entityId?: string;
  approver?: string;
  age?: number;
}

export interface ReportResult {
  code: string;
  name: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
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

const num2 = (v: unknown): string | null =>
  v === null || v === undefined ? null : dec(v as never);
const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
void intOrNull;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  // ------------------------------------------------------------------ catalogue

  readonly definitions: ReportDefinition[] = [
    {
      code: 'RP-01',
      name: 'Employee KPI Report',
      purpose: 'Full KPI-level record for one or more employees.',
      audience: 'Employee (own), Dept Head, Super Admin, HR',
      extraFilters: ['employee', 'status', 'category'],
      columns: [
        { key: 'kpiCode', label: 'KPI Code', type: 'text' },
        { key: 'kpi', label: 'KPI', type: 'text' },
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'target', label: 'Target', type: 'decimal', align: 'right' },
        { key: 'actual', label: 'Actual', type: 'decimal', align: 'right' },
        { key: 'achievement', label: 'ACH %', type: 'percent', align: 'right' },
        { key: 'weight', label: 'Weight', type: 'integer', align: 'right' },
        { key: 'calculatedScore', label: 'CS', type: 'decimal', align: 'right' },
        { key: 'finalScore', label: 'FS', type: 'decimal', align: 'right' },
        { key: 'weightedScore', label: 'WS', type: 'decimal', align: 'right' },
        { key: 'evidenceCount', label: 'Evidence', type: 'integer', align: 'right' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
        { key: 'status', label: 'Status', type: 'badge' },
        { key: 'approver', label: 'Approver', type: 'text' },
        { key: 'decisionDate', label: 'Decision Date', type: 'date' },
      ],
    },
    {
      code: 'RP-02',
      name: 'Employee Performance Report',
      purpose: 'Period results per employee.',
      audience: 'Dept Head, Super Admin, HR',
      extraFilters: ['employee', 'RAG'],
      columns: [
        { key: 'employeeCode', label: 'Employee ID', type: 'text' },
        { key: 'employeeName', label: 'Employee', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'designation', label: 'Designation', type: 'text' },
        { key: 'period', label: 'Period', type: 'text' },
        { key: 'totalKpiScore', label: 'Total KPI Score', type: 'decimal', align: 'right' },
        { key: 'averageAchievement', label: 'Average Achievement', type: 'percent', align: 'right' },
        { key: 'allocatedWeight', label: 'Allocated Weight', type: 'integer', align: 'right' },
        { key: 'approvedCount', label: 'Approved', type: 'integer', align: 'right' },
        { key: 'totalCount', label: 'Total KPIs', type: 'integer', align: 'right' },
        { key: 'rag', label: 'RAG', type: 'badge' },
        { key: 'rank', label: 'Rank', type: 'integer', align: 'right' },
        { key: 'previousScore', label: 'Previous Score', type: 'decimal', align: 'right' },
        { key: 'difference', label: 'Difference', type: 'decimal', align: 'right' },
      ],
    },
    {
      code: 'RP-03',
      name: 'Department Performance Report',
      purpose: 'Compare departments.',
      audience: 'Super Admin, HR, Mgmt Viewer (Dept Head: own)',
      extraFilters: ['department'],
      columns: [
        { key: 'businessUnit', label: 'Business Unit', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'headcount', label: 'Headcount', type: 'integer', align: 'right' },
        { key: 'participation', label: 'Participation %', type: 'percent', align: 'right' },
        { key: 'averageAchievement', label: 'Dept Avg Achievement', type: 'percent', align: 'right' },
        { key: 'averageTotalScore', label: 'Avg Total Score', type: 'decimal', align: 'right' },
        { key: 'approved', label: 'Approved', type: 'integer', align: 'right' },
        { key: 'pending', label: 'Pending', type: 'integer', align: 'right' },
        { key: 'rejected', label: 'Rejected', type: 'integer', align: 'right' },
        { key: 'belowTarget', label: 'Below Target', type: 'integer', align: 'right' },
        { key: 'weightIncomplete', label: 'Weight Incomplete', type: 'integer', align: 'right' },
      ],
    },
    {
      code: 'RP-04',
      name: 'Manager (Approver) Performance Report',
      purpose: 'Approver timeliness and consistency.',
      audience: 'Super Admin, HR',
      extraFilters: ['approver'],
      columns: [
        { key: 'approver', label: 'Approver', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'received', label: 'Requests Received', type: 'integer', align: 'right' },
        { key: 'decided', label: 'Requests Decided', type: 'integer', align: 'right' },
        { key: 'medianDecisionDays', label: 'Median Decision (working days)', type: 'decimal', align: 'right' },
        { key: 'slaBreachPct', label: 'SLA Breach %', type: 'percent', align: 'right' },
        { key: 'adjustments', label: 'Adjustments', type: 'integer', align: 'right' },
        { key: 'meanDelta', label: 'Mean Δ', type: 'decimal', align: 'right' },
        { key: 'escalations', label: 'Escalations', type: 'integer', align: 'right' },
        { key: 'returns', label: 'Returns', type: 'integer', align: 'right' },
        { key: 'rejections', label: 'Rejections', type: 'integer', align: 'right' },
      ],
    },
    {
      code: 'RP-05',
      name: 'KPI Achievement Report',
      purpose: 'Distribution of achievement.',
      audience: 'Super Admin, HR, Dept Head',
      extraFilters: ['category', 'type'],
      columns: [
        { key: 'band', label: 'ACH Band', type: 'text' },
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'measurementType', label: 'Measurement Type', type: 'text' },
        { key: 'kpiCount', label: 'KPI Count', type: 'integer', align: 'right' },
        { key: 'kpiPct', label: 'KPI %', type: 'percent', align: 'right' },
      ],
    },
    {
      code: 'RP-06',
      name: 'Variable KPI Report',
      purpose: 'Master extract of variable KPIs for HR and management.',
      audience: 'Super Admin, HR',
      extraFilters: ['status'],
      columns: [
        { key: 'kpiCode', label: 'KPI Code', type: 'text' },
        { key: 'employeeCode', label: 'Employee ID', type: 'text' },
        { key: 'employeeName', label: 'Employee', type: 'text' },
        { key: 'businessUnit', label: 'Business Unit', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'kpi', label: 'KPI', type: 'text' },
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'target', label: 'Target', type: 'decimal', align: 'right' },
        { key: 'actual', label: 'Actual', type: 'decimal', align: 'right' },
        { key: 'achievement', label: 'ACH %', type: 'percent', align: 'right' },
        { key: 'weight', label: 'Weight', type: 'integer', align: 'right' },
        { key: 'calculatedScore', label: 'CS', type: 'decimal', align: 'right' },
        { key: 'finalScore', label: 'FS', type: 'decimal', align: 'right' },
        { key: 'weightedScore', label: 'WS', type: 'decimal', align: 'right' },
        { key: 'status', label: 'Status', type: 'badge' },
        { key: 'approver', label: 'Approver', type: 'text' },
        { key: 'configVersion', label: 'Config Version', type: 'integer', align: 'right' },
        { key: 'escalated', label: 'Escalation', type: 'text' },
      ],
    },
    {
      code: 'RP-07',
      name: 'KPI Trend Report',
      purpose: 'Performance over time.',
      audience: 'All roles within scope',
      extraFilters: ['entity (employee / department / BU)'],
      columns: [
        { key: 'entity', label: 'Entity', type: 'text' },
        { key: 'period', label: 'Period', type: 'text' },
        { key: 'totalKpiScore', label: 'Total KPI Score', type: 'decimal', align: 'right' },
        { key: 'averageAchievement', label: 'Average Achievement', type: 'percent', align: 'right' },
        { key: 'kpiCount', label: 'KPIs', type: 'integer', align: 'right' },
        { key: 'change', label: 'Period-over-Period', type: 'decimal', align: 'right' },
      ],
    },
    {
      code: 'RP-08',
      name: 'Monthly / Quarterly / Annual Performance Report',
      purpose: 'Period close pack.',
      audience: 'Super Admin, Mgmt Viewer, HR',
      extraFilters: ['frequency'],
      columns: [
        { key: 'section', label: 'Section', type: 'text' },
        { key: 'rank', label: 'Rank / Key', type: 'text' },
        { key: 'name', label: 'Employee / Department', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'value', label: 'Value', type: 'text' },
        { key: 'secondary', label: 'Detail', type: 'text' },
      ],
    },
    {
      code: 'RP-09',
      name: 'Pending Review Report',
      purpose: 'Queue health.',
      audience: 'Dept Head (own), Super Admin',
      extraFilters: ['approver', 'age'],
      columns: [
        { key: 'employeeCode', label: 'Employee ID', type: 'text' },
        { key: 'employeeName', label: 'Employee', type: 'text' },
        { key: 'designation', label: 'Designation', type: 'text' },
        { key: 'kpi', label: 'KPI', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'approver', label: 'Approver', type: 'text' },
        { key: 'submittedAt', label: 'Submitted', type: 'datetime' },
        { key: 'ageDays', label: 'Age (working days)', type: 'integer', align: 'right' },
        { key: 'slaStatus', label: 'SLA Status', type: 'badge' },
        { key: 'status', label: 'Status', type: 'badge' },
      ],
    },
    {
      code: 'RP-10',
      name: 'Pending Approval Report',
      purpose: 'Items waiting for a Super Admin.',
      audience: 'Super Admin',
      extraFilters: ['type'],
      columns: [
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'employeeName', label: 'Employee', type: 'text' },
        { key: 'kpi', label: 'KPI', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'calculatedScore', label: 'CS', type: 'decimal', align: 'right' },
        { key: 'proposedScore', label: 'Proposed / FS', type: 'decimal', align: 'right' },
        { key: 'delta', label: 'Δ', type: 'decimal', align: 'right' },
        { key: 'requester', label: 'Requester', type: 'text' },
        { key: 'reason', label: 'Reason', type: 'text' },
        { key: 'ageDays', label: 'Age (working days)', type: 'integer', align: 'right' },
      ],
    },
    {
      code: 'RP-11',
      name: 'KPI Exception Report',
      purpose: 'Control and audit.',
      audience: 'Super Admin, HR, internal audit',
      extraFilters: ['exception type'],
      columns: [
        { key: 'exceptionType', label: 'Exception', type: 'text' },
        { key: 'employeeCode', label: 'Employee ID', type: 'text' },
        { key: 'employeeName', label: 'Employee', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'kpi', label: 'KPI', type: 'text' },
        { key: 'detail', label: 'Detail', type: 'text' },
        { key: 'period', label: 'Period', type: 'text' },
        { key: 'detectedAt', label: 'Detected', type: 'datetime' },
      ],
    },
    {
      code: 'RP-12',
      name: 'Historical Performance Report',
      purpose: 'Multi-period history from snapshots and versions.',
      audience: 'Super Admin, HR (Employee: own)',
      extraFilters: ['year range'],
      columns: [
        { key: 'employeeCode', label: 'Employee ID', type: 'text' },
        { key: 'employeeName', label: 'Employee', type: 'text' },
        { key: 'period', label: 'Period', type: 'text' },
        { key: 'totalKpiScore', label: 'Total KPI Score', type: 'decimal', align: 'right' },
        { key: 'averageAchievement', label: 'Average Achievement', type: 'percent', align: 'right' },
        { key: 'rank', label: 'Rank', type: 'integer', align: 'right' },
        { key: 'versionCount', label: 'Versions', type: 'integer', align: 'right' },
        { key: 'rag', label: 'RAG', type: 'badge' },
      ],
    },
    {
      code: 'RP-13',
      name: 'Management Summary Report',
      purpose: 'One-page executive pack (PDF / XLSX).',
      audience: 'Super Admin, Mgmt Viewer',
      extraFilters: ['frequency'],
      columns: [
        { key: 'section', label: 'Section', type: 'text' },
        { key: 'metric', label: 'Metric', type: 'text' },
        { key: 'value', label: 'Value', type: 'text' },
      ],
    },
  ];

  getDefinition(code: string): ReportDefinition {
    const def = this.definitions.find((d) => d.code === code.toUpperCase());
    if (!def) throw NotFound('NOT-FOUND', `Report ${code} does not exist`);
    return def;
  }

  assertAccess(user: AuthUser, code: string): void {
    const allowed = REPORT_ACCESS[code.toUpperCase()];
    if (!allowed) throw NotFound('NOT-FOUND', `Report ${code} does not exist`);
    if (!user.roles.some((r) => allowed.includes(r as RoleKey))) {
      throw Forbidden('FORBIDDEN', `The ${code} report is not available to your role`);
    }
  }

  // -------------------------------------------------------------------- runner

  async run(
    user: AuthUser,
    code: string,
    filters: ReportFilters,
    page = 1,
    size = 25,
  ): Promise<ReportResult> {
    const def = this.getDefinition(code);
    this.assertAccess(user, def.code);
    const rows = await this.buildRows(user, def.code, filters);

    const total = rows.length;
    const start = (page - 1) * size;
    const paged = rows.slice(start, start + size);

    return {
      code: def.code,
      name: def.name,
      columns: def.columns,
      rows: paged,
      totals: this.totalsFor(def.code, rows),
      meta: {
        filters: filters as Record<string, unknown>,
        generatedAt: new Date().toISOString(),
        generatedBy: { id: user.id, name: user.fullName, email: user.email },
        rowCount: total,
        page,
        size,
        totalPages: Math.max(1, Math.ceil(total / size)),
      },
    };
  }

  /** Full, unpaged dataset used by exports (AC-19). */
  async runFull(user: AuthUser, code: string, filters: ReportFilters): Promise<ReportResult> {
    const def = this.getDefinition(code);
    this.assertAccess(user, def.code);
    const rows = await this.buildRows(user, def.code, filters);
    return {
      code: def.code,
      name: def.name,
      columns: def.columns,
      rows,
      totals: this.totalsFor(def.code, rows),
      meta: {
        filters: filters as Record<string, unknown>,
        generatedAt: new Date().toISOString(),
        generatedBy: { id: user.id, name: user.fullName, email: user.email },
        rowCount: rows.length,
        page: 1,
        size: rows.length,
        totalPages: 1,
      },
    };
  }

  // ------------------------------------------------------------------ builders

  private async periodWhere(filters: ReportFilters): Promise<Prisma.KpiWhereInput> {
    const where: Prisma.KpiWhereInput = {};
    if (filters.periodId) {
      where.periodId = filters.periodId;
    } else if (filters.periodCode) {
      where.period = { code: filters.periodCode };
    } else if (filters.frequency || filters.year) {
      const periodFilter: Prisma.KpiPeriodWhereInput = {};
      if (filters.frequency) periodFilter.frequency = filters.frequency;
      if (filters.year) periodFilter.year = filters.year;
      where.period = periodFilter;
    }
    return where;
  }

  private mergeScopeKpi(user: AuthUser, extra: Prisma.KpiWhereInput): Prisma.KpiWhereInput {
    const scopeWhere = this.scope.kpiScopeWhere(user);
    if (!scopeWhere.OR) return extra;
    return { AND: [scopeWhere, extra] };
  }

  private inScopeEmployeeIds(user: AuthUser): string[] | null {
    if (this.scope.isGroupScoped(user)) return null;
    return [user.id, ...user.scope.departmentIds.map(() => '')].filter(Boolean);
  }

  private kpiSelect() {
    return {
      id: true,
      code: true,
      name: true,
      kpiType: true,
      measurementType: true,
      unit: true,
      direction: true,
      target: true,
      actual: true,
      achievement: true,
      calculatedScore: true,
      finalScore: true,
      overrideScore: true,
      kpiWeight: true,
      weightedScore: true,
      status: true,
      remarks: true,
      evidenceCount: true,
      submittedAt: true,
      decidedAt: true,
      createdAt: true,
      frequency: true,
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          email: true,
          designationTitle: true,
          department: { select: { id: true, name: true } },
          businessUnit: { select: { id: true, name: true, code: true } },
        },
      },
      approver: { select: { id: true, fullName: true } },
      period: { select: { id: true, code: true, label: true, frequency: true } },
      category: { select: { id: true, code: true, name: true } },
      configVersion: { select: { version: true } },
      escalations: { select: { status: true }, take: 1, orderBy: { createdAt: 'desc' as const } },
      department: { select: { id: true, name: true } },
      businessUnit: { select: { id: true, name: true, code: true } },
    } satisfies Prisma.KpiSelect;
  }

  private async buildRows(
    user: AuthUser,
    code: string,
    filters: ReportFilters,
  ): Promise<Record<string, unknown>[]> {
    switch (code) {
      case 'RP-01':
        return this.rp01(user, filters);
      case 'RP-02':
        return this.rp02(user, filters);
      case 'RP-03':
        return this.rp03(user, filters);
      case 'RP-04':
        return this.rp04(user, filters);
      case 'RP-05':
        return this.rp05(user, filters);
      case 'RP-06':
        return this.rp06(user, filters);
      case 'RP-07':
        return this.rp07(user, filters);
      case 'RP-08':
        return this.rp08(user, filters);
      case 'RP-09':
        return this.rp09(user, filters);
      case 'RP-10':
        return this.rp10(user, filters);
      case 'RP-11':
        return this.rp11(user, filters);
      case 'RP-12':
        return this.rp12(user, filters);
      case 'RP-13':
        return this.rp13(user, filters);
      default:
        throw NotFound('NOT-FOUND', `Report ${code} is not implemented`);
    }
  }

  /** RP-01 — full KPI-level record. */
  private async rp01(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const where = this.mergeScopeKpi(user, {
      ...(await this.periodWhere(filters)),
      ...(filters.status ? { status: filters.status as Prisma.EnumKpiStatusFilter['equals'] } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.businessUnitId ? { businessUnitId: filters.businessUnitId } : {}),
      ...(filters.measurementType ? { measurementType: filters.measurementType as never } : {}),
    });

    const rows = await this.prisma.kpi.findMany({
      where,
      select: this.kpiSelect(),
      orderBy: [{ period: { startDate: 'desc' } }, { employee: { fullName: 'asc' } }, { name: 'asc' }],
      take: 50_000,
    });

    return rows.map((k) => ({
      kpiCode: k.code,
      kpi: k.name,
      category: k.category.name,
      type: k.measurementType,
      target: num2(k.target),
      actual: num2(k.actual),
      achievement: num2(k.achievement),
      weight: k.kpiWeight,
      calculatedScore: num2(k.calculatedScore),
      finalScore: num2(k.finalScore),
      weightedScore: num2(k.weightedScore),
      evidenceCount: k.evidenceCount,
      remarks: k.remarks ?? '—',
      status: k.status,
      approver: k.approver?.fullName ?? 'Super Admin',
      decisionDate: k.decidedAt,
      employeeName: k.employee.fullName,
      employeeCode: k.employee.employeeCode,
      period: k.period.label,
    }));
  }

  /** RP-02 — period results per employee (live for open, snapshot for closed). */
  private async rp02(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const periodWhere: Prisma.KpiPeriodWhereInput = {};
    if (filters.periodId) periodWhere.id = filters.periodId;
    else {
      if (filters.frequency) periodWhere.frequency = filters.frequency;
      if (filters.year) periodWhere.year = filters.year;
    }
    const periods = await this.prisma.kpiPeriod.findMany({
      where: periodWhere,
      orderBy: { startDate: 'desc' },
      take: filters.periodId ? 1 : 36,
    });
    if (!periods.length) return [];

    const out: Record<string, unknown>[] = [];
    for (const period of periods) {
      const ctx = await this.employeePeriodMetrics(user, period, filters);
      out.push(...ctx);
    }
    return out;
  }

  private async employeePeriodMetrics(
    user: AuthUser,
    period: { id: string; code: string; label: string; frequency: string; startDate: Date },
    filters: ReportFilters,
  ): Promise<Record<string, unknown>[]> {
    // Closed/reopened periods read snapshots so history never changes (§4.9)
    if (period as unknown as { status?: string }) {
      // fall through to snapshots check below
    }
    const snapshots = await this.prisma.performanceSnapshot.findMany({
      where: {
        periodId: period.id,
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
        ...(filters.businessUnitId ? { businessUnitId: filters.businessUnitId } : {}),
        ...(filters.rag ? { rag: filters.rag as never } : {}),
        employee: this.scope.userScopeWhere(user) as Prisma.UserWhereInput,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            designationTitle: true,
            department: { select: { name: true } },
            businessUnit: { select: { name: true } },
          },
        },
      },
      orderBy: [{ rank: 'asc' }, { totalKpiScore: 'desc' }],
    });

    if (snapshots.length) {
      return snapshots.map((s) => ({
        employeeCode: s.employee.employeeCode,
        employeeName: s.employee.fullName,
        department: s.employee.department?.name ?? '—',
        designation: s.employee.designationTitle ?? '—',
        period: period.label,
        totalKpiScore: num2(s.totalKpiScore),
        averageAchievement: num2(s.averageAchievement),
        allocatedWeight: s.allocatedWeight,
        approvedCount: s.approvedCount,
        totalCount: s.totalCount,
        rag: s.rag,
        rank: s.rank,
        previousScore: num2(s.previousScore),
        difference: num2(s.difference),
      }));
    }

    // Open period — live aggregates from approved KPIs
    const kpis = await this.prisma.kpi.findMany({
      where: this.mergeScopeKpi(user, {
        periodId: period.id,
        status: { notIn: ['DELETED'] },
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
        ...(filters.businessUnitId ? { businessUnitId: filters.businessUnitId } : {}),
      }),
      select: {
        employeeId: true,
        status: true,
        achievement: true,
        finalScore: true,
        weightedScore: true,
        kpiWeight: true,
        employee: {
          select: {
            fullName: true,
            employeeCode: true,
            designationTitle: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    const byEmployee = new Map<string, typeof kpis>();
    kpis.forEach((k) => {
      const list = byEmployee.get(k.employeeId) ?? [];
      list.push(k);
      byEmployee.set(k.employeeId, list);
    });

    const rows: Record<string, unknown>[] = [];
    for (const [, list] of byEmployee) {
      const approved = list.filter((k) => k.status === 'APPROVED');
      const totalScore = round2(approved.reduce((a, k) => a.plus(new Decimal(k.weightedScore?.toString() ?? 0)), new Decimal(0)));
      const achNumerator = approved.reduce(
        (a, k) => a.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight)),
        new Decimal(0),
      );
      const weightSum = approved.reduce((a, k) => a + k.kpiWeight, 0);
      const avgAch = weightSum > 0 ? round2(achNumerator.div(weightSum)) : new Decimal(0);
      const allocated = list.filter((k) => k.status !== 'REJECTED').reduce((a, k) => a + k.kpiWeight, 0);
      const first = list[0];
      rows.push({
        employeeCode: first.employee.employeeCode,
        employeeName: first.employee.fullName,
        department: first.employee.department?.name ?? '—',
        designation: first.employee.designationTitle ?? '—',
        period: period.label,
        totalKpiScore: dec(totalScore),
        averageAchievement: dec(avgAch),
        allocatedWeight: allocated,
        approvedCount: approved.length,
        totalCount: list.length,
        rag: ragFor(totalScore),
        rank: null,
        previousScore: null,
        difference: null,
      });
    }

    rows.sort((a, b) => num(b.totalKpiScore as string) - num(a.totalKpiScore as string));
    rows.forEach((r, i) => {
      r.rank = i + 1;
    });
    return rows;
  }

  /** RP-03 — department comparison. */
  private async rp03(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const deptWhere: Prisma.DepartmentWhereInput = { isActive: true };
    if (filters.departmentId) deptWhere.id = filters.departmentId;
    else if (filters.businessUnitId) deptWhere.businessUnitId = filters.businessUnitId;
    const allowed = this.scope.departmentFilter(user);
    if (allowed) deptWhere.id = { in: allowed };

    const departments = await this.prisma.department.findMany({
      where: deptWhere,
      include: { businessUnit: { select: { name: true, code: true } } },
      orderBy: [{ businessUnit: { name: 'asc' } }, { name: 'asc' }],
      take: 500,
    });

    const periodFilter: Prisma.KpiWhereInput = await this.periodWhere(filters);
    const out: Record<string, unknown>[] = [];

    for (const dept of departments) {
      const headcount = await this.prisma.user.count({
        where: { departmentId: dept.id, status: 'ACTIVE' },
      });
      if (headcount === 0) continue;

      const kpis = await this.prisma.kpi.findMany({
        where: { departmentId: dept.id, ...periodFilter, status: { notIn: ['DELETED'] } },
        select: { employeeId: true, status: true, achievement: true, finalScore: true, weightedScore: true, kpiWeight: true },
        take: 50_000,
      });

      const approved = kpis.filter((k) => k.status === 'APPROVED');
      const scoredEmployees = new Set(approved.map((k) => k.employeeId));
      const participation = headcount ? round2(new Decimal(scoredEmployees.size).div(headcount).mul(100)) : new Decimal(0);

      const totalScore = approved.reduce((a, k) => a.plus(new Decimal(k.weightedScore?.toString() ?? 0)), new Decimal(0));
      const approvedScores = new Map<string, Decimal>();
      approved.forEach((k) => {
        approvedScores.set(k.employeeId, (approvedScores.get(k.employeeId) ?? new Decimal(0)).plus(new Decimal(k.weightedScore?.toString() ?? 0)));
      });
      const avgTotal = approvedScores.size
        ? round2(Array.from(approvedScores.values()).reduce((a, b) => a.plus(b), new Decimal(0)).div(approvedScores.size))
        : new Decimal(0);

      const achNumerator = approved.reduce((a, k) => a.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight)), new Decimal(0));
      const weightSum = approved.reduce((a, k) => a + k.kpiWeight, 0);
      const avgAch = weightSum > 0 ? round2(achNumerator.div(weightSum)) : new Decimal(0);

      // Weight-incomplete employees: allocated weight <> 100 across the period
      const perEmployeeWeight = new Map<string, number>();
      kpis.filter((k) => k.status !== 'REJECTED').forEach((k) => {
        perEmployeeWeight.set(k.employeeId, (perEmployeeWeight.get(k.employeeId) ?? 0) + k.kpiWeight);
      });
      const weightIncomplete = Array.from(perEmployeeWeight.values()).filter((w) => w !== 100).length;

      out.push({
        businessUnit: dept.businessUnit.name,
        department: dept.name,
        headcount,
        participation: dec(participation),
        averageAchievement: dec(avgAch),
        averageTotalScore: dec(avgTotal),
        approved: approved.length,
        pending: kpis.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status)).length,
        rejected: kpis.filter((k) => k.status === 'REJECTED').length,
        belowTarget: approved.filter((k) => k.achievement !== null && num(k.achievement) < 100).length,
        weightIncomplete,
      });
    }

    return out;
  }

  /** RP-04 — approver timeliness. */
  private async rp04(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const where = this.mergeScopeKpi(user, {
      ...(await this.periodWhere(filters)),
      approverId: filters.approverId ? filters.approverId : { not: null },
      status: { in: ['APPROVED', 'REJECTED', 'RETURNED', 'ESCALATED', 'SUBMITTED', 'UNDER_REVIEW'] },
    });

    const kpis = await this.prisma.kpi.findMany({
      where,
      select: {
        approverId: true,
        status: true,
        submittedAt: true,
        decidedAt: true,
        department: { select: { name: true } },
        approver: { select: { id: true, fullName: true } },
        decisions: { select: { action: true, createdAt: true } },
        adjustments: { select: { id: true } },
        escalations: { select: { id: true } },
      },
      take: 50_000,
    });

    const grouped = new Map<string, typeof kpis>();
    kpis.forEach((k) => {
      if (!k.approverId) return;
      const list = grouped.get(k.approverId) ?? [];
      list.push(k);
      grouped.set(k.approverId, list);
    });

    const rows: Record<string, unknown>[] = [];
    for (const [, list] of grouped) {
      const decided = list.filter((k) => k.decidedAt && k.submittedAt);
      const durations = decided
        .map((k) => workingDaysBetween(k.submittedAt!, k.decidedAt!))
        .sort((a, b) => a - b);
      const median = durations.length
        ? durations[Math.floor(durations.length / 2)]
        : null;
      const breaches = durations.filter((d) => d > 5).length;
      const adjustments = list.flatMap((k) => k.adjustments);
      const deltaSum = list.reduce((a, k) => {
        const d = k.escalations[0] as unknown as { delta?: string } | undefined;
        return a + (d?.delta ? Math.abs(Number(d.delta)) : 0);
      }, 0);

      rows.push({
        approver: list[0].approver?.fullName ?? '—',
        department: list[0].department?.name ?? '—',
        received: list.length,
        decided: decided.length,
        medianDecisionDays: median,
        slaBreachPct: decided.length ? dec(round2(new Decimal(breaches).div(decided.length).mul(100))) : null,
        adjustments: adjustments.length,
        meanDelta: adjustments.length ? dec(round2(new Decimal(deltaSum).div(adjustments.length))) : null,
        escalations: list.filter((k) => k.escalations.length > 0).length,
        returns: list.filter((k) => k.status === 'RETURNED').length,
        rejections: list.filter((k) => k.status === 'REJECTED').length,
      });
    }

    return rows.sort((a, b) => num(b.received as number) - num(a.received as number));
  }

  /** RP-05 — achievement distribution. */
  private async rp05(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const where = this.mergeScopeKpi(user, {
      ...(await this.periodWhere(filters)),
      status: 'APPROVED',
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.measurementType ? { measurementType: filters.measurementType as never } : {}),
    });

    const kpis = await this.prisma.kpi.findMany({
      where,
      select: { achievement: true, measurementType: true, category: { select: { code: true, name: true } } },
      take: 100_000,
    });

    const bands = [
      { code: '<75', test: (v: number) => v < 75 },
      { code: '75-94.99', test: (v: number) => v >= 75 && v < 95 },
      { code: '95-99.99', test: (v: number) => v >= 95 && v < 100 },
      { code: '100-120', test: (v: number) => v >= 100 && v <= 120 },
      { code: '>120', test: (v: number) => v > 120 },
    ];

    const total = kpis.length;
    const out: Record<string, unknown>[] = [];
    for (const band of bands) {
      const matching = kpis.filter((k) => k.achievement !== null && band.test(num(k.achievement)));
      const byCategory = new Map<string, number>();
      matching.forEach((k) => byCategory.set(k.category.name, (byCategory.get(k.category.name) ?? 0) + 1));
      if (byCategory.size === 0) {
        out.push({ band: band.code, category: '—', measurementType: '—', kpiCount: 0, kpiPct: total ? '0.00' : null });
      } else {
        for (const [cat, count] of byCategory) {
          out.push({
            band: band.code,
            category: cat,
            measurementType: matching.find((m) => m.category.name === cat)?.measurementType ?? '—',
            kpiCount: count,
            kpiPct: total ? dec(round2(new Decimal(count).div(total).mul(100))) : null,
          });
        }
      }
    }
    return out;
  }

  /** RP-06 — variable KPI master extract. */
  private async rp06(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const where = this.mergeScopeKpi(user, {
      ...(await this.periodWhere(filters)),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.businessUnitId ? { businessUnitId: filters.businessUnitId } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    });

    const rows = await this.prisma.kpi.findMany({
      where,
      select: this.kpiSelect(),
      orderBy: [{ period: { startDate: 'desc' } }, { employee: { employeeCode: 'asc' } }],
      take: 100_000,
    });

    return rows.map((k) => ({
      kpiCode: k.code,
      employeeCode: k.employee.employeeCode,
      employeeName: k.employee.fullName,
      businessUnit: k.businessUnit?.name ?? k.employee.businessUnit?.name ?? '—',
      department: k.department?.name ?? k.employee.department?.name ?? '—',
      kpi: k.name,
      category: k.category.name,
      type: k.measurementType,
      target: num2(k.target),
      actual: num2(k.actual),
      achievement: num2(k.achievement),
      weight: k.kpiWeight,
      calculatedScore: num2(k.calculatedScore),
      finalScore: num2(k.finalScore),
      weightedScore: num2(k.weightedScore),
      status: k.status,
      approver: k.approver?.fullName ?? 'Super Admin',
      configVersion: k.configVersion?.version ?? null,
      escalated: k.escalations.length ? k.escalations[0].status : 'No',
      period: k.period.label,
    }));
  }

  /** RP-07 — trend over time. */
  private async rp07(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const frequency = filters.frequency ?? 'MONTHLY';
    const periods = await this.prisma.kpiPeriod.findMany({
      where: {
        frequency,
        ...(filters.year ? { year: filters.year } : {}),
      },
      orderBy: { startDate: 'asc' },
      take: 60,
    });

    const out: Record<string, unknown>[] = [];
    for (const period of periods) {
      const where = this.mergeScopeKpi(user, {
        periodId: period.id,
        status: 'APPROVED',
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
        ...(filters.businessUnitId ? { businessUnitId: filters.businessUnitId } : {}),
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      });

      const kpis = await this.prisma.kpi.findMany({
        where,
        select: {
          achievement: true,
          weightedScore: true,
          kpiWeight: true,
          employeeId: true,
          employee: { select: { fullName: true } },
          department: { select: { name: true } },
          businessUnit: { select: { name: true } },
        },
        take: 100_000,
      });

      const entity = filters.entity ?? 'department';
      const groups = new Map<string, typeof kpis>();
      kpis.forEach((k) => {
        const key =
          entity === 'employee'
            ? k.employee.fullName
            : entity === 'business_unit'
              ? (k.businessUnit?.name ?? '—')
              : (k.department?.name ?? '—');
        const list = groups.get(key) ?? [];
        list.push(k);
        groups.set(key, list);
      });

      for (const [key, list] of groups) {
        const total = round2(list.reduce((a, k) => a.plus(new Decimal(k.weightedScore?.toString() ?? 0)), new Decimal(0)));
        const achNum = list.reduce((a, k) => a.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight)), new Decimal(0));
        const wSum = list.reduce((a, k) => a + k.kpiWeight, 0);
        out.push({
          entity: key,
          period: period.label,
          totalKpiScore: dec(total),
          averageAchievement: dec(wSum ? round2(achNum.div(wSum)) : new Decimal(0)),
          kpiCount: list.length,
          change: null,
          periodId: period.id,
        });
      }
    }

    // period-over-period change per entity
    const byEntity = new Map<string, Record<string, unknown>[]>();
    out.forEach((r) => {
      const list = byEntity.get(String(r.entity)) ?? [];
      list.push(r);
      byEntity.set(String(r.entity), list);
    });
    for (const [, list] of byEntity) {
      for (let i = 1; i < list.length; i += 1) {
        const prev = num(list[i - 1].totalKpiScore as string);
        const cur = num(list[i].totalKpiScore as string);
        list[i].change = dec(round2(new Decimal(cur).minus(prev)));
      }
    }

    return out.map(({ periodId: _periodId, ...rest }) => rest);
  }

  /** RP-08 — period close pack. */
  private async rp08(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const period = await this.resolvePeriod(filters);
    if (!period) return [];
    const out: Record<string, unknown>[] = [];

    const snapshots = await this.prisma.performanceSnapshot.findMany({
      where: { periodId: period.id },
      include: {
        employee: { select: { fullName: true, employeeCode: true, department: { select: { name: true } } } },
      },
      orderBy: { totalKpiScore: 'desc' },
    });

    const ragCounts = { GREEN: 0, AMBER: 0, RED: 0 };
    snapshots.forEach((s) => {
      ragCounts[s.rag] += 1;
    });
    out.push(
      { section: 'RAG distribution', rank: 'Green ≥ 95', name: '—', department: '—', value: String(ragCounts.GREEN), secondary: `${snapshots.length} employees` },
      { section: 'RAG distribution', rank: 'Amber 75–94.99', name: '—', department: '—', value: String(ragCounts.AMBER), secondary: '' },
      { section: 'RAG distribution', rank: 'Red < 75', name: '—', department: '—', value: String(ragCounts.RED), secondary: '' },
    );

    snapshots.slice(0, 10).forEach((s, i) => {
      out.push({
        section: 'Top 10 employees',
        rank: String(i + 1),
        name: s.employee.fullName,
        department: s.employee.department?.name ?? '—',
        value: dec(s.totalKpiScore) ?? '0.00',
        secondary: `Avg achievement ${dec(s.averageAchievement) ?? '0.00'}%`,
      });
    });
    snapshots
      .slice(-10)
      .reverse()
      .forEach((s, i) => {
        out.push({
          section: 'Bottom 10 employees',
          rank: String(snapshots.length - i),
          name: s.employee.fullName,
          department: s.employee.department?.name ?? '—',
          value: dec(s.totalKpiScore) ?? '0.00',
          secondary: `Avg achievement ${dec(s.averageAchievement) ?? '0.00'}%`,
        });
      });

    const deptAgg = new Map<string, { total: number; count: number }>();
    snapshots.forEach((s) => {
      const name = s.employee.department?.name ?? '—';
      const agg = deptAgg.get(name) ?? { total: 0, count: 0 };
      agg.total += num(s.totalKpiScore);
      agg.count += 1;
      deptAgg.set(name, agg);
    });
    Array.from(deptAgg.entries())
      .sort((a, b) => b[1].total / b[1].count - a[1].total / a[1].count)
      .forEach(([name, agg], i) => {
        out.push({
          section: 'Department ranking',
          rank: String(i + 1),
          name,
          department: name,
          value: (agg.total / agg.count).toFixed(2),
          secondary: `${agg.count} employees`,
        });
      });

    const exceptionCount = await this.prisma.kpi.count({
      where: { periodId: period.id, status: 'NOT_SUBMITTED' },
    });
    out.push({
      section: 'Exceptions summary',
      rank: 'Not submitted',
      name: '—',
      department: '—',
      value: String(exceptionCount),
      secondary: 'KPIs that scored 0',
    });

    return out;
  }

  /** RP-09 — pending review queue health. */
  private async rp09(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const where = this.mergeScopeKpi(user, {
      ...(await this.periodWhere(filters)),
      status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      ...(filters.approverId ? { approverId: filters.approverId } : {}),
    });

    const rows = await this.prisma.kpi.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        submittedAt: true,
        frequency: true,
        employee: { select: { fullName: true, employeeCode: true, designationTitle: true } },
        approver: { select: { fullName: true } },
        department: { select: { name: true } },
        period: { select: { label: true } },
      },
      orderBy: { submittedAt: 'asc' },
      take: 20_000,
    });

    return rows.map((k) => {
      const age = k.submittedAt ? workingDaysBetween(k.submittedAt, new Date()) : 0;
      return {
        employeeCode: k.employee.employeeCode,
        employeeName: k.employee.fullName,
        designation: k.employee.designationTitle ?? '—',
        kpi: k.name,
        department: k.department?.name ?? '—',
        approver: k.approver?.fullName ?? 'Super Admin',
        submittedAt: k.submittedAt,
        ageDays: age,
        slaStatus: age <= 3 ? 'Within SLA' : age <= 5 ? 'At risk' : 'Breached',
        status: k.status,
        period: k.period.label,
      };
    });
  }

  /** RP-10 — items awaiting a Super Admin. */
  private async rp10(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    const type = filters.type;

    if (!type || type === 'ESCALATION') {
      const escalations = await this.prisma.escalation.findMany({
        where: { status: 'PENDING' },
        include: {
          kpi: {
            select: {
              name: true,
              department: { select: { name: true } },
              employee: { select: { fullName: true } },
              period: { select: { label: true } },
            },
          },
          requestedBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 10_000,
      });
      escalations.forEach((e) =>
        out.push({
          type: 'Escalation',
          employeeName: e.kpi.employee.fullName,
          kpi: e.kpi.name,
          department: e.kpi.department?.name ?? '—',
          calculatedScore: num2(e.calculatedScore),
          proposedScore: num2(e.proposedScore),
          delta: num2(e.delta),
          requester: e.requestedBy.fullName,
          reason: e.reason,
          ageDays: workingDaysBetween(e.createdAt, new Date()),
          period: e.kpi.period.label,
        }),
      );
    }

    if (!type || type === 'CORRECTION') {
      const corrections = await this.prisma.correctionRequest.findMany({
        where: { status: 'PENDING' },
        include: {
          kpi: {
            select: {
              name: true,
              department: { select: { name: true } },
              employee: { select: { fullName: true } },
              calculatedScore: true,
              finalScore: true,
              period: { select: { label: true } },
            },
          },
          requestedBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 10_000,
      });
      corrections.forEach((c) =>
        out.push({
          type: 'Correction',
          employeeName: c.kpi.employee.fullName,
          kpi: c.kpi.name,
          department: c.kpi.department?.name ?? '—',
          calculatedScore: num2(c.kpi.calculatedScore),
          proposedScore: num2(c.kpi.finalScore),
          delta: null,
          requester: c.requestedBy.fullName,
          reason: c.reason,
          ageDays: workingDaysBetween(c.createdAt, new Date()),
          period: c.kpi.period.label,
        }),
      );
    }

    if (!type || type === 'DEPARTMENT_HEAD_KPI') {
      const headKpis = await this.prisma.kpi.findMany({
        where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] }, employee: { roles: { some: { role: { code: 'DEPT_HEAD' } } } } },
        include: {
          employee: { select: { fullName: true } },
          department: { select: { name: true } },
          period: { select: { label: true } },
        },
        orderBy: { submittedAt: 'asc' },
        take: 10_000,
      });
      headKpis.forEach((k) =>
        out.push({
          type: 'Department Head KPI',
          employeeName: k.employee.fullName,
          kpi: k.name,
          department: k.department?.name ?? '—',
          calculatedScore: num2(k.calculatedScore),
          proposedScore: num2(k.finalScore),
          delta: null,
          requester: k.employee.fullName,
          reason: 'Department Head KPI — Super Admin decision (FR-APR-08)',
          ageDays: k.submittedAt ? workingDaysBetween(k.submittedAt, new Date()) : 0,
          period: k.period.label,
        }),
      );
    }

    return out;
  }

  /** RP-11 — exception report. */
  private async rp11(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const periodFilter = await this.periodWhere(filters);
    const scopeWhere = this.scope.kpiScopeWhere(user);
    const base: Prisma.KpiWhereInput = {
      AND: [
        scopeWhere,
        periodFilter,
        filters.departmentId ? { departmentId: filters.departmentId } : {},
        filters.businessUnitId ? { businessUnitId: filters.businessUnitId } : {},
      ],
    };

    const type = filters.exceptionType;
    const rows: Record<string, unknown>[] = [];
    const push = (
      exceptionType: string,
      k: {
        employee?: { fullName: string; employeeCode: string } | null;
        department?: { name: string } | null;
        name: string;
        code: string;
        period?: { label: string } | null;
      },
      detail: string,
      detectedAt: Date,
    ) => {
      rows.push({
        exceptionType,
        employeeCode: k.employee?.employeeCode ?? '—',
        employeeName: k.employee?.fullName ?? '—',
        department: k.department?.name ?? '—',
        kpi: `${k.code} · ${k.name}`,
        detail,
        period: k.period?.label ?? '—',
        detectedAt,
      });
    };

    const include = {
      employee: { select: { fullName: true, employeeCode: true } },
      department: { select: { name: true } },
      period: { select: { label: true } },
    } as const;

    if (!type || type === 'NOT_SUBMITTED' || type === 'ALL') {
      const list = await this.prisma.kpi.findMany({ where: { AND: [base, { status: 'NOT_SUBMITTED' }] }, include, take: 20_000 });
      list.forEach((k) => push('Not submitted', k, 'Deadline passed with no valid submission — scores 0', k.overdueAt ?? k.updatedAt));
    }

    if (!type || type === 'OVERRIDE' || type === 'ALL') {
      const list = await this.prisma.kpi.findMany({
        where: { AND: [base, { overrideScore: { not: null } }] },
        include: { ...include, adjustments: { orderBy: { createdAt: 'asc' }, take: 1 } },
        take: 20_000,
      });
      list.forEach((k) =>
        push('Override', k, `Calculated ${decOrNull(k.calculatedScore)} → Final ${decOrNull(k.finalScore)} (Δ ${decOrNull(k.overrideScore ? new Decimal(k.overrideScore.toString()).minus(new Decimal(k.calculatedScore?.toString() ?? 0)).abs() : null)})`, k.updatedAt),
      );
    }

    if (!type || type === 'ESCALATION' || type === 'ALL') {
      const list = await this.prisma.escalation.findMany({
        where: { kpi: base },
        include: { kpi: { include } },
        take: 20_000,
      });
      list.forEach((e) =>
        push('Escalation', e.kpi, `CS ${decOrNull(e.calculatedScore)} → proposed ${decOrNull(e.proposedScore)} (Δ ${decOrNull(e.delta)}), status ${e.status}`, e.createdAt),
      );
    }

    if (!type || type === 'RETURNED_TWICE' || type === 'ALL') {
      const list = await this.prisma.kpi.findMany({
        where: { AND: [base, { decisions: { some: { action: 'RETURN' } } }] },
        include: { ...include, decisions: { where: { action: 'RETURN' } } },
        take: 20_000,
      });
      list
        .filter((k) => k.decisions.length > 2)
        .forEach((k) => push('Returned more than twice', k, `${k.decisions.length} returns recorded`, k.updatedAt));
    }

    if (!type || type === 'ACH_ABOVE_150' || type === 'ALL') {
      const list = await this.prisma.kpi.findMany({
        where: { AND: [base, { achievement: { gt: 150 } }] },
        include,
        take: 20_000,
      });
      list.forEach((k) => push('ACH > 150%', k, `Achievement ${decOrNull(k.achievement)}% — outlier for review`, k.updatedAt));
    }

    if (!type || type === 'TARGET_CHANGED' || type === 'ALL') {
      const list = await this.prisma.kpiAdjustment.findMany({
        where: { field: 'target', kpi: base },
        include: { kpi: { include } },
        take: 20_000,
      });
      list.forEach((a) =>
        push('Target changed after submission', a.kpi, `Target ${a.oldValue ?? '—'} → ${a.newValue ?? '—'} by reason: ${a.reason}`, a.createdAt),
      );
    }

    if (!type || type === 'EXTENSION' || type === 'ALL') {
      const list = await this.prisma.kpiExtension.findMany({
        where: { kpi: base },
        include: { kpi: { include } },
        take: 20_000,
      });
      list.forEach((e) => push('Extension granted', e.kpi, `${e.days} day(s) until ${e.until.toISOString().slice(0, 10)} — ${e.reason}`, e.createdAt));
    }

    return rows.sort((a, b) => new Date(b.detectedAt as Date).getTime() - new Date(a.detectedAt as Date).getTime());
  }

  /** RP-12 — historical performance from snapshots. */
  private async rp12(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const where: Prisma.PerformanceSnapshotWhereInput = {
      ...(filters.yearFrom ? { period: { year: { gte: filters.yearFrom } } } : {}),
      ...(filters.yearTo ? { period: { year: { lte: filters.yearTo } } } : {}),
      ...(filters.frequency ? { frequency: filters.frequency } : {}),
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      employee: this.scope.userScopeWhere(user) as Prisma.UserWhereInput,
    };

    const snapshots = await this.prisma.performanceSnapshot.findMany({
      where,
      include: {
        employee: { select: { fullName: true, employeeCode: true } },
        period: { select: { label: true } },
      },
      orderBy: [{ employee: { employeeCode: 'asc' } }, { period: { startDate: 'desc' } }],
      take: 50_000,
    });

    const versionCounts = new Map<string, number>();
    const empIds = Array.from(new Set(snapshots.map((s) => s.employeeId)));
    if (empIds.length) {
      const grouped = await this.prisma.kpiVersion.groupBy({
        by: ['kpiId'],
        _count: { _all: true },
      });
      const kpiToEmployee = await this.prisma.kpi.findMany({
        where: { employeeId: { in: empIds } },
        select: { id: true, employeeId: true },
      });
      const kpiMap = new Map(kpiToEmployee.map((k) => [k.id, k.employeeId]));
      grouped.forEach((g) => {
        const emp = kpiMap.get(g.kpiId);
        if (!emp) return;
        versionCounts.set(emp, (versionCounts.get(emp) ?? 0) + g._count._all);
      });
    }

    return snapshots.map((s) => ({
      employeeCode: s.employee.employeeCode,
      employeeName: s.employee.fullName,
      period: s.period.label,
      totalKpiScore: num2(s.totalKpiScore),
      averageAchievement: num2(s.averageAchievement),
      rank: s.rank,
      versionCount: versionCounts.get(s.employeeId) ?? 0,
      rag: s.rag,
    }));
  }

  /** RP-13 — one-page executive pack. */
  private async rp13(user: AuthUser, filters: ReportFilters): Promise<Record<string, unknown>[]> {
    const period = await this.resolvePeriod(filters);
    const out: Record<string, unknown>[] = [];
    if (!period) return out;

    const scopeWhere = this.scope.kpiScopeWhere(user);
    const kpis = await this.prisma.kpi.findMany({
      where: { AND: [scopeWhere, { periodId: period.id }, { status: { notIn: ['DELETED'] } }] },
      select: {
        status: true,
        achievement: true,
        weightedScore: true,
        kpiWeight: true,
        employeeId: true,
        departmentId: true,
        businessUnitId: true,
        submittedAt: true,
        decidedAt: true,
      },
      take: 100_000,
    });

    const approved = kpis.filter((k) => k.status === 'APPROVED');
    const groupTotal = approved.reduce((a, k) => a.plus(new Decimal(k.weightedScore?.toString() ?? 0)), new Decimal(0));
    const achNum = approved.reduce((a, k) => a.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight)), new Decimal(0));
    const wSum = approved.reduce((a, k) => a + k.kpiWeight, 0);

    const employees = new Set(kpis.map((k) => k.employeeId));
    const scoredEmployees = new Set(approved.map((k) => k.employeeId));

    out.push({ section: 'Group overview', metric: 'Period', value: period.label });
    out.push({ section: 'Group overview', metric: 'Active participant employees', value: String(employees.size) });
    out.push({
      section: 'Group overview',
      metric: 'Participation',
      value: employees.size ? `${((scoredEmployees.size / employees.size) * 100).toFixed(2)}%` : '0.00%',
    });
    out.push({ section: 'Group overview', metric: 'Group average achievement', value: `${wSum ? dec(round2(achNum.div(wSum))) : '0.00'}%` });
    out.push({ section: 'Group overview', metric: 'Group average total score', value: scoredEmployees.size ? dec(round2(groupTotal.div(scoredEmployees.size))) ?? '0.00' : '0.00' });

    const decided = kpis.filter((k) => k.submittedAt && k.decidedAt);
    const breaches = decided.filter((k) => workingDaysBetween(k.submittedAt!, k.decidedAt!) > 5).length;
    out.push({
      section: 'SLA compliance',
      metric: 'Median decision time',
      value: (() => {
        const d = decided.map((k) => workingDaysBetween(k.submittedAt!, k.decidedAt!)).sort((a, b) => a - b);
        return d.length ? `${d[Math.floor(d.length / 2)]} working days` : 'n/a';
      })(),
    });
    out.push({ section: 'SLA compliance', metric: 'SLA breaches (> 5 working days)', value: `${breaches} (${decided.length ? ((breaches / decided.length) * 100).toFixed(2) : '0.00'}%)` });
    out.push({ section: 'SLA compliance', metric: 'Pending evaluations', value: String(kpis.filter((k) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(k.status)).length) });

    const escalationCount = await this.prisma.escalation.count({ where: { status: 'PENDING' } });
    const pendingCorrections = await this.prisma.correctionRequest.count({ where: { status: 'PENDING' } });
    out.push({ section: 'Key exceptions', metric: 'Open escalations', value: String(escalationCount) });
    out.push({ section: 'Key exceptions', metric: 'Pending correction requests', value: String(pendingCorrections) });
    out.push({ section: 'Key exceptions', metric: 'Not submitted', value: String(kpis.filter((k) => k.status === 'NOT_SUBMITTED').length) });
    out.push({
      section: 'Key exceptions',
      metric: 'ACH > 150% (outliers)',
      value: String(approved.filter((k) => num(k.achievement) > 150).length),
    });

    // BU comparison
    const bus = await this.prisma.businessUnit.findMany({ select: { id: true, name: true } });
    for (const bu of bus) {
      const list = approved.filter((k) => k.businessUnitId === bu.id);
      if (!list.length) continue;
      const t = list.reduce((a, k) => a.plus(new Decimal(k.weightedScore?.toString() ?? 0)), new Decimal(0));
      const n = list.reduce((a, k) => a.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight)), new Decimal(0));
      const w = list.reduce((a, k) => a + k.kpiWeight, 0);
      out.push({
        section: 'Business Unit comparison',
        metric: bu.name,
        value: `Avg achievement ${w ? dec(round2(n.div(w))) : '0.00'}% · Avg score ${dec(round2(t.div(new Set(list.map((k) => k.employeeId)).size)))}`,
      });
    }

    const depts = await this.prisma.department.findMany({ select: { id: true, name: true } });
    for (const d of depts) {
      const list = approved.filter((k) => k.departmentId === d.id);
      if (!list.length) continue;
      const w = list.reduce((a, k) => a + k.kpiWeight, 0);
      const n = list.reduce((a, k) => a.plus(new Decimal(k.achievement?.toString() ?? 0).mul(k.kpiWeight)), new Decimal(0));
      out.push({
        section: 'Department heat table',
        metric: d.name,
        value: `Avg achievement ${w ? dec(round2(n.div(w))) : '0.00'}% · Below target ${list.filter((k) => num(k.achievement) < 100).length}`,
      });
    }

    return out;
  }

  // -------------------------------------------------------------------- helpers

  private async resolvePeriod(filters: ReportFilters) {
    if (filters.periodId) {
      return this.prisma.kpiPeriod.findUnique({ where: { id: filters.periodId } });
    }
    if (filters.periodCode) {
      return this.prisma.kpiPeriod.findUnique({ where: { code: filters.periodCode } });
    }
    const where: Prisma.KpiPeriodWhereInput = {};
    if (filters.frequency) where.frequency = filters.frequency;
    if (filters.year) where.year = filters.year;
    return this.prisma.kpiPeriod.findFirst({
      where,
      orderBy: { startDate: 'desc' },
    });
  }

  private totalsFor(code: string, rows: Record<string, unknown>[]): Record<string, unknown> | undefined {
    const sum = (key: string): string =>
      dec(rows.reduce((a, r) => a.plus(new Decimal(String(r[key] ?? 0) || '0')), new Decimal(0))) ?? '0.00';
    switch (code) {
      case 'RP-01':
      case 'RP-06':
        return {
          rows: rows.length,
          weightedScore: sum('weightedScore'),
        };
      case 'RP-02':
        return {
          rows: rows.length,
          averageTotalScore: rows.length ? (num(sum('totalKpiScore')) / rows.length).toFixed(2) : '0.00',
        };
      case 'RP-03':
        return {
          departments: rows.length,
          averageAchievement: rows.length ? (num(sum('averageAchievement')) / rows.length).toFixed(2) : '0.00',
          approved: sum('approved'),
          pending: sum('pending'),
        };
      case 'RP-04':
        return {
          approvers: rows.length,
          received: sum('received'),
          decided: sum('decided'),
          escalations: sum('escalations'),
        };
      case 'RP-05':
        return { buckets: rows.length, kpis: sum('kpiCount') };
      case 'RP-09':
        return {
          pending: rows.length,
          breached: rows.filter((r) => r.slaStatus === 'Breached').length,
        };
      case 'RP-10':
        return { pending: rows.length };
      case 'RP-11':
        return { exceptions: rows.length };
      case 'RP-12':
        return { rows: rows.length };
      default:
        return { rows: rows.length };
    }
  }

  /** Label helper used by the PDF/XLSX footer (AC-19). */
  footerText(result: ReportResult, format: string): string {
    const filters = Object.entries(result.meta.filters)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return [
      `${result.code} · ${result.name} · ${format}`,
      `Filters: ${filters || 'none'}`,
      `Generated by ${result.meta.generatedBy.name} (${result.meta.generatedBy.email}) at ${result.meta.generatedAt}`,
      `Rows: ${result.meta.rowCount}`,
      'Anwar Group of Industries · Internal & Confidential',
    ].join('  |  ');
  }
}
