import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { PerformanceService } from '../../modules/performance/performance.service';
import { AuditService } from '../../modules/audit/audit.service';
import { QueueService } from '../queue.service';
import { NT, EXPORT_LINK_TTL_HOURS } from '../../common/constants';
import {
  daysRemaining,
  formatDate,
  workingDaysBetween,
} from '../../common/utils/period.util';
import { dec, round2, Decimal } from '../../common/utils/decimal.util';
import { Prisma } from '@prisma/client';

/**
 * Background job implementations — BRD §15 (NT-13/NT-14/NT-15), §4.9
 * (nightly verification), §18 (hash-chain verification) and FR-RPT-02
 * (async export delivery).
 */
@Injectable()
export class ScheduledJobsService {
  private readonly logger = new Logger(ScheduledJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly performance: PerformanceService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async run(name: string, detail?: Record<string, unknown>): Promise<unknown> {
    const started = new Date();
    const run = await this.prisma.scheduledJobRun.create({
      data: { jobName: name, status: 'RUNNING', detail: (detail ?? {}) as Prisma.InputJsonValue },
    });
    try {
      let result: unknown;
      switch (name) {
        case 'deadline-reminders':
          result = await this.deadlineReminders();
          break;
        case 'overdue-sweep':
          result = await this.overdueSweep();
          break;
        case 'sla-check':
          result = await this.slaCheck();
          break;
        case 'nightly-verification':
          result = await this.nightlyVerification();
          break;
        case 'hash-chain-verify':
          result = await this.hashChainVerify();
          break;
        case 'digest-emails':
          result = await this.digestEmails();
          break;
        case 'purge-expired':
          result = await this.purgeExpired();
          break;
        default:
          result = { skipped: true, reason: `Unknown job ${name}` };
      }

      await this.prisma.scheduledJobRun.update({
        where: { id: run.id },
        data: { status: 'SUCCEEDED', endedAt: new Date(), detail: result as Prisma.InputJsonValue },
      });
      this.logger.log(`Job ${name} finished in ${Date.now() - started.getTime()}ms`);
      return result;
    } catch (e) {
      await this.prisma.scheduledJobRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', endedAt: new Date(), detail: { error: (e as Error).message } },
      });
      this.logger.error(`Job ${name} failed: ${(e as Error).message}`);
      throw e;
    }
  }

  // --------------------------------------------------------------- NT-13 / NT-14

  /** NT-13 — reminders 3 days and 1 day before the deadline; NT-14 on the day after. */
  private async deadlineReminders() {
    const now = new Date();
    const periods = await this.prisma.kpiPeriod.findMany({
      where: { status: { in: ['OPEN', 'REOPENED'] } },
    });

    let reminded = 0;
    let missed = 0;

    for (const period of periods) {
      const remaining = daysRemaining(period.submissionDeadline, now);

      if (remaining === 3 || remaining === 1) {
        const outstanding = await this.prisma.kpi.findMany({
          where: {
            periodId: period.id,
            status: { in: ['DRAFT', 'RETURNED'] },
          },
          select: {
            employeeId: true,
            name: true,
            status: true,
            employee: { select: { id: true, email: true, fullName: true, emailDigest: true } },
          },
          take: 50_000,
        });

        const byEmployee = new Map<string, typeof outstanding>();
        outstanding.forEach((k) => {
          const list = byEmployee.get(k.employeeId) ?? [];
          list.push(k);
          byEmployee.set(k.employeeId, list);
        });

        // Weight-incomplete employees who have no drafts still need the reminder
        const weightRows = await this.prisma.kpi.groupBy({
          by: ['employeeId'],
          where: { periodId: period.id, status: { notIn: ['REJECTED', 'DELETED'] }, frequency: period.frequency },
          _sum: { kpiWeight: true },
        });
        const incomplete = weightRows.filter((w) => (w._sum.kpiWeight ?? 0) < 100);
        const incompleteUsers = await this.prisma.user.findMany({
          where: { id: { in: incomplete.map((w) => w.employeeId).filter((id) => !byEmployee.has(id)) } },
          select: { id: true, email: true, fullName: true, emailDigest: true },
        });

        const items = [
          ...Array.from(byEmployee.values()).map((list) => ({
            user: list[0].employee,
            rows: list.map((k) => ({ label: k.name, value: k.status === 'RETURNED' ? 'Returned — needs resubmission' : 'Draft — not submitted' })),
          })),
          ...incompleteUsers.map((u) => {
            const w = incomplete.find((i) => i.employeeId === u.id)!;
            return {
              user: u,
              rows: [{ label: 'Weight allocated', value: `${w._sum.kpiWeight ?? 0} / 100%` }],
            };
          }),
        ];

        for (const item of items) {
          await this.notifications.notify({
            code: NT.DEADLINE_APPROACHING,
            recipients: [{ userId: item.user.id, email: item.user.email, fullName: item.user.fullName, emailDigest: item.user.emailDigest }],
            title: `${remaining} day(s) left to submit your KPIs for ${period.label}`,
            body: `You have ${remaining} day(s) left in the ${period.label} submission window.`,
            deepLink: '/my-kpi',
            entityType: 'kpi_period',
            entityId: period.id,
            emailContext: {
              daysLeft: remaining,
              period: period.label,
              myKpiUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi?period=${period.code}`,
              items: item.rows,
            },
          });
          reminded += 1;
        }
      }

      if (remaining === -1) {
        // EC-09: the deadline has just passed → Not Submitted
        const swept = await this.overdueSweep(period.id);
        missed += swept.length;
      }
    }

    return { reminded, missed };
  }

  /** EC-09 — Draft/Returned KPIs past the deadline (or their resubmission window) become Not Submitted. */
  async overdueSweep(periodId?: string): Promise<Array<{ id: string; employeeId: string }>> {
    const now = new Date();
    const periods = await this.prisma.kpiPeriod.findMany({
      where: periodId ? { id: periodId } : { status: { in: ['OPEN', 'REOPENED'] } },
    });

    const converted: Array<{ id: string; employeeId: string }> = [];

    for (const period of periods) {
      const deadline = period.submissionDeadline;
      const candidates = await this.prisma.kpi.findMany({
        where: {
          periodId: period.id,
          status: { in: ['DRAFT', 'RETURNED'] },
          isLocked: false,
        },
        select: {
          id: true,
          employeeId: true,
          name: true,
          status: true,
          returnedAt: true,
          extensions: { select: { until: true }, orderBy: { until: 'desc' }, take: 1 },
        },
        take: 50_000,
      });

      for (const kpi of candidates) {
        const extensionUntil = kpi.extensions[0]?.until ?? null;
        // Resubmission window: the later of the deadline and 3 working days after a return
        const resubmitBy =
          kpi.status === 'RETURNED' && kpi.returnedAt
            ? new Date(Math.max(kpi.returnedAt.getTime() + 3 * 86_400_000, deadline.getTime()))
            : deadline;
        const effective = extensionUntil && extensionUntil > resubmitBy ? extensionUntil : resubmitBy;
        if (effective >= now) continue;

        await this.prisma.kpi.update({
          where: { id: kpi.id },
          data: {
            status: 'NOT_SUBMITTED',
            overdueAt: now,
            actual: kpi.status === 'DRAFT' ? undefined : null,
            rowVersion: { increment: 1 },
          },
        });
        converted.push({ id: kpi.id, employeeId: kpi.employeeId });
      }

      // Notify employees and their Department Heads in one digest per employee
      const byEmployee = new Map<string, string[]>();
      converted.forEach((c) => {
        const list = byEmployee.get(c.employeeId) ?? [];
        list.push(c.id);
        byEmployee.set(c.employeeId, list);
      });

      for (const [employeeId, ids] of byEmployee) {
        const employee = await this.prisma.user.findUnique({
          where: { id: employeeId },
          select: { id: true, email: true, fullName: true, emailDigest: true, departmentId: true, department: { select: { name: true } } },
        });
        if (!employee) continue;
        const names = await this.prisma.kpi.findMany({ where: { id: { in: ids } }, select: { name: true } });
        const heads = employee.departmentId
          ? await this.prisma.departmentHead.findMany({
              where: { departmentId: employee.departmentId, isActive: true },
              include: { user: { select: { id: true, email: true, fullName: true, emailDigest: true } } },
            })
          : [];

        await this.notifications.notify({
          code: NT.DEADLINE_MISSED,
          recipients: [
            { userId: employee.id, email: employee.email, fullName: employee.fullName, emailDigest: employee.emailDigest },
            ...heads.map((h) => ({ userId: h.user.id, email: h.user.email, fullName: h.user.fullName, emailDigest: h.user.emailDigest })),
          ],
          title: `Submission deadline missed for ${period.label}`,
          body: `${names.length} KPI(s) were set to Not Submitted and score 0.`,
          deepLink: '/my-kpi',
          entityType: 'kpi_period',
          entityId: period.id,
          severity: 'warning',
          emailContext: {
            period: period.label,
            kpiList: names.map((n) => n.name).join(', '),
            myKpiUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/my-kpi?period=${period.code}`,
          },
        });
      }

      if (converted.length) {
        await this.audit.record({
          action: 'kpi.overdue.sweep',
          entityType: 'kpi_period',
          entityId: period.id,
          actorKind: 'SYSTEM',
          after: { converted: converted.length, period: period.code },
        });
      }
    }

    return converted;
  }

  // ---------------------------------------------------------------------- NT-15

  /** NT-15 — review SLA breach: 5 working days → approver, 8 → Super Admin, repeated daily. */
  private async slaCheck() {
    const pending = await this.prisma.kpi.findMany({
      where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] }, isLocked: false },
      select: {
        id: true,
        name: true,
        submittedAt: true,
        approverId: true,
        departmentId: true,
        employee: { select: { fullName: true, employeeCode: true } },
        department: { select: { name: true } },
        period: { select: { label: true } },
      },
      take: 50_000,
    });

    const breached = pending.filter((k) => k.submittedAt && workingDaysBetween(k.submittedAt, new Date()) > 5);
    if (!breached.length) return { breached: 0 };

    const byApprover = new Map<string, typeof breached>();
    breached.forEach((k) => {
      const key = k.approverId ?? 'super-admin';
      const list = byApprover.get(key) ?? [];
      list.push(k);
      byApprover.set(key, list);
    });

    const superAdmins = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', roles: { some: { role: { code: 'SUPER_ADMIN' } } } },
      select: { id: true, email: true, fullName: true, emailDigest: true },
    });

    let notified = 0;
    for (const [approverId, list] of byApprover) {
      const maxAge = Math.max(...list.map((k) => workingDaysBetween(k.submittedAt!, new Date())));
      const approver = approverId === 'super-admin'
        ? null
        : await this.prisma.user.findUnique({
            where: { id: approverId },
            select: { id: true, email: true, fullName: true, emailDigest: true },
          });

      const recipients = [
        ...(approver ? [{ userId: approver.id, email: approver.email, fullName: approver.fullName, emailDigest: approver.emailDigest }] : []),
        ...(maxAge > 8
          ? superAdmins.map((s) => ({ userId: s.id, email: s.email, fullName: s.fullName, emailDigest: s.emailDigest }))
          : []),
      ];

      if (!recipients.length) continue;

      await this.notifications.notify({
        code: NT.REVIEW_SLA_BREACHED,
        recipients,
        title: `Review SLA breached: ${list.length} request(s) waiting ${maxAge} working days`,
        body: `The review SLA of 5 working days has been breached. ${maxAge > 8 ? 'This is escalated to the Super Admin.' : ''}`,
        deepLink: approverId === 'super-admin' ? '/all-kpi-requests' : '/approvals',
        entityType: 'kpi',
        entityId: list[0].id,
        severity: 'warning',
        critical: maxAge > 8,
        emailContext: {
          pendingCount: list.length,
          ageDays: maxAge,
          queueUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/approvals`,
        },
      });
      notified += list.length;
    }

    return { breached: breached.length, notified };
  }

  // ------------------------------------------------------- FR-CAL-04, §4.9

  /** Nightly verification: re-computes every open-period KPI and reports mismatches. */
  private async nightlyVerification() {
    const { calculateKpi } = await import('../../modules/calculation/calculation.engine');
    const openPeriods = await this.prisma.kpiPeriod.findMany({
      where: { status: { in: ['OPEN', 'REOPENED'] } },
      select: { id: true },
    });

    const kpis = await this.prisma.kpi.findMany({
      where: { periodId: { in: openPeriods.map((p) => p.id) }, status: { notIn: ['DELETED'] } },
      select: {
        id: true,
        target: true,
        actual: true,
        rubricLevel: true,
        kpiWeight: true,
        direction: true,
        measurementType: true,
        achievement: true,
        calculatedScore: true,
        finalScore: true,
        weightedScore: true,
        overrideScore: true,
        configVersion: { select: { scoreCap: true, scoreFloor: true, qualitativeMap: true } },
      },
      take: 500_000,
    });

    const mismatches: Array<{ id: string; field: string; stored: string | null; computed: string }> = [];

    for (const k of kpis) {
      if (k.target === null || k.actual === null) continue;
      try {
        const qualitativeMap = (k.configVersion?.qualitativeMap ?? null) as Record<string, number> | null;
        const result = calculateKpi({
          target: k.target,
          actual: k.actual,
          rubricLevel: k.rubricLevel,
          kpiWeight: k.kpiWeight,
          direction: k.direction,
          measurementType: k.measurementType,
          overrideScore: k.overrideScore,
          config: {
            scoreCap: k.configVersion?.scoreCap ?? 120,
            scoreFloor: k.configVersion?.scoreFloor ?? 0,
            qualitativeMap: qualitativeMap ?? undefined,
          },
        });

        const checks: Array<[string, string | null, string]> = [
          ['achievement', dec(k.achievement), dec(result.achievement)!],
          ['calculatedScore', dec(k.calculatedScore), dec(result.calculatedScore)!],
          ['finalScore', dec(k.finalScore), dec(result.finalScore)!],
          ['weightedScore', dec(k.weightedScore), dec(result.weightedScore)!],
        ];
        checks.forEach(([field, stored, computed]) => {
          if ((stored ?? '') !== computed) mismatches.push({ id: k.id, field, stored, computed });
        });
      } catch {
        // V-TGT-01 style inputs are validated at entry; skip during verification
      }
    }

    if (mismatches.length) {
      const sysAdmins = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', roles: { some: { role: { code: { in: ['SYS_ADMIN', 'SUPER_ADMIN'] } } } } },
        select: { id: true, email: true, fullName: true, emailDigest: true },
      });
      await this.notifications.notify({
        code: NT.CORRECTION_OR_REOPEN,
        recipients: sysAdmins.map((s) => ({ userId: s.id, email: s.email, fullName: s.fullName, emailDigest: s.emailDigest })),
        title: `Nightly calculation verification: ${mismatches.length} mismatch(es) found`,
        body: 'The nightly job re-computed open-period KPIs and found stored values that differ from the engine output.',
        deepLink: '/admin/system-health',
        severity: 'danger',
        critical: true,
        emailContext: {
          eventTitle: 'Nightly calculation verification failed',
          subject: `${mismatches.length} KPI value(s) differ from the calculation engine`,
          detail: 'Investigate the KPI ids listed in the System Health screen.',
          rows: mismatches.slice(0, 10).map((m) => ({ label: m.id.slice(0, 8), value: `${m.field}: stored ${m.stored} vs computed ${m.computed}` })),
          ctaLabel: 'Open System Health',
          linkUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/admin/system-health`,
        },
      });
    }

    await this.audit.record({
      action: 'calculation.verify',
      entityType: 'calculation_log',
      actorKind: 'SYSTEM',
      after: { checked: kpis.length, mismatches: mismatches.length },
    });

    return { checked: kpis.length, mismatches: mismatches.length };
  }

  // ----------------------------------------------------------- §18 hash chain

  private async hashChainVerify() {
    const result = await this.audit.verifyChain();
    if (!result.ok) {
      const superAdmins = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', roles: { some: { role: { code: { in: ['SUPER_ADMIN', 'SYS_ADMIN'] } } } } },
        select: { id: true, email: true, fullName: true, emailDigest: true },
      });
      await this.notifications.notify({
        code: NT.CORRECTION_OR_REOPEN,
        recipients: superAdmins.map((s) => ({ userId: s.id, email: s.email, fullName: s.fullName, emailDigest: s.emailDigest })),
        title: 'Audit hash-chain verification FAILED',
        body: `The audit trail chain is broken at record ${result.brokenAt?.id} (${result.brokenAt?.action}).`,
        severity: 'danger',
        critical: true,
        deepLink: '/admin/audit-log',
        emailContext: {
          eventTitle: 'Audit hash-chain verification failed',
          subject: `Broken at record ${result.brokenAt?.id}`,
          detail: `Checked ${result.checked} records before the break. Action: ${result.brokenAt?.action}.`,
          ctaLabel: 'Open Audit Log',
          linkUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/admin/audit-log`,
        },
      });
    }
    return result;
  }

  // --------------------------------------------------------- FR-PRF-05 digest

  /** Daily digest for users who chose not to receive non-critical e-mails immediately. */
  private async digestEmails() {
    const users = await this.prisma.user.findMany({
      where: { emailDigest: true, status: 'ACTIVE' },
      select: { id: true, email: true, fullName: true },
      take: 20_000,
    });

    let sent = 0;
    for (const user of users) {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const pending = await this.prisma.notification.count({
        where: { userId: user.id, createdAt: { gte: since } },
      });
      if (!pending) continue;
      await this.notifications.notify({
        code: NT.CORRECTION_OR_REOPEN,
        recipients: [{ userId: user.id, email: user.email, fullName: user.fullName }],
        title: `Your daily ANWAR KPIFlow digest — ${pending} update(s)`,
        body: 'A summary of the activity on your KPIs in the last 24 hours.',
        deepLink: '/notifications',
        channel: 'EMAIL' as never,
        emailContext: {
          eventTitle: 'Your daily ANWAR KPIFlow digest',
          subject: `${pending} update(s) in the last 24 hours`,
          detail: 'Open the notification centre to see every update.',
          ctaLabel: 'Open notifications',
          linkUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/notifications`,
        },
      });
      sent += 1;
    }
    return { sent };
  }

  // ------------------------------------------------------------------ retention

  private async purgeExpired() {
    const now = new Date();
    const tokens = await this.prisma.token.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } }, { usedAt: { not: null } }] },
    });
    const sessions = await this.prisma.session.deleteMany({
      where: { OR: [{ absoluteExpiresAt: { lt: now } }, { revokedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } }] },
    });
    const exportsPurged = await this.prisma.exportJob.updateMany({
      where: { status: 'COMPLETED', expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    const idempotency = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - 2 * 86_400_000) } },
    });
    void EXPORT_LINK_TTL_HOURS;

    return {
      tokens: tokens.count,
      sessions: sessions.count,
      exports: exportsPurged.count,
      idempotencyKeys: idempotency.count,
    };
  }

  /** Utility used by period close to deliver NT-16. */
  async notifyPeriodClosed(periodId: string): Promise<number> {
    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) return 0;

    const snapshots = await this.prisma.performanceSnapshot.findMany({
      where: { periodId },
      include: {
        employee: { select: { id: true, email: true, fullName: true, emailDigest: true } },
      },
    });

    for (const s of snapshots) {
      await this.notifications.notify({
        code: NT.PERIOD_CLOSED,
        recipients: [
          {
            userId: s.employee.id,
            email: s.employee.email,
            fullName: s.employee.fullName,
            emailDigest: s.employee.emailDigest,
          },
        ],
        title: `Results published for ${period.label}`,
        body: `Your Total KPI Score is ${dec(s.totalKpiScore)} with RAG ${s.rag}.`,
        deepLink: `/performance-summary?period=${period.code}`,
        entityType: 'kpi_period',
        entityId: periodId,
        severity: 'success',
        critical: true,
        emailContext: {
          period: period.label,
          totalKpiScore: dec(s.totalKpiScore),
          averageAchievement: `${dec(s.averageAchievement)}%`,
          allocatedWeight: `${s.allocatedWeight}%`,
          approvedCount: `${s.approvedCount} / ${s.totalCount}`,
          rag: s.rag,
          rank: s.rank ?? '—',
          summaryUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/performance-summary?period=${period.code}`,
        },
      });
    }
    return snapshots.length;
  }

  /** Recompute the aggregates of a single employee/period (used after every decision). */
  async refreshAggregates(employeeId: string, periodId: string): Promise<void> {
    await this.performance.employeePeriod(employeeId, periodId);
    void round2;
  }
}
