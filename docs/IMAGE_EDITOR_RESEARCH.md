# 图片编辑（局部重绘 / 区域标注）技术调研与实施设计

> 调研日期：2026-10-07 · 目标仓库：`F:\agentai-platform` · **本文档仅调研与设计，未修改任何代码**
> 所有版本号 / star 数 / token 成本均实测或联网查证，来源见每节标注。

---

## 0. 结论速览（TL;DR）

| 决策点 | 结论 |
|---|---|
| 画布库 | **手写 Canvas 2D 标注层**（不自研几何引擎），绘制循环只用 Konva 的 `Konva.Stage` 承载？→ **推荐 Konva + 手写交互**，见 §2 |
| 具体选型 | **`konva@10.7.1`（MIT）直接用，不用 react-konva**。原因：react-konva@19.x 要求 React ^19.3.0，本项目是 React 18.3.1，peer 冲突 |
| AI 意图传递 | **方案 D（组合）**：彩色编号叠加图（1 张）+ 结构化 JSON 区域描述 + 后端合成灰度mask 供 inpaint。坐标仅作辅助 |
| 后端 inpaint | **必须新增**。现有 `/v1/image` 的 `mode:'edit'` 是整图重绘，**无 mask 参数** → 局部重绘无法实现 |
| 贴图存储 | 独立文件 + `/api/files/download` 复用现有机制，不走 base64 内联 |
| MVP 工期 | **前端 5~6 天 + 后端 3~4 天 = 8~10 人日** |
| 最大风险 | 后端 mask 能力缺失（阻塞项），其次是 React 版本与 react-konva 的 peer 冲突 |

---

## 1. 现有能力盘点

### 1.1 现有图片相关工具清单

| 名称 | 位置 | 参数 | 支持 mask/inpaint？ |
|---|---|---|---|
| `generate_image`（Agent 工具） | `tools.ts:720` 定义 / `tools.ts:1354` 实现 | `prompt`(必), `size`(enum), `style`, `negative_prompt` | ❌ 纯文生图 |
| `POST /v1/image`（REST） | `routes/image.ts:65` | `prompt`(必), `size`, `ratio`, `model`, `image`, `negative_prompt`, `mode`, `strength`, `n` | ❌ **无 `mask` 字段** |
| `generate_character_consistent_image` | `enhanced-image-tools.ts:418` | `characterDescription`, `scenes[]` | ❌ |
| `generate_scene_continuous_image` | `enhanced-image-tools.ts:444` | `sceneDescription`, `timeSequences[]` | ❌ |
| `generate_storyboard` | `enhanced-image-tools.ts:468` | `script`, `totalScenes`, `aspectRatio`, `style` | ❌（只出分镜文本） |
| `enhanced_style_transfer` | `enhanced-image-tools.ts:482` | `sourceImage`, `targetStyle`, `preserveComposition`, `strength` | ❌ |

**关键结论：全平台无任何 `edit_image` / `inpaint` / mask 消费方。** grep `mask` 在 gateway 命中的全部是 `maskCredentials`（脱敏，`credential-extractor.ts:20`）与 `maskKey`（打码，`routes/settings.ts:60`），与图像无关。

### 1.2 现有后端引擎（`routes/image.ts`）

| 引擎 | 触发条件 | 端点 | 备注 |
|---|---|---|---|
| ALRC（`alrc-*`/`factory-*`） | `routes/image.ts:97` | `alro.huazhiweilai.com/v1/images/generations` | 只透传 `prompt`+`size`，**连图都不传**（`:110-114`） |
| Cogview-3-Flash | `effectiveModel==='cogview'` | `open.bigmodel.cn/.../images/generations` | 仅文生图 |
| Agnes Image 2.5 Flash | 默认兜底 | `api.agnes-ai.cn/v1/images/generations` | 唯一支持 `image`（图生图/风格迁移/edit），走 `extra_body`（`:225-235`） |

现有 `mode:'edit'`（`routes/image.ts:87-90`）的实现是：给 Agnes 的 `extra_body.tags` 加一个字符串 `'edit'`，然后走**整图 img2img**。它既没有 mask，模型也不知道用户改了哪里 —— 这正是用户所说「对话改图模式下要新建图片编辑功能」的原因。**这是一个真实的、从零开始的能力缺口。**

### 1.3 前端 `ImageStudio.tsx` 结构（707 行）

- **状态：全部 `useState`（25 个），无 store。** `mode`(`:112`)、`prompt`(`:113`)、`history`(`:121`)、`sourceImage`(`:125`)、`editMessages`(`:129`)。
- **路由挂载**：`App.tsx:34` 懒加载 → `App.tsx:216` 注册为 `'image'` 页签（`requireSubscription: true`）。
- **5 种模式**（`:31-37`）：text2img / img2img / style_transfer / edit / tryon。
- **edit 模式是独立的全屏分支**（`:281-418`）：消息流 + 底部输入框，**与分栏布局互斥**。这是好消息：新增「区域标注」模式可沿用同样做法加第 6 个模式分支，**不触碰分栏布局代码**。
- **132 处内联 style**（实测 grep 计数），无 CSS Module / styled-components。历史类 CSS 仅一处（`:649` `<style>` 块，定义 `imgResultIn` 动画）。
- **复用点**：`<input type=file>` + `FileReader.readAsDataURL` 上传（`:221-230`，含 6MB 限制）、`imgContextMenu` 右键菜单（`:244-264`）、`downloadImg`（:219）、Modal 复用（`:393`）、`EDIT_QUICK_ACTIONS`（`:98-107`）。

