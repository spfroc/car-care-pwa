# M3-D 生产 PWA 最终 Go / No-Go 准备报告

> **⚠ ARCHIVE ONLY · DO NOT DEPLOY**  
> 本 PR **仅**归档生产发布前的 Go/No-Go 准备结论与证据索引。  
> **禁止**据此部署 `https://car.adobesun.com` 或重部署正式 Notion Gateway。  
> 生产 PWA 仍须用户**单独、明示**授权且指令原文**命名** `car.adobesun.com` 后方可执行。  
> **日期**：2026-10-15（Asia/Shanghai）  
> **基线 tip**：`main@98a8390f01268ddb0162c0b0cce8320a768634d7`（PR #25 squash merge）

---

## 0. 一句话结论

| 项 | 结论 |
|----|------|
| **生产 `car.adobesun.com`** | **仍 No-Go**（本报告不授权、不部署） |
| **car-test RR-WK Phase 2** | **验收 PASS**（E1–E11，含硬门 E4）；证据见 PR #25 |
| **正式 Gateway** | 保持 `m3d-prod-1.0.0`；**不**重部署 |
| **推荐生产 `notionTargetGuard`** | 构建/运行时默认保持 **`off`**；发布后仅经设置页可选手动切 **`observe`**，CLAIM/门禁通过后再**人工**切 **`enforce`**；**禁止**生产构建默认 enforce |
| **Legacy Outbox** | 仅设置页二次确认 + `confirmToken==='CLAIM'`；**禁止**后台/静默/自动认领 |

---

## 1. 基线指纹（核实自 main / 既有归档）

| 项 | 值 | 证据 |
|----|-----|------|
| **Phase 1 代码基线** | `f3bb58aceec53fea1c14f6959c3954259f6ff88d` | PR #24 · `feat(sync): RR-WK Phase 1 Outbox Gateway+Workspace composite identity` |
| **Phase 2 归档 merge** | `98a8390f01268ddb0162c0b0cce8320a768634d7` | PR #25 squash 合入 main（原 tip `3145bb8173ba5eabcb5e499d3bdb476ee4954af0`） |
| **car-test 部署 SHA** | `f3bb58a`（完整同上 Phase 1） | [`m3d-rrwk-phase2-car-test-accept-report.md`](./m3d-rrwk-phase2-car-test-accept-report.md) §指纹 |
| **car-test bundle** | `assets/index-Ddi6Z1jp.js` | 同上；sha256 `5e94997a82fb7353d44849283e02e2fd89aff638d13e2c1f0674f870cc3f7563` |
| **car-test 备份 id** | `car-care-staging-pre-m3d-rrwk-phase2-20261015-154120` | 同上 |
| **Staging URL** | https://car-test.adobesun.com | 同上 |
| **生产静态（未改）** | `index-TdTLY2U-.js` / `index-DUfOadJ-.css` | [`m3d-prod-pwa-release-checklist.md`](./m3d-prod-pwa-release-checklist.md) 文首；Phase 2 报告确认未触碰 |
| **正式 Gateway** | `car-care-notion-sync` / **`m3d-prod-1.0.0`** · URL `https://car-care-notion-sync.spf-roc.workers.dev` · keyFp `aa819deb16dc` · wkFp `c647ac0368ff` | [`m3d-prod-gateway-deploy-report.md`](./m3d-prod-gateway-deploy-report.md) · PR #21 |
| **正式 Gateway CORS** | `ALLOWED_ORIGIN` 含 `https://car.adobesun.com,https://car-test.adobesun.com`；CORS 探针 PASS | 同上 §C |

---

## 2. 生产构建 `notionTargetGuard` 启用策略（重点）

### 2.1 模式定义

| 模式 | 行为（与 Phase 1 实现一致） |
|------|---------------------------|
| **`off`** | 门禁不激活（`isNotionTargetGuardActive() === false`） |
| **`observe`** | 激活：打日志 / 分类 / skip 行为可观测；**不**把生产默认当成「已强制拒发」运维态 |
| **`enforce`** | 激活：拒发无 attested session、legacy、target mismatch 等（与 car-test Phase 2 终跑一致） |

