# PulseFlow 自主开发指南 —— 抄什么 · 删什么 · 怎么排期

> **生成日期**：2026-10-10
> **方法论**：源码级实测（行区间精确统计 + 语义验证），**不采信任何文档自述**
> **基线**：`agentai-gateway` 292 文件 / 29 子系统 / 核心四件套 18,090 行
> **前置校验**：`tsc --noEmit` 全绿（EXIT=0），回滚锚点 `4fa471f`，分支 `fix/strict-audit-2026-10-03`

---

## 卷首 · 三句话

1. **这份文档的价值全在"实测"二字。** 下面每一个数字都是我写脚本从源码里抠出来的，与官方文档冲突处以本文为准。
2. **平台最该抄的不是工具数量，是三个抗脆弱性设计**（代际计数器、超时软降级、注入预算机制——虽然这个机制建错了容器）。
3. **平台最该避的不是代码丑，是三个静默缺陷**（零 prompt 预算、静默 catch、强模型决策层永不执行）。这些坑我自己都踩过一遍。

---

# 第一卷· 实测数据（全篇基石）

## 1.1 文档失真清单 —— 信任边界从这里开始

接手任何宣称「已完成 / 已精简」的项目，**第一件事是核对真实数字**。本项目文档与代码的偏差：

| 文档宣称 | 实测结果 | 偏差 | 证据位置 |
|---|---|---|---|
| 141 个工具 | **198 声明 / 203 实现** | 低估 40% | `tools.ts:749-1382` / `1383-7459` |
| 8 层上下文注入 | **49 处 prefix push** + 15 处 log push + 17 处其他 | **高估 6 倍** | `agentai-loop.ts` |
| system-prompt.ts 约 250 行 | **643 行 / 38,999 字符** | 高估 2.6 倍 | `system-prompt.ts` |
| 记忆 >30 条自动合并 | **该逻辑不存在**（实为构建期 slice 截断） | 功能虚构 | `memory-manager.ts` |
| 五维路由在 llm-router | 实际在 `model-classifier.ts:580` | 指错文件 | — |
| 测试「有覆盖」 | 65 文件 / ~811 it，但 **6416 行主循环零覆盖** | 覆盖错觉 | `vitest.config.ts` |
| 上下文分层注入（§1-§8） | **17 个平铺 try/catch**，无注册表无优先级 | 无架构 | `agentai-loop.ts:689-1715` |

**核对工具本身（可直接复用）**：

```python
# 精确统计 EXTRA_TOOLS vs EXTRA_HANDLERS 配对
import re, io
L = io.open('tools.ts', encoding='utf-8').read().split('\n')
t_start = next(i for i,l in enumerate(L) if l.startswith('export const EXTRA_TOOLS = ['))
h_start = next(i for i,l in enumerate(L) if l.startswith('export const EXTRA_HANDLERS'))
h_end   = next(i for i,l in enumerate(L[h_start:], h_start) if l.rstrip() == '};')

names = list(dict.fromkeys(re.findall(r"name:\s*'([A-Za-z0-9_]+)'", '\n'.join(L[t_start:h_start]))))
keys  = list(dict.fromkeys(re.findall(r'^ {2}([A-Za-z0-9_]+)\s*:\s*(?:async\s*)?\(',
                                    '\n'.join(L[h_start:h_end+1]), re.M)))
print(f'声明 {len(names)} / 实现 {len(keys)}')
print('声明无实现:', [n for n in names if n not in keys])
print('实现未声明:', [k for k in keys if k not in names])
```

> **踩坑提醒**：这个脚本我写坏了 5 次才跑通。原因依次是——① 行区间截断遇模板字符串 ② bash 双引号吞掉 `\"` ③ `[^|;&]*` 被 shell 当管道 ④ 正则贪婪匹配跨过整个 handler 块 ⑤ 模板字符串里的 `${}` 破坏括号配平。
> **教训**：统计脚本必须写成独立 `.py` 文件，**绝不要用 `python -c` 内联**——shell 转义层会吃掉你的正则。

## 1.2 真实容量

