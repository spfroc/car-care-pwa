# M3-D PR #17 → car-test 部署与验收报告

**时间：** 2026-10-14 ~16:23–16:27 Asia/Shanghai (CST)  
**执行：** Grok Bot executor  
**用户授权：** B — 合并 PR #17 + **仅**部署 car-test

## 指纹

| 项 | 值 |
|---|---|
| PR #17 | https://github.com/spfroc/car-care-pwa/pull/17 **MERGED** |
| Head tip | `5b7052c00d2ed7370c7cca119672bed247c5396a` |
| **Merge SHA** | **`c5dcf493eca7a088605ca685fe2e43acf8ca4eaa`** |
| Staging URL | https://car-test.adobesun.com |
| Staging path | Contabo `/var/www/car-care-staging/` |
| Staging bundle | `assets/index-B32gzRTV.js` |
| Bundle sha256 | `fc4e608c3dbcbfd72a2b1f5556be0c4859ba0b9347cec62fe6f032c396fc63b7` |
| Staging backup | `/var/www/car-care-backups/car-care-staging-pre-m3d-pr17-20261014-102422.tar.gz` |
| Backup sha256 | `e2391ea1ebd9744fb07b8a3e831dc2dc3aa1201a340bec23666b592ee369c71a` |
| Gateway | `https://car-care-notion-sync-d1-test.spf-roc.workers.dev` (**d1-test DEV**) |
| Worker | `m3d-d1-0.1.1` · keyFp `91dee0d48d59` · workspaceFp `c647ac0368ff` |
| Prod URL | https://car.adobesun.com — **未改** (`index-TdTLY2U-.js` / `9b64a2bd`) |
| Optional PR #16 | docs artifacts merged → `aa7788ac7ce6bdb27f8c3da9e7c74c319f9783e0` |

## 1. 合并

- `merge_pull_request` #17 @ pinned SHA `5b7052c…` → merge commit **`c5dcf49…`**
- Optional docs PR #16 merged after (non-blocking)

## 2. 部署前门禁（合入后 tip）

| Check | Result |
|-------|--------|
| `npm test` | **339 passed** / 5 skipped |
| `npx tsc -b` | **PASS** (exit 0) |
| `npm run build` | **PASS** → `index-B32gzRTV.js` |
| SW/DEL unit `notion-d2-p5.test.ts` | **19/19 PASS** |

## 3. Staging 备份与部署

1. SSH `root@161.97.138.206` (`~/.ssh/contabo_vps`)
2. 备份 **仅** `/var/www/car-care-staging` → tar 如上
3. 清空 staging 并解压新 `dist`；写入 `deploy-stamp.txt`
4. **未**触碰 `/var/www/car-care`（生产）
5. 公网核对：car-test stamp/bundle = `c5dcf49` / `index-B32gzRTV.js`；prod 仍 `9b64a2bd` / `index-TdTLY2U-.js`

## 4. 浏览器 E2E（真实 Playwright + car-test + d1-test）

目标：https://car-test.adobesun.com + 独立 Notion 测试工作区 via **d1-test** Gateway。

| ID | Status | Notes |
|----|--------|-------|
| browser.verify | **PASS** | 会话已就绪 · `/verify` 200 |
| ui.vehicle_create | **PASS** | 昵称+车牌写入 |
| browser.bidirectional_sync | **PASS** | `/sync/push` + `/sync/pull` 200 |
| api.payload_name_plate_roundtrip | **PASS** | pull 还原 `name`+`plate`（PR #17 核心） |
| offline.reonline_sync | **PASS** | 恢复在线后 sync 200 |
| offline.idb_probe | FAIL (non-critical) | 离线 context 下 IDB.databases SecurityError；未清用户 IDB |

**Kind：** real browser + real Gateway。截图：`browser-smoke.png`

## 5. Live Gateway API 矩阵（d1-test）

| Suite | Status |
|-------|--------|
| P3 CRUD / pull / offline flush / delete / restore / D2.6 | **PASS** |
| P4 conflict `cloud_newer` + keep_local LWW + entity reject | **PASS** |
| P5 DEL1–DEL3 map/switch corridor | **PASS** |
| 养护记录同步 | **PASS**（P3 vehicle+record create/pull） |
| 冲突解决 | **PASS**（P4） |
| 删除防复活 | **PASS**（P5 DEL2 `skipped_deleted`） |

## 6. SW1–SW4 诚实标签

| ID | Status |
|----|--------|
| SW1–SW4 | **SKIP (unit-only)** — **未**完成真实双工作区联调；**不得**宣称双工作区 E2E PASS |
| Unit | `notion-d2-p5.test.ts` 19/19 |

## 7. Supabase disposable 回归

| Item | Result |
|------|--------|
| `m2-supabase-smoke.mjs` | **PASS**（auth / LWW apply+skip+newer / cross-device pull / RLS / cleanup） |
| 正式 project / schema | **未修改** |

## 8. 回滚（staging only）

```bash
ssh -i /home/box/.ssh/contabo_vps root@161.97.138.206
# 可选：先备份当前 tip
tar -C /var/www -czf /var/www/car-care-backups/car-care-staging-pre-rollback-$(date +%Y%m%d-%H%M%S).tar.gz car-care-staging
rm -rf /var/www/car-care-staging/*
tar -xzf /var/www/car-care-backups/car-care-staging-pre-m3d-pr17-20261014-102422.tar.gz -C /var/www
# 勿动 /var/www/car-care
nginx -t
```

本地副本：`/workspace/car-care-pwa/backups/car-care-staging-pre-m3d-pr17-20261014-102422.tar.gz`

## 9. 明确声明

- **未**部署 https://car.adobesun.com
- **未**把 d1-test 当正式生产 Gateway
- **未**修改正式 Supabase 数据/配置
- **未**清除现有用户 IndexedDB 或 Outbox
- 本报告交主 Bot → 独立审查；**不**申请生产合入/部署

## Artifact index

```
artifacts/m3d-pr17-car-test-accept/
  SUMMARY.md  matrix.json
  unit-test.log  tsc.log  build.log  unit-sw-del.log
  live-p3.log + live-p3-matrix.json
  live-p4.log + live-p4-matrix.json
  live-p5.log + live-p5-matrix.json
  browser-e2e.log  browser-matrix.json  browser-smoke.png  browser-notion-e2e.mjs
  supabase-smoke.log
```
