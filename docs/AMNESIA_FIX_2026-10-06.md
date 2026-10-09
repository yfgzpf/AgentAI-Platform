# AI 失忆专项修复 —— 2026-10-06

> 触发：用户实机反馈 *"项目 AI 还是失忆严重，工作摘要及上回做了什么，在任务时会一直重复读取文件，不会像你这么的聪明及严谨，我要的是你的全能力不要保留的赋予系统"*

---

## 一、症状与根因总览

用户反馈包含三个可观测症状，全部定位到具体代码行：

| 症状 | 根因 | 位置 |
|---|---|---|
| 工作摘要看不见 | `flush()` 只返回 1 条指令，其余静默丢弃 | `system-directive-manager.ts:55` |
| 上回做了什么不记得 | 摘要从 `appendOnlyLog` **推导**，而 log 会被裁剪/压缩/清空 | `agentai-loop.ts:1713/2801` |
| 一直重复读文件 | 同上——"已读过哪些文件"这个事实随 log 一起消失 | 同上 |

**核心洞察**：前两层修复（保留 user 消息、摘要不被过滤）都是**在 log 内部打补丁**。
但 log 的生命周期由压缩策略决定，只要压缩发生，事实就丢了。
**状态必须是独立于对话历史的一等公民。**

---

## 二、根因一：`flush()` 静默丢弃（最隐蔽）

```ts
// system-directive-manager.ts —— 修复前
flush(): string | null {
  if (this.pending.length === 0) return null;
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  this.pending.sort((a, b) => order[a.priority] - order[b.priority]);
  const top = this.pending[0]!;
  this.pending = [];      // ★ 其余全部丢弃
  return top.content;
}
```

而 `agentai-loop.ts:2578` **每轮都**执行：

```ts
this.directives.add('task_progress', progressSummary, 'high');
```

同轮竞争者（全部同为 `high`）：

```
fail_strategy / dup_fail / empty_response / llm_timeout / timeout / tool_budget
auto_fix_path / auto_fix_tool / auto_fix_syntax / auto_fix_perm / auto_fix_network
auto_fix_module / auto_fix_encoding / auto_fix_parse / auto_fix_ts / auto_fix_undefined
forbidden_response / planning / diagnosis / doubt / resume_exhausted
```

**结论：工作摘要绝大多数轮次根本没进 messages。** AI 每轮都像第一次见到任务。

### 修法

新增 `flushAll(maxChars = 1600)`：

- 返回**全部** `critical` + `high`（`medium`/`low` 仍不参与每轮注入，避免噪音）
- 按优先级排序
- 同 `source` 只保留最新一条（`add()` 只对 deferred 队列去重，即时队列会堆积同源指令 —— 这是实测中发现的第二个 bug）
- `maxChars` 兜底防刷屏撑爆上下文

保留 `flush()` 兼容旧调用方。

---

## 三、根因二：任务台账（状态独立于历史）

新增 `task-ledger.ts`（300 行）：

```
TaskLedger (per-session)
├── goal       任务目标（用户原话）
├── iteration  当前轮次
├── reads      Map<path, count>     读过哪些文件、读了几次
├── writes     Map<path, count>     写过哪些文件
├── commands   string[]             执行过的命令
├── failures   string[]             (工具+原因)，禁止原样重试
├── decisions  string[]             已论证的结论，禁止推翻重议
└── actions    LedgerAction[]       完整流水（诊断用）
```

**关键设计：per-session（key = `userId:workspace`）+ LRU 上限 64**
—— 与 `soul/workspace-scope.ts` 同理，避免 A 的已读文件清单泄漏到 B 的任务。

### 接线三处

| 位置 | 动作 |
|---|---|
| `agentai-loop.ts:1714` run() 入口 | `setGoal()` —— **<4 字不覆盖**（"继续"/"好" 不能冲掉真目标） |
| `agentai-loop.ts:2851` 每轮 prompt | `render()` 作为 **system 消息**注入（不参与指令优先级竞争） |
| `agentai-loop.ts:5853` 工具执行后 | `record()`，重复读 ≥2 次触发 `redundant_read` 指令 |

### 台账注入形态

```
# 🧾 任务台账（事实记录，与对话历史无关，不会因压缩丢失）
## 任务目标（用户原话）
给 tools.ts 的 git_commit 加参数校验，防止命令注入
## 进度
- 当前第 5 轮，累计动作 23 次
## 已读文件（8 个，禁止重复读取）
- packages/gateway/src/tools.ts
- packages/gateway/src/routes/chat.ts
...
## 已定决策（不要重新讨论）
- 采用 execFile 参数数组，因为它不经 shell
## 已失败（不要原样重试）
- read_file: ENOENT src/old.ts
```

---

## 四、根因三：决策抽取（防止"推翻重议"）

长任务里 AI 常在第 3 轮就定下方案，但压缩后忘记，第 8 轮又推翻 —— 用户看到的是**原地打转**。

新增 `decision-extractor.ts`：

- 规则匹配中文决策句式：`决定/采用/选用/改用/换成/确定为/结论是/不再/废弃...`
- 负向过滤：`让我/我来/正在/抱歉/已读取...`
- **剥离代码块**（里面全是"决定"字样的注释不是决策）
- 长度窗口 5~200 字

**用规则而非模型调用**：为记台账再调一次 LLM 会多烧一轮 token 且把主链路延迟翻倍。中文技术回答的决策句式高度模式化，规则足够覆盖。

调用点：`agentai-loop.ts:3486`（assistant 消息写入处）。

---

## 五、行为规则：规则 7「任务台账纪律」

