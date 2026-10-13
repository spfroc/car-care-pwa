/** PayloadJson fail-closed encoding (architecture §3.5 / O3). NEVER silently truncate. */

export const MAX_PAYLOAD_CHARS = 2000;

export type EncodeOk = { ok: true; text: string };
export type EncodeFail = { ok: false; code: 'payload_too_large'; length: number };

const VEHICLE_STRIP = new Set([
  'id',
  'name',
  'plate',
  'energyType',
  'archived',
  'updatedAt',
  'deletedAt',
  'deviceId',
  'imageBase64',
  'photoBase64',
  'thumbnailBase64',
]);

const RECORD_STRIP = new Set([
  'id',
  'vehicleId',
  'type',
  'recordType',
  'date',
  'recordDate',
  'amountPaid',
  'updatedAt',
  'deletedAt',
  'deviceId',
  'imageBase64',
  'photoBase64',
  'thumbnailBase64',
  'mediaBase64',
]);

function stripBinaries(obj: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && (v.startsWith('data:') || v.length > 5000)) {
      delete obj[k];
      continue;
    }
    if (k.toLowerCase().includes('base64') || k.toLowerCase().includes('binary')) {
      delete obj[k];
    }
  }
  if (Array.isArray(obj.mediaIds)) {
    obj.mediaIds = obj.mediaIds.filter((x) => typeof x === 'string');
  }
}

export function slimPayload(
  entity: 'vehicles' | 'records',
  payload: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const src = payload && typeof payload === 'object' ? { ...payload } : {};
  const strip = entity === 'vehicles' ? VEHICLE_STRIP : RECORD_STRIP;
  for (const k of strip) delete src[k];
  stripBinaries(src);
  return src;
}

/** UTF-16 code units ≈ JS string length; Notion rich_text content max 2000. */
export function encodePayloadJson(slim: unknown): EncodeOk | EncodeFail {
  const text = JSON.stringify(slim ?? {});
  if (text.length > MAX_PAYLOAD_CHARS) {
    return { ok: false, code: 'payload_too_large', length: text.length };
  }
  return { ok: true, text };
}

export function decodePayloadJson(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return { value: v };
  } catch {
    return null;
  }
}
