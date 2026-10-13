# M3-C Staging 部署与验收报告

> **时间**：2026-10-13 ~09:48–10:00 Asia/Shanghai (CST)；**D5/D8 补强重跑** ~10:15–10:22 CST  
> **执行**：Grok Bot executor（`/workspace/car-care-pwa/app`）  
> **硬约束**：仅部署 https://car-test.adobesun.com；**未**部署 https://car.adobesun.com；**未**改正式 Supabase `tqjowsffppgoqtdokbzp`；**未**碰 Notion；**未**做 M3-C.1 30 天恢复。

## 1. 版本指纹

| 项 | 值 |
|---|---|
| PR | https://github.com/spfroc/car-care-pwa/pull/7（**MERGED**） |
| Feature tip（审查通过） | `29b3c5e79fa6de6545d358fc701726cce3b05e3b` |
| **main merge commit** | **`9b64a2bd204acfb5791f3f6668110e4c00ab3c95`** |
| Staging URL | https://car-test.adobesun.com |
| Staging 路径 | Contabo `/var/www/car-care-staging/` |
| Staging 主 bundle | `assets/index-TdTLY2U-.js` |
| Bundle sha256 | `6eb256e40f233cae892b6b07cc9e368f71d504a3aa3656287509e436ce66c3cb` |
| Staging backup | `/var/www/car-care-backups/car-care-staging-pre-m3c-20261013-034929.tar.gz` |
| Deploy stamp builtAt | `2026-10-13T09:49:18+08:00` |
| Prod URL | https://car.adobesun.com |
| Prod（部署后核对） | 仍为 `index-Cv8wDxDq.js` / git `d7dd681` — **未改** |

**结论**：car-test 公网 HTML / JS / `deploy-stamp.txt` 均指向 **main `9b64a2b`**；与本地构建 sha256 一致。生产未动。

## 2. 合并前验证

| 检查 | 结果 |
|---|---|
| PR #7 body | 已含 R1/R2/R3 摘要、275/5、仅 car-test、不改正式库（协调员/最终 GitHub 正文为准） |
| `npm test` @ `29b3c5e` | **275 passed** / 5 skipped |
| `npm run build`（含 `tsc -b`） | **PASS** → `index-TdTLY2U-.js` |
| 合并方式 | `gh pr merge 7 --merge`（与 PR#6 一致） |

## 3. 部署步骤（仅 staging）

1. `gh pr merge 7 --merge` → merge commit `9b64a2b`  
2. `git checkout main && git pull` → `npm run build`  
3. 写入 `dist/deploy-stamp.txt`（`target=car-test.adobesun.com`）  
4. SSH `root@161.97.138.206`（`/home/box/.ssh/contabo_vps`）  
5. 备份 **仅** `/var/www/car-care-staging`  
6. 清空 staging 并解压新 dist；**未**触碰 `/var/www/car-care`  
7. 部署前后 prod bundle/stamp 相同；`nginx -t` OK  

## 4. 公网核对

| 检查 | 结果 |
|---|---|
| `GET https://car-test.adobesun.com/deploy-stamp.txt` | `git=9b64a2b…` / `bundle=index-TdTLY2U-.js` |
| Staging bundle sha256 | = 本地构建 |
| `GET https://car.adobesun.com/deploy-stamp.txt` | 仍 `d7dd681` / `index-Cv8wDxDq.js` |

## 5. D1–D9 双设备验收（disposable）

**环境**

- 站点：https://car-test.adobesun.com（`9b64a2b` / `index-TdTLY2U-.js`）  
- 云：仅 disposable `https://skwoahneuqkqgxzpkkzl.supabase.co`  
- 账号：`m2smoke@carcare.test`（凭据仅 `.env.smoke.local`，gitignore）  
- 脚本：`scripts/m3c-staging-acceptance.mjs`  
- 产物：`artifacts/m3c-staging-accept/`（`results.json` + screenshots + `unit-m3c.log`）  
- **方法标注**：双 Playwright **独立 context** ≈ 双设备（分 IDB）；冲突场景用本地 pending + 云端 API 写入对端版本（自动化等价）；**非**真人手机+桌面。单元路径另跑 `m3c-conflict.test.ts` + `conflictDetect.test.ts`（**20 passed**）。

| # | 场景 | 结果 | 证据要点 |
|---|------|------|----------|
| D1 | A/B 登录并首次同步 | **PASS** | A 推送车辆；B 拉取同名 `D1-Car-A`；IDB 含 `sync_conflicts` |
| D2 | 并发编辑 → open | **PASS** | `edit_edit` open；本地仍 `D2-Local`（无静默 LWW） |
| D3 | 「保留本地」 | **PASS** | 冲突关闭；本地+云端均为 `D3-KeepLocal` |
| D4 | 「采用云端」 | **PASS** | 本地 `D4-CloudWin`；对应 outbox 清空；冲突关闭 |
| D5 | 删除与修改 + **真点击**二次确认 | **PASS** | 见 §5.1：取消无变 → 确认后云端删生效 |
| D6 | 离线后同步遇对端已改 | **PASS** | open + 本地名保留 |
| D7 | 解决失败重试 | **PASS** | abort REST 时保持 open/本地/outbox；恢复后 take_cloud 成功 |
| D8 | 持锁期间另一标签**真点击**同步 | **PASS** | 见 §5.2：持锁中 busy；未 await 完整持锁；释放后同步 OK |
| D9 | 非 vehicles/records | **PASS** | stations 冲突 **不**进入 open 队列 |
| TOCTOU | 后续新编辑保护 | **PASS** | post-conflict 编辑后 take_cloud 不覆盖 `TOC-NewEdit`；冲突保持 open |

