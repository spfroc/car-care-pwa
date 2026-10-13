# Notion 作为可选同步后端 — 可行性说明（stub）

> **状态**：调研 + UI 占位。本里程碑 **不**实现 Notion API 读写。  
> **优先级**：Supabase 验证通过后再评估是否开工。  
> **M3-D 设计（2026-10-13）**：规格 / 架构 / 风险验收已起草，第二轮审查裁定已合入 — 见  
> [`m3d-mvp-spec.md`](./m3d-mvp-spec.md) · [`m3d-architecture.md`](./m3d-architecture.md) · [`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md) · [`m3d-architecture-review-round2.md`](./m3d-architecture-review-round2.md)。  
> 下文既往结论仍然有效；实现须遵守 M3-D 文档中的单一推荐方案与否决项。

## 1. 目标回顾

用户可选「自有 Notion workspace」作为备份/同步目标，与「自有 Supabase」并列；默认仍为本地 IndexedDB。

## 2. 可行性结论（摘要）

| 维度 | 评估 | 说明 |
|---|---|---|
| 数据模型 | 弱 | Database 属性类型有限；嵌套记录/媒体差；难表达 CareRecord 联合类型 |
| 冲突 / 版本 | 弱 | 无原生 row version / LWW；`last_edited_time` 粒度粗 |
| 配额 | 风险 | API rate limit + workspace 块数量；含图 base64 不现实 |
| 认证安全 | **阻断** | Internal Integration Token / OAuth token 属长效密钥；**不可**打进 PWA 前端 bundle |
| 多设备 | 一般 | 需中转或每设备持有 token（更差） |

**结论**：在缺少 **安全认证通道**（用户 OAuth 经受控后端代理，token 永不进前端）之前，Notion **不应**作为生产同步后端。个人 token 方案明确否决。

## 3. 若未来要实现：安全路径

1. **受控代理**（Cloudflare Worker / 自有 API）：PWA 只持有短命用户 session；代理持有 Notion token（用户自建 integration，token 仅存用户自有密钥库或用户粘贴到 **代理** 而非 PWA）。  
2. 或 Notion OAuth public integration（**非 MVP**）：授权码经**用户自有**代理换 token，refresh **仅存用户自有 Worker**（绝不存应用方集中库，也绝不下发 PWA）。  
3. 映射：一个 parent database / 每实体一 database；MVP **不同步媒体二进制**（非完整图文云备份）；若未来外链图，对象存储须用户自有。  
4. 同步协议仍复用本仓 `CloudProvider` + outbox；Notion 仅是另一 adapter。

> M3-D 将上述路径收敛为：**用户自部署 Worker + Token 仅存 Worker**；MVP 实体仅 vehicles+records；**不同步图片**；Gateway API Key Bearer（密钥不进 IDB/JSON 备份）。细节以 [`m3d-architecture.md`](./m3d-architecture.md) / [`m3d-mvp-spec.md`](./m3d-mvp-spec.md) 为准；审查纪要见 [`m3d-architecture-review-round2.md`](./m3d-architecture-review-round2.md)。

## 4. 本 PR 的 stub 行为

- 设置「数据存储」可选 Notion，但展示「尚未开放」说明与本文档链接。  
- `NotionProvider` 所有方法抛出 `NotionNotImplementedError`。  
- 无 `@notionhq/client` 依赖；无网络调用。

## 5. 开工门槛（checklist）

- [x] Supabase 路径在真实自有项目上验证（RLS + 双向同步）— M2–M3-C  
- [x] 确定代理宿主与密钥托管（用户自有 Worker，非应用方多租户）— M3-D 推荐已冻结；待实现  
- [ ] 原型：无媒体文本实体 push/pull  
- [ ] 安全复审：前端 bundle 扫描零 Notion token  
- [ ] M3-D 设计文档架构评审通过后再开实现 PR  
