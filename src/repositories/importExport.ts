import { getDB, ensureDefaultSettings } from '../db';
import type { CareRecord, LearningRow, Media, SettingRow, Station, Vehicle } from '../types';
import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { CarCareDB } from '../db';
import { blobToBase64, base64ToBlob } from '../lib/image';
import { APP_SCHEMA_VERSION, nowISO } from '../lib/constants';
import { validateImportJson } from '../lib/importValidate';

const WARN_BYTES = 8 * 1024 * 1024; // 8MB soft warn

const BUSINESS_STORES = ['vehicles', 'records', 'stations', 'settings', 'media', 'learning'] as const;
type BusinessStore = (typeof BUSINESS_STORES)[number];

export async function estimateExportSize(includeImages: boolean): Promise<number> {
  const db = await getDB();
  const vehicles = await db.getAll('vehicles');
  const records = await db.getAll('records');
  const stations = await db.getAll('stations');
  const settings = await db.getAll('settings');
  const learning = await db.getAll('learning');
  let size = JSON.stringify({ vehicles, records, stations, settings, learning }).length;
  if (includeImages) {
    const media = await db.getAll('media');
    for (const m of media) size += m.byteSize * 1.37; // base64 overhead
  }
  return size;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export { WARN_BYTES };

/** Keys that must never appear in car-care-export (C3 / H8). */
const EXPORT_SECRET_KEYS = new Set([
  'bearer',
  'apiKey',
  'gatewayApiKey',
  'gateway_api_key',
  'GATEWAY_API_KEY',
  'notionToken',
  'notion_token',
  'NOTION_TOKEN',
  'token',
  'accessToken',
  'refreshToken',
  'jwt',
  'password',
  'secret',
]);

/**
 * Strip session secrets from settings before JSON export.
 * Whitelists CloudStorageConfig fields; drops any accidental secret keys (C3 / §3.5.6).
 */
export function sanitizeSettingsForExport(
  settings: SettingRow[],
): SettingRow[] {
  return settings.map((row) => {
    if (row.key !== 'cloudStorage' || !row.value || typeof row.value !== 'object') {
      return row;
    }
    const v = row.value as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};
    if (typeof v.provider === 'string') cleaned.provider = v.provider;
    if (typeof v.supabaseUrl === 'string') cleaned.supabaseUrl = v.supabaseUrl;
    if (typeof v.supabaseAnonKey === 'string') cleaned.supabaseAnonKey = v.supabaseAnonKey;
    if (typeof v.notionGatewayUrl === 'string') cleaned.notionGatewayUrl = v.notionGatewayUrl;
    if (typeof v.notionWorkspaceHint === 'string') {
      cleaned.notionWorkspaceHint = v.notionWorkspaceHint;
    }
    if (typeof v.workspaceKey === 'string') cleaned.workspaceKey = v.workspaceKey;
    for (const k of Object.keys(v)) {
      if (EXPORT_SECRET_KEYS.has(k)) continue;
      // already whitelisted above; ignore unknown non-secret extras
    }
    return { ...row, value: cleaned };
  });
}


export async function exportData(includeImages: boolean): Promise<{ json: string; size: number }> {
  const db = await getDB();
  const vehicles = await db.getAll('vehicles');
  const records = await db.getAll('records');
  const stations = await db.getAll('stations');
  const settings = await db.getAll('settings');
  const meta = await db.getAll('meta');
  const learning = await db.getAll('learning');
  let mediaOut: Array<{
    id: string;
    mimeType: string;
    byteSize: number;
    width?: number;
    height?: number;
    base64: string;
    createdAt: string;
  }> = [];
  if (includeImages) {
    const media = await db.getAll('media');
    mediaOut = await Promise.all(
      media.map(async (m) => ({
        id: m.id,
        mimeType: m.mimeType,
        byteSize: m.byteSize,
        width: m.width,
        height: m.height,
        base64: await blobToBase64(m.blob),
        createdAt: m.createdAt,
      })),
    );
  } else {
    mediaOut = [];
  }
  const payload = {
    format: 'car-care-export-v1' as const,
    exportedAt: nowISO(),
    appSchemaVersion: APP_SCHEMA_VERSION,
    vehicles,
    records: includeImages
      ? records
      : records.map((r) => ({ ...r, mediaIds: [] })),
    stations,
    settings: sanitizeSettingsForExport(settings),
    media: mediaOut,
    meta: meta.map((m) => ({ key: m.key, value: m.value, updatedAt: nowISO() })),
    learning,
  };
  const json = JSON.stringify(payload, null, 2);
  await db.put('meta', { key: 'lastExportAt', value: payload.exportedAt });
  return { json, size: new Blob([json]).size };
}

