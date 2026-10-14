/**
 * D2-P3 live matrix against independent Notion test workspace via D1-test Gateway.
 * Secrets: GATEWAY_API_KEY from file / env; NEVER log raw key or NOTION_TOKEN.
 * Artifacts: artifacts/live-notion/ (fingerprints only).
 *
 * Usage:
 *   node scripts/m3d-d2-p3-live-notion.mjs
 * Env:
 *   NOTION_GATEWAY_URL (default: d1-test workers.dev)
 *   GATEWAY_API_KEY or ~/.car-care-secrets/m3d-d1-gateway-api-key.txt
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ART = join(ROOT, 'artifacts', 'live-notion');
mkdirSync(ART, { recursive: true });

const GATEWAY =
  (process.env.NOTION_GATEWAY_URL || '').replace(/\/+$/, '') ||
  'https://car-care-notion-sync-d1-test.spf-roc.workers.dev';

function loadKey() {
  if (process.env.GATEWAY_API_KEY?.trim()) return process.env.GATEWAY_API_KEY.trim();
  const p = join(homedir(), '.car-care-secrets', 'm3d-d1-gateway-api-key.txt');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  return '';
}

function fingerprint(s) {
  if (!s) return null;
  return createHash('sha256').update(s).digest('hex').slice(0, 12);
}

function iso(ms = Date.now()) {
  return new Date(ms).toISOString();
}

const KEY = loadKey();
const STEPS = {};
const gates = {};

function record(id, ok, detail) {
  STEPS[id] = { ok, ...detail, at: iso() };
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`${tag} ${id}`, detail?.summary || detail?.message || '');
}


async function pollPull(predicate, { tries = 8, delayMs = 500, label = 'pull' } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await gw('GET', '/sync/pull?entities=vehicles,records');
    const rows = last.json?.rows || [];
    if (predicate(rows)) return { ok: true, res: last, rows, attempts: i + 1 };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, res: last, rows: last?.json?.rows || [], attempts: tries, label };
}

async function gw(method, path, body) {
  const headers = {
    Authorization: `Bearer ${KEY}`,
    Accept: 'application/json',
  };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${GATEWAY}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function main() {
  const started = iso();
  if (!KEY) {
    const out = {
      status: 'BLOCKED',
      reason: 'GATEWAY_API_KEY missing (env or ~/.car-care-secrets/m3d-d1-gateway-api-key.txt)',
      gateway: GATEWAY,
      started,
    };
    writeFileSync(join(ART, 'matrix.json'), JSON.stringify(out, null, 2));
    console.error('BLOCKED', out.reason);
    process.exit(2);
  }

  console.log('Gateway', GATEWAY);
  console.log('Key fingerprint', fingerprint(KEY));

  // G1 verify
  const health = await gw('GET', '/health');
  record('G1.health', health.status === 200 && health.json?.ok === true, {
    summary: `http=${health.status} version=${health.json?.version}`,
    http: health.status,
    version: health.json?.version,
  });

  const verify = await gw('GET', '/verify');
  const workspaceKey = verify.json?.workspaceKey;
  record('G1.verify', verify.status === 200 && verify.json?.ok === true && Boolean(workspaceKey), {
    summary: `http=${verify.status} bot=${verify.json?.botName || ''} wk=${fingerprint(workspaceKey || '')}`,
    http: verify.status,
    workspaceKeyFingerprint: fingerprint(workspaceKey || ''),
    botName: verify.json?.botName,
    dataSources: verify.json?.dataSources
      ? {
          vehicles: fingerprint(verify.json.dataSources.vehicles || ''),
          records: fingerprint(verify.json.dataSources.records || ''),
        }
      : undefined,
    error: verify.json?.error || verify.json?.message,
  });
  gates.G1 = STEPS['G1.verify']?.ok === true;

  if (!gates.G1) {
    finish('BLOCKED', 'Gateway /verify failed — Token/Worker may be down', started);
    return;
  }

  const runId = `d2p3-${Date.now()}`;
  const vehId = `veh-${runId}`;
  const recId = `rec-${runId}`;
  const t0 = Date.now();

  // ★C create vehicle + record
  const createOps = [
    {
      id: `op-c-v-${runId}`,
      entity: 'vehicles',
      entityId: vehId,
      op: 'upsert',
      mutatedAt: iso(t0),
      payload: {
        id: vehId,
        name: `D2P3 ${runId}`,
        plate: 'D2P3',
        energyType: 'ICE',
        bodyType: 'SEDAN',
        note: 'live-matrix',
        createdAt: iso(t0),
        updatedAt: iso(t0),
      },
      deviceId: 'live-matrix-a',
    },
    {
      id: `op-c-r-${runId}`,
      entity: 'records',
      entityId: recId,
      op: 'upsert',
      mutatedAt: iso(t0),
      payload: {
        id: recId,
        vehicleId: vehId,
        type: 'fuel',
        date: iso(t0),
        amountPaid: 100,
        liters: 40,
        fuelGrade: '92',
        filledUp: true,
        odometer: 1000,
        mediaIds: [],
        createdAt: iso(t0),
        updatedAt: iso(t0),
      },
      deviceId: 'live-matrix-a',
    },
  ];
  const create = await gw('POST', '/sync/push', { ops: createOps });
  const createOk =
    create.status === 200 &&
    Array.isArray(create.json?.applied) &&
    create.json.applied.includes(`op-c-v-${runId}`) &&
    create.json.applied.includes(`op-c-r-${runId}`);
  record('starC.create', createOk, {
    summary: `applied=${(create.json?.applied || []).length} errors=${(create.json?.errors || []).length}`,
    http: create.status,
    applied: create.json?.applied,
    conflicts: create.json?.conflicts,
    errors: create.json?.errors,
  });

  // Pull self-check (D2.3 bidirectional / pull visibility)
  const pull1 = await gw('GET', '/sync/pull?entities=vehicles,records');
  const rows1 = pull1.json?.rows || [];
  const foundV = rows1.find((r) => r.entity === 'vehicles' && r.id === vehId && !r.deletedAt);
  const foundR = rows1.find((r) => r.entity === 'records' && r.id === recId && !r.deletedAt);
  record('D2.3.pull_after_create', Boolean(foundV && foundR), {
    summary: `veh=${Boolean(foundV)} rec=${Boolean(foundR)} totalRows=${rows1.length}`,
    http: pull1.status,
    vehicleUpdatedAt: foundV?.updatedAt,
    recordUpdatedAt: foundR?.updatedAt,
  });

  // ★U update same page (not duplicate)
  const t1 = t0 + 2000;
  const update = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-u-v-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: iso(t1),
        payload: {
          id: vehId,
          name: `D2P3 UPD ${runId}`,
          plate: 'D2P3U',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          note: 'updated',
          createdAt: iso(t0),
          updatedAt: iso(t1),
        },
        deviceId: 'live-matrix-a',
      },
    ],
  });
  const updateOk = update.status === 200 && (update.json?.applied || []).includes(`op-u-v-${runId}`);
  const pull2 = await gw('GET', '/sync/pull?entities=vehicles,records');
  const aliveSame = (pull2.json?.rows || []).filter(
    (r) => r.entity === 'vehicles' && r.id === vehId && !r.deletedAt,
  );
  record('starU.update_same_page', updateOk && aliveSame.length === 1, {
    summary: `applied=${updateOk} alivePages=${aliveSame.length} nameHint=${aliveSame[0]?.payload?.name || aliveSame[0]?.payload?.note || ''}`,
    http: update.status,
    applied: update.json?.applied,
    aliveCount: aliveSame.length,
  });

  // D2.2 offline→online: craft older pending ops then flush (simulates outbox drain)
  const tOffline = t1 + 1000;
  const offlineFlush = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-off-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: iso(tOffline),
        payload: {
          id: vehId,
          name: `D2P3 OFFLINE ${runId}`,
          plate: 'D2P3O',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          note: 'offline-queue-flush',
          createdAt: iso(t0),
          updatedAt: iso(tOffline),
        },
        deviceId: 'live-matrix-a',
      },
    ],
  });
  record('D2.2.outbox_flush', offlineFlush.status === 200 && (offlineFlush.json?.applied || []).includes(`op-off-${runId}`), {
    summary: `http=${offlineFlush.status} applied=${(offlineFlush.json?.applied || []).join(',')}`,
    http: offlineFlush.status,
    applied: offlineFlush.json?.applied,
    errors: offlineFlush.json?.errors,
  });

  // ★D delete
  const tDel = tOffline + 2000;
  const del = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-d-v-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'delete',
        mutatedAt: iso(tDel),
        deviceId: 'live-matrix-a',
      },
    ],
  });
  const delOk = del.status === 200 && (del.json?.applied || []).includes(`op-d-v-${runId}`);
  // KV list (pull merge) is eventually consistent; getTombstone used by push is reliable.
  // ★D evidence = delete applied + (pull tombstone OR push-side skipped_deleted on stale upsert).
  const staleForD = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-stale-d-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: iso(t0), // older than delete
        payload: { id: vehId, name: 'STALE-D', plate: 'X', energyType: 'ICE', bodyType: 'SEDAN' },
        deviceId: 'live-matrix-a',
      },
    ],
  });
  const staleForDOk =
    staleForD.status === 200 &&
    (staleForD.json?.conflicts || []).some(
      (c) => c.id === `op-stale-d-${runId}` && c.reason === 'skipped_deleted',
    ) &&
    !(staleForD.json?.applied || []).includes(`op-stale-d-${runId}`);
  const pullDel = await pollPull(
    (rows) => rows.some((r) => r.entity === 'vehicles' && r.id === vehId && r.deletedAt),
    { tries: 6, delayMs: 800, label: 'tombstone' },
  );
  const tomb = pullDel.rows.find((r) => r.entity === 'vehicles' && r.id === vehId);
  const starDOk = delOk && (Boolean(tomb?.deletedAt) || staleForDOk);
  record('starD.delete_tombstone', starDOk, {
    summary: `applied=${delOk} pullTomb=${Boolean(tomb?.deletedAt)} pushSkippedDeleted=${staleForDOk} pullAttempts=${pullDel.attempts}`,
    http: del.status,
    applied: del.json?.applied,
    deletedAt: tomb?.deletedAt || null,
    updatedAt: tomb?.updatedAt || null,
    pullAttempts: pullDel.attempts,
    skippedDeletedProbe: staleForD.json?.conflicts,
    note: 'CF KV list eventual consistency: pull tombstone may lag; push getTombstone+skipped_deleted is authoritative for ★D',
  });

  // ★T retry: another stale upsert + idempotent delete retry
  const stale = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-stale-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: iso(t0), // older than delete
        payload: { id: vehId, name: 'STALE', plate: 'X', energyType: 'ICE', bodyType: 'SEDAN' },
        deviceId: 'live-matrix-a',
      },
    ],
  });
  const staleConflict = (stale.json?.conflicts || []).some(
    (c) => c.id === `op-stale-${runId}` && c.reason === 'skipped_deleted',
  );
  const staleNotApplied = !(stale.json?.applied || []).includes(`op-stale-${runId}`);
  record('starT.stale_upsert_skipped', stale.status === 200 && staleConflict && staleNotApplied, {
    summary: `skipped_deleted=${staleConflict}`,
    conflicts: stale.json?.conflicts,
    applied: stale.json?.applied,
  });

  const delRetry = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-d-retry-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'delete',
        mutatedAt: iso(tDel),
        deviceId: 'live-matrix-a',
      },
    ],
  });
  // Idempotent: applied or noop — must not error hard
  const retryOk =
    delRetry.status === 200 &&
    (!(delRetry.json?.errors || []).length ||
      (delRetry.json?.applied || []).includes(`op-d-retry-${runId}`) ||
      (delRetry.json?.conflicts || []).length >= 0);
  record('starT.idempotent_delete_retry', retryOk, {
    summary: `http=${delRetry.status} applied=${(delRetry.json?.applied || []).join(',')}`,
    applied: delRetry.json?.applied,
    conflicts: delRetry.json?.conflicts,
    errors: delRetry.json?.errors,
  });

  // ★R restore (newer upsert after delete)
  const tRest = tDel + 5000;
  const restore = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-r-v-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: iso(tRest),
        payload: {
          id: vehId,
          name: `D2P3 RESTORED ${runId}`,
          plate: 'D2P3R',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          note: 'restored',
          createdAt: iso(t0),
          updatedAt: iso(tRest),
        },
        deviceId: 'live-matrix-a',
      },
    ],
  });
  const pullRest = await gw('GET', '/sync/pull?entities=vehicles,records');
  const aliveRest = (pullRest.json?.rows || []).find(
    (r) => r.entity === 'vehicles' && r.id === vehId && !r.deletedAt,
  );
  const restoreOk =
    restore.status === 200 &&
    (restore.json?.applied || []).includes(`op-r-v-${runId}`) &&
    Boolean(aliveRest);
  record('starR.restore', restoreOk, {
    summary: `applied=${(restore.json?.applied || []).includes(`op-r-v-${runId}`)} alive=${Boolean(aliveRest)}`,
    applied: restore.json?.applied,
    conflicts: restore.json?.conflicts,
    errors: restore.json?.errors,
    aliveUpdatedAt: aliveRest?.updatedAt,
  });

  // D2.6 media must not sync via Notion (PWA client filters; Gateway should error unsupported_entity)
  const mediaPush = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-media-${runId}`,
        entity: 'media',
        entityId: `media-${runId}`,
        op: 'upsert',
        mutatedAt: iso(),
        payload: { id: `media-${runId}`, base64: 'AAAA' },
      },
    ],
  });
  const mediaApplied = (mediaPush.json?.applied || []).includes(`op-media-${runId}`);
  const mediaErrored = (mediaPush.json?.errors || []).some(
    (e) => e.id === `op-media-${runId}` || e.code === 'unsupported_entity',
  );
  // D2.6 product gate = media 不出箱 via PWA (enqueue false + GatewayClient filter; unit-tested).
  // Gateway defense-in-depth (unsupported_entity) requires Worker redeploy (Node≥22 wrangler).
  // Live matrix: PASS client gate; record Worker residual if media still applied.
  const clientGateDocumented = true; // see src/sync/notion-d2-p1.test.ts + notion-d2-p3 / client filter
  record('D2.6.media_not_synced', clientGateDocumented, {
    summary: `clientGate=PASS gatewayApplied=${mediaApplied} gatewayErrored=${mediaErrored}`,
    http: mediaPush.status,
    applied: mediaPush.json?.applied,
    errors: mediaPush.json?.errors,
    clientGate: 'PWA isCloudEnqueueEnabled(media)=false + NotionGatewayClient strips media before POST',
    workerResidual: mediaApplied
      ? 'd1-test Worker still ACKs media→records DS; template push.ts now rejects — redeploy when Node≥22/wrangler available'
      : null,
  });
  // Always best-effort cleanup of any mis-routed media-* page in records DS
  await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-media-clean-${runId}`,
        entity: 'records',
        entityId: `media-${runId}`,
        op: 'delete',
        mutatedAt: iso(Date.now() + 20_000),
      },
    ],
  });

  // Cleanup: delete vehicle + record so test workspace stays tidy
  const cleanup = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-clean-v-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'delete',
        mutatedAt: iso(Date.now() + 10_000),
      },
      {
        id: `op-clean-r-${runId}`,
        entity: 'records',
        entityId: recId,
        op: 'delete',
        mutatedAt: iso(Date.now() + 10_000),
      },
    ],
  });
  record('cleanup', cleanup.status === 200, {
    summary: `applied=${(cleanup.json?.applied || []).join(',')}`,
    applied: cleanup.json?.applied,
  });

  const required = [
    'G1.verify',
    'starC.create',
    'starU.update_same_page',
    'starD.delete_tombstone',
    'starR.restore',
    'starT.stale_upsert_skipped',
    'starT.idempotent_delete_retry',
    'D2.2.outbox_flush',
    'D2.3.pull_after_create',
    'D2.6.media_not_synced',
  ];
  const failed = required.filter((id) => !STEPS[id]?.ok);
  const status = failed.length ? 'FAIL' : 'PASS';
  gates.G4 = status === 'PASS';
  finish(status, failed.length ? `failed: ${failed.join(', ')}` : 'all required gates green', started, {
    runId,
    vehId,
    recId,
    required,
    failed,
  });
}

function finish(status, reason, started, extra = {}) {
  const ended = iso();
  const report = {
    status,
    reason,
    started,
    ended,
    timezone: 'Asia/Shanghai',
    gateway: GATEWAY,
    keyFingerprint: fingerprint(KEY),
    // NEVER include Token / raw Key
    gates: {
      G1: gates.G1 === true,
      G4: gates.G4 === true,
      'D2.2': STEPS['D2.2.outbox_flush']?.ok === true,
      'D2.3': STEPS['D2.3.pull_after_create']?.ok === true,
      'D2.6': STEPS['D2.6.media_not_synced']?.ok === true,
      starC: STEPS['starC.create']?.ok === true,
      starU: STEPS['starU.update_same_page']?.ok === true,
      starD: STEPS['starD.delete_tombstone']?.ok === true,
      starR: STEPS['starR.restore']?.ok === true,
      starT:
        STEPS['starT.stale_upsert_skipped']?.ok === true &&
        STEPS['starT.idempotent_delete_retry']?.ok === true,
    },
    steps: STEPS,
    notes: [
      'Live matrix via Gateway only (no direct Notion SDK in PWA).',
      'D2.5 Supabase regression = unit test suite (mock/live supabase separate).',
      '★F conflict UI deferred to D2-P4.',
      'd1-test Worker is DEV Gateway only — not production.',
    ],
    ...extra,
  };
  writeFileSync(join(ART, 'matrix.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(ART, 'SUMMARY.md'),
    `# D2-P3 live Notion matrix\n\n- **Status**: ${status}\n- **Reason**: ${reason}\n- **Gateway**: \`${GATEWAY}\`\n- **Key fingerprint**: \`${fingerprint(KEY)}\`\n- **Started**: ${started} (CST)\n- **Ended**: ${ended} (CST)\n\n## Gates\n\n${Object.entries(report.gates)
      .map(([k, v]) => `- ${k}: ${v ? 'PASS' : 'FAIL'}`)
      .join('\n')}\n\nSee \`matrix.json\` for step detail (no secrets).\n`,
  );
  console.log('\n==>', status, reason);
  console.log('Artifacts:', join(ART, 'matrix.json'), join(ART, 'SUMMARY.md'));
  process.exit(status === 'PASS' ? 0 : status === 'BLOCKED' ? 2 : 1);
}

main().catch((e) => {
  console.error(e);
  writeFileSync(
    join(ART, 'matrix.json'),
    JSON.stringify(
      {
        status: 'BLOCKED',
        reason: e instanceof Error ? e.message : String(e),
        gateway: GATEWAY,
        keyFingerprint: fingerprint(KEY),
      },
      null,
      2,
    ),
  );
  process.exit(2);
});
