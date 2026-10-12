# M3-B 生产部署报告

> **时间**：2026-10-12 ~17:20 Asia/Shanghai (CST)  
> **批准**：用户明确说「发布」——授权部署到 https://car.adobesun.com  
> **执行**：Grok Bot executor  
> **硬约束**：未修改正式 Supabase `tqjowsffppgoqtdokbzp` 的数据/schema/Storage/配置；仅替换静态前端 `/var/www/car-care/`。未改 staging、nginx、DNS。

## 1. 版本指纹

| 项 | 值 |
|---|---|
| **App / 部署 SHA** | **`d7dd681fc934fa07915ae6cff2434b75122aa4a0`**（PR #6 merge；与 car-test 验收一致） |
| Bundle | `assets/index-Cv8wDxDq.js` |
| Bundle sha256 | `f6ac3b122fa0eff5a1fb37106181b9ac894218356a59e4e6dcb78e492ef421dc` |
| 生产 URL | https://car.adobesun.com → Contabo `/var/www/car-care/` |
| Staging（未改） | https://car-test.adobesun.com → 仍为同 git/bundle；`builtAt=2026-10-12T16:25:30+0800` |
| 构建目标 stamp | `target=car.adobesun.com` · `approved_by_user=true` · `builtAt=2026-10-12T17:19:52+0800` |

> 说明：main tip（如 `d2ddfb6`）在 `d7dd681` 之后仅有 docs/scripts/security 验收脚本，**无业务 app 差异**；生产构建自 **`d7dd681` 分离 worktree checkout**，与 M3-A 用 `8f335bc` 同口径。本地构建 sha256 与 staging 期望值完全一致后才继续部署。

## 2. 备份

| 项 | 路径 / 值 |
|---|---|
| 部署前 prod git | `6adcd1595313ca8989e62a46bec0a9e8976dc267` |
| 部署前 prod bundle | `index-f4r7_DP6.js` sha256 `2b4e8506438473c95796a1cd3bd9198152c73725e73cc5e19e5bc1239c53427c` |
| 全量备份 | `/var/www/car-care-backups/car-care-pre-m3b-20261012-171957.tar.gz` |
| sha 记录 | `/var/www/car-care-backups/car-care-pre-m3b-20261012-171957.sha256.txt` |
| 备份包 sha256 | `b58f1979f4f3b243730d9a7e83a31462ec5c27bc4ee06d500a90061e49f5b510` |

## 3. 部署步骤

1. `git fetch` → worktree checkout `d7dd681` → `npm ci` → `npm run build` → 主 bundle `index-Cv8wDxDq.js`，sha256 与 staging 一致  
2. 写入 `dist/deploy-stamp.txt`（全 SHA、bundle、sha256、builtAt Asia/Shanghai、target、approved_by_user=true）  
3. SSH `root@161.97.138.206`（`/home/box/.ssh/contabo_vps`）  
4. 备份 **仅** `/var/www/car-care` → 上述 tar.gz + sha256 记录  
5. 清空 **仅** `/var/www/car-care/*`，解压新 dist；**未碰** `/var/www/car-care-staging/`  
6. 校验 prod sha = 期望；staging stamp 时间戳仍为 `16:25:30`（未被动过）  
7. `nginx -t` OK；未改 nginx / DNS  

## 4. 公网核对（curl）

| 检查 | 结果 |
|---|---|
| `GET https://car.adobesun.com/` | **200**；脚本 `index-Cv8wDxDq.js` |
| `GET …/deploy-stamp.txt` | `git=d7dd681…` / `bundle=index-Cv8wDxDq.js` / `target=car.adobesun.com` / `approved_by_user=true` |
| `GET …/assets/index-Cv8wDxDq.js` | **200**；sha256 = `f6ac3b122fa0eff5a1fb37106181b9ac894218356a59e4e6dcb78e492ef421dc`（与本地一致） |
| `GET https://car-test.adobesun.com/deploy-stamp.txt` | **仍** `d7dd681` / `index-Cv8wDxDq.js` / `builtAt=2026-10-12T16:25:30+0800`（目录未改） |

## 5. Playwright 只读冒烟

脚本：`scripts/m3b-prod-smoke.mjs`（改编自 `m3a-prod-smoke.mjs`）  
产物：`artifacts/m3b-prod-smoke/`  
**故意不**填写 Supabase、不点校验/上传/同步（避免写任何用户云或正式项目）。

| 套件 | 结果 |
|---|---|
| prod 首页/指纹/SW/路由 `/` `/stats` `/settings` / IDB / console | **12/12 PASS** |
| stage 同上（确认未破坏） | **12/12 PASS** |
| **合计** | **24/24 PASS** |

IDB stores（prod/stage 均见）：`learning, media, meta, records, settings, stations, sync_meta, sync_outbox, vehicles`。

## 6. 明确未做

- 未对正式 Supabase `tqjowsffppgoqtdokbzp` 执行任何 SQL / schema / Storage / 数据写入  
- 未改 staging `/var/www/car-care-staging/` 内容  
- 未改 nginx 配置或 DNS（仅 `nginx -t` 校验）  
- 未 purge Cloudflare（HTML `no-cache` + 新 hashed assets；如遇旧 SW，用户硬刷新或「更新」即可）

## 7. 回滚（生产）

```bash
ssh -i /home/box/.ssh/contabo_vps root@161.97.138.206
tar -xzf /var/www/car-care-backups/car-care-pre-m3b-20261012-171957.tar.gz -C /var/www
# 勿动 /var/www/car-care-staging
nginx -t
```

期望回滚后 bundle 回到 `index-f4r7_DP6.js` / git `6adcd15`。

确认：

```bash
ls /var/www/car-care/assets/index-*.js   # 期望 index-f4r7_DP6.js
cat /var/www/car-care/deploy-stamp.txt
curl -sS https://car.adobesun.com/deploy-stamp.txt
```

## 8. 用户侧提示（BYO）

- 本机 IndexedDB 默认不变；仅当用户在设置中连接**自有** Supabase 时才同步  
- M3-B 能力（tab sync lock、BG Sync、outbox harden）随新静态包生效；多标签场景建议硬刷新一次以拉取新 SW  
- 迁移/同步前建议 JSON 导出备份  

---

**交付**：生产运行 `d7dd681` / `index-Cv8wDxDq.js`（sha256 与 staging 验收构建一致）；备份与回滚就绪；只读冒烟 24/24 PASS；正式 Supabase 未改；staging 未改坏。
