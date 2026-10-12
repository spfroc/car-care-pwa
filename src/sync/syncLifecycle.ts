/**
 * M3-B: wire Background Sync messages + stale status recovery into app lifecycle.
 *
 * Important: Background Sync does NOT guarantee upload when the page is closed.
 * The SW only postMessages open clients; without an open page, outbox stays in IDB
 * until the next manual sync or app start (+ optional online register).
 */

import { listenBackgroundSyncMessages, registerBackgroundOutboxSync } from './backgroundSync';
import * as engine from './engine';

export type SyncLifecycleHandles = {
  stop: () => void;
};

let installed = false;
let unsubMessage: (() => void) | null = null;
let onlineHandler: (() => void) | null = null;

/**
 * Install once per page:
 * - recover stuck `syncing` (Web Locks + lease + heartbeat aware)
 * - on BG Sync SW message → engine.bidirectionalSync() (already exclusive; no double-lock)
 * - on `online` → best-effort register BG Sync tag (manual sync remains primary)
 */
export function installSyncLifecycle(): SyncLifecycleHandles {
  if (installed) {
    return { stop: () => uninstallSyncLifecycle() };
  }
  installed = true;

  void engine.recoverStaleSyncingStatus();

  unsubMessage = listenBackgroundSyncMessages(() => {
    // Entry is already wrapped with withSyncLock — do not nest another lock.
    void engine.bidirectionalSync();
  });

  onlineHandler = () => {
    void registerBackgroundOutboxSync();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onlineHandler);
  }

  return { stop: () => uninstallSyncLifecycle() };
}

export function uninstallSyncLifecycle(): void {
  unsubMessage?.();
  unsubMessage = null;
  if (onlineHandler && typeof window !== 'undefined') {
    window.removeEventListener('online', onlineHandler);
  }
  onlineHandler = null;
  installed = false;
}

/** Test helper */
export function resetSyncLifecycleForTests(): void {
  uninstallSyncLifecycle();
}
