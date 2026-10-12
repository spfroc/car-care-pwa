import { describe, expect, it } from 'vitest';
import { detectPullConflict, detectPushRejected, resolutionImpliesDelete } from './conflictDetect';
import type { CloudRow, SyncOutboxItem } from './types';

function pending(partial: Partial<SyncOutboxItem> & Pick<SyncOutboxItem, 'entityId' | 'op' | 'mutatedAt'>): SyncOutboxItem {
  return {
    opId: partial.opId ?? 'op1',
    entity: partial.entity ?? 'records',
    entityId: partial.entityId,
    op: partial.op,
    payload: partial.payload,
    mutatedAt: partial.mutatedAt,
    attempts: 0,
    nextRetryAt: partial.mutatedAt,
  };
}

function cloud(partial: Partial<CloudRow> & Pick<CloudRow, 'id' | 'updatedAt'>): CloudRow {
  return {
    entity: 'records',
    payload: { id: partial.id },
    deletedAt: null,
    ...partial,
  };
}

describe('detectPushRejected', () => {
  it('escalates vehicles/records to open', () => {
    const d = detectPushRejected({
      entity: 'records',
      entityId: 'r1',
      opId: 'op1',
      localOp: pending({ entityId: 'r1', op: 'upsert', mutatedAt: '2026-01-01T00:00:00.000Z', payload: { id: 'r1' } }),
      cloudUpdatedAt: '2026-02-01T00:00:00.000Z',
      cloudRow: cloud({ id: 'r1', updatedAt: '2026-02-01T00:00:00.000Z', payload: { id: 'r1', note: 'cloud' } }),
    });
    expect(d.escalate).toBe(true);
    if (d.escalate) expect(d.kind).toBe('push_rejected');
  });

  it('does not escalate stations/media', () => {
    const d = detectPushRejected({
      entity: 'stations',
      entityId: 's1',
      opId: 'op1',
      localOp: pending({ entity: 'stations', entityId: 's1', op: 'upsert', mutatedAt: '2026-01-01T00:00:00.000Z' }),
      cloudUpdatedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(d.escalate).toBe(false);
  });

  it('marks edit_vs_delete when local delete vs cloud upsert', () => {
    const d = detectPushRejected({
      entity: 'vehicles',
      entityId: 'v1',
      opId: 'op1',
      localOp: pending({ entity: 'vehicles', entityId: 'v1', op: 'delete', mutatedAt: '2026-01-01T00:00:00.000Z' }),
      cloudRow: cloud({ entity: 'vehicles', id: 'v1', updatedAt: '2026-02-01T00:00:00.000Z' }),
    });
    expect(d.escalate).toBe(true);
    if (d.escalate) expect(d.kind).toBe('edit_vs_delete');
  });
});

describe('detectPullConflict', () => {
  it('E2 edit_edit when pending and cloud newer', () => {
    const d = detectPullConflict({
      cloud: cloud({ id: 'r1', updatedAt: '2026-03-01T00:00:00.000Z', payload: { id: 'r1', note: 'B' } }),
      pendingOutbox: [
        pending({
          entityId: 'r1',
          op: 'upsert',
          mutatedAt: '2026-02-01T00:00:00.000Z',
          payload: { id: 'r1', note: 'A' },
        }),
      ],
    });
    expect(d.escalate).toBe(true);
    if (d.escalate) expect(d.kind).toBe('edit_edit');
  });

  it('E3 edit_vs_delete when pending upsert and cloud tombstone', () => {
    const d = detectPullConflict({
      cloud: cloud({
        id: 'r1',
        updatedAt: '2026-03-01T00:00:00.000Z',
        deletedAt: '2026-03-01T00:00:00.000Z',
      }),
      pendingOutbox: [
        pending({ entityId: 'r1', op: 'upsert', mutatedAt: '2026-02-01T00:00:00.000Z', payload: { id: 'r1' } }),
      ],
    });
    expect(d.escalate).toBe(true);
    if (d.escalate) expect(d.kind).toBe('edit_vs_delete');
  });

  it('suppresses self-push echo via recentAckStamps', () => {
    const d = detectPullConflict({
      cloud: cloud({ id: 'r1', updatedAt: '2026-02-01T00:00:00.000Z' }),
      pendingOutbox: [
        pending({ entityId: 'r1', op: 'upsert', mutatedAt: '2026-02-01T00:00:00.000Z' }),
      ],
      recentAckStamps: new Map([['records:r1', '2026-02-01T00:00:00.000Z']]),
    });
    expect(d.escalate).toBe(false);
    if (!d.escalate) expect(d.reason).toBe('echo');
  });

  it('does not escalate non-manual entities', () => {
    const d = detectPullConflict({
      cloud: cloud({ entity: 'settings', id: 'currency', updatedAt: '2026-03-01T00:00:00.000Z' }),
      pendingOutbox: [
        pending({
          entity: 'settings',
          entityId: 'currency',
          op: 'upsert',
          mutatedAt: '2026-02-01T00:00:00.000Z',
        }),
      ],
    });
    expect(d.escalate).toBe(false);
  });
});

describe('resolutionImpliesDelete', () => {
  it('detects delete on either side', () => {
    expect(
      resolutionImpliesDelete('take_cloud', { cloudSnapshot: { op: 'delete' } }),
    ).toBe(true);
    expect(
      resolutionImpliesDelete('keep_local', { localSnapshot: { op: 'delete' } }),
    ).toBe(true);
    expect(
      resolutionImpliesDelete('keep_local', { localSnapshot: { op: 'upsert', payload: {} } }),
    ).toBe(false);
  });
});
