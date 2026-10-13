# M3-D 架构：Notion BYO 同步（单一推荐方案）

> **状态**：设计通过 · 实现规格已起草（2026-10-13）· docs-only · **第二轮裁定 + 第三轮闭合已合入**  
> 规格：[`m3d-mvp-spec.md`](./m3d-mvp-spec.md) · 风险/验收：[`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md)  
> **实现规格**：[`m3d-implementation-spec.md`](./m3d-implementation-spec.md) · Worker 模板：[`templates/notion-sync-worker/`](./templates/notion-sync-worker/)  
> **架构师独立稿（交叉阅读）**：[`m3d-notion-byo-architecture.md`](./m3d-notion-byo-architecture.md)  
> 审查纪要：[`m3d-architecture-review-round2.md`](./m3d-architecture-review-round2.md)  
> 原则对齐：[`own-cloud-sync-architecture.md`](./own-cloud-sync-architecture.md) · 可行性 stub：[`notion-sync-feasibility.md`](./notion-sync-feasibility.md)
>
> **文档优先级（权威冻结）**：BYO Cloudflare Worker Gateway · **双层 LWW**（客户端 pull `merge.ts` + Gateway push 尽力先读后写）· **媒体不同步** · 与 Supabase **互斥** · 属性名 PascalCase（`AppEntityId` 等）· MVP 会话 = Gateway API Key Bearer（密钥不进 IDB/JSON 备份）· 删除双轨 · Payload 失败闭合 · 切换默认保留 Outbox。细则见 [`m3d-mvp-spec.md` §0 / §0.1](./m3d-mvp-spec.md)。

---

## 0. 代码盘点（已用 rg/Read 核实，勿当臆造）

生产基线含 M3-C：`9b64a2bd204acfb5791f3f6668110e4c00ab3c95`（PR #7）。下列路径相对仓库 `app/`。

### 0.1 Notion 预留（stub）

| 路径 | 现状 | M3-D 含义 |
|------|------|-----------|
| `src/sync/providers/notion.ts` | `NotionProvider` 实现 `CloudProvider`；`verify` 返回未开放；`pullAll`/`pushOps`/`pushSnapshot` 抛 `NotionNotImplementedError`；**无网络、无密钥** | **实现时填真逻辑**；接口形状可复用 |
| `src/sync/types.ts` | `CloudProviderId` 含 `'notion'`；`CloudStorageConfig.notionWorkspaceHint?` 注释「Phase D」 | 扩展配置字段（代理 URL、workspace 提示等），**禁止**加 Notion token / Gateway 长期密钥字段到**可导出**前端 config |
| `src/sync/engine.ts` `resolveProvider()` | `cfg.provider === 'notion'` → `new NotionProvider()` | 保持解析入口；构造参数改为代理 endpoint + 运行时会话 |
| `src/components/DataStorageSettings.tsx` | 可选 Notion，展示 stub 文案 + 文档链 | UI 升级为代理配置向导（实现阶段） |
| `src/i18n/messages.ts` | `storage.providerNotion` / `notionStub` | 文案须体现「不同步图片 / 非完整图文云备份」 |

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
| `src/sync/outbox.ts` | `makeOutboxItem`、`nextRetryDelayMs`、`ownerUserId` / `OUTBOX_UNBOUND`、`blockedByConflictId`、`ackOutboxCoveredByUpload`、`clearOutboxForUser` | **`isCloudEnqueueEnabled()` 今日仅 `provider === 'supabase'`**（约 L28–32）。Notion 真同步前必须扩展。**切换/断开默认不得调用 `clearOutboxForUser`**（见 §4.8） |
| `src/sync/types.ts` `SyncOutboxItem` | 实体/op/重试字段齐全 | — |
| `src/db/index.ts` | `sync_outbox` + `sync_meta` + `sync_conflicts`（IDB v4） | 不因 Notion 改 schema 版本亦可起步；`workspaceKey` 可放 `sync_meta` |

### 0.4 LWW 与 Supabase RPC 依赖（必须分叉）

| 路径 | 说明 |
|------|------|
| `docs/sql/supabase-car-care-rows.sql` `car_care_upsert_lww` | DB 侧 `FOR UPDATE` + 比较 `updated_at`，返回 `applied` \| `skipped_cloud_newer`；**消除客户端 TOCTOU** |
| `SupabaseProvider.pushOps` | 逐 op 调该 RPC |
| `src/sync/merge.ts` `shouldApplyCloudRow` | 客户端 pull 合并：pending outbox 跳过、LWW by `updatedAt`、改胜于删 |

**Notion 无同等事务/RPC**：不能复用 SQL；须在 **用户代理内**实现「读当前页 `AppUpdatedAt` → 比较 → 写」的**尽力 LWW**，并文档化竞态窗口（§4.0 / §4.2）。Engine 侧仍消费同一 `PushResult`。

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
| Outbox 队列 / 重试 / owner 隔离 | ✅ | `isCloudEnqueueEnabled` 扩 notion；切换默认保留队列 |
| Merge + M3-C 冲突 UI | ✅ | 无（若 `PushResult` 对齐） |
| 原子 LWW RPC | ❌ | Worker 内比较写 + 可选 DO（非 MVP 必做） |
| RLS / Auth（Supabase） | ❌ | Gateway API Key 会话 + Notion 页分享权限 |
| MediaObjectStore | ❌ MVP | 不同步媒体二进制 |
| 集中多租户 Token 库 | ❌ 否决 | 用户自有代理 |

---

## 1. 单一推荐方案（一句话）

**每个需要 Notion 的用户自部署一台 Cloudflare Worker（或同等边缘代理），Worker Secret/KV 持有该用户的 Notion Internal Integration Token；PWA 只持久化「代理 Base URL + workspace 提示」并在运行时持有用户自设的 Gateway API Key（Bearer）；车辆/养护映射为用户 workspace 内两个 Data Source 的 Page 行，双层 LWW 用属性 `AppUpdatedAt`，媒体 MVP 不同步二进制。**

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
| E. OAuth Public + Token 存**用户自有** Worker KV | **可采纳变体（非 MVP）** | 适合「一键授权」；MVP 不做共享 Public OAuth（O2） |
| F. 直接浏览器调 `api.notion.com` | **否决** | CORS/密钥暴露；Notion 不面向纯前端持有 secret |
| G. 把 `GATEWAY_API_KEY` 换名写入 IDB / JSON 备份 | **否决** | 长期共享密钥不得进浏览器持久化或导出文件（§2.4） |

**推荐默认落地路径**：Internal Integration + 用户把 Token 粘贴到**自己的** Worker Secret（一次配置）→ PWA 填 Worker URL → 每次会话输入 Gateway API Key。  
**增强路径（D4）**：`POST /auth/session` 用 API Key 换短命 JWT，减少冷启动重输。

---

## 2. 认证与代理（会话状态机 · 凭据存储）

### 2.1 Notion 侧（官方，2026）

文档：

- Authorization：https://developers.notion.com/guides/get-started/authorization  
- Create token：https://developers.notion.com/reference/create-a-token  
- 最新 `Notion-Version`：`2026-03-11`（https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11）

| 类型 | 用途 | MVP 推荐 |
|------|------|----------|
| Internal connection token | 单 workspace；页需手动分享给 connection | **默认**（只进 Worker Secret） |
| Personal Access Token (PAT) | 用户态脚本；管理员可管控 | 允许等价于 Internal，仍**只进 Worker** |
| Public OAuth | `authorize` → `code` → `POST /v1/oauth/token`；有 `refresh_token` | **MVP 不做**（O2）；若未来做，refresh **只存用户自有 Worker** |

### 2.2 代理 API 草图（用户 Worker）

```
PWA ──Bearer <GatewayApiKey|短命JWT>──► User Worker ──Bearer <NOTION_TOKEN>──► api.notion.com
```

| Worker 路由 | 对应 CloudProvider | 备注 |
|-------------|-------------------|------|
| `GET /health` + `GET /verify` | `verify()` | 校验 Bearer；调 Notion `users/me` 或探测 Data Source；返回 `workspaceKey` |
| `GET /sync/pull` | `pullAll()` | 分页 query 两 Data Source（含 tombstone 策略 §4.7） |
| `POST /sync/push` | `pushOps` | 逐 op 尽力 LWW upsert/trash |
| `POST /sync/snapshot` | `pushSnapshot` | 分块调用 push |
| `POST /auth/session` | （D4 可选） | 校验 `GATEWAY_API_KEY` → 签发短命 JWT |
| `POST /auth/refresh` | （D4 可选） | 未过期 refresh 窗口内换新 JWT；**不**接受「仅持旧 JWT 无限续」而不绑定密钥轮换 |
| `POST /auth/revoke` | （D4 可选） | 吊销当前 jti / 设备会话（KV denylist） |

安全要求：

- Notion Token **仅** `NOTION_TOKEN` env；永不写入响应体或日志明文  
- PWA↔Worker：TLS + **MVP：Bearer Gateway API Key**；禁止「无认证开放代理」  
- CORS 仅允许用户配置的 PWA Origin  
- D4：JWT 由 Worker 用独立 `SESSION_SIGNING_SECRET` 签发；TTL 建议 ≤ 1h；签名密钥永不下发客户端

### 2.3 会话状态机（可执行）

```
                    ┌─────────────────────────────────────────┐
                    │              Unauthenticated            │
                    └───────────────┬─────────────────────────┘
                         用户输入 API Key + gatewayUrl
                                    │
                                    ▼
                         POST /verify（或 /auth/session）
                    ┌───────────────┴───────────────┐
                    │ 失败：保持未认证；可重试      │
                    │ 成功：→ Authenticated         │
                    └───────────────┬───────────────┘
                                    ▼
              ┌──────────── Authenticated ────────────┐
              │ MVP：内存持有 API Key，请求带 Bearer  │
              │ D4：内存持有 short JWT；到期 → Renew  │
              └─────┬─────────────┬─────────────┬─────┘
                    │             │             │
          续期成功(D4)      用户断开/登出    密钥轮换或 revoke
                    │             │             │
                    ▼             ▼             ▼
              Authenticated   Unauthenticated  Unauthenticated
              （新 JWT）      （清内存会话）   （全部设备失效）
```

| 事件 | 行为 | 持久化影响 |
|------|------|------------|
| **初始认证** | 用户填 `gatewayUrl` + 输入 `GATEWAY_API_KEY` → `verify` | 仅允许持久化 URL / hint / `workspaceKey` |
| **短期会话签发（D4）** | `POST /auth/session` → JWT（含 `workspaceKey`、`exp`、`jti`） | JWT **不**写入 JSON 备份；实现可选 `sessionStorage`（关页即失） |
| **续期（D4）** | `exp` 前 `POST /auth/refresh`；失败则回退要求重输 API Key | 同左 |
| **跨设备登录** | 每设备各自输入同一 `GATEWAY_API_KEY`；**无**共享服务端设备会话表（MVP） | 各设备独立内存会话 |
| **撤销** | 用户在 Worker 轮换 `GATEWAY_API_KEY` Secret → 旧 Key 立即失效；D4 另可 `revoke` jti | 客户端下次请求 401 → 清内存会话并提示重输 |
| **断开** | `signOut`：清内存会话；**默认保留**该 `ownerUserId` 的 Outbox（§4.8） | 不清业务 IDB；不清 Notion 页 |

### 2.4 凭据存储：PWA 可存 / 绝不可存

| 类别 | 项 | 允许？ | 说明 |
|------|-----|--------|------|
| **可持久化**（IDB 设置 / `sync_meta`） | `provider: 'notion'` | ✅ | |
| | `notionGatewayUrl` | ✅ | HTTPS URL |
| | `notionWorkspaceHint` | ✅ | 展示用 |
| | `workspaceKey`（verify 返回的稳定 id） | ✅ | 防串租户；非密钥 |
| **仅运行时**（内存；可选 `sessionStorage` 作 tab 级，**禁止**进 export） | `GATEWAY_API_KEY` | ⚠️ 运行时持有 | **禁止**写入 IDB `CloudStorageConfig`、`localStorage`、`car-care-export` JSON |
| | 短命 JWT（D4） | ⚠️ 运行时持有 | 同上；过期即废 |
| **绝不可出现在 PWA** | `NOTION_TOKEN` / Internal / PAT / OAuth access / refresh | ❌ | 只在 Worker Secret/KV |
| | `SESSION_SIGNING_SECRET` / `PROXY_SHARED_SECRET` | ❌ | 只在 Worker |
| | 任何把上述密钥**换名**后的字段（如 `notionToken`→`syncSecret`） | ❌ | 类型层 + CI 扫描禁止 |

**JSON 备份（`car-care-export-v1`）**：导出过滤必须剥离一切会话/密钥字段；导入不得要求或写回密钥。

### 2.5 前端配置（允许的类型方向）

```ts
// 可持久化（设计方向；实现阶段）
CloudStorageConfig {
  provider: 'notion'
  notionGatewayUrl: string
  notionWorkspaceHint?: string
  // 禁止：notionToken / notionGatewayKey / notionOauthRefresh / 任何 secret
}

// 运行时会话（非 export、非长期 IDB 设置）
NotionRuntimeSession {
  bearer: string          // API Key 或短命 JWT
  workspaceKey: string
  expiresAt?: number      // D4 JWT
}
```

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

### 3.3 属性映射（MVP · 权威命名）

**公共列（两表）——与独立稿同名，一律 PascalCase：**

| Notion 属性 | 类型 | 含义 |
|-------------|------|------|
| `Name` | title | 展示名（车名 / 记录摘要） |
| `AppEntityId` | rich_text | 本地 UUID；幂等键；query filter |
| `AppUpdatedAt` | rich_text（ISO-8601） | **应用 LWW 戳**（权威；勿依赖 `last_edited_time`） |
| `AppDeletedAt` | rich_text（ISO）/ 空 | 软删戳；与 `in_trash` 双轨（§4.7） |
| `DeviceId` | rich_text | 可选；回声抑制 |
| `PayloadJson` | rich_text | 瘦实体 JSON；编码规则 §3.5 |

**vehicles 额外（便于 Notion UI，权威仍在 `PayloadJson`）：** `Plate`、`EnergyType`、`Archived`。

**records 额外：** `VehicleAppId`（rich_text）、`RecordType`、`RecordDate`、`AmountPaid`。

联合类型 `CareRecord`：不在 Notion 拆多表；用 `RecordType` + 瘦 JSON。`mediaIds` 可保留 ID 数组，**不含** base64 / 二进制。

### 3.4 与 `CloudRow` 对齐

```ts
CloudRow { entity, id, payload, updatedAt, deletedAt?, deviceId? }
```

映射：`id` ← `AppEntityId`；`updatedAt` ← `AppUpdatedAt`；`deletedAt` ← `AppDeletedAt`（优先）或由 `in_trash` 推导。

### 3.5 PayloadJson 无损编码（冻结方案 · O3）

**目标**：业务 JSON 在 Notion 往返后语义无损，或**显式失败**；**禁止静默截断**。

#### 3.5.1 编码规则（MVP）

1. **瘦 payload**：从实体 JSON 剥离已冗余到标量列的字段（如 `name`→`Name`、`plate`→`Plate`）；剥离一切媒体二进制 / data-URL；保留 `mediaIds: string[]`（仅 ID）。  
2. **序列化**：`JSON.stringify` → UTF-16 长度（Notion rich_text 以字符计）**必须 ≤ 2000**。  
3. **超限**：**失败闭合**——该 outbox op 标记失败；UI 可读错误（如「该条记录过大，无法同步到 Notion；请缩短备注或改用 JSON 导出 / Supabase」）；**不得**截断后写入。  
4. **单段**：MVP **只**使用单一属性 `PayloadJson`；**不**自动拆 `PayloadJson_N`（拆分属 D4）。  
5. **往返校验（Gateway 写后读或本地预检）**：  
   - 写前：`encode(payload).length <= 2000`  
   - 写后（D1 建议）：retrieve 拼回字符串 → `JSON.parse` → 与规范化瘦对象 deep-equal；失败则该 op **不** ACK，返回可诊断错误（视为未应用）。  
6. **异常恢复**：解码失败（手改损坏、半截属性）→ 该行 skip + 计数；**不**用残缺 JSON 覆盖本地权威行；必要时开 M3-C 或「云端损坏」提示。  
7. **分页**：与 Payload 无关的 query 分页 `page_size≤100`；单行属性不跨 page。

#### 3.5.2 非 MVP（D4 候选，未冻结为默认）

| 方案 | 说明 | 状态 |
|------|------|------|
| `PayloadJson_1`…`N` 拼接 | 须定义分隔与校验和；实现与验收成本高 | D4 可选 |
| 用户 R2 外链存全文 | 增加依赖与权限面 | D4 可选 |
| 静默截断 / 丢字段 | — | **永久否决** |

---

## 4. 同步协议

### 4.0 双层 LWW（必须并存 · 审查裁定）

| 路径 | 权威组件 | 职责 |
|------|----------|------|
| **Pull**（云→本地） | 客户端 `merge.ts` + M3-C | 是否应用云行、open 冲突、回声抑制、改胜于删 |
| **Push**（本地→云） | Gateway 先读 `AppUpdatedAt` 再写 | 产出与 Supabase 同形的 `PushResult`（含 `cloud_newer`）；**无**第二套冲突模型 |

客户端不能替代 Gateway 的 push 比较（否则 TOCTOU 全在浏览器）；Gateway 不能替代客户端 pull/M3-C。  
**不得承诺**与 Postgres `FOR UPDATE` 同等的跨实例强一致。

### 4.1 仍复用本地协议

见 `own-cloud-sync-architecture.md` §5：`sync_meta` + `sync_outbox`；业务写后入队；`runSync` push→pull。

### 4.2 Push（Gateway 尽力 LWW）与并发

对每个 op：

1. 按 `AppEntityId` query Data Source（filter equals）；**查询策略须能看见 tombstone 页**（§4.7），`page_size` 足够覆盖重复页异常  
2. 无行 → create page（`parent.data_source_id`）  
3. 有行且已删（`AppDeletedAt` 或 `in_trash`）→ 见 §4.7 表（默认拒绝「旧 upsert 复活」，除非本地 op 为显式恢复且戳更新）  
4. 有存活行 → 读 `AppUpdatedAt`：若云端 > `op.mutatedAt` → 返回 `skipped_cloud_newer`（**不写**）  
5. 否则 PATCH properties；`delete` op → 双轨删除（§4.7）  
   - 文档：https://developers.notion.com/reference/trash-page  

#### 4.2.1 无原子 LWW 的并发（跨 Worker 实例）

| 层级 | MVP | 说明 |
|------|-----|------|
| 同 isolate / 同请求批内 | **要** | 对同一 `AppEntityId` 串行处理 push 批次 |
| Cloudflare Durable Object | **非必做（O5）** | D4 加固：每 `AppEntityId`（或每 workspace）一个 DO 队列，把「读戳→写」放进单线程 actor |
| 跨独立 Worker 实例无 DO | **存在竞态窗** | 两设备近同时 create/update 仍可能双页或后写覆盖 |

**若采用 DO（D4）——一致性边界与成本（不得夸大）：**

| 项 | 陈述 |
|----|------|
| 一致性边界 | **仅**保证进入同一 DO 的同一实体操作串行；**不是**全局快照隔离，**不是**跨实体事务 |
| 仍可能发生 | 客户端已基于过期快照决策；Notion API 503 后的不确定提交；DO 外的直连/手动 UI 编辑 |
| 成本 | 每活跃实体或每 workspace 的 DO 时长/请求计入 CF 账单；个人量级通常可忽略，大库高频同步需评估 |
| 产品承诺 | 文档与 UI **不得**写「强一致 / 零丢失」；应写「尽力 LWW + 冲突 UI」 |

**与客户端 LWW / M3-C 的分工**：Gateway 负责 push 比较并返回 `cloud_newer`；客户端负责 pull 合并与 open 冲突；用户在 M3-C 选择 keep_local / take_cloud。竞态残余靠时间戳 + 冲突 UI，**接受**弱于 Supabase RPC。

**幂等**：create 前必须 query（含 trash）；禁止无查直 insert。

### 4.3 Pull

- 分页 query 两 Data Source；**须包含 tombstone 行**（见 §4.7：`AppDeletedAt` 非空的页仍在可 query 的 Data Source 内，直到 grace 后策略另议）  
- 映射为 `CloudSnapshot` → 现有 `merge` / M3-C detect  
- `serverCursor`：可用 max(`AppUpdatedAt`)；Notion 无等价 WAL cursor

### 4.4 首次同步

1. `verify` 探测 Data Source ID（存 Worker KV 或返回给客户端 meta）  
2. 若云空 → `pushSnapshot` 仅 vehicles+records  
3. 若云非空且本地非空 → **禁止静默覆盖**；UI 选「以本地为准上传 / 以云为准拉取 / 取消」  
4. 向导文案：**明确不同步照片**

### 4.5 重试与限流

- 客户端：现有 `nextRetryDelayMs` + `MAX_OUTBOX_ATTEMPTS`  
- Worker→Notion：429/529 读 `Retry-After`；文档 https://developers.notion.com/reference/request-limits  
  - 普通计划约 **180 req/min/connection**；Business/Enterprise 600  
  - 写入 503 可能已提交：按 `retry_guidance` **先读后判**，避免双建页  
- 队列化出站，避免 burst 打满预算

### 4.7 删除同步协议（可执行 · O4）

#### 4.7.1 不变式

1. **双轨**：应用内删除 → Gateway 同时（同一逻辑操作内）设置 `in_trash: true` **且**写入 `AppDeletedAt`（ISO）。  
2. **Tombstone 仍可 query**：在 grace 窗口内，带 `AppDeletedAt` 的页**必须仍能**被 Data Source query 按 `AppEntityId` 命中（即便 `in_trash`；若 Notion query 默认排除 trash，Worker 须用可返回 trash 的检索方式或依赖本地 `sync_notion_map` + retrieve）。**实现验收**：删后立刻用同一 `AppEntityId` 仍能读到 tombstone 元数据。  
3. **Pull `deletedAt`**：优先 `AppDeletedAt`；若空但 `in_trash===true` → 用页 `last_edited_time` 或 push 时写入的戳推导。  
4. **恢复**：须 `in_trash: false` **且**清空 `AppDeletedAt`，并 bump `AppUpdatedAt`。  
5. **防旧设备复活**：create 前 query 若命中 tombstone，**禁止**再 create 第二页；对过期 upsert（`mutatedAt` < `AppDeletedAt`）返回冲突或 no-op deleted；仅当本地为显式「恢复/新编辑」且 `mutatedAt` > `AppDeletedAt` 时才允许 untrash+patch。

#### 4.7.2 状态转换表

| 当前云状态 | 事件 | 下一云状态 | Gateway / 客户端 |
|------------|------|------------|------------------|
| Absent（无 page） | push upsert | Alive | create + 写属性 |
| Absent | push delete | Absent | no-op applied |
| Alive | push upsert（本地戳 ≥ 云戳） | Alive | patch |
| Alive | push upsert（本地戳 < 云戳） | Alive | `cloud_newer` → M3-C |
| Alive | push delete | Tombstone（`in_trash` + `AppDeletedAt`） | 双轨写 |
| Tombstone | push upsert（戳 ≤ `AppDeletedAt`） | Tombstone | **拒绝复活**；可返回 conflict / skipped_deleted |
| Tombstone | push upsert（戳 > `AppDeletedAt`，显式恢复/新编辑） | Alive | untrash + 清 `AppDeletedAt` + patch |
| Tombstone | push delete | Tombstone | 幂等；可刷新 `AppDeletedAt` |
| Alive / Tombstone | 用户在 Notion UI 硬删 page | Absent（映射残留） | 下次 push：query 无行 → **先查 map**；若 map 曾标记 deleted 则 **禁止**盲目 create；清 map 或标 orphan（验收：不因旧 outbox upsert 重建已删实体） |
| Tombstone | pull | 本地 merge 见删 | `deletedAt` 非空 → 现有 merge / M3-C `edit_vs_delete` |
| Tombstone | 用户 Notion UI restore | 可能 Alive 但属性脏 | 下次 pull 以属性为准；若缺 `AppDeletedAt` 仅靠 `in_trash` 推导 |

```
Absent ──upsert──► Alive ──delete──► Tombstone ──(过期 upsert)──► Tombstone（拒绝）
                      ▲                  │
                      └──upsert(新戳)────┘
```

### 4.8 断开 / 切换工作区（安全走廊 · S3）

#### 4.8.1 默认行为（冻结）

| 动作 | Outbox | 业务 IDB | Notion 云端 | 内存会话 |
|------|--------|----------|-------------|----------|
| 断开 Notion（signOut） | **保留**该 `ownerUserId` 队列 | 保留 | 不动 | 清除 |
| 切换 Gateway URL / `workspaceKey` | **保留**旧 owner 队列；**绑定新 owner** 的新队列为空 | 保留（除非用户确认清空业务数据） | 不动旧库 | 清除后按新 URL 认证 |
| 切换 Notion ↔ Supabase | 同上：旧 provider 队列保留；禁止跨 provider 误推 | 保留 | 各云不动 | 按目标 provider 会话 |

**禁止默认调用** `clearOutboxForUser` 作为断开/切换的唯一路径。显式「丢弃未推送变更」须独立确认文案。

#### 4.8.2 安全走廊（实现须遵守）

1. 每个 outbox 项带 `ownerUserId`（= `workspaceKey` 或代理 subject）。  
2. `runSync` / `pushOps` **只**推送 `ownerUserId === 当前 verify 的 workspaceKey` 的项。  
3. 切换后旧队列可见于设置页「未推送（旧工作区）」；提供：  
   - **返回旧工作区并推送**（改回 URL/密钥后 flush）  
   - **导出 JSON 后丢弃**  
   - **显式丢弃**（二次确认）  
4. 新工作区首次同步仍走 §4.4 非空确认。

#### 4.8.3 验收用例（摘要；完整矩阵见 risks）

| ID | 场景 | 期望 |
|----|------|------|
| SW1 | 有未推送 outbox 时断开 | 队列仍在；会话清除；云端不变 |
| SW2 | 切换到另一 workspaceKey | 旧队列仍在且 **不**被 push；新库无旧数据写入 |
| SW3 | 用户显式丢弃旧队列 | 仅在确认后清除；需可测 |
| SW4 | 切回旧 workspace 后 flush | 旧队列成功推到原库（LWW 仍适用） |

---

## 5. 图片 / 媒体（产品文案）

| 选项 | 结论 |
|------|------|
| Notion File Upload 作主媒体库 | **不推荐作 MVP 主路径**：附件下载 URL **1 小时过期**；Free 单文件 5 MiB（https://developers.notion.com/guides/data-apis/working-with-files-and-media） |
| Payload 内嵌 base64 | **否决** |
| **MVP：不同步 media 实体与图片二进制**；记录上 `mediaIds` 可保留 ID | **推荐** |
| 后续：用户自有 HTTPS 外链 | 可选 Phase D.1 |
| 有 Supabase 时媒体继续走 M3-A | 互斥 provider 下自然分离 |

**文案冻结**：Notion 模式 =「车辆与养护**结构化数据**的可读备份 + 轻同步」。**禁止**：「完整图文云备份」「照片已同步到 Notion」「全量图文上云」。设置页常驻：「照片仅保存在本机；需要云端存图请用 Supabase 或 JSON 导出」。

---

## 6. 与 Supabase 混合使用策略

| 策略 | 说明 | MVP |
|------|------|-----|
| **互斥** | `CloudProviderId` 同时只能启用一个；切换走 §4.8 | **推荐默认** |
| 双写 | 同一 outbox 扇出两个 provider | 否决 |
| Supabase 主 + Notion 只读导出 | 定时 dump | 非 MVP |

---

## 7. 费用与维护

| 项 | 预估 |
|----|------|
| Cloudflare Worker | 个人量级通常免费档；DO（若 D4 启用）另计 |
| Notion Free | 单人 Free 通常够用；**多人 Free** 有 **1000 lifetime blocks** API 强制：https://developers.notion.com/reference/workspace-block-limits |
| 应用方 | 开源 Worker **参考模板**（O1）+ 文档；不代付用户 Notion；不托管 Token |
| 维护 | Notion-Version 钉 `2026-03-11`；Data Source API |

---

## 8. 实现阶段文件预期（本 PR 不创建）

- 填实 `src/sync/providers/notion.ts`（仅调用户代理，不直连带 token）  
- 扩展 `isCloudEnqueueEnabled`；切换路径遵守 §4.8  
- `docs/templates/notion-sync-worker/`（O1：README + 伪代码已落盘；无真实 secret；**不**进 app 构建）  
- **禁止**把 Notion SDK 打进生产 PWA 关键路径  

---

## 9. 开放问题

第二轮已裁 O1–O6 / S1–S3，见 [`m3d-mvp-spec.md` §0.1](./m3d-mvp-spec.md)。实现规格阶段仅允许在**不推翻冻结**的前提下细化接口字段与测试夹具。
