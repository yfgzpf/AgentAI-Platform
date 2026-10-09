# PulseFlow 优化执行计划

> 制定日期：2026-10-02
> 依据：`docs/STRICT_AUDIT_2026-10-02.md`（134 条问题，实测取证）
> 原则：遵守 AGENTS.md 四条Karpathy 定律 —— 最小改动、精准修改、不顺带优化、目标驱动
> **本计划只规划改动，不改动任何代码**

---

## 零、执行前必须知道的三件事

### 1. 有 3 个批次是"解锁型"，不先做后面全部白干

| 解锁项 | 为什么是前置|
|---|---|
| **B0-1 修 `tools.ts` 缩进** | `tools.ts:4925/4968/5252/5271/5305/5324/6494` 共 7 个 handler 是 0 缩进（其余统一 2 空格）。这导致本次审计脚本先后产生 96 个和 7 个假阳性。**不修，lint / 死代码检测 / 安全扫描在这 216 行上全部不可信。** |
| **B0-2 修 lint 依赖** | `eslint.config.js:21` `import globals from 'globals'`，但**没有任何 package.json 声明 `globals`**，`.pnpm-store` 里有 `globals@14.0.0` 却没被 link。→ `pnpm run lint` **当前直接崩溃**。CI 的 `pr-check.yml` 里 `Lint` 步骤必然失败。**lint 从来没真正跑过。** |
| **B0-3 修根 typecheck 空转** | 根 `tsconfig.json` 的 `include: []` → `pnpm run typecheck` **一个文件都不检查**，永远秒过。CI 的 `Typecheck` 步骤形同虚设。（实测：根 typecheck 0.09s 通过；gateway/gui 包内 `npx tsc --noEmit` 是真的跑过且通过） |

### 2. 有 4 个决策点需要你拍板，我不替你定

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| D1 | `.env` 历史清理方式 | ① 只轮换 Key，不动历史 ② `git filter-repo` 重写历史 ③ 保持现状 | **①**（实测 `d103a62` 不在 main、不在任何分支、远端无此提交 → 泄露面为零，轮换 Key 即闭环。重写历史会让 272 个提交全部换 SHA，代价大于收益） |
| D2 | 鉴权默认值 | ① 保持默认关闭 + 补文档警告 ② 默认开启 ③ 按环境区分（dev 关 / prod 开） | **③**。当前默认关闭是"零破坏"的有意设计，但生产部署必须显式关掉才安全，这个默认值很危险 |
| D3 | 中间件顺序| ① 只调顺序 ② 顺序 + 全局限流中间件 | **②**。`express.json({limit:'50mb'})` 在鉴权之前是明确的内存耗尽向量 |
| D4 | 死代码清理尺度 | ① 只删确定无引用的 ② 全删 77 个孤儿 ③ 先加检测再逐步删 | **③**。直接全删风险高（孤儿判定可能有误判），先上检测工具跑 1 周拿到基线 |

### 3. 工作区当前是脏的

`git status` 显示 **20+ 个未跟踪源码文件**（`frameworks/agentai-adapter.ts`、`frameworks/pulseflow-adapter.ts`、`agent-behavior-rules.ts`、`WelcomePanel.tsx`、`monaco-setup.ts` 等）+ 1 个已暂存的 125MB 日志。

**动手前必须先建干净分支**，否则任何批量操作都可能误伤。

---

# 一、B0 解锁批次（必须最先做，约 0.5 天）

## B0-0 建立干净工作分支
```bash
git checkout -b fix/strict-audit-2026-10-02
git reset                      # 清掉暂存的 125MB 日志
```
**前置**：确认 `frameworks/` 等未跟踪文件是否需要先提交（它们可能是你正在做的工作）。

## B0-1 修 `tools.ts` 缩进（216 行）
**文件**：`packages/agentai-gateway/src/tools.ts`
**范围**：7 个 handler，共约 216 行
```
4925-4967  self_diagnose    (43 行)
4968-5006  self_modify     (39 行)
5252-5296  git_branch      (45 行)
5271-5302  git_push        (32 行)
5305-5319  git_pull        (15 行)
5324-5339  git_clone       (16 行)
6494-6519  remember_project(26 行)
```
**做法**：先确认这个区间的边界（`EXTRA_HANDLERS` 声明在 `:1131`），然后对这7 段各自补 2 空格缩进（含块内所有层级）。
**注意**：区间外的 0 缩进行（如 `:4939 }` `:4940 }`）需要一并判断，**不能只改handler 首行**。
**验证**：
```bash
cd packages/agentai-gateway && npx tsc --noEmit   # 必须 EXIT=0
# 重跑孤儿文件检测脚本，结果应与上一版一致（不能因为修了缩进而误判新孤儿）
```

## B0-2 修 lint 依赖
**文件**：`package.json`（root，devDependencies）
**做法**：`pnpm add -D -w globals@^14`（版本对齐 `.pnpm-store` 里的 `globals@14.0.0`）。
**验证**：
```bash
pnpm run lint 2>&1 | tail -20   # 记录首次真实告警数=基线，写进报告
```
**预期**：会暴露一批历史告警。**不要在这一批修**，只记录数量，作为 B3 的基线。

