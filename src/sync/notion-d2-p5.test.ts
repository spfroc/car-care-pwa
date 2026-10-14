/**
 * D2-P5: sync_notion_map + switch/disconnect Outbox corridor (SW1–SW4) + DEL* edges.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, DB_VERSION, getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { CareRecord, Vehicle } from '../types';
import { putRecord } from '../repositories/records';
import { deleteVehicle, putVehicle } from '../repositories/vehicles';
import { setCloudStorageConfig } from './config';
import {
  bidirectionalSync,
  disconnectCloud,
  discardOrphanOutboxOwner,
  getSwitchCorridorPanel,
  getSyncStatusSummary,
  guardUserSwitch,
  setCloudProviderForTests,
  verifyConnection,
} from './engine';
import {
  applyCloudRowsToNotionMap,
  getNotionMapEntry,
  listAllNotionMap,
  markNotionMapTombstone,
  shouldBlockBlindRecreate,
} from './notionMap';
import {
  clearNotionRuntimeSession,
  resetNotionRuntimeSessionForTests,
  setNotionRuntimeSession,
} from './notionSession';
import {
  countOutboxForOwner,
  enqueueSyncOp,
  listOrphanOutbox,
  listOutbox,
  listReadyOutbox,
  makeOutboxItem,
  patchSyncMeta,
  prepareOutboxEnqueue,
  putOutboxItem,
} from './outbox';
import {
  assertReadyOutboxIsolated,
  discardParkedOutboxOwner,
  evaluateWorkspaceSwitch,
  listFlushableForOwner,
} from './switchCorridor';
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
    plate: 'P5-TEST',
    energyType: 'ICE',
    bodyType: 'SEDAN',
    createdAt: updatedAt,
    updatedAt,
  };
}

function mockNotionProvider(opts: {
  workspaceKey: string;
  push?: (ops: SyncOutboxItem[]) => Promise<PushResult>;
  pullRows?: CloudRow[];
}): CloudProvider {
  return {
    id: 'notion',
    getMediaObjectStore: () => null,
    getAuthUserId: async () => opts.workspaceKey,
    verify: async (): Promise<VerifyResult> => ({
      ok: true,
      userId: opts.workspaceKey,
      cloudRowCount: opts.pullRows?.length ?? 0,
    }),
    pullAll: async (): Promise<CloudSnapshot> => ({
      rows: opts.pullRows ?? [],
      pulledAt: nowISO(),
    }),
    pushOps: async (ops) =>
      opts.push
        ? opts.push(ops)
        : { applied: ops.map((o) => o.opId), conflicts: [] },
    pushSnapshot: async () => ({ applied: [], conflicts: [] }),
    signOut: async () => {
      clearNotionRuntimeSession();
    },
  };
}

describe('D2-P5 IDB sync_notion_map store', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  it('opens DB_VERSION 5 with sync_notion_map', async () => {
    expect(DB_VERSION).toBe(5);
    const db = await getDB();
    expect(db.objectStoreNames.contains('sync_notion_map')).toBe(true);
  });

  it('persists tombstone and blocks blind recreate', async () => {
    await markNotionMapTombstone({
      entity: 'vehicles',
      appEntityId: 'veh-del',
      workspaceKey: 'wk-a',
      pageId: 'page-1',
      deletedAt: '2026-10-14T00:00:00.000Z',
    });
    const entry = await getNotionMapEntry('vehicles', 'veh-del');
    expect(entry?.tombstone).toBe(true);
    expect(entry?.pageId).toBe('page-1');
    expect(await shouldBlockBlindRecreate('vehicles', 'veh-del', 'wk-a')).toBe(true);
    expect(await shouldBlockBlindRecreate('vehicles', 'veh-del', 'wk-other')).toBe(false);
  });

  it('applyCloudRowsToNotionMap sets alive vs tombstone', async () => {
    const rows: CloudRow[] = [
      {
        entity: 'vehicles',
        id: 'v1',
        payload: {},
        updatedAt: '2026-10-14T01:00:00.000Z',
        deletedAt: null,
      },
      {
        entity: 'vehicles',
        id: 'v2',
        payload: {},
        updatedAt: '2026-10-14T01:00:00.000Z',
        deletedAt: '2026-10-14T00:30:00.000Z',
      },
    ];
    const r = await applyCloudRowsToNotionMap(rows, 'wk-a');
    expect(r.upserted).toBe(1);
    expect(r.tombstoned).toBe(1);
    expect((await getNotionMapEntry('vehicles', 'v1'))?.tombstone).toBe(false);
    expect((await getNotionMapEntry('vehicles', 'v2'))?.tombstone).toBe(true);
  });

  it('UI hard-delete notes tombstone when notion enabled', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    setNotionRuntimeSession({ bearer: 'test-key', workspaceKey: 'wk-a' });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    const t0 = nowISO();
    await putVehicle(vehicle('veh-hard', 'Hard', t0));
    await deleteVehicle('veh-hard');
    const entry = await getNotionMapEntry('vehicles', 'veh-hard');
    expect(entry?.tombstone).toBe(true);
    expect(entry?.workspaceKey).toBe('wk-a');
  });

  it('enqueueSyncOp upsert skipped when map tombstone (same workspace)', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    setNotionRuntimeSession({ bearer: 'test-key', workspaceKey: 'wk-a' });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    await markNotionMapTombstone({
      entity: 'vehicles',
      appEntityId: 'veh-x',
      workspaceKey: 'wk-a',
    });
    await enqueueSyncOp({
      entity: 'vehicles',
      entityId: 'veh-x',
      op: 'upsert',
      payload: vehicle('veh-x', 'X', nowISO()),
    });
    expect(await listOutbox()).toHaveLength(0);
  });

  it('putVehicle upsert enqueue blocked when map tombstone (same workspace)', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    setNotionRuntimeSession({ bearer: 'test-key', workspaceKey: 'wk-a' });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    await markNotionMapTombstone({
      entity: 'vehicles',
      appEntityId: 'veh-repo',
      workspaceKey: 'wk-a',
    });
    const t0 = nowISO();
    await putVehicle(vehicle('veh-repo', 'RepoBlind', t0));
    // Local write still happens; outbox must not get a blind-recreate upsert
    const db = await getDB();
    expect(await db.get('vehicles', 'veh-repo')).toBeTruthy();
    expect(await listOutbox()).toHaveLength(0);
    // Control: different workspace tombstone does not block
    await markNotionMapTombstone({
      entity: 'vehicles',
      appEntityId: 'veh-other-wk',
      workspaceKey: 'wk-other',
    });
    await putVehicle(vehicle('veh-other-wk', 'OtherWk', t0));
    const box = await listOutbox();
    expect(box).toHaveLength(1);
    expect(box[0]?.entityId).toBe('veh-other-wk');
    expect(box[0]?.op).toBe('upsert');
  });

  it('putRecord upsert enqueue blocked when map tombstone (same workspace)', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    setNotionRuntimeSession({ bearer: 'test-key', workspaceKey: 'wk-a' });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    await markNotionMapTombstone({
      entity: 'records',
      appEntityId: 'rec-repo',
      workspaceKey: 'wk-a',
    });
    const t0 = nowISO();
    const rec: CareRecord = {
      id: 'rec-repo',
      vehicleId: 'veh-1',
      type: 'fuel',
      date: t0,
      amountPaid: 100,
      mediaIds: [],
      createdAt: t0,
      updatedAt: t0,
      fuelGrade: '95#',
      liters: 40,
      filledUp: true,
      odometer: 1000,
    };
    await putRecord(rec);
    const db = await getDB();
    expect(await db.get('records', 'rec-repo')).toBeTruthy();
    expect(await listOutbox()).toHaveLength(0);
    // prepareOutboxEnqueue directly returns null for tombstoned upsert
    expect(
      await prepareOutboxEnqueue({
        entity: 'records',
        entityId: 'rec-repo',
        op: 'upsert',
        payload: rec,
        mutatedAt: t0,
      }),
    ).toBeNull();
  });

  it('listReadyOutbox filters tombstoned upserts (defense in depth)', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    setNotionRuntimeSession({ bearer: 'test-key', workspaceKey: 'wk-a' });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    // Bypass prepareOutboxEnqueue to simulate a stale pre-gate outbox row
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'veh-stale',
        op: 'upsert',
        payload: vehicle('veh-stale', 'Stale', nowISO()),
        ownerUserId: 'wk-a',
      }),
    );
    await markNotionMapTombstone({
      entity: 'vehicles',
      appEntityId: 'veh-stale',
      workspaceKey: 'wk-a',
    });
    expect(await listOutbox()).toHaveLength(1);
    expect(await listReadyOutbox()).toHaveLength(0);
  });
});

describe('D2-P5 SW1–SW4 switch corridor', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
    setCloudProviderForTests(null);
  });

  it('SW1: disconnect retains outbox and clears session', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    setNotionRuntimeSession({ bearer: 'sess-key', workspaceKey: 'wk-a' });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    const op = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'v1',
      op: 'upsert',
      payload: vehicle('v1', 'A', nowISO()),
      ownerUserId: 'wk-a',
    });
    await putOutboxItem(op);
    setCloudProviderForTests(
      mockNotionProvider({ workspaceKey: 'wk-a' }),
    );
    const r = await disconnectCloud();
    expect(r.ok).toBe(true);
    expect(await countOutboxForOwner('wk-a')).toBe(1);
    expect(await listOutbox()).toHaveLength(1);
    // session cleared
    const { getNotionRuntimeSession } = await import('./notionSession');
    expect(getNotionRuntimeSession()?.bearer).toBeFalsy();
  });

  it('SW2: park switch keeps orphan outbox and does not flush it', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'old-v',
        op: 'upsert',
        payload: vehicle('old-v', 'Old', nowISO()),
        ownerUserId: 'wk-a',
      }),
    );

    const guard = await guardUserSwitch('wk-b', { mode: 'park', providerId: 'notion' });
    expect(guard.ok).toBe(true);
    expect(guard.note).toMatch(/保留/);

    const meta = await (await import('./outbox')).getSyncMeta();
    expect(meta.cloudUserId).toBe('wk-b');
    expect(await countOutboxForOwner('wk-a')).toBe(1);
    expect(await listOrphanOutbox('wk-b')).toHaveLength(1);

    // Ready flush must not include orphan
    const ready = await listReadyOutbox();
    expect(ready.every((o) => (o.ownerUserId ?? '') === 'wk-b' || !o.ownerUserId)).toBe(true);
    expect(ready.find((o) => o.entityId === 'old-v')).toBeUndefined();
    const iso = await assertReadyOutboxIsolated('wk-b');
    expect(iso.ok).toBe(true);
  });

  it('SW2 block mode still refuses supabase-style switch with parked outbox', async () => {
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'supabase',
      cloudUserId: 'user-a',
    });
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'v1',
        op: 'upsert',
        payload: vehicle('v1', 'A', nowISO()),
        ownerUserId: 'user-a',
      }),
    );
    const r = await evaluateWorkspaceSwitch('user-b', {
      mode: 'block',
      localBusinessRows: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/已阻止账号切换/);
  });

  it('SW3: discard requires DISCARD token and only clears exact orphan owner', async () => {
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-b',
    });
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'a1',
        op: 'upsert',
        payload: vehicle('a1', 'A', nowISO()),
        ownerUserId: 'wk-a',
      }),
    );
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'b1',
        op: 'upsert',
        payload: vehicle('b1', 'B', nowISO()),
        ownerUserId: 'wk-b',
      }),
    );

    const bad = await discardParkedOutboxOwner({
      ownerUserId: 'wk-a',
      confirmToken: 'nope',
    });
    expect(bad.ok).toBe(false);
    expect(await countOutboxForOwner('wk-a')).toBe(1);

    const refuseCurrent = await discardOrphanOutboxOwner({
      ownerUserId: 'wk-b',
      confirmToken: 'DISCARD',
    });
    expect(refuseCurrent.ok).toBe(false);
    expect(await countOutboxForOwner('wk-b')).toBe(1);

    const ok = await discardOrphanOutboxOwner({
      ownerUserId: 'wk-a',
      confirmToken: 'DISCARD',
    });
    expect(ok.ok).toBe(true);
    expect(await countOutboxForOwner('wk-a')).toBe(0);
    expect(await countOutboxForOwner('wk-b')).toBe(1);
  });

  it('SW4: switch back makes old queue flushable again', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'parked',
        op: 'upsert',
        payload: vehicle('parked', 'P', nowISO()),
        ownerUserId: 'wk-a',
      }),
    );

    await guardUserSwitch('wk-b', { mode: 'park' });
    expect(await listFlushableForOwner('wk-a')).toHaveLength(1);
    expect((await listReadyOutbox()).find((o) => o.entityId === 'parked')).toBeUndefined();

    // Switch back
    await guardUserSwitch('wk-a', { mode: 'park' });
    await patchSyncMeta({ cloudUserId: 'wk-a', status: 'idle', provider: 'notion', deviceId: 'dev' });
    const ready = await listReadyOutbox();
    expect(ready.some((o) => o.entityId === 'parked')).toBe(true);

    let pushedIds: string[] = [];
    setCloudProviderForTests(
      mockNotionProvider({
        workspaceKey: 'wk-a',
        push: async (ops) => {
          pushedIds = ops.map((o) => o.entityId);
          return { applied: ops.map((o) => o.opId), conflicts: [] };
        },
      }),
    );
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'wk-a' });
    const sync = await bidirectionalSync();
    expect(sync.ok).toBe(true);
    expect(pushedIds).toContain('parked');
    expect(await countOutboxForOwner('wk-a')).toBe(0);
  });

  it('panel summarizes orphan owners', async () => {
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-now',
    });
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'o1',
        op: 'upsert',
        payload: vehicle('o1', 'O', nowISO()),
        ownerUserId: 'wk-old',
      }),
    );
    const panel = await getSwitchCorridorPanel();
    expect(panel.orphanTotal).toBe(1);
    expect(panel.orphans[0]?.ownerUserId).toBe('wk-old');
    const summary = await getSyncStatusSummary();
    expect(summary.orphanOutboxCount).toBe(1);
  });
});

describe('D2-P5 DEL* map edges (unit)', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
    setCloudProviderForTests(null);
  });

  it('DEL1: pull tombstone writes map; local merge path sees deletedAt', async () => {
    const rows: CloudRow[] = [
      {
        entity: 'vehicles',
        id: 'del1',
        payload: {},
        updatedAt: '2026-10-14T02:00:00.000Z',
        deletedAt: '2026-10-14T02:00:00.000Z',
      },
    ];
    await applyCloudRowsToNotionMap(rows, 'wk-a');
    expect((await getNotionMapEntry('vehicles', 'del1'))?.tombstone).toBe(true);
  });

  it('DEL2: tombstone blocks recreate upsert enqueue', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'wk-a' });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    await markNotionMapTombstone({
      entity: 'vehicles',
      appEntityId: 'del2',
      workspaceKey: 'wk-a',
      pageId: 'page-del2',
    });
    await enqueueSyncOp({
      entity: 'vehicles',
      entityId: 'del2',
      op: 'upsert',
      payload: vehicle('del2', 'Revive', nowISO()),
    });
    expect(await listOutbox()).toHaveLength(0);
    expect(await shouldBlockBlindRecreate('vehicles', 'del2', 'wk-a')).toBe(true);
  });

  it('DEL3: clear tombstone on alive pull (restore)', async () => {
    await markNotionMapTombstone({
      entity: 'vehicles',
      appEntityId: 'del3',
      workspaceKey: 'wk-a',
      pageId: 'p3',
    });
    await applyCloudRowsToNotionMap(
      [
        {
          entity: 'vehicles',
          id: 'del3',
          payload: { name: 'Restored' },
          updatedAt: '2026-10-14T03:00:00.000Z',
          deletedAt: null,
        },
      ],
      'wk-a',
    );
    const e = await getNotionMapEntry('vehicles', 'del3');
    expect(e?.tombstone).toBe(false);
    expect(e?.deletedAt).toBeNull();
  });

  it('push applied delete marks map tombstone via sync', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'wk-a' });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    const delOp = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'push-del',
      op: 'delete',
      ownerUserId: 'wk-a',
      mutatedAt: nowISO(),
    });
    await putOutboxItem(delOp);
    setCloudProviderForTests(
      mockNotionProvider({
        workspaceKey: 'wk-a',
        push: async (ops) => ({ applied: ops.map((o) => o.opId), conflicts: [] }),
        pullRows: [],
      }),
    );
    const r = await bidirectionalSync();
    expect(r.ok).toBe(true);
    expect((await getNotionMapEntry('vehicles', 'push-del'))?.tombstone).toBe(true);
    expect(await listAllNotionMap()).toHaveLength(1);
  });
});

describe('D2-P5 verify park corridor end-to-end', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
    setCloudProviderForTests(null);
  });

  it('verifyConnection parks prior Notion workspace instead of blocking', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'stay',
        op: 'upsert',
        payload: vehicle('stay', 'Stay', nowISO()),
        ownerUserId: 'wk-a',
      }),
    );
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'wk-b' });
    setCloudProviderForTests(mockNotionProvider({ workspaceKey: 'wk-b' }));
    const r = await verifyConnection();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/保留|切换/);
    expect(await countOutboxForOwner('wk-a')).toBe(1);
    const meta = await (await import('./outbox')).getSyncMeta();
    expect(meta.cloudUserId).toBe('wk-b');
  });
});
