import { describe, expect, it } from 'vitest';
import {
  chargeSpendAfterBaseline,
  costPerKm,
  formatMileagePair,
  fuelSpendAfterBaseline,
  heroEnergyCosts,
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

describe('fuelSpendAfterBaseline', () => {
  it('sums only fuel amountPaid with odometer strictly after baseline', () => {
    const records: CareRecord[] = [
      {
        ...base,
        id: 'before',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-01T10:00:00.000Z',
        odometer: 100,
        liters: 40,
        fuelGrade: '92#',
        filledUp: true,
        amountPaid: 300,
      },
      {
        ...base,
        id: 'at',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-02T10:00:00.000Z',
        odometer: 34448,
        liters: 40,
        fuelGrade: '92#',
        filledUp: true,
        amountPaid: 350,
      },
      {
        ...base,
        id: 'after1',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-02-01T10:00:00.000Z',
        odometer: 35000,
        liters: 38,
        fuelGrade: '92#',
        filledUp: true,
        amountPaid: 280,
      },
      {
        ...base,
        id: 'maint',
        vehicleId: 'v',
        type: 'maintenance',
        date: '2026-02-05T10:00:00.000Z',
        odometer: 35100,
        category: 'service',
        title: '保养',
        amountPaid: 2000,
      },
      {
        ...base,
        id: 'after2',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-03-01T10:00:00.000Z',
        odometer: 36000,
        liters: 40,
        fuelGrade: '92#',
        filledUp: true,
        amountPaid: 320,
      },
    ];
    expect(fuelSpendAfterBaseline(records, 34448)).toBeCloseTo(280 + 320, 5);
  });

  it('ICE hero 每公里成本 = fuel spend / tracked mileage', () => {
    const records: CareRecord[] = [
      {
        ...base,
        id: 'f1',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-01T10:00:00.000Z',
        odometer: 100,
        liters: 40,
        fuelGrade: '92#',
        filledUp: true,
        amountPaid: 999,
      },
      {
        ...base,
        id: 'f2',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-02-01T10:00:00.000Z',
        odometer: 1100,
        liters: 40,
        fuelGrade: '92#',
        filledUp: true,
        amountPaid: 400,
      },
      {
        ...base,
        id: 'ins',
        vehicleId: 'v',
        type: 'insurance',
        date: '2026-02-02T10:00:00.000Z',
        insurer: '人保',
        amountPaid: 5000,
      },
    ];
    const mileage = summarizeMileage({ initialOdometer: 100 }, records);
    expect(mileage.trackedMileage).toBe(1000);
    const fuelSpend = fuelSpendAfterBaseline(records, mileage.baselineOdometer);
    expect(fuelSpend).toBe(400); // excludes fill at baseline 100 and insurance
    expect(costPerKm(fuelSpend, mileage.trackedMileage)).toBeCloseTo(0.4, 5);
  });

  it('includes all fuel when baseline is null', () => {
    const records: CareRecord[] = [
      {
        ...base,
        id: 'f1',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-01T10:00:00.000Z',
        odometer: 100,
        liters: 10,
        fuelGrade: '92#',
        filledUp: true,
        amountPaid: 80,
      },
    ];
    expect(fuelSpendAfterBaseline(records, null)).toBe(80);
  });
});


describe('chargeSpendAfterBaseline', () => {
  it('sums only charge amountPaid with odometer strictly after baseline', () => {
    const records: CareRecord[] = [
      {
        ...base,
        id: 'at',
        vehicleId: 'v',
        type: 'charge',
        date: '2026-01-01T10:00:00.000Z',
        odometer: 5000,
        kWh: 40,
        stationName: 'h',
        stationKind: 'home',
        amountPaid: 0,
      },
      {
        ...base,
        id: 'after',
        vehicleId: 'v',
        type: 'charge',
        date: '2026-01-10T10:00:00.000Z',
        odometer: 5300,
        kWh: 30,
        stationName: 'p',
        stationKind: 'public',
        amountPaid: 45,
      },
      {
        ...base,
        id: 'fuel',
        vehicleId: 'v',
        type: 'fuel',
        date: '2026-01-11T10:00:00.000Z',
        odometer: 5400,
        liters: 10,
        fuelGrade: '95#',
        filledUp: true,
        amountPaid: 80,
      },
    ];
    expect(chargeSpendAfterBaseline(records, 5000)).toBe(45);
  });
});

describe('heroEnergyCosts by energy type', () => {
  const records: CareRecord[] = [
    {
      ...base,
      id: 'f0',
      vehicleId: 'v',
      type: 'fuel',
      date: '2026-01-01T10:00:00.000Z',
      odometer: 100,
      liters: 40,
      fuelGrade: '92#',
      filledUp: true,
      amountPaid: 300,
    },
    {
      ...base,
      id: 'f1',
      vehicleId: 'v',
      type: 'fuel',
      date: '2026-02-01T10:00:00.000Z',
      odometer: 1100,
      liters: 40,
      fuelGrade: '92#',
      filledUp: true,
      amountPaid: 400,
    },
    {
      ...base,
      id: 'c1',
      vehicleId: 'v',
      type: 'charge',
      date: '2026-02-05T10:00:00.000Z',
      odometer: 1200,
      kWh: 20,
      stationName: 'h',
      stationKind: 'home',
      amountPaid: 12,
    },
  ];

  it('EV shows charge only; ¥/km = charge / tracked', () => {
    const h = heroEnergyCosts('EV', records, 100);
    expect(h.showFuelSpend).toBe(false);
    expect(h.showChargeSpend).toBe(true);
    expect(h.chargeSpend).toBe(12);
    expect(h.costPerKmNumerator).toBe(12);
    expect(h.costPerKmHint).toContain('充电');
  });

  it('ICE shows fuel only; ¥/km = fuel / tracked', () => {
    const h = heroEnergyCosts('ICE', records, 100);
    expect(h.showFuelSpend).toBe(true);
    expect(h.showChargeSpend).toBe(false);
    expect(h.fuelSpend).toBe(400); // excludes baseline fill at 100
    expect(h.costPerKmNumerator).toBe(400);
    expect(h.costPerKmHint).toContain('加油');
  });

  it('PHEV shows oil + electric; ¥/km uses combined numerator', () => {
    const h = heroEnergyCosts('PHEV', records, 100);
    expect(h.showFuelSpend).toBe(true);
    expect(h.showChargeSpend).toBe(true);
    expect(h.fuelSpend).toBe(400);
    expect(h.chargeSpend).toBe(12);
    expect(h.costPerKmNumerator).toBe(412);
    expect(h.costPerKmHint).toContain('加油+充电');
  });

  it('HEV with hevAllowCharge uses combined numerator', () => {
    const h = heroEnergyCosts('HEV', records, 100, true);
    expect(h.showFuelSpend).toBe(true);
    expect(h.showChargeSpend).toBe(true);
    expect(h.costPerKmNumerator).toBe(412);
  });
});
