# M3-D 生产发布前验收门禁报告（pre-gates）

> **日期（CST）**：2026-10-14 17:22  
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
| **SW1–SW4** 真实双工作区 E2E | **PASS** | `artifacts/m3d-prod-pre-gates/sw-dual/` + harness `scripts/m3d-sw-dual-workspace-live.mjs` |
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

## 3. SW1–SW4 真实双工作区 — PASS

**不得**用 `notion-d2-p5.test.ts` 单测冒充 live PASS（单测 19/19 仅作支持证据）。本轮为 **真实双 Gateway / 双 workspaceKey** live。

### Gateway B（测试专用）

| 项 | 值 |
|----|-----|
| Worker | `car-care-notion-sync-d1-test-b`（**含** `d1-test-b`；**未**部署正式名 `car-care-notion-sync`） |
| URL | `https://car-care-notion-sync-d1-test-b.spf-roc.workers.dev` |
| version | `m3d-d1b-0.1.0` |
| keyFp | `5d915911b54a`（密钥仓外 `~/.car-care-secrets/m3d-d1-b-gateway-api-key.txt`） |
| wkFp / workspaceKey | `db38e1e5a251` ← `18eab0db-43db-817c-911a-000390294864`（**≠** A 的 `c647ac0368ff`） |
| KV | `car-care-notion-tombstone-d1-test-b` id `fbb4af0a15e1414e931fd949a78df0d8`（独立于 A） |
| 配置目录 | 仓外 `/home/box/.car-care-secrets/notion-sync-worker-d1-test-b/`（自模板复制） |

### Gateway A（确认未改）

| 项 | 值 |
|----|-----|
| URL | `https://car-care-notion-sync-d1-test.spf-roc.workers.dev` |
| version | `m3d-d1-0.1.1`（仍） |
| keyFp | `91dee0d48d59` |
| wkFp | `c647ac0368ff` |
| KV / DS / Token | **未改**（仍绑定测试区 A） |

### Harness

- `scripts/m3d-sw-dual-workspace-live.mjs`（本轮修复：断网不导航、Node 侧 UUID、`syncMeta.cloudUserId`、Outbox `ownerUserId=workspaceKey`、断开文案、SW4 切回 flush）
- Env：`GATEWAY_A_*` / `GATEWAY_B_*` 或 `~/.car-care-secrets/m3d-d1-b-*.txt`

| 项 | 结果 |
|----|------|
| SW0 verify A/B + distinct | PASS `c647ac0368ff` ≠ `db38e1e5a251` |
| **SW1** 断开保留 Outbox | **PASS** |
| **SW2** park 隔离（无误推 B） | **PASS** `push200toB=0` `leakedA=false` |
| **SW3** 无 DISCARD 拒清 / DISCARD 清 orphan | **PASS** |
| **SW4** 切回 A flush（B 无串写） | **PASS** `seenOnA=true` `leakedB=false`（**偏软**：`push200=0`；见 §5.1） |

证据：`artifacts/m3d-prod-pre-gates/sw-dual/sw-matrix.json` · `sw-SUMMARY.md` · `sw-dual-final.png`

---

## 4. Checklist A–H 证据整理

见更新后的 [`m3d-prod-gateway-security-checklist.md`](./m3d-prod-gateway-security-checklist.md)「验收证据附录」。  
**本检查表不授权部署**；A–F 生产项仍为「待部署授权后」。

| 节 | 本轮状态 |
|----|----------|
| A–F 生产部署项 | 待部署授权后（未执行正式 Gateway/PWA） |
| G1 SW 双工作区 | **已闭合（PASS）** |
| G2 RR-IDB | **主路径已 PASS**（对象仓）；`databases()` 历史风险保留披露 |
| G3 LWW | 已知披露，未改 |
| G4 带伤上线 | 模板已改为**仅覆盖残余**（不再写「无双工作区 E2E」）；**未**获用户原样确认 → 不可勾 |
| H 禁止项 | 本轮遵守 |

---

## 5. 未触碰确认

- [x] 未部署 / 未改 `car.adobesun.com`（生产 tip `9b64a2bd`）
- [x] 未部署正式名 Worker `car-care-notion-sync`（无 `-test`）
- [x] 仅新增测试 Worker `car-care-notion-sync-d1-test-b`；**未改** d1-test（A）的 Token/DS/KV/Key
- [x] 未动生产 PWA / 正式 Supabase / `car.adobesun.com`
- [x] 未改正式 Supabase
- [x] 未清用户设备 IDB / Outbox（仅 Playwright 临时上下文）
- [x] 未 redeploy car-test（沿用现网）
- [x] 密钥未进 git / artifacts（仅 keyFp / workspaceFp）

---


## 5.1 发布前应知（非阻塞 · 诚实披露）

下列项**不推翻**本轮 SW1–SW4 / DEL / RR-IDB **PASS**，但正式发布前审查应知情：

| 项 | 说明 | 建议 |
|----|------|------|
| **SW4 flush 证据偏软** | `sw-matrix`：`push200=0` 却 `seenOnA=true`；隔离硬（`leakedB=false`），PWA 双向 flush 观测不够铁 | 正式 Gateway 冒烟补 **switchback flush**，观察真实 `push` 200 |
| **SW3 `removed=?`** | DISCARD 后 `aOwnerLeft=0` 已证明清空；返回摘要未给出精确 `removed` 计数 | 可接受；后续 harness 可补打印 |
| **SW1 `sessionStorage-clear-fallback`** | 断开清除走了 sessionStorage fallback 路径（仍 `retained=1`） | 披露即可；非失败 |
| **DEL 摘要旧 `SW_NOTE` 残留** | `artifacts/m3d-prod-pre-gates/del/*` 仍写「单测覆盖、不能 dual-tenant live」——属 DEL 跑次当时口径；**已被**本轮 `sw-dual/` live PASS **取代**，勿再当现状 | 以 `sw-dual/` 与本报告 §3 为准 |

## 6. 后续

1. ~~第二工作区 + Gateway B~~ **已完成**；SW1–SW4 live **PASS**。
2. Checklist G1 已闭合；A–F 生产部署项仍待**显式部署授权**。
3. 本轮**未**开业务 fix PR（缺陷仅在验收 harness，已在本 docs 分支修复）。
4. **不要 merge** 至生产部署，直至用户按 checklist 完成 Go /（若适用）改写后的带伤残余确认与部署授权。
5. 正式 Gateway 冒烟时优先补观察 SW4 switchback flush 的 `push` 200（见 §5.1）。
