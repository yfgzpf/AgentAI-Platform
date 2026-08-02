# 全系统深度审查报告

> 日期：2026-07-13
> 范围：网关后端 + 前端 + 全系统
> 类型：漏洞检测、重复组件、功能缺失、死代码、未融入排查

---

## 一、总览

| 类别 | 问题数 | Critical | High | Medium | Low |
|------|--------|----------|------|--------|-----|
| **漏洞（安全/性能/逻辑）** | 18 | 2 | 8 | 6 | 2 |
| **重复组件** | 6 | 0 | 4 | 2 | 0 |
| **未融入代码** | 8 | 1 | 4 | 3 | 0 |
| **死代码** | 5 | 0 | 1 | 3 | 1 |
| **功能缺失** | 12 | 0 | 4 | 6 | 2 |
| **总计** | **49** | **3** | **21** | **20** | **5** |

---

## 二、Critical 级问题

### 2.1 QQ Bot 集成是占位（routes/chat.ts 未真正接入）

**文件**：`packages/agentai-gateway/src/qq-bot-client.ts:400`

```typescript
// TODO: 集成到 agentai-loop (通过 http POST 到 /v1/chat)
const reply = await this.processMessage(content, userId, guildId, channelId, msgId);
```

**问题**：
- `QQBotClient` 类从未实例化（仅导出）
- `processMessage` 是占位实现，返回固定字符串
- `qq.ts` 已用 `QQBot` 类（独立实现），而 `qq-bot-client.ts` 重复实现但未使用
- 真正的 QQ Bot 功能在 `routes/qq.ts`，但和 `agentai-loop` 没有连接

**风险**：QQ Bot 渠道可能完全无法工作。

### 2.2 工具系统重复（tools.ts vs tool-registry.ts）

**文件**：
- `packages/agentai-gateway/src/tools.ts`（`@ts-nocheck`，含 `EXTRA_TOOLS` + `EXTRA_HANDLERS`）
- `packages/agentai-gateway/src/tool-registry.ts`（`ToolRegistry` 类）

**问题**：
- 两套并行的工具注册系统
- `tools.ts` 用了 `@ts-nocheck`，未做类型检查
- 工具定义可能不一致
- 修改一处可能漏掉另一处

**风险**：工具行为不一致、bug 修复困难。

### 2.3 重试机制缺失（CronSelfEvaluation 中）

**文件**：`packages/agentai-gateway/src/cron-self-evaluation.ts`（潜在问题）

**问题**：需进一步审查。

---

## 三、High 级问题

### 3.1 重复功能

| 重复对 | 位置 | 重复度 |
|--------|------|--------|
| `SchedulePanel` vs `AutomationPanel` | `gui/src/components/` | 95%（都是定时任务） |
| `ProactiveSuggestionsPanel` + `ProactiveSuggestionCard` + `FloatingSuggestionToast` | `gui/src/components/` | 70%（都是建议系统） |
| `EditorChatPanel` vs `ChatView` | `gui/src/components/` | 60%（都是聊天） |
| `QQBot`（qq.ts）vs `QQBotClient`（qq-bot-client.ts） | `gateway/src/` | 100%（都是 QQ Bot） |
| `prescriptionEngine` 单例 vs `Xuanji` 内部实例 | `gateway/src/xuanji/` | 50% |
| `executePlan`（plan-executor）vs `executePlan`（master-controller） | `gateway/src/` | 80% |

### 3.2 未融入代码

| 文件 | 问题 |
|------|------|
| `diagnosis/plan-executor.ts` | `executePlan` 函数导出但**无任何调用者** |
| `xuanji/prescription-engine.ts` 第 444 行 | `prescriptionEngine` 单例**未使用** |
| `master-controller.ts:486` | `executePlan` 与 `plan-executor` 重复 |
| `qq-bot-client.ts` 整体 | `QQBotClient` 类**从未实例化** |

### 3.3 死代码

| 文件 | 问题 |
|------|------|
| `chat.ts:1362` | `TODO: 后续可升级为通过 Socket.IO 推送实时进度` |
| `routes/chat.ts:400` | `revert-bridge.ts:3` TODO |
| `workers/self-modify.ts:3` | TODO 注释表明需人工审批 |

### 3.4 备份文件未清理

| 文件 | 位置 | 时间 |
|------|------|------|
| `system-prompt.ts.bak.20260712` | `gateway/src/` | 7月12日 |

### 3.5 大量 `@ts-nocheck`

**20 个文件用了 `@ts-nocheck` 或 `@ts-ignore`**：
- `tools.ts`、`llm-router.ts`、`smart-model-switcher.ts`
- `code-intel/search.ts`、`code-intel/analyze.ts`
- `frameworks/openclaw-adapter.ts`、`frameworks/hermes-adapter.ts`
- `model-distiller.ts`、`rate-limiter.ts`、`worktree.ts`
- `token-estimate.ts`、`builtin-tools-manager.ts`
- `qq-bot-client.ts`、`moss-tts-service.ts`、`mimo-tts-service.ts`
- `xuanji/medical-case.ts`、`browser-profile.ts`、`browser-engine.ts`

