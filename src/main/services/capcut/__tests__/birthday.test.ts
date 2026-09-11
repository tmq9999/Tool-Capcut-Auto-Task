import { describe, it, expect } from 'vitest';
import { generateBirthday, generateBirthdayInRange, isLeapYear, getDaysInMonth } from '../birthday';

describe('T03 — A02: Birthday randomizer (1990 - 2004)', () => {
  it('correctly calculates leap years and days in month', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2004)).toBe(true);
    expect(isLeapYear(1996)).toBe(true);
    expect(isLeapYear(1990)).toBe(false);
    expect(isLeapYear(1999)).toBe(false);

    expect(getDaysInMonth(2000, 2)).toBe(29);
    expect(getDaysInMonth(1999, 2)).toBe(28);
    expect(getDaysInMonth(2001, 4)).toBe(30);
    expect(getDaysInMonth(2001, 1)).toBe(31);
  });

  it('generates years strictly between 1990 and 2004 across 1000 runs', () => {
    const years = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const bday = generateBirthday();
      expect(bday.year).toBeGreaterThanOrEqual(1990);
      expect(bday.year).toBeLessThanOrEqual(2004);
      expect(bday.month).toBeGreaterThanOrEqual(1);
      expect(bday.month).toBeLessThanOrEqual(12);
      expect(bday.day).toBeGreaterThanOrEqual(1);
      expect(bday.day).toBeLessThanOrEqual(getDaysInMonth(bday.year, bday.month));
      years.add(bday.year);
    }
    // Ensures distribution covers multiple years in the range
    expect(years.size).toBeGreaterThan(10);
  });

  it('handles deterministic mock RNG for exact values', () => {
    // rng returns 0 -> startYear (1990), month 1, day 1
    const minBday = generateBirthday({}, () => 0);
    expect(minBday.year).toBe(1990);
    expect(minBday.month).toBe(1);
    expect(minBday.monthIndex).toBe(0);
    expect(minBday.day).toBe(1);
    expect(minBday.dayIndex).toBe(0);
    expect(minBday.monthName).toBe('January');

    // rng returns 0.9999 -> endYear (2004), month 12, day 31
    const maxBday = generateBirthday({}, () => 0.9999);
    expect(maxBday.year).toBe(2004);
    expect(maxBday.month).toBe(12);
    expect(maxBday.monthIndex).toBe(11);
    expect(maxBday.day).toBe(31);
    expect(maxBday.dayIndex).toBe(30);
    expect(maxBday.monthName).toBe('December');
  });

  it('supports custom range if provided', () => {
    const custom = generateBirthday({ startYear: 1995, endYear: 1995 });
    expect(custom.year).toBe(1995);
  });

  it('generates consistent memoized birthday object matching BirthdayInfo contract', () => {
    const bday = generateBirthday({ startYear: 1990, endYear: 2004 });
    expect(typeof bday.year).toBe('number');
    expect(bday.year).toBeGreaterThanOrEqual(1990);
    expect(bday.year).toBeLessThanOrEqual(2004);
    expect(bday.monthIndex).toBe(bday.month - 1);
    expect(bday.dayIndex).toBe(bday.day - 1);
  });

  it('rejects fractional, NaN, or infinite years and invalid RNG in generateBirthday', () => {
    expect(() => generateBirthday({ startYear: NaN })).toThrow();
    expect(() => generateBirthday({ endYear: Infinity })).toThrow();
    expect(() => generateBirthday({ startYear: 1990.5 })).toThrow();
    expect(() => generateBirthday({ startYear: 2005, endYear: 2000 })).toThrow();

    expect(() => generateBirthday({}, () => -0.1)).toThrow();
    expect(() => generateBirthday({}, () => 1.0)).toThrow();
    expect(() => generateBirthday({}, () => NaN)).toThrow();
  });

  it('generateBirthdayInRange: validates calendar day bounds and sample uniform day distribution', () => {
    // Leap year boundary: 2000-02-28 to 2000-03-01 has 3 days (28, 29, 1)
    const feb28 = generateBirthdayInRange({ earliest: '2000-02-28', latest: '2000-03-01' }, () => 0);
    expect(feb28).toMatchObject({ year: 2000, month: 2, day: 28, monthName: 'February' });

    const feb29 = generateBirthdayInRange({ earliest: '2000-02-28', latest: '2000-03-01' }, () => 0.34);
    expect(feb29).toMatchObject({ year: 2000, month: 2, day: 29, monthName: 'February' });

    const mar01 = generateBirthdayInRange({ earliest: '2000-02-28', latest: '2000-03-01' }, () => 0.99);
    expect(mar01).toMatchObject({ year: 2000, month: 3, day: 1, monthName: 'March' });

    // Single day range
    const single = generateBirthdayInRange({ earliest: '1995-06-15', latest: '1995-06-15' }, () => 0.5);
    expect(single).toMatchObject({ year: 1995, month: 6, day: 15, monthName: 'June', monthIndex: 5, dayIndex: 14 });

    // Invalid non-leap 1900-02-29
    expect(() => generateBirthdayInRange({ earliest: '1900-02-29', latest: '1900-03-01' })).toThrow('INVALID_BIRTHDAY_RANGE');

    // Invalid date formats or malformed
    expect(() => generateBirthdayInRange({ earliest: '2000/01/01', latest: '2000-01-02' })).toThrow('INVALID_BIRTHDAY_RANGE');
    expect(() => generateBirthdayInRange({ earliest: '2000-13-01', latest: '2000-13-02' })).toThrow('INVALID_BIRTHDAY_RANGE');

    // Reversed range
    expect(() => generateBirthdayInRange({ earliest: '2000-01-05', latest: '2000-01-01' })).toThrow('INVALID_BIRTHDAY_RANGE');

    // Invalid RNG
    expect(() => generateBirthdayInRange({ earliest: '2000-01-01', latest: '2000-01-05' }, () => -0.01)).toThrow('INVALID_BIRTHDAY_RNG');
    expect(() => generateBirthdayInRange({ earliest: '2000-01-01', latest: '2000-01-05' }, () => 1.0)).toThrow('INVALID_BIRTHDAY_RNG');
    expect(() => generateBirthdayInRange({ earliest: '2000-01-01', latest: '2000-01-05' }, () => NaN)).toThrow('INVALID_BIRTHDAY_RNG');
  });
});

