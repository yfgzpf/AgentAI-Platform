# 生图 / 生视频 / 3D建模 三模块优化规划

> 调研日期：2026-10-12 | 状态：**待富哥拍板，未动一行代码**
> 方法：全量代码审计（行号可溯源）+ 契约测试覆盖分析

---

## 一、一句话诊断

**三个模块是同一个产品做了三遍。** 架构上它们本该是一套「媒体生成任务系统」的三个皮肤，
但实际是三份独立实现——于是同一个问题（上传无校验、轮询会互相踩、防叠加漏了一个）必然重复踩坑，
且模块越成熟、代码越厚，差距越大。

| 模块 | 行数 | 内联style | 硬编码色 | 成熟度 | 测试覆盖 |
|---|---|---|---|---|---|
| ImageStudio | 1257 | **197** | 15 | 最高 | 3 处源码契约断言 |
| VideoGen | 1136 | 105 | 6 | 中 | 3 处源码契约断言 |
| Model3DGen | **244** | 22 | **0** | 最低 | **零** |

---

## 二、必须承认的两个客观事实

### 1. Model3DGen 是功能缺口，不只是「待优化」

`Model3DGen.tsx` 244 行，生成 3D 模型后**只给了一个下载按钮**（`L223 href={task.fileUrl}`）。
而项目里已经有 `Scene3DViewer.tsx`（Three.js + iframe `srcDoc`）——但它只被 ChatView 消费，
跟 Model3DGen **零关联**。

**结果：用户生成完 3D 模型，看不到它。** 这是三个模块里唯一的"产品级缺失"，
不是代码质量问题，是功能没做完。

对比另外两个模块缺什么：Model3DGen 没有模式切换、没有画廊网格、没有重试/删除、
`Progress` 组件在 `L7` 导入但**从未使用**、轮询是每任务覆盖式单定时器（`L86 clearInterval` 后重建），
**并发两个任务会互相把对方的轮询清掉**。

### 2. ImageStudio 的"成熟"里藏着布局 bug

- `StudioMode` 类型定义 5 个模式（`L32`），但 `MODES` 常量只剩 3 个（`L36-40`，
  注释 `L34-35` 承认 img2img/style_transfer 保留但不在 UI）
- 而 `L943` 的网格仍是 `repeat(5, 1fr)` —— **5 列网格只放 3 个按钮**，视觉上左右各空一格

这是"删功能忘改布局"的典型遗留。

---

## 三、问题分级（按 ROI 排序，不是按严重度）

### 批次 0 · P0 纯 bug 修复（半天，不动架构）

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 0-1 | **密钥进 URL query** | Model3DGen `L90-91` | `apiKey`/`secretKey` 拼在 URL 里 → 进浏览器历史、网关日志、Referer 泄漏 |
| 0-2 | 一键润色可重复叠加 | ImageStudio `L975-979` | VideoGen `L460-465` 有防叠加，ImageStudio **没有** → 连点直接扣两份钱 |
| 0-3 | 5 列网格放 3 按钮 | ImageStudio `L943` | 布局错位 |
| 0-4 | 历史缩略图无 `preload` | VideoGen `L923` | 每张一个 `<video>` 标签，默认 `preload="auto"` → 30 个视频并发解码，卡死浏览器 |
| 0-5 | 死代码 6 处 | 见下 | `STORAGE_KEY`(Image L112)、`QUALITY_TIERS`(L73-77)、`imgTasks/setImgTasks`(L194/197 只写不读)、`PRESET_CATEGORIES`+`presetCategory`(Video L35/L187)、`pollRef`(Video L202 只清不设)、`providerInfo`(3D L144)、`Progress` 未用(3D L7) |

**验收**：tsc 零错误 + 287 测试全绿 + 人工确认布局与防叠加

---

### 批次 1 · P0 性能止血（1-2 天）

**1-1 上传链路对齐（最该做的一处）**

VideoGen 的首尾帧、参考图、音频**全部裸 `readAsDataURL` 裸转 base64**（`L750/751/785/786`），
**无大小校验、无压缩**。而 ImageStudio 有 `compressImage()`（`L327-344`，压到 768px/0.75）
和 6MB 限制（`L446`）。

→ 用户传一张原图照片（4MB+）到 VideoGen，base64 后变 5.5MB 塞进 JSON body，
**界面不卡死算运气好**。

**修法**：把 ImageStudio 的 `readImages` + `compressImage` 提到 `utils/image-io.ts`，三模块共用。

**1-2 画廊懒加载**

ImageStudio `L1157`/`L625` 全量 `history.slice(0,30).map`，4K 图全尺寸直出，无虚拟化无懒加载
（grep `IntersectionObserver` / `loading="lazy"` 零命中）。

→ 至少给 `<img>` 加 `loading="lazy"` + `decoding="async"`（一行改动，立竿见影）。

