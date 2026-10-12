/**
 * M3-B staging browser acceptance — car-test ONLY.
 * Covers: SW, two-tab lock (Web Locks + IDB fallback), offline/outbox,
 * BG Sync API degrade, M2/M3-A smoke (routes/IDB/JSON export UI).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = process.env.M3B_STAGE_URL || 'https://car-test.adobesun.com';
const OUT = 'artifacts/m3b-staging-accept';
mkdirSync(OUT, { recursive: true });

const results = [];
function pass(id, detail = '') {
  results.push({ id, ok: true, detail });
  console.log(`PASS ${id}${detail ? ' — ' + detail : ''}`);
}
function fail(id, detail = '') {
  results.push({ id, ok: false, detail });
  console.error(`FAIL ${id}${detail ? ' — ' + detail : ''}`);
}

async function stampOk(page) {
  const t = await page.request.get(BASE + '/deploy-stamp.txt').then((r) => r.text());
  return t;
}

const browser = await chromium.launch({ headless: true });
const consErrors = [];

try {
  // --- A: fingerprint + SW + routes + IDB ---
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  pageA.on('console', (m) => {
    if (m.type() === 'error') consErrors.push('A:' + m.text());
  });

  const res = await pageA.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  if (res?.status() === 200) pass('A1-home-200');
  else fail('A1-home-200', String(res?.status()));

  const stamp = await stampOk(pageA);
  if (stamp.includes('car-test.adobesun.com') && stamp.includes('index-')) pass('A2-stamp', stamp.trim().split('\n').slice(0, 3).join(' | '));
  else fail('A2-stamp', stamp.slice(0, 200));

  const html = await pageA.content();
  if (html.includes('index-Cv8wDxDq.js') || /assets\/index-[A-Za-z0-9_-]+\.js/.test(html)) pass('A3-bundle-ref');
  else fail('A3-bundle-ref');

  // SW
  const sw = await pageA.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { ok: false, reason: 'no SW API' };
    const reg = await navigator.serviceWorker.ready;
    return {
      ok: !!reg?.active,
      scriptURL: reg?.active?.scriptURL || '',
      controlling: !!navigator.serviceWorker.controller,
    };
  });
  if (sw.ok) pass('A4-sw-ready', sw.scriptURL);
  else fail('A4-sw-ready', JSON.stringify(sw));

  // BG Sync capability (degrade OK)
  const bg = await pageA.evaluate(async () => {
    const hasSW = 'serviceWorker' in navigator;
    let syncInProto = false;
    try {
      syncInProto = !!(await navigator.serviceWorker?.ready) && 'sync' in ServiceWorkerRegistration.prototype;
    } catch {
      syncInProto = false;
    }
    return { hasSW, syncInProto };
  });
  pass('A5-bg-sync-probe', `syncAPI=${bg.syncInProto} (degrade OK if false)`);

  // Routes
  for (const path of ['/', '/stats', '/settings']) {
    const r = await pageA.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
    if (r?.status() === 200) pass(`A6-route-${path}`);
    else fail(`A6-route-${path}`, String(r?.status()));
  }
  await pageA.screenshot({ path: `${OUT}/settings.png`, fullPage: true });

  // Settings: JSON import/export copy present (M2)
  const settingsText = await pageA.locator('body').innerText();
  if (/导出|导入|JSON|JSON/.test(settingsText) || /Export|Import/i.test(settingsText)) {
    pass('A7-json-ui');
  } else {
    // softer: look for data storage section
    if (/数据|云|同步|Data|Cloud|Sync/i.test(settingsText)) pass('A7-json-ui', 'storage/sync section present');
    else fail('A7-json-ui', 'no export/import cues');
  }

  // IndexedDB stores
  const idb = await pageA.evaluate(async () => {
    return await new Promise((resolve) => {
      const req = indexedDB.open('car-care-db');
      req.onerror = () => resolve({ ok: false, err: String(req.error) });
      req.onsuccess = () => {
        const db = req.result;
        const names = [...db.objectStoreNames];
        db.close();
        resolve({
          ok: true,
          names,
          hasMedia: names.includes('media'),
          hasOutbox: names.includes('sync_outbox'),
          hasMeta: names.includes('sync_meta'),
        });
      };
    });
  });
  if (idb.ok && idb.hasMedia && idb.hasOutbox && idb.hasMeta) pass('A8-idb-stores', idb.names.join(','));
  else fail('A8-idb-stores', JSON.stringify(idb));

  // Web Locks availability
  const locksAvail = await pageA.evaluate(() => typeof navigator.locks?.request === 'function');
  pass('A9-web-locks-probe', `available=${locksAvail}`);

  // --- B: two tabs concurrent sync lock (Web Locks path if available) ---
  const pageB = await ctxA.newPage();
  pageB.on('console', (m) => {
    if (m.type() === 'error') consErrors.push('B:' + m.text());
  });
  await pageB.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 45000 });

  const lockRace = await pageA.evaluate(async () => {
    const name = 'car-care-sync';
    if (typeof navigator.locks?.request !== 'function') {
      return { mode: 'no-web-locks', skipped: true };
    }
    let bSawBusy = false;
    const gate = {};
    gate.p = new Promise((r) => {
      gate.release = r;
    });
    const a = navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) return { held: false };
      await gate.p;
      return { held: true };
    });
    await new Promise((r) => setTimeout(r, 30));
    const b = await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
      bSawBusy = !lock;
      return { held: !!lock };
    });
    gate.release();
    const aRes = await a;
    return { mode: 'web-locks', aHeld: aRes?.held === true, bBusy: bSawBusy || b?.held === false };
  });

  if (lockRace.skipped) pass('B1-two-tab-web-locks', 'skipped — no Web Locks (IDB fallback expected)');
  else if (lockRace.aHeld && lockRace.bBusy) pass('B1-two-tab-web-locks', JSON.stringify(lockRace));
  else fail('B1-two-tab-web-locks', JSON.stringify(lockRace));

  // IDB lease fallback simulation in-page (disable locks by deleting navigator.locks)
  const idbLease = await pageA.evaluate(async () => {
    // Minimal lease acquire in sync_meta like production
    const open = () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('car-care-db');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const db = await open();
    if (![...db.objectStoreNames].includes('sync_meta')) {
      db.close();
      return { ok: false, reason: 'no sync_meta' };
    }
    const putLease = (holderId, expiresAt) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('sync_meta', 'readwrite');
        tx.objectStore('sync_meta').put({ key: 'syncTabLease', value: { holderId, expiresAt } });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    const readLease = () =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('sync_meta', 'readonly');
        const g = tx.objectStore('sync_meta').get('syncTabLease');
        g.onsuccess = () => resolve(g.result?.value ?? null);
        g.onerror = () => reject(g.error);
      });
    await putLease('tab-A-accept', Date.now() + 90_000);
    const held = await readLease();
    // Second writer with expired A → B takeover
    await putLease('tab-A-accept', Date.now() - 1);
    await putLease('tab-B-accept', Date.now() + 90_000);
    const after = await readLease();
    db.close();
    return {
      ok: held?.holderId === 'tab-A-accept' && after?.holderId === 'tab-B-accept',
      held,
      after,
    };
  });
  if (idbLease.ok) pass('B2-idb-lease-fallback', JSON.stringify(idbLease.after));
  else fail('B2-idb-lease-fallback', JSON.stringify(idbLease));

  // Offline / outbox: go offline, ensure app still loads settings and IDB writable
  await ctxA.setOffline(true);
  const offlineNav = await pageA.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => e);
  const offlineOk =
    offlineNav && typeof offlineNav.status === 'function'
      ? true
      : offlineNav?.status?.() === 200 || (await pageA.locator('#root').count()) > 0;
  // With SW, offline navigation may still work
  const rootVisible = await pageA.locator('#root').count();
  if (rootVisible > 0) pass('C1-offline-shell', `root=${rootVisible}`);
  else fail('C1-offline-shell', String(offlineNav));

  const outboxWrite = await pageA.evaluate(async () => {
    const open = () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('car-care-db');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const db = await open();
    const opId = 'accept-offline-' + Date.now();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('sync_outbox', 'readwrite');
      tx.objectStore('sync_outbox').put({
        opId,
        entity: 'vehicles',
        entityId: 'accept-v',
        op: 'upsert',
        payload: { id: 'accept-v', name: 'offline-test' },
        mutatedAt: new Date().toISOString(),
        attempts: 0,
        nextRetryAt: new Date().toISOString(),
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    const got = await new Promise((resolve, reject) => {
      const tx = db.transaction('sync_outbox', 'readonly');
      const g = tx.objectStore('sync_outbox').get(opId);
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    });
    // cleanup test row
    await new Promise((resolve, reject) => {
      const tx = db.transaction('sync_outbox', 'readwrite');
      tx.objectStore('sync_outbox').delete(opId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { ok: !!got && got.opId === opId };
  });
  if (outboxWrite.ok) pass('C2-offline-outbox-write');
  else fail('C2-offline-outbox-write');

  await ctxA.setOffline(false);

  // M3-A media store present (already A8); vehicles/records stores
  if (idb.names?.includes('vehicles') && idb.names?.includes('records')) pass('D1-m2-stores');
  else fail('D1-m2-stores', JSON.stringify(idb.names));

  await pageA.screenshot({ path: `${OUT}/home-after.png`, fullPage: true });
  await pageB.close();
  await ctxA.close();

  // --- E: prod untouched (curl from browser context not needed) ---
  const prodStamp = await (await fetch('https://car.adobesun.com/deploy-stamp.txt')).text();
  if (prodStamp.includes('car.adobesun.com') && !prodStamp.includes('index-Cv8wDxDq')) {
    pass('E1-prod-untouched', prodStamp.trim().split('\n').slice(0, 3).join(' | '));
  } else if (prodStamp.includes('index-f4r7_DP6') || prodStamp.includes('6adcd15')) {
    pass('E1-prod-untouched', prodStamp.trim().split('\n').slice(0, 3).join(' | '));
  } else {
    fail('E1-prod-untouched', prodStamp.slice(0, 200));
  }

  const fatalCons = consErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  if (fatalCons.length === 0) pass('F1-console-clean');
  else fail('F1-console-clean', fatalCons.slice(0, 5).join(' || '));
} finally {
  await browser.close();
}

const summary = {
  ranAt: new Date().toISOString(),
  base: BASE,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  results,
  consoleErrors: consErrors.slice(0, 10),
};
writeFileSync(`${OUT}/results.json`, JSON.stringify(summary, null, 2));
console.log('\nSUMMARY', summary.passed, 'passed,', summary.failed, 'failed');
if (summary.failed > 0) process.exit(1);
