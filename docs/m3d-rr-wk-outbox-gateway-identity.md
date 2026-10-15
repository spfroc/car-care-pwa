# M3-D RR-WK · Outbox Gateway+Workspace 复合身份（检查表选项 ②）

> **状态**：Phase 0 设计（本 PR）· **未实现代码** · **不 merge 部署**  
> **日期**：2026-10-15（Asia/Shanghai）  
> **Conditional Go 修订**：L1 二次确认硬性 · `notionTargetId` 冗余键 / 结构化比较权威 · session-derived `activeTarget` + verify 原子写 meta · §9 E4 同 wk 异 keyFp 必测  
> **风险 ID**：RR-WK（高 / 已知）  
> **对应检查表**：[`m3d-prod-pwa-release-checklist.md`](./m3d-prod-pwa-release-checklist.md) §1A 选项 ②  
> **范围**：**仅 Notion 走廊**；Supabase `ownerUserId` / RLS / sync 路径**不变**  
> **硬禁**：不改正式 Gateway · 不部署 `car.adobesun.com` · 不改正式 Supabase · 不在可运行生产脚本中清 Outbox/IDB

---

## 0. 一句话结论

在 Outbox 行与 `sync_meta` 上，于每次成功 `/verify` 后盖印 **复合身份**  
`{ workspaceKey, gatewayKeyFp }`（Notion 下 `ownerUserId ≡ workspaceKey`）。  
展示/分组用冗余键 `notionTargetId = workspaceKey + "::" + gatewayKeyFp`  
（`gatewayKeyFp` = Bearer 的 sha256 前 **12** 位 hex，与运维指纹 `keyFp` 同算法；分隔符恰好 `::`、无空格）。  
**比较权威**为结构化字段，**非**拼接串。  
Flush **仅当**当前已验证会话派生的 target 与行上盖印**完全一致**；否则拒发并 park 为孤儿队列。  
**禁止**仅用用户手填 Gateway URL 作为身份。

---

## 1. 问题与威胁模型

### 1.1 已核实事实

| 项 | 值 |
|----|-----|
| 正式 Gateway wkFp | `c647ac0368ff` |
| 历史 d1-test A wkFp | `c647ac0368ff`（**相同**） |
| 原因 | 同一 Notion workspace → 同一 `workspaceKey` |
| 正式 keyFp | `aa819deb16dc`（**≠** d1-test） |
| d1-test A keyFp | `91dee0d48d59` |
| d1-test-b wkFp | `db38e1e5a251`（跨工作区隔离已由 FG3 证明） |

### 1.2 当前隔离（不足）

| 层 | 现状 | 缺口 |
|----|------|------|
| Outbox | `ownerUserId ≈ workspaceKey`（`src/sync/outbox.ts` · `stampOutboxOwner`） | 同 workspaceKey 的正式 / d1-test **共享同一 owner 队列** |
| Session | `NotionRuntimeSession = { bearer, workspaceKey }`（`notionSession.ts`） | 无 `keyFp`；URL 变更后仍可能对「同 owner」flush |
| 配置 | `CloudStorageConfig.notionGatewayUrl` 可手填 | URL **可伪造 / 可抄错**；**不得**作为唯一身份 |
| 切换走廊 | `switchCorridor.ts` park 按 `ownerUserId` | 同 wk 换 Gateway **不会**触发 park（`cloudUserId` 不变） |
| `/verify` 客户端 | `notionGatewayClient.verify` 只取 `workspaceKey` | 未持久化 / 未比对 `keyFp` |

### 1.3 威胁场景（RR-WK）

1. **同会话混连**：用户在生产 PWA（或 car-test）先连正式 Gateway，再把 URL/Key 改成 d1-test（或反之），未清会话。  
2. **跨环境直 flush**：本地 Outbox 仍标 `ownerUserId = workspaceKey`，与新会话「匹配」，引擎对**错误 Gateway** 执行 `/sync/push`。  
3. **后果**：测试夹具写入生产 Notion workspace，或生产待同步写入测试 DS/KV（DS/KV 虽独立，但**业务语义污染**与错误信任域）。  
4. **非目标**：跨不同 `workspaceKey` 的串写（已由 owner 隔离 + FG3 覆盖）；Supabase 账号隔离；Bearer 泄漏后的服务端防护（属密钥轮换 / Gateway 鉴权）。