export type ImportMode = 'merge' | 'replace';

/** Options for importData. Defaults prefer data integrity over partial success. */
export type ImportOptions = {
  /**
   * When true, skip undecodable media and continue.
   * Default **false**: any corrupt media rejects the entire import (no DB mutation).
   */
  skipCorruptMedia?: boolean;
};

export type ImportWriteHookInfo = {
  /** Monotonic count of clear/put ops inside the import transaction (1-based). */
  writeCount: number;
  op: 'clear' | 'put';
  store: BusinessStore;
};

/**
 * Test-only hook invoked before each clear/put inside the import transaction.
 * Throw to abort the IndexedDB transaction (verifies full rollback).
 * Always reset to null in afterEach.
 */
let importWriteHookForTests: ((info: ImportWriteHookInfo) => void) | null = null;

export function setImportWriteHookForTests(
  hook: ((info: ImportWriteHookInfo) => void) | null,
): void {
  importWriteHookForTests = hook;
}

type PreparedMedia = Media;

type PrepareMediaResult =
  | { ok: true; media: PreparedMedia[]; skipped: number }
  | { ok: false; corruptIds: string[] };

type BusinessSnapshot = {
  [K in BusinessStore]: unknown[];
};

async function snapshotBusiness(db: IDBPDatabase<CarCareDB>): Promise<BusinessSnapshot> {
  const snap = {} as BusinessSnapshot;
  for (const s of BUSINESS_STORES) {
    snap[s] = await db.getAll(s);
  }
  return snap;
}

async function restoreBusiness(
  db: IDBPDatabase<CarCareDB>,
  snap: BusinessSnapshot,
): Promise<void> {
  const tx = db.transaction(BUSINESS_STORES, 'readwrite');
  for (const s of BUSINESS_STORES) {
    await tx.objectStore(s).clear();
    for (const row of snap[s]) {
      await tx.objectStore(s).put(row as never);
    }
  }
  await tx.done;
}

function tryAbort(
  tx: IDBPTransaction<CarCareDB, typeof BUSINESS_STORES, 'readwrite'> | null,
): void {
  if (!tx) return;
  // Prevent unhandled rejection from tx.done when we intentionally abort.
  void tx.done.catch(() => {
    /* AbortError expected */
  });
  try {
    tx.abort();
  } catch {
    /* already complete / aborted */
  }
}

/**
 * Decode media base64 BEFORE any DB mutation.
 * On decode failure: either collect corrupt ids (reject path) or skip (opt-in).
 */
function prepareMedia(
  items: Array<{
    id: string;
    mimeType: string;
    byteSize: number;
    width?: number;
    height?: number;
    base64: string;
    createdAt: string;
  }>,
  skipCorrupt: boolean,
): PrepareMediaResult {
  const media: PreparedMedia[] = [];
  const corruptIds: string[] = [];
  for (const m of items) {
    try {
      media.push({
        id: m.id,
        mimeType: m.mimeType,
        byteSize: m.byteSize,
        width: m.width,
        height: m.height,
        blob: base64ToBlob(m.base64, m.mimeType),
        createdAt: m.createdAt,
      });
    } catch {
      corruptIds.push(m.id);
      if (!skipCorrupt) {
        return { ok: false, corruptIds };
      }
    }
  }
  if (!skipCorrupt && corruptIds.length > 0) {
    return { ok: false, corruptIds };
  }
  return { ok: true, media, skipped: corruptIds.length };
}

/**
 * Import with full structural validation first.
 * Cover (replace) and merge writes run in a single IndexedDB transaction.
 * Replace also snapshots business stores first and restores them if the tx fails
 * (IndexedDB may auto-commit completed clears when a JS throw happens between awaits).
 *
 * Merge strategy (unified): same id/key → **skip** (keep local) for vehicles,
 * records, stations, media, learning. Settings still overwrite (user import intent).
 */
