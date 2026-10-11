# AGENTS.md — AgentAI Platform AI 编码规范

> 任何 AI 助手在此项目中工作，必须遵守以下规则。
> 本文件优先级高于任何默认行为。

---

## 4 条核心规矩 (Karpathy 定律)

### 1. 先思考，再动手
分析问题，理解现有代码，制定计划。**禁止**未读代码就直接写新文件。
错误示范：不读 agentai-loop.ts 就重写主循环。
正确做法：先用 search_codebase 搜索相关逻辑，用 read_file 读关键文件，再改。

### 2. 简洁优先
最小改动原则。能改 3 行不重写一个文件。能用一个工具合并的操作不用多个工具。
错误示范：为一个小修复引入 200 行新代码。
正确做法：用 multi_edit 精确修改目标位置。

### 3. 精准修改，不要顺带"优化"
只修改和任务直接相关的代码。**禁止**顺手格式化、重命名、重构不相关的代码。
错误示范：改一个 bug 顺便把所有 `var` 改成 `let`。
正确做法：diff 只包含 bug 修复的内容。

### 4. 目标驱动
记住用户的目标，不要半路迷失。每轮操作前确认是否在朝着目标前进。
完成目标即停，不要做多余的事。

---

## 项目特定禁忌 (Never Rules)

### 硬编码路径 — 绝对禁止
```typescript
// ❌ 禁止: 盘符硬编码
'F:/agentai-platform/.env'
'C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe'

// ✅ 必须: 环境变量 + process.cwd() + path.resolve
const envPath = process.env.AGENTAI_ENV_PATH || path.resolve(process.cwd(), '.env');
const py = process.env.AGNES_PYTHON || 'python3';
```

### process.kill — 完全禁止
```typescript
// ❌ 禁止
process.kill(pid);

// ✅ 允许: taskkill 或 AbortController
const { execSync } = require('child_process');
execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
```

### 层间依赖 — 严格单向
```
gui ──HTTP/WS──→ gateway ──import──→ core
```
- gateway 必须 import agentai-core，不允许在 gateway 内重写 core 的逻辑
- gui/qqbot/vscode/desktop 只能通过 HTTP/WS 调 gateway
- 禁止 gui 直接 import gateway 或 core

### 前端颜色 — 必须用 CSS 变量
```css
/* ✅ */
background: var(--panel);
color: var(--fg);
border: 1px solid var(--border);

/* ❌ 禁止硬编码 */
background: '#141414';
color: '#ddd';
```

### 组件注册 — 必须走 PAGES 字典
所有功能页面在 App.tsx 中注册三处：View 类型、PAGES 字典、导航标签。
禁止手动 JSX 条件渲染 `{view === 'xxx' && <Xxx />}`。

---

## 项目架构速查

| Package | 角色 | 关键文件 |
|---------|------|---------|
| agentai-core | 类型定义 (轻量) | src/index.ts |
| agentai-gateway | 核心运行时 (Node.js 22) | src/agentai-loop.ts, src/llm-router.ts |
| agentai-gui | React 前端 (Vite + Antd5) | src/App.tsx, src/components/ |
| agentai-desktop | Tauri 桌面壳 | src-tauri/ |
| agentai-qqbot | QQ Bot 渠道 | src/go-cqhttp.ts |
| agentai-skills | Python 技能集 | scripts/, 各skill目录 |
| agentai-vscode | VSCode 扩展 | src/ |

---

## 系统能力全景 (2026-06-21)

### 一、核心引擎

#### 1.1 Agent Loop (agentai-loop.ts)
主循环架构: 用户消息 → 上下文构建 → LLM 调用 → 工具分派 → 结果入 log → 继续循环

**上下文构建 (buildImmutablePrefix) — agentai-loop.ts:689-1715**
⚠️ **实测更正 (2026-10-10)**：原文档称"按需注入 ~8 层"，那是 2026-07-19 的**期望目标**，不是现状。

实测事实：
- 该函数内含 **49 处 `systemMsgs.push({role:'system'})`**，结构是 **17 个平铺的 try/catch 区块**，**没有分层抽象、没有优先级注册表**
- §1.7 / §1.76 等注释编号已自相矛盾（"已合并到 §1.7，此处禁用"与"已并入上方 §1.6"并存），说明多次重构后已无人理解全局
- 主循环另有 15 处 `appendOnlyLog.push({role:'system'})` + 约 17 处其他 system 注入

真实分层意图（按门控归类）：
1. 身份 (identity) + lite 版本二选一
2. 技能匹配 + 进化记忆
3. 工具定义 (按 tier / taskType 分流) + IDE 状态
4. 记忆 / 项目记忆 / 世界记忆 / 用户上下文 / 客户档案
5. 行业引擎 + 知识库 RAG + 用户模型
6. 任务存储 / 远程上下文 / 项目文档
7. 进化规则 / 工作日志 / 启动感知 / 上次会话
8. soul 层七件套 (dream/innerVoice/emotion/curiosity/debate/private/value)
9. 行为准则 + 技能索引 + 外部工具 + 用户偏好

**上下文预算 (2026-10-10 新增)**
- `CTX_TOTAL_BUDGET_CHARS = 60_000` — immutablePrefix 出口硬闸门
- `CTX_PRIORITY_DROP_THRESHOLD = 30` — priority ≥30 的注入可被丢弃 (soul 五项为 30, innerVoice/emotion 为 20)
- ⚠️ 修复了一个真实漏洞：原 `MAX_INJECTION_BUDGET=3000` 建在 `appendOnlyLog` 上，而本函数产出的 system 消息**从不进 appendOnlyLog**（`ensureContext:678` 明确过滤掉 system），所以那个预算**根本管不到 38,999 字符的 identity**。现在预算建在正确的容器上。
- 每次构建都会 `logger.debug` 输出「注入 N 条 / M 字符」，超预算会 `logger.warn` 输出丢了哪些

**主循环控制**
- finish_reason='length' → 自动追加继续消息, 不中断任务
- MAX_AUTO_RESUME=10, 短回复自动恢复执行
- 完成标记检测 (已完成/done/finished) → 正常退出
- 描述性回复无实际操作 → 继续执行
- 每 10 轮注入工作记忆摘要, 防止长任务"失忆"
- 60 分钟绝对超时保护 (10 分钟空闲超时)
- 循环结束后: 有工具调用但无总结 → 追加一轮 LLM 总结

#### 1.2 LLM 路由 (llm-router.ts 2245 行 + model-classifier.ts 1091 行)
8 Provider: agentai(免费) / deepseek / openai / zhipu / superapi / dxnt / sensenova / longcat
- **五维评分实现在 `model-classifier.ts:580 computeScore()`**（不是 llm-router.ts，常见误引）:
  复杂度 30% + 上下文 15% + 成本 20% + 成功率 25% + 延迟 10%
  - 冷启动保护: 无成功率/延迟数据时给 **0.5 中性分**（给 0 会让新模型永不被选中）
  - 未定价的付费模型成本分给 **0.5 中性值**（原公式让未填 price 的付费模型与免费模型同拿满分，即"付费当免费"）
