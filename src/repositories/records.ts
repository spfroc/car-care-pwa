import { getDB } from '../db';
import type { CareRecord, RecordType } from '../types';

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

/**
 * Delete one record and its media that are not referenced by any other record.
 * Single transaction: media + records stay consistent on abort.
 */
export async function deleteRecord(id: string): Promise<void> {
  const db = await getDB();
  const rec = await db.get('records', id);
  if (!rec) return;

  const mediaIds = [...(rec.mediaIds ?? [])];
  const allRecords = mediaIds.length ? await db.getAll('records') : [];

  const stillReferenced = new Set<string>();
  if (mediaIds.length) {
    for (const other of allRecords) {
      if (other.id === id) continue;
      for (const mid of other.mediaIds ?? []) {
        if (mediaIds.includes(mid)) stillReferenced.add(mid);
      }
    }
  }

  const tx = db.transaction(['records', 'media'], 'readwrite');
  for (const mid of mediaIds) {
    if (!stillReferenced.has(mid)) {
      await tx.objectStore('media').delete(mid);
    }
  }
  await tx.objectStore('records').delete(id);
  await tx.done;
}

/**
 * Delete all records for a vehicle (+ orphaned media) inside one transaction.
 * Used by deleteVehicle; prefer deleteVehicle for full cascade including the vehicle row.
 */
export async function deleteRecordsForVehicle(vehicleId: string): Promise<void> {
  const db = await getDB();
  const rows = await db.getAllFromIndex('records', 'byVehicle', vehicleId);
  const mediaToDelete = new Set<string>();
  for (const r of rows) {
    for (const mid of r.mediaIds ?? []) mediaToDelete.add(mid);
  }

  // Keep media still referenced by other vehicles' records
  if (mediaToDelete.size) {
    const all = await db.getAll('records');
    for (const other of all) {
      if (other.vehicleId === vehicleId) continue;
      for (const mid of other.mediaIds ?? []) {
        mediaToDelete.delete(mid);
      }
    }
  }

  const tx = db.transaction(['records', 'media'], 'readwrite');
  for (const r of rows) {
    await tx.objectStore('records').delete(r.id);
  }
  for (const mid of mediaToDelete) {
    await tx.objectStore('media').delete(mid);
  }
  await tx.done;
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
