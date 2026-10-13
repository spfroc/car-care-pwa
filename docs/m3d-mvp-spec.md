# M3-D MVP 规格：Notion BYO 同步（仅设计）

> **状态**：设计通过 · 实现规格已起草（2026-10-13）· **本里程碑不写业务 `src`、不部署、不碰正式 Supabase/生产**  
> 生产基线：M3-C merge `9b64a2bd204acfb5791f3f6668110e4c00ab3c95`  
> 配套：[`m3d-architecture.md`](./m3d-architecture.md) · [`m3d-notion-byo-architecture.md`](./m3d-notion-byo-architecture.md) · [`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md)  
> **实现规格**：[`m3d-implementation-spec.md`](./m3d-implementation-spec.md)（第三轮通过后起草；仍无业务代码）  
> 审查纪要：[`m3d-architecture-review-round2.md`](./m3d-architecture-review-round2.md)（第三轮闭合：**通过**；本文件已合入裁定）  
> 既往结论：[`notion-sync-feasibility.md`](./notion-sync-feasibility.md)（无安全代理前禁止；个人 token 进前端否决）

## 0. 已采用默认（2026-10-13）

> **用户未显式回复产品待决 widget，采用产品/架构默认**；**第二轮独立架构审查已确认 P1–P4，不回滚**。实现阶段不得擅自改口；若后续评审推翻，须回写本节。

| # | 议题 | 已采用默认 |
|---|------|------------|
| P1 | MVP 媒体 | **不同步图片**（二进制不入 Notion；本地 IDB / JSON 导出仍可用）。产品定位：**结构化账本可读备份 + 轻同步**，**不是**完整图文云备份 |
| P2 | 冲突 | **接受**可见冲突 + 有限二选一 / 降级文案（复用 M3-C keep_local / take_cloud）；**不**要求对等 M3-C@Supabase 能力才开放 Notion 冲突入口。降级 ≠ 静默丢意图 |
| P3 | 产品入口 | 先以 **实验 / 高级开关** 暴露；至 **D2 真机通过** 后再考虑与 Supabase 正式并列 |
| P4 | 安全通道 | **BYO Cloudflare Worker Gateway**（Notion Token 仅存用户 Worker Secret；PWA 持 Gateway URL + 运行时会话，见 §0.1） |

## 0.1 评审裁定（第二轮 · 冻结，勿再悬空）

| # | 议题 | 裁定 |
|---|------|------|
| O1 | Worker 模板 | **要**：仓库内维护参考模板（如 `docs/templates/notion-sync-worker/`），无真实 secret；**不**等于应用方托管运行时 |
| O2 | 共享 Public OAuth `client_id` | **MVP 不做**；仅 Internal Connection + 用户 Worker Secret。共享 public app 须另开安全评审 |
| O3 | `PayloadJson` > 2000 字符 | **失败闭合**：超限则该 op **失败**并给用户可读错误；**禁止静默截断**业务 JSON。MVP：瘦 payload + 冗余标量列；`PayloadJson_N` / 外置 → D4。完整方案见 [`m3d-architecture.md` §3.5](./m3d-architecture.md) |
| O4 | `in_trash` vs `AppDeletedAt` | **双轨**：delete → `in_trash: true` **且**写 `AppDeletedAt`；pull 的 `deletedAt` 优先 `AppDeletedAt`，否则由 `in_trash` 推导。恢复须清两者。状态机见 [`m3d-architecture.md` §4.7](./m3d-architecture.md) |
| O5 | Durable Object 串行 | **非 MVP 必做**。MVP：Worker 请求内 / 同 isolate 尽力串行即可；DO 作 D4 加固。**不得承诺**跨实例强一致。见 [`m3d-architecture.md` §4.0 / §4.2](./m3d-architecture.md) |
| O6 | Notion UI 手改未 bump | **不支持为同步语义**。文案：请用 App 编辑；UI 手改可能在下次同步被覆盖。无 Webhook（MVP） |
| S1 | PWA↔Gateway 会话 | **MVP = Gateway API Key（Bearer）**；短命 JWT（`POST /auth/session`）= **D4 可选加固**。禁止无认证开放代理。凭据存储见 [`m3d-architecture.md` §2.3–2.5](./m3d-architecture.md) |
| S2 | Notion 属性命名 | **权威**：`AppEntityId` · `AppUpdatedAt` · `AppDeletedAt` · `PayloadJson` · `DeviceId` · `Name`（PascalCase）。`CloudRow` / TS 仍用 `id`/`updatedAt`/`deletedAt`，由 Gateway 映射 |
| S3 | 断开/切换 Outbox | 原工作区**未推送 Outbox 默认必须保留**（不得默认 `clearOutboxForUser`）；禁止推到新 workspace。见 [`m3d-architecture.md` §4.8](./m3d-architecture.md) |

## 1. 产品目标

用户可将**自有 Notion workspace** 作为可选云副本，对 **车辆（vehicles）+ 养护记录（records）** 做双向同步；IndexedDB 仍为唯一实时读写源（local-first）。用户拥有云端数据；应用方**不**建集中多租户托管用户车数据，也**不**在前端/Git 持有 Notion Token。

**产品文案约束（P1）**：Notion MVP **不同步图片**。设置页 / 向导 / 营销话术须写清「结构化字段与记录文本的可读备份 + 轻同步」；**禁止**描述为「完整图文云备份」「相册上云」「含照片的全量备份」。需要云端存图时引导使用 **Supabase 路径（M3-A）** 或本地 JSON 导出。

## 2. MVP 范围（做）

| 项 | 说明 |
|----|------|
| 实体 | 仅 `vehicles` + `records` |
| 方向 | 双向：本地 → Notion（outbox push）；Notion → 本地（pull / 首次同步） |
| 认证 | 经**用户自有代理**持有 Notion 凭证；PWA **永不**持久化 Integration / OAuth / PAT / Gateway 长期密钥到 IDB 设置或 JSON 备份（见架构 §2.4） |
| 冲突 | 复用 M3-C 手动冲突管道（仅上述两实体）；其余实体本阶段不同步 |
| 删除 | 双轨：`in_trash: true` + `AppDeletedAt`（API `2026-03-11`）；状态转换见架构 §4.7 |
| 幂等 | 每行稳定 `AppEntityId`（= 本地 UUID）；同 id 更新而非重复建页；create 前须 query（含可查 tombstone） |
| Payload | 瘦 `PayloadJson` + 标量冗余；超限失败闭合；禁静默截断 |
| 设置 UI | 在现有「数据存储」中把 Notion 从 stub 升级为「需配置代理 URL + 运行时密钥」入口（实现阶段）；本设计 PR 不改 UI |

## 3. 非目标（明确不做）

- 实现 `NotionProvider` 真网络逻辑、引入生产路径 `@notionhq/client`
- stations / settings / media / learning 的 Notion 同步
- 把 Notion 当主库或替代 IndexedDB
- 应用方多租户代管全体用户的 Notion Token
- 个人 Internal / PAT Token **明文进 PWA / localStorage / Git**
- 把 `GATEWAY_API_KEY` / 任一长期共享密钥**换名**后写入浏览器持久化设置或 `car-care-export` JSON 备份
- 依赖 Notion 原生事务、RLS、与 Supabase 同等的原子 LWW RPC；**不承诺**跨 Worker 实例强一致
- 改正式 Supabase schema / 生产部署 / 用户现网数据
- 字段级三路合并；MVP 仍整行 keep local / take cloud（对齐 M3-C）
- MVP 内把图片二进制作为 Notion 主存储；**不**把 Notion 模式宣传为完整图文云备份
- 共享 Public OAuth `client_id`（O2）；Durable Object 作为 MVP 必做（O5）

## 4. 用户故事

1. **作为**已用本地记账的车主，**我希望**把车辆与养护记录的**结构化字段**同步到自己的 Notion，**以便**在 Notion 里检索/备份，且手机离线仍可记账（照片仍在本地或走 JSON 导出）。  
2. **作为**安全敏感用户，**我希望** Notion Token 只存在我自己部署的 Worker/机器上，且 PWA **不会**把长期 Gateway 密钥写进备份文件，**以便**导出分享或 XSS 面更小。  
3. **作为**已接 Supabase 的用户，**我希望** Notion 与 Supabase **互斥**，**以免**双写撕裂。  
4. **作为**双设备用户，**我希望**两端都改同一条记录时进入与 M3-C 一致的冲突 UI，**而不是**静默丢一侧意图。  
5. **作为**首次开通者，**我希望**向导创建「车辆」「养护」两个 Data Source，并把本地现有行上传上去，**且**重复开通不产生重复页。  
6. **作为**切换工作区的用户，**我希望**原工作区未推送的 Outbox **默认保留**且不会误推到新库，**以便**我可先回去推完或显式丢弃。

## 5. 验收标准（设计完成 ≠ 功能上线；下列为**实现阶段**门禁草案）

### 5.1 安全

- [ ] 前端 bundle / IDB 持久设置 / `car-care-export` JSON 中 **零** Notion `secret_` / OAuth access_token / refresh_token / PAT / `GATEWAY_API_KEY` / 会话签发密钥  
- [ ] PWA 可持久化：`notionGatewayUrl`、`provider`、`notionWorkspaceHint`、`workspaceKey`；运行时 API Key **仅**内存（或等价非导出会话），冷启动须重新输入（D4 可用短命 JWT 改善 UX）  
- [ ] 代理侧 Token 仅环境变量或用户自有密钥存储；文档含轮换与撤销步骤  
- [ ] Git 扫描无示例真实 token；Worker 模板无真实 secret

### 5.2 功能（实现后）

- [ ] 仅 vehicles+records 进出 Notion；其它实体不写 Notion；**media 实体不出箱**  
- [ ] 离线编辑 → 恢复网络后 outbox 重试成功  
- [ ] 同 `AppEntityId` 二次 push 更新原页，不新建重复行  
- [ ] Push 遇云端更新戳更新 → `cloud_newer` → M3-C open conflict（不静默丢本地意图）  
- [ ] Pull 双侧脏 → open conflict；自推回声不误报  
- [ ] 删除双轨：本地删 → `in_trash: true` + `AppDeletedAt`；旧设备带过期 upsert **不会**把已删实体复活为新页（见架构 §4.7）  
- [ ] `PayloadJson` 超限 → op 失败 + 可读错误；往返编解码校验；**无**静默截断  
- [ ] 429/529 尊重 `Retry-After`；写入 503 按 Notion 指引先读后判是否重试  
- [ ] 断开/切换：原 `ownerUserId` 未推送 Outbox **默认保留**；**禁止**推到新 workspace；仅在用户显式确认后才可丢弃旧队列（见架构 §4.8）

### 5.3 非破坏 / 文案

- [ ] 选择 Notion **不**改动用户现有 Supabase 项目数据  
- [ ] `provider === 'supabase'` 路径回归（outbox / LWW RPC / M3-C）仍绿  
- [ ] UI/文档无一处称 Notion 模式为「完整图文云备份」或等价表述

## 6. 与路线图关系

- 依赖：M2–M3-C 已落地的 `CloudProvider`、outbox、merge、M3-C 冲突 UI  
- 实现建议：M3-C 稳定后开工；可与其它适配器评估并行，但 **adapter 实现**建议在冲突管道可用之后  
- 本 PR：仅文档；状态见 `m3-roadmap.md`「设计中」

## 7. 成功定义（本设计里程碑）

设计文档（含第二轮裁定合入）可独立审查通过；代码盘点 / API 调研可追溯；**不**以「能在生产调 Notion API」为成功。
