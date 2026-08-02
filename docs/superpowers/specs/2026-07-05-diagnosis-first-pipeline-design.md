# 诊断优先主链路 — 实施设计

> 状态：待用户审阅
> 制定日期：2026-07-05
> 依据：`重构说明 v2.0`（`f:\agentai-platform\.trae\rules\重构说明`）
> 立场：保留 AgentAI Platform 现状，引入"诊断优先"结构化主链路；不采纳 ALTES 品牌重塑
> 范围：仅 P0 最小闭环（感知 → 缺口 → 诊断 → 计划 → 执行 → 验证）

---

## 1. 背景与问题

当前系统主循环承担过多职责（诊断、调度、修复、反思、补轮耦合在一起），
决策多以系统注入和自由文本为主，缺稳定结构化中间产物，前端展示不到
"诊断 → 计划 → 执行 → 验证"的完整链路。

## 2. 目标

跑通最小闭环：
- 模糊需求会先诊断，而不是直接执行
- 复杂任务会先计划，而不是直接大段输出
- 工具执行后的关键步骤有验证结果
- 最终回复可说明"为什么这么做"

## 3. 非目标（明确不做）

- 不重命名现有 packages
- 不把仓库整体迁移成新框架
- 不引入插件市场、生态市场、社区治理
- 不在 P0 阶段做品牌重塑（ALTES 文档作为产品愿景独立推动）
- 不在 P0 阶段实现双阶段生成、辩论室、回阳救逆等高级治法

## 4. 关键发现：现有能力复用

| 文档规划 | 实际已存在 | 复用方式 |
|---------|-----------|---------|
| `task_perception` (望) | `meta/intent-clarifier.ts` | 包装歧义检测 |
| `gap_analysis` (闻) | 同上 `detectAmbiguities` | 包装为 gap_report |
| `diagnosis_engine` (切) | `meta/confidence-estimator.ts` + `meta-cognitive-loop.ts` | 包装为 diagnosis_report |
| `execution_strategy_selector` | `meta/strategy-selector.ts` | 映射为 execution_mode 枚举 |
| `step_verifier` | `judge/self-eval.ts` | 包装为 step_verification_result |
| 计划生成 | `tools.plan_task` | 包装为 plan_assembler |
| 经验沉淀 | `fts5-memory.ts` | P2 阶段再接入 |

**结论**：采用"薄包装优先"策略，**不新建** `diagnosis/ execution/ verification/` 三个平行目录。

## 5. 数据对象（落到 `agentai-core`）

> 全部落到 `packages/agentai-core/src/types/`，纯英文工程命名，不带隐喻。

### 5.1 `TaskPerceptionReport`
```ts
export type TaskType = 'coding' | 'research' | 'design' | 'debugging' | 'creative' | 'general';
export type ComplexityLevel = 'simple' | 'medium' | 'complex';
export type NextAction = 'diagnose' | 'ask_user' | 'plan' | 'execute';

export interface TaskPerceptionReport {
  taskType: TaskType;
  complexity: ComplexityLevel;
  domain: string;
  ambiguityFlags: AmbiguityFlag[];
  knownConstraints: string[];
  missingConstraints: string[];
  suggestedNextAction: NextAction;
  generatedAt: number;
}
```

### 5.2 `DiagnosisReport`
```ts
export type ExecutionMode =
  | 'direct_execute'
  | 'clarify_first'
  | 'plan_first'
  | 'verify_heavy'
  | 'exploratory';
export type ReasoningLevel = 'light' | 'medium' | 'deep';

export interface DiagnosisReport {
  taskSummary: string;
  rootProblem: string;
  constraints: string[];
  successCriteria: string[];
  riskPoints: string[];
  executionMode: ExecutionMode;
  reasoningLevel: ReasoningLevel;
  derivedFrom: string;
  generatedAt: number;
}
```

### 5.3 `ExecutionPlan`
```ts
export type StepType = 'understand' | 'research' | 'execute' | 'verify';

export interface ExecutionStep {
  id: string;
  title: string;
  type: StepType;
  expectedOutput: string;
  toolHint?: string;
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  derivedFrom: string;
  steps: ExecutionStep[];
  createdAt: number;
}
```

### 5.4 `StepVerificationResult`
```ts
export type VerificationStatus = 'pass' | 'fail' | 'uncertain';
export type FollowupAction = 'continue' | 'retry' | 'replan' | 'ask_user';

export interface StepVerificationResult {
  stepId: string;
  status: VerificationStatus;
  evidence: string[];
  followupAction: FollowupAction;
  checkedAt: number;
}
```

## 6. 薄包装层（新增 4 个文件）

> 全部放在 `packages/agentai-gateway/src/diagnosis/`，纯英文命名。

### 6.1 `task-perception.ts`
封装 `IntentClarifier` + 关键词任务分类 + 复杂度估算，输出 `TaskPerceptionReport`。

