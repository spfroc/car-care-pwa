# M2 审查修复报告（PR #2）

> 基线：`188ca3d` → remediaiton-1 `42d8481` → **round-3** 见最新 commit。  
> **未合并、未部署** Contabo / 生产。  
> **真实 Supabase 冒烟仍待发布前完成**（现有 MCP 项目含真实用户，未写入；未建 disposable 项目）。

## Round-3（相对 `42d8481`）

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| 1 | P0 | `guardUserSwitch` 盲目清空未同步 outbox | **按 `ownerUserId` 隔离队列**；切换账号只重置 cursor，**不删**原账号 pending；切回可继续同步；`unbound` 仅在首次绑定/同账号重连时 rebind |
| 2 | P0 | `pushSnapshot` 无条件 upsert 覆盖云端较新行 | 首次上传改为走 **LWW RPC / Memory LWW**；云端较新 → `conflicts`（不进 `applied`）；补冲突场景测试 |
| 3 | P1 | `skipped_cloud_newer` 静默丢编辑 / 同步中再改 | conflict **不**列入 `applied`；写入 `sync_conflicts`（`push_skipped_cloud_newer`）；`removeStaleConflictOps` 清理过期项并 **保留更新的 mid-sync op**；补并发测试 |

## Round-2（已在 `42d8481`）

原子业务+outbox 事务、`replaceLocal` 单事务、选择性 first-upload ack、pull 分页、LWW RPC、载荷校验、凭证硬化等。

## 测试

```
npm test     # 188 passed
npx tsc -b
npm run build
```

## Notion / 发布前

- Notion 仍为 stub  
- **发布前**：在 disposable 自有 Supabase 执行 `docs/sql/supabase-car-care-rows.sql` 后人工冒烟  
