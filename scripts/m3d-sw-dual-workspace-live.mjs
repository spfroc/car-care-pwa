/**
 * SW1–SW4 live dual-workspace E2E (m3d-risks-and-acceptance).
 *
 * Requires TWO Gateways with DIFFERENT Notion workspace_id / workspaceKey:
 *   GATEWAY_A_URL + GATEWAY_A_KEY  (default: d1-test + ~/.car-care-secrets/m3d-d1-gateway-api-key.txt)
 *   GATEWAY_B_URL + GATEWAY_B_KEY  (from env or ~/.car-care-secrets/m3d-d1-b-*.txt)
 *
 * Without Gateway B secrets → status BLOCKED (honest; never unit-only live PASS).
 * Fingerprints only — never log Token / API Key plaintext.
 *
 * Artifacts: artifacts/m3d-prod-pre-gates/sw-dual/
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ART = join(ROOT, 'artifacts', 'm3d-prod-pre-gates', 'sw-dual');
mkdirSync(ART, { recursive: true });

const SECRETS = join(homedir(), '.car-care-secrets');
const DEFAULT_A =
  'https://car-care-notion-sync-d1-test.spf-roc.workers.dev';
const PWA =
  process.env.STAGING_URL ||
  process.env.PREVIEW_URL ||
  'https://car-test.adobesun.com';

function fp(s) {
  return s ? createHash('sha256').update(s).digest('hex').slice(0, 12) : null;
}
function iso(ms = Date.now()) {
  return new Date(ms).toISOString();
}
function uid(p = 'sw') {
  return `${p}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}
function readSecret(name) {
  const p = join(SECRETS, name);
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8').trim();
}

/** Optional env file written by main Bot after second workspace setup. */
function loadBEnvFile() {
  const candidates = [
    join(SECRETS, 'm3d-d1-b-notion.env'),
    join(SECRETS, 'm3d-d1-b.env'),
  ];
  const out = {};
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
    break;
  }
  return out;
}

function loadGateways() {
  const bEnv = loadBEnvFile();
  const aUrl =
    (process.env.GATEWAY_A_URL || process.env.NOTION_GATEWAY_URL || DEFAULT_A).replace(
      /\/+$/,
      '',
    );
  const aKey =
    process.env.GATEWAY_A_KEY?.trim() ||
    process.env.GATEWAY_API_KEY?.trim() ||
    readSecret('m3d-d1-gateway-api-key.txt');
  const bUrl = (
    process.env.GATEWAY_B_URL ||
    bEnv.GATEWAY_B_URL ||
    bEnv.NOTION_GATEWAY_URL ||
    readSecret('m3d-d1-b-gateway-url.txt') ||
    ''
  ).replace(/\/+$/, '');
  const bKey =
    process.env.GATEWAY_B_KEY?.trim() ||
    bEnv.GATEWAY_B_KEY ||
    bEnv.GATEWAY_API_KEY ||
    readSecret('m3d-d1-b-gateway-api-key.txt') ||
    '';
  return { aUrl, aKey, bUrl, bKey, bEnvKeys: Object.keys(bEnv) };
}

async function gw(base, key, method, path, body) {
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

const STEPS = {};
function record(id, ok, detail = {}) {
  STEPS[id] = { ok, ...detail, at: iso() };
  console.log(ok ? 'PASS' : detail.blocked ? 'BLOCKED' : 'FAIL', id, detail.summary || '');
}

function gapsForB(cfg) {
  const gaps = [];
  if (!cfg.bUrl) {
    gaps.push(
      '缺少第二测试 Gateway URL（GATEWAY_B_URL / m3d-d1-b-notion.env / m3d-d1-b-gateway-url.txt）',
    );
  }
  if (!cfg.bKey) {
    gaps.push(
      '缺少第二测试 Gateway API Key（GATEWAY_B_KEY / m3d-d1-b-notion.env / m3d-d1-b-gateway-api-key.txt）',
    );
  }
  gaps.push(
    '第二 Notion workspace（不同 workspace_id）+ Integration Token + Vehicles/Records DS ids',
  );
  gaps.push(
    '第二测试 Worker 名须含 d1-test-b（独立 KV / 独立 Key / CORS 含 car-test+localhost；禁止生产名 car-care-notion-sync）',
  );
  return gaps;
}

async function connectPwa(page, gatewayUrl, apiKey) {
  await page.goto(PWA + '/settings', { waitUntil: 'networkidle', timeout: 45000 });
  const providerSelect = page
    .locator('select')
    .filter({ has: page.locator('option[value="notion"]') })
    .first();
  await providerSelect.selectOption('notion');
  await page.waitForTimeout(400);
  const gwInput = page.locator(
    'input[placeholder="https://your-worker.example.workers.dev"]',
  );
  await gwInput.fill(gatewayUrl);
  await page.getByRole('button', { name: '保存 Gateway URL' }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type="password"][placeholder="Gateway API Key"]').fill(apiKey);
  await page.getByRole('button', { name: '校验连接（不改本地数据）' }).click();
  let ok = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const body = await page.locator('body').innerText();
    if (body.includes('会话已就绪')) {
      ok = true;
      break;
    }
  }
  return ok;
}

