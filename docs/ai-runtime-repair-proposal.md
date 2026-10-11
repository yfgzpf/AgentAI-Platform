# AgentAI 运行时修复建议书

> 版本: v1.0 ｜ 日期: 2026-10-12 ｜ 状态: 待评审（未实施任何代码改动）
>
> 目标: 解决"AI 累、做不了长任务、能力发挥不出来"的运行时根因。
> 原则: 先止血、后治本; 优先新增模块挂载, 不先动上帝文件; 每步可独立验证。

---

## ⚠️ 实测校正（2026-10-11 复核）

本文第 1 节「问题诊断」有 **5 处与代码实测不符** —— 把**已存在**或**休眠**的机制当成"缺失"。
若照原诊断实施, 会**重复造轮子**（AGENTS.md §二.2 明令禁止）。原文保留作历史记录, 以下为核验后的真相。

### 实测三分类

| 方案书说 | 实测 | 证据 / 核验命令 |
|---|---|---|
| L1「无循环检测、无熔断」 | **已存在** | `grep -c "_hardStopNext" packages/agentai-gateway/src/agentai-loop.ts`；跨轮去重 + `[SKIPPED]` 留痕：`grep -n "_skippedToolCalls" ...` |
| L1「无预算守卫」 | **部分存在** | 每轮上限 `const TOOL_BUDGET`（`:3808`）、token 压力预警、60min/10min 超时。**真缺**的只有"每任务累计调用上限"与"独立迭代上限" |
| L2「无优先级注册表」 | **已存在但不完整** | `grep -n "ctxLedger\|const track = " agentai-loop.ts` → `track()` 仅 **7 处**调用点, 全是 `soul:*` |
| L2 60K 预算「硬闸门」 | **形同纸老虎** | `ctxLedger.filter(e => e.priority <= 30)` + `if (entry.priority < 30) break` → **只可能丢弃 priority 恰为 30 的 5 条 soul 注入**, 其余 44 条注入结构上不可触碰 |
| L2「无冷热分级」 | **已存在** | `compressAllToolResults`（`:4213`）、`pruneOldToolResults` + `maybeFold`（`:5386`）**无条件执行** |
| L3「台账未持久化」 | **已持久化 + 真缺一半** | `active-plan.json` 落盘（`tools.ts` `getActivePlan`/`setActivePlan`）。**真缺**的是"台账 goal 的冷启动回填"（本轮已补） |
| L3「无 checkpoint」 | **休眠** | `grep -rn "addCheckpoint(" packages/agentai-gateway/src --include=*.ts` → **0 个调用者**（实现存在, 无人调用） |
| L4「313 技能全量注入」 | **已过滤** | `grep -n "slice(0, 10)\|slice(0, 3)" agentai-loop.ts` → 技能注入已是 **Top-10 / Top-3** |
| L5「无自检钩子」 | **休眠** | `grep -rn "AI_SELF_CHECK_PROTOCOL\|selfCheck(" src --include=*.ts` → 各 **1 处**（仅定义, 零调用） |
| L5「元认知层缺失」 | **对强模型有意关闭** | `grep -c "_capabilityTier !== 'autonomous'" agentai-loop.ts` → **5 处**, 注释已标"非技术债" |

### 第 1.1 节数字更正

| 原文 | 实测 |
|---|---|
| `buildImmutablePrefix()` 约 689–1715 行 | **:812 起, 下一个方法 :1928 结束**（`grep -n "private async buildImmutablePrefix\|private buildExternalToolsContext"`） |
| 49 处 `systemMsgs.push({role:'system'})` | 字面量 **32** 处; `systemMsgs.push(` 总数 **49**（含变量 role） |
| 17 个平铺 try/catch | 实际顶层 try/catch 区块 **14** 个 |
| 技能 313 个 / 200+ 个 `[low]` | 数量未复核（**不要引用未经复核的数字**）；注入侧已 Top-K 过滤, `[low]` 是 `riskLevel` 风险标记, **不是重要度分级** |

