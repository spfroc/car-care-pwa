# 车护助手 — 低维护交接手册（M3-D）

> 本文档用于生产环境进入低维护期后的只读交接。  
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

| 项 | 值 |
|---|---|
| 生产 PWA | https://car.adobesun.com |
| 生产 tip（git） | `f3bb58aceec53fea1c14f6959c3954259f6ff88d` |
| 生产 bundle | `index-Ddi6Z1jp.js` |
| bundle sha256 | `5e94997a82fb7353d44849283e02e2fd89aff638d13e2c1f0674f870cc3f7563` |
| deploy stamp | `git=f3bb58aceec53fea1c14f6959c3954259f6ff88d bundle=index-Ddi6Z1jp.js target=car.adobesun.com approved_by_user=true` |
| 归档 merge（部署报告 PR #27） | `0ecc52ba212a58e8cc201df35cbce0dc06ba79f9` |
| staging / car-test（只读对照） | https://car-test.adobesun.com（同 bundle） |

---

## 2. 架构与关键依赖

### 2.1 PWA 主机（Contabo）

| 项 | 值 |
|---|---|
| 主机 | Contabo `161.97.138.206` |
| 生产目录 | `/var/www/car-care` |
| 备份目录 | `/var/www/car-care-backups/` |

### 2.2 Notion 同步 Gateway（Cloudflare Worker）

| 项 | 值 |
|---|---|
| Worker 名 | `car-care-notion-sync` |
| URL | https://car-care-notion-sync.spf-roc.workers.dev |
| version | `m3d-prod-1.0.0` |
| keyFp | `aa819deb16dc` |
| wkFp | `c647ac0368ff`（与历史 d1-test A 相同 workspaceKey — 见 [RR-WK](#61-rr-wk)） |
| botName | 车护正式同步 |

**安全约束：** 测试 Worker **不得**含生产 Origin（已验证对生产 Origin 返回 403）。

### 2.3 Supabase

- 用户自有云为可选能力。
- 烟雾项目：`car-care-m2-smoke`（ref `skwoahneuqkqgxzpkkzl`，状态 `ACTIVE_HEALTHY`）。
- **低维护期间不改**正式 schema / 数据 / 密钥。

### 2.4 监控主机路径

- 根目录：`/opt/car-care-monitor`（已部署在 Contabo，只读巡检）
- 凭据文件（权限均为 `600`，与部署 SSH 密钥隔离）：
  - `/opt/car-care-monitor/conf/smtp.secret`
  - `/opt/car-care-monitor/conf/gateway.monitor.key`

---

## 3. 巡检任务与告警渠道

### 3.1 systemd timers

已部署：

- `car-care-monitor-15m.timer`
- `car-care-monitor-daily.timer`
- `car-care-monitor-weekly.timer`
- `car-care-monitor-monthly.timer`
- `car-care-monitor-quarterly.timer`

### 3.2 告警邮件

| 项 | 值 |
|---|---|
| 通道 | 163 SMTP SSL `smtp.163.com:465` |
| 发件 | `grok_bot@163.com` |
| 收件 | `spf_roc@163.com` |

### 3.3 告警策略

| 级别 | 行为 |
|---|---|
| 正常 | 不通知 |
| P0 | 立即通知 |
| P1 | 连续 3 次失败后通知 |
| P2 | 按周期通知 |
| P3 | 单次超时只记日志 |
| 去重 | 已启用 |
| 恢复 | 发送恢复通知 |
| 发送失败 | 进入 pending，下次重试 |

### 3.4 监控禁止项

监控脚本与运维人员在低维护期 **禁止**：

- 自动改代码 / 依赖
- 重启生产服务
- 轮换密钥
- 自动部署
- 自动 CLAIM Outbox
- 开启 `notionTargetGuard` enforce

---

## 4. 备份与回滚

### 4.1 备份位置

- 目录：`/var/www/car-care-backups/`
- 回滚备份示例：  
  `/var/www/car-care-backups/car-care-pre-m3d-prod-rrwk-20261015-112538.tar.gz`

### 4.2 回滚命令要点

```bash
# 在 Contabo 上（需明示授权后执行）
tar -C /var/www -xzf /var/www/car-care-backups/<backup>.tar.gz
```

**硬性禁止：**

- 禁止把生产指回 `d1-test`
- 禁止在无用户明示授权时改动 `/var/www/car-care`

---

## 5. 常见故障排查

> 原则：**先报告，不自动修。** 必要修复走独立 PR → 审查 → car-test 验收 → 明示授权后再动生产。

| 现象 | 建议排查（只读） |
|---|---|
| 生产页面异常 / 白屏 | 核对 tip `f3bb58a…`、bundle `index-Ddi6Z1jp.js`、sha256；对照 car-test |
| Gateway 4xx/5xx | 查 Worker `car-care-notion-sync` 版本 `m3d-prod-1.0.0`；确认测试 Worker 对生产 Origin 仍为 403 |
| 同步身份异常 | 核对 keyFp / wkFp；勿在文档或日志外泄完整密钥 |
| 邮件告警未到 | 查 timer 状态、pending 队列、SMTP 配置文件权限 `600`（勿打印密钥内容） |
| Outbox 积压 | 只读观察；**禁止**自动 CLAIM / DISCARD |
| Supabase 异常 | 烟雾项目健康可参考；**不改**正式 schema/数据/密钥 |

---

## 6. 已知风险与功能限制

### 6.1 RR-WK

生产 Gateway 的 `wkFp=c647ac0368ff` 与历史 **d1-test A** 使用相同 workspaceKey（指纹一致）。此为已知披露项 **RR-WK**，低维护期不主动轮换；任何轮换须独立审查与明示授权。

### 6.2 notionTargetGuard 切换流程（仅文档，默认不执行）

1. **保持默认 off**
2. 授权后在测试环境 / 设备切 **observe**，观察日志
3. 再经人工授权后切 **enforce**
4. **Legacy Outbox** 仅允许在设置页经二次确认后 **CLAIM**；禁止自动 CLAIM / DISCARD

### 6.3 其它限制

- 测试 Worker 不得含生产 Origin（已验证 403）
- 低维护期冻结新功能
- 不改正式 Supabase / Notion 用户数据 / IDB / Outbox

---

## 7. 低维护纪律

1. **冻结新功能** — 非必要不合并功能变更。
2. **先报告，不自动修** — 监控与巡检只读；发现问题先通知、再人工决策。
3. **必要修复流程**  
   独立 PR → 独立审查 → [car-test](https://car-test.adobesun.com) 验收 → **用户明示授权**后才可变更 [car.adobesun.com](https://car.adobesun.com)。
4. **数据与密钥边界**  
   不改正式 Supabase schema/数据/密钥；不改 Notion 用户数据；不改 IDB / Outbox；不自动 CLAIM；不开启 guard enforce（除非按 §6.2 逐步授权）。
5. **零静默部署** — 任何生产目录、Worker、监控配置变更均需明示授权。
6. **文档保密** — 不把 Token、API Key、SMTP 授权码、完整 workspaceKey UUID 写入仓库或本文件。

---

*文档版本：M3-D 低维护交接 · 对应生产 tip `f3bb58aceec53fea1c14f6959c3954259f6ff88d`*
