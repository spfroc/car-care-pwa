# M3-D 架构方案：Notion BYO 同步（仅设计）

> **状态**：已并入 PR #8；**第二轮独立审查有条件通过后的裁定已合入**。属性名 / 会话 / 双层 LWW / 删除双轨 / Payload / Outbox 切换以 [`m3d-mvp-spec.md` §0.1](./m3d-mvp-spec.md) 与 [`m3d-architecture.md`](./m3d-architecture.md) 为权威。  
> **前提**：生产仍为 M3-C 线；local-first IndexedDB；用户自有云；**不破坏**现有 Supabase 路径。  
> **未经架构评审通过不写业务代码**；不改生产 / 正式库。  
> **上游**：[`notion-sync-feasibility.md`](./notion-sync-feasibility.md)、[`own-cloud-sync-architecture.md`](./own-cloud-sync-architecture.md)、[`m3c-conflict-ui-architecture.md`](./m3c-conflict-ui-architecture.md)。  
> **审查纪要**：[`m3d-architecture-review-round2.md`](./m3d-architecture-review-round2.md)。  
> **实现规格**：[`m3d-implementation-spec.md`](./m3d-implementation-spec.md) · 模板：[`templates/notion-sync-worker/`](./templates/notion-sync-worker/)。  
> **本文给出单一推荐方案 + 明确否决项。** 共识锚点：**BYO Worker Gateway · 双层 LWW · 媒体不同步 · 与 Supabase 互斥**。

---

## 0. 一句话推荐

**BYO Gateway（用户自建 Cloudflare Worker）+ Notion Internal Connection Token 只存用户 Worker Secret；PWA 持久化 Gateway URL（及 workspace 提示），运行时持有用户自设的 Gateway API Key（Bearer；密钥不进 IDB/JSON 备份）。**  
同步仍走现有 `CloudProvider` + outbox + **双层 LWW**（客户端 pull + Gateway push 尽力）+ M3-C 冲突 UI；Notion 仅作「行存储适配器」。  
**M3-D MVP 实体：`vehicles` + `records`；不同步图片（非完整图文云备份）。Provider 与 Supabase 互斥。**

---

## 1. 相对现有栈：复用 vs 必须分叉

### 1.1 可复用（不要重写）

| 模块 | 复用方式 |
|------|----------|
| `CloudProvider` 接口 | 实现真 `NotionProvider`（经 Gateway 调 Notion，不直连带 token） |
| `sync_outbox` / `sync_meta` / ownerUserId 隔离 | 不变；`cloudUserId` 映射为 Gateway 返回的 `workspaceKey`；**切换默认保留 Outbox**（见 §5.1） |
| `engine` 编排（pull→merge→push、tab lock、lease lost 不 ACK） | 不变 |
| 客户端 LWW（`merge.ts`）+ M3-C open 冲突 | **必须**在 pull 路径做；与 Gateway push 尽力 LWW **并存**（§3.4） |
| M3-B `withSyncLock` | 不变；Notion 更慢，更依赖单写者 |
| 设置页 Provider 切换 | 复用；换 Notion↔Supabase 视为换 provider；安全走廊见 §5.1 |
| 导入导出 `car-care-export-v1` | 冷备份；**导出须剥离一切 Gateway/Notion 密钥** |

### 1.2 必须分叉（Notion 不像 Postgres）

| 点 | Supabase 现状 | Notion 必须不同 |
|----|---------------|-----------------|
| 鉴权 | 用户自有项目 anon key + Auth | **长效 Notion token 绝不能进 PWA**；经 BYO Gateway；Gateway API Key 仅运行时 |
| LWW 写入 | DB 函数可原子比较 `updated_at` | **无事务**；Gateway 先读后写比较 `AppUpdatedAt`；**不承诺**跨实例强一致；DO 非 MVP 必做 |
| 主键 | 行 `id` = 业务 UUID | Notion `page_id` ≠ 业务 id → 本地映射表 `sync_notion_map` |
| 查询 / cursor | `updated_at > cursor` 可靠 | 以自有属性 `AppUpdatedAt` + 分页 query 为主 |
| Tombstone | `deleted_at` 列 | **双轨** `AppDeletedAt` + `in_trash`（与 architecture §4.7 同名） |
| 媒体 | M3-A private Storage | MVP **不同步媒体**；非图文云盘 |
| 配额 | DB+Storage | **约 180 req/min/workspace（非企业）**；串行批次 + `Retry-After` |
| RLS | `auth.uid()` | 无；隔离 = 用户自己的 workspace + share 指定 DB 给 integration |
| 批量 | upsert 批量 RPC | 逐页 create/patch；`pushSnapshot` 成本高 |

