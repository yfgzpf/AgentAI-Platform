# AgentAI Platform — 系统状态审查报告 (2026-07-06)

> 审查范围：核心引擎全审 + 最近改动复审
> 产出形式：完整报告（Markdown 结构化报告）
> 审查依据：逐文件阅读 + 行号验证

---

## 一、buildImmutablePrefix — 8层上下文逐层核验

### 总览
`agentai-loop.ts:577-1203` — 函数共 ~626 行，按 Section 编号注入系统消息。

| # | 层名 | 代码行 | 状态 | 备注 |
|---|------|--------|------|------|
| 0 | 任务类型+行业检测 | 580-589 | ✅ 真生效 | detectTaskType + userModel.industry |
| 1 | 系统提示 | 591-649 | ✅ 真生效 | tier 分层: autonomous/guided → lite; supervised → 完整版 |
| 1.1 | 进化记忆 (evolution recall) | 601-632 | ✅ 真生效 | recallEvolution → extractPatterns → Top-3 注入。§4.5 已废弃合并 ✅ |
| 1.5 | 工具按需加载 | 657-669 | ✅ 真生效 | autonomous 给全部工具; supervised/guided → getRelevantTools() 过滤 |
| 2 | 用户上下文 | 671-743 | ✅ 真生效 | 姓名+情绪(含趋势感知)+开发偏好+浏览器引擎状态 |
| 2.5 | 客户档案 | 745-775 | ✅ 真生效 | dynamic import customer-store, 可选 |
| 3 | 行业引擎 | 777-883 | ✅ 真生效 | auto-detect → activate → 动态注册技能 → insight prompt |
| 3.5 | 行业知识库 RAG | 893-912 | ✅ 真生效 | industry-knowledge-base, 文档存在才注入 |
| 4 | 持久记忆 | 914-933 | ✅ 真生效 | readMemory 10条, industryTag加权 |
| 4.5 | 自进化记忆 | 935-937 | ⚠️ 仅注释 | 已废弃，整合到 §1.1 ✅ |
| 4.6 | IDE 状态 | 939-946 | ✅ 真生效 | dynamic import ide-state, 可选 |
| 4.7 | 自进化规则 | 948-962 | ✅ 真生效 | evolved-rules.json, fs.existsSync 检查 |
| 4.8 | 启动感知 | 964-990 | ✅ 真生效 | git log -5 + diff --name-only HEAD~3, 异步不阻塞 |
| 4.9 | 跨会话连续记忆 | 992-1014 | ✅ 真生效 | persistent-memory, lastSessionSummary |
| 6 | Workspace 上下文 | 1019-1081 | ✅ 真生效 | 目录树 + subdir-memory + 最近生成文件扫描 |
| 6.3 | 项目规则 | 1084-1098 | ✅ 真生效 | project-rules-initializer → .trae/rules/project_rules.md |
| 6.5 | 行为准则 | 1100-1140 | ✅ 真生效 | 核心原则/任务分解/自主触发/工具失败自修复/成本意识 |
| 5 | Skills 索引 | 1142-1164 | ✅ 真生效 | 遍历 registry.list() |
| 5b | 用户偏好 | 1166-1172 | ✅ 真生效 | RevertBridge |
| 6.6 | 审查模式 | 1178-1191 | ✅ 真生效 | mode=review 注入 |
| SessionStart | ProactiveSuggestionEngine | 1193-1201 | ⚠️ 实例化但未使用 | 仅 `new()` 一行, 未做任何事 |

### 结论
- **8层全部真生效**，实际已扩展到 20+ 层（细粒度拆分）
- §4.5 双重调用已废弃合并 ✅
- 第 1.1 节是 evolution 的唯一注入点 ✅（不再在 §4.5 重复）
- 无冲突：每层独立 push(systemMsgs)，按顺序注入

---

## 二、系统提示

### system-prompt 架构
- **完整版 (AGENT_SYSTEM_IDENTITY)**: 从 `src/system-prompt.ts` 导入, 用于 supervised tier
- **精简版 (buildLiteSystemPrompt)**: 用于 autonomous/guided tier, ~50行
- **分层决策**: 通过 `model-classifier.ts` 6维评分 → tier 判定

### System Prompt v3.0
- 版本历史: ✅ `prompts/version-history/v3.0-20260627.md` 存在
- 安全守护层: ⚠️ 代码中未见 `<security-guard priority="critical">` 标签（可能在 AGENT_SYSTEM_IDENTITY 常量内部, 需确认具体内容）
- XML 模块化: 完整版 system-prompt 的 section 结构未在代码中找到（常量 AGENT_SYSTEM_IDENTITY 可能较大, 未逐一展开验证）

