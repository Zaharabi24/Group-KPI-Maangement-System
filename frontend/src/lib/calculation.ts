/**
 * ============================================================================
 *  KPI Calculation engine — client mirror of backend/src/modules/calculation
 * ============================================================================
 *  BRD §4 and AC-05: "the UI preview, API response and stored version show
 *  identical ACH, CS and WS values". This module therefore implements exactly the
 *  same algorithm with the same ROUND_HALF_UP rounding at each step.
 * ============================================================================
 */

export type CalcDirection = 'HIGHER' | 'LOWER';
export type CalcMeasurementType = 'COUNT' | 'MONETARY' | 'PERCENTAGE' | 'TIME' | 'RATING' | 'QUALITATIVE';

export const DEFAULT_QUALITATIVE_MAP: Record<string, number> = {
  '1': 50,
  '2': 75,
  '3': 100,
  '4': 110,
  '5': 120,
};

export const SCORE_CAP = 120;
export const SCORE_FLOOR = 0;

export interface CalcConfig {
  scoreCap?: number;
  scoreFloor?: number;
  qualitativeMap?: Record<string, number> | null;
}

export interface CalcInput {
  target?: number | string | null;
  actual?: number | string | null;
  rubricLevel?: number | null;
  kpiWeight: number;
  direction: CalcDirection;
  measurementType: CalcMeasurementType;
  overrideScore?: number | string | null;
  config?: CalcConfig | null;
}

export interface CalcResult {
  achievement: number;
  calculatedScore: number;
  finalScore: number;
  weightedScore: number;
  formulaText: string;
  hasOverride: boolean;
  capped: boolean;
  floored: boolean;
  error?: { code: string; message: string };
}

const toNumber = (value: number | string | null | undefined, fallback = 0): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** ROUND_HALF_UP at 2 decimal places, immune to binary floating-point drift. */
export const roundHalfUp = (value: number, places = 2): number => {
  if (!Number.isFinite(value)) return 0;
  const negative = value < 0;
  const abs = Math.abs(value);
  // Exponential-notation shift avoids artefacts such as 1.005 → 1.00499999…
  const shifted = Number(`${abs}e${places}`);
  if (!Number.isFinite(shifted)) return value;
  const rounded = Math.round(shifted);
  const result = Number(`${rounded}e-${places}`);
  return negative ? -result : result;
};

/** §4.2 — Achievement %. */
export const computeAchievement = (
  input: Omit<CalcInput, 'kpiWeight' | 'overrideScore'>,
): { achievement: number; formulaText: string; floored: boolean } => {
  const map = input.config?.qualitativeMap ?? DEFAULT_QUALITATIVE_MAP;
  const t = toNumber(input.target);
  const a = toNumber(input.actual);

  if (input.measurementType === 'QUALITATIVE') {
    const level = input.rubricLevel ?? (input.actual !== null && input.actual !== undefined ? Math.round(a) : null);
    if (level === null || level === undefined) {
      return { achievement: 0, formulaText: 'rubric level required', floored: false };
    }
    const mapped = map[String(level)];
    if (mapped === undefined) {
      return { achievement: 0, formulaText: `rubric_map[Level ${level}] is not configured`, floored: false };
    }
    return { achievement: roundHalfUp(mapped), formulaText: `rubric_map[Level ${level}] = ${mapped}`, floored: false };
  }

  if (input.direction === 'HIGHER' || input.measurementType === 'RATING') {
    if (t <= 0) {
      return { achievement: 0, formulaText: 'Target must be greater than 0 (V-TGT-01)', floored: false };
    }
    const raw = (a / t) * 100;
    return {
      achievement: Math.max(roundHalfUp(raw), 0),
      formulaText: `(actual ${trimNumber(a)} / target ${trimNumber(t)}) × 100`,
      floored: raw < 0,
    };
  }

  // LOWER is better
  if (t === 0) {
    if (a === 0) return { achievement: 100, formulaText: 'target 0 (zero tolerance): actual 0 → 100', floored: false };
    return { achievement: 0, formulaText: `target 0 (zero tolerance): actual ${trimNumber(a)} > 0 → 0`, floored: false };
  }
  const raw = ((2 * t - a) / t) * 100;
  return {
    achievement: Math.max(roundHalfUp(raw), 0),
    formulaText: `((2 × target ${trimNumber(t)} − actual ${trimNumber(a)}) / target ${trimNumber(t)}) × 100`,
    floored: raw < 0,
  };
};

