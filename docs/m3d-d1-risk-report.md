# M3-D D1 风险报告 · Notion BYO Gateway 原型

> **日期**：2026-10-13（Asia/Shanghai）  
> **范围**：用户自有 Cloudflare Worker 参考实现 + 测试 workspace 夹具  
> **纪律**：PR **未经独立审查不得 merge**；**不得**部署正式多租户 Gateway；**不得**改正式 Supabase `tqjowsffppgoqtdokbzp`；**不得**接 PWA NotionProvider 生产路径。

## 1. 交付摘要

| 项 | 结果 |
|----|------|
| 设计 PR #8 | 已 squash/merge 习惯一致的 **merge commit** `15ee4c6143793e8aa134fe2412bf8746b2573256`；diff **仅 docs**；未部署任何站 |
| D1 分支 | `feature/m3d-d1-notion-gateway` · 路径 `docs/templates/notion-sync-worker/` |
| 测试 Worker | `car-care-notion-sync-d1-test` · `https://car-care-notion-sync-d1-test.spf-roc.workers.dev`（用户 CF 账号原型，非正式服务） |
| 单测 | `npm test` · 12 pass（auth / LWW / payload） |

## 2. 必测项结论

### 2.1 Trash / Tombstone

| | |
|--|--|
| **证据** | `artifacts/m3d-d1-notion-gateway/trash-tombstone-evidence.json` · `soft-delete-property-fixture.json` |
| **文档结论** | Data Source query **默认不含** trash；`in_trash` 非 DS query 参数；需 `search?in_trash` 或 **retrieve(pageId)** + **用户自有 KV 墓碑映射** |
| **实现** | 删除双轨 + `TOMBSTONE_KV`（已建 namespace `6ae5cb6d1309453db197b6ce8217e419`）· pull 合并 KV · 防过期 upsert 复活 |
| **阻断** | 环境无 Notion **Integration Token** → 无法用 Worker 对真 API 执行 `PATCH in_trash` 闭环。Notion MCP 无 trash 工具。最小手工步骤见证据 JSON。 |
| **属性墓碑** | 已在测试 DB 写入 `AppDeletedAt` 非空行（`veh-tombstone-001`），Gateway 逻辑将其视为 tombstone。 |

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
- 无 `NOTION_TOKEN` 时 `/verify` → **503 notion_unavailable**（失败闭合，不假装已连接）

## 3. 残余风险

| ID | 风险 | 缓解 | 残余 |
|----|------|------|------|
| R-Tomb | Trash 真 API 未在本环境 PATCH 闭环 | KV 映射 + 文档步骤 | 需手工 Token 后补夹具 |
| R-Race | 跨 isolate 双页 | ambiguous_race 拒绝；D4 可选 DO | 弱于 Supabase RPC |
| R-Key | Gateway Key 泄漏 | 用户轮换 secret；HTTPS；不进 IDB | 用户运维责任 |
| R-Scope | 误当正式服务 | README / 本报告明示；workers 名含 d1-test | 流程纪律 |

## 4. 明确未做

- PWA `NotionProvider` 业务接入  
- 改现有 / 正式 Supabase  
- 部署正式 Gateway 给全体用户  
- 将 secret 写入 Git  

## 5. 审查门禁

**本 D1 PR 合并前须独立审查。合并后亦不得自动部署「正式」服务。**
