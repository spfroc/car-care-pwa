# M3-D MVP 规格：Notion BYO 同步（仅设计）

> **状态**：设计中（2026-10-13）· **本里程碑不写业务 `src`、不部署、不碰正式 Supabase/生产**  
> 生产基线：M3-C merge `9b64a2bd204acfb5791f3f6668110e4c00ab3c95`  
> 配套：[`m3d-architecture.md`](./m3d-architecture.md) · [`m3d-notion-byo-architecture.md`](./m3d-notion-byo-architecture.md) · [`m3d-risks-and-acceptance.md`](./m3d-risks-and-acceptance.md)  
> 既往结论：[`notion-sync-feasibility.md`](./notion-sync-feasibility.md)（无安全代理前禁止；个人 token 进前端否决）

## 0. 已采用默认（2026-10-13）

> **用户未显式回复产品待决 widget，采用产品/架构默认**（待独立审查确认）。实现阶段不得擅自改口；若评审推翻，须回写本节。

| # | 议题 | 已采用默认 |
|---|------|------------|
| P1 | MVP 媒体 | **不同步图片**（二进制不入 Notion；本地 IDB / JSON 导出仍可用） |
| P2 | 冲突 | **接受**可见冲突 + 有限二选一 / 降级文案（复用 M3-C keep_local / take_cloud）；**不**要求对等 M3-C@Supabase 能力才开放 Notion 冲突入口 |
| P3 | 产品入口 | 先以 **实验 / 高级开关** 暴露；至 **D2 真机通过** 后再考虑与 Supabase 正式并列 |
| P4 | 安全通道 | 对齐架构推荐：**BYO Cloudflare Worker Gateway**（Notion Token 仅存用户 Worker Secret；PWA 只持 Gateway URL + 用户自设会话/密钥） |

仍开放给架构评审（不阻塞本默认采纳）：Gateway 会话形态（短命 JWT vs 长期 Gateway API Key）、属性命名终选（`AppEntityId` vs `app_id` 等）、Payload 超长策略、trash vs `AppDeletedAt` 双轨、信息架构（设置页文案与向导步骤细节）。

## 1. 产品目标

用户可将**自有 Notion workspace** 作为可选云副本，对 **车辆（vehicles）+ 养护记录（records）** 做双向同步；IndexedDB 仍为唯一实时读写源（local-first）。用户拥有云端数据；应用方**不**建集中多租户托管用户车数据，也**不**在前端/Git 持有 Notion Token。

## 2. MVP 范围（做）

| 项 | 说明 |
|----|------|
| 实体 | 仅 `vehicles` + `records` |
| 方向 | 双向：本地 → Notion（outbox push）；Notion → 本地（pull / 首次同步） |
| 认证 | 经**用户自有代理**持有 Notion 凭证；PWA 永不存 Integration / OAuth / PAT 明文 |
| 冲突 | 复用 M3-C 手动冲突管道（仅上述两实体）；其余实体本阶段不同步 |
| 删除 | Notion 侧用 `in_trash`（API `2026-03-11`）；本地 tombstone / outbox `delete` 映射见架构文档 |
| 幂等 | 每行稳定 `AppEntityId`（= 本地 UUID）属性；同 id 更新而非重复建页 |
| 设置 UI | 在现有「数据存储」中把 Notion 从 stub 升级为「需配置代理 URL + 自有会话」入口（实现阶段）；本设计 PR 不改 UI |

## 3. 非目标（明确不做）

- 实现 `NotionProvider` 真网络逻辑、引入生产路径 `@notionhq/client`
- stations / settings / media / learning 的 Notion 同步
- 把 Notion 当主库或替代 IndexedDB
- 应用方多租户代管全体用户的 Notion Token
- 个人 Internal / PAT Token **明文进 PWA / localStorage / Git**
- 依赖 Notion 原生事务、RLS、与 Supabase 同等的原子 LWW RPC
- 改正式 Supabase schema / 生产部署 / 用户现网数据
- 字段级三路合并；MVP 仍整行 keep local / take cloud（对齐 M3-C）
- MVP 内把图片二进制作为 Notion 主存储（见架构「图片」取舍）

## 4. 用户故事

1. **作为**已用本地记账的车主，**我希望**把车辆与养护记录同步到自己的 Notion，**以便**在 Notion 里检索/备份，且手机离线仍可记账。  
2. **作为**安全敏感用户，**我希望** Notion Token 只存在我自己部署的 Worker/机器上，**以便** PWA 被破解也不会泄露长效密钥。  
3. **作为**已接 Supabase 的用户，**我希望** Notion 与 Supabase **互斥或明确混合策略**，**以免**双写撕裂。  
4. **作为**双设备用户，**我希望**两端都改同一条记录时进入与 M3-C 一致的冲突 UI，**而不是**静默丢一侧意图。  
5. **作为**首次开通者，**我希望**一键/向导创建「车辆」「养护」两个 Data Source，并把本地现有行上传上去，**且**重复开通不产生重复页。

## 5. 验收标准（设计完成 ≠ 功能上线；下列为**实现阶段**门禁草案）

### 5.1 安全

- [ ] 前端 bundle / IDB / 设置导出中 **零** Notion `secret_` / OAuth access_token / refresh_token / PAT  
- [ ] 代理侧 Token 仅环境变量或用户自有密钥存储；文档含轮换与撤销步骤  
- [ ] Git 扫描无示例真实 token

### 5.2 功能（实现后）

- [ ] 仅 vehicles+records 进出 Notion；其它实体不写 Notion  
- [ ] 离线编辑 → 恢复网络后 outbox 重试成功  
- [ ] 同 `AppEntityId` 二次 push 更新原页，不新建重复行  
- [ ] Push 遇云端更新戳更新 → `cloud_newer` → M3-C open conflict（不静默丢本地意图）  
- [ ] Pull 双侧脏 → open conflict；自推回声不误报  
- [ ] 删除：本地删 → Notion `in_trash: true`；Notion 回收站恢复策略按架构文档  
- [ ] 429/529 尊重 `Retry-After`；写入 503 按 Notion 指引先读后判是否重试  
- [ ] 切换/断开 Notion 账号不误推其它 owner 的 outbox（对齐现有 `ownerUserId`）

### 5.3 非破坏

- [ ] 选择 Notion **不**改动用户现有 Supabase 项目数据  
- [ ] `provider === 'supabase'` 路径回归（outbox / LWW RPC / M3-C）仍绿

## 6. 与路线图关系

- 依赖：M2–M3-C 已落地的 `CloudProvider`、outbox、merge、M3-C 冲突 UI  
- 实现建议：M3-C 稳定后开工；可与其它适配器评估并行，但 **adapter 实现**建议在冲突管道可用之后  
- 本 PR：仅文档；状态见 `m3-roadmap.md`「设计中」

## 7. 成功定义（本设计里程碑）

三份设计文档评审通过，且代码盘点 / API 调研可追溯；**不**以「能在生产调 Notion API」为成功。