```
tools.ts              7,714 行   198 工具声明 + 203 handler（全文 @ts-nocheck）
agentai-loop.ts       6,416 行   唯一上帝类
llm-router.ts         2,245 行   修复管道 + 熔断 + 降级 + 缓存
model-classifier.ts   1,091 行   五维评分（文档指错位置）
tool-registry.ts        624 行   注册 + 参数校验
soul/                 2,355 行   人格连续性（平台无对应物）
xuanji/               1,232 行   任务规划器（真闭环）
diagnosis/            1,384 行   诊断/gap分析（平台无对应物）
```

工具风险分布：**low 107 / medium 51 / high 20**。测试：65 文件 / ~811 it / 覆盖率门槛 lines 60% branches 50%。

---

# 第二卷 · 抄（直接可用的设计）

## 2.1 ★★★★★ 代际计数器 —— 全项目最值得抄的一行设计

**问题**：`abort()` 设 `_aborted=true` → 新 `run()` 把它重置为 false → 旧 `run()` 从 await 恢复后看到 false，**继续跑**。这是 AbortController 解决不了的竞态——`abortSignal.aborted` 无法区分「谁 abort 的」。

**解法**（`agentai-loop.ts:294-301`）：

```ts
/** 代际计数器: 解决中断后竞态条件
 *  每次 run() 分配唯一 generation ID, abort() 记录被中断的 generation。
 *  循环内检查: 当前 generation ≠ 被中断的 generation → 已被新 run() 取代 → 立即退出。
 */
private _runGeneration = 0;
private _abortedGeneration = 0;
```

三处配套使用：

| 位置 | 代码 | 作用 |
|---|---|---|
| `run()` 入口 ~1876 | `const myGeneration = ++this._runGeneration` | 领取代际 |
| `abort()` 428-439 | `this._abortedGeneration = this._runGeneration` | 记录被中断的是哪一代 |
| 循环内 2614 / 2903 | `if (myGeneration !== this._runGeneration) return` | 优雅退出，**不 throw** |

**为什么满分**：单调计数器 + 身份比对，天然免疫「谁重置了标志位」。这一条值 200 行注释。

## 2.2 ★★★★★ 超时软降级三件套

**问题**：长任务跑到 30 分钟，直接 kill 掉 = 前功尽弃。

**解法**（`agentai-loop.ts:2876-2900`）：

```ts
if (idleTime > IDLE_TIMEOUT_MS || totalTime > ABSOLUTE_MAX_MS) {
  // ① 注入"请总结"指令，而不是直接停
  this.directives.add('timeout',
    `[SYSTEM] 已运行 ... 请检查进度后继续; 如果确实无法继续, 请总结当前进展。`, 'high');
  // ② 强制同步写盘快照（关键：flush 而非等 debounce）
  if (taskSnap) { taskSnap.setResumeHints({...}); taskSnap?.flush(); }
  // ③ 发事件，供 SSE 转发给前端
  this.emit('timeout', {...});
  const dynamicMax = ctxWindow >= 500_000 ? 50 : ctxWindow >= 200_000 ? 40 : 30;
  if (this.iteration > effectiveMax - 2) break;   // ← 真正的硬退出在这里
}
```

**三个要点**：
- **超时本身不 break**，只给 2 轮机会。真正的硬退出条件是「接近轮数上限」。
- `flush()` 而非异步写——超时时刻进程可能立刻退出。
- 按上下文窗口动态调整轮数上限，而不是写死。

**对照实现**：TTCM 那边超时是 `break`。**同源架构，这里更聪明。** 抄这个。

## 2.3 ★★★★★ 上下文预算仲裁器（机制对，位置错——自己写时修好）

平台的 `MAX_INJECTION_BUDGET = 3000` / `MAX_INJECTION_COUNT = 7`（`agentai-loop.ts:2400-2401`）思路极对：**按优先级裁剪注入，合并成一条**。

**但它建在了错误的容器上**（实测确认）：

```
ensureContext()  :677  this.context.immutablePrefix = await this.buildImmutablePrefix(...)
仲裁器:2527  this.context.appendOnlyLog.filter(m => m.role === 'system')

immutablePrefix 消费点: 2626 / 2953 / 3377 / 3457 / 4893 / 4958 / 5001 / 5034
```

49 条 system 消息进的是 `immutablePrefix`，**从不进入 `appendOnlyLog`**（`ensureContext:678` 明确把 system 从 appendOnlyLog 过滤掉）。所以这个 3000 字符预算**根本管不到那 38,999 字符的 identity**。