## B0-3 修根 typecheck
**文件**：`tsconfig.json`
**做法**：把 `include: []` 改为显式包含各包，或直接改成引用模式 `tsc --build`。
**验证**：
```bash
pnpm run typecheck 2>&1 | tail -30   # 这会第一次真的检查全仓代码
```
**风险**：可能一次性暴露大量类型错误。**如果超过 100 条，改为只修 packages 各包的 tsconfig（gateway/gui 单独跑本来就是对的），根 typecheck 改为 `tsc --build --emitDeclarationOnly false` 的引用校验模式。**

## B0-4 修测试红灯
**文件**：`packages/agentai-gateway/src/self-memory-updater.test.ts`
**现象**：3 个用例 `Test timed out in 10000ms`（:95 / :111 / :147），全文件 48 个文件里唯一红的一个。
**做法**：先定位是`fs.rm` 清理慢、被测模块有未 resolve 的 promise、还是 `vi.resetModules()` + 动态 import 的竞态。**超时通常是"没有 await 某个 promise"而不是"性能问题"**，别盲目调大 timeout。
**验证**：`npx vitest run src/self-memory-updater.test.ts` → 全绿。

## B0-5 清理已提交的垃圾文件
**这一步是纯删除，零代码风险，但必须做。**

| 类别 | 文件 | 大小 |
|---|---|---|
| 日志 | `packages/agentai-gateway/gateway-restart.log.old` | **125 MB** |
| 客户数据 | `packages/agentai-skills/decoration/*/output/quotation_*.xlsx` × 46 | 325 KB |
| 崩溃转储 | `bash.exe.stackdump` ×2 | 0 B |
| 编译产物 | `agentai-vscode-0.1.0-alpha.1.vsix` / `tsconfig.tsbuildinfo` / `references/cursor-mcp/dist/main.js` | 3.3 MB |
| 运行时DB | `packages/agentai-gateway/data/model-metrics.db` | 311 KB |

**`.gitignore` 补规则**：
```
*.log.*
*.stackdump
*.vsix
dist/**
**/quotation_*.xlsx     ← 现有规则是中文名「报价*.xlsx」，完全没生效
*.tsbuildinfo
*.db
```
**注意**：`dist/` 必须改成 `dist/**`，否则不匹配 `references/cursor-mcp/dist/main.js` 这种嵌套路径。
**验证**：`git ls-files | xargs ls -la | awk '{s+=$5} END {print s}'` 对比修复前后（当前 157.4 MB）。

---

# 二、B1 安全止血批次（约 1.5 天）

**这批全部是安全漏洞，改动集中、影响面小，但必须一起做完才有效。**

## B1-1 shell 工具消除命令注入 + 接入审批
**文件**：`packages/agentai-gateway/src/tools.ts`
**问题**：`run_shell_command:6749`、`run_command:2087` 用 `execSync(args.command)`，参数原样进 shell。
**做法**：
1. `run_shell_command` 若必须支持管道/重定向 → 至少加命令黑名单（`rm -rf /`、`mkfs`、`dd if=`、`chmod -R 777 /`）+ `timeout` 上限（当前 `tools.ts:6754` 的 `(args.timeout||30)*1000` **无上限**，可传 999999 占用事件循环近 12 分钟；对比 `run_command:2086` 有 `Math.min(...,120_000)`）
2. 在 `agentai-loop.ts` 的 `dispatchToolCalls` 审批列表（当前只含 `['multi_edit','write_file','delete_file']`）**加入 shell 类工具**
3. 在 `EXTRA_TOOLS` 里把这三个工具的 `riskLevel` 从 `high` 改为 `critical`（`tool-registry.ts:366` 的门只判 critical）
4. `run_shell_command` 的 `timeout` 加 `Math.min(..., 120_000)`

**验证**：写一个测试断言 `run_shell_command({command:'echo a; echo b'})` 被拒绝或被黑名单拦下。

## B1-2 `git_*` 消除命令注入（7 个工具）
**文件**：`tools.ts`
**问题点**：
```
:5155-5156  git_diff   args.file   零转义
:5167-5168  git_log    args.file   零转义
:5176,5191  git_commit message      只转义双引号（挡不住 $( ) 反引号 %VAR%）
:5239       git_add    args.file
:5261/:5264 git_checkout args.name/branch
:5286       git_push   ${remote} ${branch}
:5313       git_pull
```
**做法**：全部改 `execFileSync('git', ['commit','-m',msg], {cwd, encoding})` 参数数组形式。参数数组不经 shell，`;` `|` `$()` 全部无害。
**注意**：不要用 shell 转义方案（加白名单黑名单/引号处理）—— 参数数组是唯一根治手段。
**额外**：`git_*` handler 签名是 `async (args: any)`，**不接收 `ctx`**。改参数数组的同时把签名改成 `(args, ctx)`，为 B2-1 的工作区隔离做准备。