const trimNumber = (value: number): string => {
  const s = value.toFixed(2);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
};

/** §4.2–§4.3 — Achievement, Calculated Score, Final Score and Weighted Score. */
export const calculateKpi = (input: CalcInput): CalcResult => {
  const cap = toNumber(input.config?.scoreCap ?? SCORE_CAP, SCORE_CAP);
  const floor = toNumber(input.config?.scoreFloor ?? SCORE_FLOOR, SCORE_FLOOR);

  const { achievement, formulaText, floored } = computeAchievement(input);
  const capped = achievement > cap;
  const calculatedScore = Math.min(achievement, cap);

  const hasOverride =
    input.overrideScore !== null && input.overrideScore !== undefined && input.overrideScore !== '';
  const finalScore = hasOverride
    ? Math.max(Math.min(toNumber(input.overrideScore), cap), floor)
    : Math.max(calculatedScore, floor);

  const weightedScore = roundHalfUp((finalScore * input.kpiWeight) / 100);

  return {
    achievement,
    calculatedScore: roundHalfUp(calculatedScore),
    finalScore: roundHalfUp(finalScore),
    weightedScore,
    formulaText,
    hasOverride,
    capped,
    floored,
  };
};

/** ADJ-2 — Δ = |FS at approval − CS as submitted|, band-tested on the server. */
export const bandTest = (
  finalScore: number,
  calculatedScoreAsSubmitted: number,
  band: number,
): { delta: number; withinBand: boolean } => {
  const delta = roundHalfUp(Math.abs(finalScore - calculatedScoreAsSubmitted));
  return { delta, withinBand: delta <= band };
};

/** §4.5 — RAG thresholds. */
export const ragFor = (
  value: number,
  thresholds: { green: number; amber: number } = { green: 95, amber: 75 },
): 'GREEN' | 'AMBER' | 'RED' => {
  if (value >= thresholds.green) return 'GREEN';
  if (value >= thresholds.amber) return 'AMBER';
  return 'RED';
};

export type StepState = 'done' | 'current' | 'todo' | 'error';

/** §3.6 — the six-step stepper: Target → Actual → Evidence → Score → Review → Approval. */
export const STEPPER_LABELS = ['Target', 'Actual', 'Evidence', 'Score', 'Review', 'Approval'] as const;

export const stepperFor = (kpi: {
  status: string;
  target?: number | string | null;
  actual?: number | string | null;
  rubricLevel?: number | null;
  evidenceCount?: number | null;
  calculatedScore?: number | string | null;
}): StepState[] => {
  const hasTarget = kpi.rubricLevel !== null && kpi.rubricLevel !== undefined
    ? true
    : kpi.target !== null && kpi.target !== undefined && kpi.target !== '';
  const hasActual = kpi.rubricLevel !== null && kpi.rubricLevel !== undefined
    ? true
    : kpi.actual !== null && kpi.actual !== undefined && kpi.actual !== '';
  const hasEvidence = (kpi.evidenceCount ?? 0) > 0;
  const hasScore = kpi.calculatedScore !== null && kpi.calculatedScore !== undefined && kpi.calculatedScore !== '';

  const states: StepState[] = [
    hasTarget ? 'done' : 'todo',
    hasActual ? 'done' : 'todo',
    hasEvidence ? 'done' : 'todo',
    hasScore ? 'done' : 'todo',
    'todo',
    'todo',
  ];

  switch (kpi.status) {
    case 'SUBMITTED':
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
      return ['todo', 'todo', 'todo', 'todo', 'todo', 'todo'];
    default:
      break;
  }
  return states;
};

/** §4.5 — period aggregates over the set of Approved KPIs. */
export interface AggregateRow {
  achievement: number | string | null;
  weightedScore: number | string | null;
  kpiWeight: number;
  status: string;
}