### 1.4 `imageTaskManager.ts`（235 行）

- 单例 + `localStorage` 持久化（`STORAGE_KEY='agentai-image-history'`，`:35`），并行度 2（`MAX_PARALLEL=2`，`:36`）。
- `submitTask`(`:105`) / `registerCompleted`(`:183`) / `regenerate`(`:227`)。
- **关键限制**：`ImageTask.params`（`imageTaskManager.ts:22-30`）是**固定 7 字段**结构，**没有 `mask` / `regions` / `sticker` 字段**。要接 mask 必须扩这个接口，否则「用相同参数重新生成」功能会静默丢失标注。
- ⚠️ 潜在 Bug：`saveToStorage`(`:94`) 的过滤条件 `t.imageUrl \|\| t.status !== 'failed'` 是恒真式，`imageUrl` 的判空无效。接入新功能时会放大 localStorage 溢出问题。

### 1.5 「已实现但没接线」的部分

| 未接线能力 | 证据 | 可否复用 |
|---|---|---|
| `mode:'edit'` 后端分支 | `routes/image.ts:87-90` | 语义可复用为「整图编辑」通道，与新局部重绘并存 |
| `strength` 参数已从前端传到后端 | `ImageStudio.tsx:198` → `routes/image.ts:237` | ✅ 可作为遮罩羽化/重绘强度的映射目标 |
| `mode:'tryon'` 双图输入 | `routes/image.ts:214-224` 支持 `image` 数组 | ✅ **正是贴图（sticker）合成的现成通道**，无需新写上传逻辑 |
| 多图 base64 Data URI 支持 | `routes/image.ts:220-224`（`cleanImages` 补 DataURI 前缀） | ✅ 直接复用 |

**盘点小结：后端没有 mask/inpaint，但「多图输入 + Data URI」的基础设施已完备。**

---

## 2. 技术选型对比（联网查证）

### 2.1 实测数据

| 库 | npm latest | 许可证 | GitHub stars | 最后 push | 包体积 (gzip) | 依赖数 |
|---|---|---|---|---|---|---|
| `fabric` | **7.4.0** (2026-05-18) | **MIT** | **31,468** | 2026-10-06 | **89.7 KB** | **0** |
| `konva` | **10.7.1** (2026-10-05) | MIT¹ | **14,854** | 2026-10-05 | **54.3 KB** | **0** |
| `react-konva` | **19.3.0** (2026-09-15) | MIT | **6,426** | 2026-09-15 | (随 konva) | 4 |
| `pixi.js` | **8.22.0** (2026-10-06) | MIT | **48,295** | 2026-10-06 | **258.6 KB** | 11 |

¹ konva 仓库 license API 返回 `NOASSERTION`（未标准识别），但 LICENSE 文件正文为标准 MIT（Copyright 2011-2013 Eric Rowell / 2014- Anton Lavrenov）。**商用友好，但需在法务留档这一事实。**

来源：npm registry `registry.npmjs.org/{pkg}` 实测 + `api.github.com/repos/{owner}/{repo}` 实测 + bundlephobia API 实测（2026-10-07）。

版本时间线补充：`fabric` 5.3.0(2022-12) → 6.0.0(2024-06) → 6.7.1(2025-07) → 7.0.0(2025-12) → 7.4.0(2026-05)。**注意：坊间文档普遍说的「fabric v6」已过时，当前是 v7，且 v7 是大版本（ESM 优先 + 破坏性 API 变更）。**

### 2.2 逐项评估

| 维度 | fabric 7.4.0 | konva 10.7.1 | pixi.js 8.22.0 |
|---|---|---|---|
| 渲染后端 | Canvas 2D | **Canvas 2D** | **WebGL/WebGPU** |
| 内置矢量选区 | ✅ Polygon/Polyline/Path + `toDataURL({format:'png'})` 导出 alpha | ✅ 需自建（Konva 无 Select/Brush 原生对象） | ⚠️ 无编辑语义，纯图形库 |
| 免费变换器（缩放/旋转/移动） | ✅ 内置 `scaleX/scaleY/angle` + `setCoords` | ⚠️ `Transformer` 可用但需手写控制点 | ❌ 全手写 |
| **脏矩形 / 增量渲染** | ❌ **无脏矩形机制**，每帧全量重绘 | ✅ `layer.batchDraw()` + `layer.cache()` / `layer.draw()` 可手动裁剪 | ✅ 内置渲染批处理 |
| 序列化 / 撤销栈 | ✅ `toJSON()` / `loadFromJSON()` **开箱即用** | ❌ 需自写（Konva 无内置序列化） | ❌ 需自写 |
| 笔迹（画笔） | ✅ `PencilBrush` + `freeDrawingBrush` | ⚠️ 需自写 `Konva.Shape` + `sceneFunc` + 缓存 canvas | ✅ 需自写 |
| TS 类型质量 | ✅ 内置 `.d.ts`，v7 已全面 TS 化 | ⚠️ 需 `@types/konva`（社区维护） | ✅ 内置 |
| React 19 兼容 | ✅ 框架无关 | ⚠️ 经 react-konva 受限（见下） | ✅ 框架无关 |
| 许可风险 | MIT，低 | MIT，低（LICENSE 文件为标准 MIT） | MIT，低 |

