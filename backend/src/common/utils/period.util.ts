/**
 * Period calendar helpers — §3.5 (frequency, deadlines, working days).
 * Working week is Saturday–Thursday; Friday is the weekly holiday (§21.2).
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import isoWeek from 'dayjs/plugin/isoWeek';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(customParseFormat);

export const APP_TZ = process.env.TIMEZONE || 'Asia/Dhaka';

export type FrequencyKey = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface PeriodDescriptor {
  frequency: FrequencyKey;
  code: string;
  label: string;
  year: number;
  periodIndex: number;
  startDate: Date;
  endDate: Date;
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const addDays = (date: Date | string, days: number): Date =>
  dayjs.utc(date).add(days, 'day').startOf('day').toDate();

export const startOfDayUtc = (date: Date | string): Date =>
  dayjs.utc(date).startOf('day').toDate();

export const endOfDayUtc = (date: Date | string): Date =>
  dayjs.utc(date).endOf('day').toDate();

/** Friday is the weekly holiday; Working days are Saturday–Thursday. */
export const isWorkingDay = (date: Date | string): boolean => dayjs.utc(date).day() !== 5;

/** Working days between two dates (exclusive of the start, inclusive of the end). */
export const workingDaysBetween = (from: Date | string, to: Date | string): number => {
  const start = dayjs.utc(from).startOf('day');
  const end = dayjs.utc(to).startOf('day');
  if (end.isBefore(start)) return 0;
  let count = 0;
  let cursor = start.add(1, 'day');
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    if (cursor.day() !== 5) count += 1;
    cursor = cursor.add(1, 'day');
  }
  return count;
};

/** Age in working days used by the SLA colour (§11.4). */
export const workingDaysAgo = (date: Date | string, now: Date = new Date()): number =>
  workingDaysBetween(date, now);

export const addWorkingDays = (date: Date | string, days: number): Date => {
  let cursor = dayjs.utc(date);
  let remaining = days;
  while (remaining > 0) {
    cursor = cursor.add(1, 'day');
    if (cursor.day() !== 5) remaining -= 1;
  }
  return cursor.toDate();
};

/** Calendar days remaining until a deadline (negative = overdue). */
export const daysRemaining = (deadline: Date | string, now: Date = new Date()): number =>
  dayjs.utc(deadline).startOf('day').diff(dayjs.utc(now).startOf('day'), 'day');

export const monthStart = (year: number, month1: number): Date =>
  dayjs.utc(`${year}-${String(month1).padStart(2, '0')}-01`).startOf('month').toDate();

export const monthEnd = (year: number, month1: number): Date =>
  dayjs.utc(`${year}-${String(month1).padStart(2, '0')}-01`).endOf('month').startOf('day').toDate();

export const monthCode = (year: number, month1: number): string =>
  `${year}-${String(month1).padStart(2, '0')}`;

export const quarterCode = (year: number, q: number): string => `${year}-Q${q}`;

export const yearCode = (year: number): string => `${year}`;

export const periodLabel = (frequency: FrequencyKey, year: number, index: number): string => {
  if (frequency === 'MONTHLY') return `${MONTH_LABELS[index - 1]} ${year}`;
  if (frequency === 'QUARTERLY') return `Q${index} ${year}`;
  return `${year}`;
};

export const monthDescriptor = (year: number, month1: number): PeriodDescriptor => ({
  frequency: 'MONTHLY',
  code: monthCode(year, month1),
  label: periodLabel('MONTHLY', year, month1),
  year,
  periodIndex: month1,
  startDate: monthStart(year, month1),
  endDate: monthEnd(year, month1),
});

export const quarterDescriptor = (year: number, q: number): PeriodDescriptor => {
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    frequency: 'QUARTERLY',
    code: quarterCode(year, q),
    label: periodLabel('QUARTERLY', year, q),
    year,
    periodIndex: q,
    startDate: monthStart(year, startMonth),
    endDate: monthEnd(year, endMonth),
  };
};

export const yearDescriptor = (year: number): PeriodDescriptor => ({
  frequency: 'YEARLY',
  code: yearCode(year),
  label: periodLabel('YEARLY', year, 1),
  year,
  periodIndex: 1,
  startDate: monthStart(year, 1),
  endDate: monthEnd(year, 12),
});

/** All periods of one year for a frequency — used to generate the calendar (FR-CFG-01). */
export const descriptorsForYear = (frequency: FrequencyKey, year: number): PeriodDescriptor[] => {
  if (frequency === 'MONTHLY') {
    return Array.from({ length: 12 }, (_, i) => monthDescriptor(year, i + 1));
  }
  if (frequency === 'QUARTERLY') {
    return Array.from({ length: 4 }, (_, i) => quarterDescriptor(year, i + 1));
  }
  return [yearDescriptor(year)];
};

/** Current period descriptor in Asia/Dhaka. */
export const currentPeriodDescriptor = (
  frequency: FrequencyKey,
  reference: Date = new Date(),
): PeriodDescriptor => {
  const local = dayjs(reference).tz(APP_TZ);
  const year = local.year();
  if (frequency === 'MONTHLY') return monthDescriptor(year, local.month() + 1);
  if (frequency === 'QUARTERLY') return quarterDescriptor(year, Math.floor(local.month() / 3) + 1);
  return yearDescriptor(year);
};

/** The preceding period of the same frequency (§4.5 — Previous KPI Score). */
export const previousPeriodDescriptor = (
  frequency: FrequencyKey,
  year: number,
  index: number,
): PeriodDescriptor | null => {
  if (frequency === 'MONTHLY') {
    if (index === 1) return year === 1900 ? null : monthDescriptor(year - 1, 12);
    return monthDescriptor(year, index - 1);
  }
  if (frequency === 'QUARTERLY') {
    if (index === 1) return year === 1900 ? null : quarterDescriptor(year - 1, 4);
    return quarterDescriptor(year, index - 1);
  }
  return year === 1900 ? null : yearDescriptor(year - 1);
};

export const isoDate = (date: Date | string): string => dayjs.utc(date).format('YYYY-MM-DD');

export const formatDate = (date: Date | string | null | undefined): string =>
  date ? dayjs.utc(date).format('DD MMM YYYY') : '—';

export const formatDateTime = (date: Date | string | null | undefined): string =>
  date ? dayjs(date).tz(APP_TZ).format('DD MMM YYYY, HH:mm') : '—';

export const toDate = (value: string | Date): Date => dayjs.utc(value).startOf('day').toDate();

export { dayjs };
