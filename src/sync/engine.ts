import { getDB } from '../db';
import { nowISO, uid } from '../lib/constants';
import type { CareRecord, Media, SettingRow, Station, Vehicle } from '../types';
import { clearCloudStorageConfig, getCloudStorageConfig } from './config';
import { mediaToCloudPayload, cloudPayloadToMediaAsync } from './mediaCodec';
import {
  cleanupOrphanMediaObjects,
  isLegacyBase64MediaPayload,
  isStorageMediaPayload,
  migrateLegacyPayloadToStorage,
  uploadAndVerifyMedia,
  type MediaObjectStore,
} from './mediaStorage';
import { base64ToBlob } from '../lib/image';
import { mergeCloudIntoPlan } from './merge';
import {
  ackOutboxCoveredByUpload,
  appendConflicts,
  countOutboxForOwner,
  ensureDeviceId,
  getSyncMeta,
  listOutbox,
  listOutboxForUser,
  listReadyOutbox,
  markOutboxFailure,
  patchSyncMeta,
  rebindUnboundOutbox,
  removeOutboxItems,
  removeStaleConflictOps,
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
  SyncEntity,
  VerifyResult,
} from './types';

export type MediaMigrateSummary = {
  migrated: number;
  skipped: number;
  /** Legacy base64 rows that still need migration after this pass. */
  unmigrated: number;
  failed: number;
  errors: string[];
  ok: boolean;
};

