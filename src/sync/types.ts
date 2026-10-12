import type { CareRecord, ISODateTime, Media, SettingRow, Station, UUID, Vehicle } from '../types';

export type CloudProviderId = 'none' | 'supabase' | 'notion';

export type SyncEntity = 'vehicles' | 'records' | 'stations' | 'settings' | 'media';

export type SyncOpKind = 'upsert' | 'delete';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'disconnected';

export interface SyncOutboxItem {
  opId: UUID;
  entity: SyncEntity;
  entityId: string;
  op: SyncOpKind;
  /** Full entity for upsert; omitted/ partial for delete */
  payload?: unknown;
  mutatedAt: ISODateTime;
  attempts: number;
  nextRetryAt: ISODateTime;
  lastError?: string;
  /**
   * Cloud auth user that owns this pending op.
   * Isolates queues across account switches; never push another user's ops.
   * 'unbound' = enqueued before first successful verify.
   */
  ownerUserId?: string;
}

export interface SyncConflict {
  id: UUID;
  entity: SyncEntity;
  entityId: string;
  localUpdatedAt?: ISODateTime;
  cloudUpdatedAt?: ISODateTime;
  resolution: 'kept_local' | 'kept_cloud' | 'kept_edit_over_delete' | 'push_skipped_cloud_newer';
  notedAt: ISODateTime;
}

export interface SyncMetaState {
  deviceId: string;
  status: SyncStatus;
  lastPullAt?: ISODateTime;
  lastPushAt?: ISODateTime;
  lastSuccessAt?: ISODateTime;
  lastError?: string;
  cloudUserId?: string;
  /** ISO watermark of max cloud updated_at seen */
  serverCursor?: ISODateTime;
  provider: CloudProviderId;
}

export interface CloudStorageConfig {
  provider: CloudProviderId;
  supabaseUrl?: string;
  /** anon / publishable only — never service_role */
  supabaseAnonKey?: string;
  /** Notion stub fields (unused until Phase D) */
  notionWorkspaceHint?: string;
}

/** M2 JSONB/base64 body. */
export const MEDIA_SCHEMA_BASE64 = 1;
/** M3-A private Storage object ref. */
export const MEDIA_SCHEMA_STORAGE = 2;
export const MEDIA_BUCKET = 'car-care-media';

export interface CloudMediaPayload {
  id: UUID;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  createdAt: ISODateTime;
  /** 1 = base64 in jsonb (M2); 2 = Storage object (M3-A). */
  schemaVersion?: number;
  /**
   * M2 / migration: base64 body.
   * M3-A live rows omit this after upload+verify+ref switch.
   */
  base64?: string;
  /** Relative path inside private bucket `car-care-media`. */
  storageKey?: string;
  /** Hex SHA-256 of binary bytes (dedupe + verify). */
  contentSha256?: string;
}

export interface CloudRow {
  entity: SyncEntity;
  id: string;
  payload: unknown;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime | null;
  deviceId?: string | null;
}

export interface CloudSnapshot {
  rows: CloudRow[];
  pulledAt: ISODateTime;
}

export interface LocalSnapshot {
  vehicles: Vehicle[];
  records: CareRecord[];
  stations: Station[];
  settings: SettingRow[];
  media: Media[];
}

export interface VerifyResult {
  ok: boolean;
  userId?: string;
  email?: string;
  error?: string;
  cloudRowCount?: number;
}

export interface PushResult {
  /** Successfully written to cloud (opIds). */
  applied: string[];
  /** Skipped due to LWW / errors that are not hard failures. Not included in applied. */
  conflicts: Array<{
    opId: string;
    reason: string;
    entity?: SyncEntity | string;
    entityId?: string;
    cloudUpdatedAt?: string;
    /** Local mutatedAt that was skipped — used to drop matching outbox without touching newer mid-sync ops */
    attemptedAt?: string;
  }>;
  error?: string;
}

export interface MergeResult {
  appliedUpserts: number;
  appliedDeletes: number;
  skippedPendingLocal: number;
  conflicts: SyncConflict[];
}

export const SYNC_ENTITIES: SyncEntity[] = [
  'vehicles',
  'records',
  'stations',
  'settings',
  'media',
];

export const MAX_OUTBOX_ATTEMPTS = 8;

/** Soft cap for media base64 in JSONB payloads (~1.5 MiB binary ≈ 2e6 chars). */
export const MAX_MEDIA_BASE64_CHARS = 2_000_000;
export const MAX_MEDIA_BYTE_SIZE = 1_500_000;
