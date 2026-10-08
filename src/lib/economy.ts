import type { CareRecord, ChargeRecord, EconomyInterval, FuelRecord, Km } from '../types';

function sortByOdometerThenDate<T extends { odometer: Km; date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.odometer !== b.odometer) return a.odometer - b.odometer;
    return a.date.localeCompare(b.date);
  });
}

/** Interval fuel economy L/100km using full-tank method (B.liters / Δkm * 100). */
export function fuelIntervals(records: CareRecord[]): EconomyInterval[] {
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

/** Interval electric economy kWh/100km. */
export function electricIntervals(records: CareRecord[]): EconomyInterval[] {
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
      lowConfidence: false,
      endRecordId: b.id,
    });
  }
  return out;
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
  const anchors = records.filter(
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
  for (const r of records) {
    if (typeof r.odometer !== 'number') continue;
    if (r.odometer < from || r.odometer > to) continue;
    if (r.type === 'fuel') liters += r.liters;
    if (r.type === 'charge') kwh += r.kWh;
  }
  // Exclude the first anchor's fill if using full-tank semantics for combined window:
  // PRD: sum L + k*sum kWh in window. Include all in range.
  const litersEq = liters + kwhToLiterFactor * kwh;
  return {
    economyPer100: (litersEq / deltaKm) * 100,
    deltaKm,
    litersEq,
  };
}

export function latestFuelEconomy(records: CareRecord[]): number | null {
  const ivs = fuelIntervals(records);
  if (!ivs.length) return null;
  return ivs[ivs.length - 1].economyPer100;
}

export function latestElectricEconomy(records: CareRecord[]): number | null {
  const ivs = electricIntervals(records);
  if (!ivs.length) return null;
  return ivs[ivs.length - 1].economyPer100;
}
