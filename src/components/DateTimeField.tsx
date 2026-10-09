import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AppLanguage,
  type DateFormatId,
  type TimeFormatId,
  buildCalendarCells,
  formatLocalValueDisplay,
  from12Hour,
  getPickerLabels,
  normalizeDateFormat,
  normalizeLanguage,
  normalizeTimeFormat,
  partsFromLocalValue,
  shiftMonth,
  to12Hour,
  toLocalDateTimeValue,
  toLocalDateValue,
} from '../lib/datetime';

type Mode = 'date' | 'datetime';

type Props = {
  value: string;
  onChange: (next: string) => void;
  mode?: Mode;
  required?: boolean;
  dateFormat?: string;
  timeFormat?: string;
  language?: string;
  id?: string;
};

export function DateTimeField({
  value,
  onChange,
  mode = 'datetime',
  required,
  dateFormat,
  timeFormat,
  language,
  id,
}: Props) {
  const df = normalizeDateFormat(dateFormat) as DateFormatId;
  const tf = normalizeTimeFormat(timeFormat) as TimeFormatId;
  const lang = normalizeLanguage(language) as AppLanguage;
  const labels = useMemo(() => getPickerLabels(lang), [lang]);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const parts = partsFromLocalValue(value);
  const now = new Date();
  const [viewYear, setViewYear] = useState(parts?.year ?? now.getFullYear());
  const [viewMonth, setViewMonth] = useState(parts?.month ?? now.getMonth() + 1);

  useEffect(() => {
    if (!open) return;
    const p = partsFromLocalValue(value);
    if (p) {
      setViewYear(p.year);
      setViewMonth(p.month);
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const display = value
    ? formatLocalValueDisplay(value, { mode, dateFormat: df, timeFormat: tf, language: lang })
    : '';

  const cells = useMemo(() => buildCalendarCells(viewYear, viewMonth), [viewYear, viewMonth]);

  function emit(next: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  }) {
    onChange(mode === 'date' ? toLocalDateValue(next) : toLocalDateTimeValue(next));
  }

  function selectDay(year: number, month: number, day: number) {
    const hour = parts?.hour ?? now.getHours();
    const minute = parts?.minute ?? now.getMinutes();
    emit({ year, month, day, hour, minute });
    if (mode === 'date') setOpen(false);
  }

  function setHour24(hour: number) {
    if (!parts) {
      emit({
        year: viewYear,
        month: viewMonth,
        day: now.getDate(),
        hour,
        minute: 0,
      });
      return;
    }
    emit({ ...parts, hour });
  }

  function setMinute(minute: number) {
    if (!parts) {
      emit({
        year: viewYear,
        month: viewMonth,
        day: now.getDate(),
        hour: now.getHours(),
        minute,
      });
      return;
    }
    emit({ ...parts, minute });
  }

  function onClear() {
    onChange('');
    setOpen(false);
  }

  function onToday() {
    const t = new Date();
    emit({
      year: t.getFullYear(),
      month: t.getMonth() + 1,
      day: t.getDate(),
      hour: parts?.hour ?? t.getHours(),
      minute: parts?.minute ?? t.getMinutes(),
    });
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth() + 1);
    if (mode === 'date') setOpen(false);
  }

  const selectedKey = parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
  const hour24 = parts?.hour ?? 12;
  const minute = parts?.minute ?? 0;
  const { hour12, period } = to12Hour(hour24);

  const hourChoices =
    tf === '24h'
      ? Array.from({ length: 24 }, (_, i) => i)
      : [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const minuteChoices = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div className={`dt-field${open ? ' open' : ''}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="dt-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={display ? '' : 'dt-placeholder'}>{display || '—'}</span>
        <span className="dt-cal-icon" aria-hidden>
          📅
        </span>
      </button>
      <input type="text" className="dt-hidden-input" value={value} required={required} readOnly tabIndex={-1} aria-hidden />

      {open && (
        <div className="dt-popover" role="dialog">
          <div className="dt-month-nav">
            <button
              type="button"
              className="btn ghost tiny"
              aria-label="prev"
              onClick={() => {
                const n = shiftMonth(viewYear, viewMonth, -1);
                setViewYear(n.year);
                setViewMonth(n.month);
              }}
            >
              ‹
            </button>
            <span className="dt-month-title">{labels.monthTitle(viewYear, viewMonth)}</span>
            <button
              type="button"
              className="btn ghost tiny"
              aria-label="next"
              onClick={() => {
                const n = shiftMonth(viewYear, viewMonth, 1);
                setViewYear(n.year);
                setViewMonth(n.month);
              }}
            >
              ›
            </button>
          </div>

          <div className="dt-weekdays">
            {labels.weekdays.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="dt-grid">
            {cells.map((c, i) => {
              const key = `${c.date.year}-${c.date.month}-${c.date.day}`;
              const selected = key === selectedKey;
              return (
                <button
                  key={`${key}-${i}`}
                  type="button"
                  className={`dt-day${!c.inMonth ? ' muted' : ''}${selected ? ' selected' : ''}`}
                  onClick={() => selectDay(c.date.year, c.date.month, c.date.day)}
                >
                  {c.day}
                </button>
              );
            })}
          </div>

          {mode === 'datetime' && (
            <div className={`dt-time${tf === '12h' ? ' with-period' : ''}`}>
              <div className="dt-time-col" role="listbox" aria-label="hour">
                {hourChoices.map((h) => {
                  const active = tf === '24h' ? h === hour24 : h === hour12;
                  return (
                    <button
                      key={`h-${h}`}
                      type="button"
                      className={`dt-time-item${active ? ' selected' : ''}`}
                      onClick={() => {
                        if (tf === '24h') setHour24(h);
                        else setHour24(from12Hour(h, period));
                      }}
                    >
                      {tf === '24h' ? String(h).padStart(2, '0') : h}
                    </button>
                  );
                })}
              </div>
              <div className="dt-time-col" role="listbox" aria-label="minute">
                {minuteChoices.map((m) => (
                  <button
                    key={`m-${m}`}
                    type="button"
                    className={`dt-time-item${m === minute ? ' selected' : ''}`}
                    onClick={() => setMinute(m)}
                  >
                    {String(m).padStart(2, '0')}
                  </button>
                ))}
              </div>
              {tf === '12h' && (
                <div className="dt-time-col period" role="listbox" aria-label="period">
                  {(['am', 'pm'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`dt-time-item${period === p ? ' selected' : ''}`}
                      onClick={() => setHour24(from12Hour(hour12, p))}
                    >
                      {p === 'am' ? labels.am : labels.pm}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="dt-footer">
            <button type="button" className="btn ghost tiny" onClick={onClear}>
              {labels.clear}
            </button>
            <button type="button" className="btn ghost tiny" onClick={onToday}>
              {labels.today}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}