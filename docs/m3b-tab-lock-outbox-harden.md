# M3-B：多标签同步互斥 · Background Sync · Outbox 可靠性

> **用户选择**：C（本项）  
> **状态**：Round-4 已批准并合并；**仅 staging 部署**（见 `docs/m3b-staging-deploy-report.md`）  
> **硬约束**：IndexedDB local-first；不改正式 Supabase；不动 Notion；不破坏 M2/M3-A 数据与 schema。  
> **Round-1 整改**：见 `docs/m3b-remediation-round1.md`  
> **最终整改**：见 `docs/m3b-remediation-final.md`（原子 IDB lease、生命周期 BG Sync、Web Locks 兼容的 stale 康复）。

## 1. 目标

| # | 目标 | 非目标 |
|---|------|--------|
| 1 | 多标签页同时点「同步」时互斥，避免双写/双 pull 互相覆盖 | 跨设备实时协作锁 |
| 2 | Background Sync **可行性评估 + 渐进增强**（有则更好，无则仍可靠） | 强依赖 BG Sync / 改完 SW 才可同步 |
| 3 | Outbox 在断网、关页、重启、并发、部分失败下不丢；重试与状态可感知；防重复同步与并发覆盖 | 冲突可视化合并 UI（→ **M3-C**） |

## 2. 现状缺口（相对 M2/M3-A）

1. **`bidirectionalSync` / upload / restore 无跨标签锁**：两标签可并行 `status=syncing`，后写 wins。  
2. **进程内亦无互斥**：同页连点可重入。  
3. **关页时 `status` 可能卡在 `syncing`**：无启动康复。  
4. **无 Background Sync 钩子**：离线入队后仅靠用户再点同步。  
5. Outbox 本身（IDB 持久、退避、`ackOutboxCoveredByUpload`、部分失败 `markOutboxFailure`）已较硬，本阶段 **加固入口与可观测性**，不改行 schema。

## 3. 方案

### 3.1 多标签互斥（优先 Web Locks）

```
withSyncLock(fn):
  1. 同页 in-process mutex（防重入）
  2. 若 navigator.locks 可用 → locks.request('car-care-sync', { ifAvailable: true })
     - lock==null → { ok:false, reason:'busy' }（不排队死等，快速反馈）
  3. 否则 IDB lease（sync_meta 键 syncTabLease）：
     - { holderId, expiresAt }；TTL 90s；持有中每 ~30s 续租
     - 过期可抢；持有者 finally 释放
  4. finally 清 in-process + 释放锁/租约
```

包装入口（不改内部 push/pull 算法）：

- `bidirectionalSync`
- `firstUploadToCloud`
- `restoreFromCloud`

忙时返回明确文案：`另一标签页正在同步，请稍候`。

### 3.2 Background Sync（渐进增强）

| 能力 | 策略 |
|------|------|
| 支持检测 | `'serviceWorker' in navigator` && `'sync' in ServiceWorkerRegistration.prototype` |
| 注册时机 | 离线检测到 / push 整批失败 / 用户关页前有 pending outbox |
| SW | `public/bg-sync-sw-addon.js` + vite `workbox.importScripts`；`sync` 事件只 **postMessage 给已打开的 clients** |
| 客户端 | App 生命周期 `installSyncLifecycle` → 消息调用 **已加锁** `bidirectionalSync`（不双锁） |
| 无支持 / 无打开页 | **无操作**；outbox 仍在 IDB，下次打开手动或 online 事件触发 |

详见 `docs/m3b-background-sync-feasibility.md`。

### 3.3 Outbox 可靠性加固