## B1-3 `routes/settings.ts` 加参数校验
**文件**：`packages/agentai-gateway/src/routes/settings.ts:147`（POST）、`:178`（DELETE）
**做法**：
```ts
const PROVIDER_RE = /^[a-z][a-z0-9_]{0,30}$/;
if (!PROVIDER_RE.test(provider)) return res.status(400).json({error:'invalid provider'});
```
`apiKey` 需拒绝含 `\n` `\r` 的输入（防注入第二个键值对）。
**验证**：`POST {"provider":"NODE_OPTIONS",...}` → 400。

## B1-4 `read_file` / `undo_edit` 补沙箱
**文件**：`tools.ts:1819`（read_file）、`:2015`（undo_edit）
**背景**：`resolvePath:434` 只拦 7 个系统目录字面量；`sandbox/rules.ts:119` 把 `.ssh`/`.aws`列为 deny、`.env*`/`*.pem` 列为 prompt，但这套规则对 read_file 完全不生效（`sandboxGuard` 全文件仅 7 处调用）。
**另外必须修**：`tools.ts:466` 的 prompt 分支 `return null` =完全放行，且警告信息根本没返回给调用方。→ 改为返回警告文本并在 tool result 里体现。
**做法**：
1. `read_file` 入口加 `sandboxGuard(resolved, 'read')`
2. `undo_edit` 的写入目标 `resolved` 加 `sandboxGuard(resolved, 'write')`（现在 write_file:1909 / delete_file:2014 都有，只有它没有）
3. `undo_edit` 的备份源 `wm().projectDir` 改为从 `ctx.workspace` 取（现在用的是全局单例，见 B2-1）
4. `resolvePath` 的 BLOCKED 列表补 `.aws`/`.config`/`.npmrc`/`.pypirc`/`.docker`/`AppData`
5. `sanitize.ts:133` 的 SSRF 防护改用 DNS 解析后的 IP 判断（现在是纯字符串匹配，`attacker.com → 127.0.0.1` 可绕过）；`tools.ts:1468` 的 `redirect:'follow'` 需限制或对重定向目标复检

## B1-5 中间件顺序 + 全局限流
**文件**：`app.ts:85-99`
**当前**：`cors → express.json({limit:'50mb'}) → authMiddleware`（无全局限流）
**目标**：`cors → rateLimit → auth → express.json({limit:'50mb'})`
**依据**：50MB 请求体先完整读入内存再决定是否 401，是 trivially 可用的内存耗尽向量。
**同时**：`rate-limit.ts:233` 的 `isInternalReq` 来自 `req.body._internal`，客户端可自传 `{"_internal":true}` 拿到内部额度 → 改从可信来源判断（如 header 签名或直接移除该旁路）。

## B1-6 修 SSE 路径的限流泄漏（永久 429）
**文件**：`routes/chat.ts`
**问题**：`limiter.check` 在 `:233`，`limiter.release` 全文件**仅 `:1563` 一处**，在非流式分支的 `finally`。流式分支在 `:1290` 就 `return` 了，到不了 1563。`maxConcurrency=2` + `userId` 默认 `'default'` → **第 3 个并发流式请求后所有匿名用户永久 429**。
**做法**：把 `limiter.release` 从 `:1563` 的 `finally` 移到**整个 handler 最外层**的 `finally`（覆盖流式与非流式），或用 `res.on('close')` 兜底。
**验证**：并发发 3 个 `stream:true` 请求，第 3 个应正常排队而非 429。

## B1-7 修 `tc.args = {}` 静默执行（数据覆盖）
**文件**：`agentai-loop.ts:3269-3284`
**问题**：JSON 修复失败后 `tc.args = {}` 只 warn 然后继续执行。`write_file` 收到 `{}` → `content` 为 undefined → **写入空文件覆盖用户原有内容，且 `success:true`**。
**做法**：`tc.args = {}` 时改为**拒绝执行该工具调用**并回问模型，而不是传空参数。
**附带**：`:3306` 的去重签名 `${tc.name}:${JSON.stringify(tc.args).slice(0,500)}` 会误杀参数前 500 字符相同的多次调用（批量 multi_edit 常见）→ 改为对 args 做 hash 而非截断。

## B1-8 修 `abort()` 不取消上游
**文件**：`agentai-loop.ts:349`（abort 全文）、`routes/chat.ts`（`abortSignal` 出现 **0 次**）
**问题**：`abort()` 只改标志位不碰 `AbortController`。`agentai-loop.ts:484` 的 `opts.abortSignal ?? new AbortController().signal` 永远走右侧（永不 abort 的 signal）。中断后 `router.chat()` 的 fetch 继续跑完整轮，token 照常计费，`res.write()` 全部落进已销毁 socket（`chat.ts:448` 静默吞掉），`activeLoops` 条目泄漏。
**做法**：loop 内部持有自己的 `AbortController`；`abort()` 调 `.abort()`；把 signal 传给 `router.chat()`。同时 `chat.ts:1226` 的 `activeLoops.delete` 要放 finally。

---

# 三、B2 数据正确性批次（约 2 天）

**这批是用户可见的功能失效，改动需要跨前后端，验证要手工点。**

