# M2 审查修复报告（PR #2）

> 基线 head：`188ca3d` → 本报告对应后续 remediation commit。  
> **未合并、未部署** Contabo / 生产。

## 修复对照

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| 1 | P0 | 业务写与 `sync_outbox` 非同一事务 | 仓储 `put*` / `delete*` 在同一 IndexedDB 事务写入业务 store + outbox；`settleTx` 保证中途抛错 abort 回滚 |
| 2 | P0 | `restoreFromCloud({replaceLocal:true})` 清空与应用分事务 | `applyCloudRows` 在**单事务**内 clear（含 outbox）+ apply；失败 abort，本地保持原样 |
| 3 | P0 | `firstUploadToCloud` 成功后 `clearOutbox()` 误删并发 ops | 改为 `ackOutboxCoveredByUpload`：仅移除 `entity+id` 且 `mutatedAt <= 上传快照 updatedAt` 的项 |
| 4 | P1 | `pullAll` 受 1000 行限制 | Supabase `.range` 分页（`pageSize=1000`）直至耗尽；单测验证多页聚合 |
| 5 | P1 | `pushOps` 读后写 TOCTOU | SQL `car_care_upsert_lww` RPC（`FOR UPDATE` + 条件 upsert）；客户端只调 RPC，缺 RPC 则明确报错要求升级 schema |
| 6 | P1 | 云端载荷未校验 | `validatePayload.ts`；restore/sync 写入前 `assertCloudRowsValid` |
| 7 | 安全 | JWT/RLS/账号切换 | 拒绝 service_role（含 JWT `role` claim）；https URL；`getUser()` 校验会话；账号切换清空队列与 cursor；凭证不同步到云 |
| 8 | 验收 | 故障注入 / 双端 / 离线 / 重复同步 / 删除冲突 | `remediation.test.ts` |
| 9 | 冒烟 | 真实 Supabase | **未对接现网项目**：MCP 可见项目 `spfroc's Project`（含真实用户邮箱），避免写入生产数据；新建 disposable 项目需费用确认。以 Memory + mock client 覆盖；schema/RPC 见 `docs/sql/supabase-car-care-rows.sql` |
| 10 | 流程 | PR / 日志 / SHA | 本报告 + artifacts + PR 描述更新 |

## 测试

```
npm test     # 184 passed
npx tsc -b
npm run build
```

## 仍留给 Notion / 后续

- Notion 仍为可行性 stub  
- 媒体迁 Supabase Storage（Phase C）  
- 人工在**自有 disposable** Supabase 跑 SQL 后点「校验连接」冒烟（推荐）
