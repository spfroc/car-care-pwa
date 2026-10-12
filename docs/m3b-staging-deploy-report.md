# M3-B Staging 部署与验收报告

> **时间**：2026-10-12 ~16:24–16:27 Asia/Shanghai (CST)  
> **执行**：Grok Bot executor（`/workspace/car-care-pwa`）  
> **硬约束**：仅部署 https://car-test.adobesun.com；**未**部署 https://car.adobesun.com；**未**改生产 Supabase。

## 1. 版本指纹

| 项 | 值 |
|---|---|
| PR | https://github.com/spfroc/car-care-pwa/pull/6（**MERGED**） |
| Round-4 批准 tip | `09667cb` |
| Feature tip（含最终 docs） | `25a2df5` |
| **main merge commit** | **`d7dd681fc934fa07915ae6cff2434b75122aa4a0`** |
| Staging URL | https://car-test.adobesun.com |
| Staging 路径 | Contabo `/var/www/car-care-staging/` |
| Staging 主 bundle | `assets/index-Cv8wDxDq.js` |
| Bundle sha256 | `f6ac3b122fa0eff5a1fb37106181b9ac894218356a59e4e6dcb78e492ef421dc` |
| Staging backup | `/var/www/car-care-backups/car-care-staging-pre-m3b-20261012-162530.tar.gz` |
| Prod URL | https://car.adobesun.com |
| Prod（部署后核对） | 仍为 `index-f4r7_DP6.js` / git `6adcd15` — **未改** |

**结论**：car-test 公网 HTML / JS / `deploy-stamp.txt` 均指向 **main `d7dd681`**；与本地构建 sha256 一致。生产未动。

## 2. 合并前验证

| 检查 | 结果 |
|---|---|
| `npm test` | **252 passed** / 5 skipped |
| `npx tsc -b` | **PASS** |
| `npm run build` | **PASS** → `index-Cv8wDxDq.js` |
| 最终整改文档 | `docs/m3b-remediation-final.md` |
| 生产 Supabase | **未触碰** |

## 3. 部署步骤（仅 staging）

1. `gh pr merge 6` → merge commit `d7dd681`  
2. `git checkout main && git pull` → `npm run build`  
3. 写入 `dist/deploy-stamp.txt`（target=`car-test.adobesun.com`）  
4. SSH `root@161.97.138.206`（`/home/box/.ssh/contabo_vps`）  
5. 备份 **仅** `/var/www/car-care-staging`  
6. 清空 staging 并解压新 dist；**未**触碰 `/var/www/car-care`  
7. 部署前后 prod `index-*.js` 路径相同；`nginx -t` OK  

## 4. 公网核对

| 检查 | 结果 |
|---|---|
| `GET https://car-test.adobesun.com/deploy-stamp.txt` | `git=d7dd681…` / `bundle=index-Cv8wDxDq.js` |
| Staging bundle sha256 | = 本地构建 |
| `GET https://car.adobesun.com/deploy-stamp.txt` | 仍 `6adcd15` / `index-f4r7_DP6.js` |

## 5. 浏览器验收

### 5.1 M3-B 专用（`scripts/m3b-staging-browser-accept.mjs`）

**18/18 PASS** — 产物 `artifacts/m3b-staging-accept/results.json`

| ID | 覆盖 | 结果 |
|----|------|------|
| A1–A3 | home 200 / stamp / bundle | PASS |
| A4 | Service Worker ready + controlling | PASS |
| A5 | BG Sync API probe（本环境 `syncAPI=true`；缺失时降级仍 OK） | PASS |
| A6 | 路由 `/` `/stats` `/settings` | PASS |
| A7 | 设置页 JSON 导入导出文案 | PASS |
| A8 | IDB stores：vehicles/records/media/sync_* | PASS |
| A9 | Web Locks 可用探测 | PASS |
| B1 | 双标签 Web Locks `ifAvailable`：A 持锁 → B busy | PASS |
| B2 | IDB lease 接管（TTL 过期后 B 写入） | PASS |
| C1–C2 | 离线 shell + outbox 可写（保留队列语义） | PASS |
| D1 | M2 业务 stores 仍在 | PASS |
| E1 | 生产 stamp 未变 | PASS |
| F1 | 无致命 console error | PASS |

### 5.2 既有 M2 smoke（`scripts/m2-staging-browser-smoke.mjs`）

**14/14 PASS** — SW / precache / 路由 / 设置导入导出 / manifest / IDB / console。

## 6. 异常与备注

- Playwright Chromium 具备 Web Locks；B1 走 Web Locks 路径。B2 额外验证 IDB lease 写入/接管（无锁 API 或降级时的生产回退）。  
- BG Sync：本环境 API 存在；文档仍**不承诺**关页后自动上行（SW 仅通知已打开 client）。  
- 双标签「真实点同步按钮」依赖用户云配置；本验收用锁原语 + outbox/IDB 验证互斥与离线队列，避免写生产 Supabase。  
- 无 M2/M3-A 回归信号（stores、设置 JSON UI、SW、路由均 PASS）。

## 7. 回滚（staging only）

```bash
ssh -i /home/box/.ssh/contabo_vps root@161.97.138.206
tar -xzf /var/www/car-care-backups/car-care-staging-pre-m3b-20261012-162530.tar.gz -C /var/www
# 勿动 /var/www/car-care
nginx -t
```

## 8. 相关文档

- `docs/m3b-remediation-final.md` — Round-4 最终整改  
- `docs/m3b-remediation-round1.md` — R1 明细  
- `docs/m3b-tab-lock-outbox-harden.md` — 设计  
- `docs/m3b-background-sync-feasibility.md` — BG Sync 边界  
