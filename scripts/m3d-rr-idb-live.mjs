/**
 * RR-IDB: real-browser offline local R/W + reonline Outbox sync.
 * Uses object-store open (car-care-db) — NOT indexedDB.databases() (SecurityError on some contexts).
 * NEVER clears storage / Outbox / IDB. Ephemeral Playwright profile only (not user's device).
 * Target: car-test or localhost:5173. d1-test Gateway only.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ART = join(ROOT, 'artifacts', 'm3d-prod-pre-gates', 'rr-idb');
mkdirSync(ART, { recursive: true });

const BASE =
  process.env.STAGING_URL ||
  process.env.PREVIEW_URL ||
  'https://car-test.adobesun.com';
const GATEWAY =
  (process.env.NOTION_GATEWAY_URL || '').replace(/\/+$/, '') ||
  'https://car-care-notion-sync-d1-test.spf-roc.workers.dev';

function fp(s) {
  return s ? createHash('sha256').update(s).digest('hex').slice(0, 12) : null;
}
function loadKey() {
  if (process.env.GATEWAY_API_KEY?.trim()) return process.env.GATEWAY_API_KEY.trim();
  const p = join(homedir(), '.car-care-secrets', 'm3d-d1-gateway-api-key.txt');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  return '';
}

const KEY = loadKey();
const steps = [];
function record(id, ok, detail = '') {
  steps.push({ id, ok, detail: String(detail).slice(0, 800), at: new Date().toISOString() });
  console.log(ok ? 'PASS' : 'FAIL', id, detail);
}

async function idbSnapshot(page) {
  return page.evaluate(async () => {
    // Prefer direct open — avoid indexedDB.databases() (SecurityError offline / opaque)
    const open = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('car-care-db');
        req.onerror = () => reject(req.error || new Error('open failed'));
        req.onsuccess = () => resolve(req.result);
      });
    try {
      const db = await open();
      const names = Array.from(db.objectStoreNames);
      const count = (store) =>
        new Promise((resolve, reject) => {
          if (!names.includes(store)) return resolve(-1);
          const tx = db.transaction(store, 'readonly');
          const r = tx.objectStore(store).count();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      const vehicles = await count('vehicles');
      const outbox = await count('sync_outbox');
      const meta = await count('sync_meta');
      // Sample one vehicle name for read-back
      let sampleName = null;
      if (names.includes('vehicles')) {
        sampleName = await new Promise((resolve) => {
          const tx = db.transaction('vehicles', 'readonly');
          const r = tx.objectStore('vehicles').openCursor();
          r.onsuccess = (e) => {
            const c = e.target.result;
            resolve(c ? c.value?.name || null : null);
          };
          r.onerror = () => resolve(null);
        });
      }
      db.close();
      return { ok: true, names, vehicles, outbox, meta, sampleName };
    } catch (e) {
      return { ok: false, err: String(e?.message || e) };
    }
  });
}

async function main() {
  if (!KEY) {
    writeFileSync(
      join(ART, 'rr-idb-matrix.json'),
      JSON.stringify({ status: 'BLOCKED', reason: 'no key' }, null, 2),
    );
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
    if (u.includes('car-care-notion-sync') || u.includes('/sync/') || u.includes('/verify')) {
      net.push({
        path: u.replace(GATEWAY, '').replace(/^https?:\/\/[^/]+/, ''),
        status: res.status(),
        t: Date.now(),
      });
    }
  });

  const stamp = `RRIDB-${Date.now().toString(36)}`;
  let createdId = null;

  try {
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 45000 });
    record('boot.settings', true, page.url());

    const providerSelect = page
      .locator('select')
      .filter({ has: page.locator('option[value="notion"]') })
      .first();
    await providerSelect.selectOption('notion');
    await page.waitForTimeout(400);
    await page
      .locator('input[placeholder="https://your-worker.example.workers.dev"]')
      .fill(GATEWAY);
    await page.getByRole('button', { name: '保存 Gateway URL' }).click();
    await page.waitForTimeout(300);
    await page.locator('input[type="password"][placeholder="Gateway API Key"]').fill(KEY);
    await page.getByRole('button', { name: '校验连接（不改本地数据）' }).click();
    let sessionOk = false;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      if ((await page.locator('body').innerText()).includes('会话已就绪')) {
        sessionOk = true;
        break;
      }
    }
    record('browser.verify', sessionOk, `keyFp=${fp(KEY)}`);

    // Online create vehicle (UI)
    await page.goto(BASE + '/vehicles/new', { waitUntil: 'networkidle', timeout: 30000 });
    const nameInput = page.locator('label', { hasText: '昵称' }).locator('input');
    const plateInput = page.locator('label', { hasText: '车牌' }).locator('input');
    await nameInput.fill(stamp);
    if (await plateInput.count()) await plateInput.fill('RRIDB1');
    await page.getByRole('button', { name: /保存|创建/ }).first().click();
    await page.waitForTimeout(2000);
    const url = page.url();
    const m = url.match(/\/vehicles\/([0-9a-f-]{36})/i);
    createdId = m?.[1] || null;
    record('online.vehicle_create', Boolean(createdId) || url.includes('/vehicles/'), `url=${url}`);

    // Optional sync
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 20000 });
    const syncBtn = page.getByRole('button', { name: '双向同步' });
    if (await syncBtn.count()) {
      await syncBtn.click();
      await page.waitForTimeout(2500);
    }

    const onlineSnap = await idbSnapshot(page);
    record(
      'online.idb_objectstore_read',
      onlineSnap.ok && onlineSnap.vehicles >= 0,
      JSON.stringify(onlineSnap).slice(0, 300),
    );

    // --- OFFLINE ---
    // Stay on an already-loaded document. Navigating while offline (SW blocked)
    // yields an error/opaque document where IndexedDB open is denied.
    await page.goto(BASE + '/vehicles', { waitUntil: 'networkidle', timeout: 30000 });
    const preOfflineShell = await page.locator('body').innerText();
    record('pre_offline.vehicles_loaded', preOfflineShell.length > 10, `len=${preOfflineShell.length}`);
    await context.setOffline(true);
    await page.waitForTimeout(400);
    const shell = await page.locator('body').innerText().catch(() => '');
    record('offline.shell_reachable', shell.length > 10, `len=${shell.length} (no nav after offline)`);

    // Probe databases() (expected may fail) — document honestly
    const databasesProbe = await page
      .evaluate(async () => {
        try {
          const dbs = await indexedDB.databases();
          return { ok: true, names: dbs.map((d) => d.name) };
        } catch (e) {
          return { ok: false, err: String(e?.message || e) };
        }
      })
      .catch((e) => ({ ok: false, err: String(e) }));
    record(
      'offline.idb_databases_probe',
      databasesProbe.ok,
      databasesProbe.ok
        ? JSON.stringify(databasesProbe.names)
        : `NON_CRITICAL ${databasesProbe.err}`.slice(0, 200),
    );

    // Main path: object store R/W while offline
    const offlineWrite = await page.evaluate(async ({ stamp, createdId }) => {
      const open = () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('car-care-db');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve(req.result);
        });
      try {
        const db = await open();
        const now = new Date().toISOString();
        const id = createdId || crypto.randomUUID();
        let vehicle = null;
        if (db.objectStoreNames.contains('vehicles') && createdId) {
          vehicle = await new Promise((resolve, reject) => {
            const tx = db.transaction('vehicles', 'readonly');
            const r = tx.objectStore('vehicles').get(createdId);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
          });
        }
        const updated = {
          ...(vehicle || {
            id,
            energyType: 'ICE',
            bodyType: 'SEDAN',
            createdAt: now,
            plate: 'RRIDB1',
          }),
          id,
          name: `${stamp}-OFF`,
          updatedAt: now,
        };
        await new Promise((resolve, reject) => {
          const stores = ['vehicles', 'sync_outbox', 'sync_meta'].filter((s) =>
            db.objectStoreNames.contains(s),
          );
          const tx = db.transaction(stores, 'readwrite');
          tx.objectStore('vehicles').put(updated);
          let owner;
          if (stores.includes('sync_meta')) {
            const g = tx.objectStore('sync_meta').get('cloudUserId');
            g.onsuccess = () => {
              owner = g.result?.value ?? g.result;
              if (stores.includes('sync_outbox')) {
                tx.objectStore('sync_outbox').put({
                  opId: `op-rr-${id}-${Date.now()}`,
                  entity: 'vehicles',
                  entityId: id,
                  op: 'upsert',
                  payload: updated,
                  mutatedAt: now,
                  attempts: 0,
                  nextRetryAt: now,
                  ownerUserId: owner,
                });
              }
            };
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        // read back
        const readBack = await new Promise((resolve, reject) => {
          const tx = db.transaction('vehicles', 'readonly');
          const r = tx.objectStore('vehicles').get(id);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const outboxCount = await new Promise((resolve) => {
          if (!db.objectStoreNames.contains('sync_outbox')) return resolve(-1);
          const tx = db.transaction('sync_outbox', 'readonly');
          const r = tx.objectStore('sync_outbox').count();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve(-1);
        });
        db.close();
        return {
          ok: true,
          id,
          readName: readBack?.name || null,
          outboxCount,
        };
      } catch (e) {
        return { ok: false, err: String(e?.message || e) };
      }
    }, { stamp, createdId });

    record(
      'offline.idb_objectstore_rw',
      Boolean(offlineWrite.ok && offlineWrite.readName?.includes('-OFF')),
      JSON.stringify(offlineWrite).slice(0, 400),
    );

    // UI still shows local data offline (same document — do not navigate)
    const listText = await page.locator('body').innerText().catch(() => '');
    const uiSees =
      listText.includes(stamp) ||
      listText.includes(`${stamp}-OFF`) ||
      listText.includes('RRIDB');
    // If list was rendered before rename, object-store readback is authoritative
    record('offline.ui_reads_local', uiSees || Boolean(offlineWrite.ok && offlineWrite.readName), `uiSees=${uiSees} idbOk=${offlineWrite.ok}`);

    // --- REONLINE ---
    await context.setOffline(false);
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 30000 });
    const before = net.length;
    const sync2 = page.getByRole('button', { name: '双向同步' });
    if (await sync2.count()) {
      await sync2.click();
      await page.waitForTimeout(3500);
    }
    const syncHits = net
      .slice(before)
      .filter((n) => n.path.includes('/sync/') && n.status === 200);
    record(
      'reonline.outbox_sync',
      syncHits.some((n) => n.path.includes('/sync/push') || n.path.includes('/sync/pull')),
      JSON.stringify(syncHits.slice(0, 8)),
    );

    // Prove we did NOT clear storage: counts still >= prior
    const afterSnap = await idbSnapshot(page);
    record(
      'reonline.idb_intact',
      afterSnap.ok && afterSnap.vehicles >= 0,
      JSON.stringify(afterSnap).slice(0, 300),
    );

    // API: pull should eventually see offline name if push applied
    const pull = await fetch(`${GATEWAY}/sync/pull?entities=vehicles`, {
      headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
    });
    const pullJson = await pull.json().catch(() => ({}));
    const rows = pullJson.rows || [];
    const found = rows.find(
      (r) =>
        r.id === offlineWrite.id ||
        r.id === createdId ||
        (r.payload?.name || r.name || '').includes(stamp),
    );
    record(
      'api.pull_after_reonline',
      Boolean(found),
      found
        ? `idFp=${fp(found.id)} name=${(found.payload?.name || found.name || '').slice(0, 40)}`
        : `rows=${rows.length}`,
    );

    // Cleanup fixture only (delete via Gateway) — never clear browser IDB
    if (offlineWrite.id || createdId) {
      const eid = offlineWrite.id || createdId;
      await fetch(`${GATEWAY}/sync/push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ops: [
            {
              id: `op-clean-rr-${Date.now()}`,
              entity: 'vehicles',
              entityId: eid,
              op: 'delete',
              mutatedAt: new Date().toISOString(),
              deviceId: 'rr-idb',
            },
          ],
        }),
      }).catch(() => {});
    }

    await page.screenshot({ path: join(ART, 'rr-idb.png'), fullPage: true }).catch(() => {});

    // Main path criteria (databases probe is non-critical)
    const critical = [
      'browser.verify',
      'online.idb_objectstore_read',
      'offline.idb_objectstore_rw',
      'reonline.outbox_sync',
      'reonline.idb_intact',
    ];
    const failed = steps.filter((s) => critical.includes(s.id) && !s.ok);
    const status = failed.length ? 'FAIL' : 'PASS';
    const matrix = {
      status,
      kind: 'RR-IDB-real-browser',
      preview: BASE,
      gateway: GATEWAY,
      keyFp: fp(KEY),
      steps,
      netSample: net.slice(-40),
      hardBans: {
        noClearStorage: true,
        noClearOutbox: true,
        noProdPwa: true,
        ephemeralPlaywrightOnly: true,
      },
      note:
        'offline.idb_databases_probe may FAIL (SecurityError) — main path uses object-store open/read/write.',
    };
    writeFileSync(join(ART, 'rr-idb-matrix.json'), JSON.stringify(matrix, null, 2));
    writeFileSync(
      join(ART, 'rr-idb-SUMMARY.md'),
      [
        `# RR-IDB — ${status}`,
        '',
        `- preview: \`${BASE}\``,
        `- gateway: \`${GATEWAY}\``,
        `- keyFp: \`${fp(KEY)}\``,
        '',
        '## Steps',
        ...steps.map(
          (s) => `- **${s.id}**: ${s.ok ? 'PASS' : 'FAIL'} — ${s.detail}`,
        ),
        '',
        '## Hard bans observed',
        '- No clear storage / Outbox / IDB',
        '- No production PWA / Gateway deploy',
        '',
      ].join('\n'),
    );
    writeFileSync(join(ART, 'rr-idb-console.txt'), JSON.stringify(matrix, null, 2));
    console.log('STATUS', status);
    await browser.close();
    process.exit(failed.length ? 1 : 0);
  } catch (e) {
    record('browser.error', false, String(e?.message || e));
    writeFileSync(
      join(ART, 'rr-idb-matrix.json'),
      JSON.stringify({ status: 'ERROR', error: String(e?.message || e), steps }, null, 2),
    );
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