### 本轮（批次1）实际修了什么

只补 4 个**真缺口**, 不新建任何层：

| 缺口 | 修法 | 证据 |
|---|---|---|
| 跨迭代连续失败计数**被每轮重建**（"失败 3 次换方案"从未生效） | `duplicateTracker` 局部 Map → 实例字段 `_failTracker` | `agentai-loop.ts` 字段声明 + `run()` 内 `_failTracker.clear()` |
| 同文件反复改（参数每次不同）**全签名去重拦不到** | 复用 `ledger.writeCount()` 注入 `repeat_write` **提醒**（不拦截） | `grep -n "repeat_write\|WRITE_CLASS_TOOLS" agentai-loop.ts` |
| 无**每任务累计**工具调用上限 | `TOOL_CALL_BUDGET = 200` + `tool:budget-exceeded` | `grep -n "TOOL_CALL_BUDGET" agentai-loop.ts` |
| 迭代上限**埋在超时块内**（没超时 = 无上限） | 循环顶部独立硬闸（软着陆 1 轮后 break） | `grep -n "this.iteration >= this.opts.maxIterations" agentai-loop.ts` |

**意外收获（实测证据）**：G4 迭代硬闸修好了 **5 个既有的失败测试** —— 它们并非断言错误, 而是
`Error: Test timed out in 10000ms`（循环无上限, 其中一个空转到 `iter=48`）。
基线因此从 `804 测试 / 7 失败` 变为 `815 测试 / 2 失败`（其余 2 个为 b1-security、code-runner 的源码契约断言, 与本轮无关）。

回归测试：`packages/agentai-gateway/src/runtime-guard.test.ts`（11 项, 行为级 + 源码契约级）。

---

## 0. 摘要（一句话版）

平台用"加法"堆功能, 但运行时缺了**代谢系统**——上下文排不掉、任务记不住、循环拦不住、能力找不到、异常感知不到。
本建议书给出 **5 层修复 + 3 批实施路线**, 前两批（止血）**不触碰 `tools.ts` / `agentai-loop.ts` 主体**, 可在低风险下快速见效。

| 层级 | 修复目标 | 根治的症状 | 优先级 | 风险 |
|---|---|---|---|---|
| L1 循环层 | 循环检测 + 目标校验 + 预算守卫 | 重复读文件、目标漂移 | **P0 止血** | 低 |
| L2 上下文层 | 优先级注册表 + 三级记忆 | 注意力涣散、中间遗忘 | **P1 治本** | 中 |
| L3 工作记忆层 | 任务台账持久化 + Checkpoint | 长任务中断即归零 | **P2** | 中 |
| L4 工具技能层 | 技能渐进式披露 + 结果压缩 | 313 技能过载 | **P2** | 低 |
| L5 元认知层 | 自检钩子（把脉机制） | 不知道自己迷路 | **P3** | 低 |

---

## 1. 问题诊断（带代码证据）

### 1.1 上下文层: 49 处 push / 17 个平铺 try-catch
- **位置**: `packages/agentai-gateway/src/agentai-loop.ts` 的 `buildImmutablePrefix()`（约 689–1715 行）。
- **事实**: 函数内含 **49 处 `systemMsgs.push({role:'system'})`**, 结构是 **17 个平铺的 try/catch 区块**, 无分层抽象、无优先级注册表。主循环另有 **15 处 `appendOnlyLog.push` + 约 17 处其他 system 注入**。
- **后果**: 注入顺序即优先级, 但顺序靠人工维护; 注释编号（§1.7 / §1.76）已自相矛盾, 无人掌握全局。→ **每轮灌入的内容不可控, 关键信息被淹没。**
- **现有缓解**: `CTX_TOTAL_BUDGET_CHARS = 60_000` 仅作**出口硬截断**。

