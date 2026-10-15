# M3-D 正式 Gateway 安全部署检查表

> **用途**：正式 Cloudflare Worker Gateway **部署前/后**勾选；供架构与安全审查。  
> **配套总案**：[`m3d-prod-release-plan.md`](./m3d-prod-release-plan.md)  
> **配套部署报告**：[`m3d-prod-gateway-deploy-report.md`](./m3d-prod-gateway-deploy-report.md)  
> **状态（2026-10-15 CST · 正式环境）**：**PASS**（A–E + FG1–FG3；F N/A）  
> - Worker `car-care-notion-sync` / `m3d-prod-1.0.0` / URL `https://car-care-notion-sync.spf-roc.workers.dev`  
> - KV `car-care-notion-tombstone-prod` id `86eaac822dac…` · keyFp `aa819deb16dc` · token_fp `974ffc15d334` · wkFp `c647ac0368ff`  
> - Integration「车护正式同步」+ DS Share ✅  
> - F 节生产 PWA：**本轮未授权 · N/A**  
> **基线测试（禁止复用）**：d1-test = `car-care-notion-sync-d1-test` / `m3d-d1-0.1.1`  
> **pre-gates（2026-10-14 CST）**：DEL **PASS** · RR-IDB **PASS** · SW1–SW4 live **PASS**（Gateway B `d1-test-b` · wkFp `db38e1e5a251`）；详见 [`m3d-prod-pre-gates-report.md`](./m3d-prod-pre-gates-report.md)

操作者：Grok Bot（box）　日期（CST）：2026-10-15　审查人：____________

---

## A. 隔离门禁（全部必须 ✅）

| # | 检查项 | ✅ |
|---|--------|---|
| A1 | 正式 Worker **name** ≠ `car-care-notion-sync-d1-test`，且不含仅测试用途的 `d1-test` 角色 | ✅ `car-care-notion-sync` |
| A2 | 正式 Worker **URL** 与 d1-test URL 不同；生产 PWA 配置**不**指向 d1-test | ✅ `…car-care-notion-sync.spf-roc.workers.dev`；生产 PWA 未改 |
| A3 | 新建生产 `TOMBSTONE_KV`；id **≠** `6ae5cb6d1309453db197b6ce8217e419` | ✅ `86eaac822dac466aa6f7e3af66447c21` |
| A4 | 生产 Notion **Integration** 独立；Token **≠** 测试 Token | ✅ 「车护正式同步」 token_fp `974ffc15d334` |
| A5 | 生产 Data Source ID **≠** 模板/测试中的 `68e70331-…` / `dee1f83b-…` | ✅ `8a131796-…` / `6aef6240-…` |
| A6 | 生产 Integration **未** Share 到测试库；测试 Integration **未** Share 到生产库 | ✅ 父 agent 核对：测试B DS→404；测试B 无页面权限 |
| A7 | `GATEWAY_API_KEY` 为新熵；与 d1-test / 任何已泄露演示 Key 不同 | ✅ keyFp `aa819deb16dc` |
| A8 | `GATEWAY_VERSION` 使用生产串（如 `m3d-prod-1.0.0`），便于与 `m3d-d1-0.1.1` 区分 | ✅ `m3d-prod-1.0.0` |
| A9 | **deploy 前**：在**独立生产配置目录**（仓外或 gitignore；**非** `docs/templates/notion-sync-worker` 就地）执行 `npx wrangler whoami`，确认账号无误 | ✅ 仓外目录 + MCP whoami `spf_roc@163.com`（本机 wrangler 未登录） |
| A10 | **deploy 前**：打印并核对 `wrangler.toml` 的 `name` = 审定生产名，且 **≠** `*-d1-test`、**≠** `car-care-notion-sync-d1-test`、**≠** 任何测试 Worker 名后，才执行 `wrangler deploy` | ✅ name=`car-care-notion-sync` |

---

## B. 密钥与密钥面（全部必须 ✅）

| # | 检查项 | ✅ |
|---|--------|---|
| B1 | `NOTION_TOKEN` 仅通过 `wrangler secret put` 注入 | ✅ CF MCP secrets |
| B2 | `GATEWAY_API_KEY` 仅通过 `wrangler secret put` 注入 | ✅ CF MCP secrets（等价 secret put） |
| B3 | 仓库 / PR / artifacts / issue 评论中 **无** Token、API Key、`.dev.vars` 真值 | ✅ |
| B4 | `wrangler.toml`（若提交）无 secret 字段；生产 DS/KV 若不宜公开可留本地覆盖 | ✅ 生产 toml 仅仓外 |
| B5 | 健康/错误响应抽样：无 Token / Key 回显 | ✅ |
| B6 | 密钥轮换SOP已理解：覆盖 secret → 旧 Key 401 → 用户重输（见总案 §2.9）；单用户 MVP **无双 Key 窗口**，多设备会短暂全断会话（已知代价） | ✅ |
| B7 | 密码管理器已保存生产 Key/Token 备份位置（离线安全介质）；**不**存 git | ✅ `~/.car-care-secrets/m3d-prod-*.txt` + `m3d-prod-notion.env` |