## B2-1 消除跨请求全局工作区串扰 ★最高优先
**文件**：`routes/chat.ts:247`、`tools.ts`（44 处 `wm().projectDir`）
**问题**：`wm.setProjectDir(req.body.projectDir)` 改的是**模块级单例**，还 `_saveWorkspaceConfig()` 持久化到磁盘。B 用户不传 workspace 时，`chat.ts:256` 取到的是 A 的目录 → B 的所有 `read_file`/`write_file`/`git_*` 作用在 A 的项目上。且请求内`await` 大量异步操作后才执行工具，存在明确 TOCTOU 窗口。
**做法（推荐方案）**：
1. `WorkspaceManager` 增加 `withProjectDir(dir, fn)` 或返回 `projectDir` 的**不可变快照**方法
2. `chat.ts` 把 `workspace` 作为**显式参数**沿调用链传递，不再依赖单例
3. `tools.ts` 的 44 处 `wm().projectDir` 全部改为 `ctx?.workspace || wm().projectDir`（`resolvePath:435` 已经在用 `ws || wm().projectDir`，模式是对的，只是调用方没传 `ws`）
4. `setProjectDir` 移除 `_saveWorkspaceConfig()`，或改名 `setDefaultProjectDir` 明确其语义
**风险**：这是本次审查中**改动面最大**的一项。44 处调用点 + 工具签名。建议单独一个 PR，先改 `resolvePath` 一处验证，再铺开。
**验证**：开两个浏览器窗口，分别选不同 workspace，A 请求写入文件 → B 的 `read_file` 必须读不到 A 的文件。

## B2-2 修会话隔离（流式回复永久丢失）★
**文件**：`packages/agentai-gui/src/store/sessionStore.ts:4`、`components/ChatView.tsx:870`
**问题**：`SessionMessage = {role, content, ts}` **没有 `id` 字段**，但 `ChatView.tsx:874` 用 `findIndex(m => m.id === id)` 查找 → 恒为 -1 → 走 `return` 丢弃更新。**发送后立刻切会话，AI 回复永久蒸发，token 照烧。**
**做法**：
1. `SessionMessage` 加 `id: string`
2. `addMessage` 生成 id
3. 兼容旧数据：persist 反序列化时给无 id 的消息补 `id`（`onRehydrateStorage`）
4. `ChatView.tsx:874` 的查找改为按 id 命中

## B2-3 修节流无卸载刷盘（刷新丢最后 2 秒）
**文件**：`store/chatStore.ts:16`
**问题**：`throttledStorage` 是纯 trailing debounce，无 `beforeunload` flush。F5 丢最后 2 秒消息。
**做法**：`zap` 不支持，但可以：① 在 store 的 `set` 里同时写一个内存快照，`beforeunload` 时同步写 localStorage；② 或改用 `BroadcastChannel` + `visibilitychange` 事件。**推荐 ①，改动最小。**
**顺带**：`useSessionAutoSave` 的定时器 effect 依赖 `messages`（`hooks/useSessionAutoSave.ts:66`）→ 流式期间每帧 clearInterval+setInterval → 30 秒计时器**永远归零**；且 `persistMessage` 只调本地 `addMessage`，**无任何 `/api/sessions` 调用**，注释承诺的 Gateway 备份链路根本不存在。→ 依赖改为 `messages.length`，并补真实的备份调用或删掉误导性注释。

## B2-4 修 connectors 虚假启用（8 个开关）
**文件**：`Composer.tsx:1149`、`routes/connectors.ts:176`
**问题**：前端 POST 空 body → 后端 `!!req.body.enabled` 恒 false → 后端禁用，前端拿到 ok 后本地翻转成"已开"。
**做法**：前端 `fetch(conn.toggleApi, {method:'POST', body: JSON.stringify({enabled: !c.enabled}), headers:{'Content-Type':'application/json'}})`，或改用已有的 `POST /toggle` 别名路由。
**顺带**：修 `collectors` 反馈双写（`MsgActions.tsx:77` 写 localStorage → `ChatView.tsx:1482` 读到相同值就删）和收藏提示恒为"已收藏"（`MsgActions.tsx:110`）。

## B2-5 修契约断裂（4 处，已实测坐实）
| 问题 | 前端 | 后端 | 做法 |
|---|---|---|---|
| `/v1/chat/completions` 不存在 | `services/api.ts:369` | 只有 `routes/chat.ts:206` 的 `/v1/chat` | 改调用路径；顺手去掉 `\|\| ''` 静默兜底 |
| Git 鉴权面板全是死代码 | `GitAuthPanel.tsx` 调 7 个 `/v1/git/auth/*` | `git-auth.ts` 全库 **0 import**，是纯服务模块 | 要么补Router，要么删面板 |
| 8 个 stats 端点双重前缀404 | 调 `/v1/metrics/models` | `stats.ts:10` 用绝对路径 + `app.ts:135` 以 `/v1` 挂载 → `/v1/v1/...` | `stats.ts` 改相对路径 |
| 前端从不发 `x-agentai-token` | 无| `middleware/auth.ts` 开启后要token | 前端加拦截器统一注入；或补 `/v1/auth/init` 端点（错误文案里让用户调的端点本身不存在） |

