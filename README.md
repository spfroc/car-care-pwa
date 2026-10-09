# 车护助手（Car Care PWA）— M1

离线优先车辆养护账本。纯前端：Vite + React + TypeScript + IndexedDB（idb）+ PWA。

规格见上级目录：`../PRD.md`、`../data-model.md`。

## 运行

```bash
cd /workspace/car-care-pwa/app
npm install
npm run dev      # 开发服务器
npm run build    # 生产构建
npm run preview  # 预览构建产物
npm test         # 油耗/电耗/综合公式单测
```

浏览器打开终端提示的本地地址（如 `http://localhost:5173`）。建议用 Chromium 系移动端或桌面 DevTools 手机模式。

首次演示：**设置 → 载入演示数据**，首页会出现 ICE SUV / EV 轿车 / PHEV MPV / **HEV 轿车** 及加油·充电记录（HEV 默认仅加油）。

## M1 已实现

- IndexedDB schema（vehicles / records / stations / settings / media / meta / **learning**）与 repositories
- 车辆 CRUD、能源类型约束（ICE 仅加油；EV 仅充电；PHEV/REEV 两者；HEV 默认禁充电，可用 `hevAllowCharge` 开启）
- 记录：加油 / 充电 / 维保 / 改装 / 洗车 / 配件 / 罚单 / **停车费**（固定·临时）/ **高速通行费** / **保险**；图片 canvas JPEG 压缩
- 收藏加油站 / 充电站
- 设置：燃油标号、默认燃油、`kwhToLiterFactor`、油耗/电耗显示单位、OCR 四白名单（紫卡 + 重置 +「下次识别时生效」）、导入（默认合并去重 / 可选覆盖）、导出（含图体积警告 / 不含图）、演示种子、清空
- 首页花费矩阵 + 近况能耗；车辆时间线筛选（含停车/高速/保险）；统计汇总卡 + 近月柱状；综合油耗折算
- Service Worker + manifest；`storage.persist` 尝试；IDB 不可用时非白屏错误页
- Vitest：油耗 / 电耗 / 加权平均 / 综合油耗；能源门禁（ICE/EV/PHEV/HEV+开关）；充电 SOC 校验

## 已知缺口（相对 M2+）

- **无 OCR 识别流水线**（仅白名单配置；识别仅本地，无云 OCR）
- 统计趋势折线、长列表虚拟滚动、主题动画等体验项属 M3
- 能耗「显示单位」下的 km/L、km/kWh 仅存设置，界面计算仍按 L/100km 与 kWh/100km 数值展示单位后缀
- 收藏站无完整编辑表单（快速添加为主）
- iOS Safari 持久化配额需真机验证

## 冻结要点（用户确认）

1. OCR：本地/浏览器 only  
2. 导入默认 merge-dedupe  
3. HEV 默认禁充电 + `hevAllowCharge`  
4. 油耗/电耗单位默认 L/100km、kWh/100km  
5. 罚单仅金额+扣分，无驾驶证周期统计  




## 多能源路径人工验收清单

载入演示数据后，按能源类型点几下即可（无需真车）：

| 路径 | 操作 | 期望 |
|---|---|---|
| **EV** | 打开「城市纯电轿车」 | 详情有电耗、总充电量；无加油入口；时间线充电含 `SOC%→%`；统计有电耗区间 |
| **EV 录入** | + 新增记录 → 充电 | 表单有充电量、充电前/后电量(%)、站类型；非法 SOC（>100 或后<前）应报错 |
| **PHEV** | 打开「插混家用 MPV」 | 同时有油耗、电耗、综合；可新增加油与充电 |
| **HEV 默认** | 打开「油电混动轿车」 | 有油耗、总加油量；**无**充电入口 / 电耗 |
| **HEV 开充电** | 设置 → 勾选「HEV 允许录充电」→ 回 HEV 详情 | 出现充电入口与电耗位（演示种子仍无充电记录，可手录一条验证） |
| **ICE** | 「家用燃油 SUV」 | 仅加油路径；油耗区间非空 |
| **首页卡片** | 对照四车 | EV 不显示油费相关；HEV 默认不显示充电花费 |

