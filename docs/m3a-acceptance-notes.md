# M3-A 验收笔记

**基线**：`main` @ `42c1b61`  
**分支**：`feature/m3a-media-storage-objects`  
**Disposable 项目**：`car-care-m2-smoke` / `skwoahneuqkqgxzpkkzl`（已应用 Storage SQL；**未**触碰 `tqjowsffppgoqtdokbzp`）  
**部署**：无 Contabo / 无 `car.adobesun.com`

## 测试结果

| 套件 | 结果 |
|---|---|
| `npm test`（含 mediaStorage / media-migration） | **213 passed** / 2 skipped |
| `tsc -b` | PASS |
| `npm run build` | PASS |
| `scripts/m3a-media-storage-smoke.mjs` | **7/7 PASS**（upload/download/RLS cross-user/RPC/cleanup） |
| `src/sync/supabase.media-e2e.test.ts` | **3/3 PASS**（upload→restore、legacy migrate、orphan GC） |

## 文档

- 设计 / 风险 / 回滚：`docs/m3a-media-storage-migration.md`
- BYO SQL：`docs/sql/supabase-car-care-media-storage.sql`（+ 既有 rows SQL）

## 明确未做

- 生产 Supabase 写入  
- Contabo / 生产站部署  
- Notion  
