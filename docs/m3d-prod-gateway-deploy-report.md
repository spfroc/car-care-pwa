# M3-D 正式 Gateway 部署验收报告

> **状态**：**BLOCKED** — 缺独立 Notion Internal Integration Token（`NOTION_TOKEN`）  
> **时间**：2026-10-15 Asia/Shanghai (CST)  
> **用户授权**：选择 B · 部署独立正式 Notion Gateway · **暂不**发布生产 PWA  
> **操作者**：Grok Bot（box 执行者）  
> **审查**：本 PR **不要 merge**；交独立审查

---

## 0. 结论摘要

| 项 | 结果 |
|----|------|
| Worker 独立部署 | **PASS** — `car-care-notion-sync` / `m3d-prod-1.0.0` |
| KV 独立 | **PASS** — `car-care-notion-tombstone-prod` id `86eaac822dac…` |
| Gateway API Key 新熵 | **PASS** — keyFp `aa819deb16dc`（仅指纹） |
| CORS / 401 探针 | **PASS**（见 §C） |
| `GET /health` version | **PASS** — `m3d-prod-1.0.0` |
| Notion 生产库（PascalCase） | **PASS 建库** — 车辆/养护 DS 已建；**未** Share 给正式 Integration |
| `NOTION_TOKEN` | **BLOCKED** — 无法纯 API 创建 Internal Integration |
| `/verify` · E3–E5 · FG1–FG3 | **未跑**（依赖 Token） |
| F 节生产 PWA | **整节 N/A**（本轮未授权） |
| 正式 Supabase / 清 IDB / car.adobesun.com 静态 | **零变更** |

**父 agent / 审查下一步（精确阻塞）**：

1. 浏览器打开：https://www.notion.so/my-integrations  
2. 新建 Internal Integration，名称建议：**车护正式同步**  
3. 复制 Token → 仅写入仓外 `~/.car-care-secrets/m3d-prod-notion.env`（mode 600）并 `wrangler secret put` / CF MCP secrets（**永不**进 git/PR/聊天）  
4. 打开生产库并 **Share** 给该 Integration：  
   - Lab：https://app.notion.com/p/3fa620fbd01f8144b645e13e13170129  
   - Vehicles DS：`8a131796-3b54-49ef-870c-db60eb6ee081`  
   - Records DS：`6aef6240-eecb-4608-97d9-78216af766fb`  
5. **确认** d1-test / d1-test-b 的测试 Integration **未**被邀请进上述库；正式 Integration **未** Share 测试库  
6. 恢复执行：`/verify` → 夹具 push/pull/delete → FG1–FG3 → 更新本报告与检查表勾选

---

## 1. 部署版本与资源指纹

| 资源 | 值 |
|------|-----|
| Worker `name` | `car-care-notion-sync`（≠ `*-d1-test` / `*-d1-test-b`） |
| URL | `https://car-care-notion-sync.spf-roc.workers.dev` |
| `GATEWAY_VERSION` | `m3d-prod-1.0.0` |
| `NOTION_VERSION` | `2026-03-11` |
| `ALLOWED_ORIGIN` | `https://car.adobesun.com,https://car-test.adobesun.com` |
| KV title / id | `car-care-notion-tombstone-prod` / `86eaac822dac466aa6f7e3af66447c21` |
| Vehicles DS | `8a131796-3b54-49ef-870c-db60eb6ee081`（≠ `68e70331-…`） |
| Records DS | `6aef6240-eecb-4608-97d9-78216af766fb`（≠ `dee1f83b-…`） |
| keyFp（sha256 前 12） | `aa819deb16dc` |
| wkFp | *待 `/verify` 后填写* |
| 仓外配置目录 | `~/.car-care-secrets/notion-sync-worker-prod/` |
| 密钥文件 | `~/.car-care-secrets/m3d-prod-gateway-api-key.txt`（600）· Notion Token **待建** |

**未复用（硬核对）**：

- Worker ≠ `car-care-notion-sync-d1-test` / `car-care-notion-sync-d1-test-b`
- KV ≠ `6ae5cb6d1309453db197b6ce8217e419` / ≠ `fbb4af0a…`
- 未读取/注入 `NOTION_TOKEN_D1_TEST` 或 d1-test-b Token
- 模板目录 `docs/templates/notion-sync-worker` **未**就地改名 deploy（`git` 干净）

**deploy 前 name 核对（执行记录）**：

```
=== pre-deploy Worker name check ===
name = "car-care-notion-sync"
parsed name=[car-care-notion-sync]
NAME_OK
```

部署方式：仓外目录 `wrangler deploy --dry-run --outdir=dist` 打完整 TypeScript bundle → Cloudflare MCP `PUT .../workers/scripts/car-care-notion-sync` multipart（module syntax + bindings）→ `subdomain.enabled=true` → secrets `GATEWAY_API_KEY`。本机 `npx wrangler whoami` 仍未登录；账号经 MCP `spf_roc@163.com`。

---

## 2. Checklist A–E / FG / F（正式环境）

### A 隔离

| # | 结果 | 证据 |
|---|------|------|
| A1 name | ✅ | Worker `car-care-notion-sync` |
| A2 URL | ✅ | `…car-care-notion-sync.spf-roc.workers.dev` ≠ d1-test |
| A3 KV | ✅ | id `86eaac822dac…` |
| A4 Integration | ⛔ | **未**创建正式 Integration / Token |
| A5 DS | ✅ | 新 UUID（见上表） |
| A6 Share 隔离 | ⛔ | 待正式 Integration 后 Share + 核对 |
| A7 API Key | ✅ | 新熵 keyFp `aa819deb16dc` |
| A8 VERSION | ✅ | `m3d-prod-1.0.0` |
| A9 whoami | ✅ | MCP whoami `spf_roc@163.com`；仓外目录操作 |
| A10 name 打印 | ✅ | 见 §1 |

