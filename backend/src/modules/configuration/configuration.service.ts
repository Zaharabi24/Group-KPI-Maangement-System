/**
 * Configuration versions & recalculation — FR-CFG-02, §4.9.
 *
 * Configuration is versioned and immutable once published: publishing creates a
 * new version and deactivates the previous one. Open periods can be recalculated
 * against the active configuration without touching closed (historical) periods.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { AUDIT_ACTIONS, KPI_CATEGORIES } from '../../common/constants';
import {
  BadRequest,
  Conflict,
  ErrorCode,
  FieldError,
  NotFound,
  Unprocessable,
} from '../../common/errors/error-codes';
import { calculateKpi, DEFAULT_QUALITATIVE_MAP } from '../calculation/calculation.engine';
import { dec, num } from '../../common/utils/decimal.util';
import { isoDate, toDate } from '../../common/utils/period.util';

const KNOWN_CATEGORIES: string[] = KPI_CATEGORIES.map((c) => c.code);

const DEFAULT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** Platform defaults, used when no configuration version has been published yet. */
export const DEFAULT_CONFIGURATION = {
  id: null as string | null,
  version: 0,
  effectiveFrom: null as Date | null,
  scoreCap: '120.00',
  scoreFloor: '0.00',
  adjustmentBand: '10.00',
  minWeight: 5,
  maxWeight: 50,
  maxKpisPerPeriod: 10,
  submissionGraceDays: 7,
  reviewWindowDays: 7,
  reviewSlaDays: 5,
  extensionMaxDays: 7,
  minReasonLength: 15,
  maxEvidenceFiles: 5,
  maxEvidenceSizeMb: 10,
  qualitativeMap: DEFAULT_QUALITATIVE_MAP as Record<string, number>,
  ragThresholds: { green: 95, amber: 75 },
  categories: KNOWN_CATEGORIES,
  allowedMimeTypes: DEFAULT_ALLOWED_MIME_TYPES,
  isActive: true,
  notes: null as string | null,
  publishedById: null as string | null,
  createdAt: null as Date | null,
};

interface PublishInput {
  effectiveFrom?: string;
  scoreCap?: number;
  scoreFloor?: number;
  adjustmentBand?: number;
  minWeight?: number;
  maxWeight?: number;
  maxKpisPerPeriod?: number;
  submissionGraceDays?: number;
  reviewWindowDays?: number;
  reviewSlaDays?: number;
  extensionMaxDays?: number;
  minReasonLength?: number;
  maxEvidenceFiles?: number;
  maxEvidenceSizeMb?: number;
  qualitativeMap?: Record<string, number>;
  ragThresholds?: { green: number; amber: number };
  categories?: string[];
  allowedMimeTypes?: string[];
  notes?: string;
}

