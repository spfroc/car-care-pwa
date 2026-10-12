# M3-B 最终发布前 — 双标签真实浏览器集成验收

> **时间**：2026-10-12 ~16:32–16:39 Asia/Shanghai (CST)  
> **站点**：https://car-test.adobesun.com（`d7dd681` / `index-Cv8wDxDq.js`）  
> **云**：仅 disposable `https://skwoahneuqkqgxzpkkzl.supabase.co`  
> **账号**：`m2smoke@carcare.test`  
> **硬禁止**：生产 Supabase `tqjowsffppgoqtdokbzp`、生产站 `car.adobesun.com`（本轮仅核对 stamp 未变）

脚本：`scripts/m3b-live-dual-tab-acceptance.mjs`  
产物：`artifacts/m3b-live-dual-tab/`（screenshots + `results.json` + `console.log`）

## PASS/FAIL 矩阵

| # | 场景 | 断言 | 结果 |
|---|------|------|------|
| 0 | Staging stamp / bundle / target | `d7dd681` + `index-Cv8wDxDq.js` + car-test | **PASS** |
| 0 | Prod untouched | 仍 `6adcd15` / `index-f4r7_DP6.js` | **PASS** |
| 0 | Disposable URL only | `skwoahneuqkqgxzpkkzl`，无 prod ref | **PASS** |
| 1 | 同账号校验连接 | toast 连接成功 | **PASS** |
| 1 | Web Locks 可用 | `navigator.locks.request` | **PASS** |
| 1 | 并发双向同步序列化 | 一侧 busy / 一侧完成；云端单行；outbox 清空无重复 | **PASS** |
| 2 | A 同步中 B busy（互斥） | 两 toast 中恰好一侧「另一标签页…队列已保留」 | **PASS** |
| 3 | A 网络中断/失败 | toast 失败；**outbox 仍保留**该 op | **PASS** |
| 4 | B 重试 | 双向同步完成；云端有车辆；本地有车辆；outbox 已 ACK | **PASS** |
| 5 | 禁用 Web Locks | `navigator.locks` 不可用 | **PASS** |
| 5 | IDB lease 互斥 | 禁用锁后仍一侧 busy、一侧完成 | **PASS** |

**合计：21 / 21 PASS**（0 FAIL）

### 判定说明（IDB meta）

同步结束后 `syncTabLease` / `syncHeartbeat` 会被 holder **正常释放**，故「同步完成后读 lease」不能作为路径证据。IDB 回退路径的证据为：

1. `addInitScript` 禁用 `navigator.locks`  
2. 双标签仍出现 busy 互斥  
3. 同跑次中曾观测 `mode: "idb-lease"`（中途快照；完成后清空属预期）

## 证据文件

| 文件 | 内容 |
|------|------|
| `artifacts/m3b-live-dual-tab/results.json` | 全量断言 |
| `artifacts/m3b-live-dual-tab/console.log` | 运行日志 |
| `01-verified.png` | 校验连接成功 |
| `01-concurrent.png` / `02-*.png` | 并发 / busy |
| `03-interrupt-outbox.png` | 失败后队列保留 |
| `04-retry-consistent.png` | B 重试成功 |
| `05-idb-lease-busy.png` | 无 Web Locks 时互斥 |

## 方法摘要

- **同一 browser context、两个 page** = 真实双标签（共享 IDB / Web Locks / origin）  
- Disposable 配置经设置页「校验连接」写入本地  
- 本地 vehicle + `sync_outbox` 种子（`m3b-dt-*`）  
- Supabase 路由延迟 / `route.abort` 模拟长同步与中断  
- 云一致性用 `@supabase/supabase-js` anon + 同账号查询 `car_care_rows`  
- Suite 5：`context.addInitScript` 去掉 `navigator.locks` → 强制 IDB lease  

## 未做 / 边界

- 未部署生产、未改生产 Supabase  
- 未宣称关页后 BG Sync 一定上行  
- 飞行中推送失败时 outbox **保留**（本验收 #3）；成功重试后 ACK（#4）  

## 结论

**集成验收 PASS。** 双标签互斥（Web Locks + IDB 回退）、失败保留 outbox、重试后云/本地一致，均在 car-test + disposable 上得到真实浏览器证据。
