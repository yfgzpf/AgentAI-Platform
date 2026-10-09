# 把「AI 的工作条理」赋予系统：执行纪律层设计方案

> 生成日期：2026-10-09
> 来源：富哥观察到「AI 做任务条理清晰、任务明确、权限清晰、知道如何做更好」，问能否把这能力赋予系统
> 结论：**能，而且骨架已经有了**。缺的只是把骨架从「建议」变成「纪律」的三条硬规则。

---

## 零、先破除一个误解

「把我赋予系统」不是把我的提示词抄进代码。我的条理性来自三样东西：

| 我的条理来源 | 是否可代码化 |
|---|---|
| 每次动手前先读现状（不盲信） | ✅ 可��成 = 前置校验器 |
| 任务拆成有依赖关系的批次，每批有验收 | ✅ 可代码化 = 可执行验收断言 |
| 不可逆动作前必建锚点 | ✅ 可代码化 = 闸门中间件 |
| 权限清晰（我能改什么、不能改什么） | ✅ 可代码化 = 权限分级 |
| 训练出来的判断力（怎么想更合适） | ❌ 不可直接复制，只能**约束+示范** |

**能代码化的是前四项**——而这四项恰好是「条理清晰」的可观测外壳。

---

## 一、实测：你已经有三块骨架（不是空想）

### 骨架 1：阶段化执行 — `goal-runner.ts`（368 行）

```ts
export interface GoalStage {
  key: string;
  label: string;
  description: string;
  parallelizable: boolean;      // 可并行 → 委派 subagent
  acceptanceCriteria: string;   // 验收标准
  requireHumanApproval?: boolean; // 人工闸门
}
```
外加 `GoalProgress` 的 `skipStages`（断点续跑跳过已完成阶段）+ `pendingApproval`（暂停等审批）。
**已被主循环使用**：`agentai-loop.ts:6178` 动态 import 调 `runWithGoal`，`routes/goal.ts` 有 SSE 端点。

### 骨架 2：审批分级 — `approval-policy.ts`（354 行）

四级风险 `low|medium|high|critical` + `ModificationProposal` 提案机制 + `submitModification` / `approveModification`。

### 骨架 3：断点续跑 — `task-supervisor.ts`（461 行）

`checkHealth()` / `detectInterruption()` / `shouldAutoResume()` / `generateTaskResumeContext()` / 计时器 + 文件变更统计。
**已被主循环使用**：`agentai-loop.ts:1740` 调 `getTaskSupervisor()`。

### 配套
- `task-scheduler.ts`（568 行）· `task-ledger.ts`（291 行）· `task-snapshot.ts`（1,030 行）· `agent-task-store.ts`（321 行）· `governor/runtime-capability-tracker.ts`（656 行）

**任务域合计 3,910 行，骨架相当完整。**

---

## 二、实测：缺的是这三环（这才是「条理」的真实来源）

### 环一 · 验收标准只是字符串，不是断言 ❌ 致命

**证据**：`grep -rn "acceptanceCriteria"` 全项目，goal-runner 内部 4 处**全部是拼进 prompt 文本**：
```ts
const prompt = `验收标准: ${stage.acceptanceCriteria}\n\n请开始执行此阶段的任务。`;
```
**零处机器校验**。这意味着——**模型自己说「完成了」就算完成**。

我每轮做的事，系统做不到：跑 `tsc --noEmit` 看是不是 0、`vitest run` 看是不是绿、`git status` 看只 stage 了目标路径。**系统把验收标准当提示词，模型就只会当参考建议。**

### 环二 · 没有不可逆操作的闸门与预演 ❌

`approval-policy` 管的是「改什么要审批」，管不了「删之前能不能先看一眼」。

我删 31 个文件前的动作是：①建 git 锚点 ②逐个 git grep 验 0 引用 ③分批删 ④每批 tsc ⑤任一失败立刻回滚。
**这套「不可逆动作前置纪律」在系统里不存在。** `feature-flags.ts` 有一点雏形，但没接到执行链上。

### 环三 · 任务状态只存在于运行时，不落盘 ⚠️

`task-scheduler` / `task-ledger` 在，但缺「谁在第几步 / 卡在哪 / 为何卡 / 上次验证结果」的**持久可恢复视图**。

我每轮开工第一件事是 `git status` + 读现状——这是「外部记忆」。系统重启后，这些信息全丢，只能靠模型回忆。

---

## 三、设计：执行纪律层（`discipline/` 目录，约 600-900 行）

### 层 1 · 验收断言器 `discipline/assertions.ts`

**核心：把 `acceptanceCriteria: string` 升级为 `acceptanceCriteria: AcceptanceAssert[]`。**

```ts
export type AcceptanceAssert =
  | { kind: 'command'; cmd: string; expect: 'exit0' | 'exitN'; exitCode?: number; timeoutMs?: number }
  | { kind: 'grep'; pattern: string; path: string; expect: 'found' | 'absent'; minCount?: number }
  | { kind: 'fileExists'; path: string }
  | { kind: 'lineCount'; path: string; mode: 'lte' | 'gte'; value: number }
  | { kind: 'llmJudge'; rubric: string; threshold: number };  // 语义类兜底

export interface StageGate {
  stageKey: string;
  asserts: AcceptanceAssert[];
  onFail: 'halt' | 'retry' | 'rollbackAndHalt';
  maxRetries: number;
}

export function verifyStage(gate: StageGate, ctx: RunContext): GateResult;
```

**兼容旧数据**：字符串形式 `acceptanceCriteria` 自动降级为 `{ kind: 'llmJudge', rubric: 原字符串, threshold: 0.7 }`，**不破坏现有 368 行 goal-runner**。

