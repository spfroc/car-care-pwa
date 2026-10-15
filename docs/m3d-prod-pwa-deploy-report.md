# M3-D 生产 PWA 部署报告（car.adobesun.com）

> **结论：Go（已执行生产部署）**  
> **操作时间（CST）**：2026-10-15 17:24–17:27 Asia/Shanghai  
> **操作者**：Grok Bot（生产发布执行器）  
> **授权**：用户明示部署 `https://car.adobesun.com`  
> **检查表**：[`m3d-prod-pwa-release-checklist.md`](./m3d-prod-pwa-release-checklist.md) @ main `691113d1`  
> **本报告为真实部署记录，非 No-Go 假报告。**

---

## 0. 最终 Go / No-Go

| 项 | 结果 |
|----|------|
| 最终结论 | **Go** — 生产静态站已更新 |
| 回滚 | **未触发** |
| RR-WK | 选项 ② 已落地（PR #24 tip `f3bb58a` + Phase 2 E4 PASS / PR #25 merge `98a8390f`）；WK2=已落地，未要求 WK3 短句 |
| P6 授权 | 用户原文已命名 `https://car.adobesun.com` |

---

## 1. §2A 测试 Worker Origin 门禁（Z8/P9）— **PASS**

对 `Origin: https://car.adobesun.com` 探针（OPTIONS + GET）：

| Worker | ACAO 含 car.adobesun.com？ | 响应 | 结论 |
|--------|---------------------------|------|------|
| `car-care-notion-sync-d1-test` | **否**（无 ACAO） | 403 `Origin not allowed` | **PASS** |
| `car-care-notion-sync-d1-test-b` | **否**（无 ACAO） | 403 `Origin not allowed` | **PASS** |

证据：`artifacts/m3d-prod-pwa-deploy/probe-d1-test-*.txt`

---

## 2. 正式 Gateway 只读健康（P1/P2）— **PASS**（未改 Gateway）

| 检查 | 结果 |
|------|------|
| `GET /health` + Bearer | `{"ok":true,"version":"m3d-prod-1.0.0"}` |
| CORS `Origin: https://car.adobesun.com` | ACAO = `https://car.adobesun.com` |
| 无 / 错 Bearer → `/verify` | **401** `unauthorized` |
| keyFp | `aa819deb16dc`（与归档一致） |
| wkFp | `c647ac0368ff`（workspaceKey SHA-256 前 12；与归档一致） |
| `/verify` botName | `车护正式同步` |
| wrangler deploy / Secrets | **未执行** |

证据：`artifacts/m3d-prod-pwa-deploy/prod-gw-*.txt`（无 API Key 明文）

---

## 3. 构建门禁（P4/D1）— **PASS**

```text
checkout: f3bb58aceec53fea1c14f6959c3954259f6ff88d
（main@691113d1 相对该 tip 仅 docs #25/#26；src/ 无代码 diff → 优先用 Phase1 tip 构建）
npm test:  350 passed | 5 skipped (32 files passed | 3 skipped)
npx tsc -b: exit 0
npm run build: OK
```

| 字段 | 值 |
|------|-----|
| tip | `f3bb58aceec53fea1c14f6959c3954259f6ff88d` |
| bundle | `index-Ddi6Z1jp.js` |
| bundle sha256 | `5e94997a82fb7353d44849283e02e2fd89aff638d13e2c1f0674f870cc3f7563` |
| css | `index-DUfOadJ-.css` |
| stamp | `git=f3bb58aceec53fea1c14f6959c3954259f6ff88d bundle=index-Ddi6Z1jp.js target=car.adobesun.com approved_by_user=true` |

---

## 4. 备份（P5/D3）

| 字段 | 值 |
|------|-----|
| 路径 | `/var/www/car-care-backups/car-care-pre-m3d-prod-rrwk-20261015-112538.tar.gz` |
| tar sha256 | `43c581cef68b8e1cd32eb85a4a9863f8190ca0222ce95a22aeaeb2396b3930ab` |
| 文件名时钟 | Contabo 本机时区（≈ **2026-10-15 17:25 CST**） |
| 部署前基线 JS | `index-TdTLY2U-.js` |
| staging | **未动**（仍 `index-Ddi6Z1jp.js`） |

