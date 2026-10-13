# Notion Sync Worker 参考模板（O1）· 伪代码 / 接口说明

> **状态**：docs-only · 无真实 secret · **不可**当作已发布的可运行生产包  
> **权威契约**：[`../../m3d-implementation-spec.md`](../../m3d-implementation-spec.md) §3 · [`../../m3d-architecture.md`](../../m3d-architecture.md) §2  
> **目的**：用户自建 Cloudflare Worker 时的目录与职责说明；应用方**不**托管运行时、**不**集中持有 Token。

## 目录与职责

| 路径 | 职责 |
|------|------|
| `README.md` | 本文件：部署概念步骤与 Secret 清单 |
| `CONTRACT.md` | HTTP 契约摘要 |
| `src/routes.pseudo.ts` | 路由 / 鉴权伪代码 |
| `src/lww.pseudo.ts` | Push 先读后写 + 删除双轨 |
| `src/payload.pseudo.ts` | PayloadJson ≤2000 失败闭合 |

## Secret 清单（仅用户 Worker 环境）

| 名 | 说明 |
|----|------|
| `NOTION_TOKEN` | Internal Connection / PAT · **永不**下发客户端 |
| `GATEWAY_API_KEY` | 用户自设 · PWA 运行时 Bearer |
| `ALLOWED_ORIGIN` | PWA Origin（CORS） |
| `SESSION_SIGNING_SECRET` | **仅 D4** JWT |

## 概念部署步骤（实现阶段完善；此处不承诺 30min 可跑通）

1. 在 Notion 创建 Internal Connection，将「车辆」「养护」两 Database Share 给该 Connection。  
2. 复制本模板到自有仓库 / 目录；用 wrangler 配置上述 Secret（**不要**把实值 commit）。  
3. 实现（或后续替换伪代码为）`/verify` `/sync/pull` `/sync/push`。  
4. 在车护设置（实验）填 Gateway URL；每次会话输入 API Key。

## 明确不做

- 不把本目录链进 `app` Vite 生产构建  
- 不提交真实 token  
- MVP 不做共享 Public OAuth、不做 Durable Object 必选  
