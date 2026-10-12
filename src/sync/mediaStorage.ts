/**
 * M3-A: private Storage helpers for media binaries.
 * DB rows keep refs + metadata only; IndexedDB / JSON backup stay local.
 */
import type { Media } from '../types';
import type { CloudMediaPayload } from './types';
import { MEDIA_SCHEMA_STORAGE, MEDIA_BUCKET } from './types';

export type MediaObjectBytes = Blob | ArrayBuffer | Uint8Array;

export interface MediaObjectStore {
  /** Upload (idempotent overwrite). Returns the storage key used. */
  uploadMediaObject(opts: {
    storageKey: string;
    body: MediaObjectBytes;
    contentType: string;
  }): Promise<void>;
  /** Download object body as Blob. Throws if missing. */
  downloadMediaObject(storageKey: string): Promise<Blob>;
  /** Best-effort delete; missing object is OK. */
  removeMediaObject(storageKey: string): Promise<void>;
  /** List object names under `{userId}/` (relative to bucket). */
  listMediaObjectKeys(userId: string): Promise<string[]>;
  /** Optional existence + size check without full download. */
  headMediaObject?(storageKey: string): Promise<{ exists: boolean; byteSize?: number }>;
}

export function mimeToExt(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  return 'bin';
}

/** Hex SHA-256 of blob bytes (Web Crypto). */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | Blob): Promise<string> {
  let buf: ArrayBuffer;
  if (data instanceof Blob) {
    buf = await data.arrayBuffer();
  } else if (data instanceof Uint8Array) {
    buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  } else {
    buf = data;
  }
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildStorageKey(userId: string, mediaId: string, contentSha256: string, mimeType: string): string {
  if (!userId || userId.includes('/') || userId.includes('..')) {
    throw new Error('invalid userId for storage path');
  }
  if (!mediaId || mediaId.includes('/') || mediaId.includes('..')) {
    throw new Error('invalid mediaId for storage path');
  }
  if (!/^[a-f0-9]{64}$/i.test(contentSha256)) {
    throw new Error('invalid contentSha256');
  }
  return `${userId}/${mediaId}/${contentSha256.toLowerCase()}.${mimeToExt(mimeType)}`;
}

export function isStorageMediaPayload(p: CloudMediaPayload): boolean {
  return typeof p.storageKey === 'string' && p.storageKey.length > 0;
}

export function isLegacyBase64MediaPayload(p: CloudMediaPayload): boolean {
  return typeof p.base64 === 'string' && p.base64.length >= 8;
}

export function needsStorageMigration(p: CloudMediaPayload): boolean {
  return isLegacyBase64MediaPayload(p) && !isStorageMediaPayload(p);
}

/**
 * Upload + verify, then return a v2 payload WITHOUT base64.
 * Does not touch DB. Caller upserts row only after this resolves.
 */
export async function uploadAndVerifyMedia(opts: {
  store: MediaObjectStore;
  userId: string;
  media: Media;
}): Promise<CloudMediaPayload> {
  const { store, userId, media } = opts;
  const contentSha256 = await sha256Hex(media.blob);
  const storageKey = buildStorageKey(userId, media.id, contentSha256, media.mimeType);

  // Dedupe: if already present with matching size, skip re-upload body
  let skipUpload = false;
  if (store.headMediaObject) {
    const head = await store.headMediaObject(storageKey);
    if (head.exists && (head.byteSize === undefined || head.byteSize === media.byteSize)) {
      skipUpload = true;
    }
  }

  if (!skipUpload) {
    await store.uploadMediaObject({
      storageKey,
      body: media.blob,
      contentType: media.mimeType,
    });
  }

  // Verify: download and check size (+ hash when affordable)
  const downloaded = await store.downloadMediaObject(storageKey);
  if (downloaded.size !== media.byteSize && media.byteSize > 0) {
    // Some stores report Blob size differently; fall back to hash
    const downHash = await sha256Hex(downloaded);
    if (downHash !== contentSha256) {
      throw new Error(`media verify failed: size/hash mismatch for ${storageKey}`);
    }
  } else {
    const downHash = await sha256Hex(downloaded);
    if (downHash !== contentSha256) {
      throw new Error(`media verify failed: hash mismatch for ${storageKey}`);
    }
  }

  return {
    id: media.id,
    mimeType: media.mimeType,
    byteSize: media.byteSize,
    width: media.width,
    height: media.height,
    createdAt: media.createdAt,
    schemaVersion: MEDIA_SCHEMA_STORAGE,
    storageKey,
    contentSha256,
  };
}

/**
 * Progressive migrate: if payload is legacy base64, upload then return v2.
 * If already v2, return as-is (no base64).
 * Never strips base64 from an input object in-place before verify succeeds.
 */
export async function migrateLegacyPayloadToStorage(opts: {
  store: MediaObjectStore;
  userId: string;
  payload: CloudMediaPayload;
  blobFromBase64: (base64: string, mimeType: string) => Blob;
}): Promise<CloudMediaPayload> {
  const { store, userId, payload, blobFromBase64 } = opts;
  if (isStorageMediaPayload(payload) && !payload.base64) {
    return {
      id: payload.id,
      mimeType: payload.mimeType,
      byteSize: payload.byteSize,
      width: payload.width,
      height: payload.height,
      createdAt: payload.createdAt,
      schemaVersion: MEDIA_SCHEMA_STORAGE,
      storageKey: payload.storageKey!,
      contentSha256: payload.contentSha256 ?? (await sha256Hex(await store.downloadMediaObject(payload.storageKey!))),
    };
  }
  if (!isLegacyBase64MediaPayload(payload)) {
    throw new Error(`media ${payload.id}: neither storageKey nor base64`);
  }
  const blob = blobFromBase64(payload.base64!, payload.mimeType);
  const media: Media = {
    id: payload.id,
    mimeType: payload.mimeType,
    byteSize: payload.byteSize || blob.size,
    width: payload.width,
    height: payload.height,
    createdAt: payload.createdAt,
    blob,
  };
  return uploadAndVerifyMedia({ store, userId, media });
}

/** Remove Storage objects for tombstoned / orphaned media keys. */
export async function cleanupOrphanMediaObjects(opts: {
  store: MediaObjectStore;
  userId: string;
  liveStorageKeys: Set<string>;
}): Promise<{ removed: string[]; errors: string[] }> {
  const { store, userId, liveStorageKeys } = opts;
  const listed = await store.listMediaObjectKeys(userId);
  const removed: string[] = [];
  const errors: string[] = [];
  for (const key of listed) {
    if (!key.startsWith(`${userId}/`)) continue; // belt-and-suspenders
    if (liveStorageKeys.has(key)) continue;
    try {
      await store.removeMediaObject(key);
      removed.push(key);
    } catch (e) {
      errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { removed, errors };
}

export { MEDIA_BUCKET };
