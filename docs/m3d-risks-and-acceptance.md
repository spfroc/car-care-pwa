# M3-D 风险清单与分阶段验收矩阵

> **状态**：设计中（2026-10-13）· docs-only  
> 配套：[`m3d-mvp-spec.md`](./m3d-mvp-spec.md) · [`m3d-architecture.md`](./m3d-architecture.md)

## 1. 风险清单

| ID | 风险 | 严重度 | 可能性 | 缓解 | 残余 |
|----|------|--------|--------|------|------|
| R1 | Notion Token 泄露进前端/日志/Git | 致命 | 中（若实现漂移） | 类型层禁止 token 字段；CI 扫描；代理不回显；设计否决 A | 用户误贴到错误配置框 — UI 校验与告警 |
| R2 | 无原子 LWW，双设备 TOCTOU 丢更新 | 高 | 中 | Worker 单飞锁 + `AppUpdatedAt`；M3-C 冲突 UI | 弱于 Postgres `FOR UPDATE` |
| R3 | `last_edited_time` 粒度粗 / 被 UI 手动编辑干扰 | 中 | 高 | **以 `AppUpdatedAt` 为权威**；不依赖 Notion 编辑时间做 LWW | 用户在 Notion UI 改属性未改戳 — 需文档「请用 App 编辑」或 Webhook 将来补 |
| R4 | Rate limit 180/min；首次全量上传超时 | 中 | 中 | 出站队列；尊重 `Retry-After`；分块 snapshot；退避与 outbox | 超大库用户体验差 |
| R5 | 写入 503 已提交却重试 → 重复页 | 高 | 低～中 | 按 Notion `retry_guidance` 先读；始终按 `AppEntityId` query 再 create | 实现缺陷仍可能双页 — 验收测 |
| R6 | Free 多人 workspace **1000 blocks** 配额（API 约 2026-09 强制） | 高（对目标用户） | 中 | 文档要求单人 Free 或付费；监测 403 `block_limit`；MVP 控制属性/块膨胀 | 删除不返还额度 |
| R7 | Rich text 2000 字符 → PayloadJson 截断 | 高 | 高（复杂记录） | 瘦字段 + 拆分属性或外置；验收用大记录 | 完整保真可能失败 |
| R8 | 媒体：Notion 文件 URL 1h 过期 | 中 | 高（若误用） | MVP **不同步媒体二进制** | 用户期望「图也在 Notion」落空 — 产品文案 |
| R9 | `isCloudEnqueueEnabled` 未扩 notion → 静默不入队 | 高 | 高（若漏改） | 架构盘点已标；实现 PR checklist | — |
| R10 | 与 Supabase 双开撕裂 | 高 | 中 | MVP **互斥 provider** | 高级用户绕过 |
| R11 | Trash / archive 语义（`in_trash` vs `is_archived`，API 2026-03-11） | 中 | 中 | 固定 Version；删除用 `in_trash`；query 文档区分 | Notion 再变更 |
| R12 | 用户 Worker 停机 / 密钥轮换 | 中 | 中 | 本地 IDB 仍可用；设置页健康检查；轮换文档 | 云副本陈旧 |
| R13 | 应用方误建集中 Token 库「图省事」 | 致命 | 低 | 架构明文否决；评审门禁 | 组织压力 |
| R14 | Database vs Data Source API 混用旧代码 | 中 | 中 | 以 `2026-03-11` + Data Source query 为准；勿假设 `database.properties` | — |
| R15 | 页面未 Share 给 Integration → 404 | 低 | 高 | 向导强制分享步骤；`verify` 友好错误 | — |

### 1.1 API 能力摘要（调研锚点）

| 主题 | 要点 | URL |
|------|------|-----|
| OAuth / Internal / PAT | Public 用 OAuth+refresh；Internal/PAT 静态 Bearer；secret 勿进前端 | https://developers.notion.com/guides/get-started/authorization |
| Data Source | DB 容器 + data_sources；query/retrieve schema | https://developers.notion.com/guides/data-apis/working-with-databases |
| 分页 | `start_cursor` / `page_size` max 100 | https://developers.notion.com/reference/pagination |
| 限流 | 180/min（非 Biz/Ent）；429/529 + Retry-After；写 503 谨慎重试 | https://developers.notion.com/reference/request-limits |
| 删除 | `in_trash: true`；不可永久删除；`archived` 请求字段在 2026-03-11 移除 | https://developers.notion.com/reference/trash-page · upgrade guide |
| 文件 | ≤20MiB 单部分；更大 multipart；Free 5MiB；URL 1h | https://developers.notion.com/guides/data-apis/working-with-files-and-media |
| 块配额 | 多人 Free 1000 lifetime blocks | https://developers.notion.com/reference/workspace-block-limits |

