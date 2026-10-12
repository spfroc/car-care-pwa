import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { Vehicle } from '../types';
import { setCloudStorageConfig } from './config';
import {
  bidirectionalSync,
  firstUploadToCloud,
  migrateCloudLegacyMedia,
  restoreFromCloud,
  setCloudProviderForTests,
  verifyConnection,
} from './engine';
import { getSyncMeta, listOutbox, patchSyncMeta, putOutboxItem } from './outbox';
import { MemoryCloudProvider } from './providers/memory';
import { putVehicle } from '../repositories/vehicles';
import {
  clearLeaseForTests,
  resetTabLockForTests,
  setSyncLockSessionForTests,
  SyncLeaseLostError,
  SyncLockSession,
} from './tabLock';
import { blobToBase64 } from '../lib/image';
import { uploadAndVerifyMedia } from './mediaStorage';

async function reset() {
  setCloudProviderForTests(null);
  await closeDBForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('car-care-db');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function vehicle(id: string, name: string, updatedAt: string): Vehicle {
  return {
    id,
    name,
    energyType: 'ICE',
    bodyType: 'SEDAN',
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('sync engine with memory provider', () => {
  let mem: MemoryCloudProvider;

  beforeEach(async () => {
    await reset();
    mem = new MemoryCloudProvider();
    setCloudProviderForTests(mem);
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'test-anon-key',
    });
  });

  afterEach(async () => {
    setCloudProviderForTests(null);
    await closeDBForTests();
  });

  it('verify does not mutate local data', async () => {
    const ts = nowISO();
    await putVehicle(vehicle('v1', 'Local', ts));
    const before = await (await getDB()).getAll('vehicles');
    const r = await verifyConnection();
    expect(r.ok).toBe(true);
    const after = await (await getDB()).getAll('vehicles');
    expect(after).toEqual(before);
  });

  it('first upload pushes local without pulling overwrite', async () => {
    const ts = '2026-01-01T00:00:00.000Z';
    await putVehicle(vehicle('v1', 'A', ts));
    // Seed cloud with different vehicle that must NOT appear locally after upload
    mem.rows.set('vehicles:cloud-only', {
      entity: 'vehicles',
      id: 'cloud-only',
      payload: vehicle('cloud-only', 'Cloud', '2026-02-01T00:00:00.000Z'),
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    });
    const r = await firstUploadToCloud();
    expect(r.ok).toBe(true);
    expect(mem.rows.has('vehicles:v1')).toBe(true);
    const local = await (await getDB()).getAll('vehicles');
    expect(local.map((v) => v.id).sort()).toEqual(['v1']);
  });

  it('restore merges newer cloud into local', async () => {
    await putVehicle(vehicle('v1', 'Old', '2026-01-01T00:00:00.000Z'));
    // Clear outbox so restore can apply (pending local ops intentionally block)
    await (await getDB()).clear('sync_outbox');
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'New', '2026-02-01T00:00:00.000Z'),
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    });
    const r = await restoreFromCloud();
    expect(r.ok).toBe(true);
    const v = await (await getDB()).get('vehicles', 'v1');
    expect(v?.name).toBe('New');
  });

  it('restore does not overwrite when pending outbox exists', async () => {
    await putVehicle(vehicle('v1', 'LocalPending', '2026-01-05T00:00:00.000Z'));
    await putOutboxItem({
      opId: 'op1',
      entity: 'vehicles',
      entityId: 'v1',
      op: 'upsert',
      payload: vehicle('v1', 'LocalPending', '2026-01-05T00:00:00.000Z'),
      mutatedAt: '2026-01-05T00:00:00.000Z',
      attempts: 0,
      nextRetryAt: '2026-01-05T00:00:00.000Z',
    });
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudNewer', '2026-03-01T00:00:00.000Z'),
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
    });
    const r = await restoreFromCloud();
    expect(r.ok).toBe(true);
    const v = await (await getDB()).get('vehicles', 'v1');
    expect(v?.name).toBe('LocalPending');
    expect(r.merge?.skippedPendingLocal).toBeGreaterThan(0);
  });

  it('bidirectional push then pull with LWW', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-10T00:00:00.000Z'));
    // outbox from putVehicle should exist because config is set
    const box = await listOutbox();
    expect(box.some((o) => o.entityId === 'v1')).toBe(true);

    mem.rows.set('vehicles:v2', {
      entity: 'vehicles',
      id: 'v2',
      payload: vehicle('v2', 'FromCloud', '2026-01-11T00:00:00.000Z'),
      updatedAt: '2026-01-11T00:00:00.000Z',
      deletedAt: null,
    });

    const r = await bidirectionalSync();
    expect(r.ok).toBe(true);
    expect(mem.rows.has('vehicles:v1')).toBe(true);
    const v2 = await (await getDB()).get('vehicles', 'v2');
    expect(v2?.name).toBe('FromCloud');
    const meta = await getSyncMeta();
    expect(meta.lastSuccessAt).toBeTruthy();
    expect(meta.status).toBe('idle');
  });

  it('push failure keeps outbox and sets error', async () => {
    await putVehicle(vehicle('v1', 'X', '2026-01-01T00:00:00.000Z'));
    mem.failNextPush = true;
    // Force ready outbox only
    const r = await bidirectionalSync();
    expect(r.ok).toBe(false);
    const box = await listOutbox();
    expect(box.length).toBeGreaterThan(0);
    expect(box.some((o) => (o.attempts ?? 0) >= 1 || o.lastError)).toBe(true);
    const meta = await getSyncMeta();
    expect(meta.status).toBe('error');
  });

  it('applies cloud delete when newer', async () => {
    await putVehicle(vehicle('v1', 'Gone', '2026-01-01T00:00:00.000Z'));
    // clear outbox so merge applies
    const db = await getDB();
    await db.clear('sync_outbox');
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: {},
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: '2026-02-01T00:00:00.000Z',
    });
    const r = await restoreFromCloud();
    expect(r.ok).toBe(true);
    const v = await (await getDB()).get('vehicles', 'v1');
    expect(v).toBeUndefined();
  });

  it('rejects service_role in config', async () => {
    await expect(
      setCloudStorageConfig({
        provider: 'supabase',
        supabaseUrl: 'https://x.supabase.co',
        supabaseAnonKey: 'service_role_secret_key_value',
      }),
    ).rejects.toThrow(/service_role/);
  });
});