**脚本合计：49 / 49 PASS**（含指纹、unit、D5/D8 补强断言、回归探针）。

## 5.1 D5 补强：删除冲突二次确认（真点击）

**审查缺口**：旧脚本仅断言 `edit_vs_delete` +「采用云端」按钮存在 / dialog handler 已注册。  
**补强后**（`scripts/m3c-staging-acceptance.mjs`）：

1. 造 local upsert vs cloud tombstone → `kind=edit_vs_delete`  
2. 定位「删除与修改冲突」行，**实际 click**「采用云端」  
3. **第一次 dismiss** 原生 confirm（文案含「确定采用云端删除？」）  
4. 断言：冲突仍 `open`；本地 record `note=keep-me`；outbox opIds **未变**  
5. **第二次 accept** 同一确认  
6. 断言：冲突关闭；本地 record 删除；outbox 清空（采用云端删）

| 断言 | 结果 |
|------|------|
| `D5.edit_vs_delete` | PASS |
| `D5.cancel.dialog-delete-confirm` | PASS（真 dialog message） |
| `D5.cancel.no-mutation` | PASS |
| `D5.accept.dialog-delete-confirm` | PASS |
| `D5.accept.take-cloud-delete` | PASS |

**证据**：`artifacts/m3c-staging-accept/d5-confirm-cancel-dialog.txt`、`d5-confirm-accept-dialog.txt`、`d5-after-cancel.png`、`d5-after-accept.png`

## 5.2 D8 补强：持锁期间另一标签同步（禁止 await 完整持锁）

**审查缺口**：旧脚本 `await pageA.evaluate(…hold 4s…)` 后再点 B，等于持锁已结束才同步。  
**补强后**：

1. 同 context 双 page（共享 Web Locks + IDB）  
2. 种子 pending outbox（`D8-HoldLock-Pending`）  
3. Tab A：`navigator.locks.request('car-care-sync')` 取得锁后 **立即返回**；用 `waitForFunction` 确认 `held===true`  
4. **在 A 仍持锁时** Tab B 点击「双向同步」（**未** await A 的完整持锁 Promise）  
5. B 收到 busy toast：`另一标签页或任务正在同步，请稍候再试（队列已保留，不会丢数据）。`  
6. 断言 outbox 未变、无 mutating REST；`heldDuring===true`  
7. 释放 A 后 B 再同步 → 推送成功、outbox 清空

| 断言 | 结果 |
|------|------|
| `D8.A.holding` / `D8.pre-click-B.A-still-held` | PASS |
| `D8.B.busy-toast` / `D8.B.during-A-held` | PASS |
| `D8.B.no-protected-outbox-write` | PASS（mutatingRest=[]） |
| `D8.after-release.sync-ok` | PASS |

**证据**：`artifacts/m3c-staging-accept/d8-busy-evidence.json`、`d8-busy.png`、`d8-after-release.png`、`run-d5d8.log`

## 6. 回归（M2 / M3-A / M3-B）


| 套件 | 结果 |
|------|------|
| `scripts/m3b-staging-browser-accept`（E1 适配本轮 prod=M3-B） | **18 / 18 PASS** — SW、路由、JSON UI、IDB（含 media/outbox/conflicts）、Web Locks、IDB lease、离线 outbox、prod 未改 |
| M3-C 脚本内回归探针 | IDB stores / Web Locks / 设置同步 UI / media 可写 — **PASS** |
| 正式 Supabase | **未触碰**（仅 disposable） |

## 7. 残留风险 / 边界

- 真人双端（手机+桌面）未跑；以双 context + IDB/云种子 + 单测矩阵等价覆盖，已在报告标注。  
- D5/D8 已按独立审查补强为真点击路径（见 §5.1 / §5.2）；不再仅以按钮存在或 await 完整持锁作为 PASS。  
- SW 缓存：已在验收中 unregister/清缓存；用户旧 tab 可能需硬刷新。  
- M3-C.1「最近删除 30 天」明确未做。

## 8. 回滚（staging only）

```bash
ssh -i /home/box/.ssh/contabo_vps root@161.97.138.206
tar -xzf /var/www/car-care-backups/car-care-staging-pre-m3c-20261013-034929.tar.gz -C /var/www
# 勿动 /var/www/car-care
nginx -t
```

## 9. 相关文档 / 脚本

- `docs/m3c-mvp-frozen-spec.md` — 冻结规格  
- `docs/m3c-dual-device-acceptance.md` — D1–D9 矩阵  
- `docs/m3c-conflict-ui-architecture.md` — 架构  
- `scripts/m3c-staging-acceptance.mjs` — 本轮验收脚本  
- `artifacts/m3c-staging-accept/results.json` — 全量断言（本轮 **49 PASS**）  
- `artifacts/m3c-staging-accept/run-d5d8.log` — D5/D8 补强 Playwright 日志  

## 10. 明确声明

- **未改业务源码**（仅更新 `scripts/m3c-staging-acceptance.mjs` + 本报告）  
- **未**部署生产 `car.adobesun.com`  
- **未**修改正式 Supabase `tqjowsffppgoqtdokbzp` 数据或配置  
- **未**碰 Notion；**未**实现 M3-C.1  
