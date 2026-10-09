/** Date/time display + picker locale helpers (no external date lib). */

export type DateFormatId = 'YYYY-MM-DD' | 'YYYY/MM/DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
export type TimeFormatId = '24h' | '12h';
export type AppLanguage = 'zh-CN' | 'en';

export const DATE_FORMAT_OPTIONS: { value: DateFormatId; label: string }[] = [
  { value: 'YYYY-MM-DD', label: 'yyyy-mm-dd' },
  { value: 'YYYY/MM/DD', label: 'yyyy/mm/dd' },
  { value: 'DD/MM/YYYY', label: 'dd/mm/yyyy' },
  { value: 'MM/DD/YYYY', label: 'mm/dd/yyyy' },
];

export const TIME_FORMAT_OPTIONS: { value: TimeFormatId; labelZh: string; labelEn: string }[] = [
  { value: '24h', labelZh: '24 小时制', labelEn: '24-hour' },
  { value: '12h', labelZh: '12 小时制 (AM/PM)', labelEn: '12-hour (AM/PM)' },
];

export const LANGUAGE_OPTIONS: { value: AppLanguage; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
];

export const DEFAULT_DATE_FORMAT: DateFormatId = 'YYYY-MM-DD';
export const DEFAULT_TIME_FORMAT: TimeFormatId = '24h';
export const DEFAULT_LANGUAGE: AppLanguage = 'zh-CN';

export type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function normalizeLanguage(raw: string | undefined | null): AppLanguage {
  if (!raw) return DEFAULT_LANGUAGE;
  const lower = raw.toLowerCase();
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  return 'zh-CN';
}

export function normalizeDateFormat(raw: string | undefined | null): DateFormatId {
  const allowed: DateFormatId[] = ['YYYY-MM-DD', 'YYYY/MM/DD', 'DD/MM/YYYY', 'MM/DD/YYYY'];
  if (raw && (allowed as string[]).includes(raw)) return raw as DateFormatId;
  return DEFAULT_DATE_FORMAT;
}

export function normalizeTimeFormat(raw: string | undefined | null): TimeFormatId {
  if (raw === '12h' || raw === '24h') return raw;
  return DEFAULT_TIME_FORMAT;
}

export function partsFromDate(d: Date): DateParts {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

export function partsFromISO(iso: string): DateParts | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return partsFromDate(d);
}

/** Parse form value `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` as local parts. */
export function partsFromLocalValue(value: string): DateParts | null {
  if (!value) return null;
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/,
  );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] != null ? Number(m[4]) : 0;
  const minute = m[5] != null ? Number(m[5]) : 0;
  if (!isValidYmd(year, month, day)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

export function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

export function toLocalDateValue(parts: Pick<DateParts, 'year' | 'month' | 'day'>): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function toLocalDateTimeValue(parts: DateParts): string {
  return `${toLocalDateValue(parts)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDateParts(
  parts: Pick<DateParts, 'year' | 'month' | 'day'>,
  dateFormat: DateFormatId = DEFAULT_DATE_FORMAT,
): string {
  const y = String(parts.year);
  const m = pad2(parts.month);
  const d = pad2(parts.day);
  switch (normalizeDateFormat(dateFormat)) {
    case 'YYYY/MM/DD':
      return `${y}/${m}/${d}`;
    case 'DD/MM/YYYY':
      return `${d}/${m}/${y}`;
    case 'MM/DD/YYYY':
      return `${m}/${d}/${y}`;
    case 'YYYY-MM-DD':
    default:
      return `${y}-${m}-${d}`;
  }
}

export function formatTimeParts(
  hour: number,
  minute: number,
  timeFormat: TimeFormatId = DEFAULT_TIME_FORMAT,
  language: AppLanguage = DEFAULT_LANGUAGE,
): string {
  const min = pad2(minute);
  if (normalizeTimeFormat(timeFormat) === '24h') {
    return `${pad2(hour)}:${min}`;
  }
  const { hour12, period } = to12Hour(hour);
  const labels = getPickerLabels(language);
  const periodLabel = period === 'am' ? labels.am : labels.pm;
  return `${hour12}:${min} ${periodLabel}`;
}

export function to12Hour(hour24: number): { hour12: number; period: 'am' | 'pm' } {
  const period = hour24 < 12 ? 'am' : 'pm';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, period };
}

export function from12Hour(hour12: number, period: 'am' | 'pm'): number {
  const h = ((hour12 - 1) % 12) + 1;
  if (period === 'am') return h === 12 ? 0 : h;
  return h === 12 ? 12 : h + 12;
}

export function formatDateBySetting(
  iso: string,
  dateFormat: string = DEFAULT_DATE_FORMAT,
): string {
  const parts = partsFromISO(iso);
  if (!parts) return iso;
  return formatDateParts(parts, normalizeDateFormat(dateFormat));
}

export function formatDateTimeBySetting(
  iso: string,
  dateFormat: string = DEFAULT_DATE_FORMAT,
  timeFormat: string = DEFAULT_TIME_FORMAT,
  language: string = DEFAULT_LANGUAGE,
): string {
  const parts = partsFromISO(iso);
  if (!parts) return iso;
  const lang = normalizeLanguage(language);
  return `${formatDateParts(parts, normalizeDateFormat(dateFormat))} ${formatTimeParts(
    parts.hour,
    parts.minute,
    normalizeTimeFormat(timeFormat),
    lang,
  )}`;
}

/** Format a local form value for the input display. */
export function formatLocalValueDisplay(
  localValue: string,
  opts: {
    mode: 'date' | 'datetime';
    dateFormat?: string;
    timeFormat?: string;
    language?: string;
  },
): string {
  const parts = partsFromLocalValue(localValue);
  if (!parts) return localValue;
  const dateFormat = normalizeDateFormat(opts.dateFormat);
  const date = formatDateParts(parts, dateFormat);
  if (opts.mode === 'date') return date;
  return `${date} ${formatTimeParts(
    parts.hour,
    parts.minute,
    normalizeTimeFormat(opts.timeFormat),
    normalizeLanguage(opts.language),
  )}`;
}

export type PickerLabels = {
  clear: string;
  today: string;
  am: string;
  pm: string;
  weekdays: string[];
  monthTitle: (year: number, month: number) => string;
};

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function getPickerLabels(language: string): PickerLabels {
  const lang = normalizeLanguage(language);
  if (lang === 'en') {
    return {
      clear: 'Clear',
      today: 'Today',
      am: 'AM',
      pm: 'PM',
      weekdays: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
      monthTitle: (year, month) => `${MONTHS_EN[month - 1]} ${year}`,
    };
  }
  return {
    clear: '清除',
    today: '今天',
    am: '上午',
    pm: '下午',
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    monthTitle: (year, month) => `${year}年${month}月`,
  };
}

export type CalendarCell = { day: number; inMonth: boolean; date: DateParts };

/** Build a Sun-start 6×7 calendar grid for year/month (1-12). */
export function buildCalendarCells(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month - 1, 1);
  const startPad = first.getDay();
  const cells: CalendarCell[] = [];
  const cursor = new Date(year, month - 1, 1 - startPad);
  for (let i = 0; i < 42; i++) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    const day = cursor.getDate();
    cells.push({
      day,
      inMonth: y === year && m === month,
      date: { year: y, month: m, day, hour: 0, minute: 0 },
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function documentLangFor(language: string): string {
  return normalizeLanguage(language) === 'en' ? 'en' : 'zh-CN';
}