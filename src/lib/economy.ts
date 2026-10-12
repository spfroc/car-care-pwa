import type { CareRecord, ChargeRecord, EconomyInterval, FuelRecord, Km } from '../types';

/** SOC after charge ≥ this → treat as "full enough" for high-confidence electric economy. */
export const CHARGE_FULL_SOC_THRESHOLD = 95;

function sortByOdometerThenDate<T extends { odometer: Km; date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.odometer !== b.odometer) return a.odometer - b.odometer;
    return a.date.localeCompare(b.date);
  });
}

/** Group records by vehicleId (preserves first-seen order of vehicle keys). */
function groupByVehicleId(records: CareRecord[]): CareRecord[][] {
  const map = new Map<string, CareRecord[]>();
  for (const r of records) {
    let list = map.get(r.vehicleId);
    if (!list) {
      list = [];
      map.set(r.vehicleId, list);
    }
    list.push(r);
  }
  return [...map.values()];
}

/** Charge endpoint is low-confidence when SOC-after is known and below full threshold. */
export function isChargeLowConfidence(end: ChargeRecord): boolean {
  if (typeof end.socAfter === 'number' && Number.isFinite(end.socAfter)) {
    return end.socAfter < CHARGE_FULL_SOC_THRESHOLD;
  }
  return false;
}

function fuelIntervalsOneVehicle(records: CareRecord[]): EconomyInterval[] {
  const fuels = sortByOdometerThenDate(
    records.filter((r): r is FuelRecord => r.type === 'fuel' && typeof r.odometer === 'number'),
  );
  const out: EconomyInterval[] = [];
  for (let i = 1; i < fuels.length; i++) {
    const a = fuels[i - 1];
    const b = fuels[i];
    const dKm = b.odometer - a.odometer;
    if (dKm <= 0) continue;
    out.push({
      kind: 'fuel',
      fromOdometer: a.odometer,
      toOdometer: b.odometer,
      amount: b.liters,
      economyPer100: (b.liters / dKm) * 100,
      lowConfidence: !b.filledUp,
      endRecordId: b.id,
    });
  }
  return out;
}

function electricIntervalsOneVehicle(records: CareRecord[]): EconomyInterval[] {
  const charges = sortByOdometerThenDate(
    records.filter((r): r is ChargeRecord => r.type === 'charge' && typeof r.odometer === 'number'),
  );
  const out: EconomyInterval[] = [];
  for (let i = 1; i < charges.length; i++) {
    const a = charges[i - 1];
    const b = charges[i];
    const dKm = b.odometer - a.odometer;
    if (dKm <= 0) continue;
    out.push({
      kind: 'electric',
      fromOdometer: a.odometer,
      toOdometer: b.odometer,
      amount: b.kWh,
      economyPer100: (b.kWh / dKm) * 100,
      lowConfidence: isChargeLowConfidence(b),
      endRecordId: b.id,
    });
  }
  return out;
}

/**
 * Interval fuel economy L/100km using full-tank method (B.liters / Δkm * 100).
 * Always computed per vehicleId then merged — never stitch odometer across vehicles
 * (Stats「全部车辆」 must not invent cross-car intervals).
 */
export function fuelIntervals(records: CareRecord[]): EconomyInterval[] {
  return groupByVehicleId(records).flatMap(fuelIntervalsOneVehicle);
}

/**
 * Interval electric economy kWh/100km.
 * Always computed per vehicleId then merged (same anti-cross-stitch rule as fuel).
 */
export function electricIntervals(records: CareRecord[]): EconomyInterval[] {
  return groupByVehicleId(records).flatMap(electricIntervalsOneVehicle);
}

/** Distance-weighted average economy from intervals. */
export function weightedAverage(intervals: EconomyInterval[]): number | null {
  let sumAmt = 0;
  let sumKm = 0;
  for (const iv of intervals) {
    const d = iv.toOdometer - iv.fromOdometer;
    if (d <= 0) continue;
    sumAmt += iv.amount;
    sumKm += d;
  }
  if (sumKm <= 0) return null;
  return (sumAmt / sumKm) * 100;
}

export type EconomySummary = {
  /** Distance-weighted average (includes low-confidence intervals per PRD). */
  value: number | null;
  /** True when any included interval is lowConfidence (UI should show 参考 caveat). */
  lowConfidence: boolean;
  intervalCount: number;
  lowConfidenceCount: number;
};

function summarizeIntervals(intervals: EconomyInterval[]): EconomySummary {
  const lowConfidenceCount = intervals.filter((iv) => iv.lowConfidence).length;
  return {
    value: weightedAverage(intervals),
    lowConfidence: lowConfidenceCount > 0,
    intervalCount: intervals.length,
    lowConfidenceCount,
  };
}

