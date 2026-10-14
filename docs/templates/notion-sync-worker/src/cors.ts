import type { GatewayEnv } from './types.ts';

export function corsHeaders(req: Request, env: GatewayEnv): HeadersInit {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGIN ?? '').trim();
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowed && origin === allowed) {
    headers['Access-Control-Allow-Origin'] = allowed;
  } else if (!allowed && !origin) {
    // non-browser / curl without Origin: no ACAO needed
  } else if (!allowed) {
    // misconfigured: do not reflect arbitrary Origin
  }
  return headers;
}

export function originAllowed(req: Request, env: GatewayEnv): boolean {
  const origin = req.headers.get('Origin');
  if (!origin) return true; // non-CORS clients
  const allowed = (env.ALLOWED_ORIGIN ?? '').trim();
  if (!allowed) return false;
  return origin === allowed;
}
