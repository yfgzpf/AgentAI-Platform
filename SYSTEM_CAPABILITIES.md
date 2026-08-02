# 岐枢 PulseFlow — 系统能力全景

> 版本: v0.5.0 | 更新日期: 2026-08-01
> 本文档是岐枢 PulseFlow 的**唯一权威能力说明文档**，整合了所有散落的架构/审计/使用说明。

---

## 一、系统定位

岐枢 PulseFlow 是一个**自进化的 AI 辅助开发平台**，基于 React + Vite + TypeScript + Ant Design 构建，采用 pnpm Monorepo 架构。

**核心差异化**: 不只是 AI 对话工具，而是一个能**自我学习、自我修复、团队协作**的 AI 开发伙伴。

---

## 二、技术架构

### 2.1 Monorepo 包结构

| 包名 | 角色 | 关键文件 |
|------|------|----------|
| `agentai-core` | 类型定义 (轻量) | `src/index.ts` |
| `agentai-gateway` | 核心运行时 (Node.js 22) | `src/agentai-loop.ts`, `src/llm-router.ts`, `src/tools.ts` |
| `agentai-gui` | React 前端 (Vite + Antd5) | `src/App.tsx`, `src/components/` |
| `agentai-desktop` | Tauri 桌面壳 | `src-tauri/` |
| `agentai-qqbot` | QQ Bot 渠道 | `src/go-cqhttp.ts` |
| `agentai-skills` | Python 技能集 | `scripts/`, 各 skill 目录 |
| `agentai-vscode` | VSCode 扩展 | `src/` |

### 2.2 层间依赖规则

```
gui ──HTTP/WS──→ gateway ──import──→ core
```

- gateway 必须 import agentai-core，不允许在 gateway 内重写 core 的逻辑
- gui/qqbot/vscode/desktop 只能通过 HTTP/WS 调 gateway
- 禁止 gui 直接 import gateway 或 core

---

## 三、核心引擎

### 3.1 Agent Loop (agentai-loop.ts)

主循环架构: 用户消息 → 上下文构建 → LLM 调用 → 工具分派 → 结果入 log → 继续循环

**上下文构建 (buildImmutablePrefix) v3.3**
按需注入 ~8 层上下文 (2026-07-19 精简自 19 层):
1. 身份+技能匹配+进化记忆 (合并)
2. 工具定义+IDE状态+项目记忆 (合并)
3. 用户上下文+客户档案 (合并)
4. 行业引擎+知识库RAG+用户模型 (合并)
5. 持久记忆+进化规则+启动感知+上次会话 (合并)
6. Workspace+项目规则+行为准则 (合并)
7. 技能索引 (按 includeSkillsIndex)
8. 用户偏好+额外system消息

**主循环控制**
- `finish_reason='length'` → 自动追加继续消息, 不中断任务
- `MAX_AUTO_RESUME=10`, 短回复自动恢复执行
- 完成标记检测 (已完成/done/finished) → 正常退出
- 描述性回复无实际操作 → 继续执行
- 每 10 轮注入工作记忆摘要, 防止长任务"失忆"
- 60 分钟绝对超时保护 (10 分钟空闲超时)
- 循环结束后: 有工具调用但无总结 → 追加一轮 LLM 总结

**任务恢复检测**
- 仅当用户消息包含恢复关键词 ('继续', '上次', '恢复', 'resume', 'continue') 时触发
- 避免每次对话都注入未完成任务提示

**项目文档自动生成**
- 新会话 `init()` 时, 若 `.agentai/` 目录下 `PROJECT_README.md`、`PROJECT_CONTEXT.md`、`PROJECT_STATE.md` 全部缺失
- 自动调用 `autoProjectDoc({action:'review'})` 生成这 3 个文件

### 3.2 LLM 路由 (llm-router.ts)

8 Provider: `agentai`(免费) / `deepseek` / `openai` / `zhipu` / `superapi` / `dxnt` / `sensenova` / `longcat`

**五维评分**: 复杂度匹配 30% + 上下文适配 15% + 成本 20% + 成功率 25% + 延迟 10%

- Cost Guard 预检 + 后检
- LRU 缓存 (相同请求直接命中)
- 失败降级 + 熔断保护
- 30% 失败率触发智能模型切换 (smart-model-switcher.ts)

