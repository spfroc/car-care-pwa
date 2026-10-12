import { getDB } from '../db';
import type { Station, StationType } from '../types';
import {
  isCloudEnqueueEnabled,
  makeOutboxItem,
  putOutboxInTx,
  settleTx,
} from '../sync/outbox';

export async function listStations(type?: StationType): Promise<Station[]> {
  const db = await getDB();
  const all = type
    ? await db.getAllFromIndex('stations', 'byType', type)
    : await db.getAll('stations');
  return all.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function putStation(s: Station): Promise<void> {
  const db = await getDB();
  const sync = await isCloudEnqueueEnabled();
  const stores = sync ? (['stations', 'sync_outbox'] as const) : (['stations'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    await tx.objectStore('stations').put(s);
    if (sync) {
      await putOutboxInTx(
        tx,
        makeOutboxItem({
          entity: 'stations',
          entityId: s.id,
          op: 'upsert',
          payload: s,
          mutatedAt: s.updatedAt,
        }),
      );
    }
  });
}

export async function deleteStation(id: string): Promise<void> {
  const db = await getDB();
  const records = await db.getAll('records');
  const sync = await isCloudEnqueueEnabled();
  const stores = sync
    ? (['stations', 'records', 'sync_outbox'] as const)
    : (['stations', 'records'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    const mutatedAt = new Date().toISOString();
    for (const r of records) {
      if ('stationId' in r && r.stationId === id) {
        const next = { ...r, stationId: undefined, updatedAt: mutatedAt };
        await tx.objectStore('records').put(next as typeof r);
        if (sync) {
          await putOutboxInTx(
            tx,
            makeOutboxItem({
              entity: 'records',
              entityId: r.id,
              op: 'upsert',
              payload: next,
              mutatedAt,
            }),
          );
        }
      }
    }
    await tx.objectStore('stations').delete(id);
    if (sync) {
      await putOutboxInTx(
        tx,
        makeOutboxItem({ entity: 'stations', entityId: id, op: 'delete', mutatedAt }),
      );
    }
  });
}

export async function getStation(id: string): Promise<Station | undefined> {
  return (await getDB()).get('stations', id);
}
