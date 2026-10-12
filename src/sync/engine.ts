import { getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { CareRecord, Media, SettingRow, Station, Vehicle } from '../types';
import { clearCloudStorageConfig, getCloudStorageConfig } from './config';
import { mediaToCloudPayload, cloudPayloadToMedia } from './mediaCodec';
import { mergeCloudIntoPlan } from './merge';
import {
  ackOutboxCoveredByUpload,
  appendConflicts,
  clearOutbox,
  ensureDeviceId,
  getSyncMeta,
  listOutbox,
  listReadyOutbox,
  markOutboxFailure,
  patchSyncMeta,
  removeOutboxItems,
} from './outbox';
import type { CloudProvider } from './providers/types';
import { NotionProvider } from './providers/notion';
import { SupabaseProvider } from './providers/supabase';
import { assertCloudRowsValid } from './validatePayload';
import { runSyncTxHook } from './txHooks';
import type {
  CloudMediaPayload,
  CloudRow,
  CloudStorageConfig,
  LocalSnapshot,
  MergeResult,
  VerifyResult,
} from './types';

export type SyncActionResult = {
  ok: boolean;
  message: string;
  verify?: VerifyResult;
  merge?: MergeResult;
  pushed?: number;
  pulled?: number;
};

let providerOverride: CloudProvider | null = null;

/** Test-only: inject memory provider. */
export function setCloudProviderForTests(p: CloudProvider | null): void {
  providerOverride = p;
}

export async function resolveProvider(): Promise<CloudProvider | null> {
  if (providerOverride) return providerOverride;
  const cfg = await getCloudStorageConfig();
  const deviceId = await ensureDeviceId();
  if (cfg.provider === 'supabase' && cfg.supabaseUrl && cfg.supabaseAnonKey) {
    return new SupabaseProvider({
      url: cfg.supabaseUrl,
      anonKey: cfg.supabaseAnonKey,
      deviceId,
    });
  }
  if (cfg.provider === 'notion') return new NotionProvider();
  return null;
}

export async function readLocalSnapshot(): Promise<LocalSnapshot> {
  const db = await getDB();
  return {
    vehicles: await db.getAll('vehicles'),
    records: await db.getAll('records'),
    stations: await db.getAll('stations'),
    settings: await db.getAll('settings'),
    media: await db.getAll('media'),
  };
}

export async function localSnapshotToCloudRows(snap: LocalSnapshot): Promise<CloudRow[]> {
  const deviceId = await ensureDeviceId();
  const rows: CloudRow[] = [];
  for (const v of snap.vehicles) {
    rows.push({
      entity: 'vehicles',
      id: v.id,
      payload: v,
      updatedAt: v.updatedAt,
      deletedAt: null,
      deviceId,
    });
  }
  for (const r of snap.records) {
    rows.push({
      entity: 'records',
      id: r.id,
      payload: r,
      updatedAt: r.updatedAt,
      deletedAt: null,
      deviceId,
    });
  }
  for (const s of snap.stations) {
    rows.push({
      entity: 'stations',
      id: s.id,
      payload: s,
      updatedAt: s.updatedAt,
      deletedAt: null,
      deviceId,
    });
  }
  for (const s of snap.settings) {
    if (s.key === 'cloudStorage') continue;
    rows.push({
      entity: 'settings',
      id: s.key,
      payload: s,
      updatedAt: s.updatedAt,
      deletedAt: null,
      deviceId,
    });
  }
  for (const m of snap.media) {
    const payload = await mediaToCloudPayload(m);
    rows.push({
      entity: 'media',
      id: m.id,
      payload,
      updatedAt: m.createdAt,
      deletedAt: null,
      deviceId,
    });
  }
  return rows;
}

/**
 * Apply cloud rows in ONE IndexedDB transaction.
 * When replaceLocal=true, clear + apply happen atomically (failure restores nothing / keeps prior).
 */
async function applyCloudRows(
  toUpsert: CloudRow[],
  toDelete: CloudRow[],
  opts?: { replaceLocal?: boolean },
): Promise<void> {
  assertCloudRowsValid(toUpsert);

  const db = await getDB();
  const stores = opts?.replaceLocal
    ? (['vehicles', 'records', 'stations', 'settings', 'media', 'sync_outbox'] as const)
    : (['vehicles', 'records', 'stations', 'settings', 'media'] as const);
  const tx = db.transaction(stores, 'readwrite');

  try {
    if (opts?.replaceLocal) {
      for (const store of ['vehicles', 'records', 'stations', 'media'] as const) {
        await tx.objectStore(store).clear();
      }
      const settings = await tx.objectStore('settings').getAll();
      for (const s of settings) {
        if (s.key !== 'cloudStorage') await tx.objectStore('settings').delete(s.key);
      }
      await tx.objectStore('sync_outbox').clear();
    }

    for (const row of toDelete) {
      if (row.entity === 'settings') await tx.objectStore('settings').delete(row.id);
      else if (row.entity === 'vehicles') await tx.objectStore('vehicles').delete(row.id);
      else if (row.entity === 'records') await tx.objectStore('records').delete(row.id);
      else if (row.entity === 'stations') await tx.objectStore('stations').delete(row.id);
      else if (row.entity === 'media') await tx.objectStore('media').delete(row.id);
    }

    for (const row of toUpsert) {
      runSyncTxHook('during_restore_apply', { store: row.entity });
      if (row.entity === 'vehicles') {
        await tx.objectStore('vehicles').put(row.payload as Vehicle);
      } else if (row.entity === 'records') {
        await tx.objectStore('records').put(row.payload as CareRecord);
      } else if (row.entity === 'stations') {
        await tx.objectStore('stations').put(row.payload as Station);
      } else if (row.entity === 'settings') {
        const s = row.payload as SettingRow;
        if (s?.key === 'cloudStorage') continue;
        await tx.objectStore('settings').put(s);
      } else if (row.entity === 'media') {
        const p = row.payload as CloudMediaPayload;
        const media = cloudPayloadToMedia(p);
        await tx.objectStore('media').put(media);
      }
    }
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* ignore */
    }
    try {
      await tx.done;
    } catch {
      /* expected after abort */
    }
    throw e;
  }
  await tx.done;
}

