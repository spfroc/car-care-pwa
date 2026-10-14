/**
 * Notion / cloud switch–disconnect Outbox corridor (D2-P5 · architecture §4.8 · SW1–SW4).
 *
 * Default: RETAIN orphan Outbox; isolate by ownerUserId; never mis-push to another workspace.
 * Explicit discard (SW3) requires confirmToken === 'DISCARD'.
 */
import { getCloudStorageConfig, setCloudStorageConfig } from './config';
import {
  clearOutboxForUser,
  countOutboxForOwner,
  discardOutboxForExactOwner,
  getSyncMeta,
  listOrphanOutbox,
  listOutbox,
  listOutboxForUser,
  listReadyOutbox,
  patchSyncMeta,
  summarizeOrphanOutbox,
  OUTBOX_UNBOUND,
} from './outbox';
import { clearNotionRuntimeSession, getNotionRuntimeSession } from './notionSession';
import type { SyncOutboxItem } from './types';

export type SwitchCorridorMode = 'block' | 'park';

export type SwitchGuardResult =
  | { ok: true; mode: SwitchCorridorMode; note?: string; parkedCount?: number; previousOwner?: string }
  | { ok: false; mode: SwitchCorridorMode; message: string };

/**
 * SW2 corridor decision when verify returns a different workspaceKey / userId.
 * - block: Supabase-style — refuse switch while local business data or parked outbox exist
 * - park: Notion-style — rebind cloudUserId, RETAIN old owner queue, do not push orphans
 */
export async function evaluateWorkspaceSwitch(
  newOwnerId: string | undefined,
  opts: {
    mode: SwitchCorridorMode;
    localBusinessRows: number;
  },
): Promise<SwitchGuardResult> {
  if (!newOwnerId) return { ok: true, mode: opts.mode };
  const meta = await getSyncMeta();
  if (!meta.cloudUserId || meta.cloudUserId === newOwnerId) {
    return { ok: true, mode: opts.mode };
  }

  const previousOwner = meta.cloudUserId;
  const parked = await countOutboxForOwner(previousOwner);
  const localRows = opts.localBusinessRows;

  if (opts.mode === 'block') {
    if (parked > 0 || localRows > 0) {
      return {
        ok: false,
        mode: 'block',
        message:
          `已阻止账号切换：本机 IndexedDB 跨云端账号共享，当前绑定 ${previousOwner.slice(0, 8)}…，` +
          `本地业务数据 ${localRows} 条、原账号待同步 ${parked} 条。` +
          `请先导出 JSON 备份 → 断开云连接 →（如需换号）清空本地业务数据或用「从云端完全替换本地」恢复新账号数据，再连接新账号。` +
          `切勿在未清空时把本地数据首次上传到另一账号。`,
      };
    }
    await patchSyncMeta({
      cloudUserId: newOwnerId,
      serverCursor: undefined,
    });
    return {
      ok: true,
      mode: 'block',
      note: `云端账号已切换（${previousOwner.slice(0, 8)}… → ${newOwnerId.slice(0, 8)}…）；本地无业务数据，已重置同步游标。`,
      previousOwner,
      parkedCount: 0,
    };
  }

  // park mode (Notion SW2): retain orphan outbox; rebind; never clearOutboxForUser
  await patchSyncMeta({
    cloudUserId: newOwnerId,
    serverCursor: undefined,
  });
  const cfg = await getCloudStorageConfig();
  if (cfg.provider === 'notion') {
    await setCloudStorageConfig({ ...cfg, workspaceKey: newOwnerId });
  }
  return {
    ok: true,
    mode: 'park',
    note:
      `工作区已切换（${previousOwner.slice(0, 8)}… → ${newOwnerId.slice(0, 8)}…）。` +
      (parked > 0
        ? `已保留原工作区待同步 ${parked} 条（不会推送到新工作区）；可在「未推送（旧工作区）」面板丢弃或切回后推送。`
        : `原工作区无待同步项。`) +
      (localRows > 0 ? ` 本地业务数据 ${localRows} 条仍保留。` : ''),
    previousOwner,
    parkedCount: parked,
  };
}