export type SyncActionResult = {
  ok: boolean;
  message: string;
  verify?: VerifyResult;
  merge?: MergeResult;
  pushed?: number;
  pulled?: number;
  /** Progressive M2→Storage migration outcome (when Storage available). */
  mediaMigrate?: MediaMigrateSummary;
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

export async function localSnapshotToCloudRows(
  snap: LocalSnapshot,
  opts?: { mediaStore?: MediaObjectStore | null; userId?: string | null },
): Promise<CloudRow[]> {
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
  const store = opts?.mediaStore;
  const userId = opts?.userId;
  for (const m of snap.media) {
    let payload: CloudMediaPayload;
    if (store && userId) {
      // M3-A: binary → Storage; DB only refs. Upload+verify before row payload.
      payload = await uploadAndVerifyMedia({ store, userId, media: m });
    } else {
      // Legacy / no Storage: base64 in jsonb (M2 compat)
      payload = await mediaToCloudPayload(m, { preferBase64: true });
    }
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
 * Resolve media blobs from Storage / base64 BEFORE opening the IDB transaction.
 */
async function materializeMediaUpserts(
  toUpsert: CloudRow[],
  mediaStore?: MediaObjectStore | null,
): Promise<Map<string, Media>> {
  const out = new Map<string, Media>();
  for (const row of toUpsert) {
    if (row.entity !== 'media' || row.deletedAt) continue;
    const p = row.payload as CloudMediaPayload;
    const media = await cloudPayloadToMediaAsync(p, mediaStore);
    out.set(row.id, media);
  }
  return out;
}

/**
 * Apply cloud rows in ONE IndexedDB transaction.
 * When replaceLocal=true, clear + apply happen atomically (failure restores nothing / keeps prior).
 */
async function applyCloudRows(
  toUpsert: CloudRow[],
  toDelete: CloudRow[],
  opts?: {
    replaceLocal?: boolean;
    clearOutboxOpIds?: string[];
    mediaStore?: MediaObjectStore | null;
  },
): Promise<void> {
  assertCloudRowsValid(toUpsert);

  // Download / decode media outside the IDB txn (network + crypto)
  const mediaMap = await materializeMediaUpserts(toUpsert, opts?.mediaStore);

  const db = await getDB();
  const stores =
    opts?.replaceLocal
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
      // Only drop CURRENT account pending ops — never wipe other accounts' queues
      for (const opId of opts.clearOutboxOpIds ?? []) {
        await tx.objectStore('sync_outbox').delete(opId);
      }
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
        const media = mediaMap.get(row.id);
        if (!media) throw new Error(`media ${row.id}: materialize failed`);
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

/**
 * Account switch safety: IndexedDB is a SINGLE shared DB (`car-care-db`).
 * Outbox is owner-scoped, but vehicles/records/media are NOT.
 * Switching cloud accounts while local business data (or parked outbox) exists
 * can leak/mix data across users — block with clear UX instead of silent switch.
 */
export type AccountSwitchGuard =
  | { ok: true; note?: string }
  | { ok: false; message: string };

async function countLocalBusinessRows(): Promise<number> {
  const db = await getDB();
  const [v, r, s, m] = await Promise.all([
    db.count('vehicles'),
    db.count('records'),
    db.count('stations'),
    db.count('media'),
  ]);
  return v + r + s + m;
}

export async function guardUserSwitch(userId: string | undefined): Promise<AccountSwitchGuard> {
  if (!userId) return { ok: true };
  const meta = await getSyncMeta();
  if (!meta.cloudUserId || meta.cloudUserId === userId) return { ok: true };

  const parked = await countOutboxForOwner(meta.cloudUserId);
  const localRows = await countLocalBusinessRows();
  if (parked > 0 || localRows > 0) {
    return {
      ok: false,
      message:
        `已阻止账号切换：本机 IndexedDB 跨云端账号共享，当前绑定 ${meta.cloudUserId.slice(0, 8)}…，` +
        `本地业务数据 ${localRows} 条、原账号待同步 ${parked} 条。` +
        `请先导出 JSON 备份 → 断开云连接 →（如需换号）清空本地业务数据或用「从云端完全替换本地」恢复新账号数据，再连接新账号。` +
        `切勿在未清空时把本地数据首次上传到另一账号。`,
    };
  }

  // Empty local + no parked outbox: safe to rebind cursor only
  await patchSyncMeta({
    cloudUserId: userId,
    serverCursor: undefined,
  });
  return {
    ok: true,
    note: `云端账号已切换（${meta.cloudUserId.slice(0, 8)}… → ${userId.slice(0, 8)}…）；本地无业务数据，已重置同步游标。`,
  };
}

/**
 * Enforce Auth session user === locally bound account before upload / restore / sync.
 * Does NOT rely on the user having clicked「校验连接」first.
 * On mismatch with local business data or parked outbox → reject (no cloud/local mutation).
 * Returns a failure result to short-circuit, or null to proceed.
 */
async function ensureAuthMatchesBoundAccount(
  provider: CloudProvider,
): Promise<SyncActionResult | null> {
  let verify: VerifyResult;
  try {
    verify = await provider.verify();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchSyncMeta({ status: 'error', lastError: msg });
    return { ok: false, message: msg };
  }
  if (!verify.ok) {
    const msg = verify.error ?? '云端身份校验失败';
    await patchSyncMeta({ status: 'error', lastError: msg });
    return { ok: false, message: msg, verify };
  }
  const switchGuard = await guardUserSwitch(verify.userId);
  if (!switchGuard.ok) {
    await patchSyncMeta({ status: 'error', lastError: switchGuard.message });
    return { ok: false, message: switchGuard.message, verify };
  }
  return null;
}

export async function verifyConnection(): Promise<SyncActionResult> {
  const provider = await resolveProvider();
  if (!provider) {
    return { ok: false, message: '未配置云存储（本地模式）' };
  }
  try {
    const verify = await provider.verify();
    if (verify.ok) {
      const metaBefore = await getSyncMeta();
      const prevUser = metaBefore.cloudUserId;
      const switchGuard = await guardUserSwitch(verify.userId);
      if (!switchGuard.ok) {
        await patchSyncMeta({ status: 'error', lastError: switchGuard.message });
        return { ok: false, message: switchGuard.message, verify };
      }
      // Only bind unbound ops on first connect / same user — never on account switch
      if (verify.userId && (!prevUser || prevUser === verify.userId)) {
        await rebindUnboundOutbox(verify.userId);
      }
      await patchSyncMeta({
        status: 'idle',
        cloudUserId: verify.userId,
        lastError: undefined,
        provider: provider.id === 'memory' ? 'supabase' : provider.id,
      });
      return {
        ok: true,
        message: `连接成功${verify.email ? `（${verify.email}）` : ''}；云端约 ${verify.cloudRowCount ?? 0} 行。不会自动改动本地数据。${switchGuard.note ? ` ${switchGuard.note}` : ''}`,
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
  const authBlock = await ensureAuthMatchesBoundAccount(provider);
  if (authBlock) return authBlock;
  await patchSyncMeta({ status: 'syncing', lastError: undefined });
  try {
    const snap = await readLocalSnapshot();
    const mediaStore = provider.getMediaObjectStore?.() ?? null;
    const userId = (await provider.getAuthUserId?.()) ?? (await getSyncMeta()).cloudUserId;
    const rows = await localSnapshotToCloudRows(snap, { mediaStore, userId });
    const result = await provider.pushSnapshot(rows);
    if (result.error && !result.applied.length && !result.conflicts.length) {
      await patchSyncMeta({ status: 'error', lastError: result.error });
      return { ok: false, message: `首次上传失败：${result.error}`, pushed: 0 };
    }
    // Ack only rows actually written (LWW may skip cloud-newer — do not ack those)
    const appliedKeys = new Set(result.applied);
    const uploadedOk = rows.filter((r) => appliedKeys.has(`${r.entity}:${r.id}`));
    const acked = await ackOutboxCoveredByUpload(
      uploadedOk.map((r) => ({ entity: r.entity, id: r.id, updatedAt: r.updatedAt })),
    );
    if (result.conflicts.length) {
      await appendConflicts(
        result.conflicts.map((c) => ({
          id: uid(),
          entity: (c.entity as SyncEntity) || 'vehicles',
          entityId: c.entityId || c.opId,
          cloudUpdatedAt: c.cloudUpdatedAt,
          resolution: 'push_skipped_cloud_newer' as const,
          notedAt: nowISO(),
        })),
      );
      // Drop only the stale conflicted opIds; keep newer mid-upload ops
      await removeStaleConflictOps(result.conflicts);
    }
    const ts = nowISO();
    const skipped = result.conflicts.length;
    await patchSyncMeta({
      status: result.error ? 'error' : 'idle',
      lastPushAt: ts,
      lastSuccessAt: result.error ? undefined : ts,
      lastError: result.error,
    });
    return {
      ok: !result.error,
      message: `首次上传：写入 ${result.applied.length} 行，跳过云端较新 ${skipped} 行（确认队列 ${acked} 条）。本地数据未改动。${result.error ? ` 部分失败：${result.error}` : ''}`,
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
  const authBlock = await ensureAuthMatchesBoundAccount(provider);
  if (authBlock) return authBlock;
  await patchSyncMeta({ status: 'syncing', lastError: undefined });
  try {
    const snapshot = await provider.pullAll();
    // Validate before any local mutation
    assertCloudRowsValid(snapshot.rows.filter((r) => !r.deletedAt));

    const meta = await getSyncMeta();
    // Conflict / skip checks use ONLY current account pending ops
    const pendingMine = await listOutboxForUser(meta.cloudUserId);
    const pending = opts?.replaceLocal ? [] : pendingMine;
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
        clearOutboxOpIds: opts?.replaceLocal ? pendingMine.map((o) => o.opId) : undefined,
        mediaStore: provider.getMediaObjectStore?.() ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchSyncMeta({ status: 'error', lastError: `恢复写入失败（事务已中止）：${msg}` });
      return { ok: false, message: `恢复失败，本地保持原样：${msg}` };
    }

    // Progressive migrate: legacy base64 cloud rows → Storage (idempotent)
    const mediaMigrate = await migrateCloudLegacyMedia(provider);
    // NOTE: orphan GC is NOT auto-run here (upload→ref race). Use explicit cleanup.

    await appendConflicts(plan.conflicts);
    const ts = nowISO();
    const maxUpdated = snapshot.rows.reduce(
      (acc, r) => (r.updatedAt > acc ? r.updatedAt : acc),
      ts,
    );
    const migrateNote = formatMediaMigrateNote(mediaMigrate);
    const migrateErr = mediaMigrate.ok
      ? undefined
      : `媒体迁移待重试：未完成 ${mediaMigrate.unmigrated} 张；${mediaMigrate.errors.slice(0, 3).join('；')}`;
    await patchSyncMeta({
      status: mediaMigrate.ok ? 'idle' : 'error',
      lastPullAt: ts,
      lastSuccessAt: ts,
      serverCursor: maxUpdated,
      lastError: migrateErr,
    });
    return {
      ok: mediaMigrate.ok,
      message: `从云端恢复完成：应用 ${plan.appliedUpserts} 条更新、${plan.appliedDeletes} 条删除；跳过本地待推送 ${plan.skippedPendingLocal}。${migrateNote}`,
      merge: plan,
      pulled: snapshot.rows.length,
      mediaMigrate,
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

  const authBlock = await ensureAuthMatchesBoundAccount(provider);
  if (authBlock) return authBlock;

  await patchSyncMeta({ status: 'syncing', lastError: undefined });
  try {
    const ready = await listReadyOutbox();
    const enriched = await enrichOutboxPayloads(ready, provider);
    let pushed = 0;
    if (enriched.length) {
      const push = await provider.pushOps(enriched);
      if (push.error && !push.applied.length && !push.conflicts.length) {
        for (const op of enriched) await markOutboxFailure(op.opId, push.error);
        await patchSyncMeta({ status: 'error', lastError: push.error });
        return { ok: false, message: `推送失败：${push.error}` };
      }
      // Successfully written — remove those opIds (newer mid-sync ops have different opIds)
      await removeOutboxItems(push.applied);
      pushed = push.applied.length;
      if (push.conflicts.length) {
        await appendConflicts(
          push.conflicts.map((c) => ({
            id: uid(),
            entity: (c.entity as SyncEntity) || 'vehicles',
            entityId: c.entityId || c.opId,
            cloudUpdatedAt: c.cloudUpdatedAt,
            resolution: 'push_skipped_cloud_newer' as const,
            notedAt: nowISO(),
          })),
        );
        // Remove stale conflicted ops only; preserve newer ops for same entity
        await removeStaleConflictOps(push.conflicts);
      }
      if (push.error) {
        const done = new Set([...push.applied, ...push.conflicts.map((c) => c.opId)]);
        const remaining = enriched.filter((o) => !done.has(o.opId));
        for (const op of remaining) await markOutboxFailure(op.opId, push.error);
      }
    }

    const snapshot = await provider.pullAll();
    assertCloudRowsValid(snapshot.rows.filter((r) => !r.deletedAt));
    const localIndex = await buildLocalIndex();
    const pending = await listOutboxForUser((await getSyncMeta()).cloudUserId);
    const plan = mergeCloudIntoPlan(
      snapshot.rows,
      (entity, id) => localIndex.get(`${entity}:${id}`),
      pending,
      nowISO(),
    );

    try {
      await applyCloudRows(plan.toUpsert, plan.toDelete, {
        mediaStore: provider.getMediaObjectStore?.() ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchSyncMeta({ status: 'error', lastError: `拉取合并失败：${msg}` });
      return {
        ok: false,
        message: `推送 ${pushed} 条后拉取合并失败（本地合并已回滚）：${msg}`,
        pushed,
      };
    }

    // Best-effort: remove Storage objects for media tombstones just applied
    // (explicit tombstone — not speculative orphan GC)
    await removeStorageForDeletedMedia(provider, plan.toDelete);
    // Progressive migrate remaining base64 rows — surface errors; do not strip failed base64
    const mediaMigrate = await migrateCloudLegacyMedia(provider);
    // P0: do NOT auto-run orphan GC during sync (A upload / B GC before DB ref race).
    // Use runOrphanMediaCleanup explicitly (grace + recheck).

    await appendConflicts(plan.conflicts);
    const ts = nowISO();
    const migrateNote = formatMediaMigrateNote(mediaMigrate);
    const migrateErr = mediaMigrate.ok
      ? undefined
      : `媒体迁移待重试：未完成 ${mediaMigrate.unmigrated} 张；${mediaMigrate.errors.slice(0, 3).join('；')}`;
    await patchSyncMeta({
      status: mediaMigrate.ok ? 'idle' : 'error',
      lastPushAt: ts,
      lastPullAt: ts,
      lastSuccessAt: ts,
      lastError: migrateErr,
      serverCursor: snapshot.rows.reduce((a, r) => (r.updatedAt > a ? r.updatedAt : a), ts),
    });
    return {
      ok: mediaMigrate.ok,
      message: `双向同步完成：推送 ${pushed}，拉取应用 ${plan.appliedUpserts} 更新 / ${plan.appliedDeletes} 删除。${migrateNote}`,
      pushed,
      pulled: snapshot.rows.length,
      merge: plan,
      mediaMigrate,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patchSyncMeta({ status: 'error', lastError: msg });
    return { ok: false, message: msg };
  }
}

async function enrichOutboxPayloads(
  ops: Awaited<ReturnType<typeof listReadyOutbox>>,
  provider?: CloudProvider | null,
) {
  const db = await getDB();
  const store = provider?.getMediaObjectStore?.() ?? null;
  const userId =
    (await provider?.getAuthUserId?.()) ?? (await getSyncMeta()).cloudUserId ?? null;
  const out = [];
  for (const op of ops) {
    if (op.op === 'delete') {
      out.push(op);
      continue;
    }
    if (op.payload && op.entity !== 'media') {
      out.push(op);
      continue;
    }
    if (op.entity === 'media') {
      const m = await db.get('media', op.entityId);
      if (!m) {
        out.push(op);
        continue;
      }
      if (store && userId) {
        // Upload+verify BEFORE row push; never put base64 when Storage is available
        const payload = await uploadAndVerifyMedia({
          store,
          userId,
          media: m as Media,
        });
        out.push({ ...op, payload });
      } else {
        out.push({
          ...op,
          payload: await mediaToCloudPayload(m as Media, { preferBase64: true }),
        });
      }
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


function formatMediaMigrateNote(m: MediaMigrateSummary): string {
  if (!m.migrated && !m.failed && !m.unmigrated) return '';
  if (m.ok && m.migrated) return ` 媒体迁移：成功 ${m.migrated} 张。`;
  if (m.ok) return '';
  return (
    ` 媒体迁移：成功 ${m.migrated}，失败 ${m.failed}，仍待迁移 ${m.unmigrated}` +
    `（失败项保留 M2 base64；请重试同步）。` +
    (m.errors.length ? ` 详情：${m.errors.slice(0, 3).join('；')}` : '')
  );
}

/**
 * Progressive, idempotent migration of M2 base64 media rows → Storage v2.
 * Never strips base64 until upload+verify succeeds and refs are switched via LWW upsert.
 * Partial success is OK: failed rows keep base64 for retry.
 */
export async function migrateCloudLegacyMedia(provider: CloudProvider): Promise<MediaMigrateSummary> {
  const store = provider.getMediaObjectStore?.() ?? null;
  const userId = await provider.getAuthUserId?.();
  if (!store || !userId) {
    return { migrated: 0, skipped: 0, unmigrated: 0, failed: 0, errors: [], ok: true };
  }

  const snapshot = await provider.pullAll();
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of snapshot.rows) {
    if (row.entity !== 'media' || row.deletedAt) continue;
    const p = row.payload as CloudMediaPayload;
    if (isStorageMediaPayload(p) && !p.base64) {
      skipped += 1;
      continue;
    }
    if (!isLegacyBase64MediaPayload(p)) {
      skipped += 1;
      continue;
    }
    try {
      // Upload+verify FIRST — only then switch refs (drop base64)
      const v2 = await migrateLegacyPayloadToStorage({
        store,
        userId,
        payload: p,
        blobFromBase64: base64ToBlob,
      });
      const push = await provider.pushOps([
        {
          opId: `migrate-media-${row.id}`,
          entity: 'media',
          entityId: row.id,
          op: 'upsert',
          payload: v2,
          mutatedAt: nowISO(), // newer than legacy so LWW applies
          attempts: 0,
          nextRetryAt: nowISO(),
        },
      ]);
      if (push.error) {
        failed += 1;
        errors.push(`${row.id}: ${push.error}`);
        // Keep M2 base64 on cloud — do not strip
        continue;
      }
      if (push.applied.length) {
        migrated += 1;
      } else {
        // LWW skipped — final unmigrated recount decides retry need
        errors.push(`${row.id}: push skipped (cloud newer / conflict); will re-check`);
      }
    } catch (e) {
      failed += 1;
      errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Re-count remaining legacy after this pass (source of truth for retry)
  const after = await provider.pullAll();
  let unmigrated = 0;
  for (const row of after.rows) {
    if (row.entity !== 'media' || row.deletedAt) continue;
    const p = row.payload as CloudMediaPayload;
    if (isLegacyBase64MediaPayload(p) && !isStorageMediaPayload(p)) unmigrated += 1;
  }

  return {
    migrated,
    skipped,
    unmigrated,
    failed,
    errors,
    ok: unmigrated === 0,
  };
}

async function removeStorageForDeletedMedia(
  provider: CloudProvider,
  deleted: CloudRow[],
): Promise<void> {
  const store = provider.getMediaObjectStore?.() ?? null;
  if (!store) return;
  for (const row of deleted) {
    if (row.entity !== 'media') continue;
    const p = row.payload as CloudMediaPayload | undefined;
    const key = p?.storageKey;
    if (!key) continue;
    try {
      await store.removeMediaObject(key);
    } catch {
      /* explicit orphan GC later */
    }
  }
}

function collectLiveStorageKeys(rows: CloudRow[]): Set<string> {
  const live = new Set<string>();
  for (const row of rows) {
    if (row.entity !== 'media' || row.deletedAt) continue;
    const p = row.payload as CloudMediaPayload;
    if (p.storageKey) live.add(p.storageKey);
  }
  return live;
}

/**
 * Explicit orphan GC only (not called from sync automatically).
 * Grace period + live-ref recheck before any delete; aborts on incomplete list.
 */
export async function runOrphanMediaCleanup(
  provider: CloudProvider,
  opts?: { gracePeriodMs?: number; nowMs?: number },
): Promise<ReturnType<typeof cleanupOrphanMediaObjects>> {
  const store = provider.getMediaObjectStore?.() ?? null;
  const userId = await provider.getAuthUserId?.();
  if (!store || !userId) {
    return { removed: [], errors: [], skippedGrace: [], skippedRecheck: [] };
  }
  const snapshot = await provider.pullAll();
  const live = collectLiveStorageKeys(snapshot.rows);
  return cleanupOrphanMediaObjects({
    store,
    userId,
    liveStorageKeys: live,
    gracePeriodMs: opts?.gracePeriodMs,
    nowMs: opts?.nowMs,
    recheckLiveKeys: async () => {
      const again = await provider.pullAll();
      return collectLiveStorageKeys(again.rows);
    },
  });
}

export async function disconnectCloud(): Promise<SyncActionResult> {
  const provider = await resolveProvider();
  const metaBefore = await getSyncMeta();
  const parked = metaBefore.cloudUserId
    ? await countOutboxForOwner(metaBefore.cloudUserId)
    : (await listOutbox()).length;
  try {
    await provider?.signOut?.();
  } catch {
    /* ignore */
  }
  await clearCloudStorageConfig();
  // Keep pending outbox so same-account reconnect can resume sync
  await patchSyncMeta({
    status: 'disconnected',
    provider: 'none',
    cloudUserId: metaBefore.cloudUserId,
    serverCursor: undefined,
    lastError: undefined,
  });
  const parkNote =
    parked > 0
      ? `待同步队列 ${parked} 条已保留；同一账号重新连接后可继续同步。`
      : '无待同步项。';
  return { ok: true, message: `已断开云存储；本地业务数据保留。${parkNote}` };
}

export async function getSyncStatusSummary(): Promise<{
  meta: Awaited<ReturnType<typeof getSyncMeta>>;
  outboxCount: number;
  config: CloudStorageConfig;
}> {
  const meta = await getSyncMeta();
  const config = await getCloudStorageConfig();
  const outbox = meta.cloudUserId
    ? await listOutboxForUser(meta.cloudUserId)
    : await listOutbox();
  return { meta, outboxCount: outbox.length, config };
}