**原则**：Engine 继续跟「带 `CloudRow` 的提供者」说话；Notion 怪异处全部吞进 **Gateway + NotionProvider**，不要污染 `merge` / 冲突 UI。

---

## 2. 认证与 API 代理（Secret 永不进前端持久化）

### 2.1 推荐：BYO Gateway（用户自持）

```
PWA ──HTTPS──► 用户的 Cloudflare Worker（Gateway）
                    │  Secret: NOTION_TOKEN（Internal Connection）
                    │  Secret: GATEWAY_API_KEY（用户自设）
                    └──► api.notion.com
```

**PWA 本地仅持久化**（与 [`m3d-architecture.md` §2.4](./m3d-architecture.md) 一致）：

- `provider: 'notion'`
- `notionGatewayUrl`
- `notionWorkspaceHint`（可选）
- `workspaceKey`（verify 后）

**运行时（内存；禁止进 IDB 设置与 JSON 备份）**：

- `GATEWAY_API_KEY`（Bearer）— MVP 认证方式  
- 短命 JWT — D4 可选（`POST /auth/session`）

**禁止**：`NOTION_TOKEN`、OAuth refresh、签名密钥、以及把上述密钥换名后写入浏览器持久化或导出文件。

**用户操作路径（文档化，非我们托管）：**

1. 在 Notion 创建 **Internal Connection**，把两个 Database（Vehicles / Records）Share 给该 Connection。  
2. 部署开源 **Worker 参考模板**（O1；wrangler），把 Integration Token 与自设 `GATEWAY_API_KEY` 配进 Worker Secret。  
3. 在车护设置里填 Gateway URL；每次会话输入 API Key → `verify`。

### 2.2 Gateway 最小 API（与 CloudProvider 对齐）

| 方法 | 语义 |
|------|------|
| `GET /health` + `Authorization: Bearer <gatewayKey\|jwt>` | verify；返回 `workspaceKey` / bot 名 |
| `GET /sync/pull?entities=vehicles,records&cursor=` | 返回 `CloudRow[]`（含 tombstone） |
| `POST /sync/push` | body=`SyncOutboxItem[]`；尽力 LWW 比较 `AppUpdatedAt`；返回 `applied` / `conflicts` |
| `POST /sync/snapshot` | 首次引导写入 |
| `POST /auth/session` · `/auth/refresh` · `/auth/revoke` | **D4 可选**短命 JWT |

Gateway **禁止**把 `NOTION_TOKEN` 回显；日志打码。会话状态机见 architecture §2.3。

### 2.3 否决的认证方案

| 方案 | 原因 |
|------|------|
| **个人 / Internal Token 进 PWA** | 已否决 |
| **我们集中托管的多租户 OAuth 保险库** | 集中持有全体 refresh；非「用户自有云」 |
| **纯前端 Public OAuth（无后端）** | 无法安全持有 `client_secret` |
| **共享 Public OAuth client_id（MVP）** | O2 否决 |
| **把 Notion token / Gateway 长期密钥存 IDB 或 JSON 备份**（含换名） | 用户硬约束 + 审查合入 |
| **无认证开放代理** | 否决 |

---

## 3. 数据模型与同步协议

### 3.1 Notion 侧结构

每个用户 workspace 内（模板可复制）：

1. **Database `Car Care Vehicles`**  
2. **Database `Car Care Records`**

**公共属性（两库）——权威命名与 architecture §3.3 同名：**

| 属性 | 类型 | 用途 |
|------|------|------|
| `Name` | title | 展示：车辆昵称 / 记录摘要 |
| `AppEntityId` | rich_text | **业务 UUID**（查询键） |
| `AppUpdatedAt` | rich_text（ISO） | **LWW 戳** |
| `AppDeletedAt` | rich_text / 空 | tombstone；与 `in_trash` 双轨 |
| `DeviceId` | rich_text | 回声抑制 |
| `PayloadJson` | rich_text | 瘦实体 JSON（§3.5 / architecture §3.5） |

Records 额外可冗余：`VehicleAppId`、`RecordType`、`RecordDate`、`AmountPaid`（**同步仍以 PayloadJson + 双轨删除为准**）。

### 3.2 本地映射

```ts
// sync_notion_map
{ entity: 'vehicles'|'records', appId: string, pageId: string, workspaceKey: string, deleted?: boolean }
```

`workspaceKey` = verify 返回的稳定 id，防止换 workspace 串页。`deleted` 辅助防旧设备 recreate。

### 3.3 协议映射

