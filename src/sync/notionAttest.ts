/**
 * RR-WK: atomic /verify attestation — session + sync_meta in one write path.
 * ADR §2.3 / §3.2: never flush with stale meta overriding session-derived target.
 */

import { getCloudStorageConfig, setCloudStorageConfig } from './config';
import {
  getNotionRuntimeSession,
  setNotionRuntimeSession,
} from './notionSession';
import { buildNotionTargetId, computeGatewayKeyFp, observeTargetGuard } from './notionTarget';
import { getSyncMeta, patchSyncMeta } from './outbox';

export type NotionAttestResult = {
  workspaceKey: string;
  gatewayKeyFp: string;
  notionTargetId: string;
};

/**
 * After successful /verify (ok + non-empty workspaceKey), stamp:
 * 1. runtime session: workspaceKey + gatewayKeyFp (from current bearer)
 * 2. sync_meta: cloudUserId + notionGatewayKeyFp + notionTargetId
 * Same logical write path — callers must not flush between these steps.
 */
export async function attestNotionTargetAfterVerify(
  workspaceKey: string,
  opts?: { provider?: 'notion' | string },
): Promise<NotionAttestResult> {
  const wk = workspaceKey.trim();
  if (!wk) {
    throw new Error('attestNotionTargetAfterVerify: empty workspaceKey');
  }
  const session = getNotionRuntimeSession();
  const bearer = session?.bearer?.trim();
  if (!bearer) {
    throw new Error('attestNotionTargetAfterVerify: no bearer in session');
  }
  const gatewayKeyFp = await computeGatewayKeyFp(bearer);
  const notionTargetId = buildNotionTargetId(wk, gatewayKeyFp);

  // 1) Session first (flush authority)
  setNotionRuntimeSession({
    bearer,
    workspaceKey: wk,
    gatewayKeyFp,
    expiresAt: session?.expiresAt,
  });

  // 2) sync_meta mirror in the same attestation path
  const meta = await getSyncMeta();
  await patchSyncMeta({
    cloudUserId: wk,
    notionGatewayKeyFp: gatewayKeyFp,
    notionTargetId,
    status: meta.status === 'disconnected' ? 'idle' : meta.status,
    provider: opts?.provider === 'notion' || meta.provider === 'notion' ? 'notion' : meta.provider,
    lastError: undefined,
  });

  // 3) Optional non-secret config hint for settings display
  try {
    const cfg = await getCloudStorageConfig();
    if (cfg.provider === 'notion') {
      await setCloudStorageConfig({
        ...cfg,
        workspaceKey: wk,
        notionGatewayKeyFp: gatewayKeyFp,
      });
    }
  } catch {
    /* config write best-effort; session+meta already attested */
  }

  observeTargetGuard('verify_attested', { workspaceKey: wk, gatewayKeyFp, notionTargetId });
  return { workspaceKey: wk, gatewayKeyFp, notionTargetId };
}
