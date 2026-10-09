import { getDB } from '../db';
import { OCR_DEFAULTS, nowISO } from '../lib/constants';
import type { SettingRow } from '../types';

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const row = await (await getDB()).get('settings', key);
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const row: SettingRow = { key, value, updatedAt: nowISO() };
  await (await getDB()).put('settings', row);
}

export async function getAllSettings(): Promise<SettingRow[]> {
  return (await getDB()).getAll('settings');
}

export async function resetOcrWhitelist(field: 'main' | 'date' | 'amountDue' | 'discount'): Promise<string> {
  const defaults = (await getSetting<Record<string, string>>('ocrWhitelistDefaults')) ?? OCR_DEFAULTS;
  const value = defaults[field] ?? OCR_DEFAULTS[field];
  await setSetting(`ocrWhitelist.${field}`, value);
  return value;
}

export type AppSettings = {
  language: string;
  dateFormat: string;
  timeFormat: string;
  currency: { code: string; symbol: string };
  volumeUnit: string;
  energyUnit: string;
  defaultFuelGrade: string;
  fuelGrades: string[];
  kwhToLiterFactor: number;
  hevAllowCharge: boolean;
  fuelEconomyUnit: string;
  electricEconomyUnit: string;
  ocrMain: string;
  ocrDate: string;
  ocrAmountDue: string;
  ocrDiscount: string;
};

export async function loadAppSettings(): Promise<AppSettings> {
  const g = async <T>(k: string, d: T): Promise<T> => (await getSetting<T>(k)) ?? d;
  return {
    language: await g('language', 'zh-CN'),
    dateFormat: await g('dateFormat', 'YYYY-MM-DD'),
    timeFormat: await g('timeFormat', '24h'),
    currency: await g('currency', { code: 'CNY', symbol: '¥' }),
    volumeUnit: await g('volumeUnit', 'L'),
    energyUnit: await g('energyUnit', 'kWh'),
    defaultFuelGrade: await g('defaultFuelGrade', '95#'),
    fuelGrades: await g('fuelGrades', ['92#', '95#', '98#', '0#柴油']),
    kwhToLiterFactor: await g('kwhToLiterFactor', 0.112),
    hevAllowCharge: await g('hevAllowCharge', false),
    fuelEconomyUnit: await g('fuelEconomyUnit', 'L/100km'),
    electricEconomyUnit: await g('electricEconomyUnit', 'kWh/100km'),
    ocrMain: await g('ocrWhitelist.main', OCR_DEFAULTS.main),
    ocrDate: await g('ocrWhitelist.date', OCR_DEFAULTS.date),
    ocrAmountDue: await g('ocrWhitelist.amountDue', OCR_DEFAULTS.amountDue),
    ocrDiscount: await g('ocrWhitelist.discount', OCR_DEFAULTS.discount),
  };
}
