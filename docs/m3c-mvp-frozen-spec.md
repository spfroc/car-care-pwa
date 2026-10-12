# M3-C MVP 冻结规格（冲突 UI）

> **状态：已冻结（用户批准 2026-10-12）**  
> 权威口径：本文件。架构细节见 `m3c-conflict-ui-architecture.md`（已对齐）。  
> **本 PR / 本任务只冻结文档 + 路线图状态；禁止部署、禁止改生产、禁止改正式 Supabase、禁止开始业务代码实现。**

---

## 1. 产品目标（一句话）

在静默 LWW 仍为默认合并引擎的前提下，仅当「本地待推送且与云端发生版本冲突」时，把会丢掉用户意图的分叉升级为 **open 冲突**，由用户在设置页对 **车辆 / 养护记录** 整行二选一（保留本地 / 采用云端）。

---

## 2. 用户故事摘要（US-1…US-5）

| ID | 故事 | MVP 验收要点 |
|----|------|----------------|
| **US-1** 待处理队列 | 作为已登录用户，我能在设置页看到当前 open 冲突列表（实体、摘要、两侧时间） | 仅 `vehicles` / `records`；有角标/计数；无 open 时不打扰 |
| **US-2** 二选一 | 我可以对单条冲突选择「保留本地」或「采用云端」 | 见 §4 硬约束；解决持 `withSyncLock`；失败保持 open 可重试 |
| **US-3** 删改冲突 | 一侧删一侧改时，我能理解后果并二次确认后再解决 | `edit_vs_delete`；删除相关选择必须二次确认对话框 |
| **US-4** 恢复 | 冲突路径上我能基于仍持有的 snapshot 决定保留编辑或确认删除 | **不做**设置页「最近删除 30 天」浏览/恢复（→ M3-C follow-up）；见 §6 |
| **US-5** 双端验收 | 两台设备交叉编辑后不静默丢意图 | 见 §7 清单；用 disposable 账号，勿用生产主数据 |

---

## 3. 冲突何时 open（冻结）

**仅**对同时满足以下条件的行提供手动解决：

1. 实体 ∈ `{ vehicles, records }`  
2. 本地对该 id **有待推送 outbox**（或等价「本地意图未 ACK」）  
3. 与云端发生版本分叉，使得自动 LWW 会丢掉一侧用户可见改动  

对应检测（实现期对齐架构稿 E1–E3，实体过滤后）：

- **E1** Push 被拒（`cloud_newer` / skip）→ **不得**立刻 `removeStaleConflictOps` 丢掉唯一本地意图；改为 open  
- **E2** Pull 双侧脏（pending + 云端 stamp 分叉，且非自推回声）→ 不应用云端；open  
- **E3** 改 vs 删（tombstone ↔ upsert 交叉）→ open，`kind: edit_vs_delete`  

**其它场景保持现有 LWW**（含 stations / settings / media、无 pending 的单边更新、等价去重、media 迁移类 bump、回声抑制路径）。

字段级合并：**不做**。整行 keep_local / take_cloud。

---

## 4. 硬约束（必须写进实现与单测）

### 4.1 采用云端（take_cloud）

1. 在 `withSyncLock` 内执行。  
2. **必须先**把云端数据成功恢复到本地业务 store（upsert 写入或按现有级联删路径删除），确认本地已与 `cloudSnapshot` 一致。  
3. **然后**才能清除对应待同步 outbox（`blockedOpIds` 及同 entity+id 遗留 ops）。  
4. 顺序颠倒导致「清了队列但本地未恢复」视为缺陷；失败则保持 open，可重试。  
5. media 附件：本 MVP **不**对 media 实体 open；若 record 侧 snapshot 仅元数据，blob 仍走现有 pull/download（与架构一致：snapshot 不塞整图 Blob）。

### 4.2 保留本地（keep_local）

1. 必须经过 **账号验证**（与现有 sync 一致：Auth === bound account）与 **M3-B `withSyncLock`**。  
2. **禁止**绕过 LWW、静默强制覆盖较新的云端记录（禁止本地强写盖云 / 禁止伪造 stamp 骗过 provider）。  
3. 合法路径：以 `localSnapshot`（或当前 IDB 行）为准写回本地 → `mutatedAt = now` bump → 入 outbox → 走 **正常 push / LWW**。  
4. 若 push 仍返回云端更新 → **重新 open** 冲突，不得静默丢本地意图。

### 4.3 删除相关冲突

凡解决结果会导致 **本地或云端语义上的删除生效**（含：采用云端且云为删；保留本地且本地意图为删），UI **必须二次确认**（展示两侧摘要后再执行）。

### 4.4 实体与范围

- Open / 手动解决：**仅** `vehicles`、`records`。  
- **不扩展**：Notion、Storage/正式 schema 变更、stations/settings/media/learning 的冲突 UI、服务端冲突表、restore RPC。

---

## 5. 非目标（本 MVP 明确不做）

