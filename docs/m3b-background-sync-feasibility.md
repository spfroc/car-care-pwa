# M3-B：Background Sync 可行性（渐进增强）

## 结论（摘要）

| 问题 | 结论 |
|------|------|
| 能否作为 outbox 投递的**唯一**机制？ | **否**。Safari / iOS / Firefox 支持差或行为受限；无打开的受控 client 时无法在本架构下安全跑 IndexedDB 同步引擎。 |
| 能否作为增强？ | **能**。Chromium 桌面/Android 在短时离线后回网时，可唤醒 SW → 通知已打开的页面跑 `withSyncLock(bidirectionalSync)`。 |
| 本阶段交付 | 检测 + `register(tag)` + SW addon postMessage + 客户端监听；失败/不支持静默降级。 |

## API 现状（2026）

- `ServiceWorkerRegistration.sync`：以 Chromium 为主。  
- 周期性 Background Sync（`periodicSync`）权限更严，**本阶段不用**。  
- iOS Safari：PWA SW 有，但 Background Sync **不可依赖**。  
- 无 window client 时：SW 内直接操作本应用 IDB/supabase-js **风险高**（重复造引擎、凭证、锁）；故 SW **只发信号**。

## 与 local-first 的关系

1. 业务写 → IDB + outbox（已原子，M2）。  
2. 在线 → 用户/自动 `bidirectionalSync`（M3-B 加锁）。  
3. 离线 → outbox 留存；可选 `registration.sync.register('car-care-outbox')`。  
4. 回网 + BG Sync 触发 → client 收消息 → 带锁同步。  
5. 若无 client：下次打开 App / `online` 事件再同步。

## 安全

- SW 不持有 service_role；不新增云凭证通道。  
- Tag 名固定 `car-care-outbox`，忽略其它 tag。

## 验收

- 不支持环境：应用行为与 M3-A 相同。  
- 支持环境：离线编辑后回网（有打开页）可自动尝试同步；失败不丢 outbox。
