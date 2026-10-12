# M3-A：媒体从 JSONB/base64 迁到私有 Storage 对象

> **分支**：`feature/m3a-media-storage-objects`  
> **基线**：`main` @ `42c1b61`（prod）  
> **约束**：local-first IndexedDB；BYO Supabase；前端永不嵌入 `service_role`；不部署 Contabo / `car.adobesun.com`；不写生产项目 `tqjowsffppgoqtdokbzp`。  
> **本阶段**：无 Notion。

## 0. 审计结论（实现前）

| 区域 | 现状 | 风险 |
|---|---|---|
| 本地媒体 | `IndexedDB.media` 存 `Blob`；`putMediaFromFile` 压缩 JPEG | 配额；与云无关 |
| 车辆封面 | `Vehicle.coverMediaId` → media id | 删车时级联孤儿清理 |
| 记录附件 | `CareRecord.mediaIds[]` | 同上 |
| 云同步媒体 | `mediaToCloudPayload` → **整图 base64 塞进 `car_care_rows.payload` jsonb** | 行巨大、PostgREST 慢、配额吃紧 |
| 校验 | `validatePayload` 强制 `base64` 存在且 ≤ ~2e6 chars | M3 须兼容 storageKey |
| JSON 备份 | `car-care-export-v1` 仍含 base64 | **必须保留**；与云协议解耦 |
| Storage | 无 bucket / 无 RLS | Phase C（本里程碑） |
| 密钥 | `SupabaseProvider` 拒绝 `service_role` | 保持 |

**结论**：云端二进制应进 **private Storage**；DB 行只保留引用 + 元数据。本地 IDB + JSON 备份路径不变。

## 1. 目标

1. 私有 bucket + 对象路径约定 + Storage RLS（用户可在自家项目执行 SQL）。  
2. 上传：二进制 → Storage；`car_care_rows` media payload 仅 refs/metadata。  
3. 与 M2 JSONB/base64 **兼容**：幂等、可中断恢复、渐进迁移。  
4. 失败/中断/去重/删引用/孤儿清理有明确语义。  
5. 自动化单测 + 仅 disposable Supabase 上的 live/E2E（`skwoahneuqkqgxzpkkzl`）。

## 2. 设计

### 2.1 Bucket

| 项 | 值 |
|---|---|
| id/name | `car-care-media` |
| public | **false** |
| file_size_limit | 1_500_000（对齐 `MAX_MEDIA_BYTE_SIZE`） |
| allowed_mime_types | `image/jpeg`, `image/png`, `image/webp`, `image/gif` |

### 2.2 对象路径（每用户隔离）

```
{auth.uid()}/{media_id}/{content_sha256}.{ext}
```

- 第一段必须等于 `auth.uid()`（RLS 强制）。  
- `media_id` = 本地/云端媒体 UUID。  
- `content_sha256` = 内容哈希（hex）；同内容同路径 → **去重上传**（`upsert: true`）。  
- `ext` 由 mime 推导（jpeg→jpg）。

RLS 策略：`storage.foldername(name)[1] = auth.uid()::text`（select/insert/update/delete）。

### 2.3 DB payload schema

`car_care_rows` 表结构 **不变**（仍 jsonb）。media payload：

```ts
// schemaVersion 2（Storage）
{
  id, mimeType, byteSize, width?, height?, createdAt,
  schemaVersion: 2,
  storageKey: string,      // 相对 bucket 的对象路径
  contentSha256: string,   // hex
  // 迁移过渡期可短暂同时带 base64；切换引用成功后必须去掉
  base64?: string          // 仅 schemaVersion 1 / 迁移中
}
```

- **v1（M2）**：有 `base64`，无 `storageKey`。  
- **v2（M3）**：有 `storageKey` + `contentSha256`，**无** `base64`。  
- 校验：tombstone 除外；活行必须 `(storageKey) XOR 合法 base64`（迁移中允许两者并存，下载优先 Storage）。

### 2.4 客户端流程

#### Push（upsert media）

1. 读本地 Blob → SHA-256 → 算 `storageKey`。  
2. `storage.from(bucket).upload(storageKey, blob, { upsert: true, contentType })`。  
3. **校验**：`download` 或 list + size；可选再哈希。失败 → 保留 outbox，不写行。  
4. RPC `car_care_upsert_lww` 写入 **仅 metadata + storageKey**（无 base64）。  
5. 成功才 ack outbox。

#### Pull（media）

1. 若有 `storageKey` → download → Blob → IDB。  
2. 否则若有 `base64` → 解码（M2 兼容）。  
3. 若两者皆无且非 tombstone → 校验失败，跳过该行并记错误。

#### 渐进迁移（云上已有 base64 行）

触发：双向同步 / 首次上传准备时，对「有 base64、无 storageKey」的 media：

1. Upload + verify（上节 2–3）。  
2. **同一逻辑事务意图**：再 upsert 行，payload 改为 v2（去掉 base64）。  
3. **禁止**在 verify 前删 base64；切换引用 = 一次 LWW upsert 替换整个 payload。  
4. 幂等：已存在同 `storageKey` 对象则跳过字节上传。  
5. 中断：对象已在、行仍 v1 → 下次重试只做 verify + 切引用；对象在、行已 v2 → 完成。  
6. 孤儿对象：行切走或删除后，GC 清理（见下）。

#### Delete

1. Outbox tombstone → 行 `deleted_at`（保留 payload 中 storageKey 便于 GC）。  
2. Best-effort `remove` 对象；失败留给 orphan cleanup。  
3. 本地 IDB 媒体照旧硬删。

