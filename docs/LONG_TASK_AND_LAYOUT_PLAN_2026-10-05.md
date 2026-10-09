# 长任务"从头开始" + 前端布局优化 — 调查结论与实施计划

> 制定日期：2026-10-05
> 分支：`fix/strict-audit-2026-10-03`（B0 + 串味修复已完成并通过验收）
> 本文档只给计划，**尚未实施**，等你拍板后再动手

---

# 第一部分：「AI 老是从头开始」根因调查

## 结论先行

**不是单一 bug，是三个"每轮无差别丢弃历史"的截断点叠加。** 其中最致命的一个在 `agentai-loop.ts:1700`——它**每次 run() 开始时**（即用户每次发消息）无条件把上一轮上下文砍到只剩 2 条消息 + 3~5 条工具结果。

所有结论已逐条实读代码核实，行号已复核。

---

## 根因 1：每次 run() 入口无条件清空历史 ★★★★★

**位置**：`agentai-loop.ts:1700-1720`

```ts
// 每次新 run() 调用时: 保留上轮的 assistant 回复, 清除所有旧 user 消息和旧 tool 结果
if (this.context.appendOnlyLog.length > 4) {
  const oldMsgs = this.context.appendOnlyLog.slice(0, -2);
  const recentMsgs = this.context.appendOnlyLog.slice(-2);   // 最近 2 条
  const retainedOld = isSameTopic
    ? oldMsgs.filter(m => m.role === 'tool' && ...).slice(-3)
    : oldMsgs.filter(m => m.role === 'tool' && ...).slice(-5);
  this.context.appendOnlyLog = [...retainedOld, ...recentMsgs];
}
```

**三个叠加缺陷**：

| # | 缺陷 | 后果 |
|---|---|---|
| a | `retainedOld` 只保留 `role === 'tool'` | **所有旧的 user 和 assistant 消息被丢弃**。AI 看不到"上轮我说了什么、承诺了什么" |
| b | `lastUserText` 取自 `recentMsgs` | 判断"是否同一话题"时用的是**即将被保留的那条**，不是被丢的那条。语义反了 |
| c | `slice(-2)` 假设"上轮=user+assistant" | 实际每轮会插入多条 system/tool，拿到的是任意两条，**不保证包含上轮用户诉求** |

**用户可见表现**：每轮都重新问"你要我做什么"、重新解释项目结构、重新读同一个文件。

---

## 根因 2：压缩后把摘要自己过滤掉了 ★★★★★

**位置**：`agentai-loop.ts:2774-2804`

