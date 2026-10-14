# M3-D D1 风险报告 · Notion BYO Gateway 原型

> **日期**：2026-10-14（Asia/Shanghai）· M1 Trash 闭环更新  
> **范围**：用户自有 Cloudflare Worker 参考实现 + 测试 workspace 夹具  
> **纪律**：PR **未经独立审查不得 merge**；**不得**部署正式多租户 Gateway；**不得**改正式 Supabase `tqjowsffppgoqtdokbzp`；**不得**接 PWA NotionProvider 生产路径。

## 1. 交付摘要

| 项 | 结果 |
|----|------|
| 设计 PR #8 | 已 squash/merge 习惯一致的 **merge commit** `15ee4c6143793e8aa134fe2412bf8746b2573256`；diff **仅 docs**；未部署任何站 |
| D1 分支 | `feature/m3d-d1-notion-gateway` · 路径 `docs/templates/notion-sync-worker/` |
| 测试 Worker | `car-care-notion-sync-d1-test` · `https://car-care-notion-sync-d1-test.spf-roc.workers.dev`（用户 CF 账号原型，非正式服务） |
| 单测 | `npm test` · 12+ pass（auth / LWW / payload） |
| **M1 Trash 硬门** | **已关闭（live PASS）** · 见 `artifacts/m3d-d1-notion-gateway/trash-tombstone-evidence.json` |

## 2. 必测项结论

### 2.1 Trash / Tombstone（M1 已关闭）

| | |
|--|--|
| **证据** | `artifacts/m3d-d1-notion-gateway/trash-tombstone-evidence.json` · `soft-delete-property-fixture.json` |
| **文档结论** | Data Source query **默认不含** trash；`in_trash` 非 DS query 参数；需 `search?in_trash` 或 **retrieve(pageId)** + **用户自有 KV 墓碑映射** |
| **实现** | 删除双轨 + `TOMBSTONE_KV`（namespace `6ae5cb6d1309453db197b6ce8217e419`）· pull 合并 KV · 防过期 upsert 复活 |
| **Live M1（2026-10-14）** | ① push delete → Notion `in_trash:true` + `AppDeletedAt` **PASS** · ② DS query 隐藏行 + KV 映射存在 + `retrieve(pageId)` 仍见 tombstone **PASS** · ③ 过期 upsert → `skipped_deleted`（未复活）**PASS** |
| **夹具** | `AppEntityId=veh-trash-m1-1791956900358` · pageId `3f9620fb-d01f-8151-8783-fbbbeaf1a17c` · Gateway `/verify` Notion connected |
| **属性墓碑** | 另有 `veh-tombstone-001`（仅 `AppDeletedAt`）夹具仍有效；Gateway 将其视为 tombstone |

**客户端重试（architect 建议）**：Trash 在 Notion 已成功后，若随后 **KV `put` 失败**，Worker 对该 op 返回 **500 / 不 ACK**。客户端必须 **幂等重试** 同一 delete（再 push），以便补写 KV 墓碑；不得在未 ACK 时从 outbox 丢弃。

### 2.2 并发 create/update

| | |
|--|--|
| **证据** | `artifacts/m3d-d1-notion-gateway/concurrency-duplicate-pages.json` |
| **真实现象** | 同一 `AppEntityId=veh-concurrent-001` 在 Vehicles DS **成功存在两页**（device-A @05:00Z 与 device-B @05:10Z） |
| **MVP 一致性保证** | **尽力 LWW**：同批同 id 串行；先 query 再 create/patch；云端较新 → `cloud_newer` 不写；**多页** → `ambiguous_race` **拒绝静默成功** |
| **不保证** | 跨 Worker isolate 强一致 / 零双页（O5 Durable Object 非 MVP） |
| **产品含义** | 危险竞态不得 ACK 为成功；交由客户端 M3-C / 用户处理 |

### 2.3 Gateway 认证 / CORS（真 Worker）

证据：`artifacts/m3d-d1-notion-gateway/gateway-auth-cors.json`

- 无 Key / 错 Key → **401**  
- 合法 Key → `/health` 200  
- Origin 不匹配 → **403**；匹配 `ALLOWED_ORIGIN` → ACAO 回显  
- `/verify`（已配置 `NOTION_TOKEN`）→ **200** Notion connected（bot + dataSources）

## 3. 残余风险

| ID | 风险 | 缓解 | 残余 |
|----|------|------|------|
| R-Tomb | ~~Trash 真 API 未闭环~~ **M1 live 已关闭** | KV 映射 + retrieve + skipped_deleted 已实证 | 残余：Trash 成功后 KV put 失败窗口 → 依赖客户端幂等重试 delete；跨账号 fork 须自建 KV/DS |
| R-Race | 跨 isolate 双页 | ambiguous_race 拒绝；D4 可选 DO | 弱于 Supabase RPC |
| R-Key | Gateway Key / Notion Token 泄漏 | 用户轮换 secret；HTTPS；不进 IDB / Git | 用户运维责任 |
| R-Scope | 误当正式服务 | README / 本报告明示；workers 名含 d1-test | 流程纪律 |

## 4. 明确未做（硬禁令仍生效）

- PWA `NotionProvider` 业务接入  
- 改现有 / 正式 Supabase `tqjowsffppgoqtdokbzp`  
- 部署正式 Gateway 给全体用户 / 多租户  
- 将 secret 写入 Git  
- **本 PR 未经独立审查不得 merge**

## 5. 审查门禁

**本 D1 PR 合并前须独立审查。合并后亦不得自动部署「正式」服务。**

M1（live Trash API evidence）已具备；请 architect 对更新后的 `trash-tombstone-evidence.json` 与本报告做条件放行 / 再审。
