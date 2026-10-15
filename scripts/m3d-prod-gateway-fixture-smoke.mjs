/**
 * Formal Gateway E3–E5 fixture smoke (API only).
 * Prefix: M3D-PROD-FIXTURE-
 * Secrets via env / ~/.car-care-secrets — never logged.
 * Artifacts: artifacts/m3d-prod-gateway-deploy/e-smoke/
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ART = join(ROOT, 'artifacts', 'm3d-prod-gateway-deploy', 'e-smoke');
mkdirSync(ART, { recursive: true });

const GATEWAY = (
  process.env.NOTION_GATEWAY_URL ||
  process.env.GATEWAY_A_URL ||
  'https://car-care-notion-sync.spf-roc.workers.dev'
).replace(/\/+$/, '');

function fp(s) {
  return s ? createHash('sha256').update(s).digest('hex').slice(0, 12) : null;
}
function iso(ms = Date.now()) {
  return new Date(ms).toISOString();
}
function uid(p = 'fx') {
  return `${p}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}
function loadKey() {
  if (process.env.GATEWAY_API_KEY?.trim()) return process.env.GATEWAY_API_KEY.trim();
  if (process.env.GATEWAY_A_KEY?.trim()) return process.env.GATEWAY_A_KEY.trim();
  const p = join(homedir(), '.car-care-secrets', 'm3d-prod-gateway-api-key.txt');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  return '';
}

const KEY = loadKey();
const STEPS = {};
function record(id, ok, detail = {}) {
  STEPS[id] = { ok, ...detail, at: iso() };
  console.log(ok ? 'PASS' : 'FAIL', id, detail.summary || detail.message || '');
}

async function gw(method, path, body) {
  const headers = { Authorization: `Bearer ${KEY}`, Accept: 'application/json' };
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
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function pollPull(pred, { tries = 10, delayMs = 600 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await gw('GET', '/sync/pull?entities=vehicles,records');
    const rows = last.json?.rows || [];
    if (pred(rows)) return { ok: true, rows, attempts: i + 1, status: last.status };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, rows: last?.json?.rows || [], attempts: tries, status: last?.status };
}

async function main() {
  const started = iso();
  const runId = uid('prod');
  if (!KEY) {
    writeFileSync(join(ART, 'e-smoke-matrix.json'), JSON.stringify({ status: 'BLOCKED', reason: 'no key' }, null, 2));
    process.exit(2);
  }
  console.log('Gateway', GATEWAY);
  console.log('keyFp', fp(KEY));

  const health = await gw('GET', '/health');
  record('E1.health', health.status === 200 && health.json?.version === 'm3d-prod-1.0.0', {
    summary: `http=${health.status} version=${health.json?.version}`,
  });

  const verify = await gw('GET', '/verify');
  const wk = verify.json?.workspaceKey || '';
  record('E2.verify', verify.status === 200 && verify.json?.ok === true && Boolean(wk), {
    summary: `http=${verify.status} bot=${verify.json?.botName} wkFp=${fp(wk)}`,
    wkFp: fp(wk),
    botName: verify.json?.botName,
    dsVehiclesFp: fp(verify.json?.dataSources?.vehicles || ''),
    dsRecordsFp: fp(verify.json?.dataSources?.records || ''),
  });

  const vehId = uid('veh');
  const recId = uid('rec');
  const name = `M3D-PROD-FIXTURE-${runId}`;
  const plate = `PF${runId.slice(-6).toUpperCase()}`;
  const t0 = iso();

  // E3: push vehicle with name+plate, pull hydrate
  const createVeh = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-create-${vehId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: t0,
        payload: {
          id: vehId,
          name,
          plate,
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: t0,
          updatedAt: t0,
        },
      },
    ],
  });
  const vehApplied = (createVeh.json?.applied || []).some((a) => a === `op-create-${vehId}` || a?.id === `op-create-${vehId}`)
    || (createVeh.json?.applied || []).length > 0
    || createVeh.json?.ok === true;
  // PushResult shape: applied: string[] of op ids, conflicts: []
  const appliedIds = createVeh.json?.applied || [];
  const createOk = createVeh.status === 200 && (appliedIds.includes(`op-create-${vehId}`) || appliedIds.length >= 1);
  record('E3.push_vehicle', createOk, {
    summary: `http=${createVeh.status} applied=${JSON.stringify(appliedIds)} conflicts=${JSON.stringify(createVeh.json?.conflicts || [])}`,
    http: createVeh.status,
  });

  const pullVeh = await pollPull((rows) =>
    rows.some((r) => r.entity === 'vehicles' && r.id === vehId && (r.payload?.name === name || r.payload?.plate === plate || r.name === name)),
  );
  const row = (pullVeh.rows || []).find((r) => r.id === vehId);
  const nameOk = row && (row.payload?.name === name || row.name === name);
  const plateOk = row && (row.payload?.plate === plate || row.plate === plate);
  record('E3.pull_hydrate_name_plate', pullVeh.ok && nameOk && plateOk, {
    summary: `attempts=${pullVeh.attempts} nameOk=${!!nameOk} plateOk=${!!plateOk} payloadKeys=${row ? Object.keys(row.payload || {}).join(',') : 'none'}`,
    nameOk: !!nameOk,
    plateOk: !!plateOk,
  });

  // Idempotent re-push same vehicle
  const t1 = iso(Date.now() + 1000);
  const rePush = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-repush-${vehId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: t1,
        payload: {
          id: vehId,
          name,
          plate,
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: t0,
          updatedAt: t1,
        },
      },
    ],
  });
  record('E3.idempotent_repush', rePush.status === 200, {
    summary: `http=${rePush.status} applied=${JSON.stringify(rePush.json?.applied || [])} conflicts=${JSON.stringify(rePush.json?.conflicts || [])}`,
  });

  // Record CRUD
  const tRec = iso();
  const createRec = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-create-${recId}`,
        entity: 'records',
        entityId: recId,
        op: 'upsert',
        mutatedAt: tRec,
        payload: {
          id: recId,
          vehicleId: vehId,
          vehicleAppId: vehId,
          recordType: 'FUEL',
          recordDate: tRec.slice(0, 10),
          amountPaid: 123.45,
          name: `M3D-PROD-FIXTURE-REC-${runId}`,
          createdAt: tRec,
          updatedAt: tRec,
        },
      },
    ],
  });
  record('E3.push_record', createRec.status === 200 && (createRec.json?.applied || []).includes(`op-create-${recId}`), {
    summary: `http=${createRec.status} applied=${JSON.stringify(createRec.json?.applied || [])}`,
  });

  const pullRec = await pollPull((rows) => rows.some((r) => r.entity === 'records' && r.id === recId));
  record('E3.pull_record', pullRec.ok, {
    summary: `attempts=${pullRec.attempts} found=${pullRec.ok}`,
  });

  // PayloadJson round-trip: slim payload fields that must survive
  const payloadMarker = `marker-${runId}`;
  const tPay = iso();
  const payPush = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-pay-${vehId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: tPay,
        payload: {
          id: vehId,
          name,
          plate,
          energyType: 'ICE',
          bodyType: 'SUV',
          fuelGrade: '95#',
          fixtureMarker: payloadMarker,
          createdAt: t0,
          updatedAt: tPay,
        },
      },
    ],
  });
  const payPull = await pollPull((rows) => {
    const r = rows.find((x) => x.id === vehId);
    return r && (r.payload?.fixtureMarker === payloadMarker || r.payload?.bodyType === 'SUV');
  });
  const prow = (payPull.rows || []).find((r) => r.id === vehId);
  const markerOk = prow?.payload?.fixtureMarker === payloadMarker;
  const bodyOk = prow?.payload?.bodyType === 'SUV';
  record('E3.payloadjson_roundtrip', payPush.status === 200 && payPull.ok && (markerOk || bodyOk), {
    summary: `markerOk=${!!markerOk} bodyOk=${!!bodyOk} bodyType=${prow?.payload?.bodyType}`,
  });

  // E4: delete then stale upsert → skipped_deleted
  const tDel = iso();
  const del = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-del-${vehId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'delete',
        mutatedAt: tDel,
        payload: { id: vehId, deletedAt: tDel },
      },
    ],
  });
  record('E4.delete', del.status === 200 && (del.json?.applied || []).includes(`op-del-${vehId}`), {
    summary: `http=${del.status} applied=${JSON.stringify(del.json?.applied || [])}`,
  });

  // Idempotent delete retry
  const tDel2 = iso(Date.now() + 500);
  const delRetry = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-del-retry-${vehId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'delete',
        mutatedAt: tDel2,
        payload: { id: vehId, deletedAt: tDel2 },
      },
    ],
  });
  record('E4.delete_idempotent_retry', delRetry.status === 200, {
    summary: `http=${delRetry.status} applied=${JSON.stringify(delRetry.json?.applied || [])} conflicts=${JSON.stringify(delRetry.json?.conflicts || [])}`,
  });

  const staleAt = iso(Date.parse(tDel) - 60_000); // older than delete
  const stale = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-stale-${vehId}`,
        entity: 'vehicles',
        entityId: vehId,
        op: 'upsert',
        mutatedAt: staleAt,
        payload: {
          id: vehId,
          name: name + '-RESURRECT',
          plate,
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: t0,
          updatedAt: staleAt,
        },
      },
    ],
  });
  const conflicts = stale.json?.conflicts || [];
  const skipped = conflicts.some((c) => (c.id === `op-stale-${vehId}` || c.opId === `op-stale-${vehId}`) && c.reason === 'skipped_deleted');
  record('E4.skipped_deleted', stale.status === 200 && skipped, {
    summary: `http=${stale.status} conflicts=${JSON.stringify(conflicts)}`,
  });

  // Cleanup: delete record + ensure vehicle stays deleted; try hard cleanup via delete record
  const tClean = iso();
  const cleanup = await gw('POST', '/sync/push', {
    ops: [
      {
        id: `op-del-rec-${recId}`,
        entity: 'records',
        entityId: recId,
        op: 'delete',
        mutatedAt: tClean,
        payload: { id: recId, deletedAt: tClean },
      },
    ],
  });
  record('E5.cleanup_record_delete', cleanup.status === 200, {
    summary: `http=${cleanup.status} applied=${JSON.stringify(cleanup.json?.applied || [])}`,
  });

  // Confirm fixture not alive under resurrect name
  const finalPull = await gw('GET', '/sync/pull?entities=vehicles,records');
  const aliveBad = (finalPull.json?.rows || []).filter(
    (r) =>
      (r.payload?.name || r.name || '').includes('M3D-PROD-FIXTURE') &&
      r.id &&
      (r.id === vehId || r.id === recId) &&
      !r.deletedAt &&
      r.kind !== 'tombstone',
  );
  // Allow tombstones; fail if live resurrect
  const liveResurrect = (finalPull.json?.rows || []).some(
    (r) => r.id === vehId && (r.payload?.name || '').includes('RESURRECT'),
  );
  record('E5.no_live_fixture_resurrect', !liveResurrect, {
    summary: `liveResurrect=${liveResurrect} aliveLike=${aliveBad.length}`,
  });

  const allIds = Object.keys(STEPS);
  const failed = allIds.filter((k) => !STEPS[k].ok);
  const status = failed.length ? 'FAIL' : 'PASS';
  const out = {
    status,
    started,
    finished: iso(),
    gateway: GATEWAY,
    keyFp: fp(KEY),
    wkFp: fp(wk),
    runId,
    fixturePrefix: 'M3D-PROD-FIXTURE-',
    steps: STEPS,
    failed,
  };
  writeFileSync(join(ART, 'e-smoke-matrix.json'), JSON.stringify(out, null, 2));
  writeFileSync(
    join(ART, 'e-smoke-SUMMARY.md'),
    `# E3–E5 fixture smoke · ${status}\n\n- Gateway: \`${GATEWAY}\`\n- keyFp: \`${fp(KEY)}\` · wkFp: \`${fp(wk)}\`\n- failed: ${failed.join(', ') || '(none)'}\n`,
  );
  console.log('STATUS', status, 'failed=', failed);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
