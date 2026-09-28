import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';

export interface AuditRecordInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  actor?: Pick<AuthUser, 'id' | 'roles'> | null;
  actorKind?: 'USER' | 'SYSTEM' | 'ANONYMOUS';
  employeeId?: string | null;
  departmentId?: string | null;
  businessUnitId?: string | null;
  before?: unknown;
  after?: unknown;
  changedFields?: unknown;
  reason?: string | null;
  meta?: RequestContextMeta;
}

/**
 * Append-only, hash-chained audit trail — BRD §18, BR-R11, NFR-AUD-01.
 *
 * Every record stores `previousHash` (the hash of the preceding record) and its
 * own `recordHash`, so removing or editing any row breaks the chain and is
 * detected by the weekly verification job (AuditService.verifyChain).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private static readonly GENESIS = '0'.repeat(64);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      const previous = await client.auditLog.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { recordHash: true },
      });
      const previousHash = previous?.recordHash ?? AuditService.GENESIS;

      const payload = {
        actorId: input.actor?.id ?? null,
        actorKind: input.actorKind ?? (input.actor ? 'USER' : 'ANONYMOUS'),
        actorRole: input.actor?.roles?.join(',') ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        employeeId: input.employeeId ?? null,
        departmentId: input.departmentId ?? null,
        businessUnitId: input.businessUnitId ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
        changedFields: input.changedFields ?? null,
        reason: input.reason ?? null,
        ipAddress: input.meta?.ip ?? null,
        userAgent: input.meta?.userAgent ?? null,
        correlationId: input.meta?.correlationId ?? null,
        at: new Date().toISOString(),
      };

      const recordHash = AuditService.hash(previousHash, payload);

      await client.auditLog.create({
        data: {
          actorId: payload.actorId,
          actorKind: payload.actorKind as Prisma.AuditLogCreateInput['actorKind'],
          actorRole: payload.actorRole,
          action: payload.action,
          entityType: payload.entityType,
          entityId: payload.entityId,
          employeeId: payload.employeeId,
          departmentId: payload.departmentId,
          businessUnitId: payload.businessUnitId,
          before: payload.before as Prisma.InputJsonValue,
          after: payload.after as Prisma.InputJsonValue,
          changedFields: payload.changedFields as Prisma.InputJsonValue,
          reason: payload.reason,
          ipAddress: payload.ipAddress,
          userAgent: payload.userAgent,
          correlationId: payload.correlationId,
          previousHash,
          recordHash,
        },
      });
    } catch (e) {
      // An audit failure must never silently pass: it is surfaced in the log and
      // the caller's transaction is expected to roll back.
      this.logger.error(`Audit write failed for ${input.action} on ${input.entityType}: ${(e as Error).message}`);
      throw e;
    }
  }

  private static hash(previousHash: string, payload: unknown): string {
    return createHash('sha256')
      .update(previousHash)
      .update('|')
      .update(AuditService.stableStringify(payload))
      .digest('hex');
  }

  /** Deterministic JSON so the hash is reproducible. */
  private static stableStringify(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => AuditService.stableStringify(v)).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${AuditService.stableStringify(v)}`)
      .join(',')}}`;
  }

  /**
   * Weekly hash-chain verification (§18) — returns the first broken record, or
   * `null` when the chain is intact.
   */
  async verifyChain(
    limit = 200_000,
  ): Promise<{ ok: boolean; checked: number; brokenAt?: { id: string; action: string; createdAt: Date } }> {
    let previousHash = AuditService.GENESIS;
    let checked = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.prisma.auditLog.findMany({
        take: 2000,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (batch.length === 0) break;

      for (const row of batch) {
        const expected = AuditService.hash(previousHash, {
          actorId: row.actorId,
          actorKind: row.actorKind,
          actorRole: row.actorRole,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          employeeId: row.employeeId,
          departmentId: row.departmentId,
          businessUnitId: row.businessUnitId,
          before: row.before ?? null,
          after: row.after ?? null,
          changedFields: row.changedFields ?? null,
          reason: row.reason,
          ipAddress: row.ipAddress,
          userAgent: row.userAgent,
          correlationId: row.correlationId,
          at: row.createdAt.toISOString(),
        });
        checked += 1;
        if (row.previousHash !== previousHash || expected !== row.recordHash) {
          return {
            ok: false,
            checked,
            brokenAt: { id: row.id, action: row.action, createdAt: row.createdAt },
          };
        }
        previousHash = row.recordHash;
      }

      cursor = batch[batch.length - 1].id;
      if (checked >= limit) break;
    }

    return { ok: true, checked };
  }

  /** Filtered, paginated audit viewer (FR-AUD-04). */
  async list(params: {
    page: number;
    size: number;
    actorId?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    from?: string;
    to?: string;
    scopeDepartmentIds?: string[] | null;
  }) {
    const where: Prisma.AuditLogWhereInput = {};
    if (params.actorId) where.actorId = params.actorId;
    if (params.action) where.action = { contains: params.action, mode: 'insensitive' };
    if (params.entityType) where.entityType = params.entityType;
    if (params.entityId) where.entityId = params.entityId;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(params.from);
      if (params.to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(params.to);
    }
    if (params.scopeDepartmentIds && params.scopeDepartmentIds.length) {
      where.departmentId = { in: params.scopeDepartmentIds };
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.size,
        take: params.size,
        include: {
          actor: { select: { id: true, fullName: true, email: true, employeeCode: true } },
          department: { select: { id: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page: params.page,
      size: params.size,
      totalPages: Math.max(1, Math.ceil(total / params.size)),
    };
  }
}
