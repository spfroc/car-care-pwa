import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { blobToBase64 } from '../lib/image';
import type { Media } from '../types';
import { clearCloudStorageConfig, setCloudStorageConfig } from './config';
import {
  bidirectionalSync,
  firstUploadToCloud,
  getSyncStatusSummary,
  migrateCloudLegacyMedia,
  restoreFromCloud,
  runOrphanMediaCleanup,
  setCloudProviderForTests,
  verifyConnection,
} from './engine';
import { MEDIA_SCHEMA_STORAGE } from './types';
import { MemoryCloudProvider } from './providers/memory';
import { patchSyncMeta } from './outbox';
import { isStorageMediaPayload, ORPHAN_GC_DEFAULT_GRACE_MS } from './mediaStorage';

function tinyJpeg(bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
}

/** ≥6 raw bytes → base64 length ≥8 (legacy detector / validator floor). */
function enoughBytes(seed: number, n = 16): number[] {
  return Array.from({ length: n }, (_, i) => (seed + i) & 0xff);
}

async function putLocalMedia(partial: Partial<Media> & { id: string; bytes: number[] }) {
  const blob = tinyJpeg(partial.bytes);
  const media: Media = {
    id: partial.id,
    mimeType: 'image/jpeg',
    byteSize: partial.bytes.length,
    createdAt: partial.createdAt ?? '2026-10-12T01:00:00.000Z',
    blob,
  };
  const db = await getDB();
  await db.put('media', media);
  return media;
}