**自己开发时的正确做法**——在 prefix 构建出口做统一仲裁：

```ts
// ✗ 平台做法：预算建在 appendOnlyLog，管不到 prefix
// ✓ 正确做法：ContextProvider 数组 + 出口仲裁

interface ContextProvider {
  name: string;
  priority: number;      // 0=必保留 100=可丢弃
  maxChars: number;      // 单块硬上限
  build(): Promise<string | null>;
}

// buildImmutablePrefix 从 1028 行平铺 try/catch → 变成声明式注册
const providers: ContextProvider[] = [
  { name: 'identity',  priority: 0,   maxChars: 12000, build: () => buildIdentity() },
  { name: 'tools',     priority: 10,  maxChars: 8000,  build: () => buildToolsFragment() },
  { name: 'soul',      priority: 20,  maxChars: 6000,  build: () => buildSoul() },
  // ... 44 个
];

// 出口统一仲裁：超预算时按 priority 从高到低丢弃，并留下可观测日志
async function buildImmutablePrefix(messages: ChatMessage[]) {
  const built: Array<{ name: string; content: string; priority: number }> = [];
  for (const p of providers) {
    try {
      const c = await p.build();
      if (c) built.push({ name: p.name, content: c.slice(0, p.maxChars), priority: p.priority });
    } catch (e) {
      logger.warn(`[ctx:${p.name}] 构建失败`, e);   // ★ 绝不能 catch {}
    }
  }
  const total = built.reduce((s, b) => s + b.content.length, 0);
  if (total > SYSTEM_TOTAL_BUDGET) {
    const kept = dropLowPriority(built, SYSTEM_TOTAL_BUDGET);   // 按 priority 升序保留
    logger.warn(`[ctx] 预算超限 ${total}→${kept.length * 1}，丢弃: ${droppedNames(built, kept)}`);
    return kept.map(b => ({ role: 'system', content: b.content }));
  }
  return built.map(b => ({ role: 'system', content: b.content }));
}
```

**收益**：44 个平铺 `if` → 一张可观测、可排序、可预算的表。调试时能一眼看出「这轮注入了什么、丢了什么、为什么丢」。

## 2.4 ★★★★☆ 修复管道 6 步（输出层自愈）

`llm-router.ts:981 repairPipeline(raw)`，`chat():820` 调用。

```
1. flattenToolCalls    :1235  嵌套对象压成点号键，数组保留不展平
2. scavengeFromThink   :1260  从 <think>块正则打捞被吞的 JSON
3. detectCallStorm     :1281  同轮≥3调用时签名去重计数，仅告警不去重
4. repairTruncation    :1294  统计括号差值补齐
5. repairToolCallArgs  :1172  尾逗号→引号→无引号key→undefined
6. parseTextToolCalls  :1013  4 种降级格式文本转 tool_call
```

**两个「克制」是精华，务必理解其所以然**：

**Step 4：只补 args 的括号，绝不动 content。**
平台注释写明原因：对代码正文补 `}` 会破坏语法（`if(x){` → `if(x){}` 反而语法错）。
**很多人写修复器都会犯这个错**——总想"把 JSON 补完整"，却忘了 content 里是自然语言/代码。

**Step 5：`smartQuoteFix`（:1200）是状态机逐字符扫描**，不是正则替换。只把 JSON **边界位置**的单引号换成双引号，字符串**内部**的单引号原样保留，内部双引号转义为 `\"`。动机注释举例：`{"code":"console.log('hello')"}` 不被误伤。
**用全局正则做这件事必翻车**——`replace(/'/g,'"')` 会把代码里的引号全毁掉。

**Step 6 降级格式矩阵**（值得整段抄）：

```
func(args)              裸函数调用式
```tool ... ```         代码块式
<tool_call>...</tool_call>  XML 式
DSML 伪XML              <｜DSML｜invoke name="x"><｜DSML｜parameter name="p">v
                        （DeepSeek 系私有格式）
```

配套两条硬要求：
1. 工具名必须过 `KNOWN_TOOL_NAMES` 白名单（约 110 个）校验，防止模型幻觉出不存在的工具。
2. **解析成功后必须从 content 正则擦除已消费文本**，否则模型会在下一轮重复输出已执行的调用。

