# M3-C 架构取舍：冲突合并 UI + 双端体验

> **状态：已冻结（用户批准 2026-10-12）**  
> 产品冻结规格（权威口径）：[`m3c-mvp-frozen-spec.md`](./m3c-mvp-frozen-spec.md)。本文件为架构取舍与模块边界；若与冻结规格冲突，**以冻结规格为准**。  
> 基于 M2 LWW / outbox / `sync_*` 与 M3-B 多标签锁。  
> 非目标：Notion、改正式 Supabase schema、油耗口径、业务代码未开 feature 前不得开工实现。  
> 前提：静默 LWW 仍是默认合并引擎；M3-C 只把**会丢掉用户意图**的分叉升级为可操作冲突。  
> **MVP 实体：仅 `vehicles` + `records`。** 其它实体保持现有 LWW。

## 0. 现状（相对静默 LWW）

| 路径 | 今日行为 | 用户可见 |
|------|----------|----------|
| Pull：同 id 有 pending outbox | 不应用云端，记 `kept_local` | 设置页只读审计（近 50，展示近 5） |
| Pull：云端 `updatedAt` 更新 | 静默覆盖本地 | 无 |
| Push：云端更新 | `push_skipped_cloud_newer`，**丢弃 stale outbox**，下次 pull 吃云端 | 审计一条后本地意图消失 |
| 改 vs 删 | 默认可 `kept_edit_over_delete` | 审计 |
| 多标签 | M3-B `withSyncLock`；lease lost 不 ACK | 忙提示 |

**核心缺口**：`SyncConflict.resolution` 已写死「自动结果」，没有 **open** 态；push 跳过会删队列，等于静默放弃本地。

---

## 1. 冲突如何定义与检测

### 1.1 定义（M3-C）

**开放冲突（open）**：同一 `(entity, entityId)` 上，本地意图与云端副本**分叉且自动 LWW 会丢一侧用户可见改动**，须用户二选一后才能继续对该行自动合并。

**MVP 实体过滤（冻结）**：仅当 `entity ∈ { vehicles, records }` **且**「本地待推送（pending outbox）且发生版本冲突」时 escalate 为 open；stations / settings / media / learning **不**进手动队列。

**仍静默（非 open）**：

- 仅一侧有更新（无 pending、时间戳严格单边更新）→ 继续 LWW  
- 时间戳相等且 payload 等价 → 去重，不记  
- media 仅 storage 迁移类 bump（同内容换 schema）→ 继续自动  

### 1.2 检测点（相对今日）

在现有 `merge.shouldApplyCloudRow` / push LWW 之上加 **escalate**：

| 触发 | 条件 | 动作 |
|------|------|------|
| **E1 Push 被拒** | provider 返回 `cloud_newer` / skip | **不要** `removeStaleConflictOps` 立刻丢掉唯一本地意图；改为写入 open conflict（带 `localPayload` + `cloudUpdatedAt`），outbox 项标记 `blockedByConflictId` 或移入 conflict 快照后暂移出可推送集 |
| **E2 Pull 双侧脏** | pending outbox **且** `cloud.updatedAt` 与 local/`mutatedAt` 分叉（云端并非「我们刚推的回声」） | 不应用云端；写 open（今日只记 `kept_local`） |
| **E3 改 vs 删** | 一侧 tombstone、一侧 upsert，且两边 stamp 交叉或用户可见 | 记 open，`kind: edit_vs_delete`（可默认建议「保留编辑」，但须确认） |
| **非冲突** | pending 存在但云端 stamp ≤ 本地即将推送的 `mutatedAt`（自推回声） | 跳过 escalate，维持今日 skip-apply |

**回声抑制**：用 `deviceId` + `mutatedAt`/`updatedAt` 与最近成功 push 的 ACK 集；避免把自己的推送当成 E2。

**字段级合并**：MVP **不做**。整行 keep local / take cloud。

---

## 2. 本地存储模型

