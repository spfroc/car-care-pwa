# M3-D 风险清单与分阶段验收矩阵

> **状态**：设计通过 · 实现规格已起草（2026-10-13）· docs-only · **第二轮裁定 + 第三轮闭合已合入**  
> 配套：[`m3d-mvp-spec.md`](./m3d-mvp-spec.md) · [`m3d-architecture.md`](./m3d-architecture.md) · [`m3d-notion-byo-architecture.md`](./m3d-notion-byo-architecture.md) · [`m3d-architecture-review-round2.md`](./m3d-architecture-review-round2.md)  
> **实现规格**：[`m3d-implementation-spec.md`](./m3d-implementation-spec.md)

## 1. 风险清单

| ID | 风险 | 严重度 | 可能性 | 缓解 | 残余 |
|----|------|--------|--------|------|------|
| R1 | Notion Token / 长期 Gateway 密钥泄露进前端/日志/Git/JSON 备份 | 致命 | 中（若实现漂移） | 类型层禁止 token/密钥持久化字段；CI 扫描；代理不回显；API Key 仅内存；导出过滤 | 用户误贴到错误框 — UI 校验 |
| R2 | 无原子 LWW，跨 Worker 实例 TOCTOU / 双页 | 高 | 中 | Gateway 同批串行 + `AppUpdatedAt`；M3-C；DO 仅 D4；**不承诺强一致** | 弱于 Postgres `FOR UPDATE` |
| R3 | `last_edited_time` / Notion UI 手改干扰 | 中 | 高 | 以 `AppUpdatedAt` 为权威；O6：UI 手改不支持为同步语义 | 残余接受 |
| R4 | Rate limit 180/min；首次全量超时 | 中 | 中 | 出站队列；`Retry-After`；分块 snapshot | 超大库体验差 |
| R5 | 写入 503 已提交却重试 → 重复页 | 高 | 低～中 | 先读后判；按 `AppEntityId` query（含 trash）再 create | 验收测 |
| R6 | Free 多人 workspace **1000 blocks** | 高（对目标用户） | 中 | 文档要求单人 Free 或付费；监测 403 | 删除不返还额度 |
| R7 | Rich text 2000 → Payload 截断丢数据 | 高 | 高（若误实现） | **失败闭合**；禁静默截断；往返校验（architecture §3.5） | 过大行无法上云 — 明示用户 |
| R8 | 媒体：用户以为图已上云 | 中 | 高（若文案漂移） | MVP 不同步图；禁「完整图文云备份」话术；设置常驻说明 | — |
| R9 | `isCloudEnqueueEnabled` 未扩 notion → 静默不入队 | 高 | 高（若漏改） | 实现 PR checklist | — |
| R10 | 与 Supabase 双开撕裂 | 高 | 中 | MVP **互斥 provider** | — |
| R11 | Trash 语义不清 / 旧设备复活已删实体 | 高 | 中 | 双轨 `in_trash`+`AppDeletedAt`；状态机 §4.7；create 前查 tombstone | Notion query 对 trash 行为需夹具钉死 |
| R12 | 用户 Worker 停机 / 密钥轮换 | 中 | 中 | 本地 IDB 仍可用；健康检查；轮换文档 | 云副本陈旧 |
| R13 | 应用方误建集中 Token 库 | 致命 | 低 | 架构否决；评审门禁 | — |
| R14 | Database vs Data Source API 混用 | 中 | 中 | 钉 `2026-03-11` + Data Source query | — |
| R15 | 页面未 Share → 404 | 低 | 高 | 向导强制分享；`verify` 友好错误 | — |
| R16 | 断开/切换默认清空 Outbox → 丢未推送意图 | 高 | 中（若误用 `clearOutboxForUser`） | §4.8：默认保留；禁跨 workspace 误推；验收 SW1–SW4 | — |

### 1.1 API 能力摘要（调研锚点）

