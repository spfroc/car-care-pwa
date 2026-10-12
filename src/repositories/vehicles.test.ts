import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { deleteVehicle, putVehicle } from './vehicles';
import { putRecord } from './records';
import { nowISO } from '../lib/constants';
import type { CareRecord, Media, Vehicle } from '../types';

async function reset() {
  await closeDBForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('car-care-db');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

describe('deleteVehicle transactional cascade', () => {
  beforeEach(reset);
  afterEach(async () => {
    await closeDBForTests();
  });

  it('removes vehicle, records, and unshared media in one cascade', async () => {
    const v: Vehicle = {
      id: 'v1',
      name: 'A',
      energyType: 'ICE',
      bodyType: 'SEDAN',
      coverMediaId: 'cover1',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const media: Media = {
      id: 'm1',
      mimeType: 'image/jpeg',
      byteSize: 4,
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
      createdAt: nowISO(),
    };
    const cover: Media = {
      id: 'cover1',
      mimeType: 'image/jpeg',
      byteSize: 2,
      blob: new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }),
      createdAt: nowISO(),
    };
    const rec: CareRecord = {
      id: 'r1',
      vehicleId: 'v1',
      type: 'fuel',
      date: '2026-01-01T00:00:00.000Z',
      amountPaid: 10,
      mediaIds: ['m1'],
      liters: 10,
      odometer: 100,
      fuelGrade: '95#',
      filledUp: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    const db = await getDB();
    await putVehicle(v);
    await db.put('media', media);
    await db.put('media', cover);
    await putRecord(rec);

    await deleteVehicle('v1');

    const db2 = await getDB();
    expect(await db2.get('vehicles', 'v1')).toBeUndefined();
    expect(await db2.get('records', 'r1')).toBeUndefined();
    expect(await db2.get('media', 'm1')).toBeUndefined();
    expect(await db2.get('media', 'cover1')).toBeUndefined();
  });

  it('keeps media still referenced by another vehicle record', async () => {
    const shared: Media = {
      id: 'shared',
      mimeType: 'image/jpeg',
      byteSize: 1,
      blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
      createdAt: nowISO(),
    };
    await putVehicle({
      id: 'v1',
      name: 'A',
      energyType: 'ICE',
      bodyType: 'SEDAN',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });
    await putVehicle({
      id: 'v2',
      name: 'B',
      energyType: 'EV',
      bodyType: 'SEDAN',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });
    const db = await getDB();
    await db.put('media', shared);
    await putRecord({
      id: 'r1',
      vehicleId: 'v1',
      type: 'wash',
      date: '2026-01-01T00:00:00.000Z',
      amountPaid: 1,
      mediaIds: ['shared'],
      washKind: 'basic',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });
    await putRecord({
      id: 'r2',
      vehicleId: 'v2',
      type: 'wash',
      date: '2026-01-02T00:00:00.000Z',
      amountPaid: 1,
      mediaIds: ['shared'],
      washKind: 'basic',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });

    await deleteVehicle('v1');

    const db2 = await getDB();
    expect(await db2.get('vehicles', 'v1')).toBeUndefined();
    expect(await db2.get('records', 'r1')).toBeUndefined();
    expect(await db2.get('records', 'r2')).toBeTruthy();
    expect(await db2.get('media', 'shared')).toBeTruthy();
  });
});
