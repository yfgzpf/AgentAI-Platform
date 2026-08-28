# agentai-gui 前端架构审查报告

> 审查日期：2026-08-28 ｜ 审查范围：`packages/agentai-gui/src`（182 文件 / 59,777 行）
> 审查方法：对照 Matt Pocock Skills 方法论（深模块/浅模块理论、定期架构扫描、统一语言）
> 结论先行：**前端"乱"不是错觉，是 5 类系统性病灶叠加的结果，其中 12.8% 是死代码，可直接删除止血**

---

## 〇、与参考文章的观点对照

用户引用文章（Matt Pocock 的 AI Skills 方法论）的核心主张与本项目的实况完全对得上：

| 文章观点 | 本项目实况 |
|---|---|
| "AI 写代码的最大问题是太快，快导致代码越堆越乱" | 四大巨型文件（ChatView 2478 / Thread 1891 / App 1386 / Composer 1220 行）就是"快"的产物，占 src 总量 12% |
| "浅模块接口和实现一样复杂，基本就是个传话的，是重点揪出的重构对象" | 本项目"浅"不在组件包组件，而在三处系统性传话：3 套消息 store 互相同步、类型双份声明、99 个 `agentai:*` 字符串事件让组件退化为传话节点 |
| "定期扫描仓库，生成报告供人挑选，不擅自动手" | 本报告即此方法论的一次执行；P0/P1/P2 分级方案供人工挑选 |
| "不允许把原型写成半成品留在仓库里" | 26 个孤儿文件 7,661 行（12.8% 死代码）+ 9 个 `hidden:true` 半成品页面，正是"原型滞留" |
| "建立统一术语表（CONTEXT.md），统一语言" | 本项目"语言"未统一：两个 `mode` 同名不同义、`isFreeModel` 两处判断标准不一致、3 套 base URL |

---

## 一、执行摘要

**一句话结论**：前端有 5 类系统性病灶——巨型宿主文件、死代码滞留、状态层三套消息域、样式三套体系并存、接口层未收敛。前端"乱"的体感主要来自**样式（3629 处内联 + 3 套体系）**和**死代码（12.8%）**，而**改不动**的根源来自**巨型文件 + 字符串事件总线 + 裸 fetch**。

### 核心数字

| 指标 | 数值 | 严重度 |
|---|---|---|
| 死代码（孤儿文件） | **26 个文件 / 7,661 行 / 12.8%** | 🔴 P0 |
| 巨型文件（>500 行） | **20 个组件**，最大 ChatView 2,478 行 | 🔴 P0 |
| `@ts-nocheck` 掩盖类型 | **7 个文件**（含 ChatView、EmbeddedBrowser） | 🔴 P0 |
| 消息域 store 并存 | **3 套**（chatStore / editorChatStore / sessionStore） | 🟠 P1 |
| 内联样式 `style={{}}` | **3,629 处**（Thread 202、Settings 135、Composer 90…） | 🟠 P1 |
| 硬编码十六进制色 | **1,315 处** tsx + 60 处 CSS | 🟠 P1 |
| 裸 `fetch(` 绕过封装 | **82 个文件**；`/v1/settings/keys` 手写 8+ 处 | 🟠 P1 |
| 字符串事件总线 | **99 个 `agentai:*` 事件**，跨 27+ 组件 | 🟠 P1 |
| 未定义 CSS 变量（靠 fallback 兜底） | **14 个**（--text-primary/--bg-primary 等） | 🟡 P2 |
| 死依赖 | **4 个**（axios / react-router-dom / framer-motion / react-virtuoso） | 🟡 P2 |

---

## 二、五大病灶诊断

### 🔴 病灶一：巨型宿主文件 —— "一栋楼一层住"

```
ChatView.tsx    2,478 行  = 对话渲染 + 模型切换 + 图片插入 + socket.io 桥接 + SSE + 会话同步 + 拖拽上传 + 快捷键…
Thread.tsx      1,891 行
App.tsx         1,386 行  = 手写路由 + 30 页面注册 + 主题 + 身份 + 事件总线 + 订阅拦截 + FeatureGuide 内联
Composer.tsx    1,220 行
EmbeddedBrowser 1,144 行
```

- 违反单一职责：任何一个改动（如加一个按钮）都要读 2000+ 行上下文，`@ts-nocheck` 成了继续堆代码的通行证
- 手写路由 `useState<PageKey>('chat')`，无 react-router；`AutomationButton.tsx` 里居然残留 `useNavigate`（react-router-dom），说明"以为在用 router"
- **对照文章**：这就是"AI 写代码太快、老问题被放大"的最典型后果

### 🔴 病灶二：死代码滞留 —— "博物馆展品"

**孤儿组件 13 个（3,764 行）**：

