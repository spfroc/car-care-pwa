import { describe, expect, it } from 'vitest';
import {
  averageFuelEconomy,
  combinedEconomy,
  confidentElectricEconomy,
  confidentFuelEconomy,
  convertEconomy,
  electricEconomySummary,
  electricIntervals,
  formatEconomy,
  fuelEconomyDiagnostics,
  fuelEconomySummary,
  fuelIntervals,
  latestFuelEconomy,
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
    expect(ivs[0].open).toBe(true);
    // Open tail is an estimate: not the confirmed average.
    expect(averageFuelEconomy(records)).toBeNull();
    expect(fuelEconomySummary(records).value).toBeNull();
  });

  it('ignores odometer≤0 history补录 so they cannot invent a 0→firstFill mega-interval', () => {
    // Repro: X-RV screenshot showed 1.27 L/100km because odo=0 rows + first real fill
    // created (25.85L / 34448km)*100 ≈ 0.08 dominating the weighted average.
    const records: CareRecord[] = [
      {
        ...base,
        id: 'hist',
        vehicleId: 'v',
        type: 'fuel',
        date: '2021-08-15T04:00:00.000Z',
        odometer: 0,
        liters: 0,
        fuelGrade: '92#',
        filledUp: false,
        amountPaid: 200,
        flags: { lowConfidenceEconomy: true },
      },
      {
        ...base,
        id: 'hist2',
        vehicleId: 'v',
        type: 'fuel',
        date: '2022-06-01T04:00:00.000Z',
        odometer: 0,
        liters: 36.86,
        fuelGrade: '92#',
        filledUp: false,
        amountPaid: 282,
        flags: { lowConfidenceEconomy: true },
      },
      {
        ...base,
        id: 'a',
        vehicleId: 'v',
        type: 'fuel',
        date: '2025-12-20T04:00:00.000Z',
        odometer: 34448,
        liters: 25.85,
        fuelGrade: '92#',
        filledUp: true,
        amountPaid: 152.77,
      },
      {
        ...base,
        id: 'b',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-01T04:00:00.000Z',
        odometer: 35072,
        liters: 34.6,
        fuelGrade: '92#',
        filledUp: false,
        amountPaid: 200,
      },
      {
        ...base,
        id: 'c',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-25T04:00:00.000Z',
        odometer: 35488,
        liters: 41.37,
        fuelGrade: '92#',
        filledUp: true,
        amountPaid: 241.6,
      },
      {
        ...base,
        id: 'd',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-10-06T04:00:00.000Z',
        odometer: 41864,
        liters: 39.75,
        fuelGrade: '92#',
        filledUp: true,
        amountPaid: 296.96,
      },
    ];
    const ivs = fuelIntervals(records);
    expect(ivs.some((iv) => iv.fromOdometer === 0)).toBe(false);
    // Partial b (35072, not full) merges into the next full at c (35488).
    expect(ivs).toHaveLength(2);
    expect(ivs[0].fromOdometer).toBe(34448);
    expect(ivs[0].toOdometer).toBe(35488);
    expect(ivs[0].endRecordId).toBe('c');
    expect(ivs[0].amount).toBeCloseTo(34.6 + 41.37, 5);
    expect(ivs[0].lowConfidence).toBe(false);
    expect(ivs[0].open).toBe(false);
    expect(ivs[1].fromOdometer).toBe(35488);
    expect(ivs[1].toOdometer).toBe(41864);
    const avg = averageFuelEconomy(records)!;
    // Closed chain: (all liters − first fill) / (last − first) × 100. Not crushed by odo=0.
    const spanKm = 41864 - 34448;
    const spanLiters = 34.6 + 41.37 + 39.75;
    expect(avg).toBeCloseTo((spanLiters / spanKm) * 100, 5);
    expect(avg).toBeGreaterThan(1.27);
    expect(fuelEconomySummary(records).lowConfidence).toBe(false);
  });

  it('marks flags.lowConfidenceEconomy as 参考 but keeps the fill in the chain', () => {
    const records: CareRecord[] = [
      { ...base, id: 'a', vehicleId: 'v', type: 'fuel', date: '2026-01-01T10:00:00.000Z', odometer: 1000, liters: 40, fuelGrade: '95#', filledUp: true },
      {
        ...base,
        id: 'mid',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-05T10:00:00.000Z',
        odometer: 1300,
        liters: 20,
        fuelGrade: '95#',
        filledUp: true,
        flags: { lowConfidenceEconomy: true },
      },
      { ...base, id: 'c', vehicleId: 'v', type: 'fuel', date: '2026-01-10T10:00:00.000Z', odometer: 1600, liters: 40, fuelGrade: '95#', filledUp: true },
    ];
    const ivs = fuelIntervals(records);
    expect(ivs).toHaveLength(2);
    expect(ivs[0].lowConfidence).toBe(true); // flagged end
    expect(ivs[1].lowConfidence).toBe(false);
    expect(averageFuelEconomy(records)).toBeCloseTo((20 + 40) / (300 + 300) * 100, 5);
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

describe('multi-vehicle: never cross-stitch intervals', () => {
  it('fuelIntervals groups by vehicleId (Stats 全部车辆)', () => {
    // Two ICE cars with overlapping-looking odometers — stitching across cars
    // would invent a fake 1500→2000 interval (40L / 500km).
    const records: CareRecord[] = [
      { ...base, id: 'a1', vehicleId: 'car-a', type: 'fuel', date: '2026-01-01T10:00:00.000Z', odometer: 1000, liters: 40, fuelGrade: '95#', filledUp: true },
      { ...base, id: 'a2', vehicleId: 'car-a', type: 'fuel', date: '2026-01-10T10:00:00.000Z', odometer: 1500, liters: 40, fuelGrade: '95#', filledUp: true },
      { ...base, id: 'b1', vehicleId: 'car-b', type: 'fuel', date: '2026-01-02T10:00:00.000Z', odometer: 2000, liters: 35, fuelGrade: '92#', filledUp: true },
      { ...base, id: 'b2', vehicleId: 'car-b', type: 'fuel', date: '2026-01-20T10:00:00.000Z', odometer: 2500, liters: 35, fuelGrade: '92#', filledUp: true },
    ];
    const ivs = fuelIntervals(records);
    expect(ivs).toHaveLength(2);
    expect(ivs.map((iv) => iv.endRecordId).sort()).toEqual(['a2', 'b2']);
    // No cross-vehicle 1500→2000
    expect(ivs.some((iv) => iv.fromOdometer === 1500 && iv.toOdometer === 2000)).toBe(false);
    expect(ivs.find((iv) => iv.endRecordId === 'a2')!.economyPer100).toBeCloseTo(8, 5);
    expect(ivs.find((iv) => iv.endRecordId === 'b2')!.economyPer100).toBeCloseTo(7, 5);
    // Average = distance-weighted merge of per-vehicle intervals only
    expect(averageFuelEconomy(records)).toBeCloseTo(weightedAverage(ivs)!, 10);
    expect(averageFuelEconomy(records)).toBeCloseTo((40 + 35) / (500 + 500) * 100, 5);
  });

  it('electricIntervals groups by vehicleId', () => {
    const records: CareRecord[] = [
      { ...base, id: 'e1', vehicleId: 'ev-a', type: 'charge', date: '2026-01-01T10:00:00.000Z', odometer: 1000, kWh: 40, stationName: 'h', stationKind: 'home' },
      { ...base, id: 'e2', vehicleId: 'ev-a', type: 'charge', date: '2026-01-05T10:00:00.000Z', odometer: 1200, kWh: 30, stationName: 'h', stationKind: 'home' },
      { ...base, id: 'f1', vehicleId: 'ev-b', type: 'charge', date: '2026-01-02T10:00:00.000Z', odometer: 5000, kWh: 50, stationName: 'p', stationKind: 'public' },
      { ...base, id: 'f2', vehicleId: 'ev-b', type: 'charge', date: '2026-01-12T10:00:00.000Z', odometer: 5300, kWh: 45, stationName: 'p', stationKind: 'public' },
    ];
    const ivs = electricIntervals(records);
    expect(ivs).toHaveLength(2);
    expect(ivs.some((iv) => iv.fromOdometer === 1200 && iv.toOdometer === 5000)).toBe(false);
    expect(ivs.find((iv) => iv.endRecordId === 'e2')!.economyPer100).toBeCloseTo(15, 5);
    expect(ivs.find((iv) => iv.endRecordId === 'f2')!.economyPer100).toBeCloseTo(15, 5);
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

describe('multi-energy economy scenarios', () => {
  it('EV charge intervals produce non-blank kWh/100km (seed-like)', () => {
    const records: CareRecord[] = [
      { ...base, id: 'e1', vehicleId: 'ev', type: 'charge', date: '2026-01-01T10:00:00.000Z', odometer: 5000, kWh: 45, stationName: '家充', stationKind: 'home', socBefore: 15, socAfter: 95 },
      { ...base, id: 'e2', vehicleId: 'ev', type: 'charge', date: '2026-01-10T10:00:00.000Z', odometer: 5200, kWh: 30, stationName: '公桩', stationKind: 'public', socBefore: 20, socAfter: 80 },
      { ...base, id: 'e3', vehicleId: 'ev', type: 'charge', date: '2026-01-20T10:00:00.000Z', odometer: 5400, kWh: 28, stationName: '公桩', stationKind: 'public', socBefore: 25, socAfter: 78 },
    ];
    const ivs = electricIntervals(records);
    expect(ivs.length).toBeGreaterThanOrEqual(2);
    expect(ivs[0].economyPer100).toBeCloseTo(15, 5); // 30/200*100
    expect(weightedAverage(ivs)).not.toBeNull();
  });

  it('HEV fuel-only intervals (no plug) yield L/100km', () => {
    const records: CareRecord[] = [
      { ...base, id: 'h1', vehicleId: 'hev', type: 'fuel', date: '2026-01-01T10:00:00.000Z', odometer: 15000, liters: 30, fuelGrade: '95#', filledUp: true },
      { ...base, id: 'h2', vehicleId: 'hev', type: 'fuel', date: '2026-01-15T10:00:00.000Z', odometer: 15550, liters: 30, fuelGrade: '95#', filledUp: true },
      { ...base, id: 'h3', vehicleId: 'hev', type: 'fuel', date: '2026-02-01T10:00:00.000Z', odometer: 16100, liters: 28, fuelGrade: '95#', filledUp: true },
    ];
    const ivs = fuelIntervals(records);
    expect(ivs).toHaveLength(2);
    expect(ivs[0].economyPer100).toBeCloseTo(30 / 550 * 100, 5);
    expect(electricIntervals(records)).toHaveLength(0);
  });

  it('PHEV fuel + charge support both interval kinds and combined', () => {
    const records: CareRecord[] = [
      { ...base, id: 'pf1', vehicleId: 'phev', type: 'fuel', date: '2026-01-01T10:00:00.000Z', odometer: 8000, liters: 35, fuelGrade: '95#', filledUp: true, amountPaid: 1 },
      { ...base, id: 'pc1', vehicleId: 'phev', type: 'charge', date: '2026-01-05T10:00:00.000Z', odometer: 8100, kWh: 18, stationName: '家充', stationKind: 'home', amountPaid: 0, socBefore: 20, socAfter: 95 },
      { ...base, id: 'pf2', vehicleId: 'phev', type: 'fuel', date: '2026-01-20T10:00:00.000Z', odometer: 8500, liters: 20, fuelGrade: '95#', filledUp: true, amountPaid: 1 },
      { ...base, id: 'pc2', vehicleId: 'phev', type: 'charge', date: '2026-01-25T10:00:00.000Z', odometer: 8700, kWh: 20, stationName: '公桩', stationKind: 'public', amountPaid: 0, socBefore: 15, socAfter: 90 },
    ];
    expect(fuelIntervals(records).length).toBeGreaterThanOrEqual(1);
    expect(electricIntervals(records).length).toBeGreaterThanOrEqual(1);
    const c = combinedEconomy(records, 0.112);
    expect(c).not.toBeNull();
    expect(c!.deltaKm).toBe(700);
    expect(c!.economyPer100).toBeGreaterThan(0);
  });
});

describe('averageFuelEconomy / formatEconomy', () => {
  it('matches weightedAverage of fuel intervals (home = detail hero)', () => {
    const records: CareRecord[] = [
      { ...base, id: 'a', vehicleId: 'v', type: 'fuel', date: '2026-01-01T10:00:00.000Z', odometer: 1000, liters: 40, fuelGrade: '92#', filledUp: true },
      { ...base, id: 'b', vehicleId: 'v', type: 'fuel', date: '2026-01-10T10:00:00.000Z', odometer: 1600, liters: 36, fuelGrade: '92#', filledUp: true },
      { ...base, id: 'c', vehicleId: 'v', type: 'fuel', date: '2026-01-20T10:00:00.000Z', odometer: 2100, liters: 40, fuelGrade: '92#', filledUp: true },
    ];
    const avg = averageFuelEconomy(records);
    expect(avg).toBeCloseTo(weightedAverage(fuelIntervals(records))!, 10);
    // (36+40)/(600+500)*100 = 76/1100*100 ≈ 6.90909
    expect(avg).toBeCloseTo((76 / 1100) * 100, 5);
    expect(formatEconomy(avg!)).toBe('6.91');
    // latest interval only differs from average
    expect(latestFuelEconomy(records)).toBeCloseTo((40 / 500) * 100, 5);
    expect(formatEconomy(latestFuelEconomy(records)!)).toBe('8.00');
  });

  it('formatEconomy always uses 2 decimal places', () => {
    expect(formatEconomy(6.1)).toBe('6.10');
    expect(formatEconomy(6.09)).toBe('6.09');
    expect(formatEconomy(6)).toBe('6.00');
  });
});

describe('convertEconomy / formatEconomy unit conversion', () => {
  it('leaves L/100km and kWh/100km unchanged', () => {
    expect(convertEconomy(8, 'L/100km')).toBe(8);
    expect(convertEconomy(15, 'kWh/100km')).toBe(15);
    expect(formatEconomy(8, 'L/100km')).toBe('8.00');
    expect(formatEconomy(15.5, 'kWh/100km')).toBe('15.50');
  });

  it('converts L/100km → km/L as 100 / value', () => {
    // 8 L/100km → 12.5 km/L
    expect(convertEconomy(8, 'km/L')).toBeCloseTo(12.5, 10);
    expect(formatEconomy(8, 'km/L')).toBe('12.50');
    // 6.90909… → ~14.47 km/L
    expect(formatEconomy((76 / 1100) * 100, 'km/L')).toBe('14.47');
  });

  it('converts kWh/100km → km/kWh as 100 / value', () => {
    // 15 kWh/100km → 6.666… km/kWh
    expect(convertEconomy(15, 'km/kWh')).toBeCloseTo(100 / 15, 10);
    expect(formatEconomy(15, 'km/kWh')).toBe('6.67');
  });

  it('defaults to raw per-100 when unit omitted (backward compatible)', () => {
    expect(formatEconomy(6.1)).toBe('6.10');
    expect(convertEconomy(6.1)).toBe(6.1);
  });
});

describe('full-to-full merge', () => {
  function fuel(p: {
    id: string;
    odometer: number;
    liters: number;
    filledUp: boolean;
    date: string;
    vehicleId?: string;
    flags?: { lowConfidenceEconomy?: boolean };
  }): CareRecord {
    return {
      ...base,
      id: p.id,
      vehicleId: p.vehicleId ?? 'v',
      type: 'fuel',
      date: p.date,
      odometer: p.odometer,
      liters: p.liters,
      fuelGrade: '95#',
      filledUp: p.filledUp,
      flags: p.flags,
    };
  }

  it('merges a mid-tank fill into the surrounding full-to-full interval', () => {
    // A 1000/4 full, B 1100/2 not, C 1200/3 full → 200 km, 5 L → 2.50
    const records: CareRecord[] = [
      fuel({ id: 'a', odometer: 1000, liters: 4, filledUp: true, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'b', odometer: 1100, liters: 2, filledUp: false, date: '2026-01-02T00:00:00.000Z', flags: { lowConfidenceEconomy: true } }),
      fuel({ id: 'c', odometer: 1200, liters: 3, filledUp: true, date: '2026-01-03T00:00:00.000Z' }),
    ];
    const before = structuredClone(records);
    const ivs = fuelIntervals(records);
    expect(records).toEqual(before);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].fromOdometer).toBe(1000);
    expect(ivs[0].toOdometer).toBe(1200);
    expect(ivs[0].amount).toBeCloseTo(5, 5);
    expect(ivs[0].economyPer100).toBeCloseTo(2.5, 5);
    expect(ivs[0].lowConfidence).toBe(false);
    expect(ivs[0].open).toBe(false);
    expect(ivs[0].endRecordId).toBe('c');
    expect(averageFuelEconomy(records)).toBeCloseTo(2.5, 5);
    expect(confidentFuelEconomy(records)).toBeCloseTo(2.5, 5);
    const diag = fuelEconomyDiagnostics(records);
    expect(diag.some((d) => d.code === 'low-confidence-backfill' && d.recordIds.includes('b'))).toBe(true);
    expect(diag.some((d) => d.code === 'open-trailing-partial')).toBe(false);
  });

  it('weights complete intervals by distance, not by the mean of their economies', () => {
    const records: CareRecord[] = [
      fuel({ id: 'a', odometer: 1000, liters: 10, filledUp: true, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'b', odometer: 1100, liters: 10, filledUp: true, date: '2026-01-02T00:00:00.000Z' }),
      fuel({ id: 'c', odometer: 2100, liters: 10, filledUp: true, date: '2026-01-03T00:00:00.000Z' }),
    ];
    const avg = averageFuelEconomy(records)!;
    const arithmetic = (10 + 1) / 2;
    expect(avg).toBeCloseTo((20 / 1100) * 100, 5);
    expect(Math.abs(avg - arithmetic)).toBeGreaterThan(1);
  });

  it('excludes liters added before the first confirmed full', () => {
    const records: CareRecord[] = [
      fuel({ id: 'p', odometer: 500, liters: 9, filledUp: false, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'a', odometer: 1000, liters: 4, filledUp: true, date: '2026-01-02T00:00:00.000Z' }),
      fuel({ id: 'c', odometer: 1200, liters: 3, filledUp: true, date: '2026-01-03T00:00:00.000Z' }),
    ];
    const before = structuredClone(records);
    const ivs = fuelIntervals(records);
    expect(records).toEqual(before);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].fromOdometer).toBe(1000);
    expect(ivs[0].amount).toBeCloseTo(3, 5);
    expect(averageFuelEconomy(records)).toBeCloseTo((3 / 200) * 100, 5);
    expect(fuelEconomyDiagnostics(records).some((d) => d.code === 'first-fill-not-full' && d.recordIds.includes('p'))).toBe(true);
  });

  it('merges consecutive partials between two fulls', () => {
    const records: CareRecord[] = [
      fuel({ id: 'a', odometer: 1000, liters: 4, filledUp: true, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'b', odometer: 1100, liters: 2, filledUp: false, date: '2026-01-02T00:00:00.000Z' }),
      fuel({ id: 'c', odometer: 1150, liters: 1, filledUp: false, date: '2026-01-03T00:00:00.000Z' }),
      fuel({ id: 'd', odometer: 1200, liters: 3, filledUp: true, date: '2026-01-04T00:00:00.000Z' }),
    ];
    const ivs = fuelIntervals(records);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].amount).toBeCloseTo(6, 5);
    expect(ivs[0].economyPer100).toBeCloseTo((6 / 200) * 100, 5);
    const ids = fuelEconomyDiagnostics(records).find((d) => d.code === 'consecutive-partials')?.recordIds;
    expect(ids).toEqual(['b', 'c']);
  });

  it('sums same-odometer fills and does not invent a zero-km interval', () => {
    const records: CareRecord[] = [
      fuel({ id: 'a', odometer: 1000, liters: 4, filledUp: true, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'a2', odometer: 1000, liters: 1, filledUp: true, date: '2026-01-01T01:00:00.000Z' }),
      fuel({ id: 'b', odometer: 1200, liters: 2, filledUp: false, date: '2026-01-02T00:00:00.000Z' }),
      fuel({ id: 'b2', odometer: 1200, liters: 3, filledUp: true, date: '2026-01-02T01:00:00.000Z' }),
    ];
    const before = structuredClone(records);
    const ivs = fuelIntervals(records);
    expect(records).toEqual(before);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].fromOdometer).toBe(1000);
    expect(ivs[0].toOdometer).toBe(1200);
    expect(ivs[0].amount).toBeCloseTo(5, 5);
    expect(ivs[0].endRecordId).toBe('b2');
    expect(ivs.some((iv) => iv.toOdometer - iv.fromOdometer <= 0)).toBe(false);
    expect(fuelEconomyDiagnostics(records).some((d) => d.code === 'same-odo-multi-fill')).toBe(true);
  });

  it('leaves an odometer rollback out of distance and liters', () => {
    const records: CareRecord[] = [
      fuel({ id: 'a', odometer: 1000, liters: 4, filledUp: true, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'b', odometer: 900, liters: 2, filledUp: true, date: '2026-01-02T00:00:00.000Z' }),
      fuel({ id: 'c', odometer: 1200, liters: 3, filledUp: true, date: '2026-01-03T00:00:00.000Z' }),
    ];
    const before = structuredClone(records);
    const ivs = fuelIntervals(records);
    expect(records).toEqual(before);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].fromOdometer).toBe(1000);
    expect(ivs[0].toOdometer).toBe(1200);
    expect(ivs[0].amount).toBeCloseTo(3, 5);
    expect(fuelEconomyDiagnostics(records).find((d) => d.code === 'odo-rollback')?.recordIds).toEqual(['b']);
  });

  it('diagnoses illegal liters without rewriting the row or inventing a NaN economy', () => {
    const records: CareRecord[] = [
      fuel({ id: 'a', odometer: 1000, liters: 40, filledUp: true, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'bad', odometer: 1500, liters: Number.NaN, filledUp: true, date: '2026-01-02T00:00:00.000Z' }),
      fuel({ id: 'c', odometer: 2000, liters: 40, filledUp: true, date: '2026-01-03T00:00:00.000Z' }),
    ];
    const ivs = fuelIntervals(records);
    expect(Object.is(records[1] && (records[1] as { liters: number }).liters, Number.NaN)).toBe(true);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].amount).toBeCloseTo(40, 5);
    expect(Number.isFinite(ivs[0].economyPer100)).toBe(true);
    expect(ivs[0].lowConfidence).toBe(true);
    expect(fuelEconomyDiagnostics(records).find((d) => d.code === 'missing-or-illegal-liters')?.recordIds).toEqual(['bad']);
    expect(fuelEconomySummary(records).lowConfidence).toBe(true);
  });

  it('keeps a flagged confirmed full in the average and marks that segment 参考', () => {
    const records: CareRecord[] = [
      fuel({ id: 'a', odometer: 1000, liters: 40, filledUp: true, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'b', odometer: 1500, liters: 30, filledUp: true, date: '2026-01-02T00:00:00.000Z', flags: { lowConfidenceEconomy: true } }),
      fuel({ id: 'c', odometer: 2000, liters: 40, filledUp: true, date: '2026-01-03T00:00:00.000Z' }),
    ];
    const ivs = fuelIntervals(records);
    expect(ivs[0].lowConfidence).toBe(true);
    expect(ivs[0].amount).toBeCloseTo(30, 5);
    expect(ivs[1].lowConfidence).toBe(false);
    expect(averageFuelEconomy(records)).toBeCloseTo((70 / 1000) * 100, 5);
    expect(confidentFuelEconomy(records)).toBeCloseTo((40 / 500) * 100, 5);
  });

  it('does not stitch partials across vehicles', () => {
    const records: CareRecord[] = [
      fuel({ id: 'a1', vehicleId: 'car-a', odometer: 1000, liters: 4, filledUp: true, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'a2', vehicleId: 'car-a', odometer: 1100, liters: 2, filledUp: false, date: '2026-01-02T00:00:00.000Z' }),
      fuel({ id: 'a3', vehicleId: 'car-a', odometer: 1200, liters: 3, filledUp: true, date: '2026-01-03T00:00:00.000Z' }),
      fuel({ id: 'b1', vehicleId: 'car-b', odometer: 1100, liters: 10, filledUp: true, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'b2', vehicleId: 'car-b', odometer: 1200, liters: 10, filledUp: true, date: '2026-01-04T00:00:00.000Z' }),
    ];
    const ivs = fuelIntervals(records);
    expect(ivs).toHaveLength(2);
    expect(ivs.find((iv) => iv.endRecordId === 'a3')!.economyPer100).toBeCloseTo(2.5, 5);
    expect(ivs.find((iv) => iv.endRecordId === 'b2')!.economyPer100).toBeCloseTo(10, 5);
    expect(averageFuelEconomy(records)).toBeCloseTo((15 / 300) * 100, 5);
    expect(fuelEconomyDiagnostics(records).some((d) => d.code === 'mixed-vehicles' && d.recordIds.includes('car-a') && d.recordIds.includes('car-b'))).toBe(true);
  });

  it('recomputes after a partial or closing full is removed', () => {
    const full = [
      fuel({ id: 'a', odometer: 1000, liters: 4, filledUp: true, date: '2026-01-01T00:00:00.000Z' }),
      fuel({ id: 'b', odometer: 1100, liters: 2, filledUp: false, date: '2026-01-02T00:00:00.000Z' }),
      fuel({ id: 'c', odometer: 1200, liters: 3, filledUp: true, date: '2026-01-03T00:00:00.000Z' }),
    ];
    expect(fuelIntervals(full)[0].amount).toBeCloseTo(5, 5);
    const withoutPartial = full.filter((r) => r.id !== 'b');
    expect(fuelIntervals(withoutPartial)[0].amount).toBeCloseTo(3, 5);
    expect(fuelIntervals(withoutPartial)[0].fromOdometer).toBe(1000);
    const withoutClose = full.filter((r) => r.id !== 'c');
    const open = fuelIntervals(withoutClose);
    expect(open).toHaveLength(1);
    expect(open[0].open).toBe(true);
    expect(open[0].amount).toBeCloseTo(2, 5);
    expect(averageFuelEconomy(withoutClose)).toBeNull();
    expect(full.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('low-confidence summaries & partial charge', () => {
  it('keeps an open trailing partial out of the confirmed average', () => {
    const records: CareRecord[] = [
      { ...base, id: 'a', vehicleId: 'v', type: 'fuel', date: '2026-01-01T10:00:00.000Z', odometer: 1000, liters: 40, fuelGrade: '95#', filledUp: true },
      { ...base, id: 'b', vehicleId: 'v', type: 'fuel', date: '2026-01-10T10:00:00.000Z', odometer: 1500, liters: 40, fuelGrade: '95#', filledUp: true },
      { ...base, id: 'c', vehicleId: 'v', type: 'fuel', date: '2026-01-20T10:00:00.000Z', odometer: 1700, liters: 10, fuelGrade: '95#', filledUp: false },
    ];
    const ivs = fuelIntervals(records);
    expect(ivs).toHaveLength(2);
    expect(ivs[0].open).toBe(false);
    expect(ivs[0].economyPer100).toBeCloseTo(8, 5);
    expect(ivs[1].open).toBe(true);
    expect(ivs[1].lowConfidence).toBe(true);
    expect(ivs[1].amount).toBe(10);
    const s = fuelEconomySummary(records);
    expect(s.value).toBeCloseTo(8, 5);
    expect(s.lowConfidence).toBe(false);
    expect(s.lowConfidenceCount).toBe(1);
    expect(s.intervalCount).toBe(2);
    expect(confidentFuelEconomy(records)).toBeCloseTo(8, 5);
    expect(averageFuelEconomy(records)).toBeCloseTo(8, 5);
  });

  it('returns null averages when fewer than 2 fuel records (missing data)', () => {
    const records: CareRecord[] = [
      { ...base, id: 'a', vehicleId: 'v', type: 'fuel', date: '2026-01-01T10:00:00.000Z', odometer: 1000, liters: 40, fuelGrade: '95#', filledUp: true },
    ];
    expect(fuelEconomySummary(records).value).toBeNull();
    expect(fuelIntervals(records)).toHaveLength(0);
  });

  it('marks electric interval lowConfidence when socAfter < 95', () => {
    const records: CareRecord[] = [
      { ...base, id: 'a', vehicleId: 'v', type: 'charge', date: '2026-01-01T10:00:00.000Z', odometer: 1000, kWh: 40, stationName: 'x', stationKind: 'home', socAfter: 100 },
      { ...base, id: 'b', vehicleId: 'v', type: 'charge', date: '2026-01-05T10:00:00.000Z', odometer: 1200, kWh: 20, stationName: 'x', stationKind: 'public', socAfter: 60 },
    ];
    const ivs = electricIntervals(records);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].lowConfidence).toBe(true);
    expect(electricEconomySummary(records).lowConfidence).toBe(true);
    expect(confidentElectricEconomy(records)).toBeNull();
  });

  it('combinedEconomy returns null for multi-vehicle input (no cross-stitch)', () => {
    const records: CareRecord[] = [
      { ...base, id: 'f1', vehicleId: 'a', type: 'fuel', date: '2026-01-01T10:00:00.000Z', odometer: 1000, liters: 20, fuelGrade: '95#', filledUp: true, amountPaid: 1 },
      { ...base, id: 'c1', vehicleId: 'a', type: 'charge', date: '2026-01-02T10:00:00.000Z', odometer: 1100, kWh: 10, stationName: 'h', stationKind: 'home', amountPaid: 0 },
      { ...base, id: 'f2', vehicleId: 'b', type: 'fuel', date: '2026-01-10T10:00:00.000Z', odometer: 1500, liters: 15, fuelGrade: '95#', filledUp: true, amountPaid: 1 },
    ];
    expect(combinedEconomy(records, 0.112)).toBeNull();
  });
});
