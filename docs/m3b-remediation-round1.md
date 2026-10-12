# M3-B Round-1 评审整改

> 针对 PR #6 tip `c7f5367` 的审查意见。本文件记录整改结论；实现 tip `5b2d76b`（相对评审 tip `c7f5367`）。

## P0 — IDB lease 竞态

| 要求 | 整改 |
|------|------|
| acquire 读/判/写/确认同一 readwrite 事务 | `SyncLockSession.tryAcquireIdbLease`：单 txn 内 `get` → 判断 → `put` → `tx.done` |
| renew/release 校验 holder 且条件更新 | `renewIdbLease` / `releaseIdbLease`：同 txn 读后仅当 `holderId === me` 才 put/delete |
| 双标签独立上下文测试 | `SyncLockSession` 每实例独立 `holderId` + in-process 门闩；测试用 `tab-A` / `tab-B` |
| TTL 接管后旧持有者不得覆盖/释放新租约 | renew→`lost`；release→`skipped`；断言 lease 仍为新 holder |
| 同步超过 TTL 的安全行为 | 续租失败 → `SyncLeaseLostError`；中止本次同步；**不** delete 新租约；outbox 保留；文案提示重试 |

## P1 — BG Sync 路径不完整

| 要求 | 整改 |
|------|------|
| App 生命周期注册 message listener | `installSyncLifecycle()` 于 `App.tsx` `useEffect` |
| 合法消息 → 已加锁的 `bidirectionalSync` | `engine.bidirectionalSync()`（入口已 `withSyncLock`）；**禁止**再包一层锁 |
| 不声称关页后 BG Sync 一定上行 | 文档与 `syncLifecycle` 注释明确：SW 仅通知**已打开** client；关页靠 outbox + 下次打开/手动 |
| 无 API 时仍可用 | 手动同步 + `recoverStaleSyncingStatus` 仍主路径 |
| message→sync 测试 | `syncLifecycle.test.ts` spy `engine.bidirectionalSync` |

## P1 — recoverStaleSyncingStatus

| 要求 | 整改 |
|------|------|
| 不得仅凭「无 IDB lease」推断 idle | 同时检查：`navigator.locks.query` 持锁、`hasActiveLease`、`hasFreshHeartbeat` |
| Tab A 同步中 Tab B 开设置 | 心跳 / Web Lock 任一存活 → **不**清 `syncing`（单测覆盖） |

## 明确非承诺

- Background Sync **不能**保证页面全部关闭后的自动上行。  
- 无 BG Sync API 时：手动同步 + 下次启动康复即可。
