/** Shared Gateway types aligned with docs/m3d-implementation-spec.md §3 */

export type EntityKind = 'vehicles' | 'records';

export type CloudRow = {
  entity: EntityKind;
  id: string;
  payload: Record<string, unknown>;
  updatedAt: string;
  deletedAt?: string | null;
  deviceId?: string | null;
};

export type SyncOutboxItem = {
  id: string; // outbox row id (client)
  entity: EntityKind;
  entityId: string; // AppEntityId
  op: 'upsert' | 'delete';
  mutatedAt: string;
  payload?: Record<string, unknown>;
  deviceId?: string;
};

export type PushConflict = {
  id: string;
  entity: EntityKind;
  reason: 'cloud_newer' | 'skipped_deleted' | 'ambiguous_race';
  attemptedAt: string;
  cloudRow?: CloudRow;
  message?: string;
};

export type PushError = {
  id: string;
  entity: EntityKind | string;
  code: string;
  message: string;
  retryable: boolean;
};

export type PushResult = {
  applied: string[];
  conflicts: PushConflict[];
  errors?: PushError[];
};

export type GatewayEnv = {
  NOTION_TOKEN: string;
  GATEWAY_API_KEY: string;
  ALLOWED_ORIGIN?: string;
  NOTION_VERSION?: string;
  GATEWAY_VERSION?: string;
  VEHICLES_DATA_SOURCE_ID?: string;
  RECORDS_DATA_SOURCE_ID?: string;
  /** Optional KV for durable tombstone map (user-owned). */
  TOMBSTONE_KV?: KVNamespace;
};

export type TombstoneRecord = {
  entity: EntityKind;
  appEntityId: string;
  pageId: string;
  deletedAt: string;
  updatedAt: string;
  workspaceKey: string;
};

export type NotionPageLite = {
  pageId: string;
  inTrash: boolean;
  appEntityId: string;
  appUpdatedAt: string | null;
  appDeletedAt: string | null;
  deviceId: string | null;
  payloadJson: string | null;
  name: string | null;
  /** vehicles */
  plate: string | null;
  energyType: string | null;
  archived: boolean | null;
  /** records */
  vehicleId: string | null;
  recordType: string | null;
  recordDate: string | null;
  amountPaid: number | null;
  rawProperties: Record<string, unknown>;
};
