import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { corsHeaders, originAllowed, parseAllowedOrigins } from '../src/cors.ts';
import type { GatewayEnv } from '../src/types.ts';

const envMulti: GatewayEnv = {
  NOTION_TOKEN: 'x',
  GATEWAY_API_KEY: 'y',
  ALLOWED_ORIGIN: 'https://car-test.adobesun.com,http://localhost:5173',
};

describe('CORS multi-origin allowlist', () => {
  it('parses comma-separated origins', () => {
    assert.deepEqual(parseAllowedOrigins(envMulti), [
      'https://car-test.adobesun.com',
      'http://localhost:5173',
    ]);
  });

  it('allows car-test and localhost', () => {
    const a = new Request('https://gw.example/health', {
      headers: { Origin: 'https://car-test.adobesun.com' },
    });
    const b = new Request('https://gw.example/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(originAllowed(a, envMulti), true);
    assert.equal(originAllowed(b, envMulti), true);
    const ha = corsHeaders(a, envMulti) as Record<string, string>;
    assert.equal(ha['Access-Control-Allow-Origin'], 'https://car-test.adobesun.com');
  });

  it('rejects arbitrary Origin (no reflect)', () => {
    const evil = new Request('https://gw.example/health', {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(originAllowed(evil, envMulti), false);
    const h = corsHeaders(evil, envMulti) as Record<string, string>;
    assert.equal(h['Access-Control-Allow-Origin'], undefined);
  });

  it('allows non-browser clients without Origin', () => {
    const curl = new Request('https://gw.example/health');
    assert.equal(originAllowed(curl, envMulti), true);
  });
});
