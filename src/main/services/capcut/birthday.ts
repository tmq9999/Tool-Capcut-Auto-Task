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

  if (startYear > endYear) {
    throw new Error(`Invalid birthday range: startYear (${startYear}) > endYear (${endYear})`);
  }

  const yearSpan = endYear - startYear + 1;
  const year = startYear + Math.floor(rng() * yearSpan);

  const month = 1 + Math.floor(rng() * 12);
  const maxDays = getDaysInMonth(year, month);
  const day = 1 + Math.floor(rng() * maxDays);

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
