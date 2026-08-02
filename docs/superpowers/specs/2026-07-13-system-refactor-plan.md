# 系统化改造计划：能力封装 + 自动化实现

> 制定日期：2026-07-13
> 背景：全盘审查发现 23 个问题，但核心诉求是**把散落能力封装成技能，实现自动化流转**
> 目标：统一入口、消除冲突、包装成技能、自动化执行

---

## 一、问题总览

### 1.1 入口不一致（截流两三个入口）

| 入口 | 位置 | 触发时机 | 有阻塞等待 | 效果 |
|------|------|---------|----------|------|
| `intent-clarifier` | 主循环入口 | 每轮开始前 | ✅ 有 `waitForClarification()` | 正常工作 |
| `meta-cognitive-loop` | 主循环中段 | 每 0.5 轮检查 | ❌ 无阻塞，只设置 `forceTool` 后 `break` | 死代码 |
| `confidence-estimator` | 主循环后段 | 工具调用后 | ⚠️ 只输出建议，不阻塞 | 不触发追问 |

**问题**：
1. 三个入口互相独立，状态不共享
2. `meta-cognitive-loop` 的 `ask_human` 是死代码
3. 用户回答后无法回到原任务上下文

### 1.2 能力散落（未封装）

| 能力 | 当前位置 | 问题 |
|------|---------|------|
| 任务感知 | `meta/intent-clarifier.ts` | 散落在主循环，未成独立技能 |
| 信息缺口分析 | `meta/intent-clarifier.ts` | 同上 |
| 置信度评估 | `meta/confidence-estimator.ts` | 只输出分数，不触发行为 |
| 元认知决策 | `meta/meta-cognitive-loop.ts` | 有决策无执行 |
| 策略选择 | `meta/strategy-selector.ts` | 选择后无回退 |

### 1.3 自动化缺失

| 环节 | 当前状态 | 问题 |
|------|---------|------|
| 诊断触发 | 手动/硬编码 | 不自动 |
| 追问执行 | `forceTool` + `break` | 不阻塞 |
| 用户回答处理 | 新消息 | 不恢复上下文 |
| 策略切换 | 只记录 | 不执行 |

---

## 二、改造目标

### 2.1 统一入口

**目标**：合并三个入口为一个统一的"诊断层"

```
用户输入 → [诊断层] → 任务感知 + 缺口分析 + 置信度评估 → 输出诊断报告
                                                            ↓
                                          根据报告决定: 直接执行 / 追问 / 降级
```

### 2.2 能力封装成技能

**目标**：把散落的 5 个能力封装成 5 个技能

| 技能名 | 原位置 | 封装后位置 |
|--------|-------|-----------|
| `task-perception` | `intent-clarifier` | `skills/core/task-perception.ts` |
| `gap-analysis` | `intent-clarifier` | `skills/core/gap-analysis.ts` |
| `diagnosis` | `confidence-estimator` + `meta-cognitive-loop` | `skills/core/diagnosis.ts` |
| `strategy-selection` | `strategy-selector` | `skills/core/strategy-selection.ts` |
| `ask-user` | 工具 `ask_user` | `skills/core/ask-user.ts`（升级为技能） |

### 2.3 自动化流转

**目标**：实现"暂停-恢复"机制

```
主循环 → 诊断层触发 → 检测到需要追问 → 暂停主循环 → 
emit('ask_user', { askId, question }) → 前端显示卡片 → 
用户回答 → 后端收到带 askId 的消息 → 恢复主循环继续执行
```

---

## 三、具体改造方案

### 3.1 诊断层统一封装

**新增文件**：`packages/agentai-gateway/src/diagnosis/`

```
diagnosis/
├── index.ts              # 统一入口
├── task-perception.ts    # 任务感知（薄包装 intent-clarifier）
├── gap-analysis.ts       # 缺口分析（薄包装 intent-clarifier）
├── confidence-check.ts   # 置信度检查（薄包装 confidence-estimator）
├── decision.ts           # 决策逻辑（整合 meta-cognitive-loop）
└── types.ts              # 类型定义
```

**核心类型**：

```typescript
// types.ts
export interface DiagnosisReport {
  taskId: string;
  perception: TaskPerceptionReport;
  gaps: GapReport[];
  confidence: ConfidenceReport;
  decision: 'execute' | 'ask' | 'fallback' | 'stop';
  askQuestion?: string;   // decision === 'ask' 时的问题
  fallbackStrategy?: string;
}

export interface TaskPerceptionReport {
  complexity: 'simple' | 'medium' | 'complex' | 'difficult';
  domain: string;
  urgency: 'normal' | 'urgent' | 'critical';
  explicitNeeds: string[];
  implicitSignals: string[];
}

export interface GapReport {
  gap: string;
  importance: 'critical' | 'important' | 'minor';
  action: 'ask' | 'self_fill' | 'defer' | 'respect';
}
```

### 3.2 技能封装

**新增文件**：`skills/core/`

```
skills/core/
├── SKILL.md              # 技能描述
├── task-perception.ts    # 任务感知技能
├── gap-analysis.ts       # 缺口分析技能
├── diagnosis.ts          # 诊断技能
├── strategy-selection.ts # 策略选择技能
└── ask-user.ts           # 追问技能（升级）
```

