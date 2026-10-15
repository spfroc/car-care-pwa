# M3-D 生产 PWA 发布检查表

> **用途**：在用户**明示授权**部署 `https://car.adobesun.com` 时勾选。  
> **⚠ 勾选完成 ≠ 用户部署授权**——仍须指令原文明示含该生产 URL；本表仅供审查与执行核对。  
> **配套**：[`m3d-prod-release-plan.md`](./m3d-prod-release-plan.md) §4 · [`m3d-prod-gateway-security-checklist.md`](./m3d-prod-gateway-security-checklist.md) · [`m3d-prod-gateway-deploy-report.md`](./m3d-prod-gateway-deploy-report.md)  
> **正式 Gateway（已归档验收）**：`car-care-notion-sync` / `m3d-prod-1.0.0` · URL `https://car-care-notion-sync.spf-roc.workers.dev` · keyFp `aa819deb16dc` · wkFp `c647ac0368ff`  
> **当前生产静态指纹（未改前基线）**：`/assets/index-TdTLY2U-.js` · `/assets/index-DUfOadJ-.css`

操作者：____________　日期（CST）：____________　审查人：____________

---

## 0. 硬禁（勾选任一项违规 → No-Go）

| # | 禁止项 | ✅ 遵守 |
|---|--------|--------|
| Z1 | **不**在未获用户明示「部署 car.adobesun.com」授权时改生产静态站 | ☐ |
| Z2 | **不**改正式 Supabase（schema / 数据 / 密钥） | ☐ |
| Z3 | **不**清除用户 IndexedDB / Outbox / 本地车辆数据 | ☐ |
| Z4 | **不**把生产 PWA 的 Gateway URL/Key 填成 d1-test / d1-test-b | ☐ |
| Z5 | **不**在同一浏览器会话混连正式 Gateway 与测试 Gateway（见 §1 / §1A） | ☐ |
| Z6 | **不**因「修探针 / 清脏数据」删除用户 Outbox | ☐ |
| Z7 | **不**删除或淡化「正式 Gateway 与 d1-test 共用 workspaceKey」风险披露（含 §1A RR-WK） | ☐ |
| Z8 | d1-test / d1-test-b 的 `ALLOWED_ORIGIN` **不得**含 `https://car.adobesun.com`（见 §2A）；已含 → **No-Go** 直至去掉 | ☐ |

---

## 1. ⚠ 正式 / 测试 Gateway 不混用（操作规范 · 强制）

> 正式 Gateway **wkFp=`c647ac0368ff`** 与历史 **d1-test A 相同**（同一 Notion workspace → 同一 `workspaceKey`）。  
> PWA Outbox 按 owner=`workspaceKey` 隔离；**同会话混连**正式与测试 URL/Key 可能导致跨环境直 flush。  
> DS / Integration / KV / Key / Worker URL **仍独立**；跨工作区隔离由 FG3（B wkFp `db38e1e5a251`）证明。  
> **仅操作规范 ≠ 技术隔离**——详见 §1A RR-WK。

| # | 防护措施 | ✅ |
|---|----------|---|
| M1 | 生产 PWA 仅配置正式 URL：`https://car-care-notion-sync.spf-roc.workers.dev` + 生产 `GATEWAY_API_KEY`（keyFp `aa819deb16dc`） | ☐ |
| M2 | 生产浏览器会话**禁止**填写 / 切换到 `*-d1-test*` Worker URL 或测试 Key | ☐ |
| M3 | 运维：正式与测试 Key/URL **分库存放**；密码管理器标签区分「正式 / 测试」；禁止复制测试 Key 到生产会话 | ☐ |
| M4 | 发布前：若该设备曾连过 d1-test，先在设置页**清除本会话 Key**。**清会话 Key ≠ 清 Outbox**（默认 park / 保留 Outbox；不得借机 `clearOutboxForUser`）。必要时用新浏览器配置文件专用于生产 | ☐ |
| M5 | 测试仅用 `car-test.adobesun.com` + d1-test / d1-test-b；**不得**在生产域做测试夹具写入 | ☐ |
| M6 | 事故时**禁止**「临时把生产指回 d1-test」；按 §5 回滚静态站 / 停正式 Gateway | ☐ |