回滚命令见 `artifacts/m3d-prod-pwa-deploy/rollback.sh.txt`：

```bash
ssh -i /home/box/.ssh/contabo_vps root@161.97.138.206 \
  'tar -C /var/www -xzf /var/www/car-care-backups/car-care-pre-m3d-prod-rrwk-20261015-112538.tar.gz'
# 期望恢复: index-TdTLY2U-.js；禁止把生产指回 d1-test
```

---

## 5. 部署（D4/D5）— **成功**

- 同步目标：**仅** `/var/www/car-care` → `https://car.adobesun.com`
- **未**改 `/var/www/car-care-staging`
- `nginx -t`：syntax ok / test successful
- 部署后公网实读：

| 项 | 公网实读 |
|----|----------|
| HTML 脚本 | `assets/index-Ddi6Z1jp.js` |
| CSS | `assets/index-DUfOadJ-.css` |
| `/deploy-stamp.txt` | 与 §3 stamp **逐字一致** |
| 公网 JS sha256 | `5e94997a82fb7353d44849283e02e2fd89aff638d13e2c1f0674f870cc3f7563` |

---

## 6. 发布后冒烟（S1–S7）

| # | 结果 | 说明 |
|---|------|------|
| S1 | **PASS** | 公网脚本名 / stamp / sha256 与 §2B 一致 |
| S2 | **PASS** | `car-test.adobesun.com` 仍为 `index-Ddi6Z1jp.js`（既有 Phase1；本轮未改 staging） |
| S3 | **PASS** | 首页 / 设置可开（curl 200 + 临时 Playwright）；设置页展示「仅本机 / 自有 Supabase / 自有 Notion」互斥选项 |
| S4 | **PASS（未配置）** | 临时 context 无 Notion Gateway；未写入 Key/URL |
| S5 | **PASS（设计/未导出含 Bearer）** | 临时会话无配置；代码路径不持久化 Bearer |
| S6 | **PASS** | **未**写正式 Supabase；**未** clear IDB / Outbox |
| S7 | **跳过（可选）** | 未做离线写车后再同步（避免触碰正式数据面） |

证据：`artifacts/m3d-prod-pwa-deploy/smoke-*.json` / `s3-*.png` / `s1-public-fingerprint.txt`

---

## 7. 硬禁与声明（遵守）

| 声明 | 状态 |
|------|------|
| `notionTargetGuard` 代码默认 | **`off`**（`src/sync/notionTarget.ts`：`let guardMode = 'off'`；DEFAULT config 不含 enforce） |
| 生产 IDB 写入 enforce | **未做** |
| 自动 CLAIM Legacy Outbox | **未做** |
| 正式 Notion Gateway | **未** redeploy / **未**改 Secrets；保持 `m3d-prod-1.0.0` |
| 正式 Supabase | **未**改 schema / 数据 / 密钥 |
| 用户 IDB / Outbox | **未**清除 |
| car-test / staging | **未**改（只读核对） |
| 生产默认指回 d1-test | **禁止且未做** |

---

## 8. 产物索引

`artifacts/m3d-prod-pwa-deploy/`：

- `SUMMARY.txt` — 指纹总表  
- `probe-d1-test-*.txt` — §2A  
- `prod-gw-*.txt` — Gateway 只读（无 Key）  
- `dist-sha256.txt` / `s1-public-fingerprint.txt`  
- `rollback.sh.txt`  
- `smoke-*.json` / `s3-*.png`  
- `npm-test.log` / `npm-build.log`

---

## 9. 签署摘要

| 角色 | 结论 |
|------|------|
| 操作者（本执行器） | **Go**（已部署） |
| 用户授权 | 已明示 `https://car.adobesun.com`；RR-WK ② 已落地 |
| 带条件 | 无额外条件；guard 保持默认 off；未自动 CLAIM |