### 1.4 威胁模型边界

| 视为攻击者能力 | 不在本设计范围 |
|----------------|----------------|
| 用户误配 URL/Key；同浏览器配置文件混用正式与测试 | 恶意改造本机 JS / 直接改 IDB（需代码完整性另议） |
| 操作规范失效（检查表 §1 M1–M6） | 服务端 DS 被第三方 Integration 误授权 |
| 离线排队后上线连错 Gateway | 清除用户 IDB 的运维脚本（**硬禁**；本设计不提供） |

**安全目标**：在协议 / 存储层使「同 `workspaceKey`、不同 Gateway Key」成为**不同 Outbox 目标**；误配时 **fail-closed**（拒发），永不静默推到错误 Gateway。

---

## 2. 选定复合身份（可验证）

### 2.1 定义

```text
gatewayKeyFp  := sha256_hex(utf8(bearer))[0:12]     // 固定 12 hex 字符；与运维 keyFp 同算法；非密钥
workspaceKey  := /verify 成功响应中的 workspaceKey   // 已有；亦即 tenant / owner 主键
wkFp          := sha256_hex(utf8(workspaceKey))[0:12] // 可选展示 / 日志；与文档 wkFp 对齐时可相等或派生

// Notion 走廊：ownerUserId ≡ workspaceKey
notionTargetId := workspaceKey + "::" + gatewayKeyFp   // 分隔符恰好 "::"；两侧无空格
```

**比较权威（MUST）**：结构化字段 `{ workspaceKey | ownerUserId, gatewayKeyFp }`。  
门禁 / flush / orphan 判定**必须**比对这两字段（或等价结构化对象），**不得**仅靠解析拼接串。  

**冗余键** `notionTargetId`：规范形式恰好 `workspaceKey::gatewayKeyFp`（`gatewayKeyFp` = **12** hex；分隔符 `::`；无空格）。  
仅用于展示、orphan 分组、DISCARD 精确匹配标签；若与结构化字段不一致，**以结构化字段为准**并视为数据错误。

### 2.2 为何不是「仅 URL」

| 候选 | 判定 |
|------|------|
| 用户手填 `notionGatewayUrl` | **拒绝作唯一身份**：可抄错、可指向同 Key 的别名、可在 DNS/代理下漂移；且未证明 Bearer 属于该 URL |
| 仅 `workspaceKey` | **现状**；RR-WK 根因 |
| 仅 `gatewayKeyFp` | 不足：不同工作区可能轮换出新 Key；与现有 owner / map / corridor 主键不一致 |
| **`workspaceKey` + `gatewayKeyFp`（本设计）** | **采用**：同 wk 不同 Gateway 可分；同 Gateway 换 URL（Key 不变）仍连续；须经 `/verify` 成功后才盖印 |

### 2.3 盖印时机（attestation）

仅在 **`GET /verify` 返回 ok 且取得非空 `workspaceKey`** 之后：

1. 用**当前内存 Bearer**（刚用于该次 verify）计算 `gatewayKeyFp`。  
2. 写入运行时会话与 `sync_meta`（见 §2.4）。  
3. 随后 enqueue 的 Outbox 行必须带同一 `notionTargetId` / 字段。

**禁止**：

- 仅保存 URL 后、verify 前盖印。  
- 用配置里「上次的」keyFp 而不经本次 verify。  
- 把 Bearer 原文写入 IDB / `CloudStorageConfig` / 导出 JSON（现有纪律不变；只存 `gatewayKeyFp`）。

### 2.4 建议字段名（Outbox 行 + sync_meta + session）

#### `SyncOutboxItem`（`src/sync/types.ts` · 新增可选字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `ownerUserId` | string（已有） | **保持**：仍 ≈ `workspaceKey`（或 unbound）；Supabase 路径语义不变 |
| `gatewayKeyFp` | `string \| undefined` | Notion 行：盖印的 keyFp；缺省 = legacy（§4） |
| `notionTargetId` | `string \| undefined` | **冗余**展示/分组键，形式恰好 `workspaceKey::gatewayKeyFp`（12 hex · `::` · 无空格）；比较权威仍为 `ownerUserId`/`workspaceKey` + `gatewayKeyFp` |

