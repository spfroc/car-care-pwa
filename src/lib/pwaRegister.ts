import { registerSW } from 'virtual:pwa-register';

type NeedRefreshListener = (need: boolean) => void;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
let needRefresh = false;
const listeners = new Set<NeedRefreshListener>();
let started = false;

function emit(need: boolean) {
  needRefresh = need;
  for (const l of listeners) l(need);
}

/**
 * Register the Vite PWA service worker once (prompt-to-update, not silent auto).
 * Safe to call from main and from React (idempotent).
 */
export function startPwaRegister(): void {
  if (started) return;
  started = true;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      emit(true);
    },
    onRegisteredSW(_swUrl, registration) {
      // Periodic check so long-lived installed PWAs notice new deploys.
      if (!registration) return;
      const hour = 60 * 60 * 1000;
      window.setInterval(() => {
        void registration.update().catch(() => {
          /* offline / network errors are fine */
        });
      }, hour);
    },
  });
}

export function subscribeNeedRefresh(listener: NeedRefreshListener): () => void {
  listeners.add(listener);
  listener(needRefresh);
  return () => {
    listeners.delete(listener);
  };
}

export function getNeedRefresh(): boolean {
  return needRefresh;
}

/** Activate waiting worker and reload. Call only after user consent. */
export async function applyWaitingUpdate(): Promise<void> {
  if (!updateSW) return;
  await updateSW(true);
}

/** Hide prompt for this session without activating (avoids silent reload loops). */
export function dismissUpdatePrompt(): void {
  emit(false);
}
