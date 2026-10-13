import { decidePushOp, type CloudPresence } from './lww.ts';
import {
  buildProperties,
  NotionHttpError,
  queryByAppEntityId,
  retrievePage,
} from './notion.ts';
import { decodePayloadJson, encodePayloadJson, slimPayload } from './payload.ts';
import { clearTombstone, getTombstone, putTombstone } from './tombstone-map.ts';
import type {
  CloudRow,
  EntityKind,
  GatewayEnv,
  NotionPageLite,
  PushResult,
  SyncOutboxItem,
} from './types.ts';
import { notionFetch } from './notion.ts';

function dataSourceId(env: GatewayEnv, entity: EntityKind): string {
  const id =
    entity === 'vehicles' ? env.VEHICLES_DATA_SOURCE_ID : env.RECORDS_DATA_SOURCE_ID;
  if (!id) {
    throw Object.assign(new Error(`missing data source id for ${entity}`), {
      status: 400,
      code: 'bad_request',
    });
  }
  return id;
}

function liteToCloudRow(entity: EntityKind, lite: NotionPageLite): CloudRow {
  const decoded = decodePayloadJson(lite.payloadJson);
  const deletedAt =
    lite.appDeletedAt || (lite.inTrash ? lite.appUpdatedAt || new Date().toISOString() : null);
  return {
    entity,
    id: lite.appEntityId,
    payload: decoded ?? { _decodeError: true },
    updatedAt: lite.appUpdatedAt || new Date(0).toISOString(),
    deletedAt,
    deviceId: lite.deviceId,
  };
}

function presenceFrom(
  pages: NotionPageLite[],
  mapTomb: { pageId: string; deletedAt: string; updatedAt: string } | null,
): { presence: CloudPresence; pages: NotionPageLite[] } {
  if (pages.length === 0 && mapTomb) {
    return {
      presence: {
        kind: 'tombstone',
        pageId: mapTomb.pageId,
        deletedAt: mapTomb.deletedAt,
        updatedAt: mapTomb.updatedAt,
      },
      pages,
    };
  }
  if (pages.length === 0) return { presence: { kind: 'absent' }, pages };

  // Prefer non-trash alive; else tombstone
  const alive = pages.filter((p) => !p.inTrash && !p.appDeletedAt);
  if (alive.length) {
    const p = alive.sort((a, b) =>
      (b.appUpdatedAt || '').localeCompare(a.appUpdatedAt || ''),
    )[0];
    return {
      presence: { kind: 'alive', updatedAt: p.appUpdatedAt || new Date(0).toISOString() },
      pages,
    };
  }
  const t = pages.find((p) => p.inTrash || p.appDeletedAt) || pages[0];
  const deletedAt = t.appDeletedAt || t.appUpdatedAt || new Date().toISOString();
  return {
    presence: {
      kind: 'tombstone',
      pageId: t.pageId,
      deletedAt,
      updatedAt: t.appUpdatedAt || deletedAt,
    },
    pages,
  };
}

