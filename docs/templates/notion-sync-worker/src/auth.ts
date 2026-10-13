import type { GatewayEnv } from './types.ts';

/** Constant-time-ish compare for API keys (Workers: no crypto.timingSafeEqual for strings of unequal length). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  if (!h.startsWith('Bearer ')) return null;
  const token = h.slice(7).trim();
  return token.length ? token : null;
}

export function assertGatewayAuth(req: Request, env: GatewayEnv): void {
  const key = env.GATEWAY_API_KEY;
  if (!key) {
    throw Object.assign(new Error('gateway misconfigured'), { status: 503, code: 'notion_unavailable' });
  }
  const token = extractBearer(req);
  if (!token || !safeEqual(token, key)) {
    throw Object.assign(new Error('unauthorized'), { status: 401, code: 'unauthorized' });
  }
}
