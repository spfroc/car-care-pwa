import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareIso, decidePushOp } from '../src/lww.ts';

describe('LWW decidePushOp', () => {
  it('creates when absent', () => {
    const d = decidePushOp({
      op: 'upsert',
      mutatedAt: '2026-10-13T05:00:00.000Z',
      presence: { kind: 'absent' },
    });
    assert.deepEqual(d, { action: 'create' });
  });

  it('cloud_newer does not write', () => {
    const d = decidePushOp({
      op: 'upsert',
      mutatedAt: '2026-10-13T05:00:00.000Z',
      presence: { kind: 'alive', updatedAt: '2026-10-13T06:00:00.000Z' },
    });
    assert.deepEqual(d, { action: 'conflict', reason: 'cloud_newer' });
  });

  it('rejects stale resurrection', () => {
    const d = decidePushOp({
      op: 'upsert',
      mutatedAt: '2026-10-13T04:00:00.000Z',
      presence: {
        kind: 'tombstone',
        pageId: 'p1',
        deletedAt: '2026-10-13T05:00:00.000Z',
        updatedAt: '2026-10-13T05:00:00.000Z',
      },
    });
    assert.deepEqual(d, { action: 'conflict', reason: 'skipped_deleted' });
  });

  it('allows newer restore', () => {
    const d = decidePushOp({
      op: 'upsert',
      mutatedAt: '2026-10-13T06:00:00.000Z',
      presence: {
        kind: 'tombstone',
        pageId: 'p1',
        deletedAt: '2026-10-13T05:00:00.000Z',
        updatedAt: '2026-10-13T05:00:00.000Z',
      },
    });
    assert.deepEqual(d, { action: 'restore_and_patch' });
  });

  it('ambiguous duplicate pages refuse silent success', () => {
    const d = decidePushOp({
      op: 'upsert',
      mutatedAt: '2026-10-13T07:00:00.000Z',
      presence: { kind: 'alive', updatedAt: '2026-10-13T05:00:00.000Z' },
      duplicateCount: 2,
    });
    assert.deepEqual(d, { action: 'conflict', reason: 'ambiguous_race' });
  });

  it('compareIso ordering', () => {
    assert.equal(compareIso('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'), -1);
  });
});
