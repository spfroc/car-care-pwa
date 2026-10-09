import { useCallback, useEffect, useMemo, useState } from 'react';

/** Chromium BeforeInstallPromptEvent (not in all TS libs). */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'car-care-pwa-install-dismissed';
const INSTALLED_FLAG = 'car-care-pwa-installed-once';

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)').matches;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(mq || iosStandalone);
}

function detectPlatform(): 'ios' | 'android' | 'desktop' | 'unknown' {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux/i.test(ua)) return 'desktop';
  return 'unknown';
}

export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installedToast, setInstalledToast] = useState(false);
  const [standalone, setStandalone] = useState(isStandaloneDisplay);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const platform = useMemo(() => detectPlatform(), []);

  useEffect(() => {
    const sync = () => setStandalone(isStandaloneDisplay());
    sync();
    const mq = window.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', sync);
    return () => mq?.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      try {
        localStorage.setItem(INSTALLED_FLAG, '1');
      } catch {
        /* ignore */
      }
      setInstalledToast(true);
      setStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);

    // Already running as installed PWA: one-shot toast if just opened first time after flag
    if (isStandaloneDisplay()) {
      try {
        if (localStorage.getItem(INSTALLED_FLAG) === 'pending') {
          localStorage.setItem(INSTALLED_FLAG, '1');
          setInstalledToast(true);
        }
      } catch {
        /* ignore */
      }
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismissBanner = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return { outcome: 'unavailable' as const };
    try {
      localStorage.setItem(INSTALLED_FLAG, 'pending');
    } catch {
      /* ignore */
    }
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === 'accepted') {
      // appinstalled may follow; keep pending for standalone toast fallback
    } else {
      try {
        localStorage.removeItem(INSTALLED_FLAG);
      } catch {
        /* ignore */
      }
    }
    return choice;
  }, [deferred]);

  const dismissToast = useCallback(() => setInstalledToast(false), []);

  const canNativePrompt = Boolean(deferred) && !standalone;
  const showInstallHint = !standalone && !dismissed;

  return {
    platform,
    standalone,
    canNativePrompt,
    showInstallHint,
    installedToast,
    dismissBanner,
    dismissToast,
    promptInstall,
  };
}