> **兼容**：保留 `ownerUserId` 以免破坏 SW1–SW4 orphan 面板与 Supabase 共用类型。Notion flush 额外要求 `gatewayKeyFp` / `notionTargetId` 匹配。

#### `SyncMetaState`

| 字段 | 类型 | 说明 |
|------|------|------|
| `cloudUserId` | 已有 | 仍为当前 `workspaceKey`（Notion）或 Supabase user id |
| `notionGatewayKeyFp` | `string \| undefined` | 最近一次成功 verify 的 keyFp |
| `notionTargetId` | `string \| undefined` | 当前活跃复合身份 |

#### `NotionRuntimeSession`（内存 / sessionStorage）

| 字段 | 说明 |
|------|------|
| `bearer` / `workspaceKey` | 已有 |
| `gatewayKeyFp` | verify 成功后写入；tab 刷新可恢复（与 bearer 同生命周期）；**冷启动仍须重输 Key + verify**（D2.8） |

#### `CloudStorageConfig`

| 字段 | 说明 |
|------|------|
| `notionGatewayUrl` | **仅展示 / 连接配置**；不参与 flush 身份比对 |
| `workspaceKey` | 已有；可与 meta 对齐 |
| （可选）`notionGatewayKeyFp` | 非密钥提示，便于设置页展示「当前目标指纹」 |

#### `/verify` 契约演进（Phase 1 可协商）

当前 CONTRACT：`{ ok, workspaceKey, botName?, dataSources? }`。  
**客户端可本地由 Bearer 算 keyFp**，不强制立刻改正式 Gateway。  
可选增强（**仅测试 Worker / 模板**；正式 Gateway 本 Phase **不 redeploy**）：响应增加 `keyFp` / `wkFp` 供交叉校验；若返回则必须与客户端自算一致，否则视为 verify 失败。

---

## 3. Enqueue / Flush 门禁

### 3.1 Enqueue（写入 Outbox）

前置（已有 + 增强）：

1. `isCloudEnqueueEnabled('notion')` → 须 `hasValidNotionRuntimeSession()`（bearer + workspaceKey）。  
2. **新增**：session 必须已有非空 `gatewayKeyFp`（即至少一次成功 verify 后的盖印）。  
3. `stampOutboxOwner` 扩展为 `stampOutboxNotionTarget`：  
   - `ownerUserId = meta.cloudUserId ?? session.workspaceKey ?? unbound`  
   - `gatewayKeyFp = session.gatewayKeyFp`  
   - `notionTargetId = ownerUserId + "::" + gatewayKeyFp`（Notion 下 `ownerUserId ≡ workspaceKey`；owner 为 unbound 时**不**盖 notionTargetId / 不进 Notion flush；拼接串仅冗余）

无有效复合身份 → **不 enqueue**（与「仅有 URL」同等拒绝）。

### 3.2 Flush（`listReadyOutbox` / engine push）

对 `provider === 'notion'`：

```text
// 当存在已验证会话（session 有非空 workspaceKey + gatewayKeyFp）时：
//   session-derived target 为权威；禁止用过期 sync_meta 覆盖当前会话。
active := {
  workspaceKey:  session.workspaceKey,
  gatewayKeyFp:  session.gatewayKeyFp,
}
// 无已验证会话时：拒绝全部 Notion flush（不得回落到陈旧 meta 当作活跃 target）

对每个候选 op：
  if op 无 gatewayKeyFp（legacy）→ 见 §4 分类，默认不自动 flush
  // 比较权威 = 结构化字段（不得仅比 notionTargetId 拼接串）
  if op.ownerUserId !== active.workspaceKey
     OR op.gatewayKeyFp !== active.gatewayKeyFp → 排除（视为 orphan / park）
  // 然后才进入 attempts / conflict / tombstone 等现有过滤
```

**`/verify` → sync_meta 原子写入（MUST）**：

