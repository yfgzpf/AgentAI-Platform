# 对话改图 / 生视频 / 分镜 三页面全面审查与优化规划

> 调研日期：2026-10-12 | 状态：**待拍板，未动一行代码**
> 三维度：布局架构 / 视觉美化 / 功能完整性
> 三个 P0 均已人工复核（行号可溯源），非推测

---

## 一、先看三个真 bug（都是"功能根本用不了"级别）

### P0-1 · 分镜页右栏是功能性孤儿——用户永远打不开

`StoryboardPanel.tsx` 的"分镜预览"和"剧集成品"两个面板：

```tsx
L286: const [rightPanelExpanded, setRightPanelExpanded] = useState<string[]>([]);  // 初始空
L974: display: rightPanelExpanded.length > 0 ? 'flex' : 'none',                    // 空 → 隐藏
L978: onChange={(keys) => setRightPanelExpanded(keys as string[])}                 // 唯一入口
```

`setRightPanelExpanded` 全文件**只有 2 处**：定义 + Collapse 自己的 onChange。

**问题**：Collapse 在右栏内部，右栏 `display:none` 时它也被隐藏 → **没有任何按钮能展开右栏**。L1100 那段"请展开右侧面板"的提示文案同样不可见。

这不是"体验不好"，是**整个右栏从上线到现在从未被任何用户打开过**。生成完分镜，预览和成品导出都在一个进不去的面板里。

### P0-2 · 生图清空历史后刷新就复活

```tsx
ImageStudio L611: localStorage.removeItem('agentai-image-tasks')   // 错的 key
imageTaskManager L35: const STORAGE_KEY = 'agentai-image-history'; // 真实 key
```

key 不匹配 → 清空只清了空气 → 刷新页面历史全回来了。L1171 的"清空全部"同理只清了本地 state。

### P0-3 · 分镜刷新后镜头卡死在"生成中"

持久化 useEffect（L174-219）把 `shot.status` 原样存进 localStorage，恢复时**没有把 `generating` 重置为 `pending`**。而 L954 的按钮是 `disabled={shot.status === 'generating'}`——刷新后这个镜头永远点不动。

对比：`imageTaskManager.ts L80-87` 有恢复时重置逻辑，**分镜页漏了这一步**。

---

## 二、三维度审查

### A. 布局架构：三页三套，分镜页最落后

| 页面 | 分栏能力 | 宽度记忆 | 窄屏兜底 |
|---|---|---|---|
| 对话改图 | `useResizable` ×2 + `PaneGrip` 把手，可拖可双击复位 | ✅ localStorage | clampWidth 兜底 |
| 生视频 | `useResizable` ×1 + 把手 | ✅ localStorage | clampWidth 兜底 |
| **分镜** | **0**。`width: rightPanelExpanded.length > 0 ? '55%' : '100%'` 写死 | ❌ | ❌ 完全无 |

三个具体问题：

**A1 分镜页布局能力落后两个版本**：另外两页的把手能拖、能记忆宽度、支持键盘方向键微调（`useResizable.ts L182-195`）；分镜页是纯 CSS 宽度跳变，55% 写死。

**A2 内联 `<style>` 注入**：分镜 L738 `<style>{RIGHT_COLLAPSE_CSS}</style>`、VideoGen L1086、ImageStudio L1192 都有。全局类名无 scope、强依赖 antd 内部类名、`!important` 覆盖——**antd 升级即静默失效**，且多实例会重复注入。

**A3 滚动容器冗余**：VideoGen 的 storyboard 模式把 StoryboardPanel 嵌在 `overflow:auto` 容器里（L623），而 StoryboardPanel 自己内部也 `overflow:auto`（L740）→ 双层滚动条。

### B. 视觉美化：硬编码色 + 三种标题栏范式

**B1 硬编码颜色**：ImageStudio 7 处 hex + 14 处 rgba、VideoGen 3+3、分镜 4+2。最典型的是 `linear-gradient(135deg, #10b981, #059669)` 在 ImageStudio 里**重复了 4 次**（L675/726/764/824）——同一个渐变抄四遍，改主题要改四个地方。

**B2 三种标题栏范式并存**：VideoGen 手写 button tab（L613）、ImageStudio 手写模式卡（L936）、分镜用 antd Collapse（L978）。同一个产品的三个核心创作页，切换控件三种形态。

**B3 antd 预设色 Tag**：`<Tag color="green">` / `color="red"` / `color="blue"` 散落三页——这些色值不在 token 体系内，换主题时它们是唯一的"漏网之鱼"。

**B4 空状态参差**：对话改图最完整（图标+CTA+快捷 Tag）、生视频次之（带预设卡片 hover）、**分镜最粗糙**（L1095-1101 就一个图标加三行字，而且还藏在打不开的右栏里）。

### C. 功能完整性

**C1 对话改图缺三个基础操作**：多轮对话居然不支持**单条消息删除、单条重新生成、编辑后重发**，只有"清空全部"（L659）。对比 ChatView 这些都有。
好消息：区域标注（`RegionEditor.tsx` 435 行，rect/lasso/brush + 彩色 mask + 编号）**已完整实现**，入口 7 处——这块是惊喜，不是缺口。

