import { describe, expect, it } from 'vitest';
import { adjacentTabPath, isRootTabPath, normalizePath, rootTabIndex } from './tabNav';

describe('tabNav', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('/stats/')).toBe('/stats');
    expect(normalizePath('')).toBe('/');
  });

  it('identifies root tabs only', () => {
    expect(isRootTabPath('/')).toBe(true);
    expect(isRootTabPath('/stats')).toBe(true);
    expect(isRootTabPath('/settings')).toBe(true);
    expect(isRootTabPath('/vehicles/abc')).toBe(false);
  });

  it('swipes across home → stats → settings', () => {
    expect(adjacentTabPath('/', 1)).toBe('/stats');
    expect(adjacentTabPath('/stats', 1)).toBe('/settings');
    expect(adjacentTabPath('/settings', 1)).toBe(null);
    expect(adjacentTabPath('/settings', -1)).toBe('/stats');
    expect(adjacentTabPath('/', -1)).toBe(null);
    expect(adjacentTabPath('/vehicles/x', 1)).toBe(null);
  });

  it('indexes root tabs', () => {
    expect(rootTabIndex('/')).toBe(0);
    expect(rootTabIndex('/stats/')).toBe(1);
    expect(rootTabIndex('/vehicles/1')).toBe(-1);
  });
});