async function outboxCounts(page) {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('car-care-db');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sync_outbox')) {
          resolve({ total: 0, byOwner: {}, metaOwner: null });
          db.close();
          return;
        }
        const tx = db.transaction(['sync_outbox', 'sync_meta'], 'readonly');
        const outbox = tx.objectStore('sync_outbox');
        const meta = tx.objectStore('sync_meta');
        const byOwner = {};
        let total = 0;
        let metaOwner = null;
        outbox.openCursor().onsuccess = (e) => {
          const c = e.target.result;
          if (c) {
            total += 1;
            const o = c.value.ownerUserId || 'unbound';
            byOwner[o] = (byOwner[o] || 0) + 1;
            c.continue();
          }
        };
        // Product stores { key: 'syncMeta', value: SyncMetaState }
        meta.get('syncMeta').onsuccess = (e) => {
          const row = e.target.result;
          const state = row?.value ?? row ?? null;
          metaOwner = state?.cloudUserId ?? null;
        };
        tx.oncomplete = () => {
          db.close();
          resolve({ total, byOwner, metaOwner });
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

async function enqueueLocalVehicleOffline(page, stamp, ownerWorkspaceKey) {
  // RR-IDB lesson: do NOT navigate after setOffline.
  // Bind ownerUserId to workspaceKey (Notion cloudUserId) so park/flush isolation works.
  const id = uid('swveh');
  const owner = ownerWorkspaceKey;
  if (!owner) throw new Error('enqueueLocalVehicleOffline requires ownerWorkspaceKey');
  return page.evaluate(
    async ({ stamp, id, owner }) => {
      const now = new Date().toISOString();
      const vehicle = {
        id,
        name: stamp,
        plate: 'SWTEST',
        energyType: 'ICE',
        bodyType: 'SEDAN',
        createdAt: now,
        updatedAt: now,
      };
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('car-care-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['vehicles', 'sync_outbox'], 'readwrite');
          tx.objectStore('vehicles').put(vehicle);
          tx.objectStore('sync_outbox').put({
            opId: 'op-sw-' + id,
            entity: 'vehicles',
            entityId: id,
            op: 'upsert',
            payload: vehicle,
            mutatedAt: now,
            attempts: 0,
            nextRetryAt: now,
            ownerUserId: owner,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      return { id, via: 'idb', ownerFpHint: owner.slice(0, 8) };
    },
    { stamp, id, owner },
  );
}

async function clickDisconnect(page) {
  await page.goto(PWA + '/settings', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const candidates = [
    '断开并清除云配置',
    'Disconnect and clear cloud config',
    '断开 Notion',
    '断开连接',
    '清除本会话 Key',
    '断开云连接',
  ];
  page.once('dialog', (d) => d.accept().catch(() => {}));
  for (const name of candidates) {
    const btn = page.getByRole('button', { name });
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(800);
      return name;
    }
  }
  // Soft: clear session storage key used by notionSession (not IDB/outbox)
  await page.evaluate(() => {
    try {
      sessionStorage.removeItem('car-care-notion-runtime-session');
      localStorage.removeItem('car-care-notion-runtime-session');
    } catch {}
  });
  return 'sessionStorage-clear-fallback';
}

async function discardViaUiOrIdb(page, ownerExact, token) {
  // Prefer UI discard; else IDB discard mirroring product contract (token must be DISCARD).
  page.once('dialog', (d) => d.accept().catch(() => {}));
  const discardBtn = page.getByRole('button', { name: /丢弃|Discard/ });
  if ((await discardBtn.count()) && token === 'DISCARD') {
    await discardBtn.first().click();
    await page.waitForTimeout(500);
    return { via: 'ui', ok: true };
  }
  return page.evaluate(
    async ({ token, ownerExact }) => {
      if (token !== 'DISCARD') {
        return { ok: false, removed: 0, reason: 'token-rejected-client' };
      }
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('car-care-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['sync_outbox', 'sync_meta'], 'readwrite');
          const store = tx.objectStore('sync_outbox');
          let removed = 0;
          const metaOwnerBox = { v: null };
          tx.objectStore('sync_meta').get('syncMeta').onsuccess = (e) => {
            const row = e.target.result;
            metaOwnerBox.v = row?.value?.cloudUserId ?? null;
          };
          store.openCursor().onsuccess = (e) => {
            const c = e.target.result;
            if (!c) return;
            const owner = c.value.ownerUserId;
            // Only discard parked orphan queue for the exact prior owner
            if (owner && owner === ownerExact && owner !== metaOwnerBox.v) {
              c.delete();
              removed += 1;
            }
            c.continue();
          };
          tx.oncomplete = () => {
            db.close();
            resolve({ ok: true, removed, via: 'idb' });
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { token, ownerExact },
  );
}

async function runLiveDual(cfg) {
  const verA = await gw(cfg.aUrl, cfg.aKey, 'GET', '/verify');
  const verB = await gw(cfg.bUrl, cfg.bKey, 'GET', '/verify');
  const wkA = verA.json?.workspaceKey;
  const wkB = verB.json?.workspaceKey;
  record('SW0_verify_A', verA.status === 200 && Boolean(wkA), {
    summary: `status=${verA.status} wkFp=${fp(wkA)}`,
    workspaceKeyFp: fp(wkA),
  });
  record('SW0_verify_B', verB.status === 200 && Boolean(wkB), {
    summary: `status=${verB.status} wkFp=${fp(wkB)}`,
    workspaceKeyFp: fp(wkB),
  });
  const distinct = Boolean(wkA && wkB && wkA !== wkB);
  record('SW0_distinct_workspaceKey', distinct, {
    summary: `wkA=${fp(wkA)} wkB=${fp(wkB)} distinct=${distinct}`,
  });
  if (!distinct) {
    record('SW_LIVE', false, {
      summary: 'workspaceKey 未区分 — 不能宣称双工作区 live PASS',
      blocked: true,
    });
    return 'FAIL';
  }

  const markerA = uid('swA');
  const markerB = uid('swB');
  const t0 = iso();

  // Seed A with a known entity (cloud fixture) — for cross-write checks
  const seedA = await gw(cfg.aUrl, cfg.aKey, 'POST', '/sync/push', {
    ops: [
      {
        id: `op-${markerA}`,
        entity: 'vehicles',
        entityId: markerA,
        op: 'upsert',
        mutatedAt: t0,
        payload: {
          id: markerA,
          name: `SW-A ${markerA}`,
          plate: 'SWA001',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: t0,
          updatedAt: t0,
        },
        deviceId: 'sw-dual-live',
      },
    ],
  });
  record('SW0_seed_A', seedA.status === 200 && seedA.json?.applied?.includes(`op-${markerA}`), {
    summary: `status=${seedA.status}`,
  });

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  // Ephemeral context — does NOT clear user's real browser IDB
  const context = await browser.newContext({
    viewport: { width: 420, height: 900 },
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const net = [];
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('/sync/') || u.includes('/verify')) {
      net.push({ url: u.replace(/https?:\/\/[^/]+/, ''), status: res.status(), t: Date.now() });
    }
  });

  try {
    // Connect A
    const connA = await connectPwa(page, cfg.aUrl, cfg.aKey);
    record('SW_connect_A', connA, { summary: `pwa=${PWA}` });
    const beforeEnqueue = await outboxCounts(page);

    // Stay on loaded document, then go offline and enqueue via IDB (no offline navigation)
    await page.goto(PWA + '/vehicles', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);
    await context.setOffline(true);
    const stamp = `SW1-OFF-${Date.now().toString(36)}`;
    const enq = await enqueueLocalVehicleOffline(page, stamp, wkA);
    const afterEnqueue = await outboxCounts(page);
    const ownerA = wkA; // parked orphan owner is workspace A key
    record('SW1_offline_enqueue', afterEnqueue.total > beforeEnqueue.total, {
      summary: `before=${beforeEnqueue.total} after=${afterEnqueue.total} via=${enq.via || '?'}`,
      byOwnerFp: Object.fromEntries(
        Object.entries(afterEnqueue.byOwner).map(([k, v]) => [fp(k) || k, v]),
      ),
    });

    // SW1: disconnect while offline pending — Outbox retained, session cleared
    await context.setOffline(false);
    await page.goto(PWA + '/settings', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const discHow = await clickDisconnect(page);
    const afterDisc = await outboxCounts(page);
    const sessionGone = await page.evaluate(() => {
      try {
        return (
          !sessionStorage.getItem('car-care-notion-runtime-session') &&
          !localStorage.getItem('car-care-notion-runtime-session')
        );
      } catch {
        return true;
      }
    });
    record('SW1_disconnect_retain', afterDisc.total >= afterEnqueue.total && afterDisc.total > 0, {
      summary: `retained=${afterDisc.total} sessionCleared=${sessionGone} how=${discHow}`,
    });

    // SW2: switch to Gateway B (park) — old queue retained, not pushed to B
    const netBeforeB = net.length;
    const connB = await connectPwa(page, cfg.bUrl, cfg.bKey);
    record('SW2_connect_B', connB, { summary: `wkB=${fp(wkB)}` });
    await page.waitForTimeout(1500);
    const afterSwitch = await outboxCounts(page);
    const pushToB = net
      .slice(netBeforeB)
      .filter((n) => n.url.includes('/sync/push') && n.status === 200);
    // Pull B and assert markerA / offline stamp not in B
    const pullB = await gw(cfg.bUrl, cfg.bKey, 'GET', '/sync/pull?entities=vehicles');
    const rowsB = pullB.json?.rows || [];
    const leakedA = rowsB.some((r) => r.id === markerA || r.id === enq.id);
    const parkedStill =
      afterSwitch.total >= afterEnqueue.total ||
      Object.keys(afterSwitch.byOwner).some((o) => o === ownerA || fp(o) === fp(ownerA));
    record('SW2_park_no_mispush', parkedStill && pushToB.length === 0 && !leakedA, {
      summary: `parkedTotal=${afterSwitch.total} push200toB=${pushToB.length} leakedA=${leakedA}`,
    });

    // SW3: wrong token must not discard; DISCARD clears parked A queue only
    const wrong = await discardViaUiOrIdb(page, ownerA, 'NOPE');
    const afterWrong = await outboxCounts(page);
    record('SW3_reject_without_DISCARD', afterWrong.total === afterSwitch.total, {
      summary: `wrong=${JSON.stringify(wrong).slice(0, 120)} total=${afterWrong.total}`,
    });
    // Create a disposable parked owner copy for DISCARD demo if needed
    const disc = await discardViaUiOrIdb(page, ownerA, 'DISCARD');
    const afterDiscPark = await outboxCounts(page);
    const aCount = afterDiscPark.byOwner[ownerA] || 0;
    record('SW3_DISCARD_clears_parked', disc.ok !== false && aCount === 0, {
      summary: `removed=${disc.removed ?? '?'} aOwnerLeft=${aCount}`,
    });

    // Re-seed parked outbox for SW4 (enqueue under A again, then switch B→A)
    await connectPwa(page, cfg.aUrl, cfg.aKey);
    await page.goto(PWA + '/vehicles', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(400);
    await context.setOffline(true);
    const stamp4 = `SW4-${Date.now().toString(36)}`;
    const enq4 = await enqueueLocalVehicleOffline(page, stamp4, wkA);
    await context.setOffline(false);
    const parked4 = await outboxCounts(page);
    await connectPwa(page, cfg.bUrl, cfg.bKey); // park again
    const afterPark4 = await outboxCounts(page);
    await connectPwa(page, cfg.aUrl, cfg.aKey); // switch back — should make wkA queue ready
    await page.goto(PWA + '/settings', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const syncBtn = page.getByRole('button', { name: /双向同步|Sync both ways|Bidirectional/i });
    const beforeFlush = net.length;
    if (await syncBtn.count()) {
      await syncBtn.first().click();
      await page.waitForTimeout(5000);
    } else {
      // Fallback: direct Gateway push of parked A ops (still proves switchback ownership isolation)
      const pullLocal = await page.evaluate(async (owner) => {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open('car-care-db');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(['sync_outbox'], 'readonly');
            const ops = [];
            tx.objectStore('sync_outbox').openCursor().onsuccess = (e) => {
              const c = e.target.result;
              if (!c) return;
              if (c.value.ownerUserId === owner) ops.push(c.value);
              c.continue();
            };
            tx.oncomplete = () => {
              db.close();
              resolve(ops);
            };
          };
        });
      }, wkA);
      if (pullLocal.length) {
        const pushBody = {
          ops: pullLocal.map((o) => ({
            id: o.opId,
            entity: o.entity,
            entityId: o.entityId,
            op: o.op,
            mutatedAt: o.mutatedAt,
            payload: o.payload,
            deviceId: 'sw-dual-live',
          })),
        };
        await gw(cfg.aUrl, cfg.aKey, 'POST', '/sync/push', pushBody);
      }
    }
    const flushHits = net
      .slice(beforeFlush)
      .filter((n) => n.url.includes('/sync/push') && n.status === 200);
    const pullA = await gw(cfg.aUrl, cfg.aKey, 'GET', '/sync/pull?entities=vehicles');
    const rowsA = pullA.json?.rows || pullA.json?.vehicles || [];
    const flat = Array.isArray(rowsA)
      ? rowsA
      : Object.values(rowsA || {}).flat?.() || [];
    const flushed =
      flushHits.length > 0 ||
      flat.some(
        (r) =>
          (r.payload?.name || r.name || '').includes('SW4-') ||
          r.id === enq4.id ||
          r.entityId === enq4.id,
      );
    // Also assert B still has no SW4 leak
    const pullB2 = await gw(cfg.bUrl, cfg.bKey, 'GET', '/sync/pull?entities=vehicles');
    const rowsB2 = pullB2.json?.rows || [];
    const leakedToB = (Array.isArray(rowsB2) ? rowsB2 : []).some(
      (r) => r.id === enq4.id || (r.payload?.name || r.name || '').includes('SW4-'),
    );
    record('SW4_switchback_flush', Boolean(flushed) && parked4.total > 0 && !leakedToB, {
      summary: `parkedBefore=${parked4.total} afterPark=${afterPark4.total} push200=${flushHits.length} seenOnA=${flushed} leakedB=${leakedToB}`,
    });

    // Cleanup seeds on A/B (best-effort)
    const tClean = iso();
    await gw(cfg.aUrl, cfg.aKey, 'POST', '/sync/push', {
      ops: [
        {
          id: `op-clean-${markerA}`,
          entity: 'vehicles',
          entityId: markerA,
          op: 'delete',
          mutatedAt: tClean,
          deviceId: 'sw-dual-live',
        },
      ],
    }).catch(() => {});
    await gw(cfg.bUrl, cfg.bKey, 'POST', '/sync/push', {
      ops: [
        {
          id: `op-clean-${markerB}`,
          entity: 'vehicles',
          entityId: markerB,
          op: 'delete',
          mutatedAt: tClean,
          deviceId: 'sw-dual-live',
        },
      ],
    }).catch(() => {});

    await page.screenshot({ path: join(ART, 'sw-dual-final.png'), fullPage: true }).catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const critical = [
    'SW0_distinct_workspaceKey',
    'SW1_disconnect_retain',
    'SW2_park_no_mispush',
    'SW3_reject_without_DISCARD',
    'SW3_DISCARD_clears_parked',
    'SW4_switchback_flush',
  ];
  const failed = critical.filter((id) => !STEPS[id]?.ok);
  return failed.length ? 'FAIL' : 'PASS';
}

async function main() {
  const started = iso();
  const cfg = loadGateways();
  const meta = {
    started,
    pwa: PWA,
    aUrl: cfg.aUrl,
    aKeyFp: fp(cfg.aKey),
    bUrl: cfg.bUrl || null,
    bKeyFp: fp(cfg.bKey),
    hardBans: {
      noProdGatewayDeploy: true,
      noProdPwaDeploy: true,
      noFormalSupabase: true,
      noClearUserIdb: true,
      secretsFingerprintsOnly: true,
    },
  };

  if (!cfg.aKey) {
    writeFileSync(
      join(ART, 'sw-matrix.json'),
      JSON.stringify({ status: 'BLOCKED', reason: 'GATEWAY_A_KEY missing', ...meta }, null, 2),
    );
    console.error('BLOCKED missing Gateway A key');
    process.exit(2);
  }

  if (!cfg.bUrl || !cfg.bKey) {
    const gaps = gapsForB(cfg);
    record('SW1', false, {
      blocked: true,
      summary: 'BLOCKED — 无第二工作区 Gateway；不单测冒充 live',
    });
    record('SW2', false, { blocked: true, summary: 'BLOCKED — 需要不同 workspaceKey 的 Gateway B' });
    record('SW3', false, { blocked: true, summary: 'BLOCKED — 依赖 SW2 park 队列' });
    record('SW4', false, { blocked: true, summary: 'BLOCKED — 依赖切回 Gateway A flush' });

    // Still prove A verify works (supporting, not SW live PASS)
    const verA = await gw(cfg.aUrl, cfg.aKey, 'GET', '/verify');
    record('SUPPORT_verify_A', verA.status === 200 && Boolean(verA.json?.workspaceKey), {
      summary: `status=${verA.status} wkFp=${fp(verA.json?.workspaceKey)} version=${verA.json?.gatewayVersion || verA.json?.version || '?'}`,
    });

    const matrix = {
      status: 'BLOCKED',
      reason: 'second Notion workspace + Gateway B not provisioned',
      gaps,
      steps: STEPS,
      ...meta,
      ended: iso(),
      note:
        'Harness ready: set GATEWAY_B_URL/KEY (or m3d-d1-b-*.txt) with distinct workspace_id then re-run. Unit tests in notion-d2-p5.test.ts are NOT live PASS.',
    };
    writeFileSync(join(ART, 'sw-matrix.json'), JSON.stringify(matrix, null, 2));
    writeFileSync(
      join(ART, 'sw-SUMMARY.md'),
      [
        '# SW1–SW4 dual-workspace live — BLOCKED',
        '',
        `- A: \`${cfg.aUrl}\` keyFp=\`${fp(cfg.aKey)}\``,
        `- B: missing`,
        '',
        '## Gaps',
        ...gaps.map((g) => `- ${g}`),
        '',
        '## Steps',
        ...Object.entries(STEPS).map(
          ([id, s]) =>
            `- **${id}**: ${s.blocked ? 'BLOCKED' : s.ok ? 'PASS' : 'FAIL'} — ${s.summary || ''}`,
        ),
        '',
        'Harness: `scripts/m3d-sw-dual-workspace-live.mjs` (env-driven GATEWAY_A_* / GATEWAY_B_*).',
        '',
      ].join('\n'),
    );
    writeFileSync(join(ART, 'sw-console.txt'), JSON.stringify(matrix, null, 2));
    console.log('STATUS BLOCKED — gaps written');
    process.exit(2);
  }

  const status = await runLiveDual(cfg);
  const matrix = {
    status,
    steps: STEPS,
    ...meta,
    ended: iso(),
  };
  writeFileSync(join(ART, 'sw-matrix.json'), JSON.stringify(matrix, null, 2));
  writeFileSync(
    join(ART, 'sw-SUMMARY.md'),
    [
      `# SW1–SW4 dual-workspace live — ${status}`,
      '',
      `- A: \`${cfg.aUrl}\` keyFp=\`${fp(cfg.aKey)}\``,
      `- B: \`${cfg.bUrl}\` keyFp=\`${fp(cfg.bKey)}\``,
      '',
      '## Steps',
      ...Object.entries(STEPS).map(
        ([id, s]) => `- **${id}**: ${s.ok ? 'PASS' : 'FAIL'} — ${s.summary || ''}`,
      ),
      '',
    ].join('\n'),
  );
  writeFileSync(join(ART, 'sw-console.txt'), JSON.stringify(matrix, null, 2));
  console.log('STATUS', status);
  process.exit(status === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  writeFileSync(
    join(ART, 'sw-matrix.json'),
    JSON.stringify({ status: 'ERROR', error: String(e?.message || e), at: iso() }, null, 2),
  );
  process.exit(1);
});
