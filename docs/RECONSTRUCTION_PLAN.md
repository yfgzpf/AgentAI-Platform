# ALTES | 岐黄 诊断优先主链路重构计划

> 制定日期：2026-07-05
> 目标：将现有 60% 散落的认知决策能力整合为统一的"先诊后治"主链路

---

## 一、重构原则

### 1.1 核心原则
- **薄包装**：复用现有模块，只写胶水代码
- **渐进式**：从 60% 到 100%，不推倒重来
- **可回滚**：Feature Flag 控制，随时禁用
- **可测试**：每个模块独立测试

### 1.2 技术约束
- 不动 `chat.ts` 主循环核心逻辑（4120 行稳定代码）
- 不引入新语言（保持 TypeScript）
- 不重命名 packages（违反 AGENTS.md）

---

## 二、阶段划分

### 阶段 1：基础类型与接口（Day 1-2）
**目标**：建立类型安全基础

| 任务 | 文件 | 产出 |
|------|------|------|
| 诊断类型定义 | `src/types/diagnosis.ts` | 4 个核心接口 |
| 事件类型定义 | `src/types/events.ts` | SSE 事件类型 |
| 常量定义 | `src/diagnosis/constants.ts` | 复杂度权重、治法映射 |

**验收标准**：
- [ ] TypeScript 编译通过
- [ ] 类型定义覆盖所有场景
- [ ] 单元测试通过

---

### 阶段 2：任务感知层（Day 3-4）
**目标**：实现"望闻"两层

| 任务 | 文件 | 复用模块 |
|------|------|---------|
| 任务感知 | `src/diagnosis/task-perception.ts` | `classifyComplexity()` |
| 意图澄清 | `src/diagnosis/intent-clarifier.ts` | `IntentClarifier` |
| 缺口分析 | `src/diagnosis/gap-analyzer.ts` | 新增 |

**核心逻辑**：
```typescript
// 任务感知流程
export async function perceiveTask(messages: Message[]): Promise<TaskPerceptionReport> {
  const userText = extractUserText(messages);
  
  // 1. 复杂度分析（复用现有）
  const complexity = classifyComplexity(userText, estimateLength(messages));
  
  // 2. 意图澄清（复用现有）
  const clarification = await intentClarifier.analyze(userText);
  
  // 3. 缺口分析（新增）
  const gaps = analyzeGaps(clarification, complexity);
  
  // 4. 决策行动
  const action = determineAction(gaps, complexity);
  
  return { taskType, complexity, ambiguity, gapList: gaps, suggestedAction: action };
}
```

**验收标准**：
- [ ] 能正确识别任务类型
- [ ] 能检测信息缺口
- [ ] 能建议正确行动（proceed/ask/self_fill/defer）

---

### 阶段 3：诊断引擎（Day 5-6）
**目标**：实现"切"层

| 任务 | 文件 | 复用模块 |
|------|------|---------|
| 置信度评估 | `src/diagnosis/confidence-estimator.ts` | `ConfidenceEstimator` |
| 风险分析 | `src/diagnosis/risk-analyzer.ts` | 新增 |
| 策略选择 | `src/diagnosis/strategy-selector.ts` | `StrategySelector` |

**核心逻辑**：
```typescript
// 诊断流程
export async function diagnoseTask(
  perception: TaskPerceptionReport,
  context: Context
): Promise<DiagnosisReport> {
  // 1. 置信度评估
  const confidence = await estimateConfidence(perception, context);
  
  // 2. 风险分析
  const risk = analyzeRisk(perception, confidence);
  
  // 3. 策略选择
  const strategy = selectStrategy(perception, risk);
  
  return {
    confidence: confidence.score,
    riskLevel: risk.level,
    recommendedApproach: strategy.approach,
    estimatedSteps: strategy.steps,
    potentialBlockers: risk.blockers
  };
}
```

**验收标准**：
- [ ] 能评估任务置信度
- [ ] 能识别潜在风险
- [ ] 能选择合适策略

---

### 阶段 4：治疗计划（Day 7-8）
**目标**：实现"治"层

| 任务 | 文件 | 复用模块 |
|------|------|---------|
| 计划组装 | `src/diagnosis/plan-assembler.ts` | 新增 |
| 步骤验证 | `src/diagnosis/step-verifier.ts` | `SelfEval` |
| 方案调整 | `src/diagnosis/plan-adjuster.ts` | 新增 |