**1-3 VideoGen 缩略图降级**

历史列表每项 `<video>` 改成 `preload="metadata"` + 复用首帧 poster，或干脆只显示时长+封面图。

**验收**：用 30 张 4K 图 / 10 个视频实测首屏时间（优化前后各一次）

---

### 批次 2 · P1 统一任务系统（5-7 天）—— 结构性改造

**现状：三套任务系统，互不相干**

```
ImageStudio  → imageTaskManager.ts (235行, class)
VideoGen     → videoTaskManager.ts (538行, class)
Model3DGen   → 组件内裸 setInterval (L85-103)
```

`ImageTask` / `VideoTask` / `TaskItem` 三个接口各自定义，**无共享基类**。
已经漂移出来的证据：
- VideoGen 的 `pollRef`（`L202`）只 `clearInterval` 从不 `setInterval` —— 死状态
- Model3DGen 轮询是覆盖式单定时器，并发任务互相踩

**建议**：抽 `services/task-core.ts` 定义统一状态机（`pending → running → done/failed`）+
轮询调度 + 订阅通知 + 持久化。`imageTaskManager` / `videoTaskManager` 降级为薄适配层，
`Model3DGen` 直接接入。

**为什么排 P1 而不是 P0**：批次 0/1 修完，用户已经能正常用；这一批是让三个模块**不再各自腐烂**，
属于结构性投资，不该和 bug 修复混在一起。

**风险**：VideoGen 的 538 行 taskManager 是线上稳定逻辑，重构必须逐状态对照，建议先写状态机单测再动。

---

### 批次 3 · P1 Model3DGen 补齐（3-5 天）

对齐 ImageStudio/VideoGen 的最低标准：

1. **3D 预览**（最大价值）—— `Scene3DViewer` 已有 Three.js + iframe 能力，
   给 `Scene3DData` 扩展 GLB 加载路径，生成后直接内嵌预览
2. **历史画廊网格**（现在只有 `L213-228` 的简陋列表）
3. **任务重试 / 删除**（另两个都有）
4. **进度条**（`Progress` 已导入未用）
5. **并发轮询**改多任务独立定时器（现在是覆盖式）

**验收**：`media-contract.test.ts` 补 Model3DGen 契约断言（现在零覆盖）

---

### 批次 4 · P2 设计系统对齐（长期还债，不建议本轮做）

- **抽共享组件**：`MediaPanel` / `ParamForm` / `Gallery` / `TaskCard`——
  三模块的 `Card size="small"` + 内层滚动 + `PaneGrip` 样板重复了 3 遍
  （Image `L938-941`、`L652-654`；Video `L635-638`）
- **内联 style → CSS 变量**：324 处（197 + 105 + 22）。这是大工程，
  应随功能改动顺带还，不要单独发起，否则会被无限期搁置
- **模式配色表接 token**：Image `L946` 的 hex 配色表整体绕过 design token
  （`#3B82F6`/`#EC4899`/`#8B5CF6`/`#F59E0B`），`token-layer.test.ts` 未覆盖这块
- **重复工具函数收敛**：`getCustomModels`/`saveCustomModels`（Image L107-108 vs Video L142-151
  近乎逐行重复）、下载、时间格式化、文件大小判断、base64 读取

---

## 四、明确不建议做的事

- ❌ **不建议现在大拆组件**——富哥已明确"不拆了"，且批次 0/1 的改动都不需要重构结构
- ❌ **不建议引入新 UI 库**——antd 已够用，问题在一致性不在能力
- ❌ **不建议把 Model3DGen 直接重写成 ImageStudio 的样子**——244 行从头重写风险高，
  按批次 3 增量补齐更稳
- ❌ **不建议先做批次 2 再修 bug**——架构改造前得先有个能跑的地基

---

## 五、推荐执行顺序与工作量

```
批次 0（半天）   bug 修复 + 死代码          ← 先做，成本最低，收益最直接
   ↓
批次 1（1-2天）  性能止血                   ← 用户体感提升最大的批次
   ↓
批次 3（3-5天）  Model3DGen 补齐           ← 填产品级缺口
   ↓
批次 2（5-7天）  统一任务系统               ← 结构性投资，收益长期化
   ↓
批次 4（长期）   设计系统对齐               ← 随功能改动顺带还债
```

**如果只做一个批次**：做批次 0。密钥泄漏和重复扣费是真事故。

---

## 六、红线（与本项目既有纪律一致）

- 每批次独立交付，守住 `tsc --noEmit` 零错误 + 287 测试全绿
- `media-contract.test.ts` / `token-layer.test.ts` / `layout-panes.test.ts` 是架构锁，
  改动不得使其变红
- 批次 2 重构 taskManager 前必须先补状态机单测
- 不碰 AGENTS.md 的层间依赖：`gui → HTTP/WS → gateway`，禁止 gui 直连 core/gateway 源码