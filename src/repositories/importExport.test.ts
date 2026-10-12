import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { importData, setImportWriteHookForTests } from './importExport';
import { nowISO } from '../lib/constants';

function vehicle(id = 'v-exist', overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Existing',
    energyType: 'ICE' as const,
    bodyType: 'SEDAN' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function fuel(id: string, vehicleId: string, odo: number) {
  return {
    id,
    vehicleId,
    type: 'fuel' as const,
    date: '2026-01-02T10:00:00.000Z',
    amountPaid: 100,
    mediaIds: [] as string[],
    liters: 30,
    odometer: odo,
    fuelGrade: '95#',
    filledUp: true,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
}

function exportPayload(overrides: Record<string, unknown> = {}) {
  return {
    format: 'car-care-export-v1',
    exportedAt: nowISO(),
    appSchemaVersion: 3,
    vehicles: [vehicle('v-import')],
    records: [fuel('r-import', 'v-import', 2000)],
    stations: [],
    settings: [{ key: 'language', value: 'zh-CN', updatedAt: nowISO() }],
    media: [],
    ...overrides,
  };
}

async function seedExisting() {
  const db = await getDB();
  const v = vehicle('v-exist', {
    name: 'Local Name',
    plate: '沪A·LOCAL',
    note: 'local-only-attr',
    updatedAt: '2026-09-01T00:00:00.000Z',
  });
  await db.put('vehicles', v);
  await db.put('records', fuel('r-exist', 'v-exist', 1000));
  await db.put('settings', { key: 'language', value: 'zh-CN', updatedAt: nowISO() });
  await db.put('settings', { key: 'currency', value: { code: 'CNY', symbol: '¥' }, updatedAt: nowISO() });
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
  await db.put('media', {
    id: 'm-exist',
    mimeType: 'image/jpeg',
    byteSize: 3,
    blob,
    createdAt: nowISO(),
  });
}

describe('importData atomicity & validation', () => {
  beforeEach(async () => {
    setImportWriteHookForTests(null);
    await closeDBForTests();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('car-care-db');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });

  afterEach(async () => {
    setImportWriteHookForTests(null);
    await closeDBForTests();
  });

  it('rejects malformed JSON without touching existing data', async () => {
    await seedExisting();
    const r = await importData('{{{{', 'replace');
    expect(r.ok).toBe(false);
    const db = await getDB();
    expect(await db.get('vehicles', 'v-exist')).toBeTruthy();
    expect(await db.get('records', 'r-exist')).toBeTruthy();
  });

  it('rejects invalid structure without clearing on replace', async () => {
    await seedExisting();
    const bad = exportPayload({
      vehicles: [{ id: 'x', name: 'no-energy' }],
    });
    const r = await importData(JSON.stringify(bad), 'replace');
    expect(r.ok).toBe(false);
    const db = await getDB();
    expect(await db.get('vehicles', 'v-exist')).toBeTruthy();
    expect(await db.count('vehicles')).toBe(1);
  });

  it('replace imports atomically and removes previous vehicles', async () => {
    await seedExisting();
    const r = await importData(JSON.stringify(exportPayload()), 'replace');
    expect(r.ok).toBe(true);
    const db = await getDB();
    expect(await db.get('vehicles', 'v-exist')).toBeUndefined();
    expect(await db.get('vehicles', 'v-import')).toBeTruthy();
    expect(await db.get('records', 'r-exist')).toBeUndefined();
    expect(await db.get('records', 'r-import')).toBeTruthy();
  });

  it('merge keeps existing ids and adds new ones', async () => {
    await seedExisting();
    const r = await importData(JSON.stringify(exportPayload()), 'merge');
    expect(r.ok).toBe(true);
    const db = await getDB();
    expect(await db.get('vehicles', 'v-exist')).toBeTruthy();
    expect(await db.get('vehicles', 'v-import')).toBeTruthy();
    expect(await db.get('records', 'r-exist')).toBeTruthy();
    expect(await db.get('records', 'r-import')).toBeTruthy();
  });

  it('merge same-id vehicle skips put (keeps local attrs)', async () => {
    await seedExisting();
    const incoming = exportPayload({
      vehicles: [
        vehicle('v-exist', {
          name: 'Imported Overwrite Attempt',
          plate: '京B·IMPORT',
          note: 'should-not-apply',
          updatedAt: '2020-01-01T00:00:00.000Z',
        }),
        vehicle('v-new', { name: 'Brand New' }),
      ],
      records: [fuel('r-new', 'v-new', 500)],
    });
    const r = await importData(JSON.stringify(incoming), 'merge');
    expect(r.ok).toBe(true);
    const db = await getDB();
    const local = await db.get('vehicles', 'v-exist');
    expect(local?.name).toBe('Local Name');
    expect(local?.plate).toBe('沪A·LOCAL');
    expect(local?.note).toBe('local-only-attr');
    expect(local?.updatedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(await db.get('vehicles', 'v-new')).toBeTruthy();
  });

  it('accepts legacy schema 1 payload (no learning)', async () => {
    await seedExisting();
    const payload = exportPayload({ appSchemaVersion: 1 });
    delete (payload as { learning?: unknown }).learning;
    const r = await importData(JSON.stringify(payload), 'merge');
    expect(r.ok).toBe(true);
  });

  it('rejects corrupt media by default (no DB mutation on cover-import)', async () => {
    await seedExisting();
    const payload = exportPayload({
      media: [
        {
          id: 'm-bad',
          mimeType: 'image/jpeg',
          byteSize: 10,
          base64: '!!!not-base64!!!',
          createdAt: nowISO(),
        },
      ],
    });
    const r = await importData(JSON.stringify(payload), 'replace');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/图片损坏|拒绝导入/);
    const db = await getDB();
    // Original data intact
    expect(await db.get('vehicles', 'v-exist')).toBeTruthy();
    expect(await db.get('records', 'r-exist')).toBeTruthy();
    expect(await db.get('media', 'm-exist')).toBeTruthy();
    expect(await db.get('vehicles', 'v-import')).toBeUndefined();
  });

  it('allows skipping corrupt media when skipCorruptMedia is true', async () => {
    await seedExisting();
    const payload = exportPayload({
      media: [
        {
          id: 'm-bad',
          mimeType: 'image/jpeg',
          byteSize: 10,
          base64: '!!!not-base64!!!',
          createdAt: nowISO(),
        },
      ],
    });
    const r = await importData(JSON.stringify(payload), 'replace', { skipCorruptMedia: true });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/跳过/);
    const db = await getDB();
    expect(await db.get('vehicles', 'v-exist')).toBeUndefined();
    expect(await db.get('vehicles', 'v-import')).toBeTruthy();
    expect(await db.get('media', 'm-bad')).toBeUndefined();
  });

  it('cover-import mid-transaction write failure rolls back all clears/puts', async () => {
    await seedExisting();
    // BUSINESS_STORES has 6 clears on replace; fail on first put after clears
    // writeCount 1..6 = clears; 7 = first vehicle put → throw
    setImportWriteHookForTests(({ writeCount, op }) => {
      if (writeCount === 7 && op === 'put') {
        throw new Error('injected write failure');
      }
    });

    const r = await importData(JSON.stringify(exportPayload()), 'replace');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/回滚|未损坏|injected write failure/);

    const db = await getDB();
    // Entire replace tx aborted — original rows remain
    const v = await db.get('vehicles', 'v-exist');
    expect(v).toBeTruthy();
    expect(v?.name).toBe('Local Name');
    expect(await db.get('records', 'r-exist')).toBeTruthy();
    expect(await db.get('settings', 'currency')).toBeTruthy();
    expect(await db.get('media', 'm-exist')).toBeTruthy();
    // Import payload must not have landed
    expect(await db.get('vehicles', 'v-import')).toBeUndefined();
    expect(await db.get('records', 'r-import')).toBeUndefined();
    expect(await db.count('vehicles')).toBe(1);
  });
});