**修复管道 (6 步)**
1. `flatten` — 嵌套对象压平
2. `scavenge` — 从 `<think>` 块抢救 JSON
3. `storm` — 检测工具调用风暴
4. `truncation` — 补全截断 JSON
5. **tool call JSON 自动修复** — 尾逗号/单引号/无引号 key/undefined
6. **text→tool_call 回退** — 解析 `func(args)`/` ```tool``` `/XML/DSML 模式

**模型优先级**
- 首选: `agnes-2.5-flash` (512K 上下文, 免费商用模型)
- 备用: `agnes-2.0-flash` (256K 上下文)
- 前端路由: `agnes free` (优先使用 agnes 免费模型)

---

## 四、工具系统 (141 工具)

### 4.1 文件操作 (精确编辑 + 安全守护)

| 工具 | 能力 |
|------|------|
| `read_file` | 支持 offset + limit 按行读取 |
| `write_file` | **写前自动备份** (.agentai/backups/) + diff 摘要 + **TS/JS 文件自动编译验证** |
| `multi_edit` | SearchReplace 模式, **备份+diff+模糊匹配提示** (找不到时显示最相似代码行号) |
| `undo_edit` | 从备份恢复最近一次修改 |
| `search_content` | **正则+文件类型快捷过滤+上下文行+files_only 模式** |
| `glob` / `directory_tree` | 文件模式匹配 + 递归树 |

**自动验证闭环**:
```
AI 写文件 → auto_verify(tsc --noEmit) →
  有错误 → "⚠️ 编译错误: App.tsx:23 TS2304..." → AI 自动修复 →
  无错误 → 继续
```

### 4.2 自主修复 (8 种错误模式)

1. 缺模块 → 自动 npm/pip install
2. 编码错误 → 注入 UTF-8 修复
3. 路径不存在 → 自动探索目录
4. 权限不足 → 换路径/方式
5. 语法/运行错误 → 分析并修复代码
6. 网络超时 → 重试或换方案
7. 工具不存在 → 用 `run_code` 自实现
8. 文件解析失败 → 换解析方式

### 4.3 智能决策工具

| 工具 | 能力 |
|------|------|
| `ask_user` | **4 种触发场景**: 需求模糊/缺少参数/重大取舍/修复失败 |
| `plan_task` | AI 自主拆解复杂任务为子任务列表 |
| `update_plan` | 更新子任务进度 (前端实时显示) |
| `evolve_prompt` | **AI 自我修改行为规则** (存 `.agentai/evolved-rules.json`) |
| `create_tool` | **AI 运行时自创工具** (存 `.agentai/custom-tools/`) |
| `remember` / `forget` / `recall` | 记忆管理 (项目级 vs 全局) |
| `spawn_subagent` | 子智能体并行 (商业模型) |

### 4.4 依赖自管理 (智能安装)

**核心能力**: 永远不要因为"缺依赖"而卡住 — 装上继续。

| 工具 | 能力 |
|------|------|
| `npm_install` | 智能安装: 自动检测 pnpm/npm/yarn/pip, monorepo workspace, 国内镜像加速 |
| `ensure_dependency` | 幂等预检: 先检查是否已装, 已装则跳过, 未装则自动安装 |

**智能特性**:
- 自动检测: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, 否则 npm
- monorepo: 自动检测当前 workspace 包名, 用 `pnpm --filter` 装到指定包
- 幂等: 已安装则跳过, 不重复装 (`force:true` 强制重装)
- 国内加速: 默认启用 npmmirror / 清华源
- Python venv: 自动检测 `.venv` 并使用其 pip
- 批量安装: `package` 可传数组 `["pkg1","pkg2"]`

**主动预检触发条件**:
1. 用户说"运行项目"/"启动服务"/"跑起来" → 先 `ensure_dependency` 装关键依赖
2. 用户要执行某脚本 (Python/Node) → 先 `ensure_dependency` 该脚本 import 的包
3. 调用工具前发现可能缺包 (如 `share_port` 需要 `localtunnel`)
4. 新接手项目探索时 → 检查 `package.json`/`requirements.txt` 中关键依赖是否就绪

**错误响应规则**:
- `Cannot find module 'xxx'` → 立即 `ensure_dependency({package:"xxx"})`
- `ModuleNotFoundError: No module named 'xxx'` → `ensure_dependency({package:"xxx", manager:"pip"})`
- 工具返回"包未安装" → 立即装, **不要问用户**

---

## 五、AI 团队协作 (run_team)

启动预设 AI 团队执行复杂任务。团队由多个角色 Agent 组成, 支持并行/串行/审查三种工作流, 结果自动综合。

### 5.1 预设团队

