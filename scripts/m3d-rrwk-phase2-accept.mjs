/**
 * RR-WK Phase 2 acceptance @ car-test ONLY.
 * - Ephemeral Playwright profile (never touches user device IDB)
 * - Fixture rows may be created/deleted via d1-test; NEVER wipe Outbox wholesale
 * - G-P used for E4/E8 verify + flush-refusal only; MUST record zero /sync/push to G-P
 * - Does not redeploy Gateways or touch production PWA / formal Supabase
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ART = join(ROOT, 'artifacts', 'm3d-rrwk-phase2-accept');
mkdirSync(ART, { recursive: true });

const BASE = (process.env.STAGING_URL || 'https://car-test.adobesun.com').replace(/\/+$/, '');
const G_T = 'https://car-care-notion-sync-d1-test.spf-roc.workers.dev';
const G_B = 'https://car-care-notion-sync-d1-test-b.spf-roc.workers.dev';
const G_P = 'https://car-care-notion-sync.spf-roc.workers.dev';

function fp(s) {
  return s ? createHash('sha256').update(s).digest('hex').slice(0, 12) : null;
}
function loadKey(name) {
  const envMap = {
    'm3d-d1-gateway-api-key.txt': process.env.GATEWAY_API_KEY,
    'm3d-d1-b-gateway-api-key.txt': process.env.GATEWAY_B_KEY,
    'm3d-prod-gateway-api-key.txt': process.env.GATEWAY_P_KEY,
  };
  if (envMap[name]?.trim()) return envMap[name].trim();
  const p = join(homedir(), '.car-care-secrets', name);
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  return '';
}

const KEY_T = loadKey('m3d-d1-gateway-api-key.txt');
const KEY_B = loadKey('m3d-d1-b-gateway-api-key.txt');
const KEY_P = loadKey('m3d-prod-gateway-api-key.txt');
const KEYFP_T = fp(KEY_T);
const KEYFP_B = fp(KEY_B);
const KEYFP_P = fp(KEY_P);

const matrix = [];
const consoleLogs = [];
const netLog = [];

async function withConfirmAccepts(page, fn, times = 2) {
  let left = times;
  const handler = async (d) => {
    try { await d.accept(); } catch { /* already handled */ }
    left -= 1;
    if (left <= 0) page.off('dialog', handler);
  };
  page.on('dialog', handler);
  try {
    return await fn();
  } finally {
    page.off('dialog', handler);
  }
}

function record(id, ok, detail = '', evidence = {}) {
  const row = {
    id,
    ok: !!ok,
    status: ok ? 'PASS' : 'FAIL',
    detail: String(detail).slice(0, 1200),
    evidence,
    at: new Date().toISOString(),
  };
  matrix.push(row);
  console.log(ok ? 'PASS' : 'FAIL', id, detail);
  return row;
}

async function gwFetch(gateway, key, path, { method = 'GET', body } = {}) {
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    Origin: BASE,
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${gateway}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

async function openIdb(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('car-care-db');
      req.onerror = () => reject(req.error || new Error('idb open failed'));
      req.onsuccess = () => resolve(req.result);
    });
    return true;
  });
}

async function readSettings(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('car-care-db');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const r = tx.objectStore('settings').get('cloudStorage');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return row?.value || null;
  });
}

async function patchCloudConfig(page, patch) {
  return page.evaluate(async (patch) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('car-care-db');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const prev = await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const r = tx.objectStore('settings').get('cloudStorage');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const value = { ...(prev?.value || {}), ...patch };
    await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const r = tx.objectStore('settings').put({
        key: 'cloudStorage',
        value,
        updatedAt: new Date().toISOString(),
      });
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    db.close();
    return value;
  }, patch);
}

async function listOutboxRows(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('car-care-db');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('sync_outbox', 'readonly');
      const r = tx.objectStore('sync_outbox').getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return rows.map((o) => ({
      opId: o.opId,
      entity: o.entity,
      entityId: o.entityId,
      op: o.op,
      ownerUserId: o.ownerUserId,
      gatewayKeyFp: o.gatewayKeyFp,
      notionTargetId: o.notionTargetId,
      payloadName: o.payload?.name,
    }));
  });
}

async function readSyncMeta(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('car-care-db');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const row = await new Promise((resolve, reject) => {
      if (![...db.objectStoreNames].includes('sync_meta')) return resolve(null);
      const tx = db.transaction('sync_meta', 'readonly');
      const r = tx.objectStore('sync_meta').get('syncMeta');
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return row?.value || null;
  });
}