/**
 * Combined economy for PHEV/REEV in L-equivalent/100km over odometer window.
 * Uses all fuel liters + k * kWh in [O1, O2], Δkm = O2-O1.
 * Window defaults to min/max odometer among fuel+charge records with odometer.
 */
export function combinedEconomy(
  records: CareRecord[],
  kwhToLiterFactor: number,
  window?: { from: Km; to: Km },
): { economyPer100: number; deltaKm: number; litersEq: number } | null {
  // Per-vehicle only: never cross-stitch multi-vehicle odometers for combined.
  const groups = groupByVehicleId(records);
  if (groups.length !== 1) return null;

  const scope = groups[0];
  const anchors = scope.filter(
    (r) => (r.type === 'fuel' || r.type === 'charge') && typeof r.odometer === 'number',
  ) as Array<(FuelRecord | ChargeRecord)>;
  if (anchors.length < 2) return null;

  const odos = anchors.map((r) => r.odometer);
  const from = window?.from ?? Math.min(...odos);
  const to = window?.to ?? Math.max(...odos);
  const deltaKm = to - from;
  if (deltaKm <= 0) return null;

  let liters = 0;
  let kwh = 0;
  for (const r of scope) {
    if (typeof r.odometer !== 'number') continue;
    if (r.odometer < from || r.odometer > to) continue;
    if (r.type === 'fuel') liters += r.liters;
    if (r.type === 'charge') kwh += r.kWh;
  }
  const litersEq = liters + kwhToLiterFactor * kwh;
  return {
    economyPer100: (litersEq / deltaKm) * 100,
    deltaKm,
    litersEq,
  };
}

/**
 * Average fuel economy for home card / detail hero / stats summary.
 * Same formula everywhere: distance-weighted average of full-tank intervals.
 */
export function averageFuelEconomy(records: CareRecord[]): number | null {
  return weightedAverage(fuelIntervals(records));
}

/**
 * Average electric economy for home card / detail hero / stats summary.
 * Same formula everywhere: distance-weighted average of charge intervals.
 */
export function averageElectricEconomy(records: CareRecord[]): number | null {
  return weightedAverage(electricIntervals(records));
}

/** Fuel economy with low-confidence caveat metadata for UI. */
export function fuelEconomySummary(records: CareRecord[]): EconomySummary {
  return summarizeIntervals(fuelIntervals(records));
}

/** Electric economy with low-confidence caveat metadata for UI. */
export function electricEconomySummary(records: CareRecord[]): EconomySummary {
  return summarizeIntervals(electricIntervals(records));
}

/**
 * High-confidence-only average (excludes partial fills / low-SOC charges).
 * Returns null when no confident intervals exist (caller may fall back + caveat).
 */
export function confidentFuelEconomy(records: CareRecord[]): number | null {
  return weightedAverage(fuelIntervals(records).filter((iv) => !iv.lowConfidence));
}

export function confidentElectricEconomy(records: CareRecord[]): number | null {
  return weightedAverage(electricIntervals(records).filter((iv) => !iv.lowConfidence));
}

/** Most recent single fuel interval economy (not used for hero cards). */
export function latestFuelEconomy(records: CareRecord[]): number | null {
  const ivs = fuelIntervals(records);
  if (!ivs.length) return null;
  return ivs[ivs.length - 1].economyPer100;
}

/** Most recent single electric interval economy (not used for hero cards). */
export function latestElectricEconomy(records: CareRecord[]): number | null {
  const ivs = electricIntervals(records);
  if (!ivs.length) return null;
  return ivs[ivs.length - 1].economyPer100;
}

/**
 * Convert canonical economyPer100 (L/100km or kWh/100km) to the display unit.
 * km/L = 100 / (L/100km); km/kWh = 100 / (kWh/100km).
 * Non-finite or ≤0 inputs are returned unchanged (caller shows "—" for null averages).
 */
export function convertEconomy(economyPer100: number, unit?: string): number {
  if (unit !== 'km/L' && unit !== 'km/kWh') return economyPer100;
  if (!Number.isFinite(economyPer100) || economyPer100 <= 0) return economyPer100;
  return 100 / economyPer100;
}

/**
 * Display economy with unified 2 decimal places (home, detail, timeline, stats).
 * Pass the settings unit so km/L and km/kWh convert the value, not only the suffix.
 */
export function formatEconomy(economyPer100: number, unit?: string): string {
  return convertEconomy(economyPer100, unit).toFixed(2);
}
