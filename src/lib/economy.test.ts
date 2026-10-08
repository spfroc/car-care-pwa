import { describe, expect, it } from 'vitest';
import {
  combinedEconomy,
  electricIntervals,
  fuelIntervals,
  weightedAverage,
} from './economy';
import type { CareRecord } from '../types';

const base = {
  mediaIds: [] as string[],
  amountPaid: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('fuelIntervals', () => {
  it('computes L/100km with full-tank method', () => {
    const records: CareRecord[] = [
      {
        ...base,
        id: 'a',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-01T10:00:00.000Z',
        odometer: 1000,
        liters: 40,
        fuelGrade: '95#',
        filledUp: true,
      },
      {
        ...base,
        id: 'b',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-10T10:00:00.000Z',
        odometer: 1500,
        liters: 40,
        fuelGrade: '95#',
        filledUp: true,
      },
    ];
    const ivs = fuelIntervals(records);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].economyPer100).toBeCloseTo(8, 5); // 40/500*100
    expect(ivs[0].lowConfidence).toBe(false);
  });

  it('marks lowConfidence when not filled up', () => {
    const records: CareRecord[] = [
      { ...base, id: 'a', vehicleId: 'v', type: 'fuel', date: '2026-01-01T10:00:00.000Z', odometer: 1000, liters: 40, fuelGrade: '95#', filledUp: true },
      { ...base, id: 'b', vehicleId: 'v', type: 'fuel', date: '2026-01-10T10:00:00.000Z', odometer: 1200, liters: 10, fuelGrade: '95#', filledUp: false },
    ];
    const ivs = fuelIntervals(records);
    expect(ivs[0].economyPer100).toBeCloseTo(5, 5);
    expect(ivs[0].lowConfidence).toBe(true);
  });
});

describe('electricIntervals', () => {
  it('computes kWh/100km', () => {
    const records: CareRecord[] = [
      { ...base, id: 'a', vehicleId: 'v', type: 'charge', date: '2026-01-01T10:00:00.000Z', odometer: 1000, kWh: 40, stationName: 'x', stationKind: 'home' },
      { ...base, id: 'b', vehicleId: 'v', type: 'charge', date: '2026-01-05T10:00:00.000Z', odometer: 1200, kWh: 30, stationName: 'x', stationKind: 'public' },
    ];
    const ivs = electricIntervals(records);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].economyPer100).toBeCloseTo(15, 5);
  });
});

describe('weightedAverage', () => {
  it('distance-weights intervals', () => {
    const avg = weightedAverage([
      { kind: 'fuel', fromOdometer: 0, toOdometer: 100, amount: 10, economyPer100: 10, lowConfidence: false, endRecordId: '1' },
      { kind: 'fuel', fromOdometer: 100, toOdometer: 300, amount: 10, economyPer100: 5, lowConfidence: false, endRecordId: '2' },
    ]);
    // (10+10)/(100+200)*100 = 6.666...
    expect(avg).toBeCloseTo(20 / 3, 5);
  });
});

describe('combinedEconomy', () => {
  it('folds kWh with factor into L/100km', () => {
    const records: CareRecord[] = [
      { ...base, id: 'f1', vehicleId: 'v', type: 'fuel', date: '2026-01-01T10:00:00.000Z', odometer: 1000, liters: 20, fuelGrade: '95#', filledUp: true, amountPaid: 1 },
      { ...base, id: 'c1', vehicleId: 'v', type: 'charge', date: '2026-01-02T10:00:00.000Z', odometer: 1100, kWh: 10, stationName: 'h', stationKind: 'home', amountPaid: 0 },
      { ...base, id: 'f2', vehicleId: 'v', type: 'fuel', date: '2026-01-10T10:00:00.000Z', odometer: 1500, liters: 15, fuelGrade: '95#', filledUp: true, amountPaid: 1 },
    ];
    const k = 0.112;
    const r = combinedEconomy(records, k);
    expect(r).not.toBeNull();
    // Δkm = 500; litersEq = 20+15 + 0.112*10 = 36.12; *100/500 = 7.224
    expect(r!.economyPer100).toBeCloseTo(7.224, 3);
  });
});
