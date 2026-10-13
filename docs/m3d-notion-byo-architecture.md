# M3-D 架构方案：Notion BYO 同步（仅设计）

> **状态**：架构推荐稿，供评审。**未经架构评审通过不写业务代码**；不改生产 / 正式库。  
> **前提**：生产仍为 M3-C 线；local-first IndexedDB；用户自有云；**不破坏**现有 Supabase 路径。  
> **上游**：[`notion-sync-feasibility.md`](./notion-sync-feasibility.md)（个人 token 进前端已否决）、[`own-cloud-sync-architecture.md`](./own-cloud-sync-architecture.md)、[`m3c-conflict-ui-architecture.md`](./m3c-conflict-ui-architecture.md)（冲突 MVP 实体：`vehicles`+`records`）。  
> **PR 配套（交叉阅读）**：[`m3d-mvp-spec.md`](./m3d-mvp-spec.md)（含 §0 已采用默认）· [`m3d-architecture.md`](./m3d-architecture.md)（代码盘点 + 实现侧细节）· [`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md)。  
> **本文给出单一推荐方案 + 明确否决项。** 若与 `m3d-architecture.md` 表述冲突，以本文为准的共识锚点为：**BYO Worker Gateway · 客户端 LWW · 媒体不同步 · 与 Supabase 互斥**（`m3d-architecture.md` 文首已注明同一优先级）。

---

## 0. 一句话推荐

**BYO Gateway（用户自建 Cloudflare Worker）+ Notion Internal Connection Token 只存用户 Worker Secret；PWA 只持有 Gateway URL 与用户自设的 Gateway API Key。**  
同步仍走现有 `CloudProvider` + outbox + 客户端 LWW + M3-C 冲突 UI；Notion 仅作「行存储适配器」。  
**M3-D MVP 实体：`vehicles` + `records`；媒体不同步到 Notion（留本地 / JSON 导出）。Provider 与 Supabase 互斥，不做混合。**

---

## 1. 相对现有栈：复用 vs 必须分叉

### 1.1 可复用（不要重写）

| 模块 | 复用方式 |
|------|----------|
| `CloudProvider` 接口 | 实现真 `NotionProvider`（经 Gateway 调 Notion，不直连带 token） |
| `sync_outbox` / `sync_meta` / ownerUserId 隔离 | 不变；`cloudUserId` 映射为 Notion `workspace_id`+bot 身份或 Gateway 签发的 `subject` |
| `engine` 编排（pull→merge→push、tab lock、lease lost 不 ACK） | 不变 |
| 客户端 LWW（`merge.ts`）+ M3-C open 冲突 | **必须**在客户端做；Notion 无等价 RPC/LWW |
| M3-B `withSyncLock` | 不变；Notion 更慢，更依赖单写者 |
| 设置页 Provider 切换 / 账号切换清队列模式 | 复用；换 Notion↔Supabase 视为换 provider（见 §5） |
| 导入导出 `car-care-export-v1` | 冷备份与灾难恢复，与 Notion 并行 |

### 1.2 必须分叉（Notion 不像 Postgres）

| 点 | Supabase 现状 | Notion 必须不同 |
|----|---------------|-----------------|
| 鉴权 | 用户自有项目 anon key + Auth（前端持有 publishable） | **长效 Notion token 绝不能进 PWA**；经 BYO Gateway |
| LWW 写入 | DB 函数可原子比较 `updated_at` | **无事务**；Gateway/客户端先读后写，比较**我们写入的** `updated_at` 属性；竞态窗靠 M3-C / 重试 |
| 主键 | 行 `id` = 业务 UUID | Notion `page_id` ≠ 业务 id → 本地映射表 `sync_notion_map` |
| 查询 / cursor | `updated_at > cursor` 可靠 | `last_edited_time` 粗、且会被无关编辑打乱；**以自有属性 `app_updated_at` + 全量/分页 query 为主**，cursor 仅作加速提示 |
| Tombstone | `deleted_at` 列 | 属性 `deleted_at` + 可选 archive；恢复靠清属性（对齐 M3-C 快照语义，不新开 Notion 专用 restore RPC） |
| 媒体 | M3-A private Storage | Notion 文件块/外部文件不适合做真相源 → MVP **不同步媒体** |
| 配额 | DB+Storage | **约 180 req/min/workspace（非企业）**；须串行批次 + `Retry-After` |
| RLS | `auth.uid()` | 无；隔离 =「用户自己的 workspace + 只 share 指定 DB 给 integration」 |
| 批量 | upsert 批量 RPC | 逐页 create/patch；`pushSnapshot` 首次同步成本高 |

**原则**：Engine 继续以为自己在跟「带 `CloudRow` 的提供者」说话；Notion 怪异处全部吞进 **Gateway + NotionProvider 适配层**，不要污染 `merge` / 冲突 UI。

---

## 2. 认证与 API 代理（Secret 永不进前端）

### 2.1 推荐：BYO Gateway（用户自持）

```
PWA ──HTTPS──► 用户的 Cloudflare Worker（Gateway）
                    │  Secret: NOTION_TOKEN（Internal Connection）
                    │  Secret: GATEWAY_API_KEY（用户自设）
                    └──► api.notion.com
```

**PWA 本地仅存**（`CloudStorageConfig` 扩展，仍非 Notion token）：

- `provider: 'notion'`
- `notionGatewayUrl`
- `notionGatewayKey`（用户自设的 Gateway 密钥；可存 IDB，风险低于 Notion token，仍建议可轮换）
- `notionWorkspaceHint`（可选展示）

**用户操作路径（文档化，非我们托管）：**

1. 在 Notion 创建 **Internal Connection**，把两个 Database（Vehicles / Records）Share 给该 Connection。  
2. 一键/拷贝部署我们开源的 **Worker 模板**（wrangler），把 Integration Token 配进 Worker Secret。  
3. 自设 `GATEWAY_API_KEY`，在车护设置里填 Gateway URL + Key → `verify`。

**我们（应用方）不持有全体用户 Notion Token** —— 满足硬约束。模板可开源；可选提供「一键 Deploy to Cloudflare」链接，密钥仍进用户账号。

### 2.2 Gateway 最小 API（与 CloudProvider 对齐）

| 方法 | 语义 |
|------|------|
| `GET /health` + `Authorization: Bearer <gatewayKey>` | verify；返回 `workspace_id` / bot 名作 `userId` |
| `GET /sync/pull?entities=vehicles,records&cursor=` | 返回 `CloudRow[]`（已把 page→业务 id / payload 解码） |
| `POST /sync/push` | body=`SyncOutboxItem[]`；服务端串行 LWW 比较 `app_updated_at`；返回 `applied` / `conflicts` |
| `POST /sync/snapshot` | 首次引导写入（限流友好、可断点） |

Gateway **禁止**把 `NOTION_TOKEN` 回显给客户端；日志打码。

### 2.3 否决的认证方案

| 方案 | 原因 |
|------|------|
| **个人 / Internal Token 进 PWA** | 已否决；可被 XSS/备份泄露 |
| **我们集中托管的多租户 OAuth 保险库** | 集中持有全体 refresh token；运维/合规/失窃面过大；非「用户自有云」精神 |
| **纯前端 Public OAuth（无后端）** | Token 交换需 `client_secret`（Basic）；SPA 无法安全持有；refresh 轮换竞态难 |
| **把 Notion token 存用户 Supabase 行里再读回前端** | 仍进前端内存；且强迫 Notion 用户开 Supabase |

**可选后续（D2，非本推荐 MVP）**：若产品强需求「免部署」，再评估「可选托管 Gateway + Notion Public OAuth」，token 仅存托管侧加密箱、从不下发前端——须单独安全评审，**默认关闭**。

---

## 3. 数据模型与同步协议（相对 Supabase 的差异）

### 3.1 Notion 侧结构

每个用户 workspace 内（模板可复制）：

1. **Database `Car Care Vehicles`**  
2. **Database `Car Care Records`**

**公共属性（两库）：**

| 属性 | 类型 | 用途 |
|------|------|------|
| `Name` | title | 展示：车辆昵称 / 记录摘要 |
| `app_id` | rich_text 或 title 备用键 | **业务 UUID**（唯一，查询键） |
| `app_updated_at` | rich_text（ISO）或 date | **LWW 戳**（权威；勿依赖 `last_edited_time`） |
| `app_deleted_at` | rich_text / date | tombstone；空=存活 |
| `device_id` | rich_text | 回声抑制 |
| `payload` | rich_text（JSON 文本） | 完整实体（CareRecord 多态、Vehicle 字段） |
| `entity` | select | `vehicles` / `records`（Records 库可省略） |

Records 额外可冗余：`vehicle_id`、`type`、`date`（便于用户在 Notion UI 筛选；**同步仍以 payload 为准**）。

**容量**：单 rich_text 有长度上限；单条 record JSON 需控制（媒体 id 数组可保留，**不含** base64）。超限则 push 失败并提示「该条过大，请去图后同步」。

### 3.2 本地映射

新 IDB store（仅 Notion provider 使用）：

```ts
// sync_notion_map
{ entity: 'vehicles'|'records', appId: string, pageId: string, workspaceKey: string }
```

`workspaceKey` = verify 返回的稳定 id，防止换 workspace 串页。

### 3.3 协议映射

| CloudProvider | Notion/Gateway 行为 |
|---------------|---------------------|
| `verify` | Gateway health；失败则不连 |
| `pullAll` | Query 两库（过滤或客户端丢弃已删过久）；解码为 `CloudRow`；含 `deletedAt` |
| `pushOps` | 按 `app_id` 查找 page → 无则 create；有则比较 `app_updated_at`：云端更新 → `conflicts[]`；否则 patch。**串行**，遵守 429/`Retry-After` |
| `pushSnapshot` | 首次：分页上传；已存在同 `app_id` 则 LWW；支持断点（Gateway 记进度或客户端按批 ACK） |
| `getMediaObjectStore` | **返回 null**（MVP） |

**幂等**：`app_id` 唯一；重复 push 同 `mutatedAt` → no-op applied；create 前 query 防双 page（Notion 无唯一约束，Gateway 必须「先查后写」+ 映射表）。

**与 Supabase 差异小结**：无 RLS/无原子 upsert RPC/无 Storage；LWW 与冲突语义**对齐客户端已有模型**，由 Gateway 模仿 `PushResult.conflicts`。

---

## 4. 图片方案；Notion + Supabase 混合

### 4.1 默认（推荐）

| 项 | 决定 |
|----|------|
| Notion MVP 媒体 | **不同步**；`media` 不出箱；首页/详情仍读本地 Blob |
| 备份 | 用户继续用 JSON 导出（可含图）或仅在 Supabase 路径用 M3-A |
| Provider 模型 | **互斥**：`none` \| `supabase` \| `notion`；设置里选 Notion 即断开 Supabase 会话逻辑（清/保留 outbox 按现有换账号策略） |
| Notion 页里外链图 | **不做**（链过期、权限、配额） |

### 4.2 混合（Notion 行 + Supabase Storage）

**MVP 明确否决。**  
理由：双凭证、双失败域、切换 provider 时媒体孤儿、与「用户只想用 Notion」心智不符。若未来需要，单开 **M3-D2** 评审，且默认仍关闭。

### 4.3 若用户坚持「云端要有图」

产品话术：**用 Supabase 路径**（已具备 M3-A）；Notion 路径定位为「结构化账本可读备份 + 轻同步」，不是全量媒体云盘。

---

## 5. 账号切换、删除、冲突、断网、幂等、首次同步

### 5.1 账号 / Workspace 切换

- `verify` 得到 `workspaceKey`；写入 `sync_meta.cloudUserId`（或并列 `notionWorkspaceKey`）。  
- 与现网一致：切换主体 → **不清业务 IDB 除非用户确认**；outbox 按 owner 隔离；他户队列不推。  
- 换 Gateway URL / Key 视为可能换租户 → 走与换 Supabase 用户相同的确认文案。  
- **禁止**静默把 A workspace 的 outbox 推到 B。

### 5.2 删除

- 本地删 → outbox `delete` → Gateway 写 `app_deleted_at`（不必硬删 page，便于恢复窗口）。  
- Pull 带 tombstone → 客户端按现有 merge / M3-C `edit_vs_delete`。  
- Notion UI 里用户手动删 page：下次 pull 表现为「云端消失」——Gateway 应尽量用 DB query；若 page 被硬删，映射残留则 push 时 create 新 page 并更新 map（文档说明「勿在 Notion 硬删行，宜用应用内删除」）。

### 5.3 冲突

- 完全复用 M3-C：**仅 vehicles+records** 进 open 队列；`keep_local` / `take_cloud` 语义不变。  
- **硬约束对齐 M3-C 冻结**：`take_cloud` 须云快照成功写入本地后才清 blocked outbox；`keep_local` 经 bump + 正常 push/LWW，**禁止**绕过比较强盖较新云端。  
- Gateway 返回的 `cloud_newer` 必须带云端 `updatedAt`（及可选 payload）供冲突快照。

### 5.4 断网重试

- 复用 outbox 指数退避；Gateway/Notion 429 → `markOutboxFailure` + 尊重 `Retry-After`（可写入 `nextRetryAt`）。  
- 部分批次成功：只 ACK `applied`；与现 engine 一致。

### 5.5 幂等

- 业务键 `app_id`；map `(entity, appId)→pageId`；同戳 patch 幂等。  
- 首次 snapshot 与增量 push 共用比较函数，避免双通道语义分裂。

### 5.6 首次同步

1. 用户部署 Gateway + Share 两个空 DB（或从模板复制）。  
2. PWA `verify` → 选「上传本地到云」`pushSnapshot`（仅 vehicles+records）或「从云拉取」`pullAll`（空云则提示先上传）。  
3. **禁止**无确认覆盖非空双侧（沿用 Supabase 首次引导交互）。  
4. 媒体提示：「Notion 模式不同步照片，请定期导出 JSON。」

---

## 6. 复杂度 / 费用 / 维护粗估

| 维度 | 估 |
|------|----|
| 工程量 | **中高**：Gateway 模板 + NotionProvider + map store + 限流/LWW 适配 + 设置引导 + 双端验收；约 **1.5～3 人周**（不含托管 OAuth） |
| 用户费用 | Cloudflare Worker 免费档通常够个人同步；Notion 免费/个人 workspace；**我们侧 $0**（不托管 token） |
| 我们维护 | 模板版本、Notion API 变更、文档；**无**多租户密钥运维；支持成本在「用户自建 Worker」排障 |
| 运行时风险 | 速率限制导致大库首次同步分钟～十分钟级；需进度 UI |
| 测试 | Memory 级 mock Gateway；契约测试；disposable Notion workspace 人工清单 |

相对继续加强 Supabase：Notion 路径 **产品价值是「可读 workspace + 用户已有 Notion」**，工程与稳定性均弱于 Supabase；应定位为 **可选适配器**，而非默认推荐。

---

## 7. 风险清单 + 取舍理由

### 7.1 风险

| ID | 风险 | 缓解 |
|----|------|------|
| R1 | Token 泄露 | BYO Secret；前端零 Notion token；Gateway 禁止回显 |
| R2 | 无事务双写 / 双 page | 先查后写；map；冲突 UI |
| R3 | Rate limit | 串行、退避、进度条；降低同步频率 |
| R4 | `payload` 超限 | 拒推过大行；禁 base64 |
| R5 | 用户在 Notion 乱改属性 | 以 payload 为准；损坏则冲突/跳过并计数 |
| R6 | `last_edited_time` 不可靠 | 只用 `app_updated_at` |
| R7 | 与 Supabase 行为漂移 | 同一 `CloudRow`/`PushResult`；共用 merge/M3-C 测试 |
| R8 | 支持负担（用户不会部署 Worker） | 设置页诚实文案；默认仍推 Supabase；提供逐步图 |
| R9 | Notion API / OAuth 政策变更 | 适配集中在 Gateway 模板，PWA 少改 |
| R10 | 误以为媒体已上云 | 首次连接强提示 + 设置常驻说明 |

### 7.2 为何选本方案（相对其它）

| 选项 | 结论 |
|------|------|
| **BYO Gateway + Internal Token（本推荐）** | 安全达标、不集中持币、契合「用户自有云」、能复用现有同步状态机 |
| 前端直持 Token | **否决** |
| 我方多租户 OAuth 托管 | **否决（MVP）**；与 BYO 原则冲突 |
| Notion 官方当主库且字段级同步 | **否决**；类型/冲突/媒体均弱 |
| Notion + Supabase Storage 混合 | **否决（MVP）** |
| 只做单向导出到 Notion | 可作更小切口，但用户要「双向」——若评审认为 Worker 门槛过高，**降级备选**为「导出页面/单向备份」，不叫完整 M3-D 同步 |

### 7.3 开工门槛（评审通过后方可编码）

- [ ] 本架构评审通过（含否决项确认）  
- [ ] Gateway 模板安全复审（Secret、CORS、无 token 下发）  
- [ ] 契约：Gateway↔`CloudProvider` 夹具测试  
- [ ] 前端 bundle 扫描：零 `secret_` / Notion token 模式  
- [ ] disposable workspace 双端清单（对齐 M3-C D 系列，换 Provider）  
- [ ] **不**改生产 Supabase schema；Notion 路径 feature flag 默认关  

### 7.4 明确非目标（本设计）

- 写业务代码 / 接真 API（评审前）  
- 改正式库、破坏 Supabase  
- Notion 同步 stations/settings/media/learning（MVP）  
- 字段级三路 merge、托管 OAuth、混合存储  
- 假设 Notion 具备同等事务 / RLS / 服务端 LWW  

---

## 8. 建议文档与模块边界（实现期，非本轮编码）

```
docs/m3d-notion-byo-architecture.md     ← 本文
docs/notion-sync-feasibility.md         ← 保留；文首链到本文「推荐方案」
gateway/notion-byo/（未来）             ← Worker 模板，独立目录
src/sync/providers/notion.ts            ← 经 Gateway 的真实现（评审后）
src/sync/notionMap.ts                   ← page 映射
```

**依赖方向**：`NotionProvider` → Gateway HTTP；**禁止** PWA `fetch('https://api.notion.com')`。

---

## 9. 结论（供粘贴进评审纪要）

**单一推荐**：用户自建 Gateway（Cloudflare Worker）保管 Notion Internal Token；PWA 只配 Gateway；复用 Outbox/LWW/M3-C；MVP 只同步 vehicles+records；媒体本地；与 Supabase 互斥。  

**否决**：Token 进前端、我方集中 OAuth 保险库、MVP 混合存储、把 Notion 当带 RLS 的 Postgres 用。  

**正式独立审查**：本文件入库并完成评审纪要后，再开第二轮（实现规格 / 接口草案），此前不写业务代码。
