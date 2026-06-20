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

**上下文构建 (buildImmutablePrefix)**
按需注入 8 层上下文:
1. 系统提示 (system-prompt.ts)
2. 用户身份 + 行业感知 (user-model.ts)
3. 项目规则 (.trae/rules/)
4. 持久记忆 (memory.jsonl, 限 10 条, 自动压缩)
5. 跨会话进化经验 (evolution.ts)
6. IDE 状态感知 (ide-state.ts, 打开文件/光标/诊断)
7. 自进化规则 (.agentai/evolved-rules.json)
8. 启动感知 (git log + 最近改动文件)

**主循环控制**
- finish_reason='length' → 自动追加继续消息, 不中断任务
- MAX_AUTO_RESUME=5, 短回复自动恢复执行
- 完成标记检测 (已完成/done/finished) → 正常退出
- 描述性回复无实际操作 → 继续执行
- 每 10 轮注入工作记忆摘要, 防止长任务"失忆"
- 3 分钟总超时保护
- 循环结束后: 有工具调用但无总结 → 追加一轮 LLM 总结

#### 1.2 LLM 路由 (llm-router.ts)
4 Provider: agentai(免费) / deepseek / openai / zhipu
- 三维评分: 成功率 50% + 成本 30% + 延迟 20%
- Cost Guard 预检 + 后检
- LRU 缓存 (相同请求直接命中)
- 失败降级 + 熔断保护
- 熔断 3 次触发智能模型切换 (smart-model-switcher.ts)

**修复管道 (5 步)**
1. flatten — 嵌套对象压平
2. scavenge — 从 `<think>` 块抢救 JSON
3. storm — 检测工具调用风暴
4. truncation — 补全截断 JSON
5. **tool call JSON 自动修复** — 尾逗号/单引号/无引号 key/undefined

### 二、工具系统 (57+ 工具)

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
项目记忆 >30 条 → 自动合并旧条目为摘要, 保留最近 20 条

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

### 六、安全机制

- 沙箱守卫: 所有文件操作经过 sandboxGuard 检查
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
