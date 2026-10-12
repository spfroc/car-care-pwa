import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDB } from '../db';
import { patchSyncMeta } from './outbox';
import { recoverStaleSyncingStatus } from './engine';
import {
  clearLeaseForTests,
  resetTabLockForTests,
  seedForeignLeaseForTests,
  withSyncLock,
  SYNC_LEASE_TTL_MS,
} from './tabLock';

async function resetDb() {
  const db = await getDB();
  for (const s of ['vehicles', 'records', 'stations', 'media', 'sync_outbox', 'sync_meta'] as const) {
    await db.clear(s);
  }
}

describe('withSyncLock', () => {
  beforeEach(async () => {
    resetTabLockForTests();
    await resetDb();
    await clearLeaseForTests();
    // Ensure no Web Locks in node unit env
    vi.stubGlobal('navigator', { locks: undefined, onLine: true });
  });
  afterEach(() => {
    resetTabLockForTests();
    vi.unstubAllGlobals();
  });

  it('T1: same-tab reentry returns busy (in-process)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = withSyncLock(async () => {
      await gate;
      return 'a';
    });
    // Give first time to acquire
    await new Promise((r) => setTimeout(r, 10));
    const second = await withSyncLock(async () => 'b');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.lockMode).toBe('in-process');
    release();
    const done = await first;
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.value).toBe('a');
  });

  it('T3: active foreign IDB lease → busy', async () => {
    await seedForeignLeaseForTests(60_000);
    const r = await withSyncLock(async () => 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('busy');
      expect(r.lockMode).toBe('idb-lease');
    }
  });

  it('T4: expired foreign lease can be taken', async () => {
    await seedForeignLeaseForTests(-1_000); // already expired
    const r = await withSyncLock(async () => 42);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(42);
      expect(r.lockMode).toBe('idb-lease');
    }
  });

  it('T2: Web Locks ifAvailable null → busy', async () => {
    const request = vi.fn(
      async (
        _name: string,
        _opts: { ifAvailable?: boolean },
        cb: (lock: unknown) => Promise<void>,
      ) => {
        await cb(null);
      },
    );
    vi.stubGlobal('navigator', { locks: { request }, onLine: true });
    resetTabLockForTests();
    const r = await withSyncLock(async () => 'nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lockMode).toBe('web-locks');
    expect(request).toHaveBeenCalled();
  });

  it('Web Locks success path', async () => {
    const request = vi.fn(
      async (
        _name: string,
        _opts: { ifAvailable?: boolean },
        cb: (lock: unknown) => Promise<void>,
      ) => {
        await cb({ name: 'car-care-sync' });
      },
    );
    vi.stubGlobal('navigator', { locks: { request }, onLine: true });
    resetTabLockForTests();
    const r = await withSyncLock(async () => 'ok');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lockMode).toBe('web-locks');
  });
});

describe('recoverStaleSyncingStatus', () => {
  beforeEach(async () => {
    resetTabLockForTests();
    await resetDb();
    await clearLeaseForTests();
    vi.stubGlobal('navigator', { locks: undefined, onLine: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('T7: clears stuck syncing when no foreign lease', async () => {
    await patchSyncMeta({
      deviceId: 'd1',
      status: 'syncing',
      provider: 'supabase',
    });
    const cleared = await recoverStaleSyncingStatus();
    expect(cleared).toBe(true);
    const { getSyncMeta } = await import('./outbox');
    const meta = await getSyncMeta();
    expect(meta.status).toBe('idle');
    expect(meta.lastError).toMatch(/异常中断/);
  });

  it('does not clear syncing when foreign lease active', async () => {
    await seedForeignLeaseForTests(SYNC_LEASE_TTL_MS);
    await patchSyncMeta({
      deviceId: 'd1',
      status: 'syncing',
      provider: 'supabase',
    });
    const cleared = await recoverStaleSyncingStatus();
    expect(cleared).toBe(false);
    const { getSyncMeta } = await import('./outbox');
    expect((await getSyncMeta()).status).toBe('syncing');
  });
});
