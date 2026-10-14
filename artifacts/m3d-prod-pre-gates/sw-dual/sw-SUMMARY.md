# SW1–SW4 dual-workspace live — BLOCKED

- A: `https://car-care-notion-sync-d1-test.spf-roc.workers.dev` keyFp=`91dee0d48d59`
- B: missing

## Gaps
- 缺少第二测试 Gateway URL（GATEWAY_B_URL / m3d-d1-b-notion.env / m3d-d1-b-gateway-url.txt）
- 缺少第二测试 Gateway API Key（GATEWAY_B_KEY / m3d-d1-b-notion.env / m3d-d1-b-gateway-api-key.txt）
- 第二 Notion workspace（不同 workspace_id）+ Integration Token + Vehicles/Records DS ids
- 第二测试 Worker 名须含 d1-test-b（独立 KV / 独立 Key / CORS 含 car-test+localhost；禁止生产名 car-care-notion-sync）

## Steps
- **SW1**: BLOCKED — BLOCKED — 无第二工作区 Gateway；不单测冒充 live
- **SW2**: BLOCKED — BLOCKED — 需要不同 workspaceKey 的 Gateway B
- **SW3**: BLOCKED — BLOCKED — 依赖 SW2 park 队列
- **SW4**: BLOCKED — BLOCKED — 依赖切回 Gateway A flush
- **SUPPORT_verify_A**: PASS — status=200 wkFp=c647ac0368ff version=?

Harness: `scripts/m3d-sw-dual-workspace-live.mjs` (env-driven GATEWAY_A_* / GATEWAY_B_*).