## 2.5 ★★★★☆ multi_edit 三阶段事务

`tools.ts:1824 / 1862 / 1891`

```
Phase1  预检 + 备份  → 任一 old_str 未找到，直接 return，一字不改
Phase2  原子执行     → 统一 backupId = Date.now()，批量备份
Phase3  回滚        → 任一 write 抛错即 break，遍历 backups 全部还原
```

**「预检失败必须完全不改」是很多编辑器类工具缺的**——它们边改边找，改到一半失败，留下半成品。

配套：**备份即一次性令牌**。`undo_edit`（`tools.ts:2292`）用完 `unlinkSync` 删除备份文件，避免备份无限堆积。

## 2.6 ★★★★☆ fail-closed 沙箱

`sandbox/checker.ts`（91 行），优先级 `deny > size > prompt > default-allow`。

```ts
} catch (e: any) {
  return { verdict: 'deny', reason: `Sandbox check error: ...`, source: 'error' };
}
```

**异常必须 deny，不能放行。** 这一条是整个沙箱的安全基石。

配套 `safety/path-guard.ts:60` 的前缀绕过防护：
```ts
resolved.startsWith(r + path.sep)   // 防止 /workspace-evil 通过 /workspace 校验
```

## 2.7 ★★★☆☆ 三个一次性注入闸门

`_startupGitInjected`（1351）/ `_startupSelfDiagnosis`（1386）/ `_startupSessionInjected`（1437）。

**把「首轮一次性」与「每轮」在类型层面分开**，而不是靠 `iteration === 0` 这种魔法数字。正确做法：三个独立 flag，与 iteration 完全解耦。

## 2.8 ★★★☆☆ MCP 客户端（手写 JSON-RPC 的两处消毒）

`mcp/host.ts`（301 行），不依赖官方 SDK。**这两处消毒必抄**：

```ts
normalizeSchema(schema)              // 强制 type:'object'（模型常返回残缺 schema）
name.replace(/[^a-zA-Z0-9_-]/g,'_')  // 工具名消毒，防注入
```

## 2.9 ★★★☆☆ 路由冷启动中性值

`model-classifier.ts:580`

```
复杂度 0.30 + 上下文 0.15 + 成本 0.20 + 成功率 0.25 + 延迟 0.10
```

两个细节值得抄：
- **未定价的付费模型成本分给 0.5 中性值**（:604）。平台注释说明原公式让未填 price 的付费模型与免费模型同拿满分，即「付费当免费」——真实的坑。
- **successRate / latency 无数据时默认 0.5**，不是 0。否则新模型永不被选中（0 分永远排在有数据的模型后面）。

熔断：`CB_COOLDOWN_MS=2min`、连续失败 3 次、429 指数退避 10s→120s、`FLAKY_PROVIDERS={sensenova,longcat}` 设 15s 短超时。
**重要修正**（:692 注释）：移除了 force-untrip——原逻辑对熔断中的 provider 每请求强试一次，**完全绕过 2 分钟冷却**。

---

# 第三卷 · 避（平台踩过的坑）

## 3.1 ★★★★★ 零 prompt 预算（最严重的量化缺陷）

**实测数据**：

| 块 | 位置 | 字符数 |
|---|---|---|
| `AGENT_SYSTEM_IDENTITY` | `system-prompt.ts:16-` | **38,999** |
| `agent-behavior-rules.ts` | — | 9,131 |
| `buildLiteSystemPrompt` | `system-prompt-lite.ts` | 7,255 |
| `# 行为准则补充` | `loop:1581` | ~1,500 |
| 工具块（N 个 × desc） | `tool-groups.ts:193` | ~8,000 |
| soul 七件套 | `loop:1321-1347` | 2,000–5,000 |

**搜索证据**：全文件 grep `truncate|truncat|maxLength|MAX_PROMPT|MAX_SYS|systemBudget|budget` 共 11 处命中，**全部与 system 前缀无关**（截工具调用数量、检测模型输出截断、给 AI 的文字提示）。`buildImmutablePrefix` 内所有 `slice` 都是**数据源自我裁剪**（goal 200 字符、keywords 80……），**没有一处对最终 systemMsgs 数组做总长度检查**，函数直接 `return systemMsgs;`（1715）。

