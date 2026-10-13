# Gateway HTTP 契约摘要

完整表见 [`../../m3d-implementation-spec.md`](../../m3d-implementation-spec.md) §3。

## 认证

`Authorization: Bearer <GATEWAY_API_KEY>`（MVP）。无/错 → `401`。

## 端点

| 方法 | 路径 | 备注 |
|------|------|------|
| GET | `/health` | 探活 |
| GET | `/verify` | 返回 `workspaceKey` |
| GET | `/sync/pull` | `CloudRow[]`（含 tombstone） |
| POST | `/sync/push` | 尽力 LWW → `PushResult` |
| POST | `/sync/snapshot` | 分块 push |
| POST | `/auth/session` 等 | D4 可选 |

## 错误码速查

`401 unauthorized` · `403` · `404 not_shared` · `409 workspace_mismatch` · `422 payload_too_large` · `429 rate_limited` · `503 notion_unavailable`

## 属性名

PascalCase：`AppEntityId` · `AppUpdatedAt` · `AppDeletedAt` · `PayloadJson` · `DeviceId` · `Name`
