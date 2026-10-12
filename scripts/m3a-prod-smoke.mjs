/**
 * Read-only prod UI/PWA smoke — NEVER configure Supabase / never write user cloud.
 * Target: https://car.adobesun.com only for checks; also asserts staging still OK.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const PROD = 'https://car.adobesun.com';
const STAGE = 'https://car-test.adobesun.com';
const OUT = path.resolve('artifacts/m3a-prod-smoke');
const EXPECT = 'index-D4Bw8zWY.js';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail: String(detail).slice(0, 400) });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
}

async function smokeSite(browser, base, prefix) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 420, height: 900 },
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  const resp = await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  const html = await page.content();
  record(`${prefix}.https.home`, resp?.ok() ?? false, `status=${resp?.status()}`);
  record(`${prefix}.bundle`, html.includes(EXPECT), EXPECT);

  const stampRes = await page.request.get(base + '/deploy-stamp.txt');
  const stamp = await stampRes.text();
  record(
    `${prefix}.stamp`,
    stampRes.ok() && stamp.includes('8f335bc') && stamp.includes(EXPECT),
    stamp.split('\n').slice(0, 4).join(' | '),
  );

  await page.waitForTimeout(1500);
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    await navigator.serviceWorker.ready.catch(() => null);
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      controlling: !!navigator.serviceWorker.controller,
      scriptURL: reg?.active?.scriptURL || null,
    };
  });
  record(`${prefix}.sw`, !!sw.scriptURL || sw.controlling, JSON.stringify(sw));

  for (const route of ['/', '/stats', '/settings']) {
    const r = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(600);
    record(`${prefix}.route${route === '/' ? '/home' : route}`, r?.ok() ?? false, page.url());
  }

  await page.goto(base + '/settings', { waitUntil: 'networkidle' });
  const body = await page.locator('body').innerText();
  record(`${prefix}.settings.storageUI`, /数据存储|Supabase/.test(body), 'storage section visible');
  record(`${prefix}.settings.importExport`, /导出 JSON|导入 JSON/.test(body), 'import/export visible');
  // Explicit: do NOT fill supabase credentials or click verify/upload on prod
  record(`${prefix}.noCloudWrite`, true, 'skipped connect/upload/sync by design');

  const idb = await page.evaluate(async () => {
    return await new Promise((resolve) => {
      const req = indexedDB.open('car-care-db');
      req.onerror = () => resolve({ ok: false });
      req.onsuccess = () => {
        const db = req.result;
        const stores = [...db.objectStoreNames];
        db.close();
        resolve({ ok: true, stores });
      };
    });
  });
  record(`${prefix}.idb`, idb.ok && (idb.stores || []).includes('media'), JSON.stringify(idb.stores));

  const fatal = consoleErrors.filter((e) => !/favicon|React DevTools|third-party/i.test(e));
  record(`${prefix}.console`, fatal.length === 0, fatal.slice(0, 3).join(' | ') || 'clean');

  await page.screenshot({ path: path.join(OUT, `${prefix}-settings.png`), fullPage: true });
  await context.close();
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  await smokeSite(browser, PROD, 'prod');
  await smokeSite(browser, STAGE, 'stage');
} finally {
  await browser.close();
}

const summary = {
  at: new Date().toISOString(),
  results,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  failedNames: results.filter((r) => !r.ok).map((r) => r.name),
};
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, failedNames: summary.failedNames }, null, 2));
process.exit(summary.failed ? 1 : 0);