披露原文见部署报告 §1.1；合入 main 后**必须保留**，不得因 A–E/FG PASS 删除。

---

## 1A. RR-WK — 共用 workspaceKey 残余风险（高 / 已知）

| 项 | 内容 |
|----|------|
| 风险 ID | **RR-WK** |
| 等级 | **高 / 已知** |
| 事实 | 正式 Gateway wkFp(A)=`c647ac0368ff` **≡** 历史 d1-test A（同一 Notion workspace → 同一 `workspaceKey`） |
| 后果 | Outbox 按 owner=`workspaceKey` 隔离；同浏览器会话若混连正式与测试 Gateway URL/Key，可能对同一 owner **跨环境直 flush** |
| 口径 | **仅操作规范 ≠ 技术隔离**。§1 的 M1–M6 降低人为失误，**不**在协议/存储层阻止误配 flush |

### 技术选项（任选其一可降为「有技术隔离」；本轮未做则须用户原样确认）

| 选项 | 做法 |
|------|------|
| ① 独立工作区 | 正式 Gateway 绑定**独立生产 Notion 工作区**，使 wkFp **≠** d1-test（彻底分离 `workspaceKey`） |
| ② 端点指纹 | Outbox enqueue 时记录 **Gateway+Workspace 复合身份**（`/verify` 盖印的 `gatewayKeyFp` + `workspaceKey` → `notionTargetId`；**非**仅用户手填 URL）；flush 时与当前已验证会话不一致则**拒发** / park 孤儿。设计见 [`m3d-rr-wk-outbox-gateway-identity.md`](./m3d-rr-wk-outbox-gateway-identity.md)（Phase 0；代码未落地前仍须 WK3 或本选项实现证据） |

### 用户接受（本轮不修代码 / 不换工作区时）

勾选「用户接受」**仅当**用户授权原文中含以下短句（**一字不改**；缺任一字则不可勾、视为未接受）：

> 我确认：正式 Gateway 与 d1-test 共用 workspaceKey；接受同会话混连可跨环境 flush 的风险；同意在仅操作规范防护下发布生产 PWA。

| # | 检查 | ✅ |
|---|------|---|
| WK1 | 已向用户/审查披露 RR-WK（本表 + 部署报告 §1.1） | ☐ |
| WK2 | 本轮已落地选项 ① 或 ②（若是：在下方注明证据；可跳过 WK3） | ☐ / N/A |
| WK3 | **用户接受**：授权原文含上方短句（一字不改）→ 方可勾 | ☐ |
| WK4 | 用户确认原文粘贴处（或 PR/指令链接）：见下方 | ☐ |

用户确认原文粘贴处：

> _______________________________________________________________

若 WK2=N/A 且 WK3 未勾 → **生产 PWA No-Go**（即使其余项全绿）。

---

## 2. 发布前条件

| # | 条件 | ✅ |
|---|------|---|
| P0 | 架构 + 安全独立审查通过（含本表 + Gateway 检查表） | ☐ |
| P1 | 正式 Gateway 仍为已验收版本：`GET /health` → `m3d-prod-1.0.0`；`GET /verify` → 200 · wkFp `c647ac0368ff` · bot「车护正式同步」 | ☐ |
| P2 | CORS：`Origin: https://car.adobesun.com` 有 ACAO；错/无 Bearer → 401 | ☐ |
| P3 | FG1–FG3 证据仍在仓内（`artifacts/m3d-prod-gateway-deploy/fg-dual/`）；**不得**用 pre-gates SW4 `push200=0` 冒充 | ☐ |
| P4 | 批准 tip / 构建产物已填入 **§2B**；`npm test` / `tsc` / `build` 绿 | ☐ |
| P5 | Contabo **仅生产**目录备份完成（路径与时间戳记入 §2B） | ☐ |
| P6 | 用户指令**明示**含部署 `https://car.adobesun.com`（**勾选本表 ≠ 该项自动满足**） | ☐ |
| P7 | §1 不混用操作规范已向用户/运维确认 | ☐ |
| P8 | §1A RR-WK：已落地 ①/② **或** WK3 用户原样确认已勾 | ☐ |
| P9 | §2A 测试 Worker Origin 门禁 **PASS**（d1-test / d1-test-b 均不含生产 Origin） | ☐ |
| P10 | 其他已知残余（SW4 历史观测偏软、RR-IDB 探针等）已披露；接受或已排期 | ☐ |

