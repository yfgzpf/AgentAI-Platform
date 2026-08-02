# AgentAI Platform 全盘审查报告

> 审查日期：2026-07-13
> 审查范围：6 大维度（技能/卡片/工具/决策/记忆/前端）
> 审查立场：**批判性发现问题，优先级排序，提供修复路径**

---

## 〇、总览

| 维度 | 发现问题数 | Critical | High | Medium | Low |
|------|-----------|----------|------|--------|-----|
| 1. 技能系统 | 5 | 0 | 1 | 4 | 0 |
| 2. 卡片系统 | 4 | 1 | 2 | 1 | 0 |
| 3. 工具调用链 | 3 | 0 | 2 | 1 | 0 |
| 4. 主循环决策 | 5 | 1 | 3 | 1 | 0 |
| 5. 记忆系统 | 6 | 0 | 2 | 4 | 0 |
| 6. 前端路由 | 0 | 0 | 0 | 0 | 0 |
| **总计** | **23** | **2** | **10** | **11** | **0** |

**最严重的 2 个 Critical 问题**：
1. **meta-cognitive-loop 的 ask_human 是死代码**（主循环决策）
2. **卡片类型不匹配导致工具调用被误渲染为 text**（前端卡片）

---

## 一、维度 1：技能系统（触发/加载/缓存/失败）

### 1.1 问题清单

| # | 问题 | 文件 | 行号 | 严重度 | 根因 |
|---|------|------|------|--------|------|
| 1.1 | 技能匹配失败后无回退机制 | `spawner.ts` | L69-L77 | **high** | 当 `matchSkills()` 返回空时直接返回失败，无降级处理 |
| 1.2 | 技能注册无去重检查 | `loader.ts` | L184-L192 | medium | `registerSkill()` 直接覆盖，无重复告警 |
| 1.3 | 技能加载失败静默忽略 | `loader.ts` | L175-L180 | medium | `scanDir()` 中 `try-catch` 吞掉错误，无告警 |
| 1.4 | 技能缓存无失效策略 | `loader.ts` | L57-L58 | medium | `skillRegistry` 是纯内存 Map，无 TTL/过期机制 |
| 1.5 | 并发技能执行失败不隔离 | `spawner.ts` | L138-L170 | medium | `executeSkillsConcurrently()` 用 `Promise.allSettled`，失败只记录不处理 |

### 1.2 核心问题详述

#### 问题 1.1：技能匹配失败无回退
```typescript
// spawner.ts L69-L77
const matched = matchSkills(message, context);
if (!matched || matched.length === 0) {
    return { ok: false, error: 'No skill matched' }; // ❌ 直接返回，无降级
}
```
**影响**：用户输入触发技能关键词但匹配失败时，对话直接中断，不降级到普通对话。

**修复路径**：
- 新增 `fallbackToDefaultChat()` 函数
- 在 `executeSkill()` 失败后自动降级到主循环

---

## 二、维度 2：卡片系统（前端渲染/数据流/SSE）

### 2.1 问题清单

| # | 问题 | 文件 | 行号 | 严重度 | 根因 |
|---|------|------|------|--------|------|
| 2.1 | 卡片类型不匹配（tool → text） | `Thread.tsx` | L1014-L1020 | **critical** | `nonTextSegments` 过滤逻辑遗漏部分类型 |
| 2.2 | 工具调用合并统计不准确 | `Thread.tsx` | L973-L1070 | high | `ActivityTimeline` 只统计 `ok` 工具，遗漏失败调用 |
| 2.3 | 文件卡片类型校验缺失 | `FileCard.tsx` | L357-L442 | high | `FilesFromToolSegment` 未校验工具调用类型合法性 |
| 2.4 | SSE 事件类型未覆盖 | `chat.ts` | L422-L468 | medium | 缺少 `plan_update` / `diagnosis` 等新事件 |

### 2.2 核心问题详述

#### 问题 2.1：卡片类型不匹配
```typescript
// Thread.tsx L1014-L1020
const nonTextSegments = segments.filter(
    s => s.kind !== 'tool' && s.kind !== 'reasoning' && s.kind !== 'thinking'
);
// ❌ 过滤后只处理 image/error/video/widget，text 类型被遗漏
```
**影响**：如果后端返回 `kind: 'text'` 但内容实际是工具调用 JSON，前端会错误渲染为纯文本。

**修复路径**：
- 在 `AssistantMsg` 中增加对 `text` 段的二次类型推断
- 增加 `isToolCallText()` 检测函数