---

## 2. 分阶段验收矩阵

阶段含义：**D0** 设计（本 PR）→ **D1** 代理原型 → **D2** PWA adapter（无媒体）→ **D3** 冲突/多设备 → **D4** 硬化与文档封板。  
**本仓库当前任务只要求 D0。**

### 2.1 D0 — 设计（本 PR）

| # | 验收项 | 证据 |
|---|--------|------|
| D0.1 | 三文档落盘且中文可读 | `docs/m3d-*.md` |
| D0.2 | 代码盘点含路径与复用/分叉 | `m3d-architecture.md` §0 |
| D0.3 | API 调研含 URL | 本文 §1.1 + 架构 §2–5 |
| D0.4 | 单一推荐 + 否决表 | 架构 §1 |
| D0.5 | 可行性 stub 顶部指向 M3-D | `notion-sync-feasibility.md` |
| D0.6 | 无业务 src 实现、无生产/Supabase 变更 | PR diff 仅 docs（+可选 roadmap） |

### 2.2 D1 — 用户 Worker 原型（实现后续）

| # | 验收项 | 通过标准 |
|---|--------|----------|
| D1.1 | Token 仅 env | 故意请求响应体无 token；日志脱敏 |
| D1.2 | verify | 未分享页时可读错误；分享后 ok |
| D1.3 | 按 AppEntityId 创建/更新 | 两次 upsert 同一 page id |
| D1.4 | LWW skip | 云端较新返回 cloud_newer 且不覆盖 |
| D1.5 | 429 处理 | 模拟限流后最终成功或可诊断失败 |
| D1.6 | trash | delete → `in_trash`；可 restore 策略符合文档 |

### 2.3 D2 — PWA NotionProvider（vehicles+records）

| # | 验收项 | 通过标准 |
|---|--------|----------|
| D2.1 | enqueue | `isCloudEnqueueEnabled` 含 notion；写车/记录有 outbox |
| D2.2 | 离线→在线 | 断网编辑，恢复后 push 成功 |
| D2.3 | pull 合并 | 第二设备拉到第一设备数据 |
| D2.4 | 无 token 前端 | bundle/grep/设置导出扫描 |
| D2.5 | Supabase 回归 | provider=supabase 原测试绿 |
| D2.6 | 媒体 | media 不上传 Notion；本地图仍可用 |
| D2.7 | 互斥 | 不能同时启用 supabase+notion |

### 2.4 D3 — 冲突与账号

| # | 验收项 | 通过标准 |
|---|--------|----------|
| D3.1 | E1 | push cloud_newer → open conflict，队列不丢意图 |
| D3.2 | E2 | 双侧脏 pull → open |
| D3.3 | keep_local / take_cloud | 对齐 M3-C；持锁 |
| D3.4 | 回声抑制 | 自推不误 open |
| D3.5 | 账号切换 | 旧 owner outbox 不推新 workspace |
| D3.6 | 首次双非空 | 无静默覆盖；有确认 UI |

### 2.5 D4 — 硬化

| # | 验收项 | 通过标准 |
|---|--------|----------|
| D4.1 | 大 payload | 超 2000 字记录有明确降级或成功拆分 |
| D4.2 | 块配额 | 403 block_limit 用户可见指引 |
| D4.3 | 轮换 Token | 换 Secret 后旧会话失效、新会话可用 |
| D4.4 | Notion-Version 钉死 | Worker 固定 `2026-03-11`（或评审后的更新版本） |
| D4.5 | 文档与模板 | 用户可按 README 30 分钟内部署 Worker |

---

## 3. 退出 / 降级条件

若 D1–D2 证明以下任一成立，应暂停产品化并回退「仅可行性 stub」：

1. 无法在不集中持有 Token 的前提下完成可接受 UX；或  
2. Payload 保真在 Notion 属性限制下系统性失败且用户不可接受瘦字段；或  
3. LWW 竞态导致不可接受的数据丢失率（即使有冲突 UI）。

降级产品选项：Notion **单向导出**（非双向 sync），仍经用户代理、仍禁止 token 进前端。