### 1.2 循环层: 无熔断、无 checkpoint
- **事实**: 未发现"同一文件重复读 / 同一命令重复跑"的运行时拦截; 长任务无断点落盘。
- **后果**: 靠 AI"自觉"避免打转, 而累的时候自觉不可靠 → **原地打转、上下文烧光**。

### 1.3 工作记忆层: 台账是权宜之计
- **事实**: 当前"任务台账"靠每轮 prompt 重复注入来防失忆, 未持久化到独立存储。
- **后果**: 上下文一压缩、会话一断, 目标即漂移 → **长任务 = 更长的单次会话, 一断归零**。

### 1.4 工具技能层: 全量注入
- **事实**: 技能列表 **313 个**同时注入, 其中 **200+ 个标记 `[low]`**。
- **后果**: 信息过载, 命中率反而下降 → **"想用某能力却想不起来"**。

### 1.5 元认知层: 缺失
- **事实**: 无自检钩子; 文档自述"它还不知道自己何时在迷路"。
- **后果**: "先诊断后治疗"目前是**对外口号**, 未成为**对内机制**。

> **横切根因**: 平台默认"信息越多越好"。但对 LLM 而言, **信息过载 = 变笨**（lost-in-the-middle + 注意力稀释）。

---

## 2. 修复方案（分层）

### L1 —— 循环层【P0 止血】

**L1.1 循环检测熔断器**
- 新建 `packages/agentai-gateway/src/runtime/loop-guard.ts`，不侵入主循环。
- 维护一个"动作指纹"滑动窗口（哈希 = `工具名 + 关键参数`）。
- 命中重复（如某文件 2 次、某命令 2 次）→ 注入一条**系统提醒**并建议换路, 而非静默。
- 触发上限后**升级为阻断**, 要求 AI 明确说明"为何重试"。

**L1.2 目标锚定校验**
- 每轮开头重新注入一句**用户原始目标**（从持久化台账读取, 见 L3）。
- 提供 `anchor_check()`：判断"当前动作是否仍服务最初目标", 偏离则提示拉回。

**L1.3 三元预算守卫**
- 现只有 `chars` 预算, 扩展为 **时间 / 工具调用次数 / 上下文字符** 三维。
- 任一接近阈值 → 主动降级策略（摘要而非展开、跳过非关键工具）。

**验收**: 连续 3 轮重复动作能在第 2 次被拦截; 长任务中途"跑偏"能被拉回。

---

### L2 —— 上下文层【P1 治本】

**L2.1 优先级注册表（替换 17 个平铺块）**
- 新建 `packages/agentai-gateway/src/runtime/context-registry.ts`。
- 每个上下文片段声明 `{ name, priority, scope, build() }`, 由注册表统一收集/排序/裁剪:

```
P0  身份 + 行为准则          每轮必带（小）
P1  当前任务 + 台账锚点      每轮必带（中）
P2  相关记忆 / RAG / 客户档案  按需检索（可变）
P3  背景（行业 / 技能索引）    惰性注入（命中才加）
```

- **迁移策略**: 不重写 `buildImmutablePrefix`, 而是**逐步把区块"注册"进来**, 双跑对比输出, 稳定后切换。→ 风险可控。

**L2.2 三级记忆（Hot / Warm / Cold）**
- **Hot**: 当前对话全量。
- **Warm**: 本轮相关文件 → 存**摘要**。
- **Cold**: 历史 → 只留**索引**, 需要时再取。
- 超预算时**语义压缩**（便宜模型总结"决策+结论"）, 替代现在的**尾部截断**。

**验收**: 同 60K 预算下, 可容纳的"有效信息"显著提升; 中间内容不再无端丢失。

---

### L3 —— 工作记忆层【P2】

**L3.1 任务台账持久化**
- 台账从"每轮 prompt 拼接"升级为落盘存储（JSONL, 路径如 `.agentai/work-memory/<session>.jsonl`）。
- 工具结果**自动摘要入库**, 不原样堆上下文。
- 每轮开头加载 + 校验目标锚点。

