# 🧠 管理者智能体 (Manager Agent) 设计方案

> **核心理念**: 将"预判、管事=营事+理人、八步闭环、复盘四维度"等管理智慧融入 AI 智能体系统
>
> **目标**: 让 AI 不只是执行工具，而是像优秀管理者一样——预判需求、拆解任务、追踪结果、复盘优化

---

## 一、从图片中提取的管理智慧

### 1.1 预判能力（8 层预判）

| 层级 | 预判内容 | AI 对应能力 |
|------|---------|------------|
| 1 | 别人找你之前，预判他的目的 | `ask_user` 前置 + 歧义检测 |
| 2 | 别人开口之前，预判他的情绪 | 情绪感知（用户语气分析）|
| 3 | 别人发言之前，预判他的立场 | 上下文意图推断 |
| 4 | 别人行动之前，预判他的方向 | 任务路径预测 |
| 5 | 别人沉默之前，预判他的顾虑 | 置信度评估 + 追问触发 |
| 6 | 别人表达之前，预判他的需求 | `spec_generate` 需求澄清 |
| 7 | 别人回答之前，预判他的底线 | 约束条件预检 |
| 8 | 别人合作之前，预判他的价值观 | 用户偏好记忆 (`remember_this`)**

**核心原则**: 聪明的人解决问题，智慧的人提前规避问题！

### 1.2 管事 = 营事 + 理人

```
管事 = 目标 + 流程 + 标准 + 结果
│
├── 定目标: 做到什么程度 / 什么时候完成 / 如何衡量成果
├── 建流程: 先做什么 / 后做什么
├── 立标准: 每一步做到什么程度
└── 追结果: 做到了提炼经验 / 没做到分析原因调策略
```

**AI 映射**:
- **定目标** → `plan_task(goal, subtasks)` + 验收标准
- **建流程** → 子任务依赖关系 (DAG)
- **立标准** → 每个 subtask 的 quality_gate
- **追结果** → `update_plan(status, summary)` + `run_distillation`

### 1.3 管理八步闭环

```
1. 锚定目标 ───── 凡是工作，必有目标
2. 配套计划 ───── 凡是目标，必有计划
3. 保障执行 ───── 凡是计划，必有执行
4. 动态追踪 ───── 凡是执行，必有追踪
5. 产出结果 ───── 凡是追踪，必有结果
6. 对应考核 ───── 凡是结果，必有考核
7. 匹配激励 ───── 凡是考核，必有激励
8. 迭代优化 ───── 凡是激励，必有优化
```

### 1.4 复盘四维度

| 维度 | 问题 | AI 实现 |
|------|------|---------|
| **客户复盘** | 接触了哪些客户？真实需求？值得跟进？ | 用户意图分析 + 需求优先级排序 |
| **沟通复盘** | 哪句话打动了？产生反馈？下次怎么说？ | 对话效果评估 + 话术优化 |
| **成交复盘** | 为什么成交/没成交？卡在哪？决策点？ | 决策树分析 + 阻碍识别 |
| **成长复盘** | 更懂客户心理？优化话术？明天突破点？ | `run_distillation` 经验固化 |

### 1.5 汇报两套方案技巧

```
准备方案 {
    A → 你真正想推的 (精心准备)
    B → 刻意设置短板，缺陷明显 (陪跑)
}
汇报话术: "我梳理了两个方向，您看哪个更合适？"
→ 领导一看 B 有弊端，自然选 A
→ 他觉得是自己做的决策，你得到了想要的结果
```

**AI 应用**: 当有多个实现方案时，主动呈现 2-3 个选项并推荐最优。

---

## 二、现有系统能力审计

### 2.1 已有的工具（可复用）

| 工具 | 当前用途 | 管理者增强 |
|------|---------|-----------|
| `plan_task` | 子任务拆解 | 增强：加入目标量化、验收标准、依赖关系 |
| `update_plan` | 状态更新 | 增强：加入质量门禁、耗时统计、风险标记 |
| `ask_user` | 向用户提问 | 增强：预判式提问（在用户困惑前先问）|
| `spec_generate` | PRD 生成 | 复用：作为"定目标"的前置步骤 |
| `run_distillation` | 经验萃取 | 复用：作为"迭代优化"的核心 |
| `evolve_prompt` | 行为规则进化 | 复用：作为"标准沉淀"机制 |
| `remember_this` | 结构化记忆 | 复用：存储复盘结论 |
| `spawn_subagent` | 子智能体 | 复用：并行执行独立子任务 |
| `run_team` | 团队协作 | 复用：多角色协作复杂任务 |

