/**
 * In-memory Notion Gateway session (D2 §3.5.5).
 * Never persist bearer into CloudStorageConfig / IDB / export.
 * Optional sessionStorage is same-tab refresh only — cold start still requires re-entry (D2.8).
 *
 * RR-WK: after successful /verify, session also holds gatewayKeyFp (sha256(bearer)[0:12]).
 */

export interface NotionRuntimeSession {
  bearer: string;
  /** Empty until /verify succeeds; enqueue requires non-empty (hasValidNotionRuntimeSession). */
  workspaceKey: string;
  /**
   * RR-WK: sha256_hex(bearer)[0:12] stamped after successful /verify.
   * Same lifecycle as bearer (sessionStorage); cold start still requires re-entry + verify.
   */
  gatewayKeyFp?: string;
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
    const gatewayKeyFp =
      typeof parsed.gatewayKeyFp === 'string' && parsed.gatewayKeyFp.trim()
        ? parsed.gatewayKeyFp.trim().toLowerCase()
        : undefined;
    const expiresAt =
      typeof parsed.expiresAt === 'number' ? parsed.expiresAt : undefined;
    if (expiresAt != null && Date.now() >= expiresAt) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return { bearer, workspaceKey, gatewayKeyFp, expiresAt };
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
        gatewayKeyFp: session.gatewayKeyFp,
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
 * RR-WK: verified session with composite identity (bearer + workspaceKey + gatewayKeyFp).
 * Required for Notion enqueue/flush when target guard is active.
 */
export function hasAttestedNotionRuntimeSession(): boolean {
  const s = getNotionRuntimeSession();
  return Boolean(s?.bearer && s.workspaceKey && s.gatewayKeyFp);
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
  const fp =
    typeof session.gatewayKeyFp === 'string' && session.gatewayKeyFp.trim()
      ? session.gatewayKeyFp.trim().toLowerCase()
      : undefined;
  runtimeSession = {
    bearer,
    workspaceKey: session.workspaceKey.trim(),
    gatewayKeyFp: fp,
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
    // Changing bearer invalidates prior keyFp until next successful verify
    gatewayKeyFp: undefined,
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
