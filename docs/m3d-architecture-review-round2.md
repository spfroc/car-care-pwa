# M3-D 正式独立架构审查（第二轮）· PR #8

| 项 | 内容 |
|----|------|
| PR | https://github.com/spfroc/car-care-pwa/pull/8 |
| Head | `fea4686082b8f170e873b2aafe0665ca2fa12b55` · `docs/m3d-notion-design` |
| 基线 | 文档相对 `main`@`74fb33d`；生产叙事仍指向 M3-C（本 PR **无 src**） |
| 审查范围 | 仅文档：`m3d-mvp-spec` · `m3d-architecture` · `m3d-notion-byo-architecture` · `m3d-risks-and-acceptance` · `notion-sync-feasibility` · roadmap 一行 |
| 审查角色 | 架构师独立审查（相对主 Bot 成稿） |
| 日期 | 2026-10-13 |

## 结论：**有条件通过**

设计方向正确：BYO Worker、Token 不进前端、复用 CloudProvider/outbox/M3-C、vehicles+records、媒体不同步、与 Supabase 互斥、PR 仅 docs。  
**硬约束全部满足。** 进入实现规格起草（仍不写业务代码）的前提是：下文 **必须改文档** 清单合入（同 PR 补丁或紧随 docs PR），消除命名/会话/LWW/开放问题的双口径。

**不授权**：业务 `src`、接真 Notion API、改生产/正式 Supabase、集中托管 Token。

---

## 硬约束复核

| 约束 | 结果 | 证据 |
|------|------|------|
| local-first IDB | ✅ | mvp §1；architecture 全篇 |
| BYO、不集中托管 Token/车数据 | ✅ | 否决 B/D；byo §2 |
| 不破坏 Supabase | ✅ | 互斥 §6；风险 R10；回归门禁 |
| Token 不进前端/Git | ✅ | 类型禁止；验收 D2.4；否决 A/F |
| 评审前不写业务代码 / 本 PR 不改生产 | ✅ | PR 仅 6 个 `docs/*` 文件 |

---

## 重点裁定（文档间分歧）

### 1. 属性命名：`AppEntityId` vs `app_id`

| 文档 | 用法 |
|------|------|
| `m3d-architecture` / mvp / risks | `AppEntityId` · `AppUpdatedAt` · `AppDeletedAt` · `PayloadJson` |
| `m3d-notion-byo-architecture`（原稿） | `app_id` · `app_updated_at` |

**裁定：采用 PascalCase Notion 属性名（architecture 口径）为权威。**  
理由：与 Notion UI 可读性一致；三份主规格已统一；原稿蛇形仅为早期草图。  
`CloudRow` / TS 字段仍用既有 `id` / `updatedAt` / `deletedAt`，由 Gateway 做映射。

**必须改**：byo 全文替换为 `AppEntityId` / `AppUpdatedAt` / `AppDeletedAt` 等，并加一句「与 architecture §3.3 同名」。

---

### 2. PWA↔Gateway：短命 JWT vs Gateway API Key

| 文档 | 倾向 |
|------|------|
| byo | 长期 **Gateway API Key** |
| architecture | **短命 JWT**（`PROXY_SHARED_SECRET` 换票）为主叙述 |
| mvp §0 | 显式留开放 |

**裁定：MVP 默认 = 用户自设 Gateway API Key（Bearer）；短命 JWT 为 D4 加固可选项（保留 `/auth/session`）。**  
理由：BYO 部署门槛；单用户 Worker + TLS + CORS Origin 锁定下，API Key 风险可接受；JWT 不阻塞 D1–D2。  
**禁止**：无认证开放代理；Notion Token 出现在 PWA。

**必须改**：mvp §0 写入上表默认；architecture §2.2 改「MVP：API Key；可选 JWT」；byo 与 architecture 交叉引用一致。

---

### 3. LWW：Worker 先读后写 vs 客户端 LWW

architecture 文首已写「客户端 LWW + Gateway best-effort」——**可接受，且必须并存**，不是二选一：

| 路径 | 权威组件 | 职责 |
|------|----------|------|
| **Pull**（云→本地） | 客户端 `merge.ts` + M3-C | 是否应用云行、open 冲突、回声抑制 |
| **Push**（本地→云） | Gateway 先读 `AppUpdatedAt` 再写 | 产出与 Supabase 同形的 `PushResult`（含 `cloud_newer`）；**无**第二套冲突模型 |

客户端不能替代 Gateway 的 push 比较（否则 TOCTOU 全在浏览器）；Gateway 不能替代客户端 pull/M3-C。  
竞态弱于 Postgres `FOR UPDATE`：**接受**，靠 M3-C + 时间戳；见下条 DO。

**必须改**：在 `m3d-architecture` §4 增加「双层 LWW」小节（上表），避免实现期误删一层。

---

### 4. 开放问题终裁（写入规格，勿再悬空）

| # | 问题 | 裁定 |
|---|------|------|
| O1 | Worker 模板是否「官方」提供 | **要**：仓库内维护参考模板（如 `docs/templates/notion-sync-worker/`），无真实 secret；**不**等于应用方托管运行时 |
| O2 | 共享 Public OAuth `client_id` | **MVP 不做**；仅 Internal Connection + 用户 Worker Secret。共享 public app 须另开安全评审 |
| O3 | `PayloadJson` > 2000 | **失败闭合**：序列化超限则该 op 失败并给用户可读错误；**禁止静默截断**。MVP 优先瘦 payload + 冗余标量列；`PayloadJson_N` / 外置 → D4 |
| O4 | `in_trash` vs `AppDeletedAt` | **双轨**：delete → `in_trash: true` **且**写 `AppDeletedAt`；pull 的 `deletedAt` 优先 `AppDeletedAt`，否则由 `in_trash` 推导。恢复须清两者 |
| O5 | Durable Object 串行是否 MVP 必做 | **否**。MVP：Worker 请求内单飞 / 同 isolate 串行即可；DO 作 D4 加固。残余 TOCTOU 写入风险 R2 |
| O6 | Notion UI 手改未 bump | **不支持为同步语义**。产品文案：请用 App 编辑；UI 手改可能在下次同步被覆盖。无 Webhook（MVP）。风险 R3 残余接受 |