单测：`npm test`（`energy.test.ts` 门禁 + `economy.test.ts` 多能源区间）。

## PWA 安装

- 首次访问若可安装：顶栏「安装到主屏幕」；`beforeinstallprompt` 可用时点「安装」。
- 安装成功或已以独立窗口打开：顶栏「已安装」提示。
- 设置页亦可展开安装说明。排障（主屏幕无图标、国产机快捷方式 vs WebAPK）见 [`docs/pwa-install.md`](docs/pwa-install.md)。
- Chrome 端侧语音/文字自动记账评估见 [`docs/chrome-on-device-input-eval.md`](docs/chrome-on-device-input-eval.md)。

## 车辆详情卡指标

详情页顶部卡片展示：

| 指标 | 含义 |
|---|---|
| **统计里程 / 行驶里程** | 右上角 `统计/行驶`。行驶里程 = 表显总里程（建档 `initialOdometer` 与各记录里程取最大）；统计里程 = 行驶里程 − 基线（基线优先用 `initialOdometer`，否则用最早一条含里程记录）。例：基线 100、当前 1100 → `1000/1100`。 |
| **加油花费** | 统计窗口内加油记录 `amountPaid` 之和：仅 `type=fuel` 且里程 **严格大于** 基线（与统计里程同一基线）。维保/保险等不计入详情卡；全量分类汇总仍在统计页与首页展开矩阵。 |
| **每公里成本** | 加油花费 ÷ 统计里程（统计里程 ≤ 0 时显示 —），保留 2 位小数。 |
| **油耗 / 电耗** | 首页卡片、详情卡、统计页共用距离加权平均（满箱区间法），展示统一 `toFixed(2)`；时间线单次区间用同一区间公式，亦 2 位小数。 |
| **总加油量 / 总充电量** | Σ 加油升数 / Σ 充电 kWh；按能源类型显示（ICE 仅油、EV 仅电、PHEV/REEV 可同时出现）。 |

### 公式摘要

- **区间油耗**（满箱法）：`(本次升数 / (本次里程 − 上次里程)) × 100`（L/100km）；电耗同理用 kWh。
- **平均油耗/电耗**：`Σ区间补能量 / Σ区间里程 × 100`（距离加权）。
- **加油花费 / 每公里成本**：`Σ(fuel.amountPaid where odometer > baseline)` / `统计里程`。

实现见 `src/lib/vehicleStats.ts`、`src/lib/economy.ts`。

## Date/time display

Settings → 通用:
- `language` (zh-CN | en) — picker chrome (month/weekdays/Clear/Today/AM·PM)
- `dateFormat` (default `YYYY-MM-DD` / yyyy-mm-dd) — also `YYYY/MM/DD`, `DD/MM/YYYY`, `MM/DD/YYYY`
- `timeFormat` (default `24h`, or `12h`)

Native `datetime-local` is replaced by `DateTimeField` so format/locale follow app settings, not the browser locale.


## 停车费、高速费与保险

新增两类花费记录（与维保/洗车等同属费用，计入总花费与统计）：

| 类型 | `type` | 要点 |
|---|---|---|
| 停车费 | `parking` | `parkingKind`: `fixed`（周期月租等，可选 `periodStart`/`periodEnd`、车场名）或 `temporary`（外出临停，可选时长分钟、地点） |
| 高速通行费 | `toll` | 可选 `route`（入口→出口 / 路段） |
| 保险 | `insurance` | 可选 `insurer`、`policyName`、保障/计费 `periodStart`/`periodEnd`；`date` 为缴费日 |

录入入口：车辆详情 →「+ 新增记录」。导出 `appSchemaVersion` 现为 **3**（含快捷记账本地学习）；旧版 `car-care-export-v1`（schema 1/2）仍可合并导入。

### 快捷记账本地学习

从首页「快捷」预填表单并**保存**后，本机 IndexedDB `learning` 会记住站点简称（如 中凯→收藏站）、车辆别名、以及「N块+优惠」按实付/应付的口径偏好。设置页有说明；识别不会自动保存记录；学习数据从不上传，导出/导入可备份。
