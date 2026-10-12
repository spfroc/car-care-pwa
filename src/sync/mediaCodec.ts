import { base64ToBlob, blobToBase64 } from '../lib/image';
import type { Media } from '../types';
import type { CloudMediaPayload } from './types';
import { MEDIA_SCHEMA_BASE64, MEDIA_SCHEMA_STORAGE } from './types';
import {
  isLegacyBase64MediaPayload,
  isStorageMediaPayload,
  type MediaObjectStore,
} from './mediaStorage';

/** Encode local media for cloud — prefer Storage path when store+userId given. */
export async function mediaToCloudPayload(
  m: Media,
  opts?: { preferBase64?: boolean },
): Promise<CloudMediaPayload> {
  if (opts?.preferBase64) {
    return {
      id: m.id,
      mimeType: m.mimeType,
      byteSize: m.byteSize,
      width: m.width,
      height: m.height,
      createdAt: m.createdAt,
      schemaVersion: MEDIA_SCHEMA_BASE64,
      base64: await blobToBase64(m.blob),
    };
  }
  // Default for non-Storage callers: still produce base64 (tests / memory without store).
  // Engine with MediaObjectStore uses uploadAndVerifyMedia instead.
  return {
    id: m.id,
    mimeType: m.mimeType,
    byteSize: m.byteSize,
    width: m.width,
    height: m.height,
    createdAt: m.createdAt,
    schemaVersion: MEDIA_SCHEMA_BASE64,
    base64: await blobToBase64(m.blob),
  };
}

/** Decode cloud payload that already has base64 (no Storage round-trip). */
export function cloudPayloadToMedia(p: CloudMediaPayload): Media {
  if (!isLegacyBase64MediaPayload(p)) {
    throw new Error(`media ${p.id}: cloudPayloadToMedia requires base64; use cloudPayloadToMediaAsync`);
  }
  return {
    id: p.id,
    mimeType: p.mimeType,
    byteSize: p.byteSize,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt,
    blob: base64ToBlob(p.base64!, p.mimeType),
  };
}

/** Decode media from Storage and/or legacy base64. */
export async function cloudPayloadToMediaAsync(
  p: CloudMediaPayload,
  store?: MediaObjectStore | null,
): Promise<Media> {
  if (isStorageMediaPayload(p)) {
    if (!store) {
      // Fall back to embedded base64 if dual-written during migration
      if (isLegacyBase64MediaPayload(p)) return cloudPayloadToMedia(p);
      throw new Error(`media ${p.id}: storageKey present but no MediaObjectStore`);
    }
    const blob = await store.downloadMediaObject(p.storageKey!);
    return {
      id: p.id,
      mimeType: p.mimeType,
      byteSize: p.byteSize || blob.size,
      width: p.width,
      height: p.height,
      createdAt: p.createdAt,
      blob,
    };
  }
  if (isLegacyBase64MediaPayload(p)) return cloudPayloadToMedia(p);
  throw new Error(`media ${p.id}: neither storageKey nor base64`);
}

export function stripBase64(p: CloudMediaPayload): CloudMediaPayload {
  if (!p.base64) return p;
  const { base64: _drop, ...rest } = p;
  return {
    ...rest,
    schemaVersion: MEDIA_SCHEMA_STORAGE,
  };
}

export { base64ToBlob, blobToBase64 };