@Injectable()
export class ConfigurationService {
  private readonly logger = new Logger(ConfigurationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------- reads

  /** The active version (highest version with isActive) or the platform defaults. */
  async active() {
    const row = await this.prisma.configurationVersion.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    return row ?? { ...DEFAULT_CONFIGURATION };
  }

  /** All versions, newest first. */
  async list() {
    return this.prisma.configurationVersion.findMany({
      orderBy: { version: 'desc' },
      include: {
        publishedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  // ------------------------------------------------------------- FR-CFG-02 publish

  /** Validate and publish a new immutable configuration version (Super Admin only). */
  async publish(dto: PublishInput, user: AuthUser, meta: RequestContextMeta) {
    const current = await this.prisma.configurationVersion.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });

    const pick = (value: number | undefined | null, fallback: number): number => {
      if (value === undefined || value === null) return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const pickInt = (value: number | undefined | null, fallback: number): number =>
      Math.trunc(pick(value, fallback));

    const scoreCap = pick(dto.scoreCap, num(current?.scoreCap, 120));
    const scoreFloor = pick(dto.scoreFloor, num(current?.scoreFloor, 0));
    const adjustmentBand = pick(dto.adjustmentBand, num(current?.adjustmentBand, 10));
    const minWeight = pickInt(dto.minWeight, current?.minWeight ?? 5);
    const maxWeight = pickInt(dto.maxWeight, current?.maxWeight ?? 50);
    const maxKpisPerPeriod = pickInt(dto.maxKpisPerPeriod, current?.maxKpisPerPeriod ?? 10);
    const submissionGraceDays = pickInt(dto.submissionGraceDays, current?.submissionGraceDays ?? 7);
    const reviewWindowDays = pickInt(dto.reviewWindowDays, current?.reviewWindowDays ?? 7);
    const reviewSlaDays = pickInt(dto.reviewSlaDays, current?.reviewSlaDays ?? 5);
    const extensionMaxDays = pickInt(dto.extensionMaxDays, current?.extensionMaxDays ?? 7);
    const minReasonLength = pickInt(dto.minReasonLength, current?.minReasonLength ?? 15);
    const maxEvidenceFiles = pickInt(dto.maxEvidenceFiles, current?.maxEvidenceFiles ?? 5);
    const maxEvidenceSizeMb = pickInt(dto.maxEvidenceSizeMb, current?.maxEvidenceSizeMb ?? 10);

    const errors: FieldError[] = [];
    const range = (field: string, value: number, min: number, max: number) => {
      if (!(value >= min && value <= max)) {
        errors.push({
          field,
          code: ErrorCode.VALIDATION_FAILED,
          message: `${field} must be between ${min} and ${max}`,
        });
      }
    };

    range('scoreCap', scoreCap, 100, 200);
    if (!(scoreFloor >= 0)) {
      errors.push({ field: 'scoreFloor', code: ErrorCode.VALIDATION_FAILED, message: 'scoreFloor must be 0 or greater' });
    }
    range('adjustmentBand', adjustmentBand, 0, 50);
    range('minWeight', minWeight, 1, 50);
    if (maxWeight < minWeight || maxWeight > 100) {
      errors.push({
        field: 'maxWeight',
        code: ErrorCode.VALIDATION_FAILED,
        message: 'maxWeight must be greater than or equal to minWeight and at most 100',
      });
    }
    range('maxKpisPerPeriod', maxKpisPerPeriod, 1, 50);
    range('submissionGraceDays', submissionGraceDays, 0, 30);
    range('reviewWindowDays', reviewWindowDays, 0, 30);
    range('reviewSlaDays', reviewSlaDays, 1, 30);
    range('extensionMaxDays', extensionMaxDays, 1, 30);
    range('minReasonLength', minReasonLength, 5, 100);
    range('maxEvidenceFiles', maxEvidenceFiles, 1, 10);
    range('maxEvidenceSizeMb', maxEvidenceSizeMb, 1, 50);

    // qualitativeMap — all five rubric levels present and numeric (§4.2, A-10).
    const qualitativeMap: Record<string, number> = {};
    const mapRaw: unknown = dto.qualitativeMap ?? current?.qualitativeMap ?? DEFAULT_QUALITATIVE_MAP;
    if (!mapRaw || typeof mapRaw !== 'object' || Array.isArray(mapRaw)) {
      errors.push({
        field: 'qualitativeMap',
        code: ErrorCode.VALIDATION_FAILED,
        message: 'qualitativeMap must be an object with numeric keys "1".."5"',
      });
    } else {
      let mapValid = true;
      for (let level = 1; level <= 5; level += 1) {
        const value = (mapRaw as Record<string, unknown>)[String(level)];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          mapValid = false;
          break;
        }
        qualitativeMap[String(level)] = value;
      }
      if (!mapValid) {
        errors.push({
          field: 'qualitativeMap',
          code: ErrorCode.VALIDATION_FAILED,
          message: 'qualitativeMap must contain numeric values for keys "1", "2", "3", "4" and "5"',
        });
      }
    }

    // ragThresholds — { green, amber } with green > amber (§4.5).
    const ragRaw = (dto.ragThresholds ?? current?.ragThresholds ?? { green: 95, amber: 75 }) as unknown;
    let ragThresholds = { green: 95, amber: 75 };
    if (!ragRaw || typeof ragRaw !== 'object' || Array.isArray(ragRaw)) {
      errors.push({
        field: 'ragThresholds',
        code: ErrorCode.VALIDATION_FAILED,
        message: 'ragThresholds must be an object with numeric green and amber values',
      });
    } else {
      const green = Number((ragRaw as Record<string, unknown>).green);
      const amber = Number((ragRaw as Record<string, unknown>).amber);
      if (!Number.isFinite(green) || !Number.isFinite(amber) || !(green > amber)) {
        errors.push({
          field: 'ragThresholds',
          code: ErrorCode.VALIDATION_FAILED,
          message: 'ragThresholds.green must be greater than ragThresholds.amber',
        });
      } else {
        ragThresholds = { green, amber };
      }
    }

    // categories — non-empty array of the four known KPI category codes.
    const categoriesRaw: unknown = dto.categories ?? current?.categories ?? KNOWN_CATEGORIES;
    let categories: string[] = KNOWN_CATEGORIES;
    if (
      !Array.isArray(categoriesRaw) ||
      categoriesRaw.length === 0 ||
      !categoriesRaw.every((c) => typeof c === 'string' && KNOWN_CATEGORIES.includes(c))
    ) {
      errors.push({
        field: 'categories',
        code: ErrorCode.VALIDATION_FAILED,
        message: `categories must be a non-empty array drawn from ${KNOWN_CATEGORIES.join(', ')}`,
      });
    } else {
      categories = categoriesRaw as string[];
    }

    // allowedMimeTypes — optional; must be strings when supplied.
    const mimeRaw: unknown = dto.allowedMimeTypes ?? current?.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;
    let allowedMimeTypes: string[] = DEFAULT_ALLOWED_MIME_TYPES;
    if (!Array.isArray(mimeRaw) || !mimeRaw.every((m) => typeof m === 'string')) {
      errors.push({
        field: 'allowedMimeTypes',
        code: ErrorCode.VALIDATION_FAILED,
        message: 'allowedMimeTypes must be an array of MIME type strings',
      });
    } else {
      allowedMimeTypes = mimeRaw as string[];
    }

    if (errors.length) {
      throw BadRequest(ErrorCode.VALIDATION_FAILED, 'The configuration could not be published.', errors);
    }

    const effectiveFrom = dto.effectiveFrom ? toDate(dto.effectiveFrom) : toDate(new Date());
    const max = await this.prisma.configurationVersion.aggregate({ _max: { version: true } });
    const version = (max._max.version ?? 0) + 1;

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.configurationVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      return tx.configurationVersion.create({
        data: {
          version,
          effectiveFrom,
          scoreCap: scoreCap.toFixed(2),
          scoreFloor: scoreFloor.toFixed(2),
          adjustmentBand: adjustmentBand.toFixed(2),
          minWeight,
          maxWeight,
          maxKpisPerPeriod,
          submissionGraceDays,
          reviewWindowDays,
          reviewSlaDays,
          extensionMaxDays,
          minReasonLength,
          maxEvidenceFiles,
          maxEvidenceSizeMb,
          qualitativeMap: qualitativeMap as Prisma.InputJsonValue,
          ragThresholds: ragThresholds as Prisma.InputJsonValue,
          categories: categories as Prisma.InputJsonValue,
          allowedMimeTypes: allowedMimeTypes as Prisma.InputJsonValue,
          isActive: true,
          notes: dto.notes ?? null,
          publishedById: user.id,
        },
      });
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.CONFIG_PUBLISH,
      entityType: 'configuration_version',
      entityId: created.id,
      actor: user,
      before: current ? { version: current.version, isActive: true } : null,
      after: {
        version: created.version,
        effectiveFrom: isoDate(effectiveFrom),
        scoreCap,
        scoreFloor,
        adjustmentBand,
        minWeight,
        maxWeight,
        maxKpisPerPeriod,
        categories,
      },
      reason: dto.notes ?? null,
      meta,
    });

    return created;
  }

  // ------------------------------------------------------- §4.9 recalculate open

  /**
   * §4.9 — "Recalculate open period with current configuration": re-run the
   * calculation engine for every non-deleted KPI of an OPEN/REOPENED period,
   * persist the new scores and write a CalculationLog row per KPI.
   */
  async recalculate(periodId: string, reason: string, user: AuthUser, meta: RequestContextMeta) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 15) {
      throw Unprocessable(ErrorCode.REASON_REQUIRED, 'A reason of at least 15 characters is required to recalculate.');
    }