### B 密钥面

| # | 结果 |
|---|------|
| B1 NOTION_TOKEN secret put | ⛔ 未注入（无 Token） |
| B2 GATEWAY_API_KEY secret put | ✅ CF MCP secrets |
| B3 无密钥进 git/PR/artifacts | ✅ |
| B4 wrangler.toml 无 secret | ✅ 仅仓外 |
| B5 响应无 Token/Key 回显 | ✅ 抽样 health/401 |
| B6 轮换 SOP | ✅ 理解（总案 §2.9） |
| B7 密码管理器备份 | 部分 — Key 在 `~/.car-care-secrets/`；Notion Token 待建后同存 |

### C CORS / 网络

| # | 结果 | 证据文件 |
|---|------|----------|
| C1 含 car.adobesun.com | ✅ | bindings |
| C2 精确匹配 | ✅ | 实现 `cors.ts` |
| C3 car Origin → ACAO | ✅ | `artifacts/.../cors-auth-probes.txt` |
| C4 evil → 无 ACAO（403） | ✅ | 同上 |
| C5 无/错 Bearer → 401 | ✅ | retry 文件（首轮错 Bearer 曾见 secret 传播竞态 503，复测 401） |
| C6 HTTPS | ✅ | workers.dev |
| C7 含 car-test | ✅ | ACAO `https://car-test.adobesun.com` |
| C8 密钥与 d1-test 分离 | ✅ | 新 Key / 新 KV / 新 DS；未用测试 Token |

### D Notion 契约

| # | 结果 |
|---|------|
| D1 NOTION_VERSION | ✅ `2026-03-11` |
| D2 PascalCase 属性 | ✅ 两库已建（与 D1 测试 schema 对齐） |
| D3 Share + `/verify` | ⛔ 无 Token → 503 `NOTION_TOKEN secret missing` |
| D4–D6 Payload/tombstone/产品文案 | 未跑（依赖 Token） |

### E 冒烟

| # | 结果 |
|---|------|
| E1 health version | ✅ `m3d-prod-1.0.0` |
| E2 verify + fingerprint | ⛔ |
| E3 push/pull name+plate | ⛔ 未跑 |
| E4 delete → skipped_deleted | ⛔ 未跑 |
| E5 夹具清理 | ⛔ 未跑 |
| 幂等/重试 · PayloadJson 往返 | ⛔ 未跑 |

### FG1–FG3（正式 Gateway 强制）

| # | 结果 |
|---|------|
| FG1 switchback `/sync/push` HTTP 200 | **NOT RUN** |
| FG2 Outbox 清空 | **NOT RUN** |
| FG3 仅 A 无串写 B | **NOT RUN** |
| G4 带伤短句 | **未勾**（用户未原样确认；本轮亦不走带伤） |

> 不得用 pre-gates SW4 `push200=0` 冒充 FG。

### F 生产 PWA

| # | 结果 |
|---|------|
| F1–F6 | **本轮未授权生产 PWA · N/A** |

---

## 3. 回滚方案

1. **Worker**：Cloudflare Dashboard → Workers → `car-care-notion-sync` → Versions → rollback 上一良好源；或仓外目录重新 multipart/redeploy 已知良好 bundle。紧急：Dashboard **Pause** Worker。  
2. **禁止**把 `car-care-notion-sync-d1-test` / `d1-test-b` 改 CORS/改名当生产。  
3. **密钥**：从操作者密码管理器 / `~/.car-care-secrets/m3d-prod-gateway-api-key.txt`（及未来的 `m3d-prod-notion.env`）恢复；报告不写明文。  
4. **KV**：保留 tombstone namespace；勿删除非明确弃用。  
5. **PWA**：本轮未部署生产静态站 → 无需 PWA 回滚。

---

## 4. 明确未做 / 零伤害声明

- ❌ 未发布 / 未修改 https://car.adobesun.com 静态站  
- ❌ 未修改正式 Supabase  
- ❌ 未清除任何用户 IndexedDB / Outbox / 既有云端数据  
- ❌ 未自动生产 PWA 发布  
- ❌ 未复用 d1-test / d1-test-b 的 Worker/URL/KV/Token/Key/DS  
- ❌ 未在 `docs/templates/notion-sync-worker` 就地改名 deploy  
- ❌ 密钥未进 git / PR / artifacts / 聊天明文  

---

## 5. 证据索引

| 路径 | 内容 |
|------|------|
| `artifacts/m3d-prod-gateway-deploy/deploy-summary.json` | 机器可读摘要 |
| `artifacts/m3d-prod-gateway-deploy/cors-auth-probes.txt` | 初轮 CORS/auth |
| `artifacts/m3d-prod-gateway-deploy/cors-auth-probes-retry.txt` | C5 复测 401 |
| `artifacts/m3d-prod-gateway-deploy/isolation-fingerprints.txt` | 隔离指纹 |
| 仓外 `~/.car-care-secrets/notion-sync-worker-prod/` | 正式配置 + dist bundle |
| 仓外 `~/.car-care-secrets/m3d-prod-gateway-meta.txt` | 本地元数据（无密钥明文） |

---

## 6. 签署栏（待审查）

| 角色 | 结论 |
|------|------|
| 操作者 | **条件未齐 · No-Go 冒烟** — 基础设施已立；缺 Notion Token |
| 架构 / 安全审查 | （待填） |
| 用户 | 已授权正式 Gateway；未授权生产 PWA；未确认 G4 带伤短句 |
