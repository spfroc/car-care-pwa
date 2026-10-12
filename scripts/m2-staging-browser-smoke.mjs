/**
 * Staging UI smoke via Playwright (HTTPS car-test only — never car.adobesun.com deploy).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.STAGING_URL || 'https://car-test.adobesun.com';
const OUT = path.resolve('artifacts/staging-smoke');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 420, height: 900 },
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  try {
    const resp = await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
    record('https.home', resp?.ok() ?? false, `status=${resp?.status()} url=${page.url()}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, '01-home.png'), fullPage: true });
    const rootText = await page.locator('#root').innerText().catch(() => '');
    record('ui.root.notEmpty', rootText.trim().length > 0 && !/无法打开本地数据库/.test(rootText), rootText.slice(0, 120));

    // SW
    const sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const reg = await navigator.serviceWorker.getRegistration();
      return {
        supported: true,
        controlling: !!navigator.serviceWorker.controller,
        scope: reg?.scope ?? null,
        scriptURL: reg?.active?.scriptURL ?? reg?.installing?.scriptURL ?? reg?.waiting?.scriptURL ?? null,
      };
    });
    record('sw.registered', !!sw.scriptURL || sw.controlling, JSON.stringify(sw));

    // Caches
    const cachesInfo = await page.evaluate(async () => {
      if (!('caches' in window)) return [];
      const keys = await caches.keys();
      const out = [];
      for (const k of keys) {
        const c = await caches.open(k);
        const reqs = await c.keys();
        out.push({ name: k, entries: reqs.length });
      }
      return out;
    });
    record('sw.caches', cachesInfo.length >= 0, JSON.stringify(cachesInfo));

    // Routes
    const routes = [
      ['/', '02-home'],
      ['/stats', '03-stats'],
      ['/settings', '04-settings'],
      ['/vehicles/new', '05-vehicles-new'],
    ];
    for (const [route, shot] of routes) {
      const r = await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, `${shot}.png`), fullPage: true });
      const spa = !page.url().includes('404') && (r?.ok() ?? false);
      // client routing: deep link should not 404 HTML from server
      record(`route${route}`, spa, `status=${r?.status()} final=${page.url()}`);
    }

    // Settings: look for data storage / import export
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const body = await page.locator('body').innerText();
    record('settings.hasDataStorage', /数据存储|Data storage|Supabase/.test(body), 'storage section');
    record('settings.hasImportExport', /导入|导出|Import|Export|JSON/.test(body), 'import/export');

    // Manifest
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return null;
      const res = await fetch(link.href);
      return { status: res.status, type: res.headers.get('content-type'), json: await res.json() };
    });
    record(
      'pwa.manifest',
      !!manifest && manifest.status === 200 && /manifest|json/i.test(manifest.type || ''),
      JSON.stringify({ status: manifest?.status, type: manifest?.type, name: manifest?.json?.name }),
    );

    // Client routing refresh on deep link
    await page.goto(BASE + '/stats', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    record('spa.refresh.stats', page.url().includes('/stats'), page.url());

    // IndexedDB open
    const idb = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        const req = indexedDB.open('car-care-db');
        req.onerror = () => resolve({ ok: false, error: String(req.error) });
        req.onsuccess = () => {
          const db = req.result;
          const stores = [...db.objectStoreNames];
          db.close();
          resolve({ ok: true, stores });
        };
      });
    });
    record('idb.open', idb.ok && (idb.stores || []).includes('vehicles'), JSON.stringify(idb));

    const fatalConsole = consoleErrors.filter(
      (e) => !/favicon|Download the React DevTools|third-party/i.test(e),
    );
    record('console.noFatal', fatalConsole.length === 0, fatalConsole.slice(0, 5).join(' | ') || 'clean');

    await page.screenshot({ path: path.join(OUT, '99-final-settings.png'), fullPage: true });
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ base: BASE, results, at: new Date().toISOString() }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, failedNames: failed.map((f) => f.name) }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
