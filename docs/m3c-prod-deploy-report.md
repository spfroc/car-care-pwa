# M3-C 生产部署报告

> **时间**：2026-10-13 ~10:47 Asia/Shanghai (CST)  
> **批准**：用户明确授权——将车护助手 M3-C 生产前端发布到 https://car.adobesun.com  
> **执行**：Grok Bot executor  
> **硬约束**：未修改正式 Supabase `tqjowsffppgoqtdokbzp` 的数据/schema/Storage/配置；仅替换静态前端 `/var/www/car-care/`。未改 staging、nginx、DNS。未清除任何用户浏览器数据 / IndexedDB / localStorage。

## 1. 版本指纹

| 项 | 值 |
|---|---|
| **App / 部署 SHA** | **`9b64a2bd204acfb5791f3f6668110e4c00ab3c95`**（PR #7 merge；与 car-test 验收一致） |
| Bundle | `assets/index-TdTLY2U-.js` |
| Bundle sha256 | `6eb256e40f233cae892b6b07cc9e368f71d504a3aa3656287509e436ce66c3cb` |
| 生产 URL | https://car.adobesun.com → Contabo `/var/www/car-care/` |
| Staging（未改） | https://car-test.adobesun.com → 仍为同 git/bundle；`builtAt=2026-10-13T09:49:18+08:00` |
| 构建目标 stamp | `target=car.adobesun.com` · `approved_by_user=true` · `builtAt=2026-10-13T10:46:41+08:00` |

> 说明：main tip（如 `7f464e0`）在 `9b64a2b` 之后仅有 docs/scripts 测试补强，**无业务 src 差异**；生产构建自 **`9b64a2b` 分离 worktree checkout**，与 M3-B 用 `d7dd681` 同口径。本地构建 sha256 与 staging 期望值完全一致后才继续部署。

## 2. 备份

| 项 | 路径 / 值 |
|---|---|
| 部署前 prod git | `d7dd681fc934fa07915ae6cff2434b75122aa4a0`（M3-B） |
| 部署前 prod bundle | `index-Cv8wDxDq.js` sha256 `f6ac3b122fa0eff5a1fb37106181b9ac894218356a59e4e6dcb78e492ef421dc` |
| 全量备份（本轮 pre-m3c） | `/var/www/car-care-backups/car-care-pre-m3c-20261013-104653.tar.gz` |
| sha 记录 | `/var/www/car-care-backups/car-care-pre-m3c-20261013-104653.sha256.txt` |
| 备份包 sha256 | `5dd319ad73f54d3772a397ff005791596395bc2934142a61805fd1237ffe0baf` |
| 仍保留的 M3-B 备份 | `/var/www/car-care-backups/car-care-pre-m3b-20261012-171957.tar.gz`（可回滚到 M3-B 之前的 M3-A 态） |

## 3. 部署步骤

1. `git fetch` → worktree checkout `9b64a2bd204acfb5791f3f6668110e4c00ab3c95` → `npm ci` → `npm run build` → 主 bundle `index-TdTLY2U-.js`，sha256 与验收期望完全一致  
2. 写入 `dist/deploy-stamp.txt`（全 SHA、bundle、sha256、builtAt Asia/Shanghai、target=car.adobesun.com、approved_by_user=true、pr=7、merge=全 SHA）  
3. SSH `root@161.97.138.206`（`/home/box/.ssh/contabo_vps`）  
4. 备份 **仅** `/var/www/car-care` → 上述 tar.gz + sha256 记录；确认 M3-B 备份仍在  
5. 清空 **仅** `/var/www/car-care/*`，解压新 dist；**未碰** `/var/www/car-care-staging/`  
6. 校验 prod sha = 期望；staging stamp 时间戳仍为 `09:49:18`（未被动过）  
7. `nginx -t` OK；未改 nginx / DNS  

## 4. 公网核对（curl）

