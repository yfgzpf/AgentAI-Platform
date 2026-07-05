# ALTES | 岐黄 框架审查报告

> 审查日期：2026-07-05
> 审查范围：diagnosis/ cost/ 模块及集成点

---

## 一、发现的问题

### 🔴 严重问题（必须修复）

#### 1. API 调用错误 - gap-analyzer-llm.ts

**问题**：使用了错误的参数名
```typescript
// 错误代码（第71行）
max_tokens: 200,  // ❌ 应该是 maxTokens

// 正确应该是
maxTokens: 200,
```

**影响**：TypeScript 编译可能通过，但运行时参数无效，模型可能返回超长输出，导致 token 成本失控。

**修复**：
```typescript
const response = await router.chat({
  model: 'agentai',
  messages: [...],
  temperature: 0.3,
  maxTokens: 200,  // ✅ 修正
});
```

---

### 🟡 中等问题（建议修复）

#### 2. 类型定义不一致

**问题**：`AgentAIRoader` 拼写错误
```typescript
// gap-analyzer-llm.ts 第138行
export async function analyzeGaps(
  message: string,
  router: AgentAIRoader,  // ❌ 应该是 AgentAIRouter
  ...
)
```

**影响**：类型检查失败，可能导致运行时错误。

---

#### 3. 成本追踪事件监听内存泄漏

**问题**：chat.ts 中每次请求都添加事件监听器
```typescript
// chat.ts
const costTracker = getCostTracker();
costTracker.on('alert', (alert) => {  // ❌ 每次请求都添加，永不移除
  console.warn(`[cost-alert] ${alert.severity}: ${alert.message}`);
});
```

**影响**：长时间运行后，事件监听器累积，内存泄漏。

**修复**：
```typescript
// 只监听一次，或及时移除
const onAlert = (alert) => console.warn(...);
costTracker.once('alert', onAlert);  // 使用 once 而不是 on
```

---

#### 4. 任务ID冲突风险

**问题**：使用简单的时间戳作为任务ID
```typescript
const taskId = `${userId}-${Date.now()}`;
```

**影响**：同一毫秒内的并发请求会产生相同ID。

**修复**：
```typescript
import { randomUUID } from 'crypto';
const taskId = randomUUID();
```

---

#### 5. 成本追踪器单例状态污染

**问题**：CostTracker 是单例，但任务数据存储在实例中
```typescript
// 如果服务重启或集群部署，数据丢失
```

**影响**：无法做跨进程/跨服务器的成本统计。

**建议**：短期可接受，长期需要持久化存储。

---

### 🟢 轻微问题（优化建议）

#### 6. 未使用的文件

**问题**：以下文件创建后未被使用
- `diagnosis/task-perception.ts`
- `diagnosis/diagnosis-engine.ts`
- `diagnosis/plan-assembler.ts`
- `diagnosis/step-verifier.ts`
- `diagnosis/plan-executor.ts`
- `diagnosis/gap-analyzer.ts` (被 gap-analyzer-llm.ts 替代)
- `diagnosis/constants.ts`

**建议**：删除或归档，减少维护负担。

---

#### 7. 诊断流程缺少切阶段

**问题**：当前只有望、闻、问三个阶段，缺少切阶段（分层诊断）

**规范要求**：
```
望 → 闻 → 问 → 切 → 治 → 调方
```

**当前实现**：
```
望(quickDiagnose) → 闻(gap-analyzer) → 问(澄清)
```

**影响**：诊断深度不足，复杂任务可能直接进入执行。

---

#### 8. 成本摘要未返回给前端

**问题**：成本摘要只在非流式模式下返回
```typescript
if (!stream) {
  return res.json({
    ...,
    costSummary: summary,  // 只有这里
  });
}
```

**影响**：流式模式下前端无法获取成本信息。

**建议**：通过 SSE 事件发送成本摘要。

---

## 二、架构风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| Token成本失控 | 🔴 高 | API参数错误可能导致超额消耗 |
| 内存泄漏 | 🟡 中 | 事件监听器累积 |
| 数据丢失 | 🟡 中 | 单例状态不持久化 |
| 并发冲突 | 🟡 中 | 任务ID可能重复 |
| 维护困难 | 🟢 低 | 未使用文件过多 |

---

## 三、修复优先级

### P0（立即修复）
1. ✅ 修复 `max_tokens` → `maxTokens`
2. ✅ 修复 `AgentAIRoader` → `AgentAIRouter`

### P1（本周修复）
3. 修复事件监听器内存泄漏
4. 修复任务ID生成（使用 UUID）
5. 流式模式发送成本摘要

### P2（可选优化）
6. 删除未使用文件
7. 实现切阶段（分层诊断）
8. 成本数据持久化

---

## 四、修复代码

### 修复1：gap-analyzer-llm.ts

```typescript
// 第71行
maxTokens: 200,  // 不是 max_tokens

// 第138行
router: AgentAIRouter,  // 不是 AgentAIRoader
```

### 修复2：chat.ts 事件监听

```typescript
// 修改前
costTracker.on('alert', (alert) => {
  console.warn(`[cost-alert] ${alert.severity}: ${alert.message}`);
});

// 修改后
const onAlert = (alert) => {
  console.warn(`[cost-alert] ${alert.severity}: ${alert.message}`);
};
costTracker.once('alert', onAlert);
```

### 修复3：任务ID生成

```typescript
// 修改前
const taskId = `${userId}-${Date.now()}`;

// 修改后
import { randomUUID } from 'crypto';
const taskId = randomUUID();
```

---

## 五、总体评估

### 已实现 ✅
- 望阶段：快速诊断（0 token）
- 闻阶段：缺口分析（~100 token，免费模型）
- 问阶段：澄清问题生成（0 token）
- 成本追踪：阶段级记录
- 成本告警：预算超限提醒

### 缺失 ⚠️
- 切阶段：分层诊断（简单/中等/复杂/疑难）
- 治阶段：治疗计划成本追踪
- 调方阶段：方案调整成本追踪
- 成本Dashboard：可视化

### 风险等级
**当前**：🟡 中等风险（有已知bug，但框架可用）

**修复后**：🟢 低风险

---

## 六、建议

1. **立即修复 P0 问题**，确保系统稳定运行
2. **本周修复 P1 问题**，提升可靠性
3. **评估是否继续完善**切/治/调方阶段，还是保持当前轻量实现
4. **考虑成本数据持久化**，支持跨进程统计

---

*报告生成时间：2026-07-05*
