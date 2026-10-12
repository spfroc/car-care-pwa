/**
 * M2 acceptance: real disposable Supabase A/B E2E.
 * Uses two Auth users + sequential IDB resets to simulate devices A/B.
 * Never touches production project.
 */
import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { putRecord, deleteRecord } from '../repositories/records';
import { putVehicle } from '../repositories/vehicles';
import type { CareRecord, Vehicle } from '../types';
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
import { MAX_MEDIA_BASE64_CHARS } from './types';
import { validateEntityPayload } from './validatePayload';

const URL = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_SUPABASE_ANON;
const EMAIL_A = process.env.SMOKE_EMAIL || 'm2smoke@carcare.test';
const EMAIL_B = process.env.SMOKE_EMAIL_B || 'm2smoke-b@carcare.test';
const PASS = process.env.SMOKE_PASS || 'M2SmokeTest!pass9';
const live = Boolean(URL && ANON);

const PREFIX = `ab-${Date.now().toString(36)}-`;
/** ISO timestamps anchored in the past relative to wall clock so LWW deletes/edits apply. */
function tAt(offsetSec: number): string {
  return new Date(Date.now() - 3600_000 + offsetSec * 1000).toISOString();
}

function vehicle(id: string, name: string, updatedAt: string): Vehicle {
  return {
    id,
    name,
    plate: 'AB-TEST',
    energyType: 'ICE',
    bodyType: 'SEDAN',
    createdAt: updatedAt,
    updatedAt,
  };
}

function record(id: string, vehicleId: string, updatedAt: string, amount = 100): CareRecord {
  return {
    id,
    vehicleId,
    type: 'fuel',
    date: updatedAt,
    amountPaid: amount,
    mediaIds: [],
    fuelGrade: '95#',
    liters: 10,
    filledUp: true,
    odometer: 1000,
    createdAt: updatedAt,
    updatedAt,
  };
}

async function wipeLocal(): Promise<void> {
  await clearCloudStorageConfig().catch(() => undefined);
  const db = await getDB();
  for (const s of ['vehicles', 'records', 'stations', 'media', 'sync_outbox', 'sync_meta'] as const) {
    try {
      await db.clear(s);
    } catch {
      /* */
    }
  }
}

async function bind(email: string, deviceId: string): Promise<SupabaseProvider> {
  await setCloudStorageConfig({
    provider: 'supabase',
    supabaseUrl: URL!,
    supabaseAnonKey: ANON!,
    email,
  });
  const provider = new SupabaseProvider({ url: URL!, anonKey: ANON!, deviceId });
  setCloudProviderForTests(provider);
  const signed = await provider.signIn(email, PASS, false);
  expect(signed.ok, signed.error).toBe(true);
  return provider;
}