---

## 2A. 可验门禁 — 测试 Worker `ALLOWED_ORIGIN` 不含生产域

> **要求**：`car-care-notion-sync-d1-test` 与 `car-care-notion-sync-d1-test-b` 的 `ALLOWED_ORIGIN`（或等价 CORS 配置）**不得**包含 `https://car.adobesun.com`。  
> 若任一已含 → **No-Go**，直至从测试 Worker 配置中去掉并重新部署/验证。

### 探针步骤（任选其一或并用；记录结果到表内）

**A. 运行时 OPTIONS（推荐）**

```bash
# 期望：测试 Worker 对生产 Origin 不回 Access-Control-Allow-Origin: https://car.adobesun.com
# （无 ACAO、或 ACAO 仅为 car-test/localhost 等测试域 → PASS；出现生产域 → FAIL/No-Go）

curl -sS -D- -o /dev/null -X OPTIONS \
  -H 'Origin: https://car.adobesun.com' \
  -H 'Access-Control-Request-Method: GET' \
  'https://car-care-notion-sync-d1-test.spf-roc.workers.dev/health'

curl -sS -D- -o /dev/null -X OPTIONS \
  -H 'Origin: https://car.adobesun.com' \
  -H 'Access-Control-Request-Method: GET' \
  'https://car-care-notion-sync-d1-test-b.spf-roc.workers.dev/health'
```

**B. 带 Origin 的 GET /health**

```bash
curl -sS -D- -o /tmp/d1-health-body.txt \
  -H 'Origin: https://car.adobesun.com' \
  'https://car-care-notion-sync-d1-test.spf-roc.workers.dev/health'
# 检查响应头 ACAO 是否等于 https://car.adobesun.com
```

**C. 配置只读**：仓外 `wrangler.toml` / vars / Dashboard 中读取 `ALLOWED_ORIGIN`，确认列表无 `https://car.adobesun.com`（可与 A/B 交叉）。

| Worker | 探针方式 (A/B/C) | ACAO 含 car.adobesun.com？ | 结论 |
|--------|------------------|---------------------------|------|
| d1-test | ____ | 是 / **否** | PASS / **No-Go** |
| d1-test-b | ____ | 是 / **否** | PASS / **No-Go** |

记录时间（CST）：____________　操作者：____________

---

## 2B. 版本指纹填写栏（S1 必须与之逐字一致）

| 字段 | 发布前填写 | 部署后公网实读 |
|------|------------|----------------|
| 批准 tip（完整 SHA） | `________________________________` | （与左栏相同，或写 stamp 内 git=） |
| 构建产物 `index-*.js` 文件名 | `index-____________________.js` | `index-____________________.js` |
| （可选）该 js 的 sha256 | `________________________________` | `________________________________` |
| `deploy-stamp.txt` 期望内容摘要 | git=… bundle=… target=car.adobesun.com | 公网实读：____________ |
| 生产目录备份路径 | `/var/www/car-care-backups/…` | — |
| 备份时间（CST） | ____________ | — |

**S1 判定**：公网 HTML 引用的 `index-*.js` 文件名、以及 stamp（若暴露）须与上表「发布前填写 / 部署后实读」**逐字一致**；不一致 → 冒烟 FAIL / 回滚。

