import { isStandaloneDisplay } from '../hooks/usePwaInstall';
import {
  FEEDBACK_EMAIL,
  GITHUB_ISSUES_NEW_URL,
  GITHUB_REPO_URL,
} from './feedbackConstants';

/** Build-time stamps from Vite `define` (see vite.config.ts). */
export function getAppVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
}

export function getAppGitSha(): string {
  return typeof __APP_GIT_SHA__ !== 'undefined' ? __APP_GIT_SHA__ : 'dev';
}

export function getAppBuildTime(): string {
  return typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : '';
}

/** Short display-mode label for diagnostics / issue templates. */
export function getDisplayModeLabel(): string {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const modes = ['standalone', 'minimal-ui', 'fullscreen', 'browser'] as const;
    for (const m of modes) {
      if (window.matchMedia?.(`(display-mode: ${m})`).matches) return m;
    }
  } catch {
    /* ignore */
  }
  if (isStandaloneDisplay()) return 'standalone';
  return 'browser';
}

export function formatBuildTimeForDisplay(iso: string, language?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const en = (language ?? '').toLowerCase().startsWith('en');
  try {
    return d.toLocaleString(en ? 'en-US' : 'zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export type FeedbackEnvSnapshot = {
  version: string;
  gitSha: string;
  buildTime: string;
  userAgent: string;
  displayMode: string;
  standalone: boolean;
  online: boolean;
  href: string;
};

export function collectFeedbackEnv(overrides?: Partial<FeedbackEnvSnapshot>): FeedbackEnvSnapshot {
  const standalone =
    typeof window !== 'undefined' ? isStandaloneDisplay() : false;
  return {
    version: getAppVersion(),
    gitSha: getAppGitSha(),
    buildTime: getAppBuildTime(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    displayMode: getDisplayModeLabel(),
    standalone,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    href: typeof location !== 'undefined' ? location.href : '',
    ...overrides,
  };
}

function feedbackBody(env: FeedbackEnvSnapshot, language?: string): string {
  const en = (language ?? '').toLowerCase().startsWith('en');
  if (en) {
    return [
      '## What happened',
      '',
      '(Describe the bug or request)',
      '',
      '## Steps to reproduce',
      '',
      '1. ',
      '',
      '## Expected',
      '',
      '',
      '## Environment (auto-filled — please keep)',
      '',
      `- App version: ${env.version}`,
      `- Build / commit: ${env.gitSha}`,
      `- Build time: ${env.buildTime || 'n/a'}`,
      `- Display mode: ${env.displayMode}`,
      `- Standalone PWA: ${env.standalone ? 'yes' : 'no'}`,
      `- Online when opened: ${env.online ? 'yes' : 'no'}`,
      `- Page URL: ${env.href}`,
      `- User-Agent: ${env.userAgent}`,
      '',
    ].join('\n');
  }
  return [
    '## 问题描述',
    '',
    '（请描述遇到的问题或建议）',
    '',
    '## 复现步骤',
    '',
    '1. ',
    '',
    '## 期望结果',
    '',
    '',
    '## 环境信息（自动填写，请保留）',
    '',
    `- 应用版本: ${env.version}`,
    `- 构建 / 提交: ${env.gitSha}`,
    `- 构建时间: ${env.buildTime || '无'}`,
    `- 显示模式: ${env.displayMode}`,
    `- 独立 PWA: ${env.standalone ? '是' : '否'}`,
    `- 打开时是否联网: ${env.online ? '是' : '否'}`,
    `- 页面 URL: ${env.href}`,
    `- User-Agent: ${env.userAgent}`,
    '',
  ].join('\n');
}

export function buildGitHubIssueUrl(language?: string, env?: FeedbackEnvSnapshot): string {
  const snap = env ?? collectFeedbackEnv();
  const en = (language ?? '').toLowerCase().startsWith('en');
  const title = en
    ? `[Feedback] Car Care ${snap.version} (${snap.gitSha})`
    : `[问题反馈] 车护助手 ${snap.version} (${snap.gitSha})`;
  const params = new URLSearchParams({
    title,
    body: feedbackBody(snap, language),
  });
  return `${GITHUB_ISSUES_NEW_URL}?${params.toString()}`;
}

export function buildFeedbackMailtoUrl(language?: string, env?: FeedbackEnvSnapshot): string {
  const snap = env ?? collectFeedbackEnv();
  const en = (language ?? '').toLowerCase().startsWith('en');
  const subject = en
    ? `Car Care feedback ${snap.version} (${snap.gitSha})`
    : `车护助手问题反馈 ${snap.version} (${snap.gitSha})`;
  const body = feedbackBody(snap, language);
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export { FEEDBACK_EMAIL, GITHUB_ISSUES_NEW_URL, GITHUB_REPO_URL };
