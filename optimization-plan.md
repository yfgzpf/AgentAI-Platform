# AgentAI Platform 优化计划

> 基于梁文锋式思维方法论的系统审查，按优先级分阶段执行。

---

## P0: 立即优化（不花钱，立竿见影）

### P0-1: 工具分层加载
**问题**: 141 工具全量注入 prompt，每轮浪费 ~40-60% token，弱模型工具选择准确率低
**方案**: 在现有 `system-prompt-core.ts` 的 L0/L1/L2 分层基础上，扩展 L1 按任务类型分组
- `tool-filter.ts` 已有 `INTENT_TOOLS` 映射 → 扩展为 L1 工具分组
- 核心工具（~20个）始终注入
- 按任务类型注入对应工具组（编码/搜索/创意/行业/系统管理）
- 预估节省: 每轮 40-60% token

### P0-2: 工具使用率统计 + 死工具清理
**问题**: 工具注册后永久存在，从未被调用的工具稀释模型注意力
**方案**: 
- 新增 `tool-usage-stats.ts` 记录每次工具调用
- 7 天未被调用的工具自动降级为"按需加载"
- 统计工具调用频率、成功/失败率
- 提供 API 供前端展示

### P0-3: 记忆系统双轨制统一
**问题**: `memory.ts`（JSONL 高级记忆）和 `memory-manager.ts`（KV 记忆）并存，数据可能不一致
**方案**: 
- `memory-manager.ts` 作为统一入口（薄封装）
- `memory.ts` 保留为底层 JSONL 存储
- `remember()` 写入 KV 的同时异步镜像写入 JSONL
- `recall()` 优先查 KV（同步快），必要时回退 JSONL

### P0-4: 自进化闭环补全
**问题**: evolve_prompt 写入无验证，可能积累无效规则
**方案**:
- 每条规则记录 `triggerCount` + `effectCount` + `lastTriggered`
- 无效规则（7天未触发）自动降级
- 新增 `cleanupEvolution()` 定时清理
- 规则有效性可视化报告

---

## P1: 近期优化（需一定开发量）

### P1-1: 行业引擎数据化
**问题**: `industry-engine.ts` ~690 行硬编码
**方案**: 
- 静态数据迁入 `industry-data/` JSON 配置
- 支持热加载（修改 JSON 后自动生效）
- 支持用户自定义覆盖

### P1-2: 前端 Store 领域合并
**问题**: 13 个独立 store，跨 store 同步复杂
**方案**: 
- 合并为 5-6 个核心 store
- 消除冗余状态

### P1-3: 用户反馈信号系统
**问题**: 无用户满意度信号，自进化缺少真实反馈源
**方案**: 
- 对话结束后收集 👍/👎 反馈
- 反馈数据进入进化回路
- 前端反馈 UI

### P1-4: 冲突页面合并
**问题**: `automation` 和 `schedule` 功能重叠
**方案**: 
- 合并为统一入口
- 减少用户困惑

---

## 执行顺序

```
P0-1 工具分层加载 ───→ P0-2 工具使用率统计 ───→ P0-3 记忆系统统一 ───→ P0-4 自进化闭环
       │                       │                        │                      │
       └───────────────────────┴────────────────────────┴──────────────────────┘
                                            │
                                    P1-1 行业引擎数据化
                                    P1-2 Store 合并
                                    P1-3 用户反馈
                                    P1-4 页面合并
```

---

## 文件变更清单

### P0-1: 工具分层加载
- 修改: `packages/agentai-gateway/src/loop/tool-filter.ts` — 扩展工具分组
- 修改: `packages/agentai-gateway/src/loop/context-builder.ts` — 按分组注入
- 修改: `packages/agentai-gateway/src/system-prompt-core.ts` — 对齐 L1 分组

### P0-2: 工具使用率统计
- 新增: `packages/agentai-gateway/src/tool-usage-stats.ts`
- 修改: `packages/agentai-gateway/src/tools.ts` — 注册时接入统计

### P0-3: 记忆系统统一
- 修改: `packages/agentai-gateway/src/memory-manager.ts` — 镜像写入 JSONL
- 修改: `packages/agentai-gateway/src/memory.ts` — 保持为底层存储

### P0-4: 自进化闭环
- 修改: `packages/agentai-gateway/src/evolution.ts` — 规则有效性追踪
- 修改: `packages/agentai-gateway/src/agentai-loop.ts` — 接入清理

### P1-1: 行业引擎数据化
- 新增: `packages/agentai-gateway/industry-data/` 目录
- 修改: `packages/agentai-gateway/src/industry-engine.ts`

### P1-2: Store 合并
- 修改: `packages/agentai-gui/src/store/` 多个文件

### P1-3: 用户反馈
- 修改: `packages/agentai-gateway/src/feedback-loop.ts`
- 新增: 前端反馈 UI 组件

### P1-4: 页面合并
- 修改: `packages/agentai-gui/src/App.tsx`