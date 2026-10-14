import { afterEach, describe, expect, it } from 'vitest';
import {
  adaptGatewayPushResult,
  NotionGatewayClient,
  NotionGatewayError,
} from './notionGatewayClient';
import {
  clearNotionRuntimeSession,
  setNotionRuntimeSession,
  getNotionRuntimeSession,
  resetNotionRuntimeSessionForTests,
} from '../notionSession';
import type { SyncOutboxItem } from '../types';

function op(partial: Partial<SyncOutboxItem> & { opId: string }): SyncOutboxItem {
  return {
    entity: 'vehicles',
    entityId: 'v1',
    op: 'upsert',
    mutatedAt: '2026-10-14T00:00:00.000Z',
    attempts: 0,
    nextRetryAt: '2026-10-14T00:00:00.000Z',
    ...partial,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('adaptGatewayPushResult (§3.5.2–3)', () => {
  it('maps conflicts[].id → opId and strips those from applied', () => {
    const r = adaptGatewayPushResult({
      applied: ['a1', 'c1'],
      conflicts: [
        {
          id: 'c1',
          entity: 'vehicles',
          reason: 'cloud_newer',
          attemptedAt: '2026-10-14T01:00:00.000Z',
          cloudRow: {
            entity: 'vehicles',
            id: 'v1',
            payload: {},
            updatedAt: '2026-10-14T02:00:00.000Z',
          },
        },
        { id: 'c2', entity: 'records', reason: 'skipped_deleted', attemptedAt: 't' },
        { id: 'c3', entity: 'vehicles', reason: 'ambiguous_race', attemptedAt: 't' },
      ],
    });
    expect(r.applied).toEqual(['a1']);
    expect(r.conflicts.map((c) => c.opId)).toEqual(['c1', 'c2', 'c3']);
    expect(r.conflicts.every((c) => !r.applied.includes(c.opId))).toBe(true);
    expect(r.conflicts.find((c) => c.opId === 'c1')?.cloudUpdatedAt).toBe(
      '2026-10-14T02:00:00.000Z',
    );
  });

  it('maps errors[] and never leaves those opIds in applied', () => {
    const r = adaptGatewayPushResult({
      applied: ['ok1', 'bad1'],
      errors: [
        {
          id: 'bad1',
          entity: 'vehicles',
          code: 'payload_too_large',
          message: 'too big',
          retryable: false,
        },
        {
          id: 'bad2',
          entity: 'records',
          code: 'rate_limited',
          message: 'slow down',
          retryable: true,
        },
      ],
    });
    expect(r.applied).toEqual(['ok1']);
    expect(r.errors).toEqual([
      {
        opId: 'bad1',
        entity: 'vehicles',
        code: 'payload_too_large',
        message: 'too big',
        retryable: false,
      },
      {
        opId: 'bad2',
        entity: 'records',
        code: 'rate_limited',
        message: 'slow down',
        retryable: true,
      },
    ]);
  });
});

describe('NotionGatewayClient HTTP mapping (U1)', () => {
  afterEach(() => {
    resetNotionRuntimeSessionForTests();
  });

  function client(fetchImpl: typeof fetch) {
    setNotionRuntimeSession({ bearer: 'test-gateway-key', workspaceKey: 'ws-1' });
    return new NotionGatewayClient({
      baseUrl: 'https://gateway.example',
      getBearer: () => getNotionRuntimeSession()?.bearer ?? null,
      fetchImpl,
    });
  }

  it('verify maps workspaceKey → userId', async () => {
    const c = client(async () =>
      jsonResponse(200, { ok: true, workspaceKey: 'wk-abc', botName: 'Bot' }),
    );
    const r = await c.verify();
    expect(r).toEqual({ ok: true, userId: 'wk-abc', email: 'Bot' });
  });

  it('401 clears session and returns unauthorized', async () => {
    const c = client(async () =>
      jsonResponse(401, { ok: false, code: 'unauthorized', message: 'bad key' }),
    );
    expect(getNotionRuntimeSession()?.bearer).toBeTruthy();
    const r = await c.verify();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bad key|重新输入|无效/);
    expect(getNotionRuntimeSession()).toBeNull();
  });

  it('403 Origin message tells user to fix CORS, not rotate Key', async () => {
    const c = client(async () =>
      jsonResponse(403, { ok: false, code: 'forbidden', message: 'Origin not allowed' }),
    );
    const r = await c.verify();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ALLOWED_ORIGIN|CORS/);
    expect(r.error).not.toMatch(/重新输入会话/);
  });

  it('429 / 503 are retryable via pushOps errors', async () => {
    const ops = [op({ opId: 'o1' })];

    const c429 = client(async () => jsonResponse(429, { code: 'rate_limited' }));
    const r429 = await c429.pushOps(ops);
    expect(r429.applied).toEqual([]);
    expect(r429.errors?.[0]).toMatchObject({
      opId: 'o1',
      code: 'rate_limited',
      retryable: true,
    });

    const c503 = client(async () =>
      jsonResponse(503, { code: 'notion_unavailable', message: 'down' }),
    );
    const r503 = await c503.pushOps(ops);
    expect(r503.applied).toEqual([]);
    expect(r503.errors?.[0]).toMatchObject({
      code: 'notion_unavailable',
      retryable: true,
    });
  });

  it('AbortSignal does not ACK (empty applied)', async () => {
    const c = client(async (_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        if (signal?.aborted) {
          reject(err);
          return;
        }
        signal?.addEventListener('abort', () => reject(err));
      });
    });
    const ac = new AbortController();
    const pending = c.pushOps([op({ opId: 'o-abort' })], ac.signal);
    ac.abort();
    const r = await pending;
    expect(r.applied).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.error).toMatch(/中止|ACK/);
  });

  it('pushOps sends id (= opId) to Gateway', async () => {
    const seen: unknown[] = [];
    const c = client(async (_url, init) => {
      seen.push(JSON.parse(String(init?.body)));
      return jsonResponse(200, {
        applied: ['op-9'],
        conflicts: [],
        errors: [],
      });
    });
    const r = await c.pushOps([op({ opId: 'op-9', entityId: 'veh-1' })]);
    expect(seen[0]).toEqual({
      ops: [
        expect.objectContaining({
          id: 'op-9',
          entity: 'vehicles',
          entityId: 'veh-1',
          op: 'upsert',
        }),
      ],
    });
    expect(r.applied).toEqual(['op-9']);
  });
});

describe('NotionGatewayError helpers', () => {
  it('constructs with status/code', () => {
    const e = new NotionGatewayError({
      status: 401,
      code: 'unauthorized',
      message: 'x',
    });
    expect(e.status).toBe(401);
    expect(e.code).toBe('unauthorized');
  });
});

describe('session clear helper', () => {
  it('clearNotionRuntimeSession empties memory', () => {
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'w' });
    clearNotionRuntimeSession();
    expect(getNotionRuntimeSession()).toBeNull();
  });
});