#### Orphan cleanup（**仅显式**；不同步自动跑）

1. List `auth.uid()/` 前缀对象；`complete=false` / 网络错误 → **整次中止、零删除**。  
2. 拉非删 media 行的 `storageKey` 集合。  
3. 对象不在集合 → 候选；须过 **grace（默认 24h）**（防 A 上传未提交 DB ref、B GC 误删）。  
4. 删除前 **再拉一次** live refs（recheck）；若已出现引用则跳过。  
5. 明确 tombstone 仍可在同步路径 `removeStorageForDeletedMedia` 尽力删对象。  
6. 永不跨用户；永不碰他户前缀。详见 `docs/m3a-remediation-orphan-gc-migrate.md`。

### 2.5 失败语义

| 场景 | 行为 |
|---|---|
| Upload 失败 | 不写 DB；outbox 退避重试 |
| Upload OK、行 upsert 失败 | 对象可能暂存；重试 idempotent；orphan GC |
| 行 OK、下载失败 | 合并失败该行；不静默空图；同步 error |
| 中断 | 可恢复；不删未切换的 base64 |
| 重复上传 | 同 content hash 路径 + upsert |
| 删引用 | tombstone 先行；对象后删 |
| JSON 备份 | 仍 base64；**不受** Storage 影响 |

### 2.6 安全

- 浏览器仅 anon + 用户 JWT。  
- Storage RLS + 表 RLS；路径强制 uid 前缀。  
- 拒绝 service_role（既有检查保留）。  
- 私有 bucket；下载经 authenticated client，无长期 public URL。

## 3. 迁移 / 回滚计划

### 3.1 用户侧（BYO）

1. 在自家 SQL Editor 执行：  
   - 既有 `docs/sql/supabase-car-care-rows.sql`（若尚未）  
   - **新增** `docs/sql/supabase-car-care-media-storage.sql`  
2. 升级 PWA 到含 M3-A 的版本。  
3. 连接后跑一次双向同步或首次上传 → 渐进迁移。  
4. 可用 JSON 导出做冷备份（迁移前后均可）。

### 3.2 回滚

| 层级 | 做法 |
|---|---|
| 客户端回退旧版 PWA | 旧版仍可读 v1 base64 行；**读不了**仅有 storageKey 的 v2 行 → 迁移前请 JSON 备份 |
| 保留 dual 窗口 | 可选：迁移 upsert 暂留 base64（`retainBase64UntilAck`）——本 PR **默认不保留**（verify 后直接 v2），因 JSONB 体积是迁移动机；恢复靠本地 IDB + JSON 备份 |
| SQL | bucket/policies 可留着无害；删 bucket 仅在确认无 v2 引用后 |
| 数据 | 生产项目本任务 **零写入** |

### 3.3 风险清单

| 风险 | 等级 | 缓解 |
|---|---|---|
| 仅 v2 行 + 用户装回旧客户端 | 中 | 文档警告；迁移前导出 JSON；版本门槛提示 |
| 上传成功行失败 → 孤儿 | 低 | idempotent 重试 + orphan cleanup |
| Storage RLS 配错暴露跨用户 | 高 | SQL 模板强制 uid 前缀；smoke 测跨用户拒绝 |
| 大图超时 | 中 | 已有压缩；重试；不删 base64 直至 verify |
| 误用生产项目测 | 高 | 测试硬编码 disposable ref；文档禁止 `tqjowsffppgoqtdokbzp` |
| service_role 粘贴 | 高 | 既有拒绝逻辑 |
| JSON 备份被改坏 | 中 | 导入仍走 base64 路径，与云无关 |

## 4. 文件地图

```
docs/m3a-media-storage-migration.md          ← 本文
docs/sql/supabase-car-care-media-storage.sql ← BYO Storage + RLS
src/sync/types.ts                            ← CloudMediaPayload v2
src/sync/mediaCodec.ts                       ← encode/decode + sha
src/sync/mediaStorage.ts                     ← upload/verify/download/remove/orphan
src/sync/validatePayload.ts                  ← 接受 storageKey
src/sync/engine.ts                           ← push/pull/migrate 挂钩
src/sync/providers/types.ts                  ← MediaObjectStore 能力
src/sync/providers/supabase.ts               ← Storage 实现
src/sync/providers/memory.ts                 ← 内存假 Storage
src/sync/mediaStorage.test.ts                ← 单测
src/sync/media-migration.test.ts             ← 渐进迁移 / 失败 / 去重
src/sync/supabase.media-e2e.test.ts          ← disposable live（env）
scripts/m3a-media-storage-smoke.mjs          ← layer1 SQL/Storage smoke
```

## 5. 非目标

- Contabo / 生产部署  
- 改生产 Supabase 数据  
- Notion  
- 手动冲突 UI / Background Sync（仍属后续）  
- 改 JSON 导出格式（保持 base64）

## 6. 验收

- [ ] 未配云时 local-only + JSON 备份行为不变  
- [ ] 新上传媒体：DB 无 base64，Storage 有对象  
- [ ] M2 base64 行可拉可迁；幂等；中断可恢复  
- [ ] 上传失败不丢本地、不切引用  
- [ ] 删除 tombstone + 对象尽力删 + orphan 可清  
- [ ] `npm test` / `tsc -b` / `npm run build` 通过  
- [ ] live 仅 `skwoahneuqkqgxzpkkzl`  
- [ ] 无 service_role；未部署生产  
