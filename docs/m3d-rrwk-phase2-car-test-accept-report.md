# M3-D RR-WK Phase 2 · car-test 部署与真实验收报告

**时间：** 2026-10-15 ~15:39–16:45 Asia/Shanghai (CST)  
**执行：** Grok Bot Phase 2 executor  
**用户授权：** 仅 car-test 部署与真实验收（生产 No-Go）

## 指纹

| 项 | 值 |
|---|---|
| Repo | https://github.com/spfroc/car-care-pwa |
| **Deploy / merge SHA** | **`f3bb58aceec53fea1c14f6959c3954259f6ff88d`**（PR #24 Phase 1） |
| Staging URL | https://car-test.adobesun.com |
| Staging path | Contabo `/var/www/car-care-staging/` |
| **Staging bundle** | **`assets/index-Ddi6Z1jp.js`** |
| Bundle sha256 | `5e94997a82fb7353d44849283e02e2fd89aff638d13e2c1f0674f870cc3f7563` |
| Deployed at | `2026-10-15T15:41:34+0800` |
| **Backup id** | `car-care-staging-pre-m3d-rrwk-phase2-20261015-154120` |
| Backup sha256 | `c32b6fb1eb211efdbe608898cfe28575625a61e056c8dba020376257e311daa1` |
| Backup path (VPS) | `/var/www/car-care-backups/car-care-staging-pre-m3d-rrwk-phase2-20261015-154120.tar.gz` |
| Gateway (test) | `https://car-care-notion-sync-d1-test.spf-roc.workers.dev` · keyFp `91dee0d48d59` · wkFp `c647ac0368ff` |
| Gateway B (cross-wk) | `…-d1-test-b…` · keyFp `5d915911b54a` · wkFp `db38e1e5a251` |
| Gateway P (E4/E8 only) | `https://car-care-notion-sync.spf-roc.workers.dev` · keyFp `aa819deb16dc` · **同** wkFp `c647ac0368ff` |
| Prod URL | https://car.adobesun.com — **未改** (`index-TdTLY2U-.js`) |

## A. Precheck

| Check | Result |
|-------|--------|
| Checkout tip | `f3bb58a` |
| `npm ci` | **PASS**（Node 20 engine warnings only） |
| `npm test` | **350 passed** / 5 skipped · **无** tabLock 失败 |
| `npx tsc -b` | **PASS** |
| `npm run build` | **PASS** → `index-Ddi6Z1jp.js` |

## B. 备份 + 仅部署 car-test

1. SSH `root@161.97.138.206`（`~/.ssh/contabo_vps`）
2. 备份 **仅** `/var/www/car-care-staging` → 上表 Backup id
3. 清空 staging 并解压 `f3bb58a` `dist`；写入 `deploy-stamp.txt`
4. **未**触碰 `/var/www/car-care`（生产）
5. 公网核对：car-test = `f3bb58a` / `index-Ddi6Z1jp.js`；prod 仍 `index-TdTLY2U-.js`

### 回滚（staging only）

```bash
ssh -i /home/box/.ssh/contabo_vps root@161.97.138.206
tar -C /var/www -czf /var/www/car-care-backups/car-care-staging-pre-rollback-$(date +%Y%m%d-%H%M%S).tar.gz car-care-staging
rm -rf /var/www/car-care-staging/*
tar -xzf /var/www/car-care-backups/car-care-staging-pre-m3d-rrwk-phase2-20261015-154120.tar.gz -C /var/www
# 勿动 /var/www/car-care
nginx -t
```

本地副本：`backups/car-care-staging-pre-m3d-rrwk-phase2-20261015-154120.tar.gz`

## C. observe → enforce（仅 car-test 测试会话）

| 步骤 | 结果 |
|------|------|
| 测试会话 IDB `notionTargetGuard=observe` | **PASS**（非生产默认；生产构建仍默认 off） |
| 身份判定 / 盖印 | **PASS**（E1 行含 `gatewayKeyFp=91dee0d48d59` + 冗余 `notionTargetId`） |
| 切 `enforce`（同测试会话） | **PASS** |
| 未 attested session → 同步按钮禁用 / 不 flush | **PASS**（`C.enforce.no_attested_ready_empty`） |
| 未清用户真实 Outbox | **PASS**（仅 ephemeral Playwright profile + 夹具行） |

> 说明：`console.info([notionTargetGuard:…])` 在 headless 下对象序列化常为空串；门禁以 IDB flag + 行为断言为准。

## D. ADR §9 E1–E11

