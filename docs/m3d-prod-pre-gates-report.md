# M3-D 生产发布前验收门禁报告（pre-gates）

> **日期（CST）**：2026-10-14 17:01  
> **操作者**：车护助手验收执行者（box）  
> **基线 main tip**：`3a7cd2ac…`（PR #19 docs merge）  
> **功能 tip（car-test）**：`c5dcf49…` / `index-B32gzRTV.js`（**本轮未 redeploy**）  
> **分支**：`docs/m3d-prod-gate-acceptance`  
> **硬禁令遵守**：未部署正式 Gateway / 生产 PWA；未改正式 Supabase；未清用户 IDB/Outbox；密钥仅指纹。

## 总览

| 门禁 | 结果 | 证据 |
|------|------|------|
| **DEL 防复活**（`skipped_deleted`） | **PASS** | `artifacts/m3d-prod-pre-gates/del/` |
| **RR-IDB**（断网本地读写 + 恢复同步） | **PASS** | `artifacts/m3d-prod-pre-gates/rr-idb/` |
| **SW1–SW4** 真实双工作区 E2E | **BLOCKED** | `artifacts/m3d-prod-pre-gates/sw-dual/` + harness `scripts/m3d-sw-dual-workspace-live.mjs` |
| SW 单测（**非** live PASS） | 19/19 PASS（支持证据） | `artifacts/m3d-prod-pre-gates/sw-dual/unit-sw-support.txt` |

**本轮未开业务 fix PR**（未发现需改正式产品代码的缺陷；RR-IDB 先前 `IDB.databases` 失败属自动化探针/导航上下文问题，已用对象仓直读直写主路径闭合）。

---

## 1. DEL 防复活 — PASS

- **Gateway**：`https://car-care-notion-sync-d1-test.spf-roc.workers.dev`
- **keyFp**：`91dee0d48d59` · **workspaceFp**：`c647ac0368ff` · version `m3d-d1-0.1.1`
- **脚本**：`scripts/m3d-d2-p5-live-map-switch.mjs`
- **关键断言**：设备 A delete 后，设备 B 旧 `upsert`（`mutatedAt` 早于 delete）→ `applied=[]`，`conflicts[].reason === "skipped_deleted"`（步骤 `DEL2_NO_RECREATE`）
- **日志**：`artifacts/m3d-prod-pre-gates/del/del-matrix.json` · `del-console.txt` · `del-SUMMARY.md`

| 步骤 | 结果 |
|------|------|
| G1_verify | PASS |
| CREATE / PULL_ALIVE | PASS |
| DEL1_DELETE_PUSH | PASS |
| DEL1_PULL_TOMBSTONE | PASS（pull 可省略 trash；KV tombstone 由 DEL2 证明） |
| **DEL2_NO_RECREATE** | **PASS** `skipped_deleted` |
| DEL3 restore | PASS |

---

## 2. RR-IDB — PASS

- **目标**：`https://car-test.adobesun.com` + d1-test Gateway（Playwright + Chrome；**临时浏览器配置**，**未**清用户设备 IDB）
- **脚本**：`scripts/m3d-rr-idb-live.mjs`
- **方法**：在线创建 → 已加载 `/vehicles` 后 `setOffline(true)`（**断网后不导航**，避免 opaque 文档导致 IDB 拒绝）→ `indexedDB.open('car-care-db')` 对象仓读写 + Outbox 入队 → 恢复联网双向同步 → Gateway pull 见离线改名
- **禁止项**：全程无 `clear` storage / 无清 Outbox / 无清 IDB

| 步骤 | 结果 |
|------|------|
| browser.verify | PASS |
| online.idb_objectstore_read | PASS |
| offline.shell_reachable | PASS |
| offline.idb_databases_probe | PASS（本轮在已加载文档上亦 PASS；历史 SecurityError 记为探针风险） |
| **offline.idb_objectstore_rw** | **PASS** `readName=…-OFF` `outboxCount=1` |
| offline.ui_reads_local | PASS |
| **reonline.outbox_sync** | **PASS** push 200 + pull 200 |
| reonline.idb_intact | PASS |
| api.pull_after_reonline | PASS |

