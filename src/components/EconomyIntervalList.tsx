import type { EconomyInterval } from '../types';
import { formatEconomy } from '../lib/economy';

type Props = {
  intervals: EconomyInterval[];
  /** e.g. L/100km or kWh/100km */
  unitLabel: string;
  /** 加油 or 充电 */
  kindLabel: '加油' | '充电';
  emptyText?: string;
};

export function EconomyIntervalList({
  intervals,
  unitLabel,
  kindLabel,
  emptyText = '暂无区间数据（至少两条补能记录）',
}: Props) {
  if (intervals.length === 0) {
    return <p className="muted small">{emptyText}</p>;
  }

  // Newest interval first
  const rows = [...intervals].reverse();

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
              <span className="iv-dist">
                本次{kindLabel}行驶里程 {dist.toFixed(0)} km
              </span>
              <span className="interval-meta">
                {iv.fromOdometer.toFixed(0)} → {iv.toOdometer.toFixed(0)} km
                {iv.lowConfidence ? ' · 未加满（参考）' : ''}
              </span>
            </div>
            <div className="iv-eco">
              {formatEconomy(iv.economyPer100)} {unitLabel}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
