/**
 * Period calendar & close workflow — BRD §3.5, FR-CFG-01, FR-CFG-03, FR-CFG-04, EC-09.
 *
 * Responsibilities:
 *  - Calendar generation per year / frequency (monthly 12, quarterly 4, yearly 1)
 *    with deadlines derived from the active ConfigurationVersion.
 *  - Manual period maintenance (deadlines, status).
 *  - Close: block while any KPI is in a close-blocking status, lock every KPI,
 *    write snapshots, notify employees (NT-16) and enqueue the snapshot job.
 *  - Reopen (BR-R12): reason ≥ 15 chars, unlock only the KPIs that need corrections.
 *  - Extension grant (EC-09): Department Head (own department) or Super Admin,
 *    up to `extensionMaxDays`; a Not Submitted KPI returns to Draft.
 *  - Outstanding items for the close dialog (pending / not submitted / weight-incomplete).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Frequency, PeriodStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PerformanceService } from '../performance/performance.service';
import { QueueService } from '../../queue/queue.service';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { AUDIT_ACTIONS, CLOSE_BLOCKING_STATUSES, NT, PERM, ROLE } from '../../common/constants';
import {
  BadRequest,
  Conflict,
  ErrorCode,
  FieldError,
  Forbidden,
  NotFound,
  Unprocessable,
} from '../../common/errors/error-codes';
import { dec } from '../../common/utils/decimal.util';
import {
  addDays,
  currentPeriodDescriptor,
  daysRemaining,
  descriptorsForYear,
  formatDate,
  FrequencyKey,
  isoDate,
  monthCode,
  periodLabel,
  quarterCode,
  toDate,
  yearCode,
} from '../../common/utils/period.util';

interface PagingQuery {
  page?: string | number;
  size?: string | number;
}

interface PeriodListQuery extends PagingQuery {
  frequency?: string;
  year?: string | number;
  status?: string;
}

interface ExtensionListQuery extends PagingQuery {
  periodId?: string;
}

interface UpsertPeriodInput {
  id?: string;
  frequency?: Frequency | string;
  code?: string;
  label?: string;
  year?: number;
  periodIndex?: number;
  startDate?: string;
  endDate?: string;
  submissionDeadline?: string;
  reviewDeadline?: string;
  status?: PeriodStatus | string;
  notes?: string;
}

interface CloseInput {
  reason?: string;
}

interface ExtensionInput {
  days?: number;
  reason?: string;
}

export interface PeriodCounters {
  kpiCount: number;
  pendingCount: number;
  approvedCount: number;
  notSubmittedCount: number;
  snapshotCount: number;
}

const FREQUENCIES: FrequencyKey[] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
const FREQUENCY_VALUES: string[] = Object.values(Frequency);
const PERIOD_STATUS_VALUES: string[] = Object.values(PeriodStatus);
const BLOCKING: readonly string[] = [...CLOSE_BLOCKING_STATUSES];
const UNLOCK_ON_REOPEN = ['DRAFT', 'RETURNED', 'REJECTED', 'NOT_SUBMITTED'] as const;

@Injectable()
export class PeriodsService {
  private readonly logger = new Logger(PeriodsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
    private readonly performance: PerformanceService,
  ) {}

  // ------------------------------------------------------------------ helpers

  private appUrl(path: string): string {
    const base = process.env.APP_URL || 'http://localhost:5173';
    return `${base.replace(/\/$/, '')}${path}`;
  }

  private paging(query: PagingQuery | undefined) {
    const page = Math.max(1, Math.trunc(Number(query?.page)) || 1);
    const raw = Math.trunc(Number(query?.size)) || 25;
    const size = Math.min(100, Math.max(1, raw));
    return { page, size, skip: (page - 1) * size, take: size };
  }

  private async activeConfig() {
    return this.prisma.configurationVersion.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
  }

  private indexFor(frequency: Frequency, date: Date): number {
    const month = date.getUTCMonth() + 1;
    if (frequency === 'MONTHLY') return month;
    if (frequency === 'QUARTERLY') return Math.floor((month - 1) / 3) + 1;
    return 1;
  }

  private defaultCode(frequency: Frequency, year: number, periodIndex: number, startDate: Date): string {
    if (frequency === 'MONTHLY') return monthCode(year, startDate.getUTCMonth() + 1);
    if (frequency === 'QUARTERLY') return quarterCode(year, periodIndex);
    return yearCode(year);
  }

  private periodSnapshot(period: {
    id: string;
    code: string;
    label: string;
    frequency: Frequency;
    year: number;
    periodIndex: number;
    startDate: Date;
    endDate: Date;
    submissionDeadline: Date;
    reviewDeadline: Date;
    status: PeriodStatus;
  }) {
    return {
      id: period.id,
      code: period.code,
      label: period.label,
      frequency: period.frequency,
      year: period.year,
      periodIndex: period.periodIndex,
      startDate: isoDate(period.startDate),
      endDate: isoDate(period.endDate),
      submissionDeadline: isoDate(period.submissionDeadline),
      reviewDeadline: isoDate(period.reviewDeadline),
      status: period.status,
    };
  }

  // ------------------------------------------------------------ FR-CFG-01 list

  /** GET /admin/periods — filtered list with close-dialog counters and deadline state. */
  async list(query: PeriodListQuery) {
    const { page, size, skip, take } = this.paging(query);

    const where: Prisma.KpiPeriodWhereInput = {};
    if (query?.frequency && FREQUENCY_VALUES.includes(query.frequency)) {
      where.frequency = query.frequency as Frequency;
    }
    const year = Math.trunc(Number(query?.year));
    if (Number.isFinite(year) && year >= 2000 && year <= 2100) where.year = year;
    if (query?.status && PERIOD_STATUS_VALUES.includes(query.status)) {
      where.status = query.status as PeriodStatus;
    }

    const [total, periods] = await Promise.all([
      this.prisma.kpiPeriod.count({ where }),
      this.prisma.kpiPeriod.findMany({
        where,
        orderBy: { startDate: 'desc' },
        skip,
        take,
        include: { _count: { select: { snapshots: true } } },
      }),
    ]);

    const ids = periods.map((p) => p.id);
    const grouped = ids.length
      ? await this.prisma.kpi.groupBy({
          by: ['periodId', 'status'],
          where: { periodId: { in: ids }, status: { not: 'DELETED' } },
          _count: { _all: true },
        })
      : [];

    const counters = new Map<string, PeriodCounters>();
    for (const row of grouped) {
      const current = counters.get(row.periodId) ?? {
        kpiCount: 0,
        pendingCount: 0,
        approvedCount: 0,
        notSubmittedCount: 0,
        snapshotCount: 0,
      };
      const count = row._count._all;
      current.kpiCount += count;
      if (BLOCKING.includes(row.status)) current.pendingCount += count;
      if (row.status === 'APPROVED') current.approvedCount += count;
      if (row.status === 'NOT_SUBMITTED') current.notSubmittedCount += count;
      counters.set(row.periodId, current);
    }

    const now = new Date();
    const items = periods.map((period) => {
      const daysToDeadline = daysRemaining(period.submissionDeadline, now);
      const deadlineState: 'open' | 'due_today' | 'overdue' | 'closed' =
        period.status === 'CLOSED'
          ? 'closed'
          : daysToDeadline < 0
            ? 'overdue'
            : daysToDeadline === 0
              ? 'due_today'
              : 'open';
      const current = counters.get(period.id) ?? {
        kpiCount: 0,
        pendingCount: 0,
        approvedCount: 0,
        notSubmittedCount: 0,
        snapshotCount: 0,
      };
      return {
        ...period,
        ...current,
        snapshotCount: period._count.snapshots,
        daysToDeadline,
        deadlineState,
      };
    });

    return {
      items,
      page,
      size,
      total,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  // -------------------------------------------------------- FR-CFG-01 calendar

  /**
   * Generates every period of `year` for the requested frequencies. Deadlines are
   * derived from the active configuration (grace / review window). Idempotent via
   * the `[frequency, startDate]` unique key; OPEN periods are re-aligned when the
   * configuration changed.
   */
  async ensureCalendar(
    year: number,
    frequencies?: string[],
    user?: AuthUser,
    meta?: RequestContextMeta,
  ) {
    const y = Math.trunc(Number(year));
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      throw BadRequest(ErrorCode.VALIDATION_FAILED, 'A valid calendar year between 2000 and 2100 is required.');
    }

    const config = await this.activeConfig();
    const grace = config?.submissionGraceDays ?? 7;
    const reviewWindow = config?.reviewWindowDays ?? 7;

    const requested = (frequencies ?? []).filter((f): f is FrequencyKey =>
      FREQUENCIES.includes(f as FrequencyKey),
    );
    const list: FrequencyKey[] = requested.length ? requested : FREQUENCIES;

    let created = 0;
    let existing = 0;
    const periods: any[] = [];

    for (const frequency of list) {
      for (const descriptor of descriptorsForYear(frequency, y)) {
        const submissionDeadline = addDays(descriptor.endDate, grace);
        const reviewDeadline = addDays(submissionDeadline, reviewWindow);

        const found = await this.prisma.kpiPeriod.findUnique({
          where: { frequency_startDate: { frequency, startDate: descriptor.startDate } },
        });

        if (found) {
          existing += 1;
          const row = await this.prisma.kpiPeriod.update({
            where: { id: found.id },
            data:
              found.status === 'OPEN'
                ? { label: descriptor.label, submissionDeadline, reviewDeadline }
                : {},
          });
          periods.push(row);
          continue;
        }

        const row = await this.prisma.kpiPeriod.upsert({
          where: { frequency_startDate: { frequency, startDate: descriptor.startDate } },
          create: {
            frequency,
            code: descriptor.code,
            label: descriptor.label,
            year: y,
            periodIndex: descriptor.periodIndex,
            startDate: descriptor.startDate,
            endDate: descriptor.endDate,
            submissionDeadline,
            reviewDeadline,
            status: 'OPEN',
          },
          update: {},
        });
        created += 1;
        periods.push(row);
      }
    }

    await this.audit.record({
      action: AUDIT_ACTIONS.PERIOD_OPEN,
      entityType: 'kpi_period',
      actor: user ?? null,
      actorKind: user ? 'USER' : 'SYSTEM',
      after: { year: y, frequencies: list, created, existing },
      reason: `Calendar generated for ${y}`,
      meta,
    });

    return { created, existing, periods };
  }

  // ------------------------------------------------------------- manual maintenance

  /** POST /admin/periods + PATCH /admin/periods/:id — FR-CFG-01. */
  async createOrUpdate(dto: UpsertPeriodInput, user: AuthUser, meta: RequestContextMeta) {
    if (dto.id) return this.update(dto as UpsertPeriodInput & { id: string }, user, meta);
    return this.create(dto, user, meta);
  }

  private async create(dto: UpsertPeriodInput, user: AuthUser, meta: RequestContextMeta) {
    if (!dto.startDate || !dto.endDate) {
      throw BadRequest(ErrorCode.V_MISSING, 'startDate and endDate are required to create a period.');
    }
    const frequency = (dto.frequency ?? 'MONTHLY') as Frequency;
    if (!FREQUENCY_VALUES.includes(frequency)) {
      throw BadRequest(ErrorCode.VALIDATION_FAILED, `Unsupported frequency: ${String(dto.frequency)}.`);
    }

    const startDate = toDate(dto.startDate);
    const endDate = toDate(dto.endDate);
    if (endDate.getTime() < startDate.getTime()) {
      throw BadRequest(ErrorCode.VALIDATION_FAILED, 'endDate must be on or after startDate.');
    }

    const duplicate = await this.prisma.kpiPeriod.findUnique({
      where: { frequency_startDate: { frequency, startDate } },
      select: { id: true, code: true },
    });
    if (duplicate) {
      throw Conflict(
        ErrorCode.CONFLICT,
        `A ${frequency} period starting ${isoDate(startDate)} already exists (${duplicate.code}).`,
      );
    }

    const config = await this.activeConfig();
    const grace = config?.submissionGraceDays ?? 7;
    const reviewWindow = config?.reviewWindowDays ?? 7;

    const year = dto.year ?? startDate.getUTCFullYear();
    const periodIndex = dto.periodIndex ?? this.indexFor(frequency, startDate);
    const code = (dto.code?.trim() || this.defaultCode(frequency, year, periodIndex, startDate)).toUpperCase();
    const label = dto.label?.trim() || periodLabel(frequency, year, periodIndex);
    const submissionDeadline = dto.submissionDeadline ? toDate(dto.submissionDeadline) : addDays(endDate, grace);
    const reviewDeadline = dto.reviewDeadline ? toDate(dto.reviewDeadline) : addDays(submissionDeadline, reviewWindow);

    const created = await this.prisma.kpiPeriod.create({
      data: {
        frequency,
        code,
        label,
        year,
        periodIndex,
        startDate,
        endDate,
        submissionDeadline,
        reviewDeadline,
        status: 'OPEN',
      },
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.PERIOD_OPEN,
      entityType: 'kpi_period',
      entityId: created.id,
      actor: user,
      after: this.periodSnapshot(created),
      reason: dto.notes ?? null,
      meta,
    });

    return created;
  }

  private async update(dto: UpsertPeriodInput & { id: string }, user: AuthUser, meta: RequestContextMeta) {
    const before = await this.prisma.kpiPeriod.findUnique({ where: { id: dto.id } });
    if (!before) throw NotFound(ErrorCode.NOT_FOUND, 'Period not found.');

    const data: Prisma.KpiPeriodUncheckedUpdateInput = {};
    if (dto.submissionDeadline !== undefined) data.submissionDeadline = toDate(dto.submissionDeadline);
    if (dto.reviewDeadline !== undefined) data.reviewDeadline = toDate(dto.reviewDeadline);
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.status !== undefined) {
      if (!PERIOD_STATUS_VALUES.includes(dto.status)) {
        throw BadRequest(ErrorCode.VALIDATION_FAILED, `Unsupported period status: ${String(dto.status)}.`);
      }
      const status = dto.status as PeriodStatus;
      data.status = status;
      if (status === 'CLOSED' && before.status !== 'CLOSED') {
        data.closedAt = new Date();
        data.closedById = user.id;
      }
      if (status === 'REOPENED' && before.status === 'CLOSED') {
        data.reopenedAt = new Date();
      }
    }

    if (!Object.keys(data).length) {
      throw BadRequest(ErrorCode.V_MISSING, 'Nothing to update: provide submissionDeadline, reviewDeadline, status or label.');
    }

    const updated = await this.prisma.kpiPeriod.update({ where: { id: dto.id }, data });

    await this.audit.record({
      action: AUDIT_ACTIONS.PERIOD_OPEN,
      entityType: 'kpi_period',
      entityId: updated.id,
      actor: user,
      before: this.periodSnapshot(before),
      after: this.periodSnapshot(updated),
      changedFields: Object.keys(data),
      meta,
    });

    return updated;
  }

  // --------------------------------------------------------- FR-CFG-03 close

  /**
   * Close a period. Blocked while any KPI is Submitted / Under Review / Escalated;
   * otherwise locks every KPI, closes the period, writes snapshots, notifies the
   * employees (NT-16) and enqueues the snapshot job.
   */
  async close(periodId: string, dto: CloseInput, user: AuthUser, meta: RequestContextMeta) {
    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'Period not found.');
    if (period.status === 'CLOSED') {
      throw Conflict(ErrorCode.PERIOD_ALREADY_CLOSED, `${period.label} is already closed.`);
    }

    const pending = await this.prisma.kpi.findMany({
      where: { periodId, status: { in: [...CLOSE_BLOCKING_STATUSES] } },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        employee: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    if (pending.length) {
      const list = pending
        .slice(0, 10)
        .map((p) => `${p.code} “${p.name}” (${p.employee.fullName}, ${p.status})`)
        .join('; ');
      const more = pending.length > 10 ? ` …and ${pending.length - 10} more` : '';
      const fieldErrors: FieldError[] = [
        {
          field: 'pendingItems',
          code: ErrorCode.PERIOD_PENDING_ITEMS,
          message: `${pending.length} item(s) are still pending decision`,
        },
      ];
      throw Conflict(
        ErrorCode.PERIOD_PENDING_ITEMS,
        `Close is blocked: ${pending.length} item(s) are still pending decision — ${list}${more}`,
        fieldErrors,
      );
    }

    const closedAt = new Date();
    const [locked, updated] = await this.prisma.$transaction([
      this.prisma.kpi.updateMany({
        where: { periodId },
        data: { isLocked: true, rowVersion: { increment: 1 } },
      }),
      this.prisma.kpiPeriod.update({
        where: { id: periodId },
        data: { status: 'CLOSED', closedAt, closedById: user.id },
      }),
    ]);

    let snapshotsWritten = 0;
    try {
      snapshotsWritten = await this.performance.generateSnapshots(periodId);
    } catch (e) {
      // The close itself is committed; the enqueued snapshot job and the next
      // close attempt are idempotent, so surface the problem without failing.
      this.logger.error(`Snapshot generation failed for period ${period.code}: ${(e as Error).message}`);
    }

    await this.audit.record({
      action: AUDIT_ACTIONS.PERIOD_CLOSE,
      entityType: 'kpi_period',
      entityId: periodId,
      actor: user,
      before: { status: period.status, pendingItems: pending.length },
      after: { status: 'CLOSED', closedAt: closedAt.toISOString(), lockedKpis: locked.count, snapshotsWritten },
      reason: dto?.reason ?? null,
      meta,
    });

    await this.queue.enqueueScheduled({ name: 'period-snapshot', detail: { periodId } });
    await this.notifyPeriodClosed(periodId, snapshotsWritten);

    return { period: updated, snapshotsWritten, lockedKpis: locked.count };
  }

  /**
   * NT-16 — mirrors ScheduledJobsService.notifyPeriodClosed (which cannot be
   * imported here because of the circular dependency through QueueModule).
   */
  private async notifyPeriodClosed(periodId: string, fallbackCount = 0): Promise<number> {
    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) return 0;

    const snapshots = await this.prisma.performanceSnapshot.findMany({
      where: { periodId },
      include: {
        employee: { select: { id: true, email: true, fullName: true, emailDigest: true } },
      },
    });

    const summaryUrl = this.appUrl(`/performance-summary?period=${period.code}`);

    for (const snapshot of snapshots) {
      await this.notifications.notify({
        code: NT.PERIOD_CLOSED,
        recipients: [
          {
            userId: snapshot.employee.id,
            email: snapshot.employee.email,
            fullName: snapshot.employee.fullName,
            emailDigest: snapshot.employee.emailDigest,
          },
        ],
        title: `Results published for ${period.label}`,
        body: `Your Total KPI Score is ${dec(snapshot.totalKpiScore)} with RAG ${snapshot.rag}.`,
        deepLink: `/performance-summary?period=${period.code}`,
        entityType: 'kpi_period',
        entityId: periodId,
        severity: 'success',
        critical: true,
        emailContext: {
          period: period.label,
          totalKpiScore: dec(snapshot.totalKpiScore),
          averageAchievement: `${dec(snapshot.averageAchievement)}%`,
          allocatedWeight: `${snapshot.allocatedWeight}%`,
          approvedCount: `${snapshot.approvedCount} / ${snapshot.totalCount}`,
          rag: snapshot.rag,
          rank: snapshot.rank ?? '—',
          summaryUrl,
        },
      });
    }

    return snapshots.length || fallbackCount;
  }

  // -------------------------------------------------------- FR-CFG-03 / BR-R12 reopen

  /** Reopen a closed period for corrections; only non-approved KPIs are unlocked. */
  async reopen(periodId: string, reason: string, user: AuthUser, meta: RequestContextMeta) {
    const config = await this.activeConfig();
    const minLength = Math.max(15, config?.minReasonLength ?? 15);
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < minLength) {
      throw Unprocessable(
        ErrorCode.REASON_REQUIRED,
        `A reason of at least ${minLength} characters is required to reopen a period.`,
      );
    }

    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'Period not found.');
    if (period.status !== 'CLOSED') {
      throw Conflict(
        ErrorCode.PERIOD_NOT_CLOSED,
        `Only a closed period can be reopened (current status: ${period.status}).`,
      );
    }

    const reopenedAt = new Date();
    const [updated, unlocked] = await this.prisma.$transaction([
      this.prisma.kpiPeriod.update({
        where: { id: periodId },
        data: { status: 'REOPENED', reopenedAt, reopenReason: trimmed },
      }),
      this.prisma.kpi.updateMany({
        where: { periodId, status: { in: [...UNLOCK_ON_REOPEN] } },
        data: { isLocked: false, rowVersion: { increment: 1 } },
      }),
    ]);

    await this.audit.record({
      action: AUDIT_ACTIONS.PERIOD_REOPEN,
      entityType: 'kpi_period',
      entityId: periodId,
      actor: user,
      before: { status: 'CLOSED' },
      after: { status: 'REOPENED', reopenedAt: reopenedAt.toISOString(), unlockedKpis: unlocked.count },
      reason: trimmed,
      meta,
    });

    const superAdmins = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', roles: { some: { role: { code: ROLE.SUPER_ADMIN } } } },
      select: { id: true, email: true, fullName: true, emailDigest: true },
    });

    if (superAdmins.length) {
      await this.notifications.notify({
        code: NT.CORRECTION_OR_REOPEN,
        recipients: superAdmins.map((s) => ({
          userId: s.id,
          email: s.email,
          fullName: s.fullName,
          emailDigest: s.emailDigest,
        })),
        title: `Period reopened: ${period.label}`,
        body: `${period.label} was reopened by ${user.fullName}. Reason: ${trimmed}`,
        deepLink: '/admin/periods',
        entityType: 'kpi_period',
        entityId: periodId,
        severity: 'warning',
        critical: true,
        emailContext: {
          eventTitle: 'A closed period was reopened',
          subject: `${period.label} was reopened for corrections`,
          detail: `Reopened by ${user.fullName}. Reason: ${trimmed}`,
          rows: [
            { label: 'Period', value: period.label },
            { label: 'Unlocked KPIs', value: String(unlocked.count) },
            { label: 'Reason', value: trimmed },
          ],
          ctaLabel: 'Open Period Administration',
          linkUrl: this.appUrl('/admin/periods'),
        },
      });
    }

    return { period: updated, unlockedKpis: unlocked.count };
  }

  // ----------------------------------------------------- FR-CFG-04 / EC-09 extensions

  /** Grant an extension on a single KPI (Department Head of the department or Super Admin). */
  async grantExtension(kpiId: string, dto: ExtensionInput, user: AuthUser, meta: RequestContextMeta) {
    const kpi = await this.prisma.kpi.findUnique({
      where: { id: kpiId },
      include: {
        employee: {
          select: { id: true, email: true, fullName: true, employeeCode: true, emailDigest: true },
        },
        period: {
          select: { id: true, code: true, label: true, status: true, submissionDeadline: true },
        },
      },
    });
    if (!kpi) throw NotFound(ErrorCode.KPI_NOT_FOUND, 'KPI not found.');

    const isSuperAdmin = user.roles.includes(ROLE.SUPER_ADMIN);
    const inDepartmentScope =
      !!kpi.departmentId &&
      (user.departmentId === kpi.departmentId || user.scope.departmentIds.includes(kpi.departmentId));
    if (!isSuperAdmin && !inDepartmentScope) {
      throw Forbidden(ErrorCode.OUT_OF_SCOPE, 'Extensions can only be granted for KPIs in your own department.');
    }
    if (!isSuperAdmin && !user.permissions.includes(PERM.EXTENSION_GRANT)) {
      throw Forbidden(ErrorCode.FORBIDDEN, 'Your role does not permit granting extensions.');
    }
    if (kpi.status === 'DELETED' || kpi.isLocked || kpi.period.status === 'CLOSED') {
      throw Conflict(ErrorCode.PERIOD_CLOSED, 'The period is closed or the KPI is locked; reopen the period before granting an extension.');
    }

    const config = await this.activeConfig();
    const maxDays = config?.extensionMaxDays ?? 7;
    const days = Math.trunc(Number(dto?.days));
    if (!Number.isFinite(days) || days < 1 || days > maxDays) {
      throw Unprocessable(
        ErrorCode.VALIDATION_FAILED,
        `Extension days must be between 1 and ${maxDays}.`,
      );
    }

    const minLength = Math.max(15, config?.minReasonLength ?? 15);
    const reason = (dto?.reason ?? '').trim();
    if (reason.length < minLength) {
      throw Unprocessable(
        ErrorCode.REASON_REQUIRED,
        `A reason of at least ${minLength} characters is required to grant an extension.`,
      );
    }

    const now = new Date();
    const base = kpi.period.submissionDeadline > now ? kpi.period.submissionDeadline : now;
    const until = addDays(base, days);

    const extension = await this.prisma.$transaction(async (tx) => {
      const created = await tx.kpiExtension.create({
        data: {
          kpiId,
          periodId: kpi.periodId,
          grantedById: user.id,
          departmentId: kpi.departmentId,
          reason,
          days,
          until,
        },
      });

      if (kpi.status === 'NOT_SUBMITTED') {
        // EC-09 — the employee gets the KPI back to finish the submission.
        await tx.kpi.update({
          where: { id: kpiId },
          data: { status: 'DRAFT', isLocked: false, rowVersion: { increment: 1 } },
        });
      }

      return created;
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.EXTENSION_GRANT,
      entityType: 'kpi',
      entityId: kpiId,
      actor: user,
      employeeId: kpi.employeeId,
      departmentId: kpi.departmentId,
      before: { status: kpi.status, isLocked: kpi.isLocked },
      after: { days, until: isoDate(until), status: kpi.status === 'NOT_SUBMITTED' ? 'DRAFT' : kpi.status },
      reason,
      meta,
    });

    await this.notifications.notify({
      code: NT.CORRECTION_OR_REOPEN,
      recipients: [
        {
          userId: kpi.employee.id,
          email: kpi.employee.email,
          fullName: kpi.employee.fullName,
          emailDigest: kpi.employee.emailDigest,
        },
      ],
      title: `Extension granted for “${kpi.name}” until ${formatDate(until)}`,
      body: `Your Department Head granted a ${days}-day extension for ${kpi.name} in ${kpi.period.label}. ${kpi.status === 'NOT_SUBMITTED' ? 'The KPI is back in Draft — complete and submit it before the new deadline.' : ''}`.trim(),
      deepLink: `/my-kpi?kpi=${kpi.id}`,
      entityType: 'kpi',
      entityId: kpi.id,
      severity: 'info',
      emailContext: {
        eventTitle: 'KPI submission extension granted',
        subject: `${kpi.name} — extension until ${formatDate(until)}`,
        detail: `A ${days}-day extension was granted by ${user.fullName} for ${kpi.period.label}.`,
        rows: [
          { label: 'KPI', value: kpi.name },
          { label: 'Period', value: kpi.period.label },
          { label: 'New deadline', value: formatDate(until) },
          { label: 'Reason', value: reason },
        ],
        ctaLabel: 'Open My KPI',
        linkUrl: this.appUrl(`/my-kpi?kpi=${kpi.id}`),
      },
    });

    return {
      extension,
      kpiId,
      statusAfter: kpi.status === 'NOT_SUBMITTED' ? 'DRAFT' : kpi.status,
      until,
    };
  }

  /** GET /admin/periods/extensions — extension history, optionally per period. */
  async listExtensions(periodId?: string, query?: ExtensionListQuery) {
    const { page, size, skip, take } = this.paging(query);
    const where: Prisma.KpiExtensionWhereInput = periodId ? { periodId } : {};

    const [total, items] = await Promise.all([
      this.prisma.kpiExtension.count({ where }),
      this.prisma.kpiExtension.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          kpi: {
            select: {
              id: true,
              code: true,
              name: true,
              status: true,
              employee: { select: { id: true, fullName: true, employeeCode: true } },
            },
          },
          period: { select: { id: true, code: true, label: true, frequency: true, status: true } },
          grantedBy: { select: { id: true, fullName: true } },
        },
      }),
    ]);

    return {
      items,
      page,
      size,
      total,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  // ------------------------------------------------------- close-dialog outstanding

  /**
   * Outstanding items used by the close dialog: pending decisions, not-submitted
   * KPIs and employees whose allocated weight is below 100 (FR-CFG-03).
   */
  async outstanding(periodId: string) {
    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'Period not found.');

    const kpiSelect = {
      id: true,
      code: true,
      name: true,
      status: true,
      employeeId: true,
      kpiWeight: true,
      employee: {
        select: {
          fullName: true,
          employeeCode: true,
          department: { select: { id: true, name: true } },
        },
      },
    } as const;

    const [pending, notSubmitted, weightRows] = await Promise.all([
      this.prisma.kpi.findMany({
        where: { periodId, status: { in: [...CLOSE_BLOCKING_STATUSES] } },
        select: kpiSelect,
        orderBy: { createdAt: 'asc' },
        take: 50_000,
      }),
      this.prisma.kpi.findMany({
        where: { periodId, status: 'NOT_SUBMITTED' },
        select: kpiSelect,
        orderBy: { createdAt: 'asc' },
        take: 50_000,
      }),
      this.prisma.kpi.groupBy({
        by: ['employeeId'],
        where: {
          periodId,
          frequency: period.frequency,
          status: { notIn: ['REJECTED', 'DELETED'] },
        },
        _sum: { kpiWeight: true },
      }),
    ]);

    const incomplete = weightRows.filter((row) => (row._sum.kpiWeight ?? 0) < 100);
    const employees = incomplete.length
      ? await this.prisma.user.findMany({
          where: { id: { in: incomplete.map((row) => row.employeeId) } },
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            department: { select: { id: true, name: true } },
          },
        })
      : [];
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const mapKpi = (kpi: (typeof pending)[number]) => ({
      id: kpi.id,
      code: kpi.code,
      name: kpi.name,
      status: kpi.status,
      employeeId: kpi.employeeId,
      employeeName: kpi.employee.fullName,
      employeeCode: kpi.employee.employeeCode,
      department: kpi.employee.department?.name ?? null,
      weight: kpi.kpiWeight,
    });

    const weightIncomplete = incomplete.map((row) => {
      const employee = employeeMap.get(row.employeeId);
      const allocated = row._sum.kpiWeight ?? 0;
      return {
        employeeId: row.employeeId,
        employeeName: employee?.fullName ?? '—',
        employeeCode: employee?.employeeCode ?? '—',
        department: employee?.department?.name ?? null,
        allocatedWeight: allocated,
        remaining: Math.max(0, 100 - allocated),
      };
    });

    return {
      period: this.periodSnapshot(period),
      counts: {
        pending: pending.length,
        notSubmitted: notSubmitted.length,
        weightIncomplete: weightIncomplete.length,
        total: pending.length + notSubmitted.length,
      },
      pending: pending.map(mapKpi),
      notSubmitted: notSubmitted.map(mapKpi),
      weightIncomplete,
    };
  }

  // -------------------------------------------------------------- period pickers

  /** GET /admin/periods/current?frequency= — the current period for the selector. */
  async current(frequency?: string) {
    const freq = (
      frequency && FREQUENCIES.includes(frequency as FrequencyKey) ? frequency : 'MONTHLY'
    ) as FrequencyKey;
    const descriptor = currentPeriodDescriptor(freq);

    const byDate = await this.prisma.kpiPeriod.findUnique({
      where: { frequency_startDate: { frequency: freq, startDate: descriptor.startDate } },
    });
    if (byDate) return byDate;

    return this.prisma.kpiPeriod.findFirst({
      where: { frequency: freq, status: { in: ['OPEN', 'REOPENED'] } },
      orderBy: { startDate: 'desc' },
    });
  }

  /** GET /periods/selectable — open/reopened periods for the UI picker. */
  async selectable() {
    return this.prisma.kpiPeriod.findMany({
      where: { status: { in: ['OPEN', 'REOPENED'] } },
      orderBy: { startDate: 'desc' },
      select: {
        id: true,
        code: true,
        label: true,
        frequency: true,
        status: true,
        submissionDeadline: true,
        reviewDeadline: true,
      },
    });
  }
}
