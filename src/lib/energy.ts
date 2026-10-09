import type { EnergyType } from '../types';

/** Whether fuel records are allowed for this energy type. */
export function allowsFuel(energy: EnergyType): boolean {
  return energy === 'ICE' || energy === 'HEV' || energy === 'PHEV' || energy === 'REEV' || energy === 'OTHER' || energy === 'FCEV';
}

/** Whether charge records are allowed. HEV gated by hevAllowCharge setting. */
export function allowsCharge(energy: EnergyType, hevAllowCharge = false): boolean {
  if (energy === 'EV' || energy === 'PHEV' || energy === 'REEV' || energy === 'OTHER') return true;
  if (energy === 'HEV') return hevAllowCharge;
  return false;
}

export function homeCardFlags(energy: EnergyType, hevAllowCharge = false) {
  return {
    showFuelCost: energy !== 'EV',
    showChargeCost: allowsCharge(energy, hevAllowCharge) && energy !== 'ICE',
    showFuelEconomy: energy === 'ICE' || energy === 'HEV' || energy === 'PHEV' || energy === 'REEV',
    showElectricEconomy:
      energy === 'EV' || energy === 'PHEV' || energy === 'REEV' || (energy === 'HEV' && hevAllowCharge),
  };
}

/**
 * Parse optional SOC % from charge form input.
 * Empty → undefined; otherwise must be 0–100.
 */
export function parseSocPercent(raw: string, label: string): number | undefined {
  if (raw === '') return undefined;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0 || n > 100) {
    throw new Error(`${label}须为 0–100 的电量百分比`);
  }
  return n;
}

/** Charge form: after must not be below before when both set. */
export function assertSocOrder(before?: number, after?: number): void {
  if (before != null && after != null && after < before) {
    throw new Error('充电后电量不能低于充电前电量');
  }
}
