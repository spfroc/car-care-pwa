import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function runtimeSource(rel: string): string {
  const raw = readFileSync(join(root, rel), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/import\s*\(\s*['"][^'"]+['"]\s*\)/g, '')
    .replace(/import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
}

function expectNoStatic(rel: string, spec: string) {
  const src = runtimeSource(rel);
  const re = new RegExp(`from\\s+['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
  expect(src, `${rel} should not statically import ${spec}`).not.toMatch(re);
}

describe('lazy boundaries (home must not statically import these)', () => {
  it('keeps supabase and the sync engine off the shell', () => {
    expectNoStatic('src/sync/engine.ts', './providers/supabase');
    expectNoStatic('src/sync/engine.ts', '@supabase/supabase-js');
    expectNoStatic('src/sync/syncLifecycle.ts', './engine');
    expectNoStatic('src/App.tsx', './sync/syncLifecycle');
    expectNoStatic('src/App.tsx', './sync/engine');
    expectNoStatic('src/components/DataStorageSettings.tsx', '../sync/engine');
    expectNoStatic('src/components/DataStorageSettings.tsx', '../sync/providers/supabase');
    const engine = readFileSync(join(root, 'src/sync/engine.ts'), 'utf8');
    expect(engine).toMatch(/import\('\.\/providers\/supabase'\)/);
    const lifecycle = readFileSync(join(root, 'src/sync/syncLifecycle.ts'), 'utf8');
    expect(lifecycle).toMatch(/import\('\.\/engine'\)/);
    expect(lifecycle).toMatch(/import\('\.\/recoverStale'\)/);
  });

  it('keeps stats, settings, and record flows out of the shell module graph', () => {
    for (const spec of [
      './pages/StatsPage',
      './pages/SettingsPage',
      './pages/RecordFormPage',
      './pages/VehicleFormPage',
      './pages/VehicleDetailPage',
    ]) {
      expectNoStatic('src/App.tsx', spec);
    }
    expectNoStatic('src/components/RootTabPager.tsx', '../pages/StatsPage');
    expectNoStatic('src/components/RootTabPager.tsx', '../pages/SettingsPage');
    expectNoStatic('src/components/QuickEntryFab.tsx', './QuickEntrySheet');
  });

  it('does not pull the outbox into list/read modules', () => {
    for (const rel of [
      'src/repositories/records.ts',
      'src/repositories/vehicles.ts',
      'src/repositories/stations.ts',
      'src/repositories/media.ts',
      'src/repositories/settings.ts',
    ]) {
      expectNoStatic(rel, '../sync/outbox');
      expectNoStatic(rel, '../sync/notionMap');
    }
  });
});
