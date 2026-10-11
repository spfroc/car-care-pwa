import { describe, expect, it } from 'vitest';
import { translate } from './messages';

describe('translate', () => {
  it('returns Chinese by default', () => {
    expect(translate(undefined, 'nav.home')).toBe('首页');
    expect(translate('zh-CN', 'nav.settings')).toBe('设置');
  });

  it('returns English for en / en-US', () => {
    expect(translate('en', 'nav.home')).toBe('Home');
    expect(translate('en-US', 'settings.language')).toBe('Language');
    expect(translate('en', 'app.name')).toBe('Car Care');
  });

  it('interpolates params', () => {
    expect(translate('en', 'rform.mediaCount', { n: 3 })).toBe('3 photo(s) attached (JPEG compressed)');
    expect(translate('zh-CN', 'rform.mediaCount', { n: 2 })).toBe('已附 2 张图（已压缩 JPEG）');
  });
});
