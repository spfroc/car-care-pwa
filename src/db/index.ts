import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CareRecord, Media, MetaRow, SettingRow, Station, Vehicle } from '../types';
import { DEFAULT_FUEL_GRADES, OCR_DEFAULTS, nowISO } from '../lib/constants';

export const DB_NAME = 'car-care-db';
export const DB_VERSION = 1;

export interface CarCareDB extends DBSchema {
  vehicles: { key: string; value: Vehicle; indexes: { byEnergy: string; byUpdated: string } };
  records: {
    key: string;
    value: CareRecord;
    indexes: {
      byVehicle: string;
      byType: string;
      byDate: string;
      byVehicleDate: [string, string];
      byVehicleTypeDate: [string, string, string];
    };
  };
  stations: { key: string; value: Station; indexes: { byType: string } };
  settings: { key: string; value: SettingRow };
  media: { key: string; value: Media };
  meta: { key: string; value: MetaRow };
}

let dbPromise: Promise<IDBPDatabase<CarCareDB>> | null = null;
let openError: Error | null = null;

export function getOpenError(): Error | null {
  return openError;
}

export async function getDB(): Promise<IDBPDatabase<CarCareDB>> {
  if (openError) throw openError;
  if (!dbPromise) {
    dbPromise = openDB<CarCareDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const vehicles = db.createObjectStore('vehicles', { keyPath: 'id' });
        vehicles.createIndex('byEnergy', 'energyType');
        vehicles.createIndex('byUpdated', 'updatedAt');

        const records = db.createObjectStore('records', { keyPath: 'id' });
        records.createIndex('byVehicle', 'vehicleId');
        records.createIndex('byType', 'type');
        records.createIndex('byDate', 'date');
        records.createIndex('byVehicleDate', ['vehicleId', 'date']);
        records.createIndex('byVehicleTypeDate', ['vehicleId', 'type', 'date']);

        const stations = db.createObjectStore('stations', { keyPath: 'id' });
        stations.createIndex('byType', 'stationType');

        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('media', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    }).catch((e) => {
      openError = e instanceof Error ? e : new Error(String(e));
      dbPromise = null;
      throw openError;
    });
  }
  return dbPromise;
}

export async function ensureDefaultSettings(): Promise<void> {
  const db = await getDB();
  const defaults: Record<string, unknown> = {
    language: 'zh-CN',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '24h',
    currency: { code: 'CNY', symbol: '¥' },
    volumeUnit: 'L',
    energyUnit: 'kWh',
    defaultFuelGrade: '95#',
    fuelGrades: DEFAULT_FUEL_GRADES,
    kwhToLiterFactor: 0.112,
    'ocrWhitelist.main': OCR_DEFAULTS.main,
    'ocrWhitelist.date': OCR_DEFAULTS.date,
    'ocrWhitelist.amountDue': OCR_DEFAULTS.amountDue,
    'ocrWhitelist.discount': OCR_DEFAULTS.discount,
    ocrWhitelistDefaults: { ...OCR_DEFAULTS },
    hevAllowCharge: false,
    fuelEconomyUnit: 'L/100km',
    electricEconomyUnit: 'kWh/100km',
  };
  const tx = db.transaction('settings', 'readwrite');
  for (const [key, value] of Object.entries(defaults)) {
    const existing = await tx.store.get(key);
    if (!existing) {
      await tx.store.put({ key, value, updatedAt: nowISO() });
    }
  }
  await tx.done;
  const meta = await db.get('meta', 'schemaVersion');
  if (!meta) await db.put('meta', { key: 'schemaVersion', value: 1 });
}

export async function tryPersistStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const any = e as { name?: string; message?: string };
  return (
    any.name === 'QuotaExceededError' ||
    any.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota/i.test(any.message ?? '')
  );
}
