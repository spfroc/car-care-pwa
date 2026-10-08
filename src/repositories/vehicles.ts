import { getDB } from '../db';
import type { Vehicle } from '../types';
import { deleteRecordsForVehicle } from './records';

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
}

export async function deleteVehicle(id: string): Promise<void> {
  const db = await getDB();
  await deleteRecordsForVehicle(id);
  await db.delete('vehicles', id);
}
