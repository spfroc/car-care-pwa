import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { blobToBase64 } from '../lib/image';
import type { Media } from '../types';
import { clearCloudStorageConfig, setCloudStorageConfig } from './config';
import {
  bidirectionalSync,
  firstUploadToCloud,
  migrateCloudLegacyMedia,
  restoreFromCloud,
  runOrphanMediaCleanup,
  setCloudProviderForTests,
  verifyConnection,
} from './engine';
import { MEDIA_SCHEMA_STORAGE } from './types';
import { MemoryCloudProvider } from './providers/memory';
import { patchSyncMeta } from './outbox';
import { isStorageMediaPayload } from './mediaStorage';

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
    expect(first.errors).toEqual([]);

    const row = provider.rows.get('media:legacy-1')!;
    const p = row.payload as { base64?: string; storageKey?: string };
    expect(isStorageMediaPayload(p as never)).toBe(true);
    expect(p.base64).toBeUndefined();
    expect(provider.mediaStore.objects.has(p.storageKey!)).toBe(true);

    const second = await migrateCloudLegacyMedia(provider);
    expect(second.migrated).toBe(0);
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
    const after = provider.rows.get('media:legacy-2')!.payload as {
      base64?: string;
      storageKey?: string;
    };
    expect(after.base64).toBeUndefined();
    expect(after.storageKey).toBe(tmp.storageKey);
  });

  it('delete tombstone + orphan cleanup removes storage object', async () => {
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

    const cleaned = await runOrphanMediaCleanup(provider);
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
});
