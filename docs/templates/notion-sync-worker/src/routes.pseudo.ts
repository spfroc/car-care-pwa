// SUPERSEDED by runnable *.ts in this directory (D1). Kept for design diff.
/**
 * PSEUDOCODE ONLY — not imported by the PWA build.
 * Notion Sync Worker route sketch (O1 template).
 * Secrets: NOTION_TOKEN, GATEWAY_API_KEY, ALLOWED_ORIGIN — never log or echo.
 */

export type GatewayEnv = {
  NOTION_TOKEN: string;
  GATEWAY_API_KEY: string;
  ALLOWED_ORIGIN: string;
};

/** MVP auth: compare Bearer to GATEWAY_API_KEY (constant-time in real impl). */
export function assertBearer(req: Request, env: GatewayEnv): void {
  const h = req.headers.get('Authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token || token !== env.GATEWAY_API_KEY) {
    throw { status: 401, code: 'unauthorized' };
  }
}

/**
 * Route table (illustrative):
 *   GET  /health
 *   GET  /verify          -> { ok, workspaceKey, dataSources? }
 *   GET  /sync/pull       -> { rows: CloudRow[], serverCursor? }
 *   POST /sync/push       -> PushResult  (see lww.pseudo.ts)
 *   POST /sync/snapshot   -> PushResult
 *   POST /auth/*          -> D4 only
 *
 * CORS: Allow-Origin = env.ALLOWED_ORIGIN only.
 * Notion-Version: 2026-03-11 on all api.notion.com calls.
 */
export async function handleRequest(_req: Request, _env: GatewayEnv): Promise<Response> {
  throw new Error('pseudocode: implement in user-owned Worker; not part of app bundle');
}