    const period = await this.prisma.kpiPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw NotFound(ErrorCode.NOT_FOUND, 'Period not found.');
    if (period.status === 'CLOSED') {
      throw Conflict(ErrorCode.PERIOD_CLOSED, 'Only open or reopened periods can be recalculated.');
    }

    const config = await this.prisma.configurationVersion.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    const qualitativeMap = (config?.qualitativeMap ?? DEFAULT_QUALITATIVE_MAP) as Record<string, number>;

    const kpis = await this.prisma.kpi.findMany({
      where: { periodId, status: { notIn: ['DELETED'] } },
      select: {
        id: true,
        code: true,
        target: true,
        actual: true,
        rubricLevel: true,
        kpiWeight: true,
        direction: true,
        measurementType: true,
        overrideScore: true,
        configVersionId: true,
        achievement: true,
        calculatedScore: true,
        finalScore: true,
        weightedScore: true,
      },
      take: 100_000,
    });

    let changed = 0;
    const changedKpis: Array<{
      id: string;
      code: string;
      before: Record<string, string | null>;
      after: Record<string, string | null>;
    }> = [];

    for (const kpi of kpis) {
      const computable =
        kpi.measurementType === 'QUALITATIVE'
          ? kpi.rubricLevel !== null || kpi.actual !== null
          : kpi.target !== null && kpi.actual !== null;
      if (!computable) continue;

      let result;
      try {
        result = calculateKpi({
          target: kpi.target,
          actual: kpi.actual,
          rubricLevel: kpi.rubricLevel,
          kpiWeight: kpi.kpiWeight,
          direction: kpi.direction,
          measurementType: kpi.measurementType,
          overrideScore: kpi.overrideScore,
          config: {
            scoreCap: config?.scoreCap ?? 120,
            scoreFloor: config?.scoreFloor ?? 0,
            qualitativeMap,
          },
        });
      } catch (e) {
        this.logger.warn(`Recalculation skipped KPI ${kpi.code}: ${(e as Error).message}`);
        continue;
      }

      const before = {
        achievement: dec(kpi.achievement),
        calculatedScore: dec(kpi.calculatedScore),
        finalScore: dec(kpi.finalScore),
        weightedScore: dec(kpi.weightedScore),
      };
      const after = {
        achievement: dec(result.achievement),
        calculatedScore: dec(result.calculatedScore),
        finalScore: dec(result.finalScore),
        weightedScore: dec(result.weightedScore),
      };
      const scoreChanged =
        before.achievement !== after.achievement ||
        before.calculatedScore !== after.calculatedScore ||
        before.finalScore !== after.finalScore ||
        before.weightedScore !== after.weightedScore;

      const startedAt = Date.now();
      await this.prisma.kpi.update({
        where: { id: kpi.id },
        data: {
          achievement: result.achievement.toString(),
          calculatedScore: result.calculatedScore.toString(),
          finalScore: result.finalScore.toString(),
          weightedScore: result.weightedScore.toString(),
          configVersionId: config?.id ?? null,
          lastCalculatedAt: new Date(),
          ...(scoreChanged ? { rowVersion: { increment: 1 } } : {}),
        },
      });

      await this.prisma.calculationLog.create({
        data: {
          kpiId: kpi.id,
          inputs: {
            target: dec(kpi.target),
            actual: dec(kpi.actual),
            rubricLevel: kpi.rubricLevel,
            kpiWeight: kpi.kpiWeight,
            direction: kpi.direction,
            measurementType: kpi.measurementType,
            overrideScore: dec(kpi.overrideScore),
          } as Prisma.InputJsonValue,
          outputs: {
            achievement: after.achievement,
            calculatedScore: after.calculatedScore,
            finalScore: after.finalScore,
            weightedScore: after.weightedScore,
          } as Prisma.InputJsonValue,
          formulaText: result.formulaText.slice(0, 1000),
          configVersionId: config?.id ?? null,
          trigger: 'RECALCULATE',
          actorId: user.id,
          durationMs: Date.now() - startedAt,
        },
      });

      if (scoreChanged) {
        changed += 1;
        changedKpis.push({ id: kpi.id, code: kpi.code, before, after });
      }
    }

    await this.audit.record({
      action: AUDIT_ACTIONS.CONFIG_RECALCULATE,
      entityType: 'kpi_period',
      entityId: periodId,
      actor: user,
      after: {
        period: period.code,
        configurationVersion: config?.version ?? 0,
        checked: kpis.length,
        changed,
        kpiIds: changedKpis.map((k) => k.id),
      },
      reason: trimmed,
      meta,
    });

    return { checked: kpis.length, changed, changedKpis };
  }
}