---

## C. CORS 与网络（全部必须 ✅）

| # | 检查项 | ✅ |
|---|--------|---|
| C1 | `ALLOWED_ORIGIN` **包含** `https://car.adobesun.com`（精确字符串） | ✅ 另含 car-test |
| C2 | CORS 实现为允许列表精确匹配（`cors.ts`）；**不**反射任意 `Origin` | ✅ |
| C3 | 探针：`Origin: https://car.adobesun.com` → 有 `Access-Control-Allow-Origin` 回显该值 | ✅ |
| C4 | 探针：`Origin: https://evil.example` → **无**该 Origin 的 ACAO 回显 | ✅ 403 无 ACAO |
| C5 | 无 Bearer / 错 Bearer → **401**（`/health` `/verify` `/sync/*`） | ✅ `/health` 复测 |
| C6 | 仅 HTTPS 对外（workers.dev 或自定义域）；无 HTTP 明文生产入口 | ✅ |
| C7 | （可选）若正式 Worker 同时服务 staging：列表可含 `https://car-test.adobesun.com`；仍禁止 `*` | ✅ |
| C8 | **醒目**：若 CORS 同时含 car-test，**密钥仍须与 d1-test 严格分离**（Token / Gateway Key / KV / DS 均不可与 d1-test 共用）；CORS 放宽 ≠ 可混用测试密钥 | ✅ |

---

## D. Notion 与数据契约（全部必须 ✅）

| # | 检查项 | ✅ |
|---|--------|---|
| D1 | `NOTION_VERSION` = `2026-03-11` | ✅ |
| D2 | 车辆/养护库属性 PascalCase：`Name` `AppEntityId` `AppUpdatedAt` `AppDeletedAt` `DeviceId` `PayloadJson` + 实体专用列 | ✅ 库已建 |
| D3 | 两库已 Share 给**生产** Integration；`GET /verify` → 200 + `workspaceKey` | ✅ wkFp `c647ac0368ff` |
| D4 | Payload 失败闭合：超长 `PayloadJson` **不**静默截断业务成功 | ✅ 契约 + E3 PayloadJson 往返 |
| D5 | 删除双轨 + KV tombstone；KV 失败不 ACK（可幂等重试 delete） | ✅ E4 skipped_deleted |
| D6 | 确认生产库**不是**用户日常手改的唯一真相源冲突源时，产品文案仍以 `AppUpdatedAt` 为准 | ✅ 披露 |

---

## E. 功能冒烟（部署后 · 用生产 Key · 可丢弃夹具数据）

| # | 检查项 | ✅ |
|---|--------|---|
| E1 | `GET /health` 200；version = 生产 `GATEWAY_VERSION` | ✅ `m3d-prod-1.0.0` |
| E2 | `GET /verify` 200；记录 **fingerprint**（非明文 Key）备查 | ✅ |
| E3 | 夹具 push/pull 车辆 name+plate 往返（hydrate）PASS | ✅ |
| E4 | 夹具 delete → `skipped_deleted` 防复活 PASS | ✅ |
| E5 | 夹具清理完成；无残留脏页进入真实用户车辆（或使用专用测试页前缀） | ✅ `M3D-PROD-FIXTURE-` · live=0 |

---

## F. PWA 生产联动（另需用户明示授权静态站部署）

| # | 检查项 | ✅ |
|---|--------|---|
| F1 | 生产备份 `/var/www/car-care` 已完成且 sha 记录在案 | N/A 本轮未授权生产 PWA |
| F2 | 部署 tip 与审查批准一致（基线功能 tip `c5dcf49…` 或批准后续 SHA） | N/A 本轮未授权生产 PWA |
| F3 | 部署后 stamp / bundle 公网一致；**staging 未误伤**（除非另授权） | N/A 本轮未授权生产 PWA |
| F4 | 未改正式 Supabase；未 clear 用户 IDB/Outbox | ✅ 零变更（本轮） |
| F5 | 设置页：Notion 与 Supabase **互斥**；Bearer 不进导出 JSON | N/A 本轮未授权生产 PWA |
| F6 | 回滚命令已演练文档化（总案 §4.3 / §2.10）；联合回滚顺序：先 PWA 后 Gateway | N/A 本轮未授权生产 PWA（Gateway 回滚见部署报告 §3） |