/** If cloud auth user changes, drop outbox/cursor so we never push another user's ops. */
async function guardUserSwitch(userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  const meta = await getSyncMeta();
  if (meta.cloudUserId && meta.cloudUserId !== userId) {
    await clearOutbox();
    await patchSyncMeta({
      cloudUserId: userId,
      serverCursor: undefined,
      lastError: `检测到云端账号切换（${meta.cloudUserId} → ${userId}），已清空同步队列。`,
    });
    return `云端账号已切换，队列已重置。`;
  }
  return undefined;
}

export async function verifyConnection(): Promise<SyncActionResult> {
  const provider = await resolveProvider();
  if (!provider) {
    return { ok: false, message: '未配置云存储（本地模式）' };
  }
  try {
    const verify = await provider.verify();
    if (verify.ok) {
      const switchNote = await guardUserSwitch(verify.userId);
      await patchSyncMeta({
        status: 'idle',
        cloudUserId: verify.userId,
        lastError: undefined,
        provider: provider.id === 'memory' ? 'supabase' : provider.id,
      });
      return {
        ok: true,
        message: `连接成功${verify.email ? `（${verify.email}）` : ''}；云端约 ${verify.cloudRowCount ?? 0} 行。不会自动改动本地数据。${switchNote ? ` ${switchNote}` : ''}`,
        verify,
      };
    }
    await patchSyncMeta({ status: 'error', lastError: verify.error });
    return { ok: false, message: verify.error ?? '校验失败', verify };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchSyncMeta({ status: 'error', lastError: msg });
    return { ok: false, message: msg };
  }
}

