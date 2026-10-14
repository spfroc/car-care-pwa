import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePayloadJson,
  slimPayload,
  hydrateCloudPayload,
  MAX_PAYLOAD_CHARS,
} from '../src/payload.ts';

describe('payload fail-closed', () => {
  it('accepts small payload', () => {
    const slim = slimPayload('vehicles', { note: 'ok', plate: 'X' });
    assert.equal('plate' in slim, false);
    const enc = encodePayloadJson(slim);
    assert.equal(enc.ok, true);
  });

  it('rejects oversize without truncation', () => {
    const big = { blob: 'x'.repeat(MAX_PAYLOAD_CHARS) };
    const enc = encodePayloadJson(big);
    assert.equal(enc.ok, false);
    if (!enc.ok) {
      assert.equal(enc.code, 'payload_too_large');
      assert.ok(enc.length > MAX_PAYLOAD_CHARS);
    }
  });

  it('strips base64-ish fields', () => {
    const slim = slimPayload('records', {
      note: 'a',
      imageBase64: 'aaaa',
      photoDataUrl: 'data:image/png;base64,xxx',
      mediaIds: ['m1'],
    });
    assert.equal(slim.imageBase64, undefined);
    assert.equal(slim.photoDataUrl, undefined);
    assert.deepEqual(slim.mediaIds, ['m1']);
  });
});

describe('hydrateCloudPayload round-trip columns', () => {
  it('restores vehicle name/plate/energyType/id after slim', () => {
    const full = {
      id: 'v-1',
      name: '我家车',
      plate: '沪A12345',
      energyType: 'gasoline',
      bodyType: 'sedan',
      fuelGrade: '92',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      deviceId: 'dev-a',
    };
    const slim = slimPayload('vehicles', full);
    assert.equal('name' in slim, false);
    assert.equal('plate' in slim, false);
    assert.equal('id' in slim, false);
    assert.equal(slim.bodyType, 'sedan');
    const enc = encodePayloadJson(slim);
    assert.equal(enc.ok, true);
    if (!enc.ok) return;
    const decoded = JSON.parse(enc.text) as Record<string, unknown>;
    const hydrated = hydrateCloudPayload('vehicles', decoded, {
      appEntityId: 'v-1',
      name: '我家车',
      plate: '沪A12345',
      energyType: 'gasoline',
      archived: false,
      appUpdatedAt: '2026-01-02T00:00:00.000Z',
      deviceId: 'dev-a',
    });
    assert.equal(hydrated.id, 'v-1');
    assert.equal(hydrated.name, '我家车');
    assert.equal(hydrated.plate, '沪A12345');
    assert.equal(hydrated.energyType, 'gasoline');
    assert.equal(hydrated.bodyType, 'sedan');
    assert.equal(hydrated.fuelGrade, '92');
    assert.equal(hydrated.archived, false);
    assert.equal(hydrated.updatedAt, '2026-01-02T00:00:00.000Z');
  });

  it('restores record vehicleId/type/date/amountPaid after slim', () => {
    const full = {
      id: 'r-1',
      vehicleId: 'v-1',
      type: 'fuel',
      date: '2026-01-03T00:00:00.000Z',
      amountPaid: 200,
      mediaIds: [],
      note: 'fill',
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    const slim = slimPayload('records', full);
    assert.equal('vehicleId' in slim, false);
    assert.equal('type' in slim, false);
    const hydrated = hydrateCloudPayload('records', slim, {
      appEntityId: 'r-1',
      vehicleId: 'v-1',
      recordType: 'fuel',
      recordDate: '2026-01-03T00:00:00.000Z',
      amountPaid: 200,
      appUpdatedAt: '2026-01-03T00:00:00.000Z',
    });
    assert.equal(hydrated.id, 'r-1');
    assert.equal(hydrated.vehicleId, 'v-1');
    assert.equal(hydrated.type, 'fuel');
    assert.equal(hydrated.date, '2026-01-03T00:00:00.000Z');
    assert.equal(hydrated.amountPaid, 200);
    assert.equal(hydrated.note, 'fill');
  });
});