**核心逻辑**：
```typescript
// 治疗计划流程
export function assemblePlan(
  diagnosis: DiagnosisReport,
  perception: TaskPerceptionReport
): TreatmentPlan {
  // 1. 拆解步骤
  const steps = decomposeTask(perception, diagnosis);
  
  // 2. 生成验证点
  const verificationPoints = steps.map(s => s.verificationMethod);
  
  // 3. 制定回滚策略
  const rollbackStrategy = generateRollback(steps);
  
  return { steps, verificationPoints, rollbackStrategy };
}

// 步骤验证
export async function verifyStep(
  step: PlanStep,
  result: any
): Promise<VerificationResult> {
  const evaluation = await selfEval.evaluate(result, step.expectedOutput);
  
  return {
    passed: evaluation.passed,
    score: evaluation.score,
    issues: evaluation.issues,
    suggestion: evaluation.suggestion
  };
}
```

**验收标准**：
- [ ] 能生成完整治疗计划
- [ ] 能验证步骤执行结果
- [ ] 能根据验证结果调整方案

---

### 阶段 5：主循环集成（Day 9-10）
**目标**：将诊断链路插入主循环

**修改文件**：`src/routes/chat.ts`

**插入点**（4 个）：

```typescript
// 插入点 1: 请求入口
export async function chatHandler(req: Request, res: Response) {
  // 新增：任务感知
  const perception = await perceiveTask(req.body.messages);
  
  // 如果歧义高，先询问用户
  if (perception.suggestedAction === 'ask') {
    return res.json({ type: 'clarification_needed', gaps: perception.gapList });
  }
  
  // 新增：结构化诊断
  const diagnosis = await diagnoseTask(perception, req.context);
  
  // 新增：生成治疗计划
  let plan: TreatmentPlan | undefined;
  if (diagnosis.recommendedApproach === 'multi_step') {
    plan = assemblePlan(diagnosis, perception);
  }
  
  // 启动主循环（传入诊断信息）
  const loop = new AgentAILoop(router, registry, req.body.messages, {
    plan,
    diagnosis,
    enableDiagnosis: true // Feature Flag
  });
  
  // ... 原有逻辑
}

// 插入点 2: 每次迭代后
async function runIteration(loop: AgentAILoop) {
  const result = await loop.step();
  
  // 新增：步骤验证
  if (loop.config.plan && loop.config.enableDiagnosis) {
    const currentStep = loop.config.plan.steps[loop.currentStepIndex];
    const verification = await verifyStep(currentStep, result);
    
    if (!verification.passed) {
      await loop.handleVerificationFailure(verification);
    }
  }
  
  return result;
}

// 插入点 3: 错误处理
async function handleError(error: Error, loop: AgentAILoop) {
  // 新增：诊断错误并调整方案
  if (loop.config.enableDiagnosis && loop.config.plan) {
    const adjustedPlan = await adjustPlan(loop.config.plan, error);
    loop.updatePlan(adjustedPlan);
  }
}

// 插入点 4: 完成时
async function onComplete(result: any, loop: AgentAILoop) {
  // 新增：总结执行过程
  if (loop.config.enableDiagnosis) {
    const summary = generateExecutionSummary(loop);
    await loop.memory.storeSummary(summary);
  }
}
```

**验收标准**：
- [ ] 4 个插入点正确集成
- [ ] Feature Flag 可正常开关
- [ ] 原有功能不受影响

---

### 阶段 6：SSE 事件与前端（Day 11-12）
**目标**：前端可视化诊断过程

**后端**：`src/routes/chat.ts`

```typescript
// 发送诊断事件
function sendDiagnosisEvent(res: Response, type: string, data: any) {
  res.write(`event: diagnosis\ndata: ${JSON.stringify({ type, data })}\n\n`);
}

// 在诊断各阶段调用
sendDiagnosisEvent(res, 'task_perception', perception);
sendDiagnosisEvent(res, 'diagnosis_report', diagnosis);
sendDiagnosisEvent(res, 'treatment_plan', plan);
sendDiagnosisEvent(res, 'step_verification', verification);
```

**前端**：`src/components/DiagnosisPanel.tsx`

```typescript
export const DiagnosisPanel: React.FC = () => {
  const [state, setState] = useState<DiagnosisState>({});
  
  useEffect(() => {
    const es = new EventSource('/v1/chat/events');
    es.addEventListener('diagnosis', (e) => {
      const { type, data } = JSON.parse(e.data);
      setState(prev => ({ ...prev, [type]: data }));
    });
    return () => es.close();
  }, []);
  
  return (
    <div className="diagnosis-panel">
      {state.task_perception && <TaskPerceptionCard data={state.task_perception} />}
      {state.diagnosis_report && <DiagnosisReportCard data={state.diagnosis_report} />}
      {state.treatment_plan && <TreatmentPlanCard data={state.treatment_plan} />}
      {state.step_verification && <StepVerificationCard data={state.step_verification} />}
    </div>
  );
};
```

