import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertGatewayAuth, extractBearer, safeEqual } from '../src/auth.ts';

describe('auth', () => {
  it('safeEqual', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'ab'), false);
  });

  it('extractBearer', () => {
    const req = new Request('https://x', { headers: { Authorization: 'Bearer secret' } });
    assert.equal(extractBearer(req), 'secret');
  });

  it('401 on missing/wrong key', () => {
    const env = { NOTION_TOKEN: 'n', GATEWAY_API_KEY: 'good' } as any;
    assert.throws(
      () => assertGatewayAuth(new Request('https://x'), env),
      (e: any) => e.status === 401,
    );
    assert.throws(
      () =>
        assertGatewayAuth(
          new Request('https://x', { headers: { Authorization: 'Bearer bad' } }),
          env,
        ),
      (e: any) => e.status === 401,
    );
    assert.doesNotThrow(() =>
      assertGatewayAuth(
        new Request('https://x', { headers: { Authorization: 'Bearer good' } }),
        env,
      ),
    );
  });
});