export async function importData(
  jsonText: string,
  mode: ImportMode,
  options: ImportOptions = {},
): Promise<{ ok: boolean; message: string }> {
  const skipCorruptMedia = options.skipCorruptMedia === true;

  const validated = validateImportJson(jsonText);
  if (!validated.ok) {
    return { ok: false, message: validated.message };
  }

  const data = validated.data;
  const prepared = prepareMedia(data.media ?? [], skipCorruptMedia);
  if (!prepared.ok) {
    const ids = prepared.corruptIds.slice(0, 3).join(', ');
    const more = prepared.corruptIds.length > 3 ? ` 等 ${prepared.corruptIds.length} 张` : '';
    return {
      ok: false,
      message: `图片损坏，已拒绝导入以保护本地数据（${ids}${more}）。如需跳过坏图继续，请勾选「跳过损坏图片」。`,
    };
  }
  const { media: preparedMedia, skipped: skippedMedia } = prepared;

  const db = await getDB();
  // Snapshot before any replace mutation so we can restore if IDB auto-commits mid-failure.
  const snapshot = mode === 'replace' ? await snapshotBusiness(db) : null;

  let writeCount = 0;
  let tx: IDBPTransaction<CarCareDB, typeof BUSINESS_STORES, 'readwrite'> | null = null;

  const noteWrite = (op: ImportWriteHookInfo['op'], store: BusinessStore) => {
    writeCount += 1;
    try {
      importWriteHookForTests?.({ writeCount, op, store });
    } catch (hookErr) {
      // Abort synchronously before returning to the event loop (avoids auto-commit).
      tryAbort(tx);
      throw hookErr;
    }
  };

  try {
    tx = db.transaction(BUSINESS_STORES, 'readwrite');

    if (mode === 'replace') {
      for (const s of BUSINESS_STORES) {
        noteWrite('clear', s);
        await tx.objectStore(s).clear();
      }
    }

    for (const v of data.vehicles ?? []) {
      if (mode === 'merge') {
        const exist = await tx.objectStore('vehicles').get(v.id);
        if (exist) continue;
      }
      noteWrite('put', 'vehicles');
      await tx.objectStore('vehicles').put(v as Vehicle);
    }

    for (const r of data.records ?? []) {
      if (mode === 'merge') {
        const exist = await tx.objectStore('records').get(r.id);
        if (exist) continue;
      }
      noteWrite('put', 'records');
      await tx.objectStore('records').put(r as CareRecord);
    }

    for (const s of data.stations ?? []) {
      if (mode === 'merge') {
        const exist = await tx.objectStore('stations').get(s.id);
        if (exist) continue;
      }
      noteWrite('put', 'stations');
      await tx.objectStore('stations').put(s as Station);
    }

    for (const s of data.settings ?? []) {
      noteWrite('put', 'settings');
      await tx.objectStore('settings').put(s as SettingRow);
    }

    for (const m of preparedMedia) {
      if (mode === 'merge') {
        const exist = await tx.objectStore('media').get(m.id);
        if (exist) continue;
      }
      noteWrite('put', 'media');
      await tx.objectStore('media').put(m);
    }

    for (const row of data.learning ?? []) {
      if (mode === 'merge') {
        const exist = await tx.objectStore('learning').get(row.key);
        if (exist) continue;
      }
      noteWrite('put', 'learning');
      await tx.objectStore('learning').put(row as LearningRow);
    }

    await tx.done;
    tx = null;
  } catch (e) {
    tryAbort(tx);
    tx = null;
    // Insurance: if replace clears were auto-committed despite abort, restore snapshot.
    if (snapshot) {
      try {
        await restoreBusiness(db, snapshot);
      } catch (restoreErr) {
        const detail = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
        return {
          ok: false,
          message: `覆盖导入失败且自动恢复异常，请用备份 JSON 合并导入：${detail}`,
        };
      }
    }
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: mode === 'replace'
        ? `覆盖导入失败，已回滚，本地数据未损坏：${detail}`
        : `合并导入失败，已回滚：${detail}`,
    };
  }

  await ensureDefaultSettings();

  const warnBits = [
    ...validated.warnings,
    skippedMedia > 0 ? `跳过 ${skippedMedia} 张坏图` : '',
  ].filter(Boolean);
  const warnSuffix = warnBits.length ? `（${warnBits.join('；')}）` : '';
  return {
    ok: true,
    message: (mode === 'merge' ? '合并导入完成' : '覆盖导入完成') + warnSuffix,
  };
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const stores = ['vehicles', 'records', 'stations', 'media', 'learning'] as const;
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) await tx.objectStore(s).clear();
  await tx.done;
}
