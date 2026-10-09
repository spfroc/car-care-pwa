import type { CareRecord, Km, KWh, Liter, Money, Vehicle } from '../types';

/**
 * Mileage / volume / cost helpers for the vehicle detail hero card.
 *
 * Definitions (keep in sync with README / PRD):
 * - **行驶里程** (driving odometer): the vehicle's actual total odometer.
 *   Seeded by `vehicle.initialOdometer` when the car is created/edited;
 *   thereafter the max odometer among records with a mileage reading
 *   (fuel/charge always require one; other types may include one).
 * - **统计里程** (tracked mileage): distance driven while the app has been
 *   tracking = 行驶里程 − baseline. Baseline is `initialOdometer` when set;
 *   otherwise the earliest (minimum) odometer among records. Never negative.
 * - **每公里成本**: total spend ÷ 统计里程 (¥/km when currency is CNY).
 * - **总加油量 / 总充电量**: Σ liters on fuel records / Σ kWh on charge records.
 */

export interface VehicleMileageSummary {
  /** Current total odometer (行驶里程). */
  drivingOdometer: Km | null;
  /** App-tracked distance since baseline (统计里程). */
  trackedMileage: Km | null;
  /** Baseline used for tracked mileage (initialOdometer or first record odo). */
  baselineOdometer: Km | null;
}

/** All numeric odometer readings on records (any type). */
export function recordOdometers(records: CareRecord[]): Km[] {
  const out: Km[] = [];
  for (const r of records) {
    if (typeof r.odometer === 'number' && Number.isFinite(r.odometer)) {
      out.push(r.odometer);
    }
  }
  return out;
}

export function summarizeMileage(
  vehicle: Pick<Vehicle, 'initialOdometer'>,
  records: CareRecord[],
): VehicleMileageSummary {
  const odos = recordOdometers(records);
  const maxRec = odos.length ? Math.max(...odos) : undefined;
  const minRec = odos.length ? Math.min(...odos) : undefined;
  const initial =
    typeof vehicle.initialOdometer === 'number' && Number.isFinite(vehicle.initialOdometer)
      ? vehicle.initialOdometer
      : undefined;

  let drivingOdometer: Km | null = null;
  if (maxRec != null && initial != null) {
    drivingOdometer = Math.max(maxRec, initial);
  } else if (maxRec != null) {
    drivingOdometer = maxRec;
  } else if (initial != null) {
    drivingOdometer = initial;
  }

  const baselineOdometer: Km | null =
    initial != null ? initial : minRec != null ? minRec : null;

  let trackedMileage: Km | null = null;
  if (drivingOdometer != null && baselineOdometer != null) {
    trackedMileage = Math.max(0, drivingOdometer - baselineOdometer);
  }

  return { drivingOdometer, trackedMileage, baselineOdometer };
}

/** Cost per tracked km; null when tracked mileage is missing or ≤ 0. */
export function costPerKm(totalSpend: Money, trackedMileage: Km | null | undefined): Money | null {
  if (trackedMileage == null || trackedMileage <= 0) return null;
  if (!Number.isFinite(totalSpend)) return null;
  return totalSpend / trackedMileage;
}

export function totalFuelLiters(records: CareRecord[]): Liter {
  let sum = 0;
  for (const r of records) {
    if (r.type === 'fuel' && typeof r.liters === 'number' && Number.isFinite(r.liters)) {
      sum += r.liters;
    }
  }
  return sum;
}

export function totalChargeKWh(records: CareRecord[]): KWh {
  let sum = 0;
  for (const r of records) {
    if (r.type === 'charge' && typeof r.kWh === 'number' && Number.isFinite(r.kWh)) {
      sum += r.kWh;
    }
  }
  return sum;
}

/** Format 「统计里程/行驶里程」 e.g. `1000/1100`; `—` when both unknown. */
export function formatMileagePair(summary: VehicleMileageSummary): string {
  const { trackedMileage, drivingOdometer } = summary;
  if (trackedMileage == null && drivingOdometer == null) return '—';
  const left = trackedMileage == null ? '—' : formatKm(trackedMileage);
  const right = drivingOdometer == null ? '—' : formatKm(drivingOdometer);
  return `${left}/${right}`;
}

function formatKm(n: Km): string {
  // Whole km when integer; otherwise up to 1 decimal to avoid noisy UI.
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