**另外**：`git-simple.ts` 只有 4 个端点而 `gitService.ts` 调用 8 个 → `diff`/`log`/`branches`/`pull`/`checkout`/`stash`/`reset` 全缺。但因 `add`/`commit`/`push` 可用，**Git 面板看起来正常而多数按钮无效**——这类"部分可用"最隐蔽，用户不会报bug，只会觉得"有点不好用"。

---

# 四、B3 功能接线与前端质量（约 3 天）

## B3-1 补齐 8 处"只做了 UI 没接线"
| 位置 | 症状 | 做法 |
|---|---|---|
| `Composer.tsx:82` | `webSearch` 开关不发给后端 | 后端 chat 支持 `webSearch` 参数并透传给 `web_fetch` |
| `App.tsx:436` | `fileTreeVisible` 无消费者 | 接入真正的文件树面板（ChatView 里等 `agentai:add-file-context` 的 20 行逻辑已就绪） |
| `Editor.tsx:140` | `searchQ` 无消费者 | 补 `.filter()` |
| `services/api.ts:287` | `onWidgetShow` 无 handler | 在ChatView 提供 handler，接到已存在的 `WidgetCard` |
| `Composer.tsx:191` | `composingRef` 只写不读 → **中文 IME 选词 Enter 直接发送** | `if (composingRef.current) return;` |
| `ChatView.tsx:1252` | 摘要只写记忆库不进 prompt | 把 summary 注入下一轮 context |
| `EditorChatPanel` / `SchedulePanel` | 组件存在无入口 | 接入或删|
| `resolveStoredPage` (`App.tsx:411`) | 定义了但一次没调用，`agentai.lastPage` 只写不读 | 接入（注意 `:426` 注释说"始终从 chat 开始是修复"，与该函数冲突，需产品确认预期） |

## B3-2 修 React 规则违反
| 位置 | 问题 | 做法 |
|---|---|---|
| `Thread.tsx:168` | **`AssistantText` 在 render 期间调 `setDisplay`**，违反 React 规则 | 节流逻辑移进 `useEffect` 或改 `useSyncExternalStore` |
| `ChatView.tsx:1393` | `handleSend` 依赖缺 `sessions` 等十余项 + `eslint-disable-line` | B0-2 修好 lint 后，按告警逐个修 |
| `ChatView.tsx:1736` + `:1728` | **两个 effect 都监听 `loading` 且都调 `handleSend`** → 排队消息可能重复发送 | 合并为一个 |
| `sessionStore.ts:66` | 同 workspace 只保留最新 session，旧的**静默删除**且 persist 写回 → **用户历史对话不可恢复**（注释称这是"修复"） | 改为 soft-delete 或归档 |
| `Composer.tsx:416` | 语音识别用闭包旧 `draft` → 长句只留最后一段 | `setDraft(d => d + result.text)` |
| `EmbeddedBrowser.tsx:404` | WS 依赖含 `tabs` 数组 → 每次切标签页重连，中断 AI 正在执行的操作 | 用已存在的 `tabsRef` |
| `EmbeddedBrowser.tsx:667` | `postMessage(handler, '*')` 无 origin 校验 + 3 秒定时器未 clear | 加 origin 校验 + clearTimeout |
| `chatStore.ts:143` | rAF 与 setTimeout 双保险互相打断（token 复用竞态） | 简化为单一调度 |
| `MonacoEditor.tsx` | 全文无 `dispose()` → 多标签下 ITextModel 累积 | 切 path 时 `getModel(uri)?.dispose()` |
| `ChatView.tsx:456` | 健康检查 fetch 无 `AbortController`（用 `cancelled` 标志代替） | 改 AbortController |

## B3-3 修可访问性（当前键盘完全不可用）
- **`<span onClick>` 全量改造**：`App.tsx` 8 个导航项 + 主题按钮 + 面板开关 + `Composer.tsx:601` 附件删除 ×，全无 `tabIndex`/`role`/`onKeyDown`。讽刺的是 `NavGroupDropdown:326-367` 正确实现了 role/Escape——**说明作者知道，只做了一处**。
- **模态框**：`Composer.tsx:668` 舌诊弹窗是手写 fixed 遮罩，无滚动锁、无 focus trap、无 Escape。
- **ErrorBoundary 位置错误**：`App.tsx:1246` 只包 center 区，RightPanel/StatusBar/Splash 全在边界外；且 `onRetry={() => setPage(page)}` 设成同值 → React bailout → **重试按钮无效**。
- **lazy chunk 失败不可恢复**：`ErrorBoundary.tsx:39` 重试后 React 内部缓存了 rejection。
- **`AutoHideTaskBar`**（`ChatView.tsx:13`）：8 秒后自动隐藏且 `visible={true}` 恒定 → 长任务恢复入口**永久消失**。
- **`Splash`** 每次启动强制 3600ms，sessionStorage 未去重。

## B3-4 修硬编码颜色 713 处 + 亮色主题
AGENTS.md:62-69 明文禁止，但实测 713 处。**不建议一次性全改**（风险高、易引入视觉回归）。
**建议做法**：
1. 先只修 `App.tsx:893` 的 `accentColor` —— 它是**主题不一致的根源**（与 `--accent` 不同步，切主题时 antd colorPrimary 和 CSS 变量会打架）
2. 把 ESLint 加一条自定义规则或 `no-hex-color` 规则，**从新增代码开始禁**，存量按文件逐步迁移
3. 优先修亮色主题下会导致文字不可读的那部分

