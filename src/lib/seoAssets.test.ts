import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function readPublic(name: string): string {
  return readFileSync(join(root, 'public', name), 'utf-8');
}

describe('SEO static assets', () => {
  it('allows search crawlers and points to the sitemap', () => {
    const robots = readPublic('robots.txt');
    expect(robots).toMatch(/User-agent:\s*\*/i);
    expect(robots).toMatch(/Allow:\s*\//);
    expect(robots).not.toMatch(/^\s*Disallow:\s*\/\s*$/m);
    expect(robots).toContain('Sitemap: https://car.adobesun.com/sitemap.xml');
    expect(robots).toMatch(/User-agent:\s*Googlebot/i);
    expect(robots).toMatch(/User-agent:\s*Baiduspider/i);
  });

  it('lists the app and the public intro page', () => {
    const sitemap = readPublic('sitemap.xml');
    expect(sitemap).toContain('https://car.adobesun.com/');
    expect(sitemap).toContain('https://car.adobesun.com/intro.html');
    expect(sitemap).toContain('urlset');
  });

  it('keeps the Google Search Console HTML verification file', () => {
    const verify = readPublic('google133d1449864ee82b.html').trim();
    expect(verify).toBe('google-site-verification: google133d1449864ee82b.html');
  });

  it('gives the app shell a purpose-stating title and description', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf-8');
    expect(html).toMatch(/<title>车护助手 — 离线优先的车辆养护账本<\/title>/);
    expect(html).toMatch(/name="description"/);
    expect(html).toContain('加油');
    expect(html).toContain('充电');
    expect(html).toContain('维保');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('/intro.html');
  });

  it('ships an indexable intro page with real feature copy', () => {
    const intro = readPublic('intro.html');
    expect(intro).toContain('<h1>车护助手</h1>');
    expect(intro).toContain('加油');
    expect(intro).toContain('充电');
    expect(intro).toContain('维保');
    expect(intro).toContain('保险');
    expect(intro).toContain('name="description"');
    expect(intro).toContain('rel="canonical"');
    expect(intro).toContain('https://car.adobesun.com/intro.html');
  });
});
