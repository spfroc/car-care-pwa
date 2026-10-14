/**
 * Minimal real-browser Notion Gateway smoke vs local preview (:5173 / CORS).
 * d1-test only. Fingerprints only. No deploy.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ART = dirname(fileURLToPath(import.meta.url));
mkdirSync(ART, { recursive: true });

const BASE = process.env.PREVIEW_URL || 'http://localhost:5173';
const GATEWAY =
  (process.env.NOTION_GATEWAY_URL || '').replace(/\/+$/, '') ||
  'https://car-care-notion-sync-d1-test.spf-roc.workers.dev';

function loadKey() {
  if (process.env.GATEWAY_API_KEY?.trim()) return process.env.GATEWAY_API_KEY.trim();
  const p = join(homedir(), '.car-care-secrets', 'm3d-d1-gateway-api-key.txt');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  return '';
}
function fp(s) {
  return s ? createHash('sha256').update(s).digest('hex').slice(0, 12) : null;
}

const KEY = loadKey();
const steps = [];
function record(id, ok, detail = '') {
  steps.push({ id, ok, detail: String(detail).slice(0, 500), at: new Date().toISOString() });
  console.log(ok ? 'PASS' : 'FAIL', id, detail);
}

async function main() {
  if (!KEY) {
    writeFileSync(join(ART, 'browser-matrix.json'), JSON.stringify({ status: 'BLOCKED', reason: 'no key' }, null, 2));
    process.exit(2);
  }

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
  const net = [];
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('car-care-notion-sync') || u.includes('/sync/') || u.includes('/verify') || u.includes('/health')) {
      net.push({ path: u.replace(GATEWAY, ''), status: res.status(), t: Date.now() });
    }
  });

  try {
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 30000 });
    record('boot.settings', true, page.url());

    const providerSelect = page.locator('select').filter({ has: page.locator('option[value="notion"]') }).first();
    await providerSelect.selectOption('notion');
    await page.waitForTimeout(500);
    record('ui.select_notion', (await providerSelect.inputValue()) === 'notion');

    const gwInput = page.locator('input[placeholder="https://your-worker.example.workers.dev"]');
    await gwInput.fill(GATEWAY);
    const saveUrl = page.getByRole('button', { name: '保存 Gateway URL' });
    await saveUrl.click();
    await page.waitForTimeout(400);
    record('ui.save_gateway_url', true, `keyFp=${fp(KEY)}`);

    await page.locator('input[type="password"][placeholder="Gateway API Key"]').fill(KEY);
    const beforeVerify = net.length;
    await page.getByRole('button', { name: '校验连接（不改本地数据）' }).click();

    let sessionOk = false;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      const text = await page.locator('body').innerText();
      if (text.includes('会话已就绪')) {
        sessionOk = true;
        break;
      }
      if (net.slice(beforeVerify).some((n) => n.path.includes('/verify') && n.status === 200) && i > 8) {
        // verify returned but UI may lag
        if (text.includes('会话已就绪') || text.includes('workspace')) {
          sessionOk = text.includes('会话已就绪');
          if (sessionOk) break;
        }
      }
    }
    const verifyHits = net.filter((n) => n.path.includes('/verify') && n.status === 200);
    if (!sessionOk && verifyHits.length) {
      // Accept verify 200 + no 401/403 as soft pass if UI string missed
      const body = await page.locator('body').innerText();
      sessionOk = !/401|Origin not allowed|Key 无效/.test(body) && verifyHits.length > 0;
      // Prefer explicit session string
      if (body.includes('会话已就绪')) sessionOk = true;
    }
    // Re-check UI string as primary
    {
      const body = await page.locator('body').innerText();
      sessionOk = body.includes('会话已就绪') && verifyHits.length > 0;
    }
    record(
      'browser.verify',
      sessionOk,
      `verify200=${verifyHits.length} bodyHasSession=${(await page.locator('body').innerText()).includes('会话已就绪')}`,
    );

    // Vehicle create via React-controlled fill
    const stamp = `D2E2E-${Date.now().toString(36)}`;
    await page.goto(BASE + '/vehicles/new', { waitUntil: 'networkidle', timeout: 20000 });
    const nameInput = page.locator('label', { hasText: '昵称' }).locator('input');
    await nameInput.fill(stamp);
    await page.locator('label', { hasText: '车牌' }).locator('input').fill('D2E2E');
    await page.locator('form.form button[type="submit"]').click();
    await page.waitForTimeout(1500);
    const onDetail = /\/vehicles\/[a-zA-Z0-9_-]+$/.test(page.url()) && !page.url().endsWith('/new');
    const bodyHas = (await page.locator('body').innerText()).includes(stamp);
    record('ui.vehicle_create', onDetail || bodyHas, `url=${page.url()} hasName=${bodyHas}`);

    // Bidirectional sync — require /sync/push or /sync/pull after click
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 20000 });
    // ensure still notion + session
    const bodySettings = await page.locator('body').innerText();
    if (!bodySettings.includes('会话已就绪')) {
      await page.locator('select').filter({ has: page.locator('option[value="notion"]') }).first().selectOption('notion');
      await page.waitForTimeout(300);
      await page.locator('input[placeholder="https://your-worker.example.workers.dev"]').fill(GATEWAY);
      await page.locator('input[type="password"][placeholder="Gateway API Key"]').fill(KEY);
      await page.getByRole('button', { name: '校验连接（不改本地数据）' }).click();
      await page.waitForTimeout(2000);
    }
    const beforeSync = net.length;
    await page.getByRole('button', { name: '双向同步' }).click();
    let syncNet = [];
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      syncNet = net.slice(beforeSync).filter((n) => n.path.includes('/sync/') && n.status === 200);
      if (syncNet.some((n) => n.path.includes('/push')) && syncNet.some((n) => n.path.includes('/pull'))) break;
      if (syncNet.length >= 1 && i > 20) break;
    }
    const syncOk = syncNet.some((n) => n.path.includes('/push') || n.path.includes('/pull'));
    record('browser.bidirectional_sync', syncOk, JSON.stringify(syncNet.slice(0, 8)));

    // Cross-check: Gateway pull should see the vehicle name (best-effort)
    let pullSeen = false;
    if (onDetail || bodyHas) {
      const pullRes = await fetch(`${GATEWAY}/sync/pull?entities=vehicles`, {
        headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
      });
      const pullJson = await pullRes.json();
      const rows = pullJson.rows || [];
      pullSeen = rows.some(
        (r) =>
          r.entity === 'vehicles' &&
          !r.deletedAt &&
          (r.payload?.name === stamp || r.payload?.plate === 'D2E2E'),
      );
      record('api.pull_sees_browser_vehicle', pullSeen, `rows=${rows.length}`);
      // cleanup if found
      if (pullSeen) {
        const row = rows.find((r) => r.payload?.name === stamp || r.payload?.plate === 'D2E2E');
        if (row?.id) {
          await fetch(`${GATEWAY}/sync/push`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ops: [
                {
                  id: `op-clean-browser-${Date.now()}`,
                  entity: 'vehicles',
                  entityId: row.id,
                  op: 'delete',
                  mutatedAt: new Date().toISOString(),
                  deviceId: 'browser-smoke',
                },
              ],
            }),
          });
        }
      }
    } else {
      record('api.pull_sees_browser_vehicle', false, 'skipped — create failed');
    }

    await page.screenshot({ path: join(ART, 'browser-smoke.png'), fullPage: true });
    record('browser.screenshot', true, 'browser-smoke.png');

    const critical = ['browser.verify', 'ui.vehicle_create', 'browser.bidirectional_sync'];
    const failed = steps.filter((s) => critical.includes(s.id) && !s.ok);
    const status = failed.length ? 'FAIL' : 'PASS';
    writeFileSync(
      join(ART, 'browser-matrix.json'),
      JSON.stringify(
        {
          status,
          kind: 'real-browser-E2E-minimal',
          preview: BASE,
          gateway: GATEWAY,
          keyFp: fp(KEY),
          steps,
          netSample: net.slice(-30),
          hardBans: { noDeploy: true, d1TestOnly: true, corsOrigin: 'http://localhost:5173' },
        },
        null,
        2,
      ),
    );
    console.log('STATUS', status);
    await browser.close();
    process.exit(failed.length ? 1 : 0);
  } catch (e) {
    record('browser.error', false, String(e?.message || e));
    try {
      await page.screenshot({ path: join(ART, 'browser-smoke-error.png'), fullPage: true });
    } catch {}
    writeFileSync(
      join(ART, 'browser-matrix.json'),
      JSON.stringify({ status: 'ERROR', error: String(e?.message || e), steps, netSample: net }, null, 2),
    );
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
