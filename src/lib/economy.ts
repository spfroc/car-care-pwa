import type { CareRecord, ChargeRecord, EconomyInterval, FuelRecord, Km } from '../types';

/** SOC after charge ≥ this → treat as "full enough" for high-confidence electric economy. */
export const CHARGE_FULL_SOC_THRESHOLD = 95;

/**
 * Odometer usable for economy intervals / mileage anchors.
 * Rejects missing, non-finite, and ≤0 (history补录 often stores unknown mileage as 0,
 * which would invent a 0→firstRealFill mega-interval and crush weighted L/100km).
 */
export function isUsableOdometer(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** History补录 flag — mark a confirmed-full endpoint as 参考; do not drop its liters. */
function excludeFromEconomy(r: { flags?: { lowConfidenceEconomy?: boolean } }): boolean {
  return r.flags?.lowConfidenceEconomy === true;
}

export type FuelEconomyDiagnosticCode =
  | 'first-fill-not-full'
  | 'consecutive-partials'
  | 'same-odo-multi-fill'
  | 'odo-rollback'
  | 'missing-or-illegal-liters'
  | 'low-confidence-backfill'
  | 'mixed-vehicles'
  | 'open-trailing-partial';

/** Read-only finding. Records themselves are never rewritten. */
export type FuelEconomyDiagnostic = {
  code: FuelEconomyDiagnosticCode;
  /** Set for single-vehicle findings. Omitted for mixed-vehicles. */
  vehicleId?: string;
  /** Fuel record ids, or vehicle ids when code is mixed-vehicles. */
  recordIds: string[];
};

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

function litersOk(r: { liters?: unknown }): boolean {
  return typeof r.liters === 'number' && Number.isFinite(r.liters) && r.liters > 0;
}

function isConfirmedFull(r: FuelRecord): boolean {
  return r.filledUp === true;
}

/** Confirmed full that was flagged 参考 (history backfill). Partials are not this. */
function isFlaggedFull(r: FuelRecord): boolean {
  return isConfirmedFull(r) && excludeFromEconomy(r);
}

function sortByDateThenOdo<T extends { odometer: Km; date: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    if (a.odometer !== b.odometer) return a.odometer - b.odometer;
    return a.id.localeCompare(b.id);
  });
}

type FuelStop = {
  odometer: Km;
  fills: FuelRecord[];
  liters: number;
  filledUp: boolean;
  /** True when a confirmed full in this stop is a low-confidence backfill. */
  flaggedFull: boolean;
};

function stopEndId(stop: FuelStop): string {
  for (let i = stop.fills.length - 1; i >= 0; i--) {
    if (isConfirmedFull(stop.fills[i])) return stop.fills[i].id;
  }
  return stop.fills[stop.fills.length - 1].id;
}

function fuelRecordIds(stops: FuelStop[]): string[] {
  return stops.flatMap((s) => s.fills.map((f) => f.id));
}

/**
 * Full-to-full fuel intervals for one vehicle.
 * Complete segment A→C: distance = C.odo − A.odo; liters = fills after A through C
 * (A excluded). Partials between two confirmed fulls are merged into that segment.
 * An open tail after the last full is returned with open/lowConfidence and is not
 * part of the confirmed average. Stored rows are not modified.
 */
