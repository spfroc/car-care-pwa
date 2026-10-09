import type { CareRecord, RecordType, VehicleSpendSummary } from '../types';
import { RECORD_TYPE_ORDER } from './constants';

export function summarizeSpend(vehicleId: string, records: CareRecord[]): VehicleSpendSummary {
  const s: VehicleSpendSummary = {
    vehicleId,
    fuelCost: 0,
    chargeCost: 0,
    maintenanceCost: 0,
    modificationCost: 0,
    washCost: 0,
    goodsCost: 0,
    ticketCost: 0,
    parkingCost: 0,
    tollCost: 0,
    insuranceCost: 0,
    total: 0,
  };
  for (const r of records) {
    if (r.vehicleId !== vehicleId) continue;
    const p = r.amountPaid || 0;
    switch (r.type) {
      case 'fuel': s.fuelCost += p; break;
      case 'charge': s.chargeCost += p; break;
      case 'maintenance': s.maintenanceCost += p; break;
      case 'modification': s.modificationCost += p; break;
      case 'wash': s.washCost += p; break;
      case 'goods': s.goodsCost += p; break;
      case 'ticket': s.ticketCost += p; break;
      case 'parking': s.parkingCost += p; break;
      case 'toll': s.tollCost += p; break;
      case 'insurance': s.insuranceCost += p; break;
    }
  }
  s.total =
    s.fuelCost + s.chargeCost + s.maintenanceCost + s.modificationCost +
    s.washCost + s.goodsCost + s.ticketCost + s.parkingCost + s.tollCost + s.insuranceCost;
  return s;
}

export function filterByRange(records: CareRecord[], from?: Date, to?: Date): CareRecord[] {
  return records.filter((r) => {
    const t = new Date(r.date).getTime();
    if (from && t < from.getTime()) return false;
    if (to && t > to.getTime()) return false;
    return true;
  });
}

export type MonthlySpendSegment = { type: RecordType; amount: number };

export type MonthlySpendRow = {
  /** Local calendar month key `YYYY-MM`. */
  key: string;
  total: number;
  /** Non-zero segments in stable RECORD_TYPE_ORDER. */
  segments: MonthlySpendSegment[];
};

/** Aggregate filtered records into the last `limit` calendar months, stacked by type. */
export function monthlySpendByType(records: CareRecord[], limit = 6): MonthlySpendRow[] {
  const map = new Map<string, Map<RecordType, number>>();
  for (const r of records) {
    const d = new Date(r.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const amount = r.amountPaid || 0;
    if (!amount) continue;
    let byType = map.get(key);
    if (!byType) {
      byType = new Map();
      map.set(key, byType);
    }
    byType.set(r.type, (byType.get(r.type) ?? 0) + amount);
  }

  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([key, byType]) => {
      const segments: MonthlySpendSegment[] = [];
      let total = 0;
      for (const type of RECORD_TYPE_ORDER) {
        const amount = byType.get(type) ?? 0;
        if (amount > 0) {
          segments.push({ type, amount });
          total += amount;
        }
      }
      return { key, total, segments };
    });
}
