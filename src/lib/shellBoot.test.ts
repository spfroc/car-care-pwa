import { afterEach, describe, expect, it, vi } from 'vitest';
import { readShellBootCache, writeShellBootCache } from './shellBoot';

describe('shell boot cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips language and hideBottomNav without dropping the other field', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    });
    expect(readShellBootCache()).toEqual({});
    writeShellBootCache({ hideBottomNav: true });
    writeShellBootCache({ language: 'en' });
    expect(readShellBootCache()).toEqual({ hideBottomNav: true, language: 'en' });
  });

  it('ignores malformed JSON', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{',
      setItem: () => {},
    });
    expect(readShellBootCache()).toEqual({});
  });
});
