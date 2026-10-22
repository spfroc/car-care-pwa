/**
 * Tiny synchronous cache of shell preferences so the tab bar and language
 * can paint before IndexedDB opens. Not a source of truth — IDB wins on hydrate.
 */
const KEY = 'car-care-shell-boot';

export type ShellBootCache = {
  language?: string;
  hideBottomNav?: boolean;
};

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readShellBootCache(): ShellBootCache {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as ShellBootCache;
    return {
      language: typeof v.language === 'string' ? v.language : undefined,
      hideBottomNav: typeof v.hideBottomNav === 'boolean' ? v.hideBottomNav : undefined,
    };
  } catch {
    return {};
  }
}

export function writeShellBootCache(patch: ShellBootCache): void {
  const store = storage();
  if (!store) return;
  try {
    const prev = readShellBootCache();
    store.setItem(KEY, JSON.stringify({ ...prev, ...patch }));
  } catch {
    /* private mode / quota */
  }
}
