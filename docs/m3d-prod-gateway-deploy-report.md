# M3-D 正式 Gateway 部署验收报告

> **状态**：**PASS**（正式 Gateway A–E + FG1–FG3；F 节 N/A）  
> **时间**：2026-10-15 Asia/Shanghai (CST)  
> **用户授权**：选择 B · 部署独立正式 Notion Gateway · **暂不**发布生产 PWA  
> **操作者**：Grok Bot（box 执行者）  
> **审查 PR**：https://github.com/spfroc/car-care-pwa/pull/21 · **不要 merge**

---

## 0. 结论摘要

| 项 | 结果 |
|----|------|
| Worker | **PASS** — `car-care-notion-sync` / `m3d-prod-1.0.0` |
| URL | `https://car-care-notion-sync.spf-roc.workers.dev` |
| KV | **PASS** — `car-care-notion-tombstone-prod` / `86eaac822dac…` |
| keyFp | `aa819deb16dc` |
| token_fp | `974ffc15d334` |
| wkFp | `c647ac0368ff`（同用户工作区；≠ B `db38e1e5a251`） |
| A–E | **PASS**（见 §2） |
| FG1–FG3 | **PASS**（见 §2；`push200≥1`，非 pre-gates `push200=0`） |
| F 生产 PWA | **整节 N/A** |
| 零伤害 | 零 PWA / 零正式 Supabase / 零清用户 IDB |

---

## 1. 部署版本与资源指纹

| 资源 | 值 |
|------|-----|
| Worker `name` | `car-care-notion-sync` |
| URL | `https://car-care-notion-sync.spf-roc.workers.dev` |
| `GATEWAY_VERSION` | `m3d-prod-1.0.0` |
| `NOTION_VERSION` | `2026-03-11` |
| `ALLOWED_ORIGIN` | `https://car.adobesun.com,https://car-test.adobesun.com` |
| KV | `car-care-notion-tombstone-prod` / `86eaac822dac466aa6f7e3af66447c21` |
| Vehicles DS | `8a131796-3b54-49ef-870c-db60eb6ee081` |
| Records DS | `6aef6240-eecb-4608-97d9-78216af766fb` |
| Integration | 「车护正式同步」· botName 经 `/verify` |
| keyFp | `aa819deb16dc` |
| token_fp | `974ffc15d334` |
| wkFp | `c647ac0368ff` |
| 仓外配置 | `~/.car-care-secrets/notion-sync-worker-prod/` |

**隔离说明**：wkFp 与历史 d1-test 相同，因同属「鹏飞 孙's Notion」工作区；**DS / Integration / KV / Gateway Key 均独立**。FG 对照 B = `d1-test-b`（wkFp `db38e1e5a251`）证明跨工作区无串写。

**未复用**：Worker/URL/KV/Token/Key/DS ≠ d1-test / d1-test-b；模板目录未就地改名 deploy。

---

## 2. Checklist A–E / FG / F

### A 隔离 — PASS
A1–A10 全部 ✅（含正式 Integration Token 注入与 Share 核对，由父 agent 解除阻塞后完成）。

### B 密钥面 — PASS
B1–B7 ✅。`NOTION_TOKEN` / `GATEWAY_API_KEY` 仅 CF secrets；报告仅指纹。

### C CORS / 网络 — PASS
C1–C8 ✅（car ACAO；evil 无 ACAO；无/错 Bearer→401；含 car-test 且密钥分离）。

### D Notion 契约 — PASS
| # | 结果 |
|---|------|
| D1 `NOTION_VERSION` | ✅ `2026-03-11` |
| D2 PascalCase | ✅ |
| D3 Share + `/verify` | ✅ 200 · bot「车护正式同步」· wkFp `c647ac0368ff` |
| D4 Payload 失败闭合 | ✅ 代码契约 + 夹具 PayloadJson 往返 |
| D5 删除双轨 + KV | ✅ E4 `skipped_deleted` |
| D6 产品文案 LWW | ✅ 披露保留 |

### E 冒烟 — PASS
| # | 结果 |
|---|------|
| E1 health | ✅ `m3d-prod-1.0.0` |
| E2 verify + fingerprint | ✅ keyFp / token_fp / wkFp |
| E3 name+plate + 养护 CRUD + PayloadJson | ✅ 前缀 `M3D-PROD-FIXTURE-` |
| E4 delete → skipped_deleted | ✅ |
| E5 夹具清理 | ✅ live_remaining=0 |
| 幂等/重试 | ✅ re-push + delete retry |

证据：`artifacts/m3d-prod-gateway-deploy/e-smoke/`

### FG1–FG3 — PASS（正式 Gateway 强制）

| # | 结果 | 证据摘要 |
|---|------|----------|
| FG1 | **PASS** | 切回 A 后 `/sync/push` HTTP **200**（`browserPushStatus=200` · `push200=2` · `netHits=1`） |
| FG2 | **PASS** | owner A Outbox 清空（`ownerALeft=0` · `outboxTotal=0`） |
| FG3 | **PASS** | `seenOnA=true` · `leakedB=false`（B=`d1-test-b`） |

- A = 正式 Gateway · B = d1-test-b（仅对照）  
- **禁止**将 pre-gates SW4 `push200=0` 冒充本结果  
- 证据：`artifacts/m3d-prod-gateway-deploy/fg-dual/`（含 `sw-matrix.json` · `sw-dual-final.png`）  
- G4 带伤短句：**未勾**（本轮以 FG 硬证，不走带伤）

### F 生产 PWA — N/A
F1–F6：**本轮未授权生产 PWA · N/A**。F4 相关：本轮未改正式 Supabase、未清用户 IDB。

---

## 3. 回滚方案

1. Cloudflare Dashboard → `car-care-notion-sync` → Versions rollback / Pause。  
2. 仓外目录重新 multipart 部署已知良好 bundle。  
3. **禁止**回滚到 d1-test 当生产。  
4. 密钥从 `~/.car-care-secrets/` / 密码管理器恢复（不写明文）。  
5. 本轮无生产 PWA 变更 → 无需静态站回滚。

---

## 4. 明确未做 / 零伤害

- ❌ 未发布/未修改 https://car.adobesun.com  
- ❌ 未修改正式 Supabase  
- ❌ 未清除用户 IndexedDB / Outbox（FG 仅用 Playwright 临时 context）  
- ❌ 未自动生产 PWA 发布  
- ❌ 密钥未进 git / PR / artifacts / 聊天明文  

---

## 5. 证据索引

| 路径 | 内容 |
|------|------|
| `artifacts/m3d-prod-gateway-deploy/deploy-summary.json` | 总摘要 PASS |
| `artifacts/m3d-prod-gateway-deploy/cors-auth-probes*.txt` | CORS/401 |
| `artifacts/m3d-prod-gateway-deploy/e-smoke/` | E1–E5 |
| `artifacts/m3d-prod-gateway-deploy/fg-dual/` | FG1–FG3 + SW |
| `scripts/m3d-prod-gateway-fixture-smoke.mjs` | E 夹具脚本 |
| `scripts/m3d-prod-fg-dual-workspace-live.mjs` | FG harness |

---

## 6. 签署栏

| 角色 | 结论 |
|------|------|
| 操作者 | **Go（正式 Gateway）** — A–E/FG PASS；F N/A |
| 架构 / 安全审查 | （待填） |
| 用户 | 已授权正式 Gateway；未授权生产 PWA |