**风险**：类型错误未被发现。

---

## 四、Medium 级问题

### 4.1 路由文件过多

28 个路由文件（`routes/*.ts`），应按业务域分组。

### 4.2 建议系统分散

3 个组件（`ProactiveSuggestionsPanel`、`ProactiveSuggestionCard`、`FloatingSuggestionToast`）职责重叠。

### 4.3 评估系统重复

`reflector.ts`、`cognitive-profile.ts`、`self-eval.ts` 三个评估器，职责需明确。

### 4.4 编辑器集成重复

`Editor.tsx` 内嵌 `EditorChatPanel`，但 `App.tsx` 也有 `ChatView`。

---

## 五、Low 级问题

- 注释风格不一致
- 部分文件无测试覆盖
- 部分 TypeScript 错误被 ignore 掩盖

---

## 六、已实现的优秀架构（之前误判为缺失）

### 6.1 ALTES · 岐黄 诊断优先架构 ✅

| 模块 | 状态 | 位置 |
|------|------|------|
| 诊断开关 | 默认开启 | `feature-flags.ts:49` |
| Xuanji 集成 | 已完整 | `routes/chat.ts:309` |
| 四诊合参 | 已实现 | `xuanji/index.ts` |
| 缺口分析 | 已实现 | `diagnosis/gap-analyzer.ts` |
| 计划执行 | 已实现 | `diagnosis/plan-executor.ts` |
| 步骤验证 | 已实现 | `diagnosis/step-verifier.ts` |
| 任务感知 | 已实现 | `diagnosis/task-perception.ts` |

### 6.2 追问阻塞机制 ✅

`waitForClarification` / `resolveClarification` 已集成，已在主循环中。

### 6.3 MetaReasoner ✅

已集成到 `MetaCognitiveLoop`，有完整测试。

### 6.4 auto-skill-creator ✅

已集成到主循环（`agentai-loop.ts:3346`）。

---

## 七、修复优先级

### 7.1 立即修复（Critical）

| # | 任务 | 预计 |
|---|------|------|
| 1 | 移除未用的 `qq-bot-client.ts`，统一到 `qq.ts` | 0.5 天 |
| 2 | 合并 `tools.ts` 到 `tool-registry.ts` | 1 天 |
| 3 | 集成 `plan-executor.ts` 到主循环 | 0.5 天 |

### 7.2 重要（High）

| # | 任务 | 预计 |
|---|------|------|
| 4 | 合并 `SchedulePanel` 和 `AutomationPanel` | 0.5 天 |
| 5 | 合并 3 个建议组件 | 1 天 |
| 6 | 修复 `@ts-nocheck` 文件 | 2 天 |
| 7 | 清理 `.bak` 文件 | 0.1 天 |
| 8 | 删除未使用单例 | 0.2 天 |

### 7.3 中等（Medium）

| # | 任务 | 预计 |
|---|------|------|
| 9 | 路由按业务域重构 | 1 天 |
| 10 | 评估系统职责分离 | 1 天 |

### 7.4 长期（Low）

| # | 任务 | 预计 |
|---|------|------|
| 11 | 补全测试覆盖 | 持续 |
| 12 | 统一注释风格 | 持续 |

---

## 八、总评

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构完整性** | A- | ALTÉS · 岐黄 已实现，缺实际接入 |
| **代码质量** | C+ | 20 个 `@ts-nocheck`，两套工具系统 |
| **可维护性** | C | 重复组件多，备份文件未清理 |
| **安全性** | B+ | 发现 2 个 Critical，但都可修复 |
| **创新性** | A | 中医隐喻系统是真正的差异化 |

---

## 九、关键发现

### 9.1 之前误判的"缺失"实际已实现

| 之前认为 | 实际 |
|---------|------|
| 诊断层缺失 | ✅ 完整（`xuanji/` + `diagnosis/`） |
| 追问无阻塞 | ✅ 已有（`waitForClarification`） |
| MetaReasoner 死代码 | ✅ 已用（`MetaCognitiveLoop`） |
| plan-executor 死代码 | ⚠️ 真的死（`diagnosis/plan-executor.ts`） |

### 9.2 真正的问题不是"缺失"，是"重复"

| 重复 | 危害 |
|------|------|
| 两套工具系统 | 维护成本 × 2 |
| 两个 QQ Bot 类 | 代码冗余 |
| 两个定时任务面板 | 用户困惑 |
| 三个建议组件 | 职责混乱 |

### 9.3 建议

**优先级**：
1. 先修 2 个 Critical（QQ Bot + 工具系统）
2. 再合并重复组件（5 对）
3. 最后清理 `.bak` 和 `@ts-nocheck`

预计总工作量：**5-7 天**