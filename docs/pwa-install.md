# PWA 安装说明与排障（GitHub Pages `/car-care-pwa/`）

## 清单与路径（已核对）

| 项 | 值 |
|---|---|
| `base` / Router `basename` | `/car-care-pwa/` |
| `start_url` | `/car-care-pwa/` |
| `scope` | `/car-care-pwa/` |
| `id` | `/car-care-pwa/` |
| `display` | `standalone` |
| Icons | `pwa-192.png` / `pwa-512.png` (`purpose: any`) + `pwa-maskable-512.png` (`maskable`) |
| iOS | `apple-touch-icon.png` + `apple-mobile-web-app-capable` |
| Service Worker | `vite-plugin-pwa`，`registerType: 'autoUpdate'`，注册于 `main.tsx` |

线上 manifest / 图标需能从 `https://<user>.github.io/car-care-pwa/` 以 200 打开（相对路径相对 manifest URL 解析）。

## 「提示已安装但主屏幕没有图标」— 根因假设

站点侧 **start_url / scope / SW / 图标 URL 目前无明显断裂**（相对 Pages 子路径正确）。更常见原因在设备 / 浏览器侧：

1. **无 GMS 的国产机 + Chrome**：往往只能建「浏览器快捷方式」，不能铸 WebAPK；图标可能带 Chrome 角标，或落在应用抽屉而非当前桌面页。
2. **Chrome「创建桌面快捷方式」权限被关**（小米 / 华为等常见）：安装流程走完，桌面仍无图标。
3. **「安装应用」vs「添加到主屏幕」**：前者偏 WebAPK，后者是快捷方式；用户点了菜单项但桌面布局 / 负一屏过滤导致看不见。
4. **微信 / 国产 WebView**：没有合格的 `beforeinstallprompt`，甚至无法正确写主屏幕；必须用系统 Chrome / Safari 打开 Pages URL。
5. **图标延迟**：部分机型 WebAPK 铸造需十余秒，期间桌面暂时空缺。
6. **曾缺 maskable**：旧版仅有极简 `any` 图标时，个别启动器自适应裁剪异常；现已补 `maskable` 512 与更清晰的「车」字标。

## 应用内 UX

- 捕获 `beforeinstallprompt` → 横幅「安装」调用 `prompt()`。
- `appinstalled` 或 `display-mode: standalone` → 「已安装」toast。
- 无原生事件时：「怎么装」说明（iOS / Android / 桌面 / 国产机提示）。
- 设置页可再次展开安装说明。

## 人工验证清单

1. Chrome DevTools → Application → Manifest：无错误；Icons 可预览；SW 已激活。
2. 桌面 Chrome：可出现安装按钮 / 地址栏安装图标。
3. Android Chrome：安装后检查桌面 **与** 应用列表；若无图标，打开系统设置 → 应用 → Chrome → 权限 / 桌面快捷方式。
4. iOS Safari：分享 → 添加到主屏幕 → 无浏览器栏打开。
5. 微信内打开：应引导用户用系统浏览器打开（当前文案已提示）。
