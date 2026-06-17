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
| agentai-core | 类型定义 (36行, 轻量) | src/index.ts |
| agentai-gateway | 核心运行时 (Node.js 22) | src/agentai-loop.ts (987行), src/llm-router.ts (888行) |
| agentai-gui | React 前端 (Vite + Antd5) | src/App.tsx, src/components/ |
| agentai-desktop | Tauri 桌面壳 | src-tauri/ |
| agentai-qqbot | QQ Bot 渠道 | src/go-cqhttp.ts |
| agentai-skills | Python 技能集 | scripts/, 各skill目录 |
| agentai-vscode | VSCode 扩展 | src/ |

### Gateway 核心流程
1. `index.ts` 启动 → 初始化 Router + ToolRegistry + Memory + Skills
2. 用户消息 → `AgentAILoop.run()` 
3. 上下文构建: `buildImmutablePrefix()` (系统提示 + 工具 + 记忆 + 技能索引)
4. 主循环: LLM调用 → 工具分派 → 结果入log → 继续循环
5. 自主修复: 8种模式 (缺模块/编码错/路径错/权限/语法/网络/工具/解析)

### LLM 路由
4 Provider: agentai(免费) / deepseek / openai / cline(免费)
路由策略: Cost Guard → 缓存命中 → 5维评分 → 失败降级 → 熔断

### 运行模式
- auto: 全部工具 (默认)
- planning: 只读工具 (list_directory/read_file/search_codebase/web_fetch)
- review: 只读工具 + 审查系统提示
- readonly: 无工具 (纯对话)
- **goal**: 目标驱动执行 (新增) — 调用 `loop.runWithGoal()` 实现多阶段迭代验证

---

## 新增能力模块 (2026-06-15)

| 模块 | 文件 | 作用 |
|------|------|------|
| Token压缩 | `gateway/src/token-compressor.ts` | 工具输出语义压缩, 节省70-85% token |
| Goal模式 | `gateway/src/goal-runner.ts` | 目标→拆解→逐阶段验证→修正→报告 |
| 信息增强 | `gateway/src/fetch-enhancer.ts` | web_fetch结构化输出 (标题/Meta/正文) |
| 图表生成 | `tools.ts:generate_diagram` | AI生成SVG图, 5种类型, 双重安全消毒 |
| 图表渲染 | `gui/components/Markdown.tsx` | 对话内SVG渲染, DOMParser隔离 |

### 新增安全约束
- `generate_diagram` 必须通过 ctx._router 获取路由器 (与 spawn_subagent 一致)
- `SvgDiagram` 双重点消毒: 后端 sanitizeSvg() + 前端 DOMParser 剥离 on*
- Goal 模式硬性上限: 8阶段 / 2次重试 / 5min阶段超时 / 30min总超时
- Token 压缩保留错误信息, isErrorOutput() 全量保留

---
## 新增能力模块 (2026-06-17)

| 模块 | 文件 | 作用 |
|------|------|------|
| 智能模型切换 | `gateway/src/smart-model-switcher.ts` | AI自主检测熔断, 自动切商用API, 无密钥提示用户 |
| 内置工具管理 | `gateway/src/builtin-tools-manager.ts` | 项目内置pnpm/npm/tsc/node等, 自动检查+安装 |
| 用户行为预判 | `gateway/src/user-behavior-predictor.ts` | 提前预测用户下一步行动, 主动准备资源 |
| 数据预判 | `gateway/src/data-predictor.ts` | 提前预测用户需要的数据, 主动获取并缓存 |
| 速率限制监控 | `gateway/src/rate-limiter.ts` | 监控各provider速率限制, 动态调整路由策略 |
| 速率路由增强 | `gateway/src/router-rate-limiter.ts` | 智能速率控制+子Agent按速率分配任务 |
| SkillOpt训练 | `gateway/src/skill-training.ts` | 验证门控+训练循环+学习率预算+拒绝编辑缓冲区 |
| 沙箱规则配置 | `.trae-cn/sandbox.json` | Trae IDE文件/网络白名单, 避免工具调用被阻止 |
| SVG渲染修复 | `gui/components/Markdown.tsx` | 修复AI输出SVG空格+反引号杂质导致不渲染 |
| 附件统一处理 | `gateway/src/routes/chat.ts` | 文件/图片上传统一注入MasterController+loop.run |

### 新增约束
- 熔断3次自动触发智能模型切换 (agentai-loop.ts:smart-switch)
- 沙箱配置需包含pnpm临时路径(`F:\_tmp_8204_*`)和node_modules
- SVG生成工具返回内联Markdown代码块, 不保存文件

---

## 技能 (Skills) 体系

- Python 技能放在 `packages/agentai-skills/` 下
- 每个技能目录包含 `skill.json` 清单
- Gateway 启动时自动发现扫描
- 技能通过 `skill_orchestrator.smartDispatch()` 触发匹配
- 技能无版本锁、无依赖声明 (已知缺陷，未来改善)

---

## 测试要求

| 组件 | 类型 | 要求 |
|------|------|------|
| llm-router | 单元测试 | 路由选择逻辑 100% |
| 中文提示注入 | 单元测试 | ≥50样本, 拦截率 ≥80% |
| tool-registry | 单元测试 | 并行/串行分块 100% |
| api.ts (SSE) | 单元测试 | 所有事件类型各1条 |
| GUI 页面 | E2E (Playwright) | 8路由加载 + 流式对话 |

---

## 工作规范

- 修改前先 `git status` 确认当前状态
- 每次修改后用 `pnpm typecheck` 验证类型
- 新功能必须遵循 `CODING_GUIDELINES.md` 全部 9 条规则
- 禁止删除 `.workbuddy/` 目录 (项目数据存储)