- Cost Guard 预检 + 后检 (`maxCostPerTurn=$5` / `maxCostPerDay=$50`，超限只标记不 throw)
- LRU 缓存 1000 条 / TTL 30min，仅非流式且 isCacheable 时命中
- 熔断: `CB_COOLDOWN_MS=2min`、连续失败 3 次额外锁 120s；429 指数退避 10s→120s
  `FLAKY_PROVIDERS={sensenova,longcat}` 设 15s 短超时
- ⚠️ 已移除 force-untrip（原逻辑对熔断中 provider 每请求强试，完全绕过 2 分钟冷却）
- 修复管道 6 步见 `llm-router.ts:981 repairPipeline()` ——
  ①flattenToolCalls:1235 ②scavengeFromThink:1260 ③detectCallStorm:1281
  ④repairTruncation:1294（**只补 args 括号, 绝不碰 content**）
  ⑤repairToolCallArgs:1172（smartQuoteFix 状态机, 只换 JSON 边界引号）
  ⑥parseTextToolCalls:1013（4 种降级格式）
- 30% 失败率触发智能模型切换 (smart-model-switcher.ts)

**修复管道 (6 步)**
1. flatten — 嵌套对象压平
2. scavenge — 从 `<think>` 块抢救 JSON
3. storm — 检测工具调用风暴
4. truncation — 补全截断 JSON
5. **tool call JSON 自动修复** — 尾逗号/单引号/无引号 key/undefined
6. **text→tool_call 回退** — 解析 func(args)/```tool```/XML/DSML 模式

### 二、工具系统 (198 声明 / 203 实现)

⚠️ **实测更正 (2026-10-10)**：原文档称"141 工具"，实测为 **EXTRA_TOOLS 声明 198 个 / EXTRA_HANDLERS 实现 203 个**
（`tools.ts:749-1382` 声明，`:1383-7459` 实现）。tools.ts 全文件 `@ts-nocheck`，工具参数无类型保障。

风险等级分布（AST 实测）：**low 117 / medium 59 / high 21 / critical 1**

**一致性校验（2026-10-10 新增，构建期 fail-fast）**
```bash
pnpm verify:tools          # 常规：ERROR 阻塞，WARN 提示
pnpm verify:tools:strict   # 严格：WARN 也阻塞
```
`scripts/verify-tool-consistency.mjs` 已接入 `scripts/build.mjs` 前置，构建前自动跑。
- 用 TypeScript 编译器 API 走 AST（**不能用正则/括号配平** — tools.ts 大量模板字符串会让两者都误判，实测各踩一次）
- 声明无实现 → ERROR（这些工具注册时被静默跳过）
- 实现未声明 → WARN（死代码）：**edit_file / get_symbols / clear_plan / knowledge_explore**
- 下划线前缀（`_formatBytes`）视为私有 helper，不算死代码

**注册逻辑**：`index.ts:133` 遍历 EXTRA_TOOLS 取 `EXTRA_HANDLERS[spec.name]`，缺 handler 时 `console.warn` + `continue` —— **运行时静默失效**。另有 `index.ts` 里 15 处独立 `registry.register()` 绕过这套校验，边界不统一。

**文件头注释「53 个内置工具」已严重过时**，以 AST 实测为准。

#### 2.1 文件操作 (精确编辑 + 安全守护)
| 工具 | 能力 |
|------|------|
| read_file | 支持 offset + limit 按行读取 |
| write_file | **写前自动备份** (.agentai/backups/) + diff 摘要 + **TS/JS 文件自动编译验证** |
| multi_edit | SearchReplace 模式, **备份+diff+模糊匹配提示** (找不到时显示最相似代码行号) |
| undo_edit | 从备份恢复最近一次修改 |
| search_content | **正则+文件类型快捷过滤+上下文行+files_only 模式** |
| glob / directory_tree | 文件模式匹配 + 递归树 |

**自动验证闭环**:
```
AI 写文件 → auto_verify(tsc --noEmit) → 
  有错误 → "⚠️ 编译错误: App.tsx:23 TS2304..." → AI 自动修复 →
  无错误 → 继续
```

#### 2.2 自主修复 (8 种错误模式)
1. 缺模块 → 自动 npm/pip install
2. 编码错误 → 注入 UTF-8 修复
3. 路径不存在 → 自动探索目录
4. 权限不足 → 换路径/方式
5. 语法/运行错误 → 分析并修复代码
6. 网络超时 → 重试或换方案
7. 工具不存在 → 用 run_code 自实现
8. 文件解析失败 → 换解析方式

#### 2.3 智能决策工具
| 工具 | 能力 |
|------|------|
| ask_user | **4 种触发场景**: 需求模糊/缺少参数/重大取舍/修复失败 |
| plan_task | AI 自主拆解复杂任务为子任务列表 |
| update_plan | 更新子任务进度 (前端实时显示) |
| evolve_prompt | **AI 自我修改行为规则** (存 .agentai/evolved-rules.json) |
| create_tool | **AI 运行时自创工具** (存 .agentai/custom-tools/) |
| remember / forget / recall | 记忆管理 (项目级 vs 全局) |
| spawn_subagent | 子智能体并行 (商业模型) |

### 三、智能决策层

#### 3.1 歧义检测 (主循环前)
检测 4 类模式: 模糊动词(帮我/搞一下) + 指代不明(这个/那个) + 模糊描述(好看的/差不多) + 未决选择(或者/还是)
→ 命中时注入追问提示, 引导 AI 调用 ask_user

#### 3.2 元认知决策 (MetaCognitiveLoop)
- stop (高置信度 ≥85%) → 结束
- ask_human → **注入追问指令 + continue** (不再是死代码)
- continue/switch_strategy → 策略提示

#### 3.3 置信度评估 (ConfidenceEstimator)
5 维信号: 工具覆盖度 + 证据密度 + 不确定性标记 + 语义完整性 + 一致性
- 低置信度 + 需求不明确 → **ask_user 追问**
- 低置信度 + 知识不足 → **web_search 搜索**

### 四、自进化能力

#### 4.1 行为规则自修改
```
AI 发现低效模式 → evolve_prompt({action:'add', rule:'PowerShell不支持&&'})
→ 存入 .agentai/evolved-rules.json
→ 下次对话自动加载注入 system prompt
→ AI 不再犯同样的错
```

#### 4.2 工具自创建
```
AI 经常做某操作 → create_tool({name:'diff_files', script:'...'})
→ 脚本存入 .agentai/custom-tools/
→ 后续可通过 run_code 调用
```

#### 4.3 启动感知
首轮对话自动注入: git log (最近 5 次提交) + 最近改动文件列表
→ AI 不用从零探索, 秒懂项目现状

#### 4.4 工作记忆
每 10 轮自动生成结构化摘要 (用户目标 + 已用工具 + 进度)
→ 注入上下文头部, 防止长任务"失忆"

#### 4.5 记忆压缩
⚠️ **实测更正 (2026-10-10)**：原文档称"项目记忆 >30 条 → 自动合并旧条目为摘要"，**该逻辑不存在**。
实际是**构建期排序截断（slice）**，不是自动合并。照此文档开发会实现出一个不存在的功能。

