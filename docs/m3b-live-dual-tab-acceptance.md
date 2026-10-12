# M3-B 最终发布前 — 双标签真实浏览器集成验收

> **时间**：2026-10-12 ~17:10–17:15 Asia/Shanghai (CST)  
> **站点**：https://car-test.adobesun.com（`d7dd681` / `index-Cv8wDxDq.js`）  
> **云**：仅 disposable `https://skwoahneuqkqgxzpkkzl.supabase.co`  
> **账号**：`m2smoke@carcare.test`（密码已轮换；凭据仅 `.env.smoke.local`，已 gitignore）  
> **硬禁止**：生产 Supabase `tqjowsffppgoqtdokbzp`、生产站 `car.adobesun.com`（本轮仅核对 stamp 未变）

脚本：`scripts/m3b-live-dual-tab-acceptance.mjs`  
产物：`artifacts/m3b-live-dual-tab/`（screenshots + `results.json` + `console.log` / `run.log`）

## 本轮收尾（相对审查）

1. **凭据安全**：disposable 上轮换 `m2smoke@` / `m2smoke-b@` 密码；旧密码登录失败、新密码成功。源码去掉硬编码测试密码与 anon JWT 默认值；`SMOKE_SUPABASE_ANON` / `SMOKE_PASS` 缺失则 `exit 2`。URL 默认 disposable，拒绝 prod ref。
2. **断言收紧**：互斥场景必须 **busy 文案 + 对侧完成**（禁止仅凭任一侧成功）；并检查 outbox/云一致（`2.mutex.queue-cloud`、`1.concurrent.no-dangerous-dup`、Suite 5 同口径）。Toast 用 epoch/baseline，**不**删除 React DOM，避免残留误匹配。
3. **重跑**：car-test only + disposable only；**未**部署生产、**未**改正式 Supabase。

## PASS/FAIL 矩阵

| # | 场景 | 断言 | 结果 |
|---|------|------|------|
| 0 | Staging stamp / bundle / target | `d7dd681` + `index-Cv8wDxDq.js` + car-test | **PASS** |
| 0 | Prod untouched | 仍 `6adcd15` / `index-f4r7_DP6.js` | **PASS** |
| 0 | Disposable URL only | `skwoahneuqkqgxzpkkzl`，无 prod ref | **PASS** |
| 1 | 同账号校验连接 | toast 连接成功 | **PASS** |
| 1 | Web Locks 可用 | `navigator.locks.request` | **PASS** |
| 1 | 并发双向同步序列化 | **一侧 busy 且一侧完成**（非 OR 成功） | **PASS** |
| 1 | 并发无危险双写 | 云单行 + outbox ACK/一致 | **PASS** |
| 2 | A/B 互斥 busy+done | busy∧done（可交换） | **PASS** |
| 2 | 互斥后队列/云 | acked+cloud 或合理 queued | **PASS** |
| 3 | A 网络中断/失败 | toast 失败；**outbox 仍保留**该 op | **PASS** |
| 4 | B 重试 | 双向同步完成；云端有车辆；本地有车辆；outbox 已 ACK | **PASS** |
| 5 | 禁用 Web Locks | `navigator.locks` 不可用 | **PASS** |
| 5 | IDB lease 互斥 | busy∧done + 队列/云一致 | **PASS** |
| 5 | IDB meta 证据 | locks 禁用 + mutex 成立 | **PASS** |

**合计：22 / 22 PASS**（0 FAIL）

### 判定说明（IDB meta）

同步结束后 `syncTabLease` / `syncHeartbeat` 会被 holder **正常释放**，故「同步完成后读 lease」不能作为路径证据。IDB 回退路径的证据为：

1. `addInitScript` 禁用 `navigator.locks`  
2. 双标签仍出现 **busy + 完成** 互斥（非仅成功）  
3. 云端单行 / outbox ACK 一致

## 证据文件

| 文件 | 内容 |
|------|------|
| `artifacts/m3b-live-dual-tab/results.json` | 全量断言（含 `credentialsRotated` / `assertionsTightened`） |
| `artifacts/m3b-live-dual-tab/console.log` | 运行日志 |
| `artifacts/m3b-live-dual-tab/run.log` | 脚本内时间戳日志 |
| `01-verified.png` | 校验连接成功 |
| `01-concurrent.png` / `02-*.png` | 并发 / busy |
| `03-interrupt-outbox.png` | 失败后队列保留 |
| `04-retry-consistent.png` | B 重试成功 |
| `05-idb-lease-busy.png` | 无 Web Locks 时互斥 |

## 运行方式（本地）

```bash
set -a; source .env.smoke.local; set +a
node scripts/m3b-live-dual-tab-acceptance.mjs
```

`.env.smoke.local` 已被 `*.local` gitignore，**勿提交**。

## 方法摘要

- **同一 browser context、两个 page** = 真实双标签（共享 IDB / Web Locks / origin）  
- Disposable 配置经设置页「校验连接」写入本地  
- 本地 vehicle + `sync_outbox` 种子（`m3b-dt-*`）  
- 仅对 `/rest/v1/`、`/storage/v1/` 注入延迟；`route.abort` 模拟中断  
- Toast：`beginToastEpoch` + baseline，忽略导航前残留  
- 云一致性用 `@supabase/supabase-js` anon + 同账号查询 `car_care_rows`  
- Suite 5：`context.addInitScript` 去掉 `navigator.locks` → 强制 IDB lease  

## 未做 / 边界

- 未部署生产、未改生产 Supabase  
- 未宣称关页后 BG Sync 一定上行  
- 飞行中推送失败时 outbox **保留**（本验收 #3）；成功重试后 ACK（#4）  
- 未改 M3-B 业务功能代码  

## 本提交

- git: `bc28c36` / full `bc28c364da5a24d01fd9d3af55ac120bbaed6f59`
- 业务 tip 仍为 car-test `d7dd681` / `index-Cv8wDxDq.js`（本轮未改业务、未部署）

## 结论

**集成验收 PASS（收紧后 22/22）。** 凭据已轮换且去硬编码；双标签互斥（Web Locks + IDB 回退）以 busy∧done + 队列/云一致判定；失败保留 outbox、重试后云/本地一致，均在 car-test + disposable 上得到真实浏览器证据。
