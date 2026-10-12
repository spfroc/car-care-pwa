/**
 * M3-B: cross-tab (and same-tab) mutual exclusion for cloud sync entrypoints.
 * Prefer Web Locks API; fall back to IndexedDB lease in sync_meta.
 *
 * Round-1: IDB acquire/renew/release are single readwrite transactions with
 * holder identity checks. Independent SyncLockSession instances simulate tabs.
 */

import { getDB } from '../db';
import { uid } from '../lib/constants';

export const SYNC_LOCK_NAME = 'car-care-sync';
export const SYNC_LEASE_META_KEY = 'syncTabLease';
export const SYNC_HEARTBEAT_META_KEY = 'syncHeartbeat';
/** Lease / heartbeat TTL — crashed holders auto-expire. */
export const SYNC_LEASE_TTL_MS = 90_000;
export const SYNC_LEASE_RENEW_MS = 30_000;
/**
 * When renew fails because another tab took over after TTL, the old holder
 * must abort the sync and must NOT release/overwrite the new lease.
 */
export class SyncLeaseLostError extends Error {
  constructor(
    message = '同步锁已超时并被其他标签页接管；本次同步已中止，队列仍保留（未确认的云端结果视为不确定），请重试。',
  ) {
    super(message);
    this.name = 'SyncLeaseLostError';
  }
}

/** Throw SyncLeaseLostError when the sync AbortSignal was aborted (lease lost). */
export function throwIfSyncAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  if (reason instanceof SyncLeaseLostError) throw reason;
  throw new SyncLeaseLostError();
}

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

export type LeasePayload = {
  holderId: string;
  expiresAt: number; // epoch ms
};

export type HeartbeatPayload = {
  holderId: string;
  at: number; // epoch ms
  mode: SyncLockMode;
};

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

function parseLease(row: { key: string; value: unknown } | undefined): LeasePayload | null {
  if (!row?.value || typeof row.value !== 'object') return null;
  const v = row.value as LeasePayload;
  if (typeof v.holderId !== 'string' || typeof v.expiresAt !== 'number') return null;
  return v;
}

function parseHeartbeat(row: { key: string; value: unknown } | undefined): HeartbeatPayload | null {
  if (!row?.value || typeof row.value !== 'object') return null;
  const v = row.value as HeartbeatPayload;
  if (typeof v.holderId !== 'string' || typeof v.at !== 'number') return null;
  return v;
}

/** One logical browser tab / worker context (own holderId + in-process gate). */
export class SyncLockSession {
  readonly holderId: string;
  /** Renew / heartbeat interval (overridable in tests). */
  readonly renewMs: number;
  private inProcessHeld = false;

  constructor(holderId?: string, opts?: { renewMs?: number }) {
    this.holderId = holderId ?? uid();
    this.renewMs = opts?.renewMs ?? SYNC_LEASE_RENEW_MS;
  }

  /** Acquire IDB lease in ONE readwrite txn: read → judge → write. */
  async tryAcquireIdbLease(now = Date.now()): Promise<boolean> {
    const db = await getDB();
    const me = this.holderId;
    const tx = db.transaction('sync_meta', 'readwrite');
    const store = tx.objectStore('sync_meta');
    const cur = parseLease(await store.get(SYNC_LEASE_META_KEY));
    if (cur && cur.expiresAt > now && cur.holderId !== me) {
      await tx.done;
      return false;
    }
    const next: LeasePayload = { holderId: me, expiresAt: now + SYNC_LEASE_TTL_MS };
    await store.put({ key: SYNC_LEASE_META_KEY, value: next });
    await tx.done;
    return true;
  }

  /**
   * Renew only if we still own the lease (same txn conditional update).
   * Returns 'lost' if another holder took over after TTL.
   */
  async renewIdbLease(now = Date.now()): Promise<'ok' | 'lost'> {
    const db = await getDB();
    const me = this.holderId;
    const tx = db.transaction('sync_meta', 'readwrite');
    const store = tx.objectStore('sync_meta');
    const cur = parseLease(await store.get(SYNC_LEASE_META_KEY));
    if (!cur || cur.holderId !== me) {
      await tx.done;
      return 'lost';
    }
    await store.put({
      key: SYNC_LEASE_META_KEY,
      value: { holderId: me, expiresAt: now + SYNC_LEASE_TTL_MS } satisfies LeasePayload,
    });
    await tx.done;
    return 'ok';
  }

  /** Delete lease only if holderId still matches (same txn). */
  async releaseIdbLease(): Promise<'released' | 'skipped'> {
    const db = await getDB();
    const me = this.holderId;
    const tx = db.transaction('sync_meta', 'readwrite');
    const store = tx.objectStore('sync_meta');
    const cur = parseLease(await store.get(SYNC_LEASE_META_KEY));
    if (!cur || cur.holderId !== me) {
      await tx.done;
      return 'skipped';
    }
    await store.delete(SYNC_LEASE_META_KEY);
    await tx.done;
    return 'released';
  }

  /** Heartbeat for recoverStaleSyncingStatus (works with Web Locks + IDB lease). */
  async writeHeartbeat(mode: SyncLockMode, now = Date.now()): Promise<void> {
    const db = await getDB();
    const payload: HeartbeatPayload = { holderId: this.holderId, at: now, mode };
    await db.put('sync_meta', { key: SYNC_HEARTBEAT_META_KEY, value: payload });
  }

