# M3-B 最终整改与验收（Round-4 通过）

> **PR**：https://github.com/spfroc/car-care-pwa/pull/6  
> **Round-4 批准 tip**：`09667cb`（`09667cb3c5775e762478102fdf620ef31fc59eb2`）  
> **时间**：2026-10-12 Asia/Shanghai  
> **硬约束**：合并后仅部署 staging `car-test.adobesun.com`；**不**部署 `car.adobesun.com`；**不**改生产 Supabase。

## 1. 评审轮次摘要

| Round | Tip | 要点 |
|-------|-----|------|
| 初版 | `c7f5367` | Web Locks + IDB lease、BG Sync 渐进增强、outbox harden |
| R1 | `16c2ce7` / tip 演进 | 原子 IDB lease txn；lifecycle BG Sync；Web Locks 兼容 recover |
| R2–3 | `418214f` | `AbortSignal` 取消；废止 `Promise.race`；outbox 不确定不删 |
| **R4** | **`09667cb`** | `applyCloudRows` 下载后/写 txn 前 abort；`migrateCloudLegacyMedia` 逐步检查 |

详细 R1：`docs/m3b-remediation-round1.md`。  
设计：`docs/m3b-tab-lock-outbox-harden.md`、`docs/m3b-background-sync-feasibility.md`。

## 2. P0 / P1 整改对照（最终）

### P0 — 跨标签锁与取消

| 要求 | 最终行为 |
|------|----------|
| IDB acquire/renew/release | 单 readwrite txn + holder 条件更新/删除 |
| 双标签独立上下文 | `SyncLockSession`（独立 `holderId` / in-process 门） |
| TTL 接管 | 旧 holder renew→`lost`；release→`skipped`；不覆盖新租约 |
| 取消同步 | `withSyncLock(fn(signal))`；续租 lost → `abort(SyncLeaseLostError)` |
| 副作用门禁 | 云写 / 合并 / outbox ACK 前 `throwIfSyncAborted` |
| 飞行中网络 | 结果**不确定**；**绝不**因客户端取消 delete/ACK outbox |
| `applyCloudRows` | 每张图下载后 + 开 IDB txn 前检查；txn 内 abort → `tx.abort()` |
| `migrateCloudLegacyMedia` | upload 前 / verify 后 / RPC 前 / 下一张前检查 |
| Web Locks 路径 | 不变（锁层不 abort signal；仅 heartbeat） |

### P1 — BG Sync / recover

| 要求 | 最终行为 |
|------|----------|
| App 生命周期 listener | `installSyncLifecycle` → `bidirectionalSync`（已加锁，不双锁） |
| 关页 BG Sync | **不承诺**自动上行；SW 仅通知已打开 client |
| `recoverStaleSyncingStatus` | 需同时无 Web Lock、无活跃 lease、无新鲜 heartbeat |

## 3. 合并前自动化结果（本机）

| 检查 | 结果 |
|------|------|
| `npm test` | **252 passed** / 5 skipped（26 files：23 pass + 3 skip） |
| `npx tsc -b` | **PASS** |
| `npm run build` | **PASS**（指纹见 staging 部署报告） |

关键单测（非穷尽）：`tabLock.test.ts`、`engine.test.ts`（含 mid-push / mid-download / mid-migrate）、`syncLifecycle.test.ts`、既有 media / outbox / remediation。

## 4. 明确非承诺

- Background Sync **不能**保证全部关页后自动上行。  
- 无 BG Sync API：手动同步 + 下次启动 `recoverStaleSyncingStatus` 即可。  
- Lease lost 时飞行中网络结果不确定；以 outbox 保留为准，用户重试。

## 5. 部署范围

- ✅ Staging：https://car-test.adobesun.com  
- ❌ Production：https://car.adobesun.com（本轮禁止）  
- ❌ 生产 Supabase 变更（本轮禁止）  

合并 SHA **`d7dd681`**；bundle 指纹与浏览器验收见 **`docs/m3b-staging-deploy-report.md`**。
