# 车护助手云同步路线图（M3 分阶澄清）

> 避免「Phase C / M3-A / M3-B」混用。以本文件为准；旧文档中的 Phase C 拆条已映射到此。

## 总览

| 阶段 | 名称 | 状态 | 范围 |
|------|------|------|------|
| **M2** | 用户自有云（行同步 + outbox） | ✅ 已上线 | Supabase 行表、LWW、设置 UI、账号切换安全 |
| **M3-A** | 媒体私有 Storage | ✅ 已上线（生产静态） | base64→Storage、RLS bucket、迁移/孤儿 GC 策略 |
| **M3-B** | 多标签锁 · BG Sync 增强 · Outbox  Harden | ✅ 已上线（生产 d7dd681 / car.adobesun.com；car-test 同版本） | Web Locks / lease、BG Sync 可选、关页/并发不丢队列 |
| **M3-C** | 冲突合并 UI + 双端体验 | 🚧 feature 实现中（未部署） | 仅 vehicles+records 手动解决；二选一；删改二次确认；30 天回收站 → follow-up。规格：[`m3c-mvp-frozen-spec.md`](./m3c-mvp-frozen-spec.md) · 架构：[`m3c-conflict-ui-architecture.md`](./m3c-conflict-ui-architecture.md) · 验收：[`m3c-dual-device-acceptance.md`](./m3c-dual-device-acceptance.md) |
| **M3-D** | Notion（或其它 adapter） | 📝 设计中（docs-only；PR #8；二轮审查有条件通过裁定已合入） | 规格/架构/风险/BYO/审查：`m3d-mvp-spec.md` · `m3d-architecture.md` · `m3d-notion-byo-architecture.md` · `m3d-risks-and-acceptance.md` · `m3d-architecture-review-round2.md`；可行性 stub：`notion-sync-feasibility.md`；安全认证前不接真 API；本阶段不写业务 src |

## 明确不在 M3-B

> M3-B 生产报告见 `docs/m3b-prod-deploy-report.md`。

- 冲突可视化合并（→ M3-C）  
- Notion 真同步（→ M3-D）  
- 改正式 Supabase schema / 生产部署  
- 改加满法油耗口径（独立产品决策）

## 与旧文档映射

| 旧说法 | 新说法 |
|--------|--------|
| Phase C.1 媒体 Storage | **M3-A** |
| Phase C.2 Background Sync / 多标签锁 | **M3-B** |
| Phase C.3 手动冲突合并 UI | **M3-C** |
| Phase D Notion | **M3-D** |

## 依赖

```
M2 ──► M3-A ──► M3-B ──► M3-C
                 └──► M3-D（可并行评估，实现仍建议 M3-C 后或旁路）
```

## M3-C 冻结备注（2026-10-12）

- 产品规格已冻结，见 `docs/m3c-mvp-frozen-spec.md`（用户批准）。  
- **实现**：`feature/m3c-conflict-ui`（本阶段）；**禁止 merge 后自动部署**；不改正式 Supabase。  
- **30 天最近删除恢复**：不在本 MVP；标为 M3-C follow-up（M3-C.1）。

