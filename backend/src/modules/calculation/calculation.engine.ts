/**
 * ============================================================================
 *  KPI CALCULATION ENGINE — BRD §4 (FR-CAL-01)
 * ============================================================================
 *  A pure, deterministic, dependency-free function set. The same algorithm is
 *  implemented in `frontend/src/lib/calculation.ts` so the UI preview and the
 *  stored server result are always identical (AC-05).
 *
 *  All arithmetic uses decimal (fixed-point) types, never binary floating point.
 *  Rounding mode is ROUND_HALF_UP at every step (§4.4); later steps consume the
 *  rounded value from the step before, so results can be reproduced by hand.
 * ============================================================================
 */
import { Decimal, Numeric, D, round2 } from '../../common/utils/decimal.util';

export type CalcDirection = 'HIGHER' | 'LOWER';
export type CalcMeasurementType =
  | 'COUNT'
  | 'MONETARY'
  | 'PERCENTAGE'
  | 'TIME'
  | 'RATING'
  | 'QUALITATIVE';

/** Qualitative rubric map — L1..L5 (§4.2, A-10). */
export const DEFAULT_QUALITATIVE_MAP: Record<string, number> = {
  '1': 50,
  '2': 75,
  '3': 100,
  '4': 110,
  '5': 120,
};

export interface CalcConfig {
  scoreCap: Numeric; // default 120.00
  scoreFloor: Numeric; // default 0.00
  qualitativeMap?: Record<string, number> | null;
}

export const DEFAULT_CALC_CONFIG: CalcConfig = {
  scoreCap: 120,
  scoreFloor: 0,
  qualitativeMap: DEFAULT_QUALITATIVE_MAP,
};

export interface CalcInput {
  target: Numeric | null;
  actual: Numeric | null;
  rubricLevel?: number | null;
  kpiWeight: Numeric;
  direction: CalcDirection;
  measurementType: CalcMeasurementType;
  overrideScore?: Numeric | null;
  config?: Partial<CalcConfig> | null;
}

