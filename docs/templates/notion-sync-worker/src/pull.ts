import { decodePayloadJson, hydrateCloudPayload } from './payload.ts';
import { listTombstones } from './tombstone-map.ts';
import { notionFetch, pageToLite } from './notion.ts';
import type { CloudRow, EntityKind, GatewayEnv } from './types.ts';

async function pullEntity(
  env: GatewayEnv,
  entity: EntityKind,
  dataSourceId: string,
  workspaceKey: string,
): Promise<CloudRow[]> {
  const rows: CloudRow[] = [];
  let cursor: string | undefined;
  do {
    const body = await notionFetch(env, `/v1/data_sources/${dataSourceId}/query`, {
      json: { start_cursor: cursor, page_size: 50 },
    });
    for (const page of body.results || []) {
      const lite = pageToLite(page);
      if (!lite.appEntityId) continue;
      const decoded = decodePayloadJson(lite.payloadJson);
      const payload =
        decoded === null
          ? { _decodeError: true }
          : hydrateCloudPayload(entity, decoded, {
              appEntityId: lite.appEntityId,
              name: lite.name,
              plate: lite.plate,
              energyType: lite.energyType,
              archived: lite.archived,
              vehicleId: lite.vehicleId,
              recordType: lite.recordType,
              recordDate: lite.recordDate,
              amountPaid: lite.amountPaid,
              appUpdatedAt: lite.appUpdatedAt,
              deviceId: lite.deviceId,
            });
      rows.push({
        entity,
        id: lite.appEntityId,
        payload,
        updatedAt: lite.appUpdatedAt || page.last_edited_time,
        deletedAt: lite.appDeletedAt || null,
        deviceId: lite.deviceId,
      });
    }
    cursor = body.has_more ? body.next_cursor : undefined;
  } while (cursor);

  // Merge KV tombstones that DS query may have dropped after trash.
  const tombs = await listTombstones(env, workspaceKey, entity);
  for (const t of tombs) {
    const existing = rows.find((r) => r.id === t.appEntityId);
    if (existing) {
      if (!existing.deletedAt) existing.deletedAt = t.deletedAt;
      continue;
    }
    rows.push({
      entity,
      id: t.appEntityId,
      payload: {},
      updatedAt: t.updatedAt,
      deletedAt: t.deletedAt,
      deviceId: null,
    });
  }
  return rows;
}

export async function pullAll(
  env: GatewayEnv,
  workspaceKey: string,
  entities: EntityKind[] = ['vehicles', 'records'],
): Promise<{ rows: CloudRow[] }> {
  const rows: CloudRow[] = [];
  for (const entity of entities) {
    const ds =
      entity === 'vehicles' ? env.VEHICLES_DATA_SOURCE_ID : env.RECORDS_DATA_SOURCE_ID;
    if (!ds) continue;
    rows.push(...(await pullEntity(env, entity, ds, workspaceKey)));
  }
  return { rows };
}