成功 `/verify`（ok + 非空 `workspaceKey`）后，**同一事务/同一写路径**必须原子写入：

1. 运行时 session：`workspaceKey` + `gatewayKeyFp`（由本次 Bearer 计算）  
2. `sync_meta`：`cloudUserId`（= workspaceKey）+ `notionGatewayKeyFp` + `notionTargetId`（冗余键）

禁止：先 flush 再写 meta；禁止「session 已是新 target、meta 仍是旧 target」时用 meta 参与 flush 比对。  
`sync_meta` 仅作冷启动/展示的镜像；**有已验证会话时不得以 meta 覆盖 session**。

**硬规则**：

| 条件 | 行为 |
|------|------|
| 活跃会话无 verify 盖印 | 拒绝全部 Notion flush（**不**用陈旧 meta 顶替） |
| 行结构化 target ≠ session-derived | **拒发**；保留行；计入「未推送（其他 Gateway）」孤儿 |
| URL 变了但 keyFp+workspaceKey 未变 | **允许** flush（身份未变） |
| keyFp 变了（换 Key / 换 Gateway）同 workspaceKey | **拒发**旧队列；park；新 enqueue 走新 target；verify 原子更新 meta |
| 永远 | **禁止**把 A 队列 push 到 B Gateway |

### 3.3 Park / 孤儿面板扩展

现有 `listOrphanOutbox` 仅比 `ownerUserId`。  
Phase 1 扩展：

- Orphan ⟺ `ownerUserId ≠ current.workspaceKey` **或**（Notion 且 `gatewayKeyFp` 存在且 ≠ current.gatewayKeyFp）。  
- `summarizeOrphanOutbox` 增加按 `notionTargetId`（或 `ownerUserId` + `gatewayKeyFp`）分组。  
- UI 文案**必须**区分：「**异工作区**」vs「**同工作区·异 Gateway**」（RR-WK 场景；后者不得混称为异工作区）。

### 3.4 与 switchCorridor 关系

| 事件 | 行为 |
|------|------|
| verify 得到**新** `workspaceKey` | 已有 park 模式（SW2） |
| verify 得到**同** `workspaceKey` 但**新** `gatewayKeyFp` | **新增**：视为 Gateway 目标切换 — 更新 meta 活跃 target；**保留**旧 `notionTargetId` 队列为 orphan；**不** `clearOutboxForUser` |
| disconnect | 已有：清 session；**保留** Outbox（SW1） |
| 显式 DISCARD | 仍须 `confirmToken === 'DISCARD'`；精确匹配 `notionTargetId` 或（legacy）`ownerUserId`；**禁止**默认路径调用 |

---

## 4. 既有 IDB / Outbox / sync_meta 迁移

### 4.1 原则

| 原则 | 说明 |
|------|------|
| **保留旧队列** | 升级后不得静默删除任何 `sync_outbox` 行 |
| **无静默丢弃** | 不能识别的行 → 分类为 legacy / orphan，等待用户切回匹配 Gateway 或显式 DISCARD |
| **DISCARD 仍仅显式** | `confirmToken === 'DISCARD'`；断开 / 切换 / 升级脚本均不得 wipe |
| **无强制 IDB version bump 清库** | 字段可选；旧行缺字段仍可读 |

### 4.2 行分类规则

| 类别 | 判定 | Flush 策略 |
|------|------|------------|
| **T0 完整 Notion 目标** | 有 `gatewayKeyFp`（或可解析的 `notionTargetId`）且有 `ownerUserId` | 仅当与活跃 target 全等时 flush |
| **L1 Legacy Notion** | `provider` 历史为 notion、有 `ownerUserId`（≠ unbound）、**无** `gatewayKeyFp` | **默认不自动 flush**；设置页提示「需一次成功 verify 后，经二次确认认领」 |
| **L1 认领（claim）** | 用户当前 verify 成功，且 `ownerUserId === session.workspaceKey`，且该 owner 下**不存在**其他已盖章 target 冲突，**且**设置页完成 **二次确认** | 一次性将 L1 行盖上**当前** `gatewayKeyFp` / 冗余 `notionTargetId`（写回 IDB）；记审计日志（无密钥）。**硬性要求**：claim **必须**经设置页 **二次确认**；**禁止**后台 / 静默 / 自动认领（含 observe 模式、升级 migration、verify 成功回调内隐式盖章） |
| **L1 冲突** | 同 `ownerUserId` 已有不同 `gatewayKeyFp` 的行，或用户拒绝认领 / 未二次确认 | 保持不 flush；面板展示为「旧队列（无 Gateway 指纹）」 |
| **U unbound** | `ownerUserId` 缺失或 `unbound` | 维持现有：不按用户 flush；不自动 DISCARD |
| **S Supabase** | `meta.provider === 'supabase'` 路径 | **不读** Notion 指纹字段；行为完全不变 |