压缩时构造：
```ts
messages = [
  ...systemMsgs,
  { role: 'system', content: `# 对话历史摘要 (${old.length} 条消息已压缩)\n...` },
  ...recent,
];
```

写回时：
```ts
const newLog = [...messages.filter(m => m.role !== 'system')];   // ← 摘要被过滤掉
if (newLog.length > 0) this.context.appendOnlyLog = newLog;
```

**净效果：中间历史被删除，摘要也被丢弃。** 下一轮从 `[...immutablePrefix, ...appendOnlyLog]` 重建时，只剩最近 10 条 + 完全没有摘要。这是**纯信息净损失**。

触发条件很容易达到：
```ts
// :2711
const MAX_TOKENS_EST = this._contextCompressThreshold || 50_000;
const MAX_MSGS = 30;
if (estimatedTokens > MAX_TOKENS_EST || messages.length > MAX_MSGS) {  // ← 30 条极易触发
```

---

## 根因 3：被跳过的工具调用不留任何痕迹 ★★★★☆

**位置**：`agentai-loop.ts:3317-3329`

```ts
if (this._toolCallHistory.has(_sig) && this.iteration > 0) {
  this.directives.add('duplicate_skip', '[SYSTEM] 工具 ... 已在之前轮次执行过', 'high');
  continue;     // ← 不产生任何 tool 消息
}
```

AI 那一轮的 messages 里这次调用彻底不存在——**只看到自己发起了调用，却没有结果**。

而且通知它的 directive 还会被挤掉：
```ts
// :2699-2703
const topDirective = this.directives.flush();   // 每轮只返回 1 条最高优先级
if (topDirective) messages.push({ role: 'user', content: topDirective });
this.directives.clear();                        // 其余全部丢弃
```

`duplicate_skip`（'high'，3317 行加入）与 `task_progress`（'high'，2459 行加入）竞争——`task_progress` 每轮 iteration≥3 都会加入，排序在前，**`duplicate_skip` 被静默 clear 掉**。

还有个次生问题：签名用 `JSON.stringify(args).slice(0, 500)` 截断。`write_file`/`multi_edit` 的 content 参数前 500 字符相同就会被误判为重复。

---

## 加剧因素（不是主因，但让症状更重）

| 编号 | 位置 | 问题 |
|---|---|---|
| A4 | `agentai-loop.ts:2758` | 压缩摘要里"涉及文件" `.slice(0, 15)` 截断，文件多时 AI 不知道自己改过什么 → 重复修改 |
| A5 | `session-manager.ts:29` | TTL 30 分钟。长任务超期 → session 被清 → 新建 loop → **所有 in-memory 状态归零**（彻底失忆） |
| A6 | `agentai-loop.ts:2459` | 任务进度快照有内容（用户目标/已完成/失败项/上次回复），但①`iteration` 每 run() 归零，跨消息后从头数；②被根因 2 吞掉 |
| A7 | `tools/read-tracker.ts` | **59 行死代码**。`markRead`/`reset` 全库零调用。`read_file` 无缓存无"已读过"提示 → 重复读文件零阻力 |
| A8 | `context-manager.ts:104` | `maybeFold` 阈值 76.8k tokens 且 token 估算漏算 tool_calls → **实际从不触发**，保护机制失效 |
| A9 | `agentai-loop.ts:2370` | `MAX_AUTO_RESUME = 10` 死常量（对比 `MAX_SHORT_REPLY_RESUME = 3` 是真检查的）→ 代码异味 |

---

## 被推翻的假设（避免误判优先级）

| 假设 | 结论 | 证据 |
|---|---|---|
| 每次请求重建 loop 丢状态 | **推翻** | `chat.ts:664-698` 同 `userId:workspace` 走 `sessionManager.get()` **复用实例**。仅 TTL 过期时 miss |
| 前端每轮清空消息 | **推翻** | `createSession` 仅在 `!activeId` 时调用（`ChatView.tsx:876`），正常对话不新建 |
| 前端 loading 重置造成错觉 | **推翻** | `setLoading(true)` 唯一入口是发送前 829 行，无迭代级重置 |
| `MAX_AUTO_RESUME` 导致循环重启 | **推翻** | 它是死常量，从未被读取，不导致任何重启 |

**但仍有一个定时炸弹**：`ChatView.tsx:1328` 的 `onSessionRollover` 会 `createSession` + `clearMessages()`——完全符合"从头开始"的表现。**后端从未 emit `session:rollover`**（全库仅前端 `api.ts:281` 一处 case），当前是死代码。接上前端后端之前必须先修它。

---

## 附带确认：会话隔离 bug 仍未修

`sessionStore.ts:4-8` 的 `SessionMessage` 依然**没有 `id` 字段**：
```ts
interface SessionMessage { role: string; content: string; ts: number; }
```
而 `ChatView.tsx:949`（行号已漂移，原 874）仍在用 `findIndex(m => m.id === id)` → **恒为 -1**。

生成过程中切换会话 → 这次生成的消息**根本没写进任何会话** → 用户切回来发现内容没了 → 重新发送 → **AI 又从头开始**。这条虽然不是 AI 侧问题，但**后果等价**，且已在 B2 计划里，今天一并修。

---

# 第二部分：实施计划

## 分批策略

按"改动面从小到大、每批独立可验收"排列。**P0 是必须立刻做的三处**，它们互不耦合，可并行也可分开。

---

## P0 批次：止住失忆（约 1.5 天）

### P0-1 摘要在压缩后要活下来（改动最小，收益最大）

**文件**：`agentai-loop.ts:2801`

**现状**：
```ts
const newLog = [...messages.filter(m => m.role !== 'system')];
```

**改法**：只过滤掉"工具指令类" system，保留摘要类。
```ts
const newLog = [...messages.filter(m =>
  m.role !== 'system' ||
  typeof m.content === 'string' && m.content.startsWith('# 对话历史摘要')
)];
```

**为什么先做这个**：一行改动，止住"删了历史又没留下摘要"的信息净损失。风险极低。

**验收**：构造 40 条消息触发压缩，检查压缩后 `appendOnlyLog` 里有 `# 对话历史摘要` 且下一轮重建 messages 时它还在。

---

### P0-2 工具去重要留可见痕迹

**文件**：`agentai-loop.ts:3317-3329`

**现状**：`continue` 掉，不产生 tool 消息；directive 又会被 `clear()` 挤掉。

**改法**（两处）：
1. `continue` 前 push 一条显式 tool result，让 AI 能直接感知：
```ts
this.context.appendOnlyLog.push({
  role: 'tool', name: tc.name, tool_call_id: tc.id,
  content: `[SKIPPED] 该调用与历史调用完全相同，已跳过。历史结果仍在上文中，请直接使用。`,
});
```
2. 签名去截断：`JSON.stringify(args).slice(0, 500)` → 全量 + 哈希（对 `write_file` 这类含 content 的工具尤其必要）。

**为什么做这个**：让"被跳过"从隐性变显性。比依赖 directive 通道可靠得多（那条通道本身会丢）。

---

### P0-3 SessionMessage 加 id（止住消息丢失）

**文件**：`sessionStore.ts:4-8`、`ChatView.tsx:949`

**改法**：
1. `SessionMessage` 加 `id?: string`
2. `addMessage` 生成 id
3. 兼容旧数据：`onRehydrateStorage` 给无 id 的消息补 id
4. 确认 `appendMessage` 传下来的 `id: userId`/`id: botId` 在同步路径中保留

**验收**：生成过程中切会话 → 切回来消息完整。

---

## P1 批次：重构历史裁剪策略（约 2 天，风险最高需谨慎）

### P1-1 重写 `run()` 入口的历史裁剪

**文件**：`agentai-loop.ts:1700-1720`

这是**根因 1**，也是唯一一处真正需要"重新设计"的地方。建议分两步走：

**第一步（保守，先止症状）**：
- 保留所有 `role === 'user'` 的历史消息（用户诉求是最不能丢的）
- 旧 assistant 消息只保留最后 1~2 条（避免 token 爆炸）
- tool 结果保留策略不变
- 修 `isContinuation` 判断：应该基于**被丢弃的那条**（`oldMsgs` 中最后一条 user）判断，而不是 `recentMsgs`

**第二步（彻底，做结构化摘要）**：
引入一个"任务台账"（task ledger），在裁剪时**摘要化**而非丢弃：
```
## 当前任务
- 用户目标: <最后一条 user>
- 已完成步骤: [...]
- 已修改文件: [...]
- 失败与卡点: [...]
- 下一步: [...]
```
这份台账作为一条 `role: 'system'` 消息常驻，`appendOnlyLog` 只保留最近 N 条原始消息。

**为什么不一步到位**：直接改成"只保留 user"会让上下文结构变得很奇怪（全是 user 没有 assistant 回答），影响面大。需要先做第一步观察实际效果。

**观测先行**：改动前先在 1700 行加一条日志，输出 `appendOnlyLog.length` 的实际收敛值 + 被丢弃的 user 消息数，确认真实数据再动手。

---

## P2 批次：补齐状态感知（约 1.5 天）

| 编号 | 改动 | 文件 |
|---|---|---|
| P2-1 | 接入 `ReadTracker`：`read_file` 成功时 `markRead`，返回里附"（已读，第 N 次）" | `tools/read-tracker.ts` + `read_file` handler |
| P2-2 | 裁剪历史时把"本会话已读文件"一并注入台账 | `agentai-loop.ts:1700` 区域 |
| P2-3 | 去掉"涉及文件" 15 条截断；改为独立结构化字段 | `agentai-loop.ts:2758` |
| P2-4 | 任务进度快照触发条件从 `iteration >= 3` 改为按 `appendOnlyLog` 长度变化触发（因为 iteration 每 run() 归零） | `agentai-loop.ts:2446` |
| P2-5 | SessionManager TTL 30min → 2h，或加"活跃任务锁定" | `session-manager.ts:29` |
| P2-6 | 统一 `maybeFold` 与 2711 那套阈值；token 估算补上 tool_calls | `context-manager.ts:104` |
| P2-7 | 修 `onSessionRollover`：`messages[0]` → `messages[last]`，评估 `clearMessages()` 是否清错会话；在后端 emit 前先标注未接入 | `ChatView.tsx:1328` |
| P2-8 | 接上 `MAX_AUTO_RESUME` 或直接删除（当前是误导性死代码） | `agentai-loop.ts:2370` |

---

## 依赖与风险

```
P0-1（摘 survive）  ← 独立，1 行，最高性价比
P0-2（工具痕迹）    ← 独立，改 2 处
P0-3（Session id）  ← 独立，前端 + store
        │
        ▼
P1-1（历史裁剪重构）← 依赖 P0/P1 都验证过基线，且必须先加观测日志
        │
        ▼
P2 各项            ← P2-1/2 依赖 P1-1 的台账结构
```

**最高风险项是 P1-1**。它直接决定 AI 看到多少历史，改错会同时影响 token 成本和任务连续性。建议：
1. 单独开分支
2. 先只加观测日志跑一轮，拿到真实数据
3. 再做"第一步"保守改动，验证后决定是否做"第二步"

---

# 第三部分：前端布局优化计划

## 现状实测

| 文件 | 行数 | 内联 style | 硬编码色 |
|---|---|---|---|
| App.tsx | 1492 | 84 | 13 |
| ChatView.tsx | 2406 | 39 | 1 |
| Thread.tsx | 1965 | **207** | 1 |
| Settings.tsx | 1341 | **135** | **40** |
| Composer.tsx | 1223 | 90 | 8 |
| EmbeddedBrowser.tsx | 1145 | 90 | 14 |
| Editor.tsx | 1143 | 67 | 12 |
| MonitoringPanel.tsx | 1104 | 49 | **35** |
| ImageStudio.tsx | 699 | 132 | 18 |
| PulseFlowSidebar.tsx | 784 | 67 | 2 |

**内联 style 合计 1139 处**（AGENTS.md 明文要求用 CSS 变量，实际是"颜色用变量、布局全内联"）。

## 已确认的布局硬伤

### L1：主区三栏硬编码宽度，不可拖拽
`App.tsx:1257` / `1294`
```tsx
<div style={{ width: 260, borderRight: '1px solid var(--border)', ... }}>
<div style={{ width: 320, borderLeft: '1px solid var(--border)', ... }}>
```
侧栏 260px、右栏 320px 全写死。用户在 1366×768 笔记本上，左栏+右栏占掉 580px，**留给内容的只剩 786px**。且无法拖拽调整。

### L2：`100vh` 硬编码绕过了 flex 布局链
```
ImageStudio.tsx:274   height: 'calc(100vh - 50px)'
ImageStudio.tsx:413   height: 'calc(100vh - 50px)'
VideoGen.tsx:372      height: 'calc(100vh - 50px)'
GlobalBrowserDrawer:289  height: 'calc(100vh - 44px)'
Scene3DViewer.tsx:118    height: 'calc(100vh - 140px)'
```
`app-main` 已经是 `flex:1; min-height:0`，但这些子组件用 `100vh` 自己算高度，**在 Tauri 窗口缩放、侧栏折叠、多标签场景下会溢出**。减去的 50/44/140 是魔法数字，跟实际 chrome 高度耦合。

### L3：z-index 无分层体系
实测散落：`1`(9) / `2`(2) / `5` / `50`(2) / `100`(2) / `200` / `999` / `1000`(7) / `1002` / `9999`(6) / `10000`
`9999` 用了 6 次、`1000` 用了 7 次，无规律。**Drawer(1000) 和 Modal(1000) 同级** → 打开顺序决定谁盖谁。

### L4：Thread.tsx 207 处内联 style
消息气泡是全应用最密集的渲染路径，却把样式全写在 JSX 里。后果：无法做主题切换、无法响应式、无法复用。

---

## 布局优化分批

### L-Batch 0：观测（0.5 天）
不改视觉，只加测量：
- 记录各页面在 1280/1440/1920 宽度下的实际渲染高度
- 检测 `100vh` 子组件是否溢出父容器
- 加一个 dev-only 的布局调试模式（`?layoutDebug=1` 显示各栏实际宽高）

**为什么先做**：L1/L2 到底影响多少用户、影响多严重，现在只有代码推断没有实测数据。

### L-Batch 1：布局骨架抽 CSS（1.5 天）
把 `App.tsx` 主区三栏的布局从内联 style 抽到 `agentai-theme.css`：
```css
.app-main__left  { width: var(--sidebar-w, 260px); min-width: 200px; max-width: 480px; resize: horizontal; }
.app-main__right { width: var(--rightpanel-w, 320px); min-width: 240px; max-width: 560px; resize: horizontal; }
```
**顺带解决 L1 的不可拖拽**——CSS `resize` 一行搞定，不需要引入 resizable 库。

### L-Batch 2：干掉 100vh（1 天）
新增 CSS 变量 `--chrome-h`（由 App 布局测量后写入），替换所有 `calc(100vh - N)`：
```css
:root { --chrome-h: 50px; }
.page-fill { height: calc(100vh - var(--chrome-h)); }
```
或更好：让这些组件改用 `height: 100%` + 父级 flex 约束，彻底不依赖 vh。

### L-Batch 3：z-index 分层（0.5 天）
定义 token，所有组件改用变量：
```css
:root {
  --z-base: 0; --z-sticky: 100; --z-drawer: 1000;
  --z-modal: 1100; --z-popover: 1200; --z-toast: 1300;
}
```
替换 1000/9999/10000 这类魔法值。

### L-Batch 4：响应式断点（1.5 天）
当前**完全没有断点**。补：
- `< 1280px`：右栏改为可折叠抽屉
- `< 1024px`：左栏也改为抽屉，主区全宽
- 移动端/Tauri 小窗：Composer 紧凑模式

### L-Batch 5：Thread.tsx 样式外提（2 天，分片做）
按气泡类型分批抽：user → assistant → tool card → thinking。
每批抽完跑一次视觉回归截图对比。

---

## 布局与"从头开始"的关系

**无直接关系。** 但有两处交叉：

1. **Composer 在窄屏下溢出** → 用户看不到"发送"按钮 → 可能重复点击或误操作 → 引发额外消息 → 加剧"重复"感知
2. **Thread 消息区不虚拟化**（审查已知）→ 长会话滚动掉帧 → 用户以为卡死 → 刷新页面 → 会话状态可能丢失（`throttledStorage` 2s 节流无卸载刷盘，B0 已确认）

所以建议 **L-Batch 0/1 先做**，它们不依赖后端改动，且能顺带验证"刷新后状态是否真的丢"。

---

# 第四部分：需要你拍板的 3 件事

### D1：P1-1 历史裁剪重构的激进程度

| 选项 | 做法 | 风险 |
|---|---|---|
| **保守（建议）** | 只修"保留 user 消息"+"修 isContinuation 判断"，不做台账 | 低。1 天 |
| 中 | 上面 + 简化版台账（只记已完成步骤） | 中。2 天 |
| 彻底 | 完整台账结构（目标/步骤/文件/卡点/下一步） | 高。3-4 天，且需反复调 prompt |

我建议**先做保守版跑一周**，看实际效果再决定要不要上完整台账。因为完整台账的 prompt 设计需要真实数据支撑，现在拍脑袋容易做偏。

### D2：SessionManager TTL

30 分钟对长任务确实偏短（一次深度重构任务经常超）。改成 2 小时？还是有未完成任务时不淘汰？

### D3：布局优化的优先级

现在有 3 条线在排队（安全 B1 / 数据 B2 / 布局 L）。**布局是"体验优化"，安全是"漏洞"**。我的建议是：

- **先做 P0 三处**（止住失忆，1.5 天）—— 用户现在就在受影响
- **再做 L-Batch 0/1**（观测 + 骨架抽 CSS，2 天）—— 成本低，且能验证状态丢失
- **B1 安全批次**（1.5 天）—— 除非你决定先止血
- L-Batch 2-5 视情况排

你也可以指定别的顺序。

---

## 确认后我会做什么

1. 观测先行（P1-1 前加日志、P0-1 前加断言测试）
2. 每批改动独立提交、独立跑全量测试
3. 每一批给你可验证的具体现象（不是"我改好了"而是"你现在可以这样验证"）

**我不会一次改完五个批次然后告诉你都好了。** 这次 P0-1 就是一行改动，但我会先写测试证明它修了什么，再改，再证明。
