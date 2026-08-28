# agentai-gui 前端重构方案 —— 病因诊断 + 任务拆解 + 最优方案

> 日期：2026-08-28 ｜ 定位：承接《FRONTEND_AUDIT_2026-08-28.md》的落地执行方案
> 原则：渐进蛇形重构（Strangler Pattern）+ 测试先行 + 全程可运行可回滚

---

## 一、病因诊断（为什么乱）

### 根因层：4 个开发机制缺陷（非代码问题）

| # | 根因 | 铁证 | 后果 |
|---|---|---|---|
| R1 | **只增不减** | git 历史 0 次 refactor 提交（数百次 fix/feat） | 死代码沉淀至 12.8%（26 孤儿文件 7,661 行） |
| R2 | **零测试安全网**（总病根） | 前端仅 1 个测试文件，ChatView/Thread/App 全裸奔 | 不敢重构 → 只能堆叠 → 巨型文件膨胀。与巨型文件互相喂养 |
| R3 | **无架构约束** | 无 react-router、无 eslint 守卫、99 个字符串事件 | 内联样式/裸 fetch/超长组件全部有合法入口 |
| R4 | **换代不清场** | 样式 3 代并存、消息域 3 套并存、base URL 3 套 | 每次换代留旧方案双写，包袱指数增长 |

### 恶性循环枢纽
```
零测试 → 不敢重构 → 只能继续堆 → 更乱 → 更不敢重构
```
**重构必须从打断这个循环开始（先补测试），否则一切方案都是流沙上盖楼。**

---

## 二、方案对比与选择

| 方案 | 做法 | 周期 | 风险 | 判定 |
|---|---|---|---|---|
| **A 渐进蛇形重构** | 补测试 → 从基础设施向业务层拆 → 每步可运行 | 4-6 周 | 低，随时可停 | ✅ **采用** |
| B 停机重写 | 新架构整体重写 | 2-3 月 | 极高：30 页面全重测、业务冻结 | ❌ 活跃迭代中，不划算 |
| C 只清不建 | 只删死代码 | 1 周 | 低 | ⚠️ 治标不治本 |

### 方案 A 关键决策（需富哥拍板）

| # | 决策点 | 选项 | 建议 |
|---|---|---|---|
| D1 | 路由 | 引入 react-router 渐进替换 vs 维持手写 | **引入**：PAGES 字典改造成路由表，保留 setPage 兼容层，零破坏切换 |
| D2 | 事件总线 | 收敛 6 个高频核心事件 + 立"新代码禁事件"规矩 vs 全部消灭 | **收敛+立规**：一次性消灭 99 个事件工作量巨大且收益边际递减 |
| D3 | 节奏 | 专辟 1-2 周冲刺 vs 穿插日常迭代 | **专辟冲刺**：分散重构易烂尾，每阶段结束有一个完整交付点 |
| D4 | 测试范围 | 只测重构涉及模块 + 核心 store vs 全面补测 | **前者**：成本可控，安全网足够兜住重构风险 |

---

## 三、WBS 任务拆解（23 项）

### 阶段 0：安全网（0.5 周）—— 打断恶性循环

| 编号 | 任务 | 依赖 | 工作量 | 验收标准 |
|---|---|---|---|---|
| T01 | vitest + Testing Library 接入 agentai-gui | — | 0.5d | `npm test` 可运行，1 条示例测试通过 |
| T02 | 核心逻辑测试：chatStore 消息合并 / isFreeModel / apiUrl | T01 | 1d | 3 组核心逻辑测试全绿 |
| T03 | knip 接入，生成死代码基线清单 | T01 | 0.5d | 孤儿文件清单与审查报告一致（26 文件） |
| T04 | `tsc --noEmit` 全量通过基线 | T01 | 0.5d | 0 错误（当前可能已有存量错误，先清零） |

### 阶段 1：止血（1 周）—— 先删后理，零风险

