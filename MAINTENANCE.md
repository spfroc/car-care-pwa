# 车护助手 — 低维护交接手册（M3-D）

> 本文档用于生产环境的只读交接。  
> **事实基准日：2026-10-26（Asia/Shanghai）。** 2026-10-16 初稿里的生产 tip / bundle /「与 car-test 同 bundle」/ Contabo 163 发信，均已过时，禁止再当现状。  
> **禁止**在本文档中存放 Token、API Key、SMTP 授权码或完整 workspaceKey UUID。

---

## 目录

1. [当前生产版本与地址](#1-当前生产版本与地址)
2. [架构与关键依赖](#2-架构与关键依赖)
3. [巡检任务与告警渠道](#3-巡检任务与告警渠道)
4. [备份与回滚](#4-备份与回滚)
5. [常见故障排查](#5-常见故障排查)
6. [已知风险与功能限制](#6-已知风险与功能限制)
7. [低维护纪律](#7-低维护纪律)

---

## 1. 当前生产版本与地址

2026-10-26 只读核对 https://car.adobesun.com ：首页脚本为 `index-BFbd_2kA.js`；设置页分包内版本函数返回 **1.0.7**，内嵌 git 为 `5c0a365fcbf41e7c49ad3567f26611e40e67c16f`，构建时间 `2026-10-23T09:41:24+08:00`。该 tip 即 main 上 PR #36。

| 项 | 值 |
|---|---|
| 生产 PWA | https://car.adobesun.com |
| 版本 | **1.0.7** |
| 生产 tip（git） | `5c0a365fcbf41e7c49ad3567f26611e40e67c16f`（PR #36） |
| 生产 bundle | `index-BFbd_2kA.js` |
| 监控期望 bundle | `PWA_EXPECT_BUNDLE=index-BFbd_2kA.js` |
| 构建时间（页面内嵌） | `2026-10-23T09:41:24+08:00` |
| bundle sha256（2026-10-26 对生产 URL 只读计算） | `1199294a6bb2db1e3c88e9a5a2b46225c84ace3581b14acc1470ca66442773df` |
| staging / car-test | https://car-test.adobesun.com |

**staging 不是生产的镜像。** 可能落后于生产，以实际 stamp 为准。2026-10-26 只读抽查时，car-test 首页脚本仍是 `index-Ddi6Z1jp.js`（M3-D 旧包），与生产 `index-BFbd_2kA.js` 不同。验收或排障前重新看 HTML 里的脚本名，不要沿用本表的抽查结果。

已作废、不要再写进现状：tip `f3bb58aceec53fea1c14f6959c3954259f6ff88d`、bundle `index-Ddi6Z1jp.js` 当作生产、以及「car-test 同 bundle」。

---

## 2. 架构与关键依赖

### 2.1 PWA 主机（Contabo）

| 项 | 值 |
|---|---|
| 主机 | Contabo `161.97.138.206` |
| 生产目录 | `/var/www/car-care` |
| 站点备份目录 | `/var/www/car-care-backups/` |

### 2.2 Notion 同步 Gateway（Cloudflare Worker）

PWA 1.0.4–1.0.7 没有轮换 Gateway 的提交。下列版本与指纹仍是 M3-D 正式 Gateway 部署记录，不是 2026-10-26 的重新登录探针。当日不带密钥访问 `GET /health` 返回 **401**（Worker 模板要求 Bearer），因此没有把版本串写成新的实测值。

| 项 | 值 |
|---|---|
| Worker 名 | `car-care-notion-sync` |
| URL | https://car-care-notion-sync.spf-roc.workers.dev |
| version（部署记录） | `m3d-prod-1.0.0` |
| keyFp | `aa819deb16dc` |
| wkFp | `c647ac0368ff`（与历史 d1-test A 相同 workspaceKey — 见 [RR-WK](#61-rr-wk)） |
| botName | 车护正式同步 |

**安全约束：** 测试 Worker **不得**含生产 Origin（M3-D 部署时已对生产 Origin 验证 403）。本次未再打测试 Worker。

### 2.3 Supabase

- 用户自有云为可选能力。
- 烟雾项目：`car-care-m2-smoke`（ref `skwoahneuqkqgxzpkkzl`，交接时状态 `ACTIVE_HEALTHY`；状态以控制台为准）。
- **低维护期间不改**正式 schema / 数据 / 密钥。

### 2.4 监控主机路径

- 根目录：`/opt/car-care-monitor`（Contabo，只读巡检）
- 凭据文件（权限均为 `600`，与部署 SSH 密钥隔离）：
  - `/opt/car-care-monitor/conf/smtp.secret.disabled`（原 `smtp.secret`，2026-10-26 停用 163 时改名；**不要**再写成仍在使用的 `smtp.secret`）
  - `/opt/car-care-monitor/conf/gateway.monitor.key`（Gateway 探针；本次未登录主机复核该文件是否仍在原路径）
- 停用 163 时的配置备份目录：`/opt/car-care-monitor/conf/backups-disable-163-20261026-095600/`

---

## 3. 巡检任务与告警渠道

### 3.1 systemd timers

只读巡检（2026-10-26 **仍启用**）：

- `car-care-monitor-15m.timer`
- `car-care-monitor-daily.timer`
- `car-care-monitor-weekly.timer`
- `car-care-monitor-monthly.timer`
- `car-care-monitor-quarterly.timer`

已停用：

- `car-care-digest.timer`（**disabled**）

### 3.2 告警邮件（2026-10-26 已改）

Contabo 上的 163 发信 **已停用**，不再把 `grok_bot@163.com` 写成现行通道。

| 项 | 值 |
|---|---|
| Contabo SMTP | **停用**。`SMTP_ENABLED=0` |
| 原发件 | `grok_bot@163.com`（已停，勿再启用） |
| 原 SMTP 文件 | `smtp.secret` 已改名为 `smtp.secret.disabled` |
| 摘要 timer | `car-care-digest.timer` disabled |
| 现行外发 | Grok Bot 原生邮箱 `spfroc@mail.grokbot.com` → `spf_roc@163.com`（草稿 / 例程） |
| 配置备份 | `/opt/car-care-monitor/conf/backups-disable-163-20261026-095600/` |

### 3.3 告警策略

163 通道时期的分级（正常不发、P0 立即、P1 连续 3 次、P2 按周期、P3 只记日志、去重与恢复信、失败进 pending）**不再由 Contabo SMTP 执行**。只读巡检 timer 仍会跑；是否对外发信以 Grok Bot 草稿 / 例程为准。本文不把旧 SMTP 行为写成现行发送路径。

### 3.4 监控禁止项

监控脚本与运维人员在低维护期 **禁止**：

- 自动改代码 / 依赖
- 重启生产服务
- 轮换密钥
- 自动部署
- 自动 CLAIM / DISCARD Outbox
- 开启 `notionTargetGuard` enforce
- 重新打开 Contabo 163 SMTP（`SMTP_ENABLED`、`smtp.secret`、`car-care-digest.timer`）除非另行明示授权

---

## 4. 备份与回滚

### 4.1 备份位置

- 站点目录：`/var/www/car-care-backups/`
- **近期回滚示例（PR #36 之前）：**  
  `/var/www/car-care-backups/car-care-pre-pr36-20261023-094113.tar.gz`  
  包内旧生产为 tip `de3efced479001a593dbeeafb732d49cc4277e30`（1.0.6，#35）、bundle `index-DmWIzwPt.js`。
- 更早的 M3-D 包  
  `/var/www/car-care-backups/car-care-pre-m3d-prod-rrwk-20261015-112538.tar.gz`  
  对应已作废的 `f3bb58a` / `index-Ddi6Z1jp.js`，**不是**当前生产的上一版。
- 停用 163 的监控配置备份（不是站点包）：  
  `/opt/car-care-monitor/conf/backups-disable-163-20261026-095600/`

### 4.2 回滚命令要点

```bash
# 在 Contabo 上（需明示授权后执行）
tar -C /var/www -xzf /var/www/car-care-backups/<backup>.tar.gz
```

回滚后核对 bundle 文件名，并同步修改监控里的 `PWA_EXPECT_BUNDLE`。当前期望值是 `index-BFbd_2kA.js`；若回到 PR #36 之前的包，期望值才是 `index-DmWIzwPt.js`。

**硬性禁止：**

- 禁止把生产指回 `d1-test`
- 禁止在无用户明示授权时改动 `/var/www/car-care`

---

## 5. 常见故障排查

> 原则：**先报告，不自动修。** 必要修复走独立 PR → 审查 → 明示授权后再动生产。car-test 可能落后，不能拿它的 bundle 代替生产 stamp。

| 现象 | 建议排查（只读） |
|---|---|
| 生产页面异常 / 白屏 | 核对版本 **1.0.7**、tip `5c0a365fcbf41e7c49ad3567f26611e40e67c16f`、bundle `index-BFbd_2kA.js`（监控 `PWA_EXPECT_BUNDLE`）。需要时重算 sha256，对照 §1。不要用 car-test 的脚本名充当生产 |
| Gateway 4xx/5xx | Worker `car-care-notion-sync`。部署记录版本 `m3d-prod-1.0.0`；无密钥 `GET /health` 为 401 属预期。测试 Worker 不得含生产 Origin |
| 同步身份异常 | 核对 keyFp / wkFp；勿在文档或日志外泄完整密钥 |
| 收不到邮件 | **不要**到 Contabo 上查 163 是否发出。`SMTP_ENABLED=0`，`car-care-digest.timer` 已 disabled，`smtp.secret` 已改名为 `smtp.secret.disabled`。看 Grok Bot `spfroc@mail.grokbot.com` → `spf_roc@163.com` 的草稿 / 例程。只读巡检 timer 仍应是 enabled。勿打印密钥内容 |
| Outbox 积压 | 只读观察；**禁止**自动 CLAIM / DISCARD |
| Supabase 异常 | 烟雾项目健康可参考；**不改**正式 schema/数据/密钥 |

---

## 6. 已知风险与功能限制

以下三条对照 **main `5c0a365` 源码**与 M3-D Gateway 部署记录，2026-10-26 仍然成立。PWA 版本升到 1.0.7 没有改这些默认值。

### 6.1 RR-WK

生产 Gateway 部署记录中的 `wkFp=c647ac0368ff` 与历史 **d1-test A** 使用相同 workspaceKey（指纹一致）。此为已知披露项 **RR-WK**。低维护期不主动轮换；任何轮换须独立审查与明示授权。main 上 1.0.4–1.0.7 没有轮换该指纹的提交。

### 6.2 notionTargetGuard 切换流程（仅文档，默认不执行）

`src/sync/notionTarget.ts` 中 `guardMode` 默认 **`off`**。未写入 `observe` / `enforce` 时保持关闭。

1. **保持默认 off**
2. 授权后在测试环境 / 设备切 **observe**，观察日志
3. 再经人工授权后切 **enforce**
4. **Legacy Outbox** 仅允许在设置页经二次确认后 **CLAIM**（`confirmToken === 'CLAIM'`）。禁止自动 CLAIM / DISCARD

### 6.3 其它限制

- 测试 Worker 不得含生产 Origin（M3-D 已验证 403；本次未复测）
- 不改正式 Supabase / Notion 用户数据 / IDB / Outbox
- Contabo 163 SMTP 保持停用

---

## 7. 低维护纪律

1. **现状以 §1 为准。** 生产已是 1.0.7，不是 2026-10-16 交接稿里的 `f3bb58a`。不要把「功能冻结在 M3-D 那个 bundle」写成当前事实。
2. **先报告，不自动修** — 15m / daily / weekly / monthly / quarterly 巡检只读；发现问题先通知、再人工决策。
3. **必要修复流程**  
   独立 PR → 独立审查 → **用户明示授权**后才可变更 [car.adobesun.com](https://car.adobesun.com)。[car-test](https://car-test.adobesun.com) 可能落后于生产，以实际 stamp 为准，不能当作「与生产同 bundle」的验收依据。
4. **数据与密钥边界**  
   不改正式 Supabase schema/数据/密钥；不改 Notion 用户数据；不改 IDB / Outbox；不自动 CLAIM / DISCARD；不开启 guard enforce（除非按 §6.2 逐步授权）。
5. **邮件边界** — 外发只走 Grok Bot 原生邮箱。不要在 Contabo 上重新打开 `grok_bot@163.com`。
6. **零静默部署** — 任何生产目录、Worker、监控配置变更均需明示授权。回滚后同步 `PWA_EXPECT_BUNDLE`。
7. **文档保密** — 不把 Token、API Key、SMTP 授权码、完整 workspaceKey UUID 写入仓库或本文件。

---

*文档版本：2026-10-26（Asia/Shanghai）· 已对齐生产 **1.0.7**（tip `5c0a365fcbf41e7c49ad3567f26611e40e67c16f`，bundle `index-BFbd_2kA.js`）· Contabo **163 SMTP 已停用***