| 场景 | 行为 |
|------|------|
| 断网 | 已有：`navigator.onLine` → `offline`，队列保留 |
| 关页 / 崩溃 | IDB outbox 保留；`recoverStaleSyncingStatus()`：仅当 **无 Web Lock、无未过期 lease、无新鲜 heartbeat** 时才置 idle |
| 重启后再开 | online 或设置页同步；可选 BG Sync 唤醒 |
| 并发双标签 | Web Lock / lease：第二者 `busy` |
| 部分失败 | 已有：applied 删、剩余 `markOutboxFailure`；不改 |
| 中途新编辑 | 已有：`ackOutboxCoveredByUpload` / `removeStaleConflictOps` 保较新 op |
| 状态反馈 | `getSyncStatusSummary` 增加 `outboxReady` / `outboxBlocked` / `lockMode`；设置页沿用 |

**不改** `sync_outbox` 字段布局；**不** bump DB_VERSION（lease 放 `sync_meta` 已有 KV）。

## 4. 测试矩阵

| ID | 场景 | 期望 | 自动化 |
|----|------|------|--------|
| T1 | 同页重入 sync | 第二次 busy / 串行 | unit |
| T2 | Web Locks ifAvailable 被占 | busy，outbox 不变 | unit（mock locks） |
| T3 | IDB lease 未过期 | 第二持有者 busy | unit |
| T4 | IDB lease 过期可抢 | 第二者成功 | unit |
| T5 | push 部分失败 | applied 移除，失败项 attempts+1 且仍在库 | 已有 + 回归 |
| T6 | 上传中途新 outbox | ack 不删较新 mutatedAt | 已有 remediation |
| T7 | 启动时 status=syncing 无锁 | 康复为 idle/error | unit |
| T8 | BG Sync API 缺失 | register 返回 unsupported，不抛 | unit |
| T9 | BG Sync message | 触发带锁 sync（mock） | unit |
| T10 | 离线 bidirectionalSync | offline 文案，outbox 保留 | 已有 |
| T11 | 双 SyncLockSession 并发 acquire | 仅一胜 | unit |
| T12 | TTL 接管后旧 release | skipped，新 lease 仍在 | unit |
| T13 | Tab A heartbeat + Tab B recover | 不清 syncing | unit |
| T14 | Web Locks held + Tab B recover | 不清 syncing | unit |
| T15 | BG message → bidirectionalSync | 调用 1 次 | lifecycle test |

## 5. 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| Web Locks 浏览器差异 | 低 | IDB lease 降级 |
| Lease TTL 内持有者崩溃 | 中 | TTL 90s + 启动康复 |
| BG Sync 仅 Chromium；Safari 弱 | 中 | 文档标明 optional；online/手动仍主路径 |
| importScripts 与 Workbox 生成 SW 冲突 | 低 | addon 仅监听 sync，不碰 fetch |
| 锁粒度过粗阻塞 upload+restore | 低 | 同名锁可接受（同一云会话） |
| 误以为 BG Sync 保证关页后上行 | 高（产品） | UX/文档：需打开页或稍后手动 |

## 6. 文件地图

```
docs/m3b-tab-lock-outbox-harden.md          ← 本文件
docs/m3b-background-sync-feasibility.md
docs/m3-roadmap.md                         ← M3-B/C/D 澄清
src/sync/tabLock.ts
src/sync/tabLock.test.ts
src/sync/backgroundSync.ts
src/sync/backgroundSync.test.ts
src/sync/engine.ts                         ← 入口包锁 + 启动康复钩子
src/sync/outbox.ts                         ← summary helpers（可选）
public/bg-sync-sw-addon.js
vite.config.ts                             ← importScripts
src/components/DataStorageSettings.tsx     ← busy/恢复文案（轻）
```

## 7. 验收（本 PR）

- [x] 方案 + 矩阵 + 风险文档  
- [x] Web Locks + IDB lease + 同页互斥  
- [x] BG Sync 可行性文档 + 可选注册/消息  
- [x] 单测覆盖 T1–T4、T7–T8  
- [x] `npm test` / `tsc -b` 通过  
- [ ] **不**合并 main；**不**部署；**不**写正式 Supabase  

