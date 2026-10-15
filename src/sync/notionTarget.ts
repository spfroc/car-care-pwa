/**
 * RR-WK Phase 1 — Outbox Gateway+Workspace composite identity helpers.
 * ADR: docs/m3d-rr-wk-outbox-gateway-identity.md
 *
 * Comparison authority = structured { workspaceKey|ownerUserId, gatewayKeyFp }.
 * notionTargetId is a redundant display/group key only (workspaceKey::gatewayKeyFp).
 */

import type { SyncOutboxItem } from './types';

/** Feature flag: production must not auto-enforce until Phase 3 authorization. */
export type NotionTargetGuardMode = 'off' | 'observe' | 'enforce';

/** Structured Notion Outbox target (comparison authority). */
export type NotionTarget = {
  workspaceKey: string;
  gatewayKeyFp: string;
};

const GATEWAY_KEY_FP_LEN = 12;
const TARGET_SEP = '::';

/** Default off — safe for accidental production static deploy; car-test flips to observe/enforce. */
let guardMode: NotionTargetGuardMode = 'off';

export function getNotionTargetGuardMode(): NotionTargetGuardMode {
  return guardMode;
}

export function setNotionTargetGuardMode(mode: NotionTargetGuardMode): void {
  guardMode = mode;
}

/** Test helper: reset to production-safe default. */
export function resetNotionTargetGuardModeForTests(): void {
  guardMode = 'off';
}

export function isNotionTargetGuardActive(): boolean {
  return guardMode === 'observe' || guardMode === 'enforce';
}

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * gatewayKeyFp := sha256_hex(utf8(bearer))[0:12]
 * Same algorithm as ops keyFp; not a secret.
 */
export async function computeGatewayKeyFp(bearer: string): Promise<string> {
  const trimmed = bearer.trim();
  if (!trimmed) {
    throw new Error('computeGatewayKeyFp: empty bearer');
  }
  const data = new TextEncoder().encode(trimmed);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(hash).slice(0, GATEWAY_KEY_FP_LEN);
}

/** Redundant key: workspaceKey + "::" + gatewayKeyFp (exactly 12 hex, no spaces). */
export function buildNotionTargetId(workspaceKey: string, gatewayKeyFp: string): string {
  const wk = workspaceKey.trim();
  const fp = gatewayKeyFp.trim().toLowerCase();
  if (!wk || !fp) {
    throw new Error('buildNotionTargetId: workspaceKey and gatewayKeyFp required');
  }
  if (fp.length !== GATEWAY_KEY_FP_LEN || !/^[0-9a-f]{12}$/.test(fp)) {
    throw new Error(`buildNotionTargetId: gatewayKeyFp must be ${GATEWAY_KEY_FP_LEN} hex chars`);
  }
  return `${wk}${TARGET_SEP}${fp}`;
}

export function parseNotionTargetId(
  notionTargetId: string | undefined,
): NotionTarget | null {
  if (!notionTargetId || !notionTargetId.includes(TARGET_SEP)) return null;
  const idx = notionTargetId.indexOf(TARGET_SEP);
  const workspaceKey = notionTargetId.slice(0, idx);
  const gatewayKeyFp = notionTargetId.slice(idx + TARGET_SEP.length);
  if (!workspaceKey || !/^[0-9a-f]{12}$/i.test(gatewayKeyFp)) return null;
  return { workspaceKey, gatewayKeyFp: gatewayKeyFp.toLowerCase() };
}

/** Structured equality — never compare by notionTargetId string alone. */
export function notionTargetsEqual(
  a: NotionTarget | null | undefined,
  b: NotionTarget | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.workspaceKey === b.workspaceKey &&
    a.gatewayKeyFp.toLowerCase() === b.gatewayKeyFp.toLowerCase()
  );
}

/**
 * Resolve structured target from an Outbox row.
 * Prefer explicit fields; fall back to parsing redundant notionTargetId only to recover fields.
 */
export function targetFromOutboxItem(item: SyncOutboxItem): NotionTarget | null {
  const owner = item.ownerUserId?.trim();
  const fp = item.gatewayKeyFp?.trim().toLowerCase();
  if (owner && owner !== 'unbound' && fp && /^[0-9a-f]{12}$/.test(fp)) {
    return { workspaceKey: owner, gatewayKeyFp: fp };
  }
  const parsed = parseNotionTargetId(item.notionTargetId);
  if (parsed && owner && owner !== 'unbound' && parsed.workspaceKey === owner) {
    return parsed;
  }
  return null;
}

export type OrphanKind = 'cross_workspace' | 'same_workspace_diff_gateway' | 'legacy_no_fp';

export function classifyOrphanKind(
  item: SyncOutboxItem,
  active: NotionTarget | null | undefined,
): OrphanKind | null {
  const owner = item.ownerUserId?.trim();
  if (!owner || owner === 'unbound') return null;
  const itemTarget = targetFromOutboxItem(item);
  if (!item.gatewayKeyFp && !itemTarget) {
    // Legacy L1 — treated as orphan-like when guard active and not claimed
    if (active && owner === active.workspaceKey) return 'legacy_no_fp';
    if (active && owner !== active.workspaceKey) return 'cross_workspace';
    return 'legacy_no_fp';
  }
  if (!active) {
    return itemTarget ? 'same_workspace_diff_gateway' : 'legacy_no_fp';
  }
  if (owner !== active.workspaceKey) return 'cross_workspace';
  if (itemTarget && itemTarget.gatewayKeyFp !== active.gatewayKeyFp) {
    return 'same_workspace_diff_gateway';
  }
  return null;
}

export function observeTargetGuard(event: string, detail: Record<string, unknown>): void {
  if (guardMode !== 'observe' && guardMode !== 'enforce') return;
  try {
    // eslint-disable-next-line no-console
    console.info(`[notionTargetGuard:${guardMode}] ${event}`, detail);
  } catch {
    /* ignore */
  }
}