export interface CalcResult {
  /** ACH — uncapped achievement %, floored at 0. */
  achievement: Decimal;
  /** CS — calculated score = min(ACH, CAP). */
  calculatedScore: Decimal;
  /** FS — final score = approved override if present, otherwise CS. */
  finalScore: Decimal;
  /** WS — weighted score. */
  weightedScore: Decimal;
  /** Human-readable formula actually used (§4.9). */
  formulaText: string;
  /** True when an override produced the final score. */
  hasOverride: boolean;
  /** True when ACH exceeded the cap, so CS < ACH. */
  capped: boolean;
  /** True when ACH was floored at 0. */
  floored: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export class CalculationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Achievement % — §4.2
 *
 *  HIGHER, T > 0 : ACH = (A / T) × 100
 *  LOWER,  T > 0 : ACH = ((2T − A) / T) × 100
 *  LOWER,  T = 0 : ACH = 100 if A = 0, otherwise 0            (zero tolerance)
 *  HIGHER, T = 0 : invalid — blocked at entry (V-TGT-01)
 *  RATING        : ACH = (A / T) × 100   (scale bounds validated at entry)
 *  QUALITATIVE   : ACH = MAP[level]      (L1 = 50 … L5 = 120)
 *  then          : ACH = max(round_half_up(ACH, 2), 0.00)
 */
export const computeAchievement = (
  input: Pick<
    CalcInput,
    'target' | 'actual' | 'rubricLevel' | 'direction' | 'measurementType' | 'config'
  >,
): { achievement: Decimal; formulaText: string; floored: boolean } => {
  const { direction, measurementType } = input;
  const t = D(input.target);
  const a = D(input.actual);

  if (measurementType === 'QUALITATIVE') {
    const level = input.rubricLevel ?? (input.actual !== null && input.actual !== undefined ? Number(a.toFixed(0)) : null);
    if (level === null || level === undefined || Number.isNaN(level)) {
      throw new CalculationError('V-NUM-02', 'Rubric level is required for a qualitative KPI');
    }
    const map = input.config?.qualitativeMap ?? DEFAULT_QUALITATIVE_MAP;
    const mapped = map[String(level)];
    if (mapped === undefined) {
      throw new CalculationError('V-NUM-02', `Rubric level ${level} is not defined in the rubric map`);
    }
    return {
      achievement: round2(String(mapped)),
      formulaText: `rubric_map[Level ${level}] = ${mapped}`,
      floored: false,
    };
  }

  if (measurementType === 'RATING') {
    if (t.lte(0)) {
      throw new CalculationError('V-TGT-01', 'Target must be greater than 0 for a Rating KPI');
    }
    const raw = a.div(t).mul(100);
    const floored = raw.lt(0);
    return {
      achievement: Decimal.max(round2(raw), new Decimal(0)),
      formulaText: `(actual ${strip(a)} / target ${strip(t)}) × 100`,
      floored,
    };
  }

  if (direction === 'HIGHER') {
    if (t.lte(0)) {
      // V-TGT-01 — blocked at entry
      throw new CalculationError('V-TGT-01', 'Target must be greater than 0 for higher-is-better KPIs');
    }
    const raw = a.div(t).mul(100);
    return {
      achievement: Decimal.max(round2(raw), new Decimal(0)),
      formulaText: `(actual ${strip(a)} / target ${strip(t)}) × 100`,
      floored: raw.lt(0),
    };
  }

  // LOWER is better
  if (t.eq(0)) {
    // Zero-tolerance KPI: 100 when nothing happened, 0 otherwise
    if (a.eq(0)) {
      return {
        achievement: new Decimal(100),
        formulaText: 'target 0 (zero tolerance): actual 0 → 100',
        floored: false,
      };
    }
    return {
      achievement: new Decimal(0),
      formulaText: `target 0 (zero tolerance): actual ${strip(a)} > 0 → 0`,
      floored: false,
    };
  }
  const raw = t.mul(2).minus(a).div(t).mul(100);
  return {
    achievement: Decimal.max(round2(raw), new Decimal(0)),
    formulaText: `((2 × target ${strip(t)} − actual ${strip(a)}) / target ${strip(t)}) × 100`,
    floored: raw.lt(0),
  };
};

/**
 * Full engine — §4.2, §4.3.
 *   CS = min(ACH, CAP)
 *   FS = OVERRIDE (if approved) else CS
 *   WS = round_half_up(FS × W ÷ 100, 2)
 */
export const calculateKpi = (input: CalcInput): CalcResult => {
  const config: CalcConfig = {
    scoreCap: input.config?.scoreCap ?? DEFAULT_CALC_CONFIG.scoreCap,
    scoreFloor: input.config?.scoreFloor ?? DEFAULT_CALC_CONFIG.scoreFloor,
    qualitativeMap: input.config?.qualitativeMap ?? DEFAULT_QUALITATIVE_MAP,
  };

  const { achievement, formulaText, floored } = computeAchievement({
    ...input,
    config,
  });

  const cap = D(config.scoreCap);
  const floor = D(config.scoreFloor);

  const capped = achievement.gt(cap);
  const calculatedScore = Decimal.min(achievement, cap);

  const hasOverride =
    input.overrideScore !== null &&
    input.overrideScore !== undefined &&
    input.overrideScore !== '';

  const finalScore = hasOverride
    ? Decimal.max(Decimal.min(D(input.overrideScore), cap), floor)
    : Decimal.max(calculatedScore, floor);

  const weight = D(input.kpiWeight);
  const weightedScore = round2(finalScore.mul(weight).div(100));

  return {
    achievement,
    calculatedScore,
    finalScore,
    weightedScore,
    formulaText,
    hasOverride,
    capped,
    floored,
  };
};

/**
 * ADJ-2 band test — §4.7.
 *   Δ = |FS at approval − CS as submitted by the employee|
 *   Δ ≤ band → the adjustment itself is the approval
 *   Δ >  band → Escalated (Super Admin decides)
 */
export const bandTest = (
  finalScore: Numeric,
  calculatedScoreAsSubmitted: Numeric,
  band: Numeric,
): { delta: Decimal; withinBand: boolean } => {
  const delta = round2(D(finalScore).minus(D(calculatedScoreAsSubmitted)).abs());
  return { delta, withinBand: delta.lte(D(band)) };
};

/** A stable decimal→string helper for formula text. */
const strip = (value: Decimal): string => {
  const s = value.toFixed(2);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
};

/** §4.5 — RAG thresholds (Green ≥ 95, Amber 75–94.99, Red < 75). */
export const ragFor = (
  value: Numeric,
  thresholds: { green: number; amber: number } = { green: 95, amber: 75 },
): 'GREEN' | 'AMBER' | 'RED' => {
  const v = D(value);
  if (v.gte(thresholds.green)) return 'GREEN';
  if (v.gte(thresholds.amber)) return 'AMBER';
  return 'RED';
};

/** §4.5 — the six-step stepper mapping used by the KPI card. */
export const stepperFor = (kpi: {
  status: string;
  target?: Numeric | null;
  actual?: Numeric | null;
  evidenceCount?: number | null;
  calculatedScore?: Numeric | null;
  reviewStartedAt?: Date | string | null;
  decidedAt?: Date | string | null;
}): { step: number; states: Array<'done' | 'current' | 'todo' | 'error'> } => {
  const targetDone = kpi.target !== null && kpi.target !== undefined;
  const actualDone = kpi.actual !== null && kpi.actual !== undefined;
  const evidenceDone = (kpi.evidenceCount ?? 0) > 0;
  const scoreDone = kpi.calculatedScore !== null && kpi.calculatedScore !== undefined;

  const states: Array<'done' | 'current' | 'todo' | 'error'> = [
    targetDone ? 'done' : 'todo',
    actualDone ? 'done' : 'todo',
    evidenceDone ? 'done' : 'todo',
    scoreDone ? 'done' : 'todo',
    'todo',
    'todo',
  ];

  switch (kpi.status) {
    case 'DRAFT':
      break;
    case 'SUBMITTED':
      states[4] = 'current';
      break;
    case 'UNDER_REVIEW':
    case 'ESCALATED':
      states[4] = 'current';
      break;
    case 'RETURNED':
      states[4] = 'error';
      break;
    case 'REJECTED':
      states[5] = 'error';
      break;
    case 'APPROVED':
      states[4] = 'done';
      states[5] = 'done';
      break;
    case 'NOT_SUBMITTED':
      for (let i = 0; i < states.length; i += 1) states[i] = 'todo';
      break;
    default:
      break;
  }

  const firstPending = states.findIndex((s) => s !== 'done');
  return { step: firstPending === -1 ? 6 : firstPending, states };
};

/** §4.5 — period aggregates over the set S of Approved KPIs. */
export interface AggregateRow {
  achievement: Numeric | null;
  finalScore: Numeric | null;
  weightedScore: Numeric | null;
  kpiWeight: number;
  status: string;
}

export interface AggregateResult {
  totalKpiScore: Decimal;
  averageAchievement: Decimal;
  allocatedWeight: number;
  approvedCount: number;
  totalCount: number;
  belowTargetCount: number;
  rag: 'GREEN' | 'AMBER' | 'RED';
}

export const aggregatePeriod = (
  rows: AggregateRow[],
  thresholds?: { green: number; amber: number },
): AggregateResult => {
  const approved = rows.filter((r) => r.status === 'APPROVED');
  const counted = rows.filter((r) => r.status !== 'DELETED');

  let totalScore = new Decimal(0);
  let weightedAchNumerator = new Decimal(0);
  let weightSum = new Decimal(0);

  for (const r of approved) {
    totalScore = totalScore.plus(D(r.weightedScore));
    weightedAchNumerator = weightedAchNumerator.plus(D(r.achievement).mul(D(r.kpiWeight)));
    weightSum = weightSum.plus(D(r.kpiWeight));
  }

  const allocatedWeight = counted
    .filter((r) => r.status !== 'REJECTED')
    .reduce((acc, r) => acc + r.kpiWeight, 0);

  const averageAchievement = weightSum.gt(0)
    ? round2(weightedAchNumerator.div(weightSum))
    : new Decimal(0);

  const total = round2(totalScore);

  return {
    totalKpiScore: total,
    averageAchievement,
    allocatedWeight,
    approvedCount: approved.length,
    totalCount: counted.length,
    belowTargetCount: approved.filter((r) => D(r.achievement).lt(100)).length,
    rag: ragFor(total, thresholds),
  };
};
