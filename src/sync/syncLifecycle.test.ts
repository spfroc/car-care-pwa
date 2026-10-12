import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDB } from '../db';
import { BG_SYNC_MESSAGE_TYPE } from './backgroundSync';
import { setCloudProviderForTests } from './engine';
import { MemoryCloudProvider } from './providers/memory';
import {
  installSyncLifecycle,
  resetSyncLifecycleForTests,
} from './syncLifecycle';
import { clearLeaseForTests, resetTabLockForTests } from './tabLock';

async function resetDb() {
  const db = await getDB();
  for (const s of ['vehicles', 'records', 'stations', 'media', 'sync_outbox', 'sync_meta'] as const) {
    await db.clear(s);
  }
}

describe('syncLifecycle BG Sync message → locked sync (E2E-ish)', () => {
  let listeners: Map<string, Set<EventListener>>;

  beforeEach(async () => {
    resetSyncLifecycleForTests();
    resetTabLockForTests();
    await resetDb();
    await clearLeaseForTests();
    listeners = new Map();
    const sw = {
      addEventListener: (type: string, fn: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        listeners.get(type)?.delete(fn);
      },
      ready: Promise.resolve({
        sync: undefined,
      }),
    };
    vi.stubGlobal('navigator', {
      serviceWorker: sw,
      onLine: true,
      locks: undefined,
    });
    setCloudProviderForTests(new MemoryCloudProvider());
  });

  afterEach(() => {
    resetSyncLifecycleForTests();
    setCloudProviderForTests(null);
    vi.unstubAllGlobals();
  });

  it('SW message triggers bidirectionalSync exactly once (already locked inside)', async () => {
    const engine = await import('./engine');
    const spy = vi.spyOn(engine, 'bidirectionalSync').mockResolvedValue({
      ok: true,
      message: 'mock-sync',
    });

    installSyncLifecycle();
    expect(listeners.get('message')?.size).toBe(1);

    const msg = new MessageEvent('message', {
      data: { type: BG_SYNC_MESSAGE_TYPE, tag: 'car-care-outbox' },
    });
    for (const fn of listeners.get('message') ?? []) fn(msg);
    // allow microtask
    await Promise.resolve();
    await Promise.resolve();

    expect(spy).toHaveBeenCalledTimes(1);
    // Must call the exported exclusive entry — not an unlocked internal
    spy.mockRestore();
  });

  it('ignores unrelated messages', async () => {
    const engine = await import('./engine');
    const spy = vi.spyOn(engine, 'bidirectionalSync').mockResolvedValue({
      ok: true,
      message: 'mock',
    });
    installSyncLifecycle();
    for (const fn of listeners.get('message') ?? []) {
      fn(new MessageEvent('message', { data: { type: 'other' } }));
    }
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