### 4.3 sync_meta 迁移

- 缺 `notionGatewayKeyFp` / `notionTargetId`：下次 Notion verify 成功时**与 session 盖印同一写路径原子写入**（见 §3.2）。  
- 升级瞬间**不**根据 URL 猜测 keyFp。  
- `cloudUserId` 保持不动。  
- 有已验证会话时，flush **不以**陈旧 meta 覆盖 session-derived target。

### 4.4 明确不做

- 不在 migration 里调用 `clearOutbox` / `clearOutboxForUser`。  
- 不在生产域自动跑「修复探针」清 IDB。  
- 不把 L1 静默当成「当前 URL 对应 Gateway」（会重现 RR-WK）。

---

## 5. 隔离证明（同 workspaceKey · 不同 Gateway）

设：

- Gateway **P**（正式）：keyFp `aa819deb16dc` · wkFp/workspaceKey 派生 `c647ac0368ff` 族  
- Gateway **T**（d1-test）：keyFp `91dee0d48d59` · **同一** workspaceKey 族  

则：

```text
notionTargetId_P = workspaceKey + "::" + aa819deb16dc
notionTargetId_T = workspaceKey + "::" + 91dee0d48d59
notionTargetId_P ≠ notionTargetId_T
```

**证明要点（Phase 1 单测 + Phase 2 E2E）**：

1. 在 T 下 enqueue 的行不得出现在 P 会话的 `listReadyOutbox`。  
2. 在 P 会话调用 flush 不得对 T 行发 `/sync/push`（可用 mock client 断言）。  
3. 切换 T→P 后，T 行进入 orphan 汇总；P 新写入另起队列。  
4. 切回 T + 同一 Key verify 后，T 行恢复 ready（若未 DISCARD）。  

跨工作区（d1-test-b · wkFp `db38e1e5a251`）仍由 `ownerUserId` 不等保证；复合身份为**叠加**防护，不削弱 FG3。

---

## 6. 行为矩阵

| # | 场景 | 期望 |
|---|------|------|
| B1 | **工作区切换**（verify 新 workspaceKey） | park 旧 owner 队列；meta 绑新 wk；旧队列不 flush 到新 wk（现有 SW2 + target 检查） |
| B2 | **断开连接** | 清 bearer/session；Outbox **全留**；无 flush（SW1） |
| B3 | **切回**原 workspaceKey + **原** keyFp | 原 target 队列恢复 ready；可 flush |
| B4 | **切回**原 workspaceKey + **不同** keyFp（含**同 Gateway Key 轮换**） | 旧 keyFp 队列仍 orphan；新队列独立。**运维**：同 Gateway 轮换 Key 后，旧队列不会自动跟到新 Key；须**切回旧 Key** verify 后 flush，或对该 `notionTargetId` **DISCARD**（仍仅显式） |
| B5 | **显式 DISCARD** | 仅 `confirmToken === 'DISCARD'` + 精确 `notionTargetId`（或 legacy owner）；成功删该队列 |
| B6 | **离线重试** | 行上已盖 target；上线后仅当 **session-derived** 活跃 target 匹配才 retry；错 Gateway 不上送 |
| B7 | **账号 / 走廊切换**（Notion↔Supabase） | Supabase 不写 Notion 指纹；切回 Notion 须重新 verify 盖印；互斥展示保持 |
| B8 | **仅改 URL、Key 相同** | target 不变；允许继续 flush |
| B9 | **同会话改 Key（同 URL 或不同）未 verify** | 无新盖印 → 不 enqueue；若 session 仍持旧盖印则按旧 session-derived 比对；session 已清则拒发（**不**用陈旧 meta 顶替） |
| B10 | **L1 legacy 认领** | 见 §4.2；**必须**设置页 **二次确认**；**禁止**半显式 / 后台 / 静默 / 自动认领 |

