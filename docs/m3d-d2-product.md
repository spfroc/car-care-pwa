# M3-D D2 产品：MVP 用户故事、非目标与验收（A–E）

> **状态**：产品经理交付（2026-10-14）· **docs / 规划级** · 并入 docs PR #10（`docs/m3d-d2-plan`）  
> **配套架构规划**：[`m3d-d2-plan.md`](./m3d-d2-plan.md)（模块边界、D1 契约、硬门禁 H\*、PR 切片 D2-P0..P5、禁区）  
> **权威冻结**：[`m3d-mvp-spec.md`](./m3d-mvp-spec.md) §0/§0.1 · [`m3d-architecture.md`](./m3d-architecture.md) · [`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md)  
> **冲突时**：以 mvp §0.1 / architecture / `m3d-d2-plan.md` 硬门禁与 PR 切片为准；本文件补充用户故事与验收文案，**不得**推翻 O1–O6 / S1–S3 / P1–P4 / H1–H9 / D2-P0..P5。  
> **本文件职责**：MVP 用户故事 US-D2-1..7、产品非目标、验收 A–E、与 D1 证据边界说明。

---

## 0. 与 D1 证据的边界（必读）

| 项 | 状态 | 含义 |
|----|------|------|
| D1 M1 live Trash / tombstone | **PASS**（Worker 原型 / PR #9） | Gateway 软删走廊在**独立测试工作区**已有 live 证据 |
| D2 集成验收 | **尚未完成** | D2 必须在**自有真实 Notion 测试工作区**跑通 vehicles+records 双向与冲突；**mock Gateway 仅可用于单元测试**，**不能**冒充 D2 完成 |
| Mock Notion 替代真机 | **禁止**（对齐 plan H5 / G4） | 单测 mock Gateway ✅；用 mock Notion 或「仅代理模板」冒充用户自有工作区 ❌ |

> **一句话**：D1 Trash live PASS ≠ D2 完成。D2 仍需**自己的**真实 Notion workspace 集成验收。

---

## 1. MVP 用户故事（US-D2-1..7）

> 实现落点与门禁见 [`m3d-d2-plan.md`](./m3d-d2-plan.md) §2 / §4 / §6（D2-P1..P4）。冲突语义复用既有 M3-C，不另造。  
> **前端契约适配（复审闭合）**：[`m3d-d2-plan.md`](./m3d-d2-plan.md) **§3.5**（Verify / PushResult / errors / AbortSignal / 会话 / 持久白名单 / M3-C 依赖）；摘要见下 §1.1。

### 1.1 前端契约适配（交叉链接）

完整硬表见 [`m3d-d2-plan.md`](./m3d-d2-plan.md) **§3.5**。产品验收时至少确认：

| 主题 | 用户可感知 / 验收含义 |
|------|------------------------|
| Verify | `workspaceKey` → 云端身份（Outbox owner）；`dataSources` 仅诊断 |
| Push / 冲突 | Gateway `conflicts[].id` 对上本地队列；`skipped_deleted` / `ambiguous_race` **不算**同步成功 |
| 错误 / 限流 | 过大载荷失败可读；429/503 稍后重试；**不**静默丢队列 |
| 中止 | 同步超时打断后须可重试；不误报已同步 |
| 会话 | 冷启动重输 Key；401 / 断开 / 退出清会话；无会话不同步 |
| 持久 | 仅 URL（等）进设置；**无** Token / 长期 Key |
| M3-C | 冲突仍走现有 keep/take（main 已合并 M3-C） |
| 文案 | 401≠403 Origin；本地开发须配 CORS Origin |

### US-D2-1 · 实验设置 + Gateway URL + 运行时 API Key + 校验

**作为**想试用 Notion 同步的用户，  
**我希望**在实验/高级设置中配置 Gateway URL、每次冷启动重新输入 Gateway API Key，并完成 `/verify`，  
**以便**在不把长期密钥写入 PWA 的前提下连接自有 Worker。

| 验收要点 | 对齐 |
|----------|------|
| Gateway URL 可持久；API Key **仅会话内存**；冷启动须重输 | plan D2.8 · H8 |
| `/verify` 成功后 `workspaceKey` → `VerifyResult.userId` / Outbox `ownerUserId` | plan §3.2 · **§3.5.1** |
| 401 → 清内存会话并提示重输；**403 Origin** 提示配 CORS（非换 Key） | plan §3.1 · **§3.5.8** |
| 冷启动须重输 Key；`sessionStorage` 可选且≠长期持久 | plan D2.8 · **§3.5.5** |
| 实验折叠；默认不开启 Notion | D2-P2 禁区 |

### US-D2-2 · 首次上传车辆与记录；同 AppEntityId 不双页

**作为**已 verify 的用户，  
**我希望**首次把本地 vehicles + records 推到 Notion 后，同一 `AppEntityId` 只对应一页，后续更新改同页，  
**以便**工作区不出现重复车辆/记录页。

| 验收要点 | 对齐 |
|----------|------|
| 首次 `pushSnapshot` / 全量后 Notion 各一页 | plan ★C |
| 二次 upsert **更新同页**，不 recreate 双页 | plan ★U |
| 仅 vehicles + records；media 不入队 | plan H2 · D2.1 |

### US-D2-3 · 离线编辑 → Outbox 推送；pull 见结构化数据

**作为**经常离线记养护的用户，  
**我希望**断网编辑进入 Outbox，恢复网络后自动/手动 flush，另一端或再次 pull 能看到结构化字段，  
**以便**双向同步车辆与养护记录。

| 验收要点 | 对齐 |
|----------|------|
| 断网编辑 → 恢复后 outbox push 成功 | plan D2.2 |
| 设备 A push → B pull 可见（或同设备 pull 自检） | plan D2.3 |
| 行含 tombstone 时本地正确收敛 | plan §3.2 pull |

### US-D2-4 · 双端脏数据 → 既有 M3-C 冲突 UI

**作为**可能在两端同时改同一条记录的用户，  
**我希望**云端较新时进入**现有** M3-C 冲突 UI（keep_local / take_cloud），  
**以便**不学习第二套冲突模型。

| 验收要点 | 对齐 |
|----------|------|
| `cloud_newer` → open conflict；keep/take 持锁（依赖 main M3-C `9b64a2b`） | plan ★F · D2-P4 · **§3.5.7** |
| **无** Notion 专用冲突分支；`id→opId` + 同形 `PushResult` | plan §2.1 · §3.3 · **§3.5.2** |
| `skipped_deleted` / `ambiguous_race` **禁止**当成功 ACK | plan §3.3 · **§3.5.2** |

### US-D2-5 · Notion 与 Supabase 互斥；切 Notion 不改 Supabase 项目数据

**作为**已有 Supabase 云同步的用户，  
**我希望**不能同时启用 Notion + Supabase；切换到 Notion **不**改写、清空或迁移既有 Supabase 项目数据，  
**以便**两条路径互不影响。

| 验收要点 | 对齐 |
|----------|------|
| UI + engine 互斥；不能双开 | plan D2.7 · H3 |
| provider=supabase 回归绿；现网数据未改 | plan D2.5 · H3 |
| 切换走廊 UI 可延后 D2b/D3（SW*）；默认不清 Outbox | plan §4.3 · D2-P5 |

### US-D2-6 · Token 只在用户 Worker；PWA 无 Token / 长期 Gateway Key

**作为**担心密钥泄露的用户，  
**我希望** Notion Integration Token **仅**存在于我自有 Worker Secret；PWA 包体、IDB、导出 JSON **永不**持久化 Token 或长期 Gateway Key，  
**以便**符合 BYO 与 H8。

| 验收要点 | 对齐 |
|----------|------|
| 类型禁止 secret 字段；导出剥离会话密钥 | plan H8 · §7 C1–C4 |
| 静态扫描：无 `@notionhq/client`；源码无 `ntn_`/`secret_` 实值 | plan D2.4a · C8 |
| Git / artifacts **禁止** Token | plan C-D2 · H5 证据纪律 |

### US-D2-7 · 照片留本地；UI 声明不同步图片；引导云照片路径

**作为**带照片的养护用户，  
**我希望** Notion 路径下照片仍留在本地；UI 明确「不同步图片」，并引导需要云端照片时使用 Supabase 或本地导出，  
**以便**不被「完整图文云备份」误导。

| 验收要点 | 对齐 |
|----------|------|
| media 不出箱；`getMediaObjectStore() → null` | plan H4 · D2.6 |
| 文案禁「完整图文云备份」等 | plan C10 |
| 引导：云照片 → Supabase；或本地 export | 产品文案 · D2-P2 |

---

## 2. 非目标（产品经理）

与 [`m3d-d2-plan.md`](./m3d-d2-plan.md) §1.2 / H9 对齐并显式列出：

| 非目标 | 说明 |
|--------|------|
| stations / settings / media / learning 上 Notion | 仅 vehicles + records |
| 图片 / 媒体二进制同步 | 见 US-D2-7 · H4 |
| 前端存 secrets（Token / 长期 Gateway Key） | 见 US-D2-6 · H8 |
| 同时启用 Supabase + Notion | 互斥 · US-D2-5 |
| 正式多租户 Gateway | 永久否决（BYO）· H9 |
| merge 后自动部署测试站/生产站 | H1；merge ≠ 部署；须用户再授权 |
| 字段级三路合并 | 复用 M3-C 二选一 |
| 强跨 Worker 一致性 | 无 Durable Object（D4）；继承 D1 残余窗口 |

另见 plan §1.2：Durable Object、JWT `/auth/*`、应用方集中托管 Token / Public OAuth、用 mock Notion 替代 H5 真机验收。

---

## 3. 验收 A–E

> 技术矩阵细节以 plan §4 为准；本节为产品/发布门禁与 DoD 文案。

### A · 流程门禁

| # | 门禁 |
|---|------|
| A1 | 实现走**独立** PR（建议分支名 `feature/m3d-d2-notion-provider` 或按 D2-P1..P5 切分）；**最终**才合入，审查通过前不 merge |
| A2 | **审查通过后**才可申请 merge；**merge ≠ 部署**；测试站/生产站须用户再授权 |
| A3 | **分阶段**：先单元测试（mock Gateway）→ 再真实 Token + **独立 Notion 测试工作区** E2E |
| A4 | **仅 mock 绿 ≠ D2 完成**（对齐 H5 / G4 / 上文 §0） |

### B · PWA 功能检查

覆盖 US-D2-1..5、US-D2-7 的可感知路径：

- 实验设置：URL 持久、Key 会话、verify、冷启动重输  
- 首次上传 / 同 AppEntityId 不双页  
- 离线 → Outbox → push；pull 见结构化数据  
- 双端脏 → M3-C 冲突 UI  
- Notion ↔ Supabase 互斥；切 Notion 不改 Supabase 数据  
- 媒体留本地 + 合规文案  

（对应 plan D2.1–D2.8 · ★C/U/D/R/F/T）

### C · 安全 + 文案

- Token 仅用户 Worker；PWA bundle / IDB / export **无** Token 或长期 Gateway Key（US-D2-6）  
- 文案：无「完整图文云备份」；明示不同步图片；引导 Supabase / 本地导出（US-D2-7）  
- 对齐 plan §7 C1–C4、C8、C10、C-D2  

### D · 最小 E2E 脚本（8 步）

> 必须在**真实 Notion 测试工作区** + 用户自有 Gateway（真实 Integration Token）执行；步骤可记入 `artifacts/live-notion/`（**禁止**写入 Token）。

1. 配置 Gateway URL；输入会话 API Key；`/verify` → 200，取得 `workspaceKey`  
2. 首次上传（或 snapshot）本地 **1 辆车 + 1 条养护记录** → Notion 各一页，`AppEntityId` 正确  
3. 修改同车/同记录并 push → **同页更新**，无第二页  
4. 断网编辑 → 恢复网络 → Outbox flush 成功  
5. pull（或第二配置）→ 结构化字段可见  
6. 制造双端脏（云端较新）→ 出现 M3-C 冲突 UI；keep 或 take 后两端一致  
7. 确认媒体未出箱；UI 含「不同步图片」类说明  
8. 冷启动应用 → URL 仍在、须重输 API Key；切换/保持与 Supabase 互斥且 Supabase 项目数据未改  

### E · Definition of Done（D2）

| 必须 | 说明 |
|------|------|
| 单元测试绿 | mock Gateway；含 enqueue / 错误码 / 类型安全 / 无密钥字段 |
| **真实 Token E2E 证据** | §D 八步在独立测试工作区通过；artifacts **无** Token |
| **独立审查** | 代码 + 安全清单 + 文案；审查通过前不 merge |
| **≠ 生产开放** | 不合并不等于部署；不默认开启生产 Notion；不部署正式 Gateway；须用户再授权后才动测试站/生产站 |

**非 DoD**：仅有 mock 绿；或只能打通仓库内 `*-d1-test` 而无法在用户自有工作区复现（对齐 plan §8）。

---

## 4. 与架构规划 / PR 切片映射

| 用户故事 | 主要 PR 切片（plan §6） |
|----------|-------------------------|
| US-D2-1 | D2-P2（设置 + 会话）；客户端骨架 D2-P1 |
| US-D2-2 | D2-P3（live sync / snapshot） |
| US-D2-3 | D2-P1（enqueue 单测）+ D2-P3 |
| US-D2-4 | D2-P4（M3-C 冲突路径） |
| US-D2-5 | D2-P2（互斥 UI）+ D2-P3（回归 D2.5） |
| US-D2-6 | 全程 H8；D2-P1 类型/扫描；审查 §7 |
| US-D2-7 | D2-P2 文案；D2-P3 D2.6 |

**D2-P0**（本 docs PR）：本文件 + [`m3d-d2-plan.md`](./m3d-d2-plan.md) + roadmap；**无 `src/**` 变更**。

---

## 5. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-10-14 | 产品经理交付 US-D2-1..7、非目标、验收 A–E；并入 docs PR #10；明确 D1 M1 PASS ≠ D2 完成 |
| 2026-10-14 | 复审闭合：交叉链接 plan §3.5 前端契约适配；§1.1 摘要；US-D2-1/4 对齐 |
| 2026-10-14 | 措辞：§3.5「条件通过 must-fix」→「复审闭合」；D2.1 验收补会话有效（对齐 plan §3.5.5） |
