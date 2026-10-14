/**
 * D2-P4: Notion Gateway conflicts → existing M3-C open / keep_local / take_cloud.
 * No second conflict model. Mock Gateway OK for unit; live ★F in scripts.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { Vehicle } from '../types';
import { putVehicle } from '../repositories/vehicles';
import { setCloudStorageConfig } from './config';
import { listOpenConflicts } from './conflictStore';
import { resolveConflict } from './conflictResolve';
import { detectPushRejected } from './conflictDetect';
import {
  bidirectionalSync,
  setCloudProviderForTests,
} from './engine';
import {
  listOutbox,
  listReadyOutbox,
  makeOutboxItem,
  putOutboxItem,
  patchSyncMeta,
} from './outbox';
import {
  resetNotionRuntimeSessionForTests,
  setNotionRuntimeSession,
} from './notionSession';
import { adaptGatewayPushResult } from './providers/notionGatewayClient';
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
    plate: 'P4-TEST',
    energyType: 'ICE',
    bodyType: 'SEDAN',
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('D2-P4 adaptGatewayPushResult enriches entityId from ops', () => {
  it('fills entityId from outbox when cloudRow absent (ambiguous_race)', () => {
    const op = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'veh-amb',
      op: 'upsert',
      payload: vehicle('veh-amb', 'A', '2026-01-01T00:00:00.000Z'),
      mutatedAt: '2026-01-01T00:00:00.000Z',
    });
    (op as { opId: string }).opId = 'op-amb';
    const r = adaptGatewayPushResult(
      {
        applied: ['op-amb'],
        conflicts: [{ id: 'op-amb', entity: 'vehicles', reason: 'ambiguous_race', attemptedAt: 't' }],
      },
      [op],
    );
    expect(r.applied).toEqual([]);
    expect(r.conflicts[0]?.entityId).toBe('veh-amb');
    expect(r.conflicts[0]?.entity).toBe('vehicles');
    expect(r.conflicts[0]?.reason).toBe('ambiguous_race');
  });
});

describe('D2-P4 detectPushRejected skipped_deleted → edit_vs_delete', () => {
  it('forces delete cloud snapshot for skipped_deleted', () => {
    const localOp = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'v1',
      op: 'upsert',
      payload: vehicle('v1', 'Local', '2026-01-01T00:00:00.000Z'),
      mutatedAt: '2026-01-01T00:00:00.000Z',
    });
    const d = detectPushRejected({
      entity: 'vehicles',
      entityId: 'v1',
      opId: localOp.opId,
      localOp,
      gatewayReason: 'skipped_deleted',
      cloudUpdatedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(d.escalate).toBe(true);
    if (d.escalate) {
      expect(d.kind).toBe('edit_vs_delete');
      expect(d.cloudSnapshot.op).toBe('delete');
    }
  });
});

describe('D2-P4 Notion cloud_newer → M3-C open / keep / take', () => {
  const WK = 'wk-p4-test';

  beforeEach(async () => {
    await resetDb();
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
    });
    setNotionRuntimeSession({ bearer: 'test-key', workspaceKey: WK });
    await patchSyncMeta({
      cloudUserId: WK,
      deviceId: 'dev-p4',
      status: 'idle',
      provider: 'notion',
    });
  });

  afterEach(async () => {
    setCloudProviderForTests(null);
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  function notionProvider(handlers: {
    pushOps: (ops: SyncOutboxItem[]) => Promise<PushResult>;
    pullRows?: CloudRow[];
  }): CloudProvider {
    return {
      id: 'notion',
      async verify(): Promise<VerifyResult> {
        return { ok: true, userId: WK, email: 'bot' };
      },
      async pullAll(): Promise<CloudSnapshot> {
        return { rows: handlers.pullRows ?? [], pulledAt: nowISO() };
      },
      async pushOps(ops) {
        return handlers.pushOps(ops);
      },
      async pushSnapshot() {
        return { applied: [], conflicts: [] };
      },
      getMediaObjectStore: () => null,
      getAuthUserId: async () => WK,
    };
  }

  it('★F E1: cloud_newer opens conflict, blocks outbox, no ACK', async () => {
    const cloudAt = '2026-03-01T00:00:00.000Z';
    const cloudVeh = vehicle('v-f', 'CloudNewer', cloudAt);
    const cloudRow: CloudRow = {
      entity: 'vehicles',
      id: 'v-f',
      payload: cloudVeh,
      updatedAt: cloudAt,
      deletedAt: null,
    };
    setCloudProviderForTests(
      notionProvider({
        pullRows: [cloudRow],
        pushOps: async (ops) => ({
          applied: [],
          conflicts: ops.map((o) => ({
            opId: o.opId,
            reason: 'cloud_newer',
            entity: o.entity,
            entityId: o.entityId,
            cloudUpdatedAt: cloudAt,
            attemptedAt: o.mutatedAt,
            cloudRow,
          })),
        }),
      }),
    );

    const localAt = '2026-01-01T00:00:00.000Z';
    await putVehicle(vehicle('v-f', 'Local', localAt));
    const op = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'v-f',
      op: 'upsert',
      payload: vehicle('v-f', 'Local', localAt),
      mutatedAt: localAt,
      ownerUserId: WK,
    });
    await putOutboxItem(op);

    const r = await bidirectionalSync();
    expect(r.ok).toBe(true);
    const open = await listOpenConflicts();
    expect(open.some((c) => c.entityId === 'v-f' && c.status === 'open')).toBe(true);
    const box = await listOutbox();
    expect(box.some((o) => o.opId === op.opId)).toBe(true);
    const ready = await listReadyOutbox();
    expect(ready.some((o) => o.opId === op.opId)).toBe(false);
  });

  it('keep_local bumps and pushes under lock; outbox ACK on apply', async () => {
    const cloudAt = '2026-03-01T00:00:00.000Z';
    const cloudRow: CloudRow = {
      entity: 'vehicles',
      id: 'v-kl',
      payload: vehicle('v-kl', 'Cloud', cloudAt),
      updatedAt: cloudAt,
      deletedAt: null,
    };
    let pushCount = 0;
    setCloudProviderForTests(
      notionProvider({
        pullRows: [cloudRow],
        pushOps: async (ops) => {
          pushCount += 1;
          if (pushCount === 1) {
            return {
              applied: [],
              conflicts: ops.map((o) => ({
                opId: o.opId,
                reason: 'cloud_newer',
                entity: o.entity,
                entityId: o.entityId,
                cloudUpdatedAt: cloudAt,
                cloudRow,
              })),
            };
          }
          // keep_local re-push with bumped mutatedAt
          return { applied: ops.map((o) => o.opId), conflicts: [] };
        },
      }),
    );

    const localAt = '2026-01-01T00:00:00.000Z';
    await putVehicle(vehicle('v-kl', 'Local', localAt));
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'v-kl',
        op: 'upsert',
        payload: vehicle('v-kl', 'Local', localAt),
        mutatedAt: localAt,
        ownerUserId: WK,
      }),
    );
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v-kl');
    expect(c).toBeTruthy();
    const result = await resolveConflict(c!.id, 'keep_local');
    expect(result.ok).toBe(true);
    expect(result.lockBusy).not.toBe(true);
    const after = await listOpenConflicts();
    expect(after.some((x) => x.entityId === 'v-kl')).toBe(false);
    const db = await getDB();
    const v = (await db.get('vehicles', 'v-kl')) as Vehicle;
    expect(v.name).toBe('Local');
    expect(v.updatedAt > localAt).toBe(true);
  });

  it('take_cloud applies cloud and clears blocked outbox', async () => {
    const cloudAt = '2026-03-01T00:00:00.000Z';
    const cloudRow: CloudRow = {
      entity: 'vehicles',
      id: 'v-tc',
      payload: vehicle('v-tc', 'CloudWin', cloudAt),
      updatedAt: cloudAt,
      deletedAt: null,
    };
    setCloudProviderForTests(
      notionProvider({
        pullRows: [cloudRow],
        pushOps: async (ops) => ({
          applied: [],
          conflicts: ops.map((o) => ({
            opId: o.opId,
            reason: 'cloud_newer',
            entity: o.entity,
            entityId: o.entityId,
            cloudUpdatedAt: cloudAt,
            cloudRow,
          })),
        }),
      }),
    );

    const localAt = '2026-01-01T00:00:00.000Z';
    await putVehicle(vehicle('v-tc', 'Local', localAt));
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'v-tc',
        op: 'upsert',
        payload: vehicle('v-tc', 'Local', localAt),
        mutatedAt: localAt,
        ownerUserId: WK,
      }),
    );
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v-tc');
    expect(c).toBeTruthy();
    const result = await resolveConflict(c!.id, 'take_cloud');
    expect(result.ok).toBe(true);
    const db = await getDB();
    const v = (await db.get('vehicles', 'v-tc')) as Vehicle;
    expect(v.name).toBe('CloudWin');
    const box = await listOutbox();
    expect(box.some((o) => o.entityId === 'v-tc')).toBe(false);
  });

  it('skipped_deleted opens edit_vs_delete and never ACKs', async () => {
    const delAt = '2026-02-01T00:00:00.000Z';
    const tomb: CloudRow = {
      entity: 'vehicles',
      id: 'v-del',
      payload: {},
      updatedAt: delAt,
      deletedAt: delAt,
    };
    setCloudProviderForTests(
      notionProvider({
        pullRows: [tomb],
        pushOps: async (ops) => ({
          applied: [],
          conflicts: ops.map((o) => ({
            opId: o.opId,
            reason: 'skipped_deleted',
            entity: o.entity,
            entityId: o.entityId,
            cloudUpdatedAt: delAt,
            cloudRow: tomb,
          })),
        }),
      }),
    );

    const localAt = '2026-01-01T00:00:00.000Z';
    await putVehicle(vehicle('v-del', 'Resurrect', localAt));
    const op = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'v-del',
      op: 'upsert',
      payload: vehicle('v-del', 'Resurrect', localAt),
      mutatedAt: localAt,
      ownerUserId: WK,
    });
    await putOutboxItem(op);
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v-del');
    expect(c).toBeTruthy();
    expect(c!.kind).toBe('edit_vs_delete');
    expect(await listOutbox()).toEqual(expect.arrayContaining([expect.objectContaining({ opId: op.opId })]));
  });

  it('account isolation: foreign ownerUserId outbox not flushed / not lost', async () => {
    const pushSpy = vi.fn(async (ops: SyncOutboxItem[]) => ({
      applied: ops.map((o) => o.opId),
      conflicts: [] as PushResult['conflicts'],
    }));
    setCloudProviderForTests(
      notionProvider({
        pullRows: [],
        pushOps: pushSpy,
      }),
    );

    const t = nowISO();
    // Write entities without repository enqueue (avoid double outbox)
    const db = await getDB();
    await db.put('vehicles', vehicle('v-mine', 'Mine', t));
    await db.put('vehicles', vehicle('v-other', 'Other', t));
    const mine = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'v-mine',
      op: 'upsert',
      payload: vehicle('v-mine', 'Mine', t),
      mutatedAt: t,
      ownerUserId: WK,
    });
    const other = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'v-other',
      op: 'upsert',
      payload: vehicle('v-other', 'Other', t),
      mutatedAt: t,
      ownerUserId: 'other-workspace-key',
    });
    await putOutboxItem(mine);
    await putOutboxItem(other);

    await bidirectionalSync();
    const pushedIds = pushSpy.mock.calls.flatMap((c) => c[0].map((o) => o.opId));
    expect(pushedIds).toContain(mine.opId);
    expect(pushedIds).not.toContain(other.opId);
    const box = await listOutbox();
    expect(box.some((o) => o.opId === other.opId)).toBe(true);
  });

  it('failure retry: errors[] never ACK; attempts bump', async () => {
    setCloudProviderForTests(
      notionProvider({
        pullRows: [],
        pushOps: async (ops) => ({
          applied: [],
          conflicts: [],
          errors: ops.map((o) => ({
            opId: o.opId,
            entity: o.entity,
            code: 'rate_limited',
            message: '稍后重试',
            retryable: true,
          })),
        }),
      }),
    );
    const t = nowISO();
    const db = await getDB();
    await db.put('vehicles', vehicle('v-rt', 'Retry', t));
    const op = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'v-rt',
      op: 'upsert',
      payload: vehicle('v-rt', 'Retry', t),
      mutatedAt: t,
      ownerUserId: WK,
    });
    await putOutboxItem(op);
    const r = await bidirectionalSync();
    expect(r.ok).toBe(false);
    const box = await listOutbox();
    const failed = box.find((o) => o.opId === op.opId);
    expect(failed).toBeTruthy();
    expect(failed!.attempts).toBeGreaterThanOrEqual(1);
    expect(failed!.lastError).toMatch(/rate_limited/);
  });
});
