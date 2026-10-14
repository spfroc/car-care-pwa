import { getDB } from '../db';
import type { Vehicle } from '../types';
import {
  isCloudEnqueueEnabled,
  makeOutboxItem,
  putOutboxInTx,
  stampOutboxOwner,
  settleTx,
} from '../sync/outbox';
import { runSyncTxHook } from '../sync/txHooks';

export async function listVehicles(): Promise<Vehicle[]> {
  const db = await getDB();
  const all = await db.getAll('vehicles');
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getVehicle(id: string): Promise<Vehicle | undefined> {
  return (await getDB()).get('vehicles', id);
}

export async function putVehicle(v: Vehicle): Promise<void> {
  const db = await getDB();
  const sync = await isCloudEnqueueEnabled('vehicles');
  const outboxItem = sync
    ? await stampOutboxOwner(
        makeOutboxItem({
          entity: 'vehicles',
          entityId: v.id,
          op: 'upsert',
          payload: v,
          mutatedAt: v.updatedAt,
        }),
      )
    : null;
  const stores = sync ? (['vehicles', 'sync_outbox'] as const) : (['vehicles'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    await tx.objectStore('vehicles').put(v);
    if (outboxItem) {
      await runSyncTxHook('after_business_before_outbox', { store: 'vehicles' });
      await putOutboxInTx(tx, outboxItem);
    }
  });
}

/**
 * Atomically delete a vehicle, all its records, and media that are not shared,
 * plus matching sync_outbox tombstones when cloud is enabled for that entity.
 */
export async function deleteVehicle(id: string): Promise<void> {
  const db = await getDB();
  const vehicle = await db.get('vehicles', id);
  const rows = await db.getAllFromIndex('records', 'byVehicle', id);

  const mediaToDelete = new Set<string>();
  for (const r of rows) {
    for (const mid of r.mediaIds ?? []) mediaToDelete.add(mid);
  }
  if (vehicle?.coverMediaId) mediaToDelete.add(vehicle.coverMediaId);

  if (mediaToDelete.size) {
    const all = await db.getAll('records');
    for (const other of all) {
      if (other.vehicleId === id) continue;
      for (const mid of other.mediaIds ?? []) {
        mediaToDelete.delete(mid);
      }
    }
    const vehicles = await db.getAll('vehicles');
    for (const v of vehicles) {
      if (v.id === id) continue;
      if (v.coverMediaId) mediaToDelete.delete(v.coverMediaId);
    }
  }

  const syncVehicles = await isCloudEnqueueEnabled('vehicles');
  const syncRecords = await isCloudEnqueueEnabled('records');
  const syncMedia = await isCloudEnqueueEnabled('media');
  const syncAny = syncVehicles || syncRecords || syncMedia;
  const mutatedAt = new Date().toISOString();
  const outboxItems = syncAny
    ? await Promise.all([
        ...(syncVehicles
          ? [stampOutboxOwner(makeOutboxItem({ entity: 'vehicles', entityId: id, op: 'delete', mutatedAt }))]
          : []),
        ...(syncRecords
          ? rows.map((r) =>
              stampOutboxOwner(makeOutboxItem({ entity: 'records', entityId: r.id, op: 'delete', mutatedAt })),
            )
          : []),
        ...(syncMedia
          ? [...mediaToDelete].map((mid) =>
              stampOutboxOwner(makeOutboxItem({ entity: 'media', entityId: mid, op: 'delete', mutatedAt })),
            )
          : []),
      ])
    : [];
  const stores = syncAny
    ? (['vehicles', 'records', 'media', 'sync_outbox'] as const)
    : (['vehicles', 'records', 'media'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    for (const r of rows) {
      await tx.objectStore('records').delete(r.id);
    }
    for (const mid of mediaToDelete) {
      await tx.objectStore('media').delete(mid);
    }
    await tx.objectStore('vehicles').delete(id);
    for (const item of outboxItems) {
      await putOutboxInTx(tx, item);
    }
  });
}
