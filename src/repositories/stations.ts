import { getDB } from '../db';
import type { Station, StationType } from '../types';

export async function listStations(type?: StationType): Promise<Station[]> {
  const db = await getDB();
  const all = type
    ? await db.getAllFromIndex('stations', 'byType', type)
    : await db.getAll('stations');
  return all.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function putStation(s: Station): Promise<void> {
  await (await getDB()).put('stations', s);
}

export async function deleteStation(id: string): Promise<void> {
  const db = await getDB();
  const records = await db.getAll('records');
  const tx = db.transaction(['stations', 'records'], 'readwrite');
  for (const r of records) {
    if ('stationId' in r && r.stationId === id) {
      const next = { ...r, stationId: undefined, updatedAt: new Date().toISOString() };
      await tx.objectStore('records').put(next as typeof r);
    }
  }
  await tx.objectStore('stations').delete(id);
  await tx.done;
}

export async function getStation(id: string): Promise<Station | undefined> {
  return (await getDB()).get('stations', id);
}