| 文件 | 行数 | 被谁取代 |
|---|---|---|
| GitPanel.tsx | 650 | SimpleGitPanel |
| SkillPanel.tsx | 444 | SkillLibrary |
| WorkspacePanel.tsx | 441 | WorkspaceSelector |
| SessionSidebar.tsx | 429 | PulseFlowSidebar |
| CodeSandbox.tsx | 356 | SandboxResultPanel |
| ProactiveSuggestionCard.tsx | 297 | ProactiveSuggestionsPanel |
| CustomerWidget.tsx | 294 | — |
| ModelPerformancePanel.tsx | 216 | — |
| ChatTimeline.tsx | 193 | Thread |
| AutomationButton.tsx | 145 | AutomationPanel |
| FileUpload.tsx | 120 | — |
| AutoIdentifyPanel.tsx | 99 | — |
| ProfileBadge.tsx | 80 | — |

**孤儿子模块**：DecorAI 9 个文件 3,588 行（DecorCanvas 590 / MaterialList 527 / MaterialPriceManager 514 / SpacePlanner 436 / RealtimeEditor 460 / MaskEditor 383 / StyleCompare 306 / ResizableThreePanel 278 / video-presets 94）；孤儿 service 4 个（api-config / CameraTemplates / IdeStateCollector / sseParser）；孤儿 types/index.ts（66 行）

**隐患**：死代码里的 bug 照样被扫到、被新工具误改；新人读代码有 12.8% 概率读到废料；`npx knip` / `ts-prune` 一跑就现形
**对照文章**：`/prototype` 的规矩——"原型看完就扔，不允许把原型写成半成品留在仓库里"

### 🟠 病灶三：状态层三套消息域 + 17 个 store —— "三个仓库存一份货"

- **消息域 3 处并存**：`chatStore.messages`（ChatMessage）／`editorChatStore.messages`（chatStore 的阉割复制品，连 pendingUpdates 合并逻辑都复制了一份）／`sessionStore.sessions[].messages`（简化版）
- **模型/密钥域 5 处重叠**：`modelStore` / `autoModelStore.currentModel` / `subscriptionStore.isActivated` / `settingsStore.provider` / `secureKeyStorage`，`isFreeModel` 两处实现且 free id 集合不一致
- **"模式"同名不同义**：`modeStore.AppMode`（auto/planning/review/readonly）vs `workspaceStore.WorkspaceMode`（editor/browser/preview/auto）
- 数据一致性靠 ChatView 手动在 store 间同步 —— 同步逻辑本身就是 bug 高发区

### 🟠 病灶四：样式三套体系并存 —— "三个装修队同时施工"

| 体系 | 规模 | 问题 |
|---|---|---|
| agentai-theme.css | 69 个 `--*` 变量，5 套 data-theme-style | 与 antd token 体系平行 |
| workspace 旁路命名 | `--text-primary/--bg-primary` 等，**14 个变量从未定义** | 全靠 `var(--text-primary,#ccc)` 内联兜底，换肤失效 |
| antd token（ConfigProvider cssVar） | App.tsx L785-790 | 与 CSS 变量双轨 |
| 运行时注入 `<style>` | 21 个文件（EditorMode、Avatar、UnifiedWorkspace…） | 第三套 CSS-in-JS |
| 内联 `style={{}}` | **3,629 处** | Thread 202 / Settings 135 / Composer 90… |

- `--radius-lg:14px` 被 L54 的 `--radius-lg:12px` 覆盖（死定义）；`--radius(8px)` 与 `--radius-md(10px)` 层级混乱
- 硬编码色 1,315 处（`#4ade80`、`#58a6ff` 反复出现）
- **体感结论**：用户觉得"乱"的最直观来源就是这里——同一界面三套颜色系统，深色/浅色切换时必有组件掉队

### 🟠 病灶五：接口层未收敛 —— "每个组件自带小卖部"

| 端点 | 手写处数 |
|---|---|
| `/v1/settings/keys` | 8+ |
| `/v1/files/read` | 6 |
| `/v1/health` | 5 |
| `/v1/fs/drives` | 4+ |
| `/v1/profile` | 3+ |

- **base URL 3 套并存**：`config.ts GATEWAY_HTTP` / `api-config.ts API_BASE_URL`（孤儿） / `window.__GATEWAY_HTTP__`（内联）+ 硬编码 `http://127.0.0.1:18789`
- **socket.io 6 处无封装**（ChatView、EmbeddedBrowser ×2、AutomationPanel、QQBotPanel、TaskCenterPanel、WorkflowPanel），ChatView 同时维护 socket 桥接 + SSE 两条流
- **SSE 双实现**：`api.ts` 手写解析 + 孤儿 `sseParser.ts`
- **后果**：换协议/加鉴权/做统一重试都无从下手；`services/api.ts`（401 行）封装存在但没人用

---

## 三、浅模块清单（对照深模块理论）

文章定义：**浅模块 = 接口和实现一样复杂，纯传话，是重点揪出的重构对象**。本项目最典型的 10 个：

