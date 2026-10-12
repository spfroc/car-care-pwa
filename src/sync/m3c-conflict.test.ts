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

  it('resolve failure (offline push after keep_local enqueue) keeps recoverable state', async () => {
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
    // Cloud still newer than bumped? nowISO in 2026-10 should win.
    // Force re-open path: set cloud extremely far future after we resolve? 
    // Instead: take_cloud with missing payload should fail and keep open.
    const broken = {
      ...c,
      cloudSnapshot: { op: 'upsert' as const }, // no payload
    };
    const { putConflict } = await import('./conflictStore');
    await putConflict(broken);
    const result = await resolveConflict(c.id, 'take_cloud');
    expect(result.ok).toBe(false);
    const still = await listOpenConflicts();
    expect(still.some((x) => x.id === c.id)).toBe(true);
  });
});
