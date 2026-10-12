# M3-A 生产部署报告

> **时间**：2026-10-12 ~13:42 Asia/Shanghai (CST)  
> **批准**：用户明确批准发布到 https://car.adobesun.com  
> **执行**：Grok Bot executor  
> **硬约束**：未修改正式 Supabase `tqjowsffppgoqtdokbzp` 的数据/schema/配置；仅替换静态前端。

## 1. 版本指纹

| 项 | 值 |
|---|---|
| **App / 部署 SHA** | **`8f335bc0b8bdbfa7dd5b95e72708b2e12862e54f`**（PR #5 merge；与 car-test 验收一致） |
| Bundle | `assets/index-D4Bw8zWY.js` |
| Bundle sha256 | `0971e82a39615a0afac00260a54d6080da7bb6d99b8db8fc77ba7057b7d7d608` |
| 生产 URL | https://car.adobesun.com → Contabo `/var/www/car-care/` |
| Staging（未改） | https://car-test.adobesun.com → 仍为同 bundle / `8f335bc` |
| 构建目标 stamp | `target=car.adobesun.com` · `approved_by_user=true` |

> 说明：main 上后续 docs tip（如 `75b1ac8`）**不是**本次 app 差异来源；生产构建自 **`8f335bc` 分离 checkout**。

## 2. 备份

| 项 | 路径 / 值 |
|---|---|
| 部署前 prod bundle | `index-PGrW_vYg.js` sha256 `09efa7a8357c5867ef08a263f3831157fe142dc159ec9eff17c2f2edd5506bff` |
| 全量备份 | `/var/www/car-care-backups/car-care-pre-m3a-20261012-134218.tar.gz` |
| sha 记录 | `/var/www/car-care-backups/car-care-pre-m3a-20261012-134218.sha256.txt` |

## 3. 部署步骤

1. `git checkout 8f335bc` → `npm run build` → 写入 `dist/deploy-stamp.txt`  
2. SSH `root@161.97.138.206`（`/home/box/.ssh/contabo_vps`）  
3. 备份 `/var/www/car-care`  
4. 清空 **仅** `/var/www/car-care/*` 并解压新 dist  
5. 校验 prod sha = 期望；**staging sha 部署前后相同**  
6. `nginx -t` OK；未改 nginx / DNS / staging 目录  

## 4. 公网核对（curl）

| 检查 | 结果 |
|---|---|
| `GET https://car.adobesun.com/` | **200**；脚本 `index-D4Bw8zWY.js` |
| `GET …/deploy-stamp.txt` | `git=8f335bc…` / `bundle=index-D4Bw8zWY.js` / `target=car.adobesun.com` |
| `GET …/assets/index-D4Bw8zWY.js` | **200**；sha256 与本地构建一致 |
| `GET https://car-test.adobesun.com/` | **仍正常**；同 bundle；stamp 仍指向 staging 构建时间 |

## 5. Playwright 只读冒烟

脚本：`scripts/m3a-prod-smoke.mjs`  
产物：`artifacts/m3a-prod-smoke/`  
**故意不**填写 Supabase、不点校验/上传/同步（避免写任何用户云或正式项目）。

| 套件 | 结果 |
|---|---|
| prod 首页/指纹/SW/路由 `/` `/stats` `/settings` / IDB / console | **12/12 PASS** |
| stage 同上（确认未破坏） | **12/12 PASS** |
| **合计** | **24/24 PASS** |

## 6. 明确未做

- 未对 `tqjowsffppgoqtdokbzp` 执行 SQL / Storage / 数据写入  
- 未改 staging 内容  
- 未 purge Cloudflare（HTML `no-cache` + 新 hashed assets；如遇旧 SW，用户硬刷新或「更新」即可）

## 7. 回滚（生产）

```bash
ssh -i /home/box/.ssh/contabo_vps root@161.97.138.206
# 还原部署前快照
tar -xzf /var/www/car-care-backups/car-care-pre-m3a-20261012-134218.tar.gz -C /var/www
# 确认
ls /var/www/car-care/assets/index-*.js   # 期望 index-PGrW_vYg.js
# 勿动 /var/www/car-care-staging
nginx -t
```

回滚后 curl `https://car.adobesun.com/` 应再次引用 `index-PGrW_vYg.js`。

## 8. 用户侧提示（BYO）

- 本机 IndexedDB 默认不变；仅当用户在设置中连接**自有** Supabase 时才同步  
- 使用云媒体的用户需在自家项目执行 `docs/sql/supabase-car-care-media-storage.sql`（若尚未）  
- 迁移前建议 JSON 导出备份  

---

**交付**：生产运行 `8f335bc` / `index-D4Bw8zWY.js`；备份与回滚就绪；只读冒烟全过；正式 Supabase 未改。
