/**
 * Clear a stuck `syncing` flag after a crashed tab.
 * Kept out of engine.ts so startup recovery does not download the sync engine
 * or the Supabase client.
 */
import { getSyncMeta, patchSyncMeta } from './outbox';
import { hasActiveLease, hasFreshHeartbeat, isWebSyncLockHeld } from './tabLock';

/**
 * M3-B: if a previous tab crashed mid-sync, status may stick on `syncing`.
 * Must NOT infer idle from IDB lease alone — also check Web Locks + heartbeat
 * so Tab B opening settings while Tab A syncs (Web Locks) does not clear status.
 */
export async function recoverStaleSyncingStatus(): Promise<boolean> {
  const meta = await getSyncMeta();
  if (meta.status !== 'syncing') return false;
  if (await isWebSyncLockHeld()) return false;
  if (await hasActiveLease()) return false;
  if (await hasFreshHeartbeat()) return false;
  await patchSyncMeta({
    status: 'idle',
    lastError: '检测到上次同步异常中断（可能关页/崩溃）；队列仍保留，可重新同步。',
  });
  return true;
}
