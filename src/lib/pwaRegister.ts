import { registerSW } from 'virtual:pwa-register';

let started = false;

/**
 * Register the Vite PWA service worker once (silent autoUpdate).
 * New waiting workers activate without a confirm banner; long-lived
 * installed PWAs still poll `registration.update()` hourly.
 * Safe to call from main (idempotent).
 */
export function startPwaRegister(): void {
  if (started) return;
  started = true;
  registerSW({
    immediate: true,
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
