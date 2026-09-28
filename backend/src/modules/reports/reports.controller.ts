import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ReportsService, ReportFilters } from './reports.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../../queue/queue.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AnyPermission, CurrentUser, Permissions, RequestMeta } from '../../common/decorators';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { AUDIT_ACTIONS, MAX_EXPORT_ROWS_SYNC, PERM, REPORT_ACCESS } from '../../common/constants';
import { Forbidden, Unprocessable, ErrorCode } from '../../common/errors/error-codes';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly scope: ScopeService,
  ) {}

  /** FR-RPT-01 — the catalogue visible to the caller's role (§5.2 / §14). */
  @Get()
  @AnyPermission(PERM.REPORT_VIEW)
  catalogue(@CurrentUser() user: AuthUser) {
    return this.reports.definitions
      .filter((d) => (REPORT_ACCESS[d.code] ?? []).some((r) => user.roles.includes(r)))
      .map((d) => ({
        code: d.code,
        name: d.name,
        purpose: d.purpose,
        audience: d.audience,
        extraFilters: d.extraFilters,
        columnCount: d.columns.length,
      }));
  }

  @Get('meta/filters')
  @AnyPermission(PERM.REPORT_VIEW)
  async filters(@CurrentUser() user: AuthUser) {
    const [businessUnits, departments, periods, categories, approvers] = await Promise.all([
      this.prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.department.findMany({
        where: {
          isActive: true,
          ...(this.scope.departmentFilter(user) ? { id: { in: this.scope.departmentFilter(user)! } } : {}),
        },
        select: { id: true, name: true, businessUnitId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.kpiPeriod.findMany({
        select: { id: true, code: true, label: true, frequency: true, status: true },
        orderBy: { startDate: 'desc' },
        take: 60,
      }),
      this.prisma.kpiCategory.findMany({ select: { id: true, code: true, name: true } }),
      this.prisma.user.findMany({
        where: { status: 'ACTIVE', roles: { some: { role: { code: 'DEPT_HEAD' } } } },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
    ]);
    return { businessUnits, departments, periods, categories, approvers };
  }

  /** FR-RPT-01 — paged preview; the export footer shows filters, generator and time. */
  @Get(':code')
  @AnyPermission(PERM.REPORT_VIEW)
  async preview(
    @Param('code') code: string,
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string>,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    const filters = this.parseFilters(query);
    const page = Math.max(1, Number(query.page ?? 1));
    const size = Math.min(100, Number(query.size ?? 25));

    const result = await this.reports.run(user, code, filters, page, size);

    await this.audit.record({
      action: AUDIT_ACTIONS.REPORT_VIEW,
      entityType: 'report',
      entityId: code,
      actor: user,
      after: { filters, rowCount: result.meta.rowCount },
      meta,
    });

    return result;
  }

  /** FR-RPT-01 / FR-RPT-02 — synchronous CSV (and small XLSX/PDF pick-up), async above 10,000 rows. */
  @Post(':code/export')
  @HttpCode(HttpStatus.OK)
  @AnyPermission(PERM.REPORT_VIEW)
  async export(
    @Param('code') code: string,
    @Body() body: { format?: 'XLSX' | 'CSV' | 'PDF'; filters?: ReportFilters },
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    const format = body.format ?? 'XLSX';
    const filters = body.filters ?? {};

    const definition = this.reports.getDefinition(code);
    this.reports.assertAccess(user, definition.code);

    const result = await this.reports.runFull(user, code, filters);

    // FR-RPT-02 — large exports run asynchronously and deliver a link by notification
    if (result.meta.rowCount > MAX_EXPORT_ROWS_SYNC) {
      const job = await this.prisma.exportJob.create({
        data: {
          userId: user.id,
          reportCode: definition.code,
          format,
          filters: filters as unknown as never,
          status: 'QUEUED',
        },
      });
      await this.queue.enqueueExport({ exportJobId: job.id });
      await this.audit.record({
        action: AUDIT_ACTIONS.REPORT_EXPORT,
        entityType: 'export_job',
        entityId: job.id,
        actor: user,
        after: { reportCode: definition.code, format, rowCount: result.meta.rowCount, async: true },
        meta,
      });
      return {
        async: true,
        exportJobId: job.id,
        message: `This export has ${result.meta.rowCount.toLocaleString()} rows and is being generated. You will receive a notification with the download link (valid 24 hours).`,
      };
    }

    await this.audit.record({
      action: AUDIT_ACTIONS.REPORT_EXPORT,
      entityType: 'report',
      entityId: definition.code,
      actor: user,
      after: { format, rowCount: result.meta.rowCount, filters },
      meta,
    });

    return {
      async: false,
      code: definition.code,
      format,
      rowCount: result.meta.rowCount,
      columns: result.columns,
      rows: result.rows,
      totals: result.totals,
      footer: this.reports.footerText(result, format),
      meta: result.meta,
    };
  }

  /** FR-KPI-10 — the KPI detail report with the calculation path and evidence hashes. */
  @Get(':code/download/:jobId')
  @AnyPermission(PERM.REPORT_VIEW)
  async download(
    @Param('code') code: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const job = await this.prisma.exportJob.findUnique({ where: { id: jobId } });
    if (!job || job.userId !== user.id) throw Forbidden('FORBIDDEN', 'This export is not available to you.');
    if (job.status !== 'COMPLETED' || !job.filePath) {
      throw Unprocessable(ErrorCode.CONFLICT, 'This export is not ready yet.');
    }
    if (job.expiresAt && job.expiresAt < new Date()) {
      throw Unprocessable(ErrorCode.CONFLICT, 'This download link has expired. Request a new export.');
    }
    void code;
    res.download(job.filePath, job.fileName ?? 'export.xlsx');
  }

  /** Export history for the Reports screen. */
  @Get('meta/exports/mine')
  @AnyPermission(PERM.REPORT_VIEW)
  async myExports(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.exportJob.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return rows.map((r) => ({
      id: r.id,
      reportCode: r.reportCode,
      format: r.format,
      status: r.status,
      rowCount: r.rowCount,
      error: r.error,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      downloadUrl: r.status === 'COMPLETED' ? `/api/v1/reports/${r.reportCode}/download/${r.id}` : null,
    }));
  }

  private parseFilters(query: Record<string, string>): ReportFilters {
    return {
      businessUnitId: query.businessUnitId,
      departmentId: query.departmentId,
      frequency: query.frequency as ReportFilters['frequency'],
      periodId: query.periodId,
      periodCode: query.periodCode,
      year: query.year ? Number(query.year) : undefined,
      yearFrom: query.yearFrom ? Number(query.yearFrom) : undefined,
      yearTo: query.yearTo ? Number(query.yearTo) : undefined,
      employeeId: query.employeeId,
      status: query.status,
      categoryId: query.categoryId,
      measurementType: query.measurementType,
      rag: query.rag,
      approverId: query.approverId,
      exceptionType: query.exceptionType,
      type: query.type,
      entity: query.entity as ReportFilters['entity'],
      entityId: query.entityId,
      approver: query.approver,
      age: query.age ? Number(query.age) : undefined,
    };
  }
}