**后果**：一次请求 immutablePrefix 常在 20k–60k 字符（≈8k–25k token），**且随 soul/记忆/知识库增长无上限**。

**自己开发时**：§2.3 的 ContextProvider + 出口仲裁是解药。

## 3.2 ★★★★★ 静默 catch（生产不可调试）

实测确认的空 catch：

| 行 | 内容 | 后果 |
|---|---|---|
| 1348 | soul 七件套整块 | 任一模块异常 → **7 层全静默丢失，无日志** |
| 823 | evolution 记忆 | 进化规则不生效，无感知 |
| 924 | world memory | 世界记忆丢失，无感知 |
| 958 | task store | 任务状态丢失，无感知 |
| 1490 | remote 上下文 | 远程上下文丢失，无感知 |
| 1874 | tier 决策（兜底 supervised） | 这个至少有兜底值，可接受 |

**上线后你会遇到的情况**：用户说「它好像不认识我了」，你查日志什么都没有，因为 `catch { /* soul layer optional */ }`。

**规则**：注入构建失败必须 `logger.warn('[ctx:xxx]', e)`。可选 ≠ 可静默。

## 3.3 ★★★★★ 强模型决策层永不执行

实测调用点与门控：

```
MetaCognitiveLoop      agentai-loop.ts:4609-4646（文件 meta/meta-cognitive-loop.ts 159 行）
ConfidenceEstimator    agentai-loop.ts:4705-4748, 4777-4790（文件 meta/confidence-estimator.ts 220 行）
IntentClarifier        agentai-loop.ts:2097-2107（文件 meta/intent-clarifier.ts 278 行）
歧义检测（正则）        agentai-loop.ts:2565-2583（内联）

门控（全部跳过 autonomous）：
  :4607  if (this._capabilityTier !== 'autonomous' && this.iteration < maxIterations * 0.5)
  :4775  if (this._capabilityTier !== 'autonomous' && this.iteration < maxIterations * 0.5)
```

**后果**：付费强模型（DeepSeek Pro / GPT-4o 等）**整个元认知 + 置信度层永远不执行**。注释 :4605 写「强模型跳过 — 它自己知道该不该继续」。

**更糟的是**：即使命中也只有后 50% 迭代（90 轮里第 46-90 轮）。**付费成本最高、调用量最大的配置，决策层完全静默。**

**且**：`MetaCognitiveLoop` 的 `currentPlan: []` / `pendingQuestions: []` **恒为空数组硬编码**（:4615-4616, 4635-4636）——即使执行，它也拿不到真实 plan。

**教训**：要么别做元认知层，要么别在架构图里宣称它是核心机制。当前状态是投入 159+220+278 = 657 行代码 + 5 个测试文件，生产主路径永不执行。**这是最贵的技术债——不是代码债，是认知债。**

## 3.4 ★★★★☆ 上帝类：6416 行 = 17 个平铺 try/catch + 49 个无注册表 push

**已自相矛盾的注释**（1247-1262 行）：
```
"已合并到 §1.7，此处禁用"
"已并入上方 §1.6，此处已删除"
"§1.76" 出现在 "§1.75" 之前
```

**这就是"多次重构后无人理解全局"的典型症状。** §2.3 的 ContextProvider 重构是解药。

**拆分建议**（按实测的耦合度）：

```
context-builder.ts     §2.3 的 ContextProvider 数组
loop-controller.ts     while(true) 主循环 + 计数器
tool-dispatcher.ts     dispatchToolCalls + 审批门
memory-integration.ts  记忆/进化/soul 的读取与注入
decision-layer.ts      元认知/置信度/歧义（并解决 3.3 的门控问题）
```

## 3.5 ★★★★☆ 静默丢弃用户改动（真实 bug，反面教材）

`agentai-loop.ts:3636-3670` 跨轮去重，签名用 `JSON.stringify(args).slice(0, 500)`。

**故障**：两个不同的 `write_file`，content 前 500 字符相同 → 被判为重复 → **用户改动被静默丢弃**。

修复：全量签名 + **跳过时写 `[SKIPPED]` tool 消息让 AI 可感知**。