---

## 三、维度 3：工具调用链（注册/分派/并行/错误恢复）

### 3.1 问题清单

| # | 问题 | 文件 | 行号 | 严重度 | 根因 |
|---|------|------|------|--------|------|
| 3.1 | 并行工具调用错误不隔离 | `tool-registry.ts` | L196-L234 | high | `Promise.allSettled` 只记录失败，不触发修复 |
| 3.2 | Critical 工具确认超时无回退 | `tool-registry.ts` | L330-L364 | high | `waitForConfirmation()` 超时后直接拒绝，无降级 |
| 3.3 | 工具结果压缩可能丢信息 | `token-compressor.ts` | L72-L115 | medium | 压缩策略未保留关键错误信息 |

### 3.2 核心问题详述

#### 问题 3.1：并行调用错误不隔离
```typescript
// tool-registry.ts L196-L234
const results = await Promise.allSettled(parallelTasks);
// ❌ 失败只记录到 settled.status === 'rejected'，不触发 auto-error-repair
```
**影响**：并行工具调用失败后，系统不会自动尝试修复，可能导致后续步骤依赖空数据。

**修复路径**：
- 在 `Promise.allSettled` 后检查失败项
- 对失败工具调用触发 `autoErrorRepair`

---

## 四、维度 4：主循环决策（意图/置信度/策略/熔断）

### 4.1 问题清单

| # | 问题 | 文件 | 行号 | 严重度 | 根因 |
|---|------|------|------|--------|------|
| 4.1 | **meta-cognitive-loop ask_human 是死代码** | `meta-cognitive-loop.ts` | L50-L60 | **critical** | 触发后无阻塞等待用户响应的机制 |
| 4.2 | strategy-selector 无策略失败回退 | `strategy-selector.ts` | L40-L55 | high | 选错策略后抛异常，无 fallback |
| 4.3 | intent-clarifier 与 confidence-estimator 数据断裂 | `intent-clarifier.ts` + `confidence-estimator.ts` | L20-L30 | medium | 状态未传递 |
| 4.4 | LLM Router 熔断检查不全面 | `llm-router.ts` | L90-L110 | high | 仅部分路径检查熔断状态 |
| 4.5 | 主循环决策结果未校验 | `agentai-loop.ts` | L70-L90 | high | stop/continue 未做状态一致性检查 |

### 4.2 核心问题详述

#### 问题 4.1：ask_human 是死代码
```typescript
// meta-cognitive-loop.ts L50-L60
case 'ask_human':
    // ❌ 这里只返回 { action: 'ask_human', question: ... }
    // ❌ 但主循环收到后没有阻塞等待用户回答的逻辑
    return { action: 'ask_human' };
```
**影响**：AI 判断需要追问用户时，代码会返回 `ask_human`，但主循环不等待，直接继续执行，导致追问失效。

**修复路径**：
- 在 `agentai-loop.ts` 增加 `handleAskHuman()` 函数
- 主循环收到 `ask_human` 后阻塞，等待用户输入后再继续

---

## 五、维度 5：记忆系统（三层存储/FTS5/压缩/恢复）

### 5.1 问题清单

| # | 问题 | 文件 | 行号 | 严重度 | 根因 |
|---|------|------|------|--------|------|
| 5.1 | 记忆压缩触发条件不明确 | `memory.ts` | L20-L30 | medium | "每 10 轮"未用计数器显式触发 |
| 5.2 | FTS5 查询无性能监控 | `fts5-memory.ts` | L50-L80 | medium | 查询耗时未记录 |
| 5.3 | 记忆恢复无完整性校验 | `memory.ts` | L80-L90 | high | `recall_memory` 不验证数据有效 |
| 5.4 | 错误日志缺调用栈 | `audit.ts` | L30-L50 | high | 日志不包含执行上下文 |
| 5.5 | 沙箱错误隔离薄弱 | `sandbox/executor.ts` | L100-L120 | high | 执行异常未完全捕获 |
| 5.6 | 自动修复输入未校验 | `auto-error-repair.ts` | L60-L80 | medium | 修复逻辑依赖输入格式 |

### 5.2 核心问题详述

#### 问题 5.3：记忆恢复无校验
```typescript
// memory.ts L80-L90
const data = fs.readFileSync(memoryPath, 'utf-8');
return JSON.parse(data); // ❌ 不检查 JSON 是否有效、是否有缺失字段
```
**影响**：损坏的记忆文件会导致后续任务依赖错误数据。

