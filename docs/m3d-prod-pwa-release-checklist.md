# M3-D 生产 PWA 发布检查表

> **用途**：在用户**明示授权**部署 `https://car.adobesun.com` 时勾选；本表**不等于**已获授权。  
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
| Z5 | **不**在同一浏览器会话混连正式 Gateway 与测试 Gateway（见 §1） | ☐ |
| Z6 | **不**因「修探针 / 清脏数据」删除用户 Outbox | ☐ |
| Z7 | **不**删除或淡化「正式 Gateway 与 d1-test 共用 workspaceKey」风险披露 | ☐ |

---

## 1. ⚠ 正式 / 测试 Gateway 不混用（强制）

> 正式 Gateway **wkFp=`c647ac0368ff`** 与历史 **d1-test A 相同**（同一 Notion workspace → 同一 `workspaceKey`）。  
> PWA Outbox 按 owner=`workspaceKey` 隔离；**同会话混连**正式与测试 URL/Key 可能导致跨环境直 flush。  
> DS / Integration / KV / Key / Worker URL **仍独立**；跨工作区隔离由 FG3（B wkFp `db38e1e5a251`）证明。

| # | 防护措施 | ✅ |
|---|----------|---|
| M1 | 生产 PWA 仅配置正式 URL：`https://car-care-notion-sync.spf-roc.workers.dev` + 生产 `GATEWAY_API_KEY`（keyFp `aa819deb16dc`） | ☐ |
| M2 | 生产浏览器会话**禁止**填写 / 切换到 `*-d1-test*` Worker URL 或测试 Key | ☐ |
| M3 | 运维：正式与测试 Key/URL **分库存放**；密码管理器标签区分「正式 / 测试」；禁止复制测试 Key 到生产会话 | ☐ |
| M4 | 发布前：若该设备曾连过 d1-test，先**清除本会话 Key**（设置页），确认不丢弃用户 Outbox（默认 park / 保留）；必要时用新浏览器配置文件专用于生产 | ☐ |
| M5 | 测试仅用 `car-test.adobesun.com` + d1-test / d1-test-b；**不得**在生产域做测试夹具写入 | ☐ |
| M6 | 事故时**禁止**「临时把生产指回 d1-test」；按 §5 回滚静态站 / 停正式 Gateway | ☐ |

披露原文见部署报告 §1.1；合入 main 后**必须保留**，不得因 A–E/FG PASS 删除。

---

## 2. 发布前条件

| # | 条件 | ✅ |
|---|------|---|
| P0 | 架构 + 安全独立审查通过（含本表 + Gateway 检查表） | ☐ |
| P1 | 正式 Gateway 仍为已验收版本：`GET /health` → `m3d-prod-1.0.0`；`GET /verify` → 200 · wkFp `c647ac0368ff` · bot「车护正式同步」 | ☐ |
| P2 | CORS：`Origin: https://car.adobesun.com` 有 ACAO；错/无 Bearer → 401 | ☐ |
| P3 | FG1–FG3 证据仍在仓内（`artifacts/m3d-prod-gateway-deploy/fg-dual/`）；**不得**用 pre-gates SW4 `push200=0` 冒充 | ☐ |
| P4 | 批准的生产构建 tip（基线功能 tip `c5dcf49…` 或审查批准后续 SHA）；`npm test` / `tsc` / `build` 绿 | ☐ |
| P5 | Contabo **仅生产**目录备份完成（路径与时间戳记入本表下方） | ☐ |
| P6 | 用户指令**明示**含部署 `https://car.adobesun.com` | ☐ |
| P7 | §1 不混用防护已向用户/运维确认 | ☐ |
| P8 | 已知残余（SW4 历史观测偏软、RR-IDB 探针等）已披露；接受或已排期 | ☐ |

备份记录：

> 路径：________________________________  时间（CST）：____________

批准 tip：

> `________________________________`

---

## 3. 部署步骤（授权后）

| # | 步骤 | ✅ |
|---|------|---|
| D1 | `git checkout <批准 tip>` · `npm ci && npm test && npx tsc -b && npm run build` | ☐ |
| D2 | 写入 `dist/deploy-stamp.txt`（git / bundle / target=car.adobesun.com / approved_by_user=true） | ☐ |
| D3 | SSH 备份 `/var/www/car-care` → `/var/www/car-care-backups/car-care-pre-m3d-<ts>.tar.gz` | ☐ |
| D4 | **仅**更新 `/var/www/car-care`；**勿动** `car-care-staging` | ☐ |
| D5 | `nginx -t` 通过 | ☐ |

---

## 4. 发布后只读冒烟

| # | 检查 | ✅ |
|---|------|---|
| S1 | 公网 `https://car.adobesun.com/` 引用新 `index-*.js`；stamp = 批准 tip | ☐ |
| S2 | `https://car-test.adobesun.com/` **未变**（除非另授权） | ☐ |
| S3 | 首页 / 设置可打开；Notion 与 Supabase **互斥**展示正确 | ☐ |
| S4 | 设置中 Gateway URL = 正式 Worker；**不是** d1-test | ☐ |
| S5 | Bearer **不**出现在导出 JSON | ☐ |
| S6 | **不**主动写正式 Supabase；**不** clear IDB / Outbox | ☐ |
| S7 | （可选）真实浏览器离线读写车辆一条，再上线同步——**不得**为修探针清 IDB | ☐ |

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
| I4 | 同 workspaceKey 风险已读 §1；生产会话不混测 | ☐ |

---

## 7. 签署

| 角色 | 姓名 | 日期 | 结论（Go / No-Go） |
|------|------|------|-------------------|
| 操作者 | | | |
| 架构审查 | | | |
| 安全审查 | | | |
| 用户授权（须含 car.adobesun.com） | | | |

**No-Go 时写明缺项**：

> _______________________________________________________________
