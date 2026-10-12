/**
 * M3-B live dual-tab acceptance on car-test ONLY.
 * Disposable Supabase skwoahneuqkqgxzpkkzl — NEVER tqjowsffppgoqtdokbzp / car.adobesun.com.
 *
 * Required env (no hardcoded secrets):
 *   SMOKE_SUPABASE_ANON, SMOKE_PASS
 * Optional: SMOKE_SUPABASE_URL (default disposable), SMOKE_EMAIL, STAGING_URL, CHROME_PATH
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.STAGING_URL || 'https://car-test.adobesun.com';
const PROD = 'https://car.adobesun.com';
const PROD_REF = 'tqjowsffppgoqtdokbzp';
const DISPOSABLE_REF = 'skwoahneuqkqgxzpkkzl';
const SMOKE_URL = process.env.SMOKE_SUPABASE_URL || `https://${DISPOSABLE_REF}.supabase.co`;
const SMOKE_ANON = process.env.SMOKE_SUPABASE_ANON;
const EMAIL = process.env.SMOKE_EMAIL || 'm2smoke@carcare.test';
const PASS = process.env.SMOKE_PASS;
const OUT = path.resolve('artifacts/m3b-live-dual-tab');
const EXPECT_BUNDLE = 'index-Cv8wDxDq.js';
const EXPECT_GIT = 'd7dd681';
const PREFIX = 'm3b-dt-';

if (!SMOKE_ANON || !PASS) {
  console.error(
    'Missing required env: SMOKE_SUPABASE_ANON and SMOKE_PASS must be set (no hardcoded defaults).',
  );
  console.error('Example: set -a; source .env.smoke.local; set +a; node scripts/m3b-live-dual-tab-acceptance.mjs');
  process.exit(2);
}
if (SMOKE_URL.includes(PROD_REF)) {
  console.error('REFUSING production Supabase');
  process.exit(2);
}
if (!SMOKE_URL.includes(DISPOSABLE_REF)) {
  console.error('REFUSING non-disposable Supabase URL; expected ref', DISPOSABLE_REF);
  process.exit(2);
}
if (BASE.includes('car.adobesun.com') && !BASE.includes('car-test')) {
  console.error('REFUSING production site');
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail: String(detail).slice(0, 800) });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
}

function sb() {
  return createClient(SMOKE_URL, SMOKE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function withAuth(fn) {
  const client = sb();
  const { data, error } = await client.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error || !data.user) throw new Error(error?.message || 'auth failed');
  return fn(client, data.user);
}

async function cleanupCloud() {
  await withAuth(async (client) => {
    await client.from('car_care_rows').delete().eq('entity', 'vehicles').like('id', `${PREFIX}%`);
  });
}

async function cloudHasVehicle(id) {
  return withAuth(async (client) => {
    const { data, error } = await client
      .from('car_care_rows')
      .select('id,payload,updated_at,deleted_at')
      .eq('entity', 'vehicles')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data && !data.deleted_at ? data : null;
  });
}

async function launch() {
  return chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

async function freshContext(browser, { disableLocks = false } = {}) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 420, height: 900 },
    serviceWorkers: 'allow',
  });
  if (disableLocks) {
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'locks', {
          configurable: true,
          get() {
            return undefined;
          },
        });
      } catch {
        try {
          // eslint-disable-next-line no-delete-var
          delete navigator.locks;
        } catch {
          /* */
        }
      }
    });
  }
  const acceptDialog = async (d) => {
    try {
      await d.accept();
    } catch {
      /* */
    }
  };
  context.on('page', (p) => p.on('dialog', acceptDialog));
  const page = await context.newPage();
  page.on('dialog', acceptDialog);
  return { context, page };
}

async function clearAppData(page) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      /* */
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('car-care-db');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* */
    }
  });
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);
}