---

## 7. Supabase：明确不变

| 项 | 态度 |
|----|------|
| `ownerUserId` / `cloudUserId` | 仍为 Supabase auth user id |
| RLS / 正式项目 `tqjowsffppgoqtdokbzp` | **不改 schema、不改数据、不改密钥** |
| `stampOutboxOwner` / `listOutboxForUser` | Supabase 路径不要求 `gatewayKeyFp` |
| `evaluateWorkspaceSwitch` block 模式 | 保持 |
| 本设计 diff（Phase 0） | **零** Supabase 代码 / SQL / 配置 |

Notion 字段在 Supabase 行上可为 `undefined`；flush 门禁以 `provider === 'notion'` 为开关。

---

## 8. 回滚策略

| 层级 | 做法 |
|------|------|
| **本 PR（仅文档）** | Revert 文档 commit / 关 PR；无运行时影响 |
| **Phase 1 代码已发 car-test** | 回滚静态站至上一 tip；IDB 中多出的 `gatewayKeyFp` / `notionTargetId` **只读可忽略**；旧客户端不识字段仍按 owner 工作（RR-WK 残留，但与升级前同等） |
| **Feature flag（建议）** | `notionTargetGuard: 'off' \| 'observe' \| 'enforce'` — car-test 先 observe（只打日志）再 enforce；**生产默认 off 直至验收** |
| **数据** | 回滚**不得**清 Outbox；enforce→off 后最多失去「拒错 Gateway」保护，不得丢队列 |
| **Gateway** | 本设计**不依赖**正式 Gateway redeploy；回滚客户端即可 |

---

## 9. 真实双 Gateway E2E 验收矩阵（Phase 2 · 仅 car-test）

> **允许**：`car-test.adobesun.com` + Worker `d1-test` / `d1-test-b`；对正式 Gateway **只读探针**（`/health` / `/verify`）。  
> **禁止**：部署 `car.adobesun.com`；redeploy 正式 Gateway；改正式 Supabase；清生产 IDB/Outbox；测试 Worker `ALLOWED_ORIGIN` 含生产域。

### 9.1 环境

| 代号 | Worker | 用途 |
|------|--------|------|
| G-T | `car-care-notion-sync-d1-test` · keyFp `91dee0d48d59` · wk `c647ac0368ff` 族 | 同 wk 主测试 |
| G-B | `car-care-notion-sync-d1-test-b` · keyFp `5d915911b54a` · wkFp `db38e1e5a251` | 跨 wk 对照 |
| G-P | 正式 `car-care-notion-sync` · keyFp `aa819deb16dc` · wkFp `c647ac0368ff` | **只读** verify/health；**不写** push |

### 9.2 用例

