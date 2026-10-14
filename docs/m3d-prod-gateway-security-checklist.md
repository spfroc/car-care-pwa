# M3-D 正式 Gateway 安全部署检查表

> **用途**：正式 Cloudflare Worker Gateway **部署前/后**勾选；供架构与安全审查。  
> **配套总案**：[`m3d-prod-release-plan.md`](./m3d-prod-release-plan.md)  
> **状态**：docs-only · **本检查表本身不授权部署**  
> **基线**：d1-test = `car-care-notion-sync-d1-test` / `m3d-d1-0.1.1` — **勾选任一项前须确认未复用该 Worker**  
> **pre-gates（2026-10-14 CST）**：DEL **PASS** · RR-IDB **PASS** · SW1–SW4 live **PASS**（Gateway B `d1-test-b` · wkFp `db38e1e5a251`）；详见 [`m3d-prod-pre-gates-report.md`](./m3d-prod-pre-gates-report.md)

操作者：____________　日期（CST）：____________　审查人：____________

---

## A. 隔离门禁（全部必须 ✅）

| # | 检查项 | ✅ |
|---|--------|---|
| A1 | 正式 Worker **name** ≠ `car-care-notion-sync-d1-test`，且不含仅测试用途的 `d1-test` 角色 | ☐ |
| A2 | 正式 Worker **URL** 与 d1-test URL 不同；生产 PWA 配置**不**指向 d1-test | ☐ |
| A3 | 新建生产 `TOMBSTONE_KV`；id **≠** `6ae5cb6d1309453db197b6ce8217e419` | ☐ |
| A4 | 生产 Notion **Integration** 独立；Token **≠** 测试 Token | ☐ |
| A5 | 生产 Data Source ID **≠** 模板/测试中的 `68e70331-…` / `dee1f83b-…` | ☐ |
| A6 | 生产 Integration **未** Share 到测试库；测试 Integration **未** Share 到生产库 | ☐ |
| A7 | `GATEWAY_API_KEY` 为新熵；与 d1-test / 任何已泄露演示 Key 不同 | ☐ |
| A8 | `GATEWAY_VERSION` 使用生产串（如 `m3d-prod-1.0.0`），便于与 `m3d-d1-0.1.1` 区分 | ☐ |
| A9 | **deploy 前**：在**独立生产配置目录**（仓外或 gitignore；**非** `docs/templates/notion-sync-worker` 就地）执行 `npx wrangler whoami`，确认账号无误 | ☐ |
| A10 | **deploy 前**：打印并核对 `wrangler.toml` 的 `name` = 审定生产名，且 **≠** `*-d1-test`、**≠** `car-care-notion-sync-d1-test`、**≠** 任何测试 Worker 名后，才执行 `wrangler deploy` | ☐ |

---

## B. 密钥与密钥面（全部必须 ✅）

| # | 检查项 | ✅ |
|---|--------|---|
| B1 | `NOTION_TOKEN` 仅通过 `wrangler secret put` 注入 | ☐ |
| B2 | `GATEWAY_API_KEY` 仅通过 `wrangler secret put` 注入 | ☐ |
| B3 | 仓库 / PR / artifacts / issue 评论中 **无** Token、API Key、`.dev.vars` 真值 | ☐ |
| B4 | `wrangler.toml`（若提交）无 secret 字段；生产 DS/KV 若不宜公开可留本地覆盖 | ☐ |
| B5 | 健康/错误响应抽样：无 Token / Key 回显 | ☐ |
| B6 | 密钥轮换SOP已理解：覆盖 secret → 旧 Key 401 → 用户重输（见总案 §2.9）；单用户 MVP **无双 Key 窗口**，多设备会短暂全断会话（已知代价） | ☐ |
| B7 | 密码管理器已保存生产 Key/Token 备份位置（离线安全介质）；**不**存 git | ☐ |

---

## C. CORS 与网络（全部必须 ✅）

| # | 检查项 | ✅ |
|---|--------|---|
| C1 | `ALLOWED_ORIGIN` **包含** `https://car.adobesun.com`（精确字符串） | ☐ |
| C2 | CORS 实现为允许列表精确匹配（`cors.ts`）；**不**反射任意 `Origin` | ☐ |
| C3 | 探针：`Origin: https://car.adobesun.com` → 有 `Access-Control-Allow-Origin` 回显该值 | ☐ |
| C4 | 探针：`Origin: https://evil.example` → **无**该 Origin 的 ACAO 回显 | ☐ |
| C5 | 无 Bearer / 错 Bearer → **401**（`/health` `/verify` `/sync/*`） | ☐ |
| C6 | 仅 HTTPS 对外（workers.dev 或自定义域）；无 HTTP 明文生产入口 | ☐ |
| C7 | （可选）若正式 Worker 同时服务 staging：列表可含 `https://car-test.adobesun.com`；仍禁止 `*` | ☐ |
| C8 | **醒目**：若 CORS 同时含 car-test，**密钥仍须与 d1-test 严格分离**（Token / Gateway Key / KV / DS 均不可与 d1-test 共用）；CORS 放宽 ≠ 可混用测试密钥 | ☐ |

