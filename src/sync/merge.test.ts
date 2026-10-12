import { describe, expect, it } from 'vitest';
import { dedupeOutbox, mergeCloudIntoPlan, shouldApplyCloudRow } from './merge';
import type { CloudRow, SyncOutboxItem } from './types';

function row(partial: Partial<CloudRow> & Pick<CloudRow, 'id' | 'updatedAt'>): CloudRow {
  return {
    entity: 'vehicles',
    payload: { id: partial.id },
    deletedAt: null,
    ...partial,
  };
}

describe('shouldApplyCloudRow', () => {
  it('skips when local outbox pending for same id', () => {
    const pending: SyncOutboxItem[] = [
      {
        opId: '1',
        entity: 'vehicles',
        entityId: 'v1',
        op: 'upsert',
        mutatedAt: '2026-01-02T00:00:00.000Z',
        attempts: 0,
        nextRetryAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    const r = shouldApplyCloudRow(
      row({ id: 'v1', updatedAt: '2026-01-03T00:00:00.000Z' }),
      { updatedAt: '2026-01-02T00:00:00.000Z' },
      pending,
    );
    expect(r.apply).toBe(false);
    expect(r.conflict?.resolution).toBe('kept_local');
  });

  it('applies newer cloud upsert (LWW)', () => {
    const r = shouldApplyCloudRow(
      row({ id: 'v1', updatedAt: '2026-01-03T00:00:00.000Z' }),
      { updatedAt: '2026-01-01T00:00:00.000Z' },
      [],
    );
    expect(r.apply).toBe(true);
  });

  it('keeps newer local over older cloud', () => {
    const r = shouldApplyCloudRow(
      row({ id: 'v1', updatedAt: '2026-01-01T00:00:00.000Z' }),
      { updatedAt: '2026-01-03T00:00:00.000Z' },
      [],
    );
    expect(r.apply).toBe(false);
    expect(r.conflict?.resolution).toBe('kept_local');
  });

  it('edit wins over delete when local newer', () => {
    const r = shouldApplyCloudRow(
      row({
        id: 'v1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: '2026-01-01T00:00:00.000Z',
      }),
      { updatedAt: '2026-01-02T00:00:00.000Z' },
      [],
    );
    expect(r.apply).toBe(false);
    expect(r.conflict?.resolution).toBe('kept_edit_over_delete');
  });

  it('applies cloud delete when newer than local', () => {
    const r = shouldApplyCloudRow(
      row({
        id: 'v1',
        updatedAt: '2026-01-03T00:00:00.000Z',
        deletedAt: '2026-01-03T00:00:00.000Z',
      }),
      { updatedAt: '2026-01-01T00:00:00.000Z' },
      [],
    );
    expect(r.apply).toBe(true);
  });

  it('dedups equal timestamps (no apply)', () => {
    const r = shouldApplyCloudRow(
      row({ id: 'v1', updatedAt: '2026-01-01T00:00:00.000Z' }),
      { updatedAt: '2026-01-01T00:00:00.000Z' },
      [],
    );
    expect(r.apply).toBe(false);
  });
});

describe('dedupeOutbox', () => {
  it('keeps latest mutatedAt per entity+id', () => {
    const items: SyncOutboxItem[] = [
      {
        opId: 'a',
        entity: 'records',
        entityId: 'r1',
        op: 'upsert',
        mutatedAt: '2026-01-01T00:00:00.000Z',
        attempts: 0,
        nextRetryAt: '2026-01-01T00:00:00.000Z',
      },
      {
        opId: 'b',
        entity: 'records',
        entityId: 'r1',
        op: 'delete',
        mutatedAt: '2026-01-02T00:00:00.000Z',
        attempts: 0,
        nextRetryAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    const d = dedupeOutbox(items);
    expect(d).toHaveLength(1);
    expect(d[0].opId).toBe('b');
    expect(d[0].op).toBe('delete');
  });
});

describe('mergeCloudIntoPlan', () => {
  it('dedups cloud rows and plans upserts/deletes', () => {
    const local = new Map([['vehicles:v1', { updatedAt: '2026-01-01T00:00:00.000Z' }]]);
    const plan = mergeCloudIntoPlan(
      [
        row({ id: 'v1', updatedAt: '2026-01-01T00:00:00.000Z', payload: { n: 1 } }),
        row({ id: 'v1', updatedAt: '2026-01-05T00:00:00.000Z', payload: { n: 2 } }),
        row({
          id: 'v2',
          updatedAt: '2026-01-05T00:00:00.000Z',
          deletedAt: '2026-01-05T00:00:00.000Z',
        }),
      ],
      (e, id) => local.get(`${e}:${id}`),
      [],
      '2026-01-06T00:00:00.000Z',
    );
    expect(plan.toUpsert).toHaveLength(1);
    expect((plan.toUpsert[0].payload as { n: number }).n).toBe(2);
    expect(plan.toDelete).toHaveLength(1);
    expect(plan.toDelete[0].id).toBe('v2');
  });
});