| ID | Status | 证据摘要 |
|----|--------|----------|
| **E1** | **PASS** | Outbox 盖印 `gatewayKeyFp=91dee0d48d59`；`notionTargetId=workspaceKey::91dee0d48d59` |
| **E2** | **PASS** | 切 G-B（异 wk）：G-T hold **不** push 到 G-B；孤儿面板可见 |
| **E3** | **PASS** | 切回 G-T：hold flush `/sync/push` 200；队列清空 |
| **E4** | **PASS（硬门）** | **同 wkFp `c647ac0368ff` · 异 keyFp**（G-T `91dee0d…` vs G-P `aa819deb…`）：hold 保留、**prod `/sync/push` = 0**、attempted sync under `enforce` |
| **E5** | **PASS** | disconnect 后会话清除；E5 夹具 Outbox 行仍在 |
| **E6** | **PASS** | DISCARD 精确丢弃目标队列 |
| **E7** | **PASS** | 离线 enqueue → 错 Gateway 零 push → 切回后 flush |
| **E8** | **PASS** | G-P `/verify` 200 · wkFp `c647ac0368ff` · **零** push |
| **E9** | **PASS** | 无 `gatewayKeyFp` 旧行不自动 flush |
| **E10** | **PASS** | 见 §G Supabase smoke |
| **E11** | **PASS** | verify 后 meta `notionGatewayKeyFp`/`notionTargetId` 与 session 一致；陈旧 meta（故意写入 P fp）**不**覆盖 session-derived 门禁 |

完整矩阵：`artifacts/m3d-rrwk-phase2-accept/matrix.json`  
截图：`e4-same-wk-diff-gw.png` 等

## E. Legacy CLAIM

| 项 | 结果 |
|----|------|
| Guard 开启时 legacy 不自动 flush | **PASS** |
| 设置页二次确认 + `confirmToken==='CLAIM'` | **PASS**（UI 认领后 fp=`91dee0d48d59`） |
| verify / observe / migration **无**静默认领 | **PASS** |

## F. Notion 业务（car-test + d1-test）

| Suite | Status |
|-------|--------|
| Browser 车辆双向 + 离线重试 | **PASS**（Phase2 accept F.*） |
| Live P3 CRUD / pull / offline flush / delete / restore | **PASS** |
| Live P4 conflict `cloud_newer` + keep_local LWW + D2.6 reject | **PASS** |
| Live P5 DEL1–DEL3 删除防复活 | **PASS** |
| 养护记录同步 | **PASS**（P3 vehicle+record） |

## G. Supabase 回归

| Item | Result |
|------|--------|
| `m2-supabase-smoke.mjs` | **PASS**（auth / LWW apply+skip+newer / cross-device pull / RLS / cleanup） |
| 正式 project / schema / 密钥 | **未修改** |

## 事故与处置（诚实记录）

1. **首次 E4 试跑**在 `notionTargetGuard` 未写入 IDB 时误点「双向同步」，导致 **1** 条夹具车辆 `RRWK2-…-E4RR` 写入正式 Gateway 对应 Notion。  
2. 经用户批准的一次性 delete push 已清理；只读复核 **剩余 live RRWK2 = 0**。  
3. 脚本已改为：**E4 前强制 `enforce` 且 IDB 确认后才允许对 G-P 尝试 sync**；终跑 `invariant.zero_prod_gateway_push` **PASS**。  
4. **未**重部署正式 Gateway；**未**改 Secrets。

## 遗留风险

- 生产 `car.adobesun.com` 仍 **No-Go**；`notionTargetGuard` **默认 off**（构建未 enforce）
- 正式 Gateway **未**改代码/Secrets；E4/E8 仅用其 `/verify` +（guard 下）flush-refusal
- Headless 下 `console.info` 结构化日志采集不稳定；行为门禁已由 IDB/网络断言覆盖
- SW1–SW4 真实双工作区 UI 仍以既有 unit + E2/E4 门禁为准（本 Phase 未扩 SW E2E）
- 正式 Notion 曾短暂出现 1 条测试夹具（已删）；建议运维侧抽查回收站/审计若需要

## 明确声明

- **未**部署 https://car.adobesun.com
- **未**重部署 / 修改正式 Notion Gateway 代码或 Secrets
- **未**修改正式 Supabase schema/数据/密钥（smoke 仅用既有 disposable 账号路径）
- **未**清除用户设备 IndexedDB / 真实 Outbox（仅 ephemeral Playwright + 夹具）
- 本报告 PR **不要 merge**（除非用户另授）；交独立审查

## Artifact index

```
artifacts/m3d-rrwk-phase2-accept/
  SUMMARY.md  matrix.json  run5.log
  c-observe-session.png  e2-orphan-gb.png  e4-same-wk-diff-gw.png  final-settings.png
  phase2-deploy-meta.json  phase2-npm-test.log  phase2-tsc.log  phase2-build.log
  supabase-smoke.log
  live-p3.log  live-p4.log  live-p5.log
  live-p3-art/  live-p4-art/  live-p5-art/
scripts/m3d-rrwk-phase2-accept.mjs
backups/car-care-staging-pre-m3d-rrwk-phase2-20261015-154120.tar.gz
```