- 字段级三路 merge / diff 编辑器  
- Notion / 正式 Supabase schema / 油耗口径  
- 服务端冲突表、云端 restore RPC、grace GC 产品化  
- 冲突推送通知；批量「全部采用云端/全部保留本地」（可加分，非必须）  
- learning 同步  
- **设置页「最近删除 · 30 天」浏览与恢复**（见 §6）  
- 跨设备「回收站」协议、媒体 Blob 快照入库  

---

## 6. 30 天恢复：判据与冻结结论

### 6.1 评估（相对现状）

| 现状 | 含义 |
|------|------|
| 云端 tombstone（`deletedAt`） | 软删行；payload **可为空**（校验已允许） |
| 本地 apply 删 | IDB **硬删** vehicles/records 行，无 trash store |
| 无 `recentTombstones` / 回收站 UI | 架构稿仅提案，未实现 |
| 媒体 | Storage 对象可随 tombstone GC；整图进 snapshot 成本高 |

「真 30 天恢复」若定义为：设置页可浏览近 30 天删除、可一键恢复、自动 TTL 过期、有恢复测试，且跨会话可靠——需要 **新 Object Store（或等价持久化）+ JSON 快照 + TTL 扫描 +（可选）媒体策略 + UI + 单测**。云端空 payload 时还无法仅靠 tombstone 还原，跨设备恢复更依赖新协议或长期保留云端 payload。

### 6.2 冻结结论（写死）

**本 MVP：不纳入「设置页最近删除 30 天浏览/恢复」。**

标为 **M3-C follow-up（建议称 M3-C.1）**。

**本 MVP 仅做：**

- 冲突解决路径上的 **删改二次确认**  
- open 冲突所需的 **localSnapshot / cloudSnapshot**（解决前持久化；解决后随 resolved 保留策略，不作 30 天产品回收站）  

**禁止**在实现 PR / 发布说明中宣称「已支持 30 天恢复」。

### 6.3 M3-C.1（follow-up）门槛（未开工）

纳入后续阶段前须另开规格，至少包含：本地持久化删除快照、自动过期、恢复测试；并诚实写明媒体/跨设备是否 in-scope。未达门槛不得在主规格勾选「30 天恢复」。

---

## 7. 双设备验收清单（disposable）

环境：两浏览器配置（或手机 + 桌面），**同一 disposable Supabase 用户**；禁止生产主数据。

| # | 场景 | 期望 |
|---|------|------|
| D1 | A/B 登录并首次同步 | 两侧一致 |
| D2 | **同一车辆/记录并发编辑**：A 离线改 R，B 在线改 R，A 上线 | 出现 open（vehicles/records）；**不得**静默丢 A 或 B |
| D3 | 在 A 选「保留本地」 | 经 bump + 正常 push；B pull 得 A 内容；冲突 resolved |
| D4 | 重做 D2，选「采用云端」 | 本地先恢复为云端内容，**再**无该 id outbox 残留 |
| D5 | **删除与修改冲突**：A 删 R，B 改 R | `edit_vs_delete` open；二次确认后：保留编辑则 R 在，采用删除则两侧无 R |
| D6 | **离线后恢复**：离线产生 pending，对端已改同 id，再上线 | open 而非静默 LWW 丢意图 |
| D7 | **冲突处理失败重试**：解决中断网 / lease lost / 锁 busy | 保持 open；提示重试；不双写 ACK；重试可成功 |
| D8 | 同步中第二标签点解决 | M3-B busy / 锁提示；不破坏队列 |
| D9 | 非 vehicles/records（若触发分叉） | **不**进手动队列；行为与现网 LWW 一致 |

自动化：memory provider 模拟 E1–E3（限实体）+ resolve 顺序断言（尤其 take_cloud「先本地后清 outbox」）；真人双端按上表签字。实现期结果写入 `docs/m3c-dual-device-acceptance.md`（本冻结任务不创建该结果文件）。

---

## 8. 待决已关闭

| 议题 | 冻结决定 |
|------|----------|
| 哪些实体手动解决 | 仅 vehicles + records |
| 解决选项 | 仅「保留本地」「采用云端」 |
| 删改 | 必须二次确认 |
| 默认引擎 | 非上述场景继续 LWW |
| take_cloud 与 outbox | 先成功恢复本地，再清 outbox |
| keep_local 与 LWW | 不绕过；走正常 push；云仍新则再 open |
| 30 天回收站 | **defer → M3-C.1 / follow-up**；MVP 仅冲突路径 snapshot + 二次确认 |
| 字段 merge / Notion / schema | 不做 |
| 本任务范围 | 仅文档 + roadmap；不写业务代码、不部署 |

---

## 9. 实现入口（文档指针，非本任务开工）

实现须另开 **feature 分支**（路线图：规格已冻结 / 待 feature 分支）。模块边界以架构稿 §5.3 为准；本文件硬约束优先于架构稿旧表述。

---

## 10. 冻结签字

- 产品口径：用户批准 2026-10-12  
- 文档：`docs/m3c-mvp-frozen-spec.md`（本文件）  
- 架构对齐：`docs/m3c-conflict-ui-architecture.md`  
- 路线图：`docs/m3-roadmap.md`（M3-C = 规格已冻结 / 待 feature 分支）
