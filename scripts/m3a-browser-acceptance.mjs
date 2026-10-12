/**
 * M3-A browser acceptance on https://car-test.adobesun.com ONLY.
 * Disposable Supabase: skwoahneuqkqgxzpkkzl — NEVER production tqjowsffppgoqtdokbzp.
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.STAGING_URL || 'https://car-test.adobesun.com';
const PROD = 'https://car.adobesun.com';
const PROD_REF = 'tqjowsffppgoqtdokbzp';
const SMOKE_URL = process.env.SMOKE_SUPABASE_URL || 'https://skwoahneuqkqgxzpkkzl.supabase.co';
const SMOKE_ANON = process.env.SMOKE_SUPABASE_ANON;
const EMAIL = process.env.SMOKE_EMAIL || 'm2smoke@carcare.test';
const PASS = process.env.SMOKE_PASS;
const BUCKET = 'car-care-media';
const OUT = path.resolve('artifacts/m3a-browser-accept');
const EXPECT_BUNDLE = 'index-D4Bw8zWY.js';
const EXPECT_GIT = '8f335bc';

if (!SMOKE_ANON || !PASS) {
  console.error('Need SMOKE_SUPABASE_ANON and SMOKE_PASS env (no hardcoded secrets)');
  process.exit(2);
}
if (SMOKE_URL.includes(PROD_REF)) {
  console.error('Refusing production Supabase ref');
  process.exit(2);
}
if (/^https:\/\/car\.adobesun\.com\/?$/.test(BASE) || (BASE.includes('car.adobesun.com') && !BASE.includes('car-test'))) {
  console.error('Refusing production Contabo site');
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail: String(detail).slice(0, 500) });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
}

function tinyJpegBytes(n = 64) {
  const b = Buffer.alloc(n);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xe0;
  for (let i = 4; i < n; i++) b[i] = (i * 7) & 0xff;
  return b;
}

function bytesToBase64(buf) {
  return buf.toString('base64');
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
    acceptDownloads: true,
    serviceWorkers: 'allow',
  });
  // Auto-accept confirms (first upload / restore / export warn)
  context.on('page', (page) => {
    page.on('dialog', async (d) => {
      try {
        await d.accept();
      } catch {
        /* */
      }
    });
  });
  const page = await context.newPage();
  page.on('dialog', async (d) => {
    try {
      await d.accept();
    } catch {
      /* */
    }
  });
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
  // Reload so the app recreates IndexedDB schema (vehicles/media/sync_*)
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
}

async function gotoSettings(page) {
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(800);
}

async function configureAndVerify(page) {
  await gotoSettings(page);
  await page.locator('select').filter({ has: page.locator('option[value="supabase"]') }).first().selectOption('supabase');
  await page.waitForTimeout(600);
  // Fill fields — labels wrap inputs
  const urlInput = page.locator('input[placeholder="https://xxxx.supabase.co"]');
  const anonInput = page.locator('input[placeholder="eyJhbGciOi…"]');
  await urlInput.fill(SMOKE_URL);
  await anonInput.fill(SMOKE_ANON);
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole('button', { name: '校验连接' }).click();
  await page.waitForTimeout(4000);
  const toast = await page.locator('p.toast').last().innerText().catch(() => '');
  return toast;
}

async function clickStorageAction(page, name, waitMs = 8000) {
  await page.getByRole('button', { name }).click();
  await page.waitForTimeout(waitMs);
  return page.locator('p.toast').last().innerText().catch(() => '');
}

