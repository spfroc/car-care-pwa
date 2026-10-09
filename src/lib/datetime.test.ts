import { describe, expect, it } from 'vitest';
import {
  buildCalendarCells,
  documentLangFor,
  formatDateBySetting,
  formatDateParts,
  formatDateTimeBySetting,
  formatLocalValueDisplay,
  formatTimeParts,
  from12Hour,
  getPickerLabels,
  normalizeDateFormat,
  normalizeLanguage,
  normalizeTimeFormat,
  partsFromLocalValue,
  shiftMonth,
  to12Hour,
  toLocalDateTimeValue,
} from './datetime';

describe('normalize helpers', () => {
  it('normalizes language', () => {
    expect(normalizeLanguage('zh-CN')).toBe('zh-CN');
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('fr')).toBe('zh-CN');
    expect(documentLangFor('en')).toBe('en');
    expect(documentLangFor('zh-CN')).toBe('zh-CN');
  });

  it('normalizes date/time formats', () => {
    expect(normalizeDateFormat('YYYY-MM-DD')).toBe('YYYY-MM-DD');
    expect(normalizeDateFormat('bogus')).toBe('YYYY-MM-DD');
    expect(normalizeTimeFormat('12h')).toBe('12h');
    expect(normalizeTimeFormat('x')).toBe('24h');
  });
});

describe('formatDateParts', () => {
  const parts = { year: 2025, month: 12, day: 20 };

  it('formats all date patterns', () => {
    expect(formatDateParts(parts, 'YYYY-MM-DD')).toBe('2025-12-20');
    expect(formatDateParts(parts, 'YYYY/MM/DD')).toBe('2025/12/20');
    expect(formatDateParts(parts, 'DD/MM/YYYY')).toBe('20/12/2025');
    expect(formatDateParts(parts, 'MM/DD/YYYY')).toBe('12/20/2025');
  });
});

describe('formatTimeParts / 12h', () => {
  it('formats 24h', () => {
    expect(formatTimeParts(0, 5, '24h', 'zh-CN')).toBe('00:05');
    expect(formatTimeParts(15, 30, '24h', 'en')).toBe('15:30');
  });

  it('formats 12h with locale period', () => {
    expect(formatTimeParts(0, 0, '12h', 'en')).toBe('12:00 AM');
    expect(formatTimeParts(12, 0, '12h', 'en')).toBe('12:00 PM');
    expect(formatTimeParts(15, 5, '12h', 'zh-CN')).toBe('3:05 下午');
    expect(formatTimeParts(9, 7, '12h', 'zh-CN')).toBe('9:07 上午');
  });

  it('converts 12h <-> 24h', () => {
    expect(to12Hour(0)).toEqual({ hour12: 12, period: 'am' });
    expect(to12Hour(12)).toEqual({ hour12: 12, period: 'pm' });
    expect(to12Hour(13)).toEqual({ hour12: 1, period: 'pm' });
    expect(from12Hour(12, 'am')).toBe(0);
    expect(from12Hour(12, 'pm')).toBe(12);
    expect(from12Hour(3, 'pm')).toBe(15);
    expect(from12Hour(9, 'am')).toBe(9);
  });
});

describe('formatDateBySetting / formatDateTimeBySetting', () => {
  it('formats ISO using settings', () => {
    const local = new Date(2025, 11, 20, 12, 0, 0);
    const iso = local.toISOString();
    expect(formatDateBySetting(iso, 'YYYY-MM-DD')).toBe('2025-12-20');
    expect(formatDateBySetting(iso, 'MM/DD/YYYY')).toBe('12/20/2025');
    expect(formatDateTimeBySetting(iso, 'YYYY-MM-DD', '24h', 'zh-CN')).toBe('2025-12-20 12:00');
    expect(formatDateTimeBySetting(iso, 'MM/DD/YYYY', '12h', 'en')).toBe('12/20/2025 12:00 PM');
  });
});

describe('partsFromLocalValue / display', () => {
  it('parses local datetime values', () => {
    expect(partsFromLocalValue('2025-12-20T12:00')).toEqual({
      year: 2025,
      month: 12,
      day: 20,
      hour: 12,
      minute: 0,
    });
    expect(partsFromLocalValue('2025-12-20')).toEqual({
      year: 2025,
      month: 12,
      day: 20,
      hour: 0,
      minute: 0,
    });
    expect(partsFromLocalValue('not-a-date')).toBeNull();
  });

  it('formats local value for display', () => {
    expect(
      formatLocalValueDisplay('2025-12-20T12:00', {
        mode: 'datetime',
        dateFormat: 'YYYY-MM-DD',
        timeFormat: '24h',
        language: 'zh-CN',
      }),
    ).toBe('2025-12-20 12:00');
    expect(
      formatLocalValueDisplay('2025-12-20T12:00', {
        mode: 'datetime',
        dateFormat: 'MM/DD/YYYY',
        timeFormat: '12h',
        language: 'en',
      }),
    ).toBe('12/20/2025 12:00 PM');
    expect(
      formatLocalValueDisplay('2025-12-20', {
        mode: 'date',
        dateFormat: 'DD/MM/YYYY',
      }),
    ).toBe('20/12/2025');
  });

  it('round-trips toLocalDateTimeValue', () => {
    const parts = partsFromLocalValue('2025-12-20T15:30')!;
    expect(toLocalDateTimeValue(parts)).toBe('2025-12-20T15:30');
  });
});

describe('picker locale', () => {
  it('returns Chinese chrome for zh-CN', () => {
    const l = getPickerLabels('zh-CN');
    expect(l.clear).toBe('清除');
    expect(l.today).toBe('今天');
    expect(l.am).toBe('上午');
    expect(l.weekdays[0]).toBe('日');
    expect(l.monthTitle(2025, 12)).toBe('2025年12月');
  });

  it('returns English chrome for en', () => {
    const l = getPickerLabels('en');
    expect(l.clear).toBe('Clear');
    expect(l.today).toBe('Today');
    expect(l.pm).toBe('PM');
    expect(l.weekdays[1]).toBe('Mo');
    expect(l.monthTitle(2025, 12)).toBe('December 2025');
  });
});

describe('calendar grid', () => {
  it('builds a 6x7 grid starting Sunday', () => {
    const cells = buildCalendarCells(2025, 12);
    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({ day: 30, inMonth: false });
    expect(cells[1]).toMatchObject({ day: 1, inMonth: true });
    const day20 = cells.find((c) => c.inMonth && c.day === 20);
    expect(day20?.date).toMatchObject({ year: 2025, month: 12, day: 20 });
  });

  it('shifts months across year boundary', () => {
    expect(shiftMonth(2025, 12, 1)).toEqual({ year: 2026, month: 1 });
    expect(shiftMonth(2025, 1, -1)).toEqual({ year: 2024, month: 12 });
  });
});