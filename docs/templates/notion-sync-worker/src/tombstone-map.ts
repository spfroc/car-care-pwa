import type { EntityKind, GatewayEnv, TombstoneRecord } from './types.ts';

function key(entity: EntityKind, appEntityId: string, workspaceKey: string) {
  return `tomb:${workspaceKey}:${entity}:${appEntityId}`;
}

export async function getTombstone(
  env: GatewayEnv,
  workspaceKey: string,
  entity: EntityKind,
  appEntityId: string,
): Promise<TombstoneRecord | null> {
  if (!env.TOMBSTONE_KV) return null;
  const raw = await env.TOMBSTONE_KV.get(key(entity, appEntityId, workspaceKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TombstoneRecord;
  } catch {
    return null;
  }
}

export async function putTombstone(env: GatewayEnv, rec: TombstoneRecord): Promise<void> {
  if (!env.TOMBSTONE_KV) {
    // Fail closed for delete durability when KV missing: caller should treat as error.
    throw Object.assign(new Error('TOMBSTONE_KV binding required for delete durability'), {
      status: 503,
      code: 'notion_unavailable',
    });
  }
  await env.TOMBSTONE_KV.put(key(rec.entity, rec.appEntityId, rec.workspaceKey), JSON.stringify(rec));
}

export async function clearTombstone(
  env: GatewayEnv,
  workspaceKey: string,
  entity: EntityKind,
  appEntityId: string,
): Promise<void> {
  if (!env.TOMBSTONE_KV) return;
  await env.TOMBSTONE_KV.delete(key(entity, appEntityId, workspaceKey));
}

export async function listTombstones(
  env: GatewayEnv,
  workspaceKey: string,
  entity?: EntityKind,
): Promise<TombstoneRecord[]> {
  if (!env.TOMBSTONE_KV) return [];
  const prefix = entity ? `tomb:${workspaceKey}:${entity}:` : `tomb:${workspaceKey}:`;
  const out: TombstoneRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.TOMBSTONE_KV.list({ prefix, cursor });
    for (const k of page.keys) {
      const raw = await env.TOMBSTONE_KV.get(k.name);
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as TombstoneRecord);
      } catch {
        /* skip */
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