**修复路径**：
- 增加 `validateMemoryData()` 函数
- 恢复前校验必需字段存在且类型正确

---

## 六、维度 6：前端路由（App.tsx/PAGES 字典）

### 6.1 结论

**✅ 无明显问题**。PAGES 字典与 View 类型定义一致，导航逻辑正确，状态管理清晰。

---

## 七、优先级排序（Top 10 必修）

| 排名 | 问题 | 严重度 | 维度 | 修复难度 | 影响面 |
|------|------|--------|------|----------|--------|
| 1 | ask_human 死代码 | **critical** | 决策 | 中 | 全对话流程 |
| 2 | 卡片类型不匹配 | **critical** | 卡片 | 中 | 前端渲染 |
| 3 | 技能匹配失败无回退 | high | 技能 | 低 | 技能触发 |
| 4 | 熔断检查不全面 | high | 决策 | 低 | 模型路由 |
| 5 | 记忆恢复无校验 | high | 记忆 | 低 | 数据一致性 |
| 6 | 错误日志缺调用栈 | high | 记忆 | 低 | 问题排查 |
| 7 | 沙箱错误隔离薄弱 | high | 记忆 | 中 | 执行安全 |
| 8 | 策略选择无回退 | high | 决策 | 低 | 策略执行 |
| 9 | 并行工具错误不隔离 | high | 工具 | 中 | 工具调用 |
| 10 | Critical 工具确认超时无回退 | high | 工具 | 低 | 安全审批 |

---

## 八、修复路径建议（分阶段）

### 阶段 1：Critical 问题（本周）

**目标**：修复 2 个 Critical 问题

| 问题 | 修复点 | 预计 |
|------|--------|------|
| ask_human 死代码 | `agentai-loop.ts` 增加 `handleAskHuman()` | 2 天 |
| 卡片类型不匹配 | `Thread.tsx` 增加类型推断 | 1 天 |

### 阶段 2：High 问题（下周）

**目标**：修复 8 个 High 问题

| 问题 | 修复点 |
|------|--------|
| 技能匹配失败无回退 | `spawner.ts` 降级逻辑 |
| 熔断检查不全面 | `llm-router.ts` 全路径检查 |
| 记忆恢复无校验 | `memory.ts` 校验函数 |
| 错误日志缺调用栈 | `audit.ts` 增强日志 |
| 沙箱错误隔离薄弱 | `sandbox/executor.ts` try-catch |
| 策略选择无回退 | `strategy-selector.ts` fallback |
| 并行工具错误不隔离 | `tool-registry.ts` 错误处理 |
| Critical 工具确认超时无回退 | `tool-registry.ts` 降级 |

### 阶段 3：Medium 问题（后续）

**目标**：修复 11 个 Medium 问题

按维度逐个修复，优先处理影响用户体验的问题（如工具结果压缩丢信息）。

---

## 九、与重构理念的关系

| 重构理念 | 审查发现 | 对应问题 |
|---------|---------|---------|
| 望·任务感知 | intent-clarifier 存在 | ✅ 已实现 |
| 闻·缺口分析 | 数据流断裂 | ⚠️ 问题 4.3 |
| 问·探询追问 | **ask_human 是死代码** | ❌ 问题 4.1 |
| 切·诊断 | confidence-estimator 存在 | ✅ 已实现 |
| 因证施治·策略选择 | 无回退机制 | ⚠️ 问题 4.2 |
| 调方·执行验证 | 并行错误不隔离 | ⚠️ 问题 3.1 |

**结论**：重构理念的 7 个核心点中，**2 个有硬伤**（问/施治），**2 个有软伤**（闻/调方），其余正常。

---

## 十、审查方法论（供后续复用）

本次审查使用 **6 维度并行扫描**：
1. 每个维度独立启动 search agent
2. 聚焦"触发机制 → 数据流 → 错误处理"闭环
3. 发现问题后记录文件路径 + 行号
4. 统一汇总并优先级排序

后续可定期（每两周）重复此流程，持续发现新问题。

---

## 十一、下一步建议

1. 🔜 **本周**：开干 2 个 Critical 问题
2. 🔜 **下周**：批量修复 8 个 High 问题
3. 🔜 **后续**：Medium 问题按影响面排序处理
4. ⏸ **扩展路线图**：暂停，先修复问题再谈扩展

**不做扩展先做修复，否则新代码会建立在错误地基上。**