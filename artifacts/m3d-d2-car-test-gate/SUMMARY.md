# M3-D car-test 发布前门禁 — 执行报告

**Ran:** 2026-10-14 16:15 CST (Asia/Shanghai)  
**main tip (baseline):** `137e318a65df5bee3e9155d32b06930a16493884`  
**独立修复提交:** `5b7052c00d2ed7370c7cca119672bed247c5396a` → PR https://github.com/spfroc/car-care-pwa/pull/17  
**Gateway (d1-test only):** `https://car-care-notion-sync-d1-test.spf-roc.workers.dev`  
**Worker version (live):** `m3d-d1-0.1.1`  
**keyFp:** `91dee0d48d59` · **workspaceFp:** `c647ac0368ff` (unchanged)

**Deploy PWA:** **未执行**（用户明确暂不授权；本轮仅 d1-test Worker 配置/代码）  
**正式 Supabase:** **未变更** · **d1-test ≠ 正式 Gateway**

---

## 1) PayloadJson name/plate 往返 — **PASS**

| Item | Detail |
|------|--------|
| 根因 | Worker `slimPayload` 将 `name`/`plate`/`id`/`energyType` 抽到 Notion 列，但 `/sync/pull` 与 conflict `cloudRow` 只返回 decoded `PayloadJson`，未回填列字段 |
| 修复 | `hydrateCloudPayload`（`docs/templates/notion-sync-worker/src/payload.ts`）；`pull.ts` / `push.ts` `liteToCloudRow` 调用 |
| 断言 | Worker unit `tests/payload.test.ts`（hydrate round-trip）；live `payload-roundtrip.json` |
| Live 证据 | create→push→pull：`name`/`plate`/`id`/`energyType` + slim extras `bodyType`/`fuelGrade` 全部还原；随后 delete 清理 |
| 独立修复 PR | https://github.com/spfroc/car-care-pwa/pull/17 （**勿从此报告 merge**；留给独立审查） |

**Kind:** real Gateway API round-trip（d1-test）。前端映射路径此前浏览器烟雾已证明 UI 会写入 name/plate；本轮确认丢失点在 Worker pull 回填，修复后 API 路径无损。

---

## 2) CORS — **PASS**（d1-test Worker only）

| Item | Detail |
|------|--------|
| 配置 | `ALLOWED_ORIGIN=https://car-test.adobesun.com,http://localhost:5173`（逗号分隔精确匹配） |
| 代码 | `cors.ts` `parseAllowedOrigins` — **不**反射任意 Origin |
| car-test | OPTIONS/GET → ACAO=`https://car-test.adobesun.com` |
| localhost | OPTIONS/GET → ACAO=`http://localhost:5173` |
| evil | OPTIONS/GET → **403** Origin not allowed；无 ACAO |
| 证据 | `cors-evidence.json` + 原始 hdr-\*.txt（指纹 only） |

**未**部署 PWA 到 car-test/prod。

---

## 3) npm test — **PASS**

| Check | Result |
|-------|--------|
| `npm test` | **339 passed** / 5 skipped（31 files / 3 skipped） |
| `tabLock.test.ts` ×2 | **12/12 PASS** 两次；**本轮未复现** 偶发 P0 lease fail |
| `npx tsc -b` | exit 0 |

---

## 4) SW1–SW4 标签（诚实口径）

| ID | Status |
|----|--------|
| SW1–SW4 | **SKIP (unit-only)** — **未完成真实双工作区联调**；**不得**称为真实 E2E PASS |
| 依据 | 单一 d1-test workspaceKey；unit 覆盖见 `notion-d2-p5.test.ts` |

继续沿用上轮：live Gateway CRUD/conflict/DEL 为 API PASS；SW 仅 unit。

---

## 5) 交叉引用

- 验收 artifacts PR #16（本报告）：本分支  
- 业务修复 PR #17：`fix/m3d-payload-name-plate-rehydrate` @ `5b7052c00d2ed7370c7cca119672bed247c5396a`  
- 上轮 full acceptance：`artifacts/m3d-d2-full-acceptance/`

---

## 收尾门禁

- [x] 未 merge 任何 PR  
- [x] 未部署 car-test/prod PWA  
- [x] 未改正式 Supabase  
- [x] 仅更新 d1-test Worker（vars + script content → `m3d-d1-0.1.1`）  
- **建议：** 门禁证据齐全后交前端复审；**再**请求授权部署

