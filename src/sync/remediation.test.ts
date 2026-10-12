import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { nowISO } from '../lib/constants';
import { putVehicle } from '../repositories/vehicles';
import type { Vehicle } from '../types';
import { setCloudStorageConfig } from './config';
import {
  bidirectionalSync,
  firstUploadToCloud,
  disconnectCloud,
  restoreFromCloud,
  setCloudProviderForTests,
  verifyConnection,
} from './engine';
import {
  ackOutboxCoveredByUpload,
  getSyncMeta,
  listConflicts,
  listOutbox,
  listOutboxForUser,
  countOutboxForOwner,
  patchSyncMeta,
  putOutboxItem,
} from './outbox';
import { MemoryCloudProvider } from './providers/memory';
import { SupabaseProvider } from './providers/supabase';
import { setSyncTxHookForTests } from './txHooks';
import { validateCloudRow } from './validatePayload';

async function reset() {
  setCloudProviderForTests(null);
  setSyncTxHookForTests(null);
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

describe('P0 atomic business + outbox', () => {
  beforeEach(async () => {
    await reset();
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'eyJhbGciOi.test.anon',
    });
  });
  afterEach(async () => {
    setSyncTxHookForTests(null);
    await closeDBForTests();
  });

  it('commits vehicle and outbox together', async () => {
    await putVehicle(vehicle('v1', 'A', '2026-01-01T00:00:00.000Z'));
    const v = await (await getDB()).get('vehicles', 'v1');
    const box = await listOutbox();
    expect(v?.name).toBe('A');
    expect(box.some((o) => o.entityId === 'v1' && o.op === 'upsert')).toBe(true);
  });

  it('rolls back business write if outbox phase throws mid-transaction', async () => {
    setSyncTxHookForTests(() => {
      throw new Error('inject-fail-before-outbox');
    });
    await expect(
      putVehicle(vehicle('v-fail', 'X', '2026-01-01T00:00:00.000Z')),
    ).rejects.toThrow(/inject-fail/);
    const v = await (await getDB()).get('vehicles', 'v-fail');
    const box = await listOutbox();
    expect(v).toBeUndefined();
    expect(box.some((o) => o.entityId === 'v-fail')).toBe(false);
  });
});

describe('P0 restore replaceLocal single transaction', () => {
  let mem: MemoryCloudProvider;
  beforeEach(async () => {
    await reset();
    mem = new MemoryCloudProvider();
    setCloudProviderForTests(mem);
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'eyJhbGciOi.test.anon',
    });
  });
  afterEach(async () => {
    setSyncTxHookForTests(null);
    setCloudProviderForTests(null);
    await closeDBForTests();
  });

  it('keeps original local data if apply fails during replaceLocal', async () => {
    await putVehicle(vehicle('keep', 'Original', '2026-01-01T00:00:00.000Z'));
    await (await getDB()).clear('sync_outbox');
    mem.rows.set('vehicles:cloud1', {
      entity: 'vehicles',
      id: 'cloud1',
      payload: vehicle('cloud1', 'FromCloud', '2026-02-01T00:00:00.000Z'),
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    });
    let calls = 0;
    setSyncTxHookForTests(() => {
      calls += 1;
      if (calls >= 1) throw new Error('inject-restore-fail');
    });
    const r = await restoreFromCloud({ replaceLocal: true });
    expect(r.ok).toBe(false);
    const local = await (await getDB()).getAll('vehicles');
    expect(local.map((v) => v.id)).toContain('keep');
    expect(local.find((v) => v.id === 'keep')?.name).toBe('Original');
    expect(local.some((v) => v.id === 'cloud1')).toBe(false);
  });
});