### 6.2 `diagnosis-engine.ts`
封装 `ConfidenceEstimator` + `StrategySelector`，输出 `DiagnosisReport`。
策略类型 → execution_mode 映射：
| `StrategyType` | `ExecutionMode` |
|---------------|-----------------|
| `minimal` | `direct_execute` |
| `code-first` + `complexity=low` | `direct_execute` |
| `code-first` + `complexity=high` | `plan_first` |
| `tool-heavy` | `verify_heavy` |
| `reasoning-first` | `exploratory` |
| 存在 high-severity ambiguity | `clarify_first` |

### 6.3 `plan-assembler.ts`
根据 `execution_mode` 决定：
- `direct_execute` → 1 步最小计划
- `clarify_first` → 0 步（先 ask_user）
- 其他 → 调 `plan_task` 工具生成计划

### 6.4 `step-verifier.ts`
封装 `judge/self-eval`：
- `pass` → `continue`
- `uncertain` → `retry`
- `fail` + step.type=execute → `retry`
- `fail` + step.type=verify → `replan`
- 其他 → `ask_user`

## 7. 主循环最小侵入（修改 3 个文件）

### 7.1 `agentai-loop.ts`
新增 4 个调用点（每点包 try/catch，失败回退原行为）：
1. 入口：`perception = taskPerception.build(userInput, ctx)`
2. 入口：`diagnosis = diagnosisEngine.diagnose(perception, ctx)`
3. 决策分支：`if (clarify_first) askUser(...)`
4. 每个 step 后：`verification = stepVerifier.verify(step, result)`

### 7.2 `routes/chat.ts`
SSE 流中新增 4 个事件：
- `task_perception_report`
- `diagnosis_report`
- `execution_plan`
- `step_verification_result`

### 7.3 `gui/store/chatStore.ts` + `Thread.tsx`
新增 4 个 UI 卡片（默认折叠）：
- `DiagnosisCard`
- `GapReportCard`（追问时展开）
- `PlanCard`（增强 `TaskPlanPanel`）
- `VerificationCard`（失败时高亮）

## 8. 验收标准

### 8.1 功能验收
| 输入示例 | 期望 execution_mode | 期望行为 |
|---------|---------------------|----------|
| "帮我看看这个文件" | `clarify_first` | 触发追问，显示 GapReportCard |
| "重构 agentai-loop.ts 的工具调度" | `plan_first` | 先生成 3-5 步计划 |
| "写一个 hello world" | `direct_execute` | 跳过计划直接执行 |
| "删库跑路" | `verify_heavy` | 加步骤验证 |
| "创意一个产品名" | `exploratory` | 多步推理 + 多次验证 |

### 8.2 回归指标
- 简单任务延迟增加 ≤ 200ms
- 复杂任务成功率提升 ≥ 10%
- 追问触发率 / 计划触发率 / 验证失败率可采集

### 8.3 工程验收
- `pnpm --filter agentai-gateway typecheck` 通过
- `pnpm --filter agentai-gui typecheck` 通过
- 既有对外接口不变

## 9. 6 天节奏

| Day | 工作项 | 产出 | 回滚成本 |
|-----|--------|------|---------|
| D1 | §5 4 个数据对象 + 单元测试 | `agentai-core/types/*` | 低 |
| D2 | §6.1 task-perception + 测试 | `gateway/diagnosis/task-perception.ts` | 低 |
| D3 | §6.2 diagnosis-engine + 测试 | `gateway/diagnosis/diagnosis-engine.ts` | 低 |
| D4 | §6.3 plan-assembler + §6.4 step-verifier + 测试 | 2 个文件 | 中 |
| D5 | §7.1 主循环接入（4 个调用点） | `agentai-loop.ts` | 中 |
| D6 | §7.2 SSE 事件 + §7.3 前端卡片 | 4 个 UI 卡片 + 4 个事件 | 中 |

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 薄包装层引入额外延迟 | 单元测试覆盖 `build/diagnose` ≤ 50ms |
| 主循环改动影响既有行为 | 4 个调用点全部 try/catch，失败回退 |
| 前端卡片样式冲突 | 复用 `ApprovalCard` / `ClarificationCard` 样式 token |
| 隐喻侵入代码命名 | ESLint 规则禁止中文文件名 + 隐喻标识符 |
| `StrategyType` → `ExecutionMode` 映射不准确 | 完整单元测试覆盖 5x3 组合 |

## 11. 待办（明确边界）

- P1 双阶段生成、多视角方案比较 → P0 完成后启动
- P2 经验沉淀、指标采集 → P0 完成后启动
- 品牌层"望闻问切"等隐喻 → 由产品团队独立推动，不进代码

## 12. 后续

用户审阅本设计通过后：
1. 调用 `writing-plans` 技能把 §5-§7 转成可执行 task 列表（按文件/按人/按日）
2. 逐项落地