**教训**：任何去重/去重/截断逻辑，**必须有可感知的中止信号**。静默丢弃是最坏的一种——用户和 AI 都不知道发生了什么。

## 3.6 ★★★☆☆ 其余

| 问题 | 位置 | 说明 |
|---|---|---|
| 整文件 @ts-nocheck | `tools.ts` 全文 | 198 个工具参数无类型保障 |
| 硬编码本机路径 | `agentai-loop.ts:6265` | `^f:\\agentai-platform\\...` 违反自家 AGENTS.md 禁令 |
| 字符串哨兵判断 | `agentai-loop.ts:1221` | `!profile.includes('0,')` 判断 userModel 是否为空，格式化一变就静默坏 |
| prompt 构建期写状态 | `agentai-loop.ts:1324` | `innerVoice.whisper()` 在「不可变前缀」构建期写状态，破坏不可变承诺 |
| userSystemMsgs 无过滤 | `agentai-loop.ts:1672` | 调用方传入的 system 消息直通模型 = prompt 注入面 |
| 重复实现 | `llm-router:1294` vs `loop:3636`；`validator.ts` vs `auto_verify` | 同逻辑两份，其中一份未被调用 |

---

# 第四卷 · 拆（平台已有，不要重造）

> 判定三问：① 平台运行时是否原生提供？② 自建版比平台可靠吗？③ 是 PulseFlow 差异化资产吗？
> 全否 → 删。①是 → 改调平台。③是 → 保留。

## 4.1 红区：平台已有，自建是重复造轮

| 模块 | 行数 | 平台对应能力 |
|---|---|---|
| 自建技能系统 skill-* 17 文件 | 5,856 | Skill 运行时 + 推荐市场 + find-skills + SkillManage + 两级作用域 |
| 自建浏览器 browser-* 5 文件 | 2,033 | **6 个**浏览器技能（agent-browser / tabbit / playwright / stagehand / stealth / qqbrowser） |
| 自建调度 cron-* + automation-* | 1,828 | automation_update（RRULE + SQLite 三表 + 执行历史） |
| 自建 MCP mcp-client + host + config | 1,233 | mcp.json 信任机制 + **400+ 已连接器** |
| 试验性原型（demo/mock/example/debug） | 1,965 | —— 直接删 |

**合计约 11,400 + 1,965 = 13,365 行可删。**

**判定标准（可复用）**：文件名带 `-demo` / `-example` / `-mock` / `debug-` 的，在主干里就是没清理的原型。

**决策依据对比**：
- 自建技能 = 没有市场分发、没有版本、没有安全扫描 → **等于给自己造了个没有生态的影子市场**
- 自建调度 1,828 行 = 「能跑」；平台 = 「可运维」（三表 + 历史查询）

## 4.2 黄区：改造保留（平台有雏形但不足）

| 模块 | 行数 | 处置 |
|---|---|---|
| 自建记忆系统 | 1,699 | 保留 KV 事实层 + 关联网络，通用检索委托平台。**只负责医案经验/辨证结论/用药反馈** |
| 知识探索 | 884 | explorer 降级调平台检索，**保留 distiller + gap-detector**（「找到值得学的之后怎么蒸馏」是差异化的） |
| QQ/微信通道 | 1,251 | 保留，但**不在通道协议上和平台竞争**。价值在「Agent 主动出手」（反向 WS、主动回复） |

## 4.3 绿区：护城河（平台完全没有）

| 模块 | 行数 | 为什么平台替代不了 |
|---|---|---|
| `soul/` 灵魂层 | 2,355 | 内心独白/内部辩论/好奇心/梦境/痛觉/价值向量——**平台无任何对应物**，这是「人格连续性」 |
| `xuanji/` 医案处方 | 1,232 | 辨证论治 + 处方引擎，**真闭环**（见 §5.1） |
| `diagnosis/` 诊断子系统 | 1,384 | 诊断引擎/gap 分析/任务感知 |
| `judge/self-eval.ts` | 245 | 自验证闭环起点 |
| `governor/` | 656 | 能力矩阵 + 运行时追踪 |
| `sandbox/` | 10 文件 | 沙箱规则引擎，平台沙箱**没有「可编辑规则」概念** |
| `qihuang/four-diagnoses.ts` | 699 | ⚠️ 见 §5.1，实为半死代码 |

