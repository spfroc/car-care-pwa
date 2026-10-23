import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  averageFuelEconomy,
  confidentFuelEconomy,
  fuelEconomyDiagnostics,
  fuelEconomySummary,
  fuelIntervals,
} from './economy';
import type { CareRecord } from '../types';

/**
 * Fuel rows copied from the attached car-care-export-v1-no-media export.
 * Plates, payments, stations, and non-fuel records are not in the fixture.
 * Expected economies are recomputed from these rows (not literals such as 2.26).
 */

type RawFuel = {
  id: string;
  vehicleId: string;
  type: 'fuel';
  date: string;
  odometer: number;
  liters: number;
  filledUp: boolean;
  flags?: { odometerAnomaly?: boolean; lowConfidenceEconomy?: boolean };
};

type Fixture = {
  vehicles: Array<{ id: string; name: string; energyType: string; initialOdometer?: number }>;
  records: RawFuel[];
};

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/car-care-export-v1-no-media.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

const base = {
  mediaIds: [] as string[],
  amountPaid: 0,
  fuelGrade: '92#',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function asRecords(rows: RawFuel[]): CareRecord[] {
  return rows.map((r) => ({ ...base, ...r }));
}

function byDate(rows: RawFuel[]): RawFuel[] {
  return [...rows].sort((a, b) => {
    const byDateKey = a.date.localeCompare(b.date);
    if (byDateKey !== 0) return byDateKey;
    if (a.odometer !== b.odometer) return a.odometer - b.odometer;
    return a.id.localeCompare(b.id);
  });
}

/** Usable fuel rows for one vehicle, date order. */
function usableFuels(vehicleId: string): RawFuel[] {
  return byDate(
    fixture.records.filter(
      (r) =>
        r.vehicleId === vehicleId &&
        r.type === 'fuel' &&
        typeof r.odometer === 'number' &&
        Number.isFinite(r.odometer) &&
        r.odometer > 0 &&
        typeof r.liters === 'number' &&
        Number.isFinite(r.liters) &&
        r.liters > 0,
    ),
  );
}

/**
 * Complete full→full segments from raw rows.
 * Valid when odometer is strictly increasing in date order (no rollback, no same-odo).
 */
function expectedCompleteIntervals(rows: RawFuel[]) {
  const fulls = rows.filter((r) => r.filledUp === true);
  const out: Array<{
    from: number;
    to: number;
    liters: number;
    km: number;
    economyPer100: number;
    endId: string;
  }> = [];
  for (let i = 1; i < fulls.length; i++) {
    const start = fulls[i - 1];
    const end = fulls[i];
    const included = rows.filter((r) => r.odometer > start.odometer && r.odometer <= end.odometer);
    const liters = included.reduce((sum, r) => sum + r.liters, 0);
    const km = end.odometer - start.odometer;
    out.push({
      from: start.odometer,
      to: end.odometer,
      liters,
      km,
      economyPer100: (liters / km) * 100,
      endId: end.id,
    });
  }
  return out;
}

/** Previous adjacent-fill average, including not-full segments. */
function adjacentAverage(rows: RawFuel[]): number {
  let liters = 0;
  let km = 0;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].odometer - rows[i - 1].odometer;
    if (d <= 0) continue;
    liters += rows[i].liters;
    km += d;
  }
  return (liters / km) * 100;
}

/**
 * Previous confident-only adjacent average: drop a segment whose end fill is not full
 * or is flagged. That drops the partial's liters without adding them to the next full.
 */
function adjacentConfidentAverage(rows: RawFuel[]): number | null {
  let liters = 0;
  let km = 0;
  for (let i = 1; i < rows.length; i++) {
    const end = rows[i];
    const d = end.odometer - rows[i - 1].odometer;
    if (d <= 0) continue;
    const low = end.filledUp !== true || end.flags?.lowConfidenceEconomy === true;
    if (low) continue;
    liters += end.liters;
    km += d;
  }
  if (km <= 0) return null;
  return (liters / km) * 100;
}

function spanAverage(rows: RawFuel[]): number {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const liters = rows.reduce((sum, r) => sum + r.liters, 0) - first.liters;
  const km = last.odometer - first.odometer;
  return (liters / km) * 100;
}