## B3-5 性能
- **零虚拟化**：`ChatView.tsx:1957` 全量 `messages.map`，`react-window|virtuoso` 全库 0 命中。引入虚拟化（1000+ 消息场景）
- **`CTX_MAX = 1_000_000`**（`ChatView.tsx:669`）→ 上下文监控条形如虚设，`FOLD_THRESHOLD=0.70` 永不触发 → 改成按实际模型窗口
- **`tokenInfo` 每帧重算全量**：`useMemo` 依赖 `messages`，流式期间 flatMap 全部 segment
- **ref 回调内联**：`ChatView.tsx:1966/1991` 无 `useCallback`，每帧 2000 次 ref 调用
- **消息列表零虚拟化的连带**：`_chatAvatarSize` 模块级全局缓存（`Thread.tsx:141`）主题切换后需刷新才恢复

---

# 五、B4 后端稳定性（约 2 天）

## B4-1 修计数器只写不读（4 处）
| 位置 | 问题 | 后果 |
|---|---|---|
| `agentai-loop.ts:2357` | `MAX_AUTO_RESUME = 10` **声明后全文 0 引用**，`:4082` 的 `autoResumeCount++` 只用于 emit，**没有任何 `if (count >= MAX) break`** | `finish_reason==='length'` 可无限自旋，单请求可达 **90 次付费 LLM 调用**（`iteration > effectiveMax-2` 才停） |
| `agentai-loop.ts:1722` | `lastToolActivityAt` **仅在 `:3397` 工具执行后更新** | 纯文本多轮对话时 idle 超时永不触发；且 `:2617` 的处理是"不强制结束，只给 AI 注入 directive" |
| `llm-router.ts:232` | `_healthCheckTimer` 有声明 + `clearInterval`，**无 `setInterval`** | 无流量时熔断状态永久悬挂，下次请求直接吃 `premiumEmpty()` |
| `llm-router.ts:207` | `REQUEST_PACING_MS = 3000` 全文 0 引用，`lastCallAt` 只写不读 | 注释声称的"主动调速"机制不存在 |

## B4-2 修熔断器永久锁死
**文件**：`llm-router.ts`
**问题 1**：`:2113` 的 400 分支 `return` 前**不回收 `failureCount`**（对比 429 分支有 `Math.max(0, p.failureCount-1)` 配对）→ 3 次 400 后 `failureCount/totalCalls = 1.0 > 0.30` → 熔断。冷却 2 分钟后被确定性错误再次打满 → 熔断↔冷却永久循环，期间该模型 100% 不可用。
**问题 2**：`:2225` 的 `tryRecoverCircuit` 重置了 `tripped/totalCalls/failureCount/trippedAt/lastErrorStatus`，但**不重置 `_consecutiveFailures`**（`:2151`）→ 恢复后任何一次失败就立即重新黑名单 120s，退化为"失败一次锁两分钟"。
**问题 3**：免费池轮换路径 `:684` 的 `continue` 前**没有 `recordFailure`**（`:713` emergency 路径有）→ 备用模型永不熔断，每次请求串行重试全部 ranked 候选。
**做法**：400 分支补计数回收；`tryRecoverCircuit` 补 `_consecutiveFailures.set(id, 0)`（`:2182` 已有该模式，复用）；轮换路径补 recordFailure。

## B4-3 修 execSync 阻塞事件循环
**文件**：`tools.ts`（55 处 `execSync` + 23 处 `readFileSync`）
全部位于 `async` handler 内且串行 await（`dispatchToolCalls:159` 单次 await）。单条命令阻塞期间**整个 gateway 无响应**（含所有其他用户的 SSE 流和 `:458` 心跳）。
**做法**：高频命令改 `execFile` 的 Promise 版本；`readFileSync`/`writeFileSync` 改 `fs.promises`。**这是 B4-1 idle 超时救不了场的直接原因之一。**

## B4-4 修 SSRF 与 delta 缓冲
- `tools.ts:4608` `skill_forge` 的 `targetUrl` **无 SSRF 校验**（`isDangerousUrl` 全库仅 1 处调用，在 `:1443` 的 `web_fetch` 内，而 `tools.ts` 有 20+ 个 fetch 调用点）→ 云元数据凭证可被读入
- `agentai-loop.ts:519` 的 `_createThrottledOnDelta` 缓冲定时器在 40+ 个 `return` 路径不清理 → 尾部 delta 永久丢失（前端看到**截断的回复**），且 `emit('llm:delta')` 在 `run()` 已返回后触发 → 时序错乱

## B4-5 备份目录无上限
`tools.ts:1922`（write_file）、`:1552`（multi_edit）、`temp-file-tracker.ts` 均单调写入，无容量/TTL/数量上限。`:2022` 的 `readdirSync` 随文件数线性变慢（`undo_edit` 每次全量扫描）。

---

# 六、B5 架构还债（约 4 天）

## B5-1 删死代码（有检测工具后逐步删）
**规模**：77 个孤儿文件 / 18,157 行 + 5 个死工具数组 + 16 个 src 内测试脚本 + 122 个备份文件 / 120MB

