/**
 * sync_notion_map — local (entity, appEntityId) → { pageId, workspaceKey, tombstone? }
 * D2-P5 / architecture §4.7 / byo §3.2.
 * Prevents blind recreate after hard UI delete when Gateway pull no longer returns the row.
 */
import { getDB } from '../db';
import { nowISO } from '../lib/constants';
import { getCloudStorageConfig } from './config';
import type { CloudRow, SyncEntity } from './types';

export type NotionMapEntity = 'vehicles' | 'records';

export interface NotionMapEntry {
  mapKey: string;
  entity: NotionMapEntity;
  appEntityId: string;
  /** Notion page id when known; empty string if only tombstone hint is stored. */
  pageId: string;
  workspaceKey: string;
  tombstone?: boolean;
  deletedAt?: string | null;
  updatedAt: string;
}

export function notionMapKey(entity: string, appEntityId: string): string {
  return `${entity}:${appEntityId}`;
}

export function isNotionMapEntity(entity: string): entity is NotionMapEntity {
  return entity === 'vehicles' || entity === 'records';
}

export async function getNotionMapEntry(
  entity: string,
  appEntityId: string,
): Promise<NotionMapEntry | undefined> {
  const db = await getDB();
  const row = await db.get('sync_notion_map', notionMapKey(entity, appEntityId));
  return row as NotionMapEntry | undefined;
}

export async function putNotionMapEntry(
  entry: Omit<NotionMapEntry, 'mapKey' | 'updatedAt'> & { updatedAt?: string },
): Promise<NotionMapEntry> {
  if (!isNotionMapEntity(entry.entity)) {
    throw new Error(`sync_notion_map only supports vehicles|records, got ${entry.entity}`);
  }
  const full: NotionMapEntry = {
    mapKey: notionMapKey(entry.entity, entry.appEntityId),
    entity: entry.entity,
    appEntityId: entry.appEntityId,
    pageId: entry.pageId ?? '',
    workspaceKey: entry.workspaceKey,
    tombstone: entry.tombstone,
    deletedAt: entry.deletedAt ?? null,
    updatedAt: entry.updatedAt ?? nowISO(),
  };
  const db = await getDB();
  await db.put('sync_notion_map', full);
  return full;
}

/** Mark tombstone after UI hard-delete or cloud deletedAt / skipped_deleted. Keeps pageId if known. */
export async function markNotionMapTombstone(input: {
  entity: string;
  appEntityId: string;
  workspaceKey: string;
  pageId?: string;
  deletedAt?: string;
}): Promise<NotionMapEntry | null> {
  if (!isNotionMapEntity(input.entity)) return null;
  const prev = await getNotionMapEntry(input.entity, input.appEntityId);
  return putNotionMapEntry({
    entity: input.entity,
    appEntityId: input.appEntityId,
    workspaceKey: input.workspaceKey || prev?.workspaceKey || '',
    pageId: input.pageId ?? prev?.pageId ?? '',
    tombstone: true,
    deletedAt: input.deletedAt ?? prev?.deletedAt ?? nowISO(),
  });
}

/** Clear tombstone on restore / successful alive upsert mapping. */
export async function clearNotionMapTombstone(input: {
  entity: string;
  appEntityId: string;
  workspaceKey: string;
  pageId?: string;
}): Promise<NotionMapEntry | null> {
  if (!isNotionMapEntity(input.entity)) return null;
  const prev = await getNotionMapEntry(input.entity, input.appEntityId);
  return putNotionMapEntry({
    entity: input.entity,
    appEntityId: input.appEntityId,
    workspaceKey: input.workspaceKey || prev?.workspaceKey || '',
    pageId: input.pageId ?? prev?.pageId ?? '',
    tombstone: false,
    deletedAt: null,
  });
}

/**
 * True when map says this app entity was deleted — upsert must not blindly recreate
 * a Notion page (Gateway still authoritative; this is local Absent-guard).
 */
export async function shouldBlockBlindRecreate(
  entity: string,
  appEntityId: string,
  workspaceKey?: string,
): Promise<boolean> {
  const entry = await getNotionMapEntry(entity, appEntityId);
  if (!entry?.tombstone) return false;
  if (workspaceKey && entry.workspaceKey && entry.workspaceKey !== workspaceKey) {
    // Different workspace map entry does not block this workspace
    return false;
  }
  return true;
}

/** Apply pull / conflict cloud rows into the map (alive vs tombstone). */
export async function applyCloudRowsToNotionMap(
  rows: CloudRow[],
  workspaceKey: string,
): Promise<{ upserted: number; tombstoned: number }> {
  let upserted = 0;
  let tombstoned = 0;
  if (!workspaceKey) return { upserted, tombstoned };
  for (const row of rows) {
    if (!isNotionMapEntity(row.entity)) continue;
    const pageId =
      typeof (row as CloudRow & { pageId?: string }).pageId === 'string'
        ? (row as CloudRow & { pageId?: string }).pageId!
        : '';
    if (row.deletedAt) {
      await markNotionMapTombstone({
        entity: row.entity,
        appEntityId: row.id,
        workspaceKey,
        pageId: pageId || undefined,
        deletedAt: row.deletedAt,
      });
      tombstoned += 1;
    } else {
      await clearNotionMapTombstone({
        entity: row.entity,
        appEntityId: row.id,
        workspaceKey,
        pageId: pageId || undefined,
      });
      upserted += 1;
    }
  }
  return { upserted, tombstoned };
}

export async function listNotionMapForWorkspace(workspaceKey: string): Promise<NotionMapEntry[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex('sync_notion_map', 'byWorkspace', workspaceKey);
  return rows as NotionMapEntry[];
}

export async function listAllNotionMap(): Promise<NotionMapEntry[]> {
  const db = await getDB();
  return (await db.getAll('sync_notion_map')) as NotionMapEntry[];
}

/** Drop map rows for one workspace (explicit reset only — not on disconnect). */
export async function clearNotionMapForWorkspace(workspaceKey: string): Promise<number> {
  const rows = await listNotionMapForWorkspace(workspaceKey);
  if (!rows.length) return 0;
  const db = await getDB();
  const tx = db.transaction('sync_notion_map', 'readwrite');
  for (const r of rows) await tx.store.delete(r.mapKey);
  await tx.done;
  return rows.length;
}

export type { SyncEntity };

async function readBoundWorkspaceKey(): Promise<string | undefined> {
  const cfg = await getCloudStorageConfig();
  if (cfg.workspaceKey?.trim()) return cfg.workspaceKey.trim();
  // Avoid importing outbox (circular with shouldBlockBlindRecreate) — read sync_meta directly.
  const db = await getDB();
  const row = await db.get('sync_meta', 'syncMeta');
  const v = row?.value;
  if (v && typeof v === 'object' && typeof (v as { cloudUserId?: string }).cloudUserId === 'string') {
    return (v as { cloudUserId: string }).cloudUserId;
  }
  return undefined;
}

/** After UI hard-delete: persist tombstone so Absent pull cannot blind-recreate. */
export async function noteLocalHardDelete(
  entity: string,
  appEntityId: string,
): Promise<void> {
  if (!isNotionMapEntity(entity)) return;
  const cfg = await getCloudStorageConfig();
  if (cfg.provider !== 'notion') return;
  const wk = (await readBoundWorkspaceKey()) ?? '';
  if (!wk) return;
  await markNotionMapTombstone({ entity, appEntityId, workspaceKey: wk });
}
