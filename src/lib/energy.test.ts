import { describe, expect, it } from 'vitest';
import {
  allowsCharge,
  allowsFuel,
  assertSocOrder,
  homeCardFlags,
  parseSocPercent,
} from './energy';

describe('allowsFuel / allowsCharge', () => {
  it('ICE: fuel yes, charge no', () => {
    expect(allowsFuel('ICE')).toBe(true);
    expect(allowsCharge('ICE')).toBe(false);
  });

  it('EV: fuel no, charge yes', () => {
    expect(allowsFuel('EV')).toBe(false);
    expect(allowsCharge('EV')).toBe(true);
  });

  it('PHEV / REEV: both fuel and charge', () => {
    for (const e of ['PHEV', 'REEV'] as const) {
      expect(allowsFuel(e)).toBe(true);
      expect(allowsCharge(e)).toBe(true);
    }
  });

  it('HEV: fuel yes; charge only when hevAllowCharge', () => {
    expect(allowsFuel('HEV')).toBe(true);
    expect(allowsCharge('HEV')).toBe(false);
    expect(allowsCharge('HEV', false)).toBe(false);
    expect(allowsCharge('HEV', true)).toBe(true);
  });
});

describe('homeCardFlags', () => {
  it('EV shows electric economy and charge cost only', () => {
    const f = homeCardFlags('EV');
    expect(f.showFuelCost).toBe(false);
    expect(f.showChargeCost).toBe(true);
    expect(f.showFuelEconomy).toBe(false);
    expect(f.showElectricEconomy).toBe(true);
  });

  it('HEV default: fuel economy, no electric until toggle', () => {
    const off = homeCardFlags('HEV', false);
    expect(off.showFuelEconomy).toBe(true);
    expect(off.showElectricEconomy).toBe(false);
    expect(off.showChargeCost).toBe(false);
    const on = homeCardFlags('HEV', true);
    expect(on.showElectricEconomy).toBe(true);
    expect(on.showChargeCost).toBe(true);
  });

  it('PHEV shows both economies', () => {
    const f = homeCardFlags('PHEV');
    expect(f.showFuelEconomy).toBe(true);
    expect(f.showElectricEconomy).toBe(true);
    expect(f.showFuelCost).toBe(true);
    expect(f.showChargeCost).toBe(true);
  });
});

describe('charge form SOC helpers', () => {
  it('parseSocPercent accepts empty and 0–100', () => {
    expect(parseSocPercent('', '充电前电量')).toBeUndefined();
    expect(parseSocPercent('0', '充电前电量')).toBe(0);
    expect(parseSocPercent('100', '充电后电量')).toBe(100);
    expect(parseSocPercent('42.5', '充电前电量')).toBe(42.5);
  });

  it('parseSocPercent rejects out of range', () => {
    expect(() => parseSocPercent('-1', '充电前电量')).toThrow(/0–100/);
    expect(() => parseSocPercent('101', '充电后电量')).toThrow(/0–100/);
    expect(() => parseSocPercent('abc', '充电前电量')).toThrow(/0–100/);
  });

  it('assertSocOrder rejects after < before', () => {
    expect(() => assertSocOrder(80, 20)).toThrow(/不能低于/);
    expect(() => assertSocOrder(20, 80)).not.toThrow();
    expect(() => assertSocOrder(undefined, 80)).not.toThrow();
  });
});
