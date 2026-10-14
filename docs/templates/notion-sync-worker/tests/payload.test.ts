import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodePayloadJson, slimPayload, MAX_PAYLOAD_CHARS } from '../src/payload.ts';

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