**验收标准**：
- [ ] SSE 事件正确发送
- [ ] 前端卡片正确显示
- [ ] 4 类诊断信息完整展示

---

### 阶段 7：测试与优化（Day 13-14）
**目标**：确保稳定性

| 任务 | 内容 |
|------|------|
| 单元测试 | 每个诊断模块独立测试 |
| 集成测试 | 完整链路测试 |
| 性能测试 | 诊断延迟 < 200ms |
| 回归测试 | 原有功能不受影响 |

**验收标准**：
- [ ] 测试覆盖率 > 80%
- [ ] 诊断延迟 < 200ms
- [ ] 无回归 bug

---

## 三、文件结构

```
packages/agentai-gateway/src/
├── types/
│   ├── diagnosis.ts          # 诊断类型定义
│   └── events.ts             # 事件类型定义
├── diagnosis/                # 诊断优先链路
│   ├── constants.ts          # 常量定义
│   ├── task-perception.ts    # 任务感知（望）
│   ├── intent-clarifier.ts   # 意图澄清（闻）
│   ├── gap-analyzer.ts       # 缺口分析（问）
│   ├── confidence-estimator.ts # 置信度评估（切）
│   ├── risk-analyzer.ts      # 风险分析
│   ├── strategy-selector.ts  # 策略选择
│   ├── plan-assembler.ts     # 计划组装（治）
│   ├── step-verifier.ts      # 步骤验证
│   └── plan-adjuster.ts      # 方案调整（调方）
├── routes/
│   └── chat.ts               # 主循环（插入 4 点）
└── ...

packages/agentai-gui/src/
├── components/
│   ├── DiagnosisPanel.tsx    # 诊断面板
│   ├── TaskPerceptionCard.tsx
│   ├── DiagnosisReportCard.tsx
│   ├── TreatmentPlanCard.tsx
│   └── StepVerificationCard.tsx
└── ...
```

---

## 四、Git 工作流

```bash
# 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/diagnosis-pipeline

# 按阶段提交
git add . && git commit -m "diagnosis(types): Day 1-2 - add type definitions"
git add . && git commit -m "diagnosis(gateway): Day 3-4 - add task perception layer"
git add . && git commit -m "diagnosis(gateway): Day 5-6 - add diagnosis engine"
git add . && git commit -m "diagnosis(gateway): Day 7-8 - add treatment plan"
git add . && git commit -m "diagnosis(gateway): Day 9-10 - integrate into main loop"
git add . && git commit -m "diagnosis(gui): Day 11-12 - add diagnosis visualization"
git add . && git commit -m "diagnosis(test): Day 13-14 - add tests and optimization"

# 合并回 develop
git checkout develop
git merge feature/diagnosis-pipeline
git push origin develop
```

---

## 五、Feature Flag

```typescript
// config.ts
export const FEATURE_FLAGS = {
  enableDiagnosisPipeline: true,  // 总开关
  enableTaskPerception: true,     // 任务感知
  enableDiagnosisReport: true,    // 诊断报告
  enableTreatmentPlan: true,      // 治疗计划
  enableStepVerification: true,   // 步骤验证
};

// 使用
if (FEATURE_FLAGS.enableDiagnosisPipeline) {
  const perception = await perceiveTask(messages);
  // ...
}
```

---

## 六、风险缓解

| 风险 | 缓解措施 |
|------|---------|
| 主循环改动引入 bug | Feature Flag 可快速关闭 |
| 诊断增加延迟 | 异步执行 + 简单任务跳过 |
| 类型不兼容 | 严格 TypeScript 检查 |
| 测试覆盖不足 | 每个模块独立测试 |

---

## 七、立即开始

```bash
# 1. 创建分支
git checkout -b feature/diagnosis-pipeline

# 2. 创建目录
mkdir -p packages/agentai-gateway/src/types
mkdir -p packages/agentai-gateway/src/diagnosis
mkdir -p packages/agentai-gui/src/components/diagnosis

# 3. Day 1 开始
touch packages/agentai-gateway/src/types/diagnosis.ts
# ... 开始编码
```

---

**14 天后，ALTES | 岐黄 将拥有完整的"望闻问切 → 因证施治 → 调方"诊断优先链路。**
