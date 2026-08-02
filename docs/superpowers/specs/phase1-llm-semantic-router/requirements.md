# Phase 1: LLM 语义路由调度层 — 需求规范

> 状态：最终版
> 日期：2026-07-14
> 负责人：Agnes（架构自治）
> 触发来源：Fugu/TRINITY 论文 — 调度器自学习编排能力

## 0. 背景

`skill-orchestrator.ts` 的 `smartDispatch()` (L173-230) 是 100% 关键词+正则匹配：
- 正则匹配 triggers → +20 分
- 名称匹配 → +10 分
- 标签匹配 → +5 分/个
- 描述分词匹配 → +1 分/词

这意味着：**调度逻辑永远停在写 SKILL.md 的那一刻**。新的任务语义（如"帮我分析这段代码的性能瓶颈"）如果不在 triggers/tags/description 中出现匹配词，就会得 0 分，永远匹配不到。

Fugu 论文证明：让调度模型**通过语义相似度自动理解意图**，然后在历史 run 数据上 RL 微调调度权重，才能覆盖未见过的任务类型。

Phase 1 不做 RL 训练，只把当前的关键词匹配升级为 **LLM 语义路由**，让调度器具备"读懂用户意图并匹配技能"的能力。

## 1. 需求矩阵

| ID | 类型 | 需求描述 | 验收方式 |
|---|---|---|---|
| **R1** | Functional | When 用户发送一条消息，`SkillOrchestrator` 的 `routeSkill()` 方法 shall 优先使用 LLM 语义路由匹配技能 | 单元测试：调用 `routeSkill("帮我写一个登录页面")` 返回正确的 skill name |
| **R2** | Functional | When LLM 语义路由返回最高置信度 ≥ 0.75，系统 shall 直接使用该 skill | 观察返回的 skill name 与预期一致 |
| **R3** | Functional | When LLM 语义路由最高置信度 < 0.75，系统 shall 降级回原有的 `smartDispatch()` 关键词匹配作为 fallback | 低置信度时走关键词路径，不影响已有功能 |
| **R4** | Functional | When 用户消息经 hash 去重后的语义意图已在 `knowledge-cache.ts` 缓存中且有缓存分数 ≥ 0.75，系统 shall 直接返回缓存结果，跳过 LLM 调用 | 同一意图第二次调用不走 API |
| **R5** | Security | When 用户消息包含可疑输入模式（SQL 注入、命令注入、ReDoS 特征），语义路由的 prompt 执行前 shall 被 `sanitizeUserInput()` 清理 | 含恶意输入的消息不会被直接传给 LLM |
| **R6** | Cost | When 语义路由触发 LLM 调用，成本 shall 被记录到 `cost/tracker`，当日累计语义路由成本超过 ¥5.00 时 shall 自动降级到纯关键词模式 | 观察 cost tracker 日志 |
| **R7** | Observability | When 路由完成（无论 LLM 还是 fallback），系统 shall 在 `governor/runtime-capability-tracker` 中记录 `recordToolResult(router, 'skill-match', success, durationMs)` | 审计日志中可见路由记录 |
| **R8** | Non-functional | 语义路由单次调用延迟 P95 < 2000ms（取决于 LLM provider） | 性能测试 |
| **R9** | Security | Skill 描述中的 system prompt 片段不得超过 500 字 | 路由 prompt 构造逻辑校验 |

## 2. 设计原则

1. **渐进式**：不改 `smartDispatch()` 现有代码，新增 `routeSkill()` 方法。老代码调用 `smartDispatch()`，新代码/新路径调用 `routeSkill()`。零破坏性变更。
2. **先缓存后 LLM**：R4 的缓存查询在 LLM 调用之前，避免不必要的 API 费用。
3. **fallback 永远可用**：LLM 调用失败/超时/成本高时，自动回到 `smartDispatch()`。
4. **成本可控**：R6 每日 ¥5 封顶，超线自动降级。

## 3. 验收标准（Definition of Done）

- [ ] `routeSkill(message: string, userId?: string, workspace?: string)` 方法实现并返回 `{ skillName, confidence, method: 'llm'|'cache'|'fallback' }`
- [ ] 语义路由 prompt 构造逻辑（含知识库片段 + 技能描述列表 + 用户消息）
- [ ] `knowledge-cache.ts` 查询 + upsert 集成（query=hash(message)）
- [ ] `sanitizeUserInput()` 集成（前置消毒）
- [ ] `cost/tracker` 记录（每次 LLM 调用）
- [ ] `governor/runtime-capability-tracker` 记录（每次路由完成）
- [ ] fallback 到 `smartDispatch()` 路径（置信度 < 0.75 或 LLM 失败）
- [ ] 单元测试：至少 10 条典型消息的语义路由准确率 ≥ 70%
- [ ] 无破坏性变更：现有 `smartDispatch()` 调用者不受影响