源码类型与**进程内默认**（核实）：

```12:24:src/sync/notionTarget.ts
export type NotionTargetGuardMode = 'off' | 'observe' | 'enforce';
// ...
/** Default off — safe for accidental production static deploy; car-test flips to observe/enforce. */
let guardMode: NotionTargetGuardMode = 'off';
```

配置字段为可选枚举，未写入 IDB 时保持 `undefined` → 不覆盖上述默认 `off`（`src/sync/config.ts` `notionTargetGuard` 白名单解析）。

### 2.2 ADR / Phase 1 依据（禁止编造）

| 依据 | 原文要点 |
|------|----------|
| ADR [`m3d-rr-wk-outbox-gateway-identity.md`](./m3d-rr-wk-outbox-gateway-identity.md) §8 | Feature flag：`off \| observe \| enforce` — car-test 先 observe 再 enforce；**生产默认 off 直至验收** |
| Phase 2 报告 §C / 遗留风险 | 测试会话可切 observe→enforce；**生产构建仍默认 off（构建未 enforce）** |
| 源码注释 | `notionTarget.ts`：「production must not auto-enforce until Phase 3 authorization」；默认 `off`「safe for accidental production static deploy」 |

### 2.3 推荐生产路径（发布**后**观察；本 PR 不部署）

1. **构建与首次静态发布**：**保持默认 `off`**（不写死 enforce；不改代码默认值）。  
2. **冒烟通过后**：在生产设置页（或运维可控配置）将 `notionTargetGuard` 切到 **`observe`**，观察日志/孤儿面板/未认领 legacy，**不**自动 CLAIM。  
3. **清点 Legacy Outbox + 完成必要 CLAIM（见 §3）且门禁行为符合预期后**：由人**人工**切到 **`enforce`**。  
4. **硬禁**：生产默认**不得**自动 enforce；本归档 PR **不**修改任何运行时默认（仅文档）。

### 2.4 与 car-test 的差异（勿混淆）

| 环境 | 推荐 / 实况 |
|------|-------------|
| car-test（已验收） | 测试会话 IDB：`observe` → `enforce`；E4 前强制 enforce（Phase 2 §C / 事故处置） |
| 生产（未授权） | 构建默认 **`off`** → 发布后观察 **`observe`** → 人工 **`enforce`** |

---

## 3. 既有 Legacy Outbox 处理

### 3.1 硬性规则（ADR + 代码）

| 规则 | 依据 |
|------|------|
| L1（无 `gatewayKeyFp`）**默认不自动 flush** | ADR §4.2；Phase 2 E9 **PASS** |
| 认领**必须**设置页 **二次确认** + `confirmToken === 'CLAIM'` | ADR §4.2 / B10；`claimLegacyNotionOutbox`；UI `DataStorageSettings` + i18n `storage.legacyClaimConfirm2` |
| **禁止**后台 / 静默 / 自动认领（含 observe、migration、verify 成功回调） | ADR 硬性；`engine.ts` verify 路径注释「Never claim legacy…」；Phase 2 Legacy CLAIM **PASS** |
| 显式丢弃仅 `confirmToken === 'DISCARD'` | ADR B5；`discardOutboxForNotionTarget` |

### 3.2 生产上线前清点 / 认领风险

1. **清点**：在目标设备用设置页查看「旧队列（无 Gateway 指纹）」数量与 owner；**禁止**为清点而 `clearOutboxForUser` / 清 IDB。  
2. **认领前**：确认当前会话已成功 `/verify` 正式 Gateway（keyFp `aa819deb16dc`），且同 owner 下**无**其他已盖章异 `gatewayKeyFp` 冲突行（否则 claim API 拒绝）。  
3. **认领**：仅设置页二次确认 → `CLAIM`；认领后队列盖上当前 `gatewayKeyFp` / 冗余 `notionTargetId`。  
4. **风险**：误认领到错误 Gateway 会把旧变更推到错误 Notion；故生产须先 **`observe` 观察**、确认 URL/Key 为正式后再 CLAIM，最后才 **`enforce`**。  
5. **回滚**：enforce→off **不得**清 Outbox（ADR §8）。

