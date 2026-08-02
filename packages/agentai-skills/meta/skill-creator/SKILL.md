---
name: skill-creator
version: 1.0.0
description: AI 自主创建新技能包，将重复工作流固化为可复用 Skill，支持生成 SKILL.md + handler + scripts
category: meta
tags: [skill, create, workflow, reusable, 技能创建, 工作流固化]
riskLevel: low
author: AgentAI
testCommand: echo "skill-creator skill loaded"
---

# Skill Creator — 技能自创建引擎

当 AI 完成了一个多步骤可复用工作流后，自动将其固化为标准 Skill 包，供后续会话直接调用。

## 触发条件

以下情况主动触发技能创建:
1. 完成了 8+ 个工具调用的复杂任务
2. 用户说"把这个工作流保存下来"、"做成技能"
3. 反思门检测到某个模式出现 3+ 次

## 创建流程

```
1. 分析刚完成的工作流 → 提取可复用步骤
2. 生成 SKILL.md (带 frontmatter + 执行指令)
3. 如有 Python/TS 脚本 → 生成 handler.py / handler.ts
4. 写入 agentai-skills/{category}/{skill-name}/
5. 调用 auto-skill-discovery 重新扫描注册
```

## SKILL.md 标准模板

```markdown
---
name: {skill-name}
version: 1.0.0
description: {一句话描述}
category: {code|web|agents|image|meta|...}
tags: [{tag1}, {tag2}]
riskLevel: low|medium|high
author: AgentAI
---

# {Skill 名称}

{功能描述}

## 触发条件
...

## 执行规则
...

## 输出格式
...
```

## 技能分类规范

| 类别 | 说明 | 示例 |
|------|------|------|
| code | 代码相关 | 执行、审查、生成 |
| web | Web/浏览器 | 抓取、自动化、API |
| agents | 多智能体 | 协调、编排 |
| image | 图像处理 | 生成、编辑 |
| voice | 语音 | TTS、STT |
| meta | 框架自身 | 进化、技能管理 |
| office | 办公 | Excel、Word、PDF |
| desktop | 桌面控制 | 鼠标键盘、截图 |

## 注意事项

- 创建的技能存放在 `agentai-skills/` 目录，自动被 auto-skill-discovery 扫描
- 技能名称使用 kebab-case（小写+连字符）
- 高风险操作必须设置 `riskLevel: high` 并在指令中说明危险点