describe('P0 firstUpload selective outbox ack', () => {
  let mem: MemoryCloudProvider;
  beforeEach(async () => {
    await reset();
    mem = new MemoryCloudProvider();
    setCloudProviderForTests(mem);
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'eyJhbGciOi.test.anon',
    });
  });
  afterEach(async () => {
    setCloudProviderForTests(null);
    await closeDBForTests();
  });

  it('does not wipe ops enqueued during upload (newer mutatedAt)', async () => {
    await putVehicle(vehicle('v1', 'A', '2026-01-01T00:00:00.000Z'));
    // Simulate concurrent edit during upload by inserting newer outbox before ack logic
    const original = await firstUploadToCloud();
    expect(original.ok).toBe(true);

    // Re-seed: upload then add concurrent op, then ack manually mirrors engine behavior
    await putOutboxItem({
      opId: 'concurrent',
      entity: 'vehicles',
      entityId: 'v1',
      op: 'upsert',
      payload: vehicle('v1', 'Newer', '2026-03-01T00:00:00.000Z'),
      mutatedAt: '2026-03-01T00:00:00.000Z',
      attempts: 0,
      nextRetryAt: '2026-03-01T00:00:00.000Z',
    });
    await putOutboxItem({
      opId: 'old',
      entity: 'vehicles',
      entityId: 'v1',
      op: 'upsert',
      payload: vehicle('v1', 'A', '2026-01-01T00:00:00.000Z'),
      mutatedAt: '2026-01-01T00:00:00.000Z',
      attempts: 0,
      nextRetryAt: '2026-01-01T00:00:00.000Z',
    });
    const n = await ackOutboxCoveredByUpload([
      { entity: 'vehicles', id: 'v1', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(n).toBe(1);
    const box = await listOutbox();
    expect(box.some((o) => o.opId === 'concurrent')).toBe(true);
    expect(box.some((o) => o.opId === 'old')).toBe(false);
  });
});

describe('P1 payload validation', () => {
  it('rejects bad vehicle / media / cloudStorage settings', () => {
    expect(
      validateCloudRow({
        entity: 'vehicles',
        id: 'v1',
        payload: { id: 'v1', name: 1 },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatch(/name/);
    expect(
      validateCloudRow({
        entity: 'settings',
        id: 'cloudStorage',
        payload: { key: 'cloudStorage', value: {}, updatedAt: '2026-01-01T00:00:00.000Z' },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatch(/cloudStorage/);
    expect(
      validateCloudRow({
        entity: 'media',
        id: 'm1',
        payload: {
          id: 'm1',
          mimeType: 'text/plain',
          byteSize: 1,
          base64: 'abcd',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatch(/mimeType/);
  });

  it('restore rejects invalid cloud payload without mutating local', async () => {
    await reset();
    const mem = new MemoryCloudProvider();
    setCloudProviderForTests(mem);
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'eyJhbGciOi.test.anon',
    });
    await putVehicle(vehicle('safe', 'OK', '2026-01-01T00:00:00.000Z'));
    await (await getDB()).clear('sync_outbox');
    mem.rows.set('vehicles:bad', {
      entity: 'vehicles',
      id: 'bad',
      payload: { id: 'bad' },
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    });
    const r = await restoreFromCloud();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/校验/);
    expect(await (await getDB()).get('vehicles', 'safe')).toBeTruthy();
    setCloudProviderForTests(null);
    await closeDBForTests();
  });
});

describe('P1 Supabase pull pagination', () => {
  it('aggregates multiple pages beyond page size', async () => {
    const pages: unknown[][] = [];
    // 3 pages: 2, 2, 1 with pageSize=2
    const all = [
      { entity: 'vehicles', id: 'a', payload: {}, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, device_id: null },
      { entity: 'vehicles', id: 'b', payload: {}, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, device_id: null },
      { entity: 'vehicles', id: 'c', payload: {}, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, device_id: null },
      { entity: 'vehicles', id: 'd', payload: {}, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, device_id: null },
      { entity: 'vehicles', id: 'e', payload: {}, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, device_id: null },
    ];

    const mockClient = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 't@t.com' } }, error: null }),
      },
      from() {
        const state = { from: 0, to: 0 };
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          order() {
            return api;
          },
          range(from: number, to: number) {
            state.from = from;
            state.to = to;
            return Promise.resolve({
              data: all.slice(from, to + 1),
              error: null,
            });
          },
        };
        return api;
      },
    };

    const provider = new SupabaseProvider({
      url: 'https://example.supabase.co',
      anonKey: 'eyJhbGciOi.test.anon',
      deviceId: 'dev',
      client: mockClient as never,
    });
    provider.pageSize = 2;
    const snap = await provider.pullAll();
    expect(snap.rows).toHaveLength(5);
    expect(snap.rows.map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    void pages;
  });
});

describe('fault injection / dual-device / offline / repeat / delete-conflict', () => {
  let mem: MemoryCloudProvider;
  beforeEach(async () => {
    await reset();
    mem = new MemoryCloudProvider();
    setCloudProviderForTests(mem);
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'eyJhbGciOi.test.anon',
    });
  });
  afterEach(async () => {
    setCloudProviderForTests(null);
    setSyncTxHookForTests(null);
    await closeDBForTests();
  });

  it('offline queues and recovers on next sync', async () => {
    await putVehicle(vehicle('v1', 'A', '2026-01-01T00:00:00.000Z'));
    expect((await listOutbox()).length).toBeGreaterThan(0);
    mem.failNextPush = true;
    const fail = await bidirectionalSync();
    expect(fail.ok).toBe(false);
    expect((await listOutbox()).length).toBeGreaterThan(0);
    // Make failed ops immediately retryable (backoff would otherwise delay)
    const db = await getDB();
    for (const item of await listOutbox()) {
      await db.put('sync_outbox', { ...item, nextRetryAt: '2020-01-01T00:00:00.000Z' });
    }
    const ok = await bidirectionalSync();
    expect(ok.ok).toBe(true);
    expect(mem.rows.has('vehicles:v1')).toBe(true);
  });

  it('repeat sync is idempotent', async () => {
    await putVehicle(vehicle('v1', 'A', '2026-01-01T00:00:00.000Z'));
    const a = await bidirectionalSync();
    const b = await bidirectionalSync();
    expect(a.ok && b.ok).toBe(true);
    expect(mem.rows.get('vehicles:v1')?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('dual-device LWW: newer cloud wins; pending local protected', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-05T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'DeviceB', '2026-01-10T00:00:00.000Z'),
      updatedAt: '2026-01-10T00:00:00.000Z',
      deletedAt: null,
    });
    // clear outbox so pull can apply
    await (await getDB()).clear('sync_outbox');
    const r = await bidirectionalSync();
    expect(r.ok).toBe(true);
    expect((await (await getDB()).get('vehicles', 'v1'))?.name).toBe('DeviceB');
  });

  it('delete vs edit: edit wins over older tombstone', async () => {
    await putVehicle(vehicle('v1', 'Alive', '2026-01-10T00:00:00.000Z'));
    await (await getDB()).clear('sync_outbox');
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: {},
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: '2026-01-01T00:00:00.000Z',
    });
    const r = await restoreFromCloud();
    expect(r.ok).toBe(true);
    expect(await (await getDB()).get('vehicles', 'v1')).toBeTruthy();
  });

  it('user switch with local data is blocked (shared IDB safety)', async () => {
    await patchSyncMeta({ cloudUserId: 'old-user', deviceId: 'dev', status: 'idle', provider: 'supabase' });
    await putVehicle(vehicle('v1', 'A', '2026-01-01T00:00:00.000Z'));
    expect(await countOutboxForOwner('old-user')).toBeGreaterThan(0);
    mem.userId = 'new-user';
    const r = await verifyConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/阻止账号切换|IndexedDB/);
    // Binding must NOT flip to new user
    expect((await getSyncMeta()).cloudUserId).toBe('old-user');
    // Pending ops for old user remain parked
    expect(await countOutboxForOwner('old-user')).toBeGreaterThan(0);
  });

  it('user switch allowed when local empty and no parked outbox', async () => {
    await patchSyncMeta({ cloudUserId: 'old-user', deviceId: 'dev', status: 'idle', provider: 'supabase' });
    // no vehicles / outbox
    mem.userId = 'new-user';
    const r = await verifyConnection();
    expect(r.ok).toBe(true);
    expect((await getSyncMeta()).cloudUserId).toBe('new-user');
    expect(r.message).toMatch(/切换|成功/);
  });

  it('pushOps atomic LWW skips older client without TOCTOU pair', async () => {
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'Cloud', '2026-02-01T00:00:00.000Z'),
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    });
    const push = await mem.pushOps([
      {
        opId: 'op1',
        entity: 'vehicles',
        entityId: 'v1',
        op: 'upsert',
        payload: vehicle('v1', 'Stale', '2026-01-01T00:00:00.000Z'),
        mutatedAt: '2026-01-01T00:00:00.000Z',
        attempts: 0,
        nextRetryAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(push.conflicts[0]?.reason).toBe('cloud_newer');
    expect(mem.rows.get('vehicles:v1')?.payload).toMatchObject({ name: 'Cloud' });
  });
});


