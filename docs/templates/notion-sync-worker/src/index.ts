/**
 * Notion Sync Worker Gateway — user-owned reference implementation (M3-D D1).
 * Secrets: NOTION_TOKEN, GATEWAY_API_KEY — never log or echo.
 * Do not deploy as a shared multi-tenant service for all PWA users.
 */
import { assertGatewayAuth } from './auth.ts';
import { corsHeaders, originAllowed } from './cors.ts';
import { getBotMe, searchDataSources } from './notion.ts';
import { pullAll } from './pull.ts';
import { pushOps } from './push.ts';
import type { EntityKind, GatewayEnv, SyncOutboxItem } from './types.ts';

function json(data: unknown, status: number, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function errResponse(e: any, cors: HeadersInit): Response {
  const status = typeof e?.status === 'number' ? e.status : 500;
  const code = e?.code || (status === 401 ? 'unauthorized' : 'bad_request');
  return json({ ok: false, code, message: e?.message || 'error' }, status, cors);
}

async function workspaceKeyFromEnv(env: GatewayEnv): Promise<{ workspaceKey: string; botName?: string }> {
  const me = await getBotMe(env);
  const workspaceKey =
    me?.bot?.workspace_id || me?.id || 'notion-workspace';
  const botName = me?.name;
  return { workspaceKey, botName };
}

export default {
  async fetch(req: Request, env: GatewayEnv): Promise<Response> {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') {
      if (!originAllowed(req, env) && req.headers.get('Origin')) {
        return json({ ok: false, code: 'forbidden', message: 'Origin not allowed' }, 403, cors);
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (req.headers.get('Origin') && !originAllowed(req, env)) {
      return json({ ok: false, code: 'forbidden', message: 'Origin not allowed' }, 403, cors);
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (req.method === 'GET' && path === '/health') {
        // Health requires auth to avoid open probes leaking version on misconfig? Spec says Bearer.
        assertGatewayAuth(req, env);
        return json(
          { ok: true, version: env.GATEWAY_VERSION || 'm3d-d1' },
          200,
          cors,
        );
      }

      assertGatewayAuth(req, env);

      if (req.method === 'GET' && path === '/verify') {
        if (!env.NOTION_TOKEN) {
          return json(
            { ok: false, code: 'notion_unavailable', message: 'NOTION_TOKEN secret missing' },
            503,
            cors,
          );
        }
        const { workspaceKey, botName } = await workspaceKeyFromEnv(env);
        let vehicles = env.VEHICLES_DATA_SOURCE_ID;
        let records = env.RECORDS_DATA_SOURCE_ID;
        if (!vehicles || !records) {
          const search = await searchDataSources(env);
          for (const r of search.results || []) {
            const title = (r.title || []).map((t: any) => t.plain_text).join('') || r.name || '';
            if (!vehicles && /vehicle/i.test(title)) vehicles = r.id;
            if (!records && /record/i.test(title)) records = r.id;
          }
        }
        return json(
          {
            ok: true,
            workspaceKey,
            botName,
            dataSources: { vehicles: vehicles || null, records: records || null },
          },
          200,
          cors,
        );
      }

      if (req.method === 'GET' && path === '/sync/pull') {
        const { workspaceKey } = await workspaceKeyFromEnv(env);
        const entitiesParam = url.searchParams.get('entities') || 'vehicles,records';
        const entities = entitiesParam
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is EntityKind => s === 'vehicles' || s === 'records');
        const snap = await pullAll(env, workspaceKey, entities);
        return json(snap, 200, cors);
      }

      if (req.method === 'POST' && path === '/sync/push') {
        const { workspaceKey } = await workspaceKeyFromEnv(env);
        const body = (await req.json()) as SyncOutboxItem[] | { ops: SyncOutboxItem[] };
        const ops = Array.isArray(body) ? body : body.ops;
        if (!Array.isArray(ops)) {
          return json({ ok: false, code: 'bad_request', message: 'ops array required' }, 400, cors);
        }
        const result = await pushOps(env, workspaceKey, ops);
        return json(result, 200, cors);
      }

      if (req.method === 'POST' && path === '/sync/snapshot') {
        const { workspaceKey } = await workspaceKeyFromEnv(env);
        const body = (await req.json()) as { rows?: any[] } | any[];
        const rows = Array.isArray(body) ? body : body.rows || [];
        const ops: SyncOutboxItem[] = rows.map((r: any, i: number) => ({
          id: `snap-${i}-${r.id}`,
          entity: r.entity,
          entityId: r.id,
          op: r.deletedAt ? 'delete' : 'upsert',
          mutatedAt: r.updatedAt,
          payload: r.payload,
          deviceId: r.deviceId,
        }));
        const result = await pushOps(env, workspaceKey, ops);
        return json(result, 200, cors);
      }

      if (path.startsWith('/auth/')) {
        return json({ ok: false, code: 'not_implemented', message: 'D4 JWT auth not in D1' }, 501, cors);
      }

      return json({ ok: false, code: 'bad_request', message: 'not found' }, 404, cors);
    } catch (e: any) {
      return errResponse(e, cors);
    }
  },
};
