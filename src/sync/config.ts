import { getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { CloudProviderId, CloudStorageConfig } from './types';
import type { SettingRow } from '../types';

const KEY = 'cloudStorage';

const DEFAULT: CloudStorageConfig = { provider: 'none' };

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
  if (cfg.supabaseAnonKey && /service_role/i.test(cfg.supabaseAnonKey)) {
    throw new Error('拒绝保存：检测到 service_role。请只使用 anon / publishable key。');
  }
  if (cfg.supabaseAnonKey && cfg.supabaseAnonKey.length > 2000) {
    throw new Error('密钥过长，请确认粘贴的是 anon key。');
  }
  const value: CloudStorageConfig = {
    provider: cfg.provider,
    supabaseUrl: cfg.supabaseUrl?.trim() || undefined,
    supabaseAnonKey: cfg.supabaseAnonKey?.trim() || undefined,
    notionWorkspaceHint: cfg.notionWorkspaceHint?.trim() || undefined,
  };
  const row: SettingRow = { key: KEY, value, updatedAt: nowISO() };
  await (await getDB()).put('settings', row);
  // Intentionally do NOT enqueue — cloud credentials stay local-only
}

export async function clearCloudStorageConfig(): Promise<void> {
  await setCloudStorageConfig({ provider: 'none' });
}