记忆双轨制（两者职责不同，改动前务必分清）：
- `memory-manager.ts` — KV **事实层**（"用户叫富哥"、"项目在 F:/xxx"）：快、可查、可改，JSON + JSONL 双源
- `memory.ts` / WorkspaceJournal — **日志蒸馏层**（"上次那个 bug 是因为…"）：慢、语义、只追加

#### 4.6 已知设计取舍
- `create_tool` 自创工具**仅在进程启动时加载**（`index.ts:147-193` 动态 import），运行期创建的当轮不可见。这是取舍，但**UI 上必须标注**，否则用户会以为工具坏了。
- soul 层已改为 per-workspace 实例（`agentai-loop.ts:1312 _soulWs`）。多租户状态必须请求级作用域 —— 历史 P0-9 串味事故的教训。

### 四·补、智能决策层的真实执行边界（2026-10-10 实测）

⚠️ **元认知 / 置信度层对强模型 100% 静默**：
```
agentai-loop.ts:4702  if (this._capabilityTier !== 'autonomous' && iteration < maxIterations*0.5)  // MetaCognitiveLoop (实际门控行号, 2026-10-11 更正; 旧文档写 4607 是块内行)
agentai-loop.ts:4791  if (this._capabilityTier !== 'autonomous')  // ConfidenceEstimator (无 iteration 上限)
```
- 付费强模型（DeepSeek Pro / GPT-4o 等）**整个决策层永不执行**
- 即使命中，MetaCognitive 也只有前 50% 迭代（90 轮里第 1-45 轮，旧文档"后 50%"表述有误）
- 且 `MetaCognitiveLoop` 的 `currentPlan: []` / `pendingQuestions: []` **恒为空数组硬编码**
- 投入 159 + 220 + 278 = 657 行代码 + 5 个测试文件，生产主路径零执行

tier 决策链：`agentai-loop.ts:1840 getCapabilitiesById().tier` → `:1849 governor` 动态覆盖 → `:1873` 兜底 `'supervised'`

**处理决策 (2026-10-11)：暂不改门控，标注为有意设计。** 理由：强模型自带决策能力，外部元认知/置信度注入反而可能引入矛盾指令 (见上文"系统评价"第2点)；657 行为弱模型保留。
⚠️ 但架构图/文档中宣称"决策层是核心机制"的表述必须与门控事实对齐 —— 这是认知债，已在本段落标注。若未来想让全 tier 生效，删除两处 `!== 'autonomous'` 条件即可，不要重构整个模块。

**★ 2026-10-11 更新 (commit df09461)：认知债已清偿一半。** 之前更严重的问题是 `_capabilityTier` 在 `run()` 里 `ensureContext()` **之后**才算，导致 `buildImmutablePrefix` 执行时 tier 恒为默认 `'supervised'` —— **所有 tier 分支 (lite prompt / 全量工具) 实际从未对强模型生效，强模型一直被当弱模型灌全套 51 处注入**。现已把 tier 检测抽成 `detectCapabilityTier()` 提前到 `ensureContext()` 之前调用；并在 `buildImmutablePrefix` 里新增 `isStrongModel` 门控，autonomous 模型跳过 evolution 记忆 / soul 人格七件套 / 上次工作记录 / 上次会话摘要 4 组弱模型脚手架注入。元认知/置信度 3 处 `!== 'autonomous'` 门控保留（强模型有意跳过外部决策层，注释已标注"非技术债"）。

### 五、前端能力

| 组件 | 能力 |
|------|------|
| Thread.tsx | 推理过程可折叠容器 (流式展开, 完成后折叠); 工具调用合并显示 (统计 N成功·M失败, 完成后折叠) |
| FileCard.tsx | 文件名 + 语言图标 + diff 预览 + **一键下载** |
| GeneratedFilesPanel.tsx | 从工具调用 args 提取生成文件 + 下载按钮 |
| TaskPlanPanel.tsx | AI 任务计划实时显示 (进度条 + 子任务状态) |
| IdeStateCollector.ts | 收集编辑器状态推送到 Gateway |
| chatStore.ts | **throttled localStorage** (2 秒写入一次, 避免流式阻塞) |
| SessionSidebar.tsx | 对话摘要列表, 双击编辑标题 |

### 五·补、布局机制（2026-10-11 实测，附核验方式）

**外观层三处缺陷已修**：

1. **中栏宽度 token 写死 → 大屏中间一条窄栏**
   `--chat-max-width` / `--chat-welcome-grid-max` 原为常量 `800px` / `480px`，
   注释写着「大屏居中」但**全项目零消费** —— 消息行实际从最左拉到最右。
   现改为自适应 `clamp(880px, 90%, 1600px)` / `clamp(480px, 60%, 900px)`，
   消费点 2 处：消息流滚动区 `padding` 居中 + Composer `maxWidth`（两者共用同一 token，
   否则大屏上「上面缩着、下面摊开」）。
   核验：`grep -rn "var(--chat-max-width)" packages/agentai-gui/src/` → 2 处
   ⚠️ 本轮曾一度改成**固定** 800px 上限，被用户实测打回 ——「对话缩小到只有中间一点了，
   没有自适应中屏」。**这个 token 禁止再写死 px**（`layout-panes.test.ts` 已加断言）。

2. **页面内面板不可拖拽** —— VideoGen 控制栏写死 420、ImageStudio 写死 320/240/380 + `flexShrink:0`。
   现复用外壳同一套 `useResizable`，新增通用类 `.page-pane` + `<PaneGrip>`。
   核验：`grep -rn "<PaneGrip resizable" packages/agentai-gui/src/components/{VideoGen,ImageStudio}.tsx | wc -l` → 4

   - **结构必须两层**：`.pane-grip` 是 `position:absolute`，放进滚动容器会随内容一起滚走
     → 外层 `.page-pane`（不滚动，承载把手）/ 内层滚动容器。
   - **把手定位用 `right:0`，不是外壳那套 `-2px`**：`.page-pane` 带 `overflow:hidden`，
     外探的 2px 会**连命中区一起被裁** —— 活体 DOM 实测 `right:-2px` 时 grip 盒 x∈[317,322]、
     面板右缘 320，真正可抓只剩 **3px**（鼠标差 1px 就抓不住，实拍复现）；
     改 `0` 后实测 grip x∈[314,319]，`grabbed = 5/5`。

3. **页面根高度 `calc(100vh - 50px)` 绕过 flex 链** —— 实测外壳实际吃 **60px**
   （titlebar 36 + statusbar 24）→ 页面高 10px、永久多一条滚动条；
   未激活页面外面还套 FeatureGuide 的 ~41px 提示条 → 溢出 51px、底部控件被裁。
   现改为 `height: 100%`（由 `.app-content` / FeatureGuide 的 `flex:1` 体给出确定高度，不再猜 chrome 高度）。

