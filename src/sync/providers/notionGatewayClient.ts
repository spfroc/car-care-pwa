/**
 * Notion BYO Gateway HTTP client (D2-P1).
 * Speaks CONTRACT.md only — no Notion SDK, no Integration Token.
 */

import { nowISO } from '../../lib/constants';
import type {
  CloudRow,
  CloudSnapshot,
  PushResult,
  SyncEntity,
  SyncOutboxItem,
  VerifyResult,
} from '../types';
import { clearNotionRuntimeSession } from '../notionSession';

export type GatewayFetch = typeof fetch;

export type NotionGatewayClientOptions = {
  baseUrl: string;
  /** Session Gateway API Key (Bearer). Never log. */
  getBearer: () => string | null;
  fetchImpl?: GatewayFetch;
  /** Called on HTTP 401 before session clear hook. */
  onUnauthorized?: () => void;
};

export class NotionGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(opts: { status: number; code: string; message: string; retryable?: boolean }) {
    super(opts.message);
    this.name = 'NotionGatewayError';
    this.status = opts.status;
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
  }
}

type GatewayPushConflict = {
  id?: string;
  opId?: string;
  entity?: string;
  reason?: string;
  attemptedAt?: string;
  cloudRow?: CloudRow;
  message?: string;
};

type GatewayPushError = {
  id?: string;
  entity?: string;
  code?: string;
  message?: string;
  retryable?: boolean;
};

type GatewayPushResultRaw = {
  applied?: string[];
  conflicts?: GatewayPushConflict[];
  errors?: GatewayPushError[];
  error?: string;
};

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** Map Gateway JSON → PWA PushResult (§3.5.2–3): id→opId; errors never in applied. */
export function adaptGatewayPushResult(raw: GatewayPushResultRaw): PushResult {
  const applied = Array.isArray(raw.applied) ? raw.applied.filter((x) => typeof x === 'string') : [];
  const appliedSet = new Set(applied);

  const conflicts: PushResult['conflicts'] = [];
  for (const c of raw.conflicts ?? []) {
    const opId = (typeof c.opId === 'string' && c.opId) || (typeof c.id === 'string' && c.id) || '';
    if (!opId) continue;
    const reason = typeof c.reason === 'string' ? c.reason : 'conflict';
    // cloud_newer / skipped_deleted / ambiguous_race must never be treated as applied
    if (appliedSet.has(opId)) appliedSet.delete(opId);
    const cloud = c.cloudRow;
    conflicts.push({
      opId,
      reason,
      entity: c.entity as SyncEntity | string | undefined,
      entityId: cloud?.id,
      cloudUpdatedAt: cloud?.updatedAt,
      attemptedAt: typeof c.attemptedAt === 'string' ? c.attemptedAt : undefined,
      cloudRow: cloud,
    });
  }

  const errors: NonNullable<PushResult['errors']> = [];
  for (const e of raw.errors ?? []) {
    const opId = typeof e.id === 'string' ? e.id : '';
    if (!opId) continue;
    if (appliedSet.has(opId)) appliedSet.delete(opId);
    errors.push({
      opId,
      entity: e.entity as SyncEntity | string | undefined,
      code: typeof e.code === 'string' ? e.code : 'error',
      message: typeof e.message === 'string' ? e.message : 'Gateway error',
      retryable: Boolean(e.retryable),
    });
  }

  return {
    applied: [...appliedSet],
    conflicts,
    errors: errors.length ? errors : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
  };
}

function mapOutboxForGateway(ops: SyncOutboxItem[]): Array<Record<string, unknown>> {
  return ops.map((op) => ({
    id: op.opId,
    entity: op.entity,
    entityId: op.entityId,
    op: op.op,
    mutatedAt: op.mutatedAt,
    payload: op.payload,
  }));
}

export class NotionGatewayClient {
  readonly baseUrl: string;
  private getBearer: () => string | null;
  private fetchImpl: GatewayFetch;
  private onUnauthorized?: () => void;

  constructor(opts: NotionGatewayClientOptions) {
    this.baseUrl = trimSlash(opts.baseUrl.trim());
    this.getBearer = opts.getBearer;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.onUnauthorized = opts.onUnauthorized;
  }

  private authHeaders(): HeadersInit {
    const bearer = this.getBearer()?.trim();
    if (!bearer) {
      throw new NotionGatewayError({
        status: 401,
        code: 'unauthorized',
        message: '缺少 Gateway API Key，请重新输入会话密钥',
      });
    }
    return {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
    };
  }

  private handleUnauthorized(): void {
    this.onUnauthorized?.();
    clearNotionRuntimeSession();
  }

