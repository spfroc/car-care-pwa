/**
 * PSEUDOCODE — PayloadJson fail-closed encoding (architecture §3.5 / O3).
 * NEVER silently truncate.
 */

const MAX_CHARS = 2000;

export type EncodeOk = { ok: true; text: string };
export type EncodeFail = { ok: false; code: 'payload_too_large'; length: number };

/** Strip redundant scalars + any binary/data-URL; keep mediaIds: string[] only. */
export function slimPayload(entity: 'vehicles' | 'records', payload: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...payload };
  delete (clone as { imageBase64?: unknown }).imageBase64;
  // real impl: also strip fields mirrored into Name/Plate/… columns
  void entity;
  return clone;
}

export function encodePayloadJson(slim: unknown): EncodeOk | EncodeFail {
  const text = JSON.stringify(slim);
  // Notion rich_text counted in UTF-16 code units ≈ JS string length
  if (text.length > MAX_CHARS) {
    return { ok: false, code: 'payload_too_large', length: text.length };
  }
  return { ok: true, text };
}
