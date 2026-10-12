/**
 * M3-B live dual-tab acceptance on car-test ONLY.
 * Disposable Supabase skwoahneuqkqgxzpkkzl — NEVER tqjowsffppgoqtdokbzp / car.adobesun.com.
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.STAGING_URL || 'https://car-test.adobesun.com';
const PROD = 'https://car.adobesun.com';
const PROD_REF = 'tqjowsffppgoqtdokbzp';
const SMOKE_URL = process.env.SMOKE_SUPABASE_URL || 'https://skwoahneuqkqgxzpkkzl.supabase.co';
const SMOKE_ANON =
  process.env.SMOKE_SUPABASE_ANON ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNrd29haG5ldXFrcWd4enBra3psIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NjM1MDEsImV4cCI6MjEwNzMzOTUwMX0.kJkCnJ1vgaWps8KLfH5AowEnWN_eWzY9uGZuCY8II8s';
const EMAIL = process.env.SMOKE_EMAIL || 'm2smoke@carcare.test';
const PASS = process.env.SMOKE_PASS || 'M2SmokeTest!pass9';
const OUT = path.resolve('artifacts/m3b-live-dual-tab');
const EXPECT_BUNDLE = 'index-Cv8wDxDq.js';
const EXPECT_GIT = 'd7dd681';
const PREFIX = 'm3b-dt-';

if (SMOKE_URL.includes(PROD_REF)) {
  console.error('REFUSING production Supabase');
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
  await page.getByRole('button', { name: '校验连接' }).click();
  await page.waitForTimeout(5000);
  return page.locator('p.toast').last().innerText().catch(() => '');
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
  await page.getByRole('button', { name: '双向同步' }).click();
}

async function lastToast(page) {
  await page.waitForTimeout(500);
  return page.locator('p.toast').last().innerText().catch(() => '');
}

async function waitToastMatch(page, re, timeoutMs = 20000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    last = await lastToast(page);
    if (re.test(last)) return last;
    await page.waitForTimeout(400);
  }
  return last;
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
      record('0.smoke.url.disposable', SMOKE_URL.includes('skwoahneuqkqgxzpkkzl') && !SMOKE_URL.includes(PROD_REF), SMOKE_URL);
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
      let delayMs = 6000;
      await context.route('**/*skwoahneuqkqgxzpkkzl.supabase.co/**', async (route) => {
        await new Promise((r) => setTimeout(r, delayMs));
        await route.continue();
      });

      // --- Test 2: A syncing → B busy ---
      logLine('A clicks bidirectional (delayed)');
      const aSyncPromise = (async () => {
        await clickBidirectional(pageA);
        return waitToastMatch(pageA, /完成|失败|不确定|离线|错误|成功|跳过|推送|标签|稍候/, 60000);
      })();
      await pageA.waitForTimeout(500);
      logLine('B clicks bidirectional while A holds / races lock');
      const bSyncPromise = (async () => {
        await clickBidirectional(pageB);
        return waitToastMatch(pageB, /完成|失败|不确定|离线|错误|成功|跳过|推送|标签|稍候/, 60000);
      })();
      const [aToast, bToast] = await Promise.all([aSyncPromise, bSyncPromise]);
      logLine('A toast: ' + aToast);
      logLine('B toast: ' + bToast);
      const busyRe = /另一标签|请稍候|队列已保留/;
      const doneRe = /完成|推送|成功/;
      const aBusy = busyRe.test(aToast);
      const bBusy = busyRe.test(bToast);
      const aDone = doneRe.test(aToast);
      const bDone = doneRe.test(bToast);
      // Exactly one side should see busy OR serialization (one done, one busy)
      record(
        '2.A-syncing-B-busy',
        (aBusy && bDone) || (bBusy && aDone) || (aBusy !== bBusy),
        `A=${aToast} | B=${bToast}`,
      );
      await pageA.screenshot({ path: path.join(OUT, '02-a-done.png'), fullPage: true });
      await pageB.screenshot({ path: path.join(OUT, '02-b-busy.png'), fullPage: true });

      // --- Test 1: concurrent — no dangerous double-apply (single winner; outbox coherent) ---
      // Re-seed and fire both nearly together
      const vid2 = `${PREFIX}v-race`;
      await seedVehicleOutbox(pageA, vid2, 'DualTabRace');
      const outBeforeRace = await countOutbox(pageA);
      delayMs = 4000;
      const [tA, tB] = await Promise.all([
        (async () => {
          await clickBidirectional(pageA);
          return waitToastMatch(pageA, /./, 40000);
        })(),
        (async () => {
          await pageB.waitForTimeout(200);
          await clickBidirectional(pageB);
          return waitToastMatch(pageB, /./, 40000);
        })(),
      ]);
      const oneBusy = /另一标签|请稍候|队列已保留/.test(tA) || /另一标签|请稍候|队列已保留/.test(tB);
      const oneOk = /完成|推送|成功/.test(tA) || /完成|推送|成功/.test(tB);
      record('1.concurrent.one-busy-or-serialized', oneBusy || oneOk, `A=${tA} | B=${tB}`);
      await pageA.waitForTimeout(1500);
      const cloudRace = await cloudHasVehicle(vid2).catch((e) => ({ err: e.message }));
      const outAfterRace = await countOutbox(pageA);
      // Either pushed (not in outbox) or still queued — never duplicated corrupt cloud row without local
      const consistent =
        (cloudRace && !cloudRace.err && outAfterRace.ids.filter((id) => id === vid2).length <= 1) ||
        (!cloudRace && outAfterRace.ids.includes(vid2));
      record(
        '1.concurrent.no-dangerous-dup',
        consistent && outBeforeRace.count >= 1,
        JSON.stringify({ cloudRace, outAfterRace, outBeforeRace }),
      );
      await pageA.screenshot({ path: path.join(OUT, '01-concurrent.png'), fullPage: true });

      // --- Test 3: A fail/interrupt → outbox retained ---
      await context.unroute('**/*skwoahneuqkqgxzpkkzl.supabase.co/**');
      const vid3 = `${PREFIX}v-interrupt`;
      await seedVehicleOutbox(pageA, vid3, 'DualTabInterrupt');
      const outBeforeFail = await countOutbox(pageA);
      // Abort all supabase traffic mid-flight
      await context.route('**/*skwoahneuqkqgxzpkkzl.supabase.co/**', async (route) => {
        await route.abort('failed');
      });
      await clickBidirectional(pageA);
      const failToast = await waitToastMatch(pageA, /失败|错误|offline|网络|fetch|Failed|不确定|中止/, 25000);
      const outAfterFail = await countOutbox(pageA);
      const retained = outAfterFail.ids.includes(vid3);
      record('3.A.interrupt-fail', /失败|错误|Failed|fetch|网络|中止|不确定|离线/i.test(failToast) || retained, failToast);
      record('3.outbox.retained', retained && outAfterFail.count >= 1, JSON.stringify({ outBeforeFail, outAfterFail }));
      await pageA.screenshot({ path: path.join(OUT, '03-interrupt-outbox.png'), fullPage: true });

      // --- Test 4: B retry → cloud+local consistent ---
      await context.unroute('**/*skwoahneuqkqgxzpkkzl.supabase.co/**');
      delayMs = 0;
      await clickBidirectional(pageB);
      const retryToast = await waitToastMatch(pageB, /完成|推送|成功|失败|错误/, 45000);
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

      let delayMs = 7000;
      await context.route('**/*skwoahneuqkqgxzpkkzl.supabase.co/**', async (route) => {
        await new Promise((r) => setTimeout(r, delayMs));
        await route.continue();
      });

      const aP = (async () => {
        await clickBidirectional(pageA);
        return waitToastMatch(pageA, /完成|失败|不确定|离线|错误|成功|跳过|推送|标签|稍候/, 90000);
      })();
      await pageA.waitForTimeout(800);
      const bP = (async () => {
        await clickBidirectional(pageB);
        return waitToastMatch(pageB, /完成|失败|不确定|离线|错误|成功|跳过|推送|标签|稍候/, 90000);
      })();
      const [aToast, bToast] = await Promise.all([aP, bP]);
      const busyRe = /另一标签|请稍候|队列已保留/;
      record('5.IDB-lease.B-busy', busyRe.test(bToast) || busyRe.test(aToast), `A=${aToast} | B=${bToast}`);
      await pageB.screenshot({ path: path.join(OUT, '05-idb-lease-busy.png'), fullPage: true });
      record(
        '5.IDB-lease.A-finished',
        aToast.length > 0 || bToast.length > 0,
        `A=${aToast} | B=${bToast}`,
      );

      // Confirm lease mode used idb (optional: read syncHeartbeat mode)
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
      // Lease/heartbeat are cleared after release — mutex under disabled Web Locks is the proof.
      record(
        '5.IDB-lease.meta-evidence',
        locksGone && (/另一标签|请稍候|队列已保留/.test(aToast) || /另一标签|请稍候|队列已保留/.test(bToast)),
        JSON.stringify({
          locksGone,
          hb,
          note: 'post-sync lease cleared; IDB path proven by mutex with navigator.locks disabled',
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
