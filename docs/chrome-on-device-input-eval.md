# Chrome 端侧文字 / 语音 → 自动记账 评估

面向车护助手 PWA（GitHub Pages，无后端）。结论基于公开文档与说明，非产品承诺。

**调研日期：** 2026-10-09

## 推荐结论

**建议：稍后（Later），不要现在做完整「语音/文字直接落库」。**

可接受的下一阶段 MVP（若排期宽松）：**语音 → 文本（Web Speech）→ 用户确认表单预填**，解析规则先用简单正则 / 关键词，不必依赖 Gemini Nano。

| 选项 | 建议 |
|---|---|
| 现在就做端侧 Prompt API 结构化记账 | **Skip / 再等**（设备覆盖差，中文结构化支持有限） |
| 语音转写 + 确认后写入表单 | **Later（MVP）** |
| 纯云端 ASR / LLM | **Skip**（与「无后端、隐私本地」产品约束冲突） |

## 1. Web Speech API（语音 → 文字）

### 能力（文档）

- 接口：`SpeechRecognition` / 前缀 `webkitSpeechRecognition`（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)、[Web Speech API](https://webaudio.github.io/web-speech-api/)）。
- **端侧识别：** `processLocally = true`，配合静态方法 `SpeechRecognition.available()` / `install()` 下载语言包（[on-device explainer](https://github.com/WebAudio/web-speech-api/blob/main/explainers/on-device-speech-recognition.md)、[MDN available](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static)）。
- Chrome 端侧语言列表示例含 **`zh-CN` / `zh-TW`**（explainer；实际是否可装取决于 UA / OS）。
- 默认 `processLocally = false` 时，UA 可走云端识别（需网络；音频离开设备）。

### 限制（与本 PWA 相关）

- **端侧模型目前主要面向桌面 Chrome**；Android Chrome 可能暴露 API 表面但 `available({ processLocally: true })` 返回 `unavailable`（社区 2026 实测与 MDN BCD：端侧能力曾标为桌面优先、Android 未齐）。
- 未安装语言包且强制 `processLocally` → `language-not-supported`。
- 需要 **麦克风权限**；在 insecure context / 部分内置 WebView 不可用。
- iOS Safari 行为与 Chrome 不同，不能假设同一套端侧 API。
- GitHub Pages **可以**纯前端调用；无后端要求。

### 隐私

- `processLocally: true`：目标是音频不离设备（仍受浏览器实现约束）。
- 云端回退：音频与转写可上传至识别服务 — 应在 UI 明示，并默认尝试端侧、失败再问用户是否允许云端。

## 2. Chrome 内置 AI（Gemini Nano / Prompt API 等）— 解析自然语言

来源：[Built-in AI APIs](https://developer.chrome.com/docs/ai/built-in-apis)、[Prompt API](https://developer.chrome.com/docs/ai/prompt-api)、[Summarizer](https://developer.chrome.com/docs/ai/summarizer-api)。

| API | Web 可用性（文档所述） | 对本需求 |
|---|---|---|
| Prompt API (`LanguageModel`) | Chrome **148** 起 Web；扩展更早 | 理想用于「口语 → JSON 记账字段」；支持 `responseConstraint` JSON Schema |
| Summarizer | Chrome **138** stable | 摘要为主，不适合直接结构化加油单 |
| Translator / Language Detector | 138+ | 次要 |

### 硬件与平台门槛（Prompt / Summarizer 等 foundation 模型）

文档要求大致包括：

- OS：Windows 10/11、macOS 13+、Linux、部分 Chromebook Plus；**Android / iOS Chrome 尚不支持**这些 foundation 模型 API。
- 存储：Chrome profile 卷约 **≥ 22 GB** 空闲等。
- GPU **> 4 GB VRAM**，或 CPU 路径 **≥ 16 GB RAM + ≥ 4 核**。
- 首次下载模型需非按量网络；之后可离线推理；文档称推理数据不发往 Google。

### 语言

Prompt API `expectedInputs` / `expectedOutputs` 文档列出的语言示例偏 **`en` / `ja` / `es` / `de` / `fr`**，并写明更多语言仍在推进。**不能把「中文口语稳定抽成加油/充电 JSON」当成已就绪事实。**

### 与 GitHub Pages

- 纯前端可调用；无后端。
- 但目标用户（手机记账）大量在 **Android Chrome**，与「仅桌面 foundation 模型」错位严重。

## 3. 对本 PWA 的可行性

| 维度 | 评估 |
|---|---|
| 隐私 | 端侧 Speech + 端侧 Nano 最契合产品叙事；云端 Speech 需明示 |
| 权限 | 麦克风；安装语言包 / 下载 Nano 需用户等待与磁盘 |
| 桌面 Chrome | Speech 端侧（含 zh-CN 列表）+ Prompt API 相对最可行 |
| Android Chrome | Speech 常只能云端或不可用端侧；**Prompt API 不可用** → 手机主场景弱 |
| 国产浏览器 / WebView | 基本不可依赖 |
| 实现复杂度 | 转写易、可靠结构化难；必须「预填 + 确认」 |

## 4. 建议 MVP（稍后）

1. 记录表单增加「语音输入」按钮（仅 Chromium 且 `SpeechRecognition` 存在时显示）。
2. `lang = 'zh-CN'`；先 `available({ langs:['zh-CN'], processLocally:true })`，可装则 `install`；`unavailable` 则提示仅云端或放弃。
3. 转写结果进入备注或临时文本框；用 **关键词规则** 尝试填：类型（加油/充电）、升数/度、金额、里程（例如「加了 40 升 320 块 里程 12345」）。
4. **绝不自动保存**：只预填表单，用户点保存。
5. 不在 MVP 引入 Prompt API；待 Android 支持或桌面用户占比明确后再评。

## 5. 风险摘要

- 手机端侧能力碎片化 → 功能「有的人能用、多数人不能」易造成差评。
- 云端 Speech 与「本地账本」定位冲突。
- Nano 中文结构化未文档化为稳定能力；JSON Schema 约束也不能保证字段正确。
- 误识别导致错误油耗区间（需低置信标记 / 确认）。

## 6. 实现草图（非现网代码）

```js
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) { /* hide button */ }
const rec = new SR();
rec.lang = 'zh-CN';
rec.processLocally = true; // if supported
// await SpeechRecognition.available / install …
rec.onresult = (e) => {
  const text = e.results[0][0].transcript;
  const draft = ruleParse(text); // { type, liters, kWh, amountPaid, odometer? }
  fillForm(draft); // user confirms
};
rec.start();
```

---

**一句话给用户：** Chrome 端侧语音转写（尤其桌面、中文语言包）值得以后做「说完再确认」；用浏览器内置 Gemini Nano 自动生成加油/充电记录目前对手机场景不成熟，建议先不做。
