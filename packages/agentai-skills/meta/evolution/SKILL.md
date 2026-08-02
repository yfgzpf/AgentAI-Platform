---
name: evolution
version: 2.0.0
description: 跨会话自进化引擎，记录最优工具调用序列和失败教训，在下次对话时自动注入相关经验
category: meta
tags: [evolution, memory, learning, cross-session, 进化, 记忆, 跨会话学习]
riskLevel: low
author: AgentAI
testCommand: echo "evolution skill loaded"
---

# Evolution — 自进化记忆引擎

学习并记忆最优工具调用模式、用户偏好、失败教训，下次遇到相似任务时自动注入经验指导决策。

## 存储结构

进化记录存储在 `~/.agentai/evolution.jsonl`，每条记录包含:

```json
{
  "id": "uuid",
  "type": "success|failure|preference|meta_instruction|tool_stats",
  "taskType": "coding|writing|analysis|...",
  "industry": "general|construction|finance|...",
  "userId": "user-id",
  "workspace": "/path/to/project",
  "content": "经验描述",
  "toolSequence": ["tool1", "tool2"],
  "score": 0.95,
  "ts": 1719000000000
}
```

## 注入策略

在每次 loop 启动时，`buildImmutablePrefix` 的 §1.1 会召回最相关的 20 条经验注入 system prompt:

- **meta_instruction** → `[教练建议]` (权重最高)
- **failure** → `[教训]` (避免重蹈覆辙)
- **preference** → `[偏好]` (用户习惯)
- **success** → `[经验]` (成功模式)

## AI 行为规则

遇到以下情况时，主动触发进化记录:
1. 用户说"记住这个做法"、"下次用这种方式"
2. 工具调用序列超过 10 步且成功完成 → 记录为 success
3. 工具调用失败超过 3 次 → 记录为 failure 并写教训
4. 反思门触发（每 10 轮）→ 自动提炼本轮模式

## 工具调用

```
write_evolution(type, content, taskType, toolSequence, score)
recall_evolution(taskType, industry, keywords, limit)
```

## 注意事项

- 进化记忆是跨会话持久化的，不随对话结束丢失
- 每个 workspace 有独立的进化记录，不同项目不互相污染
- 全局进化（跨 workspace）只记录用户偏好类
