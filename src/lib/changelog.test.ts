import { describe, expect, it } from 'vitest';
import { CHANGELOG, changelogBullets } from './changelog';

describe('CHANGELOG', () => {
  it('lists newest versions first and includes recent releases', () => {
    expect(CHANGELOG.length).toBeGreaterThanOrEqual(3);
    expect(CHANGELOG[0]?.version).toBe('1.0.2');
    expect(CHANGELOG.map((e) => e.version)).toEqual(
      expect.arrayContaining(['1.0.2', '1.0.1', '1.0.0']),
    );
  });

  it('returns Chinese or English bullets by language', () => {
    const first = CHANGELOG[0]!;
    expect(changelogBullets(first, 'zh-CN')[0]).toMatch(/无感|自动更新|更新日志/);
    expect(changelogBullets(first, 'en')[0]).toMatch(/auto-update|silent|changelog/i);
  });
});