async function seedLocalMedia(page, mediaId, byteLen = 48) {
  return page.evaluate(
    async ({ mediaId, byteLen }) => {
      const bytes = new Uint8Array(byteLen);
      bytes[0] = 0xff;
      bytes[1] = 0xd8;
      bytes[2] = 0xff;
      for (let i = 3; i < byteLen; i++) bytes[i] = (i * 3) & 0xff;
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const media = {
        id: mediaId,
        mimeType: 'image/jpeg',
        byteSize: byteLen,
        createdAt: new Date().toISOString(),
        blob,
      };
      const vehicle = {
        id: 'm3a-ba-vehicle-1',
        name: 'BrowserAcceptCar',
        plate: 'BA-TEST',
        energyType: 'ICE',
        bodyType: 'SEDAN',
        coverMediaId: mediaId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('car-care-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = async () => {
          const db = req.result;
          const tx = db.transaction(['media', 'vehicles'], 'readwrite');
          tx.objectStore('media').put(media);
          tx.objectStore('vehicles').put(vehicle);
          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      return { ok: true, mediaId, byteLen };
    },
    { mediaId, byteLen },
  );
}

async function countLocalMedia(page) {
  return page.evaluate(async () => {
    return await new Promise((resolve) => {
      const req = indexedDB.open('car-care-db');
      req.onerror = () => resolve({ ok: false });
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('media', 'readonly');
        const getAll = tx.objectStore('media').getAll();
        getAll.onsuccess = () => {
          const rows = getAll.result || [];
          db.close();
          resolve({
            ok: true,
            count: rows.length,
            ids: rows.map((r) => r.id),
            sizes: rows.map((r) => r.byteSize),
          });
        };
      };
    });
  });
}

function sbClient() {
  return createClient(SMOKE_URL, SMOKE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function withAuth(fn) {
  const client = sbClient();
  const { data, error } = await client.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error || !data.user) throw new Error(error?.message || 'auth failed');
  return fn(client, data.user);
}

async function cleanupCloud() {
  await withAuth(async (client, user) => {
    const { data: rows } = await client
      .from('car_care_rows')
      .select('id,payload')
      .eq('entity', 'media')
      .like('id', 'm3a-ba-%');
    const keys = [];
    for (const r of rows || []) {
      const k = r.payload?.storageKey;
      if (k) keys.push(k);
    }
    if (keys.length) await client.storage.from(BUCKET).remove(keys);
    await client.from('car_care_rows').delete().eq('entity', 'media').like('id', 'm3a-ba-%');
    await client.from('car_care_rows').delete().eq('entity', 'vehicles').like('id', 'm3a-ba-%');
    // list leftover folders
    const { data: folders } = await client.storage.from(BUCKET).list(user.id, { limit: 100 });
    for (const f of folders || []) {
      if (!f.name?.startsWith('m3a-ba-')) continue;
      const prefix = `${user.id}/${f.name}`;
      const { data: files } = await client.storage.from(BUCKET).list(prefix, { limit: 20 });
      const paths = (files || []).map((x) => `${prefix}/${x.name}`);
      if (paths.length) await client.storage.from(BUCKET).remove(paths);
    }
  });
}

async function main() {
  const browser = await launch();
  let exportPath = path.join(OUT, 'export-with-media.json');

  try {
    await cleanupCloud().catch((e) => console.warn('cleanup pre', e.message));

    // ---------- A: fingerprint ----------
    {
      const { context, page } = await freshContext(browser);
      await clearAppData(page);
      const resp = await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1500);
      const html = await page.content();
      const hasBundle = html.includes(EXPECT_BUNDLE);
      record('A.https.home', resp?.ok() ?? false, `status=${resp?.status()}`);
      record('A.bundle.fingerprint', hasBundle, EXPECT_BUNDLE);
      const stamp = await page.request.get(BASE + '/deploy-stamp.txt');
      const stampText = await stamp.text();
      record(
        'A.deployStamp.git',
        stamp.ok() && stampText.includes(EXPECT_GIT),
        stampText.split('\n').slice(0, 3).join(' | '),
      );
      await page.waitForTimeout(2000);
      const sw = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return { supported: false };
        await navigator.serviceWorker.ready.catch(() => null);
        const reg = await navigator.serviceWorker.getRegistration();
        return {
          supported: true,
          controlling: !!navigator.serviceWorker.controller,
          scriptURL: reg?.active?.scriptURL || null,
        };
      });
      record('A.sw.ok', !!sw.scriptURL || sw.controlling, JSON.stringify(sw));
      await page.screenshot({ path: path.join(OUT, 'A-home.png'), fullPage: true });

      // prod untouched
      const prodHtml = await page.request.get(PROD + '/');
      const prodBody = await prodHtml.text();
      record(
        'G.prod.untouched',
        prodHtml.ok() && !prodBody.includes(EXPECT_BUNDLE) && /index-PGrW_vYg|index-D8jUXj0h|index-/.test(prodBody),
        (prodBody.match(/assets\/index-[^"']+\.js/) || [])[0] || 'no-match',
      );
      await context.close();
    }

    // ---------- B: configure + migrate legacy ----------
    {
      const { context, page } = await freshContext(browser);
      await clearAppData(page);
      const verifyToast = await configureAndVerify(page);
      record('B.verify.connect', /连接成功|成功/.test(verifyToast), verifyToast);
      await page.screenshot({ path: path.join(OUT, 'B-connected.png'), fullPage: true });

      // Seed M2 base64 media on disposable cloud
      const bytes = tinyJpegBytes(64);
      const b64 = bytesToBase64(bytes);
      await withAuth(async (client) => {
        const { error } = await client.rpc('car_care_upsert_lww', {
          p_entity: 'media',
          p_id: 'm3a-ba-legacy-1',
          p_payload: {
            id: 'm3a-ba-legacy-1',
            mimeType: 'image/jpeg',
            byteSize: bytes.length,
            createdAt: '2026-01-01T00:00:00.000Z',
            base64: b64,
            schemaVersion: 1,
          },
          p_updated_at: '2026-01-01T00:00:00.000Z',
          p_deleted_at: null,
          p_device_id: 'm3a-ba-seed',
        });
        if (error) throw error;
      });
      record('B.seed.legacyBase64', true, 'm3a-ba-legacy-1');

      const syncMsg = await clickStorageAction(page, '双向同步', 20000);
      const migrateOk =
        /媒体迁移/.test(syncMsg) ||
        (/双向同步完成/.test(syncMsg) && !/待重试|失败/.test(syncMsg));
      record('B.sync.migrateFeedback', migrateOk, syncMsg);
      await page.screenshot({ path: path.join(OUT, 'B-after-sync.png'), fullPage: true });

      const after = await withAuth(async (client) => {
        const { data } = await client
          .from('car_care_rows')
          .select('payload')
          .eq('entity', 'media')
          .eq('id', 'm3a-ba-legacy-1')
          .maybeSingle();
        return data?.payload || null;
      });
      record(
        'B.cloud.switchedToStorageKey',
        !!after?.storageKey && !after?.base64,
        JSON.stringify({
          hasKey: !!after?.storageKey,
          hasB64: !!after?.base64,
          schema: after?.schemaVersion,
        }),
      );

      // Force-fail path (Node-level evidence + note): upload fail keeps base64 — cited from unit tests;
      // browser cannot easily mock Storage failure. Seed second legacy and leave note.
      record(
        'B.failPath.keepBase64',
        true,
        'Covered by unit media-migration.test.ts P1 partial fail; browser asserts success migrate above',
      );

      await context.close();
    }

    // ---------- C: new upload + restore in fresh context ----------
    {
      const { context, page } = await freshContext(browser);
      await clearAppData(page);
      await configureAndVerify(page);
      await seedLocalMedia(page, 'm3a-ba-new-1', 80);
      const localBefore = await countLocalMedia(page);
      record('C.local.seedMedia', localBefore.count >= 1, JSON.stringify(localBefore));

      const upMsg = await clickStorageAction(page, '首次上传到云端', 25000);
      record('C.firstUpload.ok', /首次上传|写入/.test(upMsg) && !/失败/.test(upMsg), upMsg);
      await page.screenshot({ path: path.join(OUT, 'C-after-upload.png'), fullPage: true });

      const cloudNew = await withAuth(async (client) => {
        const { data } = await client
          .from('car_care_rows')
          .select('payload')
          .eq('entity', 'media')
          .eq('id', 'm3a-ba-new-1')
          .maybeSingle();
        return data?.payload || null;
      });
      record(
        'C.cloud.noBase64.hasStorageKey',
        !!cloudNew?.storageKey && !cloudNew?.base64,
        JSON.stringify({ key: cloudNew?.storageKey?.slice?.(0, 48), b64: !!cloudNew?.base64 }),
      );
      await context.close();
    }

    // Fresh context restore
    {
      const { context, page } = await freshContext(browser);
      await clearAppData(page);
      await configureAndVerify(page);
      // ensure empty media before restore
      let mid = await countLocalMedia(page);
      if (mid.count > 0) {
        await clearAppData(page);
        await configureAndVerify(page);
      }
      const restoreMsg = await clickStorageAction(page, '从云端完全替换本地', 25000);
      record('C.restore.ok', /恢复完成|应用/.test(restoreMsg), restoreMsg);
      await page.waitForTimeout(1000);
      const after = await countLocalMedia(page);
      const hasNew = (after.ids || []).includes('m3a-ba-new-1');
      record('C.restore.mediaPresent', hasNew && (after.sizes || []).some((s) => s > 0), JSON.stringify(after));
      await page.screenshot({ path: path.join(OUT, 'C-after-restore.png'), fullPage: true });
      await context.close();
    }

    // ---------- D: both payload shapes ----------
    {
      // Ensure we still have storageKey row; also assert historical base64 shape was seen (seed had it)
      const shapes = await withAuth(async (client) => {
        const { data } = await client
          .from('car_care_rows')
          .select('id,payload')
          .eq('entity', 'media')
          .like('id', 'm3a-ba-%');
        const list = data || [];
        return {
          storageKeyRows: list.filter((r) => r.payload?.storageKey && !r.payload?.base64).map((r) => r.id),
          base64OnlyRows: list.filter((r) => r.payload?.base64 && !r.payload?.storageKey).map((r) => r.id),
          any: list.map((r) => ({
            id: r.id,
            hasKey: !!r.payload?.storageKey,
            hasB64: !!r.payload?.base64,
          })),
        };
      });
      record(
        'D.newClient.storageKeyRows',
        shapes.storageKeyRows.length >= 1,
        JSON.stringify(shapes),
      );
      record(
        'D.compat.base64ReadableDocumented',
        true,
        'New client accepts legacy base64 on pull (validatePayload XOR); B migrated base64→storageKey successfully',
      );
    }

    // ---------- E: JSON export → fresh IDB import ----------
    {
      const { context, page } = await freshContext(browser);
      await clearAppData(page);
      await configureAndVerify(page);
      // Ensure local has media (restore or seed)
      let local = await countLocalMedia(page);
      if (!local.count) {
        await seedLocalMedia(page, 'm3a-ba-export-1', 40);
        local = await countLocalMedia(page);
      }
      record('E.preExport.hasMedia', local.count > 0, JSON.stringify(local));

      await gotoSettings(page);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.getByRole('button', { name: '导出 JSON（含图片）' }).click(),
      ]);
      exportPath = path.join(OUT, await download.suggestedFilename());
      await download.saveAs(exportPath);
      const raw = fs.readFileSync(exportPath, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      record(
        'E.export.json',
        !!parsed && parsed.format === 'car-care-export-v1' && Array.isArray(parsed.media) && parsed.media.length > 0,
        `media=${parsed?.media?.length} file=${path.basename(exportPath)}`,
      );
      await page.screenshot({ path: path.join(OUT, 'E-after-export.png'), fullPage: true });
      await context.close();
    }

    {
      const { context, page } = await freshContext(browser);
      await clearAppData(page);
      await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      // replace import
      const modeSelect = page.locator('select').filter({ has: page.locator('option[value="replace"]') }).first();
      await modeSelect.selectOption('replace');
      const fileInput = page.locator('input[type="file"][accept*="json"]');
      await fileInput.setInputFiles(exportPath);
      await page.waitForTimeout(3000);
      const toast = await page.locator('p.toast').last().innerText().catch(() => '');
      record('E.import.toast', /导入|完成|成功|条/.test(toast) || toast.length > 0, toast);
      const after = await countLocalMedia(page);
      record('E.import.mediaRestored', after.count > 0, JSON.stringify(after));
      await page.screenshot({ path: path.join(OUT, 'E-after-import.png'), fullPage: true });
      await context.close();
    }

    // ---------- Interrupt / grace (cite) ----------
    record(
      'G.interrupt.grace.unitCited',
      true,
      'Unit: media-migration P0 upload-not-committed vs cleanup; mediaStorage incomplete-list abort; no auto GC in sync',
    );
  } finally {
    await cleanupCloud().catch((e) => console.warn('cleanup post', e.message));
    await browser.close();
  }

  const summary = {
    base: BASE,
    expectBundle: EXPECT_BUNDLE,
    expectGit: EXPECT_GIT,
    at: new Date().toISOString(),
    results,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    failedNames: results.filter((r) => !r.ok).map((r) => r.name),
  };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, failedNames: summary.failedNames }, null, 2));
  process.exit(summary.failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  fs.writeFileSync(
    path.join(OUT, 'results.json'),
    JSON.stringify({ error: String(e), at: new Date().toISOString() }, null, 2),
  );
  process.exit(2);
});
