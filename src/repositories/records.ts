import { getDB } from '../db';
import type { CareRecord, RecordType } from '../types';
import { deleteMedia } from './media';

export async function listRecordsByVehicle(vehicleId: string, type?: RecordType): Promise<CareRecord[]> {
  const db = await getDB();
  let rows: CareRecord[];
  if (type) {
    rows = await db.getAllFromIndex('records', 'byVehicleTypeDate', IDBKeyRange.bound(
      [vehicleId, type, ''],
      [vehicleId, type, '\uffff'],
    ));
  } else {
    rows = await db.getAllFromIndex('records', 'byVehicle', vehicleId);
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function listAllRecords(): Promise<CareRecord[]> {
  const db = await getDB();
  return (await db.getAll('records')).sort((a, b) => b.date.localeCompare(a.date));
}

export async function getRecord(id: string): Promise<CareRecord | undefined> {
  return (await getDB()).get('records', id);
}

export async function putRecord(r: CareRecord): Promise<void> {
  await (await getDB()).put('records', r);
}

export async function deleteRecord(id: string): Promise<void> {
  const db = await getDB();
  const rec = await db.get('records', id);
  if (rec) {
    for (const mid of rec.mediaIds ?? []) {
      await deleteMedia(mid);
    }
    await db.delete('records', id);
  }
}

export async function deleteRecordsForVehicle(vehicleId: string): Promise<void> {
  const rows = await listRecordsByVehicle(vehicleId);
  for (const r of rows) {
    await deleteRecord(r.id);
  }
}

export async function latestOdometer(vehicleId: string): Promise<number | undefined> {
  const rows = await listRecordsByVehicle(vehicleId);
  let max: number | undefined;
  for (const r of rows) {
    if (typeof r.odometer === 'number') {
      if (max === undefined || r.odometer > max) max = r.odometer;
    }
  }
  return max;
}
