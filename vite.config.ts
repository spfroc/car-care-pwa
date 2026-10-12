import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    VitePWA({
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
        description: '离线优先车辆养护账本',
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
