/**
 * In-app release notes for Settings → 更新日志.
 * Newest first. Append a new object when bumping package.json version.
 */
export type ChangelogEntry = {
  version: string;
  /** Optional ISO date (YYYY-MM-DD) for display; omit if unknown. */
  date?: string;
  bulletsZh: string[];
  bulletsEn: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.3',
    date: '2026-10-22',
    bulletsZh: [
      '主页 / 统计 / 设置支持左右滑动切换',
      '使用中底栏自动隐藏；长距离上下滑动后再显示，停滑约 1 秒后再次隐藏',
    ],
    bulletsEn: [
      'Swipe left/right between Home / Stats / Settings',
      'Bottom tab bar auto-hides while using; long vertical swipe shows it, then hides ~1s after scrolling stops',
    ],
  },
  {
    version: '1.0.2',
    date: '2026-10-22',
    bulletsZh: [
      'PWA 改为无感自动更新（不再弹出「发现新版本 / 立即更新」）',
      '设置页底部新增「更新日志」（默认折叠）',
      '仍每小时检查一次是否有新版本',
    ],
    bulletsEn: [
      'PWA silent auto-update (no “new version / update now” banner)',
      'Settings: changelog section at the bottom (collapsed by default)',
      'Still checks for updates about once per hour',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-10-22',
    bulletsZh: ['车辆详情统计瓦片（加油花费 / 每公里成本等）窄屏不再横向滚动'],
    bulletsEn: [
      'Vehicle detail mini-stats tiles no longer cause a horizontal scrollbar on narrow phones',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-22',
    bulletsZh: [
      '设置页新增「问题反馈」（GitHub Issues 预填 + 邮件备用）',
      '设置页新增「关于本应用」版本 / 构建号',
      '已安装 PWA 可检测新版本（后续改为无感自动更新）',
    ],
    bulletsEn: [
      'Settings: feedback entry (prefilled GitHub Issues + mailto fallback)',
      'Settings: About section with version / build stamp',
      'Installed PWA can detect new versions (later switched to silent auto-update)',
    ],
  },
];

export function changelogBullets(entry: ChangelogEntry, language?: string): string[] {
  const en = (language ?? '').toLowerCase().startsWith('en');
  return en ? entry.bulletsEn : entry.bulletsZh;
}