---

## D. Notion 与数据契约（全部必须 ✅）

| # | 检查项 | ✅ |
|---|--------|---|
| D1 | `NOTION_VERSION` = `2026-03-11` | ☐ |
| D2 | 车辆/养护库属性 PascalCase：`Name` `AppEntityId` `AppUpdatedAt` `AppDeletedAt` `DeviceId` `PayloadJson` + 实体专用列 | ☐ |
| D3 | 两库已 Share 给**生产** Integration；`GET /verify` → 200 + `workspaceKey` | ☐ |
| D4 | Payload 失败闭合：超长 `PayloadJson` **不**静默截断业务成功 | ☐ |
| D5 | 删除双轨 + KV tombstone；KV 失败不 ACK（可幂等重试 delete） | ☐ |
| D6 | 确认生产库**不是**用户日常手改的唯一真相源冲突源时，产品文案仍以 `AppUpdatedAt` 为准 | ☐ |

---

## E. 功能冒烟（部署后 · 用生产 Key · 可丢弃夹具数据）

| # | 检查项 | ✅ |
|---|--------|---|
| E1 | `GET /health` 200；version = 生产 `GATEWAY_VERSION` | ☐ |
| E2 | `GET /verify` 200；记录 **fingerprint**（非明文 Key）备查 | ☐ |
| E3 | 夹具 push/pull 车辆 name+plate 往返（hydrate）PASS | ☐ |
| E4 | 夹具 delete → `skipped_deleted` 防复活 PASS | ☐ |
| E5 | 夹具清理完成；无残留脏页进入真实用户车辆（或使用专用测试页前缀） | ☐ |

---

## F. PWA 生产联动（另需用户明示授权静态站部署）

| # | 检查项 | ✅ |
|---|--------|---|
| F1 | 生产备份 `/var/www/car-care` 已完成且 sha 记录在案 | ☐ |
| F2 | 部署 tip 与审查批准一致（基线功能 tip `c5dcf49…` 或批准后续 SHA） | ☐ |
| F3 | 部署后 stamp / bundle 公网一致；**staging 未误伤**（除非另授权） | ☐ |
| F4 | 未改正式 Supabase；未 clear 用户 IDB/Outbox | ☐ |
| F5 | 设置页：Notion 与 Supabase **互斥**；Bearer 不进导出 JSON | ☐ |
| F6 | 回滚命令已演练文档化（总案 §4.3 / §2.10）；联合回滚顺序：先 PWA 后 Gateway | ☐ |

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

### A–H 待确认 / 待部署授权后

| 节 | 状态 |
|----|------|
| **A** 隔离门禁（正式 Worker/KV/Token/DS） | **待部署授权后** — 本轮未建正式 Gateway |
| **B** 密钥面 | **待部署授权后** — d1-test Key 仅用于测试；生产须新熵 |
| **C** CORS（含 `car.adobesun.com`） | **待部署授权后** — d1-test 现仅 car-test + localhost |
| **D** Notion 生产契约 | **待部署授权后** |
| **E** 正式 Key 冒烟 | **待部署授权后**（E4 行为已在 d1-test 证明） |
| **F** 生产 PWA 联动 | **待部署授权后** — 本轮未动 `car.adobesun.com` |
| **G1** | **闭** — SW1–SW4 live PASS |
| **G2** | 主路径已 PASS；历史探针风险保留披露 |
| **G3** | 已知披露 |
| **G4** | **未**原样确认（已改写为残余风险短句；**不再**要求「无双工作区 E2E」）→ 不可勾 |
| **H** | 本轮遵守（无生产名部署、无清 IDB、无密钥进 git） |

### 第二工作区缺口（SW live）— **已闭合（归档）**

> **2026-10-14 17:22 CST**：Workspace B + Gateway `car-care-notion-sync-d1-test-b` + SW1–SW4 live **PASS**。本附录保留为历史缺口说明，**不得**再当作未完成项。

| 原缺口 | 闭合证据 |
|--------|----------|
| 第二 Notion workspace（`workspace_id` ≠ A） | B wkFp `db38e1e5a251` ← `18eab0db-43db-817c-911a-000390294864`（≠ A `c647ac0368ff`） |
| Integration Token + Vehicles/Records DS | 仓外 `~/.car-care-secrets/m3d-d1-b-notion.env`（密钥未进 git） |
| 测试 Worker `*-d1-test-b`（独立 KV/Key/CORS） | `https://car-care-notion-sync-d1-test-b.spf-roc.workers.dev` keyFp `5d915911b54a` |
| 重跑 live harness | `node scripts/m3d-sw-dual-workspace-live.mjs` → **PASS** |

权威证据目录：[`artifacts/m3d-prod-pre-gates/sw-dual/`](../artifacts/m3d-prod-pre-gates/sw-dual/)（`sw-matrix.json` · `sw-SUMMARY.md` · `sw-dual-final.png`）。

