# M3-A 验收笔记（最终）

> **时间**：2026-10-12（Asia/Shanghai）  
> **PR**：https://github.com/spfroc/car-care-pwa/pull/5  
> **审查 tip**：`602a94a`（第二轮 P0/P1 整改已通过）  
> **约束**：不部署 `car.adobesun.com`；不改生产 Supabase `tqjowsffppgoqtdokbzp`。

## 1. 版本

| 项 | 值 |
|---|---|
| Feature tip（审查通过） | `602a94a` |
| Merge 后 main | `8f335bc0b8bdbfa7dd5b95e72708b2e12862e54f` |
| Staging | https://car-test.adobesun.com → `/var/www/car-care-staging/`（bundle `index-D4Bw8zWY.js`） |
| Prod | https://car.adobesun.com → **未部署、未写入** |
| Disposable Supabase | `car-care-m2-smoke` / `skwoahneuqkqgxzpkkzl` |

## 2. 整改摘要（相对 f44f691）

详见 `docs/m3a-remediation-orphan-gc-migrate.md`。

| ID | 问题 | 处置 |
|---|---|---|
| **P0** | 同步自动 orphan GC 可在「上传未提交 DB ref」窗口误删对象 | **禁用同步自动 GC**；显式清理须 **grace 24h + recheck refs**；列表不完整/网络错误则 **中止、零删除** |
| **P1** | `migrateCloudLegacyMedia` 错误被同步丢弃 | 返回 `unmigrated/failed/errors/ok`；失败保留 M2 base64；同步文案 + `lastError` 提示重试 |

## 3. 自动化测试结果

| 套件 | 结果 |
|---|---|
| `npm test`（无 live env） | **222 passed** / 5 skipped |
| `npx tsc -b` | **PASS** |
| `npm run build` | **PASS**（产物指纹见部署报告） |
| `scripts/m3a-media-storage-smoke.mjs` | **7/7 PASS**（upload/download/RLS 跨用户拒绝/RPC/cleanup） |
| `src/sync/supabase.media-e2e.test.ts` | **3/3 PASS**（upload→restore、legacy migrate、orphan GC grace=0） |
| 生产项目 `tqjowsffppgoqtdokbzp` | **未触碰** |

## 4. 文档地图

| 路径 | 内容 |
|---|---|
| `docs/m3a-media-storage-migration.md` | 设计 / 风险 / 回滚 |
| `docs/m3a-remediation-orphan-gc-migrate.md` | P0/P1 整改说明 |
| `docs/sql/supabase-car-care-media-storage.sql` | BYO Storage SQL |
| `docs/m3a-staging-deploy-report.md` | 合并 + car-test 部署 + 浏览器验收清单 |
| 本文 | 最终验收矩阵 |

## 5. 非目标（本阶段）

- 生产 Contabo / `car.adobesun.com` 发布（需用户另行批准）
- Notion
- 自动 orphan GC 在同步路径恢复（刻意关闭）


## 6. Staging 部署

完整步骤、冒烟与浏览器验收清单见 **`docs/m3a-staging-deploy-report.md`**。