| CloudProvider | Notion/Gateway 行为 |
|---------------|---------------------|
| `verify` | Gateway health；失败则不连 |
| `pullAll` | Query 两库（含 tombstone）；解码为 `CloudRow` |
| `pushOps` | 按 `AppEntityId` 查找（含 trash）→ 无则 create；有则比较 `AppUpdatedAt`；删除走双轨。**串行**；429/`Retry-After` |
| `pushSnapshot` | 首次分页上传；同 `AppEntityId` 则 LWW |
| `getMediaObjectStore` | **返回 null**（MVP） |

**幂等**：`AppEntityId` 唯一；create 前 query 防双 page。

### 3.4 双层 LWW（与 architecture §4.0 一致）

| 路径 | 权威 | 职责 |
|------|------|------|
| Pull | 客户端 `merge.ts` + M3-C | 应用云行 / open 冲突 |
| Push | Gateway 先读后写 | `PushResult` 含 `cloud_newer` |

Durable Object 串行 = **D4 可选**，非 MVP 必做；**不承诺**强一致。分工细节与成本见 architecture §4.2.1。

### 3.5 PayloadJson

与 architecture §3.5 **同一冻结方案**：瘦 JSON、≤2000 字符、失败闭合、禁静默截断、往返校验、损坏行 skip。

---

## 4. 图片方案；Notion + Supabase 混合

### 4.1 默认（推荐）

| 项 | 决定 |
|----|------|
| Notion MVP 媒体 | **不同步图片**；`media` 不出箱；首页/详情仍读本地 Blob |
| 产品文案 | 「结构化账本可读备份 + 轻同步」；**禁止**「完整图文云备份」 |
| 备份含图 | JSON 导出或 Supabase（M3-A）路径 |
| Provider 模型 | **互斥**：`none` \| `supabase` \| `notion` |
| Notion 页里外链图 | **不做**（MVP） |

### 4.2 混合（Notion 行 + Supabase Storage）

**MVP 明确否决。**

### 4.3 若用户坚持「云端要有图」

产品话术：**用 Supabase 路径**（已具备 M3-A）；Notion 路径**不是**全量媒体云盘，也**不是**完整图文云备份。

---

## 5. 账号切换、删除、冲突、断网、幂等、首次同步

### 5.1 账号 / Workspace 切换（安全走廊）

与 [`m3d-architecture.md` §4.8](./m3d-architecture.md) 一致：

- `verify` → `workspaceKey` 写入 `sync_meta`。  
- 切换主体 → **不清业务 IDB 除非用户确认**。  
- **未推送 Outbox 默认必须保留**；**禁止**把旧 owner 队列推到新 `workspaceKey`。  
- 设置页提供：返回旧区推送 / 导出后丢弃 / 显式丢弃（二次确认）。  
- **禁止**默认 `clearOutboxForUser` 作为断开唯一动作。

### 5.2 删除（双轨 + 防复活）

完整状态转换表见 architecture §4.7。摘要：

- 本地删 → outbox `delete` → Gateway：`in_trash: true` **且** `AppDeletedAt`。  
- Tombstone **须仍可**按 `AppEntityId` 解析到（query 或 map+retrieve）。  
- 旧设备过期 upsert **不得** recreate 已删实体。  
- 恢复须清双轨并 bump `AppUpdatedAt`。  
- 文案：勿在 Notion UI 硬删行；宜用应用内删除。

### 5.3 冲突

- 完全复用 M3-C：**仅 vehicles+records**。  
- `take_cloud` / `keep_local` 硬约束与 M3-C 冻结一致。  
- Gateway `cloud_newer` 须带云端 `updatedAt`（及可选 payload）。

### 5.4 断网重试

- 复用 outbox 指数退避；429 → 尊重 `Retry-After`。  
- 部分批次成功：只 ACK `applied`。

### 5.5 幂等

- 业务键 `AppEntityId`；map `(entity, appId)→pageId`；同戳 patch 幂等。

### 5.6 首次同步

1. 部署 Gateway + Share 两个空 DB。  
2. PWA `verify` → 「上传本地」或「从云拉取」。  
3. **禁止**无确认覆盖非空双侧。  
4. 媒体提示：「Notion 模式**不同步照片**，不是完整图文云备份；请定期导出 JSON 或使用 Supabase 存图。」

---

## 6. 复杂度 / 费用 / 维护粗估