function analyzeFuelVehicle(records: CareRecord[]): {
  intervals: EconomyInterval[];
  diagnostics: FuelEconomyDiagnostic[];
} {
  const fuels = records.filter((r): r is FuelRecord => r.type === 'fuel');
  if (!fuels.length) return { intervals: [], diagnostics: [] };
  const vehicleId = fuels[0].vehicleId;
  const diagnostics: FuelEconomyDiagnostic[] = [];

  const illegal = fuels.filter((r) => !litersOk(r));
  if (illegal.length) {
    diagnostics.push({
      code: 'missing-or-illegal-liters',
      vehicleId,
      recordIds: illegal.map((r) => r.id),
    });
  }
  const flagged = fuels.filter((r) => excludeFromEconomy(r));
  if (flagged.length) {
    diagnostics.push({
      code: 'low-confidence-backfill',
      vehicleId,
      recordIds: flagged.map((r) => r.id),
    });
  }

  const usable = fuels.filter((r) => isUsableOdometer(r.odometer) && litersOk(r));
  const ordered = sortByDateThenOdo(usable);
  const accepted: FuelRecord[] = [];
  const rollbackIds: string[] = [];
  let lastOdo: number | null = null;
  for (const row of ordered) {
    if (lastOdo != null && row.odometer < lastOdo) {
      rollbackIds.push(row.id);
      continue;
    }
    accepted.push(row);
    lastOdo = row.odometer;
  }
  if (rollbackIds.length) {
    diagnostics.push({ code: 'odo-rollback', vehicleId, recordIds: rollbackIds });
  }

  const stops: FuelStop[] = [];
  for (const row of accepted) {
    const prev = stops[stops.length - 1];
    if (prev && prev.odometer === row.odometer) {
      prev.fills.push(row);
      prev.liters += row.liters;
      prev.filledUp = prev.filledUp || isConfirmedFull(row);
      prev.flaggedFull = prev.flaggedFull || isFlaggedFull(row);
    } else {
      stops.push({
        odometer: row.odometer,
        fills: [row],
        liters: row.liters,
        filledUp: isConfirmedFull(row),
        flaggedFull: isFlaggedFull(row),
      });
    }
  }
  const multi = stops.filter((s) => s.fills.length > 1);
  if (multi.length) {
    diagnostics.push({
      code: 'same-odo-multi-fill',
      vehicleId,
      recordIds: fuelRecordIds(multi),
    });
  }

  const illegalOdos = illegal.filter((r) => isUsableOdometer(r.odometer)).map((r) => r.odometer);
  const intervals: EconomyInterval[] = [];

  const pushInterval = (from: FuelStop, to: FuelStop, included: FuelStop[], open: boolean) => {
    const dKm = to.odometer - from.odometer;
    if (!(dKm > 0)) return;
    const amount = included.reduce((sum, s) => sum + s.liters, 0);
    const bridgedIllegal = illegalOdos.some((odo) => odo > from.odometer && odo <= to.odometer);
    // Partials merged into a closed full→full stay confident: the later full
    // closes the tank. lowConfidenceEconomy on a not-full row only restates
    // filledUp and must not mark that closed segment as an estimate.
    const lowConfidence = open || bridgedIllegal || included.some((s) => s.flaggedFull);
    intervals.push({
      kind: 'fuel',
      fromOdometer: from.odometer,
      toOdometer: to.odometer,
      amount,
      economyPer100: (amount / dKm) * 100,
      lowConfidence,
      endRecordId: stopEndId(to),
      open,
    });
  };

  let anchor: FuelStop | null = null;
  let partials: FuelStop[] = [];
  const leading: FuelStop[] = [];

  for (const stop of stops) {
    if (!anchor) {
      if (stop.filledUp) anchor = stop;
      else leading.push(stop);
      continue;
    }
    if (stop.filledUp) {
      if (partials.length >= 2) {
        diagnostics.push({
          code: 'consecutive-partials',
          vehicleId,
          recordIds: fuelRecordIds(partials),
        });
      }
      pushInterval(anchor, stop, [...partials, stop], false);
      anchor = stop;
      partials = [];
    } else {
      partials.push(stop);
    }
  }

  if (leading.length) {
    diagnostics.push({
      code: 'first-fill-not-full',
      vehicleId,
      recordIds: fuelRecordIds(leading),
    });
    if (leading.length >= 2) {
      diagnostics.push({
        code: 'consecutive-partials',
        vehicleId,
        recordIds: fuelRecordIds(leading),
      });
    }
  }

  if (anchor && partials.length) {
    diagnostics.push({
      code: 'open-trailing-partial',
      vehicleId,
      recordIds: fuelRecordIds(partials),
    });
    if (partials.length >= 2) {
      diagnostics.push({
        code: 'consecutive-partials',
        vehicleId,
        recordIds: fuelRecordIds(partials),
      });
    }
    pushInterval(anchor, partials[partials.length - 1], partials, true);
  }

  return { intervals, diagnostics };
}

