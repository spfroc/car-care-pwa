# M3-D D2 规划：PWA NotionProvider 架构切片与门禁

> **状态**：规划草稿（2026-10-14）· **docs / 规划级** · 用户授权启动 D2（选项 A）  
> **前置**：D0 设计通过 · D1 Worker Gateway 原型 PR #9 已 merge（`a79db99`）· M1 Trash live **PASS**  
> **权威冻结**：[`m3d-mvp-spec.md`](./m3d-mvp-spec.md) §0/§0.1 · [`m3d-architecture.md`](./m3d-architecture.md) · [`m3d-implementation-spec.md`](./m3d-implementation-spec.md) · [`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md) · D1 风险报告 [`m3d-d1-risk-report.md`](./m3d-d1-risk-report.md)  
> **本文件职责**：D2 模块边界、与 D1 Worker 契约、验收矩阵、风险、建议 PR 切分与硬门禁。  
> **产品配套**：[`m3d-d2-product.md`](./m3d-d2-product.md)（MVP 用户故事 US-D2-1..7、产品非目标、验收 A–E）；冲突时以本文件硬门禁 / PR 切片为准。  
> **冲突时**：以 mvp §0.1 / architecture 为准；本规划不得推翻 O1–O6 / S1–S3 / P1–P4。  
> **D1 vs D2**：D1 M1 live Trash 证据已 **PASS**（Worker 原型）；D2 仍须**自己的**真实 Notion 工作区集成验收（mock Gateway 仅单测；详见 product §0）。

---

## 0. 硬约束（本阶段全程）

| # | 约束 |
|---|------|
| H1 | **独立 feature 分支 + PR**；审查通过且用户再授权前：**不合并不部署**测试站/生产站 |
| H2 | 范围：`NotionProvider`、Gateway 认证、**vehicles + records** 双向同步；复用 **Outbox + M3-C** 冲突 UI |
| H3 | **Supabase 功能不变**；回归必须绿；provider **互斥** |
| H4 | **不同步 Notion 图片**（媒体二进制不出箱；禁「完整图文云备份」文案） |
| H5 | **前置门禁**：真实 Notion Integration Token 联调。D1 模板已有 PASS 证据，但 **D2 集成验收不得用 mock 冒充真实 Notion** |
| H6 | 分阶段：先适配器**单元测试** → 再**独立 Notion 测试工作区**验证 create/update/delete/restore/冲突/重试 |
| H7 | 目标：用户能用**自己的** Notion 工作区同步车辆与养护记录，不止代理模板 |
| H8 | PWA **永不**持久化 `NOTION_TOKEN` / `GATEWAY_API_KEY` 到 IDB 设置或 JSON 导出；Token 仅用户 Worker Secret |
| H9 | ❌ 正式多租户 Gateway · ❌ 改正式 Supabase · ❌ 把 `*-d1-test` Worker 当生产 |

---

## 1. D2 目标与非目标

### 1.1 目标（用户可感知）

用户在实验/高级设置中配置 **自有 Gateway URL**，每次会话输入 **Gateway API Key**，完成 `/verify` 后，本地车辆与养护记录经 Outbox **双向**同步到其 Notion Data Sources；冲突进入既有 M3-C UI；Supabase 路径不受影响。

### 1.2 非目标（D2 不做）

> 与产品经理清单一致（详见 [`m3d-d2-product.md`](./m3d-d2-product.md) §2）。

- stations / settings / media / learning 的 Notion 同步  
- 图片 / 媒体二进制同步（上云）；Durable Object；JWT `/auth/*`（D4）  
- 前端存 secrets（Token / 长期 Gateway Key）；应用方集中托管 Token / Public OAuth  
- 同时启用 Supabase + Notion（双写）  
- 正式多租户 Gateway（永久否决 · BYO）  
- merge 后自动部署测试站/生产站（merge ≠ 部署）  
- 字段级三路合并；强跨 Worker 一致性  
- 部署正式 Gateway 或生产 PWA Notion 默认开启  
- 用 mock Notion **替代** H5 真机验收（单测 mock Gateway **可以**，且应先于真机；**仅 mock 绿 ≠ D2 完成**）

### 1.3 相对 D1 的增量

| 层 | D1（已交付） | D2（本规划） |
|----|--------------|--------------|
| Worker | 用户自有模板 + 测试 Worker + live Trash/auth/LWW 证据 | **原则上不改契约**；仅 bugfix / CORS Origin 文档；fork 指引已在 README |
| PWA | stub / 未接生产路径 | 真 `NotionProvider` + Gateway 客户端 + enqueue + 实验 UI |
| 验收 | D1.1–D1.9 · M1 Trash | D2.1–D2.8 · 真机 CRUD/冲突/重试（§4） |

---

## 2. 模块边界

```
┌─────────────────────────────────────────────────────────────┐
│ PWA (IndexedDB = 权威本地)                                   │
│  DataStorageSettings (实验)                                  │
│       │ gatewayUrl (持久) + API Key (仅内存会话)              │
│  NotionRuntimeSession ──► NotionGatewayClient ──HTTPS+Bearer─►│
│  NotionProvider : CloudProvider                               │
│       │ verify / pullAll / pushOps / pushSnapshot             │
│  outbox + engine + merge + conflictDetect/Resolve (M3-C)     │
│  sync_notion_map (可选加固：pageId / tombstone 提示)           │
└───────────────────────────────┬─────────────────────────────┘
                                │ 契约：CONTRACT.md / impl-spec §3
┌───────────────────────────────▼─────────────────────────────┐
│ 用户自有 Worker (D1 模板)                                     │
│  GATEWAY_API_KEY · NOTION_TOKEN(Secret) · TOMBSTONE_KV       │
│  /health /verify /sync/pull /sync/push /sync/snapshot        │
└───────────────────────────────┬─────────────────────────────┘
                                │ Notion-Version 2026-03-11
┌───────────────────────────────▼─────────────────────────────┐
│ 用户 Notion workspace · Vehicles + Records Data Sources      │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 PWA 落点（实现 PR 才动 `src/**`）

| 模块 | 建议路径 | 边界 |
|------|----------|------|
| Gateway HTTP 客户端 | `src/sync/providers/notionGatewayClient.ts` | 只懂 URL/Bearer/超时/429 退避/错误码 → `PushResult`/`VerifyResult`；方法带 `signal?: AbortSignal`；**无** Notion SDK |
| NotionProvider | `src/sync/providers/notion.ts` | 实现 `CloudProvider`；委托客户端；§3.5 适配；`getMediaObjectStore() → null` |
| 会话类型 | `src/sync/types.ts` + `config.ts` | 可持久：`notionGatewayUrl`、`notionWorkspaceHint`、`workspaceKey`；**类型禁止** secret；`NotionRuntimeSession` 仅内存；**白名单**读写对齐 §3.5.6 |
| Outbox | `src/sync/outbox.ts` | `isCloudEnqueueEnabled` 含 `'notion'` **且**有效会话；flush 仅 `ownerUserId === workspaceKey` |
| Engine | `src/sync/engine.ts` | `resolveProvider('notion')` 注入 URL+session；与 supabase **互斥**；锁 signal 下传 |
| notion map（建议） | `src/sync/notionMap.ts` + IDB store | `(entity, appEntityId) → { pageId, workspaceKey, tombstone? }`；防 UI 硬删后盲目 recreate |
| 冲突 | `merge` / `conflictDetect` / `conflictResolve` | **无 Notion 专用分支**；消费同形 `CloudRow` / `PushResult` |
| 设置 UI | `DataStorageSettings.tsx` + i18n | 实验折叠；URL + 会话 Key；媒体说明；旧 Outbox 面板（可 D2b） |
| 回归 | 现有 supabase provider 测试 | 不得因 notion 分支变红 |

### 2.2 Worker 边界（D2 默认只消费）

- 契约源：[`docs/templates/notion-sync-worker/CONTRACT.md`](./templates/notion-sync-worker/CONTRACT.md) + [`m3d-implementation-spec.md`](./m3d-implementation-spec.md) §3  
- D2 **禁止**为图省事改契约破坏 D1 证据；必要修复走独立小 PR 并重跑相关夹具  
- CORS：`ALLOWED_ORIGIN` 须覆盖开发 Origin（及日后 Staging Origin）；用户自部署

### 2.3 明确不进 D2 边界

| 排除 | 去向 |
|------|------|
| JWT `/auth/session` | D4 |
| Durable Object | D4 / O5 |
| Payload 拆分 `PayloadJson_N` | D4 |
| 正式并列 UI（非实验） | D2 真机通过后产品再议（P3） |
| 正式多租户 Gateway | 永久否决（BYO） |

---

## 3. 与 D1 Worker 契约（消费清单）

### 3.1 认证与 CORS

| 规则 | PWA 行为 |
|------|----------|
| `Authorization: Bearer <GATEWAY_API_KEY>` | 每次会话输入；401 → 清内存会话、提示重输 |
| Origin 精确匹配 | 浏览器环境必配；开发与 Staging Origin 写入用户 Worker vars |
| 永不回显 Token | 客户端不得记录 Authorization / 响应中的密钥 |

### 3.2 端点映射

| CloudProvider | HTTP | 备注 |
|---------------|------|------|
| `verify()` | `GET /verify` | 取 `workspaceKey` → Outbox `ownerUserId` |
| `pullAll()` | `GET /sync/pull?entities=vehicles,records` | 行含 tombstone（KV 合并） |
| `pushOps()` | `POST /sync/push` | body：`SyncOutboxItem[]` 或 `{ ops }` |
| `pushSnapshot()` | `POST /sync/snapshot` | 首次全量；分块 |
| （探活） | `GET /health` | 可选；需 Bearer |
| D4 | `POST /auth/*` | 期望 501；忽略 |

### 3.3 PushResult 同形（M3-C 接入）

| Gateway | PWA |
|---------|-----|
| `applied[]` | ACK outbox |
| `conflicts[].reason = cloud_newer` | E1 → open conflict |
| `skipped_deleted` / `ambiguous_race` | 可读冲突/错误；**禁止**当成功 ACK |
| `errors[].retryable` | 429/5xx → outbox 退避；不 ACK |
| `payload_too_large` | 失败闭合；用户可读 |

> **字段级 must-fix**（`id→opId`、`workspaceKey→userId`、`errors[]`、AbortSignal、会话、持久白名单、M3-C 依赖）：见 **§3.5 前端契约适配**。

### 3.4 删除 / 重试走廊（继承 D1 M1）

1. delete → Gateway 双轨 + KV  
2. Trash 成功而 KV put 失败 → **不 ACK**；客户端 **幂等重试** 同一 delete（D1 风险报告残余）  
3. 过期 upsert → `skipped_deleted`；禁止复活  

### 3.5 前端契约适配（条件通过 · must-fix）

> 本节把 Gateway JSON（[`CONTRACT.md`](./templates/notion-sync-worker/CONTRACT.md)）接到现有 `CloudProvider` / `PushResult` / Outbox / M3-C。实现 PR（D2-P1..P4）必须对齐；产品侧交叉见 [`m3d-d2-product.md`](./m3d-d2-product.md) §1.1。  
> §3.3 为摘要；**字段级映射以本小节为准**。

#### 3.5.1 Verify 适配

| Gateway `/verify` | PWA |
|-------------------|-----|
| `workspaceKey` | → `VerifyResult.userId`（作 `sync_meta.cloudUserId` / Outbox `ownerUserId`） |
| `ok` / 失败 `error` | → `VerifyResult.ok` / `error` |
| `botName?` | 可选展示（可映射 `email` 或设置文案；非硬依赖） |
| `dataSources?` | **仅诊断**（设置页提示 DS 已绑）；**不**写入业务权威、**不**替代 `workspaceKey` |

`verify` 成功后：`patchSyncMeta({ cloudUserId: verify.userId })`；enqueue / flush 仅 `ownerUserId === workspaceKey`（= `userId`）。

#### 3.5.2 PushResult 适配表

Gateway `POST /sync/push` → 引擎消费的 `PushResult`：

| Gateway 字段 | → PWA `PushResult` | 规则 |
|--------------|-------------------|------|
| `applied[]`（outbox id） | `applied: string[]`（opId） | 仅这些 op **ACK** / `removeOutboxItems` |
| `conflicts[].id` | `conflicts[].opId` | **必须** `id → opId`；引擎按 opId 关联 outbox |
| `conflicts[].entity` | `conflicts[].entity` | 透传；缺省时上层不得臆造成功 |
| `conflicts[].reason` | `conflicts[].reason` | `cloud_newer` → M3-C `openConflict`；见下 |
| `conflicts[].attemptedAt` | `conflicts[].attemptedAt` | 透传（防误删较新 mid-sync op） |
| `conflicts[].cloudRow?` | 透传或映射 | 优先填入冲突快照；可派生 `entityId` / `cloudUpdatedAt`；缺则 `handlePushConflicts` 可再 `pullAll` |
| `skipped_deleted` / `ambiguous_race` | 进 `conflicts`（或等价非 applied 通道） | **禁止**进入 `applied`；**禁止**当成功 ACK |
| `errors[]` | 见 §3.5.3 | **禁止**混入 `applied` |

`cloud_newer`：走既有 M3-C（`open` / `keep_local` / `take_cloud`）；**无** Notion 专用冲突分支。

#### 3.5.3 `errors[]` 结算

Gateway：`errors: [{ id, entity, code, message, retryable }]`.

实现二选一（P1 单测须覆盖映射；文档与代码择一并写清）：

1. **扩展** `PushResult.errors`（推荐，契约同形），引擎按条结算；或  
2. **映射**为逐 op `markOutboxFailure(opId, …)` + `nextRetryDelayMs` 退避，且 **不** ACK。

| `code` / HTTP | 行为 | ACK？ |
|---------------|------|-------|
| `payload_too_large`（413/422） | **失败闭合**；该 op 标记失败；UI 可读；**禁截断** PayloadJson | ❌ |
| 429 / `rate_limited` | `retryable: true` → backoff；可读「稍后重试」 | ❌ |
| 503 / `notion_unavailable` / 5xx | `retryable: true` → backoff | ❌ |
| 其它 `retryable: false` | 失败闭合或进诊断；不 ACK | ❌ |
| 整包超时 / 网络断开 | 见 §3.5.4；全部未决 op **不** ACK | ❌ |

顶层 `PushResult.error`（现有单字符串）可保留作「批次摘要」；**不得**用「有 error 就 ACK 其余」掩盖未列出的 op——未进 `applied` 的 op 一律保留队列。

#### 3.5.4 AbortSignal

- `NotionGatewayClient` 方法签名与引擎锁对齐：`verify/pullAll/pushOps/pushSnapshot(…, signal?: AbortSignal)`（实现阶段扩 `CloudProvider` 或 Provider 内转发）。  
- 与 `withSyncLock` / `throwIfSyncAborted` 同一 `AbortSignal`；超时 / lease lost → **中止 in-flight fetch**。  
- **超时 abort 必须不 ACK**：不得 `removeOutboxItems`；不得把不确定写成功的 id 写入 `applied`。  
- abort 后上层按现网：`SyncLeaseLostError` 或等价「未合并 / 请重试」；Outbox 保持可幂等重推。

#### 3.5.5 会话生命周期（`NotionRuntimeSession`）

| 项 | 约定 |
|----|------|
| **栖身** | 进程内模块单例 / 设置页持有的 runtime（**非** `CloudStorageConfig`）；可选 `sessionStorage` 仅作 **同 tab** 刷新便利（**禁止**进 `car-care-export` / IDB 设置） |
| **字段** | `{ bearer, workspaceKey, expiresAt? }`；`bearer` = 会话 Gateway API Key（或 D4 JWT） |
| **清 Key** | `401 unauthorized` · `disconnectCloud` · `signOut` · **冷启动**（无有效会话） |
| **工厂** | `resolveProvider('notion')` 注入 `notionGatewayUrl`（持久）+ 当前 `NotionRuntimeSession`；缺会话 → **不**构造可推送 Provider |
| **enqueue** | 无会话时 `isCloudEnqueueEnabled('notion') === false`（实现：`provider==='notion'` 且 URL 已配 **且** 内存会话有效；仅 URL 不足） |

**sessionStorage vs 冷启动**：`sessionStorage` **可选**；关浏览器 / 新会话仍须重输 Key（验收 D2.8）。有 sessionStorage 时「同 tab 刷新可免重输」≠ 持久化长期密钥。

#### 3.5.6 持久字段与 `config.ts` 白名单

| 字段 | 持久？ | 说明 |
|------|--------|------|
| `provider: 'notion'` | ✅ IDB `cloudStorage` | |
| `notionGatewayUrl` | ✅ **新增** | HTTPS；`get/setCloudStorageConfig` 白名单读写 |
| `notionWorkspaceHint` | ✅（已有） | 展示 |
| `workspaceKey` | ✅ 建议 | 可放 `CloudStorageConfig` **或** `sync_meta.cloudUserId`（与 verify `userId` 同源）；防串租户；**非**密钥 |
| `GATEWAY_API_KEY` / Token / JWT | ❌ | 类型 **禁止** secret 字段；对齐 architecture §2.4–2.5 |

实现时同步改 `src/sync/types.ts` 的 `CloudStorageConfig` 与 `config.ts` 的 get/set **白名单**（今日仅 `provider` / `supabaseUrl` / `supabaseAnonKey` / `notionWorkspaceHint`）——漏白名单则 URL 无法 round-trip。导出过滤必须剥离会话密钥。

#### 3.5.7 M3-C 依赖（D2-P4）

- **D2-P4**（`cloud_newer` → open / keep / take）依赖仓库内 **已合并** 的 M3-C：`openConflict` · `keep_local` · `take_cloud`（持锁）。  
- M3-C 已在 **main**（merge `9b64a2b` / PR #7）；当前 `origin/main` 含该提交（及后续 D1 等）。  
- D2 **不**重做冲突模型；仅保证 PushResult 适配后进入同一条走廊。

#### 3.5.8 非阻塞备注（实现时折叠执行）

| 项 | 说明 |
|----|------|
| **P1 mocks** | 单测覆盖 `conflicts[].id → opId`、`workspaceKey → userId`、`errors[]` 结算（扩展或 `markOutboxFailure`） |
| **P3 CORS** | 用户 Worker `ALLOWED_ORIGIN` **含本地开发 Origin**（及日后 Staging）；见 §2.2 |
| **verify 文案** | **401** = Key 无效/缺失 → 清会话重输；**403** = Origin 未在 `ALLOWED_ORIGIN` → 提示改 Worker CORS，**不是**换 Key |
| **P5 / 切换走廊** | D2-P5 可延期；默认 **保留** 孤儿 Outbox（按 `ownerUserId` 隔离不误推）；面板可延后；对齐 architecture SW* |

---

## 4. 验收矩阵（D2）

> 用例 ID 对齐 [`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md) §2.3；H5 要求带 ★ 的项必须在**真实 Notion 测试工作区**跑通（经用户 Gateway，非 mock Notion）。

### 4.0 前置门禁（开工 / 合并前）

| # | 门禁 | 证据 |
|---|------|------|
| G0 | 独立 feature 分支；PR 描述含本规划链接与禁区 | PR body |
| G1 | 真实 Integration Token 可用（测试 workspace，非生产车库） | `/verify` 200；**不**把 Token 写入 Git |
| G2 | 用户自有 Worker（fork 模板或 `*-d1-test` 仅作开发）CORS Origin 已配 | curl / 浏览器预检 |
| G3 | 适配器单测绿（mock **Gateway**，非假 Notion） | CI / `npm test` |
| G4 | ★ 真机矩阵 §4.2 通过后才可申请 merge；merge ≠ 部署 | artifacts 或审查签收 |
| G5 | 用户再授权后才部署 Staging/生产 | 聊天 / PR 评论 |

### 4.1 单元 / 契约（可 mock Gateway）

| ID | 项 | 通过标准 |
|----|----|----------|
| D2.1 | enqueue | `isCloudEnqueueEnabled` 含 `notion`；vehicles/records 入队；media **不**入队 |
| U1 | GatewayClient 401/403/429/503 | 映射正确；**401** 清会话；**403 Origin** 文案区分（§3.5.8）；Abort 不 ACK |
| U2 | PushResult 适配 | `id→opId`；`cloud_newer` / `skipped_deleted` / `ambiguous_race` **不**进 applied；`errors[]` 结算（§3.5.2–3） |
| U3 | 类型安全 | `CloudStorageConfig` 无 token/key；含 `notionGatewayUrl` 白名单（§3.5.6） |
| D2.4a | 静态扫描 | bundle 依赖无 `@notionhq/client`；源码无 `ntn_`/`secret_` 实值 |

### 4.2 ★ 真机（独立 Notion 测试工作区）

| ID | 项 | 通过标准 |
|----|----|----------|
| D2.2 | 离线→在线 | 断网编辑，恢复后 outbox push 成功 |
| D2.3 | 双向 | 设备 A push → 设备 B pull 可见（可用两配置或 pull 自检） |
| ★C | create | 新车辆/记录 → Notion 一页；`AppEntityId` 正确 |
| ★U | update | 二次 upsert **更新同页**不双页 |
| ★D | delete | 本地删 → `in_trash` + `AppDeletedAt`；pull 见 tombstone |
| ★R | restore | 恢复后两端存活；KV 墓碑清除 |
| ★F | 冲突 | 云端较新 push → `cloud_newer` → M3-C open；keep/take 持锁 |
| ★T | 重试 | 模拟 429/断开后最终成功或可诊断失败；delete 未 ACK 可幂等重试 |
| D2.6 | 媒体 | media 不出箱；UI 无违禁文案 |
| D2.7 | 互斥 | 不能同时启用 supabase+notion |
| D2.8 | 冷启动 | 重启后须重输 API Key；URL 仍在 |
| D2.5 | Supabase 回归 | provider=supabase 原测试绿；现网数据未改 |

### 4.3 D2 可选延后到 D2b / D3（规划标明，避免偷加范围）

| ID | 项 | 建议切片 |
|----|----|----------|
| SW1–SW4 | 切换/断开 Outbox 走廊 UI | D2b 或 D3 |
| D3.6 | 首次双非空确认 | D3 |
| DEL* 全矩阵 | 多设备删除边角 | D2 真机至少 ★D/★R；多设备 DEL → D3 |

### 4.4 产品验收 A–E（摘要）

完整文案见 [`m3d-d2-product.md`](./m3d-d2-product.md) §3：

| | 含义 |
|---|------|
| **A** | 独立 feature PR；审查后才 merge；分阶段单测→真 Token+测试工作区 E2E；**mock-only ≠ D2 完成** |
| **B** | PWA 功能（US-D2-1..5、US-D2-7） |
| **C** | 安全 + 文案（US-D2-6/7） |
| **D** | 最小真机 E2E 八步（真实 Notion 工作区） |
| **E** | DoD：单测 + 真 Token E2E 证据 + 独立审查；**≠ 生产开放** |

---

## 5. 风险（D2 特有 / 继承）

| ID | 风险 | 缓解 | 残余 |
|----|------|------|------|
| R-D2-1 | 用 mock 冒充真 Notion 验收 | H5 / G4；artifacts 目录区分 `unit/` vs `live-notion/` | 流程纪律 |
| R-D2-2 | 误改 Worker 契约导致 D1 回退 | D2 默认只消费；契约变更独立 PR + 重跑夹具 | — |
| R-D2-3 | API Key 进 IDB/导出 | 类型禁止 + 导出过滤 + D2.4 扫描 | XSS 面仍在 — 会话内存 |
| R-D2-4 | enqueue 漏开 → 静默不同步 | D2.1 单测 + checklist | — |
| R-D2-5 | 与 Supabase 双开 | 互斥 UI + engine 守卫 + D2.7 | — |
| R-D2-6 | CORS / Origin 配错 | README + verify 失败可读 | 用户运维 |
| R-D2-7 | Trash→KV 窗口（D1 残余） | 不 ACK + 幂等重试；文档写进 Provider 注释 | 跨 isolate 仍弱 |
| R-D2-8 | 误部署生产 / 正式 Gateway | H1/H9；PR 模板勾选 | 流程纪律 |
| R9–R11,R16 | 见总风险表 | 继承 architecture / risks | — |

---

## 6. 建议 PR 切分

> 每一 PR：**独立分支**；描述含本规划章节；**审查通过前不 merge**；**merge ≠ 部署**。

| PR | 名称建议 | 内容 | 出口门禁 | 禁区 |
|----|----------|------|----------|------|
| **D2-P0** | `docs(m3d): D2 plan` | 本文件 + [`m3d-d2-product.md`](./m3d-d2-product.md)（US-D2-1..7 / 验收 A–E）+ roadmap | 架构师 + 产品签收 | 无 `src` |
| **D2-P1** | `test(m3d-d2): NotionGatewayClient + Provider unit` | 客户端 + Provider 骨架；**mock Gateway**；enqueue/媒体/错误码单测；**§3.5** mocks：`id→opId` / `workspaceKey→userId` / `errors[]` | G3 · D2.1 · U1–U3 · D2.4a · §3.5.8 | 不接真 Notion；不改设置默认 |
| **D2-P2** | `feat(m3d-d2): experimental settings + session` | 实验 UI：URL、会话 Key、互斥、媒体文案；冷启动重输 | D2.7 · D2.8 · 文案扫描 | 不默认开启；不部署 |
| **D2-P3** | `feat(m3d-d2): live sync vehicles/records` | 真机接线；outbox flush；pull/merge；artifacts `live-notion/` | ★C/U/D/R/T · D2.2 · D2.3 · D2.5 · D2.6 · G1/G4 | 无媒体上云；无正式站部署 |
| **D2-P4** | `feat(m3d-d2): M3-C conflict path` | `cloud_newer` → open；keep/take；回声抑制；**依赖** main 已合并 M3-C（`9b64a2b`） | ★F · 对齐 D3.1–D3.4 子集 · §3.5.7 | 无第二套冲突模型 |
| **D2-P5**（可选） | `feat(m3d-d2): sync_notion_map + switch corridor` | map store；旧 Outbox 面板 SW*；可延期 | SW1–SW4 或明确延期 D3 · §3.5.8 | 默认**保留**孤儿 Outbox；面板可延后 |

**推荐开工顺序**：P0（本 PR）→ P1 → P2 → P3 → P4 →（P5）。  
**产品经理**：用户故事与验收 A–E 已写入 [`m3d-d2-product.md`](./m3d-d2-product.md)（与本矩阵对齐，不另造冲突语义）；实现 PR 按 US-D2-1..7 对照 §4 / product §4 映射验收。

---

## 7. 安全检查清单（D2 CI / 审查）

| # | 检查 |
|---|------|
| C1 | Git 无 `ntn_` / `secret_` / 实值 `GATEWAY_API_KEY` |
| C2 | 类型：设置/导出结构无 token/key 字段 |
| C3 | `car-care-export` 剥离会话密钥 |
| C4 | API Key 仅内存（可选 sessionStorage）；禁 localStorage / IDB 设置 |
| C8 | 生产构建依赖图无 `@notionhq/client` |
| C10 | 文案扫描：禁「完整图文云备份」等 |
| C-D2 | artifacts 可含 pageId / 脱敏 workspaceKey fingerprint；**禁止** Token |

---

## 8. 成功定义（D2）

1. 用户按 README fork/部署（或使用自有已配 Token 的测试 Worker），在 PWA 实验开关填 URL + 会话 Key 后，能对**自有**测试 Notion 工作区完成车辆/养护的创建、更新、删除、恢复与基础冲突处理。  
2. Supabase 路径回归绿；无媒体上云；无密钥进持久化/导出。  
3. 全程未部署正式 Gateway / 生产站，直至审查通过且用户再授权。

**非成功**：仅有 mock 绿、或只能打通仓库内 `*-d1-test` 而无法在用户自有工作区复现。

---

## 9. 退出 / 降级（沿用 risks §3）

若 D2-P3 真机证明无法在不持久化长期密钥的前提下完成可接受 UX，或 LWW/删除走廊导致不可接受丢数据，应暂停产品化并评估「仅经代理的单向导出」降级，而非放宽 H8/H4。