**技能注册**（`SKILL.md`）：

```markdown
---
name: diagnosis
description: 诊断技能 - 在执行前分析任务、识别缺口、评估置信度
triggers:
  - 每轮主循环开始前自动触发
tools:
  - ask_user
  - plan_task
  - web_search
---
```

### 3.3 暂停-恢复机制

**主循环改动**（`agentai-loop.ts`）：

```typescript
// 新增属性
private pendingAsk: { askId: string; question: string } | null = null;

// 诊断触发后
async runDiagnosticLayer(message: string): Promise<DiagnosisReport> {
  const report = await diagnosisEngine.analyze(message, this.context);
  
  if (report.decision === 'ask') {
    // 暂停主循环
    this.pendingAsk = { askId: uuid(), question: report.askQuestion! };
    this.emit('ask_user', { askId: this.pendingAsk.askId, question: report.askQuestion });
    
    // 等待用户回答
    const answer = await this.waitForAskResponse(this.pendingAsk.askId, 60_000);
    
    // 恢复主循环，注入答案
    this.context.appendOnlyLog.push({
      role: 'system',
      content: `[追问回答] ${answer}`
    });
  }
  
  return report;
}

// 新增等待方法
waitForAskResponse(askId: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      this.pendingAsks.delete(askId);
      resolve(''); // 超时返回空，继续执行
    }, timeoutMs);
    this.pendingAsks.set(askId, { resolve, reject, timer });
  });
}

// 路由端点调用
resolveAskResponse(askId: string, answer: string): boolean {
  const entry = this.pendingAsks.get(askId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  this.pendingAsks.delete(askId);
  entry.resolve(answer);
  return true;
}
```

### 3.4 前端改动

**ChatView.tsx**：

```typescript
// onAskUser 回调增加 askId
onAskUser: (info: { askId: string; question: string; options: any[] }) => {
  setAskUserCard({ askId: info.askId, question: info.question, options: info.options });
},

// 发送答案时附加 askId
onAnswer={(answer) => {
  const answerText = Array.isArray(answer) ? answer.join(', ') : answer;
  handleSend(answerText, { meta: { askId: askUserCard.askId, type: 'ask_response' } });
  setAskUserCard(null);
}}
```

### 3.5 后端路由改动

**routes/chat.ts**：

```typescript
// 识别追问答案
if (req.body.meta?.type === 'ask_response') {
  const { askId } = req.body.meta;
  const loop = sessionManager.get(sessionKey)?.loop;
  if (loop?.resolveAskResponse) {
    loop.resolveAskResponse(askId, req.body.message);
    // 不启动新循环，只是恢复等待中的循环
    return;
  }
}
```

---

## 四、改造步骤（按优先级）

### Phase 1：统一诊断层（本周）

| 步骤 | 内容 | 产出 |
|------|------|------|
| P1-1 | 创建 `diagnosis/` 目录 + 类型定义 | `diagnosis/types.ts` |
| P1-2 | 薄包装 `task-perception.ts` | 复用 `intent-clarifier` |
| P1-3 | 薄包装 `gap-analysis.ts` | 复用 `intent-clarifier` |
| P1-4 | 薄包装 `confidence-check.ts` | 复用 `confidence-estimator` |
| P1-5 | 整合 `decision.ts` | 替代 `meta-cognitive-loop` |

### Phase 2：暂停-恢复机制（下周）

| 步骤 | 内容 | 产出 |
|------|------|------|
| P2-1 | 主循环增加 `pendingAsk` + `waitForAskResponse` | `agentai-loop.ts` |
| P2-2 | 路由识别 `meta.ask_response` | `routes/chat.ts` |
| P2-3 | 前端发送 `askId` | `ChatView.tsx` |
| P2-4 | 端到端测试 | 3 个测试用例 |

### Phase 3：技能封装（后续）

| 步骤 | 内容 | 产出 |
|------|------|------|
| P3-1 | 迁移诊断层到 `skills/core/` | 5 个技能文件 |
| P3-2 | 注册技能到 `skills-loader` | 自动加载 |
| P3-3 | 技能触发机制 | 主循环自动调用 |

---

## 五、预期效果

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 入口数量 | 3 个独立入口 | 1 个统一诊断层 |
| 追问处理 | 死代码 | 暂停-恢复机制 |
| 用户回答 | 新消息 | 恢复到原任务 |
| 能力状态 | 散落在主循环 | 封装成 5 个技能 |
| 自动化程度 | 手动/硬编码 | 自动流转 |

---

## 六、风险与应对

| 风险 | 应对 |
|------|------|
| 主循环改动影响现有功能 | 增量修改，不删除旧代码 |
| 暂停-恢复机制复杂 | 参考 `waitForClarification()` 已有模式 |
| 前端改动量大 | 最小改动：只增加 `askId` |
| 技能封装后性能下降 | 薄包装，不重复计算 |

---

## 七、下一步

1. ✅ 确认改造方案
2. 🔜 开始 Phase 1：创建 `diagnosis/types.ts`
3. 🔜 逐步薄包装现有能力
4. 🔜 实现 Phase 2 的暂停-恢复机制

---

**关键结论**：不是简单修复 bug，而是**系统化改造**——统一入口、封装能力、实现自动化。