import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { putVehicle } from '../repositories/vehicles';
import type { Vehicle } from '../types';
import { clearCloudStorageConfig, setCloudStorageConfig } from './config';
import {
  bidirectionalSync,
  disconnectCloud,
  firstUploadToCloud,
  restoreFromCloud,
  setCloudProviderForTests,
  verifyConnection,
} from './engine';
import { listOutbox, patchSyncMeta } from './outbox';
import { SupabaseProvider } from './providers/supabase';

const URL = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_SUPABASE_ANON;
const EMAIL = process.env.SMOKE_EMAIL || 'm2smoke@carcare.test';
const PASS = process.env.SMOKE_PASS;
const live = Boolean(URL && ANON);
if (live && !PASS) {
  throw new Error('SMOKE_PASS required when SMOKE_SUPABASE_URL/ANON are set (no hardcoded password)');
}

function vehicle(id: string, name: string, updatedAt: string): Vehicle {
  return {
    id,
    name,
    plate: 'LIVE',
    energyType: 'ICE',
    bodyType: 'SEDAN',
    createdAt: updatedAt,
    updatedAt,
  };
}

describe.skipIf(!live)('live Supabase smoke (disposable project)', () => {
  let provider: SupabaseProvider;

  beforeEach(async () => {
    await clearCloudStorageConfig().catch(() => undefined);
    const db = await getDB();
    for (const s of ['vehicles', 'records', 'stations', 'media', 'sync_outbox', 'sync_meta'] as const) {
      try {
        await db.clear(s);
      } catch {
        /* */
      }
    }
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: URL!,
      supabaseAnonKey: ANON!,
      email: EMAIL,
    });
    provider = new SupabaseProvider({ url: URL!, anonKey: ANON!, deviceId: 'live-smoke-a' });
    setCloudProviderForTests(provider);
    const signed = await provider.signIn(EMAIL, PASS, false);
    expect(signed.ok).toBe(true);
  });

  afterEach(async () => {
    try {
      const client = provider.getClient();
      await client.from('car_care_rows').delete().like('id', 'live-%');
    } catch {
      /* */
    }
    setCloudProviderForTests(null);
    await closeDBForTests();
  });

  it(
    'connect → upload → restore → disconnect keeps queue → reconnect sync',
    async () => {
    const v = await verifyConnection();
    console.log('verify', v.ok, v.message);
    expect(v.ok).toBe(true);

    await putVehicle(vehicle('live-v1', 'LocalCar', '2026-10-12T03:00:00.000Z'));
    const up = await firstUploadToCloud();
    console.log('upload', up.ok, up.message);
    if (!up.ok) console.error('UPLOAD FAIL', up);
    expect(up.ok, up.message).toBe(true);

    // Simulate other device: clear local business data, restore
    const db = await getDB();
    await db.clear('vehicles');
    const rest = await restoreFromCloud({ replaceLocal: true });
    console.log('restore', rest.ok, rest.message);
    if (!rest.ok) console.error('RESTORE FAIL', rest);
    expect(rest.ok, rest.message).toBe(true);
    const got = await db.get('vehicles', 'live-v1');
    expect(got?.name).toBe('LocalCar');

    // Local edit + disconnect should keep outbox
    await putVehicle(vehicle('live-v1', 'AfterDisconnect', '2026-10-12T04:00:00.000Z'));
    expect((await listOutbox()).length).toBeGreaterThan(0);
    const d = await disconnectCloud();
    console.log('disconnect', d.ok, d.message);
    expect(d.ok).toBe(true);
    expect((await listOutbox()).length).toBeGreaterThan(0);

    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: URL!,
      supabaseAnonKey: ANON!,
      email: EMAIL,
    });
    provider = new SupabaseProvider({ url: URL!, anonKey: ANON!, deviceId: 'live-smoke-a' });
    setCloudProviderForTests(provider);
    await provider.signIn(EMAIL, PASS, false);
    await verifyConnection();
    for (const item of await listOutbox()) {
      await db.put('sync_outbox', { ...item, nextRetryAt: '2020-01-01T00:00:00.000Z' });
    }
    const sync = await bidirectionalSync();
    console.log('sync', sync.ok, sync.message);
    expect(sync.ok).toBe(true);
    const pull = await provider.pullAll();
    const row = pull.rows.find((r) => r.id === 'live-v1');
    expect(row?.payload && (row.payload as Vehicle).name).toBe('AfterDisconnect');
  },
  30_000,
  );
});
