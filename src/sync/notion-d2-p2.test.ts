/**
 * D2-P2: experimental settings + session lifecycle (D2.7 / D2.8 / C3 / C10).
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, getDB } from '../db';
import { nowISO } from '../lib/constants';
import {
  exportData,
  sanitizeSettingsForExport,
} from '../repositories/importExport';
import {
  getCloudStorageConfig,
  setCloudStorageConfig,
} from './config';
import { disconnectCloud, resolveProvider } from './engine';
import { isCloudEnqueueEnabled } from './outbox';
import {
  clearNotionRuntimeSession,
  getNotionRuntimeSession,
  hasValidNotionRuntimeSession,
  notionSessionStorageKeyForTests,
  resetNotionRuntimeSessionForTests,
  setNotionRuntimeSession,
  setNotionSessionBearer,
} from './notionSession';
import { MESSAGES } from '../i18n/messages';

async function resetDb() {
  resetNotionRuntimeSessionForTests();
  await closeDBForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('car-care-db');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

describe('D2.7 mutual exclusion (supabase vs notion)', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  it('CloudStorageConfig has a single provider — cannot be both', async () => {
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: 'anon-key',
      notionGatewayUrl: 'https://gw.example.com',
    });
    let c = await getCloudStorageConfig();
    expect(c.provider).toBe('supabase');
    expect(await isCloudEnqueueEnabled('vehicles')).toBe(true);

    // Switching to notion disables supabase enqueue even if supabase fields remain
    await setCloudStorageConfig({
      provider: 'notion',
      supabaseUrl: c.supabaseUrl,
      supabaseAnonKey: c.supabaseAnonKey,
      notionGatewayUrl: 'https://gw.example.com',
    });
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'ws' });
    c = await getCloudStorageConfig();
    expect(c.provider).toBe('notion');
    expect(c.supabaseUrl).toBe('https://abc.supabase.co');
    expect(await isCloudEnqueueEnabled('vehicles')).toBe(true);
    // Notion path: media never
    expect(await isCloudEnqueueEnabled('media')).toBe(false);

    // Back to supabase — notion session should be cleared by UI; simulate clear
    clearNotionRuntimeSession();
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: 'anon-key',
      notionGatewayUrl: 'https://gw.example.com',
    });
    c = await getCloudStorageConfig();
    expect(c.provider).toBe('supabase');
    expect(hasValidNotionRuntimeSession()).toBe(false);
    expect(await isCloudEnqueueEnabled('media')).toBe(true);
    // resolveProvider follows active provider only
    const p = await resolveProvider();
    expect(p?.id).toBe('supabase');
  });

  it('resolveProvider returns at most one active cloud provider', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: 'anon-key',
      notionGatewayUrl: 'https://gw.example.com',
    });
    const p = await resolveProvider();
    expect(p?.id).toBe('notion');
  });
});

describe('D2.8 cold start clears Key; URL persists', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  it('after session clear, URL remains and enqueue is false', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'ws-persist',
    });
    setNotionRuntimeSession({ bearer: 'session-secret-key', workspaceKey: 'ws-persist' });
    expect(hasValidNotionRuntimeSession()).toBe(true);
    expect(await isCloudEnqueueEnabled('vehicles')).toBe(true);

    // Simulate cold start / disconnect / 401 clear
    clearNotionRuntimeSession();
    expect(hasValidNotionRuntimeSession()).toBe(false);
    expect(getNotionRuntimeSession()).toBeNull();
    const c = await getCloudStorageConfig();
    expect(c.notionGatewayUrl).toBe('https://gw.example.com');
    expect(c.workspaceKey).toBe('ws-persist');
    expect(await isCloudEnqueueEnabled('vehicles')).toBe(false);
  });

  it('bearer-only pre-verify does not enable enqueue until workspaceKey set', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
    });
    setNotionSessionBearer('pre-verify-key');
    expect(getNotionRuntimeSession()?.bearer).toBe('pre-verify-key');
    expect(hasValidNotionRuntimeSession()).toBe(false);
    expect(await isCloudEnqueueEnabled('vehicles')).toBe(false);

    setNotionRuntimeSession({
      bearer: 'pre-verify-key',
      workspaceKey: 'ws-from-verify',
    });
    expect(hasValidNotionRuntimeSession()).toBe(true);
    expect(await isCloudEnqueueEnabled('vehicles')).toBe(true);
  });

  it('disconnectCloud clears Notion session', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
    });
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'ws' });
    const r = await disconnectCloud();
    expect(r.ok).toBe(true);
    expect(hasValidNotionRuntimeSession()).toBe(false);
    expect((await getCloudStorageConfig()).provider).toBe('none');
  });

  it('optional sessionStorage is same-tab only; clear removes it', () => {
    // jsdom/node may or may not have sessionStorage — exercise the API safely
    setNotionRuntimeSession({ bearer: 'tab-key', workspaceKey: 'ws' });
    const key = notionSessionStorageKeyForTests();
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(key);
    } catch {
      stored = null;
    }
    if (typeof sessionStorage !== 'undefined') {
      expect(stored).toBeTruthy();
      expect(stored).toContain('tab-key');
      // Must not look like a long-term IDB dump key
      expect(key).toMatch(/session/i);
    }
    clearNotionRuntimeSession();
    try {
      expect(sessionStorage.getItem(key)).toBeNull();
    } catch {
      /* no sessionStorage */
    }
  });
});

