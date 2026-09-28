import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuditService } from './audit.service';
import { AnyPermission, CurrentUser, Permissions, RequestMeta } from '../../common/decorators';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { PERM } from '../../common/constants';
import { Forbidden } from '../../common/errors/error-codes';
import { ScopeService } from '../../common/scope/scope.service';

/**
 * Audit log viewer — FR-AUD-04 and §18 access rules.
 *   Super Admin  → everything
 *   HR Admin     → read-only (no system-setting events)
 *   Dept Head    → read-only for KPIs in their department
 *   Employee     → own records, but through the KPI history views (not here)
 *   Sys Admin    → technical/security logs only (break-glass is audited)
 */
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  @AnyPermission(PERM.AUDIT_VIEW, PERM.AUDIT_VIEW_ALL, PERM.AUDIT_TECHNICAL)
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string>,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    const page = Math.max(1, Number(query.page ?? 1));
    const size = Math.min(100, Math.max(1, Number(query.size ?? 25)));

    const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
    const isHr = user.roles.includes('HR_ADMIN');
    const isSysAdmin = user.roles.includes('SYS_ADMIN');
    const isDeptHead = user.roles.includes('DEPT_HEAD');

    if (isSysAdmin && !isSuperAdmin && !isHr && !isDeptHead) {
      // Technical logs only — never KPI content (§5.2)
      const technicalOnly = [
        'auth.',
        'security.',
        'user.role',
        'configuration.',
        'period.open',
      ];
      const result = await this.audit.list({
        page,
        size,
        action: query.action,
        entityType: query.entityType,
        from: query.from,
        to: query.to,
      });
      return {
        ...result,
        items: result.items.filter((i) => technicalOnly.some((t) => i.action.startsWith(t))),
        notice: 'System Administrator view: technical and security events only.',
      };
    }

    if (!isSuperAdmin && !isHr && !isDeptHead) {
      throw Forbidden('FORBIDDEN', 'Your role does not permit the audit log');
    }

    const scopeDepartmentIds = isSuperAdmin || isHr ? null : this.scope.departmentFilter(user);

    const result = await this.audit.list({
      page,
      size,
      actorId: query.actorId,
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      from: query.from,
      to: query.to,
      scopeDepartmentIds: isHr && !isSuperAdmin ? this.scope.departmentFilter(user) : scopeDepartmentIds,
    });

    await this.audit.record({
      action: 'audit.view',
      entityType: 'audit_log',
      actor: user,
      after: { page, size, filters: query },
      meta,
    });

    return result;
  }

  @Get('verify')
  @Permissions(PERM.AUDIT_VIEW_ALL)
  async verify(@CurrentUser() user: AuthUser, @RequestMeta() meta: RequestContextMeta) {
    const result = await this.audit.verifyChain();
    await this.audit.record({
      action: 'audit.verify',
      entityType: 'audit_log',
      actor: user,
      after: { ok: result.ok, checked: result.checked },
      meta,
    });
    return result;
  }

  @Get('entity-types')
  @AnyPermission(PERM.AUDIT_VIEW, PERM.AUDIT_VIEW_ALL, PERM.AUDIT_TECHNICAL)
  entityTypes() {
    return [
      'user',
      'session',
      'invitation',
      'business_unit',
      'department',
      'kpi',
      'kpi_version',
      'kpi_evidence',
      'kpi_period',
      'kpi_decision',
      'kpi_adjustment',
      'escalation',
      'correction_request',
      'kpi_template',
      'kpi_assignment',
      'configuration_version',
      'report',
      'export_job',
      'audit_log',
      'calculation_log',
    ];
  }

  @Get('export')
  @Permissions(PERM.AUDIT_VIEW_ALL)
  async export(
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string>,
    @Res() res: Response,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    const result = await this.audit.list({
      page: 1,
      size: 10_000,
      actorId: query.actorId,
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      from: query.from,
      to: query.to,
    });

    await this.audit.record({
      action: 'audit.view',
      entityType: 'audit_log',
      actor: user,
      after: { export: true, rows: result.items.length },
      meta,
    });

    const header = [
      'Timestamp',
      'Actor',
      'Actor Role',
      'Action',
      'Entity Type',
      'Entity ID',
      'Reason',
      'IP',
      'Previous Hash',
      'Record Hash',
    ].join(',');

    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = result.items.map((row) =>
      [
        row.createdAt.toISOString(),
        row.actor?.fullName ?? row.actorRole ?? 'system',
        row.actorRole ?? '',
        row.action,
        row.entityType,
        row.entityId ?? '',
        row.reason ?? '',
        row.ipAddress ?? '',
        row.previousHash ?? '',
        row.recordHash,
      ]
        .map(esc)
        .join(','),
    );

    const csv = `${header}\n${lines.join('\n')}\n\nAudit export · generated by ${user.email} at ${new Date().toISOString()} · Internal & Confidential\n`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.csv"`);
    res.send(csv);
  }
}
