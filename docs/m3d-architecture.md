# M3-D 架构：Notion BYO 同步（单一推荐方案）

> **状态**：设计中（2026-10-13）· docs-only  
> 规格：[`m3d-mvp-spec.md`](./m3d-mvp-spec.md) · 风险/验收：[`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md)  
> 原则对齐：[`own-cloud-sync-architecture.md`](./own-cloud-sync-architecture.md) · 可行性 stub：[`notion-sync-feasibility.md`](./notion-sync-feasibility.md)

---

## 0. 代码盘点（已用 rg/Read 核实，勿当臆造）

生产基线含 M3-C：`9b64a2bd204acfb5791f3f6668110e4c00ab3c95`（PR #7）。下列路径相对仓库 `app/`。

### 0.1 Notion 预留（stub）

| 路径 | 现状 | M3-D 含义 |
|------|------|-----------|
| `src/sync/providers/notion.ts` | `NotionProvider` 实现 `CloudProvider`；`verify` 返回未开放；`pullAll`/`pushOps`/`pushSnapshot` 抛 `NotionNotImplementedError`；**无网络、无密钥** | **实现时填真逻辑**；接口形状可复用 |
| `src/sync/types.ts` | `CloudProviderId` 含 `'notion'`；`CloudStorageConfig.notionWorkspaceHint?` 注释「Phase D」 | 扩展配置字段（代理 URL、会话提示等），**禁止**加 token 字段到前端 config |
| `src/sync/engine.ts` `resolveProvider()` | `cfg.provider === 'notion'` → `new NotionProvider()` | 保持解析入口；构造参数改为代理 endpoint + 短命会话 |
| `src/components/DataStorageSettings.tsx` | 可选 Notion，展示 stub 文案 + 文档链 | UI 升级为代理配置向导（实现阶段） |
| `src/i18n/messages.ts` | `storage.providerNotion` / `notionStub` | 文案随实现更新 |

### 0.2 CloudProvider 契约（可复用）

`src/sync/providers/types.ts`：

```ts
interface CloudProvider {
  id: 'supabase' | 'notion' | 'memory';
  verify(): Promise<VerifyResult>;
  pullAll(): Promise<CloudSnapshot>;
  pushOps(ops: SyncOutboxItem[]): Promise<PushResult>;
  pushSnapshot(rows: CloudRow[]): Promise<PushResult>;
  signOut?(): Promise<void>;
  getMediaObjectStore?(): MediaObjectStore | null;  // Notion MVP: 返回 null
  getAuthUserId?(): Promise<string | null>;
}
```

`PushResult.conflicts` 已支持 `reason: 'cloud_newer'` + `attemptedAt`（Supabase / Memory 已用）。**Notion adapter 必须产出同一形状**，以便 engine + M3-C 无需分叉检测语义。

参考实现：

- `src/sync/providers/supabase.ts` — 真路径：`car_care_upsert_lww` RPC、分页 `pullAll`、Media Storage  
- `src/sync/providers/memory.ts` — 内存 LWW，单测假后端  

### 0.3 Outbox / 元数据（大部分可复用，一处必须改）

| 路径 | 可复用 | 必须分叉 / 注意 |
|------|--------|-----------------|
| `src/sync/outbox.ts` | `makeOutboxItem`、`nextRetryDelayMs`、`ownerUserId` / `OUTBOX_UNBOUND`、`blockedByConflictId`、`ackOutboxCoveredByUpload`、`clearOutboxForUser` | **`isCloudEnqueueEnabled()` 今日仅 `provider === 'supabase'`**（约 L28–32）。Notion 真同步前必须扩展，否则业务写不会入队 |
| `src/sync/types.ts` `SyncOutboxItem` | 实体/op/重试字段齐全 | — |
| `src/db/index.ts` | `sync_outbox` + `sync_meta` + `sync_conflicts`（IDB v4） | 不因 Notion 改 schema 版本亦可起步；若存代理会话指纹可放 `sync_meta` 或设置 store |

### 0.4 LWW 与 Supabase RPC 依赖（必须分叉）

| 路径 | 说明 |
|------|------|
| `docs/sql/supabase-car-care-rows.sql` `car_care_upsert_lww` | DB 侧 `FOR UPDATE` + 比较 `updated_at`，返回 `applied` \| `skipped_cloud_newer`；**消除客户端 TOCTOU** |
| `SupabaseProvider.pushOps` | 逐 op 调该 RPC |
| `src/sync/merge.ts` `shouldApplyCloudRow` | 客户端 pull 合并：pending outbox 跳过、LWW by `updatedAt`、改胜于删 |

**Notion 无同等事务/RPC**：不能复用 SQL；须在 **用户代理内**实现「读当前页 AppUpdatedAt → 比较 → 写」的**尽力 LWW**，并文档化竞态窗口。Engine 侧仍消费同一 `PushResult`。

### 0.5 M3-C 冲突机制（可复用）

| 路径 | 角色 |
|------|------|
| `src/sync/conflictTypes.ts` | `MANUAL_CONFLICT_ENTITIES = vehicles\|records`；`SyncConflictRecord` open/resolved |
| `src/sync/conflictDetect.ts` | E1 push 被拒、E2/E3 pull 分叉、回声抑制 |
| `src/sync/conflictStore.ts` | IDB `sync_conflicts` |
| `src/sync/conflictResolve.ts` | keep_local / take_cloud；持 `withSyncLock`；禁止绕过 LWW 强写云 |
| `docs/m3c-conflict-ui-architecture.md` / `m3c-mvp-frozen-spec.md` | 产品冻结口径 |

Notion MVP 实体集合与 M3-C 手动实体**对齐**，可直接复用 UI 与 escalate；**不要**为 Notion 另造冲突模型。

### 0.6 引擎与其它

| 路径 | 注意 |
|------|------|
| `src/sync/engine.ts` | `runSync` / restore / 首次上传走 `CloudProvider`；媒体迁移依赖 `getMediaObjectStore` — Notion 返回 null 时跳过 Storage 迁移分支 |
| `src/sync/tabLock.ts` / M3-B | 多标签锁对 Notion flush **同样适用** |
| `src/sync/mediaStorage.ts` | Supabase 私有 bucket；Notion MVP 不实现对等对象存储 |

### 0.7 盘点结论表

| 能力 | 复用 | 分叉 |
|------|------|------|
| `CloudProvider` 接口 + engine 编排 | ✅ | Notion 实现类 |
| Outbox 队列 / 重试 / owner 隔离 | ✅ | `isCloudEnqueueEnabled` 扩 notion |
| Merge + M3-C 冲突 UI | ✅ | 无（若 `PushResult` 对齐） |
| 原子 LWW RPC | ❌ | Worker 内比较写 + 可选乐观锁字段 |
| RLS / Auth（Supabase） | ❌ | 代理会话 + Notion 页分享权限 |
| MediaObjectStore | ❌ MVP | 外链或不同步媒体 |
| 集中多租户 Token 库 | ❌ 否决 | 用户自有代理 |

---

## 1. 单一推荐方案（一句话）

**每个需要 Notion 的用户自部署一台 Cloudflare Worker（或同等边缘代理），Worker Secret/KV 持有该用户的 Notion Internal Integration Token（或 OAuth access/refresh）；PWA 只配置「代理 Base URL + 用户自签发的短命会话」并调用现有 `CloudProvider` 形状；车辆/养护映射为用户 workspace 内两个 Data Source 的 Page 行，应用侧 LWW 用属性 `AppUpdatedAt`，媒体 MVP 不同步二进制。**

### 1.1 为何选它

| 目标 | 本方案 |
|------|--------|
| Token 永不进前端/Git | ✅ 只在用户 Worker |
| 应用方不集中托管全体用户车数据与 Token | ✅ 每用户自有代理与 Notion |
| 低成本易部署 | ✅ CF Worker 免费档通常够个人同步；无额外 Postgres |
| 复用现有 sync 栈 | ✅ 实现 `NotionProvider` → HTTP 调自有代理 |
| 不破坏 Supabase | ✅ 独立 provider；混合策略见 §6 |

### 1.2 否决与取舍

| 方案 | 结论 | 理由 |
|------|------|------|
| A. 个人 Internal/PAT Token 明文进 PWA | **否决** | 长效密钥进 bundle/IDB；与可行性文档一致 |
| B. 应用方多租户代管所有用户 Notion Token | **否决** | 违反「用户拥有 / 不建集中托管」；密钥与合规成本高 |
| C. 仅 Contabo 主机上 per-user env、无 Worker | **备选** | 可行但运维重于 CF；若用户已有 Contabo 可等同「自有代理」 |
| D. OAuth Public Integration + Token 存**应用方** DB | **否决作默认** | 应用方仍集中持有 refresh |
| E. OAuth Public + Token 存**用户自有** Worker KV | **可采纳变体** | 适合「一键授权」；仍须用户侧有换票终点；实现复杂度高于 Internal+Secret |
| F. 直接浏览器调 `api.notion.com` | **否决** | CORS/密钥暴露；Notion 不面向纯前端持有 secret |

**推荐默认落地路径**：Internal Integration + 用户把 Token 粘贴到**自己的** Worker Secret（一次配置）→ PWA 填 Worker URL。  
**增强路径（同一架构）**：Public OAuth，但 `client_secret` 与 refresh **只在用户 Worker**；应用官网只提供可 fork 的 Worker 模板与 `client_id`（若用共享 public app，须另开评审，见开放问题）。

---

## 2. 认证与代理

### 2.1 Notion 侧（官方，2026）

文档：

- Authorization：https://developers.notion.com/guides/get-started/authorization  
- Create token：https://developers.notion.com/reference/create-a-token  
- 最新 `Notion-Version`：`2026-03-11`（https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11）

类型：

| 类型 | 用途 | MVP 推荐 |
|------|------|----------|
| Internal connection token | 单 workspace；页需手动分享给 connection | **默认** |
| Personal Access Token (PAT) | 用户态脚本；管理员可管控 | 允许等价于 Internal，仍**只进 Worker** |
| Public OAuth | `authorize` → `code` → `POST /v1/oauth/token`；有 `refresh_token` | 增强变体 |

### 2.2 代理 API 草图（用户 Worker）

```
PWA ──Bearer <session>──► User Worker ──Bearer <notion_token>──► api.notion.com
```

建议最小路由（实现阶段）：

| Worker 路由 | 对应 CloudProvider |
|-------------|-------------------|
| `GET /health` + `GET /verify` | `verify()` — 调 Notion `users/me` 或探测 Data Source |
| `GET /sync/pull` | `pullAll()` — 分页 query 两 Data Source，映射 `CloudRow[]` |
| `POST /sync/push` | `pushOps` — 逐 op LWW upsert/trash |
| `POST /sync/snapshot` | `pushSnapshot` — 分块调用 push |
| `POST /auth/session`（可选） | 用用户配置的 `PROXY_SHARED_SECRET` 换短命 JWT |

安全要求：

- Notion Token **仅** `NOTION_TOKEN` env；永不写入响应体或日志明文  
- PWA↔Worker：TLS + 共享密钥派生的短命 JWT（或 CF Access）；禁止「无认证开放代理」  
- CORS 仅允许用户 PWA Origin（可配置）

### 2.3 前端配置（允许）

`CloudStorageConfig` 扩展方向（设计）：

- `notionProxyUrl`（https）  
- `notionSessionHint` / 不持久化 secret（会话放 memory 或 WebCrypto 包装的非导出密钥，实现评审）  
- **禁止** `notionToken` / `notionOauthRefresh` 字段进入前端类型与设置导出

---

## 3. 数据模型

### 3.1 Notion 对象模型（2025-09-03 以降）

- **Database** = 容器；含一个或多个 **Data Source**  
- **Data Source** = schema（properties）+ 行的父级  
- **Page** = 一行；`parent.data_source_id`  
- 查询：`POST /v1/data_sources/{id}/query`（分页 `start_cursor` / `page_size`≤100）  
- 文档：https://developers.notion.com/guides/data-apis/working-with-databases · https://developers.notion.com/reference/query-a-data-source · https://developers.notion.com/reference/retrieve-a-data-source

### 3.2 推荐库表布局

用户 workspace 内（模板或向导创建）：

1. 父 Page「车护同步」  
2. Database「车辆」→ Data Source `vehicles`  
3. Database「养护记录」→ Data Source `records`

### 3.3 属性映射（MVP）

**公共列（两表）：**

| Notion 属性 | 类型 | 含义 |
|-------------|------|------|
| `Name` | title | 展示名（车名 / 记录摘要） |
| `AppEntityId` | rich_text 或 title 旁 unique 用 rich_text + 查询 filter | 本地 UUID；幂等键 |
| `AppUpdatedAt` | rich_text（ISO）或 date | **应用 LWW 戳**（优先于粗粒度 `last_edited_time`） |
| `AppDeletedAt` | rich_text / date | 软删戳；与 trash 策略配合 |
| `DeviceId` | rich_text | 可选 |
| `PayloadJson` | rich_text（≤2000 字/段；超长则多块或外部） | 完整实体 JSON；**注意 2000 char/段限制** |

**vehicles 额外（便于 Notion UI）：** `Plate`、`EnergyType`、`Archived` 等可冗余标量；权威仍在 `PayloadJson`。

**records 额外：** `VehicleAppId`（relation 或 rich_text）、`RecordType`、`RecordDate`、`AmountPaid`。

联合类型 `CareRecord`：不在 Notion 拆多表；用 `RecordType` + 完整 JSON。

**超长 JSON**：单 rich_text 2000 字符上限（官方 Request limits）。对策（按序）：

1. MVP 接受「瘦 payload」+ 必要标量列；或  
2. Payload 拆多个 `PayloadJson_N`；或  
3. 仅存 Notion 外（用户 R2）链接 — 增加依赖，非默认。

### 3.4 与 `CloudRow` 对齐

```ts
CloudRow { entity, id, payload, updatedAt, deletedAt?, deviceId? }
```

映射：`id` ← `AppEntityId`；`updatedAt` ← `AppUpdatedAt`；`deletedAt` ← `AppDeletedAt` 或页 `in_trash`。

---

## 4. 同步协议

### 4.1 仍复用本地协议

见 `own-cloud-sync-architecture.md` §5：`sync_meta` + `sync_outbox`；业务写后入队；`runSync` push→pull。

### 4.2 Push（Worker LWW）

对每个 op：

1. 按 `AppEntityId` query Data Source（filter equals）；`page_size=1`  
2. 无行 → create page（`parent.data_source_id`）  
3. 有行 → 读 `AppUpdatedAt`：若云端 > `op.mutatedAt` → 返回 `skipped_cloud_newer`（**不写**）  
4. 否则 PATCH properties；`delete` op → `in_trash: true`（`Notion-Version: 2026-03-11`，**勿用已移除的 `archived` 请求字段**）  
   - 文档：https://developers.notion.com/reference/trash-page  

**竞态**：两设备近同时 push 无 DB 锁时可能双写覆盖。缓解：Worker 对同 `AppEntityId` 串行化（Durable Object / 单飞锁）；仍弱于 Postgres `FOR UPDATE`。接受为 Notion 路径已知差距，冲突靠 M3-C + 时间戳。

**幂等**：create 前必须 query；禁止无查直 insert。

### 4.3 Pull

- 分页 query 两 Data Source（含 `is_archived` 策略：默认非归档页；trash 行为见风险文档）  
- 映射为 `CloudSnapshot` → 现有 `merge` / M3-C detect  
- `serverCursor`：可用 max(`AppUpdatedAt`)；Notion 无等价 WAL cursor

### 4.4 首次同步

1. `verify` 探测 Data Source ID（存 Worker KV 或返回给客户端 meta）  
2. 若云空 → `pushSnapshot` 仅 vehicles+records  
3. 若云非空且本地非空 → **禁止静默覆盖**；UI 选「以本地为准上传 / 以云为准拉取 / 取消」（实现阶段；对齐 Supabase 首次上云谨慎原则）

### 4.5 重试与限流

- 客户端：现有 `nextRetryDelayMs` + `MAX_OUTBOX_ATTEMPTS`  
- Worker→Notion：429/529 读 `Retry-After`；文档 https://developers.notion.com/reference/request-limits  
  - 普通计划约 **180 req/min/connection**；Business/Enterprise 600  
  - 写入 503 可能已提交：按 `retry_guidance` **先读后判**，避免双建页  
- 队列化出站，避免 burst 打满预算

### 4.6 账号切换 / 断开

- 复用 `ownerUserId`：Notion 的「用户」键用 Worker 返回的 `bot_id`/`workspace_id` 哈希或代理签发的 `proxyUserId`  
- 断开：`signOut` 清本地会话；`clearOutboxForUser`；**不**自动清空 Notion 页  
- 切换 workspace：视为新云用户；禁止旧 outbox 推新库

---

## 5. 图片 / 媒体

| 选项 | 结论 |
|------|------|
| Notion File Upload 作主媒体库 | **不推荐作 MVP 主路径**：附件下载 URL **1 小时过期**须反复 retrieve；Free 单文件 5 MiB；上传后须 1 小时内 attach（https://developers.notion.com/guides/data-apis/working-with-files-and-media） |
| Payload 内嵌 base64 | **否决**：块配额 + 2000 字限制 + rate |
| **MVP：不同步 media 实体**；记录上 `mediaIds` 可保留 ID，二进制仍仅本地 IDB | **推荐** |
| 后续：Notion 属性存**用户自有** HTTPS 外链（R2/Supabase Storage） | 可选 Phase D.1 |
| 有 Supabase 时媒体继续走 M3-A | 见混合策略 |

---

## 6. 与 Supabase 混合使用策略

| 策略 | 说明 | MVP |
|------|------|-----|
| **互斥** | `CloudProviderId` 同时只能启用一个；切换需确认清空/保留 outbox | **推荐默认** |
| 双写 | 同一 outbox 扇出两个 provider | 否决（冲突与幂等爆炸） |
| Supabase 主 + Notion 只读导出 | 定时 dump | 非 MVP |

设置页文案明确：Notion 与自有 Supabase 二选一；切换向导警告未推送队列。

---

## 7. 费用与维护

| 项 | 预估 |
|----|------|
| Cloudflare Worker | 个人量级通常免费档；注意 CPU/请求配额 |
| Notion Free | 单人 Free workspace 块通常充足；**多人 Free** 有 **1000 lifetime blocks** API 强制（约 2026-09 起）：https://developers.notion.com/reference/workspace-block-limits — 每养护行≈1 page block，超量 403 `restricted_resource` |
| 应用方 | 只维护开源 Worker 模板 + 文档；不代付用户 Notion |
| 维护 | Notion-Version 升级（`2026-03-11` 已改 `in_trash`）；Data Source API 与旧 `databases.query` 迁移 |

---

## 8. 实现阶段文件预期（本 PR 不创建）

- 填实 `src/sync/providers/notion.ts`（仅调用户代理，不直连带 token）  
- 扩展 `isCloudEnqueueEnabled`  
- 可选 `docs/templates/notion-sync-worker/`（示例，无真实 secret）  
- **禁止**把 Notion SDK 打进生产 PWA 关键路径（若示例需要，限于 templates/scripts）

---

## 9. 开放问题（交独立架构评审）

见成功回报；摘要：共享 Public OAuth client 是否可接受、Payload 超长策略终选、trash vs `AppDeletedAt` 双轨、Worker 参考实现宿主是否官方维护。