---

# 第五卷 · 两个必须知道的架构教材

## 5.1 ★★★★★ 同一套中医叙事，一个真闭环一个摆设

这是全项目**最有教学价值的一组对比**。

### xuanji/ = 真闭环（1232 行）

| 中医 | 实际 | 证据 |
|---|---|---|
| 望闻问切 | `perceiveTask()` | `diagnosis/` |
| 切诊 | `diagnoseTask()` | — |
| 开方 | `prescriptionEngine.prescribe()` → **步骤化 tool 序列** | — |
| 医案 | `medicalCaseManager` 持久化 | — |

```
routes/chat.ts:340  调 processTask
routes/chat.ts:349  映射为 strategy: direct / deep / step_by_step
routes/chat.ts:368  接入成本核算
XuanjiResult 含 confidence / riskLevel / estimatedSteps / potentialBlockers
```

**本质**：一个带风险评估的**任务规划器**。`riskLevel` 和 `potentialBlockers` 是关键——它在开方前就告诉你「这步可能卡住」。

### qihuang/four-diagnoses.ts = 半死代码（699 行）

```
agentai-loop.ts:42   import  ✅
agentai-loop.ts      调用  ❌ 全文件 0 处调用
routes/qihuang.ts    独立 HTTP API 暴露（绕开主流程）
```

**699 行 import 了但从未被调用。** 只有独立 HTTP 端点能用。

### 结论

**同一套中医叙事，一个做成了真闭环（进主流程、有成本核算、有风险评估），一个做成了摆设（import 不调用、只能走旁路）。**

**这个对比本身就是最好的架构教材**：技术分级的标准不是「用了什么隐喻」，而是「是否接入主流程、是否有下游消费、是否有可观测输出」。

## 5.2 ★★★★☆ 自进化资产化的三个坑

```
evolve_prompt  → .agentai/evolved-rules.json（上限 20 条，超出 slice(-20)）
                → 下次对话全量拼进 prompt（:1292）
create_tool    → .agentai/custom-tools/ + registry.json
                → 进程启动时 await import(scriptPath) 动态加载（index.ts:147-193）
记忆           → memory-manager.ts (KV 事实层, JSON+JSONL 双源)
                → memory.ts / WorkspaceJournal (日志蒸馏层)
```

**坑 1：自创工具运行期不可见。** `create_tool` 写的脚本**只在下次进程启动时加载**。用户当轮创建的当轮用不了。这是设计取舍，但**必须在 UI 上标注**，否则用户会以为工具坏了。

**坑 2：记忆双轨制未标注。** `memory.ts` ↔ `memory-manager.ts` 两套，职责边界不清。开发时一开始就要分清：
- KV 事实层（"用户叫富哥"、"项目在 F:/xxx"）→ 快、可查、可改
- 日志蒸馏层（"上次那个 bug 是因为…"）→ 慢、语义、只追加

**坑 3：记忆压缩功能虚构。** 文档称 >30 条自动合并，实为构建期 slice 截断。照抄会实现出一个不存在的功能。

---

# 第六卷 · 落地排期

## 6.1 自己开发一个 Agent 框架的话

| 阶段 | 交付物 | 抄本文哪节 |
|---|---|---|
| **P0** | 二段式上下文（prefix + appendOnlyLog）<br>修复管道 6 步<br>fail-closed 沙箱<br>代际计数器 | §2.1 §2.4 §2.6 |
| **P1** | ContextProvider 数组 + 出口预算仲裁<br>超时软降级三件套<br>multi_edit 三阶段事务<br>四个计数器（截断/短答/迭代/子智能体） | §2.2 §2.3 §2.5 |
| **P2** | MCP 客户端（两处消毒）<br>技能渐进式披露<br>五维路由 + 冷启动中性值 | §2.8 §2.9 |
| **P3** | 自进化三件套资产化<br>带风险评估的任务规划器 | §5.1 §5.2 |

## 6.2 在本项目上优化的话