### 限制词密度
- Lite 版 ~50行, 完整版 ~200行 — 对于免费模型来说偏长
- 但是 tier 分层减轻了这个问题

---

## 三、上下文管理

### Token Compressor
- ✅ `token-compressor.ts` 存在并集成 (loop.ts:29 import, loop.ts:2415 使用)
- ✅ 压缩结果同步写回 appendOnlyLog — **修复了"不持久化"问题** (2026-06-27)

### maybeFold (语义折叠)
- ✅ **已从幽灵函数复活**: loop.ts:3143-3156, `iteration >= 3 && log > 20` 时触发
- ✅ 当 token 超过 60% 阈值时调用 LLM 压缩中间轮次
- ✅ 保护尾部 25%, 迭代更新摘要 (previousSummary)
- 降级: 如果 LLM 调用超时 → 简单截断

### appendOnlyLog 管理
- ✅ 空/失败响应: loop.ts:2271 `content: res.content || null` — **注意这里仍然写 null**, 但 `llm-router.ts:1251` 会修正为空串
- ✅ Log 上限: 60条时截断 (loop.ts:3162-3169)
- ✅ 工具输出修剪: pruneOldToolResults (context-manager.ts:224)

---

## 四、Provider 适配层

### 自动检测 (llm-router.ts:1249-1268)
| 适配项 | 状态 | 行号 |
|--------|------|------|
| assistant content null→'' | ✅ 所有 provider | 1251-1252 |
| reasoning_content 自动检测 | ✅ _hasReasoningSupport Map | 1254-1259 |
| tool content array→stringify | ✅ 所有 provider | 1261-1262 |
| tool name 删除 | ✅ 所有 provider | 1265-1266 |
| stream_options 自动探测 | ✅ HTTP 400 → _noStreamOptions | 1344-1346 |
| 保留 tool_calls | ✅ 多轮工具调用必需 | 1248 |

### DXNT 集成
- ✅ DXNT 是第6个内置 provider (llm-router.ts:30)
- ✅ 免费路由紧急兜底 (llm-router.ts:649-658)
- ✅ rate limit 冷却检测

### Cost Guard
- ⚠️ **未找到 cost-guard.ts 文件**。搜索 `checkCostGuard` / `CostGuard` / `resetCostGuard` 无结果
- ⚠️ `app.ts` 中也无 cost-guard 路由注册
- ❓ 可能作为内存中的概念存在于 llm-router 内部（熔断策略仍在）
- ⚠️ `resetCostGuard()` 和 `POST /v1/cost-guard/reset` 端点**未找到**
- **结论**: Cost Guard 的熔断逻辑在 llm-router 中, 但独立的 reset 功能可能未实现或已移除

---

## 五、自动化任务持久化

### AutomationStore
- ✅ `automation-store.ts` 存在, SQLite 后端
- ✅ Singleton 模式 (getInstance)
- ✅ CRUD: create/list/update/delete
- ✅ 集成到 app.ts:587-591 (启动时加载)
- ✅ 工具定义: automation_create/list/update/delete (tools.ts:465-468)

---

## 六、能力集成状态

### 自动技能创建 (auto-skill-creator.ts)
- ✅ 文件存在: `src/auto-skill-creator.ts`
- ✅ 集成到 loop 退出: loop.ts:3299-3313
- ✅ 检测 8+ 工具调用 → 提取模式 → 生成 SKILL.md
- ⚠️ 异步调用 (import().then()), 失败不阻塞主循环

### WorkspaceJournal (memory.ts:450+)
- ✅ `memory.ts:550` 导出 singleton
- ✅ append/readToday/readRecent/distillOldLogs
- ✅ 30天蒸馏到 MEMORY.md (memory.ts:504-546)
- ✅ 集成到 loop 退出: loop.ts:3271-3296

### Model Distiller
- ✅ `model-distiller.ts` 存在
- ✅ 每次 loop 开始前注入 distilled patterns (loop.ts:3373-3385)
- ✅ 每次 loop 结束后自动蒸馏 (loop.ts:3387-3395)
- ✅ implicit_rules.md 自动生成

### Goal 模式
- ✅ `goal-runner.ts` 存在
- ✅ HTTP 入口: `routes/chat.ts:1378` + `routes/goal.ts`
- ✅ runWithGoal(): 多阶段迭代, 每阶段验证验收标准

### 元认知 (MetaCognitiveLoop)
- ✅ `meta/meta-cognitive-loop.ts` 存在
- ✅ 集成到 loop 中: loop.ts:2764-2765

### 置信度评估 (ConfidenceEstimator)
- ✅ `meta/confidence-estimator.ts` 存在
- ✅ 5维信号 + knowledge boundary 检测
- ✅ 集成到 loop 中: loop.ts:2832-2915