### 2.1 取舍

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 继续 `sync_meta.syncConflicts` 数组 | 已有 list/append；无 open/payload | 不够 |
| B. 新 Object Store `sync_conflicts` | keyPath=`id`；索引 `status`、`entityId` | **推荐** |
| C. 改云端 schema 存冲突 | 超范围 | 否 |

**推荐 B**：M3-C 可升 IDB 小版本；**不改** Supabase 表。旧 `syncConflicts` 审计可迁移为 `status:'resolved'` 只读或弃用只保留新 store。

### 2.2 建议形状

```ts
type ConflictKind = 'edit_edit' | 'edit_vs_delete' | 'push_rejected';
type ConflictStatus = 'open' | 'resolved';

interface SyncConflictRecord {
  id: UUID;
  entity: SyncEntity;
  entityId: string;
  kind: ConflictKind;
  status: ConflictStatus;
  localUpdatedAt?: ISODateTime;
  cloudUpdatedAt?: ISODateTime;
  /** 解决前快照：upsert 实体或 delete 标记 */
  localSnapshot?: { op: 'upsert' | 'delete'; payload?: unknown };
  cloudSnapshot?: { op: 'upsert' | 'delete'; payload?: unknown; deletedAt?: ISODateTime | null };
  /** 关联被挂起的 outbox opId（可多） */
  blockedOpIds?: UUID[];
  createdAt: ISODateTime;
  resolvedAt?: ISODateTime;
  resolution?: 'keep_local' | 'take_cloud' | 'dismiss';
  notedAt: ISODateTime; // 兼容旧审计字段语义
}
```

- Open 上限建议 **30**；超出则设置页提示「先处理冲突再同步」，同步引擎对相关 id **暂停自动覆盖/暂停丢队列**。  
- Resolved 保留最近 **50** 可查。  
- **不**把整图 Blob 塞进 snapshot：media 冲突只存元数据 + `storageKey`/是否本地有 blob；大图 take cloud 时走现有 pull/download。

### 2.3 与 outbox

- Open 期间：该 `entity+id` 的 outbox **不进入** `listReadyOutbox`（filter `blockedByConflict` 或 opId ∈ blocked）。  
- 其它实体照常 push/pull。  
- 同 id 新本地编辑：更新 conflict 的 `localSnapshot` + `localUpdatedAt`，或合并 blockedOpIds（dedupe 仍按最新 mutatedAt）。

---

## 3. 解决动作语义

均在 **`withSyncLock`** 内执行（与 M3-B 同一把锁）；持锁期间 UI disable「同步/解决」。Lease lost → 整笔解决事务中止，冲突保持 open，提示重试。

### 3.1 保留本地（keep local）— 冻结硬约束

1. **必须**账号验证（Auth === bound）+ **`withSyncLock`**；禁止无锁解决。  
2. 以 `localSnapshot`（或当前 IDB 行）为准写入业务 store（若缺行则恢复）。  
3. `mutatedAt = nowISO()` bump，outbox `upsert`（或 `delete` 若本地意图是删）。  
4. 清除该 conflict 的 blocked 标记；open → resolved `keep_local`。  
5. 立即或下轮 `runSync` push；**必须走正常 push / LWW**。  
6. **禁止**绕过 LWW 静默强制覆盖较新的云端记录（禁止本地强写盖云、禁止伪造 stamp）。  
7. 若 push 再次 `cloud_newer`（竞态或云仍更新）→ **重新 open**，不静默丢本地意图。

### 3.2 采用云端（take cloud）— 冻结硬约束

1. **必须**在 `withSyncLock` 内执行。  
2. **先**应用 `cloudSnapshot`：upsert 写入 / delete 走现有级联删（与 engine pull 删路径一致），并**确认本地已成功恢复为云端内容**。  
3. **仅在步骤 2 成功之后**，才 `removeOutboxItems(blockedOpIds)` 及同 entity+id 遗留 ops。  
4. 顺序颠倒（先清 outbox 再恢复）视为缺陷；任一步失败 → 保持 open，可重试。  
5. conflict → resolved `take_cloud`。  
6. **不必**为对齐再 push；下轮 pull 幂等即可。record 关联 media：缺 blob 则按 M3-A 下载（MVP **不对 media 实体** open）。

