# M2：用户自有数据存储 — 分期实施计划

> **分支**：`feature/m2-user-owned-data-storage`  
> **约束**：不部署 Contabo / 生产；local-first；前端永不嵌入 `service_role` / Notion 长效密钥。  
> **基线**：`main` @ 见 PR；既有 `docs/own-cloud-sync-architecture.md` 为协议参考。

## 0. 现状审计（本里程碑前）

| 层 | 现状 |
|---|---|
| IndexedDB | `car-care-db` v2：vehicles / records / stations / settings / media / meta / learning |
| 仓储 | `repositories/*` 直接读写 IDB；learning **永不上传** |
| 备份 | `car-care-export-v1` JSON 导入/导出（含 merge/replace 原子事务） |
| 云 | 无 Supabase / Notion 客户端；仅有架构设计稿 |

**结论**：Local-only 路径必须保持默认且完整可用；云为可选同步/备份。

## 1. 产品决策（本 PR）

| 决策 | 选择 |
|---|---|
| 默认存储 | 本机 IndexedDB（不变） |
| 云提供方 #1 | **用户自有 Supabase 项目**（BYO：URL + anon key + 用户 Auth） |
| 云提供方 #2 | Notion：**可行性说明 + UI stub**，本 PR **不实现**真实读写 |
| 真相源 | 本地 R/W 永远打 IndexedDB；云端为副本 |
| 首次连接 | **禁止**自动覆盖本地；须显式「首次上传 / 从云恢复 / 双向同步」 |
| 密钥 | 仅 anon/publishable；RLS 必须开启；不要求关闭 RLS |
| 媒体 | MVP：行内 base64（jsonb）；后续可迁 Storage（计划 Phase C） |
| learning | **不同步**（隐私/噪音） |

## 2. 分期

### Phase A — 计划与协议（本文档 + schema）✅ 本 PR

1. 写入本计划与 Notion 可行性笔记。  
2. 提供用户可在自家 Supabase SQL Editor 执行的 schema（RLS on）。  
3. 约定实体：`vehicles` / `records` / `stations` / `settings` / `media`；公共列 `user_id, entity, id, payload, updated_at, deleted_at, device_id`。

### Phase B — Supabase 适配 + 设置 UI ✅ 本 PR

1. IndexedDB v3：`sync_outbox`、`sync_meta`（及冲突缓冲）。  
2. `CloudProvider` 接口 + `SupabaseProvider`（verify / pushOps / pullAll）。  
3. 同步引擎：首次上传、从云恢复、双向 LWW、删除 tombstone、离线 outbox + 指数退避重试。  
4. 仓储写路径：云已连接时追加 outbox（本地写成功后再入队；失败不回滚本地业务写，标记 dirty 供重试）。  
5. 设置页「数据存储」：选择 Local / Supabase / Notion(stub)；连接校验；状态/上次成功/错误；断开与切换。  
6. 保留 JSON 导入/导出区块不变。  
7. 自动化测试：merge/dedup/冲突/删除/队列重试/首次不覆盖；fake provider。

### Phase C — 媒体对象存储与多设备 harden（后续）

1. Supabase Storage + 签名 URL；行表只留 `storage_key`。  
2. Background Sync / 多标签锁。  
3. 手动冲突合并 UI。

### Phase D — Notion（仅当可行性通过）⏳

见 `docs/notion-sync-feasibility.md`。在安全认证或受控代理落地前 **不**接真实 API。

## 3. 同步语义（本 PR 实现）

### 3.1 状态

```
sync_meta: deviceId, lastPullAt, lastPushAt, lastSuccessAt, lastError,
           status (idle|syncing|offline|error), cloudUserId, serverCursor
sync_outbox: opId, entity, entityId, op(upsert|delete), payload, mutatedAt,
             attempts, nextRetryAt, lastError
sync_conflicts: 可选列表供设置页展示（LWW 自动解决时记审计）
```

### 3.2 操作

| 操作 | 行为 |
|---|---|
| 校验连接 | Auth session + `select` 探测表（不写数据） |
| 首次上传 | 本地快照 → upsert 全部云行；**不**拉取覆盖本地 |
| 从云恢复 | 拉取云快照 → **显式确认后** 合并进本地（可选 replace-from-cloud） |
| 双向同步 | push outbox → pull → LWW(updated_at)；pending outbox 同 id 不静默覆盖 |
| 删除 | 本地硬删业务行 + outbox tombstone；云端 `deleted_at` |
| 断开 | 清 session/配置；保留本地业务数据；清空 outbox |

### 3.3 冲突

- 默认 **LWW by `updated_at`**（ISO 字符串比较）。  
- 一端删一端改：**改胜于删**（清 tombstone）。  
- 失败：单批 push 失败不丢 outbox；指数退避；达上限 → `status=error` + 文案，JSON 导出兜底。

### 3.4 安全

- 前端只存 URL + anon key + supabase-js session。  
- Schema 强制 `auth.uid() = user_id`。  
- 文档明确禁止粘贴 service_role。

## 4. 文件地图（本 PR）

```
docs/m2-user-owned-data-storage-plan.md   ← 本计划
docs/notion-sync-feasibility.md
docs/sql/supabase-car-care-rows.sql
src/db/index.ts                           ← DB_VERSION 3
src/sync/types.ts
src/sync/outbox.ts
src/sync/merge.ts
src/sync/config.ts
src/sync/engine.ts
src/sync/mediaCodec.ts
src/sync/providers/types.ts
src/sync/providers/supabase.ts
src/sync/providers/notion.ts              ← stub
src/sync/providers/memory.ts              ← tests
src/sync/*.test.ts
src/components/DataStorageSettings.tsx
src/pages/SettingsPage.tsx                ← 挂载「数据存储」
src/repositories/*                        ← enqueue hooks
src/i18n/messages.ts
```

## 5. 验收清单

- [ ] 未配置云时行为与 main 一致（local-only）  
- [ ] 连接成功后不自动改本地数据  
- [ ] 首次上传 / 恢复 / 双向 / 断开可用  
- [ ] outbox 离线排队与重试  
- [ ] `npm test` / `tsc -b` / `npm run build` 通过  
- [ ] 无 service_role；Notion 无真实调用  
- [ ] 未部署生产  

## 6. 非目标（本 PR）

- Contabo / gh-pages 部署  
- 官方托管多租户后端  
- Notion 真实同步  
- OCR 云引擎  