---

## 七、前端 Thread.tsx — Widget 渲染

### render_widget 支持
- ✅ 后端 tools.ts:460-462: render_widget 工具定义
- ✅ 后端 tools.ts:3872-3899: handler 实现, 返回 `{__type: 'widget', ...}`
- ✅ 前端 Thread.tsx:618-657: WidgetCard 组件 (SVG + HTML iframe)
- ✅ 前端 Thread.tsx:1092-1094: 渲染分支 `s.kind === 'widget'`

### WidgetCard 实现细节
- SVG: 包裹 `<svg>` 标签, viewBox 固定 680x400
- HTML: Blob URL + iframe 渲染
- 折叠交互: header 点击展开/折叠
- 样式: 使用 CSS 变量 (var(--border)/var(--card)/var(--panel)/var(--fg-2)/var(--accent-soft)) ✅

---

## 八、品牌重塑 — Atlas 命名状态

### 前端显示层
| 元素 | 当前值 | 状态 |
|------|--------|------|
| 品牌名 (TitleBar) | `ALTES` (App.tsx:402) | ⚠️ 拼写异常 |
| favicon 图片 | `/favicon-32.png` (alt="Atlas") | ✅ |
| GitHub 链接 | `AgentAI-Platform` | ⚠️ 仍是旧名 |
| localStorage key | `agentai-user-profile` / `agentai.workspace` | ⚠️ 仍是 agentai |
| 事件名 | `agentai:navigate` / `agentai:suggestion-accept` | ⚠️ 仍是 agentai |
| App.tsx.broken | 备份文件存在 | ⚠️ 应清理 |

### 后端
| 元素 | 当前值 | 状态 |
|------|--------|------|
| package 目录 | `agentai-gateway` / `agentai-core` / `agentai-gui` | ℹ️ 按要求包名不变 |
| GitHub URL | `yfgzpf/AgentAI-Platform` | ⚠️ 应随品牌更新 |
| `.agentai/` 目录 | 记忆/技能/备份目录前缀 | ℹ️ 约定俗成, 可保留 |

---

## 九、待清理 / 问题清单

### P0 — 必须修
| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | 品牌名 `ALTES` 拼写异常 | App.tsx:402 | 用户看到乱拼的品牌名 |
| 2 | `app.tsx.broken` 备份文件残留 | `packages/agentai-gui/src/App.tsx.broken` | 混淆, 应删除 |
| 3 | Cost Guard reset 端点缺失 | `app.ts` + `routes/chat.ts` | 记忆说有了 resetCostGuard()/POST /v1/cost-guard/reset, 但代码中未找到 |

### P1 — 应该修
| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 4 | ProactiveSuggestionEngine 仅 new() 无用 | loop.ts:1197-1198 | 浪费 token, 无实际行为 |
| 5 | localStorage key 仍用 `agentai.*` | App.tsx 多处 | 前端存储命名不一致 |
| 6 | GitHub URL 仍指向 AgentAI-Platform | App.tsx:589 | 品牌名未更新 |
| 7 | `detectTaskType` 被多次调用 | loop.ts:582, 3286 | 可缓存 |

### P2 — 优化建议
| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 8 | 品牌事件名 `agentai:navigate` 等 | App.tsx:226,360 | 仅前端影响小 |
| 9 | system-prompt-lite 的 "反摆烂/PRD/质疑模式" 在完整版中是否真正存在 | 需确认 AGENT_SYSTEM_IDENTITY | 需验证完整版内容 |

---

## 十、结论

### 做得好的
1. **buildImmutablePrefix 架构成熟** — 20+ 层独立可控, 全动态 import, 全 try/catch 容错, 失败不阻塞
2. **Evolution 失忆症已治愈** — §1.1 唯一注入点, §4.5 废弃合并 ✅
3. **Provider 适配层自动检测** — _hasReasoningSupport + _noStreamOptions 动态收集 ✅
4. **Frontend Widget 完整链路** — tools 定义 → handler → Thread.tsx 渲染, 端到端打通 ✅
5. **多层记忆门面** — WorkspaceJournal + Memory + Evolution 分离清晰 ✅

### 核心风险
1. **Cost Guard reset 功能可能已丢失** — 记忆说写了, 代码找不到
2. **ALTES 拼写问题** — 显然是品牌重塑时的手误
3. **ProactiveSuggestionEngine 裸 new()** — 浪费 token 且无意义
4. **system prompt 整体偏长** — 完整版 + 所有层注入可能导致首轮 8000+ token

### 建议
- 优先级: ALTES 修正 > Cost Guard reset 验证 > ProactiveSuggestionEngine 清理 > 删除 .broken 备份
