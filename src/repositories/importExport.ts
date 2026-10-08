import { getDB } from '../db';
import type { CarCareExportV1, CareRecord, Media, SettingRow, Station, Vehicle } from '../types';
import { blobToBase64, base64ToBlob } from '../lib/image';
import { nowISO } from '../lib/constants';
import { ensureDefaultSettings } from '../db';

const WARN_BYTES = 8 * 1024 * 1024; // 8MB soft warn

export async function estimateExportSize(includeImages: boolean): Promise<number> {
  const db = await getDB();
  const vehicles = await db.getAll('vehicles');
  const records = await db.getAll('records');
  const stations = await db.getAll('stations');
  const settings = await db.getAll('settings');
  let size = JSON.stringify({ vehicles, records, stations, settings }).length;
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
  let mediaOut: CarCareExportV1['media'] = [];
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
    // strip mediaIds from records copy for consistency? keep ids but no blobs
    mediaOut = [];
  }
  const payload: CarCareExportV1 = {
    format: 'car-care-export-v1',
    exportedAt: nowISO(),
    appSchemaVersion: 1,
    vehicles,
    records: includeImages
      ? records
      : records.map((r) => ({ ...r, mediaIds: [] })),
    stations,
    settings,
    media: mediaOut,
    meta: meta.map((m) => ({ key: m.key, value: m.value, updatedAt: nowISO() })),
  };
  const json = JSON.stringify(payload, null, 2);
  await db.put('meta', { key: 'lastExportAt', value: payload.exportedAt });
  return { json, size: new Blob([json]).size };
}

export type ImportMode = 'merge' | 'replace';

export async function importData(jsonText: string, mode: ImportMode): Promise<{ ok: boolean; message: string }> {
  let data: CarCareExportV1;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { ok: false, message: 'JSON 解析失败' };
  }
  if (data.format !== 'car-care-export-v1') {
    return { ok: false, message: '格式不正确：需要 car-care-export-v1' };
  }
  const db = await getDB();
  if (mode === 'replace') {
    const stores = ['vehicles', 'records', 'stations', 'settings', 'media'] as const;
    const tx = db.transaction(stores, 'readwrite');
    for (const s of stores) await tx.objectStore(s).clear();
    await tx.done;
  }

  const putAll = async () => {
    for (const v of data.vehicles ?? []) await db.put('vehicles', v as Vehicle);
    for (const r of data.records ?? []) {
      if (mode === 'merge') {
        const exist = await db.get('records', r.id);
        if (exist) continue;
      }
      await db.put('records', r as CareRecord);
    }
    for (const s of data.stations ?? []) {
      if (mode === 'merge') {
        const exist = await db.get('stations', s.id);
        if (exist) continue;
      }
      await db.put('stations', s as Station);
    }
    for (const s of data.settings ?? []) {
      await db.put('settings', s as SettingRow);
    }
    for (const m of data.media ?? []) {
      if (mode === 'merge') {
        const exist = await db.get('media', m.id);
        if (exist) continue;
      }
      try {
        const media: Media = {
          id: m.id,
          mimeType: m.mimeType,
          byteSize: m.byteSize,
          width: m.width,
          height: m.height,
          blob: base64ToBlob(m.base64, m.mimeType),
          createdAt: m.createdAt,
        };
        await db.put('media', media);
      } catch {
        /* skip bad image */
      }
    }
  };
  await putAll();
  await ensureDefaultSettings();
  return { ok: true, message: mode === 'merge' ? '合并导入完成' : '覆盖导入完成' };
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const stores = ['vehicles', 'records', 'stations', 'media'] as const;
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) await tx.objectStore(s).clear();
  await tx.done;
}
