/**
 * Decimal helpers — every monetary, percentage and score value in ANWAR KPIFlow
 * is computed with fixed-point decimal arithmetic (BRD §4.4, NFR-INT-01).
 * Binary floating point is never used for scoring.
 */
import Decimal from 'decimal.js';

Decimal.set({
  precision: 30,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});

export { Decimal };

export type Numeric = Decimal | number | string | null | undefined;

export const D = (value: Numeric, fallback = '0'): Decimal => {
  if (value === null || value === undefined || value === '') return new Decimal(fallback);
  try {
    return new Decimal(value as Decimal.Value);
  } catch {
    return new Decimal(fallback);
  }
};

/** ACH is rounded to 2 dp; later steps use the rounded value (§4.4). */
export const round2 = (value: Numeric): Decimal => D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Serialise a decimal for JSON transport — decimals travel as strings (§13.1). */
export const dec = (value: Numeric): string | null =>
  value === null || value === undefined ? null : D(value).toFixed(2);

export const decOrNull = (value: Numeric): string | null => {
  if (value === null || value === undefined || value === '') return null;
  return D(value).toFixed(2);
};

export const num = (value: Numeric, fallback = 0): number => {
  try {
    return D(value, String(fallback)).toNumber();
  } catch {
    return fallback;
  }
};

/** Comparison helpers that never throw. */
export const gt = (a: Numeric, b: Numeric): boolean => D(a).gt(D(b));
export const gte = (a: Numeric, b: Numeric): boolean => D(a).gte(D(b));
export const lt = (a: Numeric, b: Numeric): boolean => D(a).lt(D(b));
export const lte = (a: Numeric, b: Numeric): boolean => D(a).lte(D(b));
export const eq = (a: Numeric, b: Numeric): boolean => D(a).eq(D(b));

export const clampDecimal = (value: Numeric, min: Numeric, max: Numeric): Decimal =>
  Decimal.min(Decimal.max(D(value), D(min)), D(max));

/** Number of decimal places actually used by a value. */
export const decimalPlaces = (value: Numeric): number =>
  Math.max(0, D(value).decimalPlaces());

/**
 * BDT lakh/crore digit grouping (§1.4, §4.4) — 1,00,00,000.00
 * Grouping: last 3 digits, then groups of 2.
 */
export const formatBdt = (value: Numeric, withSymbol = false): string => {
  const v = D(value).toFixed(2);
  const negative = v.startsWith('-');
  const [intPart, fracPart] = v.replace('-', '').split('.');
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

/** Short form used on KPI cards — BDT 1.00 Cr / BDT 6.10 L (§4.4). */
export const formatBdtShort = (value: Numeric, withSymbol = true): string => {
  const v = D(value);
  const abs = v.abs();
  const sign = v.isNegative() ? '-' : '';
  const prefix = withSymbol ? 'BDT ' : '';
  if (abs.gte(10_000_000)) return `${sign}${prefix}${abs.div(10_000_000).toFixed(2)} Cr`;
  if (abs.gte(100_000)) return `${sign}${prefix}${abs.div(100_000).toFixed(2)} L`;
  if (abs.gte(1_000)) return `${sign}${prefix}${abs.div(1_000).toFixed(2)} K`;
  return `${sign}${prefix}${abs.toFixed(2)}`;
};

/** Renders a value according to the measurement type's precision (§3.4). */
export const formatByMeasurementType = (
  value: Numeric,
  measurementType: string,
  unit?: string | null,
): string => {
  if (value === null || value === undefined) return '—';
  const v = D(value);
  switch (measurementType) {
    case 'MONETARY':
      return formatBdt(v);
    case 'COUNT':
      return v.toFixed(0);
    case 'PERCENTAGE':
      return `${v.toFixed(2)}${unit ? unit : '%'}`;
    case 'RATING':
      return v.toFixed(1);
    case 'TIME':
    case 'QUALITATIVE':
    default:
      return `${v.toFixed(2)}${unit ? ` ${unit}` : ''}`;
  }
};

export const round = (value: number, places = 2): number => {
  const f = Math.pow(10, places);
  return Math.round((value + Number.EPSILON) * f) / f;
};
