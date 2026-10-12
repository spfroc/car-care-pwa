# M2 Staging 验收 + 生产发布准备报告

> **严禁**：未部署、也不会部署 `https://car.adobesun.com`。  
> **时间**：2026-10-12（Asia/Shanghai / CST）  
> **执行**：Grok Bot executor（独立验收）

## 1. 版本与环境

| 项 | 值 |
|---|---|
| PR #2 merge（origin/main） | `9fbdf83` — Merge pull request #2 from spfroc/feature/m2-user-owned-data-storage |
| 本地 main 额外提交（已上 staging，尚未 push origin） | `35210b0` — fix(pwa): static boot placeholder so #root is never empty pre-JS |
| Staging | https://car-test.adobesun.com → Contabo `/var/www/car-care-staging` |
| Staging 资源指纹 | `assets/index-DSI5GT2u.js` sha256 `1aa6c2f0…d8fb`（与本地 `35210b0` 构建一致） |
| Staging 部署时间 | 2026-10-12 05:10:18 +0200 ≈ **11:10 CST** |
| Prod | https://car.adobesun.com → `/var/www/car-care`（**只读核对**，未部署；仍为旧 bundle `index-D8jUXj0h.js`，无 boot placeholder） |
| Disposable Supabase | `car-care-m2-smoke` / `skwoahneuqkqgxzpkkzl`（**仅此**；未触碰 `tqjowsffppgoqtdokbzp`） |

### SHA 结论

- Staging **运行内容 = `35210b0` 构建**，相对 `origin/main`（`9fbdf83`）多 1 个 boot placeholder 修复。
- `35210b0` 需经独立 PR push 到 origin（见下文 PR）。
- 账号切换安全修复在新分支 `fix/m2-account-switch-safety`（基于 `9fbdf83`），**未部署到任何 Contabo 站点**。

## 2. PASS/FAIL 矩阵

### 2.1 Staging UI / PWA 冒烟（Playwright → car-test）

脚本：`scripts/m2-staging-browser-smoke.mjs`  
产物：`artifacts/staging-smoke/`（截图 + `results.json`）  
时间：约 11:19 CST

| 检查项 | 结果 | 备注 |
|---|---|---|
| HTTPS home 200 | **PASS** | Cloudflare + nginx |
| `#root` 非空 / 可交互 | **PASS** | boot placeholder + React 挂载；首页「还没有车辆」 |
| Service Worker 注册/控制 | **PASS** | `sw.js` controlling |
| Precache | **PASS** | `workbox-precache-v2-…` 13 entries |
| 路由 `/` `/stats` `/settings` `/vehicles/new` | **PASS** | SPA try_files OK |
| Settings 数据存储 | **PASS** | 可见 Supabase / 数据存储 |
| Settings 导入导出 | **PASS** | JSON 导入/导出文案存在 |
| manifest `application/manifest+json` | **PASS** | name=车护助手 |
| Deep link 刷新 `/stats` | **PASS** | 客户端路由 |
| IndexedDB `car-care-db` | **PASS** | stores 含 vehicles/records/sync_outbox/… |
| Console 无致命错误 | **PASS** | clean |
| **Prod 部署** | **N/A / 禁止** | 未执行任何 prod rsync/deploy |

截图路径：

- `artifacts/staging-smoke/01-home.png` … `05-vehicles-new.png`
- `artifacts/staging-smoke/99-final-settings.png`
- `artifacts/staging-smoke/results.json`

### 2.2 单元 / 类型 / 构建

| 检查项 | 结果 | 日志 |
|---|---|---|
| `npm test`（含修复后） | **PASS** 194 | `artifacts/m2-acceptance-unit-final.log` |
| `npx tsc -b` | **PASS** | `artifacts/m2-acceptance-tsc.log` |
| `npm run build` | **PASS** | `artifacts/m2-acceptance-build.log`（修复分支产物 `index-DD7_Q8cM.js`，**未部署**） |

### 2.3 真实 Supabase E2E（仅 disposable）

| 层 | 结果 | 日志/说明 |
|---|---|---|
| Layer1 `scripts/m2-supabase-smoke.mjs` | **PASS**（8/8） | auth / table / LWW apply+skip+newer / cross-device pull / RLS anon block / cleanup |
| Layer2 `supabase.live-smoke.test.ts` | **PASS** | connect→upload→restore→disconnect 保队列→reconnect sync |
| Layer3 `supabase.ab-e2e.test.ts` A/B | **PASS** | 见下表 |

#### A/B E2E 场景矩阵（synthetic，两账号 + 顺序清空 IDB 模拟双端）

| 场景 | 结果 | DB 校验 |
|---|---|---|
| A 创建车辆+记录 → firstUpload | **PASS** | `car_care_rows` 出现对应 id（user A） |
| B（同账号、空 IDB）replaceLocal restore | **PASS** | 本地车辆名/金额匹配 |
| B 编辑 → bidirectionalSync | **PASS** | 云端 payload.name = Edited |
| 离线编辑 → disconnect 保 outbox → reconnect sync | **PASS** | 云端 = OfflineEdit |
| 删除记录 + sync | **PASS** | `deleted_at` 非空（tombstone） |
| 并发冲突（云端较新 vs 本地旧） | **PASS** | LWW 云端胜出 CloudWins |
| A/B **账号切换**（本地仍有 A 数据时登录 B） | **PASS（阻止）** | meta.cloudUserId 仍为 A；verify `ok:false` |
| 错误密码 auth fail | **PASS** | signIn ok=false |
| Media base64 超限校验 | **PASS** | validate → `too large` |
| 小 media 写入云端 | **PASS** | entity=media 行存在 |
| RLS：B 拉不到 A 的 id | **PASS** | B pull 无 A 的 vehicle id |
| 生产项目 `tqjowsffppgoqtdokbzp` | **未触碰** | — |