基线（本轮未发布前）：`index-TdTLY2U-.js` — 仅作回滚对照，**不是**新发布期望值。

---

## 3. 部署步骤（授权后）

| # | 步骤 | ✅ |
|---|------|---|
| D1 | `git checkout <§2B 批准 tip>` · `npm ci && npm test && npx tsc -b && npm run build` | ☐ |
| D2 | 将产物 `index-*.js` 文件名（及可选 sha256）填入 §2B「发布前」栏；写入 `dist/deploy-stamp.txt` | ☐ |
| D3 | SSH 备份 `/var/www/car-care` → `/var/www/car-care-backups/car-care-pre-m3d-<ts>.tar.gz`（填 §2B） | ☐ |
| D4 | **仅**更新 `/var/www/car-care`；**勿动** `car-care-staging` | ☐ |
| D5 | `nginx -t` 通过 | ☐ |

---

## 4. 发布后只读冒烟

| # | 检查 | ✅ |
|---|------|---|
| S1 | 公网 `https://car.adobesun.com/` 引用的 `index-*.js` **及** stamp/bundle 实读值与 **§2B 逐字一致** | ☐ |
| S2 | `https://car-test.adobesun.com/` **未变**（除非另授权） | ☐ |
| S3 | 首页 / 设置可打开；Notion 与 Supabase **互斥**展示正确 | ☐ |
| S4 | **仅当用户已配置 Notion 时**：设置中 Gateway URL = 正式 Worker、**不是** d1-test。若尚未配置 Notion（空配置）→ **PASS**（记「未配置」） | ☐ |
| S5 | Bearer **不**出现在导出 JSON | ☐ |
| S6 | **不**主动写正式 Supabase；**不** clear IDB / Outbox | ☐ |
| S7 | （可选）真实浏览器离线读写车辆一条，再上线同步——**不得**为修探针清 IDB | ☐ |

S4 实况：已配置 Notion / 未配置（空配置 PASS）　____________

---

## 5. 回滚

| # | 动作 | ✅ |
|---|------|---|
| R1 | 先回滚生产静态站（恢复备份 tar；确认脚本名回基线，当前基线含 `index-TdTLY2U-.js`） | ☐ |
| R2 | 再视需要暂停/回滚正式 Gateway（Dashboard Versions / Pause）；**禁止**回滚到 d1-test 当生产 | ☐ |
| R3 | 用户侧硬刷新或设置内「更新」清 SW 旧壳 | ☐ |
| R4 | 回滚后再次确认生产未指向测试 Gateway | ☐ |

联合回滚顺序：**PWA 静态站 → Gateway**（见 release-plan §4.4）。

---

## 6. IndexedDB / Outbox 保护

| # | 要求 | ✅ |
|---|------|---|
| I1 | 默认切换 Corridor **保留** Outbox（park）；不调用 `clearOutboxForUser` 除非用户显式 DISCARD | ☐ |
| I2 | 发布/回滚脚本与运维手册**无**「清除 IDB」步骤 | ☐ |
| I3 | 自动化只用临时 Playwright context；不碰用户真实配置文件 | ☐ |
| I4 | 同 workspaceKey 风险已读 §1 / §1A；生产会话不混测；**清会话 Key ≠ 清 Outbox** | ☐ |

---

## 7. 签署

| 角色 | 姓名 | 日期 | 结论（Go / No-Go） |
|------|------|------|-------------------|
| 操作者 | | | |
| 架构审查 | | | |
| 安全审查 | | | |
| 用户授权（须含 car.adobesun.com；若未做 RR-WK ①/② 还须含 §1A 短句） | | | |

**带条件 Go 时写明条件**（例如：「RR-WK 仅操作规范 + 用户已原样确认」「§2A 探针已 PASS」）：

> _______________________________________________________________

**No-Go 时写明缺项**：

> _______________________________________________________________