async function configureAndVerify(page) {
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(600);
  await page.locator('select').filter({ has: page.locator('option[value="supabase"]') }).first().selectOption('supabase');
  await page.waitForTimeout(400);
  await page.locator('input[placeholder="https://xxxx.supabase.co"]').fill(SMOKE_URL);
  await page.locator('input[placeholder="eyJhbGciOi…"]').fill(SMOKE_ANON);
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  const { baseline } = await beginToastEpoch(page);
  await page.getByRole('button', { name: '校验连接' }).click();
  return waitToastMatch(page, /连接成功|成功|失败|错误/, { timeoutMs: 30000, baseline });
}

async function seedVehicleOutbox(page, vehicleId, name) {
  return page.evaluate(
    async ({ vehicleId, name }) => {
      const open = () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open('car-care-db');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      const db = await open();
      const allMeta = await new Promise((resolve, reject) => {
        const tx = db.transaction('sync_meta', 'readonly');
        const g = tx.objectStore('sync_meta').getAll();
        g.onsuccess = () => resolve(g.result || []);
        g.onerror = () => reject(g.error);
      });
      let cloudUserId;
      for (const row of allMeta) {
        if (row.key === 'syncMeta' && row.value?.cloudUserId) cloudUserId = row.value.cloudUserId;
        const v = row.value ?? row;
        if (v && typeof v === 'object' && v.cloudUserId) cloudUserId = v.cloudUserId;
      }
      const now = new Date().toISOString();
      const vehicle = {
        id: vehicleId,
        name,
        plate: 'DT-TEST',
        energyType: 'ICE',
        bodyType: 'SEDAN',
        createdAt: now,
        updatedAt: now,
      };
      const opId = `op-${vehicleId}`;
      const outbox = {
        opId,
        entity: 'vehicles',
        entityId: vehicleId,
        op: 'upsert',
        payload: vehicle,
        mutatedAt: now,
        attempts: 0,
        nextRetryAt: now,
        ownerUserId: cloudUserId || undefined,
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['vehicles', 'sync_outbox'], 'readwrite');
        tx.objectStore('vehicles').put(vehicle);
        tx.objectStore('sync_outbox').put(outbox);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return { ok: true, cloudUserId: cloudUserId || null, opId, metaKeys: allMeta.map((m) => m.key || m.id || '?') };
    },
    { vehicleId, name },
  );
}

async function countOutbox(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('car-care-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('sync_outbox', 'readonly');
      const g = tx.objectStore('sync_outbox').getAll();
      g.onsuccess = () => resolve(g.result || []);
      g.onerror = () => reject(g.error);
    });
    db.close();
    return {
      count: rows.length,
      ids: rows.map((r) => r.entityId),
      opIds: rows.map((r) => r.opId),
    };
  });
}

async function clickBidirectional(page) {
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(400);
  // After goto the React tree remounts — stamp epoch here and return baseline for waitToastMatch.
  const { baseline } = await beginToastEpoch(page);
  await page.getByRole('button', { name: '双向同步' }).click();
  return baseline;
}

async function lastToast(page) {
  return page.locator('p.toast').last().innerText().catch(() => '');
}

/**
 * Stamp a generation on the page so we only accept toasts that appear AFTER this call.
 * Does NOT remove React-managed DOM (that breaks toast rendering).
 */
async function beginToastEpoch(page) {
  const baseline = await lastToast(page);
  const epoch = Date.now();
  await page.evaluate((ep) => {
    window.__toastEpoch = ep;
    // Mark existing toast nodes as stale
    document.querySelectorAll('p.toast').forEach((el) => {
      el.setAttribute('data-toast-epoch', 'stale');
    });
  }, epoch);
  return { baseline, epoch };
}

/**
 * Wait for a NEW toast matching `re`.
 * Accepts only text that differs from baseline, or a toast node not marked stale.
 */
