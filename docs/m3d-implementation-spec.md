# M3-D 实现规格（Implementation Spec）· Notion BYO

> **状态**：草稿（2026-10-13）· **仅 docs** · 第三轮闭合复审 **通过**（`fea4686`）后授权起草  
> **权威冻结**：[`m3d-mvp-spec.md`](./m3d-mvp-spec.md) §0 / §0.1 · [`m3d-architecture.md`](./m3d-architecture.md) · [`m3d-notion-byo-architecture.md`](./m3d-notion-byo-architecture.md) · [`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md) · [`m3d-architecture-review-round2.md`](./m3d-architecture-review-round2.md)  
> **本文件职责**：把冻结设计落成「模块落点 / Gateway 契约 / 模板路径 / 工程切片 / 测试映射」；**仍禁止**业务 `src`、真 Notion API、merge PR、部署、碰正式 Supabase。  
> **冲突时**：以 mvp §0.1 与 architecture 为准；本规格不得推翻 O1–O6 / S1–S3 / P1–P4。

---

## 1. 范围与非目标

### 1.1 本规格覆盖

| 项 | 说明 |
|----|------|
| 模块拆分与文件落点 | PWA NotionProvider、Gateway HTTP 契约、`sync_notion_map`、设置 UI 实验开关 |
| Gateway API | Bearer API Key、端点、错误码、限流语义 |
| Worker 参考模板（O1） | `docs/templates/notion-sync-worker/` 目录与伪代码；**不**进 app 生产构建 |
| 数据属性 | PascalCase；删除双轨；Payload 失败闭合 |
| 双层 LWW + M3-C | 接入点与 `PushResult` 同形要求 |
| Outbox owner 隔离 | 切换保留策略实现要点 |
| 分阶段切片 | D1 Staging 前工程顺序 + 验收用例映射 |
| 安全检查清单 | Token / 密钥扫描等 |

### 1.2 明确非目标（本规格与后续实现 PR 均须遵守）

- ❌ 在本 docs PR 或未授权实现 PR 中编写可运行业务 `src` / 接真 Notion API  
- ❌ 把 `@notionhq/client` 或 Notion Token 打进 PWA 生产 bundle  
- ❌ 集中托管多租户 Token / 共享 Public OAuth（O2）  
- ❌ MVP 媒体二进制同步；文案称「完整图文云备份」  
- ❌ Durable Object 作为 MVP 必做（O5）；承诺跨实例强一致  
- ❌ 与 Supabase 双写；改正式 Supabase schema / 生产部署 / merge 后自动上线  
- ❌ 静默截断 `PayloadJson`；无认证开放代理；长期密钥写入 IDB / JSON 备份  
- ❌ stations / settings / media / learning 的 Notion 同步  

---

## 2. 模块拆分与文件落点

> 下列路径为**实现阶段预期**（相对仓库 `app/`）。本 PR **不创建** `src/**`；仅 `docs/templates/**` 可放伪代码/接口说明。

### 2.1 PWA 侧（实现 PR 才动）

| 落点 | 职责 | 相对冻结设计 |
|------|------|--------------|
| `src/sync/providers/notion.ts` | 真 `NotionProvider`：只调用户 Gateway；构造注入 `gatewayUrl` + 运行时 `NotionRuntimeSession` | architecture §0.1 / §8 |
| `src/sync/providers/notionGatewayClient.ts`（建议新建） | 薄 HTTP 客户端：Bearer、超时、429 退避、错误码映射 → `PushResult` / `VerifyResult` | §2.2 |
| `src/sync/providers/types.ts` | 保持 `CloudProvider`；不改冲突语义 | §0.2 |
| `src/sync/types.ts` | 扩可持久化字段：`notionGatewayUrl`、`notionWorkspaceHint`；**类型层禁止** secret 字段；`NotionRuntimeSession` 独立类型 | §2.4–2.5 |
| `src/sync/outbox.ts` | `isCloudEnqueueEnabled()` 含 `'notion'`；`runSync` 仅 flush `ownerUserId === workspaceKey` | §0.3 · §4.8 |
| `src/sync/notionMap.ts`（建议新建） | IDB `sync_notion_map`：`(entity, appEntityId) → { pageId, workspaceKey, tombstone? }` | byo §1.2 |
| `src/db/index.ts` | 若需新 store：`sync_notion_map`（实现时再 bump 版本）；本规格不定死版本号 | — |
| `src/sync/engine.ts` | `resolveProvider('notion')`；`getMediaObjectStore()` → `null` 跳过媒体迁移 | §0.6 |
| `src/sync/merge.ts` / `conflictDetect.ts` / `conflictResolve.ts` | **不**为 Notion 分叉语义；消费同形 `CloudRow` / `PushResult` | §4.0 · M3-C |
| `src/components/DataStorageSettings.tsx` | 实验开关（P3）：Gateway URL、会话输入框、互斥 Supabase、媒体说明、旧 Outbox 面板 | mvp §0 P3 · §4.8 |
| `src/i18n/messages.ts` | 禁「完整图文云备份」；失败闭合 / 切换确认文案 | §5 |

### 2.2 Gateway / Worker 侧（用户自部署；仓库仅模板）

| 落点（模板内） | 职责 |
|----------------|------|
| `docs/templates/notion-sync-worker/README.md` | 部署步骤、Secret 清单、CORS Origin |
| `docs/templates/notion-sync-worker/CONTRACT.md` | 本规格 §3 的镜像（接口/错误码） |
| `docs/templates/notion-sync-worker/src/routes.pseudo.ts` | 路由伪代码（不可运行、无真实 secret） |
| `docs/templates/notion-sync-worker/src/lww.pseudo.ts` | Push 先读后写 / 删除双轨伪代码 |
| `docs/templates/notion-sync-worker/src/payload.pseudo.ts` | Payload ≤2000 失败闭合伪代码 |
| （实现后期可选）真实 `wrangler.toml.example` | **无**真实 secret；仍不进 PWA 构建 |

### 2.3 设置 UI 实验开关（产品要点）

1. Provider 选择：`supabase` \| `notion` **互斥**（architecture §6）。  
2. Notion 区块默认折叠在「实验 / 高级」；至 D2 真机通过前不与 Supabase 正式并列（P3）。  
3. 可持久化：URL、hint、`workspaceKey`；API Key **每次会话输入**，不进设置导出。  
4. 常驻说明：不同步照片；指向 Supabase / JSON 导出。  
5. 「未推送（旧工作区）」列表面板：返回推送 / 导出后丢弃 / 显式丢弃（§4.8）。

---

## 3. Gateway API 契约

### 3.1 传输与认证

```
PWA ──HTTPS + Authorization: Bearer <GATEWAY_API_KEY|JWT>──► User Worker
         Worker ──Authorization: Bearer <NOTION_TOKEN>──► api.notion.com
```

| 规则 | MVP |
|------|-----|
| 认证 | **必填** Bearer Gateway API Key（S1）；无 Key / 错 Key → **401** |
| JWT | D4 可选：`POST /auth/session` 换短命 JWT；本规格端点表保留但 D1 可不实现 |
| CORS | 仅用户配置的 PWA Origin |
| TLS | 必须 HTTPS（本地 wrangler dev 除外，且不得用于真 Token 演示进 Git） |
| Notion-Version | 钉 `2026-03-11` |
| 响应 | **永不**回显 `NOTION_TOKEN` / `GATEWAY_API_KEY` / 签名密钥 |

### 3.2 端点

| 方法 | 路径 | CloudProvider | 请求 | 成功响应（形状） |
|------|------|---------------|------|------------------|
| `GET` | `/health` | （探活） | Bearer | `{ ok: true, version?: string }` |
| `GET` | `/verify` | `verify()` | Bearer | `{ ok: true, workspaceKey: string, botName?: string, dataSources?: { vehicles: string, records: string } }` |
| `GET` | `/sync/pull` | `pullAll()` | Query: `entities=vehicles,records`；可选 `cursor` | `{ rows: CloudRow[], serverCursor?: string }`（含 tombstone） |
| `POST` | `/sync/push` | `pushOps()` | Body: `SyncOutboxItem[]`（或等价 `{ ops: ... }`） | `PushResult`：`{ applied: string[], conflicts: { id, entity, reason: 'cloud_newer'\|…, attemptedAt, cloudRow? }[], errors?: ... }` |
| `POST` | `/sync/snapshot` | `pushSnapshot()` | Body: `CloudRow[]` | 同 `PushResult`；分块调用内部 push |
| `POST` | `/auth/session` | D4 | Body: 证明持有 API Key | `{ token: string, expiresAt: number, workspaceKey }` |
| `POST` | `/auth/refresh` | D4 | Bearer JWT | 新 JWT |
| `POST` | `/auth/revoke` | D4 | Bearer JWT / jti | `{ ok: true }` |

`CloudRow` 对齐 architecture §3.4：`{ entity, id, payload, updatedAt, deletedAt?, deviceId? }`。

### 3.3 错误码（Gateway → PWA）

| HTTP | 码（建议 JSON `code`） | 含义 | PWA 行为 |
|------|------------------------|------|----------|
| 401 | `unauthorized` | 无/错 Bearer | 清内存会话；提示重输 Key |
| 403 | `forbidden` / `block_limit` | Origin 拒 / Notion 块配额等 | 可读错误；不 ACK 整批盲目重试 |
| 404 | `not_shared` | DB 未 Share 给 Integration | 向导指引分享 |
| 409 | `workspace_mismatch` | 请求绑定的 workspaceKey 与 Worker 不一致 | 停止 flush；防串租户 |
| 413 / 422 | `payload_too_large` | `PayloadJson` > 2000 | **失败闭合**；该 op 失败；禁截断写入 |
| 429 | `rate_limited` | 透传 Notion 或 Worker 自限 | 尊重 `Retry-After`；outbox 退避 |
| 503 | `notion_unavailable` | Notion 5xx / 写后不确定 | **先读后判**；不盲目 recreate |
| 501 | `not_implemented` | D4 路由未开 | 客户端忽略 JWT 路径 |
| 400 | `bad_request` | 体校验失败 | 不重试至用户修数据 |

单 op 失败不得导致静默丢弃同批其它已 `applied` 项的 ACK 语义错乱：与现有 Supabase 路径一样，按 `PushResult` 逐项结算。

### 3.4 限流

| 层 | 策略 |
|----|------|
| Worker→Notion | 遵守 ~180 req/min/connection；429/529 读 `Retry-After` |
| 写入 503 | 按 Notion `retry_guidance`：**先 query/retrieve 再决定**是否 create |
| PWA→Worker | 复用 `nextRetryDelayMs` + `MAX_OUTBOX_ATTEMPTS`；避免 snapshot burst |
| 同批 push | 同 `AppEntityId` **串行**（O5：跨 isolate DO 非 MVP） |

---

## 4. 参考 Worker 模板路径计划（O1）

```
docs/templates/notion-sync-worker/
├── README.md              # 用户部署说明（无真实 secret）
├── CONTRACT.md            # 契约摘要 → 链回本规格 §3
└── src/
    ├── routes.pseudo.ts   # 路由与鉴权伪代码
    ├── lww.pseudo.ts      # 双层 LWW 之 push 侧 + 删除双轨
    └── payload.pseudo.ts  # Payload 编码 / 失败闭合
```

**约束**：

- 可含 TypeScript **伪代码 / 接口注释**；**不要**添加会进入 `app` Vite/生产构建的可运行依赖。  
- 模板内仅占位符：`NOTION_TOKEN`、`GATEWAY_API_KEY`、`ALLOWED_ORIGIN`。  
- 不等同应用方托管运行时；用户自 `wrangler deploy`。

细则见目录内文件。

---

## 5. 数据属性映射 · 删除双轨 · Payload 失败闭合

### 5.1 PascalCase 属性（权威）

| Notion 属性 | 类型 | ← CloudRow / 业务 |
|-------------|------|-------------------|
| `Name` | title | 展示名 |
| `AppEntityId` | rich_text | `id` |
| `AppUpdatedAt` | rich_text ISO | `updatedAt` |
| `AppDeletedAt` | rich_text ISO / 空 | `deletedAt` |
| `DeviceId` | rich_text | `deviceId` |
| `PayloadJson` | rich_text | 瘦 `payload` |
| vehicles 额外 | `Plate` `EnergyType` `Archived` | 冗余标量 |
| records 额外 | `VehicleAppId` `RecordType` `RecordDate` `AmountPaid` | 冗余标量 |

Gateway 负责 Notion ↔ `CloudRow` 映射；PWA **不**直写 Notion 属性名到业务表。

### 5.2 删除双轨（O4）

实现清单：

1. `delete` op → 同一逻辑操作内：`in_trash: true` **且**写 `AppDeletedAt`。  
2. Pull：`deletedAt` = `AppDeletedAt` 优先，否则由 `in_trash` 推导。  
3. 恢复：`in_trash: false` + 清空 `AppDeletedAt` + bump `AppUpdatedAt`。  
4. Create 前 query **必须能命中 tombstone**；过期 upsert **禁止**新 create（architecture §4.7）。  
5. `sync_notion_map` 在 UI 硬删导致 Absent 时防止盲目 recreate。

### 5.3 Payload 失败闭合（O3）

1. 瘦化：剥冗余标量与一切二进制 / data-URL；可留 `mediaIds: string[]`。  
2. `JSON.stringify` UTF-16 长度 **≤ 2000**；否则该 op **失败** + 可读错误。  
3. **禁止**静默截断 / 自动 `PayloadJson_N`（拆分属 D4）。  
4. D1 建议写后读 deep-equal；失败不 ACK。  
5. 解码失败：skip + 计数；不覆盖本地权威行。

---

## 6. 双层 LWW 与 M3-C 冲突 UI 接入点

```
                    ┌──────────────────────────────────────┐
  pull 云→本地      │  merge.ts + conflictDetect (E2/E3)   │  ← 客户端权威
                    │  → open SyncConflictRecord → M3-C UI │
                    └──────────────────────────────────────┘
  push 本地→云      ┌──────────────────────────────────────┐
                    │  Gateway：读 AppUpdatedAt → 比较 → 写 │  ← Gateway 权威
                    │  → PushResult.conflicts reason=        │
                    │    cloud_newer → conflictDetect (E1)  │
                    └──────────────────────────────────────┘
```

| 接入点 | 实现要求 |
|--------|----------|
| `NotionProvider.pushOps` | 必须把 Gateway 的 skip/conflict **原样**映成与 Supabase 同形的 `PushResult` |
| `conflictDetect` | 无 Notion 专用分支；E1 吃 `cloud_newer` |
| `conflictResolve` | keep_local / take_cloud 仍走 `withSyncLock`；禁止绕过 LWW 强写 |
| 回声抑制 | `DeviceId` / 既有 echo 逻辑；自推不误 open |
| 产品 | P2：可降级文案，但**不得**静默丢意图 |

---

## 7. Outbox owner 隔离与切换保留策略

### 7.1 实现要点

| # | 要点 |
|---|------|
| 1 | `ownerUserId` = verify 返回的 `workspaceKey`（或稳定代理 subject） |
| 2 | enqueue 时写入当前 owner；`OUTBOX_UNBOUND` 仅用于未绑定态（沿用 M2） |
| 3 | `runSync` / `pushOps`：**只**选择 `ownerUserId === 当前 workspaceKey` |
| 4 | 断开 / 切换：**默认不**调用 `clearOutboxForUser` |
| 5 | 切换 provider 或 Gateway URL：旧队列保留；设置页展示「未推送（旧工作区）」 |
| 6 | 显式丢弃：独立二次确认；可测（SW3） |
| 7 | 切回旧区 + 重输 Key 后 flush 旧队列（SW4）；LWW 仍适用 |

### 7.2 禁止

- 把旧 owner 的 op 推到新 workspace（串租户 / 污染）  
- 以「切换即清空」作为唯一 UX  
- 导出 JSON 时带上 Bearer / 任何密钥字段  

---

## 8. 分阶段实现顺序（D1 Staging 前工程切片）

> 阶段定义见 risks §2。以下为 **工程切片**，仍 docs 授权范围内的「如何切 PR」，不是本 PR 写代码。

| 切片 | 内容 | 出口门禁（映射验收） | 禁区 |
|------|------|----------------------|------|
| **S0** | 本实现规格 + 模板伪代码入库（本 PR） | D0.* 维持；规格可审 | 无 src |
| **S1** | Worker 模板可本地 mock（用户机 / 独立目录）；`/verify` `/push` `/pull` 契约测试 | D1.1–D1.9（可用 Notion 测试 workspace，**非**正式 Supabase） | 不改 PWA 生产路径 |
| **S2** | PWA：`NotionGatewayClient` + 填实 `NotionProvider`；扩展 enqueue；实验 UI | D2.1–D2.8 | 无媒体上云；互斥 |
| **S3** | `sync_notion_map` + 删除双轨夹具 + 切换走廊 UI | D1.6–7 · DEL* · SW1–4 · D3.5 | 默认不清 Outbox |
| **S4** | M3-C 真机：E1/E2、keep/take、回声、双非空确认 | D3.1–D3.6 | 无第二套冲突模型 |
| **S5** | D4 可选项：JWT、DO、Payload 拆分、模板 README 30min | D4.* | 仍不承诺强一致 |

**建议 PR 纪律**：每一切片独立 PR；先 Staging 再考虑生产；**禁止** merge 后自动部署；正式 Supabase 只读回归。

---

## 9. 测试计划 ↔ 验收用例映射

| 测试套件（实现时） | 主要用例 ID | 断言摘要 |
|--------------------|-------------|----------|
| Gateway 契约单测 / 契约测试 | D1.1 D1.9 | 无 Token 回显；无 Key→401 |
| LWW push 夹具 | D1.3 D1.4 | 同 id 不双页；云新→`cloud_newer` 不写 |
| 删除 / tombstone | D1.6 D1.7 DEL1–3 | 双轨；拒复活；pull 可见删 |
| Payload | D1.8 D4.1 | >2000 失败；无截断残片 |
| 限流 | D1.5 | Retry-After 后成功或可诊断失败 |
| PWA adapter | D2.1–D2.3 D2.8 | enqueue；离线重试；冷启动重输 Key |
| 安全扫描 | D2.4 | bundle / IDB 设置 / export **零** secret |
| 回归 | D2.5 D2.7 | Supabase 路径绿；互斥 |
| 文案 / 媒体 | D2.6 | media 不出箱；无违禁文案 |
| 冲突 | D3.1–D3.4 | E1/E2；resolve 持锁；回声 |
| 切换 | SW1–SW4 D3.5 | 保留；不误推；显式丢弃；切回 flush |
| 首次同步 | D3.6 | 双非空无静默覆盖 |

自动化优先：Gateway 纯函数（LWW 比较、payload 长度、tombstone 状态机）→ Provider mock Gateway → 少量 Staging 真机。

---

## 10. 安全检查清单（实现 / CI）

| # | 检查 | 时机 |
|---|------|------|
| C1 | rg / CI：禁止 `secret_`、`ntn_`、OAuth refresh、`GATEWAY_API_KEY` 实值进 Git | 每 PR |
| C2 | TypeScript：`CloudStorageConfig` **无** token/key 字段；ESLint 禁 `notionToken` 等标识 | S2 |
| C3 | 导出过滤：`car-care-export` 剥离会话与密钥 | S2 |
| C4 | 运行时 API Key 仅内存（可选 sessionStorage）；**禁** localStorage / IDB 设置 | S2 · D2.8 |
| C5 | Worker 日志脱敏；响应无 Token | D1.1 |
| C6 | CORS Origin 锁定；禁止无认证成功 | D1.9 |
| C7 | 模板 README 轮换/撤销步骤；旧 Key 立即失效 | D4.3 |
| C8 | 生产 PWA 构建依赖图：无 `@notionhq/client` | S2 门禁 |
| C9 | 不引入应用方集中 Token 库 / 共享 OAuth client | 架构评审门禁 |
| C10 | 文案扫描：禁「完整图文云备份」等 | D2.6 |

---

## 11. 文档与 PR 纪律（本里程碑）

| 允许 | 禁止 |
|------|------|
| 更新 `docs/m3d-*.md`、`docs/templates/**`、roadmap 一行 | 改 `src/**` 业务逻辑 |
| 推送 `docs/m3d-notion-design` 更新 PR #8 | merge PR #8；生产 / Staging 部署 |
| 起草本规格与伪代码 | 接真 Notion API；碰正式 Supabase |

**成功标准（本 docs 轮）**：实现规格可独立指导 S1 开工；与冻结设计无矛盾；PR diff 仍仅 docs（+ templates 伪代码）。