| 主题 | 要点 | URL |
|------|------|-----|
| OAuth / Internal / PAT | Public 用 OAuth+refresh；Internal/PAT 静态 Bearer；secret 勿进前端；refresh 若用则仅存**用户自有 Worker** | https://developers.notion.com/guides/get-started/authorization |
| Data Source | DB 容器 + data_sources；query/retrieve schema | https://developers.notion.com/guides/data-apis/working-with-databases |
| 分页 | `start_cursor` / `page_size` max 100 | https://developers.notion.com/reference/pagination |
| 限流 | 180/min（非 Biz/Ent）；429/529 + Retry-After；写 503 谨慎重试 | https://developers.notion.com/reference/request-limits |
| 删除 | `in_trash: true`；不可永久删除；`archived` 请求字段在 2026-03-11 移除 | https://developers.notion.com/reference/trash-page · upgrade guide |
| 文件 | URL 1h 过期等 — MVP 不用作媒体真相源 | https://developers.notion.com/guides/data-apis/working-with-files-and-media |
| 块配额 | 多人 Free 1000 lifetime blocks | https://developers.notion.com/reference/workspace-block-limits |

### 1.2 删除状态转换摘要（验收锚点）

| 当前 | 事件 | 下一状态 | 要点 |
|------|------|----------|------|
| Absent | upsert | Alive | create |
| Alive | delete | Tombstone | `in_trash` + `AppDeletedAt`；仍可按 `AppEntityId` 解析 |
| Tombstone | 过期 upsert | Tombstone | **拒绝复活 / 禁止新 create** |
| Tombstone | 新戳恢复/编辑 | Alive | untrash + 清 `AppDeletedAt` |
| * | UI 硬删 | Absent | map 防盲目 recreate |

完整表：[`m3d-architecture.md` §4.7](./m3d-architecture.md)。

---

## 2. 分阶段验收矩阵

阶段含义：**D0** 设计（本 PR）→ **D1** 代理原型 → **D2** PWA adapter（无媒体）→ **D3** 冲突/多设备/切换 → **D4** 硬化与文档封板。  
**本仓库当前任务只要求 D0。**

### 2.1 D0 — 设计（本 PR）

| # | 验收项 | 证据 |
|---|--------|------|
| D0.1 | 主文档落盘且中文可读 | `docs/m3d-*.md` + 审查纪要 |
| D0.2 | 代码盘点含路径与复用/分叉 | `m3d-architecture.md` §0 |
| D0.3 | API 调研含 URL | 本文 §1.1 + 架构 §2–5 |
| D0.4 | 单一推荐 + 否决表 | 架构 §1 · 独立稿 §0/§7 |
| D0.5 | 可行性 stub 指向 M3-D；refresh 表述为用户自有 Worker | `notion-sync-feasibility.md` |
| D0.6 | 无业务 src、无生产/Supabase 变更 | PR diff 仅 docs |
| D0.7 | [x] 产品默认 P1–P4 已确认不回滚 | `m3d-mvp-spec.md` §0 |
| D0.8 | [x] O1–O6 / S1–S3 写入裁定节 | `m3d-mvp-spec.md` §0.1 |
| D0.9 | [x] 六项审查整改可独立定位 | 见本文 §2.6 锚点索引 |
| D0.10 | [x] 属性名统一 PascalCase；byo 无蛇形权威字段 | byo §3.1 |

### 2.2 D1 — 用户 Worker 原型（实现后续）

| # | 验收项 | 通过标准 |
|---|--------|----------|
| D1.1 | Token 仅 env | 响应体无 token；日志脱敏 |
| D1.2 | verify | 未分享页可读错误；分享后 ok；返回 `workspaceKey` |
| D1.3 | 按 `AppEntityId` 创建/更新 | 两次 upsert 同一 page id |
| D1.4 | LWW skip | 云端较新 → `cloud_newer` 且不覆盖 |
| D1.5 | 429 处理 | 模拟限流后最终成功或可诊断失败 |
| D1.6 | 删除双轨 | delete → `in_trash` + `AppDeletedAt`；tombstone 仍可按 id 解析 |
| D1.7 | 防复活 | tombstone 存在时过期 upsert **不** create 新页 |
| D1.8 | Payload 失败闭合 | >2000 字符 op 失败；云端无截断残片 |
| D1.9 | Bearer | 无 Key → 401；错误 Key → 401；禁止无认证成功 |

### 2.3 D2 — PWA NotionProvider（vehicles+records）

| # | 验收项 | 通过标准 |
|---|--------|----------|
| D2.1 | enqueue | `isCloudEnqueueEnabled` 含 notion |
| D2.2 | 离线→在线 | 断网编辑，恢复后 push 成功 |
| D2.3 | pull 合并 | 第二设备拉到第一设备数据 |
| D2.4 | 无 token / 无持久化 Gateway 密钥 | bundle + IDB 设置 + **JSON 导出**扫描 |
| D2.5 | Supabase 回归 | provider=supabase 原测试绿 |
| D2.6 | 媒体 | media 不上传 Notion；本地图仍可用；UI 无「图文云备份」表述 |
| D2.7 | 互斥 | 不能同时启用 supabase+notion |
| D2.8 | 冷启动会话 | 重启 PWA 后须重输 API Key（或 D4 JWT 未过期）；URL 仍在 |

