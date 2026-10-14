/**
 * D2-P3: live wiring unit tests (mock Gateway OK).
 * Covers AbortSignal → pushOps/pullAll, PushResult.errors[] settlement, Notion entity filter.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { Vehicle } from '../types';
import { putVehicle } from '../repositories/vehicles';
import { setCloudStorageConfig } from './config';
import {
  bidirectionalSync,
  firstUploadToCloud,
  setCloudProviderForTests,
} from './engine';
import {
  listOutbox,
  makeOutboxItem,
  putOutboxItem,
  patchSyncMeta,
} from './outbox';
import {
  resetNotionRuntimeSessionForTests,
  setNotionRuntimeSession,
} from './notionSession';
import { NotionProvider } from './providers/notion';
import { MemoryCloudProvider } from './providers/memory';
import type { CloudProvider } from './providers/types';
import type { CloudRow, CloudSnapshot, PushResult, SyncOutboxItem, VerifyResult } from './types';

async function resetDb() {
  resetNotionRuntimeSessionForTests();
  setCloudProviderForTests(null);
  await closeDBForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('car-care-db');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function vehicle(id: string, name: string, updatedAt: string): Vehicle {
  return {
    id,
    name,
    plate: 'P3-TEST',
    energyType: 'ICE',
    bodyType: 'SEDAN',
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('D2-P3 AbortSignal forwarded to Notion Gateway client', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    setCloudProviderForTests(null);
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  it('pushOps / pullAll receive AbortSignal and abort does not ACK', async () => {
    const calls: Array<{ path: string; aborted: boolean }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const signal = init?.signal;
      calls.push({ path: url, aborted: Boolean(signal?.aborted) });
      if (signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (url.includes('/verify')) {
        return new Response(JSON.stringify({ ok: true, workspaceKey: 'ws-p3' }), { status: 200 });
      }
      if (url.includes('/sync/pull')) {
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }
      if (url.includes('/sync/push')) {
        // Simulate slow push — wait until aborted
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5000);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
        return new Response(JSON.stringify({ applied: ['should-not'], conflicts: [] }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 404 });
    });

    setNotionRuntimeSession({ bearer: 'test-key', workspaceKey: 'ws-p3' });
    const provider = new NotionProvider({
      gatewayUrl: 'https://gw.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const ac = new AbortController();
    const pullP = provider.pullAll(ac.signal);
    await expect(pullP).resolves.toMatchObject({ rows: [] });

    const ops: SyncOutboxItem[] = [
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'v1',
        op: 'upsert',
        payload: vehicle('v1', 'A', nowISO()),
        mutatedAt: nowISO(),
      }),
    ];
    const pushPromise = provider.pushOps(ops, ac.signal);
    ac.abort();
    const result = await pushPromise;
    expect(result.applied).toEqual([]);
    expect(result.error).toMatch(/中止|abort/i);
  });
});

describe('D2-P3 PushResult.errors[] per-op settlement', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    setCloudProviderForTests(null);
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  it('marks failures for errors[] opIds and never ACKs them', async () => {
    const mem = new MemoryCloudProvider();
    mem.userId = 'user-p3';
    mem.pushOps = async (ops, signal?) => {
      void signal;
      if (!ops.length) return { applied: [], conflicts: [] };
      const okOp = ops.find((o) => o.entityId === 'veh-ok');
      const errOp = ops.find((o) => o.entityId === 'veh-err');
      return {
        applied: okOp ? [okOp.opId] : [],
        conflicts: [],
        errors: errOp
          ? [
              {
                opId: errOp.opId,
                entity: errOp.entity,
                code: 'rate_limited',
                message: '稍后重试',
                retryable: true,
              },
            ]
          : undefined,
      };
    };

    await setCloudStorageConfig({ provider: 'none' });
    setCloudProviderForTests(mem);
    await patchSyncMeta({ cloudUserId: 'user-p3', provider: 'supabase', status: 'idle' });

    const t = nowISO();
    const v1 = vehicle('veh-ok', 'Ok', t);
    const v2 = vehicle('veh-err', 'Err', t);
    await putVehicle(v1);
    await putVehicle(v2);
    const op1 = makeOutboxItem({
      entity: 'vehicles',
      entityId: v1.id,
      op: 'upsert',
      payload: v1,
      mutatedAt: t,
      ownerUserId: 'user-p3',
    });
    const op2 = makeOutboxItem({
      entity: 'vehicles',
      entityId: v2.id,
      op: 'upsert',
      payload: v2,
      mutatedAt: t,
      ownerUserId: 'user-p3',
    });
    await putOutboxItem(op1);
    await putOutboxItem(op2);

    const result = await bidirectionalSync();
    expect(result.ok).toBe(true);
    const box = await listOutbox();
    expect(box.find((o) => o.opId === op1.opId)).toBeUndefined();
    const failed = box.find((o) => o.opId === op2.opId);
    expect(failed).toBeTruthy();
    expect(failed!.lastError).toMatch(/rate_limited/);
    expect(failed!.attempts).toBeGreaterThanOrEqual(1);
  });
});

describe('D2-P3 Notion entity filter (vehicles/records only)', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    setCloudProviderForTests(null);
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  it('firstUpload + sync only push vehicles/records to Notion provider', async () => {
    const pushedEntities: string[] = [];
    const fake: CloudProvider = {
      id: 'notion',
      async verify(): Promise<VerifyResult> {
        return { ok: true, userId: 'wk-notion', email: 'bot' };
      },
      async pullAll(): Promise<CloudSnapshot> {
        return { rows: [], pulledAt: nowISO() };
      },
      async pushOps(ops: SyncOutboxItem[]): Promise<PushResult> {
        for (const o of ops) pushedEntities.push(o.entity);
        return { applied: ops.map((o) => o.opId), conflicts: [] };
      },
      async pushSnapshot(rows: CloudRow[]): Promise<PushResult> {
        for (const r of rows) pushedEntities.push(r.entity);
        return {
          applied: rows.map((r) => `${r.entity}:${r.id}`),
          conflicts: [],
        };
      },
      getMediaObjectStore: () => null,
      getAuthUserId: async () => 'wk-notion',
    };

    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
    });
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'wk-notion' });
    setCloudProviderForTests(fake);
    await patchSyncMeta({ cloudUserId: 'wk-notion', provider: 'notion', status: 'idle' });

    const t = nowISO();
    await putVehicle(vehicle('nv1', 'N1', t));
    // stations/settings exist locally but must not be snapshotted to Notion
    const db = await getDB();
    await db.put('stations', {
      id: 'st1',
      stationType: 'gas',
      name: 'S',
      sortOrder: 0,
      createdAt: t,
      updatedAt: t,
    });
    await db.put('settings', { key: 'theme', value: 'dark', updatedAt: t });

    const up = await firstUploadToCloud();
    expect(up.ok).toBe(true);
    expect(pushedEntities.every((e) => e === 'vehicles' || e === 'records')).toBe(true);
    expect(pushedEntities).toContain('vehicles');
    expect(pushedEntities).not.toContain('stations');
    expect(pushedEntities).not.toContain('settings');
    expect(pushedEntities).not.toContain('media');
  });
});

describe('D2-P3 NotionGatewayClient refuses media/stations/settings', () => {
  it('pushOps returns unsupported_entity and does not fetch for media-only batch', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'ws' });
    const { NotionGatewayClient } = await import('./providers/notionGatewayClient');
    const client = new NotionGatewayClient({
      baseUrl: 'https://gw.example.com',
      getBearer: () => 'k',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const mediaOp = makeOutboxItem({
      entity: 'media',
      entityId: 'm1',
      op: 'upsert',
      payload: { id: 'm1' },
      mutatedAt: nowISO(),
    });
    const result = await client.pushOps([mediaOp]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.applied).toEqual([]);
    expect(result.errors?.[0]?.code).toBe('unsupported_entity');
  });

  it('pushOps sends only vehicles when mixed with media', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ applied: ['veh-op'], conflicts: [], errors: [] }), {
        status: 200,
      }),
    );
    const { NotionGatewayClient } = await import('./providers/notionGatewayClient');
    const client = new NotionGatewayClient({
      baseUrl: 'https://gw.example.com',
      getBearer: () => 'k',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const veh = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'v1',
      op: 'upsert',
      payload: vehicle('v1', 'X', nowISO()),
      mutatedAt: nowISO(),
    });
    // overwrite opId for assert
    (veh as { opId: string }).opId = 'veh-op';
    const media = makeOutboxItem({
      entity: 'media',
      entityId: 'm1',
      op: 'upsert',
      payload: { id: 'm1' },
      mutatedAt: nowISO(),
    });
    const result = await client.pushOps([veh, media]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(body.ops).toHaveLength(1);
    expect(body.ops[0].entity).toBe('vehicles');
    expect(result.applied).toEqual(['veh-op']);
    expect(result.errors?.some((e) => e.code === 'unsupported_entity')).toBe(true);
  });
});