**前置**：必须先有 B0-1（缩进修复）+ 一个孤儿文件检测 CI，否则删不干净也验不对。

**优先删的 8 个死工具数组**（全是无人 import）：
```
system-prompt-core.ts:44       L1_TOOLS (29)
builtin-tools-manager.ts:44    BUILT_IN_TOOLS (10)
mcp-skill-market-server.ts:37  TOOLS (5)
media-generation-tools.ts:333  (6)
ai-marketing-tools.ts:467      (10)
enhanced-image-tools.ts:416    (4)
multi-platform-publish.ts:406  (5)
skill-market-tools.ts:363      (7)
```
**优先删的 GUI 孤儿**：`SchedulePanel.tsx`(453) / `GovernorPanel.tsx`(433) / `GitAuthPanel.tsx`(434) / `materials.ts`(403) / `ExternalConnectionsPanel.tsx`(188)

**必须删的**：`packages/agentai-gui/src/components/ChatView.tsx.bak`（113KB，**紧邻源码，AI 编辑 ChatView 时可能误读**）

## B5-2 统一 provider 配置（当前 4 处且互不同步）
| 位置 | 内容 | 状态 |
|---|---|---|
| `llm-router.ts:1370` PROVIDER_DEFAULTS | 17 项 | **唯一活的** |
| `provider-config.ts:36` PROVIDER_CONFIGS | 11 项 | **全库 0 引用的孤儿文件**，190 行从未被执行 |
| `model-selector.ts:20` BUILTIN_MODELS | 46 项 | — |
| `gui/store/modelStore.ts:82` ModelConfig | **68 项** | 与后端不同步 |

**后果**：`filterRequestFields()` 对未配置 provider 走 `return body` **完全不过滤字段** → thinking 扩展字段直接发给不支持的 provider。
**另外**：`agnes-2.5-flash` **一个模型名硬编码在 11 个文件**里。改一次模型名要改 11 处——这已经发生过（`commercial-model-templates.ts:110`、`llm-router.ts:359`、`model-classifier.ts:409,1090` 等散布 11+ 处删除注释）。

## B5-3 统一重复实现
| 类别 | 现状 | 做法 |
|---|---|---|
| Token 估算 | 4 套：后端 `token-utils.ts`(tiktoken) / `token-estimate.ts`(仅被自己测试引用，死) / 前端 `tokenCounter.ts`(`len/4`) / `context-manager.ts:60` 等 3 处独立实现 | 前端改用后端返回的 `usage`，删本地估算；删死文件 |
| SSE 解析 | 10 处 | 抽共享解析器到 `packages/agentai-core` |
| 时间格式化 | 46+ 处，GUI 无任何共享 date utils | 建 `gui/src/utils/datetime.ts` |

## B5-4 修 AGENTS.md 失真（4 个数字）
| 位置 | 声明 | 实测 |
|---|---|---|
| `AGENTS.md:137` `:338` | 141 个工具 | `tools.ts:497` = **198** |
| `AGENTS.md:284` | system-prompt.ts ~250 行 | **642 行** |
| `AGENTS.md:122` | 8 个 Provider | `llm-router.ts:1370` = **17 个** |
| `AGENTS.md:101-110` | 上下文注入 ~8 层 | `agentai-loop.ts:559` 内 **34 处 `systemMsgs.push`** |
| `AGENTS.md:282` | 已删 5 个死代码文件 | `self-verifier.ts`(99行) / `trust-ladder.ts`(394行，仍孤儿) **还在** |
| `README.md:411` | `pnpm dev:qqbot` | 根 package.json **无此 script** |
| `AGENTS.md:259` | "缺少端到端测试" | 已有 492 用例（1 红） |

**同时删掉 91 处误导性注释**（声称已删但代码还在 / TODO 未实现）：
```
agentai-loop.ts:653,1127,1119,3990
llm-router.ts:2163
routes/profile.ts:64
qihuang/four-diagnoses.ts:163,173,262,267
skill-code-generator.ts:245  ← 整个文件是空壳
meta/meta-reasoner.ts:3 / agent-battle.ts:3 / revert-bridge.ts:3  ← 各 3 行 TODO
```

---

# 七、B6 建立防线（防止问题再生）

## B6-1 CI 加 5 道门
| 门 | 实现 | 阻断什么 |
|---|---|---|
| **lint 真实可用** | B0-2 修 `globals` 依赖 | 当前 `pnpm run lint` **直接崩溃**，CI 的 Lint 步骤必然失败 → **lint 从来没真正跑过** |
| **typecheck 不空转** | B0-3 修 `include: []` | 根 typecheck 当前一个文件都不检查 |
| **测试全绿** | B0-4 修 3 个超时 | CI 现在是红的 |
| **契约 diff** | 脚本：提取后端路由 vs 前端 fetch，输出差集 | 38 处契约不匹配不会再攒到 38 |
| **孤儿文件检测** | import 图脚本（B0-1 完成后可信） | 77 个孤儿不会再攒 |

现有 `pr-check.yml` 已有 Lint/Typecheck/Test 三步和 secret-scan，**只需要把它们修好**，不需要新建 workflow。