### 3.3 删除相关冲突与恢复（冻结）

**删除相关冲突必须二次确认**（确认框展示两侧摘要后才执行 resolve）。

| UI | 语义 | MVP |
|----|------|-----|
| 冲突 `edit_vs_delete` + 保留本地 | 等同 keep local → 正常 push upsert（改胜于删 + bump） | ✅ in-scope |
| 冲突 + 采用云端且云为删 | 本地先级联删成功，再清 outbox | ✅ in-scope |
| 冲突解决所需 snapshot | open 行上的 `localSnapshot` / `cloudSnapshot` | ✅ in-scope |
| 设置页「最近删除 · 30 天」浏览/恢复 | 独立 trash store + TTL + 恢复测试 | ❌ **deferred → M3-C.1 / follow-up** |

**本 MVP 不做**：服务端 30 天 grace / restore RPC；设置页回收站；媒体 Blob 快照入库；跨设备回收站协议。  
**禁止**宣称「已支持 30 天恢复」。判据与理由见冻结规格 §6。

### 3.4 与多标签 / 同步引擎

- 解决与 `runSync` 互斥：锁 busy → toast 沿用 M3-B 文案。  
- 解决成功后 `BroadcastChannel` 或已有 meta 心跳触发其它탭刷新冲突列表。  
- 引擎入口：`runSync` 开头若 `countOpenConflicts() > 0`，仍允许推送**未阻塞**实体；设置页角标显示 open 数。

---

## 4. 双设备验收（disposable）与风险 / ADR

### 4.1 验收怎么做

环境：两个浏览器配置（或手机 + 桌面），**同一 disposable Supabase 用户**；勿用生产主数据。

| # | 步骤 | 期望 |
|---|------|------|
| D1 | A/B 均登录并首次同步 | 两侧一致 |
| D2 | A 离线改 record R；B 在线改同一 R；A 上线同步 | 两侧出现 **同一 open 冲突**（或先同步到的一侧 open，另一侧 pull 后一致）；**不得**静默丢 A 或 B |
| D3 | 选「保留本地」于 A | bump 后 B pull 得到 A 内容；冲突 resolved |
| D4 | 重做 D2，选「采用云端」 | 本地先恢复为云端内容，**再**确认 outbox 无该 id 残留 |
| D5 | A 删 R，B 改 R（交叉） | `edit_vs_delete` open + 二次确认；保留编辑后 R 仍在；采用删除后两侧无 R |
| D6 | 离线后上线遇对端已改；或解决中断网 / lease lost | open 保持可重试；不静默丢意图 |
| D7 | 同步中开第二标签点解决 | busy / 锁提示；不双写 ACK |
| D8 | （非目标抽查）media/stations 分叉 | 不进手动队列；现网 LWW |

自动化：扩展 `remediation.test.ts` / memory provider 模拟 E1–E3 + resolve；真人双端用 disposable 清单签字。

### 4.2 风险

| 风险 | 缓解 |
|------|------|
| Open 堆积阻塞体验 | 上限 + 角标 + 「全部采用云端/全部保留本地」二次确认（可 M3-C 加分，MVP 可单条） |
| Snapshot 占配额 | 禁 Blob；settings 可只存 key/value |
| Bump 时钟回拨 | 继续 ISO 字符串比较；已有 device 无 NTP 假设与 M2 相同 |
| 旧审计与 open 混读 | UI 分「待处理 / 已解决」 |
| 误点采用云端 | 确认框展示两侧摘要（类型、金额、日期、updatedAt） |

### 4.3 ADR 建议（短录）

