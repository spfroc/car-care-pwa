# 车护助手云同步路线图（M3 分阶澄清）

> 避免「Phase C / M3-A / M3-B」混用。以本文件为准；旧文档中的 Phase C 拆条已映射到此。

## 总览

| 阶段 | 名称 | 状态 | 范围 |
|------|------|------|------|
| **M2** | 用户自有云（行同步 + outbox） | ✅ 已上线 | Supabase 行表、LWW、设置 UI、账号切换安全 |
| **M3-A** | 媒体私有 Storage | ✅ 已上线（生产静态） | base64→Storage、RLS bucket、迁移/孤儿 GC 策略 |
| **M3-B** | 多标签锁 · BG Sync 增强 · Outbox  Harden | ✅ 已上线（生产 d7dd681 / car.adobesun.com；car-test 同版本） | Web Locks / lease、BG Sync 可选、关页/并发不丢队列 |
| **M3-C** | 冲突合并 UI + 双端体验 | 🚧 进行中（设计中） | 设置页冲突列表可操作（保留本地/采用云端）；删除恢复可视；双设备交叉编辑验收 |
| **M3-D** | Notion（或其它 adapter） | 📋 仅可行性通过后 | 见 `notion-sync-feasibility.md`；安全认证前不接真 API |

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