describe('P0 lease-lost aborts sync side effects', () => {
  let mem: MemoryCloudProvider;

  beforeEach(async () => {
    await reset();
    resetTabLockForTests();
    await clearLeaseForTests();
    vi.stubGlobal('navigator', { locks: undefined, onLine: true });
    mem = new MemoryCloudProvider();
    setCloudProviderForTests(mem);
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'test-anon-key',
    });
  });

  afterEach(() => {
    setSyncLockSessionForTests(null);
    resetTabLockForTests();
    vi.unstubAllGlobals();
  });

  it('A mid-push lease stolen by B → outbox NOT deleted (uncertain push)', async () => {
    await putVehicle(vehicle('v-abort', 'AbortMe', '2026-01-10T00:00:00.000Z'));
    const before = await listOutbox();
    expect(before.some((o) => o.entityId === 'v-abort')).toBe(true);

    let releasePush!: () => void;
    mem.pushGate = new Promise<void>((r) => {
      releasePush = r;
    });

    setSyncLockSessionForTests(new SyncLockSession('engine-A', { renewMs: 25 }));
    const syncP = bidirectionalSync();

    // Wait until pushOps entered the gate
    for (let i = 0; i < 50 && mem.pushCallCount < 1; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(mem.pushCallCount).toBeGreaterThanOrEqual(1);

    const tabB = new SyncLockSession('engine-B');
    const db = await getDB();
    await db.put('sync_meta', {
      key: 'syncTabLease',
      value: { holderId: 'engine-A', expiresAt: Date.now() - 1 },
    });
    expect(await tabB.tryAcquireIdbLease()).toBe(true);

    // Allow renew timer to abort A
    await new Promise((r) => setTimeout(r, 80));
    releasePush();

    const r = await syncP;
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/不确定|接管|中止/);
    const after = await listOutbox();
    expect(after.some((o) => o.entityId === 'v-abort')).toBe(true);
    await tabB.releaseIdbLease();
  });

  it('A loses lease mid image download → no local merge', async () => {
    mem.userId = 'user-dl-abort';
    await patchSyncMeta({ cloudUserId: mem.userId, provider: 'supabase', status: 'idle' });

    const bytes = new Uint8Array(Array.from({ length: 16 }, (_, i) => i + 1));
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const payload = await uploadAndVerifyMedia({
      store: mem.mediaStore,
      userId: mem.userId,
      media: {
        id: 'm-dl',
        mimeType: 'image/jpeg',
        byteSize: bytes.byteLength,
        createdAt: '2026-01-01T00:00:00.000Z',
        blob,
      },
    });
    mem.rows.set('media:m-dl', {
      entity: 'media',
      id: 'm-dl',
      payload,
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    });

    const downloadBaseline = mem.mediaStore.downloadCount; // setup verify may have downloaded
    let releaseDl!: () => void;
    mem.mediaStore.downloadGate = new Promise<void>((r) => {
      releaseDl = r;
    });

    setSyncLockSessionForTests(new SyncLockSession('dl-A', { renewMs: 25 }));
    const restoreP = restoreFromCloud();

    for (let i = 0; i < 100 && mem.mediaStore.downloadCount <= downloadBaseline; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(mem.mediaStore.downloadCount).toBeGreaterThan(downloadBaseline);

    // Steal lease with a live foreign holder so A's renew cannot refresh it
    const db = await getDB();
    await db.put('sync_meta', {
      key: 'syncTabLease',
      value: { holderId: 'dl-B', expiresAt: Date.now() + 60_000 },
    });
    // Wait for A's renew timer to observe lost → abort signal
    await new Promise((r) => setTimeout(r, 80));
    releaseDl();

    const r = await restoreP;
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/不确定|接管|中止/);
    expect(await db.get('media', 'm-dl')).toBeUndefined();
  });

  it('A loses lease mid migrate → no next image', async () => {
    mem.userId = 'user-mig-abort';
    for (const [id, seed] of [
      ['leg-a', 21],
      ['leg-b', 42],
    ] as const) {
      const raw = Uint8Array.from({ length: 16 }, (_, i) => (seed + i) & 0xff);
      const blob = new Blob([raw], { type: 'image/jpeg' });
      const base64 = await blobToBase64(blob);
      mem.rows.set(`media:${id}`, {
        entity: 'media',
        id,
        payload: {
          id,
          mimeType: 'image/jpeg',
          byteSize: raw.byteLength,
          createdAt: '2026-01-01T00:00:00.000Z',
          base64,
          schemaVersion: 1,
        },
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
      });
    }

    let releaseUp!: () => void;
    mem.mediaStore.uploadGate = new Promise<void>((r) => {
      releaseUp = r;
    });
    const ac = new AbortController();
    const migP = migrateCloudLegacyMedia(mem, ac.signal);

    for (let i = 0; i < 80 && mem.mediaStore.uploadCount < 1; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(mem.mediaStore.uploadCount).toBe(1);

    ac.abort(new SyncLeaseLostError());
    releaseUp();

    await expect(migP).rejects.toBeInstanceOf(SyncLeaseLostError);
    // First image may have finished upload (uncertain); second must never start
    expect(mem.mediaStore.uploadCount).toBe(1);
  });
});