### 2.2 已有的前端组件

| 组件 | 位置 | 现状 | 管理者增强 |
|------|------|------|-----------|
| `TaskPlanPanel` | GUI | 显示子任务列表+进度 | 增强：八步闭环视图、复盘面板 |
| `Thread` | GUI | 对话容器 | 增强：预判提示、决策节点高亮 |

### 2.3 缺失的能力（需要新建）

| 能力 | 描述 | 优先级 |
|------|------|--------|
| **预判引擎** | 在用户表达前预测需求 | P0 |
| **目标量化** | 将模糊目标转为 SMART 目标 | P0 |
| **质量门禁** | 每步完成后的自动检查 | P1 |
| **复盘生成器** | 任务完成后自动生成四维度复盘 | P1 |
| **晨会/晚复盘模板** | 管理者每日规划界面 | P2 |

---

## 三、落地路径规划

### Phase 1: 增强 plan_task（1-2 天）

**目标**: 让任务拆解具备"管理者思维"

```typescript
// 增强 plan_task 参数
interface ManagerTaskPlan {
    goal: string;
    // 新增：SMART 目标量化
    smart_goal?: {
        specific: string;    // 具体做什么
        measurable: string;  // 如何衡量成功
        achievable: string;  // 可行性评估
        relevant: string;    // 与大目标的关系
        time_bound: string;  // 时间限制
    };
    
    subtasks: Array<{
        id: string;
        title: string;
        priority: 'high' | 'medium' | 'low';
        // 新增
        depends_on?: string[];      // 依赖的其他子任务 ID
        acceptance_criteria?: string; // 验收标准
        estimated_effort?: string;   // 预估工作量
        risk_level?: 'low' | 'medium' | 'high'; // 风险等级
        assignee_type?: 'self' | 'subagent' | 'team'; // 执行者类型
    }>;
    
    // 新增：整体策略
    strategy?: {
        approach: string;           // 总体思路
        alternatives?: string[];    // 备选方案（汇报两套方案）
        recommended: number;       // 推荐方案索引
        risks?: Array<{            // 风险预判
            what: string;
            mitigation: string;
        }>;
    };
}
```

**System Prompt 注入**：
```
你是 PulseFlow 管理者智能体。在执行任何复杂任务前：
1. 【预判】先判断用户真实需求（可能用户自己都没想清楚）
2. 【定目标】将模糊需求转为 SMART 目标
3. 【两套方案】准备 2 个实现方案，推荐最优
4. 【拆解】用 plan_task 拆解，每个子任务要有验收标准
5. 【追踪】每步完成后 update_plan，失败立即分析原因
6. 【复盘】任务完成后自动调用 run_distillation 固化经验
```

### Phase 2: 预判引擎（2-3 天）

**目标**: AI 在用户表达前主动预判

```typescript
// 新工具: pre_judge (或增强现有歧义检测)
interface PreJudgment {
    // 在用户发消息前/消息模糊时触发
    trigger: 'before_response' | 'ambiguous_input' | 'complex_task';
    
    // 预判维度（对应 8 层预判）
    predictions: {
        user_intent?: string;        // 用户真实目的
        emotional_state?: string;     // 情绪状态
        implicit_constraints?: string[]; // 隐含约束
        unspoken_concerns?: string[];   // 未说出的顾虑
        decision_criteria?: string[];    // 决策标准
        collaboration_readiness?: string; // 合作意愿
    };
    
    // 预判动作
    actions: {
        should_ask_clarification: boolean;  // 是否需要追问
        suggested_questions?: string[];     // 建议的追问
        proactive_suggestions?: string[];   // 主动建议
        risk_alerts?: string[];             // 风险预警
    };
}
```

**注入位置**: `agentai-loop.ts` 的主循环前，或 `system-prompt.ts` 的歧义检测模块

### Phase 3: 复盘面板（3-5 天）

**目标**: TaskPlanPanel 增加复盘视图

