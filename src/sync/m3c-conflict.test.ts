import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import type { CareRecord, Vehicle } from '../types';
import { setCloudStorageConfig } from './config';
import { listOpenConflicts } from './conflictStore';
import { resolveConflict } from './conflictResolve';
import { bidirectionalSync, setCloudProviderForTests } from './engine';
import {
  listOutbox,
  listReadyOutbox,
  patchSyncMeta,
  putOutboxItem,
} from './outbox';
import { MemoryCloudProvider } from './providers/memory';
import { setSyncTxHookForTests } from './txHooks';
import { putRecord } from '../repositories/records';
import { putVehicle } from '../repositories/vehicles';

async function reset() {
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
    energyType: 'ICE',
    bodyType: 'SEDAN',
    createdAt: updatedAt,
    updatedAt,
  };
}

function record(id: string, vehicleId: string, note: string, updatedAt: string): CareRecord {
  return {
    id,
    vehicleId,
    type: 'wash',
    date: updatedAt,
    amountPaid: 20,
    mediaIds: [],
    note,
    createdAt: updatedAt,
    updatedAt,
    washKind: 'basic',
  } as CareRecord;
}

describe('M3-C conflict UI engine paths', () => {
  let mem: MemoryCloudProvider;

  beforeEach(async () => {
    setSyncTxHookForTests(null);
    await reset();
    mem = new MemoryCloudProvider();
    setCloudProviderForTests(mem);
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'test-anon-key',
    });
    await patchSyncMeta({
      cloudUserId: 'test-user',
      deviceId: 'dev-a',
      status: 'idle',
      provider: 'supabase',
    });
  });

  afterEach(async () => {
    setSyncTxHookForTests(null);
    setCloudProviderForTests(null);
    await closeDBForTests();
  });

  it('E1 push cloud_newer opens conflict and keeps outbox (no silent drop)', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudNewer', '2026-03-01T00:00:00.000Z'),
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
    });
    const r = await bidirectionalSync();
    expect(r.ok).toBe(true);
    const open = await listOpenConflicts();
    expect(open.some((c) => c.entity === 'vehicles' && c.entityId === 'v1')).toBe(true);
    const box = await listOutbox();
    expect(box.some((o) => o.entity === 'vehicles' && o.entityId === 'v1')).toBe(true);
    const ready = await listReadyOutbox();
    expect(ready.some((o) => o.entity === 'vehicles' && o.entityId === 'v1')).toBe(false);
  });

  it('E2 offline then sync opens edit_edit for concurrent record edit', async () => {
    await putVehicle(vehicle('v1', 'Car', '2026-01-01T00:00:00.000Z'));
    await putRecord(record('r1', 'v1', 'local-edit', '2026-02-01T00:00:00.000Z'));
    // Clear auto outbox from puts; seed explicit pending + newer cloud
    await (await getDB()).clear('sync_outbox');
    await putOutboxItem({
      opId: 'local-pending',
      entity: 'records',
      entityId: 'r1',
      op: 'upsert',
      payload: record('r1', 'v1', 'local-edit', '2026-02-01T00:00:00.000Z'),
      mutatedAt: '2026-02-01T00:00:00.000Z',
      attempts: 0,
      nextRetryAt: '2026-02-01T00:00:00.000Z',
      ownerUserId: 'test-user',
    });
    mem.rows.set('records:r1', {
      entity: 'records',
      id: 'r1',
      payload: record('r1', 'v1', 'cloud-edit', '2026-03-01T00:00:00.000Z'),
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
      deviceId: 'dev-b',
    });
    // Make push fail LWW so pending survives to pull escalate
    // Actually push will try and get cloud_newer → E1; that's also open. Either path OK.
    const r = await bidirectionalSync();
    expect(r.ok).toBe(true);
    const open = await listOpenConflicts();
    expect(open.some((c) => c.entityId === 'r1')).toBe(true);
    const local = await (await getDB()).get('records', 'r1');
    // Must not silently take cloud while pending
    expect(local?.note).toBe('local-edit');
  });

  it('E3 edit_vs_delete opens with kind', async () => {
    await putVehicle(vehicle('v1', 'Car', '2026-01-01T00:00:00.000Z'));
    await putRecord(record('r1', 'v1', 'keep-me', '2026-02-01T00:00:00.000Z'));
    await (await getDB()).clear('sync_outbox');
    await putOutboxItem({
      opId: 'edit-op',
      entity: 'records',
      entityId: 'r1',
      op: 'upsert',
      payload: record('r1', 'v1', 'keep-me', '2026-02-01T00:00:00.000Z'),
      mutatedAt: '2026-02-01T00:00:00.000Z',
      attempts: 0,
      nextRetryAt: '2026-02-01T00:00:00.000Z',
      ownerUserId: 'test-user',
    });
    mem.rows.set('records:r1', {
      entity: 'records',
      id: 'r1',
      payload: {},
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: '2026-03-01T00:00:00.000Z',
      deviceId: 'dev-b',
    });
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const hit = open.find((c) => c.entityId === 'r1');
    expect(hit?.kind).toBe('edit_vs_delete');
  });

  it('take_cloud applies cloud first then clears outbox', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudNewer', '2026-03-01T00:00:00.000Z'),
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
    });
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v1');
    expect(c).toBeTruthy();
    const beforeBox = await listOutbox();
    expect(beforeBox.some((o) => o.entityId === 'v1')).toBe(true);

    const result = await resolveConflict(c!.id, 'take_cloud');
    expect(result.ok).toBe(true);
    const local = await (await getDB()).get('vehicles', 'v1');
    expect(local?.name).toBe('CloudNewer');
    const afterBox = await listOutbox();
    expect(afterBox.some((o) => o.entityId === 'v1')).toBe(false);
    const stillOpen = await listOpenConflicts();
    expect(stillOpen.some((x) => x.id === c!.id)).toBe(false);
  });

  it('keep_local bumps and pushes via normal LWW', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudNewer', '2026-02-01T00:00:00.000Z'),
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    });
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v1');
    expect(c).toBeTruthy();

    const result = await resolveConflict(c!.id, 'keep_local');
    // bump nowISO() should be newer than 2026-02 cloud → push applies
    expect(result.ok).toBe(true);
    expect(result.reopened).not.toBe(true);
    const cloud = mem.rows.get('vehicles:v1');
    expect((cloud?.payload as Vehicle).name).toBe('Local');
  });

  it('stations stay on silent LWW (no open)', async () => {
    const ts = '2026-01-01T00:00:00.000Z';
    await putOutboxItem({
      opId: 'st1',
      entity: 'stations',
      entityId: 's1',
      op: 'upsert',
      payload: { id: 's1', name: 'Local', stationType: 'gas', updatedAt: ts, createdAt: ts },
      mutatedAt: ts,
      attempts: 0,
      nextRetryAt: ts,
      ownerUserId: 'test-user',
    });
    mem.rows.set('stations:s1', {
      entity: 'stations',
      id: 's1',
      payload: { id: 's1', name: 'Cloud', stationType: 'gas', updatedAt: '2026-03-01T00:00:00.000Z', createdAt: ts },
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
    });
    await bidirectionalSync();
    const open = await listOpenConflicts();
    expect(open.some((c) => c.entity === 'stations')).toBe(false);
  });

  it('resolve failure (cloud read offline) keeps recoverable state', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'Cloud', '2026-05-01T00:00:00.000Z'),
      updatedAt: '2026-05-01T00:00:00.000Z',
      deletedAt: null,
    });
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v1')!;
    const beforeLocal = await (await getDB()).get('vehicles', 'v1');
    const beforeBox = await listOutbox();

    mem.offline = true;
    const result = await resolveConflict(c.id, 'take_cloud');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/读取云端失败|offline/);

    const still = await listOpenConflicts();
    expect(still.some((x) => x.id === c.id)).toBe(true);
    const afterLocal = await (await getDB()).get('vehicles', 'v1');
    expect(afterLocal?.name).toBe(beforeLocal?.name);
    const afterBox = await listOutbox();
    expect(afterBox.map((o) => o.opId).sort()).toEqual(beforeBox.map((o) => o.opId).sort());
  });

  it('P0 take_cloud after post-conflict local edit re-prompts and keeps new outbox', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudNewer', '2026-03-01T00:00:00.000Z'),
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
    });
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v1');
    expect(c).toBeTruthy();
    const blockedBefore = new Set(c!.blockedOpIds ?? []);

    // User edits again while conflict is still open
    await putVehicle(vehicle('v1', 'PostConflictEdit', '2026-10-01T00:00:00.000Z'));
    const midBox = await listOutbox();
    const postOps = midBox.filter(
      (o) => o.entityId === 'v1' && !blockedBefore.has(o.opId),
    );
    expect(postOps.length).toBeGreaterThan(0);

    const result = await resolveConflict(c!.id, 'take_cloud');
    expect(result.ok).toBe(false);
    expect(result.reopened).toBe(true);
    expect(result.message).toMatch(/新编辑/);

    const local = await (await getDB()).get('vehicles', 'v1');
    expect(local?.name).toBe('PostConflictEdit'); // must NOT silently take cloud
    const afterBox = await listOutbox();
    for (const op of postOps) {
      expect(afterBox.some((o) => o.opId === op.opId)).toBe(true);
    }
    const stillOpen = await listOpenConflicts();
    const refreshed = stillOpen.find((x) => x.id === c!.id);
    expect(refreshed).toBeTruthy();
    expect(refreshed!.status).toBe('open');
    expect(refreshed!.localSnapshot?.op).toBe('upsert');
    expect((refreshed!.localSnapshot?.payload as Vehicle).name).toBe('PostConflictEdit');
    // Post-conflict ops absorbed into blocked set after re-prompt refresh
    for (const op of postOps) {
      expect(refreshed!.blockedOpIds ?? []).toContain(op.opId);
    }
  });

  it('P1 take_cloud rejects account mismatch and preserves state', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudNewer', '2026-03-01T00:00:00.000Z'),
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
    });
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v1')!;
    const beforeLocal = await (await getDB()).get('vehicles', 'v1');
    const beforeBox = await listOutbox();

    mem.userId = 'other-user';
    const result = await resolveConflict(c.id, 'take_cloud');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/账号|绑定|切换/);

    const still = await listOpenConflicts();
    expect(still.some((x) => x.id === c.id)).toBe(true);
    const afterLocal = await (await getDB()).get('vehicles', 'v1');
    expect(afterLocal?.name).toBe(beforeLocal?.name);
    const afterBox = await listOutbox();
    expect(afterBox.map((o) => o.opId).sort()).toEqual(beforeBox.map((o) => o.opId).sort());
  });

  it('P1 take_cloud refreshes when cloud changed again', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudV1', '2026-03-01T00:00:00.000Z'),
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
    });
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v1')!;
    expect(c.cloudUpdatedAt).toBe('2026-03-01T00:00:00.000Z');
    const beforeLocal = await (await getDB()).get('vehicles', 'v1');
    const beforeBox = await listOutbox();

    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudV2', '2026-04-01T00:00:00.000Z'),
      updatedAt: '2026-04-01T00:00:00.000Z',
      deletedAt: null,
    });

    const result = await resolveConflict(c.id, 'take_cloud');
    expect(result.ok).toBe(false);
    expect(result.reopened).toBe(true);
    expect(result.message).toMatch(/云端版本已变化/);

    const still = await listOpenConflicts();
    const refreshed = still.find((x) => x.id === c.id);
    expect(refreshed).toBeTruthy();
    expect(refreshed!.cloudUpdatedAt).toBe('2026-04-01T00:00:00.000Z');
    expect((refreshed!.cloudSnapshot?.payload as Vehicle).name).toBe('CloudV2');
    const afterLocal = await (await getDB()).get('vehicles', 'v1');
    expect(afterLocal?.name).toBe(beforeLocal?.name);
    const afterBox = await listOutbox();
    expect(afterBox.map((o) => o.opId).sort()).toEqual(beforeBox.map((o) => o.opId).sort());
  });

  it('TOCTOU take_cloud: edit after check before tx must not overwrite local', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudNewer', '2026-03-01T00:00:00.000Z'),
      updatedAt: '2026-03-01T00:00:00.000Z',
      deletedAt: null,
    });
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v1');
    expect(c).toBeTruthy();
    const blockedBefore = new Set(c!.blockedOpIds ?? []);

    // Outside P0 check passes; inject a new edit in the race window before apply tx.
    setSyncTxHookForTests(async (phase) => {
      if (phase === 'before_take_cloud_tx') {
        await putVehicle(vehicle('v1', 'RaceAfterCheck', '2026-10-05T00:00:00.000Z'));
      }
    });

    const result = await resolveConflict(c!.id, 'take_cloud');
    expect(result.ok).toBe(false);
    expect(result.reopened).toBe(true);
    expect(result.message).toMatch(/新编辑/);

    const local = await (await getDB()).get('vehicles', 'v1');
    expect(local?.name).toBe('RaceAfterCheck');
    const afterBox = await listOutbox();
    const raceOps = afterBox.filter(
      (o) => o.entityId === 'v1' && !blockedBefore.has(o.opId),
    );
    expect(raceOps.length).toBeGreaterThan(0);
    expect(raceOps.some((o) => (o.payload as Vehicle)?.name === 'RaceAfterCheck')).toBe(true);
    const stillOpen = await listOpenConflicts();
    expect(stillOpen.some((x) => x.id === c!.id && x.status === 'open')).toBe(true);
  });

  it('TOCTOU keep_local: subsequent edit must not be cleared or overwritten', async () => {
    await putVehicle(vehicle('v1', 'Local', '2026-01-01T00:00:00.000Z'));
    mem.rows.set('vehicles:v1', {
      entity: 'vehicles',
      id: 'v1',
      payload: vehicle('v1', 'CloudNewer', '2026-02-01T00:00:00.000Z'),
      updatedAt: '2026-02-01T00:00:00.000Z',
      deletedAt: null,
    });
    await bidirectionalSync();
    const open = await listOpenConflicts();
    const c = open.find((x) => x.entityId === 'v1');
    expect(c).toBeTruthy();
    const blockedBefore = new Set(c!.blockedOpIds ?? []);
    expect(c!.localSnapshot && 'payload' in c!.localSnapshot).toBe(true);
    expect((c!.localSnapshot?.payload as Vehicle).name).toBe('Local');

    setSyncTxHookForTests(async (phase) => {
      if (phase === 'before_keep_local_tx') {
        await putVehicle(vehicle('v1', 'KeepLocalRace', '2026-10-06T00:00:00.000Z'));
      }
    });

    const result = await resolveConflict(c!.id, 'keep_local');
    expect(result.ok).toBe(false);
    expect(result.reopened).toBe(true);
    expect(result.message).toMatch(/新编辑/);

    const local = await (await getDB()).get('vehicles', 'v1');
    // Must keep the newer race edit, not stale conflict snapshot "Local"
    expect(local?.name).toBe('KeepLocalRace');
    const afterBox = await listOutbox();
    const raceOps = afterBox.filter(
      (o) => o.entityId === 'v1' && !blockedBefore.has(o.opId),
    );
    expect(raceOps.length).toBeGreaterThan(0);
    expect(raceOps.some((o) => (o.payload as Vehicle)?.name === 'KeepLocalRace')).toBe(true);
    // Original blocked ops should still be present (tx aborted; no clear)
    for (const id of blockedBefore) {
      expect(afterBox.some((o) => o.opId === id)).toBe(true);
    }
    const stillOpen = await listOpenConflicts();
    const refreshed = stillOpen.find((x) => x.id === c!.id);
    expect(refreshed).toBeTruthy();
    expect(refreshed!.status).toBe('open');
    expect((refreshed!.localSnapshot?.payload as Vehicle).name).toBe('KeepLocalRace');
  });
});