| 批次 | 动作 | 预期收益 | 风险 |
|---|---|---|---|
| **第一批**（零风险） | 删 demo/mock/prototype 1,965 行<br>修订 AGENTS.md 失真数字（§1.1 七处） | 项目轻 30%+，认知债清零 | 极低（删前 grep 验引用） |
| **第二批**（低风险） | ContextProvider 重构 `buildImmutablePrefix`<br>catch {} 补日志<br>预算仲裁移到 prefix 出口 | 上下文可控、故障可定位 | 中（需 tsc + 回归） |
| **第三批**（架构级） | 技能/调度/MCP 三件套收敛到平台 | 换 400+ 连接器、6 浏览器技能、带历史的调度器 | 高（先出适配层设计） |
| **第四批**（必须做） | 决策层门控改掉 §3.3<br>或明确标注「仅弱模型启用」 | 消除 657 行的认知债 | 中 |
| **不排期** | 绿区任何一行不动 | —— | —— |

## 6.3 核心判断

**这个平台的框架决策层已经超过大部分商用产品**（代际计数器、软降级、预算仲裁的**思路**都是生产级）。瓶颈在三处：

1. 单文件 6416 行 → 无法并行开发、无法局部测试、无法安全重构
2. 上下文零预算 → 成本不可控、行为不可预测
3. 核心零测试 + 文档失真 → **认知债已经开始收利息**

**你要借鉴的话**：抄 §2 的九个设计（尤其 2.1/2.2/2.3），避开 §3 的六个坑，就已经超过 90% 的开源 Agent 框架。

**你自己开发的话，只记一条**：**让架构决策可观测。** 平台这三个最严重的问题（静默 catch、零预算、决策层静默）有一个共同根因——**做决策的地方没有留痕**。每次修 bug 都要加行日志的痛，就是这个根因在收利息。

---

## 附录 A · 核心文件速查

| 文件 | 行数 | 作用 | 本文引用 |
|---|---|---|---|
| `tools.ts` | 7,714 | 198 工具 + 203 handler（@ts-nocheck） | §1.1 |
| `agentai-loop.ts` | 6,416 | 上帝类：689-1715 prefix / 1792 run / 2607 主循环 | §2 §3 |
| `llm-router.ts` | 2,245 | 修复管道 :981 / 熔断 / 降级 / 缓存 | §2.4 |
| `model-classifier.ts` | 1,091 | 五维评分 :580（文档指错位置） | §2.9 |
| `system-prompt.ts` | 643 / 38,999 字符 | identity 单块，无预算 | §3.1 |
| `tool-registry.ts` | 624 | 注册 + 参数校验 | —— |
| `sandbox/checker.ts` | 91 | fail-closed | §2.6 |
| `soul/` | 2,355 | 人格连续性 | §5.2 |
| `xuanji/` | 1,232 | 任务规划器（真闭环） | §5.1 |

## 附录 B · 三个计数器（平台续跑不崩的秘密）

```
MAX_AUTO_RESUME        = 10     agentai-loop.ts:2601   截断续写
MAX_SHORT_REPLY_RESUME = 3      agentai-loop.ts:2605   短回复空转（排除问候/告别正则）
maxIterations          = 90     agentai-loop.ts:146/560 总轮数上限
MAX_SUBAGENTS          = 2      agentai-loop.ts:353    子智能体上限
```

**四个互不干扰**——这是长期任务不崩的关键。多数框架只有一个 iteration 计数器，结果截断续跑和总轮数保护互相打架。

## 附录 C · 实时续跑补充（Agent Loop 可借鉴项）

Agent Loop 的续跑用的是**计数器 + 代际 + 超时软降级 + 工作记忆**四件套：

| 机制 | 做法 |
|---|---|
| 三重计数器 | 截断 10 / 短答 3 / 迭代上限，**互不干扰** |
| 短答排除 | 用正则排除「你好/谢谢/再见」，避免把告别当空转 |
| 工作记忆摘要 | 每 10 轮生成，**先 splice 掉旧的再 unshift 新的**（防膨胀） |
| 超时策略 | 工具裁剪到 8 个 + messages 压成 system+最近6条 + sanitize 修 tool 配对 |
| 中断 | 代际检查 → 优雅 return，不 throw |
| 代际竞态 | 单调 `_runGeneration` 计数器，防旧 run 复活 |

**与平台同源**（同为 Agent Loop 架构），细节实现不同但设计判断一致：**软降级优于硬杀，静默丢弃必须配可感知信号。**