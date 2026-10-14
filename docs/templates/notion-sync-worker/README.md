# Notion Sync Worker · 用户自有 Gateway 参考实现（M3-D D1）

> **状态**：可部署参考实现（D1 原型）· **非**应用方集中托管服务 · **禁止**把 Token 写入 Git / PWA  
> **权威契约**：[`../../m3d-implementation-spec.md`](../../m3d-implementation-spec.md) §3 · [`CONTRACT.md`](./CONTRACT.md)  
> **冻结设计**：[`../../m3d-architecture.md`](../../m3d-architecture.md) · [`../../m3d-mvp-spec.md`](../../m3d-mvp-spec.md)

本目录是 **用户 fork / 复制后自部署** 的 Cloudflare Worker Gateway。车护 PWA **不**把本包打进生产 bundle；应用方 **不**为全体用户运行「正式 Gateway」。

伪代码文件 `src/*.pseudo.ts` 保留作设计对照；可运行实现为 `src/*.ts`（`index.ts` 为入口）。


## ⚠️ Fork 必换 ID（可见警告）

本目录 `wrangler.toml` 里的 **`VEHICLES_DATA_SOURCE_ID` / `RECORDS_DATA_SOURCE_ID` / `TOMBSTONE_KV` id** 仅属于 disposable 测试 Worker `car-care-notion-sync-d1-test`。

**Fork / 复制后必须**：

1. 在你自己的 Notion 建库并 Share 给 Integration，填入**你的** Data Source ID  
2. `wrangler kv namespace create …` 建**你的** KV，替换 `[[kv_namespaces]].id`  
3. `wrangler secret put NOTION_TOKEN` / `GATEWAY_API_KEY`（永不 commit）

直接沿用测试 ID 会导致写错 workspace 或 KV 串租。详见 `wrangler.toml` 顶部横幅注释。

## 你需要准备什么

| 项 | 说明 |
|----|------|
| Cloudflare 账号 | 免费档通常足够个人同步 |
| Notion Internal Integration | [my-integrations](https://www.notion.so/my-integrations) → Token **仅** `wrangler secret put NOTION_TOKEN` |
| 两个 Database | 车辆 / 养护，属性 PascalCase（见下），Share 给该 Integration |
| Gateway API Key | 自设长随机串 → `wrangler secret put GATEWAY_API_KEY`；PWA 每次会话 Bearer 输入 |
| Workers KV | 绑定 `TOMBSTONE_KV`（删除墓碑映射，用户侧持久化） |

## 属性（PascalCase）

`Name` · `AppEntityId` · `AppUpdatedAt` · `AppDeletedAt` · `DeviceId` · `PayloadJson`  
vehicles 额外：`Plate` `EnergyType` `Archived`  
records 额外：`VehicleAppId` `RecordType` `RecordDate` `AmountPaid`

## 端点（MVP Bearer）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 探活（需 Bearer） |
| GET | `/verify` | 连接验证 → `workspaceKey` + dataSources |
| GET | `/sync/pull` | `?entities=vehicles,records` → CloudRow[]（含 KV tombstone） |
| POST | `/sync/push` | 尽力 LWW upsert/delete → PushResult |
| POST | `/sync/snapshot` | 分块 push |
| POST | `/auth/*` | D4 · 501 |

无/错 Key → **401**。CORS 仅 `ALLOWED_ORIGIN`。超长 `PayloadJson` → **失败闭合**（不截断）。429/5xx/写不确定 → **不 ACK**（`errors[].retryable`）。

## Fork / Deploy（约 15–30 分钟）

```bash
# 1) 复制本目录到自有仓库，或在本 monorepo 内仅本地部署
cd docs/templates/notion-sync-worker
npm install

# 2) 创建 KV
npx wrangler kv namespace create car-care-notion-tombstone
# 把返回的 id 写入 wrangler.toml [[kv_namespaces]] id=

# 3) 配置非密 vars（Origin、Data Source ID）—— FORK MUST REPLACE 测试 ID
#    编辑 wrangler.toml [vars] ALLOWED_ORIGIN / VEHICLES_DATA_SOURCE_ID / RECORDS_DATA_SOURCE_ID
#    以及 [[kv_namespaces]] id=（勿沿用 d1-test 的 DS/KV）

# 4) Secrets（永不 commit）
cp .dev.vars.example .dev.vars   # 仅本地 wrangler dev
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put GATEWAY_API_KEY

# 5) 部署到你自己的账号
npx wrangler deploy

# 6) 验证
curl -H "Authorization: Bearer $GATEWAY_API_KEY" https://<your-worker>.workers.dev/verify
```

Node.js **≥ 22**（当前 wrangler 要求）。


## PayloadJson / rich_text 长度

`src/notion.ts` 的 `rt()` 对写入 Notion 的 rich_text 使用 `content.slice(0, 2000)`，这是 **Notion rich_text 单段硬上限的防护性截断**（避免 API 直接 400）。

**业务层失败闭合**：`encodePayloadJson` 在 UTF-16 长度 > 2000 时返回失败；`push` 对 upsert 发 `payload_too_large`（`retryable: false`），**拒绝静默截断业务载荷**。勿把 `rt()` 的 slice 当成「可以随便超长、Gateway 会悄悄砍」的产品行为。

## 本地单测（无需 Notion）

```bash
npm test
```

覆盖：API Key 401、LWW / 防复活 / ambiguous_race、Payload 失败闭合。

## 真 Notion 集成测试（需 Token）

1. 准备测试 workspace + Integration Token（**不要**用生产车数据库）。  
2. `.dev.vars` 填 Token / Key / Data Source ID。  
3. `npx wrangler dev` 后对 `/sync/push` `/sync/pull` 跑夹具；或部署测试 Worker 后 curl。  
4. **Trash 夹具**：push delete → 确认 DS query 是否仍可见；不可见时确认 `TOMBSTONE_KV` 有映射且 retrieve(pageId) 可读；过期 upsert 必须 `skipped_deleted`。  
5. **并发夹具**：两客户端近同时 create 同 `AppEntityId` → 不得静默双页成功；Gateway 对已存在多页返回 `ambiguous_race`。

若环境无 Token：见仓库 `artifacts/m3d-d1-notion-gateway/trash-tombstone-evidence.json` 阻断说明。

## 明确不做

- 不把本目录链进 app Vite 生产构建  
- 不提交真实 token / Gateway Key  
- 不做共享 Public OAuth、不做 Durable Object 必选（O5）  
- 不部署「正式」多租户 Gateway 给全体用户  
- 不改正式 Supabase / PWA NotionProvider 业务接入（属后续切片）

## D1 测试部署（本仓库作者账号 · 仅原型）

- Worker：`car-care-notion-sync-d1-test` · `https://car-care-notion-sync-d1-test.spf-roc.workers.dev`  
- **非**正式服务；未经独立审查不得当生产使用  
- 已配置 `NOTION_TOKEN` 时 `/verify` 返回 200；**勿**把 `*-d1-test` Worker 当生产使用
