import { lazy } from 'react';
import { normalizePath } from '../lib/tabNav';

let statsPromise: Promise<typeof import('../pages/StatsPage')> | null = null;
let settingsPromise: Promise<typeof import('../pages/SettingsPage')> | null = null;

export function loadStatsPage() {
  statsPromise ??= import('../pages/StatsPage');
  return statsPromise;
}

export function loadSettingsPage() {
  settingsPromise ??= import('../pages/SettingsPage');
  return settingsPromise;
}

/** Start fetching a root-tab chunk. Does not mount it or read IndexedDB. */
export function preloadRootTab(pathname: string): void {
  const path = normalizePath(pathname);
  if (path === '/stats') void loadStatsPage();
  else if (path === '/settings') void loadSettingsPage();
}

export const StatsPage = lazy(() =>
  loadStatsPage().then((m) => ({ default: m.StatsPage })),
);
export const SettingsPage = lazy(() =>
  loadSettingsPage().then((m) => ({ default: m.SettingsPage })),
);
export const VehicleDetailPage = lazy(() =>
  import('../pages/VehicleDetailPage').then((m) => ({ default: m.VehicleDetailPage })),
);
export const VehicleFormPage = lazy(() =>
  import('../pages/VehicleFormPage').then((m) => ({ default: m.VehicleFormPage })),
);
export const RecordFormPage = lazy(() =>
  import('../pages/RecordFormPage').then((m) => ({ default: m.RecordFormPage })),
);
