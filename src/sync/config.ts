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

/** Direct IDB read — avoids circular import with repositories/settings ↔ outbox. */
export async function getCloudStorageConfig(): Promise<CloudStorageConfig> {
  const row = await (await getDB()).get('settings', KEY);
  const v = row?.value as CloudStorageConfig | undefined;
  if (!v || typeof v !== 'object') return { ...DEFAULT };
  return {
    provider: (v.provider as CloudProviderId) ?? 'none',
    supabaseUrl: typeof v.supabaseUrl === 'string' ? v.supabaseUrl : undefined,
    supabaseAnonKey: typeof v.supabaseAnonKey === 'string' ? v.supabaseAnonKey : undefined,
    notionWorkspaceHint:
      typeof v.notionWorkspaceHint === 'string' ? v.notionWorkspaceHint : undefined,
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
  const value: CloudStorageConfig = {
    provider: cfg.provider,
    supabaseUrl: cfg.supabaseUrl?.trim() || undefined,
    supabaseAnonKey: anon || undefined,
    notionWorkspaceHint: cfg.notionWorkspaceHint?.trim() || undefined,
  };
  const row: SettingRow = { key: KEY, value, updatedAt: nowISO() };
  await (await getDB()).put('settings', row);
}

export async function clearCloudStorageConfig(): Promise<void> {
  await setCloudStorageConfig({ provider: 'none' });
}
