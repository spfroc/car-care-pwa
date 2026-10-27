import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

function resolveGitSha(): string {
  if (process.env.VITE_GIT_SHA?.trim()) return process.env.VITE_GIT_SHA.trim();
  if (process.env.CF_PAGES_COMMIT_SHA?.trim()) {
    return process.env.CF_PAGES_COMMIT_SHA.trim().slice(0, 7);
  }
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const appVersion = pkg.version;
const appGitSha = resolveGitSha();
const appBuildTime = process.env.VITE_BUILD_TIME?.trim() || new Date().toISOString();

export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_GIT_SHA__: JSON.stringify(appGitSha),
    __APP_BUILD_TIME__: JSON.stringify(appBuildTime),
  },
  plugins: [
    react(),
    VitePWA({
      // Silent auto-update: activate new SW without a confirm banner.
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'pwa-maskable-512.png',
      ],
      manifest: {
        id: '/',
        name: '车护助手',
        short_name: '车护助手',
        description: '离线优先车辆养护账本：加油、保养、多车油耗电耗统计',
        theme_color: '#6d28d9',
        background_color: '#f8fafc',
        display: 'standalone',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Keep SEO/static entrypoints out of SPA navigateFallback.
        navigateFallbackDenylist: [
          /^\/about(?:\/|$)/,
          /^\/robots\.txt$/,
          /^\/sitemap\.xml$/,
        ],
        // M3-B: optional Background Sync signal (clients still run the engine)
        importScripts: ['bg-sync-sw-addon.js'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
