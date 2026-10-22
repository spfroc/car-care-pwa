import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDBForTests, DB_NAME, ensureDefaultSettings } from '../db';
import { getSetting, loadAppSettings, setSetting } from './settings';

async function reset() {
  await closeDBForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

describe('hideBottomNav setting', () => {
  beforeEach(reset);
  afterEach(async () => {
    await closeDBForTests();
  });

  it('defaults to off and round-trips in the settings store', async () => {
    await ensureDefaultSettings();
    expect(await getSetting('hideBottomNav')).toBe(false);
    expect((await loadAppSettings()).hideBottomNav).toBe(false);

    await setSetting('hideBottomNav', true);
    expect((await loadAppSettings()).hideBottomNav).toBe(true);

    // Defaults must not clobber a saved preference.
    await ensureDefaultSettings();
    expect(await getSetting('hideBottomNav')).toBe(true);

    await setSetting('hideBottomNav', false);
    expect((await loadAppSettings()).hideBottomNav).toBe(false);
  });

  it('treats a missing key as off', async () => {
    expect((await loadAppSettings()).hideBottomNav).toBe(false);
  });
});