冒烟账号（仅 disposable，报告不写密码）：`m2smoke@carcare.test`、`m2smoke-b@carcare.test`。  
Anon/publishable 仅通过环境变量注入；报告与 git **不含密钥**。

## 3. Browser / PWA 说明

| 主题 | 自动化 | 需手动（Android 真机） |
|---|---|---|
| IndexedDB 打开与 store 列表 | **已测** staging | 杀进程后数据仍在 |
| SW 安装 / precache / controlling | **已测** | 发版后「更新」提示与 skipWaiting 体感 |
| Offline 导航（已控制 SW 后） | 部分（缓存存在） | 飞行模式打开已访问页、出队同步 |
| 安装到主屏幕 | manifest OK | Android Chrome：⋮→安装应用；国产机快捷方式 vs WebAPK 差异见 `docs/pwa-install.md` |
| Settings 鉴权反馈 | 代码路径 + E2E auth fail | UI 上错误密码 toast |
| JSON 导入导出兼容 | 既有单测 + settings UI 可见 | 大文件/坏 base64 在真机确认 |
| 图片 / media | 校验上限 + 小图 RPC | 拍照附件体积与 JSONB 上限 |

## 4. 风险分诊

| 风险 | 评级 | 处置 |
|---|---|---|
| **共享本地 DB 跨云账号**（`car-care-db` 固定名；业务表不按 user 隔离） | **高** | **已修（新 PR）**：有本地业务数据或原账号 outbox 时 **阻止账号切换**，明确文案引导：备份→断开→清空/替换→再连新号 |
| Outbox 跨账号串推 | 中（此前已 owner 隔离） | 保持；切换被阻后更安全 |
| `replaceLocal` 误触 | 中 | **已修**：新增「从云端完全替换本地」按钮，**双重 confirm** + 备份警告；默认仍为合并恢复 |
| base64 → JSONB 体积 | 中 | **已修**：`MAX_MEDIA_BASE64_CHARS=2e6`、`MAX_MEDIA_BYTE_SIZE=1.5e6`，校验失败拒绝 |
| `service_role` 进客户端 | 高（已有防护） | **PASS**：config/JWT/provider 三维拒绝；文案 `storage.anonOnly`；E2E 仅 anon |
| disconnect 文案与行为不符（旧文案写「队列清除」） | 低 | **已修**：文案改为队列按同账号保留 |
| Staging 领先 origin/main（`35210b0` 未 push） | 低 | 另开/补 PR 同步 origin |

## 5. 缺陷与修复 PR

| 项 | 说明 |
|---|---|
| **PR A（本轮）** | `fix/m2-account-switch-safety` — 阻止不安全账号切换；replaceLocal 双重确认；media 体积上限；disconnect 文案；A/B E2E；staging smoke 脚本 |
| **PR B（建议）** | 将本地 `35210b0` boot placeholder push 到 origin（staging 已跑此构建） |
| Prod 部署 | **无**；明确禁止 |

> PR URL 在 push 后填入本节 / 父代理摘要。

## 6. 开放问题

1. 长期应用 **按 cloudUserId 分 IDB 库名**（或分区）替代「阻止切换」——本期仅硬阻止。
2. Media 终极方案应走 Supabase Storage，而非 JSONB base64（Phase C）。
3. `35210b0` 与账号切换 PR 的合并顺序：建议先合 boot placeholder，再合 safety（或一并 rebase）。
4. Disposable 项目验收后可 `pause_project`（需用户明确授权）。
5. Android 真机安装/离线/相机未在本环境执行。

## 7. 回滚

| 场景 | 动作 |
|---|---|
| Staging 回滚 | Contabo：从 `/var/www/car-care-backups/` 还原 staging 目录；或重新 rsync 已知好的 `9fbdf83` 构建。**不要动** `/var/www/car-care`（prod） |
| 代码回滚 | `git revert` 合并提交；勿 force-push main |
| Supabase smoke | 仅 disposable；可 truncate `car_care_rows` 或 pause 项目；**禁止**对生产项目操作 |
| Prod | 本轮无变更 → 无需回滚 |

## 8. 发布准备结论（非授权上线）

- Staging 功能与 M2 同步路径 **可接受**（在 `35210b0` + disposable E2E 语义下）。
- **合入账号切换安全 PR 前，不建议生产发布**（共享 IDB 换号风险）。
- 合入后仍需：独立 code review → 用户明确批准 → **另一次** staging 验证 → 再考虑 prod（本报告不执行 prod）。

---

**产物索引**

- 本报告：`docs/m2-staging-acceptance-report.md`
- Staging 截图：`artifacts/staging-smoke/`
- 测试日志：`artifacts/m2-acceptance-*.log`