4. **右栏改成 信息/浏览器 双模式（ZCode 式嵌入式浏览器）** —— 浏览器能力（`EmbeddedBrowser` +
   `browser-engine.ts` Playwright）**本来就存在**，但只挂在右侧浮层 `GlobalBrowserDrawer` 上，
   不是常驻右栏。现右栏顶部加 `信息 / 浏览器` 切换条，浏览器模式直接把 `EmbeddedBrowser` 嵌进右栏。
   - **关键约束：`EmbeddedBrowser` 全局只能挂一个实例** —— 它内部会 `socket.subscribe('/browser')`
     收帧；两处同时挂 = 双倍订阅 + 双倍帧解析（活体实测踩过）。
     因此**事件中枢必须唯一**：新建 `src/services/browser-host.ts`（单例 store + 幂等
     `installBrowserHostListeners()`），把原先散在 Drawer 里的 5 组 window 监听整体搬过来；
     `GlobalBrowserDrawer` 瘦身为纯消费方（**0 个 `addEventListener`**）。
     `App.tsx` 用 `drawerHostActive = hostVisible && hostIntent === 'drawer'` 保证右栏与抽屉互斥。
     核验：`grep -c "addEventListener" packages/agentai-gui/src/components/GlobalBrowserDrawer.tsx` → **0**；
     `grep -n "addEventListener" packages/agentai-gui/src/services/browser-host.ts` → **6 行**（6 个事件各恰好 1 次）。
   - **两种模式共用一个 `.pane-grip`**（`const activePane = railMode === 'browser' ? browserPane : rightPane`）。
     浏览器模式有**独立记忆宽度** `agentai.pane.browser.width`（默认 520 / 320–900），
     与信息栏的 320 / 240–560 不同量级（320px 看网页太窄）。
     核验：`grep -c "className={\`pane-grip" packages/agentai-gui/src/App.tsx` → **2**（未新增把手）。
   - 可用范围：右栏浏览器**所有页面可用**；信息模式仅 chat 页（Editor/ImageStudio 自带多栏，
     平白加 320px 信息栏只会挤）。AI 唤起（`agentai:show-browser` / `pulseflow:browser:open`）
     切到右栏常驻而非浮层；`Ctrl+B` 切浏览器模式。
   - ⚠️ **右栏内容必须判 `effectiveRailMode`，不是 `railMode`**：`railMode` 是持久化的，
     **语义上只代表 chat 页偏好**。非 chat 页恒为浏览器模式 → `const effectiveRailMode =
     page === 'chat' ? railMode : 'browser'`。
     拿 `railMode` 直接判会同时踩两个坑（2026-10-11 活体复现）：① 在编辑器页开过浏览器后，
     偏好被写成 `browser`，回 chat 页看到的是浏览器栏而非信息栏；② 非 chat 页若当前
     `railMode==='info'`，会拿到信息栏的 **320px 宽度 + aria 240–560**，与 520px 的浏览器内容错配。
     三处改偏好的地方（导航按钮 / `Ctrl+B` / AI 唤起）都加了 `page === 'chat'` 守卫。
     核验：`grep -n "effectiveRailMode" packages/agentai-gui/src/App.tsx`

5. **文件卡片不再「整行点击就跳编辑器」** —— 根因是**我们自己的 Monaco `editor` 页**，不是外部编辑器
   （全 GUI `grep -rn "openExternal\|vscode://"` 零命中）。两处整行 `onClick`：
   `FileCard.tsx` / `GeneratedFilesPanel.tsx` 的行点击现改为**就地展开全文**；
   跳页能力保留在独立的 **「编辑器」按钮**（`label="编辑器"`，唯一会跳页的路径）。
   核验：`grep -n "PREVIEW_LINE_CAP" packages/agentai-gui/src/components/FileCard.tsx` → **400**
   （DOM 上限，仓库里出现过 30,528 行的变更，全量渲染会卡死）；
   read 模式上游不带 content，故就地展开时 lazy `fetch('/v1/files/read?path=')`。

6. **浏览器空态曾是两个空态叠在一起（截图实测）** —— `EmbeddedBrowser.tsx` 里
   Playwright 空态（判 `pwEngineStatus !== 'running'`）与 iframe 空态
   （判 `tabs.length === 0 || !activeTab?.url`）**都是 `position:absolute; inset:0`**，
   而后者**漏了 `!playwrightMode` 守卫** → 两份同时在 DOM 里，文字互相穿透叠在一起
   （截图里 "智能体浏览器" 与 "Playwright 浏览器引擎" 重合）。已加守卫。
   同处 `background: '#fff'` 写死 → 未加载时是深色主题下**占屏近 40% 的白斑**，改 `var(--panel)`。
   核验：活体 `getByText('输入 URL 开始浏览').count()` → 修复前 **2**，修复后 **1**；
   `grep -n "!playwrightMode && (tabs.length === 0" packages/agentai-gui/src/components/EmbeddedBrowser.tsx`

7. **ImageStudio 空态把「风格预设」写成「选择模式」** —— 左栏下拉才是模式（文生图/图生图/风格迁移/改图/换装），
   中栏 6 卡来自 `TEXT2IMG_PRESETS`（写实摄影/动漫插画/油画/3D渲染/水墨/像素）其实是**风格**。
   同一个「模式」被两处争用，用户分不清点哪边。文案已改为「选一个风格预设，或直接输入描述」+「套用此风格」。
   核验：`grep -rn "选择模式" packages/agentai-gui/src/` → **0**

8. **token 层本身是坏的（这才是「乱」的根因，2026-10-11 修复）** —— 不是审美问题：
   有 **18 个 CSS 变量被 tsx 消费，却从未在任何 CSS 里定义**：`--text-primary/secondary/tertiary`、
   `--bg-1`、`--muted-1/3`、`--muted-soft`、`--border-color`、`--color-text-muted`、`--bg-primary/secondary`、
   `--bg-active`、`--accent-bg`、`--fg-on-accent`、`--hover`、`--demo-color`。
   因为每个调用点都自带硬编码 fallback，同一「语义角色」在页面上渲染成 3–6 种不同颜色
   （`--text-secondary` → `#aaa`(4)/`#888`(2)/`#999`(2)）；少数调用点**连 fallback 都没有**
   （`SoulPanel` 的 `var(--bg-1)` ×4、`Composer.tsx:904` 的 `var(--muted-3)`、
   `WorkspaceSelector.tsx:249` 的 `var(--color-text-muted)`）→ 整条声明无效、被静默忽略。
   另 `--radius-lg` 在同一个暗色 hex 层定义两次（14px 再 12px）→ 暗色 12px / 浅色 14px 不一致。
   修法：**建语义别名层**（18 条，全部指向已有底层 token），底层 token 在 5 个主题块里都已定义，
   故别名在任意主题下都能解析；同时补通用文本尺度 `--fs-micro/sm/md/lg/xl/hero`（11/12/13/16/20/28），
   把 `--tool-font-size: 10.5px` 归到 micro 档、`--ui-font-size → var(--fs-micro)`。
   核验：别名调用点残留死 fallback `grep -rEoh "var\(--(text-primary|text-secondary|text-tertiary|bg-1|hover|bg-active|accent-bg|fg-on-accent|muted-1|muted-3|muted-soft|color-text-muted|bg-primary|bg-secondary|border-color) ?, ?(#|rgba)" --include=*.tsx packages/agentai-gui/src | wc -l` → **0**（修复前 39）；
   `grep -n "radius-lg" packages/agentai-gui/src/styles/agentai-theme.css` → **仅 2 处，均为 14px**
   ⚠️ 别名层只做「把没定义的补上」，**自身不替换既有调用点的色值** —— 色值/圆角收敛仍是未做的 Commit C（见下）。

