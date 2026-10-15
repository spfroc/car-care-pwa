import { getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { CloudProviderId, CloudStorageConfig } from './types';
import type { SettingRow } from '../types';

const KEY = 'cloudStorage';

const DEFAULT: CloudStorageConfig = { provider: 'none' };

function looksLikeServiceRole(key: string): boolean {
  if (/service_role/i.test(key)) return true;
  // JWT payload often contains role claim — decode middle segment if present
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const json = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (json?.role === 'service_role') return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function assertHttpsUrl(raw: string, label: string): string {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') throw new Error(`${label} 必须使用 https`);
    return u.toString().replace(/\/+$/, '');
  } catch (e) {
    if (e instanceof Error && e.message.includes('https')) throw e;
    throw new Error(`${label} 无效`);
  }
}

/** Direct IDB read — avoids circular import with repositories/settings ↔ outbox. */
export async function getCloudStorageConfig(): Promise<CloudStorageConfig> {
  const row = await (await getDB()).get('settings', KEY);
  const v = row?.value as CloudStorageConfig | undefined;
  if (!v || typeof v !== 'object') return { ...DEFAULT };
  return {
    provider: (v.provider as CloudProviderId) ?? 'none',
    supabaseUrl: typeof v.supabaseUrl === 'string' ? v.supabaseUrl : undefined,
    supabaseAnonKey: typeof v.supabaseAnonKey === 'string' ? v.supabaseAnonKey : undefined,
    notionGatewayUrl: typeof v.notionGatewayUrl === 'string' ? v.notionGatewayUrl : undefined,
    notionWorkspaceHint:
      typeof v.notionWorkspaceHint === 'string' ? v.notionWorkspaceHint : undefined,
    workspaceKey: typeof v.workspaceKey === 'string' ? v.workspaceKey : undefined,
    notionGatewayKeyFp:
      typeof v.notionGatewayKeyFp === 'string' ? v.notionGatewayKeyFp : undefined,
    notionTargetGuard:
      v.notionTargetGuard === 'off' ||
      v.notionTargetGuard === 'observe' ||
      v.notionTargetGuard === 'enforce'
        ? v.notionTargetGuard
        : undefined,
  };
}

export async function setCloudStorageConfig(cfg: CloudStorageConfig): Promise<void> {
  const anon = cfg.supabaseAnonKey?.trim();
  if (anon && looksLikeServiceRole(anon)) {
    throw new Error('拒绝保存：检测到 service_role。请只使用 anon / publishable key。');
  }
  if (anon && anon.length > 2000) {
    throw new Error('密钥过长，请确认粘贴的是 anon key。');
  }
  if (cfg.supabaseUrl) {
    try {
      const u = new URL(cfg.supabaseUrl.trim());
      if (u.protocol !== 'https:') throw new Error('Supabase URL 必须使用 https');
    } catch (e) {
      if (e instanceof Error && e.message.includes('https')) throw e;
      throw new Error('Supabase URL 无效');
    }
  }
  let notionGatewayUrl: string | undefined;
  if (cfg.notionGatewayUrl?.trim()) {
    notionGatewayUrl = assertHttpsUrl(cfg.notionGatewayUrl, 'Notion Gateway URL');
  }
  // Whitelist only — never persist bearer / Integration Token / JWT (§3.5.6)
  const guard = cfg.notionTargetGuard;
  const value: CloudStorageConfig = {
    provider: cfg.provider,
    supabaseUrl: cfg.supabaseUrl?.trim() || undefined,
    supabaseAnonKey: anon || undefined,
    notionGatewayUrl,
    notionWorkspaceHint: cfg.notionWorkspaceHint?.trim() || undefined,
    workspaceKey: cfg.workspaceKey?.trim() || undefined,
    notionGatewayKeyFp: cfg.notionGatewayKeyFp?.trim().toLowerCase() || undefined,
    notionTargetGuard:
      guard === 'off' || guard === 'observe' || guard === 'enforce' ? guard : undefined,
  };
  const row: SettingRow = { key: KEY, value, updatedAt: nowISO() };
  await (await getDB()).put('settings', row);
}

export async function clearCloudStorageConfig(): Promise<void> {
  await setCloudStorageConfig({ provider: 'none' });
}