| 团队 ID | 名称 | 成员 | 工作流 | 适用场景 |
|---------|------|------|--------|----------|
| `code-review` | 代码审查团队 | 架构师 + 安全专家 + 性能专家 | 并行 | 提交前审查 / 架构评估 / 技术债务排查 |
| `feature-dev` | 功能开发团队 | 架构师 + 前端 + 后端 + 测试 | 串行 | 全栈功能开发 / 端到端实现 |
| `docs` | 文档团队 | 技术写作 + 校对 | 串行 | API文档 / 技术规范 / 用户手册 |
| `debug` | 调试团队 | 探索 + 审查 + 安全 | 并行 | 复杂Bug定位 / 性能调优 |
| `security-audit` | 安全审计团队 | 漏洞扫描 + 架构安全 + 代码探索 | 并行 | 上线前审计 / 合规检查 |
| `refactor` | 重构团队 | 架构师 + 前端 + 后端 + 测试 | 串行 | 系统重构 / 代码现代化 |

### 5.2 子智能体角色 (6 种)

| 角色 | 职责 | 工具集 |
|------|------|--------|
| `architect` | 软件架构师: 分析项目架构设计, 评估模块划分, 识别反模式 | `list_directory`, `read_file`, `search_content`, `search_files`, `get_symbols`, `directory_tree` |
| `frontend` | 前端工程师 (React + TS + Ant Design): 审查组件设计、状态管理、路由配置 | `list_directory`, `read_file`, `search_content`, `search_files`, `get_symbols`, `glob` |
| `backend` | 后端工程师: 审查 API 设计、数据库操作、中间件、性能 | `list_directory`, `read_file`, `search_content`, `search_files`, `get_symbols`, `glob` |
| `tester` | 测试工程师: 编写测试用例、覆盖率分析、边界条件 | `list_directory`, `read_file`, `search_content`, `search_files`, `glob`, `run_command` |
| `tech-writer` | 技术写作: 编写文档、API 说明、用户手册 | `list_directory`, `read_file`, `search_content`, `search_files`, `write_file`, `glob` |
| `performance` | 性能专家: 分析性能瓶颈、优化建议、内存泄漏检测 | `list_directory`, `read_file`, `search_content`, `search_files`, `get_symbols`, `run_command` |

### 5.3 使用示例

```
用户: "帮我审查整个 packages 目录的代码质量"
AI: → 自动调用 run_team({teamId:"code-review", task:"..."})

用户: "用代码审查团队审查 src/auth 目录"
用户: "组建功能开发团队实现用户登录模块"
```

---

## 六、3D 可交互场景生成 (generate_3d_scene)

根据用户描述生成 Three.js 参数化 3D 场景, 前端自动渲染为可交互预览。用户可旋转/缩放/调参/下载。

### 6.1 适用场景

| 场景 | 说明 |
|------|------|
| 🪑 家具设计 | 沙发/桌椅/灯具 3D 预览 |
| 🏗️ 建筑可视化 | 楼盘/室内/外观 3D 漫游 |
| 📦 产品原型 | 包装/工业品 3D 展示 |
| 📊 数据可视化 | 3D 柱状图/散点/曲面 |
| 🎮 游戏场景 | 低多边形场景概念图 |
| 🎨 艺术创作 | 抽象雕塑/粒子系统 |

### 6.2 生成要求