---

## G. 残余风险披露（签字前必须阅读）

| # | 风险 | 已向用户/审查披露 | ✅ |
|---|------|-------------------|---|
| G1 | **SW1–SW4 真实双工作区 live PASS**（2026-10-14 17:22 CST）— A `d1-test` wkFp `c647ac0368ff` · B `d1-test-b` wkFp `db38e1e5a251`；证据 `artifacts/m3d-prod-pre-gates/sw-dual/` | ☑ |
| G2 | **离线 IDB 探针异常**（历史 `IDB.databases` SecurityError）；**2026-10-14 RR-IDB**：对象仓直读直写 + reonline Outbox sync **PASS**（`artifacts/m3d-prod-pre-gates/rr-idb/`）；未清用户 IDB | ☐ |
| G3 | Gateway LWW 弱于 Supabase RPC；竞态靠 M3-C，不承诺强一致 | ☐ |
| G4 | G1 双工作区 live **已 PASS**；若仍带已知残余（SW4 flush 观测偏软、正式 Gateway/PWA 未部署等）强行生产 → **No-Go**（除非用户按下方模板**原样确认**带伤上线） | ☐ |

**G4「带伤上线」书面接受模板（须原样确认）**

> **口径更新（2026-10-14）**：G1 SW1–SW4 真实双工作区 live **已闭合（PASS）**；不得再写「SW1–SW4 无真实双工作区 E2E」。本模板仅覆盖**剩余残余**。

勾选 G4「用户接受」**仅当**用户授权原文中含以下短句（一字不改；缺任一项则 G4 不可勾、视为未接受）：

> 我确认：SW1–SW4 双工作区 live 已 PASS；接受 SW4 flush 证据偏软（push200=0 / seenOnA=true）及正式 Gateway/PWA 尚未部署等残余风险。同意在此条件下带伤上线。

用户确认原文粘贴处：

> _______________________________________________________________

---

## H. 明确禁止（违规即失败）

- ❌ 将 d1-test Worker 填入生产 PWA Gateway URL  
- ❌ 在 `docs/templates/notion-sync-worker`（已入库 d1-test 默认值）就地改名后 `wrangler deploy`  
- ❌ `wrangler deploy` 前未打印核对 `name` ≠ `*-d1-test` / 测试 Worker 名  
- ❌ 把测试 DS/KV/Token 复制进正式 `wrangler.toml` 并 deploy  
- ❌ 正式 Worker CORS 含 car-test 时仍与 d1-test **共用**密钥  
- ❌ 密钥进 git / PR / 聊天明文  
- ❌ 为「修 IDB 探针」清除用户 Outbox / IndexedDB  
- ❌ 本检查表勾选完成 ≠ 已获生产部署授权（仍须用户明示）  
- ❌ 改写 G4 接受短句后仍勾「用户接受」（必须原样确认）

---

## 签署

| 角色 | 姓名 | 日期 | 结论（Go / No-Go / 带条件 Go） |
|------|------|------|--------------------------------|
| 操作者 | | | |
| 架构审查 | | | |
| 安全审查 | | | |
| 用户授权（部署执行） | | | 另附指令原文 |

**带条件 Go 时必须写明条件**（例如：「正式 Gateway 冒烟补观察 SW4 switchback flush push 200」或「接受 G4 带伤短句所列残余」）：

> _______________________________________________________________

---

## 验收证据附录（pre-gates · 2026-10-14 CST · **不部署**）

操作者：验收执行者（box）　配套报告：[`m3d-prod-pre-gates-report.md`](./m3d-prod-pre-gates-report.md)

### 已用 d1-test / car-test 证明（≠ 正式生产勾选）

| 项 | 结果 | 证据路径 |
|----|------|----------|
| E4 同类：delete → `skipped_deleted` 防复活 | **PASS** | `artifacts/m3d-prod-pre-gates/del/del-matrix.json`（`DEL2_NO_RECREATE`） |
| RR-IDB 断网本地读写 + 恢复同步 | **PASS** | `artifacts/m3d-prod-pre-gates/rr-idb/rr-idb-matrix.json` |
| SW1–SW4 真实双工作区 E2E | **PASS** | `artifacts/m3d-prod-pre-gates/sw-dual/sw-matrix.json` · B URL `…d1-test-b.spf-roc.workers.dev` keyFp `5d915911b54a` wkFp `db38e1e5a251` |
| SW 单测（非 live） | 19/19 PASS | `artifacts/m3d-prod-pre-gates/sw-dual/unit-sw-support.txt` |

