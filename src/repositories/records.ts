import { getDB } from '../db';
import type { CareRecord, RecordType } from '../types';
import {
  isCloudEnqueueEnabled,
  makeOutboxItem,
  putOutboxInTx,
  settleTx,
  stampOutboxOwner,
} from '../sync/outbox';
import { noteLocalHardDelete } from '../sync/notionMap';

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
  const db = await getDB();
  const sync = await isCloudEnqueueEnabled('records');
  const outboxItem = sync
    ? await stampOutboxOwner(
        makeOutboxItem({
          entity: 'records',
          entityId: r.id,
          op: 'upsert',
          payload: r,
          mutatedAt: r.updatedAt,
        }),
      )
    : null;
  const stores = sync ? (['records', 'sync_outbox'] as const) : (['records'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    await tx.objectStore('records').put(r);
    if (outboxItem) await putOutboxInTx(tx, outboxItem);
  });
}

async function mediaStillReferenced(
  mediaIds: string[],
  excludeRecordId?: string,
  excludeVehicleId?: string,
): Promise<Set<string>> {
  const still = new Set<string>();
  if (!mediaIds.length) return still;
  const db = await getDB();
  const allRecords = await db.getAll('records');
  for (const other of allRecords) {
    if (excludeRecordId && other.id === excludeRecordId) continue;
    for (const mid of other.mediaIds ?? []) {
      if (mediaIds.includes(mid)) still.add(mid);
    }
  }
  const vehicles = await db.getAll('vehicles');
  for (const v of vehicles) {
    if (excludeVehicleId && v.id === excludeVehicleId) continue;
    if (v.coverMediaId && mediaIds.includes(v.coverMediaId)) {
      still.add(v.coverMediaId);
    }
  }
  return still;
}

/**
 * Delete one record (+ orphan media) and outbox tombstones in one transaction.
 */
export async function deleteRecord(id: string): Promise<void> {
  const db = await getDB();
  const rec = await db.get('records', id);
  if (!rec) return;

  const mediaIds = [...(rec.mediaIds ?? [])];
  const stillReferenced = await mediaStillReferenced(mediaIds, id);
  const syncRecords = await isCloudEnqueueEnabled('records');
  const syncMedia = await isCloudEnqueueEnabled('media');
  const syncAny = syncRecords || syncMedia;
  const orphanMedia = mediaIds.filter((mid) => !stillReferenced.has(mid));
  const mutatedAt = new Date().toISOString();
  const outboxItems = syncAny
    ? await Promise.all([
        ...(syncRecords
          ? [stampOutboxOwner(makeOutboxItem({ entity: 'records', entityId: id, op: 'delete', mutatedAt }))]
          : []),
        ...(syncMedia
          ? orphanMedia.map((mid) =>
              stampOutboxOwner(makeOutboxItem({ entity: 'media', entityId: mid, op: 'delete', mutatedAt })),
            )
          : []),
      ])
    : [];
  const stores = syncAny
    ? (['records', 'media', 'sync_outbox'] as const)
    : (['records', 'media'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    for (const mid of orphanMedia) {
      await tx.objectStore('media').delete(mid);
    }
    await tx.objectStore('records').delete(id);
    for (const item of outboxItems) await putOutboxInTx(tx, item);
  });
  if (syncRecords) await noteLocalHardDelete('records', id);
}

export async function deleteRecordsForVehicle(vehicleId: string): Promise<void> {
  const db = await getDB();
  const rows = await db.getAllFromIndex('records', 'byVehicle', vehicleId);
  const mediaToDelete = new Set<string>();
  for (const r of rows) {
    for (const mid of r.mediaIds ?? []) mediaToDelete.add(mid);
  }

  if (mediaToDelete.size) {
    const still = await mediaStillReferenced([...mediaToDelete], undefined, vehicleId);
    const self = await db.get('vehicles', vehicleId);
    if (self?.coverMediaId) still.add(self.coverMediaId);
    for (const mid of still) mediaToDelete.delete(mid);
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
