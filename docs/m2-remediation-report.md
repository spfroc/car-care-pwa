# M2 审查修复报告（PR #2）

> 基线：`188ca3d` → `42d8481` → `7ca11b6` → **round-4** 见最新 commit。  
> **未合并、未部署** Contabo / 生产。

## Round-4

| # | 问题 | 处理 |
|---|---|---|
| 1 | `disconnectCloud` 无条件 `clearOutbox` | **保留**待同步队列；断开后同账号重连可继续同步；`cloudUserId` 保留以便归属 |
| 2 | `restoreFromCloud` 用全量 outbox / `replaceLocal` 清空全部 outbox | 冲突判断仅用 **当前账号** `listOutboxForUser`；`replaceLocal` 只删当前账号 opIds，保留他账号队列 |
| 3 | 审计 `clearOutbox`/`listOutbox` | engine 路径：`disconnect` 不再 clear；merge pending / status 计数均账号隔离；新增 `clearOutboxForUser` |

## Round-3 / Round-2

见 git history（账号隔离、LWW 首次上传、原子事务、分页、RPC 等）。

## 测试

```
npm test     # 191+ passed
npx tsc -b
npm run build
```

## 真实 Supabase 冒烟

见本节更新或 `artifacts/m2-supabase-smoke.md`（若本轮成功创建 disposable 项目）。
