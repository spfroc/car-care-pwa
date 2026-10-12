import { getDB } from '../db';
import type { Vehicle } from '../types';
import { enqueueSyncOp } from '../sync/outbox';

export async function listVehicles(): Promise<Vehicle[]> {
  const db = await getDB();
  const all = await db.getAll('vehicles');
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getVehicle(id: string): Promise<Vehicle | undefined> {
  return (await getDB()).get('vehicles', id);
}

export async function putVehicle(v: Vehicle): Promise<void> {
  await (await getDB()).put('vehicles', v);
  await enqueueSyncOp({
    entity: 'vehicles',
    entityId: v.id,
    op: 'upsert',
    payload: v,
    mutatedAt: v.updatedAt,
  });
}

/**
 * Atomically delete a vehicle, all its records, and media that are not shared.
 * Also clears coverMediaId blob when unused. Stations are never deleted (data-model §11).
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
    // Cover of another vehicle?
    const vehicles = await db.getAll('vehicles');
    for (const v of vehicles) {
      if (v.id === id) continue;
      if (v.coverMediaId) mediaToDelete.delete(v.coverMediaId);
    }
  }

  const tx = db.transaction(['vehicles', 'records', 'media'], 'readwrite');
  for (const r of rows) {
    await tx.objectStore('records').delete(r.id);
  }
  for (const mid of mediaToDelete) {
    await tx.objectStore('media').delete(mid);
  }
  await tx.objectStore('vehicles').delete(id);
  await tx.done;
  const mutatedAt = new Date().toISOString();
  await enqueueSyncOp({ entity: 'vehicles', entityId: id, op: 'delete', mutatedAt });
  for (const r of rows) {
    await enqueueSyncOp({ entity: 'records', entityId: r.id, op: 'delete', mutatedAt });
  }
  for (const mid of mediaToDelete) {
    await enqueueSyncOp({ entity: 'media', entityId: mid, op: 'delete', mutatedAt });
  }
}