export const aggregatePeriod = (
  rows: AggregateRow[],
  thresholds: { green: number; amber: number } = { green: 95, amber: 75 },
) => {
  const approved = rows.filter((r) => r.status === 'APPROVED');
  const totalKpiScore = roundHalfUp(approved.reduce((a, r) => a + toNumber(r.weightedScore), 0));
  const achNum = approved.reduce((a, r) => a + toNumber(r.achievement) * r.kpiWeight, 0);
  const achDen = approved.reduce((a, r) => a + r.kpiWeight, 0);
  const averageAchievement = achDen ? roundHalfUp(achNum / achDen) : 0;
  const allocatedWeight = rows
    .filter((r) => r.status !== 'REJECTED' && r.status !== 'DELETED')
    .reduce((a, r) => a + r.kpiWeight, 0);

  return {
    totalKpiScore,
    averageAchievement,
    allocatedWeight,
    approvedCount: approved.length,
    totalCount: rows.filter((r) => r.status !== 'DELETED').length,
    belowTargetCount: approved.filter((r) => toNumber(r.achievement) < 100).length,
    rag: ragFor(totalKpiScore, thresholds),
  };
};

/** §4.4 — BDT lakh/crore grouping. */
export const formatBdt = (value: number | string | null | undefined, withSymbol = false): string => {
  if (value === null || value === undefined || value === '') return '—';
  const n = toNumber(value);
  const fixed = n.toFixed(2);
  const negative = fixed.startsWith('-');
  const [intPart, fracPart] = fixed.replace('-', '').split('.');
  let grouped: string;
  if (intPart.length <= 3) {
    grouped = intPart;
  } else {
    const head = intPart.slice(0, intPart.length - 3);
    const tail = intPart.slice(-3);
    grouped = `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
  }
  return `${negative ? '-' : ''}${withSymbol ? 'BDT ' : ''}${grouped}.${fracPart}`;
};

/** Short form for KPI cards: BDT 1.00 Cr / BDT 6.10 L. */
export const formatBdtShort = (value: number | string | null | undefined, withSymbol = true): string => {
  if (value === null || value === undefined || value === '') return '—';
  const n = toNumber(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const prefix = withSymbol ? 'BDT ' : '';
  if (abs >= 10_000_000) return `${sign}${prefix}${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `${sign}${prefix}${(abs / 100_000).toFixed(2)} L`;
  if (abs >= 1_000) return `${sign}${prefix}${(abs / 1_000).toFixed(2)} K`;
  return `${sign}${prefix}${abs.toFixed(2)}`;
};

/** Renders a value using the measurement type's precision (§3.4). */
export const formatMeasured = (
  value: number | string | null | undefined,
  measurementType: CalcMeasurementType | string | undefined,
  unit?: string | null,
  opts: { short?: boolean } = {},
): string => {
  if (value === null || value === undefined || value === '') return '—';
  switch (measurementType) {
    case 'MONETARY':
      return opts.short ? formatBdtShort(value, true) : formatBdt(value);
    case 'COUNT':
      return `${toNumber(value).toFixed(0)}${unit && unit !== 'units' ? ` ${unit}` : ''}`;
    case 'PERCENTAGE':
      return `${toNumber(value).toFixed(2)}${unit && unit !== '%' ? ` ${unit}` : '%'}`;
    case 'RATING':
      return `${toNumber(value).toFixed(1)}`;
    case 'TIME':
      return `${toNumber(value).toFixed(2)}${unit ? ` ${unit}` : ''}`;
    case 'QUALITATIVE':
      return `Level ${toNumber(value).toFixed(0)}`;
    default:
      return `${toNumber(value).toFixed(2)}${unit ? ` ${unit}` : ''}`;
  }
};

export const formatScore = (value: number | string | null | undefined): string =>
  value === null || value === undefined || value === '' ? '—' : toNumber(value).toFixed(2);

export const formatPercent = (value: number | string | null | undefined): string =>
  value === null || value === undefined || value === '' ? '—' : `${toNumber(value).toFixed(2)}%`;
