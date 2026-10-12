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
}

export interface SyncConflict {
  id: UUID;
  entity: SyncEntity;
  entityId: string;
  localUpdatedAt?: ISODateTime;
  cloudUpdatedAt?: ISODateTime;
  resolution: 'kept_local' | 'kept_cloud' | 'kept_edit_over_delete';
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

export interface CloudMediaPayload {
  id: UUID;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  createdAt: ISODateTime;
  /** MVP: base64 body; Phase C → storage_key */
  base64: string;
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
  applied: string[];
  conflicts: Array<{ opId: string; reason: string }>;
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
