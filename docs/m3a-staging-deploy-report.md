# M3-A Staging 部署与验收报告

> **时间**：2026-10-12 ~13:09–13:13 Asia/Shanghai (CST)  
> **执行**：Grok Bot executor（本机 `/workspace/car-care-pwa`）  
> **硬约束**：未部署 `https://car.adobesun.com`；未改生产 Supabase `tqjowsffppgoqtdokbzp`。正式生产发布需用户另行批准。

## 1. 版本指纹

| 项 | 值 |
|---|---|
| PR | https://github.com/spfroc/car-care-pwa/pull/5 （已合并） |
| Round-2 审查 tip | `602a94a` |
| Feature tip（含最终 docs） | `61204dd` |
| **main merge commit** | **`8f335bc0b8bdbfa7dd5b95e72708b2e12862e54f`** |
| Staging URL | https://car-test.adobesun.com |
| Staging 路径 | Contabo `/var/www/car-care-staging/` |
| Staging 主 bundle | `assets/index-D4Bw8zWY.js` |
| Bundle sha256 | `0971e82a39615a0afac00260a54d6080da7bb6d99b8db8fc77ba7057b7d7d608` |
| Staging backup | `/var/www/car-care-backups/car-care-staging-pre-m3a-20261012-131235.tar.gz` |
| Prod URL | https://car.adobesun.com |
| Prod bundle（部署后核对） | 仍为 `assets/index-PGrW_vYg.js` sha256 `09efa7a8…5506bff` — **未改** |
| Disposable Supabase | `skwoahneuqkqgxzpkkzl` only |

**结论**：car-test 公网 HTML / JS / `deploy-stamp.txt`（curl）均指向 **main `8f335bc`**；与本地构建一致。

## 2. 合并前验证

| 检查 | 结果 |
|---|---|
| `npm test`（无 live env） | **222 passed** / 5 skipped |
| `npx tsc -b` | **PASS** |
| `npm run build` | **PASS** → `index-D4Bw8zWY.js` |
| `scripts/m3a-media-storage-smoke.mjs` | **7/7 PASS**（upload/download/跨用户 RLS 拒绝/RPC/cleanup） |
| `supabase.media-e2e.test.ts` | **3/3 PASS**（upload→restore、legacy migrate、orphan GC） |
| `supabase.live-smoke.test.ts` | **1/1 PASS** |
| 生产 Supabase | **未触碰** |

整改说明：`docs/m3a-remediation-orphan-gc-migrate.md`（P0 安全 orphan GC；P1 migrate 错误上浮）。  
验收矩阵：`docs/m3a-acceptance-notes.md`。

## 3. 部署步骤（仅 staging）

1. `git checkout main && git pull` → `8f335bc`  
2. `npm run build`；写入 `dist/deploy-stamp.txt`（git/bundle/sha）  
3. SSH `root@161.97.138.206`（key `/home/box/.ssh/contabo_vps`）  
4. 备份 `/var/www/car-care-staging` → `car-care-backups/…pre-m3a…`  
5. 清空 **仅** staging 目录内容并解压新 `dist/`  
6. 部署前后比对 prod `index-*.js` sha — **相同**  
7. `nginx -t` OK；未改 nginx / DNS / prod 目录  

## 4. 无头冒烟（已执行）

### 4.1 curl / 资源

| 检查 | 结果 |
|---|---|
| `GET https://car-test.adobesun.com/` | **200**；引用 `index-D4Bw8zWY.js`；boot placeholder 存在 |
| `GET …/assets/index-D4Bw8zWY.js` | **200**；sha256 = 本地构建 |
| `GET …/deploy-stamp.txt`（curl） | `git=8f335bc…` / `bundle=index-D4Bw8zWY.js` |
| `GET https://car.adobesun.com/` | **200**；仍 `index-PGrW_vYg.js`（**非** M3-A bundle） |

### 4.2 Playwright（`scripts/m2-staging-browser-smoke.mjs`）

**14/14 PASS**（约 13:13 CST）

| 检查 | 结果 |
|---|---|
| HTTPS home / `#root` 可交互 | PASS |
| Service Worker controlling | PASS |
| Precache workbox | PASS |
| 路由 `/` `/stats` `/settings` `/vehicles/new` | PASS |
| Settings 数据存储 / JSON 导入导出文案 | PASS |
| manifest | PASS |
| IndexedDB stores（含 sync_* / media） | PASS |
| Console 无致命错误 | PASS |

截图：`artifacts/staging-smoke/`（脚本默认目录）+ `artifacts/m3a-staging-smoke/home.png`

## 5. 浏览器验收清单（主 Bot / 人工）

> 自动化无法完整覆盖「旧图迁移 / 双客户端」；下列为可执行步骤与预期。建议在 **隐身窗口** 打开 car-test，避免旧 SW 干扰；或 DevTools → Application → Bypass for network / Unregister SW 后硬刷新。

### A. 构建指纹

1. 打开 https://car-test.adobesun.com/  
2. View Source：脚本为 `assets/index-D4Bw8zWY.js`  
3. （可选）curl `deploy-stamp.txt` 含 `8f335bc`  
**预期**：与 main 一致；非生产 `index-PGrW_vYg.js`。

### B. M2 旧图（JSONB/base64）→ Storage 迁移

