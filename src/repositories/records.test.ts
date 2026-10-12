import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { deleteRecord, putRecord } from './records';
import { putVehicle } from './vehicles';
import { nowISO } from '../lib/constants';
import type { Media } from '../types';

async function reset() {
  await closeDBForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('car-care-db');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

describe('deleteRecord media + coverMediaId protection', () => {
  beforeEach(reset);
  afterEach(async () => {
    await closeDBForTests();
  });

  it('deletes unreferenced record media', async () => {
    await putVehicle({
      id: 'v1',
      name: 'A',
      energyType: 'ICE',
      bodyType: 'SEDAN',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });
    const media: Media = {
      id: 'm1',
      mimeType: 'image/jpeg',
      byteSize: 1,
      blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
      createdAt: nowISO(),
    };
    const db = await getDB();
    await db.put('media', media);
    await putRecord({
      id: 'r1',
      vehicleId: 'v1',
      type: 'wash',
      date: '2026-01-01T00:00:00.000Z',
      amountPaid: 1,
      mediaIds: ['m1'],
      washKind: 'basic',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });

    await deleteRecord('r1');

    const db2 = await getDB();
    expect(await db2.get('records', 'r1')).toBeUndefined();
    expect(await db2.get('media', 'm1')).toBeUndefined();
  });

  it('keeps media that is another record reference', async () => {
    await putVehicle({
      id: 'v1',
      name: 'A',
      energyType: 'ICE',
      bodyType: 'SEDAN',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });
    const db = await getDB();
    await db.put('media', {
      id: 'shared',
      mimeType: 'image/jpeg',
      byteSize: 1,
      blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
      createdAt: nowISO(),
    });
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
      vehicleId: 'v1',
      type: 'wash',
      date: '2026-01-02T00:00:00.000Z',
      amountPaid: 1,
      mediaIds: ['shared'],
      washKind: 'basic',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });

    await deleteRecord('r1');

    const db2 = await getDB();
    expect(await db2.get('records', 'r1')).toBeUndefined();
    expect(await db2.get('media', 'shared')).toBeTruthy();
  });

  it('keeps media that is a vehicle coverMediaId even if only this record lists it', async () => {
    await putVehicle({
      id: 'v1',
      name: 'A',
      energyType: 'ICE',
      bodyType: 'SEDAN',
      coverMediaId: 'cover-as-rec',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });
    const db = await getDB();
    await db.put('media', {
      id: 'cover-as-rec',
      mimeType: 'image/jpeg',
      byteSize: 1,
      blob: new Blob([new Uint8Array([9])], { type: 'image/jpeg' }),
      createdAt: nowISO(),
    });
    await putRecord({
      id: 'r1',
      vehicleId: 'v1',
      type: 'wash',
      date: '2026-01-01T00:00:00.000Z',
      amountPaid: 1,
      mediaIds: ['cover-as-rec'],
      washKind: 'basic',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });

    await deleteRecord('r1');

    const db2 = await getDB();
    expect(await db2.get('records', 'r1')).toBeUndefined();
    // Cover must survive — otherwise vehicle points at missing blob
    expect(await db2.get('media', 'cover-as-rec')).toBeTruthy();
  });

  it('keeps media used as cover on a different vehicle', async () => {
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
      coverMediaId: 'm-cover',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });
    const db = await getDB();
    await db.put('media', {
      id: 'm-cover',
      mimeType: 'image/jpeg',
      byteSize: 1,
      blob: new Blob([new Uint8Array([2])], { type: 'image/jpeg' }),
      createdAt: nowISO(),
    });
    await putRecord({
      id: 'r1',
      vehicleId: 'v1',
      type: 'wash',
      date: '2026-01-01T00:00:00.000Z',
      amountPaid: 1,
      mediaIds: ['m-cover'],
      washKind: 'basic',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });

    await deleteRecord('r1');

    const db2 = await getDB();
    expect(await db2.get('media', 'm-cover')).toBeTruthy();
  });
});