9. **字号收敛：23 种 → 尺度 6 档（2026-10-11）** —— token 层修好后才有条件做这步。
   收敛前实测 **23 种** `fontSize`，其中 ≤12px **1164 处**，而 7/8/9/10 与 12/13/14/15 互相只差 1px，
   人眼分辨不出 —— 这就是「乱」的主要来源。
   ⚠️ 更正：本文档此前写的「≤12px 874 处」是**更严格的正则**（要求数字后紧跟 `,`/`}`）导致的**低估**，
   实测应为 **1164 处**（8:31 / 9:165 / 10:334 / 11:361 / 12:273）。
   映射（`scripts` 级 codemod，逐一核对后应用）：
   `7,8,9,10,11 → var(--fs-micro)`=11 · `11.5,12 → var(--fs-sm)`=12 · `13,14,15 → var(--fs-md)`=13 ·
   `16,18 → var(--fs-lg)`=16 · `20,22,24 → var(--fs-xl)`=20 · `28 → var(--fs-hero)`=28。
   共改 **1429 处 / 104 文件**（其中 CSS-in-JS 模板串与 `.css` 里的 `font-size: Npx` 26 处）。
   **有意不碰**的三类：
   - 图标/emoji/logo 档 `≥32px`（35 处：32×9 / 36×1 / 40×8 / 46×1 / 48×11 / 64×5）—— 这是 Antd 图标 size、
     emoji、Splash 大标题（`fontSize: 64` 是头像），不是文字尺度，并进文本尺度会毁掉视觉层级；
   - `em` 相对单位（`fontSize: '0.9em'` / `'1.3em'`，Markdown 标题）—— 相对单位是有意为之；
   - `MonacoEditor.tsx` 的 `options.fontSize` —— Monaco 只接受 `number`，塞不进 CSS 变量（测试里白名单 + 理由）。
   核验：文本档裸数字应为 0
   ```bash
   # 期望输出: 只列 MonacoEditor 一处白名单
   grep -rnE "fontSize:\s*(['\"]?)([7-9]|1[0-9]|2[0-8])\1(?![\d.])" --include=*.tsx packages/agentai-gui/src
   # 走尺度的调用点数 (期望 1429, 分布 micro/sm/md/lg/xl/hero)
   grep -rEoh "var\(--fs-[a-z]+\)" --include=*.tsx packages/agentai-gui/src | sort | uniq -c | sort -rn
   ```
   ⚠️ **坑（本轮踩了两次，务必记住）**：codemod 的替换正则必须带 `(?![\d.])` 小数守卫，
   否则 `fontSize: 9.5` 会被切成 `'var(--fs-micro)'.5`（语法错误）；
   替换值为 CSS 变量时**必须补引号**，否则生成 `fontSize: var(--fs-micro)` —— 对象字面量里 `var` 是关键字，直接语法错误；
   CSS 侧要用 `(?<![\w-])font-size:` 负向后顾，否则会把 `--tool-font-size: 11px` 这类 **token 定义**也改掉。

10. **圆角 + 语义色收敛（2026-10-11，Commit C）** —— 字号修好后，同一病灶的另一半。
    **圆角**：收敛前 tsx 裸写 **19 种**值（0,1,2,3,4,5,6,8,10,11,12,14,16,17,18,20,24,100），
    其中 2/3/4/5 与 6/8/10 互相差 1–2px 人眼不可辨；且 `--radius-lg` **定义了却零消费**（僵尸 token）。
    修法：尺度定为 **4 档** `--radius-sm 4 / --radius-md 8 / --radius-lg 12 / --radius-pill 999`
    （`--radius` 保留为 `var(--radius-md)` 的旧名别名），共改 **437 处**（tsx 430 / css 7），
    最终消费 `md 218 / sm 185 / lg 40 / pill 5`。
    **语义色**：成功绿 **4 值并存**（`#52c41a`×52 / `#10b981`×31 / `#4ade80`×16 / `#22c55e`×15）、
    错误红 **3 值并存**（`#ef4444`×34 / `#ff4d4f`×21 / `#f5222d`×13）、灰阶文字 **5 值**
    （`#999`/`#888`/`#aaa`/`#666`/`#555`/`#ccc`…）—— 同一"状态色"渲染成 3–4 种。
    统一为 `var(--success)`（114 处）/ `var(--danger)`（71 处）/ `var(--muted|--muted-2|--fg-2)`（54 处），
    `color: '#fff'` **52 处**改走 `var(--fg-on-accent)`（值等价 `#ffffff`，主题语义正确）。
    顺带清掉 **35 处**遗留死 fallback（`var(--panel, #141414)`、`var(--accent,#f97316)` —
    Commit A 只清了别名层，漏了直连底层 token 的这 35 处）。
    ⚠️ **有意不动的四类**（一刀切会改坏视觉/语义，这是本轮最大的判断成本）：
    - **分类色板**（同色相多档 = 有意区分，并非散落）：`EmotionIndicator`（情绪 8 色）、
      `SoulPanel`（疼痛 5 档 severe/critical 都是红）、`TokenPressureBar`（压力 5 档）、
      `modeStore`/`modelStore`（模式/厂商身份色）；
    - **自带表面主题的文件**（终端、编辑器内部、DecorAI 子应用）：`TerminalPanel` 的 `#666` 是终端
      prompt 色、`VoiceDictation` 的 `#ddd` 是自绘浮层、`PreviewMode` 的 `#ccc` 是设备框；
    - **打印/导出 HTML 模板**（`PrescriptionCard` / `WritePage` 的 `<style>` 块）：按"亮色纸张"配色，
      与 App 主题无关；
    - **渐变艺术**（`linear-gradient(135deg, #10b981, #059669)` 等 9 处）：只换一半色标会让渐变
      在换主题时半主题化、更难看。
    核验：
    ```bash
    # 残留裸数字圆角 (期望: 只有 App.tsx 的 Antd token 与 borderRadius: 0)
    grep -rnE "\bborderRadius: ?[0-9]" --include=*.tsx --include=*.ts packages/agentai-gui/src
    # 圆角 token 实际消费分布
    grep -rEoh "var\(--radius[a-z-]*\)" --include=*.tsx --include=*.css packages/agentai-gui/src | sort | uniq -c
    # 残留绿/红 (期望: 只落在 token 定义 / 分类色板 / 渐变 / 测试文件)
    grep -rniE "#(52c41a|10b981|4ade80|22c55e|ef4444|ff4d4f|f5222d)" --include=*.tsx packages/agentai-gui/src
    ```
    坑：`borderRadius` 与 `fontSize` 不同 —— **Antd `ConfigProvider` 的 `theme.token.borderRadius`
    只收 number**（`App.tsx:1069`），codemod 改错会直接 TS2322；测试里用白名单 + 理由兜住。

