/**
 * M3-A: private Storage helpers for media binaries.
 * DB rows keep refs + metadata only; IndexedDB / JSON backup stay local.
 */
import type { Media } from '../types';
import type { CloudMediaPayload } from './types';
import { MEDIA_SCHEMA_STORAGE, MEDIA_BUCKET } from './types';

export type MediaObjectBytes = Blob | ArrayBuffer | Uint8Array;

/** Result of listing Storage objects. Incomplete lists must abort GC. */
export type MediaObjectListResult = {
  keys: string[];
  /** false if truncated, errored mid-walk, or otherwise untrusted — NEVER delete from this. */
  complete: boolean;
  /** ISO created/updated times when known (grace-period checks). */
  createdAtByKey?: Record<string, string>;
  error?: string;
};

/** Default grace: protect upload→DB-ref race (device A upload, device B GC). */
export const ORPHAN_GC_DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

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
  /**
   * List objects under `{userId}/`.
   * On network/list failure set complete=false (or throw) — never return a partial list as complete.
   */
  listMediaObjectKeys(userId: string): Promise<MediaObjectListResult>;
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

export type OrphanCleanupResult = {
  removed: string[];
  errors: string[];
  skippedGrace: string[];
  skippedRecheck: string[];
  /** When set, no deletes were performed. */
  aborted?: string;
};

/**
 * Safe orphan GC: never delete from an incomplete list; respect grace period;
 * re-check live refs immediately before each delete (A upload / B GC race).
 * Sync must NOT call this automatically — explicit cleanup only.
 */
export async function cleanupOrphanMediaObjects(opts: {
  store: MediaObjectStore;
  userId: string;
  /** First-pass live keys from DB snapshot. */
  liveStorageKeys: Set<string>;
  /** Protect recently uploaded objects whose DB ref may not be committed yet. */
  gracePeriodMs?: number;
  nowMs?: number;
  /**
   * Re-fetch live storage keys immediately before deletes.
   * Required for race safety; if omitted, cleanup aborts.
   */
  recheckLiveKeys?: () => Promise<Set<string>>;
}): Promise<OrphanCleanupResult> {
  const {
    store,
    userId,
    liveStorageKeys,
    gracePeriodMs = ORPHAN_GC_DEFAULT_GRACE_MS,
    nowMs = Date.now(),
    recheckLiveKeys,
  } = opts;

  const empty = (): OrphanCleanupResult => ({
    removed: [],
    errors: [],
    skippedGrace: [],
    skippedRecheck: [],
  });

  if (!recheckLiveKeys) {
    return { ...empty(), aborted: 'recheckLiveKeys required — refusing unsafe orphan GC' };
  }

  let listed: MediaObjectListResult;
  try {
    listed = await store.listMediaObjectKeys(userId);
  } catch (e) {
    return {
      ...empty(),
      aborted: `list failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!listed.complete) {
    return {
      ...empty(),
      aborted: listed.error
        ? `incomplete list: ${listed.error}`
        : 'incomplete list — refusing to treat partial listing as full',
    };
  }

  const candidates: string[] = [];
  const skippedGrace: string[] = [];
  for (const key of listed.keys) {
    if (!key.startsWith(`${userId}/`)) continue;
    if (liveStorageKeys.has(key)) continue;
    const createdIso = listed.createdAtByKey?.[key];
    if (createdIso) {
      const createdMs = Date.parse(createdIso);
      if (!Number.isNaN(createdMs) && nowMs - createdMs < gracePeriodMs) {
        skippedGrace.push(key);
        continue;
      }
    } else if (gracePeriodMs > 0) {
      // Unknown age + nonzero grace → treat as young (safe default for upload race)
      skippedGrace.push(key);
      continue;
    }
    candidates.push(key);
  }

  if (!candidates.length) {
    return { removed: [], errors: [], skippedGrace, skippedRecheck: [] };
  }

  let liveNow: Set<string>;
  try {
    liveNow = await recheckLiveKeys();
  } catch (e) {
    return {
      removed: [],
      errors: [],
      skippedGrace,
      skippedRecheck: [],
      aborted: `recheck refs failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const removed: string[] = [];
  const errors: string[] = [];
  const skippedRecheck: string[] = [];
  for (const key of candidates) {
    if (liveNow.has(key)) {
      skippedRecheck.push(key);
      continue;
    }
    try {
      await store.removeMediaObject(key);
      removed.push(key);
    } catch (e) {
      errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { removed, errors, skippedGrace, skippedRecheck };
}

export { MEDIA_BUCKET };