1. 在 **disposable** Supabase（或自有测试项目已执行 `docs/sql/supabase-car-care-media-storage.sql`）用设置页连接  
2. 若云端仍有 M2 `base64` media 行：点「双向同步」  
**预期**：成功项 DB payload 变为 `storageKey`、无 base64；失败项 **保留 base64**；设置页/同步文案出现「媒体迁移」成功数或「待重试」  
3. 中断：同步中断网 → 恢复后再同步  
**预期**：已上传对象不误删；未完成项可重试（grace + 无自动 orphan GC）

### C. 新上传 → 恢复

1. 添加车辆封面/记录附件 → 首次上传或双向同步  
**预期**：云端 media 行 **无** base64；Storage 私有桶有对象  
2. 另一隐身配置「从云恢复」  
**预期**：图片可显示；本地 IndexedDB media 有 blob

### D. 新旧客户端兼容

| 场景 | 预期 |
|---|---|
| 仅 car-test（新）读写 v2 storageKey 行 | 正常 |
| 旧客户端（prod / 旧包）拉仅有 storageKey 的行 | 可能无法解码图 → **迁移前 JSON 备份**；勿在无备份时清空本地 |
| 新客户端读仍含 base64 的 M2 行 | 可拉可迁 |

### E. JSON 导入导出

1. 设置 → 导出 JSON（含媒体）  
2. 清空/换机 → 导入  
**预期**：本地图恢复；与云 Storage 路径无关（备份仍 base64）  
3. 再同步到已配 Storage 的项目  
**预期**：上传走 Storage，不把巨型 base64 留在 DB

### F. 权限隔离（可选人工）

1. 用户 A 上传图；用户 B 同项目登录  
**预期**：B 看不到 A 的行/对象（RLS）；自动化已测跨 uid 路径上传被拒

### G. 明确不要做

- 不要在验收中对 **生产** `tqjowsffppgoqtdokbzp` 跑迁移 SQL 或写入  
- 不要部署 / 覆盖 `car.adobesun.com`  
- 不要在同步路径期望「立即 orphan GC」（已禁用；显式清理 + 24h grace）

## 6. 回滚（仅 staging）

```bash
# on Contabo
tar -xzf /var/www/car-care-backups/car-care-staging-pre-m3a-20261012-131235.tar.gz -C /var/www
# 勿动 /var/www/car-care
```

## 7. 未做 / 待批准

- [ ] 生产 Contabo `/var/www/car-care/` 发布  
- [ ] 生产 Cloudflare purge（本任务未改 prod，无需）  
- [ ] 用户自有项目执行 Storage SQL（BYO 文档已提供）  

---

**交付摘要**：main=`8f335bc`；car-test 运行同 SHA / `index-D4Bw8zWY.js`；单元+disposable+staging 冒烟通过；生产未改动。

## 8. 浏览器真实验收（Playwright · 2026-10-12 13:18 CST）

脚本：`scripts/m3a-browser-acceptance.mjs`  
产物：`artifacts/m3a-browser-accept/`（截图 + `results.json` + 导出 JSON）  
目标：https://car-test.adobesun.com · disposable `skwoahneuqkqgxzpkkzl`  
**生产** `car.adobesun.com` / `tqjowsffppgoqtdokbzp`：**未触碰**（`G.prod.untouched` PASS）

### PASS/FAIL 矩阵（22/22 PASS）

| ID | 检查 | 结果 |
|---|---|---|
| A.https.home | staging HTTPS 200 | **PASS** |
| A.bundle.fingerprint | `index-D4Bw8zWY.js` | **PASS** |
| A.deployStamp.git | stamp `8f335bc` | **PASS** |
| A.sw.ok | SW controlling | **PASS** |
| B.verify.connect | Settings 校验连接 disposable | **PASS** |
| B.seed.legacyBase64 | 云端注入 M2 base64 行 | **PASS** |
| B.sync.migrateFeedback | 双向同步文案含「媒体迁移：成功 1 张」 | **PASS** |
| B.cloud.switchedToStorageKey | 行变为 schema=2 / storageKey、无 base64 | **PASS** |
| B.failPath.keepBase64 | 失败保留 base64（单元 P1 覆盖；浏览器测成功路径） | **PASS**（cite） |
| C.local.seedMedia | IDB 写入新图 | **PASS** |
| C.firstUpload.ok | 首次上传 | **PASS** |
| C.cloud.noBase64.hasStorageKey | 新图仅 storageKey | **PASS** |
| C.restore.ok / mediaPresent | 新上下文完全替换恢复，图 byteSize>0 | **PASS** |
| D.newClient.storageKeyRows | 新客户端可见 v2 行 | **PASS** |
| D.compat.base64ReadableDocumented | 兼容说明 + B 已验证 base64→Storage | **PASS** |
| E.export/import | JSON 含图导出 → 清空 IDB → 覆盖导入恢复 | **PASS** |
| G.prod.untouched | prod 仍 `index-PGrW_vYg.js` | **PASS** |
| G.interrupt.grace.unitCited | 中断/grace/orphan 引用单元 P0 | **PASS**（cite） |

### 截图

- `A-home.png`, `B-connected.png`, `B-after-sync.png`
- `C-after-upload.png`, `C-after-restore.png`
- `E-after-export.png`, `E-after-import.png`
- `results.json`, `car-care-export-v1.json`

### 复跑

```bash
cd app
# env: SMOKE_SUPABASE_* 仅 disposable
node scripts/m3a-browser-acceptance.mjs
```
