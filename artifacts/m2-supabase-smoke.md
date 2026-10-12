# M2 真实 Supabase 验收（Round-4）

**时间**：2026-10-12（Asia/Shanghai）  
**未部署** Contabo / 生产 App。  
**未使用** 既有生产项目 `tqjowsffppgoqtdokbzp`；全程仅用 disposable。

## 项目

| 项 | 值 |
|---|---|
| Name | `car-care-m2-smoke` |
| Ref / id | `skwoahneuqkqgxzpkkzl` |
| Region | `ap-northeast-1` |
| URL | `https://skwoahneuqkqgxzpkkzl.supabase.co` |
| Schema | 已 `apply_migration`：`docs/sql/supabase-car-care-rows.sql`（表 + RLS + `car_care_upsert_lww`） |
| Auth | 冒烟账号（SQL 创建，仅 disposable）：`m2smoke@carcare.test` |
| Keys | 仅 **anon / publishable**；前端路径未使用 service_role |

## 结果

### Layer 1 — `scripts/m2-supabase-smoke.mjs`（anon + Auth）

全部 PASS：

- auth.signIn
- table.probe（`car_care_rows`）
- rpc.lww.apply / skip_older / apply_newer
- cross_device_ish.pull（device-a → device-b LWW）
- rls.block_anon_insert
- cleanup

### Layer 2 — `src/sync/supabase.live-smoke.test.ts`（引擎路径）

需环境变量 `SMOKE_SUPABASE_URL` + `SMOKE_SUPABASE_ANON`；无 env 时 `skipIf`。

PASS（30s timeout）：connect → firstUpload → replaceLocal restore → disconnect 保留 outbox → reconnect bidirectionalSync，云端 name=`AfterDisconnect`。

## 运行方式

```bash
export SMOKE_SUPABASE_URL=https://skwoahneuqkqgxzpkkzl.supabase.co
export SMOKE_SUPABASE_ANON='<anon from get_publishable_keys>'
node scripts/m2-supabase-smoke.mjs
npx vitest run src/sync/supabase.live-smoke.test.ts
```

## 后续

- disposable 项目可在验收后 `pause_project` / 删除（需用户明确授权）。
- 仍 **不要** 把该项目密钥写进生产 Contabo 部署。