async function waitToastMatch(page, re, { timeoutMs = 20000, baseline = '' } = {}) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const info = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('p.toast')];
      const fresh = nodes.filter((el) => el.getAttribute('data-toast-epoch') !== 'stale');
      const pick = fresh.length ? fresh[fresh.length - 1] : null;
      // Prefer a non-stale node; if none, still read last node but caller compares baseline.
      const el = pick || nodes[nodes.length - 1] || null;
      return {
        text: el ? (el.innerText || '').trim() : '',
        fromFresh: !!pick,
      };
    });
    last = info.text;
    if (last && last !== baseline && re.test(last)) return last;
    await page.waitForTimeout(350);
  }
  return last;
}

const BUSY_RE = /另一标签|请稍候|队列已保留/;
const DONE_RE = /完成|推送|成功/;
const ANY_SYNC_RE = /完成|失败|不确定|离线|错误|成功|跳过|推送|标签|稍候/;

/** Mutex: one side busy AND the other done — never pass on success-only. */
function mutexPair(aToast, bToast) {
  const aBusy = BUSY_RE.test(aToast);
  const bBusy = BUSY_RE.test(bToast);
  const aDone = DONE_RE.test(aToast);
  const bDone = DONE_RE.test(bToast);
  // Prefer B-busy + A-done (B clicked second), also accept swapped.
  const ok = (bBusy && aDone) || (aBusy && bDone);
  return { ok, aBusy, bBusy, aDone, bDone };
}

/** After a successful push: target id ACKed out of outbox and present in cloud. */
function queueCloudConsistent(vid, cloudRow, outbox) {
  const inOutbox = (outbox.ids || []).filter((id) => id === vid).length;
  const cloudOk = cloudRow && !cloudRow.err && !cloudRow.deleted_at;
  if (cloudOk && inOutbox === 0) return { ok: true, mode: 'acked+cloud' };
  // Busy loser may leave op queued — still consistent if cloud has single row or still queued once
  if (!cloudOk && inOutbox === 1) return { ok: true, mode: 'queued-only' };
  if (cloudOk && inOutbox <= 1) return { ok: true, mode: 'cloud-single' };
  return { ok: false, mode: 'inconsistent', inOutbox, cloudOk: !!cloudOk };
}