  async clearHeartbeatIfMine(): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('sync_meta', 'readwrite');
    const store = tx.objectStore('sync_meta');
    const cur = parseHeartbeat(await store.get(SYNC_HEARTBEAT_META_KEY));
    if (cur && cur.holderId === this.holderId) {
      await store.delete(SYNC_HEARTBEAT_META_KEY);
    }
    await tx.done;
  }

  /**
   * Run `fn` under exclusive sync lock.
   * `fn` receives AbortSignal: on IDB lease loss the signal is aborted; `fn` must
   * stop before new cloud writes / local merge / outbox ACK. Web Locks path is
   * unchanged (signal never aborted by the lock layer).
   */
  async withSyncLock<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<SyncLockResult<T>> {
    if (this.inProcessHeld) return busy('in-process');

    if (hasWebLocks()) {
      let result: SyncLockResult<T> | undefined;
      let error: unknown;
      await navigator.locks!.request(SYNC_LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          result = busy('web-locks');
          return;
        }
        this.inProcessHeld = true;
        // Web Locks path unchanged: heartbeat only; signal is never aborted here.
        const ac = new AbortController();
        const renewTimer = setInterval(() => {
          void this.writeHeartbeat('web-locks');
        }, this.renewMs);
        try {
          await this.writeHeartbeat('web-locks');
          result = { ok: true, value: await fn(ac.signal), lockMode: 'web-locks' };
        } catch (e) {
          error = e;
        } finally {
          clearInterval(renewTimer);
          this.inProcessHeld = false;
          await this.clearHeartbeatIfMine();
        }
      });
      if (error) throw error;
      return result ?? busy('web-locks');
    }

    const got = await this.tryAcquireIdbLease();
    if (!got) return busy('idb-lease');

    this.inProcessHeld = true;
    const ac = new AbortController();
    const renewTimer = setInterval(() => {
      void (async () => {
        const r = await this.renewIdbLease();
        if (r === 'lost') {
          clearInterval(renewTimer);
          // Abort first so in-flight fn checkpoints stop; do NOT release the new lease.
          if (!ac.signal.aborted) {
            ac.abort(new SyncLeaseLostError());
          }
        } else {
          await this.writeHeartbeat('idb-lease');
        }
      })();
    }, this.renewMs);

    try {
      await this.writeHeartbeat('idb-lease');
      const value = await fn(ac.signal);
      // If renew aborted while fn ignored the signal, still fail closed.
      throwIfSyncAborted(ac.signal);
      return { ok: true, value, lockMode: 'idb-lease' };
    } finally {
      clearInterval(renewTimer);
      this.inProcessHeld = false;
      await this.releaseIdbLease();
      await this.clearHeartbeatIfMine();
    }
  }
}

/** Default session for the running page. */
const defaultSession = new SyncLockSession();

export function getDefaultSyncLockSession(): SyncLockSession {
  return defaultSession;
}

/** Test-only: route withSyncLock through an independent session (multi-tab). */
let sessionOverrideForTests: SyncLockSession | null = null;

export function setSyncLockSessionForTests(session: SyncLockSession | null): void {
  sessionOverrideForTests = session;
}

/** Production helper — uses the page's default session (or test override). */
export async function withSyncLock<T>(
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<SyncLockResult<T>> {
  return (sessionOverrideForTests ?? defaultSession).withSyncLock(fn);
}

export async function readLeaseForTests(): Promise<LeasePayload | null> {
  const db = await getDB();
  return parseLease(await db.get('sync_meta', SYNC_LEASE_META_KEY));
}

export async function readHeartbeatForTests(): Promise<HeartbeatPayload | null> {
  const db = await getDB();
  return parseHeartbeat(await db.get('sync_meta', SYNC_HEARTBEAT_META_KEY));
}

export async function seedForeignLeaseForTests(ttlMs = SYNC_LEASE_TTL_MS): Promise<void> {
  const db = await getDB();
  await db.put('sync_meta', {
    key: SYNC_LEASE_META_KEY,
    value: { holderId: 'foreign-holder', expiresAt: Date.now() + ttlMs } satisfies LeasePayload,
  });
}

export async function clearLeaseForTests(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('sync_meta', 'readwrite');
  await tx.objectStore('sync_meta').delete(SYNC_LEASE_META_KEY);
  await tx.objectStore('sync_meta').delete(SYNC_HEARTBEAT_META_KEY);
  await tx.done;
}

export function resetTabLockForTests(): void {
  sessionOverrideForTests = null;
  // Default session in-process flag cannot be fully reset across instances;
  // tests should prefer SyncLockSession. Create fresh sessions for multi-tab.
  (defaultSession as unknown as { inProcessHeld: boolean }).inProcessHeld = false;
}

/** Any non-expired lease exists (any holder). */
export async function hasActiveLease(now = Date.now()): Promise<boolean> {
  const db = await getDB();
  const cur = parseLease(await db.get('sync_meta', SYNC_LEASE_META_KEY));
  return !!cur && cur.expiresAt > now;
}

/** Fresh heartbeat within TTL (Web Locks path has no IDB lease). */
export async function hasFreshHeartbeat(now = Date.now(), ttlMs = SYNC_LEASE_TTL_MS): Promise<boolean> {
  const db = await getDB();
  const hb = parseHeartbeat(await db.get('sync_meta', SYNC_HEARTBEAT_META_KEY));
  return !!hb && now - hb.at < ttlMs;
}

/** Cross-tab: is Web Lock currently held/pending? */
export async function isWebSyncLockHeld(): Promise<boolean> {
  if (!hasWebLocks() || typeof navigator.locks!.query !== 'function') return false;
  try {
    const state = await navigator.locks!.query();
    const match = (l: { name?: string } | null | undefined) => l?.name === SYNC_LOCK_NAME;
    return (state.held?.some(match) ?? false) || (state.pending?.some(match) ?? false);
  } catch {
    return false;
  }
}