describe('export fixture fuel economy (computed from raw rows)', () => {
  const names = ['Spacy125', 'X-RV'] as const;

  it('loads both vehicles from the fuel-only export copy', () => {
    expect(fixture.vehicles.map((v) => v.name).sort()).toEqual(['Spacy125', 'X-RV']);
    expect(fixture.records.every((r) => r.type === 'fuel')).toBe(true);
  });

  for (const name of names) {
    it(`${name}: confirmed average matches full-to-full liters and km from the raw rows`, () => {
      const vehicle = fixture.vehicles.find((v) => v.name === name);
      expect(vehicle).toBeTruthy();
      const rows = usableFuels(vehicle!.id);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].odometer).toBeGreaterThan(rows[i - 1].odometer);
      }
      expect(rows[0].filledUp).toBe(true);
      expect(rows[rows.length - 1].filledUp).toBe(true);

      const independent = spanAverage(rows);
      const expected = expectedCompleteIntervals(rows);
      const records = asRecords(rows);
      const before = structuredClone(records);
      const ivs = fuelIntervals(records);
      expect(records).toEqual(before);

      expect(ivs.filter((iv) => iv.open)).toHaveLength(0);
      expect(ivs).toHaveLength(expected.length);
      for (const exp of expected) {
        const iv = ivs.find((row) => row.endRecordId === exp.endId);
        expect(iv, `${name} ${exp.from}→${exp.to}`).toBeTruthy();
        expect(iv!.fromOdometer).toBe(exp.from);
        expect(iv!.toOdometer).toBe(exp.to);
        expect(iv!.amount).toBeCloseTo(exp.liters, 6);
        expect(iv!.economyPer100).toBeCloseTo(exp.economyPer100, 6);
        expect(iv!.open).toBe(false);
      }

      const summedLiters = expected.reduce((sum, iv) => sum + iv.liters, 0);
      const summedKm = expected.reduce((sum, iv) => sum + iv.km, 0);
      const weighted = (summedLiters / summedKm) * 100;
      expect(weighted).toBeCloseTo(independent, 8);
      expect(averageFuelEconomy(records)).toBeCloseTo(independent, 8);
      expect(fuelEconomySummary(records).value).toBeCloseTo(independent, 8);
      expect(confidentFuelEconomy(records)).toBeCloseTo(independent, 8);

      // Closed chain: the old adjacent average (partials included) matches the span.
      // The old confident-only average does not, once a not-full fill is dropped.
      expect(adjacentAverage(rows)).toBeCloseTo(independent, 8);
      const oldConfident = adjacentConfidentAverage(rows);
      const partials = rows.filter((r) => r.filledUp !== true);
      if (partials.length) {
        expect(oldConfident).not.toBeCloseTo(independent, 2);
        for (const partial of partials) {
          expect(ivs.some((iv) => iv.endRecordId === partial.id)).toBe(false);
          const cover = ivs.find((iv) => iv.fromOdometer < partial.odometer && iv.toOdometer > partial.odometer);
          expect(cover).toBeTruthy();
          expect(cover!.lowConfidence).toBe(false);
        }
      } else {
        expect(oldConfident).toBeCloseTo(independent, 8);
      }

      const flagged = rows.filter((r) => r.flags?.lowConfidenceEconomy === true).map((r) => r.id);
      const backfill = fuelEconomyDiagnostics(records).find((d) => d.code === 'low-confidence-backfill');
      if (flagged.length) expect(backfill?.recordIds).toEqual(flagged);
      else expect(backfill).toBeUndefined();
    });
  }

  it('does not stitch Spacy125 and X-RV into one odometer chain', () => {
    const records = asRecords(fixture.records);
    const ivs = fuelIntervals(records);
    const byVehicle = new Map(fixture.vehicles.map((v) => [v.id, new Set(usableFuels(v.id).map((r) => r.id))]));
    for (const iv of ivs) {
      const owners = [...byVehicle.entries()].filter(([, ids]) => ids.has(iv.endRecordId));
      expect(owners).toHaveLength(1);
    }
    let liters = 0;
    let km = 0;
    for (const vehicle of fixture.vehicles) {
      const rows = usableFuels(vehicle.id);
      liters += rows.reduce((sum, r) => sum + r.liters, 0) - rows[0].liters;
      km += rows[rows.length - 1].odometer - rows[0].odometer;
    }
    expect(averageFuelEconomy(records)).toBeCloseTo((liters / km) * 100, 8);
    const mixed = fuelEconomyDiagnostics(records).find((d) => d.code === 'mixed-vehicles');
    expect(mixed?.recordIds.sort()).toEqual(fixture.vehicles.map((v) => v.id).sort());
  });

  it('recomputes X-RV when the not-full fill is deleted from the input', () => {
    const vehicle = fixture.vehicles.find((v) => v.name === 'X-RV')!;
    const rows = usableFuels(vehicle.id);
    const partial = rows.find((r) => r.filledUp !== true);
    expect(partial).toBeTruthy();
    const withPartial = asRecords(rows);
    const covered = fuelIntervals(withPartial).find(
      (iv) => iv.fromOdometer < partial!.odometer && iv.toOdometer > partial!.odometer,
    )!;
    expect(covered.amount).toBeGreaterThan(partial!.liters);
    const without = asRecords(rows.filter((r) => r.id !== partial!.id));
    const after = fuelIntervals(without).find((iv) => iv.fromOdometer === covered.fromOdometer)!;
    expect(after.amount).toBeCloseTo(covered.amount - partial!.liters, 6);
    expect(withPartial.find((r) => r.id === partial!.id)).toBeTruthy();
  });
});
