# B2 批次：跨请求工作区隔离 —— 2026-10-06

> 对应优化计划 `docs/OPTIMIZATION_PLAN_2026-10-02.md` 的 **B2-1**，审查报告 **P0-9**
> 这是全部改动里风险最高的一项，因此单独成篇。

---

## 一、问题链

```
routes/chat.ts:252   wm.setProjectDir(req.body.projectDir)     ← 改**进程级**单例
                     + _saveWorkspaceConfig() 写全局配置文件（永久化）
tools.ts48 处        wm().projectDir作路径基准
git_* handlers       签名是 (args) —— 根本不收 ctx
workspace-manager.ts resolveProjectPath() 的越界校验也用 this.projectDir
```

### 实际发生的串扰

```
用户在projA 让 AI 干活→ setProjectDir(projA)     → 工具在 projA 上读写   ✅
用户在 projB 让 AI 干活 → setProjectDir(projB)     → 工具在 projB 上读写   ✅
projA 的下一轮工具调用  → 读到的 projectDir 已是 projB
                     → AI 在 projB 的项目里读写文件、并 git commit   ❌
```

而且因为调了 `_saveWorkspaceConfig()`，**污染会永久写进配置文件**，重启也不恢复。

### 实测数据

`tools.ts` 里引用 `wm().projectDir` 的 handler共 **38 个**，其中：

| 类别 | 数量 | 说明 |
|---|---|---|
| 签名含 `ctx` | 18 | 可直接改用 `ctx.workspace` |
| **签名不含 ctx** | **20** | `git_*` 全家（7个）、`remember_this`、`evolve_prompt`、`create_tool`、`forget`、`session_manage`、`find_references`、`run_tests`、`typecheck`、`validate_and_fix`、`remember_project`、`recall_project` |

---

## 二、方案选型：为什么不逐个给 handler 加参数

逐个改20 个 handler 的签名会破坏**所有外部调用方**：

- 工具市场 / skill系统
- 子智能体（`spawn_subagent`）
- 自动化任务 / 工作流引擎
- 插件系统（`plugin-system.ts` 也有自己的 `ToolContext`）

风险远大于收益。

### 采用：AsyncLocalStorage（Node 原生异步上下文传播）

Node 为「请求级上下文不传遍所有函数签名」设计的标准方案（Express/Koa/Prisma 都用它传requestId）。

在 `tool-registry.dispatch` 入口开一个作用域，作用域内**任意深度**的代码都能读到本次请求的 workspace，请求之间天然隔离。

---

## 三、改动清单

### 新增 `request-scope.ts`（~180 行）

```ts
runWithWorkspace(workspace, fn, meta?)     // 开作用域
currentRequestWorkspace(): string | null   // 读当前请求工作区
currentRequestScope(): RequestScope | null // 读完整作用域（诊断用）
inRequestScope(): boolean
workspaceFromRequest(req)                  // 从 header/query/body 解析
workspaceDriftWarning(globalDir)          // 检出「请求级 vs 全局」不一致
```

### `tool-registry.ts`

`dispatch` 拆成两层，外层开作用域：

```ts
async dispatch(calls, ctx) {
  return runWithWorkspace(ctx.workspace, () => this.dispatchInternal(calls, ctx), { userId: ctx.userId });
}
private async dispatchInternal(calls, ctx) { /* 原实现原封不动 */ }
```

### `tools.ts`

```ts
function ws(): string {
  return currentRequestWorkspace() || WorkspaceManager.getInstance().projectDir;
}
```

**48 处 `wm().projectDir` → `ws()`**（全量替换，剩余 0 处）。
`resolvePath(p, wsParam?)` 的 `base` 参数也改成读请求级。

### `workspace-manager.ts`

`resolveProjectPath()` 的 `base` 从 `this.projectDir` 改成 `currentRequestWorkspace() || this.projectDir`。

**这条是第二条暗道**，容易被漏：

```ts
// 修复前
if (path.isAbsolute(relativePath)) {
  const rel = path.relative(this.projectDir, relativePath);
  if (rel.startsWith('..')) throw new Error('outside project directory');
}
```

全局单例被 B 改成 projB 后，**A 请求传 projB 的绝对路径会被判为「合法」** —— 越界校验直接失效。

### `routes/chat.ts`、`routes/goal.ts`

不再调 `setProjectDir`，只解析本次请求的 workspace：

```ts
const wm = WorkspaceManager.getInstance();
let workspace = wm.projectDir;          // 兜底
if (rawProjectDir && fs.existsSync(rawProjectDir)) workspace = path.resolve(rawProjectDir);
else if (rawWorkspace && fs.existsSync(rawWorkspace)) workspace = path.resolve(rawWorkspace);
if (!fs.existsSync(workspace)) workspace = process.cwd();
```