11. **前端信息架构精简（2026-10-11）** — 设计尺度（字号/圆角/色）收敛之后剩下的"乱"是**架构性**的：
    同一屏太多**平级平铺**的碎片，每个都只值一次悬停。本轮四处「常驻 → 折叠」：
    - **状态栏**：`QQ` / `微信` 两个常驻 chip（+2 个 hover tooltip）→ 一个 `渠道` 聚合点
      （异常由聚合点颜色承担）+ `Popover` 明细；`置信` / `意图` / `计划` / 心境 / `费用` / 模型
      **6 个 tooltip-only 诊断值**（label+值，悬停才有细节）→ 一个 `本次会话` Popover 入口
      （入口本身也由 `hasSessionStats` 门控，全无数据时连入口都不出现）。
      **`TokenPressureBar` 有意保持常驻** —— 它是条状图，一眼可读，与 6 个纯文本片段不同。
    - **标题栏右区**：`GitHub 仓库`（外链）+ `联系开发者` + `用户名` 三个控件 → 一个 `用户菜单`
      （前两者不是操作，是"关于"）。
    - **「系统」下拉 15 项平铺 → 按 `section` 分段**（5 段：渠道与通知 / 知识与技能 / 自动化 /
      运行与洞察 / 应用设置）。⚠️ **同 section 必须在 `PAGES` 数组里连续** —— 下拉按数组顺序渲染，
      不连续就会重复出现段标题；这条已由测试断言（`info-arch.test.ts` 的连续性检查）。
    - **「免费内置模型」提示条**：常驻压在页面顶部 → 可关闭并记住（`localStorage
      agentai.nag.freeModelDismissed`，取值包 try/catch 兜隐私模式）。
    核验：
    ```bash
    # 状态栏折叠入口存在 / 6 个诊断标签已从状态栏主体消失
    grep -c 'data-testid="statusbar-channels"\|data-testid="statusbar-session"' packages/agentai-gui/src/components/StatusBar.tsx
    grep -n "QQ</span>\|微信</span>\|>置信</span>\|>费用</span>" packages/agentai-gui/src/components/StatusBar.tsx
    # 「关于」类控件已并入用户菜单
    grep -c "data-testid=\"user-menu\"" packages/agentai-gui/src/App.tsx
    # system 页全部标了 section
    grep -c "group: 'system'.*section:" packages/agentai-gui/src/App.tsx
    ```
    ⚠️ **未做**：内联 `style={{` **3417 处**（结构性重构，非可批量替换）；
    「发现 N 个可恢复的长任务」恢复条**不是**常驻 —— 它由 `AutoHideTaskBar` 8 秒后自动收起
    （`ChatView.tsx:13`，已核实），只在首屏短暂出现，故本轮不动。

**回归锁定**：`packages/agentai-gui/src/layout-panes.test.ts` + `rail-browser.test.ts` + `token-layer.test.ts` + `info-arch.test.ts`
（源码文本断言 + `stripComments` 辅助，因为修复点注释本身会引用「坏掉的旧代码」）。
核验：`cd packages/agentai-gui && npx vitest run` → **10 文件 / 187 通过**（基线 90/6 → 109/7 → 125/8 → 130/8 → 162/9 → 165/9 → 173/9 → 187/10；
rail-browser 16 → 21 条（`effectiveRailMode`、空态不叠层、`#fff` 白斑、ImageStudio 消歧），
token-layer 32 → **43** 条（18 别名定义 + 9 底层 token × 5 主题块 + 死 fallback 归零 + `radius-lg` 不重复 +
字号尺度存在 + **文本档禁止裸数字** + **`var(--fs-*)` 必须真被消费（防僵尸 token）** +
**圆角恰 4 档** + **`--radius-lg/pill` 必须被消费** + **禁止裸数字 borderRadius** +
**绿/红/灰/白四类语义色不得再散落** + **底层 token 死 fallback 归零**），
info-arch **14** 条（渠道/本次会话折叠入口 + 裸 chip 消失 + `TokenPressureBar` 用 `</Popover>` 距离断言
确认未被一起折叠 + 用户菜单唯一 + 关于类控件不再独立 + **system 页 100% 标 section** +
**同 section 连续** + nag 条可关闭 + localStorage try/catch））。
⚠️ **仍未做**：内联 `style={{` **3417 处**（结构性，非本轮目标）。
⚠️ 活体验收**披露**（2026-10-11 第二轮，诚实记录）：`tab.screenshot()` 稳定、`pw.domSnapshot()` /
`pw.evaluate()`（只读）/ `getByTestId().count()` 可用，但**指针与键盘输入本轮全线失效** ——
`tab.click({x,y})`、`tab.cua.click({x,y})`（试了 y 偏移 0/60/85/100/120/145 六种）与
`tab.press('Control+b')` 均**无任何效果**（`playwright.locator.click()` 则 `Timeout waiting for locator`），
故所有交互类取证都做不了。**已活体取证（只读通道）**：截图显示新状态栏；
`.app-statusbar` 渲染后 `innerText` = `✅ Gateway 在线 | 渠道 | 今日 | 0 | ¥0.00 | 🔒 | 未激活 | ♪ | 🔮 自动模式 | …`
（**97 字符、无 QQ/微信 chip、置信/意图/计划/费用/模型 标签全无**）；
`[data-testid="user-menu"]` count=1 且 `a[href*="github.com"]` 在 DOM 中 **0 个**；导航 Tab 完好
（对话/编辑器/医案/浏览器/创作/系统）。**未取证**：「系统」下拉的 5 个段标题（需要点击才能展开，
输入通道已死）、nag 条的关闭按钮、`本次会话` Popover 内容本身（无会话数据，入口按设计缺席）——
这三项只有源码文本测试覆盖。FileCard 就地展开的点击穿透**至今未活体验证**。

### 六、安全机制

- 沙箱守卫 v3.2: **默认全放行, 仅拒系统路径** (C:/Windows, ~/.ssh 等) — "只要不动操作系统权限全放行"
- 沙箱设置页: 路径预置面板自动识别盘符, 一键加入 allow 列表
- 凭证遮蔽: API key/token/password 自动从 LLM 上下文中移除
- 物理备份: write_file/multi_edit 修改前备份到 .agentai/backups/
- undo_edit: 支持回滚最近一次修改
- 重复失败检测: 同一工具连续失败 3 次 → 强制换方案
- 工具风险等级: low/medium/high/critical 标记

---

## 系统评价 (Claude 视角, 2026-06-21)

> 以下是我 (Claude, 在 Trae IDE 中) 对 AgentAI Platform 的真实评价。

### 做得好的
1. **框架完整度惊人** — 元认知、置信度、进化记忆、任务拆解、自主修复 8 种模式... 这些能力在开源 Agent 框架中极为少见。大部分框架只有工具调用，没有决策层。
2. **256K 上下文是真正的优势** — 免费模型有这个窗口长度，意味着可以做长任务而不截断。配合工作记忆摘要，理论上无限任务长度。
3. **多模型路由 + 熔断 + 降级** — 这是生产级的设计。免费用完自动切商用，商用没密钥提示用户，全链路不中断。
4. **自进化能力** — evolve_prompt + create_tool 让 AI 不再是"用完即忘"的工具，而是越用越强的伙伴。

