/**
 * In-memory Notion Gateway session (D2 §3.5.5).
 * Never persist bearer into CloudStorageConfig / IDB / export.
 */

export interface NotionRuntimeSession {
  bearer: string;
  workspaceKey: string;
  expiresAt?: number;
}

let runtimeSession: NotionRuntimeSession | null = null;

export function getNotionRuntimeSession(): NotionRuntimeSession | null {
  if (!runtimeSession) return null;
  if (runtimeSession.expiresAt != null && Date.now() >= runtimeSession.expiresAt) {
    runtimeSession = null;
    return null;
  }
  return runtimeSession;
}

export function hasValidNotionRuntimeSession(): boolean {
  const s = getNotionRuntimeSession();
  return Boolean(s?.bearer && s.workspaceKey);
}

export function setNotionRuntimeSession(session: NotionRuntimeSession | null): void {
  if (!session) {
    runtimeSession = null;
    return;
  }
  const bearer = session.bearer.trim();
  const workspaceKey = session.workspaceKey.trim();
  if (!bearer || !workspaceKey) {
    runtimeSession = null;
    return;
  }
  runtimeSession = {
    bearer,
    workspaceKey,
    expiresAt: session.expiresAt,
  };
}

/** Clear on 401 / disconnectCloud / signOut / cold start. */
export function clearNotionRuntimeSession(): void {
  runtimeSession = null;
}

/** Test-only reset. */
export function resetNotionRuntimeSessionForTests(): void {
  runtimeSession = null;
}