/** First upload: local → cloud. Does not pull/overwrite local. */
export async function firstUploadToCloud(): Promise<SyncActionResult> {
  const provider = await resolveProvider();
  if (!provider) return { ok: false, message: '未配置云存储' };
  await patchSyncMeta({ status: 'syncing', lastError: undefined });
  try {
    const snap = await readLocalSnapshot();
    const rows = await localSnapshotToCloudRows(snap);
    const result = await provider.pushSnapshot(rows);
    if (result.error) {
      await patchSyncMeta({ status: 'error', lastError: result.error });
      return { ok: false, message: `首次上传失败：${result.error}`, pushed: result.applied.length };
    }
    // Only ack ops covered by uploaded snapshot — keep ops enqueued during upload
    const acked = await ackOutboxCoveredByUpload(
      rows.map((r) => ({ entity: r.entity, id: r.id, updatedAt: r.updatedAt })),
    );
    const ts = nowISO();
    await patchSyncMeta({
      status: 'idle',
      lastPushAt: ts,
      lastSuccessAt: ts,
      lastError: undefined,
    });
    return {
      ok: true,
      message: `首次上传完成：${result.applied.length} 行（确认队列 ${acked} 条）。本地数据未改动。`,
      pushed: result.applied.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchSyncMeta({ status: 'error', lastError: msg });
    return { ok: false, message: msg };
  }
}

/**
 * Restore from cloud into local (merge LWW).
 * replaceLocal: clear+apply in ONE transaction; failure leaves prior local intact.
 */
export async function restoreFromCloud(opts?: {
  replaceLocal?: boolean;
}): Promise<SyncActionResult> {
  const provider = await resolveProvider();
  if (!provider) return { ok: false, message: '未配置云存储' };
  await patchSyncMeta({ status: 'syncing', lastError: undefined });
  try {
    const snapshot = await provider.pullAll();
    // Validate before any local mutation
    assertCloudRowsValid(snapshot.rows.filter((r) => !r.deletedAt));

    const pending = opts?.replaceLocal ? [] : await listOutbox();
    const localIndex = opts?.replaceLocal ? new Map() : await buildLocalIndex();
    const plan = mergeCloudIntoPlan(
      snapshot.rows,
      (entity, id) => localIndex.get(`${entity}:${id}`),
      pending,
      nowISO(),
    );

    try {
      await applyCloudRows(plan.toUpsert, plan.toDelete, {
        replaceLocal: opts?.replaceLocal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchSyncMeta({ status: 'error', lastError: `恢复写入失败（事务已中止）：${msg}` });
      return { ok: false, message: `恢复失败，本地保持原样：${msg}` };
    }

    await appendConflicts(plan.conflicts);
    const ts = nowISO();
    const maxUpdated = snapshot.rows.reduce(
      (acc, r) => (r.updatedAt > acc ? r.updatedAt : acc),
      ts,
    );
    await patchSyncMeta({
      status: 'idle',
      lastPullAt: ts,
      lastSuccessAt: ts,
      serverCursor: maxUpdated,
      lastError: undefined,
    });
    return {
      ok: true,
      message: `从云端恢复完成：应用 ${plan.appliedUpserts} 条更新、${plan.appliedDeletes} 条删除；跳过本地待推送 ${plan.skippedPendingLocal}。`,
      merge: plan,
      pulled: snapshot.rows.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchSyncMeta({ status: 'error', lastError: msg });
    return { ok: false, message: msg };
  }
}

async function buildLocalIndex(): Promise<Map<string, { updatedAt: string }>> {
  const snap = await readLocalSnapshot();
  const map = new Map<string, { updatedAt: string }>();
  for (const v of snap.vehicles) map.set(`vehicles:${v.id}`, { updatedAt: v.updatedAt });
  for (const r of snap.records) map.set(`records:${r.id}`, { updatedAt: r.updatedAt });
  for (const s of snap.stations) map.set(`stations:${s.id}`, { updatedAt: s.updatedAt });
  for (const s of snap.settings) map.set(`settings:${s.key}`, { updatedAt: s.updatedAt });
  for (const m of snap.media) map.set(`media:${m.id}`, { updatedAt: m.createdAt });
  return map;
}

/** Bidirectional: push ready outbox, then pull+merge. */
export async function bidirectionalSync(): Promise<SyncActionResult> {
  const provider = await resolveProvider();
  if (!provider) return { ok: false, message: '未配置云存储' };

  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    await patchSyncMeta({ status: 'offline', lastError: '浏览器离线' });
    return { ok: false, message: '当前离线，变更已留在队列，联网后重试' };
  }

  await patchSyncMeta({ status: 'syncing', lastError: undefined });
  try {
    const ready = await listReadyOutbox();
    const enriched = await enrichOutboxPayloads(ready);
    let pushed = 0;
    if (enriched.length) {
      const push = await provider.pushOps(enriched);
      if (push.error && !push.applied.length) {
        for (const op of enriched) await markOutboxFailure(op.opId, push.error);
        await patchSyncMeta({ status: 'error', lastError: push.error });
        return { ok: false, message: `推送失败：${push.error}` };
      }
      await removeOutboxItems(push.applied);
      pushed = push.applied.length;
      if (push.error) {
        const remaining = enriched.filter((o) => !push.applied.includes(o.opId));
        for (const op of remaining) await markOutboxFailure(op.opId, push.error);
      }
    }

    const snapshot = await provider.pullAll();
    assertCloudRowsValid(snapshot.rows.filter((r) => !r.deletedAt));
    const localIndex = await buildLocalIndex();
    const pending = await listOutbox();
    const plan = mergeCloudIntoPlan(
      snapshot.rows,
      (entity, id) => localIndex.get(`${entity}:${id}`),
      pending,
      nowISO(),
    );

    try {
      await applyCloudRows(plan.toUpsert, plan.toDelete);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchSyncMeta({ status: 'error', lastError: `拉取合并失败：${msg}` });
      return {
        ok: false,
        message: `推送 ${pushed} 条后拉取合并失败（本地合并已回滚）：${msg}`,
        pushed,
      };
    }

    await appendConflicts(plan.conflicts);
    const ts = nowISO();
    await patchSyncMeta({
      status: 'idle',
      lastPushAt: ts,
      lastPullAt: ts,
      lastSuccessAt: ts,
      lastError: undefined,
      serverCursor: snapshot.rows.reduce((a, r) => (r.updatedAt > a ? r.updatedAt : a), ts),
    });
    return {
      ok: true,
      message: `双向同步完成：推送 ${pushed}，拉取应用 ${plan.appliedUpserts} 更新 / ${plan.appliedDeletes} 删除。`,
      pushed,
      pulled: snapshot.rows.length,
      merge: plan,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchSyncMeta({ status: 'error', lastError: msg });
    return { ok: false, message: msg };
  }
}

async function enrichOutboxPayloads(
  ops: Awaited<ReturnType<typeof listReadyOutbox>>,
) {
  const db = await getDB();
  const out = [];
  for (const op of ops) {
    if (op.op === 'delete') {
      out.push(op);
      continue;
    }
    if (op.payload) {
      out.push(op);
      continue;
    }
    if (op.entity === 'media') {
      const m = await db.get('media', op.entityId);
      if (m) out.push({ ...op, payload: await mediaToCloudPayload(m as Media) });
      else out.push(op);
    } else if (op.entity === 'vehicles') {
      out.push({ ...op, payload: await db.get('vehicles', op.entityId) });
    } else if (op.entity === 'records') {
      out.push({ ...op, payload: await db.get('records', op.entityId) });
    } else if (op.entity === 'stations') {
      out.push({ ...op, payload: await db.get('stations', op.entityId) });
    } else if (op.entity === 'settings') {
      out.push({ ...op, payload: await db.get('settings', op.entityId) });
    } else {
      out.push(op);
    }
  }
  return out;
}

export async function disconnectCloud(): Promise<SyncActionResult> {
  const provider = await resolveProvider();
  try {
    await provider?.signOut?.();
  } catch {
    /* ignore */
  }
  await clearCloudStorageConfig();
  await clearOutbox();
  await patchSyncMeta({
    status: 'disconnected',
    provider: 'none',
    cloudUserId: undefined,
    serverCursor: undefined,
    lastError: undefined,
  });
  return { ok: true, message: '已断开云存储；本地数据保留。' };
}

export async function getSyncStatusSummary(): Promise<{
  meta: Awaited<ReturnType<typeof getSyncMeta>>;
  outboxCount: number;
  config: CloudStorageConfig;
}> {
  const [meta, outbox, config] = await Promise.all([
    getSyncMeta(),
    listOutbox(),
    getCloudStorageConfig(),
  ]);
  return { meta, outboxCount: outbox.length, config };
}