### 2.4 D3 — 冲突、账号、切换

| # | 验收项 | 通过标准 |
|---|--------|----------|
| D3.1 | E1 | push `cloud_newer` → open conflict |
| D3.2 | E2 | 双侧脏 pull → open |
| D3.3 | keep_local / take_cloud | 对齐 M3-C；持锁 |
| D3.4 | 回声抑制 | 自推不误 open |
| D3.5 | 账号切换不误推 | 旧 owner outbox **不**推新 workspace |
| D3.6 | 首次双非空 | 无静默覆盖；有确认 UI |
| SW1 | 有未推送时断开 | Outbox **保留**；会话清；云不动 |
| SW2 | 切换 workspaceKey | 旧队列保留且不推；新库无旧写入 |
| SW3 | 显式丢弃旧队列 | 仅确认后清除 |
| SW4 | 切回旧区 flush | 旧队列可推回原库 |
| DEL1 | 删后第二设备 pull | 本地隐藏/tombstone；不残留存活行 |
| DEL2 | 旧设备离线编辑后上线 | 不 recreate 已删页（§4.7） |
| DEL3 | 恢复 | 清双轨后两端可见存活行 |

### 2.5 D4 — 硬化

| # | 验收项 | 通过标准 |
|---|--------|----------|
| D4.1 | 大 payload | 超限失败可读；无静默截断；可选拆分方案若启用须有往返测试 |
| D4.2 | 块配额 | 403 `block_limit` 用户可见指引 |
| D4.3 | 轮换 Gateway API Key | 旧 Key 401；新 Key 可用；D4 JWT 全部失效 |
| D4.4 | Notion-Version 钉死 | Worker 固定 `2026-03-11`（或评审更新版） |
| D4.5 | 文档与模板 | 用户可按 README 约 30 分钟内部署参考 Worker（O1） |
| D4.6 | 可选 JWT 会话 | `/auth/session` 签发与续期；revoke/轮换生效 |
| D4.7 | 可选 DO | 同实体串行可证；文档仍不承诺全局强一致；有成本说明 |

### 2.6 用户六项整改 · 文档锚点索引（D0 审查用）

| # | 主题 | 主锚点 | 验收用例 |
|---|------|--------|----------|
| 1 | Worker 认证会话 / 凭据存储 | `m3d-architecture.md` **§2.3–2.5**；mvp **§0.1 S1**；byo **§2.1** | D1.9 · D2.4 · D2.8 · D4.3 · D4.6 |
| 2 | 无原子 LWW 并发 / DO | `m3d-architecture.md` **§4.0 · §4.2 · §4.2.1**；mvp **§0.1 O5** | D1.4 · D3.1–D3.3 · D4.7 |
| 3 | 删除同步协议 | `m3d-architecture.md` **§4.7**；mvp **§0.1 O4**；本文 **§1.2** | D1.6 · D1.7 · DEL1–DEL3 |
| 4 | PayloadJson 无损编码 | `m3d-architecture.md` **§3.5**；mvp **§0.1 O3** | D1.8 · D4.1 |
| 5 | 产品文案（不同步图） | mvp **§0 P1 · §1**；architecture **§5**；byo **§4.1** | D2.6 |
| 6 | 断开/切换保留 Outbox | `m3d-architecture.md` **§4.8**；mvp **§0.1 S3**；byo **§5.1** | SW1–SW4 · D3.5 |

---

## 3. 退出 / 降级条件

若 D1–D2 证明以下任一成立，应暂停产品化并回退「仅可行性 stub」：

1. 无法在不集中持有 Token、且不把长期密钥写入 PWA 持久化的前提下完成可接受 UX；或  
2. Payload 保真在 Notion 属性限制下系统性失败且用户不可接受瘦字段；或  
3. LWW 竞态导致不可接受的数据丢失率（即使有冲突 UI）；或  
4. 删除/切换安全走廊无法在实现中落实（旧设备复活或误清 Outbox）。

降级产品选项：Notion **单向导出**（非双向 sync），仍经用户代理、仍禁止 token/长期密钥进前端持久化与 JSON 备份。