| 检查 | 结果 |
|---|---|
| `GET https://car.adobesun.com/` | **200**；脚本 `index-TdTLY2U-.js` |
| `GET …/deploy-stamp.txt` | `git=9b64a2b…` / `bundle=index-TdTLY2U-.js` / `target=car.adobesun.com` / `approved_by_user=true` / `builtAt=2026-10-13T10:46:41+08:00` |
| `GET …/assets/index-TdTLY2U-.js` | **200**；sha256 = `6eb256e40f233cae892b6b07cc9e368f71d504a3aa3656287509e436ce66c3cb`（与本地一致） |
| `GET https://car-test.adobesun.com/deploy-stamp.txt` | **仍** `9b64a2b` / `index-TdTLY2U-.js` / `builtAt=2026-10-13T09:49:18+08:00`（目录未改） |

## 5. Playwright 只读冒烟

脚本：`scripts/m3c-prod-smoke.mjs`（改编自 `m3b-prod-smoke.mjs`）  
产物：`artifacts/m3c-prod-smoke/`  
**故意不**填写 Supabase、不点校验/上传/同步（避免写任何用户云或正式项目）。  
**故意不**调用 `indexedDB.deleteDatabase` / `clear` / 清除 localStorage。

| 套件 | 结果 |
|---|---|
| prod 首页/指纹/SW/路由 `/` `/stats` `/settings` / IDB / console | **12/12 PASS** |
| stage 同上（确认未破坏） | **12/12 PASS** |
| **合计** | **24/24 PASS** |

IDB stores（prod/stage 新上下文均见）：`learning, media, meta, records, settings, stations, sync_conflicts, sync_meta, sync_outbox, vehicles`。

### 关于「旧有 IndexedDB 数据和 Outbox 不被清空」

- 静态前端替换只动服务器 `/var/www/car-care/`，**不触碰**用户浏览器 IndexedDB / localStorage。  
- 冒烟脚本使用**全新浏览器上下文**，无法读取真实用户设备上的既有数据；打开后可见完整 store 名单（含 M3-C 新增的 `sync_conflicts`），证明 schema 升级路径为增量开库而非整库清空。  
- 脚本从未调用 `deleteDatabase` / `clear` / 清除用户数据。

## 6. 明确未做

- 未对正式 Supabase `tqjowsffppgoqtdokbzp` 执行任何 SQL / schema / Storage / 数据写入  
- 未改 staging `/var/www/car-care-staging/` 内容  
- 未改 nginx 配置或 DNS（仅 `nginx -t` 校验）  
- 未 purge Cloudflare（HTML `no-cache` + 新 hashed assets；如遇旧 SW，用户硬刷新或「更新」即可）  
- 未清除任何用户浏览器数据 / IndexedDB / Outbox  

## 7. 回滚（生产）

### 7.1 回滚到本轮部署前（M3-B / d7dd681）

```bash
ssh -i /home/box/.ssh/contabo_vps root@161.97.138.206
tar -xzf /var/www/car-care-backups/car-care-pre-m3c-20261013-104653.tar.gz -C /var/www
# 勿动 /var/www/car-care-staging
nginx -t
```

期望回滚后 bundle 回到 `index-Cv8wDxDq.js` / git `d7dd681`。

### 7.2 仍可回滚到 M3-B 之前（M3-A / 6adcd15）

```bash
tar -xzf /var/www/car-care-backups/car-care-pre-m3b-20261012-171957.tar.gz -C /var/www
```

期望 bundle `index-f4r7_DP6.js` / git `6adcd15`。

确认：

```bash
ls /var/www/car-care/assets/index-*.js
cat /var/www/car-care/deploy-stamp.txt
curl -sS https://car.adobesun.com/deploy-stamp.txt
```

## 8. 用户侧提示（BYO）

- 本机 IndexedDB 默认不变；仅当用户在设置中连接**自有** Supabase 时才同步  
- M3-C 能力（冲突检测/解决 UI、`sync_conflicts` store）随新静态包生效；多标签场景建议硬刷新一次以拉取新 SW  
- 迁移/同步前建议 JSON 导出备份  

---

**交付**：生产运行 `9b64a2b` / `index-TdTLY2U-.js`（sha256 与 staging 验收构建一致）；备份与回滚就绪（含 pre-m3c 与既有 pre-m3b）；只读冒烟 24/24 PASS；正式 Supabase 未改；staging 未改坏；用户客户端数据未触碰。
