/**
 * RR-WK Phase 1 — Outbox Gateway+Workspace composite identity
 * ADR: docs/m3d-rr-wk-outbox-gateway-identity.md
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests } from '../db';
import { nowISO } from '../lib/constants';
import { setCloudStorageConfig } from './config';
import {
  claimLegacyNotionOutbox,
  enqueueSyncOp,
  getSessionDerivedActiveTarget,
  getSyncMeta,
  listOrphanOutbox,
  listOutbox,
  listReadyOutbox,
  makeOutboxItem,
  patchSyncMeta,
  putOutboxItem,
  summarizeOrphanOutbox,
} from './outbox';
import { attestNotionTargetAfterVerify } from './notionAttest';
import {
  resetNotionRuntimeSessionForTests,
  setNotionRuntimeSession,
  getNotionRuntimeSession,
} from './notionSession';
import {
  buildNotionTargetId,
  computeGatewayKeyFp,
  notionTargetsEqual,
  resetNotionTargetGuardModeForTests,
  setNotionTargetGuardMode,
  targetFromOutboxItem,
} from './notionTarget';

async function resetDb() {
  resetNotionRuntimeSessionForTests();
  resetNotionTargetGuardModeForTests();
  await closeDBForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('car-care-db');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

describe('RR-WK Phase 1 identity helpers', () => {
  it('computeGatewayKeyFp is exactly 12 hex chars', async () => {
    const fp = await computeGatewayKeyFp('test-bearer-key');
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    expect(fp).toHaveLength(12);
  });

  it('buildNotionTargetId uses :: with no spaces', async () => {
    const fp = await computeGatewayKeyFp('k');
    const id = buildNotionTargetId('wk-abc', fp);
    expect(id).toBe(`wk-abc::${fp}`);
    expect(id.includes(' ')).toBe(false);
  });

  it('structured compare is authority (not string alone)', () => {
    expect(
      notionTargetsEqual(
        { workspaceKey: 'wk', gatewayKeyFp: 'aaaaaaaaaaaa' },
        { workspaceKey: 'wk', gatewayKeyFp: 'aaaaaaaaaaaa' },
      ),
    ).toBe(true);
    expect(
      notionTargetsEqual(
        { workspaceKey: 'wk', gatewayKeyFp: 'aaaaaaaaaaaa' },
        { workspaceKey: 'wk', gatewayKeyFp: 'bbbbbbbbbbbb' },
      ),
    ).toBe(false);
    expect(
      notionTargetsEqual(
        { workspaceKey: 'wk1', gatewayKeyFp: 'aaaaaaaaaaaa' },
        { workspaceKey: 'wk2', gatewayKeyFp: 'aaaaaaaaaaaa' },
      ),
    ).toBe(false);
  });
});

describe('RR-WK Phase 1 outbox gates (enforce)', () => {
  beforeEach(async () => {
    await resetDb();
    setNotionTargetGuardMode('enforce');
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-shared',
      notionTargetGuard: 'enforce',
    });
  });
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
    resetNotionTargetGuardModeForTests();
  });

  it('session-derived flush: matching target is ready; stale meta cannot override', async () => {
    const fpA = await computeGatewayKeyFp('key-A');
    const fpB = await computeGatewayKeyFp('key-B');
    expect(fpA).not.toBe(fpB);

    setNotionRuntimeSession({
      bearer: 'key-A',
      workspaceKey: 'wk-shared',
      gatewayKeyFp: fpA,
    });
    // Stale meta points at B — must NOT become active target
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-shared',
      notionGatewayKeyFp: fpB,
      notionTargetId: buildNotionTargetId('wk-shared', fpB),
    });

    await putOutboxItem({
      ...makeOutboxItem({
        entity: 'vehicles',
        entityId: 'v-a',
        op: 'upsert',
        payload: { id: 'v-a' },
        ownerUserId: 'wk-shared',
      }),
      gatewayKeyFp: fpA,
      notionTargetId: buildNotionTargetId('wk-shared', fpA),
    });
    await putOutboxItem({
      ...makeOutboxItem({
        entity: 'vehicles',
        entityId: 'v-b',
        op: 'upsert',
        payload: { id: 'v-b' },
        ownerUserId: 'wk-shared',
      }),
      gatewayKeyFp: fpB,
      notionTargetId: buildNotionTargetId('wk-shared', fpB),
    });

    const active = getSessionDerivedActiveTarget();
    expect(active).toEqual({ workspaceKey: 'wk-shared', gatewayKeyFp: fpA });

    const ready = await listReadyOutbox();
    expect(ready.map((o) => o.entityId)).toEqual(['v-a']);
    expect(ready.find((o) => o.entityId === 'v-b')).toBeUndefined();
  });

  it('same workspace · different keyFp does not cross-flush', async () => {
    const fpP = await computeGatewayKeyFp('prod-key');
    const fpT = await computeGatewayKeyFp('test-key');
    setNotionRuntimeSession({
      bearer: 'prod-key',
      workspaceKey: 'wk-shared',
      gatewayKeyFp: fpP,
    });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-shared',
      notionGatewayKeyFp: fpP,
      notionTargetId: buildNotionTargetId('wk-shared', fpP),
    });

    await putOutboxItem({
      ...makeOutboxItem({
        entity: 'vehicles',
        entityId: 'from-test',
        op: 'upsert',
        payload: { id: 'from-test' },
        ownerUserId: 'wk-shared',
      }),
      gatewayKeyFp: fpT,
      notionTargetId: buildNotionTargetId('wk-shared', fpT),
    });

    expect(await listReadyOutbox()).toHaveLength(0);
    const orphans = await listOrphanOutbox('wk-shared');
    expect(orphans).toHaveLength(1);
    const summary = await summarizeOrphanOutbox('wk-shared');
    expect(summary.some((s) => s.kind === 'same_workspace_diff_gateway')).toBe(true);
  });

  it('legacy L1 (no gatewayKeyFp) does not auto flush', async () => {
    const fp = await computeGatewayKeyFp('key-A');
    setNotionRuntimeSession({
      bearer: 'key-A',
      workspaceKey: 'wk-shared',
      gatewayKeyFp: fp,
    });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-shared',
      notionGatewayKeyFp: fp,
      notionTargetId: buildNotionTargetId('wk-shared', fp),
    });

    // Write legacy row without going through stamp (simulate pre-upgrade IDB)
    const { getDB } = await import('../db');
    const legacy = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'legacy-v',
      op: 'upsert',
      payload: { id: 'legacy-v' },
      ownerUserId: 'wk-shared',
    });
    // Ensure no fp fields
    delete (legacy as { gatewayKeyFp?: string }).gatewayKeyFp;
    delete (legacy as { notionTargetId?: string }).notionTargetId;
    await (await getDB()).put('sync_outbox', legacy);

    expect(await listReadyOutbox()).toHaveLength(0);
    expect(targetFromOutboxItem(legacy)).toBeNull();
  });

  it('claim requires CLAIM token and secondary-confirm path; verify must not auto-claim', async () => {
    const fp = await computeGatewayKeyFp('key-A');
    setNotionRuntimeSession({
      bearer: 'key-A',
      workspaceKey: 'wk-shared',
      gatewayKeyFp: fp,
    });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-shared',
      notionGatewayKeyFp: fp,
      notionTargetId: buildNotionTargetId('wk-shared', fp),
    });

    const { getDB } = await import('../db');
    const legacy = makeOutboxItem({
      entity: 'vehicles',
      entityId: 'legacy-v',
      op: 'upsert',
      payload: { id: 'legacy-v' },
      ownerUserId: 'wk-shared',
    });
    await (await getDB()).put('sync_outbox', legacy);

    const refused = await claimLegacyNotionOutbox({ confirmToken: 'nope' });
    expect(refused.ok).toBe(false);
    expect(await listReadyOutbox()).toHaveLength(0);

    // Attest path must not claim
    await attestNotionTargetAfterVerify('wk-shared', { provider: 'notion' });
    const afterAttest = await listOutbox();
    expect(afterAttest.find((o) => o.entityId === 'legacy-v')?.gatewayKeyFp).toBeUndefined();

    const claimed = await claimLegacyNotionOutbox({ confirmToken: 'CLAIM' });
    expect(claimed.ok).toBe(true);
    expect(claimed.claimed).toBe(1);
    const ready = await listReadyOutbox();
    expect(ready.some((o) => o.entityId === 'legacy-v')).toBe(true);
    expect(ready[0]?.gatewayKeyFp).toBe(fp);
    expect(ready[0]?.notionTargetId).toBe(buildNotionTargetId('wk-shared', fp));
  });

  it('no attested session → refuse all Notion flush (no stale meta fallback)', async () => {
    const fp = await computeGatewayKeyFp('key-A');
    // Meta looks valid but session cleared
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-shared',
      notionGatewayKeyFp: fp,
      notionTargetId: buildNotionTargetId('wk-shared', fp),
    });
    resetNotionRuntimeSessionForTests();

    await putOutboxItem({
      ...makeOutboxItem({
        entity: 'vehicles',
        entityId: 'v1',
        op: 'upsert',
        payload: { id: 'v1' },
        ownerUserId: 'wk-shared',
      }),
      gatewayKeyFp: fp,
      notionTargetId: buildNotionTargetId('wk-shared', fp),
    });

    expect(getSessionDerivedActiveTarget()).toBeNull();
    expect(await listReadyOutbox()).toHaveLength(0);
  });

  it('E11: verify attest writes session + sync_meta atomically consistent', async () => {
    setNotionRuntimeSession({ bearer: 'key-E11', workspaceKey: '' });
    const result = await attestNotionTargetAfterVerify('wk-shared', { provider: 'notion' });
    const session = getNotionRuntimeSession();
    const meta = await getSyncMeta();
    expect(session?.workspaceKey).toBe('wk-shared');
    expect(session?.gatewayKeyFp).toBe(result.gatewayKeyFp);
    expect(meta.cloudUserId).toBe('wk-shared');
    expect(meta.notionGatewayKeyFp).toBe(result.gatewayKeyFp);
    expect(meta.notionTargetId).toBe(result.notionTargetId);
    expect(meta.notionTargetId).toBe(
      buildNotionTargetId('wk-shared', result.gatewayKeyFp),
    );

    // Stale meta must not override session-derived flush
    const otherFp = await computeGatewayKeyFp('other-key');
    await patchSyncMeta({
      notionGatewayKeyFp: otherFp,
      notionTargetId: buildNotionTargetId('wk-shared', otherFp),
    });
    await putOutboxItem({
      ...makeOutboxItem({
        entity: 'vehicles',
        entityId: 'v-session',
        op: 'upsert',
        payload: { id: 'v-session' },
        ownerUserId: 'wk-shared',
      }),
      gatewayKeyFp: result.gatewayKeyFp,
      notionTargetId: result.notionTargetId,
    });
    await putOutboxItem({
      ...makeOutboxItem({
        entity: 'vehicles',
        entityId: 'v-stale',
        op: 'upsert',
        payload: { id: 'v-stale' },
        ownerUserId: 'wk-shared',
      }),
      gatewayKeyFp: otherFp,
      notionTargetId: buildNotionTargetId('wk-shared', otherFp),
    });
    const ready = await listReadyOutbox();
    expect(ready.map((o) => o.entityId)).toEqual(['v-session']);
  });

  it('enqueue stamps composite identity when session attested', async () => {
    const fp = await computeGatewayKeyFp('key-enq');
    setNotionRuntimeSession({
      bearer: 'key-enq',
      workspaceKey: 'wk-shared',
      gatewayKeyFp: fp,
    });
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-shared',
      notionGatewayKeyFp: fp,
      notionTargetId: buildNotionTargetId('wk-shared', fp),
    });
    await enqueueSyncOp({
      entity: 'vehicles',
      entityId: 'enq-1',
      op: 'upsert',
      payload: { id: 'enq-1', name: 'X', updatedAt: nowISO() },
    });
    const rows = await listOutbox();
    const row = rows.find((o) => o.entityId === 'enq-1');
    expect(row?.ownerUserId).toBe('wk-shared');
    expect(row?.gatewayKeyFp).toBe(fp);
    expect(row?.notionTargetId).toBe(buildNotionTargetId('wk-shared', fp));
  });
});

describe('RR-WK Phase 1 default flag off preserves owner flush (compat)', () => {
  beforeEach(async () => {
    await resetDb();
    await setCloudStorageConfig({
      provider: 'notion',
      notionGatewayUrl: 'https://gw.example.com',
      workspaceKey: 'wk-a',
    });
  });
  afterEach(async () => {
    await closeDBForTests();
    resetNotionRuntimeSessionForTests();
    resetNotionTargetGuardModeForTests();
  });

  it('default off: owner-matched legacy rows still list as ready (pre-enforce)', async () => {
    await patchSyncMeta({
      deviceId: 'dev',
      status: 'idle',
      provider: 'notion',
      cloudUserId: 'wk-a',
    });
    setNotionRuntimeSession({ bearer: 'k', workspaceKey: 'wk-a' });
    await putOutboxItem(
      makeOutboxItem({
        entity: 'vehicles',
        entityId: 'compat',
        op: 'upsert',
        payload: { id: 'compat' },
        ownerUserId: 'wk-a',
      }),
    );
    const ready = await listReadyOutbox();
    expect(ready.some((o) => o.entityId === 'compat')).toBe(true);
  });
});