| ID | 步骤 | 期望 |
|----|------|------|
| E1 | car-test 连 G-T · verify · 造 1 条车辆 upsert 入 Outbox | 行含 `gatewayKeyFp=91dee0d48d59`；结构化字段与冗余 `notionTargetId`（`workspaceKey::91dee0d48d59`）一致 |
| E2 | 改 Key/URL 到 G-B · verify · 尝试 flush | G-T 行 **不** push 到 G-B；orphan 可见且标「**异工作区**」（跨 wk 对照；**不得单独**作为 RR-WK 验收依据，见 E4） |
| E3 | 同会话改回 G-T（同 Key）· verify · flush | G-T 行 push 200；Outbox 清空该 target |
| E4 | **【RR-WK 必测 · 同 workspaceKey · 异 keyFp】** 在仍持 G-T 队列时：用 **第二测试 Key**（同 wk 族）**或** mock session 注入同 `workspaceKey`、不同 `gatewayKeyFp` · verify/盖印 · 尝试 flush | G-T 行 **不** push；ready 为空；orphan 标「**同工作区·异 Gateway**」。**验收硬性**：本用例 PASS 才可声称 RR-WK 技术隔离；**不得**仅凭 E2（G-T↔G-B 跨 wk）主张 RR-WK 已验收 |
| E5 | disconnect → 查 IDB | Outbox 仍在；session 无 bearer |
| E6 | 显式 DISCARD 某 `notionTargetId` | 仅该队列删除；其他保留 |
| E7 | 离线 enqueue → 上线错 Gateway → 再切回 | 错 Gateway 期间不上传；切回后上传 |
| E8 | G-P `GET /verify` 只读 | 200 · wkFp `c647ac0368ff` · **零** push |
| E9 | L1：手工写入无 `gatewayKeyFp` 的旧行 → 升级客户端 | 不自动 flush；**无**静默认领；设置页二次确认认领或 DISCARD 可测 |
| E10 | Supabase 走廊冒烟（若 car-test 仍可） | owner 行为与改前一致 |
| E11 | verify 成功后查 sync_meta | `notionGatewayKeyFp` / `notionTargetId` 与 session **原子一致**；随后故意写入陈旧 meta **不得**覆盖 session-derived flush 门禁 |

> **RR-WK 验收边界**：E2（G-T↔G-B）只证明跨 `workspaceKey`；**E4 为同 wk 异 keyFp 专用用例**，缺 E4 不得关闭 RR-WK 技术隔离项。

证据目录建议：`artifacts/m3d-rr-wk-target-guard/`（仅指纹，无密钥）。

---

## 10. 实现阶段

| 阶段 | 内容 | 部署 |
|------|------|------|
| **Phase 0（本 PR）** | 本 ADR + 检查表 §1A 选项 ② 链接 | **不** merge 强制；**不**部署 |
| **Phase 1** | 类型字段 · session 盖印 · enqueue/flush 门禁 · orphan 汇总 · 单测（含同 wk 异 keyFp）· 可选 observe flag | **仅**代码 PR；默认不 enforce 到生产 |
| **Phase 2** | §9 双 Gateway E2E @ **car-test only** | 仍 **不** 生产 PWA；正式 Gateway **不** redeploy |
| **Phase 3（另授权）** | enforce 进生产 PWA + 检查表 WK2 勾选证据 | 须用户明示部署 `car.adobesun.com` |

Phase 0 成功标准：审查者能依据本文实现 Phase 1，且不违反硬禁。

---

## 11. 审查请关注

1. ~~复合键是否同意用 `workspaceKey::gatewayKeyFp`~~ → **已定（Conditional Go）**：比较权威 = 结构化字段；`notionTargetId` 为冗余展示/分组键（形式 `workspaceKey::` + 12 hex）。  
2. ~~L1 legacy **认领**是否需设置页二次确认~~ → **已定（硬性）**：必须设置页 **二次确认**；禁止半显式 / 静默 / 自动认领。  
3. Feature flag 三级（off/observe/enforce）是否足够。  
4. 是否接受「客户端自算 keyFp、正式 Gateway 本阶段不改 `/verify`」。  
5. ~~Orphan UI 是否必须区分「异工作区」与「同工作区异 Gateway」~~ → **已定（建议落地）**：必须区分；E4 验收依赖该文案。  
6. Flush `activeTarget`：**已定** — 有已验证会话时 session-derived 权威；`/verify` 原子写 sync_meta；禁止陈旧 meta 覆盖。

---

## 12. 参考

- [`m3d-prod-pwa-release-checklist.md`](./m3d-prod-pwa-release-checklist.md) §1 / §1A  
- [`m3d-prod-gateway-deploy-report.md`](./m3d-prod-gateway-deploy-report.md) §1.1 RR-WK 披露  
- [`m3d-prod-pre-gates-report.md`](./m3d-prod-pre-gates-report.md) SW1–SW4  
- 代码：`src/sync/outbox.ts` · `notionSession.ts` · `switchCorridor.ts` · `providers/notionGatewayClient.ts` · `types.ts`

---

**本文件为设计交付；不含可执行清库脚本；不含生产部署步骤。**