---

## 4. Go 门禁 vs No-Go 阻塞项

### 4.1 已具备（可计入 Go 准备，**≠** 已授权部署）

| # | 项 | 状态 | 证据路径 |
|---|-----|------|----------|
| G-A | 正式 Gateway `m3d-prod-1.0.0` · A–E + FG1–FG3 PASS | 已归档 | PR #21 · `docs/m3d-prod-gateway-deploy-report.md` · `artifacts/m3d-prod-gateway-deploy/` |
| G-B | 正式 CORS：`Origin: https://car.adobesun.com` 有 ACAO；错/无 Bearer → 401 | PASS（Gateway 部署时） | 同上 §C · `cors-auth-probes*.txt` |
| G-C | 生产发布检查表 / 安全检查表已入库 | 已归档 | PR #22 · `docs/m3d-prod-pwa-release-checklist.md` · `docs/m3d-prod-gateway-security-checklist.md` |
| G-D | RR-WK 设计（选项 ②） | Phase 0 文档 | PR #23 · `docs/m3d-rr-wk-outbox-gateway-identity.md` |
| G-E | RR-WK Phase 1 代码 | 已合入 main | PR #24 · tip `f3bb58a` |
| G-F | RR-WK Phase 2 car-test E1–E11（**含 E4 同 wk 异 keyFp**） | **PASS** | PR #25 · `docs/m3d-rrwk-phase2-car-test-accept-report.md` · `artifacts/m3d-rrwk-phase2-accept/` |
| G-G | Legacy CLAIM 二次确认路径 | **PASS**（car-test） | Phase 2 报告 §E |
| G-H | Supabase 回归 smoke；正式 schema/密钥未改 | **PASS** / 未改 | Phase 2 报告 §G |
| G-I | 回滚预案（staging 备份 id；生产检查表 §5） | 已文档化 | Phase 2 备份 id；checklist §5；ADR §8 |
| G-J | IDB / Outbox 默认保留（park；无清 IDB 步骤） | 已文档化 | checklist §6；本报告硬禁 |

### 4.2 当前 No-Go / 阻塞（生产仍停）

| # | 阻塞项 | 说明 |
|---|--------|------|
| N1 | **用户未明示授权部署 `car.adobesun.com`** | 检查表 P6 / Z1；勾选检查表 ≠ 授权 |
| N2 | **本 PR 为零部署** | 不更新 `/var/www/car-care`；生产 bundle 仍 `index-TdTLY2U-.js` |
| N3 | **生产 `notionTargetGuard` 尚未走 observe→人工 enforce** | 构建默认 off；须发布后人工路径（§2.3） |
| N4 | **生产设备 Legacy Outbox 未按设备清点/CLAIM** | 禁止自动认领；上线前须人工（§3） |
| N5 | **检查表 §2A**：d1-test / d1-test-b 的 `ALLOWED_ORIGIN` **不得**含生产 Origin | 发布前须探针 PASS；含则 No-Go |
| N6 | **RR-WK 生产会话纪律** | 正式与 d1-test **共用** wkFp `c647ac0368ff`；技术隔离已由 E4 证明，**仍禁止**生产会话混填测试 Key/URL |
| N7 | **Phase 2 正式 Gateway 测试夹具事故（不得淡化）** | 见 §4.3 |

### 4.3 Phase 2 正式 Gateway 测试夹具事故（诚实披露）

来源：[`m3d-rrwk-phase2-car-test-accept-report.md`](./m3d-rrwk-phase2-car-test-accept-report.md)「事故与处置」：

1. 首次 E4 试跑在 `notionTargetGuard` **未写入 IDB** 时误点「双向同步」，导致 **1** 条夹具车辆 `RRWK2-…-E4RR` 写入**正式** Gateway 对应 Notion。  
2. 经用户批准的一次性 delete push **已清理**；只读复核 **剩余 live RRWK2 = 0**。  
3. 脚本此后改为：E4 前强制 `enforce` 且 IDB 确认后才允许对 G-P 尝试 sync；终跑 `invariant.zero_prod_gateway_push` **PASS**。  
4. **未**重部署正式 Gateway；**未**改 Secrets。  

