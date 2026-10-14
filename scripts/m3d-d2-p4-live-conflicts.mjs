/**
 * D2-P4 live ★F + D2.6 hard-gate probe against d1-test Gateway.
 * Secrets: GATEWAY_API_KEY file/env; NEVER log raw key or NOTION_TOKEN.
 * Artifacts: artifacts/live-notion-p4/ (fingerprints only).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ART = join(ROOT, 'artifacts', 'live-notion-p4');
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

async function main() {
  const started = iso();
  const runId = `d2p4-${Date.now()}`;
  if (!KEY) {
    writeFileSync(
      join(ART, 'matrix.json'),
      JSON.stringify({ status: 'BLOCKED', reason: 'GATEWAY_API_KEY missing', gateway: GATEWAY, started }, null, 2),
    );
    console.error('BLOCKED missing key');
    process.exit(2);
  }

  console.log('Gateway', GATEWAY, 'keyFp', fingerprint(KEY));

  // G1
  const health = await gw('GET', '/health');
  record('G1.health', health.status === 200 && health.json?.ok === true, {
    summary: `http=${health.status} version=${health.json?.version}`,
    http: health.status,
    version: health.json?.version,
  });
  const verify = await gw('GET', '/verify');
  const wk = verify.json?.workspaceKey;
  record('G1.verify', verify.status === 200 && verify.json?.ok === true && !!wk, {
    summary: `http=${verify.status} wk=${fingerprint(wk)} bot=${verify.json?.botName}`,
    http: verify.status,
    workspaceKeyFingerprint: fingerprint(wk),
    botName: verify.json?.botName,
  });

  // D2.6 hard gate — media / stations / settings must error unsupported_entity, never applied
  const rejectEntities = ['media', 'stations', 'settings'];
  let d26Ok = true;
  for (const entity of rejectEntities) {
    const id = `op-${entity}-${runId}`;
    const entityId = entity === 'settings' ? `theme-${runId}` : `${entity}-${runId}`;
    const push = await gw('POST', '/sync/push', {
      ops: [
        {
          id,
          entity,
          entityId,
          op: 'upsert',
          mutatedAt: iso(),
          payload: { id: entityId, name: 'reject-probe' },
        },
      ],
    });
    const applied = (push.json?.applied || []).includes(id);
    const errored = (push.json?.errors || []).some(
      (e) => (e.id === id || e.entity === entity) && e.code === 'unsupported_entity',
    );
    const ok = !applied && errored && push.status === 200;
    d26Ok = d26Ok && ok;
    record(`D2.6.reject_${entity}`, ok, {
      summary: `applied=${applied} unsupported=${errored}`,
      http: push.status,
      applied: push.json?.applied,
      errors: push.json?.errors,
    });
  }

  // ★F: create entity, then push older mutatedAt → cloud_newer
  const vehId = `veh-f-${runId}`;
  const baseAt = iso();
  const create = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-c-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: baseAt,
        payload: {
          id: vehId,
          name: 'P4-Cloud',
          plate: 'F4',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          updatedAt: baseAt,
        },
        deviceId: 'live-p4-a',
      },
    ],
  });
  record('starF.seed_cloud', (create.json?.applied || []).includes(`op-c-${runId}`), {
    summary: `applied=${(create.json?.applied || []).includes(`op-c-${runId}`)}`,
    http: create.status,
    applied: create.json?.applied,
    conflicts: create.json?.conflicts,
  });

  // Bump cloud further so stale local cannot win LWW
  const newerAt = iso(Date.now() + 2000);
  const bump = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-bump-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: newerAt,
        payload: {
          id: vehId,
          name: 'P4-Cloud-Newer',
          plate: 'F4',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          updatedAt: newerAt,
        },
        deviceId: 'live-p4-b',
      },
    ],
  });
  record('starF.bump_cloud', (bump.json?.applied || []).includes(`op-bump-${runId}`), {
    summary: `applied=${(bump.json?.applied || []).includes(`op-bump-${runId}`)}`,
    http: bump.status,
    applied: bump.json?.applied,
  });

  const staleAt = iso(Date.now() - 60_000);
  const stale = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-stale-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: staleAt,
        payload: {
          id: vehId,
          name: 'P4-Local-Stale',
          plate: 'F4',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          updatedAt: staleAt,
        },
        deviceId: 'live-p4-a',
      },
    ],
  });
  const conflict = (stale.json?.conflicts || []).find(
    (c) => (c.id === `op-stale-${runId}` || c.opId === `op-stale-${runId}`) && c.reason === 'cloud_newer',
  );
  const notApplied = !(stale.json?.applied || []).includes(`op-stale-${runId}`);
  record('starF.cloud_newer', Boolean(conflict) && notApplied, {
    summary: `cloud_newer=${Boolean(conflict)} notApplied=${notApplied}`,
    http: stale.status,
    applied: stale.json?.applied,
    conflicts: stale.json?.conflicts,
    cloudRowId: conflict?.cloudRow?.id,
    cloudUpdatedAt: conflict?.cloudRow?.updatedAt,
  });

  // keep_local simulation: bump mutatedAt past cloud → applied
  const keepAt = iso(Date.now() + 5000);
  const keep = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-keep-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: keepAt,
        payload: {
          id: vehId,
          name: 'P4-Keep-Local',
          plate: 'F4',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          updatedAt: keepAt,
        },
        deviceId: 'live-p4-a',
      },
    ],
  });
  record('starF.keep_local_lww', (keep.json?.applied || []).includes(`op-keep-${runId}`), {
    summary: `applied=${(keep.json?.applied || []).includes(`op-keep-${runId}`)}`,
    http: keep.status,
    applied: keep.json?.applied,
    conflicts: keep.json?.conflicts,
  });

  // take_cloud simulation: pull shows keep-local name, then we "take" by pushing cloud-side older? 
  // For live Gateway ★F we prove cloud_newer conflict shape + keep_local LWW win.
  // Full M3-C UI take_cloud is unit-covered (notion-d2-p4.test.ts).

  // Cleanup: delete test vehicle
  const delAt = iso(Date.now() + 8000);
  const del = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-del-${runId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'delete',
        mutatedAt: delAt,
      },
    ],
  });
  record('starF.cleanup_delete', (del.json?.applied || []).includes(`op-del-${runId}`), {
    summary: `applied=${(del.json?.applied || []).includes(`op-del-${runId}`)}`,
    http: del.status,
    applied: del.json?.applied,
  });

  const gates = {
    G1: STEPS['G1.health']?.ok && STEPS['G1.verify']?.ok,
    'D2.6': d26Ok,
    starF: STEPS['starF.cloud_newer']?.ok && STEPS['starF.keep_local_lww']?.ok,
  };
  const status = gates.G1 && gates['D2.6'] && gates.starF ? 'PASS' : 'FAIL';
  const ended = iso();
  const matrix = {
    status,
    reason: status === 'PASS' ? 'D2.6 live reject + ★F cloud_newer/keep_local LWW' : 'see steps',
    started,
    ended,
    timezone: 'Asia/Shanghai',
    gateway: GATEWAY,
    keyFingerprint: fingerprint(KEY),
    workspaceKeyFingerprint: fingerprint(wk),
    gates,
    d26LiveStatus: d26Ok ? 'PASS' : 'FAIL',
    d26WorkerProbeOk: d26Ok,
    steps: STEPS,
    notes: [
      'D2.6: Worker redeployed with unsupported_entity whitelist (media/stations/settings).',
      '★F: Gateway returns cloud_newer (non-ACK); keep_local path proven via LWW bump applied.',
      'M3-C open/keep_local/take_cloud lock-held UX covered by unit notion-d2-p4.test.ts.',
      'd1-test is DEV only — not production Gateway. No PWA deploy.',
    ],
  };
  writeFileSync(join(ART, 'matrix.json'), JSON.stringify(matrix, null, 2));

  const summary =
    `# D2-P4 live Notion ★F + D2.6\n\n` +
    `- **Status**: ${status}\n` +
    `- **Gateway**: \`${GATEWAY}\` (dev \`*-d1-test\` only — not production)\n` +
    `- **Key fingerprint**: \`${fingerprint(KEY)}\` (sha256-12)\n` +
    `- **Started**: ${started} → **Ended**: ${ended} (UTC; box CST=UTC+8)\n\n` +
    `## Gates\n\n` +
    `| Gate | Result |\n|------|--------|\n` +
    `| G1 verify | ${gates.G1 ? 'PASS' : 'FAIL'} |\n` +
    `| D2.6 media/stations/settings reject | ${gates['D2.6'] ? 'PASS' : 'FAIL'} |\n` +
    `| ★F cloud_newer + keep_local LWW | ${gates.starF ? 'PASS' : 'FAIL'} |\n\n` +
    `## Notes\n\n` +
    matrix.notes.map((n) => `- ${n}`).join('\n') +
    `\n\nSee \`matrix.json\` (**no secrets**).\n`;
  writeFileSync(join(ART, 'SUMMARY.md'), summary);
  console.log('\n===', status, '===');
  console.log(summary);
  process.exit(status === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
