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

  it('exposes feedback / about / changelog copy', () => {
    expect(translate('zh-CN', 'settings.feedback')).toBe('问题反馈');
    expect(translate('en', 'settings.feedback')).toBe('Feedback');
    expect(translate('zh-CN', 'settings.about')).toBe('关于本应用');
    expect(translate('zh-CN', 'settings.introLink')).toBe('公开功能介绍');
    expect(translate('en', 'settings.introLink')).toBe('Public feature overview');
    expect(translate('zh-CN', 'home.introLink')).toContain('车护助手');
    expect(translate('zh-CN', 'settings.changelog')).toBe('更新日志');
    expect(translate('zh-CN', 'settings.hideBottomNav')).toBe('隐藏底栏');
    expect(translate('en', 'settings.hideBottomNav')).toBe('Hide bottom bar');
    expect(translate('en', 'settings.changelogShow')).toBe('Show changelog');
    expect(translate('zh-CN', 'settings.feedbackMailtoHint', { email: 'a@b.c' })).toContain('a@b.c');
  });
});