`routes/files.ts` 的 `POST /v1/workspace` **保留** `setProjectDir` —— 那是用户显式切换工作区的语义，应该持久化。

### `app.ts`（+ 中间件）

在 `express.json()` 之后加一个中间件，让**所有 REST 端点**也自动获得请求级作用域：

```ts
app.use((req, _res, next) => {
  const ws = workspaceFromRequest(req);
  if (!ws) return next();
  runWithWorkspace(ws, () => next(), { userId: req.headers['x-user-id'] });
});
```

优先级：`x-workspace-path` > `x-workspace` > `?workspace=` > `body.workspace` > `body.projectDir`，
且**必须 `statSync().isDirectory()` 通过**才采用 —— 否则不建作用域（零破坏）。

### `routes/files.ts:303`、`routes/profile.ts:85`

REST 端点里直接读全局单例的两处，改成 `currentRequestWorkspace() || ...`。

---

## 四、验收

### 测试先行

`request-scope.test.ts` **24 个用例**，分6 组：

| 组 | 覆盖 |
|---|---|
| T1 | ALS 基本语义：进入/退出/嵌套/并发隔离 |
| T2 | `ws()` 读请求级而非全局单例；**真实时序**（A 等待中被 B 改了单例，A 仍读到自己的） |
| T3 | `resolveProjectPath` 的越界校验用请求级基准 |
| T4 | 端到端：两个并发请求各自 `write_file` 到各自目录，文件真的落对了地方 |
| T5 | 零破坏回归：不在请求上下文时行为不变 |
| T6 | `workspaceFromRequest` 解析优先级 + 不存在路径必须返回 null |

### 验证测试真的能抓住回归

把 `resolveProjectPath` 临时还原成修复前版本：

```
× T3 > ★ 请求A 内: projB 的绝对路径被判越界
× T3 > 请求A 内: projA 自己的绝对路径合法
Tests  2 failed | 1 passed | 13 skipped
```

**两个安全断言同时变红** —— 证明测试有效，不是摆设。

### 全仓

```
pnpm -r test    EXIT=0
  ├─ gateway  58 files / 638 passed | 1 skipped   ← 从 57/614 增到 58/638
  ├─ gui3 files / 20 passed
  ├─ qqbot    1 file  / 3 passed
  └─ skills   无 pytest 测试
pnpm run typecheck EXIT=0
pnpm run lint      EXIT=0
```

---

## 五、遗留与后续

### 遗留 1：session-manager 的 loop 复用

`routes/chat.ts` 用 `sessionManager.get()` 复用 loop 实例，key 含 workspace，
所以不同workspace 不会复用同一个 loop。但**同一 workspace 的不同用户**仍共享 loop
（key 含 userId，见 `chat.ts:712`），其 `appendOnlyLog` 互相可见 —— 这是设计如此
（同用户多标签页共享上下文），但如果要求更强隔离需另行设计。

### 遗留 2：`_saveWorkspaceConfig` 不再被 chat 调用

修复后 chat/goal 不再改全局单例，也就**不再持久化**。这意味着：

- 用户在聊天里选的工作区不会写进配置文件
- 全局 `projectDir` 只由 `POST /v1/workspace`（files.ts）改变

这其实是**更正确的行为**（聊天时传的workspace 是本次任务的上下文，不是「用户当前选中的目录」），
但属于行为变更，需要前端配合确认：前端应该在自己的 workspace 选择器里调
`POST /v1/workspace`，而不是靠 chat 请求顺带改全局。

### 遗留 3：soul 模块仍用 `workspace ||` 兜底

`soul/*.ts` 的 `get*()` 已在上轮改为 per-workspace 实例，但构造函数仍是
`workspace || WorkspaceManager.getInstance().projectDir`。
若某条路径漏传 workspace，仍会读全局单例。建议后续加一条启动期自检：
遍历 soul 单例，断言 `dataPath` 都落在某个已知 workspace 内。

---

## 六、与 B2 其他条目的关系

B2 批次共 5 项：

| 项 | 状态 |
|---|---|
| **B2-1 工作区隔离** | ✅ 本篇 |
| B2-2 会话隔离（`SessionMessage.id`） | ✅ 已修（见 2026-10-05 记录） |
| B2-3 节流刷盘 | ✅ 已修 |
| B2-4 connectors body 契约 | ✅ 已修 |
| B2-5 前端 4 处契约断裂 | 待做（与 L 批次前端部分合并） |

下一步按计划是 **L 批次前端布局**（1139 处内联 style、三栏硬编码无 resize、z-index 混乱）。