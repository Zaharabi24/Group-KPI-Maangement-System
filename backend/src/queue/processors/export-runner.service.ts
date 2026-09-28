import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../modules/audit/audit.service';
import { ReportsService, ReportResult } from '../../modules/reports/reports.service';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SCOPE_REBUILD } from '../../common/utils/scope-rebuild.util';
import { EXPORT_LINK_TTL_HOURS } from '../../common/constants';

@Injectable()
export class ExportRunnerService {
  private readonly logger = new Logger(ExportRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  private storageDir(): string {
    const dir = resolve(process.env.EXPORT_LOCAL_PATH || './storage/exports');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  async run(exportJobId: string): Promise<{ filePath: string; rowCount: number }> {
    const job = await this.prisma.exportJob.findUnique({
      where: { id: exportJobId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            employeeCode: true,
            businessUnitId: true,
            departmentId: true,
            roles: { select: { role: { select: { code: true } } } },
            scopes: {
              select: {
                roleId: true,
                departmentId: true,
                businessUnitId: true,
                role: { select: { code: true } },
              },
            },
          },
        },
      },
    });
    if (!job) throw new Error(`Export job ${exportJobId} not found`);

    await this.prisma.exportJob.update({
      where: { id: exportJobId },
      data: { status: 'PROCESSING' },
    });

    try {
      const authUser = SCOPE_REBUILD(job.user);
      const result = await this.reports.runFull(authUser, job.reportCode, (job.filters ?? {}) as Record<string, string>);

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const base = `${job.reportCode}_${stamp}_${job.id.slice(0, 8)}`;
      let fileName: string;
      let filePath: string;

      if (job.format === 'CSV') {
        fileName = `${base}.csv`;
        filePath = join(this.storageDir(), fileName);
        await writeFile(filePath, this.buildCsv(result), 'utf8');
      } else if (job.format === 'XLSX') {
        fileName = `${base}.xlsx`;
        filePath = join(this.storageDir(), fileName);
        await this.buildXlsx(result, filePath);
      } else {
        fileName = `${base}.pdf`;
        filePath = join(this.storageDir(), fileName);
        await this.buildPdf(result, filePath);
      }

      await this.prisma.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: 'COMPLETED',
          filePath,
          fileName,
          rowCount: result.meta.rowCount,
          expiresAt: new Date(Date.now() + EXPORT_LINK_TTL_HOURS * 3600 * 1000),
        },
      });

      await this.audit.record({
        action: 'report.export',
        entityType: 'export_job',
        entityId: exportJobId,
        actor: { id: job.userId, roles: job.user.roles.map((r) => r.role.code) as never },
        after: { reportCode: job.reportCode, format: job.format, rowCount: result.meta.rowCount, async: true },
      });

      this.logger.log(`Export ${job.reportCode} (${job.format}) written: ${fileName} rows=${result.meta.rowCount}`);
      return { filePath, rowCount: result.meta.rowCount };
    } catch (e) {
      await this.prisma.exportJob.update({
        where: { id: exportJobId },
        data: { status: 'FAILED', error: (e as Error).message.slice(0, 990) },
      });
      throw e;
    }
  }

  // ---------------------------------------------------------------- formatters

  buildCsv(result: ReportResult): string {
    const escape = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = result.columns.map((c) => escape(c.label)).join(',');
    const lines = result.rows.map((r) => result.columns.map((c) => escape(r[c.key])).join(','));
    const totals = result.totals
      ? `\n${result.columns.map((c) => escape(result.totals?.[c.key] ?? (c.key === result.columns[0].key ? 'TOTAL' : ''))).join(',')}`
      : '';
    return `${header}\n${lines.join('\n')}${totals}\n\n${this.reports.footerText(result, 'CSV')}\n`;
  }

  async buildXlsx(result: ReportResult, filePath: string): Promise<void> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ANWAR KPIFlow';
    wb.created = new Date();
    const ws = wb.addWorksheet(result.code, {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { defaultRowHeight: 18 },
    });

    ws.columns = result.columns.map((c) => ({
      header: c.label,
      key: c.key,
      width: c.width ?? Math.max(14, Math.min(38, c.label.length + 6)),
    }));

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 24;

    result.rows.forEach((row) => {
      const r = ws.addRow(row);
      result.columns.forEach((c, idx) => {
        const cell = r.getCell(idx + 1);
        const value = row[c.key];
        if (c.type === 'money' || c.type === 'decimal' || c.type === 'percent') {
          const n = value === null || value === undefined || value === '' ? null : Number(value);
          cell.value = n === null || Number.isNaN(n) ? (value as string | null) : n;
          cell.numFmt = c.type === 'percent' ? '0.00"%"' : '#,##0.00';
        } else if (c.type === 'integer' || c.type === 'number') {
          const n = Number(value);
          cell.value = Number.isNaN(n) ? (value as string | null) : n;
        } else if (c.type === 'date' || c.type === 'datetime') {
          cell.value = value ? new Date(String(value)) : null;
          cell.numFmt = c.type === 'date' ? 'dd mmm yyyy' : 'dd mmm yyyy hh:mm';
        } else {
          cell.value = value === null || value === undefined ? '—' : String(value);
        }
        if (c.align) cell.alignment = { horizontal: c.align, vertical: 'middle' };
      });
    });

    if (result.totals) {
      const tr = ws.addRow({ ...result.totals, [result.columns[0].key]: 'TOTAL' });
      tr.font = { bold: true };
      tr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } };
    }

    const footerRow = ws.addRow([]);
    const noteRow = ws.addRow([this.reports.footerText(result, 'XLSX')]);
    noteRow.font = { italic: true, size: 9, color: { argb: 'FF5B6770' } };
    ws.mergeCells(noteRow.number, 1, noteRow.number, Math.max(1, result.columns.length));
    void footerRow;

    await wb.xlsx.writeFile(filePath);
  }

  async buildPdf(result: ReportResult, filePath: string): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: result.columns.length > 6 ? 'landscape' : 'portrait', margin: 32 });
      const stream = createWriteStream(filePath);
      doc.pipe(stream);

      // Header
      doc.rect(0, 0, doc.page.width, 58).fill('#0B2545');
      doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold').text('ANWAR KPI', 32, 16);
      doc.fontSize(10).font('Helvetica').fillColor('#C9D6E4').text(`${result.code} · ${result.name}`, 32, 36);

      doc.fillColor('#1A1A1A').fontSize(9).font('Helvetica');
      const filterLine = Object.entries(result.meta.filters)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      doc.text(`Filters: ${filterLine || 'none'}`, 32, 72);
      doc.text(
        `Generated by ${result.meta.generatedBy.name} (${result.meta.generatedBy.email}) · ${new Date(result.meta.generatedAt).toISOString()}`,
        32,
        doc.y + 2,
      );

      // Table
      const startY = doc.y + 10;
      const pageWidth = doc.page.width - 64;
      const colWidth = pageWidth / result.columns.length;
      const rowHeight = 16;

      const drawHeader = (y: number) => {
        doc.rect(32, y, pageWidth, rowHeight).fill('#F5F7FA');
        doc.fillColor('#0B2545').font('Helvetica-Bold').fontSize(7.5);
        result.columns.forEach((c, i) => {
          doc.text(c.label, 34 + i * colWidth, y + 4, { width: colWidth - 4, ellipsis: true });
        });
        doc.moveTo(32, y + rowHeight).lineTo(32 + pageWidth, y + rowHeight).strokeColor('#D9E1EA').stroke();
        return y + rowHeight;
      };

      let y = drawHeader(startY);
      doc.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A');

      for (const row of result.rows) {
        if (y + rowHeight > doc.page.height - 60) {
          doc.addPage();
          y = drawHeader(32);
          doc.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A');
        }
        result.columns.forEach((c, i) => {
          const value = row[c.key];
          const text = value === null || value === undefined ? '—' : String(value);
          doc.text(text, 34 + i * colWidth, y + 4, { width: colWidth - 4, ellipsis: true });
        });
        doc.moveTo(32, y + rowHeight).lineTo(32 + pageWidth, y + rowHeight).strokeColor('#E6ECF2').stroke();
        y += rowHeight;
      }

      if (result.totals) {
        doc.rect(32, y, pageWidth, rowHeight).fill('#F5F7FA');
        doc.fillColor('#0B2545').font('Helvetica-Bold');
        result.columns.forEach((c, i) => {
          const text = c.key === result.columns[0].key ? 'TOTAL' : result.totals?.[c.key] !== undefined ? String(result.totals[c.key]) : '';
          doc.text(text, 34 + i * colWidth, y + 4, { width: colWidth - 4, ellipsis: true });
        });
        y += rowHeight;
      }

      // Footer
      doc.font('Helvetica').fontSize(7.5).fillColor('#5B6770');
      doc.text(this.reports.footerText(result, 'PDF'), 32, Math.min(y + 12, doc.page.height - 48), {
        width: pageWidth,
        align: 'left',
      });

      doc.end();
      stream.on('finish', () => resolvePromise());
      stream.on('error', reject);
    });
  }
}