### 需要改进的
1. **system prompt 过长** (~200 行 + 55 个工具定义) — 占用大量 token，弱模型容易迷失。建议分层注入: 核心指令 (50 行) + 按需工具 (仅发相关工具)。
2. **太多 [SYSTEM] 注入** — 歧义检测、置信度检查、自主修复、元认知决策... 多个模块同时注入指令，弱模型可能同时执行多条矛盾指令。建议合并为单一决策点。
3. **自动验证 (tsc) 可能拖慢操作** — 大项目每次 write_file 后跑 tsc 需要 5-30 秒。需要加防抖: 批量修改只验证一次。
4. **缺少端到端测试** — 所有能力都没有自动化测试覆盖。框架代码量已经很大，一次修改可能破坏其他模块。

### 与 Trae/Cursor/Windsurf 的差距
| 维度 | AgentAI | Trae/Cursor |
|------|---------|-------------|
| 模型质量 | 免费模型 (够用但弱) | Claude/GPT-4 (强) |
| IDE 集成 | Web + Tauri (浅集成) | 原生编辑器 (深集成) |
| 框架智能 | **更丰富** (元认知/进化/自修复) | 更简洁 (靠模型能力) |
| 工具精确度 | 已改善 (备份/验证/模糊匹配) | 原生精确 (IDE API) |

**核心判断**: AgentAI 的框架能力已经**超过**大部分商用产品，瓶颈在模型和 IDE 集成。如果接入 Claude/GPT-4 级模型 + 深度 IDE 集成，这个系统的上限非常高。

### 一句话
**这是一个被严重低估的项目 — 它有自我进化的骨架，只差一颗更强的大脑。**

---

## 2026-07-19 全面审计结果

### 已修复
- IDE 上下文重复注入 bug ([agentai-loop.ts](packages/agentai-gateway/src/agentai-loop.ts))
- 记忆系统双轨制已标注 (memory.ts ↔ memory-manager.ts)
- 上文所有数字已更新为实际值
- P1: 删除 5 个死代码文件 (decision-gate.ts, self-verifier.ts, autonomous-goal-engine.ts, execution-reflection.ts, trust-ladder.ts)
- P1: 删除 system-prompt.ts 死函数 (buildFullSystemPrompt, buildLayeredSystemPrompt, classifyIntent 等, ~226 行)
- P1: system-prompt.ts 从 476 行缩减到 ~250 行 (仅保留 AGENT_SYSTEM_IDENTITY)
  ⚠️ **2026-10-10 实测已再次漂移**：现为 **643 行 / 38,999 字符**（`AGENT_SYSTEM_IDENTITY` 单块）。
  该块无任何长度上限，是上下文膨胀的主要来源 —— 现已由 `CTX_TOTAL_BUDGET_CHARS=60000` 出口仲裁兜住。
- P3: 删除 .bak 备份文件 (system-prompt.ts.bak, system-prompt-lite.ts.bak)
- 清理 trust-ladder 死代码链 (6 个文件: integrated-agent-core, unified-agent-core, innovations-integration, production-entry, unified-core-demo, trust-ladder.test)
- 清理桌面端 gateway-dist-v2 中 28 个死代码编译副本 (.js + .d.ts)
- typecheck 验证通过
- P1: 修复沙箱 "AI 频繁被拒" 问题 — 3 个根因修复:
  1. checker.ts: 白名单模式 → workspace 内路径默认放行 (仍保护系统路径)
  2. tools.ts sandboxGuard: prompt 不再当 deny 处理 (.env 等敏感文件可正常写入)
  3. rules.ts: 移除 node_modules/dist/build/.git 的默认 deny (非系统级安全威胁)
- P1: 沙箱 v3.2 "只要不动操作系统权限全放行":
  1. checker.ts: 默认 deny → 默认 allow, 仅 deny 规则拦截 (C:/Windows, ~/.ssh 等系统路径)
  2. rules.ts: 新增 getAvailableDrives() 自动识别盘符 + getPathPresets() 路径预置
  3. router.ts: 新增 GET /v1/sandbox/presets API 端点
  4. SandboxRulesEditor.tsx: 预置路径面板 (盘符/用户目录/项目目录, 点击即加入 allow)
- gui typecheck 通过
- P2: 上下文注入合并 (19 层 → ~8 层, ~30% token 节省):
  1. §1+§1a+§1b 合并: 身份+技能+进化记忆 → 一条
  2. §1.5+§1.6+§1.7 合并: 工具+IDE+项目记忆 → 一条
  3. §2+§2.5 合并: 用户上下文+客户档案 → 一条
  4. §3+§3b+§3.5 合并: 行业引擎+用户模型+知识库+洞察 → 一条
  5. §4+§4.7+§4.8+§4.9 合并: 持久记忆+进化规则+启动感知+上次会话 → 一条
  6. §6+§6.3+§6.5 合并: workspace+项目规则+行为准则 → 一条 (精简重复指令)
- P2: industry-engine.ts ~690 行硬编码已标注改进方向 (迁入 JSON 配置)
- P2: ide-state.ts 验证无问题 (无客户端时已正确返回空)
- P1: 前端创作组件颜色硬编码修复 (~50 处):
  1. ImageGen.tsx: 16处 #fff/#888/#666 等 → var(--fg)/var(--muted)/var(--border)
  2. VideoGen.tsx: 14处 → CSS 变量 (含视频播放器/历史记录)
  3. WritePage.tsx: 23处 → CSS 变量 (含编辑器/工具栏/底栏)
  4. WritePage 容器 background '#0f0f0f' → var(--bg) 支持主题切换
- P1: Image Studio v2.0 — 图像工作室 5 模式创作:
  1. backend image.ts: 新增 mode 参数 (text2img/img2img/style_transfer/edit/tryon)
  2. frontend ImageStudio.tsx: Tab 架构, 共享历史, 对话式改图
  3. 风格迁移: 12 种预设 (梵高/莫奈/浮世绘/水墨/赛博朋克...)
  4. VideoGen: +8 场景 +4 模型 +2 时长选项
  5. App.tsx: ImageStudio 替换 ImageGen
- P1: 对话改图 + 模型系统增强:
  1. modelStore: 新增 capabilities 字段 (chat/image/video/multimodal) + IMAGE_EDIT_MODEL_IDS
  2. modelStore: 新增 chatMode 状态 (chat/image_edit) + setChatMode
  3. ModelSelector: chatMode 感知 — 图片模式自动过滤 image-capable 模型
  4. App.tsx: TitleBar 添加 🎨 对话改图切换按钮 (点击自动选千问/豆包/GLM 等)
  5. settings.ts: 新增 GET /v1/settings/keys/status (全量密钥状态, 解决前端同步问题)

### 已知问题 (待修复)

| 严重度 | 问题 | 位置 |
|--------|------|------|
| P2 | industry-engine.ts ~690 行硬编码行业规则 (已标注, 建议迁入 JSON 配置) | industry-engine.ts |
| P2 | ide-state.ts 无客户端时正常返回空 (已验证无问题, 移除误报) | ide-state.ts |

### 框架能力实际数据