async function applyOne(
  env: GatewayEnv,
  workspaceKey: string,
  item: SyncOutboxItem,
  result: PushResult,
): Promise<void> {
  const outboxId = item.id;
  const entity = item.entity;
  const appEntityId = item.entityId;
  const ds = dataSourceId(env, entity);

  const slim = slimPayload(entity, item.payload);
  const encoded = encodePayloadJson(slim);
  if (item.op === 'upsert' && !encoded.ok) {
    result.errors = result.errors || [];
    result.errors.push({
      id: outboxId,
      entity,
      code: 'payload_too_large',
      message: `PayloadJson length ${encoded.length} exceeds 2000; refuse silent truncate`,
      retryable: false,
    });
    return;
  }

  let pages: NotionPageLite[];
  try {
    pages = await queryByAppEntityId(env, ds, appEntityId);
  } catch (e: any) {
    if (e instanceof NotionHttpError && (e.status === 429 || e.status >= 500)) {
      result.errors = result.errors || [];
      result.errors.push({
        id: outboxId,
        entity,
        code: e.code,
        message: e.message,
        retryable: true,
      });
      return;
    }
    throw e;
  }

  const mapTomb = await getTombstone(env, workspaceKey, entity, appEntityId);
  // If DS query missed trash but map has pageId, try retrieve
  if (!pages.length && mapTomb) {
    const retrieved = await retrievePage(env, mapTomb.pageId);
    if (retrieved) pages = [retrieved];
  }

  const { presence } = presenceFrom(
    pages,
    mapTomb
      ? { pageId: mapTomb.pageId, deletedAt: mapTomb.deletedAt, updatedAt: mapTomb.updatedAt }
      : null,
  );

  const decision = decidePushOp({
    op: item.op,
    mutatedAt: item.mutatedAt,
    presence,
    duplicateCount: pages.length || (presence.kind === 'absent' ? 0 : 1),
  });

  if (decision.action === 'conflict') {
    const cloud =
      pages[0] ? liteToCloudRow(entity, pages[0]) : mapTomb
        ? {
            entity,
            id: appEntityId,
            payload: {},
            updatedAt: mapTomb.updatedAt,
            deletedAt: mapTomb.deletedAt,
          }
        : undefined;
    result.conflicts.push({
      id: outboxId,
      entity,
      reason: decision.reason,
      attemptedAt: item.mutatedAt,
      cloudRow: cloud,
      message:
        decision.reason === 'ambiguous_race'
          ? 'Multiple Notion pages share AppEntityId; refuse silent create/overwrite'
          : undefined,
    });
    return;
  }

  if (decision.action === 'noop_deleted') {
    result.applied.push(outboxId);
    return;
  }

  const name =
    (typeof item.payload?.name === 'string' && item.payload.name) ||
    (typeof item.payload?.plate === 'string' && item.payload.plate) ||
    appEntityId;
  const payloadText = encoded.ok ? encoded.text : '{}';

  try {
    if (decision.action === 'create') {
      const created = await notionFetch(env, '/v1/pages', {
        json: {
          parent: { data_source_id: ds },
          properties: buildProperties(entity, {
            name,
            appEntityId,
            appUpdatedAt: item.mutatedAt,
            deviceId: item.deviceId,
            payloadJson: payloadText,
            payload: item.payload,
          }),
        },
      });
      // Re-read for uncertain success avoidance on later retries is handled by AppEntityId query.
      void created;
      result.applied.push(outboxId);
      return;
    }

    const targetPageId =
      pages.find((p) => !p.inTrash)?.pageId ||
      pages[0]?.pageId ||
      (presence.kind === 'tombstone' ? presence.pageId : null);
    if (!targetPageId) {
      result.errors = result.errors || [];
      result.errors.push({
        id: outboxId,
        entity,
        code: 'notion_unavailable',
        message: 'No page id for patch/trash; refuse ACK',
        retryable: true,
      });
      return;
    }

    if (decision.action === 'trash') {
      const deletedAt = item.mutatedAt;
      await notionFetch(env, `/v1/pages/${targetPageId}`, {
        method: 'PATCH',
        json: {
          in_trash: true,
          properties: {
            AppDeletedAt: { rich_text: [{ type: 'text', text: { content: deletedAt } }] },
            AppUpdatedAt: { rich_text: [{ type: 'text', text: { content: deletedAt } }] },
          },
        },
      });
      await putTombstone(env, {
        entity,
        appEntityId,
        pageId: targetPageId,
        deletedAt,
        updatedAt: deletedAt,
        workspaceKey,
      });
      result.applied.push(outboxId);
      return;
    }

    if (decision.action === 'restore_and_patch' || decision.action === 'patch') {
      const props = buildProperties(entity, {
        name,
        appEntityId,
        appUpdatedAt: item.mutatedAt,
        appDeletedAt: null,
        deviceId: item.deviceId,
        payloadJson: payloadText,
        payload: item.payload,
      });
      const body: Record<string, unknown> = { properties: props };
      if (decision.action === 'restore_and_patch') body.in_trash = false;
      await notionFetch(env, `/v1/pages/${targetPageId}`, {
        method: 'PATCH',
        json: body,
      });
      if (decision.action === 'restore_and_patch') {
        await clearTombstone(env, workspaceKey, entity, appEntityId);
      }
      result.applied.push(outboxId);
      return;
    }
  } catch (e: any) {
    if (e instanceof NotionHttpError) {
      // Uncertain write (5xx/429/timeout): do NOT ACK
      result.errors = result.errors || [];
      result.errors.push({
        id: outboxId,
        entity,
        code: e.code,
        message: e.message,
        retryable: e.status === 429 || e.status >= 500,
      });
      return;
    }
    throw e;
  }
}

/** Serialize same AppEntityId within a batch; never ACK uncertain successes. */
export async function pushOps(
  env: GatewayEnv,
  workspaceKey: string,
  ops: SyncOutboxItem[],
): Promise<PushResult> {
  const result: PushResult = { applied: [], conflicts: [], errors: [] };
  const byKey = new Map<string, SyncOutboxItem[]>();
  const order: string[] = [];
  for (const op of ops) {
    const k = `${op.entity}:${op.entityId}`;
    if (!byKey.has(k)) {
      byKey.set(k, []);
      order.push(k);
    }
    byKey.get(k)!.push(op);
  }
  for (const k of order) {
    const group = byKey.get(k)!;
    group.sort((a, b) => a.mutatedAt.localeCompare(b.mutatedAt));
    for (const item of group) {
      await applyOne(env, workspaceKey, item, result);
    }
  }
  if (!result.errors?.length) delete result.errors;
  return result;
}