**C2 edit 模式生成中零进度反馈**：`fakeProgress`（L311）每 500ms 涨一次，但**只在非 edit 模式渲染**（L1140）。对话改图是 60s 超时（L366）的长任务，期间用户只看到一个 Spin 转圈。而生视频有真实进度 + 排队/渲染/提交文案 + 预估剩余（L874-885）——三页中最好。

**C3 storyboard 模式换不了模型**：VideoGen 的 storyboard tab 把 `<StoryboardPanel model={model}>` 嵌进去（L624），但该模式下左栏不可见，用户必须切回 single tab 才能换模型。

**C4 批量生成无取消、无失败重试**：`batchGenerate`（L631-695）串行执行，循环内无 cancel flag；单镜失败可手动重试，但批量整体失败后没有"一键重试所有失败项"。

**C5 三页都不支持拖拽上传和粘贴上传**（`onPaste` 零命中）。对话改图这种"传图改图"的场景，拖拽上传是刚需。

---

## 三、优化规划（按"能不能用 → 好不好用 → 好不好看"排序）

### 批次 A · 功能性修复（半天，不动布局）

| # | 问题 | 修法 |
|---|---|---|
| A-1 | **分镜右栏不可达** | 左栏标题栏加「预览/成品」两个显式开关按钮，调 `setRightPanelExpanded`；默认展开 preview |
| A-2 | 清空历史 key 错 | `agentai-image-tasks` → `agentai-image-history`；顺手确认 taskManager 的 `clear()` 是否有现成方法 |
| A-3 | 分镜 generating 卡死 | 恢复时把 `status:'generating'` 的镜头重置为 `'pending'`（对齐 imageTaskManager L80-87） |
| A-4 | 批量无取消 | 循环加 `cancelRef`，标题栏出「取消」按钮 |

**验收**：四个场景人工走查 + 289 测试不红

### 批次 B · 体验补齐（1-2 天）

| # | 内容 |
|---|---|
| B-1 | **edit 模式真实进度**：把 fakeProgress 逻辑接到 edit 分支（或直接透传 taskManager 的真实进度），替换裸 Spin |
| B-2 | 对话改图补**单条删除 / 重新生成 / 编辑重发**（对齐 ChatView 已有交互） |
| B-3 | storyboard 模式内嵌**模型切换入口**（小型 Select 浮在 Panel 顶部） |
| B-4 | 批量失败后出「重试失败项」按钮 |
| B-5 | 三页统一支持**拖拽上传**（对话改图 + 生视频首尾帧） |

### 批次 C · 布局统一（2-3 天，动结构）

| # | 内容 |
|---|---|
| C-1 | 分镜页接入 `useResizable` + `PaneGrip`，宽度记忆 `agentai.storyboard.leftW`，替换 55% 写死 |
| C-2 | 消灭内联 `<style>` 注入：三处 CSS 挪进 `agentai-theme.css`，用 scope 类名 |
| C-3 | 修 VideoGen storyboard 模式的双层滚动容器 |
| C-4 | 分镜页补窄屏兜底（<1200px 右栏自动收纳） |

### 批次 D · 美化收敛（1 天）

| # | 内容 |
|---|---|
| D-1 | `#10b981→#059669` 渐变 4 处重复 → 提为 `--grad-success` token |
| D-2 | antd 预设色 Tag → token 语义色 |
| D-3 | 三页标题栏切换控件统一为同一组件（对话改图模式卡 / 生视频 tab / 分镜 Collapse 择一收敛） |
| D-4 | 删死代码：`BgColorsOutlined` import、`style_transfer` 全套死分支（L290/314/343/1012-1017/1044/963）、`STYLE_PRESETS`、`sourceUrl` 只写不读、分镜页两个未用 icon import |
| D-5 | 分镜页空状态重做（含右栏那处不可见的） |

---

## 四、明确不做

- ❌ **不拆这三个组件**——富哥已明确不拆；且 1273/1136/1145 行的体量在"功能优先"阶段是可接受的
- ❌ **不引入虚拟滚动**——三页历史上限都在 30-50 条，`loading="lazy"` 已够
- ❌ **不重写分镜页**——只补右栏入口和分栏能力，业务逻辑一行不动

---

## 五、红线

- 每批次独立交付：`tsc --noEmit` 零错误 + 289 测试全绿
- `media-contract.test.ts` / `layout-panes.test.ts` / `token-layer.test.ts` / `info-arch.test.ts` 是架构锁，不得变红
- 批次 C 动布局后必须人工走查：拖拽把手 / 双击复位 / 键盘方向键 / 刷新后宽度记忆
- 不碰 AGENTS.md 层间依赖（gui → HTTP/WS → gateway）

---

## 六、建议执行顺序

```
批次 A（半天）  → 批次 B（1-2天）→ 批次 D（1天）→ 批次 C（2-3天）
  能用了          好用了          好看了        统一了
```

**D 排在 C 前的原因**：美化收敛（D）是纯增量低风险，先把 token 立好，再做布局统一（C），
避免布局重构时又改一遍颜色。**如果只做一个批次，做 A**——右栏打不开是上线级缺陷。