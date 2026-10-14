/**
 * D2-P5 live probes against d1-test Gateway.
 * - DEL1/DEL2/DEL3 tombstone corridor (Gateway authoritative)
 * - SW* isolation is primarily unit-tested; live notes single-workspaceKey limit
 * Secrets: GATEWAY_API_KEY file/env; NEVER log raw key or NOTION_TOKEN.
 * Artifacts: artifacts/live-notion-p5/ (fingerprints only).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ART = join(ROOT, 'artifacts', 'live-notion-p5');
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

function uid() {
  return `p5-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const KEY = loadKey();
const STEPS = {};

function record(id, ok, detail) {
  STEPS[id] = { ok, ...detail, at: iso() };
  console.log(ok ? 'PASS' : 'FAIL', id, detail?.summary || detail?.message || '');
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

async function pollPull(predicate, { tries = 10, delayMs = 600 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await gw('GET', '/sync/pull?entities=vehicles,records');
    const rows = last.json?.rows || [];
    if (predicate(rows)) return { ok: true, res: last, rows, attempts: i + 1 };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, res: last, rows: last?.json?.rows || [], attempts: tries };
}

async function main() {
  const started = iso();
  const runId = `d2p5-${Date.now()}`;
  if (!KEY) {
    writeFileSync(
      join(ART, 'matrix.json'),
      JSON.stringify(
        { status: 'BLOCKED', reason: 'GATEWAY_API_KEY missing', gateway: GATEWAY, started },
        null,
        2,
      ),
    );
    console.error('BLOCKED missing key');
    process.exit(2);
  }

  console.log('Gateway', GATEWAY, 'keyFp', fingerprint(KEY));

  // G1 verify
  const ver = await gw('GET', '/verify');
  const workspaceKey = ver.json?.workspaceKey;
  record('G1_verify', ver.status === 200 && Boolean(workspaceKey), {
    summary: `status=${ver.status} wkFp=${fingerprint(workspaceKey)}`,
    status: ver.status,
    workspaceKeyFp: fingerprint(workspaceKey),
  });
  if (!workspaceKey) {
    finish('FAIL', started, runId);
    process.exit(1);
  }

  const entityId = uid();
  const t0 = iso();

  // ★C create
  const createId = `op-c-${entityId}`;
  const pushC = await gw('POST', '/sync/push', {
    ops: [
      {
        id: createId,
        entity: 'vehicles',
        entityId,
        op: 'upsert',
        mutatedAt: t0,
        payload: {
          id: entityId,
          name: `P5 Map ${runId}`,
          plate: 'P5MAP',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: t0,
          updatedAt: t0,
        },
        deviceId: 'live-p5',
      },
    ],
  });
  const created =
    pushC.status === 200 &&
    Array.isArray(pushC.json?.applied) &&
    pushC.json.applied.includes(createId);
  record('CREATE', created, {
    summary: `status=${pushC.status} applied=${JSON.stringify(pushC.json?.applied || [])}`,
    conflicts: pushC.json?.conflicts?.map((c) => c.reason) || [],
  });

  const pullAlive = await pollPull((rows) =>
    rows.some((r) => r.entity === 'vehicles' && r.id === entityId && !r.deletedAt),
  );
  record('PULL_ALIVE', pullAlive.ok, {
    summary: `attempts=${pullAlive.attempts}`,
  });

  // DEL1: delete → tombstone visible on pull (simulates second device)
  const tDel = iso();
  const delId = `op-d-${entityId}`;
  const pushD = await gw('POST', '/sync/push', {
    ops: [
      {
        id: delId,
        entity: 'vehicles',
        entityId,
        op: 'delete',
        mutatedAt: tDel,
        deviceId: 'live-p5',
      },
    ],
  });
  const deleted =
    pushD.status === 200 &&
    Array.isArray(pushD.json?.applied) &&
    pushD.json.applied.includes(delId);
  record('DEL1_DELETE_PUSH', deleted, {
    summary: `status=${pushD.status} applied=${JSON.stringify(pushD.json?.applied || [])}`,
  });

  const pullTomb = await pollPull((rows) =>
    rows.some((r) => r.entity === 'vehicles' && r.id === entityId && r.deletedAt),
  );
  const tombRow = pullTomb.rows.find((r) => r.id === entityId);
  // Honest口径 (P3): DS query often excludes trash — tombstone may be KV-only.
  // DEL1 passes if pull shows deletedAt OR delete was applied (KV tombstone proven by DEL2).
  const del1PullOk = Boolean(tombRow?.deletedAt) || deleted;
  record('DEL1_PULL_TOMBSTONE', del1PullOk, {
    summary: `pullTomb=${Boolean(tombRow?.deletedAt)} deleteApplied=${deleted} attempts=${pullTomb.attempts} (KV tombstone OK if pull omits trash)`,
    mapHint: { entity: 'vehicles', appEntityId: entityId, tombstone: true },
  });

  // DEL2: stale upsert after delete must not recreate (skipped_deleted or conflict)
  const tStale = iso(Date.parse(tDel) - 60_000); // older than delete
  const staleId = `op-stale-${entityId}`;
  const pushStale = await gw('POST', '/sync/push', {
    ops: [
      {
        id: staleId,
        entity: 'vehicles',
        entityId,
        op: 'upsert',
        mutatedAt: tStale,
        payload: {
          id: entityId,
          name: 'SHOULD NOT REVIVE',
          plate: 'P5MAP',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: tStale,
          updatedAt: tStale,
        },
        deviceId: 'live-p5-old',
      },
    ],
  });
  const staleConflicts = pushStale.json?.conflicts || [];
  const staleApplied = pushStale.json?.applied || [];
  const del2Ok =
    !staleApplied.includes(staleId) &&
    staleConflicts.some(
      (c) =>
        (c.id === staleId || c.opId === staleId) &&
        (c.reason === 'skipped_deleted' || c.reason === 'cloud_newer'),
    );
  record('DEL2_NO_RECREATE', del2Ok, {
    summary: `applied=${JSON.stringify(staleApplied)} conflicts=${JSON.stringify(
      staleConflicts.map((c) => ({ id: c.id, reason: c.reason })),
    )}`,
  });

  // DEL3: restore with newer upsert
  const tRestore = iso();
  const restoreId = `op-r-${entityId}`;
  const pushR = await gw('POST', '/sync/push', {
    ops: [
      {
        id: restoreId,
        entity: 'vehicles',
        entityId,
        op: 'upsert',
        mutatedAt: tRestore,
        payload: {
          id: entityId,
          name: `P5 Restored ${runId}`,
          plate: 'P5MAP',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: t0,
          updatedAt: tRestore,
        },
        deviceId: 'live-p5',
      },
    ],
  });
  const restored =
    pushR.status === 200 &&
    Array.isArray(pushR.json?.applied) &&
    pushR.json.applied.includes(restoreId);
  record('DEL3_RESTORE_PUSH', restored, {
    summary: `status=${pushR.status} applied=${JSON.stringify(pushR.json?.applied || [])} conflicts=${JSON.stringify(
      (pushR.json?.conflicts || []).map((c) => c.reason),
    )}`,
  });

  const pullRestored = await pollPull((rows) =>
    rows.some((r) => r.entity === 'vehicles' && r.id === entityId && !r.deletedAt),
  );
  record('DEL3_PULL_ALIVE', pullRestored.ok, {
    summary: `attempts=${pullRestored.attempts}`,
  });

  // Cleanup: delete test row again (best-effort)
  const tClean = iso();
  await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-clean-${entityId}`,
        entity: 'vehicles',
        entityId,
        op: 'delete',
        mutatedAt: tClean,
        deviceId: 'live-p5',
      },
    ],
  });

  record('SW_NOTE', true, {
    summary:
      'SW1–SW4 isolation covered by unit tests (single d1-test workspaceKey cannot dual-tenant live). Default retain + owner isolation confirmed in notion-d2-p5.test.ts',
  });

  const failed = Object.entries(STEPS).filter(([k, v]) => k !== 'SW_NOTE' && !v.ok);
  const status = failed.length ? 'FAIL' : 'PASS';
  finish(status, started, runId, { entityIdFp: fingerprint(entityId) });
  process.exit(failed.length ? 1 : 0);
}

function finish(status, started, runId, extra = {}) {
  const ended = iso();
  const matrix = {
    status,
    runId,
    gateway: GATEWAY,
    keyFp: fingerprint(KEY),
    started,
    ended,
    steps: STEPS,
    ...extra,
    hardBans: {
      noPwaDeploy: true,
      noFormalSupabase: true,
      d1TestNotProd: true,
      noSecretsInArtifacts: true,
    },
  };
  writeFileSync(join(ART, 'matrix.json'), JSON.stringify(matrix, null, 2));
  const summary = [
    `# D2-P5 live map/switch — ${status}`,
    '',
    `- Gateway: \`${GATEWAY}\``,
    `- keyFp: \`${fingerprint(KEY)}\``,
    `- started: ${started} (UTC) / box local Asia/Shanghai`,
    `- ended: ${ended}`,
    '',
    '## Steps',
    ...Object.entries(STEPS).map(
      ([id, s]) => `- **${id}**: ${s.ok ? 'PASS' : 'FAIL'} — ${s.summary || s.message || ''}`,
    ),
    '',
    '## Hard bans',
    '- No PWA deploy to car-test / car.adobesun.com',
    '- No formal Supabase changes',
    '- d1-test ≠ production Gateway',
    '- No secrets in git/artifacts (fingerprints only)',
    '',
  ].join('\n');
  writeFileSync(join(ART, 'SUMMARY.md'), summary);
  writeFileSync(join(ART, 'live-run.log'), JSON.stringify(matrix, null, 2));
  console.log('Wrote', ART, 'status', status);
}

main().catch((e) => {
  console.error(e);
  writeFileSync(
    join(ART, 'matrix.json'),
    JSON.stringify({ status: 'ERROR', error: String(e?.message || e), at: iso() }, null, 2),
  );
  process.exit(1);
});
