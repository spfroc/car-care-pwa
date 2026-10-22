/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injected at build time via Vite `define` (package.json + git / CI env). */
declare const __APP_VERSION__: string;
declare const __APP_GIT_SHA__: string;
declare const __APP_BUILD_TIME__: string;