**ADR-M3C-1**：静默 LWW 保留；仅 escalate 会丢意图的分叉。  
**ADR-M3C-2**：冲突存本地 `sync_conflicts` store；不改 Supabase schema。  
**ADR-M3C-3**：整行二选一，不做字段 merge。  
**ADR-M3C-4**：解决动作必须持有 sync tab lock；失败保持 open。  
**ADR-M3C-5**：MVP 删除相关仅冲突路径二次确认 + 解决所需 snapshot；「最近删除 30 天」defer 至 M3-C.1；不新增云端 restore RPC。  
**ADR-M3C-6**：take_cloud 必须先确认本地已恢复云端数据，再清 outbox；keep_local 不得绕过 LWW 强盖云端。  
**ADR-M3C-7**：手动 open 仅 `vehicles` / `records`。

---

## 5. MVP 边界与模块边界

### 5.1 MVP 做

- Open 冲突检测 E1–E3 + 回声抑制，**实体仅 vehicles / records**  
- IDB `sync_conflicts` + repository  
- 设置页（`DataStorageSettings`）：待处理列表、摘要、**保留本地 / 采用云端**、已解决折叠  
- `resolveConflict`：take_cloud 先恢复本地再清 outbox；keep_local 走正常 push/LWW + 账号校验 + `withSyncLock`  
- edit_vs_delete 可视文案 + **删除相关二次确认**  
- 单测 + disposable 双端清单（含并发编辑、删改、离线恢复、失败重试）  
- i18n 文案  

### 5.2 MVP 不做

- 字段级三路 merge、diff 高亮编辑器  
- Notion / schema 变更 / 油耗  
- 服务端冲突表、restore RPC、grace GC 产品化  
- 冲突推送通知、多选批量（可加分）  
- 学习库 `learning` 同步；stations / settings / media 的手动冲突 UI  
- **设置页「最近删除 30 天」浏览/恢复**（→ M3-C follow-up / M3-C.1）  

### 5.3 模块边界（可执行，非逐行）

```
src/sync/
  conflictTypes.ts      # SyncConflictRecord 等
  conflictDetect.ts     # escalate 规则；纯函数 + 单测
  conflictStore.ts      # IDB CRUD open/resolved
  conflictResolve.ts    # keep_local / take_cloud；调 repositories + outbox + lock
  merge.ts              # 最小改动：返回 escalate 信号，不在此写 UI
  outbox.ts             # listReadyOutbox 过滤 blocked；废弃静默 remove 路径改走 detect
  engine.ts             # pull/push 钩子调用 detect；不写 React
src/components/
  ConflictList.tsx      # 列表 + 确认
  ConflictDetail.tsx    # 两侧摘要（只读）
  DataStorageSettings.tsx  # 挂载入口 + 角标
src/db/index.ts         # version bump + sync_conflicts store
docs/
  m3c-dual-device-acceptance.md  # 由实现期落 D1–D7 结果
```

**依赖方向**：`conflictResolve` → repositories / outbox / tabLock；**禁止** UI 直接改 outbox。engine 只产冲突、不自动 resolve。

### 5.4 建议实现序

1. types + store + db bump  
2. `conflictDetect` 单测（含回声）  
3. 改 engine/outbox：E1 不再静默丢队列  
4. `conflictResolve` + lock  
5. Settings UI  
6. disposable D1–D7  
7. 短 ADR 写入本文件或 `docs/adr/`  

---

## 6. 一句话结论

M3-C MVP = **仅对 vehicles/records 上「本地待推送且版本冲突」升级为 open 队列**，设置页整行二选一（删改二次确认）；take_cloud 先恢复本地再清 outbox；keep_local 不绕过 LWW；30 天回收站 defer。存储只加本地 `sync_conflicts`；解决 + M3-B 锁；双端 disposable 按冻结清单验收。不动云 schema、Notion、油耗。权威口径见 `m3c-mvp-frozen-spec.md`。
