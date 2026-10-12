import { describe, expect, it } from 'vitest';
import {
  buildStorageKey,
  cleanupOrphanMediaObjects,
  mimeToExt,
  needsStorageMigration,
  ORPHAN_GC_DEFAULT_GRACE_MS,
  sha256Hex,
  uploadAndVerifyMedia,
} from './mediaStorage';
import { MemoryMediaObjectStore } from './providers/memory';
import { validateCloudRow } from './validatePayload';
import type { CloudMediaPayload } from './types';
import { MEDIA_SCHEMA_STORAGE } from './types';

describe('mediaStorage helpers', () => {
  it('mimeToExt maps common image types', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('image/png')).toBe('png');
    expect(mimeToExt('image/webp')).toBe('webp');
  });

  it('buildStorageKey enforces uid/mediaId/sha.ext', async () => {
    const sha = 'a'.repeat(64);
    expect(buildStorageKey('user-1', 'media-9', sha, 'image/jpeg')).toBe(
      `user-1/media-9/${sha}.jpg`,
    );
    expect(() => buildStorageKey('../x', 'm', sha, 'image/jpeg')).toThrow(/userId/);
    expect(() => buildStorageKey('u', 'm/../x', sha, 'image/jpeg')).toThrow(/mediaId/);
  });

  it('sha256Hex is stable', async () => {
    const a = await sha256Hex(new Blob([new Uint8Array([1, 2, 3])]));
    const b = await sha256Hex(new Uint8Array([1, 2, 3]));
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uploadAndVerifyMedia writes object and returns v2 payload without base64', async () => {
    const store = new MemoryMediaObjectStore();
    const blob = new Blob([new Uint8Array([10, 20, 30, 40])], { type: 'image/jpeg' });
    const media = {
      id: 'm1',
      mimeType: 'image/jpeg',
      byteSize: 4,
      createdAt: '2026-10-12T00:00:00.000Z',
      blob,
    };
    const payload = await uploadAndVerifyMedia({ store, userId: 'user-a', media });
    expect(payload.schemaVersion).toBe(MEDIA_SCHEMA_STORAGE);
    expect(payload.storageKey).toMatch(/^user-a\/m1\/[a-f0-9]{64}\.jpg$/);
    expect(payload.base64).toBeUndefined();
    expect(payload.contentSha256).toHaveLength(64);
    expect(store.objects.has(payload.storageKey!)).toBe(true);
  });

  it('dedupe upload skips body when head matches', async () => {
    const store = new MemoryMediaObjectStore();
    const blob = new Blob([new Uint8Array([9, 9])], { type: 'image/png' });
    const media = {
      id: 'm2',
      mimeType: 'image/png',
      byteSize: 2,
      createdAt: '2026-10-12T00:00:00.000Z',
      blob,
    };
    const p1 = await uploadAndVerifyMedia({ store, userId: 'u', media });
    const uploadsAfterFirst = store.uploadCount;
    const p2 = await uploadAndVerifyMedia({ store, userId: 'u', media });
    expect(p2.storageKey).toBe(p1.storageKey);
    expect(store.uploadCount).toBe(uploadsAfterFirst);
  });

  it('upload failure does not leave verified payload', async () => {
    const store = new MemoryMediaObjectStore();
    store.failNextUpload = true;
    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    await expect(
      uploadAndVerifyMedia({
        store,
        userId: 'u',
        media: {
          id: 'm3',
          mimeType: 'image/jpeg',
          byteSize: 1,
          createdAt: '2026-10-12T00:00:00.000Z',
          blob,
        },
      }),
    ).rejects.toThrow(/upload failure/);
    expect(store.objects.size).toBe(0);
  });

  it('orphan cleanup removes aged unreferenced keys only under user prefix', async () => {
    const store = new MemoryMediaObjectStore();
    await store.uploadMediaObject({
      storageKey: 'user-a/m1/aaa.bbb',
      body: new Uint8Array([1]),
      contentType: 'image/jpeg',
    });
    await store.uploadMediaObject({
      storageKey: 'user-a/m2/ccc.ddd',
      body: new Uint8Array([2]),
      contentType: 'image/jpeg',
    });
    await store.uploadMediaObject({
      storageKey: 'user-b/m9/eee.fff',
      body: new Uint8Array([3]),
      contentType: 'image/jpeg',
    });
    store.ageObject('user-a/m1/aaa.bbb', ORPHAN_GC_DEFAULT_GRACE_MS + 1000);
    store.ageObject('user-a/m2/ccc.ddd', ORPHAN_GC_DEFAULT_GRACE_MS + 1000);
    const live = new Set(['user-a/m1/aaa.bbb']);
    const { removed, aborted } = await cleanupOrphanMediaObjects({
      store,
      userId: 'user-a',
      liveStorageKeys: live,
      recheckLiveKeys: async () => live,
    });
    expect(aborted).toBeUndefined();
    expect(removed).toEqual(['user-a/m2/ccc.ddd']);
    expect(store.objects.has('user-a/m1/aaa.bbb')).toBe(true);
    expect(store.objects.has('user-b/m9/eee.fff')).toBe(true);
  });

  it('P0: refuses GC without recheckLiveKeys', async () => {
    const store = new MemoryMediaObjectStore();
    await store.uploadMediaObject({
      storageKey: 'user-a/m1/x.jpg',
      body: new Uint8Array([1]),
      contentType: 'image/jpeg',
    });
    store.ageObject('user-a/m1/x.jpg', ORPHAN_GC_DEFAULT_GRACE_MS + 1);
    const r = await cleanupOrphanMediaObjects({
      store,
      userId: 'user-a',
      liveStorageKeys: new Set(),
    });
    expect(r.aborted).toMatch(/recheckLiveKeys/);
    expect(r.removed).toEqual([]);
    expect(store.objects.has('user-a/m1/x.jpg')).toBe(true);
  });

  it('P0: aborts when list incomplete — never deletes', async () => {
    const store = new MemoryMediaObjectStore();
    await store.uploadMediaObject({
      storageKey: 'user-a/orphan/x.jpg',
      body: new Uint8Array([1]),
      contentType: 'image/jpeg',
    });
    store.ageObject('user-a/orphan/x.jpg', ORPHAN_GC_DEFAULT_GRACE_MS + 1);
    store.listIncomplete = true;
    const r = await cleanupOrphanMediaObjects({
      store,
      userId: 'user-a',
      liveStorageKeys: new Set(),
      recheckLiveKeys: async () => new Set(),
    });
    expect(r.aborted).toMatch(/incomplete/);
    expect(r.removed).toEqual([]);
    expect(store.objects.has('user-a/orphan/x.jpg')).toBe(true);
  });

  it('P0: aborts when list throws network error', async () => {
    const store = new MemoryMediaObjectStore();
    await store.uploadMediaObject({
      storageKey: 'user-a/orphan/y.jpg',
      body: new Uint8Array([1]),
      contentType: 'image/jpeg',
    });
    store.listThrows = true;
    const r = await cleanupOrphanMediaObjects({
      store,
      userId: 'user-a',
      liveStorageKeys: new Set(),
      recheckLiveKeys: async () => new Set(),
    });
    expect(r.aborted).toMatch(/list failed/);
    expect(r.removed).toEqual([]);
  });

  it('P0: grace period protects upload-not-committed race', async () => {
    const store = new MemoryMediaObjectStore();
    // A uploaded object; DB ref not committed yet → appears unreferenced
    await store.uploadMediaObject({
      storageKey: 'user-a/pending/fresh.jpg',
      body: new Uint8Array([9, 9, 9]),
      contentType: 'image/jpeg',
    });
    const r = await cleanupOrphanMediaObjects({
      store,
      userId: 'user-a',
      liveStorageKeys: new Set(), // B sees no ref
      gracePeriodMs: ORPHAN_GC_DEFAULT_GRACE_MS,
      recheckLiveKeys: async () => new Set(),
    });
    expect(r.removed).toEqual([]);
    expect(r.skippedGrace).toContain('user-a/pending/fresh.jpg');
    expect(store.objects.has('user-a/pending/fresh.jpg')).toBe(true);
  });

  it('P0: recheck skips delete if ref appears before remove', async () => {
    const store = new MemoryMediaObjectStore();
    const key = 'user-a/race/old.jpg';
    await store.uploadMediaObject({
      storageKey: key,
      body: new Uint8Array([1]),
      contentType: 'image/jpeg',
    });
    store.ageObject(key, ORPHAN_GC_DEFAULT_GRACE_MS + 5000);
    const r = await cleanupOrphanMediaObjects({
      store,
      userId: 'user-a',
      liveStorageKeys: new Set(), // first snapshot: no ref
      recheckLiveKeys: async () => new Set([key]), // ref committed before delete
    });
    expect(r.removed).toEqual([]);
    expect(r.skippedRecheck).toContain(key);
    expect(store.objects.has(key)).toBe(true);
  });

  it('needsStorageMigration detects legacy base64-only', () => {
    expect(
      needsStorageMigration({
        id: 'x',
        mimeType: 'image/jpeg',
        byteSize: 10,
        createdAt: '2026-10-12T00:00:00.000Z',
        base64: 'aaaaaaaa',
      }),
    ).toBe(true);
    expect(
      needsStorageMigration({
        id: 'x',
        mimeType: 'image/jpeg',
        byteSize: 10,
        createdAt: '2026-10-12T00:00:00.000Z',
        storageKey: 'u/x/sha.jpg',
        contentSha256: 'a'.repeat(64),
      }),
    ).toBe(false);
  });

  it('validateCloudRow accepts storageKey-only and rejects empty media', () => {
    const v2: CloudMediaPayload = {
      id: 'mid',
      mimeType: 'image/jpeg',
      byteSize: 12,
      createdAt: '2026-10-12T00:00:00.000Z',
      storageKey: 'uid/mid/ab.jpg',
      contentSha256: 'ab',
      schemaVersion: 2,
    };
    expect(
      validateCloudRow({
        entity: 'media',
        id: 'mid',
        payload: v2,
        updatedAt: '2026-10-12T00:00:00.000Z',
      }),
    ).toBeNull();

    expect(
      validateCloudRow({
        entity: 'media',
        id: 'mid',
        payload: {
          id: 'mid',
          mimeType: 'image/jpeg',
          byteSize: 1,
          createdAt: '2026-10-12T00:00:00.000Z',
        },
        updatedAt: '2026-10-12T00:00:00.000Z',
      }),
    ).toMatch(/storageKey or base64/);
  });
});
