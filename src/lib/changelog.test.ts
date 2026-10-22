import { describe, expect, it } from 'vitest';
import { CHANGELOG, changelogBullets } from './changelog';

describe('CHANGELOG', () => {
  it('lists newest versions first and includes recent releases', () => {
    expect(CHANGELOG.length).toBeGreaterThanOrEqual(3);
    expect(CHANGELOG[0]?.version).toBe('1.0.6');
    expect(CHANGELOG.map((e) => e.version)).toEqual(
      expect.arrayContaining(['1.0.6', '1.0.5', '1.0.4', '1.0.3', '1.0.2', '1.0.1', '1.0.0']),
    );
  });

  it('returns Chinese or English bullets by language', () => {
    const first = CHANGELOG[0]!;
    expect(changelogBullets(first, 'zh-CN').join(' ')).toMatch(/首屏|同步/);
    expect(changelogBullets(first, 'en').join(' ')).toMatch(/Home|sync/i);
    const swipe = CHANGELOG.find((e) => e.version === '1.0.5')!;
    expect(changelogBullets(swipe, 'zh-CN').join(' ')).toMatch(/滑动/);
    expect(changelogBullets(swipe, 'en').join(' ')).toMatch(/swipe/i);
  });
});

