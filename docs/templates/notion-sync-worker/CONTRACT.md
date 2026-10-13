# Gateway HTTP 契约摘要（D1 可运行实现）

完整表见 [`../../m3d-implementation-spec.md`](../../m3d-implementation-spec.md) §3。

## 认证

`Authorization: Bearer <GATEWAY_API_KEY>`（MVP）。无/错 → `401` + `{ code: "unauthorized" }`。

## CORS

仅当 `Origin` 精确等于环境变量 `ALLOWED_ORIGIN` 时回显 `Access-Control-Allow-Origin`；否则浏览器跨域请求 → `403 forbidden`。

## 端点

| 方法 | 路径 | 备注 |
|------|------|------|
| GET | `/health` | `{ ok, version }` |
| GET | `/verify` | `{ ok, workspaceKey, botName?, dataSources? }` |
| GET | `/sync/pull` | `{ rows: CloudRow[] }`（含 KV tombstone） |
| POST | `/sync/push` | body: `SyncOutboxItem[]` 或 `{ ops }` → `PushResult` |
| POST | `/sync/snapshot` | body: `CloudRow[]` / `{ rows }` |
| POST | `/auth/*` | D4 → `501 not_implemented` |

## PushResult

```json
{
  "applied": ["outbox-id"],
  "conflicts": [{ "id", "entity", "reason": "cloud_newer|skipped_deleted|ambiguous_race", "attemptedAt", "cloudRow?" }],
  "errors": [{ "id", "entity", "code", "message", "retryable" }]
}
```

- `payload_too_large`：UTF-16 长度 > 2000 · **不截断** · 该 op 失败  
- `rate_limited` / `notion_unavailable`：`retryable: true` · **不进入 applied**  
- `ambiguous_race`：同 `AppEntityId` 多页 · **禁止静默成功**

## 属性名

PascalCase：`AppEntityId` · `AppUpdatedAt` · `AppDeletedAt` · `PayloadJson` · `DeviceId` · `Name`

## Tombstone

删除双轨：`in_trash: true` + `AppDeletedAt`。用户侧 KV `TOMBSTONE_KV` 持久化 `AppEntityId → pageId`，弥补 DS query 默认排除 trash 的缺口。