---

## 必须改文档清单（条件通过之条件）

1. **统一属性名**：byo → `AppEntityId` / `AppUpdatedAt` / `AppDeletedAt` / `PayloadJson`（对齐 architecture §3.3）。  
2. **冻结会话形态**：mvp §0 + architecture §2.2 + byo §2 — MVP = Gateway API Key；JWT 可选。  
3. **双层 LWW** 小节写入 architecture §4（pull=客户端，push=Gateway）。  
4. **开放问题 O1–O6** 写入 mvp 新节「§0.1 评审裁定」或 risks 附录，并从「仍开放」列表移除已裁项。  
5. **Payload 超限**：mvp/architecture/risks 统一「失败闭合、禁静默截断」。  
6. **删除双轨**：architecture §4.2 / risks R11 用同一段话写清 `in_trash` + `AppDeletedAt`。  
7. **feasibility §3**：「refresh 存服务端」改为「仅存**用户自有** Worker」，避免读成应用方集中库。  
8. （建议）byo 文首状态改为「已并入 PR #8；属性名/会话以评审裁定与 `m3d-architecture` 为准」。

**非必须（不挡条件通过）**：Contabo 作等价 BYO 代理的表述可保留；roadmap 上 M3-C 状态句与本审查无关。

---

## 产品默认（mvp §0）审查意见

| # | 默认 | 架构意见 |
|---|------|----------|
| P1 无图 | ✅ 同意 | 与文件 URL 1h / 配额一致 |
| P2 冲突降级可开放 | ✅ 同意 | 须仍走 M3-C 管道与硬约束（take_cloud 成功应用后清 outbox 等）；「降级」≠ 静默 LWW 丢意图 |
| P3 实验开关 | ✅ 同意 | D2 真机前不与 Supabase 正式并列 |
| P4 BYO Worker | ✅ 同意 | 单一推荐不变 |

用户未点 widget 一事已在文中标注；本审查**确认**上述默认，不要求回滚。

---

## 是否授权下一步

| 下一步 | 授权？ |
|--------|--------|
| 合入必须改文档清单后合并 PR #8（或 docs 补丁） | ✅ 建议 |
| **起草实现规格**（接口/Worker 契约/配置字段/验收用例细化） | ✅ **有条件授权**（文档补丁落地后或与补丁并行起草，但规格不得与本裁定冲突） |
| 业务编码 / 真 API / 生产变更 | ❌ **否** |
| 共享 Public OAuth / 托管 Gateway / 混合 Storage | ❌ 非 MVP |

---

## 总评（一行）

**有条件通过** — BYO 方案与硬约束站住了；把命名、Gateway 会话、双层 LWW 与 O1–O6 写死进规格后，即可开实现规格起草，仍禁止业务代码。

---

## 附录 · 第三轮闭合复审（`fea4686`）

| 项 | 内容 |
|----|------|
| 复审 SHA | `fea4686082b8f170e873b2aafe0665ca2fa12b55` |
| PR | #8 仍 OPEN，未 merge |
| Diff 范围 | 仅 `docs/*`（7 文件，无 src） |
| 日期 | 2026-10-13 |

### 条件清单核对

| # | 第二轮必须改 | 结果 |
|---|--------------|------|
| 1 | 属性名统一 PascalCase | ✅ byo / architecture / mvp / risks 一致；无业务文档残留 `app_id` |
| 2 | MVP 会话 = Gateway API Key；JWT=D4 | ✅ mvp §0.1 S1；architecture §2.2–2.5 |
| 3 | 双层 LWW 小节 | ✅ architecture §4.0 |
| 4 | O1–O6 写入裁定节 | ✅ mvp §0.1 |
| 5 | Payload 失败闭合 | ✅ §3.5 / R7 / D1.8 |
| 6 | 删除双轨 in_trash+AppDeletedAt | ✅ §4.7 状态机 |
| 7 | feasibility refresh→用户自有 Worker | ✅ §3.2 |
| 8 | 审查纪要入库 | ✅ 本文在 PR |

| # | 用户第一轮六项 | 结果 |
|--|----------------|------|
| U1 | 会话协议 | ✅ §2.3–2.5；密钥不进 IDB/JSON |
| U2 | 并发 / 不承诺强一致 | ✅ §4.2.1；O5 DO 非 MVP |
| U3 | 删除协议 | ✅ §4.7 |
| U4 | Payload 无损 | ✅ §3.5 失败闭合 |
| U5 | 媒体文案 | ✅ 禁「完整图文云备份」 |
| U6 | 断开保留 Outbox | ✅ §4.8 / S3 |

P1–P4：维持确认，不回滚。

### 闭合结论：**通过**

第二轮「有条件通过」之条件已全部满足。  
**授权**：可起草 **实现规格**（Worker 契约 / 配置字段 / 验收用例细化）。  
**仍禁止**：业务 `src`、接真 Notion API、合并后生产部署、改正式 Supabase、集中托管 Token。

无新的阻塞性文档分歧。标题区 Head 已更新为 `fea4686`；roadmap / 实现规格见本轮 docs 补丁（仍 OPEN，未 merge）。
