import { describe, expect, it } from 'vitest';
import {
  costPerKm,
  formatMileagePair,
  summarizeMileage,
  totalChargeKWh,
  totalFuelLiters,
} from './vehicleStats';
import type { CareRecord } from '../types';

const base = {
  mediaIds: [] as string[],
  amountPaid: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('summarizeMileage', () => {
  it('uses initialOdometer as baseline and latest record as 行驶里程', () => {
    const records: CareRecord[] = [
      {
        ...base,
        id: 'a',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-01T10:00:00.000Z',
        odometer: 100,
        liters: 40,
        fuelGrade: '95#',
        filledUp: true,
      },
      {
        ...base,
        id: 'b',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-02-01T10:00:00.000Z',
        odometer: 1100,
        liters: 40,
        fuelGrade: '95#',
        filledUp: true,
      },
    ];
    const s = summarizeMileage({ initialOdometer: 100 }, records);
    expect(s.baselineOdometer).toBe(100);
    expect(s.drivingOdometer).toBe(1100);
    expect(s.trackedMileage).toBe(1000);
    expect(formatMileagePair(s)).toBe('1000/1100');
  });

  it('falls back to first record odo when initial is missing', () => {
    const records: CareRecord[] = [
      {
        ...base,
        id: 'a',
        vehicleId: 'v',
        type: 'charge',
        date: '2026-01-01T10:00:00.000Z',
        odometer: 5000,
        kWh: 20,
        stationName: 'h',
        stationKind: 'home',
      },
      {
        ...base,
        id: 'b',
        vehicleId: 'v',
        type: 'charge',
        date: '2026-01-10T10:00:00.000Z',
        odometer: 5300,
        kWh: 25,
        stationName: 'h',
        stationKind: 'home',
      },
    ];
    const s = summarizeMileage({}, records);
    expect(s.baselineOdometer).toBe(5000);
    expect(s.drivingOdometer).toBe(5300);
    expect(s.trackedMileage).toBe(300);
  });

  it('shows initial only when there are no record odometers', () => {
    const s = summarizeMileage({ initialOdometer: 12000 }, []);
    expect(s.drivingOdometer).toBe(12000);
    expect(s.trackedMileage).toBe(0);
    expect(formatMileagePair(s)).toBe('0/12000');
  });
});

describe('costPerKm', () => {
  it('divides total spend by tracked mileage', () => {
    expect(costPerKm(3771.57, 1000)).toBeCloseTo(3.77157, 5);
  });

  it('returns null when tracked mileage is zero or missing', () => {
    expect(costPerKm(100, 0)).toBeNull();
    expect(costPerKm(100, null)).toBeNull();
  });
});

describe('totals', () => {
  it('sums fuel liters and charge kWh', () => {
    const records: CareRecord[] = [
      {
        ...base,
        id: 'f',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-01T10:00:00.000Z',
        odometer: 1,
        liters: 40.5,
        fuelGrade: '95#',
        filledUp: true,
      },
      {
        ...base,
        id: 'c',
        vehicleId: 'v',
        type: 'charge',
        date: '2026-01-02T10:00:00.000Z',
        odometer: 2,
        kWh: 12.25,
        stationName: 'h',
        stationKind: 'home',
      },
      {
        ...base,
        id: 'f2',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-03T10:00:00.000Z',
        odometer: 3,
        liters: 10,
        fuelGrade: '95#',
        filledUp: true,
      },
    ];
    expect(totalFuelLiters(records)).toBeCloseTo(50.5, 5);
    expect(totalChargeKWh(records)).toBeCloseTo(12.25, 5);
  });
});
