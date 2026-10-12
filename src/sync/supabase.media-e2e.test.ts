/**
 * Live M3-A media Storage E2E — disposable project ONLY.
 * Never points at production tqjowsffppgoqtdokbzp.
 *
 * SMOKE_SUPABASE_URL / SMOKE_SUPABASE_ANON required to run.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { blobToBase64 } from '../lib/image';
import type { Media } from '../types';
import { clearCloudStorageConfig, setCloudStorageConfig } from './config';
import {
  firstUploadToCloud,
  migrateCloudLegacyMedia,
  restoreFromCloud,
  runOrphanMediaCleanup,
  setCloudProviderForTests,
  verifyConnection,
} from './engine';
import { MEDIA_BUCKET } from './types';
import { SupabaseProvider } from './providers/supabase';
import { isStorageMediaPayload } from './mediaStorage';

const URL = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_SUPABASE_ANON;
const EMAIL = process.env.SMOKE_EMAIL || 'm2smoke@carcare.test';
const PASS = process.env.SMOKE_PASS;
const live = Boolean(URL && ANON);
if (live && !PASS) {
  throw new Error('SMOKE_PASS required when SMOKE_SUPABASE_URL/ANON are set (no hardcoded password)');
}

// Hard guard: refuse known production ref
const PROD_REF = 'tqjowsffppgoqtdokbzp';
if (URL && URL.includes(PROD_REF)) {
  throw new Error('Refusing to run media E2E against production Supabase project');
}

describe.skipIf(!live)('live M3-A media Storage (disposable)', () => {
  let provider: SupabaseProvider;
  let userId: string;

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
    provider = new SupabaseProvider({ url: URL!, anonKey: ANON!, deviceId: 'm3a-media-e2e' });
    setCloudProviderForTests(provider);
    const signed = await provider.signIn(EMAIL, PASS, false);
    expect(signed.ok).toBe(true);
    userId = signed.userId!;
  });

  afterEach(async () => {
    try {
      const client = provider.getClient();
      // Cleanup media rows + storage objects created by this suite
      const { data: rows } = await client
        .from('car_care_rows')
        .select('id,payload')
        .eq('entity', 'media')
        .like('id', 'm3a-%');
      const keys: string[] = [];
      for (const r of rows ?? []) {
        const k = (r.payload as { storageKey?: string } | null)?.storageKey;
        if (k) keys.push(k);
      }
      if (keys.length) await client.storage.from(MEDIA_BUCKET).remove(keys);
      await client.from('car_care_rows').delete().eq('entity', 'media').like('id', 'm3a-%');
      // Also list leftover under user prefix for m3a-
      const { data: folders } = await client.storage.from(MEDIA_BUCKET).list(userId, { limit: 100 });
      for (const f of folders ?? []) {
        if (!f.name?.startsWith('m3a-')) continue;
        const prefix = `${userId}/${f.name}`;
        const { data: files } = await client.storage.from(MEDIA_BUCKET).list(prefix, { limit: 20 });
        const paths = (files ?? []).map((x) => `${prefix}/${x.name}`);
        if (paths.length) await client.storage.from(MEDIA_BUCKET).remove(paths);
      }
    } catch {
      /* best effort */
    }
    setCloudProviderForTests(null);
    await closeDBForTests();
  });

  it(
    'upload → storage object + row without base64 → restore blob',
    async () => {
      const bytes = new Uint8Array(64);
      bytes.set([0xff, 0xd8, 0xff, 0xe0]); // jpeg-ish header
      for (let i = 4; i < 64; i++) bytes[i] = i;
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const media: Media = {
        id: 'm3a-up-1',
        mimeType: 'image/jpeg',
        byteSize: bytes.byteLength,
        createdAt: '2026-10-12T04:00:00.000Z',
        blob,
      };
      const db = await getDB();
      await db.put('media', media);

      const v = await verifyConnection();
      expect(v.ok).toBe(true);
      const up = await firstUploadToCloud();
      expect(up.ok).toBe(true);

      const client = provider.getClient();
      const { data: row, error } = await client
        .from('car_care_rows')
        .select('payload')
        .eq('entity', 'media')
        .eq('id', 'm3a-up-1')
        .single();
      expect(error).toBeNull();
      const payload = row!.payload as {
        base64?: string;
        storageKey?: string;
        schemaVersion?: number;
      };
      expect(payload.base64).toBeUndefined();
      expect(payload.storageKey).toMatch(new RegExp(`^${userId}/m3a-up-1/`));
      expect(isStorageMediaPayload(payload as never)).toBe(true);

      const { data: dl, error: dlErr } = await client.storage
        .from(MEDIA_BUCKET)
        .download(payload.storageKey!);
      expect(dlErr).toBeNull();
      expect(dl!.size).toBe(64);

      await db.clear('media');
      const rest = await restoreFromCloud({ replaceLocal: true });
      expect(rest.ok).toBe(true);
      const local = await db.get('media', 'm3a-up-1');
      expect(local?.byteSize).toBe(64);
    },
    60_000,
  );

  it(
    'progressive migrate legacy base64 row on disposable project',
    async () => {
      const bytes = new Uint8Array(48);
      for (let i = 0; i < 48; i++) bytes[i] = (i * 3) & 0xff;
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const base64 = await blobToBase64(blob);
      const client = provider.getClient();
      const { error } = await client.rpc('car_care_upsert_lww', {
        p_entity: 'media',
        p_id: 'm3a-legacy-1',
        p_payload: {
          id: 'm3a-legacy-1',
          mimeType: 'image/jpeg',
          byteSize: 48,
          createdAt: '2026-01-01T00:00:00.000Z',
          base64,
          schemaVersion: 1,
        },
        p_updated_at: '2026-01-01T00:00:00.000Z',
        p_deleted_at: null,
        p_device_id: 'm3a-seed',
      });
      expect(error).toBeNull();

      await verifyConnection();
      const mig = await migrateCloudLegacyMedia(provider);
      expect(mig.errors).toEqual([]);
      expect(mig.migrated).toBeGreaterThanOrEqual(1);

      const { data: row } = await client
        .from('car_care_rows')
        .select('payload')
        .eq('entity', 'media')
        .eq('id', 'm3a-legacy-1')
        .single();
      const payload = row!.payload as { base64?: string; storageKey?: string };
      expect(payload.base64).toBeUndefined();
      expect(payload.storageKey).toBeTruthy();

      const again = await migrateCloudLegacyMedia(provider);
      expect(again.migrated).toBe(0);
    },
    60_000,
  );

  it(
    'orphan cleanup removes unreferenced object',
    async () => {
      const store = provider.getMediaObjectStore();
      const key = `${userId}/m3a-orphan/deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef.jpg`;
      await store.uploadMediaObject({
        storageKey: key,
        body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        contentType: 'image/jpeg',
      });
      await verifyConnection();
      // Explicit cleanup with gracePeriodMs=0 (intentional orphan we just created)
      const cleaned = await runOrphanMediaCleanup(provider, { gracePeriodMs: 0 });
      expect(cleaned.aborted).toBeUndefined();
      expect(cleaned.removed).toContain(key);
    },
    60_000,
  );
});
