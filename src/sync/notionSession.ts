/**
 * In-memory Notion Gateway session (D2 §3.5.5).
 * Never persist bearer into CloudStorageConfig / IDB / export.
 * Optional sessionStorage is same-tab refresh only — cold start still requires re-entry (D2.8).
 */

export interface NotionRuntimeSession {
  bearer: string;
  /** Empty until /verify succeeds; enqueue requires non-empty (hasValidNotionRuntimeSession). */
  workspaceKey: string;
  expiresAt?: number;
}

const SESSION_STORAGE_KEY = 'car-care-notion-runtime-session';

let runtimeSession: NotionRuntimeSession | null = null;
let hydrated = false;

function canUseSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readSessionStorage(): NotionRuntimeSession | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NotionRuntimeSession>;
    const bearer = typeof parsed.bearer === 'string' ? parsed.bearer.trim() : '';
    if (!bearer) return null;
    const workspaceKey =
      typeof parsed.workspaceKey === 'string' ? parsed.workspaceKey.trim() : '';
    const expiresAt =
      typeof parsed.expiresAt === 'number' ? parsed.expiresAt : undefined;
    if (expiresAt != null && Date.now() >= expiresAt) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return { bearer, workspaceKey, expiresAt };
  } catch {
    return null;
  }
}

function writeSessionStorage(session: NotionRuntimeSession | null): void {
  if (!canUseSessionStorage()) return;
  try {
    if (!session) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        bearer: session.bearer,
        workspaceKey: session.workspaceKey,
        expiresAt: session.expiresAt,
      }),
    );
  } catch {
    /* quota / private mode — memory still works */
  }
}

function hydrateOnce(): void {
  if (hydrated) return;
  hydrated = true;
  if (runtimeSession) return;
  runtimeSession = readSessionStorage();
}

export function getNotionRuntimeSession(): NotionRuntimeSession | null {
  hydrateOnce();
  if (!runtimeSession) return null;
  if (runtimeSession.expiresAt != null && Date.now() >= runtimeSession.expiresAt) {
    runtimeSession = null;
    writeSessionStorage(null);
    return null;
  }
  return runtimeSession;
}

/** True when bearer + workspaceKey are present (post-verify). URL alone is insufficient. */
export function hasValidNotionRuntimeSession(): boolean {
  const s = getNotionRuntimeSession();
  return Boolean(s?.bearer && s.workspaceKey);
}

/**
 * Set or replace the in-memory session.
 * Bearer-only (empty workspaceKey) is allowed so /verify can run before workspaceKey is known;
 * enqueue stays gated by hasValidNotionRuntimeSession().
 */
export function setNotionRuntimeSession(session: NotionRuntimeSession | null): void {
  hydrated = true;
  if (!session) {
    runtimeSession = null;
    writeSessionStorage(null);
    return;
  }
  const bearer = session.bearer.trim();
  if (!bearer) {
    runtimeSession = null;
    writeSessionStorage(null);
    return;
  }
  runtimeSession = {
    bearer,
    workspaceKey: session.workspaceKey.trim(),
    expiresAt: session.expiresAt,
  };
  writeSessionStorage(runtimeSession);
}

/** Store Gateway API Key before /verify (workspaceKey filled after success). */
export function setNotionSessionBearer(bearer: string, opts?: { expiresAt?: number }): void {
  const prev = getNotionRuntimeSession();
  setNotionRuntimeSession({
    bearer,
    workspaceKey: prev?.workspaceKey ?? '',
    expiresAt: opts?.expiresAt ?? prev?.expiresAt,
  });
}

/** Clear on 401 / disconnectCloud / signOut / cold start. */
export function clearNotionRuntimeSession(): void {
  hydrated = true;
  runtimeSession = null;
  writeSessionStorage(null);
}

/** Test-only reset (also clears optional sessionStorage). */
export function resetNotionRuntimeSessionForTests(): void {
  hydrated = true;
  runtimeSession = null;
  writeSessionStorage(null);
}

/** Test helper: sessionStorage key used for same-tab convenience. */
export function notionSessionStorageKeyForTests(): string {
  return SESSION_STORAGE_KEY;
}
