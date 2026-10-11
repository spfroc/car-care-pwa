import type { EconomyInterval } from '../types';
import { formatEconomy } from '../lib/economy';
import { useI18n } from '../i18n';

type Props = {
  intervals: EconomyInterval[];
  /** e.g. L/100km or kWh/100km */
  unitLabel: string;
  kind: 'fuel' | 'charge';
  emptyText?: string;
};

export function EconomyIntervalList({
  intervals,
  unitLabel,
  kind,
  emptyText,
}: Props) {
  const { t } = useI18n();
  const empty = emptyText ?? t('interval.empty');

  if (intervals.length === 0) {
    return <p className="muted small">{empty}</p>;
  }

  const rows = [...intervals].reverse();
  const tripKey = kind === 'fuel' ? 'interval.tripFuel' : 'interval.tripCharge';

  return (
    <ul className="interval-list">
      {rows.map((iv) => {
        const dist = iv.toOdometer - iv.fromOdometer;
        return (
          <li
            key={iv.endRecordId}
            className={`interval-row${iv.lowConfidence ? ' low-conf' : ''}`}
          >
            <div className="iv-main">
              <span className="iv-dist">{t(tripKey, { dist: dist.toFixed(0) })}</span>
              <span className="interval-meta">
                {iv.fromOdometer.toFixed(0)} → {iv.toOdometer.toFixed(0)} km
                {iv.lowConfidence ? t('interval.notFull') : ''}
              </span>
            </div>
            <div className="iv-eco">
              {formatEconomy(iv.economyPer100, unitLabel)} {unitLabel}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