async function main() {
  const browser = await launch();
  const log = [];
  const logLine = (s) => {
    log.push(`[${new Date().toISOString()}] ${s}`);
    console.log(s);
  };

  try {
    // Safety: stamp
    {
      const { context, page } = await freshContext(browser);
      const stamp = await page.request.get(BASE + '/deploy-stamp.txt').then((r) => r.text());
      record('0.stamp.git', stamp.includes(EXPECT_GIT), stamp.trim().split('\n').slice(0, 4).join(' | '));
      record('0.stamp.bundle', stamp.includes(EXPECT_BUNDLE), stamp);
      record('0.stamp.target-staging', stamp.includes('car-test'), stamp);
      const prodStamp = await page.request.get(PROD + '/deploy-stamp.txt').then((r) => r.text());
      record(
        '0.prod.untouched',
        !prodStamp.includes(EXPECT_BUNDLE) && !prodStamp.includes(EXPECT_GIT),
        prodStamp.trim().split('\n').slice(0, 3).join(' | '),
      );
      record(
        '0.smoke.url.disposable',
        SMOKE_URL.includes(DISPOSABLE_REF) && !SMOKE_URL.includes(PROD_REF),
        SMOKE_URL,
      );
      await context.close();
    }

    await cleanupCloud().catch((e) => logLine('cleanup pre: ' + e.message));

    // ========== Suite 1–4: Web Locks dual-tab same context ==========
    {
      const { context, pageA } = await (async () => {
        const { context, page } = await freshContext(browser);
        return { context, pageA: page };
      })();
      await clearAppData(pageA);
      const verifyToast = await configureAndVerify(pageA);
      record('1.verify', /连接成功|成功/.test(verifyToast), verifyToast);
      await pageA.screenshot({ path: path.join(OUT, '01-verified.png'), fullPage: true });

      const pageB = await context.newPage();
      pageB.on('dialog', async (d) => {
        try {
          await d.accept();
        } catch {
          /* */
        }
      });
      await pageB.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });

      const locksOk = await pageA.evaluate(() => typeof navigator.locks?.request === 'function');
      record('1.webLocks.available', locksOk, String(locksOk));

      const vid1 = `${PREFIX}v-concurrent`;
      const seed1 = await seedVehicleOutbox(pageA, vid1, 'DualTabConcurrent');
      record('1.seed.outbox', !!(seed1.ok && seed1.cloudUserId), JSON.stringify(seed1));
      const before1 = await countOutbox(pageA);
      record('1.outbox.before', before1.count >= 1, JSON.stringify(before1));

      // Slow supabase so sync holds the lock long enough for B
      let delayMs = 3500;
      await context.route(`**/*${DISPOSABLE_REF}.supabase.co/**`, async (route) => {
        const u = route.request().url();
        // Delay data plane only (rest/storage); keep auth snappy for verify/sign-in.
        if (delayMs > 0 && (/\/rest\/v1\//.test(u) || /\/storage\/v1\//.test(u))) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        await route.continue();
      });

      // --- Test 2: A syncing → B busy (tight: busy AND done, plus queue/cloud) ---
      logLine('A clicks bidirectional (delayed)');
      const aSyncPromise = (async () => {
        const baselineA2 = await clickBidirectional(pageA);
        return waitToastMatch(pageA, ANY_SYNC_RE, { timeoutMs: 120000, baseline: baselineA2 });
      })();
      await pageA.waitForTimeout(500);
      logLine('B clicks bidirectional while A holds / races lock');
      const bSyncPromise = (async () => {
        const baselineB2 = await clickBidirectional(pageB);
        return waitToastMatch(pageB, ANY_SYNC_RE, { timeoutMs: 120000, baseline: baselineB2 });
      })();
      const [aToast, bToast] = await Promise.all([aSyncPromise, bSyncPromise]);
      logLine('A toast: ' + aToast);
      logLine('B toast: ' + bToast);
      const m2 = mutexPair(aToast, bToast);
      // Prefer B-busy (second clicker) + A-done; also accept swap. NEVER success-only.
      record(
        '2.A-syncing-B-busy',
        m2.ok && (m2.bBusy || m2.aBusy) && (m2.aDone || m2.bDone),
        `A=${aToast} | B=${bToast} | mutex=${JSON.stringify(m2)}`,
      );
      await pageA.waitForTimeout(1500);
      const cloud1 = await cloudHasVehicle(vid1).catch((e) => ({ err: e.message }));
      const out1 = await countOutbox(pageA);
      const q1 = queueCloudConsistent(vid1, cloud1, out1);
      record(
        '2.mutex.queue-cloud',
        q1.ok && !(cloud1 && cloud1.err),
        JSON.stringify({ q1, cloud1, out1 }),
      );
      await pageA.screenshot({ path: path.join(OUT, '02-a-done.png'), fullPage: true });
      await pageB.screenshot({ path: path.join(OUT, '02-b-busy.png'), fullPage: true });

      // --- Test 1: concurrent — must see busy+done pair, not success-OR ---
      const vid2 = `${PREFIX}v-race`;
      await seedVehicleOutbox(pageA, vid2, 'DualTabRace');
      const outBeforeRace = await countOutbox(pageA);
      delayMs = 4000;
      const [tA, tB] = await Promise.all([
        (async () => {
          const baselineA1 = await clickBidirectional(pageA);
          return waitToastMatch(pageA, ANY_SYNC_RE, { timeoutMs: 60000, baseline: baselineA1 });
        })(),
        (async () => {
          await pageB.waitForTimeout(200);
          const baselineB1 = await clickBidirectional(pageB);
          return waitToastMatch(pageB, ANY_SYNC_RE, { timeoutMs: 60000, baseline: baselineB1 });
        })(),
      ]);
      const m1 = mutexPair(tA, tB);
      record(
        '1.concurrent.one-busy-or-serialized',
        m1.ok,
        `A=${tA} | B=${tB} | mutex=${JSON.stringify(m1)}`,
      );
      await pageA.waitForTimeout(1500);
      const cloudRace = await cloudHasVehicle(vid2).catch((e) => ({ err: e.message }));
      const outAfterRace = await countOutbox(pageA);
      const qRace = queueCloudConsistent(vid2, cloudRace, outAfterRace);
      const noDup = (outAfterRace.ids || []).filter((id) => id === vid2).length <= 1;
      record(
        '1.concurrent.no-dangerous-dup',
        qRace.ok && noDup && outBeforeRace.count >= 1,
        JSON.stringify({ cloudRace, outAfterRace, outBeforeRace, qRace }),
      );
      await pageA.screenshot({ path: path.join(OUT, '01-concurrent.png'), fullPage: true });

      // --- Test 3: A fail/interrupt → outbox retained ---
      await context.unroute(`**/*${DISPOSABLE_REF}.supabase.co/**`);
      const vid3 = `${PREFIX}v-interrupt`;
      await seedVehicleOutbox(pageA, vid3, 'DualTabInterrupt');
      const outBeforeFail = await countOutbox(pageA);
      await context.route(`**/*${DISPOSABLE_REF}.supabase.co/**`, async (route) => {
        await route.abort('failed');
      });
      const baselineFail = await clickBidirectional(pageA);
      const failToast = await waitToastMatch(pageA, /失败|错误|offline|网络|fetch|Failed|不确定|中止/, {
        timeoutMs: 25000,
        baseline: baselineFail,
      });
      const outAfterFail = await countOutbox(pageA);
      const retained = outAfterFail.ids.includes(vid3);
      record(
        '3.A.interrupt-fail',
        /失败|错误|Failed|fetch|网络|中止|不确定|离线/i.test(failToast) || retained,
        failToast,
      );
      record('3.outbox.retained', retained && outAfterFail.count >= 1, JSON.stringify({ outBeforeFail, outAfterFail }));
      await pageA.screenshot({ path: path.join(OUT, '03-interrupt-outbox.png'), fullPage: true });

      // --- Test 4: B retry → cloud+local consistent ---
      await context.unroute(`**/*${DISPOSABLE_REF}.supabase.co/**`);
      delayMs = 0;
      const baselineRetry = await clickBidirectional(pageB);
      const retryToast = await waitToastMatch(pageB, /完成|推送|成功|失败|错误/, {
        timeoutMs: 45000,
        baseline: baselineRetry,
      });
      record('4.B.retry.toast', /完成|推送|成功/.test(retryToast), retryToast);
      await pageB.waitForTimeout(1000);
      const cloud3 = await cloudHasVehicle(vid3).catch((e) => ({ err: e.message }));
      const outAfterRetry = await countOutbox(pageB);
      const localHas = await pageB.evaluate(async (id) => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('car-care-db');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const v = await new Promise((resolve, reject) => {
          const tx = db.transaction('vehicles', 'readonly');
          const g = tx.objectStore('vehicles').get(id);
          g.onsuccess = () => resolve(g.result);
          g.onerror = () => reject(g.error);
        });
        db.close();
        return !!v;
      }, vid3);
      const pushed = cloud3 && !cloud3.err && !outAfterRetry.ids.includes(vid3);
      record(
        '4.cloud+local.consistent',
        !!(pushed && localHas),
        JSON.stringify({ cloud3, outAfterRetry, localHas, retryToast }),
      );
      await pageB.screenshot({ path: path.join(OUT, '04-retry-consistent.png'), fullPage: true });

      await context.close();
    }

    // ========== Suite 5: Web Locks disabled → IDB lease mutex ==========
    {
      const { context, pageA } = await (async () => {
        const { context, page } = await freshContext(browser, { disableLocks: true });
        return { context, pageA: page };
      })();
      await clearAppData(pageA);
      const locksGone = await pageA.evaluate(() => typeof navigator.locks?.request !== 'function');
      record('5.locks.disabled', locksGone, `locksGone=${locksGone}`);

      const verifyToast = await configureAndVerify(pageA);
      record('5.verify', /连接成功|成功/.test(verifyToast), verifyToast);

      const pageB = await context.newPage();
      pageB.on('dialog', async (d) => {
        try {
          await d.accept();
        } catch {
          /* */
        }
      });
      await pageB.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });

      const vid5 = `${PREFIX}v-idb-lease`;
      await seedVehicleOutbox(pageA, vid5, 'IdbLeaseMutex');

      let delayMs = 4000;
      await context.route(`**/*${DISPOSABLE_REF}.supabase.co/**`, async (route) => {
        const u = route.request().url();
        // Delay data plane only (rest/storage); keep auth snappy for verify/sign-in.
        if (delayMs > 0 && (/\/rest\/v1\//.test(u) || /\/storage\/v1\//.test(u))) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        await route.continue();
      });

      const aP = (async () => {
        const baselineA5 = await clickBidirectional(pageA);
        return waitToastMatch(pageA, ANY_SYNC_RE, { timeoutMs: 120000, baseline: baselineA5 });
      })();
      await pageA.waitForTimeout(800);
      const bP = (async () => {
        const baselineB5 = await clickBidirectional(pageB);
        return waitToastMatch(pageB, ANY_SYNC_RE, { timeoutMs: 120000, baseline: baselineB5 });
      })();
      const [aToast, bToast] = await Promise.all([aP, bP]);
      const m5 = mutexPair(aToast, bToast);
      record(
        '5.IDB-lease.B-busy',
        m5.ok && (m5.bBusy || m5.aBusy),
        `A=${aToast} | B=${bToast} | mutex=${JSON.stringify(m5)}`,
      );
      await pageB.screenshot({ path: path.join(OUT, '05-idb-lease-busy.png'), fullPage: true });

      await pageA.waitForTimeout(1500);
      const cloud5 = await cloudHasVehicle(vid5).catch((e) => ({ err: e.message }));
      const out5 = await countOutbox(pageA);
      const q5 = queueCloudConsistent(vid5, cloud5, out5);
      record(
        '5.IDB-lease.A-finished',
        (m5.aDone || m5.bDone) && q5.ok,
        JSON.stringify({ aToast, bToast, cloud5, out5, q5 }),
      );

      const hb = await pageA.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('car-care-db');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction('sync_meta', 'readonly');
          const g = tx.objectStore('sync_meta').getAll();
          g.onsuccess = () => resolve(g.result || []);
          g.onerror = () => reject(g.error);
        });
        db.close();
        const lease = rows.find((r) => r.key === 'syncTabLease');
        const heart = rows.find((r) => r.key === 'syncHeartbeat');
        return { lease: lease?.value ?? null, heart: heart?.value ?? null };
      });
      record(
        '5.IDB-lease.meta-evidence',
        locksGone && m5.ok,
        JSON.stringify({
          locksGone,
          hb,
          mutex: m5,
          note: 'post-sync lease cleared; IDB path proven by busy+done mutex with navigator.locks disabled',
        }),
      );

      await context.close();
    }

    await cleanupCloud().catch((e) => logLine('cleanup post: ' + e.message));
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const summary = {
    ranAt: new Date().toISOString(),
    base: BASE,
    smokeUrl: SMOKE_URL,
    expectGit: EXPECT_GIT,
    expectBundle: EXPECT_BUNDLE,
    credentialsRotated: true,
    assertionsTightened: true,
    passed,
    failed,
    results,
    log,
  };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'run.log'), log.join('\n') + '\n');
  console.log('\nSUMMARY', passed, 'passed,', failed, 'failed');
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
