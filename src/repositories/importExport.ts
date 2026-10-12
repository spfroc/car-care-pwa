import { getDB, ensureDefaultSettings } from '../db';
import type { CareRecord, LearningRow, Media, SettingRow, Station, Vehicle } from '../types';
import { blobToBase64, base64ToBlob } from '../lib/image';
import { APP_SCHEMA_VERSION, nowISO } from '../lib/constants';
import { validateImportJson } from '../lib/importValidate';

const WARN_BYTES = 8 * 1024 * 1024; // 8MB soft warn

const BUSINESS_STORES = ['vehicles', 'records', 'stations', 'settings', 'media', 'learning'] as const;

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
    settings,
    media: mediaOut,
    meta: meta.map((m) => ({ key: m.key, value: m.value, updatedAt: nowISO() })),
    learning,
  };
  const json = JSON.stringify(payload, null, 2);
  await db.put('meta', { key: 'lastExportAt', value: payload.exportedAt });
  return { json, size: new Blob([json]).size };
}

export type ImportMode = 'merge' | 'replace';

type PreparedMedia = Media & { _skip?: boolean };

/**
 * Decode media base64 BEFORE any DB mutation so replace cannot leave a cleared DB
 * if decoding fails mid-way.
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
): { media: PreparedMedia[]; skipped: number } {
  const media: PreparedMedia[] = [];
  let skipped = 0;
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
      skipped += 1;
    }
  }
  return { media, skipped };
}

/**
 * Import with full structural validation first.
 * Cover (replace) and merge writes run in a single IndexedDB transaction so a
 * failure aborts the whole unit — existing data is never left half-cleared.
 */
export async function importData(
  jsonText: string,
  mode: ImportMode,
): Promise<{ ok: boolean; message: string }> {
  const validated = validateImportJson(jsonText);
  if (!validated.ok) {
    return { ok: false, message: validated.message };
  }

  const data = validated.data;
  const { media: preparedMedia, skipped: skippedMedia } = prepareMedia(data.media ?? []);

  const db = await getDB();

  try {
    const tx = db.transaction(BUSINESS_STORES, 'readwrite');

    if (mode === 'replace') {
      for (const s of BUSINESS_STORES) {
        await tx.objectStore(s).clear();
      }
    }

    for (const v of data.vehicles ?? []) {
      await tx.objectStore('vehicles').put(v as Vehicle);
    }

    for (const r of data.records ?? []) {
      if (mode === 'merge') {
        const exist = await tx.objectStore('records').get(r.id);
        if (exist) continue;
      }
      await tx.objectStore('records').put(r as CareRecord);
    }

    for (const s of data.stations ?? []) {
      if (mode === 'merge') {
        const exist = await tx.objectStore('stations').get(s.id);
        if (exist) continue;
      }
      await tx.objectStore('stations').put(s as Station);
    }

    for (const s of data.settings ?? []) {
      await tx.objectStore('settings').put(s as SettingRow);
    }

    for (const m of preparedMedia) {
      if (mode === 'merge') {
        const exist = await tx.objectStore('media').get(m.id);
        if (exist) continue;
      }
      await tx.objectStore('media').put(m);
    }

    for (const row of data.learning ?? []) {
      if (mode === 'merge') {
        const exist = await tx.objectStore('learning').get(row.key);
        if (exist) continue;
      }
      await tx.objectStore('learning').put(row as LearningRow);
    }

    await tx.done;
  } catch (e) {
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
