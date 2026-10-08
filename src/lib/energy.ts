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
