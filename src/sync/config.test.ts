import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests } from '../db';
import {
  clearCloudStorageConfig,
  getCloudStorageConfig,
  setCloudStorageConfig,
} from './config';
import { NotionProvider } from './providers/notion';

async function reset() {
  await closeDBForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('car-care-db');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

describe('cloud config', () => {
  beforeEach(reset);
  afterEach(async () => {
    await closeDBForTests();
  });

  it('defaults to none / local-only', async () => {
    const c = await getCloudStorageConfig();
    expect(c.provider).toBe('none');
  });

  it('round-trips supabase config without enqueue side effects', async () => {
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: ' https://abc.supabase.co ',
      supabaseAnonKey: ' anon-key ',
    });
    const c = await getCloudStorageConfig();
    expect(c.provider).toBe('supabase');
    expect(c.supabaseUrl).toBe('https://abc.supabase.co');
    expect(c.supabaseAnonKey).toBe('anon-key');
    await clearCloudStorageConfig();
    expect((await getCloudStorageConfig()).provider).toBe('none');
  });
});

describe('NotionProvider stub', () => {
  it('verify returns not ok without network', async () => {
    const p = new NotionProvider();
    const r = await p.verify();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Notion/);
  });
});
