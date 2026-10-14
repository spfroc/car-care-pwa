import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests } from '../db';
import {
  clearCloudStorageConfig,
  getCloudStorageConfig,
  setCloudStorageConfig,
} from './config';
import { isCloudEnqueueEnabled, listOutbox } from './outbox';
import {
  hasValidNotionRuntimeSession,
  resetNotionRuntimeSessionForTests,
  setNotionRuntimeSession,
} from './notionSession';
import { NotionProvider } from './providers/notion';
import type { SyncOutboxItem } from './types';
import { putStation } from '../repositories/stations';
import { setSetting } from '../repositories/settings';
import { deleteVehicle, putVehicle } from '../repositories/vehicles';
import { putRecord } from '../repositories/records';
import { nowISO } from '../lib/constants';
import type { CareRecord, Media, Station, Vehicle } from '../types';
import { getDB } from '../db';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

async function resetDb() {
  await closeDBForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('car-care-db');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  resetNotionRuntimeSessionForTests();
}

describe('D2-P1 config whitelist (U3)', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  it('round-trips notionGatewayUrl + workspaceKey; no secret fields on type', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: ' https://gw.example.com/ ',
      notionWorkspaceHint: ' my-ws ',
      workspaceKey: ' wk-1 ',
    });
    const c = await getCloudStorageConfig();
    expect(c.provider).toBe('notion');
    expect(c.notionGatewayUrl).toBe('https://gw.example.com');
    expect(c.notionWorkspaceHint).toBe('my-ws');
    expect(c.workspaceKey).toBe('wk-1');
    // Compile-time + runtime: persisted object must not grow secret keys
    expect(c).not.toHaveProperty('gatewayApiKey');
    expect(c).not.toHaveProperty('notionToken');
    expect(c).not.toHaveProperty('bearer');
    expect(JSON.stringify(c)).not.toMatch(/ntn_|secret_/i);
    await clearCloudStorageConfig();
  });

  it('rejects non-https notionGatewayUrl', async () => {
    await expect(
      setCloudStorageConfig({
        provider: 'notion',
        notionGatewayUrl: 'http://insecure.example',
      }),
    ).rejects.toThrow(/https/i);
  });
});

describe('D2.1 enqueue gate (notion + session; media never)', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  it('notion + URL without session → false', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
    });
    expect(hasValidNotionRuntimeSession()).toBe(false);
    expect(await isCloudEnqueueEnabled()).toBe(false);
    expect(await isCloudEnqueueEnabled('vehicles')).toBe(false);
  });

  it('notion + URL + valid session → vehicles/records true; media false', async () => {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
    });
    setNotionRuntimeSession({ bearer: 'session-key', workspaceKey: 'ws' });
    expect(await isCloudEnqueueEnabled()).toBe(true);
    expect(await isCloudEnqueueEnabled('vehicles')).toBe(true);
    expect(await isCloudEnqueueEnabled('records')).toBe(true);
    expect(await isCloudEnqueueEnabled('media')).toBe(false);
    expect(await isCloudEnqueueEnabled('stations')).toBe(false);
    expect(await isCloudEnqueueEnabled('settings')).toBe(false);
  });

  it('supabase path unchanged', async () => {
    await setCloudStorageConfig({
      provider: 'supabase',
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: 'anon-key',
    });
    expect(await isCloudEnqueueEnabled()).toBe(true);
    expect(await isCloudEnqueueEnabled('media')).toBe(true);
  });
});

