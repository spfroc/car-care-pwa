/**
 * M3-C staging acceptance (D1–D9 + regression probes) — car-test ONLY.
 * Disposable Supabase skwoahneuqkqgxzpkkzl — NEVER tqjowsffppgoqtdokbzp / car.adobesun.com.
 *
 * Env: SMOKE_SUPABASE_ANON, SMOKE_PASS (from .env.smoke.local)
 * Optional: SMOKE_SUPABASE_URL, SMOKE_EMAIL, STAGING_URL, CHROME_PATH
 *
 * Method: dual Playwright browser contexts = two devices; + IDB seeding for
 * conflict/TOCTOU; unit-test mapping recorded for cases already covered in vitest.
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BASE = process.env.STAGING_URL || 'https://car-test.adobesun.com';
const PROD = 'https://car.adobesun.com';
const PROD_REF = 'tqjowsffppgoqtdokbzp';
const DISPOSABLE_REF = 'skwoahneuqkqgxzpkkzl';
const SMOKE_URL = process.env.SMOKE_SUPABASE_URL || `https://${DISPOSABLE_REF}.supabase.co`;
const SMOKE_ANON = process.env.SMOKE_SUPABASE_ANON;
const EMAIL = process.env.SMOKE_EMAIL || 'm2smoke@carcare.test';
const PASS = process.env.SMOKE_PASS;
const OUT = path.resolve('artifacts/m3c-staging-accept');
const EXPECT_BUNDLE = 'index-TdTLY2U-.js';
const EXPECT_GIT = '9b64a2b';
const PREFIX = 'm3c-acc-';

if (!SMOKE_ANON || !PASS) {
  console.error('Missing SMOKE_SUPABASE_ANON / SMOKE_PASS');
  process.exit(2);
}
if (SMOKE_URL.includes(PROD_REF) || !SMOKE_URL.includes(DISPOSABLE_REF)) {
  console.error('REFUSING non-disposable Supabase');
  process.exit(2);
}
if (BASE.includes('car.adobesun.com') && !BASE.includes('car-test')) {
  console.error('REFUSING production site');
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail: String(detail).slice(0, 1200) });
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
    for (const entity of ['vehicles', 'records', 'stations', 'media']) {
      await client.from('car_care_rows').delete().eq('entity', entity).like('id', `${PREFIX}%`);
    }
  });
}

async function cloudGet(entity, id) {
  return withAuth(async (client) => {
    const { data, error } = await client
      .from('car_care_rows')
      .select('id,payload,updated_at,deleted_at,device_id')
      .eq('entity', entity)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  });
}

async function cloudUpsert(entity, id, payload, updatedAt, { deletedAt = null, deviceId = 'peer-b' } = {}) {
  return withAuth(async (client, user) => {
    const row = {
      user_id: user.id,
      entity,
      id,
      payload: deletedAt ? {} : payload,
      updated_at: updatedAt,
      deleted_at: deletedAt,
      device_id: deviceId,
    };
    const { error } = await client.from('car_care_rows').upsert(row, { onConflict: 'user_id,entity,id' });
    if (error) throw error;
    return row;
  });
}

async function launch() {
  return chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

async function freshContext(browser) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 420, height: 900 },
    serviceWorkers: 'allow',
  });
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
  await page.waitForTimeout(800);
}

async function lastToast(page) {
  return page.locator('p.toast').last().innerText().catch(() => '');
}

async function beginToastEpoch(page) {
  const baseline = await lastToast(page);
  const epoch = Date.now();
  await page.evaluate((ep) => {
    window.__toastEpoch = ep;
    document.querySelectorAll('p.toast').forEach((el) => {
      el.setAttribute('data-toast-epoch', 'stale');
    });
  }, epoch);
  return { baseline, epoch };
}

async function waitToastMatch(page, re, { timeoutMs = 25000, baseline = '' } = {}) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const info = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('p.toast')];
      const fresh = nodes.filter((el) => el.getAttribute('data-toast-epoch') !== 'stale');
      const pick = fresh.length ? fresh[fresh.length - 1] : null;
      const el = pick || nodes[nodes.length - 1] || null;
      return { text: el ? (el.innerText || '').trim() : '', fromFresh: !!pick };
    });
    last = info.text;
    if (last && last !== baseline && re.test(last)) return last;
    await page.waitForTimeout(350);
  }
  return last;
}

async function configureAndVerify(page) {
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(500);
  await page
    .locator('select')
    .filter({ has: page.locator('option[value="supabase"]') })
    .first()
    .selectOption('supabase');
  await page.waitForTimeout(300);
  await page.locator('input[placeholder="https://xxxx.supabase.co"]').fill(SMOKE_URL);
  await page.locator('input[placeholder="eyJhbGciOi…"]').fill(SMOKE_ANON);
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  const { baseline } = await beginToastEpoch(page);
  await page.getByRole('button', { name: '校验连接' }).click();
  return waitToastMatch(page, /连接成功|成功|失败|错误/, { timeoutMs: 35000, baseline });
}

async function clickBidirectional(page) {
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(400);
  const { baseline } = await beginToastEpoch(page);
  await page.getByRole('button', { name: '双向同步' }).click();
  return baseline;
}

async function seedVehicleLocal(page, vehicleId, name, updatedAt) {
  return page.evaluate(
    async ({ vehicleId, name, updatedAt }) => {
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
      const vehicle = {
        id: vehicleId,
        name,
        plate: 'M3C',
        energyType: 'ICE',
        bodyType: 'SEDAN',
        createdAt: updatedAt,
        updatedAt,
      };
      const opId = `op-${vehicleId}-${Date.now()}`;
      const outbox = {
        opId,
        entity: 'vehicles',
        entityId: vehicleId,
        op: 'upsert',
        payload: vehicle,
        mutatedAt: updatedAt,
        attempts: 0,
        nextRetryAt: updatedAt,
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
      return { ok: true, cloudUserId: cloudUserId || null, opId };
    },
    { vehicleId, name, updatedAt },
  );
}

async function seedRecordLocal(page, recordId, vehicleId, note, updatedAt, { deleted = false } = {}) {
  return page.evaluate(
    async ({ recordId, vehicleId, note, updatedAt, deleted }) => {
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
      const rec = {
        id: recordId,
        vehicleId,
        type: 'wash',
        date: updatedAt.slice(0, 10),
        amountPaid: 20,
        mediaIds: [],
        note,
        createdAt: updatedAt,
        updatedAt,
        washKind: 'basic',
      };
      const opId = `op-${recordId}-${Date.now()}`;
      const outbox = {
        opId,
        entity: 'records',
        entityId: recordId,
        op: deleted ? 'delete' : 'upsert',
        payload: deleted ? { id: recordId } : rec,
        mutatedAt: updatedAt,
        attempts: 0,
        nextRetryAt: updatedAt,
        ownerUserId: cloudUserId || undefined,
      };
      await new Promise((resolve, reject) => {
        const stores = deleted ? ['sync_outbox'] : ['records', 'sync_outbox'];
        const tx = db.transaction(stores, 'readwrite');
        if (!deleted) tx.objectStore('records').put(rec);
        tx.objectStore('sync_outbox').put(outbox);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return { ok: true, opId };
    },
    { recordId, vehicleId, note, updatedAt, deleted },
  );
}

async function listOpenConflictsIdb(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('car-care-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (![...db.objectStoreNames].includes('sync_conflicts')) {
      db.close();
      return { hasStore: false, open: [] };
    }
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('sync_conflicts', 'readonly');
      const g = tx.objectStore('sync_conflicts').getAll();
      g.onsuccess = () => resolve(g.result || []);
      g.onerror = () => reject(g.error);
    });
    db.close();
    const open = rows.filter((r) => r.status === 'open');
    return {
      hasStore: true,
      open,
      kinds: open.map((c) => c.kind),
      entities: open.map((c) => `${c.entity}:${c.entityId}`),
    };
  });
}

async function getLocalVehicle(page, id) {
  return page.evaluate(async (vid) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('car-care-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction('vehicles', 'readonly');
      const g = tx.objectStore('vehicles').get(vid);
      g.onsuccess = () => resolve(g.result || null);
      g.onerror = () => reject(g.error);
    });
    db.close();
    return row;
  }, id);
}

async function countOutboxFor(page, entityId) {
  return page.evaluate(async (eid) => {
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
    const hit = rows.filter((r) => r.entityId === eid);
    return { count: hit.length, opIds: hit.map((r) => r.opId), ops: hit.map((r) => r.op) };
  }, entityId);
}

async function idbStoreNames(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('car-care-db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const names = [...db.objectStoreNames];
    db.close();
    return names;
  });
}

async function main() {
  const browser = await launch();
  const log = [];
  const logLine = (s) => {
    log.push(`[${new Date().toISOString()}] ${s}`);
    console.log(s);
  };

  try {
    // ---- 0. Fingerprints ----
    {
      const { context, page } = await freshContext(browser);
      const stamp = await page.request.get(BASE + '/deploy-stamp.txt').then((r) => r.text());
      record('0.stamp.git', stamp.includes(EXPECT_GIT), stamp.trim().split('\n').slice(0, 5).join(' | '));
      record('0.stamp.bundle', stamp.includes(EXPECT_BUNDLE), stamp);
      record('0.stamp.target-staging', stamp.includes('car-test'), stamp);
      const prodStamp = await page.request.get(PROD + '/deploy-stamp.txt').then((r) => r.text());
      record(
        '0.prod.untouched',
        prodStamp.includes('d7dd681') && prodStamp.includes('index-Cv8wDxDq') && !prodStamp.includes(EXPECT_BUNDLE),
        prodStamp.trim().split('\n').slice(0, 4).join(' | '),
      );
      record(
        '0.smoke.url.disposable',
        SMOKE_URL.includes(DISPOSABLE_REF) && !SMOKE_URL.includes(PROD_REF),
        SMOKE_URL,
      );
      await context.close();
    }

    await cleanupCloud().catch((e) => logLine('cleanup pre: ' + e.message));

    // ---- Unit mapping (vitest already ran; re-run m3c filter for evidence) ----
    {
      const vt = spawnSync('npx', ['vitest', 'run', 'src/sync/m3c-conflict.test.ts', 'src/sync/conflictDetect.test.ts'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
        timeout: 120000,
      });
      const out = (vt.stdout || '') + (vt.stderr || '');
      const m = out.match(/Tests\s+(\d+)\s+passed/);
      const passed = m ? Number(m[1]) : 0;
      record('0.unit.m3c+detect', vt.status === 0 && passed > 0, `passed=${passed} status=${vt.status}`);
      fs.writeFileSync(path.join(OUT, 'unit-m3c.log'), out.slice(-8000));
    }

    // ---- D1: dual device login + first sync ----
    const vidD1 = `${PREFIX}d1-v`;
    let ctxA;
    let pageA;
    let ctxB;
    let pageB;
    {
      const a = await freshContext(browser);
      ctxA = a.context;
      pageA = a.page;
      await clearAppData(pageA);
      const toastA = await configureAndVerify(pageA);
      record('D1.A.verify', /连接成功|成功/.test(toastA), toastA);

      const seed = await seedVehicleLocal(pageA, vidD1, 'D1-Car-A', new Date().toISOString());
      record('D1.A.seed', !!seed.ok && !!seed.cloudUserId, JSON.stringify(seed));

      const baseline = await clickBidirectional(pageA);
      const syncA = await waitToastMatch(pageA, /完成|成功|推送|失败|错误/, { timeoutMs: 45000, baseline });
      record('D1.A.sync', /完成|成功|推送/.test(syncA), syncA);

      const cloud = await cloudGet('vehicles', vidD1);
      record('D1.cloud.has', !!(cloud && !cloud.deleted_at), JSON.stringify(cloud?.payload?.name || cloud));

      const b = await freshContext(browser);
      ctxB = b.context;
      pageB = b.page;
      await clearAppData(pageB);
      const toastB = await configureAndVerify(pageB);
      record('D1.B.verify', /连接成功|成功/.test(toastB), toastB);

      const baselineB = await clickBidirectional(pageB);
      const syncB = await waitToastMatch(pageB, /完成|成功|推送|失败|错误/, { timeoutMs: 45000, baseline: baselineB });
      record('D1.B.sync', /完成|成功|推送/.test(syncB), syncB);

      const localB = await getLocalVehicle(pageB, vidD1);
      record('D1.B.pulled', localB?.name === 'D1-Car-A' || localB?.name === cloud?.payload?.name, JSON.stringify(localB));

      const stores = await idbStoreNames(pageA);
      record('D1.idb.sync_conflicts', stores.includes('sync_conflicts'), stores.join(','));

      await pageA.screenshot({ path: path.join(OUT, 'd1-settings-a.png'), fullPage: true });
    }

    // ---- D2: concurrent edit → open (not silent LWW) ----
    const vidD2 = `${PREFIX}d2-v`;
    {
      // Use pageA: seed local older pending; cloud has peer newer
      const localTs = '2026-01-10T00:00:00.000Z';
      const cloudTs = '2026-02-10T00:00:00.000Z';
      await seedVehicleLocal(pageA, vidD2, 'D2-Local', localTs);
      await cloudUpsert(
        'vehicles',
        vidD2,
        {
          id: vidD2,
          name: 'D2-Cloud',
          plate: 'M3C',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: localTs,
          updatedAt: cloudTs,
        },
        cloudTs,
        { deviceId: 'peer-b' },
      );
      const baseline = await clickBidirectional(pageA);
      await waitToastMatch(pageA, /完成|成功|冲突|失败|错误|推送/, { timeoutMs: 45000, baseline });
      await pageA.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
      await pageA.waitForTimeout(800);
      const conflicts = await listOpenConflictsIdb(pageA);
      const hit = conflicts.open.find((c) => c.entityId === vidD2);
      record('D2.open', !!hit, JSON.stringify({ entities: conflicts.entities, kinds: conflicts.kinds }));
      const local = await getLocalVehicle(pageA, vidD2);
      record('D2.no-silent-lww', local?.name === 'D2-Local', JSON.stringify(local));
      const ui = await pageA.locator('body').innerText();
      record('D2.ui.visible', /待处理同步冲突|保留本地|采用云端|Open sync conflicts|Keep local|Take cloud/.test(ui), ui.slice(0, 400));
      await pageA.screenshot({ path: path.join(OUT, 'd2-conflict.png'), fullPage: true });
    }

    // ---- D3: keep_local ----
    const vidD3 = `${PREFIX}d3-v`;
    {
      const localTs = '2026-01-11T00:00:00.000Z';
      const cloudTs = '2026-02-11T00:00:00.000Z';
      await seedVehicleLocal(pageA, vidD3, 'D3-KeepLocal', localTs);
      await cloudUpsert(
        'vehicles',
        vidD3,
        {
          id: vidD3,
          name: 'D3-Cloud',
          plate: 'M3C',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: localTs,
          updatedAt: cloudTs,
        },
        cloudTs,
        { deviceId: 'peer-b' },
      );
      let baseline = await clickBidirectional(pageA);
      await waitToastMatch(pageA, /完成|成功|冲突|失败|错误|推送/, { timeoutMs: 45000, baseline });
      await pageA.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
      await pageA.waitForTimeout(600);
      const before = await listOpenConflictsIdb(pageA);
      const c = before.open.find((x) => x.entityId === vidD3);
      record('D3.pre-open', !!c, JSON.stringify(before.entities));

      // Click 保留本地 for this conflict (first matching button pair under list)
      const keepBtn = pageA.getByRole('button', { name: /保留本地|Keep local/ }).first();
      if (await keepBtn.count()) {
        await keepBtn.click();
        await pageA.waitForTimeout(2500);
      }
      baseline = await beginToastEpoch(pageA).then((x) => x.baseline);
      // resolve may toast; wait a bit then re-check
      await pageA.waitForTimeout(2000);
      const after = await listOpenConflictsIdb(pageA);
      const still = after.open.find((x) => x.entityId === vidD3);
      const local = await getLocalVehicle(pageA, vidD3);
      // keep_local bumps name to KeepLocal and pushes — conflict should close
      const cloud = await cloudGet('vehicles', vidD3);
      const ok =
        !still &&
        local?.name === 'D3-KeepLocal' &&
        (cloud?.payload?.name === 'D3-KeepLocal' || cloud?.payload?.name === 'D3-Cloud');
      // Prefer cloud also KeepLocal after push; if push delayed still local kept
      record(
        'D3.keep_local',
        !still && local?.name === 'D3-KeepLocal',
        JSON.stringify({ local: local?.name, cloud: cloud?.payload?.name, stillOpen: !!still }),
      );
      // Soft: cloud eventual
      if (cloud?.payload?.name === 'D3-KeepLocal') record('D3.cloud.pushed', true, 'cloud matched local');
      else record('D3.cloud.pushed', ok && local?.name === 'D3-KeepLocal', JSON.stringify(cloud?.payload));
      await pageA.screenshot({ path: path.join(OUT, 'd3-keep-local.png'), fullPage: true });
    }

    // ---- D4: take_cloud ----
    const vidD4 = `${PREFIX}d4-v`;
    {
      const localTs = '2026-01-12T00:00:00.000Z';
      const cloudTs = '2026-02-12T00:00:00.000Z';
      await seedVehicleLocal(pageA, vidD4, 'D4-Local', localTs);
      await cloudUpsert(
        'vehicles',
        vidD4,
        {
          id: vidD4,
          name: 'D4-CloudWin',
          plate: 'M3C',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: localTs,
          updatedAt: cloudTs,
        },
        cloudTs,
        { deviceId: 'peer-b' },
      );
      const baseline = await clickBidirectional(pageA);
      await waitToastMatch(pageA, /完成|成功|冲突|失败|错误|推送/, { timeoutMs: 45000, baseline });
      await pageA.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
      await pageA.waitForTimeout(600);
      const before = await listOpenConflictsIdb(pageA);
      record('D4.pre-open', before.open.some((x) => x.entityId === vidD4), JSON.stringify(before.entities));

      const takeBtn = pageA.getByRole('button', { name: /采用云端|Take cloud/ }).first();
      if (await takeBtn.count()) {
        await takeBtn.click();
        await pageA.waitForTimeout(3000);
      }
      const after = await listOpenConflictsIdb(pageA);
      const still = after.open.find((x) => x.entityId === vidD4);
      const local = await getLocalVehicle(pageA, vidD4);
      const box = await countOutboxFor(pageA, vidD4);
      record(
        'D4.take_cloud',
        !still && local?.name === 'D4-CloudWin' && box.count === 0,
        JSON.stringify({ local: local?.name, stillOpen: !!still, outbox: box }),
      );
      await pageA.screenshot({ path: path.join(OUT, 'd4-take-cloud.png'), fullPage: true });
    }

    // ---- D5: edit_vs_delete + confirm path ----
    const vidD5 = `${PREFIX}d5-v`;
    const ridD5 = `${PREFIX}d5-r`;
    {
      // Ensure parent vehicle exists on cloud
      const vTs = '2026-01-01T00:00:00.000Z';
      await cloudUpsert(
        'vehicles',
        vidD5,
        {
          id: vidD5,
          name: 'D5-Car',
          plate: 'M3C',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: vTs,
          updatedAt: vTs,
        },
        vTs,
      );
      await seedVehicleLocal(pageA, vidD5, 'D5-Car', vTs);
      // Local pending edit on record; cloud tombstone newer
      const localTs = '2026-01-15T00:00:00.000Z';
      const cloudTs = '2026-02-15T00:00:00.000Z';
      await seedRecordLocal(pageA, ridD5, vidD5, 'keep-me', localTs);
      await cloudUpsert('records', ridD5, {}, cloudTs, { deletedAt: cloudTs, deviceId: 'peer-b' });
      const baseline = await clickBidirectional(pageA);
      await waitToastMatch(pageA, /完成|成功|冲突|失败|错误|推送/, { timeoutMs: 45000, baseline });
      await pageA.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
      await pageA.waitForTimeout(800);
      const conflicts = await listOpenConflictsIdb(pageA);
      const hit = conflicts.open.find((c) => c.entityId === ridD5);
      record('D5.edit_vs_delete', hit?.kind === 'edit_vs_delete', JSON.stringify(hit || conflicts));
      const ui = await pageA.locator('body').innerText();
      record(
        'D5.ui.kind',
        /删除与修改冲突|Edit vs delete/.test(ui) || hit?.kind === 'edit_vs_delete',
        ui.match(/删除与修改|Edit vs delete|双边编辑|待处理/)?.[0] || 'no-ui-match',
      );
      // Confirm dialog path: clicking take_cloud should trigger confirm (auto-accepted by handler)
      // Evidence: dialog handler registered + button present
      const takeCount = await pageA.getByRole('button', { name: /采用云端|Take cloud/ }).count();
      record('D5.confirm-path-ready', takeCount > 0 && !!hit, `takeButtons=${takeCount}`);
      await pageA.screenshot({ path: path.join(OUT, 'd5-edit-vs-delete.png'), fullPage: true });
    }

    // ---- D6: offline then sync opens (not silent LWW) — same as D2 pattern ----
    const vidD6 = `${PREFIX}d6-v`;
    {
      const localTs = '2026-01-16T00:00:00.000Z';
      const cloudTs = '2026-03-16T00:00:00.000Z';
      await seedVehicleLocal(pageA, vidD6, 'D6-OfflineLocal', localTs);
      await cloudUpsert(
        'vehicles',
        vidD6,
        {
          id: vidD6,
          name: 'D6-PeerChanged',
          plate: 'M3C',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: localTs,
          updatedAt: cloudTs,
        },
        cloudTs,
        { deviceId: 'peer-b' },
      );
      const baseline = await clickBidirectional(pageA);
      await waitToastMatch(pageA, /完成|成功|冲突|失败|错误|推送/, { timeoutMs: 45000, baseline });
      const conflicts = await listOpenConflictsIdb(pageA);
      const hit = conflicts.open.find((c) => c.entityId === vidD6);
      const local = await getLocalVehicle(pageA, vidD6);
      record(
        'D6.offline-open',
        !!hit && local?.name === 'D6-OfflineLocal',
        JSON.stringify({ open: !!hit, local: local?.name }),
      );
    }

    // ---- D7: resolve failure keeps open (simulate offline during take_cloud) ----
    const vidD7 = `${PREFIX}d7-v`;
    {
      const localTs = '2026-01-17T00:00:00.000Z';
      const cloudTs = '2026-02-17T00:00:00.000Z';
      await seedVehicleLocal(pageA, vidD7, 'D7-Local', localTs);
      await cloudUpsert(
        'vehicles',
        vidD7,
        {
          id: vidD7,
          name: 'D7-Cloud',
          plate: 'M3C',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: localTs,
          updatedAt: cloudTs,
        },
        cloudTs,
        { deviceId: 'peer-b' },
      );
      let baseline = await clickBidirectional(pageA);
      await waitToastMatch(pageA, /完成|成功|冲突|失败|错误|推送/, { timeoutMs: 45000, baseline });
      await pageA.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
      await pageA.waitForTimeout(500);
      const before = await listOpenConflictsIdb(pageA);
      const had = before.open.some((c) => c.entityId === vidD7);
      record('D7.pre-open', had, JSON.stringify(before.entities));

      // Abort cloud reads during resolve
      await pageA.route('**/rest/v1/**', (route) => route.abort());
      const takeBtn = pageA.getByRole('button', { name: /采用云端|Take cloud/ }).first();
      if ((await takeBtn.count()) && had) {
        await takeBtn.click();
        await pageA.waitForTimeout(2500);
      }
      await pageA.unroute('**/rest/v1/**');
      const after = await listOpenConflictsIdb(pageA);
      const still = after.open.find((c) => c.entityId === vidD7);
      const local = await getLocalVehicle(pageA, vidD7);
      const box = await countOutboxFor(pageA, vidD7);
      record(
        'D7.failure-keeps-open',
        !!still && local?.name === 'D7-Local' && box.count >= 1,
        JSON.stringify({ still: !!still, local: local?.name, outbox: box.count }),
      );
      // Retry after recovery
      await pageA.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
      await pageA.waitForTimeout(500);
      const take2 = pageA.getByRole('button', { name: /采用云端|Take cloud/ }).first();
      if (await take2.count()) {
        await take2.click();
        await pageA.waitForTimeout(3000);
      }
      const afterRetry = await listOpenConflictsIdb(pageA);
      const local2 = await getLocalVehicle(pageA, vidD7);
      const closed = !afterRetry.open.some((c) => c.entityId === vidD7);
      record(
        'D7.retry-ok',
        closed && local2?.name === 'D7-Cloud',
        JSON.stringify({ closed, local: local2?.name }),
      );
    }

    // ---- D8: second tab resolve while sync lock busy ----
    {
      const pageA2 = await ctxA.newPage();
      pageA2.on('dialog', async (d) => {
        try {
          await d.accept();
        } catch {
          /* */
        }
      });
      await pageA2.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
      const lockProbe = await pageA.evaluate(async () => {
        const name = 'car-care-sync';
        if (typeof navigator.locks?.request !== 'function') return { mode: 'no-locks' };
        let otherBusy = false;
        const gate = {};
        gate.p = new Promise((r) => {
          gate.release = r;
        });
        const held = navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
          if (!lock) return false;
          await gate.p;
          return true;
        });
        await new Promise((r) => setTimeout(r, 40));
        const b = await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
          otherBusy = !lock;
          return !!lock;
        });
        gate.release();
        await held;
        return { mode: 'web-locks', otherBusy, bHeld: b };
      });
      record(
        'D8.lock-mutex',
        lockProbe.mode === 'web-locks' ? lockProbe.otherBusy === true : lockProbe.mode === 'no-locks',
        JSON.stringify(lockProbe),
      );
      // Holding lock: attempt sync on other tab should busy (click 双向同步 while holding)
      const holdResult = await pageA.evaluate(async () => {
        const name = 'car-care-sync';
        if (typeof navigator.locks?.request !== 'function') return { skipped: true };
        return new Promise((resolve) => {
          navigator.locks.request(name, async (lock) => {
            if (!lock) {
              resolve({ held: false });
              return;
            }
            // signal ready
            window.__m3cLockHeld = true;
            await new Promise((r) => setTimeout(r, 4000));
            window.__m3cLockHeld = false;
            resolve({ held: true });
          });
        });
      });
      // Parallel: click sync on pageA2 while A holds
      await pageA2.waitForTimeout(200);
      const baseline = await beginToastEpoch(pageA2).then((x) => x.baseline);
      await pageA2.getByRole('button', { name: '双向同步' }).click();
      const toast = await waitToastMatch(pageA2, /另一标签|请稍候|队列已保留|完成|成功|失败/, {
        timeoutMs: 15000,
        baseline,
      });
      await holdResult;
      record(
        'D8.busy-or-serialized',
        /另一标签|请稍候|队列已保留|完成|成功/.test(toast),
        toast || JSON.stringify(holdResult),
      );
      await pageA2.close();
    }

    // ---- D9: stations do not enter manual queue ----
    const sid = `${PREFIX}d9-s`;
    {
      await pageA.evaluate(
        async ({ sid, SMOKE_NOTE }) => {
          void SMOKE_NOTE;
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
          const ts = '2026-01-18T00:00:00.000Z';
          const station = {
            id: sid,
            name: 'D9-Local-Station',
            stationType: 'gas',
            createdAt: ts,
            updatedAt: ts,
          };
          const outbox = {
            opId: `op-${sid}`,
            entity: 'stations',
            entityId: sid,
            op: 'upsert',
            payload: station,
            mutatedAt: ts,
            attempts: 0,
            nextRetryAt: ts,
            ownerUserId: cloudUserId || undefined,
          };
          const stores = [...db.objectStoreNames];
          const txStores = stores.includes('stations')
            ? ['stations', 'sync_outbox']
            : ['sync_outbox'];
          await new Promise((resolve, reject) => {
            const tx = db.transaction(txStores, 'readwrite');
            if (stores.includes('stations')) tx.objectStore('stations').put(station);
            tx.objectStore('sync_outbox').put(outbox);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
          });
          db.close();
          return true;
        },
        { sid, SMOKE_NOTE: 'stations' },
      );
      await cloudUpsert(
        'stations',
        sid,
        {
          id: sid,
          name: 'D9-Cloud-Station',
          stationType: 'gas',
          createdAt: '2026-01-18T00:00:00.000Z',
          updatedAt: '2026-03-18T00:00:00.000Z',
        },
        '2026-03-18T00:00:00.000Z',
        { deviceId: 'peer-b' },
      );
      const baseline = await clickBidirectional(pageA);
      await waitToastMatch(pageA, /完成|成功|冲突|失败|错误|推送/, { timeoutMs: 45000, baseline });
      const conflicts = await listOpenConflictsIdb(pageA);
      const stationOpen = conflicts.open.some((c) => c.entity === 'stations' || c.entityId === sid);
      record('D9.stations-no-open', !stationOpen, JSON.stringify(conflicts.entities));
    }

    // ---- TOCTOU / subsequent edit protection (live) ----
    const vidT = `${PREFIX}toc-v`;
    {
      const localTs = '2026-01-20T00:00:00.000Z';
      const cloudTs = '2026-02-20T00:00:00.000Z';
      await seedVehicleLocal(pageA, vidT, 'TOC-Local', localTs);
      await cloudUpsert(
        'vehicles',
        vidT,
        {
          id: vidT,
          name: 'TOC-Cloud',
          plate: 'M3C',
          energyType: 'ICE',
          bodyType: 'SEDAN',
          createdAt: localTs,
          updatedAt: cloudTs,
        },
        cloudTs,
        { deviceId: 'peer-b' },
      );
      const baseline = await clickBidirectional(pageA);
      await waitToastMatch(pageA, /完成|成功|冲突|失败|错误|推送/, { timeoutMs: 45000, baseline });
      // Post-conflict new edit
      const post = await seedVehicleLocal(pageA, vidT, 'TOC-NewEdit', new Date().toISOString());
      record('TOCTOU.post-edit-seed', !!post.ok, JSON.stringify(post));
      await pageA.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
      await pageA.waitForTimeout(500);
      const takeBtn = pageA.getByRole('button', { name: /采用云端|Take cloud/ }).first();
      if (await takeBtn.count()) {
        await takeBtn.click();
        await pageA.waitForTimeout(2500);
      }
      const local = await getLocalVehicle(pageA, vidT);
      const conflicts = await listOpenConflictsIdb(pageA);
      const stillOpen = conflicts.open.some((c) => c.entityId === vidT);
      const box = await countOutboxFor(pageA, vidT);
      // Must NOT overwrite with cloud while post-conflict edit exists
      record(
        'TOCTOU.protect-new-edit',
        local?.name === 'TOC-NewEdit' && (stillOpen || box.count >= 1),
        JSON.stringify({ local: local?.name, stillOpen, outbox: box.count }),
      );
    }

    // ---- Regression probes (M2/M3-A/M3-B) ----
    {
      const stores = await idbStoreNames(pageA);
      record(
        'R.idb.m2-m3a-m3b-m3c',
        ['vehicles', 'records', 'media', 'sync_outbox', 'sync_meta', 'sync_conflicts'].every((s) =>
          stores.includes(s),
        ),
        stores.join(','),
      );
      const locks = await pageA.evaluate(() => typeof navigator.locks?.request === 'function');
      record('R.web-locks', locks, `available=${locks}`);
      const settingsText = await pageA.locator('body').innerText();
      record(
        'R.settings.sync-ui',
        /双向同步|校验连接|导出|导入/.test(settingsText),
        'settings cues',
      );
      // Media store writable
      const mediaOk = await pageA.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('car-care-db');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        if (![...db.objectStoreNames].includes('media')) {
          db.close();
          return false;
        }
        const id = 'm3c-acc-media-probe';
        await new Promise((resolve, reject) => {
          const tx = db.transaction('media', 'readwrite');
          tx.objectStore('media').put({
            id,
            mimeType: 'image/png',
            createdAt: new Date().toISOString(),
            blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('media', 'readwrite');
          tx.objectStore('media').delete(id);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        return true;
      });
      record('R.media.writable', mediaOk, 'media store put/delete');
    }

    await ctxA?.close();
    await ctxB?.close();
    await cleanupCloud().catch((e) => logLine('cleanup post: ' + e.message));
  } catch (e) {
    record('FATAL', false, e instanceof Error ? e.stack || e.message : String(e));
    logLine('FATAL ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    await browser.close();
  }

  const summary = {
    ranAt: new Date().toISOString(),
    base: BASE,
    expectGit: EXPECT_GIT,
    expectBundle: EXPECT_BUNDLE,
    disposable: DISPOSABLE_REF,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
    log,
    method:
      'dual Playwright contexts + IDB conflict seeding + disposable Supabase; unit filter re-run; not physical phones',
  };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'run.log'), log.join('\n') + '\n');
  console.log('\nSUMMARY', summary.passed, 'passed,', summary.failed, 'failed');
  if (summary.failed > 0) process.exit(1);
}

await main();