### A–H 剩余待授权后执行项（简表）

> **本轮仅归档验收资料 · 零部署。** 下列项**不得**在无用户明示「部署正式 Gateway / 生产 PWA」授权时执行。

| 节 | 剩余项（须授权后执行） | 本轮状态 |
|----|------------------------|----------|
| **A** | 新建正式 Worker / 独立 KV / 生产 Integration+DS / 新 `GATEWAY_API_KEY` / 核对 `wrangler.toml` name≠`*-d1-test` | **PASS** |
| **B** | 生产 Secrets 仅 `wrangler secret put`；密码管理器备份；轮换 SOP | **PASS** |
| **C** | 正式 `ALLOWED_ORIGIN` 含 `https://car.adobesun.com`；CORS/401 探针 | **PASS** |
| **D** | 生产 Notion 契约（`NOTION_VERSION` / Share / Payload / tombstone） | **PASS** |
| **E** | 正式 Key 冒烟（health/verify/夹具 push-pull/delete）；**另见下方「正式 Gateway 发布验收条件」** | **PASS** |
| **F** | 生产备份 + tip 部署 + stamp 公网核对；不改正式 Supabase / 不清用户 IDB | **N/A** — 本轮未授权生产 PWA；Supabase/IDB 零变更 |
| **G1** | — | **已闭** — SW1–SW4 live PASS |
| **G2** | 正式环境手工确认离线 IDB（可选） | 主路径已 PASS；历史探针风险保留披露 |
| **G3** | — | 已知披露（LWW） |
| **G4** | 带伤上线须原样确认短句（含 SW4 `push200=0`） | **未**原样确认 → 不可勾 |
| **H** | 持续遵守禁止项 | 本轮遵守（无生产部署、无清 IDB、无密钥进 git） |

### 正式 Gateway 发布验收条件（强制 · 授权部署后冒烟）

> 交叉引用：[`m3d-prod-pre-gates-report.md`](./m3d-prod-pre-gates-report.md) §5.1 · [`m3d-prod-release-plan.md`](./m3d-prod-release-plan.md) §7 RR-SW / §8 G5。  
> **不得**将 pre-gates SW4（`push200=0` / `seenOnA=true`）改写成「已验证真实 PWA 推送」。

正式 Gateway（及联动 PWA）发布冒烟时，**必须**观测到下列全部条件，方可勾选 E 节相关项 / 宣称 switchback flush 铁证：

| # | 验收条件 | ✅ |
|---|----------|---|
| FG1 | 切回原工作区 A 后，实际产生 **`/sync/push` HTTP 200**（网络层可计数；非仅 `seenOnA`） | ✅ push200=2 browserPushStatus=200 |
| FG2 | 该 owner（`workspaceKey`）的 Outbox **正确清空**（无残留待推条目） | ✅ ownerALeft=0 |
| FG3 | 数据**仅**出现在工作区 A；工作区 B **无**串写 / 泄漏（`leakedB=false` 类断言） | ✅ leakedB=false |

pre-gates SW4 现状（保留披露）：`push200=0` 却 `seenOnA=true` · `leakedB=false` — **隔离硬、flush 观测偏软**；上表 FG1–FG3 为正式发布补验门槛。

### 第二工作区缺口（SW live）— **已闭合（归档）**

> **2026-10-14 17:22 CST**：Workspace B + Gateway `car-care-notion-sync-d1-test-b` + SW1–SW4 live **PASS**。本附录保留为历史缺口说明，**不得**再当作未完成项。

| 原缺口 | 闭合证据 |
|--------|----------|
| 第二 Notion workspace（`workspace_id` ≠ A） | B wkFp `db38e1e5a251` ← `18eab0db-43db-817c-911a-000390294864`（≠ A `c647ac0368ff`） |
| Integration Token + Vehicles/Records DS | 仓外 `~/.car-care-secrets/m3d-d1-b-notion.env`（密钥未进 git） |
| 测试 Worker `*-d1-test-b`（独立 KV/Key/CORS） | `https://car-care-notion-sync-d1-test-b.spf-roc.workers.dev` keyFp `5d915911b54a` |
| 重跑 live harness | `node scripts/m3d-sw-dual-workspace-live.mjs` → **PASS** |

权威证据目录：[`artifacts/m3d-prod-pre-gates/sw-dual/`](../artifacts/m3d-prod-pre-gates/sw-dual/)（`sw-matrix.json` · `sw-SUMMARY.md` · `sw-dual-final.png`）。