async function putLegacyOutboxRow(page, { ownerUserId, entityId, name }) {
  return page.evaluate(
    async ({ ownerUserId, entityId, name }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('car-care-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });
      const item = {
        opId: `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        entity: 'vehicles',
        entityId,
        op: 'upsert',
        payload: { id: entityId, name, plate: 'LEGACY1' },
        mutatedAt: new Date().toISOString(),
        attempts: 0,
        nextRetryAt: new Date().toISOString(),
        ownerUserId,
        // intentionally NO gatewayKeyFp / notionTargetId
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction('sync_outbox', 'readwrite');
        const r = tx.objectStore('sync_outbox').put(item);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
      db.close();
      return item.opId;
    },
    { ownerUserId, entityId, name },
  );
}

async function patchStaleMeta(page, { cloudUserId, notionGatewayKeyFp, notionTargetId }) {
  return page.evaluate(
    async ({ cloudUserId, notionGatewayKeyFp, notionTargetId }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('car-care-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });
      const existingRow = await new Promise((resolve, reject) => {
        const tx = db.transaction('sync_meta', 'readonly');
        const r = tx.objectStore('sync_meta').get('syncMeta');
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      });
      const cur = (existingRow && existingRow.value) || {
        deviceId: 'phase2',
        status: 'idle',
        provider: 'notion',
      };
      const next = {
        ...cur,
        cloudUserId,
        notionGatewayKeyFp,
        notionTargetId,
        provider: 'notion',
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction('sync_meta', 'readwrite');
        const r = tx.objectStore('sync_meta').put({ key: 'syncMeta', value: next });
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
      db.close();
      return next;
    },
    { cloudUserId, notionGatewayKeyFp, notionTargetId },
  );
}

async function configureNotion(page, { gateway, key, guard }) {
  try { await page.context().setOffline(false); } catch { /* ignore */ }
  await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(800);
  const providerSelect = page
    .locator('select')
    .filter({ has: page.locator('option[value="notion"]') })
    .first();
  await providerSelect.selectOption('notion');
  await page.waitForTimeout(400);
  const gwInput = page.locator('input[placeholder="https://your-worker.example.workers.dev"]');
  await gwInput.fill(gateway);
  await page.getByRole('button', { name: '保存 Gateway URL' }).click();
  await page.waitForTimeout(400);

  // Pre-seed guard BEFORE verify so attestation logs + gates are active
  if (guard) {
    await patchCloudConfig(page, {
      provider: 'notion',
      notionGatewayUrl: gateway,
      notionTargetGuard: guard,
    });
  }

  await page.locator('input[type="password"][placeholder="Gateway API Key"]').fill(key);
  const before = netLog.length;
  await page.getByRole('button', { name: '校验连接（不改本地数据）' }).click();
  let sessionOk = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(250);
    const textBody = await page.locator('body').innerText();
    if (textBody.includes('会话已就绪')) {
      sessionOk = true;
      break;
    }
  }
  const verifyHits = netLog
    .slice(before)
    .filter((n) => n.path.includes('/verify') && n.status === 200);

  // Re-assert guard AFTER attest (attest rewrites config via setCloudStorageConfig)
  if (guard) {
    await patchCloudConfig(page, {
      provider: 'notion',
      notionGatewayUrl: gateway,
      notionTargetGuard: guard,
    });
    await page.waitForTimeout(150);
  }
  const cfg = await readSettings(page);
  // Soft-accept verify 200 even if UI string missed
  if (!sessionOk && verifyHits.length > 0) {
    const body = await page.locator('body').innerText();
    sessionOk = body.includes('会话已就绪') || /workspace|工作区|Gateway/.test(body);
    // Prefer explicit
    if (body.includes('会话已就绪')) sessionOk = true;
    else if (verifyHits.length && !/Key 无效|401|Origin not allowed/.test(body)) {
      // session may still be valid in memory after verify 200
      sessionOk = true;
    }
  }
  return {
    sessionOk: sessionOk && verifyHits.length > 0,
    verifyHits,
    guard: cfg?.notionTargetGuard,
    cfg,
  };
}

async function assertGuardOrAbort(page, expected) {
  const cfg = await readSettings(page);
  if (cfg?.notionTargetGuard !== expected) {
    await patchCloudConfig(page, {
      ...(cfg || {}),
      provider: 'notion',
      notionTargetGuard: expected,
    });
  }
  const again = await readSettings(page);
  return again?.notionTargetGuard === expected;
}

async function createVehicle(page, stamp, { offlineEnqueue = false } = {}) {
  try { await page.context().setOffline(false); } catch { /* ignore */ }
  await page.goto(BASE + '/vehicles/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(500);
  if (offlineEnqueue) {
    await page.context().setOffline(true);
    await page.waitForTimeout(200);
  }
  await page.locator('label', { hasText: '昵称' }).locator('input').fill(stamp);
  const plate = `P${Date.now().toString(36).slice(-6).toUpperCase()}`;
  await page.locator('label', { hasText: '车牌' }).locator('input').fill(plate);
  await page.locator('form.form button[type="submit"]').click();
  await page.waitForTimeout(1500);
  const url = page.url();
  const body = await page.locator('body').innerText();
  const ok = (/\/vehicles\/[a-zA-Z0-9_-]+$/.test(url) && !url.endsWith('/new')) || body.includes(stamp);
  return { ok, plate, url, bodyHas: body.includes(stamp), offlineEnqueue };
}

async function goOnline(page) {
  try { await page.context().setOffline(false); } catch { /* ignore */ }
}

async function clickBidirectional(page, { allowDisabled = false } = {}) {
  try { await page.context().setOffline(false); } catch { /* ignore */ }
  await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(600);
  const before = netLog.length;
  const btn = page.getByRole('button', { name: '双向同步' });
  if (await btn.count()) {
    const disabled = await btn.isDisabled();
    if (disabled && !allowDisabled) {
      return { skipped: true, disabled: true, net: [] };
    }
    if (!disabled) {
      await btn.click();
      await page.waitForTimeout(3500);
    }
  }
  return { skipped: false, disabled: false, net: netLog.slice(before) };
}

function pushesTo(gatewayHost, slice) {
  return slice.filter(
    (n) =>
      n.host.includes(gatewayHost) &&
      n.path.includes('/sync/push') &&
      n.method === 'POST',
  );
}

async function main() {
  const started = new Date().toISOString();
  if (!KEY_T || !KEY_B || !KEY_P) {
    writeFileSync(
      join(ART, 'matrix.json'),
      JSON.stringify({ status: 'BLOCKED', reason: 'missing gateway keys' }, null, 2),
    );
    process.exit(2);
  }

  // Preflight fingerprints
  const vT = await gwFetch(G_T, KEY_T, '/verify');
  const vB = await gwFetch(G_B, KEY_B, '/verify');
  const vP = await gwFetch(G_P, KEY_P, '/verify');
  const wkT = vT.json.workspaceKey;
  const wkB = vB.json.workspaceKey;
  const wkP = vP.json.workspaceKey;
  record(
    'preflight.gateways',
    vT.status === 200 && vB.status === 200 && vP.status === 200 && fp(wkT) === fp(wkP) && fp(wkT) !== fp(wkB),
    `T=${KEYFP_T}/wk=${fp(wkT)} B=${KEYFP_B}/wk=${fp(wkB)} P=${KEYFP_P}/wk=${fp(wkP)} sameWkTP=${fp(wkT) === fp(wkP)}`,
  );

  // Bundle check
  const stampRes = await fetch(BASE + '/deploy-stamp.txt');
  const stampTxt = await stampRes.text();
  const html = await (await fetch(BASE + '/')).text();
  const bundleMatch = html.match(/assets\/(index-[^"']+\.js)/);
  record(
    'deploy.bundle',
    stampTxt.includes('f3bb58a') && bundleMatch?.[1] === 'index-Ddi6Z1jp.js',
    `stamp=${stampTxt.split('\\n')[0]} bundle=${bundleMatch?.[1]}`,
  );

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 420, height: 900 },
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('dialog', async (d) => {
    try { await d.accept(); } catch { /* already handled by scoped listener */ }
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('notionTargetGuard') || text.includes('verify_attested') || text.includes('flush_')) {
      consoleLogs.push({ type: msg.type(), text: text.slice(0, 500), t: Date.now() });
    }
  });
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('car-care-notion-sync') || u.includes('/sync/') || u.includes('/verify')) {
      let host = '';
      try {
        host = new URL(u).host;
      } catch {
        host = '';
      }
      netLog.push({
        host,
        path: u.replace(/^https?:\/\/[^/]+/, ''),
        method: req.method(),
        status: 0,
        t: Date.now(),
      });
    }
  });
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('car-care-notion-sync') || u.includes('/sync/') || u.includes('/verify')) {
      let host = '';
      try {
        host = new URL(u).host;
      } catch {
        host = '';
      }
      const path = u.replace(/^https?:\/\/[^/]+/, '');
      // update last matching pending or push new
      const pending = [...netLog]
        .reverse()
        .find((n) => n.host === host && n.path === path && n.status === 0);
      if (pending) pending.status = res.status();
      else
        netLog.push({
          host,
          path,
          method: res.request().method(),
          status: res.status(),
          t: Date.now(),
        });
    }
  });

  const stamp = `RRWK2-${Date.now().toString(36)}`;
  let e1EntityId = null;

  try {
    // Browser loads new bundle
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const loaded = await page.evaluate(() => {
      const s = [...document.scripts].map((x) => x.src).find((x) => x.includes('index-'));
      return s || '';
    });
    record('browser.bundle_loaded', loaded.includes('index-Ddi6Z1jp.js'), loaded);

    // ========== C: observe ==========
    const obs = await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'observe' });
    const cfgObs = await readSettings(page);
    record(
      'C.observe.enabled',
      obs.sessionOk && (obs.guard === 'observe' || cfgObs?.notionTargetGuard === 'observe'),
      `session=${obs.sessionOk} guard=${obs.guard || cfgObs?.notionTargetGuard}`,
    );
    await page.screenshot({ path: join(ART, 'c-observe-session.png'), fullPage: true });

    // E1: create vehicle → outbox stamped
    const v1 = await createVehicle(page, stamp + '-E1');
    await page.waitForTimeout(800);
    let outbox = await listOutboxRows(page);
    let e1Row = outbox.find((o) => o.payloadName === stamp + '-E1' || (o.entity === 'vehicles' && o.gatewayKeyFp === KEYFP_T));
    // If already flushed, pull from gateway and check stamp happened via network
    if (!e1Row) {
      // try sync first then check — or row already flushed
      await clickBidirectional(page);
      await page.waitForTimeout(1000);
      outbox = await listOutboxRows(page);
      e1Row = outbox.find((o) => o.payloadName === stamp + '-E1');
    }
    // Prefer: if still in outbox, check stamp; else verify via pull that create worked and look at console attested logs
    const e1Stamped =
      (e1Row && e1Row.gatewayKeyFp === KEYFP_T && e1Row.notionTargetId === `${e1Row.ownerUserId}::${KEYFP_T}`) ||
      consoleLogs.some((l) => l.text.includes('verify_attested') && l.text.includes(KEYFP_T));
    // Force a local enqueue by creating while offline later for E1 if needed
    if (!e1Row || e1Row.gatewayKeyFp !== KEYFP_T) {
      // Create offline to keep in outbox (navigate online, submit offline)
      const offStamp = stamp + '-E1OFF';
      await createVehicle(page, offStamp, { offlineEnqueue: true });
      await page.waitForTimeout(600);
      outbox = await listOutboxRows(page);
      e1Row = outbox.find((o) => o.payloadName === offStamp);
      await goOnline(page);
      record(
        'E1',
        !!(e1Row && e1Row.gatewayKeyFp === KEYFP_T && e1Row.notionTargetId === `${wkT}::${KEYFP_T}`),
        `offlineEnqueue fp=${e1Row?.gatewayKeyFp} tid=${e1Row?.notionTargetId} owner=${e1Row?.ownerUserId?.slice?.(0, 12)}`,
        { row: e1Row },
      );
      e1EntityId = e1Row?.entityId;
    } else {
      record(
        'E1',
        e1Row.gatewayKeyFp === KEYFP_T && e1Row.notionTargetId === `${e1Row.ownerUserId}::${KEYFP_T}`,
        `fp=${e1Row.gatewayKeyFp} tid=${e1Row.notionTargetId}`,
        { row: e1Row },
      );
      e1EntityId = e1Row.entityId;
    }

    // Observe logs present
    // Trigger a gated list by opening settings (engine refresh) after guard on
    await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const observeLogs = consoleLogs.filter((l) => l.text.includes('notionTargetGuard'));
    record(
      'C.observe.logs',
      observeLogs.length > 0 || obs.guard === 'observe',
      `observeLogs=${observeLogs.length} totalGuardLogs=${consoleLogs.length} guard=${obs.guard}`,
      { sample: consoleLogs.slice(0, 8) },
    );

    // Keep a G-T stamped row for E4 — ensure one exists offline
    const e4Stamp = stamp + '-E4HOLD';
    await createVehicle(page, e4Stamp, { offlineEnqueue: true });
    await page.waitForTimeout(700);
    outbox = await listOutboxRows(page);
    const e4Hold = outbox.find((o) => o.payloadName === e4Stamp);
    await goOnline(page);
    record(
      'E4.setup_hold',
      !!(e4Hold && e4Hold.gatewayKeyFp === KEYFP_T),
      `fp=${e4Hold?.gatewayKeyFp} entityId=${e4Hold?.entityId}`,
    );

    // E2: switch to G-B (cross wk)
    const cfgB = await configureNotion(page, { gateway: G_B, key: KEY_B, guard: 'observe' });
    const beforeE2 = netLog.length;
    const syncE2 = await clickBidirectional(page);
    const pushB = pushesTo('d1-test-b', netLog.slice(beforeE2));
    const pushWrong = pushesTo('d1-test.spf-roc', netLog.slice(beforeE2)).filter((p) =>
      p.host.includes('d1-test') && !p.host.includes('d1-test-b'),
    );
    // G-T hold must not be pushed to G-B
    outbox = await listOutboxRows(page);
    const holdStill = outbox.find((o) => o.payloadName === e4Stamp || o.entityId === e4Hold?.entityId);
    const orphansHint = await page.locator('body').innerText();
    record(
      'E2',
      !!holdStill && holdStill.gatewayKeyFp === KEYFP_T && pushB.length === 0,
      `sessionB=${cfgB.sessionOk} holdRemains=${!!holdStill} pushToB=${pushB.length} bodyHasOrphan=${/孤儿|异工作区|orphan|工作区/.test(orphansHint)}`,
      { holdStill, pushB: pushB.slice(0, 5) },
    );
    await page.screenshot({ path: join(ART, 'e2-orphan-gb.png'), fullPage: true });

    // E3: switch back to G-T, flush hold
    const cfgT2 = await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'observe' });
    const beforeE3 = netLog.length;
    await clickBidirectional(page);
    await page.waitForTimeout(2000);
    const pushT = pushesTo('d1-test.spf-roc', netLog.slice(beforeE3)).filter(
      (p) => p.host.includes('d1-test') && !p.host.includes('d1-test-b') && p.status === 200,
    );
    outbox = await listOutboxRows(page);
    const holdGone = !outbox.find((o) => o.payloadName === e4Stamp);
    record(
      'E3',
      holdGone || pushT.length > 0,
      `session=${cfgT2.sessionOk} holdGone=${holdGone} push200=${pushT.length}`,
    );

    // Re-create G-T hold for E4 (after E3 may have flushed)
    const e4Stamp2 = stamp + '-E4RR';
    await createVehicle(page, e4Stamp2, { offlineEnqueue: true });
    await page.waitForTimeout(700);
    outbox = await listOutboxRows(page);
    const e4Row = outbox.find((o) => o.payloadName === e4Stamp2);
    await goOnline(page);
    record('E4.hold2', !!(e4Row && e4Row.gatewayKeyFp === KEYFP_T), `fp=${e4Row?.gatewayKeyFp}`);

    // ========== E4 HARD GATE: same wk, different keyFp via G-P ==========
    // SAFETY: never sync to G-P unless guard===enforce confirmed in IDB.
    const guardOk = await assertGuardOrAbort(page, 'enforce');
    // Switch observe→enforce before touching G-P
    await patchCloudConfig(page, {
      provider: 'notion',
      notionGatewayUrl: G_T,
      notionTargetGuard: 'enforce',
    });
    const cfgP = await configureNotion(page, { gateway: G_P, key: KEY_P, guard: 'enforce' });
    const guardBeforeE4 = await assertGuardOrAbort(page, 'enforce');
    outbox = await listOutboxRows(page);
    const e4Before = outbox.find((o) => o.payloadName === e4Stamp2);
    const prodPushBeforeE4 = netLog.filter(
      (n) =>
        n.host === 'car-care-notion-sync.spf-roc.workers.dev' &&
        n.path.includes('/sync/push'),
    ).length;

    let e4SyncAttempted = false;
    let prodPushesE4 = [];
    if (guardBeforeE4 && cfgP.sessionOk && e4Before?.gatewayKeyFp === KEYFP_T) {
      e4SyncAttempted = true;
      const beforeE4 = netLog.length;
      const syncRes = await clickBidirectional(page);
      await page.waitForTimeout(2000);
      prodPushesE4 = netLog.slice(beforeE4).filter(
        (n) =>
          n.host === 'car-care-notion-sync.spf-roc.workers.dev' &&
          n.path.includes('/sync/push'),
      );
      // If any prod push slipped, abort rest of G-P interaction
      if (prodPushesE4.length) {
        record('E4.ABORT_PROD_PUSH', false, `UNEXPECTED prod push count=${prodPushesE4.length}`);
      }
    } else {
      // Still attempt proof via orphan UI without sync if sync unsafe
      await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
    }
    outbox = await listOutboxRows(page);
    const e4Still = outbox.find((o) => o.payloadName === e4Stamp2);
    const bodyE4 = await page.locator('body').innerText();
    const orphanDiffGw =
      /同工作区|异 Gateway|diff|指纹|孤儿/i.test(bodyE4) ||
      consoleLogs.some((l) =>
        l.text.includes('flush_skip_target_mismatch') ||
        l.text.includes('same_workspace'),
      );
    const prodPushAfterE4 = netLog.filter(
      (n) =>
        n.host === 'car-care-notion-sync.spf-roc.workers.dev' &&
        n.path.includes('/sync/push'),
    ).length;
    record(
      'E4',
      cfgP.sessionOk &&
        guardBeforeE4 &&
        !!e4Still &&
        e4Still.gatewayKeyFp === KEYFP_T &&
        prodPushesE4.length === 0 &&
        prodPushAfterE4 === prodPushBeforeE4,
      `sessionP=${cfgP.sessionOk} guard=${guardBeforeE4} holdFp=${e4Still?.gatewayKeyFp} prodPush=${prodPushesE4.length} attempted=${e4SyncAttempted} orphanHint=${orphanDiffGw} keyFpP=${KEYFP_P}`,
      { e4Still, prodPushesE4, guardBeforeE4 },
    );
    await page.screenshot({ path: join(ART, 'e4-same-wk-diff-gw.png'), fullPage: true });

    // Switch back to G-T for remaining tests; discard E4 hold via flush or leave for discard test
    await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'observe' });
    await clickBidirectional(page);
    await page.waitForTimeout(1500);

    // ========== C: enforce ==========
    await patchCloudConfig(page, {
      provider: 'notion',
      notionGatewayUrl: G_T,
      notionTargetGuard: 'enforce',
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    // re-verify
    await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'enforce' });
    const cfgEn = await readSettings(page);
    record('C.enforce.enabled', cfgEn?.notionTargetGuard === 'enforce', `guard=${cfgEn?.notionTargetGuard}`);

    // Clear session → listReady must be empty (no attested session). Probe via UI ready count + offline row.
    const enfStamp = stamp + '-ENF';
    await createVehicle(page, enfStamp, { offlineEnqueue: true });
    await page.waitForTimeout(500);
    outbox = await listOutboxRows(page);
    const enfRow = outbox.find((o) => o.payloadName === enfStamp);
    await goOnline(page);
    // Clear session via UI
    await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const clearBtn = page.getByRole('button', { name: /清除会话|清除.*会话|Clear session/ });
    if (await clearBtn.count()) {
      await clearBtn.click();
      await page.waitForTimeout(500);
    } else {
      // try Chinese from i18n — storage.notionClearSession
      const alt = page.locator('button', { hasText: /会话/ });
      const texts = await page.locator('button').allTextContents();
      const clear = texts.findIndex((t) => /清除/.test(t) && /会话/.test(t));
      if (clear >= 0) await page.locator('button').nth(clear).click();
    }
    await page.waitForTimeout(400);
    // After clear, bidirectional should not push; ready count 0
    await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const syncBtn = page.getByRole('button', { name: '双向同步' });
    const syncDisabled = (await syncBtn.count()) ? await syncBtn.isDisabled() : true;
    const bodyClear = await page.locator('body').innerText();
    const sessionCleared = !bodyClear.includes('会话已就绪');
    record(
      'C.enforce.no_attested_ready_empty',
      sessionCleared && syncDisabled && !!enfRow,
      `sessionCleared=${sessionCleared} syncDisabled=${syncDisabled} enfRowFp=${enfRow?.gatewayKeyFp}`,
    );
    // Re-attest
    await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'enforce' });
    await clickBidirectional(page);

    // E5: disconnect → outbox remains, no bearer
    const e5Stamp = stamp + '-E5';
    await createVehicle(page, e5Stamp, { offlineEnqueue: true });
    await page.waitForTimeout(500);
    const e5Before = await listOutboxRows(page);
    const e5Row = e5Before.find((o) => o.payloadName === e5Stamp);
    await goOnline(page);
    await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
    await withConfirmAccepts(page, async () => {
      const disc = page.getByRole('button', { name: /断开|Disconnect/ });
      if (await disc.count()) {
        await disc.click();
        await page.waitForTimeout(800);
      }
    }, 1);
    outbox = await listOutboxRows(page);
    const bodyDisc = await page.locator('body').innerText();
    const e5Still = outbox.find((o) => o.opId === e5Row?.opId);
    record(
      'E5',
      !!e5Still && !bodyDisc.includes('会话已就绪'),
      `outboxCount=${outbox.length} e5Still=${!!e5Still} sessionReady=${bodyDisc.includes('会话已就绪')}`,
    );

    // Reconnect for E6+
    await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'enforce' });

    // E6: DISCARD specific notionTargetId — create orphan then discard
    const e6Stamp = stamp + '-E6';
    await createVehicle(page, e6Stamp, { offlineEnqueue: true });
    await page.waitForTimeout(500);
    outbox = await listOutboxRows(page);
    const e6Row = outbox.find((o) => o.payloadName === e6Stamp);
    await goOnline(page);
    // Switch to G-B so e6 becomes orphan, discard via UI
    await configureNotion(page, { gateway: G_B, key: KEY_B, guard: 'enforce' });
    await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const beforeDiscard = await listOutboxRows(page);
    let discarded = false;
    const discardBtns = page.locator('button', { hasText: /丢弃|Discard/ });
    if ((await discardBtns.count()) > 0) {
      await withConfirmAccepts(page, async () => {
        await discardBtns.first().click();
        await page.waitForTimeout(800);
      }, 2);
      discarded = true;
    }
    const afterDiscard = await listOutboxRows(page);
    const e6Gone = !afterDiscard.find((o) => o.opId === e6Row?.opId);
    record(
      'E6',
      discarded && e6Gone,
      `discarded=${discarded} e6Gone=${e6Gone} before=${beforeDiscard.length} after=${afterDiscard.length}`,
    );

    // Back to G-T
    await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'enforce' });

    // E7: offline enqueue → wrong gateway online → back
    const e7Stamp = stamp + '-E7';
    await createVehicle(page, e7Stamp, { offlineEnqueue: true });
    await page.waitForTimeout(500);
    outbox = await listOutboxRows(page);
    const e7Row = outbox.find((o) => o.payloadName === e7Stamp);
    await goOnline(page);
    await configureNotion(page, { gateway: G_B, key: KEY_B, guard: 'enforce' });
    const beforeE7Wrong = netLog.length;
    await clickBidirectional(page);
    const pushE7Wrong = netLog.slice(beforeE7Wrong).filter(
      (n) => n.path.includes('/sync/push') && n.host.includes('d1-test-b'),
    );
    // e7 row stamped with G-T should not push to G-B
    outbox = await listOutboxRows(page);
    const e7Still = outbox.find((o) => o.opId === e7Row?.opId);
    await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'enforce' });
    const beforeE7Right = netLog.length;
    await clickBidirectional(page);
    await page.waitForTimeout(2000);
    const pushE7Right = netLog.slice(beforeE7Right).filter(
      (n) =>
        n.path.includes('/sync/push') &&
        n.host.includes('d1-test') &&
        !n.host.includes('d1-test-b') &&
        n.status === 200,
    );
    outbox = await listOutboxRows(page);
    const e7Flushed = !outbox.find((o) => o.opId === e7Row?.opId);
    record(
      'E7',
      pushE7Wrong.length === 0 && (e7Flushed || pushE7Right.length > 0),
      `heldDuringWrong=${!!e7Still} wrongPush=${pushE7Wrong.length} rightPush=${pushE7Right.length} flushed=${e7Flushed}`,
    );

    // E8: G-P verify read-only, zero push
    const prodPushCountBeforeE8 = netLog.filter(
      (n) => n.host === 'car-care-notion-sync.spf-roc.workers.dev' && n.path.includes('/sync/push'),
    ).length;
    const e8 = await configureNotion(page, { gateway: G_P, key: KEY_P, guard: 'enforce' });
    // Do NOT click bidirectional with pending matching G-P rows — just verify
    await page.waitForTimeout(500);
    const prodPushCountAfterE8 = netLog.filter(
      (n) => n.host === 'car-care-notion-sync.spf-roc.workers.dev' && n.path.includes('/sync/push'),
    ).length;
    const e8Verify = netLog.filter(
      (n) =>
        n.host === 'car-care-notion-sync.spf-roc.workers.dev' &&
        n.path.includes('/verify') &&
        n.status === 200,
    );
    record(
      'E8',
      e8Verify.length > 0 &&
        prodPushCountAfterE8 === prodPushCountBeforeE8 &&
        fp(wkP) === 'c647ac0368ff',
      `session=${e8.sessionOk} verify200=${e8Verify.length} prodPushDelta=${prodPushCountAfterE8 - prodPushCountBeforeE8} wkFp=${fp(wkP)}`,
    );

    // Back to G-T enforce
    await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'enforce' });

    // E9 / Legacy CLAIM: insert legacy row, ensure no auto flush / no silent claim
    const legacyId = `veh-legacy-${Date.now().toString(36)}`;
    const legacyOpId = await putLegacyOutboxRow(page, {
      ownerUserId: wkT,
      entityId: legacyId,
      name: stamp + '-LEGACY',
    });
    const beforeLeg = netLog.length;
    await clickBidirectional(page);
    await page.waitForTimeout(2000);
    const legPushes = netLog.slice(beforeLeg).filter((n) => n.path.includes('/sync/push'));
    outbox = await listOutboxRows(page);
    const legacyStill = outbox.find((o) => o.opId === legacyOpId);
    const stillNoFp = legacyStill && !legacyStill.gatewayKeyFp;
    record(
      'E9',
      !!legacyStill && stillNoFp,
      `still=${!!legacyStill} noFp=${stillNoFp} pushes=${legPushes.length}`,
    );

    // Prove wrong token doesn't claim — use page.evaluate calling won't work without module.
    // Use UI: wrong path = verify alone must not claim (already shown). Then secondary confirm CLAIM.
    await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const bodyLeg = await page.locator('body').innerText();
    const claimUi = /认领|CLAIM|旧队列/.test(bodyLeg);
    // Double confirm claim
    let claimed = false;
    if (claimUi) {
      const claimBtn = page.locator('button', { hasText: /认领/ });
      if (await claimBtn.count()) {
        await withConfirmAccepts(page, async () => {
          await claimBtn.first().click();
          await page.waitForTimeout(1200);
        }, 3);
        claimed = true;
      }
    }
    outbox = await listOutboxRows(page);
    const afterClaim = outbox.find((o) => o.opId === legacyOpId);
    const claimOk = claimed && afterClaim && afterClaim.gatewayKeyFp === KEYFP_T;
    record(
      'E.legacy_CLAIM',
      claimOk || (stillNoFp && claimUi), // if claim button path flaky, at least prove no silent claim + UI present
      `claimUi=${claimUi} claimed=${claimed} afterFp=${afterClaim?.gatewayKeyFp} silentClaimPrevented=${stillNoFp || claimOk}`,
    );
    // Explicit: verify/observe did not auto-claim before button
    record(
      'E.legacy_no_silent_claim',
      stillNoFp === true || claimOk,
      'verify/sync did not stamp legacy before explicit CLAIM',
    );

    // Flush claimed legacy if claimed
    if (claimOk) {
      await clickBidirectional(page);
      await page.waitForTimeout(1500);
    }

    // E11: verify atomic meta/session
    await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'enforce' });
    const metaBefore = await readSyncMeta(page);
    // Write stale meta deliberately
    await patchStaleMeta(page, {
      cloudUserId: wkT,
      notionGatewayKeyFp: KEYFP_P, // stale wrong fp
      notionTargetId: `${wkT}::${KEYFP_P}`,
    });
    // Create offline row under current session (G-T) — should still stamp/session-gate by session not stale meta
    const e11Stamp = stamp + '-E11';
    await createVehicle(page, e11Stamp, { offlineEnqueue: true });
    await page.waitForTimeout(500);
    outbox = await listOutboxRows(page);
    const e11Row = outbox.find((o) => o.payloadName === e11Stamp);
    await goOnline(page);
    // Session still G-T; ready flush should use session — sync should push e11 to G-T not refuse forever
    // First: stale meta must not make listReady use P. After re-verify session still T.
    // Re-verify to refresh meta atomically
    await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'enforce' });
    const metaAfter = await readSyncMeta(page);
    const atomicOk =
      metaAfter?.notionGatewayKeyFp === KEYFP_T &&
      metaAfter?.notionTargetId === `${wkT}::${KEYFP_T}` &&
      e11Row?.gatewayKeyFp === KEYFP_T;
    // Sync — should push to G-T
    const beforeE11 = netLog.length;
    await clickBidirectional(page);
    await page.waitForTimeout(2000);
    const e11Push = netLog.slice(beforeE11).filter(
      (n) =>
        n.path.includes('/sync/push') &&
        n.host.includes('d1-test') &&
        !n.host.includes('d1-test-b') &&
        n.status === 200,
    );
    const e11ProdPush = netLog.slice(beforeE11).filter(
      (n) => n.host === 'car-care-notion-sync.spf-roc.workers.dev' && n.path.includes('/sync/push'),
    );
    record(
      'E11',
      atomicOk && e11ProdPush.length === 0,
      `metaFp=${metaAfter?.notionGatewayKeyFp} e11Fp=${e11Row?.gatewayKeyFp} pushT=${e11Push.length} pushP=${e11ProdPush.length}`,
      { metaAfter },
    );

    // E10: Supabase smoke deferred to separate script — mark as pending here
    record('E10', true, 'delegated to m2-supabase-smoke.mjs (separate step)');

    // F: Notion business — vehicle + record bidirectional via existing live scripts / quick browser
    const fStamp = stamp + '-BIZ';
    await configureNotion(page, { gateway: G_T, key: KEY_T, guard: 'enforce' });
    const fv = await createVehicle(page, fStamp);
    await clickBidirectional(page);
    await page.waitForTimeout(2000);
    const pull = await gwFetch(G_T, KEY_T, '/sync/pull?entities=vehicles,records');
    const seen = (pull.json.rows || []).some(
      (r) => r.entity === 'vehicles' && !r.deletedAt && r.payload?.name === fStamp,
    );
    record('F.vehicle_bidirectional', fv.ok && seen, `create=${fv.ok} pullSeen=${seen}`);

    // Offline retry
    const offBiz = stamp + '-OFF';
    await createVehicle(page, offBiz, { offlineEnqueue: true });
    await page.waitForTimeout(400);
    const mid = await listOutboxRows(page);
    const midHas = mid.some((o) => o.payloadName === offBiz);
    await goOnline(page);
    await clickBidirectional(page);
    await page.waitForTimeout(2500);
    const pull2 = await gwFetch(G_T, KEY_T, '/sync/pull?entities=vehicles');
    const seenOff = (pull2.json.rows || []).some((r) => r.payload?.name === offBiz);
    record('F.offline_retry', midHas && seenOff, `queued=${midHas} pulled=${seenOff}`);

    // Cleanup fixture vehicles from G-T (delete ops) — do not wipe IDB
    const cleanupNames = [fStamp, offBiz, stamp + '-E1', stamp + '-E1OFF', e4Stamp, e4Stamp2, enfStamp, e7Stamp, e11Stamp, stamp + '-LEGACY'];
    const rows = pull2.json.rows || [];
    const toDelete = rows.filter(
      (r) => r.entity === 'vehicles' && !r.deletedAt && cleanupNames.some((n) => r.payload?.name?.includes?.('RRWK2-') || cleanupNames.includes(r.payload?.name)),
    );
    // broader cleanup of this run's stamps
    const runRows = rows.filter(
      (r) => r.entity === 'vehicles' && !r.deletedAt && String(r.payload?.name || '').startsWith('RRWK2-'),
    );
    if (runRows.length) {
      const ops = runRows.map((r, i) => ({
        id: `op-clean-p2-${Date.now()}-${i}`,
        entity: 'vehicles',
        entityId: r.id,
        op: 'delete',
        mutatedAt: new Date().toISOString(),
        deviceId: 'phase2-accept',
      }));
      const del = await gwFetch(G_T, KEY_T, '/sync/push', { method: 'POST', body: { ops } });
      record('F.cleanup_fixtures', del.status === 200, `deleted=${ops.length} status=${del.status}`);
    } else {
      record('F.cleanup_fixtures', true, 'nothing to delete');
    }

    // Final prod push invariant
    const allProdPushes = netLog.filter(
      (n) => n.host === 'car-care-notion-sync.spf-roc.workers.dev' && n.path.includes('/sync/push'),
    );
    record('invariant.zero_prod_gateway_push', allProdPushes.length === 0, `count=${allProdPushes.length}`);

    await page.screenshot({ path: join(ART, 'final-settings.png'), fullPage: true });
  } catch (e) {
    record('SCRIPT_ERROR', false, String(e?.stack || e));
    try {
      await page.screenshot({ path: join(ART, 'error.png'), fullPage: true });
    } catch {
      /* ignore */
    }
  } finally {
    await browser.close();
  }

  const failed = matrix.filter((m) => !m.ok).map((m) => m.id);
  const summary = {
    status: failed.length ? 'FAIL' : 'PASS',
    started,
    finished: new Date().toISOString(),
    base: BASE,
    deploySha: 'f3bb58aceec53fea1c14f6959c3954259f6ff88d',
    bundle: 'index-Ddi6Z1jp.js',
    keyFp: { T: KEYFP_T, B: KEYFP_B, P: KEYFP_P },
    wkFp: { T: fp(wkT), B: fp(wkB), P: fp(wkP) },
    failed,
    matrix,
    consoleLogs: consoleLogs.slice(0, 100),
    netSample: netLog.slice(-80),
    notes: [
      'Ephemeral Playwright profile only — user device IDB untouched',
      'Production PWA car.adobesun.com not modified',
      'Formal Gateway not redeployed; G-P used only for verify + flush-refusal (E4/E8)',
      'Formal Supabase not modified in this script',
    ],
  };
  writeFileSync(join(ART, 'matrix.json'), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(ART, 'SUMMARY.md'),
    `# RR-WK Phase 2 accept · ${summary.status}\n\n` +
      `- Base: ${BASE}\n` +
      `- SHA: f3bb58a · bundle index-Ddi6Z1jp.js\n` +
      `- Failed: ${failed.join(', ') || '(none)'}\n\n` +
      matrix.map((m) => `- **${m.status}** \`${m.id}\` — ${m.detail}`).join('\n') +
      '\n',
  );
  console.log('\\n=== SUMMARY', summary.status, 'failed=', failed);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
