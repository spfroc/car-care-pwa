import { getDB } from '../db';
import type { Station, StationType } from '../types';
import {
  isCloudEnqueueEnabled,
  makeOutboxItem,
  putOutboxInTx,
  settleTx,
  stampOutboxOwner,
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
  const outboxItem = sync
    ? await stampOutboxOwner(
        makeOutboxItem({
          entity: 'stations',
          entityId: s.id,
          op: 'upsert',
          payload: s,
          mutatedAt: s.updatedAt,
        }),
      )
    : null;
  const stores = sync ? (['stations', 'sync_outbox'] as const) : (['stations'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    await tx.objectStore('stations').put(s);
    if (outboxItem) await putOutboxInTx(tx, outboxItem);
  });
}

export async function deleteStation(id: string): Promise<void> {
  const db = await getDB();
  const records = await db.getAll('records');
  const sync = await isCloudEnqueueEnabled();
  const mutatedAt = new Date().toISOString();
  const touched = records.filter((r) => 'stationId' in r && r.stationId === id);
  const nextRecords = touched.map((r) => ({ ...r, stationId: undefined, updatedAt: mutatedAt }));
  const outboxItems = sync
    ? await Promise.all([
        ...nextRecords.map((next) =>
          stampOutboxOwner(
            makeOutboxItem({
              entity: 'records',
              entityId: next.id,
              op: 'upsert',
              payload: next,
              mutatedAt,
            }),
          ),
        ),
        stampOutboxOwner(makeOutboxItem({ entity: 'stations', entityId: id, op: 'delete', mutatedAt })),
      ])
    : [];
  const stores = sync
    ? (['stations', 'records', 'sync_outbox'] as const)
    : (['stations', 'records'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    for (const next of nextRecords) {
      await tx.objectStore('records').put(next as (typeof records)[number]);
    }
    await tx.objectStore('stations').delete(id);
    for (const item of outboxItems) await putOutboxInTx(tx, item);
  });
}

export async function getStation(id: string): Promise<Station | undefined> {
  return (await getDB()).get('stations', id);
}