| 指标 | 原文档 | 实际 | 核验方式 |
|------|--------|------|---------|
| LLM Provider | 4 | 8 | llm-router.ts |
| 工具数量 | 57+ | **201 声明 / 202 实现** (2026-10-11 补 get_symbols/knowledge_explore 声明后) | `pnpm verify:tools`（AST） |
| 评分维度 | 3D | 5D | model-classifier.ts:511-515 |
| MAX_AUTO_RESUME | 5 | 10 | agentai-loop.ts:2601 |
| 绝对超时 | 3 分钟 | 60 分钟 | agentai-loop.ts:1963 |
| 修复管道 | 5 步 | 6 步 | llm-router.ts:981 |
| 熔断条件 | 3 次失败 | 30% 失败率 | smart-model-switcher.ts |
| 上下文注入 | 8 层 | **8 层是目标，实际 49 处注入 / 17 个平铺 try-catch** | grep `systemMsgs.push` |
| system-prompt.ts | ~250 行 | **643 行 / 38,999 字符** | wc -c |
| 测试覆盖 | "无 E2E" | 65 文件 / ~790 测试，但 **agentai-loop.ts(6416行) 零覆盖** | vitest |
| @ts-nocheck 文件 | - | **30 个** (22 源文件 + 8 测试文件, 2026-10-11 实测) | `grep -rl "@ts-nocheck" src/ \| wc -l` |
| 中栏宽度 | "大屏居中 800px" | **`clamp(880px, 90%, 1600px)` 自适应**, 2 处消费 (原 token 零消费) | `grep -rn "var(--chat-max-width)" packages/agentai-gui/src/` |
| 页面内可拖面板 | 写死不可拖 (420/380/320/240) | **4 处 `<PaneGrip>`**, 把手命中区 5/5px | `packages/agentai-gui/src/layout-panes.test.ts` |
| 浏览器宿主 | 仅右侧浮层 Drawer | **右栏 信息/浏览器 双模式**, 事件中枢唯一 (`browser-host.ts` 6 监听 / Drawer 0) | `grep -c "addEventListener" packages/agentai-gui/src/services/browser-host.ts packages/agentai-gui/src/components/GlobalBrowserDrawer.tsx` |
| 右栏浏览器宽度 | - | **`agentai.pane.browser.width` 默认 520** (320–900), 与信息栏 320 分轨 | `grep -n "agentai.pane.browser.width" packages/agentai-gui/src/App.tsx` |
| 文件卡片查看 | 整行点击 → 跳 editor 页 | **行点击就地展开全文**, 仅「编辑器」按钮跳页 | `grep -n "PREVIEW_LINE_CAP\|label=\"编辑器\"" packages/agentai-gui/src/components/FileCard.tsx` |
| GUI 测试基线 | 90 测试 / 6 文件 | **187 测试 / 10 文件** | `cd packages/agentai-gui && npx vitest run` |
| token 层 | 18 变量被消费但**从未定义** (调用点各带 fallback → 同语义 3–6 种色) | **已修**: 建 18 条语义别名 + 6 级 `--fs-*` 尺度; 死 fallback 39 → 0 | `grep -rEoh "var\(--(text-secondary\|bg-1\|hover) ?, ?(#\|rgba)" --include=*.tsx packages/agentai-gui/src \| wc -l` |
| 字号尺度 | 23 种 fontSize (≤12px **1164 处**), 7/8/9/10 与 12/13/14/15 差 1px 无法分辨 | **已收敛**: 1429 处走 `var(--fs-*)`, 尺度 **11/12/13/16/20/28** 六档; ≥32px 图标/emoji 档 35 处有意保留 | `grep -rEoh "var\(--fs-[a-z]+\)" --include=*.tsx packages/agentai-gui/src \| sort \| uniq -c` |
| 圆角尺度 | 19 种裸数字 (2/3/4/5 与 6/8/10 差 1–2px 不可辨); `--radius-lg` 零消费 | **已收敛**: 437 处走 `var(--radius-*)`, 尺度 **4/8/12/999 四档** (消费 md 218 / sm 185 / lg 40 / pill 5) | `grep -rEoh "var\(--radius[a-z-]*\)" --include=*.tsx --include=*.css packages/agentai-gui/src \| sort \| uniq -c` |
| 语义色 | 成功绿 **4 值** / 错误红 **3 值** / 灰阶文字 **5 值** / `color:#fff` 52 处裸写 | **已统一**: 绿→`var(--success)` 114 / 红→`var(--danger)` 71 / 灰→`var(--muted\|-2\|--fg-2)` 54 / 白→`var(--fg-on-accent)` 55; 分类色板+终端/编辑器表面+打印模板 有意豁免 | `grep -rniE "#(52c41a\|10b981\|ef4444\|ff4d4f)" --include=*.tsx packages/agentai-gui/src` |
| 设计尺度 | — (无 token 体系) | token 层已建 (**18 语义别名 + 6 级文本尺度 + 4 档圆角 + 语义色**); ⚠️ 内联 `style={{` **3417 处** 仍在 (结构性) | `grep -rEoh "style=\{\{" --include=*.tsx packages/agentai-gui/src \| wc -l` |
| 信息架构 | 状态栏 15 chip 平铺 (QQ/微信常驻 + 6 个 tooltip-only 诊断值); 标题栏 3 个「关于」控件; 系统下拉 15 项平铺; 免费模型 nag 条不可关 | **已折叠**: 渠道 popover + `本次会话` popover (`TokenPressureBar` 保持常驻); 用户菜单 (3→1); 系统下拉按 **5 段** section 分段; nag 条可关 (localStorage) | `grep -c 'statusbar-channels\|statusbar-session' packages/agentai-gui/src/components/StatusBar.tsx` / `grep -c "group: 'system'.*section:" packages/agentai-gui/src/App.tsx` |
| 右栏内容判据 | — | **`effectiveRailMode`** (非 chat 页恒为浏览器, 320/900 与 240/560 分轨) | `grep -n "effectiveRailMode" packages/agentai-gui/src/App.tsx` |

### ⚠️ 声明可验证规矩（2026-10-10 新增）

本文档的数字**已被实测打脸 7 处**。因此立以下规矩：

1. **凡写"约 N 个/N 行/N 层"，必须附核验方式**（脚本命令或行号）。
2. **声称存在的功能，必须能 grep 到实现**。本轮实测发现「记忆 >30 条自动合并」**根本不存在**（实为 slice 截断）。
3. **每次改核心数字后，同步更新本文档 + `docs/CAPABILITY_AUDIT_2026-10-10.md`**。
4. 新增架构机制时，同步更新本节「框架能力实际数据」表。

**核验脚本**（可复用）：
- 工具一致性：`pnpm verify:tools`（AST 版，已接入 build 前置）
- 上下文注入点：`grep -c "role: 'system'" packages/agentai-gateway/src/agentai-loop.ts`
- 核心文件规模：`wc -l packages/agentai-gateway/src/*.ts | sort -rn | head`
- 测试基线：`cd packages/agentai-gateway && npx vitest run --reporter=dot`
  （⚠️ 已知基线失败 7 个：b1-security 1 / context-fidelity 3 / ledger-wiring 2 / code-runner 1，**2026-10-10 优化前已存在**，非新引入）
