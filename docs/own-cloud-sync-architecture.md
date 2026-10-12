# 自有云同步架构（设计稿）

> **状态**：设计文档 only。当前代码库 **无** Notion / Supabase / 其它云同步实现（2026-10 审计确认）。  
> **约束**：local-first；本文不接通生产、不迁移真实用户数据、不部署。

## 1. 审计结论

| 项 | 结果 |
|---|---|
| Notion MCP / SDK 引用 | 无（业务 `src/` 内零命中） |
| Supabase / Postgres 客户端 | 无 |
| 自建 sync API | 无 |
| 现有备份通道 | 本地 JSON `car-care-export-v1` 导入/导出 |

因此「自有云存储」按绿地图设计，实现落地需单独里程碑。

## 2. 目标与原则

1. **Local-first**：IndexedDB 仍是唯一实时读写源；云端是副本与跨设备中继。
2. **用户隔离**：每个账号一个逻辑租户；服务端以 `user_id` 强制 RLS / 行级隔离。
3. **可离线**：无网时照常记账；恢复网络后按 outbox 重试。
4. **可审计删除**：删除走 tombstone，支持有限窗口内恢复。
5. **凭证不出客户端明文长期存**：OAuth / magic-link；刷新令牌存安全存储（Web：HttpOnly cookie 或浏览器 credential；勿把 service role key 放进 PWA）。

## 3. 推荐栈（自有后端）

| 层 | 建议 | 备注 |
|---|---|---|
| Auth | 自建 OIDC 或 Clerk/Auth.js + 自有 user 表 | 禁止把 Notion personal token 当多用户方案 |
| API | HTTPS JSON（Cloudflare Workers / 自有 Node） | 与 Contabo 静态 PWA 分离源 |
| DB | Postgres（可用托管 Supabase **自有项目**，或自建） | 开启 RLS |
| Blob | R2 / S3 兼容 | media 不进 Postgres row |
| 客户端队列 | IndexedDB `sync_outbox` + `sync_meta` | 与业务 store 分库或分 store |

**明确不采用**：把用户养护数据写入个人 Notion workspace 作为主存储（隔离差、冲突模型弱、配额不可控）。

## 4. 数据模型（云端）

与本地 `CarCareExportV1` 对齐的行表：

- `vehicles`, `records`, `stations`, `settings`, `learning`（learning 默认 **不同步**，隐私/噪音）
- `media_objects`：元数据 + `storage_key`；二进制走对象存储
- 每行公共列：`user_id`, `id` (UUID), `updated_at`, `deleted_at` (nullable), `device_id`, `base_version` (row version / lamport)

导出格式可继续用作 **冷备份** 与 **首次上云 bootstrap**，与在线 sync 协议分离。

## 5. 同步协议（双向）

### 5.1 客户端状态

```
sync_meta: { lastPullAt, lastPushAt, serverCursor, deviceId, authUserId }
sync_outbox: [{ opId, entity, entityId, op: upsert|delete, payload, mutatedAt, attempts, nextRetryAt }]
```

业务写路径：`putX` / `deleteX` 成功后追加 outbox（同事务或紧随其后；失败则标记 dirty）。

### 5.2 Push

1. 取出 `attempts < N` 且 `nextRetryAt <= now` 的 outbox 批次（按 `mutatedAt`）。
2. `POST /sync/push`：body = ops + `deviceId`。
3. 服务端按 `(user_id, entity, id)` 应用：**last-write-wins on `updated_at`**，若客户端 `base_version` 落后则返回 conflict。
4. 成功 ops 从 outbox 删除；冲突 ops 进入 `sync_conflicts` 供 UI 处理。

### 5.3 Pull

1. `GET /sync/pull?cursor=` 返回自 cursor 以来的 upsert/tombstone。
2. 客户端合并：若本地 outbox 无同 id 未推送改动 → 应用服务端；若有 → 记 conflict，不静默覆盖。
3. 更新 `serverCursor`。

### 5.4 冲突策略（双向）

| 场景 | 默认 | UI |
|---|---|---|
| 同字段两端改 | LWW by `updated_at` | 设置中可开「手动合并」 |
| 一端删一端改 | **改胜于删**（清除 tombstone）或 **删胜于改**（可配置）；默认改胜于删 | 冲突列表可还原 |
| media 冲突 | 以较新 `updated_at` 的 storage_key 为准 | — |

## 6. 离线重试

- 指数退避：`nextRetryAt = now + min(2^attempts, 64) * 30s` + jitter。
- `navigator.onLine` / `online` 事件触发 flush；PWA background sync（可选）仅作加速。
- 达到 `attempts` 上限 → 标记 `failed`，设置页展示「同步暂停」与导出兜底。

## 7. 删除同步与恢复

1. 本地删除：写 tombstone（`deleted_at`）进 outbox，本地隐藏行（或硬删业务行但 outbox 保留 tombstone）。
2. Push tombstone → 服务端软删；对象存储媒体进「待清理」队列（Grace **30 天**）。
3. **恢复**：`POST /sync/restore { entity, id }` 在 grace 内清 `deleted_at`；客户端 pull 后重建。
4. Grace 结束后：GC 硬删 DB 行 + blob；不可恢复（需用户曾导出 JSON）。

## 8. 凭证与安全

- Access token 短命；Refresh 仅 HttpOnly Secure cookie（同站 API）或 OS 级安全存储。
- **永不** 把数据库 service role / Notion internal integration token 打进前端 bundle。
- RLS：`user_id = auth.uid()`；媒体 URL 用短时签名。
- 导出文件可含媒体 base64 —— 上云 bootstrap 走 HTTPS multipart，完成后提示用户勿再邮件明文发送。

## 9. 与现有导入导出关系

| 通道 | 用途 |
|---|---|
| `car-care-export-v1` | 离线备份、迁移、灾难恢复 |
| Sync API | 日常多设备 |

上云前必须跑通：**校验 → 原子覆盖导入**（本审计 P0）以免脏包污染云端真相源。

## 10. 实施里程碑（未开工）

1. Auth + 空 Postgres schema + RLS  
2. Outbox + push/pull MVP（无媒体）  
3. 媒体签名上传下载  
4. 冲突 UI + 删除恢复  
5. E2E：双设备离线交叉编辑  

**本文不授权任何生产部署或现网数据写入。**