**内置断言集（把我每轮做的事固化下来）**：
- `no-orphan-after-delete`：删除后 `git grep` 每个被删文件应 0 命中
- `typecheck-clean`：`npx tsc --noEmit` expect exit0
- `test-green`：`vitest run` expect exit0
- `build-pass`：`node scripts/build.mjs` expect exit0
- `no-unstaged-pollution`：`git status --short` 变更数不超过预期
- `guardzone-untouched`：绿区目录（soul/qihuang/xuanji/diagnosis）diff 必须为空 ← **把你「不越界」纪律变成机器断言**

### 层 2 · 不可逆动作闸门 `discipline/gates.ts`

```ts
export type IrreversibleKind =
  | 'delete-file' | 'delete-dir' | 'overwrite' | 'git-reset' | 'git-clean'
  | 'db-migrate' | 'publish' | 'external-send';

export interface IrreversibleRule {
  kind: IrreversibleKind;
  requiresAnchor: boolean;       // 必须先建回滚锚点
  requiresDryRun: boolean;       // 必须先预演
  requiresApproval: boolean;     // 是否需人工确认
  anchorCmd?: string;            // 如 git commit / cp -r
  dryRunCmd?: string;
}

export function gate(plan: ActionPlan, ctx: RunContext): GateDecision;
```

**默认策略**：
| 动作 | 锚点 | 预演 | 审批 |
|---|---|---|---|
| delete-file | ✅ 强制 | ✅ `git grep` 验引用 | 低风险批免 |
| git-reset / git-clean | ✅ 强制 | ✅ 显示影响文件数 | ✅ 必须人工 |
| overwrite（改已存在文件） | ✅ 强制 | ✅ 显示 diff 摘要 | 否 |
| external-send（发 QQ/微信/公众号） | — | ✅ 显示内容预览 | ✅ 必须人工 |
| db-migrate | ✅ 强制备份 | ✅ dry-run | ✅ 必须人工 |

**未建锚点就执行 delete → 直接拒绝并返回"请先执行锚点命令"**。这是硬拒绝，不是提示。

### 层 3 · 执行记事本 `discipline/notebook.ts`

**把「我为什么这么做」落盘**，这是可跨会话、可审计的外部记忆：

```ts
export interface RunNotebook {
  runId: string;
  goal: string;
  createdAt: number;
  decisionLog: Array<{
    at: number;
    decision: string;       // 「删 W1 前先建锚点，因为工作区有 335 个未提交改动」
    evidence: string[];     // ['git status: 335 files', 'tsc baseline: 0 errors']
    reversible: boolean;
  }>;
  stages: Array<{
    key: string; status: 'pending'|'running'|'passed'|'failed'|'blocked';
    gateResult?: GateResult;
    startedAt?: number; endedAt?: number;
    failureReason?: string;
  }>;
  anchors: Array<{ type: 'commit'|'backup'|'snapshot'; ref: string; at: number; description: string }>;
}

export function saveNotebook(nb: RunNotebook): void;   // 落盘 .workbuddy/runs/<runId>.json
export function loadNotebook(runId: string): RunNotebook | null;
export function resumeFrom(nb: RunNotebook): ResumePlan; // 重启后从这里接着跑
```

**这一层直接打通你之前审计出的 P0 缺失「处方-执行断链」**——处方（GoalPlan）有了，执行记事本（RunNotebook）有了，两者用 `runId` 关联，链就通了。

### 层 4 · 纪律接线（在 goal-runner 上打三个补丁）

```
阶段开始前 → gate.plan(stage.actions)      // 不可逆闸门
阶段执行后 → verifyStage(stage.gate)        // 验收断言
全过程中   → notebook.record(...)          // 决策留痕
```

改动量：`goal-runner.ts` 加约 120 行调用，其余三个新文件 600-900 行。**不重写任何现有模块。**

---

## 四、执行顺序

| 阶段 | 内容 | 行数 | 前置 |
|---|---|---|---|
| D1 | 断言器 + 内置断言集（typecheck/test/build/no-orphan/guardzone） | ~350 | 无 |
| D2 | 不可逆闸门 + 拒绝策略 | ~200 | D1 |
| D3 | 执行记事本（落盘 + 恢复） | ~250 | D1 |
| D4 | goal-runner 三点接线 + 兼容降级 | ~120 | D1-D3 |
| D5 | 一个真实任务跑通端到端验证 | — | D4 |

---

## 五、这件事的战略意义

这不是"抄我的工作习惯"，而是把你项目审计出的三个 P0 缺口一起补上：

| 审计发现的缺口 | 本方案对应 |
|---|---|
| StepExecutor（施治引擎）缺失 | 层 4 接线：每阶段真的执行并验证 |
| 处方-执行断链 | 层 3 记事本：GoalPlan ↔ RunNotebook 用 runId 关联 |
| 连续状态监控 | 层 3 恢复：`resumeFrom()` 跨会话续跑 |

**而且它同时补上了你问的"突破能力边界"里最实的那一个**：一个会给自己建锚点、会自己验收、失败会自己回滚、断了能自己接上的 agent——**这才是可信的自主性**，比任何提示词技巧都硬。

**中医叙事对齐**：这就是「治未病」——不是等坏了再修，是每次动手前先立规矩；「常慎微」= 每个阶段的断言；「善诊者察内外」= 环一的机器校验；「有故无死」= 层 2 的不可逆闸门。

---

## 六、需要你拍板

1. **是否现在开工 D1**（断言器，350 行，零风险，纯新增不影响现有代码）
2. 内置断言集优先做哪几个？（建议先 `typecheck-clean` + `guardzone-untouched`——这两个立刻能拦住最贵的错）
3. 是否要做层 3（记事本）？它是打通"处方-执行断链"的关键，但工作量最大、涉及落盘格式设计