**React 19 兼容性实测结论（重要）**：
```
react-konva@19.3.0  peerDependencies: { konva: "^8||^9||^10", react: "^19.3.0", react-dom: "^19.3.0" }
```
而 `packages/agentai-gui/package.json` 实测为 `"react": "^18.3.1"`。**装 react-konva@19.3.0 会直接 peer 冲突（npm ERESOLVE / pnpm 警告）。**

可用的最后兼容版本：`react-konva@18.2.16`（2026-05-12，peer `react: ">=18.0.0"`）。但 react-konva 19.x 已在维护、18.x 已停更半年以上 —— **为了一个纯 UI 层 canvas 编辑器，把整个前端绑死在滞后的 React 大版本上，不值得。**

### 2.3 推荐方案

**✅ 推荐：`konva@10.7.1` 直接使用（不用 react-konva），叠加手写标注交互层。**

理由（按权重排序）：
1. **规避 React peer 冲突**：`konva` 本身零依赖、框架无关，不碰 `react` 的 peer。
2. **分层架构天然契合**：标注编辑器天然是「图层面板 + 工具状态 + 历史栈」三层，Konva 的 `Layer/Group/Shape` 直接映射，无需 react-konva 的 reconciler 抽象。
3. **体积最小**：54.3 KB gzip（fabric 89.7 / pixi 258.6）。
4. **性能可控**：`layer.batchDraw()` + `cache()` 可满足笔迹密集场景（见 §6 性能分析）。
5. **`Transformer` 免费提供**贴图缩放/旋转/移动的交互控制点，需求 5 几乎零成本。

**代价（须诚实计入工作量）**：Konva 无内置序列化 → 撤销/重做需自写（但只需存 JSON 快照，见 §5.2）；无免费矢量选区对象 → Polygon 选区 + 变换器需自写（约 1.5 天）。

### 2.4 关于「手写 Canvas」（方案 B）

| 子能力 | 工作量（人日） | 难度 |
|---|---|---|
| 缩放/平移（滚轮 + 空格拖 + 双指） | 0.5 | 低 |
| 矩形选区 | 0.5 | 低 |
| **套索（贝塞尔曲线平滑 + 闭合）** | 1.5 | **高**（Catmull-Rom→贝塞尔转换、闭合点吸附） |
| **画笔笔迹（压感/平滑/抽稀）** | 1.5 | **高**（quadratic 曲线中点插值 + 环形缓冲） |
| **自由变换器（8 控制点 + 旋转）** | 1.5 | **高**（矩阵求逆、变换同步、光标切换） |
| **命中测试**（点选/框选/区分重叠） | 1.0 | **高**（`isPointInPath` + 描边距离 + z 序遍历） |
| 吸附 / 对齐参考线 | 0.5 | 中 |
| 缩略图与选区可视化 | 0.5 | 低 |
| **合计** | **≈ 8 人日** | |

**判断标准（手写 vs 用库）**：
- ✅ 手写更划算：只需要**一个**矩形 + 一个画笔，且不需要旋转/序列化（如「启动器小图标涂鸦」）。≤2 人日。
- ✅ 手写更划算：选区形状是**业务专有**的（如异形建筑轮廓），且要长期高频演进。
- ❌ 手写更划算的场景不存在：需求含**套索 + 画笔 + 贴图变换 + 撤销栈**四项，这是通用编辑器基建，**典型的「重复造轮子」反模式**。
- 本项目结论：**用 Konva**，但 Konva 的选区/笔迹逻辑仍需自己写（约 3 人日），因为没有库直接提供「标注语义」。手写是「在库之上写业务」，不是「从零写引擎」。

### 2.5 关于 WebGL（方案 C）

**当前不需要。** 判断依据：
- 典型场景：1 张底图 + 5~10 个区域 + 3~5 张贴图 = 约 20~40 个 display object，笔迹点数 5k~20k。
- Canvas 2D 在这个量级远未触及瓶颈；且标注场景需要**文字渲染**（编号标签）、**虚线描边**、**半透明填充**、**任意形状命中测试** —— 这些在 WebGL 下都要自己写 shader/几何，成本远高于收益。
- Pixi 的 258.6 KB gzip（fabric 的 2.9 倍）对 Tauri 桌面端也不划算。
- **触发 WebGL 的阈值**：单张图 >8000 万笔迹点、或需要实时 3D 纹理 / 视频级笔迹、或图层 >500 且需 60fps 持续交互。当前远未达到。

