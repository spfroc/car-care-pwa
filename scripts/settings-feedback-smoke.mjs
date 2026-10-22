#!/usr/bin/env node
/**
 * Smoke: after `npm run build`, assert Settings feedback / version wiring
 * is present in the production bundle (no browser required).
 *
 * Usage: node scripts/settings-feedback-smoke.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const distJs = join(root, 'dist', 'assets');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

if (!existsSync(distJs)) {
  console.error('FAIL: dist/assets missing — run npm run build first');
  process.exit(1);
}

const files = readdirSync(distJs).filter((f) => f.endsWith('.js'));
const blob = files.map((f) => readFileSync(join(distJs, f), 'utf-8')).join('\n');

const checks = [
  ['github issues new', 'github.com/spfroc/car-care-pwa/issues/new'],
  ['feedback email constant', 'car-care-feedback@adobesun.com'],
  ['zh feedback title', '问题反馈'],
  ['zh about section', '关于本应用'],
  ['zh changelog section', '更新日志'],
  ['changelog silent-update note', '无感自动更新'],
  ['package version embedded', pkg.version],
];

const failed = [];
for (const [name, needle] of checks) {
  if (!blob.includes(needle)) failed.push(name);
}

// Hourly poll is minified (often 36e5); SW autoUpdate injects skipWaiting.
const hasHourly =
  blob.includes('3600000') || blob.includes('36e5') || /36\s*\*\s*1e5/.test(blob);
if (!hasHourly) failed.push('hourly registration.update interval');

const swPath = join(root, 'dist', 'sw.js');
const sw = existsSync(swPath) ? readFileSync(swPath, 'utf-8') : '';
if (!/skipWaiting/.test(sw)) failed.push('sw skipWaiting (autoUpdate)');

if (failed.length) {
  console.error('FAIL settings-feedback-smoke:', failed.join(', '));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      version: pkg.version,
      jsFiles: files.length,
      checks: [...checks.map(([n]) => n), 'hourly registration.update interval', 'sw skipWaiting (autoUpdate)'],
    },
    null,
    2,
  ),
);