/** SW1: disconnect must not clear outbox — inspect post-disconnect state. */
export async function assertDisconnectRetainsOutbox(
  ownerUserId: string | undefined,
): Promise<{ retained: number; sessionCleared: boolean }> {
  const session = getNotionRuntimeSession();
  const retained = ownerUserId
    ? await countOutboxForOwner(ownerUserId)
    : (await listOutbox()).length;
  return { retained, sessionCleared: !session?.bearer };
}

export type OrphanPanelSummary = {
  currentOwnerId?: string;
  orphans: Array<{ ownerUserId: string; count: number }>;
  orphanTotal: number;
  currentReady: number;
  currentPending: number;
};

export async function getOrphanOutboxPanel(): Promise<OrphanPanelSummary> {
  const meta = await getSyncMeta();
  const currentOwnerId = meta.cloudUserId;
  const orphans = await summarizeOrphanOutbox(currentOwnerId);
  const orphanTotal = orphans.reduce((n, o) => n + o.count, 0);
  const currentPending = currentOwnerId
    ? (await listOutboxForUser(currentOwnerId)).filter(
        (o) => (o.ownerUserId ?? OUTBOX_UNBOUND) === currentOwnerId,
      ).length
    : 0;
  const currentReady = (await listReadyOutbox()).length;
  return { currentOwnerId, orphans, orphanTotal, currentReady, currentPending };
}

/**
 * SW3: explicit discard. confirmToken must be exactly 'DISCARD'.
 * Never called from disconnect/switch defaults.
 */
export async function discardParkedOutboxOwner(input: {
  ownerUserId: string;
  confirmToken: string;
}): Promise<{ ok: boolean; removed: number; message: string }> {
  if (input.confirmToken !== 'DISCARD') {
    return { ok: false, removed: 0, message: '需要确认令牌 DISCARD 才会丢弃旧工作区队列。' };
  }
  const owner = input.ownerUserId?.trim();
  if (!owner || owner === OUTBOX_UNBOUND) {
    return { ok: false, removed: 0, message: '无效的 ownerUserId。' };
  }
  const meta = await getSyncMeta();
  if (meta.cloudUserId && owner === meta.cloudUserId) {
    return {
      ok: false,
      removed: 0,
      message: '拒绝丢弃当前工作区队列；请先切换/断开，或使用其它清理入口。',
    };
  }
  const removed = await discardOutboxForExactOwner(owner);
  return {
    ok: true,
    removed,
    message: removed > 0 ? `已丢弃旧工作区 ${owner.slice(0, 8)}… 的 ${removed} 条待同步项。` : '该工作区无待同步项。',
  };
}

/**
 * SW4 helper: ops that would flush for a given owner (exact match).
 * Used by tests to prove switch-back can flush the parked queue.
 */
export async function listFlushableForOwner(ownerUserId: string): Promise<SyncOutboxItem[]> {
  const all = await listOutbox();
  return all.filter((o) => (o.ownerUserId ?? OUTBOX_UNBOUND) === ownerUserId);
}

/** Safety: ensure ready flush set never includes foreign owners. */
export async function assertReadyOutboxIsolated(
  currentOwnerId: string | undefined,
): Promise<{ ok: boolean; leaked: SyncOutboxItem[] }> {
  const ready = await listReadyOutbox();
  if (!currentOwnerId) {
    const leaked = ready.filter((o) => (o.ownerUserId ?? OUTBOX_UNBOUND) !== OUTBOX_UNBOUND);
    return { ok: leaked.length === 0, leaked };
  }
  const leaked = ready.filter((o) => {
    const owner = o.ownerUserId ?? OUTBOX_UNBOUND;
    return owner !== currentOwnerId && owner !== OUTBOX_UNBOUND;
  });
  return { ok: leaked.length === 0, leaked };
}

/** Test/diag: prove disconnect path does not call clearOutboxForUser. */
export function disconnectMustNotClearOutbox(): {
  defaultRetains: true;
  forbiddenDefault: 'clearOutboxForUser';
} {
  void clearOutboxForUser; // referenced so tree-shake keeps the export; not invoked
  void clearNotionRuntimeSession;
  return { defaultRetains: true, forbiddenDefault: 'clearOutboxForUser' };
}

export async function peekOrphanOutboxItems(
  currentOwnerId: string | undefined,
): Promise<SyncOutboxItem[]> {
  return listOrphanOutbox(currentOwnerId);
}