**L3.2 Checkpoint 断点续跑**
- 长任务每 N 步存档（目标 / 进度 / 已完成 / 已失败 / 已决策）。
- 支持 **暂停 / 恢复 / 跨 session 移交**。

**验收**: 关掉会话、重开, 能"接着上次干", 且目标不漂移。

---

### L4 —— 工具技能层【P2】

**L4.1 技能渐进式披露**
- 不再全量注入 313 个; 按当前任务语义检索 **Top-K（建议 K=10）**。
- 其余保留**索引**（名称+一句话）, 命中关键词再展开详细定义。

**L4.2 工具结果压缩**
- 大输出（日志 / 长列表 / 大 diff）先摘要再入上下文。
- 阈值可配（如 >4KB 触发摘要）。

**验收**: 技能命中率上升; 单轮上下文占用下降。

---

### L5 —— 元认知层【P3, 长期收益最高】

**L5.1 自检钩子 `self_check()`**（每 N 轮触发）

```
self_check():
  in_loop     最近 3 个动作是否重复?      → 是则收敛
  goal_drift  当前动作是否服务最初目标?    → 否则拉回
  budget      上下文/时间/调用是否将超?    → 是则换策略
```

- 输出为**系统级健康提示**, 可观测、可日志、可告警。
- **这一步最配得上 "PulseFlow" 之名**: 把脉 → 发现异常 → 主动调理。

**验收**: 能主动报告"我正在打转 / 我偏离了目标"。

---

## 3. 实施路线图

### 第 1 批（止血, 1–2 天, 低风险）
1. L1.1 循环检测熔断器（新增文件, 主循环只加一个 hook 调用）
2. L1.2 目标锚定校验（依赖 L3 的最小落盘）
3. L1.3 预算守卫扩展

> **不动 `tools.ts` / `agentai-loop.ts` 主体结构**, 只挂载。见效最快。

### 第 2 批（治本, 3–5 天, 中风险）
4. L2.1 优先级注册表（双跑对比后切换）
5. L2.2 三级记忆 + 语义压缩

> 触碰 `buildImmutablePrefix`, 需灰度 + 回滚预案。

### 第 3 批（长任务 + 能力暴露 + 元认知, 1–2 周）
6. L3 工作记忆持久化 + Checkpoint
7. L4 技能渐进式披露 + 结果压缩
8. L5 自检钩子

> 相对独立, 可并行推进。

---

## 4. 明确"不做什么"（避免过度工程）

- **不重写** `agentai-loop.ts`（先挂载, 不推倒）。
- **不一次性** 清理 4361 个 `any` / `@ts-nocheck`（与本目标无关, 另立专项）。
- **不追求** 一次把 17 个平铺块全部重构（分批注册, 双跑验证）。
- **不引入** 新的大依赖（优先用现有 `better-sqlite3` / JSONL）。

---

## 5. 附录: 关键接口草案

```typescript
// runtime/loop-guard.ts
export interface ActionFingerprint { tool: string; key: string; at: number; }
export interface LoopGuard {
  observe(fp: ActionFingerprint): 'ok' | 'warn' | 'block';
  reset(): void;
}

// runtime/context-registry.ts
export interface CtxFragment {
  name: string;
  priority: 0 | 1 | 2 | 3;
  scope: 'always' | 'on-demand' | 'lazy';
  build(): Promise<ChatMessage | null>;
}
export interface ContextRegistry {
  register(f: CtxFragment): void;
  collect(budgetChars: number): Promise<ChatMessage[]>;
}

// runtime/work-memory.ts
export interface WorkMemory {
  loadAnchor(sessionId: string): Promise<string | null>;
  append(sessionId: string, entry: { kind: string; summary: string }): Promise<void>;
  checkpoint(sessionId: string, snapshot: Record<string, unknown>): Promise<void>;
  resume(sessionId: string): Promise<Record<string, unknown> | null>;
}
```

---

*本文件仅为建议方案, 未改动任何现有代码。评审通过后再进入实施。*
