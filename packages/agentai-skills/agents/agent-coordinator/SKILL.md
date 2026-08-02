---
name: agent-coordinator
version: 1.0.0
description: 多智能体协调器，将复杂任务自动拆解为子任务并并行/串行调度多个子 Agent 执行
category: agents
tags: [multi-agent, orchestration, parallel, coordination, 多智能体, 任务分解, 编排]
riskLevel: low
author: AgentAI
testCommand: echo "agent-coordinator skill loaded"
---

# Agent Coordinator — 多智能体协调器

将复杂任务分解为子任务并智能调度多个 Agent 并行或串行执行，最终聚合结果。

## 核心能力

- **任务分解**: 将用户意图拆解为 2-8 个独立子任务
- **并行调度**: 无依赖的子任务并行执行，节省时间
- **串行依赖**: 有前置依赖的任务等待前驱完成后执行
- **结果聚合**: 合并所有子 Agent 输出，生成统一报告
- **失败重试**: 单个子任务失败不影响其他子任务，支持局部重试

## 触发条件

- 任务需要多步骤完成（超过 5 步）
- 任务包含可并行的独立子模块（如"同时分析 A 和 B"）
- 用户明确要求"用多个 Agent 完成"

## 执行流程

```
1. 解析用户意图 → 生成任务图 (DAG)
2. 识别并行组 vs 串行依赖
3. 为每个子任务 spawn 子 Agent
4. 监控所有子任务状态
5. 聚合结果 → 返回给用户
```

## 输出格式

```markdown
## 任务执行报告

### 子任务列表
| ID | 任务 | 状态 | 耗时 |
|----|------|------|------|
| 1  | ... | ✅完成 | 2.3s |
| 2  | ... | ✅完成 | 1.8s |

### 聚合结果
...
```

## 注意事项

- 子 Agent 之间通过共享 workspace 传递中间结果
- 每个子 Agent 最多运行 5 分钟
- 总并发子 Agent 数不超过 8 个