describe('C3 export strips session secrets', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  it('sanitizeSettingsForExport drops bearer/apiKey/token fields', () => {
    const rows = [
      {
        key: 'cloudStorage',
        value: {
          provider: 'notion',
          notionGatewayUrl: 'https://gw.example.com',
          workspaceKey: 'ws',
          bearer: 'SHOULD-NOT-EXPORT',
          apiKey: 'SHOULD-NOT-EXPORT',
          GATEWAY_API_KEY: 'SHOULD-NOT-EXPORT',
          notionToken: 'FAKE' + '_NOTION_TOKEN',
          token: 'nope',
        },
        updatedAt: nowISO(),
      },
      { key: 'language', value: 'zh-CN', updatedAt: nowISO() },
    ];
    const out = sanitizeSettingsForExport(rows);
    const cloud = out.find((r) => r.key === 'cloudStorage')?.value as Record<string, unknown>;
    expect(cloud.provider).toBe('notion');
    expect(cloud.notionGatewayUrl).toBe('https://gw.example.com');
    expect(cloud.workspaceKey).toBe('ws');
    expect(cloud.bearer).toBeUndefined();
    expect(cloud.apiKey).toBeUndefined();
    expect(cloud.GATEWAY_API_KEY).toBeUndefined();
    expect(cloud.notionToken).toBeUndefined();
    expect(cloud.token).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/SHOULD-NOT-EXPORT|FAKE_NOTION_TOKEN/);
  });

  it('exportData JSON never contains in-memory session bearer', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'ws',
    });
    // Poison IDB with a secret-shaped field (should still be stripped)
    const db = await getDB();
    await db.put('settings', {
      key: 'cloudStorage',
      value: {
        provider: 'notion',
        notionGatewayUrl: 'https://gw.example.com',
        workspaceKey: 'ws',
        bearer: 'memory-only-secret-xyz',
        GATEWAY_API_KEY: 'memory-only-secret-xyz',
      },
      updatedAt: nowISO(),
    });
    setNotionRuntimeSession({ bearer: 'memory-only-secret-xyz', workspaceKey: 'ws' });

    const { json } = await exportData(false);
    expect(json).toContain('https://gw.example.com');
    expect(json).not.toContain('memory-only-secret-xyz');
    expect(json).not.toMatch(/"bearer"\s*:/);
    expect(json).not.toMatch(/GATEWAY_API_KEY/);
  });
});

describe('C10 copy: no forbidden media marketing phrases', () => {
  it('i18n zh/en storage strings avoid 完整图文云备份 / full photo cloud backup', () => {
    const zhCN = MESSAGES['zh-CN'];
    const en = MESSAGES.en;
    const blob = JSON.stringify({ zhCN, en });
    expect(blob).not.toContain('完整图文云备份');
    expect(blob.toLowerCase()).not.toContain('full photo cloud backup');
    expect(blob.toLowerCase()).not.toContain('photos synced to notion');
    // Positive: media notice present
    expect(zhCN['storage.notionMediaNotice']).toMatch(/不同步图片|仅保存在本机/);
    expect(en['storage.notionMediaNotice'].toLowerCase()).toMatch(/not synced|stay on this device/);
  });

  it('DataStorageSettings source has media notice key and no forbidden phrase', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/DataStorageSettings.tsx'),
      'utf8',
    );
    expect(src).toContain('storage.notionMediaNotice');
    expect(src).toContain('storage.notionMutualExclusion');
    expect(src).not.toContain('完整图文云备份');
  });
});
