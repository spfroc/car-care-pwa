# M3-C 双设备验收（disposable）

> 实现期清单。环境：两浏览器配置（或手机 + 桌面），**同一 disposable Supabase 用户**；禁止生产主数据。  
> 规格：`m3c-mvp-frozen-spec.md` §7。本 MVP **不含** M3-C.1「最近删除 30 天」。

| # | 场景 | 期望 | 自动化 | 真人 |
|---|------|------|--------|------|
| D1 | A/B 登录并首次同步 | 两侧一致 | — | ☐ |
| D2 | 同一车辆/记录并发编辑 | open；不得静默丢 A 或 B | `m3c-conflict.test.ts` E2 | ☐ |
| D3 | 选「保留本地」 | bump + 正常 push；对端 pull 得本地 | keep_local 单测 | ☐ |
| D4 | 选「采用云端」 | 本地先恢复云端，再清 outbox | take_cloud 单测 | ☐ |
| D5 | 删除与修改冲突 | `edit_vs_delete` + 二次确认 | E3 单测 | ☐ |
| D6 | 离线后同步遇对端已改 | open 而非静默 LWW | E2 | ☐ |
| D7 | 解决失败重试 | 保持 open；可重试 | resolve failure 单测 | ☐ |
| D8 | 同步中第二标签点解决 | busy / 锁提示 | M3-B 锁既有覆盖 | ☐ |
| D9 | 非 vehicles/records | 不进手动队列 | stations 单测 | ☐ |

**明确不做（本 PR）**：设置页最近删除 30 天浏览/恢复（→ M3-C.1）；部署；改正式 Supabase schema。
