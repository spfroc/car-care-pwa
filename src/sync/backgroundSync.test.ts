import { describe, expect, it, vi } from 'vitest';
import {
  BG_SYNC_MESSAGE_TYPE,
  detectBackgroundSyncSupport,
  listenBackgroundSyncMessages,
  registerBackgroundOutboxSync,
} from './backgroundSync';

describe('backgroundSync progressive helpers', () => {
  it('T8: missing SW → unsupported / register fails soft', async () => {
    vi.stubGlobal('navigator', {});
    expect(detectBackgroundSyncSupport().supported).toBe(false);
    const r = await registerBackgroundOutboxSync();
    expect(r.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it('listen no-ops without serviceWorker', () => {
    vi.stubGlobal('navigator', {});
    const unsub = listenBackgroundSyncMessages(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
    vi.unstubAllGlobals();
  });

  it('T9: message handler fires on our type', () => {
    const listeners = new Map<string, Set<EventListener>>();
    const sw = {
      addEventListener: (type: string, fn: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        listeners.get(type)?.delete(fn);
      },
    };
    vi.stubGlobal('navigator', { serviceWorker: sw });
    const spy = vi.fn();
    const unsub = listenBackgroundSyncMessages(spy);
    const msg = new MessageEvent('message', {
      data: { type: BG_SYNC_MESSAGE_TYPE, tag: 'car-care-outbox' },
    });
    for (const fn of listeners.get('message') ?? []) fn(msg);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
    vi.unstubAllGlobals();
  });
});
