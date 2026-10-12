import type { CloudMediaPayload, CloudRow, SyncEntity } from './types';

const ENTITIES: SyncEntity[] = ['vehicles', 'records', 'stations', 'settings', 'media'];

function isISO(s: unknown): s is string {
  return typeof s === 'string' && s.length >= 10 && !Number.isNaN(Date.parse(s));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Return error message or null if ok. */
export function validateCloudRow(row: CloudRow): string | null {
  if (!ENTITIES.includes(row.entity)) return `unknown entity ${row.entity}`;
  if (typeof row.id !== 'string' || !row.id.trim()) return 'missing id';
  if (!isISO(row.updatedAt)) return 'invalid updatedAt';
  if (row.deletedAt != null && row.deletedAt !== undefined && !isISO(row.deletedAt)) {
    return 'invalid deletedAt';
  }
  // Tombstones may carry empty payload
  if (row.deletedAt) return null;
  return validateEntityPayload(row.entity, row.payload, row.id);
}

export function validateEntityPayload(
  entity: SyncEntity,
  payload: unknown,
  expectedId: string,
): string | null {
  if (!isObj(payload)) return 'payload must be object';
  switch (entity) {
    case 'vehicles': {
      if (payload.id !== expectedId) return 'vehicle id mismatch';
      if (typeof payload.name !== 'string') return 'vehicle.name';
      if (typeof payload.energyType !== 'string') return 'vehicle.energyType';
      if (typeof payload.bodyType !== 'string') return 'vehicle.bodyType';
      if (!isISO(payload.createdAt) || !isISO(payload.updatedAt)) return 'vehicle timestamps';
      return null;
    }
    case 'records': {
      if (payload.id !== expectedId) return 'record id mismatch';
      if (typeof payload.vehicleId !== 'string') return 'record.vehicleId';
      if (typeof payload.type !== 'string') return 'record.type';
      if (!isISO(payload.date)) return 'record.date';
      if (typeof payload.amountPaid !== 'number' || !Number.isFinite(payload.amountPaid)) {
        return 'record.amountPaid';
      }
      if (!Array.isArray(payload.mediaIds)) return 'record.mediaIds';
      if (!isISO(payload.createdAt) || !isISO(payload.updatedAt)) return 'record timestamps';
      return null;
    }
    case 'stations': {
      if (payload.id !== expectedId) return 'station id mismatch';
      if (typeof payload.stationType !== 'string') return 'station.stationType';
      if (typeof payload.name !== 'string') return 'station.name';
      if (typeof payload.sortOrder !== 'number') return 'station.sortOrder';
      if (!isISO(payload.createdAt) || !isISO(payload.updatedAt)) return 'station timestamps';
      return null;
    }
    case 'settings': {
      if (typeof payload.key !== 'string') return 'settings.key';
      if (payload.key === 'cloudStorage') return 'cloudStorage must not sync';
      if (payload.key !== expectedId) return 'settings key mismatch';
      if (!isISO(payload.updatedAt)) return 'settings.updatedAt';
      return null;
    }
    case 'media': {
      const p = payload as Partial<CloudMediaPayload>;
      if (p.id !== expectedId) return 'media id mismatch';
      if (typeof p.mimeType !== 'string' || !p.mimeType.startsWith('image/')) {
        return 'media.mimeType';
      }
      if (typeof p.byteSize !== 'number' || p.byteSize < 0) return 'media.byteSize';
      if (typeof p.base64 !== 'string' || p.base64.length < 8) return 'media.base64';
      if (!isISO(p.createdAt)) return 'media.createdAt';
      return null;
    }
    default:
      return 'unknown entity';
  }
}

export function assertCloudRowsValid(rows: CloudRow[]): void {
  for (const row of rows) {
    const err = validateCloudRow(row);
    if (err) throw new Error(`云端载荷校验失败 ${row.entity}/${row.id}: ${err}`);
  }
}