## B6-2 ESLint 加硬规则
```js
'react-hooks/exhaustive-deps': 'error'   // 现在是 warn，且有 8 处 eslint-disable 绕过
```
存量先 record 数量（见 B0-2），再逐文件收紧。

## B6-3 立"声明可验证"规矩
AGENTS.md 里每个数字必须来自脚本。CI 加一步"校验 AGENTS.md 中的工具数量与 `tools.ts` 实际一致"，不一致就红。
**这是本次审查最有价值的一条** —— 4 个错误数字会持续误导每一个接手的 AI 助手。

## B6-4 新增 UI 交互的三件套要求
新增任何 UI 交互，PR 必须同时包含：
1. **状态来源** —— 这个 state 从哪来、谁消费
2. **接线** —— 请求/事件怎么发出去（不能只改 UI）
3. **后端契约** —— 对应端点存在且字段对得上

配一条 ESLint 自定义规则：检测"声明后仅出现在 JSX 渲染分支、无 effect/handler 消费"的 `useState`。这能自动抓住 `webSearch`/`fileTreeVisible`/`searchQ`/`composingRef` 这一整类问题（8 处中的 6 处）。

---

# 八、执行顺序与依赖

```
B0-0 建干净分支
  │
  ├─ B0-1 修 tools.ts 缩进 ────────┐（解锁 lint/死代码检测）
  ├─ B0-2 修 lint 依赖 ────────────┤
  ├─ B0-3 修 typecheck 空转 ───────┤（三者可并行）
  ├─ B0-4 修测试红灯 ─────────────┤
  └─ B0-5 清理垃圾文件（独立，随时可做）
        │
        ▼
   B1 安全止血（6 项并行可独立 PR，2天）
        │
        ├─ B1-7 tc.args={} 覆盖    B1-6 SSE 限流泄漏（独立）
        ▼
   B2 数据正确性
        │
        └─ B2-1 工作区隔离 ★单独 PR（44 处调用点，风险最高）
        │
        ▼
   B3 前端（功能接线 → React 规则 → a11y → 性能）
        │
        ▼
   B4 后端稳定性 ─────────────┐
        ▼                      │
   B5 架构还债 ────────────────┤（B5-1 依赖 B0-1 + B6-1 孤儿检测）
        │                      │
        └──────────────────────┘
               ▼
        B6 建立防线（贯穿，B6-1 各门在对应 B0 完成后立即加）
```

**关键路径**：B0-1 → B0-2 → B6-1 的 lint 门 → B5-1 删死代码。**这条链最长，但每一步都独立可交付。**

---

# 九、工作量汇总

| 批次 | 内容 | 估算 | 风险 |
|---|---|---|---|
| B0 | 解锁（缩进/lint/typecheck/测试/清理） | 0.5 天 | 低（缩进有回归风险，但 tsc 能验） |
| B1 | 安全止血 8 项 | 1.5 天 | 中（改命令执行方式） |
| B2 | 数据正确性 5 项（含工作区隔离） | 2 天 | **高**（B2-1 触及 44 处） |
| B3 | 前端（接线/React/a11y/性能） | 3 天 | 中 |
| B4 | 后端稳定性 5 项 | 2 天 | 中 |
| B5 | 架构还债 4 项 | 4 天 | 低（但工作量大） |
| B6 | 建立防线 | 与上述并行 | 低 |
| **合计** | | **约 13 天** | |

---

# 十、验收标准

每个批次完成后必须满足：

```bash
# 通用（每个PR 都要过）
cd packages/agentai-gateway && npx tsc --noEmit    # EXIT=0
cd packages/agentai-gui && npx tsc --noEmit# EXIT=0
pnpm --filter @agentai/gateway test                 # 全绿（当前 3 红）
pnpm run lint                                        # 真实跑通（B0-2 后）
pnpm run typecheck                                   # 真实检查（B0-3 后）

# 批次专项
B0  python tools_indent_check.py       # 0 个 0缩进 handler
B1  curl 127.0.0.1:PORT/v1/chat         # 未授权请求应 401（开启鉴权时）
B1  并发 3 个 stream:true 请求          # 第 3 个排队，不 429
B2  两窗口不同 workspace交叉读文件     # 读不到对方文件
B2  发消息后立刻切会话                 # 切回来 AI 回复完整
B2  F5 刷新                           # 最后一条消息还在
B5  python orphan_detector.py          # 孤儿文件数单调下降
```

---

# 十一、需要你确认的 4 个决策点

1. **D1 `.env` 历史**：我建议**只轮换 Key**，不重写历史（实测 `d103a62` 不在 main、不在任何分支、远端无此提交 → 泄露面为零）。
2. **D2 鉴权默认值**：我建议 **dev 关 / prod 开**。这会影响部署流程，需要你确认现有部署方式。
3. **D4 死代码清理尺度**：我建议**先加检测跑一周拿基线，再逐步删**，不一次性全删。
4. **B2-1 工作区隔离**是全部改动里风险最高的一项（44 处调用点 + 工具签名变更）。我建议**单独开一个分支做**，不与其他批次混。

确认后我从 B0 开始。