**生产含义**：默认 `off` 时仍存在「误操作直写」窗口 → 故推荐发布后尽快进入 **`observe` 观察**，CLAIM/门禁通过后**人工 `enforce`**；且生产域禁止跑测试夹具。

### 4.4 E4 隔离证据（硬门 · 已 PASS）

| 对照 | keyFp | wkFp |
|------|-------|------|
| G-T（d1-test） | `91dee0d48d59` | `c647ac0368ff` |
| G-P（正式） | `aa819deb16dc` | `c647ac0368ff`（**同 wk**） |

期望与结果：同 wk · 异 key → hold **不** push；prod `/sync/push` = 0（Phase 2 §D E4）。**不得**仅用跨 wk E2 冒充 RR-WK 已验收。

---

## 5. 明确非目标（本 PR / 本报告）

| 非目标 | 状态 |
|--------|------|
| 部署 https://car.adobesun.com | **不做** |
| 重部署 / 修改正式 Notion Gateway（代码或 Secrets） | **不做**；保持 `m3d-prod-1.0.0` |
| 修改正式 Supabase（schema / 数据 / 密钥） | **不做** |
| 清除用户 IndexedDB / Outbox | **不做** |
| 将生产构建默认改为 `enforce` | **不做**（默认保持 `off`） |
| 改写或删除既有验收文档（PR #21–#25） | **不做**；本文件仅新增引用 |

---

## 6. 已归档证据索引（PR #21–#25）

| PR | 标题（摘要） | 主文档 / 产物 |
|----|--------------|---------------|
| [#21](https://github.com/spfroc/car-care-pwa/pull/21) | 正式 Notion Gateway 部署报告（A–E + FG PASS） | `docs/m3d-prod-gateway-deploy-report.md` · `artifacts/m3d-prod-gateway-deploy/` |
| [#22](https://github.com/spfroc/car-care-pwa/pull/22) | 生产 PWA 发布检查表 | `docs/m3d-prod-pwa-release-checklist.md` |
| [#23](https://github.com/spfroc/car-care-pwa/pull/23) | RR-WK Outbox Gateway+Workspace 身份设计 | `docs/m3d-rr-wk-outbox-gateway-identity.md` |
| [#24](https://github.com/spfroc/car-care-pwa/pull/24) | Phase 1 代码：复合身份 + guard + CLAIM | tip `f3bb58a` · `src/sync/notionTarget.ts` 等 |
| [#25](https://github.com/spfroc/car-care-pwa/pull/25) | Phase 2 car-test 验收 E1–E11 | `docs/m3d-rrwk-phase2-car-test-accept-report.md` · merge `98a8390f` |

配套：`docs/m3d-prod-release-plan.md` · `docs/m3d-prod-gateway-security-checklist.md` · `docs/m3d-prod-pre-gates-report.md`。

---

## 7. 签署前检查（对照 checklist；本报告不代签）

发布执行者须另开**明示含 `car.adobesun.com` 的授权**，并完成 [`m3d-prod-pwa-release-checklist.md`](./m3d-prod-pwa-release-checklist.md)：

- [ ] Z1–Z8 硬禁未违规  
- [ ] P0–P10（含 §2A 测试 Worker Origin 门禁、§2B tip/bundle）  
- [ ] §1 / §1A：生产会话不混测；RR-WK 技术隔离证据（E4）已读  
- [ ] 生产 guard：`off` → `observe` → 人工 `enforce`（§2.3）  
- [ ] Legacy：设备清点 + 二次确认 CLAIM（§3）  
- [ ] 回滚：仅静态站备份恢复；**不**清 IDB；**不**回滚到 d1-test 当生产  

**当前签署结论（文档执行器）**：**No-Go 部署** · **Go 归档本准备报告**。

---

## 8. 本 PR 声明

- **ARCHIVE ONLY / DO NOT DEPLOY**  
- **零部署**：未改 car-test / 生产静态站；未触正式 Gateway / Supabase / 用户 IDB  
- 生产仍需**单独明确授权**且指令命名 **`car.adobesun.com`**
