import type { GatewayEnv } from './types.ts';

/** Comma-separated ALLOWED_ORIGIN list; exact match only — never reflect arbitrary Origin. */
export function parseAllowedOrigins(env: GatewayEnv): string[] {
  return (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(req: Request, env: GatewayEnv): HeadersInit {
  const origin = req.headers.get('Origin') ?? '';
  const allowedList = parseAllowedOrigins(env);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowedList.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  // misconfigured / unmatched Origin: do not reflect arbitrary Origin
  return headers;
}

export function originAllowed(req: Request, env: GatewayEnv): boolean {
  const origin = req.headers.get('Origin');
  if (!origin) return true; // non-CORS clients
  const allowedList = parseAllowedOrigins(env);
  if (!allowedList.length) return false;
  return allowedList.includes(origin);
}
