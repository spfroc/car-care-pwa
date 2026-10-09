import { describe, expect, it } from 'vitest';
import { filterByRange, summarizeSpend } from './spend';
import type { CareRecord } from '../types';

const base = {
  vehicleId: 'v1',
  date: '2026-01-15T10:00:00.000Z',
  amountPaid: 100,
  mediaIds: [] as string[],
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
};

function rec(partial: Partial<CareRecord> & { id: string; type: CareRecord['type'] }): CareRecord {
  return { ...base, ...partial } as CareRecord;
}

describe('summarizeSpend', () => {
  it('sums all expense types including parking and toll', () => {
    const records: CareRecord[] = [
      rec({ id: '1', type: 'fuel', fuelGrade: '95#', liters: 40, filledUp: true, odometer: 1000, amountPaid: 300 }),
      rec({ id: '2', type: 'charge', stationName: 'home', stationKind: 'home', kWh: 20, odometer: 1100, amountPaid: 40 }),
      rec({ id: '3', type: 'maintenance', category: 'service', title: 'oil', amountPaid: 500 }),
      rec({ id: '4', type: 'modification', area: 'exterior', title: 'cam', amountPaid: 200 }),
      rec({ id: '5', type: 'wash', washKind: 'basic', amountPaid: 30 }),
      rec({ id: '6', type: 'goods', name: 'wiper', category: 'other', amountPaid: 50 }),
      rec({ id: '7', type: 'ticket', paid: true, amountPaid: 200 }),
      rec({ id: '8', type: 'parking', parkingKind: 'fixed', place: '小区', amountPaid: 400 }),
      rec({ id: '9', type: 'parking', parkingKind: 'temporary', place: '商场', amountPaid: 15 }),
      rec({ id: '10', type: 'toll', route: '沪杭高速', amountPaid: 80 }),
      // other vehicle ignored
      rec({ id: '11', type: 'toll', vehicleId: 'v2', amountPaid: 999 }),
    ];
    const s = summarizeSpend('v1', records);
    expect(s.fuelCost).toBe(300);
    expect(s.chargeCost).toBe(40);
    expect(s.maintenanceCost).toBe(500);
    expect(s.modificationCost).toBe(200);
    expect(s.washCost).toBe(30);
    expect(s.goodsCost).toBe(50);
    expect(s.ticketCost).toBe(200);
    expect(s.parkingCost).toBe(415);
    expect(s.tollCost).toBe(80);
    expect(s.total).toBe(300 + 40 + 500 + 200 + 30 + 50 + 200 + 415 + 80);
  });

  it('treats missing amountPaid as 0', () => {
    const records: CareRecord[] = [
      rec({ id: '1', type: 'parking', parkingKind: 'temporary', amountPaid: undefined as unknown as number }),
    ];
    const s = summarizeSpend('v1', records);
    expect(s.parkingCost).toBe(0);
    expect(s.total).toBe(0);
  });
});

describe('filterByRange', () => {
  it('filters by inclusive date range', () => {
    const records: CareRecord[] = [
      rec({ id: 'a', type: 'toll', date: '2026-01-01T00:00:00.000Z', amountPaid: 1 }),
      rec({ id: 'b', type: 'toll', date: '2026-02-01T00:00:00.000Z', amountPaid: 2 }),
      rec({ id: 'c', type: 'toll', date: '2026-03-01T00:00:00.000Z', amountPaid: 3 }),
    ];
    const mid = filterByRange(records, new Date('2026-01-15T00:00:00.000Z'), new Date('2026-02-15T00:00:00.000Z'));
    expect(mid.map((r) => r.id)).toEqual(['b']);
  });
});
