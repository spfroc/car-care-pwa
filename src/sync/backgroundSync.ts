/**
 * M3-B progressive Background Sync helpers.
 * Never required for correctness — outbox in IDB is the source of truth.
 */

export const OUTBOX_SYNC_TAG = 'car-care-outbox';
export const BG_SYNC_MESSAGE_TYPE = 'car-care-bg-sync';

export type BgSyncSupport =
  | { supported: true }
  | { supported: false; reason: string };

export function detectBackgroundSyncSupport(): BgSyncSupport {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false, reason: 'no-service-worker' };
  }
  try {
    if (typeof ServiceWorkerRegistration === 'undefined') {
      return { supported: false, reason: 'no-sw-registration' };
    }
    if (!('sync' in ServiceWorkerRegistration.prototype)) {
      return { supported: false, reason: 'sync-api-unavailable' };
    }
  } catch {
    return { supported: false, reason: 'sync-detect-failed' };
  }
  return { supported: true };
}

export async function registerBackgroundOutboxSync(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const det = detectBackgroundSyncSupport();
  if (!det.supported) return { ok: false, reason: det.reason };
  try {
    const reg = await navigator.serviceWorker.ready;
    const syncManager = (
      reg as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    ).sync;
    if (!syncManager || typeof syncManager.register !== 'function') {
      return { ok: false, reason: 'sync-api-unavailable' };
    }
    await syncManager.register(OUTBOX_SYNC_TAG);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export type BgSyncMessageHandler = () => void | Promise<void>;

/** Subscribe to SW postMessage for our sync tag. Returns unsubscribe. */
export function listenBackgroundSyncMessages(handler: BgSyncMessageHandler): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }
  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if ((data as { type?: string }).type !== BG_SYNC_MESSAGE_TYPE) return;
    void handler();
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}
