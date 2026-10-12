import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDB } from '../db';
import { patchSyncMeta, getSyncMeta } from './outbox';
import { recoverStaleSyncingStatus } from './engine';
import {
  clearLeaseForTests,
  readLeaseForTests,
  seedForeignLeaseForTests,
  SyncLeaseLostError,
  SyncLockSession,
  SYNC_LEASE_TTL_MS,
  withSyncLock,
  resetTabLockForTests,
} from './tabLock';

async function resetDb() {
  const db = await getDB();
  for (const s of ['vehicles', 'records', 'stations', 'media', 'sync_outbox', 'sync_meta'] as const) {
    await db.clear(s);
  }
}

describe('IDB lease atomicity + two-tab sessions', () => {
  beforeEach(async () => {
    resetTabLockForTests();
    await resetDb();
    await clearLeaseForTests();
    vi.stubGlobal('navigator', { locks: undefined, onLine: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('T1: same session reentry returns busy', async () => {
    const tab = new SyncLockSession('tab-a');
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = tab.withSyncLock(async () => {
      await gate;
      return 'a';
    });
    await new Promise((r) => setTimeout(r, 15));
    const second = await tab.withSyncLock(async () => 'b');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.lockMode).toBe('in-process');
    release();
    expect((await first).ok).toBe(true);
  });

  it('two independent sessions: second busy while first holds lease', async () => {
    const tabA = new SyncLockSession('tab-A');
    const tabB = new SyncLockSession('tab-B');
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = tabA.withSyncLock(async () => {
      await gate;
      return 'a';
    });
    await new Promise((r) => setTimeout(r, 20));
    const lease = await readLeaseForTests();
    expect(lease?.holderId).toBe('tab-A');
    const second = await tabB.withSyncLock(async () => 'b');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.lockMode).toBe('idb-lease');
    release();
    await first;
  });

  it('T4: expired lease — tab B takes over; tab A release must not wipe B', async () => {
    const tabA = new SyncLockSession('tab-A');
    const tabB = new SyncLockSession('tab-B');
    expect(await tabA.tryAcquireIdbLease()).toBe(true);
    // Simulate TTL expiry without renew
    const db = await getDB();
    await db.put('sync_meta', {
      key: 'syncTabLease',
      value: { holderId: 'tab-A', expiresAt: Date.now() - 1 },
    });
    expect(await tabB.tryAcquireIdbLease()).toBe(true);
    expect((await readLeaseForTests())?.holderId).toBe('tab-B');
    // Old holder tries renew/release — must not overwrite/delete B
    expect(await tabA.renewIdbLease()).toBe('lost');
    expect(await tabA.releaseIdbLease()).toBe('skipped');
    expect((await readLeaseForTests())?.holderId).toBe('tab-B');
    expect(await tabB.releaseIdbLease()).toBe('released');
  });

  it('acquire is one txn: concurrent judges cannot both win (serialized)', async () => {
    // fake-indexeddb serializes rw txns on same store; both attempt acquire
    const tabA = new SyncLockSession('race-A');
    const tabB = new SyncLockSession('race-B');
    const [a, b] = await Promise.all([tabA.tryAcquireIdbLease(), tabB.tryAcquireIdbLease()]);
    // Exactly one winner
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const holder = (await readLeaseForTests())?.holderId;
    expect(holder === 'race-A' || holder === 'race-B').toBe(true);
  });

  it('sync exceeding TTL: renew lost → SyncLeaseLostError; new lease intact', async () => {
    const tabA = new SyncLockSession('long-A');
    const tabB = new SyncLockSession('long-B');
    let hitLost = false;
    const run = tabA.withSyncLock(async () => {
      // Expire A and let B take over, then force A's renew (as the interval would)
      const db = await getDB();
      await db.put('sync_meta', {
        key: 'syncTabLease',
        value: { holderId: 'long-A', expiresAt: Date.now() - 1 },
      });
      expect(await tabB.tryAcquireIdbLease()).toBe(true);
      expect(await tabA.renewIdbLease()).toBe('lost');
      hitLost = true;
      // Simulate the race handler aborting the in-flight sync
      throw new SyncLeaseLostError();
    });
    await expect(run).rejects.toBeInstanceOf(SyncLeaseLostError);
    expect(hitLost).toBe(true);
    expect((await readLeaseForTests())?.holderId).toBe('long-B');
    expect(await tabA.releaseIdbLease()).toBe('skipped');
    await tabB.releaseIdbLease();
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
    const tab = new SyncLockSession('wl');
    const r = await tab.withSyncLock(async () => 'nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lockMode).toBe('web-locks');
  });
});

describe('recoverStaleSyncingStatus + Web Locks compatibility', () => {
  beforeEach(async () => {
    await resetDb();
    await clearLeaseForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('T7: clears stuck syncing when no lock / lease / heartbeat', async () => {
    vi.stubGlobal('navigator', { locks: undefined, onLine: true });
    await patchSyncMeta({ deviceId: 'd1', status: 'syncing', provider: 'supabase' });
    expect(await recoverStaleSyncingStatus()).toBe(true);
    expect((await getSyncMeta()).status).toBe('idle');
  });

  it('Tab A syncing (fresh heartbeat) + Tab B opens settings → does NOT clear', async () => {
    vi.stubGlobal('navigator', { locks: undefined, onLine: true });
    const tabA = new SyncLockSession('settings-A');
    await tabA.writeHeartbeat('idb-lease');
    await patchSyncMeta({ deviceId: 'd1', status: 'syncing', provider: 'supabase' });
    // Tab B path: getSyncStatusSummary → recoverStaleSyncingStatus
    expect(await recoverStaleSyncingStatus()).toBe(false);
    expect((await getSyncMeta()).status).toBe('syncing');
  });

  it('Web Locks held → does NOT clear even without IDB lease', async () => {
    const query = vi.fn(async () => ({
      held: [{ name: 'car-care-sync' }],
      pending: [],
    }));
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn(), query },
      onLine: true,
    });
    await patchSyncMeta({ deviceId: 'd1', status: 'syncing', provider: 'supabase' });
    // No IDB lease, no heartbeat — but Web Lock held
    expect(await recoverStaleSyncingStatus()).toBe(false);
    expect((await getSyncMeta()).status).toBe('syncing');
    expect(query).toHaveBeenCalled();
  });

  it('active IDB lease alone blocks recover', async () => {
    vi.stubGlobal('navigator', { locks: undefined, onLine: true });
    await seedForeignLeaseForTests(60_000);
    await patchSyncMeta({ deviceId: 'd1', status: 'syncing', provider: 'supabase' });
    expect(await recoverStaleSyncingStatus()).toBe(false);
  });
});

describe('default withSyncLock export', () => {
  beforeEach(async () => {
    resetTabLockForTests();
    await resetDb();
    await clearLeaseForTests();
    vi.stubGlobal('navigator', { locks: undefined, onLine: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('works via module default session', async () => {
    const r = await withSyncLock(async () => 1);
    expect(r.ok).toBe(true);
  });
});