function buildFuelEconomy(records: CareRecord[]): {
  intervals: EconomyInterval[];
  diagnostics: FuelEconomyDiagnostic[];
} {
  const fuelVehicleIds: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (r.type !== 'fuel' || seen.has(r.vehicleId)) continue;
    seen.add(r.vehicleId);
    fuelVehicleIds.push(r.vehicleId);
  }
  const diagnostics: FuelEconomyDiagnostic[] = [];
  if (fuelVehicleIds.length > 1) {
    diagnostics.push({ code: 'mixed-vehicles', recordIds: fuelVehicleIds });
  }
  const intervals: EconomyInterval[] = [];
  for (const group of groupByVehicleId(records)) {
    if (!group.some((r) => r.type === 'fuel')) continue;
    const one = analyzeFuelVehicle(group);
    intervals.push(...one.intervals);
    diagnostics.push(...one.diagnostics);
  }
  return { intervals, diagnostics };
}

function electricIntervalsOneVehicle(records: CareRecord[]): EconomyInterval[] {
  const charges = sortByOdometerThenDate(
    records.filter(
      (r): r is ChargeRecord =>
        r.type === 'charge' &&
        isUsableOdometer(r.odometer) &&
        typeof r.kWh === 'number' &&
        Number.isFinite(r.kWh) &&
        r.kWh > 0,
    ),
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
      lowConfidence: isChargeLowConfidence(b) || excludeFromEconomy(b),
      endRecordId: b.id,
    });
  }
  return out;
}

/**
 * Interval fuel economy L/100km. One interval per confirmed full→full segment:
 * liters are the sum of fills after the opening full through the closing full.
 * Mid-tank fills are merged into that segment. An open tail (no closing full)
 * is included with `open: true` for the interval list only.
 * Always computed per vehicleId — never stitch odometer across vehicles.
 */
export function fuelIntervals(records: CareRecord[]): EconomyInterval[] {
  return buildFuelEconomy(records).intervals;
}

/** Explicit fuel-economy findings. Does not modify records. */
export function fuelEconomyDiagnostics(records: CareRecord[]): FuelEconomyDiagnostic[] {
  return buildFuelEconomy(records).diagnostics;
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
  /**
   * Distance-weighted average of intervals that count.
   * Fuel open-trailing segments are omitted. Other low-confidence intervals
   * (flagged fulls, partial charges) stay in the average.
   */
  value: number | null;
  /** True when `value` itself includes a low-confidence interval (UI 参考). */
  lowConfidence: boolean;
  intervalCount: number;
  lowConfidenceCount: number;
};

function countsInConfirmedAverage(iv: EconomyInterval): boolean {
  return iv.open !== true;
}

function summarizeIntervals(intervals: EconomyInterval[]): EconomySummary {
  const counted = intervals.filter(countsInConfirmedAverage);
  const lowConfidenceCount = intervals.filter((iv) => iv.lowConfidence).length;
  return {
    value: weightedAverage(counted),
    lowConfidence: counted.some((iv) => iv.lowConfidence),
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
    (r) => (r.type === 'fuel' || r.type === 'charge') && isUsableOdometer(r.odometer),
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
 * Mileage-weighted liters/km of complete full→full intervals only
 * (open trailing partials excluded). Not the mean of segment economies.
 */
export function averageFuelEconomy(records: CareRecord[]): number | null {
  return fuelEconomySummary(records).value;
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

/** Most recent confirmed fuel interval (open tail excluded; not used for hero cards). */
export function latestFuelEconomy(records: CareRecord[]): number | null {
  const ivs = fuelIntervals(records).filter(countsInConfirmedAverage);
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