`agent-behavior-rules.ts` 新增规则 7（完整版）+ 精简版（lite）：

| 规则 | 说明 |
|---|---|
| **读前先看台账** | 台账「已读文件」里的文件内容就在上文，禁止重复 `read_file` |
| **重复读 = 浪费** | 读第 2 次起系统显式提醒；仍要读必须是因为本任务改过它 |
| **失败不重试** | 「已失败」的 (工具+原因) 禁止原样重试 |
| **决策不回退** | 「已定决策」已论证过，不要推翻重议 |
| **目标不漂移** | 每轮扫一眼「任务目标」，确认动作仍在服务它 |

**口诀**：做任何动作前先问「这个动作在台账里出现过吗?」出现 → 换路，没出现 → 执行。

---

## 六、附带修的两个 bug

### 1. `TaskLedger.render()` 判空条件吞掉决策

```ts
if (this.actions.length === 0 && !this.goal) return '';   // ★ 漏了 decisions
```

AI 第一句就定方案、还没调任何工具时，`decisions` 有值但 `actions` 为空 → **最关键的决策被整个吞掉**。
这是写测试时发现的（`decision-extractor.test.ts` 的「决策进台账」用例）。

### 2. sandbox 热重载回归（我上轮挖的坑）

2026-10-05 我把 mtime 判变改成"每轮读全文算哈希"，解决了 Windows 精度问题，
但 `reloadIntervalMs=50` 时等于每 50ms 一次 `readFileSync` → `sandbox/index.test.ts` **间歇性 10s 超时**。

我连续两轮把它误判为"既存 flaky"跳过，实际是自己引入的回归。

现在改成**双路径**：

- **快路径**：`statSync` 读 `mtimeMs + size`（元数据读取便宜两个数量级）
- **慢路径兜底**：距上次内容校验 ≥1s 时做一次指纹（覆盖 Windows 精度问题）

实测：超时用例从 10s → **412ms**，连跑 3 次全稳，`hot-reloads` 用例从失败转绿。

---

## 七、我推翻的结论

### SSE 限流泄漏不存在

上一轮报告"SSE 路径不调 `limiter.release()`，第 3 个并发后永久 429"。**实测证伪**：

```
try  {  ← chat.ts:242
  ...
  return;  ← chat.ts:1304（SSE 分支，缩进在 try 块内）
} catch (e) { ... }      ← :1554
} finally {              ← :1577
  limiter.release(...)  ✓ 会执行
}
```

JS 语义：函数级 `return` 仍执行 `finally`。

**教训**：grep 位置不够，必须做花括号配平/作用域分析。

---

## 八、验收

```
pnpm -r test       EXIT=0
  ├─ gateway  57 files / 614 passed | 1 skipped   ← 从 53/552 增到 57/614
  ├─ gui3 files / 20 passed
  ├─ qqbot    1 file  / 3 passed
  └─ skills   无 pytest 测试（已显式声明）
pnpm run typecheck EXIT=0   （5 包真实检查）
pnpm run lint      EXIT=0   （5835 warnings / 0 errors）
```

### 新增测试 73 个

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `amnesia-regression.test.ts` | 25 | flushAll 不丢指令 / 台账独立性 / 重复检出 / per-session 隔离 / LRU |
| `ledger-wiring.test.ts` | 11 | 端到端：台账真的进了 prompt / 重复读触发提醒 / 不受 log 清空影响 |
| `decision-extractor.test.ts` | 12 | 决策句式抽取 / 代码块剥离 / 负向过滤 / 决策防重议 |
| `b1-security.test.ts`（注入复现） | 14 | 真实命令注入复现（对照组证明漏洞存在） |

### 测试先行的价值

`amnesia-regression.test.ts` 首轮 **7 个失败**（`flushAll is not a function`）—— 这就是 bug 存在的证明。
`decision-extractor.test.ts` 首轮 **4 个失败** —— 其中 1 个是上面说的 `render()` 判空 bug。

---

## 九、附带完成：B1 安全批次收尾

| 项 | 内容 |
|---|---|
| **envVar 注入** | `settings.ts` 加 `isValidEnvName()`：必须匹配 `^[A-Z][A-Z0-9_]{0,63}$`，拒绝 `PATH`/`COMSPEC`/`__PROTO__`/`LD_PRELOAD`。**4 个端点全加**（POST/GET/DELETE/test）—— 原实现 `provider` 无校验，含 `=` 的 provider 能向 `.env` 注入 `NODE_OPTIONS=--require evil.js` |
| **中间件顺序** | `app.ts`：`authMiddleware` 提到 `express.json({limit:'50mb'})` **之前**。原来未认证请求可先让 gateway 分配 50MB 内存再被拒 —— 明确的内存耗尽向量，且认证默认关闭时该保护形同虚设 |
| **命令注入** | （本轮之前完成）git_* 7 个工具改 `execFile` 参数数组；3 个 shell 工具加 16 条破坏性命令黑名单 |
| **沙箱** | `read_file` 接入 `sandboxGuard`；`undo_edit` 补沙箱校验；凭证路径平台级硬拒（与沙箱开关无关） |

---

## 十、下一步

1. **B2 数据正确性** —— 工作区隔离，风险最高
   （`tools.ts` 44 处 `wm().projectDir` 作路径基准 + `git_*` handler 签名不收 `ctx`）
2. **L 批次前端布局** —— 1139 处内联 style、三栏硬编码无 resize、z-index 混乱
3. 台账「已读文件」可加 mtime 判断「文件是否被外部改过」，让"该重读"的判断更精确