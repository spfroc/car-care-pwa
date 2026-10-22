import { describe, expect, it } from 'vitest';
import {
  buildFeedbackMailtoUrl,
  buildGitHubIssueUrl,
  collectFeedbackEnv,
  formatBuildTimeForDisplay,
} from './appMeta';
import { FEEDBACK_EMAIL, GITHUB_ISSUES_NEW_URL } from './feedbackConstants';

describe('appMeta feedback links', () => {
  const env = {
    version: '1.0.0',
    gitSha: 'abc1234',
    buildTime: '2026-10-22T01:00:00.000Z',
    userAgent: 'TestAgent/1.0',
    displayMode: 'standalone',
    standalone: true,
    online: true,
    href: 'https://car.adobesun.com/settings',
  };

  it('builds a GitHub Issues URL with prefilled title and env body', () => {
    const url = buildGitHubIssueUrl('zh-CN', env);
    expect(url.startsWith(`${GITHUB_ISSUES_NEW_URL}?`)).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('title')).toContain('1.0.0');
    expect(q.get('title')).toContain('abc1234');
    const body = q.get('body') ?? '';
    expect(body).toContain('应用版本: 1.0.0');
    expect(body).toContain('构建 / 提交: abc1234');
    expect(body).toContain('TestAgent/1.0');
    expect(body).toContain('standalone');
    expect(body).toContain('独立 PWA: 是');
  });

  it('builds English GitHub Issues template when language is en', () => {
    const url = buildGitHubIssueUrl('en', env);
    const q = new URL(url).searchParams;
    expect(q.get('title')).toMatch(/Feedback/i);
    expect(q.get('body')).toContain('App version: 1.0.0');
    expect(q.get('body')).toContain('Standalone PWA: yes');
  });

  it('builds mailto fallback with documented contact constant', () => {
    const url = buildFeedbackMailtoUrl('zh-CN', env);
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?`)).toBe(true);
    expect(url).toContain(encodeURIComponent('车护助手问题反馈'));
    expect(decodeURIComponent(url)).toContain('abc1234');
  });

  it('collectFeedbackEnv merges overrides', () => {
    const snap = collectFeedbackEnv({ version: '9.9.9', gitSha: 'deadbee' });
    expect(snap.version).toBe('9.9.9');
    expect(snap.gitSha).toBe('deadbee');
  });

  it('formats build time for display', () => {
    expect(formatBuildTimeForDisplay('')).toBe('—');
    expect(formatBuildTimeForDisplay('not-a-date')).toBe('not-a-date');
    const shown = formatBuildTimeForDisplay('2026-10-22T01:00:00.000Z', 'zh-CN');
    expect(shown.length).toBeGreaterThan(8);
  });
});