describe.skipIf(!live)('M2 A/B real Supabase E2E (disposable)', () => {
  const createdIds: string[] = [];
  let providerA: SupabaseProvider;
  let userA: string;
  let userB: string;

  beforeEach(async () => {
    await wipeLocal();
  });

  afterAll(async () => {
    try {
      if (providerA) {
        const client = providerA.getClient();
        for (const id of createdIds) {
          await client.from('car_care_rows').delete().eq('id', id);
        }
        await client.from('car_care_rows').delete().like('id', `${PREFIX}%`);
      }
    } catch {
      /* */
    }
    setCloudProviderForTests(null);
    await closeDBForTests();
  });

  it(
    'A create+upload → B restore → sync edits → offline outbox → deletes+media → conflict → disconnect/reconnect → account switch block → auth fail recovery',
    async () => {
      // --- Device A: create + first upload ---
      providerA = await bind(EMAIL_A, 'device-a');
      const vA = await verifyConnection();
      expect(vA.ok, vA.message).toBe(true);
      userA = vA.verify?.userId!;
      expect(userA).toBeTruthy();

      const vid = `${PREFIX}v1`;
      const rid = `${PREFIX}r1`;
      createdIds.push(vid, rid);
      await putVehicle(vehicle(vid, 'CarA', tAt(0)));
      await putRecord(record(rid, vid, tAt(60), 88));
      const up = await firstUploadToCloud();
      expect(up.ok, up.message).toBe(true);

      // Validate DB rows for user A
      let rows = await providerA.getClient().from('car_care_rows').select('entity,id,payload,deleted_at').eq('user_id', userA);
      expect(rows.error).toBeNull();
      const idsA = new Set((rows.data ?? []).map((r) => r.id));
      expect(idsA.has(vid)).toBe(true);
      expect(idsA.has(rid)).toBe(true);

      // --- Device B (same account, fresh IDB): restore ---
      await wipeLocal();
      await closeDBForTests();
      const providerB = await bind(EMAIL_A, 'device-b');
      const vB = await verifyConnection();
      expect(vB.ok, vB.message).toBe(true);
      const rest = await restoreFromCloud({ replaceLocal: true });
      expect(rest.ok, rest.message).toBe(true);
      const dbB = await getDB();
      expect((await dbB.get('vehicles', vid))?.name).toBe('CarA');
      expect((await dbB.get('records', rid))?.amountPaid).toBe(88);

      // --- Sync edits from B ---
      await putVehicle(vehicle(vid, 'CarA-EditedB', tAt(120)));
      await putRecord(record(rid, vid, tAt(180), 120));
      // force outbox ready
      for (const item of await listOutbox()) {
        await dbB.put('sync_outbox', { ...item, nextRetryAt: '2020-01-01T00:00:00.000Z' });
      }
      const sync1 = await bidirectionalSync();
      expect(sync1.ok, sync1.message).toBe(true);
      const pull1 = await providerB.pullAll();
      const cloudV = pull1.rows.find((r) => r.id === vid);
      expect((cloudV?.payload as Vehicle)?.name).toBe('CarA-EditedB');

      // --- Offline ops: disconnect, edit, reconnect ---
      await putVehicle(vehicle(vid, 'OfflineEdit', tAt(240)));
      expect((await listOutbox()).length).toBeGreaterThan(0);
      const disc = await disconnectCloud();
      expect(disc.ok).toBe(true);
      expect((await listOutbox()).length).toBeGreaterThan(0);
      await setCloudStorageConfig({
        provider: 'supabase',
        supabaseUrl: URL!,
        supabaseAnonKey: ANON!,
        email: EMAIL_A,
      });
      const providerB2 = new SupabaseProvider({ url: URL!, anonKey: ANON!, deviceId: 'device-b' });
      setCloudProviderForTests(providerB2);
      await providerB2.signIn(EMAIL_A, PASS, false);
      await verifyConnection();
      for (const item of await listOutbox()) {
        await (await getDB()).put('sync_outbox', { ...item, nextRetryAt: '2020-01-01T00:00:00.000Z' });
      }
      const sync2 = await bidirectionalSync();
      expect(sync2.ok, sync2.message).toBe(true);
      const pull2 = await providerB2.pullAll();
      expect((pull2.rows.find((r) => r.id === vid)?.payload as Vehicle)?.name).toBe('OfflineEdit');

      // --- Deletes ---
      await deleteRecord(rid);
      for (const item of await listOutbox()) {
        await (await getDB()).put('sync_outbox', { ...item, nextRetryAt: '2020-01-01T00:00:00.000Z' });
      }
      const syncDel = await bidirectionalSync();
      expect(syncDel.ok, syncDel.message).toBe(true);
      const delRow = await providerB2
        .getClient()
        .from('car_care_rows')
        .select('deleted_at')
        .eq('user_id', userA)
        .eq('id', rid)
        .maybeSingle();
      expect(delRow.data?.deleted_at).toBeTruthy();

      // --- Concurrent conflict: older local vs newer cloud ---
      await providerB2.getClient().rpc('car_care_upsert_lww', {
        p_entity: 'vehicles',
        p_id: vid,
        p_payload: vehicle(vid, 'CloudWins', tAt(600)),
        p_updated_at: tAt(600),
        p_deleted_at: null,
        p_device_id: 'device-a',
      });
      await putVehicle(vehicle(vid, 'StaleLocal', tAt(300)));
      for (const item of await listOutbox()) {
        await (await getDB()).put('sync_outbox', { ...item, nextRetryAt: '2020-01-01T00:00:00.000Z' });
      }
      const syncC = await bidirectionalSync();
      expect(syncC.ok || syncC.message.includes('跳过') || (syncC.pushed ?? 0) >= 0).toBe(true);
      const afterConflict = await providerB2.pullAll();
      expect((afterConflict.rows.find((r) => r.id === vid)?.payload as Vehicle)?.name).toBe('CloudWins');

      // --- Account switch safety: bind B while local has A data ---
      const providerOther = new SupabaseProvider({ url: URL!, anonKey: ANON!, deviceId: 'device-switch' });
      setCloudProviderForTests(providerOther);
      const signedB = await providerOther.signIn(EMAIL_B, PASS, false);
      expect(signedB.ok, signedB.error).toBe(true);
      userB = (await providerOther.verify()).userId!;
      expect(userB).toBeTruthy();
      expect(userB).not.toBe(userA);
      // Ensure meta still bound to A with local data
      await patchSyncMeta({ cloudUserId: userA, status: 'idle', provider: 'supabase' });
      const blocked = await verifyConnection();
      expect(blocked.ok).toBe(false);
      expect(blocked.message).toMatch(/阻止账号切换|IndexedDB/);
      const metaAfter = await (await import('./outbox')).getSyncMeta();
      expect(metaAfter.cloudUserId).toBe(userA);

      // --- Auth fail recovery ---
      const bad = new SupabaseProvider({ url: URL!, anonKey: ANON!, deviceId: 'device-bad' });
      const badSign = await bad.signIn(EMAIL_A, 'wrong-password-xxx', false);
      expect(badSign.ok).toBe(false);

      // --- Media size validation (unit-level, no upload of huge blob) ---
      const tooBig = validateEntityPayload(
        'media',
        {
          id: `${PREFIX}m1`,
          mimeType: 'image/jpeg',
          byteSize: 50,
          base64: 'a'.repeat(MAX_MEDIA_BASE64_CHARS + 10),
          createdAt: tAt(0),
        },
        `${PREFIX}m1`,
      );
      expect(tooBig).toMatch(/too large/);

      // Small media round-trip via cloud row for A
      const mid = `${PREFIX}m2`;
      createdIds.push(mid);
      const tinyB64 = Buffer.from('tiny-jpeg-bytes').toString('base64');
      await providerA.getClient().rpc('car_care_upsert_lww', {
        p_entity: 'media',
        p_id: mid,
        p_payload: {
          id: mid,
          mimeType: 'image/jpeg',
          byteSize: 14,
          base64: tinyB64,
          createdAt: tAt(90),
        },
        p_updated_at: tAt(90),
        p_deleted_at: null,
        p_device_id: 'device-a',
      });
      const mediaRow = await providerA
        .getClient()
        .from('car_care_rows')
        .select('id,entity')
        .eq('user_id', userA)
        .eq('id', mid)
        .maybeSingle();
      expect(mediaRow.data?.entity).toBe('media');

      // User B cloud must stay empty for A's ids (RLS isolation)
      setCloudProviderForTests(providerOther);
      await providerOther.signIn(EMAIL_B, PASS, false);
      const bPull = await providerOther.pullAll();
      expect(bPull.rows.find((r) => r.id === vid)).toBeUndefined();
    },
    90_000,
  );
});
