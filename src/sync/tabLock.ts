/**
 * M3-B: cross-tab (and same-tab) mutual exclusion for cloud sync entrypoints.
 * Prefer Web Locks API; fall back to IndexedDB lease in sync_meta.
 */

import { getDB } from '../db';
import { uid } from '../lib/constants';

export const SYNC_LOCK_NAME = 'car-care-sync';
export const SYNC_LEASE_META_KEY = 'syncTabLease';
/** Lease TTL — crashed holders auto-expire. */
export const SYNC_LEASE_TTL_MS = 90_000;
export const SYNC_LEASE_RENEW_MS = 30_000;

export type SyncLockMode = 'web-locks' | 'idb-lease' | 'in-process';

export type SyncLockBusy = {
  ok: false;
  reason: 'busy';
  message: string;
  lockMode: SyncLockMode;
};

export type SyncLockHeld<T> = {
  ok: true;
  value: T;
  lockMode: SyncLockMode;
};

export type SyncLockResult<T> = SyncLockHeld<T> | SyncLockBusy;

type LeasePayload = {
  holderId: string;
  expiresAt: number; // epoch ms
};

let inProcessHeld = false;
let cachedHolderId: string | null = null;

function holderId(): string {
  if (!cachedHolderId) cachedHolderId = uid();
  return cachedHolderId;
}

function busy(lockMode: SyncLockMode): SyncLockBusy {
  return {
    ok: false,
    reason: 'busy',
    message: '另一标签页或任务正在同步，请稍候再试（队列已保留，不会丢数据）。',
    lockMode,
  };
}

function hasWebLocks(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
}

async function readLease(): Promise<LeasePayload | null> {
  const db = await getDB();
  const row = await db.get('sync_meta', SYNC_LEASE_META_KEY);
  if (!row?.value || typeof row.value !== 'object') return null;
  const v = row.value as LeasePayload;
  if (typeof v.holderId !== 'string' || typeof v.expiresAt !== 'number') return null;
  return v;
}

async function writeLease(lease: LeasePayload | null): Promise<void> {
  const db = await getDB();
  if (!lease) {
    await db.delete('sync_meta', SYNC_LEASE_META_KEY);
    return;
  }
  await db.put('sync_meta', { key: SYNC_LEASE_META_KEY, value: lease });
}

async function tryAcquireIdbLease(): Promise<boolean> {
  const now = Date.now();
  const cur = await readLease();
  const me = holderId();
  if (cur && cur.expiresAt > now && cur.holderId !== me) {
    return false;
  }
  await writeLease({ holderId: me, expiresAt: now + SYNC_LEASE_TTL_MS });
  const again = await readLease();
  return !!again && again.holderId === me && again.expiresAt > Date.now();
}

async function renewIdbLease(): Promise<void> {
  const cur = await readLease();
  const me = holderId();
  if (!cur || cur.holderId !== me) return;
  await writeLease({ holderId: me, expiresAt: Date.now() + SYNC_LEASE_TTL_MS });
}

async function releaseIdbLease(): Promise<void> {
  const cur = await readLease();
  const me = holderId();
  if (cur && cur.holderId === me) {
    await writeLease(null);
  }
}

/**
 * Run `fn` under an exclusive sync lock.
 * Uses ifAvailable Web Lock (no long wait) so UI can show busy immediately.
 */
export async function withSyncLock<T>(fn: () => Promise<T>): Promise<SyncLockResult<T>> {
  if (inProcessHeld) {
    return busy('in-process');
  }

  if (hasWebLocks()) {
    let result: SyncLockResult<T> | undefined;
    let error: unknown;
    await navigator.locks!.request(SYNC_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        result = busy('web-locks');
        return;
      }
      inProcessHeld = true;
      try {
        result = { ok: true, value: await fn(), lockMode: 'web-locks' };
      } catch (e) {
        error = e;
      } finally {
        inProcessHeld = false;
      }
    });
    if (error) throw error;
    return result ?? busy('web-locks');
  }

  const got = await tryAcquireIdbLease();
  if (!got) return busy('idb-lease');

  inProcessHeld = true;
  const renewTimer = setInterval(() => {
    void renewIdbLease();
  }, SYNC_LEASE_RENEW_MS);
  try {
    const value = await fn();
    return { ok: true, value, lockMode: 'idb-lease' };
  } finally {
    clearInterval(renewTimer);
    inProcessHeld = false;
    await releaseIdbLease();
  }
}

/** Test helper: reset in-process gate (fake-indexeddb suites). */
export function resetTabLockForTests(): void {
  inProcessHeld = false;
  cachedHolderId = null;
}

/** Force a foreign lease (tests). */
export async function seedForeignLeaseForTests(ttlMs = SYNC_LEASE_TTL_MS): Promise<void> {
  await writeLease({ holderId: 'foreign-holder', expiresAt: Date.now() + ttlMs });
}

export async function clearLeaseForTests(): Promise<void> {
  await writeLease(null);
}

/** Whether a foreign (non-expired) lease exists — used by stale syncing recovery. */
export async function hasActiveForeignLease(): Promise<boolean> {
  const cur = await readLease();
  if (!cur) return false;
  if (cur.expiresAt <= Date.now()) return false;
  return cur.holderId !== holderId();
}