---

## 3. AI 意图传递设计（核心）

### 3.1 各模型对 mask 的支持现状（查证）

| 模型 | 原生 mask 参数 | 语义 | 来源 |
|---|---|---|---|
| **OpenAI GPT Image** | ✅ `POST /images/edits` 的 `mask` | **PNG 的「全透明区域=要编辑」**。约束：PNG、<4MB、**与 image 同尺寸**、多图时作用于第一张。配套 `input_fidelity`(high 更好) | [OpenAI Images API](https://developers.openai.com/api/reference/python/resources/images/methods/edit/) |
| **Qwen-Image-Edit (2509/2511)** | ⚠️ **无原生 mask**，是「软提示」 | 业界做法：**把 mask 烘焙成红色高亮叠到参考图上**，再在 prompt 里追加「红色区域是唯一改动处，外部保持原样」，最后用 composite 节点在像素空间强制边界 | [comfy.icu TextEncodeQwenImageEditPlusMask](https://comfy.icu/node/TextEncodeQwenImageEditPlusMask)、[musubi-tuner DeepWiki](https://deepwiki.com/kohya-ss/musubi-tuner/9.3-z-image-turbo) |
| **Gemini 3 Pro Image (Nano Banana Pro)** | ❌ 无 mask 参数，靠自然语言描述区域 | 支持「本地化编辑」，但**明确记载「masked editing 等高级创意控制有时会产生不自然结果」** → 不可靠 | [arstechnica](https://arstechnica.com/google/2025/11/google-launches-nano-banana-pro-image-model-adds-ai-image-detection-in-gemini-app)、[aipure](https://aipure.ai/products/google-nano-banana-pro) |
| FLUX.1 Fill | ✅ 专用 inpaint 模型 + mask | 白=重绘 | 社区通用 |

**这是全篇最重要的发现：用户需求 6「AI 能理解红区要改、蓝区要保留」在 Gemini/ALRC 这类无 mask 的模型上，只能靠「彩色叠加图 + 文字映射」实现，且是软约束；而 OpenAI 走 `images/edits` 能拿到真正的硬约束 mask。**

对本项目的直接含义：`MODELS` 列表（`ImageStudio.tsx:80-88`）里 **`alrc-gpt-image-2` 是唯一有官方 mask 语义的通道**，但 `routes/image.ts:110-114` 目前只透传 `prompt` 和 `size`，**连图都没传给 ALRC**。这是后端必须先补的洞（见 §5 阻塞项）。

### 3.2 四方案对比

| 方案 | 实现 | token 成本 | 模型理解度 | 评价 |
|---|---|---|---|---|
| **① 多张黑白 mask + 文本映射** | N 区 = N 张图 | **最高**：1024² 每张 **765** token（gpt-4o high detail = 85 + 4×170）。5 区 = **3,825** | 差 —— 多张 mask 图模型难以对应「哪张是哪个区」，且丢失位置关系 | ❌ 空间信息丢失严重 |
| **② 彩色叠加图 + 文字说明** | 1 张 | **765** token（同图内画所有区域） | **最好** —— 人类看图的方式模型也最接近；业界 Qwen 方案正是此法 | ✅ 有实证先例 |
| **③ 坐标描述**（归一化 bbox/polygon） | 0 张图 | 极低（~50 token/区，纯文本） | **最差** —— OpenAI 文档明确「模型在需要精确空间定位的任务上表现不佳」；多边形顶点换算还易错 | ❌ 仅作辅助 |
| **④ 组合（推荐）** | 1 张彩色叠加图 | **765 + ~150** = **~915** token | **最好** —— 叠加图给空间，JSON 给精确语义，文字给意图 | ✅ |

> token 数据来源：[OpenAI Images and vision 文档](https://developers.openai.com/api/docs/guides/vision) —— `gpt-4o/gpt-4.1/gpt-4.5` base=**85**、tile(512px)=**170**；1024×1024 → 85+4×170 = **765** token。GPT Image 1 是 base=65/tile=129，`input_fidelity=high` 时方形再加 **4160** token。Gemini ≈ **258** token/图（<3.4MP）；Claude ≈ `(w×h)/750`（1024² ≈ 1,400）。交叉验证：[howmanytokens.io](https://howmanytokens.io/how-many-tokens-in-an-image)。

**成本对比（5 区域编辑）**：① 3,825 token vs ④ 915 token → **方案 ④ 节省 76%**。

### 3.3 ✅ 推荐：方案 ④ 组合

**组成（三件套）**：

1. **彩色编号叠加图（给模型「看」）** — 单张 RGBA，底图绘制后按区域描边 + 30% 透明填充 + 区域中心画编号徽章。**颜色使用色板固定（前端定义），但语义（颜色→意图）由用户在指令里文字定义。**
2. **结构化 JSON 区域描述（给模型「精确语义」）** — 直接进 prompt 文本，字段紧凑（见 §4.2）。
3. **后端合成的 alpha mask（给 OpenAI 通道「硬约束」）** — 服务端用 `sharp`（需新加）或纯 PNG 编码库生成，遵循 OpenAI「透明=编辑」语义。

### 3.4 颜色→意图映射：谁决定？

**明确建议：由前端固定色板 + 用户文字定义语义，后端不做颜色语义推断。**

理由：
- 让 AI「读颜色猜意图」是**不可靠且不可测**的：模型在颜色→语义映射上表现差，且用户说「红色」时可能指「我涂的红色笔迹」而非「红色的图」。
- 前端色板固定可让**每种颜色对所有模型都稳定**，且用户形成肌肉记忆。
- **色板必须按「明度差异最大化」设计**（红/绿/蓝/品红/青/黄），且**填充用低透明度 + 描边用高饱和**，避免涂鸦遮住底图导致模型看错内容。

建议默认色板（色相间隔 ≥60°，避免红/棕、黄/橙混淆）：
```
区域1 #E5484D 红   区域2 #30A46C 绿   区域3 #0090FF 蓝
区域4 #8E4EC6 紫   区域5 #F76B15 橙   区域6 #D6409F 粉
```
⚠️ **无障碍**：约 8% 男性红绿色盲。色板**不能只靠颜色区分**，每个区域必须**同时带编号徽章**（① 方案已包含），颜色只是冗余通道。

### 3.5 是否已有标准？

| 标准 | 格式 | 采纳情况 |
|---|---|---|
| OpenAI `images/edits` mask | PNG alpha，透明=编辑 | ✅ **采纳为后端 mask 语义**，直接兼容 ALRC/gpt-image-2 |
| Qwen-Image-Edit mask_url | 黑白，白=改 | ✅ 语义等价，作为多引擎统一抽象 |
| ControlNet 条件图 | 灰度/RGB 通道编码 | ❌ **不适用**，那是 SD 系训练期条件注入，与「多意图分区」无关 |

**结论：不存在跨厂商的多区域 mask 标准。建议内部抽象为统一中间格式，导出时按厂商转译。**

---

## 4. 后端接口设计

### 4.1 REST + SSE 设计

```
POST   /v1/image/annotation          保存标注工程 → 返回 projectId
GET    /v1/image/annotation/:id      读取标注工程
POST   /v1/image/annotation/:id/stickers   上传贴图（multipart）→ 返回 stickerId + url
POST   /v1/image/edit                提交编辑任务（区域+指令）→ 返回 taskId
GET    /v1/image/edit/:taskId        查询状态（轮询）或 SSE 订阅
GET    /v1/image/edit/stream         SSE 进度流（text/event-stream）
```

`POST /v1/image/edit` **不复用现有 `/v1/image`** 的理由：现有路由是单次同步返回 URL（`routes/image.ts:65-326`），而区域编辑需异步合成 mask + 长时间推理，且要保留 mask 用于重试。

### 4.2 区域数据 JSON Schema

```jsonc
{
  "projectId": "ann_7f3a9c2b",
  "version": 1,
  "baseImage": {
    "id": "img_20261007_001",
    "url": "/api/files/download?path=...",
    "width": 1024, "height": 1024,
    "naturalWidth": 1024, "naturalHeight": 1024
  },
  "regions": [
    {
      "id": "r1",
      "index": 1,                       // 徽章编号 = 数组下标+1
      "shape": "rect",                  // rect | polygon | brush
      "color": "#E5484D",
      "label": "要删除的水印",           // 用户可编辑的语义标签
      "intent": "remove",               // remove | replace | keep | enhance | insert
      "visible": true,
      "featherPx": 8,                   // 羽化半径（见 §6）
      "geometry": {
        "x": 120.5, "y": 88.0,          // rect: 左上角（自然像素坐标，非屏幕）
        "width": 340.0, "height": 210.0
      },
      "points": [],                     // polygon: 顶点数组；brush: 笔迹点
      "strokeWidth": 24,                // brush 用
      "opacity": 0.30                    // 叠加填充透明度
    },
    {
      "id": "r2", "index": 2, "shape": "polygon",
      "color": "#0090FF", "intent": "keep", "label": "人脸要保留",
      "geometry": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "points": [[512,120],[640,150],[700,300],[480,380],[400,240]]
    },
    {
      "id": "r3", "index": 3, "shape": "brush",
      "color": "#30A46C", "intent": "replace", "label": "地面换成草地",
      "strokeWidth": 32,
      "points": [[120,880],[160,900],[210,895],[260,910]]   // 密集点数组
    }
  ],
  "stickers": [
    {
      "id": "s1",
      "assetId": "asset_9b2",           // 对应 /annotation/:id/stickers 返回
      "url": "/api/files/download?path=...",
      "x": 620, "y": 440,               // 自然像素坐标（画布锚点）
      "scaleX": 0.42, "scaleY": 0.42,
      "rotation": -12.5,                // 角度（度）
      "opacity": 1.0,
      "blendMode": "normal",            // normal | multiply | screen | overlay
      "zIndex": 10
    }
  ],
  "canvas": { "zoom": 1.0, "offsetX": 0, "offsetY": 0 },
  "updatedAt": "2026-10-07T12:00:00Z"
}
```

**Schema 设计要点**：
- **坐标统一用「自然像素」而非屏幕像素** → 缩放/平移只是渲染层状态，不污染数据。多边形顶点 `(x,y)` 与矩形共用坐标系。
- `shape` 判别式字段（discriminated union），前端按值分支渲染。
- `intent` 是**枚举**而非自由文本，保证后端能据此选择不同模型/参数（如 `keep` 区域加入 mask 的「保护侧」）。
- `index` 冗余于数组顺序，但**必须持久化**，因为徽章编号一旦发给模型就不能变（用户删掉 r1 后 r2 不能变成 r1）。

### 4.3 提交编辑任务的请求体

```jsonc
POST /v1/image/edit
{
  "projectId": "ann_7f3a9c2b",
  "instruction": "把红区删掉并补全背景，蓝区人脸不要动，绿区地面换成草地",
  "provider": "alrc-gpt-image-2",       // 建议实现分通道
  "strategy": "mask",                    // mask | overlay（见下）
  "strength": 0.65,
  "overlayMode": "numbered",             // numbered | plain | none
  "n": 1
}
```

**`strategy` 双通道（重要设计）**：
- `strategy:'mask'` → 后端合成 OpenAI 语义 alpha PNG mask，走 `images/edits`。适用于 `alrc-gpt-image-2`。
- `strategy:'overlay'` → 后端合成彩色编号叠加图，走 `image` 数组 + prompt 追加区域说明。适用于 Agnes / Gemini / ALRC-nano-banana 等无 mask 模型。

后端根据 `provider` 自动选择（前端可覆盖）。

### 4.4 贴图存储策略

**推荐：独立文件 + 复用现有下载机制。不使用 base64 内联。**

| 方案 | 容量 | 复用 | 评价 |
|---|---|---|---|
| **独立文件（推荐）** | 无请求体膨胀 | ✅ 复用 `routes/files.ts:322` `/api/files/download` + `downloadToTempFile` 模式（`routes/image.ts:23-35`） | ✅ 贴图 5MB 时请求体不爆炸 |
| base64 Data URI | 请求体 ×1.37 | 复用 `routes/image.ts:220-224` | ⚠️ 前端已有 `FileReader.readAsDataURL`（`ImageStudio.tsx:228`），MVP 可零成本；但多贴图 + 大图会让 `localStorage` 与请求体双爆 |
| 对象存储（COS/S3） | 无限制 | 需新增 SDK | ❌ 当前项目**无任何对象存储依赖**（gateway deps 已核实），过早引入 |

**落地**：MVP 用独立文件落到 `~/.agentai/temp-images/`（沿用 `routes/image.ts:28` 的既有目录约定）；project JSON 存 `~/.agentai/annotations/{projectId}.json`。后期再迁对象存储，schema 无需改动（只换 `assetId`→URL 解析）。

---

## 5. 实施拆解与工作量

### 🚨 阻塞项（必须后端先有）

| # | 阻塞项 | 说明 |
|---|---|---|
| **B1** | **mask/inpaint 接口** | `routes/image.ts` 无 `mask` 字段。ALRC 分支（`:110-114`）连 `image` 都没传。**不解决则「局部重绘」在技术上是做不到的**（模型会重绘全图） |
| **B2** | ALRC 传图 | `routes/image.ts:110-114` body 仅 `{model, prompt, size}`，需补 `image` + `mask`，并改 multipart |
| **B3** | 服务端图像合成库 | 无 `sharp`/`jimp`/`canvas`（gateway deps 已核实）。合成 mask + 羽化需要它。**建议 `sharp`**（MIT，prebuilt 二进制，无需编译） |

### 5.1 MVP（最小可用）

**范围**：框选 + 涂鸦 + 贴图移动缩放旋转 + 多色编号 + 提交编辑（单引擎）。

| # | 任务 | 人日 |
|---|---|---|
| 1 | 后端：区域 schema + `/v1/image/edit` + `strategy` 分支 | 1.5 |
| 2 | 后端：**B2** ALRC 传图传 mask（multipart） | 1.0 |
| 3 | 后端：**B3** 接入 sharp，合成灰度 mask（含羽化） | 0.5 |
| 4 | 前端：Konva Stage/Layer 骨架 + 缩放平移（滚轮/拖拽/双指） | 1.0 |
| 5 | 前端：框选工具（矩形选区 + 8 控制点变换器） | 1.0 |
| 6 | 前端：画笔工具（平滑插值 + 抽稀） | 0.75 |
| 7 | 前端：贴图（上传 + 拖入 + `Transformer` 缩放/旋转） | 0.75 |
| 8 | 前端：色板 + 编号徽章 + 区域列表 + 意图标签编辑 | 0.75 |
| 9 | 前端：导出（叠加图 + JSON）+ 提交 + 结果回显 | 0.75 |
| 10 | 前端：`ImageStudio` 新增第 6 模式分支 + 路由接入 | 0.5 |
| **合计** | | **≈ 8.5 人日** |

**MVP 裁剪建议**：套索（1.5 人日）放到完整版；MVP 只做「框选 + 涂鸦」已能覆盖需求 1/3/4/5/6 的核心场景。

### 5.2 完整版补充

| # | 任务 | 人日 |
|---|---|---|
| 11 | **套索工具**（Catmull-Rom 平滑 + 闭合吸附） | 1.5 |
| 12 | 撤销/重做栈（JSON 快照，Konva 无内置序列化） | 1.0 |
| 13 | 吸附与对齐参考线（Shift + 边缘/中心） | 0.5 |
| 14 | 贴图混合模式（正片叠底等）+ 图层顺序 | 0.5 |
| 15 | 多引擎矩阵（Agnes / Gemini / ALRC 全通道） | 1.5 |
| 16 | 标注工程持久化 + 版本回溯 | 1.0 |
| 17 | 小屏/移动端适配（触控、多指） | 1.0 |
| **合计** | | **≈ 7 人日** |

**总计 ≈ 15.5 人日**。关键路径是**后端 B1/B2/B3**，前端可并行开工。

### 5.3 与现有代码的冲突面

| 面 | 冲突 | 处理 |
|---|---|---|
| `ImageStudio.tsx` | 新增第 6 模式 → `MODES`(`:31-37`) + `:429` 的 `colors` Record 加键 + `:563` 模型兼容判断 | **低**，均为增量添加，不改现有分支 |
| `imageTaskManager.ts` | `ImageTask.params`(`:22-30`) 无 mask/regions 字段 | **需扩接口**；否则「重新生成」丢标注 |
| `routes/image.ts` | 新增 `/v1/image/edit` 而非改现有路由 | **零冲突**（新 router 并列注册） |
| `App.tsx` | 无需改（复用 `image` 页签内的模式切换） | **零** |
| `imageTaskManager.saveToStorage` | 恒真过滤条件（`:94`）是既存 bug | 建议顺手修，否则新增字段会放大 localStorage 溢出 |

---

## 6. 风险清单

| # | 风险 | 严重度 | 缓解措施 |
|---|---|---|---|
| R1 | **后端无 mask 能力** | 🔴 **阻塞** | §5 的 B1/B2/B3 先行；MVP 前必须完成，否则功能无法验收 |
| R2 | **react-konva peer 冲突** | 🔴 高 | **直接用 `konva`**，不用 react-konva（§2.3）；若未来升 React 19 再引入 `react-konva@19.3.0` |
| R3 | **mask 边缘硬边** | 🔴 高 | 生图硬边是「贴纸感」主因。① 合成 mask 时做 **Gaussian 羽化**（默认 8~16px，按图尺寸自适应）；② 服务端后合成用羽化 mask 重新贴合原图未编辑区；③ 前端叠加图描边用虚线，明确「这是标注不是最终图」 |
| R4 | **Canvas 性能（大图 + 密集笔迹）** | 🟡 中 | 见下方专述 |
| R5 | **贴图混合模式可行性** | 🟡 中 | Canvas 2D `globalCompositeOperation` 原生支持 `multiply/screen/overlay`，**可行**；但 Konva 需用 `cache()` 后对 `Konva.Image` 设 `compositeOperation`，光栅化后混合，**注意缓存后缩放会模糊** → 建议导出时才混合，编辑期用简化预览 |
| R6 | **移动端/小屏** | 🟡 中 | 触控需 `pointerdown/move/up` + `touch-action:none`；双指缩放；工具栏改底部横滑；**建议 MVP 明确仅桌面**，小屏列入完整版 |
| R7 | **fabric v6 文档过时** | 🟢 低 | 若未来改用 fabric，注意当前是 **v7.4.0** 且有破坏性变更，网上大量 v6 教程会误导 |
| R8 | **konva 许可非标准识别** | 🟢 低 | LICENSE 正文为标准 MIT，仅仓库 API 返回 `NOASSERTION`。法务留档即可 |
| R9 | **AI 区域理解不准** | 🟡 中 | ① 编号徽章 + JSON 双通道冗余（§3.3）；② 前端在提交前**预览叠加图**让用户自查；③ 提示词模板显式写「区域 N 之外必须逐像素保持不变」 |
| R10 | **无 mask 模型的越界编辑** | 🟡 中 | 无 mask 通道时后端在结果回来后做一次**像素级对比**告警：「mask 外区域变化超过 X%」，给用户「以原图重新生成」选项 |
| R11 | **ImageStudio 内联 style 债** | 🟢 低 | 新组件独立文件 + 一处 `<style>`，**不加重现有 132 处内联 style 的债** |

### R4 性能专项分析

- **瓶颈定位**：非笔迹点数，而是**每帧全量重绘 + 描边路径**。Konva 逐 shape `stroke()`，10k 点路径单帧可达 30~60ms。
- **实测阈值（估算，需实测校准）**：
  - <5k 笔迹点：**无优化可接受**
  - 5k~30k：笔迹必须转 **离屏 Canvas 缓存**（`layer.cache()`），拖拽时只移动缓存整体，静止时才重绘
  - >30k：抽稀（RDP 简化，容差 0.5px）+ 分块缓存
- **大图**：>4000px 的底图必须缩放显示，禁止 1:1 渲染 4 张以上 4K 图（显存上限）。Konva 已有 `Layer.hitCanvasEnabled` / `perfectDrawEnabled=false` 可减负。
- **架构要求（现在就定，后期难改）**：**交互层与渲染层分离** —— 交互期用低分辨率预览（0.5x）+ 简化描边，`pointerup` 后才渲染高保真。这条必须在 MVP 落地，否则完整版重构成本极高。

---

## 7. 待拍板的决策点

### D1：画布库选型
- 选项：**A** Konva 直接用（推荐）/ **B** fabric 7.4.0 / **C** 手写 Canvas / **D** Pixi
- **建议：选 A**。核心依据：`react-konva@19.3.0` 要求 React ^19.3.0，而项目是 **React 18.3.1**（`packages/agentai-gui/package.json`），选 Konva 本体可完全规避；fabric 体积大 1.7 倍且 v7 有破坏性变更；Pixi 体积大 4.8 倍且需自写字与选区。

### D2：MVP 是否做套索
- **建议：不做**。套索 1.5 人日且是交互最难的部分（曲线平滑 + 闭合吸附），MVP 用「框选 + 涂鸦」已能验证完整链路（标注 → mask → 编辑 → 回显），套索放完整版。

### D3：AI 意图传递主通道
- **建议：选方案 ④（组合）**，即「彩色编号叠加图 + 结构化 JSON」。实证依据是 Qwen 官方社区方案正是「mask 烘焙成红色高亮 + prompt 追加区域说明」。同时**保留 mask 通道**给 `alrc-gpt-image-2`（唯一有硬约束的通道）。

### D4：颜色语义由谁决定
- **建议：前端固定色板 + 用户文字定义**。不建议让 AI 读颜色猜意图（不可测、模型在颜色语义映射上不可靠）。**且必须同时带编号徽章**，因为约 8% 男性红绿色盲不能只靠颜色区分。

### D5：是否引入 React 19
- **建议：暂不升级**。为 react-konva 单独升 React 19 会牵动全前端（AntD 5.20 / monaco / 全量组件回归），风险远大于收益。若未来确需 react-konva，再单独排 React 19 升级项目。

---

## 附：数据来源清单

| 数据 | 来源 | 查证方式 |
|---|---|---|
| 4 个库版本/许可/deps/peer | `registry.npmjs.org/{fabric,konva,react-konva,pixi.js}` | curl 实测 2026-10-07 |
| 4 个库 star / 最后 push / issue 数 | `api.github.com/repos/{fabricjs/fabric.js,konvajs/konva,konvajs/react-konva,pixijs/pixijs}` | curl 实测 |
| konva LICENSE 正文 | `api.github.com/repos/konvajs/konva/license` | curl 实测，正文为 MIT |
| 包体积 | `bundlephobia.com/api/size` | curl 实测（react-konva 无数据） |
| OpenAI mask 语义与约束 | [developers.openai.com/api/reference/.../images/methods/edit](https://developers.openai.com/api/reference/python/resources/images/methods/edit/) | WebSearch |
| 图像 token 成本（85/170/765/4160） | [developers.openai.com/api/docs/guides/vision](https://developers.openai.com/api/docs/guides/vision) + [help.openai.com](https://help.openai.com/en/articles/11128753) | WebSearch（含官方中文站交叉验证） |
| Gemini/Claude token 成本 | [howmanytokens.io](https://howmanytokens.io/how-many-tokens-in-an-image) | WebSearch（二手，用于估算） |
| Qwen mask「红色高亮+文字」实践 | [comfy.icu/node/TextEncodeQwenImageEditPlusMask](https://comfy.icu/node/TextEncodeQwenImageEditPlusMask) | WebSearch |
| Qwen RCM / 变体能力 | [deepwiki.com/kohya-ss/musubi-tuner/9.3-z-image-turbo](https://deepwiki.com/kohya-ss/musubi-tuner/9.3-z-image-turbo) | WebSearch |
| Gemini 局部编辑及其局限 | [arstechnica](https://arstechnica.com/google/2025/11/google-launches-nano-banana-pro-image-model-adds-ai-image-detection-in-gemini-app) + [aipure.ai](https://aipure.ai/products/google-nano-banana-pro) | WebSearch |
| 现有代码行号 | 本地 Read/grep 实测 | `wc -l` / `grep -n` |

> 局限声明：GitHub star 为查证时点快照，会变动。Gemini/Claude token 为二手估算，仅用于方案间**相对**成本比较，不作为计费依据。