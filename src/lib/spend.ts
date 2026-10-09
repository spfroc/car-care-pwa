import type { CareRecord, VehicleSpendSummary } from '../types';

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
    }
  }
  s.total =
    s.fuelCost + s.chargeCost + s.maintenanceCost + s.modificationCost +
    s.washCost + s.goodsCost + s.ticketCost + s.parkingCost + s.tollCost;
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