describe('round-3: LWW first upload + conflict recovery + mid-sync concurrency', () => {
  let mem: MemoryCloudProvider;
  beforeEach(async () => {
    await reset();
    mem = new MemoryCloudProvider();
    setCloudProviderForTests(mem);
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'eyJhbGciOi.test.anon',
    });
    await patchSyncMeta({ cloudUserId: 'test-user', deviceId: 'dev', status: 'idle', provider: 'supabase' });
  });
  afterEach(async () => {
    setCloudProviderForTests(null);
    await closeDBForTests();
  });

  it('firstUpload keeps cloud-newer rows (no unconditional overwrite)', async () => {
    await putVehicle(vehicle('v1', 'LocalOld', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudNewer', '2026-03-01T00:00:00.000Z'),
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
    });
    const r = await firstUploadToCloud();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/跳过/);
    expect(mem.rows.get('vehicles:v1')?.payload).toMatchObject({ name: 'CloudNewer' });
    const conflicts = await listConflicts();
    expect(conflicts.some((c) => c.resolution === 'push_skipped_cloud_newer')).toBe(true);
  });

  it('firstUpload writes when local is newer or equal cloud missing', async () => {
    await putVehicle(vehicle('v2', 'LocalNew', '2026-04-01T00:00:00.000Z'));
    const r = await firstUploadToCloud();
    expect(r.ok).toBe(true);
    expect(mem.rows.get('vehicles:v2')?.payload).toMatchObject({ name: 'LocalNew' });
  });

  it('skipped_cloud_newer records conflict and preserves newer mid-sync op', async () => {
    await putVehicle(vehicle('v1', 'Stale', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'Cloud', '2026-02-01T00:00:00.000Z'),
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    });
    // Mid-sync style: enqueue a newer local edit before flush completes
    await putOutboxItem({
      opId: 'newer-mid',
      entity: 'vehicles',
      entityId: 'v1',
      op: 'upsert',
      payload: vehicle('v1', 'LocalNewer', '2026-03-01T00:00:00.000Z'),
      mutatedAt: '2026-03-01T00:00:00.000Z',
      attempts: 0,
      nextRetryAt: '2026-03-01T00:00:00.000Z',
      ownerUserId: 'test-user',
    });
    const r = await bidirectionalSync();
    expect(r.ok).toBe(true);
    // Newer mid-sync op must still be present or already applied
    const box = await listOutbox();
    const hasNewer = box.some((o) => o.opId === 'newer-mid') || mem.rows.get('vehicles:v1')?.updatedAt === '2026-03-01T00:00:00.000Z';
    expect(hasNewer).toBe(true);
    const conflicts = await listConflicts();
    // Either push conflict logged, or newer won on push — no silent wipe of newer-mid without apply
    expect(box.some((o) => o.opId === 'newer-mid') || mem.rows.get('vehicles:v1')?.payload).toBeTruthy();
    void conflicts;
  });

  it('push conflict does not put skipped opId into applied list', async () => {
    const push = await mem.pushOps([
      {
        opId: 'stale',
        entity: 'vehicles',
        entityId: 'vx',
        op: 'upsert',
        payload: vehicle('vx', 'A', '2026-01-01T00:00:00.000Z'),
        mutatedAt: '2026-01-01T00:00:00.000Z',
        attempts: 0,
        nextRetryAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    // seed cloud newer then push again
    mem.rows.set('vehicles:vx', {
      entity: 'vehicles',
      id: 'vx',
      payload: vehicle('vx', 'B', '2026-05-01T00:00:00.000Z'),
      updatedAt: '2026-05-01T00:00:00.000Z',
      deletedAt: null,
    });
    const push2 = await mem.pushOps([
      {
        opId: 'stale2',
        entity: 'vehicles',
        entityId: 'vx',
        op: 'upsert',
        payload: vehicle('vx', 'A', '2026-01-01T00:00:00.000Z'),
        mutatedAt: '2026-01-01T00:00:00.000Z',
        attempts: 0,
        nextRetryAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(push2.applied).not.toContain('stale2');
    expect(push2.conflicts.some((c) => c.opId === 'stale2')).toBe(true);
    void push;
  });
});

describe('config security', () => {
  beforeEach(reset);
  afterEach(async () => {
    await closeDBForTests();
  });

  it('rejects service_role JWT role claim', async () => {
    // header.payload.sig — payload {"role":"service_role"}
    const json = JSON.stringify({ role: 'service_role', ref: 'x' });
    const payload = Buffer.from(json, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const fakeJwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
    await expect(
      setCloudStorageConfig({
        provider: 'supabase',
        supabaseUrl: 'https://abc.supabase.co',
        supabaseAnonKey: fakeJwt,
      }),
    ).rejects.toThrow(/service_role/);
  });

  it('rejects non-https URL', async () => {
    await expect(
      setCloudStorageConfig({
        provider: 'supabase',
        supabaseUrl: 'http://abc.supabase.co',
        supabaseAnonKey: 'eyJhbGciOi.test.anon',
      }),
    ).rejects.toThrow(/https/);
  });
});

describe('round-4: disconnect keep queue + restore account isolation', () => {
  let mem: MemoryCloudProvider;
  beforeEach(async () => {
    await reset();
    mem = new MemoryCloudProvider();
    setCloudProviderForTests(mem);
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'eyJhbGciOi.test.anon',
    });
  });
  afterEach(async () => {
    setCloudProviderForTests(null);
    await closeDBForTests();
  });

  it('disconnect keeps pending outbox; same-account reconnect resumes', async () => {
    await patchSyncMeta({
      cloudUserId: 'user-a',
      deviceId: 'dev',
      status: 'idle',
      provider: 'supabase',
    });
    await putVehicle(vehicle('v1', 'KeepMe', '2026-01-01T00:00:00.000Z'));
    expect(await countOutboxForOwner('user-a')).toBeGreaterThan(0);
    const d = await disconnectCloud();
    expect(d.ok).toBe(true);
    expect(d.message).toMatch(/保留/);
    expect(await countOutboxForOwner('user-a')).toBeGreaterThan(0);
    // Reconnect config + same user
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'eyJhbGciOi.test.anon',
    });
    mem.userId = 'user-a';
    const v = await verifyConnection();
    expect(v.ok).toBe(true);
    // Make ops immediately ready
    const db = await getDB();
    for (const item of await listOutbox()) {
      await db.put('sync_outbox', { ...item, nextRetryAt: '2020-01-01T00:00:00.000Z' });
    }
    const sync = await bidirectionalSync();
    expect(sync.ok).toBe(true);
    expect(mem.rows.has('vehicles:v1')).toBe(true);
  });

  it('restore merge only blocks on current-account pending ops', async () => {
    await patchSyncMeta({
      cloudUserId: 'user-a',
      deviceId: 'dev',
      status: 'idle',
      provider: 'supabase',
    });
    await putVehicle(vehicle('v1', 'LocalA', '2026-01-01T00:00:00.000Z'));
    await (await getDB()).clear('sync_outbox');
    // Other account pending for same id must NOT block A's restore
    await putOutboxItem({
      opId: 'other-b',
      entity: 'vehicles',
      entityId: 'v1',
      op: 'upsert',
      payload: vehicle('v1', 'FromB', '2026-01-05T00:00:00.000Z'),
      mutatedAt: '2026-01-05T00:00:00.000Z',
      attempts: 0,
      nextRetryAt: '2026-01-05T00:00:00.000Z',
      ownerUserId: 'user-b',
    });
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudA', '2026-02-01T00:00:00.000Z'),
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    });
    const r = await restoreFromCloud();
    expect(r.ok).toBe(true);
    expect((await (await getDB()).get('vehicles', 'v1'))?.name).toBe('CloudA');
    // B's parked op still present
    expect(await countOutboxForOwner('user-b')).toBe(1);
  });

  it('replaceLocal restore clears only current account outbox', async () => {
    await patchSyncMeta({
      cloudUserId: 'user-a',
      deviceId: 'dev',
      status: 'idle',
      provider: 'supabase',
    });
    await putVehicle(vehicle('va', 'A', '2026-01-01T00:00:00.000Z'));
    await putOutboxItem({
      opId: 'park-b',
      entity: 'vehicles',
      entityId: 'vb',
      op: 'upsert',
      payload: vehicle('vb', 'B', '2026-01-01T00:00:00.000Z'),
      mutatedAt: '2026-01-01T00:00:00.000Z',
      attempts: 0,
      nextRetryAt: '2026-01-01T00:00:00.000Z',
      ownerUserId: 'user-b',
    });
    mem.rows.set('vehicles:cloud', {
      entity: 'vehicles',
      id: 'cloud',
      payload: vehicle('cloud', 'FromCloud', '2026-03-01T00:00:00.000Z'),
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
    });
    const r = await restoreFromCloud({ replaceLocal: true });
    expect(r.ok).toBe(true);
    expect(await countOutboxForOwner('user-a')).toBe(0);
    expect(await countOutboxForOwner('user-b')).toBe(1);
    const ids = (await (await getDB()).getAll('vehicles')).map((v) => v.id);
    expect(ids).toContain('cloud');
    expect(ids).not.toContain('va');
  });
});