describe('NotionProvider skeleton', () => {
  afterEach(() => resetNotionRuntimeSessionForTests());

  it('verify without URL returns not ok (no network)', async () => {
    const p = new NotionProvider();
    const r = await p.verify();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Gateway URL|尚未配置/);
  });

  it('getMediaObjectStore → null', () => {
    const p = new NotionProvider({ gatewayUrl: 'https://gw.example.com', requireSession: false });
    expect(p.getMediaObjectStore()).toBeNull();
  });

  it('delegates pushOps to client and adapts id→opId', async () => {
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'ws' });
    const p = new NotionProvider({
      gatewayUrl: 'https://gw.example.com',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            applied: ['op-1'],
            conflicts: [
              {
                id: 'op-2',
                entity: 'vehicles',
                reason: 'cloud_newer',
                attemptedAt: 't',
              },
            ],
            errors: [
              {
                id: 'op-3',
                entity: 'records',
                code: 'payload_too_large',
                message: 'big',
                retryable: false,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    const ops: SyncOutboxItem[] = [
      {
        opId: 'op-1',
        entity: 'vehicles',
        entityId: 'v1',
        op: 'upsert',
        mutatedAt: 't',
        attempts: 0,
        nextRetryAt: 't',
      },
    ];
    const r = await p.pushOps(ops);
    expect(r.applied).toEqual(['op-1']);
    expect(r.conflicts[0]?.opId).toBe('op-2');
    expect(r.errors?.[0]?.opId).toBe('op-3');
  });
});

describe('D2.4a static scan (no Notion SDK / secret literals in src)', () => {
  it('src tree has no Notion SDK import and no ntn_/secret_ live values', () => {
    const root = join(process.cwd(), 'src');
    const hits: string[] = [];
    // Split so this test file does not self-match the forbidden package id.
    const notionSdk = '@' + 'notionhq/client';
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) continue;
        const text = readFileSync(p, 'utf8');
        if (text.includes(notionSdk)) hits.push(`${p}: ${notionSdk}`);
        // Live Notion tokens / secret_ API keys
        for (const m of text.matchAll(/\b(ntn_[A-Za-z0-9]+|secret_[A-Za-z0-9]+)\b/g)) {
          hits.push(`${p}: ${m[0]}`);
        }
      }
    };
    walk(root);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps[notionSdk]).toBeUndefined();
    expect(hits).toEqual([]);
  });
});

describe('D2.1 repository enqueue (Notion session: no stations/settings/media)', () => {
  beforeEach(resetDb);
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
  });

  async function enableNotionSession() {
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'ws',
    });
    setNotionRuntimeSession({ bearer: 'session-key', workspaceKey: 'ws' });
  }

  it('putStation does not enqueue stations', async () => {
    await enableNotionSession();
    const s: Station = {
      id: 'st1',
      stationType: 'gas',
      name: 'Shell',
      sortOrder: 0,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    await putStation(s);
    const box = await listOutbox();
    expect(box.filter((o) => o.entity === 'stations')).toEqual([]);
    expect(await (await getDB()).get('stations', 'st1')).toBeTruthy();
  });

  it('setSetting does not enqueue settings', async () => {
    await enableNotionSession();
    await setSetting('currency', { code: 'CNY', symbol: '¥' });
    const box = await listOutbox();
    expect(box.filter((o) => o.entity === 'settings')).toEqual([]);
    expect(await (await getDB()).get('settings', 'currency')).toBeTruthy();
  });

  it('deleteVehicle enqueues vehicles/records but not media', async () => {
    await enableNotionSession();
    const v: Vehicle = {
      id: 'v1',
      name: 'A',
      energyType: 'ICE',
      bodyType: 'SEDAN',
      coverMediaId: 'cover1',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const media: Media = {
      id: 'm1',
      mimeType: 'image/jpeg',
      byteSize: 4,
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
      createdAt: nowISO(),
    };
    const cover: Media = {
      id: 'cover1',
      mimeType: 'image/jpeg',
      byteSize: 2,
      blob: new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }),
      createdAt: nowISO(),
    };
    const rec: CareRecord = {
      id: 'r1',
      vehicleId: 'v1',
      type: 'fuel',
      date: '2026-01-01T00:00:00.000Z',
      amountPaid: 10,
      mediaIds: ['m1'],
      liters: 10,
      odometer: 100,
      fuelGrade: '95#',
      filledUp: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const db = await getDB();
    await putVehicle(v);
    await db.put('media', media);
    await db.put('media', cover);
    await putRecord(rec);

    const before = await listOutbox();
    expect(before.some((o) => o.entity === 'vehicles' && o.entityId === 'v1')).toBe(true);
    expect(before.some((o) => o.entity === 'records' && o.entityId === 'r1')).toBe(true);
    expect(before.filter((o) => o.entity === 'media')).toEqual([]);

    await deleteVehicle('v1');

    const box = await listOutbox();
    expect(box.some((o) => o.entity === 'vehicles' && o.op === 'delete' && o.entityId === 'v1')).toBe(
      true,
    );
    expect(box.some((o) => o.entity === 'records' && o.op === 'delete' && o.entityId === 'r1')).toBe(
      true,
    );
    expect(box.filter((o) => o.entity === 'media')).toEqual([]);
    expect(box.filter((o) => o.entity === 'stations' || o.entity === 'settings')).toEqual([]);

    const db2 = await getDB();
    expect(await db2.get('vehicles', 'v1')).toBeUndefined();
    expect(await db2.get('records', 'r1')).toBeUndefined();
    expect(await db2.get('media', 'm1')).toBeUndefined();
    expect(await db2.get('media', 'cover1')).toBeUndefined();
  });
});