| 维度 | 估 |
|------|----|
| 工程量 | **中高**：Gateway 模板 + NotionProvider + map + 限流/LWW + 设置引导；约 **1.5～3 人周**（不含托管 OAuth） |
| 用户费用 | CF Worker 免费档通常够；Notion 个人 workspace；我们侧 $0 |
| 我们维护 | 参考模板（O1）、API 变更、文档；无多租户密钥运维 |
| 运行时风险 | 速率限制；大库首次同步需进度 UI；无原子 LWW 残余竞态 |
| 测试 | Mock Gateway；契约测试；disposable Notion workspace |

Notion 路径定位为 **可选适配器**，默认仍推 Supabase。

---

## 7. 风险清单 + 取舍理由

### 7.1 风险

| ID | 风险 | 缓解 |
|----|------|------|
| R1 | Token / 长期密钥泄露 | BYO Secret；前端零 Notion token；API Key 不进 IDB/JSON；Gateway 禁止回显 |
| R2 | 无事务双写 / 双 page | 先查后写（含 trash）；map；冲突 UI；DO 仅 D4 |
| R3 | Rate limit | 串行、退避、进度条 |
| R4 | `PayloadJson` 超限 | **失败闭合**；禁静默截断 |
| R5 | 用户在 Notion 乱改属性 | 以 Payload + App* 戳为准；损坏 skip；O6 不支持 UI 手改为同步语义 |
| R6 | `last_edited_time` 不可靠 | 只用 `AppUpdatedAt` |
| R7 | 与 Supabase 行为漂移 | 同一 `CloudRow`/`PushResult`；共用 merge/M3-C |
| R8 | 支持负担（用户不会部署 Worker） | 诚实文案；默认推 Supabase |
| R9 | Notion API 变更 | 适配集中在 Gateway 模板 |
| R10 | 误以为媒体已上云 | 首次连接强提示 + 设置常驻；禁「完整图文云备份」文案 |
| R11 | 切换误清 / 误推 Outbox | §5.1 安全走廊；验收 SW1–SW4 |
| R12 | 旧设备复活已删实体 | §5.2 / architecture §4.7 |

### 7.2 为何选本方案

| 选项 | 结论 |
|------|------|
| **BYO Gateway + Internal Token（本推荐）** | 安全达标、不集中持币、复用同步状态机 |
| 前端直持 Token | **否决** |
| 我方多租户 OAuth 托管 / 共享 public client | **否决（MVP）** |
| Notion + Supabase Storage 混合 | **否决（MVP）** |
| 只做单向导出 | 降级备选，不叫完整 M3-D 同步 |

### 7.3 开工门槛

- [x] 第二轮架构审查有条件通过 + 必须改文档清单合入（本 PR 补丁）  
- [ ] Gateway 模板安全复审  
- [ ] 契约：Gateway↔`CloudProvider` 夹具测试  
- [ ] 前端 bundle / export 扫描：零 Notion token / 零持久化 Gateway 密钥  
- [ ] disposable workspace 双端清单  
- [ ] **不**改生产 Supabase schema；feature flag 默认关  

### 7.4 明确非目标

- 写业务代码 / 接真 API（评审前 / 本 PR）  
- 改正式库、破坏 Supabase  
- Notion 同步 stations/settings/media/learning（MVP）  
- 字段级三路 merge、托管 OAuth、混合存储  
- 假设 Notion / 跨 Worker 具备强一致事务  
- 把 Notion MVP 描述为完整图文云备份  

---

## 8. 建议文档与模块边界（实现期，非本轮编码）

```
docs/m3d-notion-byo-architecture.md     ← 本文
docs/m3d-architecture.md                ← 权威细则（会话/删除/Payload/切换）
docs/m3d-mvp-spec.md                    ← §0 / §0.1 裁定
docs/m3d-architecture-review-round2.md  ← 审查纪要
gateway/notion-byo/（未来）             ← Worker 模板
src/sync/providers/notion.ts            ← 经 Gateway（评审后）
src/sync/notionMap.ts                   ← page 映射
```

**依赖方向**：`NotionProvider` → Gateway HTTP；**禁止** PWA `fetch('https://api.notion.com')`。

---

## 9. 结论（供粘贴进评审纪要）

**单一推荐**：用户自建 Gateway 保管 Notion Internal Token；PWA 配 Gateway URL + 运行时 API Key；双层 LWW；MVP 只同步 vehicles+records；**不同步图片**；与 Supabase 互斥；删除双轨；Payload 失败闭合；切换默认保留 Outbox。  

**否决**：Token 进前端、长期密钥进 IDB/JSON 备份、我方集中 OAuth、MVP 混合存储、承诺强一致、完整图文云备份话术。  

**下一步**：实现规格起草（仍不写业务代码）；PR #8 保持 OPEN 至文档审查关闭。
