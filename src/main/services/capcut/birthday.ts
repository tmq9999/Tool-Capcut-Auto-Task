export interface BirthdayInfo {
  year: number;
  month: number; // 1 - 12
  monthIndex: number; // 0 - 11
  day: number; // 1 - 31
  dayIndex: number; // 0 - 30
  monthName: string;
}

export interface BirthdayRange {
  startYear?: number;
  endYear?: number;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/**
 * Sinh ngày sinh ngẫu nhiên trong khoảng tuổi được quy định (mặc định 1990 - 2004).
 * @param range Khoảng năm sinh (mặc định 1990 - 2004)
 * @param rng Hàm sinh số ngẫu nhiên [0, 1) cho phép mock trong test
 */
export function generateBirthday(
  range: BirthdayRange = {},
  rng: () => number = Math.random
): BirthdayInfo {
  const startYear = range.startYear ?? 1990;
  const endYear = range.endYear ?? 2004;

  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw new Error(`Invalid birthday range: startYear (${startYear}) and endYear (${endYear}) must be integers`);
  }
  if (startYear > endYear) {
    throw new Error(`Invalid birthday range: startYear (${startYear}) > endYear (${endYear})`);
  }

  const sampleYear = rng();
  const sampleMonth = rng();
  const sampleDay = rng();
  for (const s of [sampleYear, sampleMonth, sampleDay]) {
    if (!Number.isFinite(s) || s < 0 || s >= 1) {
      throw new Error(`Invalid birthday RNG: sample (${s}) must be in [0, 1)`);
    }
  }

  const yearSpan = endYear - startYear + 1;
  const year = startYear + Math.floor(sampleYear * yearSpan);

  const month = 1 + Math.floor(sampleMonth * 12);
  const maxDays = getDaysInMonth(year, month);
  const day = 1 + Math.floor(sampleDay * maxDays);

  const monthIndex = month - 1;
  const dayIndex = day - 1;
  const monthName = MONTH_NAMES[monthIndex] ?? 'January';

  return {
    year,
    month,
    monthIndex,
    day,
    dayIndex,
    monthName,
  };
}

export interface CalendarBirthdayRange {
  earliest: string; // exact YYYY-MM-DD
  latest: string; // inclusive YYYY-MM-DD
}

const DAY_MS = 86_400_000;

function parseCalendarDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('INVALID_BIRTHDAY_RANGE');
  const parsed = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error('INVALID_BIRTHDAY_RANGE');
  }
  return parsed;
}

function sampleBirthdayDate(range: CalendarBirthdayRange, rng: () => number): Date {
  const first = parseCalendarDay(range.earliest);
  const last = parseCalendarDay(range.latest);
  if (first > last) throw new Error('INVALID_BIRTHDAY_RANGE');
  const sample = rng();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error('INVALID_BIRTHDAY_RNG');
  }
  const days = Math.round((last - first) / DAY_MS) + 1;
  return new Date(first + Math.floor(sample * days) * DAY_MS);
}

export function generateBirthdayInRange(
  range: CalendarBirthdayRange,
  rng: () => number = Math.random
): BirthdayInfo {
  const date = sampleBirthdayDate(range, rng);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const monthIndex = month - 1;
  const dayIndex = day - 1;
  const monthName = MONTH_NAMES[monthIndex] ?? 'January';

  return {
    year,
    month,
    monthIndex,
    day,
    dayIndex,
    monthName,
  };
}