- 完整 HTML 文件 (含 Three.js CDN: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`)
- OrbitControls CDN: `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js`
- 参数化设计 (用户可调参数)
- `MeshStandardMaterial` + 灯光
- 响应式 Canvas

### 6.3 使用示例

```
用户: "生成一个 3D 沙发, 可以旋转看"
用户: "用 3D 场景展示一个装修客厅效果"
用户: "画一个数据可视化 3D 柱状图"
```

生成后可在对话区交互预览, 支持刷新/下载 HTML/全屏查看。

---

## 七、公网分享本地端口 (share_port)

将本地端口通过 localtunnel 隧道暴露为公网 URL, 任何人访问该 URL 都会转发到你的 localhost。无需注册, 完全免费。

### 7.1 4 种 action

| action | 参数 | 说明 |
|--------|------|------|
| `create` | `port` (必填), `subdomain` (可选) | 创建隧道, 返回公网 URL |
| `list` | 无 | 列出所有活跃隧道 |
| `close` | `tunnel_id` (必填) | 关闭指定隧道 |
| `close_all` | 无 | 关闭所有隧道 |

### 7.2 触发方式

AI 会在以下场景主动询问是否需要公网分享:
- 启动了 `vite dev` / `pnpm dev` / `npm start` 等本地服务
- 完成 Web 项目开发
- 用户提到"演示/分享给/远程访问/外网访问"
- 完成 Webhook/回调类功能

### 7.3 使用示例

```
用户: "把 localhost:3000 分享出去"
AI: → share_port({action:"create", port:3000}) → https://xxx.loca.lt

用户: "查看所有隧道" → share_port({action:"list"})
用户: "关闭隧道" → share_port({action:"close", tunnel_id:"tun_xxx"})
```

### 7.4 安全规则

- 仅 1024-65535 端口 (拒绝系统端口)
- 拒绝 22/3389 等敏感端口
- 不主动为数据库端口 (3306/5432/6379) 创建隧道
- 隧道 URL 仅返回给当前用户, 不写入日志

---

## 八、智能决策层

### 8.1 歧义检测 (主循环前)

检测 4 类模式: 模糊动词(帮我/搞一下) + 指代不明(这个/那个) + 模糊描述(好看的/差不多) + 未决选择(或者/还是)
→ 命中时注入追问提示, 引导 AI 调用 `ask_user`

### 8.2 元认知决策 (MetaCognitiveLoop)

- `stop` (高置信度 ≥85%) → 结束
- `ask_human` → **注入追问指令 + continue** (不再是死代码)
- `continue`/`switch_strategy` → 策略提示

### 8.3 置信度评估 (ConfidenceEstimator)

5 维信号: 工具覆盖度 + 证据密度 + 不确定性标记 + 语义完整性 + 一致性
- 低置信度 + 需求不明确 → `ask_user` 追问
- 低置信度 + 知识不足 → `web_search` 搜索

---

## 九、自进化能力

### 9.1 行为规则自修改

```
AI 发现低效模式 → evolve_prompt({action:'add', rule:'PowerShell不支持&&'})
→ 存入 .agentai/evolved-rules.json
→ 下次对话自动加载注入 system prompt
→ AI 不再犯同样的错
```

### 9.2 工具自创建

```
AI 经常做某操作 → create_tool({name:'diff_files', script:'...'})
→ 脚本存入 .agentai/custom-tools/
→ 后续可通过 run_code 调用
```

### 9.3 启动感知

首轮对话自动注入: `git log` (最近 5 次提交) + 最近改动文件列表
→ AI 不用从零探索, 秒懂项目现状

### 9.4 工作记忆

每 10 轮自动生成结构化摘要 (用户目标 + 已用工具 + 进度)
→ 注入上下文头部, 防止长任务"失忆"

### 9.5 记忆压缩

项目记忆 >30 条 → 自动合并旧条目为摘要, 保留最近 20 条

---

## 十、前端能力

| 组件 | 能力 |
|------|------|
| `Thread.tsx` | 推理过程可折叠容器 (流式展开, 完成后折叠); 工具调用合并显示 (统计 N成功·M失败, 完成后折叠) |
| `FileCard.tsx` | 文件名 + 语言图标 + diff 预览 + **一键下载** |
| `GeneratedFilesPanel.tsx` | 从工具调用 args 提取生成文件 + 下载按钮 |
| `TaskPlanPanel.tsx` | AI 任务计划实时显示 (进度条 + 子任务状态) |
| `IdeStateCollector.ts` | 收集编辑器状态推送到 Gateway |
| `chatStore.ts` | **throttled localStorage** (2 秒写入一次, 避免流式阻塞) |
| `SessionSidebar.tsx` | 对话摘要列表, 双击编辑标题 |
| `Scene3DViewer.tsx` | 3D 场景渲染 (iframe + Three.js), 支持全屏/刷新/下载 |
| `GuideModal.tsx` | 系统使用指南 (7 tab 完整文档) |

---

## 十一、安全机制

- **沙箱守卫 v3.2**: 默认全放行, 仅拒系统路径 (C:/Windows, ~/.ssh 等) — "只要不动操作系统权限全放行"
- **沙箱设置页**: 路径预置面板自动识别盘符, 一键加入 allow 列表
- **凭证遮蔽**: API key/token/password 自动从 LLM 上下文中移除
- **物理备份**: `write_file`/`multi_edit` 修改前备份到 `.agentai/backups/`
- **undo_edit**: 支持回滚最近一次修改
- **重复失败检测**: 同一工具连续失败 3 次 → 强制换方案
- **工具风险等级**: `low`/`medium`/`high`/`critical` 标记

---

## 十二、框架能力实际数据

| 指标 | 实际值 |
|------|--------|
| LLM Provider | 8 |
| 工具数量 | 141 |
| 评分维度 | 5D |
| MAX_AUTO_RESUME | 10 |
| 绝对超时 | 60 分钟 |
| 修复管道 | 6 步 |
| 熔断条件 | 30% 失败率 |
| 上下文注入层数 | ~8 (已从 19 层合并精简) |
| 预设团队 | 6 (code-review/feature-dev/docs/debug/security-audit/refactor) |
| 子智能体角色 | 6 (architect/frontend/backend/tester/tech-writer/performance) |

---

## 十三、快速开始

### 13.1 安装依赖

```bash
# 项目使用 pnpm monorepo
pnpm install

# 或让 AI 自动安装
# AI 会调用 ensure_dependency 自动检测并安装缺失依赖
```

### 13.2 启动开发服务器

```bash
# 启动 gateway
pnpm --filter @agentai/gateway dev

# 启动前端
pnpm --filter @agentai/gui dev
```

### 13.3 首次使用

1. 打开浏览器访问前端页面
2. 在对话框输入需求
3. AI 会自动探索项目、安装依赖、执行任务
4. 如需公网分享, AI 会主动询问

---

## 十四、已知问题 (待修复)

| 严重度 | 问题 | 位置 |
|--------|------|------|
| P2 | `industry-engine.ts` ~690 行硬编码行业规则 (已标注, 建议迁入 JSON 配置) | `industry-engine.ts` |
| P2 | `ide-state.ts` 无客户端时正常返回空 (已验证无问题, 移除误报) | `ide-state.ts` |

---

## 十五、系统评价

> 以下是 Claude (在 Trae IDE 中) 对 AgentAI Platform 的真实评价。

### 做得好的

1. **框架完整度惊人** — 元认知、置信度、进化记忆、任务拆解、自主修复 8 种模式... 这些能力在开源 Agent 框架中极为少见。大部分框架只有工具调用，没有决策层。
2. **256K 上下文是真正的优势** — 免费模型有这个窗口长度，意味着可以做长任务而不截断。配合工作记忆摘要，理论上无限任务长度。
3. **多模型路由 + 熔断 + 降级** — 这是生产级的设计。免费用完自动切商用，商用没密钥提示用户，全链路不中断。
4. **自进化能力** — `evolve_prompt` + `create_tool` 让 AI 不再是"用完即忘"的工具，而是越用越强的伙伴。

### 需要改进的

1. **system prompt 过长** (~200 行 + 55 个工具定义) — 占用大量 token，弱模型容易迷失。建议分层注入: 核心指令 (50 行) + 按需工具 (仅发相关工具)。
2. **太多 [SYSTEM] 注入** — 歧义检测、置信度检查、自主修复、元认知决策... 多个模块同时注入指令，弱模型可能同时执行多条矛盾指令。建议合并为单一决策点。
3. **自动验证 (tsc) 可能拖慢操作** — 大项目每次 `write_file` 后跑 tsc 需要 5-30 秒。需要加防抖: 批量修改只验证一次。
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

## 附录: 项目硬约束

- Must use Koa 2.x; Express is being phased out
- All middleware must use async/await, no callback style
- Route files must not be modified during middleware refactors
- 1MB limit per message, 10MB global body limit, 200,000 token input budget
- TaskChain state machine must follow allowed transitions: `plan→solve→verify→(fix)*→report→done`
- Audit logs stored in `~/.agentai/audit/YYYY-MM-DD.ndjson` with sensitive fields redacted
- Sandbox rules must be enforced: ALLOW/DENY/PROMPT actions defined in `~/.agentai/sandbox-rules.json`
- MCP (Multi-agent Communication Protocol) must be fully implemented with OAuth 2.1 support
- Worktree isolation required for task separation using git worktree and symlinked node_modules
- GUI must implement three-tier navigation: Indexing & Docs / Skills & Commands / Rules
- Cleaner functionality must include Treemap visualization using d3-hierarchy
- Windows systems require MFT fast scanning via Win32 API for file system analysis
- Custom Modes (planning/research/custom) must be implemented as IDE entry points
- TaskChain must support optional execution modes: `quick|plan|full`
- Plugin architecture must follow four-role model: Actions/Providers/Evaluators/Services
- System must remove all references to 'altas' naming; replace with '岐枢|pluseflow' (including settings references)

---

*本文档由 AI 自动生成, 整合自项目所有散落文档。如有疑问, 请查阅对应源码。*