证据：`artifacts/m3d-prod-pre-gates/rr-idb/rr-idb-matrix.json` · `rr-idb-SUMMARY.md` · `rr-idb.png`

---

## 3. SW1–SW4 真实双工作区 — BLOCKED

**不得**用 `notion-d2-p5.test.ts` 单测冒充 live PASS（本轮单测 19/19 仅作支持证据）。

### Harness（已就绪）

- `scripts/m3d-sw-dual-workspace-live.mjs`
- Env 驱动：`GATEWAY_A_URL` / `GATEWAY_A_KEY`（默认 d1-test）  
  `GATEWAY_B_URL` / `GATEWAY_B_KEY`  
  或 `~/.car-care-secrets/m3d-d1-b-notion.env` / `m3d-d1-b-gateway-url.txt` + `m3d-d1-b-gateway-api-key.txt`
- 要求 A/B `/verify` 得到 **不同** `workspaceKey`；执行 SW1 断开保留 / SW2 park 隔离 / SW3 DISCARD / SW4 切回 flush；断言两侧无串写

### 精确缺口（一句话）

缺第二 Notion workspace（不同 `workspace_id`）+ Integration Token/DS ids + 测试 Worker `*-d1-test-b` URL/Key（写入 `~/.car-care-secrets/m3d-d1-b-notion.env` 后即可重跑 live）。

当前 Cloudflare 仅有 `car-care-notion-sync-d1-test`；Notion MCP 仅连主区 `90da532e-…`（fp `c647ac0368ff`）。主 Bot 正在处理第二工作区登录/交接。

| 项 | 结果 |
|----|------|
| SW1 | BLOCKED |
| SW2 | BLOCKED |
| SW3 | BLOCKED |
| SW4 | BLOCKED |
| SUPPORT_verify_A | PASS `wkFp=c647ac0368ff` |

证据：`artifacts/m3d-prod-pre-gates/sw-dual/sw-matrix.json` · `sw-SUMMARY.md`

---

## 4. Checklist A–H 证据整理

见更新后的 [`m3d-prod-gateway-security-checklist.md`](./m3d-prod-gateway-security-checklist.md)「验收证据附录」。  
**本检查表不授权部署**；A–F 生产项仍为「待部署授权后」。

| 节 | 本轮状态 |
|----|----------|
| A–F 生产部署项 | 待部署授权后（未执行正式 Gateway/PWA） |
| G1 SW 双工作区 | **仍开**（BLOCKED，等第二工作区） |
| G2 RR-IDB | **主路径已 PASS**（对象仓）；`databases()` 历史风险保留披露 |
| G3 LWW | 已知披露，未改 |
| G4 带伤上线 | **未**获用户原样确认短句 → 不可勾 |
| H 禁止项 | 本轮遵守 |

---

## 5. 未触碰确认

- [x] 未部署 / 未改 `car.adobesun.com`（生产 tip `9b64a2bd`）
- [x] 未部署正式名 Worker `car-care-notion-sync`（无 `-test`）
- [x] 未改正式 Supabase
- [x] 未清用户设备 IDB / Outbox（仅 Playwright 临时上下文）
- [x] 未 redeploy car-test（沿用现网）
- [x] 密钥未进 git / artifacts（仅 keyFp / workspaceFp）

---

## 6. 后续（等主 Bot 通知）

1. 写入 `~/.car-care-secrets/m3d-d1-b-notion.env`（及可选独立 `d1-test-b` Worker）后执行：  
   `node scripts/m3d-sw-dual-workspace-live.mjs`
2. 若 SW live PASS → 更新本报告 + checklist G1 → 可再提补充 PR；若产品缺陷 → **独立 `fix/…` PR 并停下申请审查（不 merge）**。
