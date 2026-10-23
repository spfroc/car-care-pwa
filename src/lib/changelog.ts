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
    version: '1.0.7',
    date: '2026-10-23',
    bulletsZh: [
      '未加满的加油并入前后两次加满，按这段里程和升数计算油耗',
      '还没再次加满的尾段不计入平均油耗，只在区间里标为参考',
    ],
    bulletsEn: [
      'Partial fill-ups merge into the surrounding full-to-full interval',
      'An open trailing segment stays out of the average and is shown as an estimate',
    ],
  },
  {
    version: '1.0.6',
    date: '2026-10-22',
    bulletsZh: [
      '首屏不再解析统计、设置、快捷记账面板和同步客户端，首页先出来',
      '统计 / 设置的列表改到进入该页或开始滑向该页时再读本地数据库',
      'Supabase 客户端改到真正同步或登录时再加载；离线队列仍在',
    ],
    bulletsEn: [
      'Home paints without parsing Stats, Settings, the quick-entry sheet, or the sync client',
      'Stats and Settings read IndexedDB when you open that tab or start swiping toward it',
      'The Supabase client loads on the first real sync or sign-in; the offline outbox stays',
    ],
  },
  {
    version: '1.0.5',
    date: '2026-10-22',
    bulletsZh: [
      '首页 / 统计 / 设置左右滑动时，页面跟手平移并交叉淡入淡出',
      '在首页向右、或在设置向左（没有下一页）时，最多拖出约三分之一屏，露出灰白渐变模糊；松手后回弹，不切换页面',
    ],
    bulletsEn: [
      'Swiping between Home, Stats, and Settings slides and crossfades with the finger',
      'On Home (swipe right) or Settings (swipe left), when there is no next page, the drag resists after about one-third of the screen and shows a blurred gray-white gradient; release springs back without switching tabs',
    ],
  },
  {
    version: '1.0.4',
    date: '2026-10-22',
    bulletsZh: [
      '设置新增「隐藏底栏」开关（默认关闭，底栏始终显示）',
      '开启后底栏始终隐藏；上下滑动不再显示或隐藏底栏。左右滑动切换首页 / 统计 / 设置保持可用',
    ],
    bulletsEn: [
      'Settings: “Hide bottom bar” toggle (off by default — the tab bar stays visible)',
      'When on, the tab bar stays hidden; scrolling no longer shows or hides it. Left/right swipe between Home / Stats / Settings still works',
    ],
  },
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
