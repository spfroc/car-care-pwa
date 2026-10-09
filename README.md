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

首次演示：**设置 → 载入演示数据**，首页会出现 ICE SUV / EV 轿车 / PHEV MPV 及补能记录。

## M1 已实现

- IndexedDB schema（vehicles / records / stations / settings / media / meta）与 repositories
- 车辆 CRUD、能源类型约束（ICE 仅加油；EV 仅充电；PHEV/REEV 两者；HEV 默认禁充电，可用 `hevAllowCharge` 开启）
- 记录：加油 / 充电 / 维保 / 改装 / 洗车 / 配件 / 罚单；图片 canvas JPEG 压缩
- 收藏加油站 / 充电站
- 设置：燃油标号、默认燃油、`kwhToLiterFactor`、油耗/电耗显示单位、OCR 四白名单（紫卡 + 重置 +「下次识别时生效」）、导入（默认合并去重 / 可选覆盖）、导出（含图体积警告 / 不含图）、演示种子、清空
- 首页花费矩阵 + 近况能耗；车辆时间线筛选；统计汇总卡 + 近月柱状；综合油耗折算
- Service Worker + manifest；`storage.persist` 尝试；IDB 不可用时非白屏错误页
- Vitest：油耗 / 电耗 / 加权平均 / 综合油耗

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

## Date/time display

Settings → 通用:
- `language` (zh-CN | en) — picker chrome (month/weekdays/Clear/Today/AM·PM)
- `dateFormat` (default `YYYY-MM-DD` / yyyy-mm-dd) — also `YYYY/MM/DD`, `DD/MM/YYYY`, `MM/DD/YYYY`
- `timeFormat` (default `24h`, or `12h`)

Native `datetime-local` is replaced by `DateTimeField` so format/locale follow app settings, not the browser locale.