| 编号 | 任务 | 依赖 | 工作量 | 验收标准 |
|---|---|---|---|---|
| T05 | 删除 13 个孤儿组件（GitPanel/SkillPanel/WorkspacePanel/SessionSidebar/CodeSandbox/ProactiveSuggestionCard/CustomerWidget/ModelPerformancePanel/ChatTimeline/AutomationButton/FileUpload/AutoIdentifyPanel/ProfileBadge，共 3,764 行） | T03/T04 | 1d | 删完 tsc + 构建通过，功能无变化 |
| T06 | 删除 DecorAI 9 个孤儿文件（3,588 行） | T03/T04 | 1d | 同上，DecorAI 页面仍正常 |
| T07 | 删除 4 个孤儿 service（api-config/CameraTemplates/IdeStateCollector/sseParser）+ 孤儿 types/index.ts | T03/T04 | 0.5d | 0 import 引用，tsc 通过 |
| T08 | 移除 4 个死依赖（axios/react-router-dom/framer-motion/react-virtuoso） | T05-T07 | 0.5d | pnpm 构建通过，无缺失模块 |
| T09 | 处理 9 个 hidden:true 半成品页面（删 or 补全，二选一） | T04 | 1d | PAGES 字典无幽灵项 |

### 阶段 2：收敛（2-3 周）—— 从基础设施向业务层推进

| 编号 | 任务 | 依赖 | 工作量 | 验收标准 |
|---|---|---|---|---|
| T10 | API 层收敛：api.ts 补全全部端点封装 + base URL 单点化（删 3 套并存） | T04 | 2d | 全端点有封装；base URL 只 1 处 |
| T11 | 82 个裸 fetch 替换为 api.ts 封装（按端点分批，每批 tsc+构建） | T10 | 3d | grep 裸 fetch = 0 |
| T12 | socket.io 统一为 useGatewaySocket hook（6 处收敛） | T10 | 2d | socket 连接点 = 1 |
| T13 | 样式收敛：变量映射表（--text-primary→--fg 等）+ 补齐 14 个未定义变量 + 删 --radius-lg 死定义 | T04 | 1d | 未定义变量 = 0；换肤验证 |
| T14 | 存量内联样式清理（3,629 → <500，按组件分批） | T13 | 3d | 内联样式 <500 处 |
| T15 | 合并消息域：删 editorChatStore，chatStore 统一；sessionStore 只存元数据 | T04+T02 | 2d | 消息域 = 1；ChatView 同步逻辑消失 |
| T16 | isFreeModel 单点化（删两处实现）+ AppMode/WorkspaceMode 划界命名 | T04 | 1d | isFreeModel 只有 1 处；mode 语义唯一 |
| T17 | 拆 App.tsx（1,386 → <500）：路由表独立 + 主题独立 + 事件总线独立 | T10-T16 | 2d | App.tsx <500 行，功能不变 |
| T18 | 拆 ChatView（2,478 → 各 <500）：MessageList/InputComposer/SocketBridge/ImageInsertion/SessionSync + 任务链/审批/澄清拆为独立面板 | T15/T17 | 3d | ChatView <500 行；测试全绿 |
| T19 | 拆 Thread（1,891 → <500） | T18 | 2d | Thread <500 行；测试全绿 |

### 阶段 3：固化（持续）—— 防复发

| 编号 | 任务 | 依赖 | 工作量 | 验收标准 |
|---|---|---|---|---|
| T20 | eslint 规则：no-inline-styles / no-bare-fetch / no-ts-nocheck / 组件行数上限 | T14/T17 | 1d | CI 跑 eslint 全绿 |
| T21 | knip 进 CI，孤儿文件直接红 | T03 | 0.5d | 死代码无法存活 |
| T22 | 组件规范 + 术语表 CONTEXT.md（store 边界、mode 语义、命名唯一） | 阶段2完成 | 1d | 新代码遵循规范 |
| T23 | 每月架构扫描机制（AI 生成报告 + 人工挑选，对照参考文章方法论） | — | 0.5d | 月度报告机制运转 |

---

## 四、收益量化

| 指标 | 现状 | 目标 |
|---|---|---|
| 死代码 | 26 文件 / 7,661 行 / 12.8% | 0 |
| 巨型文件（>500 行） | 20 个 | <8 个 |
| 内联样式 | 3,629 处 | <500 |
| 裸 fetch | 82 文件 | 0 |
| 消息域 | 3 套 | 1 套 |
| base URL | 3 套 | 1 处 |
| 前端测试 | 1 文件 | >30 用例 |
| socket 连接点 | 6 处 | 1 处 |

---

## 附：参考文章对应关系

- "AI 写代码太快 → 越堆越乱" → 根因 R1（只增不减），阶段 1 止血
- "浅模块是重点揪出的重构对象" → 三处系统性传话（3 套 store / 类型双份 / 99 事件），T15/T16/T17 处理
- "定期扫描生成报告供人挑选" → T23 每月架构扫描机制
- "不允许原型留仓库" → T05-T09 孤儿清理
- "统一语言（术语表）" → T22 CONTEXT.md
