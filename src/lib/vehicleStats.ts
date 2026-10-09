import type { CareRecord, EnergyType, Km, KWh, Liter, Money, Vehicle } from '../types';
import { allowsCharge, allowsFuel } from './energy';

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
 * - **加油花费 / 充电花费** (hero): Σ amountPaid on fuel / charge records with
 *   odometer **strictly after** the stats baseline (same baseline as 统计里程).
 *   Which rows appear depends on energy type (see `heroEnergyCosts`).
 * - **每公里成本** (hero): energy-spend numerator ÷ 统计里程 (¥/km when CNY).
 *   Numerator matches energy type — fuel, charge, or fuel+charge — never
 *   maintenance/insurance/etc. Full category totals remain on Stats / home expand.
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

function spendOfTypeAfterBaseline(
  records: CareRecord[],
  type: 'fuel' | 'charge',
  baselineOdometer: Km | null | undefined,
): Money {
  let sum = 0;
  for (const r of records) {
    if (r.type !== type) continue;
    if (typeof r.odometer !== 'number' || !Number.isFinite(r.odometer)) continue;
    if (baselineOdometer != null && Number.isFinite(baselineOdometer) && r.odometer <= baselineOdometer) {
      continue;
    }
    const p = r.amountPaid;
    if (typeof p === 'number' && Number.isFinite(p)) sum += p;
  }
  return sum;
}

/**
 * Sum amountPaid on fuel (加油) records after stats tracking started.
 * Includes only fuel with odometer strictly greater than baseline
 * (initialOdometer, or earliest record odo when initial is unset).
 * When baseline is null, all fuel amountPaid are included.
 */
export function fuelSpendAfterBaseline(
  records: CareRecord[],
  baselineOdometer: Km | null | undefined,
): Money {
  return spendOfTypeAfterBaseline(records, 'fuel', baselineOdometer);
}

/** Sum amountPaid on charge (充电) records after stats tracking started (same baseline rules as fuel). */
export function chargeSpendAfterBaseline(
  records: CareRecord[],
  baselineOdometer: Km | null | undefined,
): Money {
  return spendOfTypeAfterBaseline(records, 'charge', baselineOdometer);
}

/** Cost per tracked km; null when tracked mileage is missing or ≤ 0. */
export function costPerKm(totalSpend: Money, trackedMileage: Km | null | undefined): Money | null {
  if (trackedMileage == null || trackedMileage <= 0) return null;
  if (!Number.isFinite(totalSpend)) return null;
  return totalSpend / trackedMileage;
}

/**
 * Detail-hero energy cost bundle: which spend lines to show and the ¥/km numerator.
 *
 * | Energy | Shown spend | 每公里成本 numerator |
 * |--------|-------------|----------------------|
 * | ICE / HEV (no charge) | 加油花费 | fuel |
 * | EV | 充电花费 | charge |
 * | PHEV / REEV / HEV+charge | 加油 + 充电 | fuel + charge |
 * | OTHER / FCEV | whichever of fuel/charge is allowed | sum of shown |
 */
export interface HeroEnergyCosts {
  showFuelSpend: boolean;
  showChargeSpend: boolean;
  fuelSpend: Money;
  chargeSpend: Money;
  /** Numerator for 每公里成本 (matches shown energy spends). */
  costPerKmNumerator: Money;
  /** Short helper: what ÷ 统计里程. */
  costPerKmHint: string;
}

export function heroEnergyCosts(
  energyType: EnergyType,
  records: CareRecord[],
  baselineOdometer: Km | null | undefined,
  hevAllowCharge = false,
): HeroEnergyCosts {
  const fuelOk = allowsFuel(energyType);
  const chargeOk = allowsCharge(energyType, hevAllowCharge);
  const fuelSpend = fuelSpendAfterBaseline(records, baselineOdometer);
  const chargeSpend = chargeSpendAfterBaseline(records, baselineOdometer);

  // EV: charge only (never show 加油花费 ¥0).
  if (energyType === 'EV') {
    return {
      showFuelSpend: false,
      showChargeSpend: true,
      fuelSpend,
      chargeSpend,
      costPerKmNumerator: chargeSpend,
      costPerKmHint: '充电花费 ÷ 统计里程',
    };
  }

  // Pure fuel path: ICE, HEV without charge, FCEV treated as fuel-like.
  if (fuelOk && !chargeOk) {
    return {
      showFuelSpend: true,
      showChargeSpend: false,
      fuelSpend,
      chargeSpend,
      costPerKmNumerator: fuelSpend,
      costPerKmHint: '加油花费 ÷ 统计里程',
    };
  }

  // Dual-energy: PHEV / REEV / HEV+charge / OTHER with both.
  if (fuelOk && chargeOk) {
    return {
      showFuelSpend: true,
      showChargeSpend: true,
      fuelSpend,
      chargeSpend,
      costPerKmNumerator: fuelSpend + chargeSpend,
      costPerKmHint: '加油+充电花费 ÷ 统计里程',
    };
  }

  // Charge-only fallback (should be rare).
  return {
    showFuelSpend: false,
    showChargeSpend: chargeOk,
    fuelSpend,
    chargeSpend,
    costPerKmNumerator: chargeSpend,
    costPerKmHint: '充电花费 ÷ 统计里程',
  };
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
