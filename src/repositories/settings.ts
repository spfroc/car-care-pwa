import { getDB } from '../db';
import { OCR_DEFAULTS, nowISO } from '../lib/constants';
import { writeShellBootCache } from '../lib/shellBoot';
import type { SettingRow } from '../types';

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const row = await (await getDB()).get('settings', key);
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const row: SettingRow = { key, value, updatedAt: nowISO() };
  const { isCloudEnqueueEnabled, makeOutboxItem, putOutboxInTx, settleTx, stampOutboxOwner } =
    await import('../sync/outbox');
  const db = await getDB();
  const sync = key !== 'cloudStorage' && (await isCloudEnqueueEnabled('settings'));
  const outboxItem = sync
    ? await stampOutboxOwner(
        makeOutboxItem({
          entity: 'settings',
          entityId: key,
          op: 'upsert',
          payload: row,
          mutatedAt: row.updatedAt,
        }),
      )
    : null;
  const stores = sync ? (['settings', 'sync_outbox'] as const) : (['settings'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    await tx.objectStore('settings').put(row);
    if (outboxItem) await putOutboxInTx(tx, outboxItem);
  });
  if (key === 'language' && typeof value === 'string') {
    writeShellBootCache({ language: value });
  } else if (key === 'hideBottomNav' && typeof value === 'boolean') {
    writeShellBootCache({ hideBottomNav: value });
  }
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
  /** Settings 「隐藏底栏」. Default false: bar stays visible. */
  hideBottomNav: boolean;
  fuelEconomyUnit: string;
  electricEconomyUnit: string;
  ocrMain: string;
  ocrDate: string;
  ocrAmountDue: string;
  ocrDiscount: string;
};

/** In-memory defaults used before IndexedDB hydrates. `boot` overrides shell prefs only. */
export function fallbackAppSettings(boot?: {
  language?: string;
  hideBottomNav?: boolean;
}): AppSettings {
  return {
    language: boot?.language || 'zh-CN',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '24h',
    currency: { code: 'CNY', symbol: '¥' },
    volumeUnit: 'L',
    energyUnit: 'kWh',
    defaultFuelGrade: '95#',
    fuelGrades: ['92#', '95#', '98#', '0#柴油'],
    kwhToLiterFactor: 0.112,
    hevAllowCharge: false,
    hideBottomNav: boot?.hideBottomNav === true,
    fuelEconomyUnit: 'L/100km',
    electricEconomyUnit: 'kWh/100km',
    ocrMain: OCR_DEFAULTS.main,
    ocrDate: OCR_DEFAULTS.date,
    ocrAmountDue: OCR_DEFAULTS.amountDue,
    ocrDiscount: OCR_DEFAULTS.discount,
  };
}

export async function loadAppSettings(): Promise<AppSettings> {
  const base = fallbackAppSettings();
  const g = async <T>(k: string, d: T): Promise<T> => (await getSetting<T>(k)) ?? d;
  const settings: AppSettings = {
    language: await g('language', base.language),
    dateFormat: await g('dateFormat', base.dateFormat),
    timeFormat: await g('timeFormat', base.timeFormat),
    currency: await g('currency', base.currency),
    volumeUnit: await g('volumeUnit', base.volumeUnit),
    energyUnit: await g('energyUnit', base.energyUnit),
    defaultFuelGrade: await g('defaultFuelGrade', base.defaultFuelGrade),
    fuelGrades: await g('fuelGrades', base.fuelGrades),
    kwhToLiterFactor: await g('kwhToLiterFactor', base.kwhToLiterFactor),
    hevAllowCharge: await g('hevAllowCharge', base.hevAllowCharge),
    hideBottomNav: await g('hideBottomNav', base.hideBottomNav),
    fuelEconomyUnit: await g('fuelEconomyUnit', base.fuelEconomyUnit),
    electricEconomyUnit: await g('electricEconomyUnit', base.electricEconomyUnit),
    ocrMain: await g('ocrWhitelist.main', base.ocrMain),
    ocrDate: await g('ocrWhitelist.date', base.ocrDate),
    ocrAmountDue: await g('ocrWhitelist.amountDue', base.ocrAmountDue),
    ocrDiscount: await g('ocrWhitelist.discount', base.ocrDiscount),
  };
  writeShellBootCache({
    language: settings.language,
    hideBottomNav: settings.hideBottomNav,
  });
  return settings;
}
