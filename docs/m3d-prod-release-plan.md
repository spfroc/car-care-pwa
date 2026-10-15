# M3-D 正式 Gateway 与生产发布方案（计划 · 未执行）

> **状态**：docs-only · **暂不执行任何生产部署**  
> **时间**：2026-10-14 Asia/Shanghai (CST)  
> **用户选择**：B — 准备正式 Gateway 与生产发布方案  
> **验收基线（已冻结）**：
>
> | 项 | 值 |
> |----|-----|
> | App merge SHA（功能 tip） | `c5dcf493eca7a088605ca685fe2e43acf8ca4eaa`（PR #17） |
> | Staging bundle | `index-B32gzRTV.js` @ https://car-test.adobesun.com |
> | Staging 报告 | PR #18 → merge SHA `94f2d11f5b1637fa9b84b2909c42e722ca151dd0` |
> | 生产 car.adobesun.com | **仍为旧 tip** `9b64a2bd` / `index-TdTLY2U-.js`（本方案**不**改） |
> | d1-test Worker | `car-care-notion-sync-d1-test` / `m3d-d1-0.1.1` — **不得**用于生产 |
>
> **配套**：[`m3d-prod-gateway-security-checklist.md`](./m3d-prod-gateway-security-checklist.md) · [`m3d-pr17-car-test-deploy-report.md`](./m3d-pr17-car-test-deploy-report.md) · 模板 [`templates/notion-sync-worker/`](./templates/notion-sync-worker/)  
> **权威设计**：[`m3d-architecture.md`](./m3d-architecture.md) §4.8 / §6 · [`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md)

---

## 0. 硬约束（本 PR 与后续执行均须遵守）

| # | 约束 |
|---|------|
| H1 | **只准备方案**；本 PR **零**生产变更 |
| H2 | **不**修改 https://car.adobesun.com |
| H3 | **不**修改正式 Supabase（schema / 数据 / 配置） |
| H4 | **不**清除用户 IndexedDB / Outbox |
| H5 | **不**将 `car-care-notion-sync-d1-test`（d1-test）用于生产 |
| H6 | **无密钥**进 git / PR / artifacts（Token、Gateway Key、指纹明文密钥均禁止） |
| H7 | 生产 Gateway 与测试 Gateway **资源完全隔离**（Worker / KV / Notion Integration / Data Source / Secrets） |

**本 PR 明确声明**：未部署生产、未创建正式 Worker、未改正式 Gateway / Supabase / 生产静态站。

---

## 1. 目标与非目标

### 1.1 目标

在架构师与安全审查通过、且用户**另行明确授权**后，可按本方案：

1. 部署一台**独立**正式 Cloudflare Worker Gateway（名称/资源均异于 d1-test）。  
2. 将 PWA 生产前端从 `9b64a2bd` / `index-TdTLY2U-.js` 推进到验收 tip `c5dcf49` / 等价生产构建（含 Notion BYO 能力）。  
3. 保证 CORS、密钥、KV tombstone、Notion 工作区与测试环境隔离。  
4. 具备可执行的密钥轮换与双端（Gateway + PWA）回滚流程。

### 1.2 非目标（本阶段不做）

- ❌ 现在执行 `wrangler deploy` / Contabo 解压到 `/var/www/car-care`  
- ❌ 把 d1-test 改名/加 CORS 冒充正式服务  
- ❌ 集中多租户 Gateway / 共享 Public OAuth  
- ❌ 媒体二进制上 Notion  
- ❌ 在未完成 SW1–SW4 **真实双工作区**验收前宣称切换走廊 E2E PASS  

---

## 2. 正式 Gateway：独立部署方案

### 2.1 为何必须独立（禁止复用 d1-test）

| 维度 | d1-test（现状） | 正式 Gateway（计划） |
|------|-----------------|----------------------|
| Worker 名 | `car-care-notion-sync-d1-test` | **新名**，见 §2.2（例：`car-care-notion-sync`） |
| `GATEWAY_VERSION` | `m3d-d1-0.1.1` | 正式版本串（例：`m3d-prod-1.0.0`）；**不得**与 d1-test 同串混用运维 |
| Notion | 测试工作区 + 测试 Data Source ID | **生产工作区** + 新 Integration + 新 DS ID |
| KV | 测试 `TOMBSTONE_KV` id `6ae5cb6d…` | **新建** KV namespace（新 id） |
| Secrets | 测试 `NOTION_TOKEN` / `GATEWAY_API_KEY` | **新** Token / 新 Key（熵独立） |
| CORS | `https://car-test.adobesun.com,http://localhost:5173` | **须含** `https://car.adobesun.com`（可另加 staging/dev） |
| 用途 | Staging / 夹具 / 开发 | 仅生产 PWA 会话指向 |

复制 d1-test 的 DS/KV/Token 会导致：**写错工作区、tombstone 串租、测试密钥进生产流量**。模板横幅已警告：[`wrangler.toml`](./templates/notion-sync-worker/wrangler.toml)「FORK MUST REPLACE」。

### 2.2 推荐资源命名（占位 · 部署时由操作者落定）

| 资源 | 推荐命名 | 备注 |
|------|----------|------|
| Worker `name` | `car-care-notion-sync` | **禁止** `*-d1-test` / `*-test` 后缀用于生产 |
| workers.dev URL | `https://car-care-notion-sync.<account>.workers.dev` | 或自定义域（§2.3） |
| KV namespace | `car-care-notion-tombstone-prod` | `wrangler kv namespace create` 后写入 `[[kv_namespaces]].id` |
| `GATEWAY_VERSION` var | `m3d-prod-1.0.0` | 与健康检查/日志指纹对齐 |
| Notion Integration | 「车护正式同步」类命名 | 仅 Share 生产车辆/养护库；**不** Share 测试库 |

> 操作者可在审查后微调名称，但**不得**与 d1-test 共用任一绑定。

### 2.3 域名

| 选项 | 说明 | 推荐 |
|------|------|------|
| A. `*.workers.dev` | 零 DNS；PWA 填完整 Gateway URL | MVP 可接受 |
| B. 自定义子域（例 `notion-gw.adobesun.com`） | Cloudflare 自定义域 → Worker；TLS 由 CF | 若需品牌/稳定 URL 时采用 |

**PWA 持久化**：仅 `notionGatewayUrl`（+ hint / `workspaceKey`）；**不**持久化 Bearer。  
生产 Origin：`https://car.adobesun.com` 必须出现在正式 Worker `ALLOWED_ORIGIN`。

### 2.4 Secrets（永不进 git）

| Secret | 来源 | 注入方式 |
|--------|------|----------|
| `NOTION_TOKEN` | 正式 Notion Internal Integration | `npx wrangler secret put NOTION_TOKEN`（**生产 Worker 目录/环境**） |
| `GATEWAY_API_KEY` | 操作者生成的长随机串（≥32 字节熵） | `npx wrangler secret put GATEWAY_API_KEY` |

规则：

- 密钥**只**存在于 Cloudflare Secrets / 操作者密码管理器。  
- **禁止**写入 `wrangler.toml`、`.dev.vars` 进仓、PR、聊天记录明文、artifacts。  
- 响应体 / 日志**永不**回显 Token 或 API Key（契约：[`CONTRACT.md`](./templates/notion-sync-worker/CONTRACT.md)）。  
- PWA：每次会话手输 Bearer → 仅内存 `NotionRuntimeSession`。

### 2.5 非密 vars / 绑定（正式 wrangler 草稿形状）

以下为**文档形状**；真实 DS/KV id 在部署授权后由操作者填入**本地** `wrangler.toml`（勿把生产 id 误提交到会复用测试 id 的模板默认值）。

```toml
# 正式 Gateway — 独立于 car-care-notion-sync-d1-test
name = "car-care-notion-sync"
main = "src/index.ts"
compatibility_date = "2026-10-13"
compatibility_flags = ["nodejs_compat"]
workers_dev = true

[vars]
NOTION_VERSION = "2026-03-11"
GATEWAY_VERSION = "m3d-prod-1.0.0"
# 必须含生产 Origin；精确匹配，不反射任意 Origin
ALLOWED_ORIGIN = "https://car.adobesun.com"
# 可选：若同一正式 Worker 也服务 staging 联调，再追加：
# ALLOWED_ORIGIN = "https://car.adobesun.com,https://car-test.adobesun.com"
VEHICLES_DATA_SOURCE_ID = "<PROD_VEHICLES_DS_UUID>"
RECORDS_DATA_SOURCE_ID = "<PROD_RECORDS_DS_UUID>"

[[kv_namespaces]]
binding = "TOMBSTONE_KV"
id = "<PROD_KV_NAMESPACE_ID>"

# Secrets: NOTION_TOKEN, GATEWAY_API_KEY — wrangler secret put only
```

**CORS 强制项**：`https://car.adobesun.com` 必须在列表中。实现为逗号分隔精确匹配（见 `src/cors.ts`）；未匹配 Origin → 无 ACAO / 业务上 403。

> **若正式 Worker 的 `ALLOWED_ORIGIN` 同时含 `https://car-test.adobesun.com`**：CORS 放宽**不等于**可与 d1-test 共用密钥。  
> **醒目强调**：`NOTION_TOKEN` / `GATEWAY_API_KEY` / KV / DS **仍须与 d1-test 严格分离**；staging Origin 仅表示浏览器可调正式 Gateway，**禁止**把 d1-test 的 Key 填进生产会话或反之。

### 2.6 Notion Integration（正式）

1. 在**生产** Notion workspace 创建 Internal Integration（勿复用测试 Integration）。  
2. 创建（或指定）车辆 / 养护两个 Database → Data Source；属性 PascalCase（模板 README）。  
3. 将两库 **Share** 给该 Integration。  
4. Token → 仅 `wrangler secret put NOTION_TOKEN`。  
5. Data Source UUID → 仅写入正式 Worker vars（非 git 默认测试值）。

**隔离检查**：正式 Integration **不得**被邀请进测试库；d1-test Integration **不得**被邀请进生产库。

### 2.7 KV tombstone

- 绑定名固定：`TOMBSTONE_KV`（代码契约）。  
- **新建**生产 namespace；禁止复用 `6ae5cb6d1309453db197b6ce8217e419`。  
- 删除双轨（`in_trash` + `AppDeletedAt`）+ KV 映射；KV `put` 失败须不 ACK（见 [`m3d-d1-risk-report.md`](./m3d-d1-risk-report.md)）。

### 2.8 部署步骤（授权后执行 · 本文档不执行）

> **强制：独立生产配置目录**  
> **禁止**在 `docs/templates/notion-sync-worker`（或任何已入库、默认值为 d1-test 的模板目录）**就地**改 `name` / 绑定后 `wrangler deploy`。  
> 就地改名会污染已入库的 d1-test 默认值，并极易把测试 Worker 当生产部署。  
> 生产配置必须落在：**仓外目录**，或 **gitignore 路径**（例：`docs/templates/notion-sync-worker-prod-local/`，且该路径已在 `.gitignore`）。

```bash
# 0) 仅在用户明确授权「部署正式 Gateway」后进行
# 1) 从模板复制到独立生产配置目录（仓外或 gitignore 路径）— 禁止就地改模板
PROD_GW_DIR="${PROD_GW_DIR:?set to out-of-repo or gitignored path}"
cp -a docs/templates/notion-sync-worker/. "$PROD_GW_DIR/"
cd "$PROD_GW_DIR"
# 2) 仅在本目录编辑 wrangler.toml：name / ALLOWED_ORIGIN / DS ids / KV id
#    （模板目录 docs/templates/notion-sync-worker 保持 d1-test 默认值不动）
npm install
npx wrangler kv namespace create car-care-notion-tombstone-prod
npx wrangler secret put NOTION_TOKEN      # 粘贴正式 Token
npx wrangler secret put GATEWAY_API_KEY   # 粘贴新 Key

# 3) deploy 前强制核对：打印 name，确认 ≠ *-d1-test 且 ≠ 任何测试 Worker 名
echo "=== pre-deploy Worker name check ==="
grep -E '^name\s*=' wrangler.toml
NAME="$(grep -E '^name\s*=' wrangler.toml | head -1 | sed -E 's/^name\s*=\s*"?([^"]+)"?/\1/')"
echo "parsed name=[$NAME]"
case "$NAME" in
  ""|*d1-test*|*d1_test*)
    echo "REFUSE: name empty or looks like d1-test — abort deploy"; exit 1 ;;
  car-care-notion-sync-d1-test|*-test|*-staging|*test*)
    # 生产名禁止测试角色；若审定名含 test 字样须人工复核后改此 case
    echo "REFUSE: name=[$NAME] matches a test Worker pattern — abort deploy"; exit 1 ;;
esac
# 再人工确认：打印值必须等于审定生产名（例 car-care-notion-sync），且 ≠ 任何已知测试 Worker
npx wrangler whoami   # 确认 Cloudflare 账号无误（见检查表 A）
npx wrangler deploy   # 仅当上面 name 核对通过后执行

# 4) 验证（密钥来自本地 env，不写文件进仓）
curl -sS -H "Authorization: Bearer $GATEWAY_API_KEY" \
  "https://car-care-notion-sync.<account>.workers.dev/health"
curl -sS -H "Authorization: Bearer $GATEWAY_API_KEY" \
  "https://car-care-notion-sync.<account>.workers.dev/verify"
# 5) CORS 探针：Origin: https://car.adobesun.com 须 ACAO 回显；evil Origin 不得回显
```

**禁止**：
- 在模板目录就地改 `wrangler.toml` 后 deploy  
- 对 d1-test 执行「改 ALLOWED_ORIGIN 含 car.adobesun.com 然后宣布生产就绪」  
- 在 `wrangler deploy` **前**未打印并核对 `name` ≠ `*-d1-test`（及 ≠ 任何测试 Worker 名）

### 2.9 密钥轮换

| 步骤 | 动作 |
|------|------|
| 1 | 生成新 `GATEWAY_API_KEY`；`wrangler secret put GATEWAY_API_KEY`（覆盖） |
| 2 | 旧 Key 立即 401；所有打开中的 PWA 会话须重输新 Key |
| 3 | 若已启用 D4 JWT：轮换后既有 JWT **全部失效**（须配套 revoke/签发密钥轮换） |
| 4 | Notion Token 泄露：在 Notion 撤销 Integration → 新建 → `secret put NOTION_TOKEN`；旧 Token 失效 |
| 5 | 轮换记录只写运维笔记（时间、操作者、原因）；**不**写密钥值 |

**单用户 MVP 已知代价（轮换无双 Key 窗口）**：当前 Gateway 仅支持单一 `GATEWAY_API_KEY`（覆盖即失效旧值），**无**双 Key 并行宽限期。轮换瞬间，所有已打开会话（含多设备）会短暂**全断**直至用户重输新 Key——此为已知可接受代价，非事故。若未来要零中断轮换，须另设计双 Key / 宽限窗口（超出本 MVP）。

验收对齐：D4.3（[`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md) §2.5）。

### 2.10 Gateway 回滚

| 场景 | 动作 |
|------|------|
| 错误代码版本 | `wrangler rollback`（若账号启用版本）或重新 `deploy` 上一已知良好 commit 的 Worker 源 |
| 错误 Secrets | 再 `secret put` 回上一密钥（从密码管理器）；或轮换到新密钥并通知用户重输 |
| 错误 DS/KV 绑定 | 立即改 vars/绑定并 redeploy；若已写入错误 workspace → **停用**该 Worker 路由，评估 Notion 侧清理（人工） |
| 紧急停用 | Cloudflare Dashboard 暂停 Worker 或移除自定义域；PWA 本地 IDB 仍可用（离线优先） |
| **不回滚到 d1-test** | 生产 PWA **不得**改填 d1-test URL 作为「临时生产」 |

---

## 3. 生产 Gateway ↔ 测试 Gateway 隔离矩阵

| 检查项 | 测试 (d1-test) | 正式 (计划) | 隔离门禁 |
|--------|----------------|-------------|----------|
| Worker name | `car-care-notion-sync-d1-test` | `car-care-notion-sync`（或审定名） | 名称不同；禁止同 Worker 双角色 |
| URL | `…-d1-test.….workers.dev` | 新 URL | PWA 生产配置只指向正式 URL |
| Notion workspace | 测试 | 生产 | Integration / DS 不交叉 Share |
| `NOTION_TOKEN` | 测试 | 生产 | 独立 secret |
| `GATEWAY_API_KEY` | 测试 | 生产 | 独立；用户勿混用 |
| `TOMBSTONE_KV` | `6ae5cb6d…` | 新 id | 禁止复制测试 id |
| `ALLOWED_ORIGIN` | car-test + localhost | **含 car.adobesun.com** | 正式可另含 car-test；测试**可不含**生产 Origin（降低误连） |
| `GATEWAY_VERSION` | `m3d-d1-0.1.1` | `m3d-prod-*` | 健康检查可区分环境 |
| 运维账号 | 可同 CF 账号 | 同账号时靠 **name/绑定** 隔离 | 清单勾选见安全检查表 |

---

## 4. PWA 生产前端部署与回滚方案（授权后）

> **勾选表**：发布当日请同时使用 [`m3d-prod-pwa-release-checklist.md`](./m3d-prod-pwa-release-checklist.md)（含正式/测试 Gateway 不混用强制项）。

### 4.1 部署前条件（全部满足才可申请「发布生产」）

| # | 条件 |
|---|------|
| P0 | 本方案与安全检查表经**独立架构 + 安全审查**通过 |
| P1 | 正式 Gateway 已按 §2 部署且 `/health` `/verify` + CORS（`car.adobesun.com`）PASS；冒烟满足 **FG1–FG3**（switchback `/sync/push` 200 · Outbox 清空 · 数据仅在 A）或用户已按 §8 G5 原样确认接受 SW4 `push200=0` 残余 |
| P2 | 生产构建 tip = `c5dcf49…`（或审查批准的后续 fix tip）；`npm test` / `tsc` / `build` 绿 |
| P3 | Contabo 生产目录备份完成（§4.3） |
| P4 | 用户**明示**授权部署 `https://car.adobesun.com`（口头/指令含该 URL） |
| P5 | 已知残余风险（§7）已向用户披露，且用户接受或已排期补验 |

### 4.2 建议部署步骤（对齐既有 M3-A/B/C 生产报告）

```bash
# 授权后：
git checkout c5dcf493eca7a088605ca685fe2e43acf8ca4eaa   # 或批准 tip
npm ci && npm test && npx tsc -b && npm run build
# 写入 dist/deploy-stamp.txt：git=… bundle=index-….js target=car.adobesun.com approved_by_user=true

ssh -i /home/box/.ssh/contabo_vps root@161.97.138.206
# 备份仅生产：
tar -C /var/www -czf /var/www/car-care-backups/car-care-pre-m3d-$(date +%Y%m%d-%H%M%S).tar.gz car-care
# 部署仅 /var/www/car-care — 勿动 car-care-staging
rm -rf /var/www/car-care/*
# 解压新 dist …
nginx -t
```

公网核对：

- `https://car.adobesun.com/` 引用新 `index-*.js`；stamp = 期望 SHA  
- `https://car-test.adobesun.com/` **不变**（除非另授权）  
- 只读冒烟：首页 / settings / 不主动写正式 Supabase / 不 clear IDB  

### 4.3 回滚（生产静态站）

```bash
ssh -i /home/box/.ssh/contabo_vps root@161.97.138.206
# 可选：先备份当前失败 tip
tar -C /var/www -czf /var/www/car-care-backups/car-care-pre-rollback-$(date +%Y%m%d-%H%M%S).tar.gz car-care
rm -rf /var/www/car-care/*
tar -xzf /var/www/car-care-backups/car-care-pre-m3d-<TIMESTAMP>.tar.gz -C /var/www
# 期望恢复 index-TdTLY2U-.js / 9b64a2bd（若备份点为当前生产）
# 勿动 /var/www/car-care-staging
nginx -t
```

回滚后 curl 确认脚本名回到部署前哈希。用户侧若 SW 缓存旧壳：硬刷新或设置内「更新」。

### 4.4 与 Gateway 的联合回滚顺序

1. 若新前端 + 新 Gateway 同时出问题：**先**回滚 PWA 静态站（用户立即回到旧 tip，无 Notion 正式依赖）。  
2. 再停用/回滚正式 Gateway（避免错误写入生产 Notion）。  
3. **不要**把生产 PWA 指向 d1-test。

---

## 5. Notion ↔ Supabase 互斥切换（代码/文档复核）

对照已合入 tip `c5dcf49` 与架构冻结：

| 要求 | 落点 | 结论 |
|------|------|------|
| 同时只能一个 `CloudProviderId` | `DataStorageSettings.tsx` 注释/逻辑「D2.7: single provider」；`setCloudStorageConfig` 单一 `provider` | **已落实**互斥写入 |
| 禁双写 | architecture §6；engine 单 `resolveProvider` | **设计+实现**一致 |
| 切换保留 Outbox | `switchCorridor.ts` park 模式；**默认不** `clearOutboxForUser` | **已落实** |
| 会话与 enqueue | `isCloudEnqueueEnabled`：notion 需有效会话 + `workspaceKey`；冷启动无 bearer → 不入队 | **已落实**（见 `notion-d2-p2.test.ts`） |
| 媒体 | Notion `getMediaObjectStore` → null；文案禁「完整图文云备份」 | **已落实**方向 |

**残余**：真实用户在生产设备上从 Supabase ↔ Notion 来回切换的长路径 UX，仍依赖设置面板与用户确认；属运维/培训项，非本方案部署阻塞，但应在发布说明中提示。

---

## 6. 旧 Outbox 隔离机制（代码/文档复核）

| 机制 | 落点 | 结论 |
|------|------|------|
| `ownerUserId` = `workspaceKey` | outbox enqueue / verify 映射 | **已落实** |
| flush 仅当前 owner | `listReadyOutbox` + `assertReadyOutboxIsolated` | **单元已覆盖** |
| SW1 断开保留 | `assertDisconnectRetainsOutbox` / `disconnectMustNotClearOutbox` | **单元已覆盖** |
| SW2 park 切换 | `evaluateWorkspaceSwitch(..., mode: 'park')` | **单元已覆盖** |
| SW3 显式丢弃 | `discardParkedOutboxOwner` 需 `confirmToken === 'DISCARD'` | **单元已覆盖** |
| SW4 切回可 flush | `listFlushableForOwner` | **单元已覆盖** |
| 权威规格 | architecture §4.8 · risks SW1–SW4 · `notion-d2-p5.test.ts` 19/19 | 设计闭合 |

**关键残余（必须披露）**：SW1–SW4 **真实双工作区 live 已 PASS**（2026-10-14 · `artifacts/m3d-prod-pre-gates/sw-dual/` · 见 [`m3d-prod-pre-gates-report.md`](./m3d-prod-pre-gates-report.md)）。单元 19/19 仅为支持证据。**剩余残余**：SW4 flush 观测偏软（`push200=0` / `seenOnA=true`）；正式 Gateway/PWA 尚未部署 — 见 §7。

---

## 7. 残余风险（不得隐瞒）

| ID | 风险 | 严重度 | 现状 | 发布含义 |
|----|------|--------|------|----------|
| **RR-SW** | **SW1–SW4 双工作区 live 已 PASS；残余为 flush 观测偏软** | **中**（原「缺 live」已闭合） | pre-gates 2026-10-14：A/B Gateway + 双 wkFp live **PASS**（`artifacts/m3d-prod-pre-gates/sw-dual/`）；SW4 `push200=0` 却 `seenOnA=true`（**禁止**改写成「已验证真实 PWA 推送」） | **正式 Gateway 发布验收条件**：切回 A 后须见 `/sync/push` **200** + 该 owner Outbox 清空 + 数据仅在 A（不漏 B）— 见 checklist FG1–FG3 / pre-gates §5.2；若带残余上线须按 §8 G5 模板原样确认（**不得**再写「无真实双工作区 E2E」） |
| **RR-IDB** | **离线 IDB 探针异常** | 中（非阻断同步主路径） | car-test E2E：`offline.idb_probe` → `IDB.databases` **SecurityError**（离线 context）；**未**清用户 IDB；双向同步 / reonline 仍 PASS | 属探针/自动化环境限制嫌疑；生产前建议在真实浏览器离线场景手工确认 IDB 读写；**不得**为「修探针」而清用户 Outbox |
| R2 | Gateway 无原子 LWW | 高（已知架构） | 尽力先读后写 + M3-C | 产品承诺不得写「强一致」 |
| R10 | 双开撕裂 | 高 | 互斥已实现 | 保持单一 provider |
| R16 | 误清 Outbox | 高 | 默认保留已实现；双工作区 live **已 PASS**（见 RR-SW） | 与 RR-SW 绑定；正式部署前仍防误清 |

来源：[`m3d-pr17-car-test-deploy-report.md`](./m3d-pr17-car-test-deploy-report.md) §4 / §6 · [`artifacts/m3d-pr17-car-test-accept/SUMMARY.md`](../artifacts/m3d-pr17-car-test-accept/SUMMARY.md)。

---

## 8. 建议发布门禁（Go / No-Go）

| 门禁 | Go 条件 |
|------|---------|
| G1 文档 | 本方案 + 安全检查表已 merge；架构师签字 |
| G2 Gateway | 正式 Worker 独立资源；CORS 含 `https://car.adobesun.com`；verify PASS；**非** d1-test |
| G3 密钥 | Secrets 仅 CF；扫描 PR/仓无 Token |
| G4 前端 | tip 批准；测试绿；生产备份完成 |
| G5 风险 | RR-SW live 已 PASS（残余偏软已披露）/ RR-IDB 已披露；正式冒烟须满足 checklist **FG1–FG3**（`/sync/push` 200 + Outbox 清空 + 数据仅在 A）**或** 用户按下方模板**原样确认**接受残余 |
| G6 授权 | 用户明示「部署 car.adobesun.com」+（若同批）「部署正式 Gateway」 |

**G5「带伤上线」书面接受模板（须原样确认，不可改写后算接受）**

> **口径更新（2026-10-14）**：G1 / RR-SW 主缺口（缺真实双工作区 E2E）**已闭合**。本模板**仅**覆盖剩余残余；**禁止**再使用旧短句「SW1–SW4 无真实双工作区 E2E」。

用户须在授权指令中**原样**包含（可另附签名/日期）以下短句，否则「用户接受」**不可执行**、G5 = No-Go：

> 我确认：SW1–SW4 双工作区 live 已 PASS；接受 SW4 flush 证据偏软（push200=0 / seenOnA=true）及正式 Gateway/PWA 尚未部署等残余风险。同意在此条件下带伤上线。

（英译备查，中文原句为准：*I confirm SW1–SW4 dual-workspace live has PASS; I accept soft SW4 flush evidence (push200=0 / seenOnA=true) and that formal Gateway/PWA is not yet deployed; I agree to ship with these remaining gaps.*）

任一 No-Go → **停止**；不得用 d1-test 顶替 G2。

---

## 9. 本 PR 交付物与明确未做

### 9.1 交付物

| 路径 | 内容 |
|------|------|
| `docs/m3d-prod-release-plan.md` | 本文：正式 Gateway 方案、隔离、PWA 部署/回滚、互斥与 Outbox 复核、残余风险、门禁 |
| `docs/m3d-prod-gateway-security-checklist.md` | 安全部署检查表（可打印勾选） |
| `docs/m3d-prod-pwa-release-checklist.md` | 生产 PWA 发布勾选表（备份/指纹/冒烟/回滚/IDB·Outbox 保护/正式·测试不混用） |

### 9.2 明确未做

- 未部署 https://car.adobesun.com  
- 未创建/未部署正式 Cloudflare Worker  
- 未修改 d1-test 配置冒充生产  
- 未修改正式 Supabase  
- 未清除任何用户 IndexedDB / Outbox  
- 无密钥写入本 PR  

---

## 10. 审查请求

请**独立架构师与安全审查**重点核对：

1. 正式 Gateway 是否与 d1-test **资源级**隔离充分。  
2. CORS / Secrets / KV / Notion Share 清单是否可执行且无密钥泄露面。  
3. RR-SW / RR-IDB 是否接受为发布前必须补验，或可带风险上线。  
4. PWA 与 Gateway 回滚顺序是否满足事故响应。

审查通过后，由主 Bot 再向用户申请**单独的生产执行授权**（本文件不构成部署许可）。