```tsx
// TaskPlanPanel.tsx 增强
const ReviewPanel = ({ task }) => (
    <Card title="📊 任务复盘">
        {/* 四维度复盘 */}
        <Tabs>
            <TabPane tab="目标复盘" key="goal">
                SMART 目标达成情况
            </TabPane>
            <TabPane tab="过程复盘" key="process">
                时间线 + 每步决策记录
            </TabPane>
            <TabPane tab="问题复盘" key="issues">
                遇到的问题 + 解决方案
            </TabPane>
            <TabPane tab="经验沉淀" key="lessons">
                可固化的经验 → 一键写入 remember_this
            </TabPane>
        </Tabs>
        
        {/* 下次改进建议 */}
        <div className="next-improvements">
            明天重点突破: ...
            优化话术: ...
        </div>
    </Card>
);
```

### Phase 4: 晨会/晚复盘模式（可选）

**目标**: 管理者每日工作流

```
┌─────────────────────────────────────────┐
│  ☀️ 晨会布局 (每日启动时自动触发)          │
│  ─────────────────────────────          │
│  1. 回顾昨日目标完成度                    │
│  2. 今日核心目标 (SMART)                 │
│  3. 关键会议/里程碑                      │
│  4. 风险预判 + 应对预案                  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  🌙 晚复盘 (每日结束或任务完成后)          │
│  ─────────────────────────────          │
│  1. 今日目标完成度                       │
│  2. 做对了什么 / 哪里不足                │
│  3. 规划调整方案                         │
│  4. 自动 run_distillation               │
└─────────────────────────────────────────┘
```

---

## 四、具体实施文件清单

### 需要修改的文件

| 文件 | 修改内容 | Phase |
|------|---------|-------|
| `packages/agentai-gateway/src/tools.ts` | 增强 `plan_task` / `update_plan` 参数定义 | 1 |
| `packages/agentai-gateway/src/system-prompt.ts` | 注入管理者行为指令 | 1 |
| `packages/agentai-gui/src/components/TaskPlanPanel.tsx` | 增加复盘视图、质量门禁显示 | 3 |

### 需要新建的文件

| 文件 | 用途 | Phase |
|------|------|-------|
| `.agentai/skills/manager-agent/SKILL.md` | 管理者智能体技能定义 | 1 |
| `packages/agentai-gateway/src/manager/prejudge.ts` | 预判引擎 | 2 |
| `packages/agentai-gateway/src/manager/review-generator.ts` | 复盘生成器 | 3 |
| `packages/agentai-gui/src/components/ReviewPanel.tsx` | 复盘面板 UI | 3 |

---

## 五、快速验证路径

### 最小可行产品 (MVP)

**只做一件事**: 增强 `plan_task` 的 system prompt 注入

1. 在 `system-prompt.ts` 中添加"管理者模式"指令块
2. 让 AI 在拆解任务时自动：
   - 量化目标 (SMART)
   - 标注验收标准
   - 识别风险点
   - 准备备选方案

3. 在 `TaskPlanPanel` 中展示这些增强信息

**验证方式**: 给一个复杂任务（如"帮我重构用户认证模块"），观察 AI 是否展现出管理者思维。

---

## 六、与现有架构的集成点

```
用户输入
    ↓
[预判引擎] ← 新增: 8层预判
    ↓
[歧义检测] ← 已有: 增强
    ↓
[spec_generate] ← 已有: 定目标
    ↓
[plan_task] ← 已有: 增强(SMART+验收标准+风险)
    ↓
[spawn_subagent / run_team] ← 已有: 并行执行
    ↓
[update_plan] ← 已有: 增强(质量门禁)
    ↓
[run_distillation] ← 已有: 复盘固化
    ↓
[ReviewPanel] ← 新增: 四维度复盘展示
```

---

## 七、设计原则

1. **渐进式增强**: 不破坏现有功能，逐步叠加管理者能力
2. **用户可控**: 管理者模式可作为开关（默认开启，用户可关闭）
3. **数据驱动**: 复盘结论必须写入 `remember_this`，跨会话复用
4. **简洁优先**: 增强的 prompt 要精简，避免 token 浪费
5. **中文原生**: 所有管理者术语使用中文（预判、复盘、闭环等）

---

*文档版本: v0.1 | 创建日期: 2026-08-05 | 基于 @小董手写 管理智慧整理*