describe('M3-A media Storage migration (memory provider)', () => {
  let provider: MemoryCloudProvider;

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
    provider = new MemoryCloudProvider();
    provider.userId = '11111111-1111-1111-1111-111111111111';
    setCloudProviderForTests(provider);
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'eyJhbGciOiJ.test',
    });
    await patchSyncMeta({ cloudUserId: provider.userId, provider: 'supabase', status: 'idle' });
  });

  afterEach(async () => {
    setCloudProviderForTests(null);
    await closeDBForTests();
  });

  it('first upload stores binary in MediaObjectStore and DB payload has no base64', async () => {
    await putLocalMedia({ id: 'media-up-1', bytes: enoughBytes(1) });
    const v = await verifyConnection();
    expect(v.ok).toBe(true);
    const up = await firstUploadToCloud();
    expect(up.ok).toBe(true);

    const row = provider.rows.get('media:media-up-1');
    expect(row).toBeTruthy();
    const p = row!.payload as { base64?: string; storageKey?: string; schemaVersion?: number };
    expect(p.base64).toBeUndefined();
    expect(p.storageKey).toMatch(
      new RegExp(`^${provider.userId}/media-up-1/[a-f0-9]{64}\\.jpg$`),
    );
    expect(p.schemaVersion).toBe(MEDIA_SCHEMA_STORAGE);
    expect(provider.mediaStore.objects.has(p.storageKey!)).toBe(true);
  });

  it('restore downloads Storage object into IndexedDB blob', async () => {
    await putLocalMedia({ id: 'media-r1', bytes: enoughBytes(7) });
    await verifyConnection();
    await firstUploadToCloud();

    const db = await getDB();
    await db.clear('media');
    expect(await db.count('media')).toBe(0);

    const rest = await restoreFromCloud({ replaceLocal: true });
    expect(rest.ok).toBe(true);
    const local = await db.get('media', 'media-r1');
    expect(local).toBeTruthy();
    expect(local!.byteSize).toBe(16);
    const buf = new Uint8Array(await local!.blob.arrayBuffer());
    expect([...buf]).toEqual(enoughBytes(7));
  });

  it('upload fail keeps outbox / does not write media row', async () => {
    await putLocalMedia({ id: 'media-fail', bytes: enoughBytes(1, 16) });
    await verifyConnection();
    provider.mediaStore.failNextUpload = true;
    const up = await firstUploadToCloud();
    expect(up.ok).toBe(false);
    expect(provider.rows.has('media:media-fail')).toBe(false);
  });

  it('progressive migrate: legacy base64 row → storageKey, idempotent', async () => {
    const bytes = enoughBytes(11);
    const blob = tinyJpeg(bytes);
    const base64 = await blobToBase64(blob);
    provider.rows.set('media:legacy-1', {
      entity: 'media',
      id: 'legacy-1',
      payload: {
        id: 'legacy-1',
        mimeType: 'image/jpeg',
        byteSize: bytes.length,
        createdAt: '2026-01-01T00:00:00.000Z',
        base64,
        schemaVersion: 1,
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    });

    await verifyConnection();
    const first = await migrateCloudLegacyMedia(provider);
    expect(first.migrated).toBe(1);
    expect(first.unmigrated).toBe(0);
    expect(first.ok).toBe(true);

    const row = provider.rows.get('media:legacy-1')!;
    const p = row.payload as { base64?: string; storageKey?: string };
    expect(isStorageMediaPayload(p as never)).toBe(true);
    expect(p.base64).toBeUndefined();
    expect(provider.mediaStore.objects.has(p.storageKey!)).toBe(true);

    const second = await migrateCloudLegacyMedia(provider);
    expect(second.migrated).toBe(0);
    expect(second.ok).toBe(true);
    expect(second.unmigrated).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
  });

  it('interrupted migrate: object exists, row still base64 → recover on retry', async () => {
    const bytes = enoughBytes(4);
    const blob = tinyJpeg(bytes);
    const base64 = await blobToBase64(blob);
    const legacyPayload = {
      id: 'legacy-2',
      mimeType: 'image/jpeg',
      byteSize: bytes.length,
      createdAt: '2026-01-01T00:00:00.000Z',
      base64,
      schemaVersion: 1,
    };
    provider.rows.set('media:legacy-2', {
      entity: 'media',
      id: 'legacy-2',
      payload: legacyPayload,
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    });

    // Simulate orphan object already uploaded (upload ok, row switch failed)
    const { uploadAndVerifyMedia } = await import('./mediaStorage');
    const tmp = await uploadAndVerifyMedia({
      store: provider.mediaStore,
      userId: provider.userId,
      media: {
        id: 'legacy-2',
        mimeType: 'image/jpeg',
        byteSize: bytes.length,
        createdAt: legacyPayload.createdAt,
        blob,
      },
    });
    expect(provider.mediaStore.objects.has(tmp.storageKey!)).toBe(true);
    // Row still legacy
    expect((provider.rows.get('media:legacy-2')!.payload as { base64?: string }).base64).toBeTruthy();

    await verifyConnection();
    const result = await migrateCloudLegacyMedia(provider);
    expect(result.migrated).toBe(1);
    expect(result.ok).toBe(true);
    const after = provider.rows.get('media:legacy-2')!.payload as {
      base64?: string;
      storageKey?: string;
    };
    expect(after.base64).toBeUndefined();
    expect(after.storageKey).toBe(tmp.storageKey);
  });

  it('delete tombstone + explicit orphan cleanup removes aged storage object', async () => {
    await putLocalMedia({ id: 'media-del', bytes: enoughBytes(9) });
    await verifyConnection();
    await firstUploadToCloud();
    const key = (provider.rows.get('media:media-del')!.payload as { storageKey: string }).storageKey;
    expect(provider.mediaStore.objects.has(key)).toBe(true);

    // Tombstone
    await provider.pushOps([
      {
        opId: 'del-1',
        entity: 'media',
        entityId: 'media-del',
        op: 'delete',
        mutatedAt: '2026-10-12T12:00:00.000Z',
        attempts: 0,
        nextRetryAt: '2026-10-12T12:00:00.000Z',
      },
    ]);
    expect(provider.rows.get('media:media-del')!.deletedAt).toBeTruthy();

    // Explicit cleanup after grace (not auto during sync)
    provider.mediaStore.ageObject(key, ORPHAN_GC_DEFAULT_GRACE_MS + 1000);
    const cleaned = await runOrphanMediaCleanup(provider);
    expect(cleaned.aborted).toBeUndefined();
    expect(cleaned.removed).toContain(key);
    expect(provider.mediaStore.objects.has(key)).toBe(false);
  });

  it('legacy base64-only provider (no MediaObjectStore) still works', async () => {
    provider.enableMediaStore = false;
    await putLocalMedia({ id: 'media-m2', bytes: enoughBytes(3) });
    await verifyConnection();
    const up = await firstUploadToCloud();
    expect(up.ok).toBe(true);
    const p = provider.rows.get('media:media-m2')!.payload as { base64?: string; storageKey?: string };
    expect(p.base64).toBeTruthy();
    expect(p.storageKey).toBeUndefined();

    const db = await getDB();
    await db.clear('media');
    const rest = await restoreFromCloud({ replaceLocal: true });
    expect(rest.ok).toBe(true);
    const local = await db.get('media', 'media-m2');
    expect(local?.byteSize).toBe(16);
  });

  it('bidirectional sync push uses Storage when available', async () => {
    await verifyConnection();
    const db = await getDB();
    const media = await putLocalMedia({ id: 'media-sync', bytes: enoughBytes(1) });
    // Enqueue outbox manually like repository would
    const { makeOutboxItem, putOutboxInTx, settleTx, stampOutboxOwner } = await import('./outbox');
    const item = await stampOutboxOwner(
      makeOutboxItem({
        entity: 'media',
        entityId: media.id,
        op: 'upsert',
        mutatedAt: media.createdAt,
      }),
    );
    const tx = db.transaction(['sync_outbox'], 'readwrite');
    await settleTx(tx, async () => {
      await putOutboxInTx(tx, item);
    });

    const sync = await bidirectionalSync();
    expect(sync.ok).toBe(true);
    const p = provider.rows.get('media:media-sync')!.payload as { storageKey?: string; base64?: string };
    expect(p.storageKey).toBeTruthy();
    expect(p.base64).toBeUndefined();
  });

  it('P0: A upload-not-committed vs B cleanup — no false delete', async () => {
    await verifyConnection();
    // Device A: uploaded Storage object; DB row ref NOT committed yet
    const key = `${provider.userId}/m3a-race/pending.jpg`;
    await provider.mediaStore.uploadMediaObject({
      storageKey: key,
      body: new Uint8Array(enoughBytes(42)),
      contentType: 'image/jpeg',
    });
    expect(provider.rows.has('media:m3a-race')).toBe(false);

    // Device B: sync must NOT auto-GC; explicit cleanup must spare fresh object
    const sync = await bidirectionalSync();
    expect(provider.mediaStore.objects.has(key)).toBe(true);

    const cleaned = await runOrphanMediaCleanup(provider);
    expect(cleaned.removed).not.toContain(key);
    expect(cleaned.skippedGrace.length + (cleaned.aborted ? 1 : 0)).toBeGreaterThan(0);
    expect(provider.mediaStore.objects.has(key)).toBe(true);

    // After grace + still no ref → explicit cleanup may remove
    provider.mediaStore.ageObject(key, ORPHAN_GC_DEFAULT_GRACE_MS + 2000);
    const aged = await runOrphanMediaCleanup(provider);
    expect(aged.removed).toContain(key);
    void sync;
  });

  it('P0: sync does not call orphan GC (object without ref survives sync)', async () => {
    await verifyConnection();
    const key = `${provider.userId}/no-auto-gc/x.jpg`;
    await provider.mediaStore.uploadMediaObject({
      storageKey: key,
      body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      contentType: 'image/jpeg',
    });
    // Age past grace — if sync auto-GC'd it would delete; must survive
    provider.mediaStore.ageObject(key, ORPHAN_GC_DEFAULT_GRACE_MS + 5000);
    await bidirectionalSync();
    expect(provider.mediaStore.objects.has(key)).toBe(true);
  });

  it('P1: partial migrate success/fail among multiple images; base64 kept; sync surfaces error', async () => {
    const makeLegacy = async (id: string, seed: number) => {
      const bytes = enoughBytes(seed);
      const blob = tinyJpeg(bytes);
      const base64 = await blobToBase64(blob);
      provider.rows.set(`media:${id}`, {
        entity: 'media',
        id,
        payload: {
          id,
          mimeType: 'image/jpeg',
          byteSize: bytes.length,
          createdAt: '2026-01-01T00:00:00.000Z',
          base64,
          schemaVersion: 1,
        },
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
      });
    };
    await makeLegacy('legacy-ok', 10);
    await makeLegacy('legacy-fail', 20);
    await makeLegacy('legacy-ok2', 30);

    await verifyConnection();
    // Fail only the first upload attempt (legacy-fail is processed in map order — control via failNextUpload)
    // Order of Map iteration is insertion order: legacy-ok, legacy-fail, legacy-ok2
    // Make upload fail when storageKey contains legacy-fail by wrapping upload
    const orig = provider.mediaStore.uploadMediaObject.bind(provider.mediaStore);
    provider.mediaStore.uploadMediaObject = async (opts) => {
      if (opts.storageKey.includes('/legacy-fail/')) {
        throw new Error('simulated migrate upload fail for legacy-fail');
      }
      return orig(opts);
    };

    const mig = await migrateCloudLegacyMedia(provider);
    expect(mig.migrated).toBe(2);
    expect(mig.failed).toBe(1);
    expect(mig.unmigrated).toBe(1);
    expect(mig.ok).toBe(false);
    expect(mig.errors.some((e) => e.includes('legacy-fail'))).toBe(true);

    // Failed row keeps M2 base64
    const failedPayload = provider.rows.get('media:legacy-fail')!.payload as {
      base64?: string;
      storageKey?: string;
    };
    expect(failedPayload.base64).toBeTruthy();
    expect(failedPayload.storageKey).toBeUndefined();

    // Successful ones switched
    expect(
      (provider.rows.get('media:legacy-ok')!.payload as { storageKey?: string }).storageKey,
    ).toBeTruthy();
    expect(
      (provider.rows.get('media:legacy-ok2')!.payload as { base64?: string }).base64,
    ).toBeUndefined();

    // Sync surfaces migrate failure for retry path
    provider.mediaStore.uploadMediaObject = orig; // restore — retry should succeed
    const sync = await bidirectionalSync();
    expect(sync.mediaMigrate).toBeTruthy();
    // After retry with working upload, should complete
    expect(sync.mediaMigrate!.ok).toBe(true);
    expect(sync.mediaMigrate!.unmigrated).toBe(0);
    expect(sync.message).not.toMatch(/待重试/);
    const status = await getSyncStatusSummary();
    expect(status.meta.status).toBe('idle');

    // Retry preserved data: previously failed now migrated
    const after = provider.rows.get('media:legacy-fail')!.payload as {
      base64?: string;
      storageKey?: string;
    };
    expect(after.storageKey).toBeTruthy();
    expect(after.base64).toBeUndefined();
  });

  it('P1: sync message reports unmigrated when migrate still failing', async () => {
    const bytes = enoughBytes(55);
    const blob = tinyJpeg(bytes);
    const base64 = await blobToBase64(blob);
    provider.rows.set('media:legacy-stuck', {
      entity: 'media',
      id: 'legacy-stuck',
      payload: {
        id: 'legacy-stuck',
        mimeType: 'image/jpeg',
        byteSize: bytes.length,
        createdAt: '2026-01-01T00:00:00.000Z',
        base64,
        schemaVersion: 1,
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    });
    await verifyConnection();
    provider.mediaStore.failNextUpload = true;
    // Also fail subsequent uploads during sync migrate
    const orig = provider.mediaStore.uploadMediaObject.bind(provider.mediaStore);
    let blows = 0;
    provider.mediaStore.uploadMediaObject = async (opts) => {
      blows += 1;
      throw new Error(`persist fail ${blows}`);
    };

    const sync = await bidirectionalSync();
    expect(sync.ok).toBe(false);
    expect(sync.mediaMigrate?.unmigrated).toBe(1);
    expect(sync.message).toMatch(/媒体迁移/);
    expect(sync.message).toMatch(/待迁移|失败|重试/);
    const stuck = provider.rows.get('media:legacy-stuck')!.payload as { base64?: string };
    expect(stuck.base64).toBeTruthy();

    const status = await getSyncStatusSummary();
    expect(status.meta.status).toBe('error');
    expect(status.meta.lastError).toMatch(/媒体迁移待重试/);

    provider.mediaStore.uploadMediaObject = orig;
  });

});