| # | 候选 | 位置 | 判定 |
|---|---|---|---|
| 1 | MarkdownPreview | PreviewMode.tsx L286 | 13 行纯转发 `return <div><MdComponent/></div>`，可内联 |
| 2 | OnboardingWrapper | App.tsx L1379 | 6 行死代码，onFinish 原样转手，0 处挂载 |
| 3 | FeatureGuide | App.tsx L102 | 整页接口 + 一层订阅提示条的转发 |
| 4 | types/index.ts | types/ | "类型传话文件"，重复 chatStore 已有类型，0 import |
| 5 | api-config.ts | services/ | 复刻 config.ts + api.ts 的 apiUrl，无人引用 |
| 6 | editorChatStore | store/ | chatStore 的"阉割传话版"，连合并逻辑都复制 |
| 7 | contextStore | store/ | 5 个 action 全是 injectedFiles 数组 CRUD 直接转发 |
| 8 | useUserName | store.ts L40 | 一行 getter 传话 |
| 9 | WorkspaceLoading / ErrorFallback / ModeIndicator | UnifiedWorkspace.tsx | 三个纯静态 JSX 小组件 |
| 10 | api.get/post/chat | services/api.ts L324 | 薄封装存在但被 82 个文件绕过 |

**共性结论**：本项目的"浅模块"病在三处系统性传话——① 3 套消息 store 互相同步；② 类型层双份声明；③ 99 个 `agentai:*` 字符串事件让大量组件退化为"dispatch/监听"节点（`agentai:navigate` 被 7 个文件各自 dispatch）。

---

## 四、优化路线图

### P0 止血（1-2 天，零风险，先删后理）

| # | 动作 | 收益 |
|---|---|---|
| 1 | 删除 26 个孤儿文件（7,661 行）+ 4 个死依赖 | 代码量 -12.8%，构建提速，新人少读废料 |
| 2 | 删除孤儿 types/index.ts，统一类型源 | 消除双份声明 |
| 3 | 9 个 `hidden:true` 半成品页面：删或补全，二选一 | 消除"注册了但看不见"的幽灵 |

### P1 重构（1-2 周，收益最大）

| # | 动作 | 说明 |
|---|---|---|
| 1 | **拆 ChatView（2,478 行）** | 按职责拆为：ChatMessageList / ChatInputComposer / SocketBridge / ImageInsertion / SessionSync 等 hooks + 组件，每块 <500 行 |
| 2 | **拆 App.tsx（1,386 行）** | 路由表独立（PAGES 移出）+ 主题初始化独立 + 事件总线独立 |
| 3 | **统一 API 层** | 用 grep 扫出 82 个裸 fetch 逐个替换为 `services/api.ts` 封装；统一 base URL 为单点；socket.io 收敛为单一 hook `useGatewaySocket` |
| 4 | **合并消息域** | 删 editorChatStore，统一走 chatStore；sessionStore 只存会话元数据；ChatView 的同步逻辑随之消失 |
| 5 | **样式收敛** | 定义变量映射表（--text-primary→--fg 等），补齐 14 个未定义变量；新代码禁止内联样式（eslint） |
| 6 | **类型收敛** | types/ 目录作为唯一类型源，store 内类型迁移，双份 ChatMessage 合并 |

### P2 治理（持续，机制化）

| # | 动作 | 说明 |
|---|---|---|
| 1 | 引入 eslint 规则 | `no-inline-styles` / `no-bare-fetch` / `no-ts-nocheck` / 组件行数上限 |
| 2 | CI 死代码检测 | knip 或 ts-prune 进 CI，孤儿文件直接红 |
| 3 | 组件规范 | 新组件 <500 行、最多挂 3 个 store、0 个字符串事件（用 props/context） |
| 4 | 定期架构扫描 | 对照文章方法论：每月跑一次扫描生成报告，人工挑选，不自动重构 |
| 5 | 统一术语表 | 建立 CONTEXT.md：AppMode/WorkspaceMode 边界、chatStore/sessionStore 边界、消息/任务/模型的命名唯一 |

---

## 五、量化收益预估

| 维度 | 现状 | 目标 | 收益 |
|---|---|---|---|
| 死代码 | 26 文件 7,661 行 | 0 | 代码量 -12.8%，新人上手成本显著下降 |
| 消息域 | 3 套互同步 | 1 套 | 数据一致性 bug 归零，删掉整套手动同步逻辑 |
| API 调用 | 82 文件裸 fetch | 全走 api.ts | 改 base URL 只改 1 处（现 3 套）；加鉴权/重试一步到位 |
| 内联样式 | 3,629 处 | <500 | 换肤只需改 CSS 变量，深浅色切换不再掉队 |
| 巨型文件 | 4 个 >1200 行 | 全 <500 | 改动不需要读 2000 行上下文 |

---

## 附：审查方法说明

- 事实盘点由代码探索子代理完成（只读，未修改任何文件），主理人抽查验证关键数字（文件行数、@ts-nocheck 清单、PAGES 字典、内联样式分布、裸 fetch 分布）
- 所有量化指标均来自 `grep`/`wc` 实测，非估算
- 分级标准：P0=零风险立即可做；P1=收益大需安排迭代；P2=机制化长期治理