  private async parseJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text.slice(0, 200) };
    }
  }

  private async request(
    method: string,
    path: string,
    opts?: { body?: unknown; signal?: AbortSignal },
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {
      ...(this.authHeaders() as Record<string, string>),
    };
    let body: string | undefined;
    if (opts?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: opts?.signal,
      });
    } catch (e) {
      if (isAbortError(e) || opts?.signal?.aborted) {
        throw new NotionGatewayError({
          status: 0,
          code: 'aborted',
          message: '请求已中止；未确认写入，队列不 ACK',
          retryable: true,
        });
      }
      throw new NotionGatewayError({
        status: 0,
        code: 'network_error',
        message: e instanceof Error ? e.message : '网络错误',
        retryable: true,
      });
    }

    const parsed = await this.parseJson(res);

    if (res.status === 401) {
      this.handleUnauthorized();
      const msg =
        (parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message?: unknown }).message ?? '')
          : '') || 'Gateway API Key 无效或已失效，请重新输入';
      throw new NotionGatewayError({ status: 401, code: 'unauthorized', message: msg });
    }

    if (res.status === 403) {
      const code =
        parsed && typeof parsed === 'object' && 'code' in parsed
          ? String((parsed as { code?: unknown }).code ?? 'forbidden')
          : 'forbidden';
      const rawMsg =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message?: unknown }).message ?? '')
          : '';
      const message =
        /origin/i.test(rawMsg) || code === 'forbidden'
          ? 'Origin 未在 Worker ALLOWED_ORIGIN 中；请改 CORS 配置，不是换 Key'
          : rawMsg || '禁止访问（403）';
      throw new NotionGatewayError({ status: 403, code, message });
    }

    if (res.status === 429) {
      throw new NotionGatewayError({
        status: 429,
        code: 'rate_limited',
        message: '请求过于频繁，请稍后重试',
        retryable: true,
      });
    }

    if (res.status === 503 || res.status >= 500) {
      const code =
        parsed && typeof parsed === 'object' && 'code' in parsed
          ? String((parsed as { code?: unknown }).code ?? 'notion_unavailable')
          : 'notion_unavailable';
      const message =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message?: unknown }).message ?? '服务暂不可用')
          : '服务暂不可用';
      throw new NotionGatewayError({
        status: res.status,
        code,
        message,
        retryable: true,
      });
    }

    if (!res.ok) {
      const code =
        parsed && typeof parsed === 'object' && 'code' in parsed
          ? String((parsed as { code?: unknown }).code ?? 'bad_request')
          : 'bad_request';
      const message =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message?: unknown }).message ?? `HTTP ${res.status}`)
          : `HTTP ${res.status}`;
      throw new NotionGatewayError({
        status: res.status,
        code,
        message,
        retryable: false,
      });
    }

    return { status: res.status, body: parsed };
  }

  async verify(signal?: AbortSignal): Promise<VerifyResult> {
    try {
      const { body } = await this.request('GET', '/verify', { signal });
      if (!body || typeof body !== 'object') {
        return { ok: false, error: 'verify 响应无效' };
      }
      const b = body as {
        ok?: boolean;
        workspaceKey?: string;
        botName?: string;
        error?: string;
        message?: string;
      };
      if (b.ok === false) {
        return { ok: false, error: b.error || b.message || 'verify 失败' };
      }
      const workspaceKey = typeof b.workspaceKey === 'string' ? b.workspaceKey : undefined;
      if (!workspaceKey) {
        return { ok: false, error: 'verify 未返回 workspaceKey' };
      }
      return {
        ok: true,
        userId: workspaceKey,
        email: typeof b.botName === 'string' ? b.botName : undefined,
      };
    } catch (e) {
      if (e instanceof NotionGatewayError) {
        return { ok: false, error: e.message };
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async pullAll(signal?: AbortSignal): Promise<CloudSnapshot> {
    const { body } = await this.request('GET', '/sync/pull?entities=vehicles,records', {
      signal,
    });
    const rows =
      body && typeof body === 'object' && Array.isArray((body as { rows?: unknown }).rows)
        ? ((body as { rows: CloudRow[] }).rows)
        : [];
    return { rows, pulledAt: nowISO() };
  }

  async pushOps(ops: SyncOutboxItem[], signal?: AbortSignal): Promise<PushResult> {
    try {
      const { body } = await this.request('POST', '/sync/push', {
        body: { ops: mapOutboxForGateway(ops) },
        signal,
      });
      return adaptGatewayPushResult((body ?? {}) as GatewayPushResultRaw);
    } catch (e) {
      if (e instanceof NotionGatewayError && e.code === 'aborted') {
        // Abort must not ACK — empty applied
        return { applied: [], conflicts: [], error: e.message };
      }
      if (e instanceof NotionGatewayError) {
        return {
          applied: [],
          conflicts: [],
          error: e.message,
          errors: ops.map((op) => ({
            opId: op.opId,
            entity: op.entity,
            code: e.code,
            message: e.message,
            retryable: e.retryable,
          })),
        };
      }
      throw e;
    }
  }

  async pushSnapshot(rows: CloudRow[], signal?: AbortSignal): Promise<PushResult> {
    try {
      const { body } = await this.request('POST', '/sync/snapshot', {
        body: { rows },
        signal,
      });
      return adaptGatewayPushResult((body ?? {}) as GatewayPushResultRaw);
    } catch (e) {
      if (e instanceof NotionGatewayError && e.code === 'aborted') {
        return { applied: [], conflicts: [], error: e.message };
      }
      if (e instanceof NotionGatewayError) {
        return { applied: [], conflicts: [], error: e.message };
      }
      throw e;
    }
  }
}
