# Git 能力调研：开源方案与技能生态 (2026-10-16)

> 目的：搞清楚「git 对这个框架还能帮什么忙」，哪些已经具备、哪些是真空白、哪些开源/技能可以直接借鉴。
> 方法：本地代码盘点（Agent 深度审计）+ 联网调研（Claude Code / Codex 官方机制、开源 MCP、开源 skill）。
> 结论前置：**最该补的不是「更多 git 命令」，而是三样东西 —— worktree 隔离、会话级 checkpoint/rewind、把散乱的 git 规则沉淀成真技能（现在 git-manager 只有 2 行）。**

---

## 一、本地已有什么（别重复造）

| 能力 | 状态 | 位置 | 说明 |
|---|---|---|---|
| 9 个 LLM 原生 git 工具 | ✅ 成熟 | `tools.ts:1069-1079` | `git_status/diff/log/commit/smart_commit/branch/push/pull/clone`，`riskLevel` 已分级 |
| git 执行安全层 | ✅ 成熟 | `tools.ts:567-580` | `execFile(gitBin, argv)` 数组化，绕开 shell；Windows 探测 git 绝对路径 |
| commit 型回滚锚点 | ✅ 成熟 | `discipline/gates.ts:353-385` | `createAnchor()` → `git add -A && git commit --no-verify -m "checkpoint: ..."`，高危动作（git reset）强制先建锚点 |
| 锚点清单/恢复上下文 | ✅ 有 | `gates.ts:389-400` | `listAnchors()` 断点续跑时反查最近锚点 |
| 任务状态快照 | ✅ 有 | `task-snapshot.ts` | 存 `~/.agentai/tasks/{taskId}/`，恢复「任务进展到哪」，**不回滚代码文件** |
| 启动注入 git log | ✅ 有 | `agentai-loop.ts:1569-1571` | 首轮注入最近 5 次提交摘要 |
| 破坏性动作门禁 | ✅ 有 | `gates.ts:137-153` | git reset/clean 走人工确认 |
| git skill ×3 | ⚠️ 空壳 | `projects/git-manager/SKILL.md` | **全文 2 行**，无流程细节；github-skill 是 GitHub API 侧，非本地 git |
| worktree 隔离 | ❌ 无 | 仅 `docs/superpowers/specs/2026-06-12-worktree-soft.md` | spec 有设计，plan 7 项 checkbox 全未勾，**代码 0 行** |
| 会话级 checkpoint/rewind | ❌ 无 | — | 只有 commit 粒度锚点，没有「这一轮改错了 → 回到第 3 轮」的能力 |
| `.worktreeinclude` 类本地文件带入 | ❌ 无 | — | 新 worktree 不带 `.env` 等未跟踪文件 |
| 子智能体**文件**隔离 | ❌ 无 | `subagent.ts` 只隔离上下文 | ⚠️ 已造成两次实际事故（并行会话互相覆盖 `tools.ts`） |
| 第三方 git 库 / git MCP | ❌ 无 | `package.json` 无 `simple-git`/`isomorphic-git`；`~/.workbuddy/mcp.json` 只有一个无关且已禁用的 server | 全部靠系统 git 二进制 |

---

## 二、开源与官方机制（可借鉴）

### 2.1 Claude Code 原生（最值得抄的两件）

**① worktree 隔离**
- `claude --worktree [name]`：建 git worktree、切进去、起独立会话（独立目录 + 分支 + 上下文）
- 子智能体级：`Agent` 工具的 `isolation: "worktree"` 参数，子代理结束后无改动则自动清理，有改动则返回路径供人 review
- `.worktreeinclude`：声明哪些未跟踪文件要复制进新 worktree（`.env.example`、本地 fixtures）—— 默认 worktree **不共享**未跟踪文件
- 官方实践：同时开 3-5 个会话各占一个 worktree；子代理 + worktree = 并行改文件不撞车
- Codex 对应物：Handoff（local ⇄ worktree 迁移任务），默认 detached HEAD 防污染分支列表

**② Checkpointing / `/rewind`（会话级撤销）**
- 机制：**每个用户 prompt 开轮前 = 一个 checkpoint**（对话位置）+ 该轮改动文件的 pre-edit 副本（存 `~/.claude/file-history/<sessionId>/`）
- 保留最近 100 个 checkpoint，默认 30 天清理（`cleanupPeriodDays` 可调），随会话持久化（`/resume` 后仍可 rewind）
- rewind 菜单 6 项：`restore code+conversation` / `restore conversation` / `restore code` / `summarize from here` / `summarize up to here` / `never mind`
- **官方明说的三个坑（对我们尤其重要）**：
  1. **bash 命令的改动不追踪**（`rm/mv/cp/sed -i/格式化器` 都不可撤销）
  2. **subagent 的编辑默认不追踪**（只有前台 `context: fork` 的 skill 例外）
  3. 符号链接 / 硬链接 / 目录结构变了的路径会被跳过
- 结论（官方原话大意）：**其他 subagent 需要 git 兜底** —— 所以 worktree 和 checkpoint 不是二选一，是两层

### 2.2 开源 MCP server

| 项目 | 干什么 | 对我们的用 | 成熟度 |
|---|---|---|---|
| **GitHub 官方 `github-mcp-server`** | repos/issues/PR/code search/Actions 全套工具，支持 `--toolsets` 精细授权 + `--read-only` 起步 | PR 自动创建、code search 当"找历史实现"的检索源 | 官方维护，MIT，在 MCP Registry |
| **GitMCP (`idosal/git-mcp`)** | 把任意公开 GitHub 仓库变成 MCP 文档源（优先 `llms.txt` → README），`https://gitmcp.io/{owner}/{repo}` 零配置 | **查第三方库真实 API 用它**（我们天天在 hallucinate 依赖版本/函数签名） | 8.4k star，Apache-2.0 |

> 这两个是"外部文档/协作源"，**不能替代本地 git 能力**，属于另一个维度（网络 vs 本地）。

### 2.3 开源 skill（可直接内化的规则集）

| Skill | 来源 | 内容 |
|---|---|---|
| `cc-worktree-management` | markus41/claude | EnterWorktree/ExitWorktree 生命周期、branch-per-worktree 命名规范、编排者 fan-out + 合并顺序 |
| `crewforth/worktree` | crewforth（Skills Directory Grade A，安全分析 A100/100） | 不变式清单：隔离先于风险 / 不在事后回滚 / **一个并行写者一个 worktree** / 不嵌套（`git rev-parse --git-dir != --git-common-dir` 检测）/ 走时清理 |

### 2.4 库：simple-git / isomorphic-git —— 建议**不引入**

我们已有 `execFile` 安全层 + Windows git 路径探测 + 单测锁死（`b1-security.test.ts:73-80`）。引入 isomorphic-git 的代价：Windows 大仓库性能差、无 worktree 支持、失去真实 git 二进制的行为一致性。**继续用 execFile 是对的。**

---

## 三、差距对照与落地方案

| 缺口 | 参考实现 | 收益 | 工作量 | 风险 | 优先级 |
|---|---|---|---|---|---|
| **A. git-manager skill 写成真技能** | 2.3 两份 skill + 本地 9 工具/锚点/门禁 | 高（零风险，当天可用） | 小 | 无 | **✅ 已完成 (10-16)** |
| **B. 会话级 checkpoint/rewind** | 2.1② | 高（AI 改错一键回退到任意轮） | 中（可复用 task-snapshot + 锚点） | 低 | **✅ 已完成 (10-16)** |
| **C. worktree 隔离（会话/子智能体）** | 2.1① + spec 已写好 | 高（根治并行覆盖事故） | 中大（目录生命周期 + 清理 + 合并） | 中 | **P1** |
| **D. `.worktreeinclude` 带入本地文件** | 2.1① | 中（worktree 落地的前置） | 小 | 无 | P1（随 C） |
| **E. GitHub MCP server** | 2.2 | 中（PR / code search） | 小（配置即用） | 需 PAT | P2 |
| **F. GitMCP 查第三方库 API** | 2.2 | 中（减幻觉） | 小 | 无 | P2 |
| **G. 引入 jj (Jujutsu)** | — | 低（无 index/可丢弃变更，理论上更贴 agent） | 大（替换工作流） | 高 | 远期，不建议现在动 |

### B 项落地记录（2026-10-16）
- 新模块 `packages/agentai-gateway/src/session-checkpoint.ts`：beginTurn / trackFile / listCheckpoints /
  rewind（默认 dryRun）/ pruneSession / clearSession；内容寻址 blob 去重，存 `~/.agentai/checkpoints/{sessionId}/`
  （可 `AGENTAI_CHECKPOINT_ROOT` 覆盖）。开关 `SESSION_CHECKPOINT_ENABLED`（默认开）、`SESSION_CHECKPOINT_KEEP`（默认 100）
- 接入 `agentai-loop.ts`：run() 入口 beginTurn；dispatch 前对 `WRITE_CLASS_TOOLS` 逐个 trackFile（含 multi_edit 的 edits[]）
- ⚠️ 关键设计：**新增 `checkpointSessionId` 字段而不是复用 `opts.sessionId`** —— 后者是 persistentMemory/fts5 的记忆键，
  且 chat.ts 每请求新建 loop 会自带随机 sessionId，动了会污染记忆系统。现在用前端会话 id 归集（ChatView 两处 body 传 sessionId）
- HTTP: `routes/session-checkpoint.ts`（GET 列表 / GET :id/files / POST rewind / DELETE），挂 app.ts
- GUI: `components/chat/RewindPanel.tsx` + `/rewind` 斜杠命令 + agentai-theme.css `.rewind-*` 类
- 测试: `session-checkpoint.test.ts` 20/20、`scripts/session-checkpoint-e2e.mjs` 21/21、gateway+GUI tsc 0 错
- 安全红线（已锁进单测）：只回滚被跟踪文件 / 默认 dryRun / 符号链接拒绝 / TOCTOU 复检 / 工作区外路径跳过 / sessionId 消毒

---

## 四、已实测的环境事实

- `git worktree add` **本机完全可用**（git 2.55.0.windows.3，2470 文件检出成功；沙箱不拦）
- ⚠️ `docs/superpowers/specs/2026-06-12-worktree-soft.md:7` 写的阻塞项「PowerShell sandbox 禁 git worktree add」**已过期**，那份 spec 可以解除阻塞直接实施
- `git worktree add <path> -b <branch>` 和 `--detach` 不能同时用
- 清理顺序：`git worktree remove <path> [--force]` → `git branch -D <branch>` → `git worktree prune`

## 五、踩坑预案（来自 Claude 官方限制，提前绕）

1. **bash 改动 checkpoint 追不到** → 我们的 write_file 类工具走文件 API（可追），但 `run_command` 改文件追不到 → 高危 bash 前必须先建锚点（现有 `gates.ts` 已做）
2. **subagent 编辑 checkpoint 追不到** → 只能靠 git/worktree → 这正是 C 项的价值
3. **worktree 不带未跟踪文件** → 必须有 D 项，否则新 worktree 跑不起来（缺 `.env`）
4. **worktree 会无限堆积** → 必须有 prune + 上限清理，否则磁盘和 `git worktree list` 都会脏
---

## 六、B 项落地后的对抗性自审（2026-10-16）

功能交付后按「继续探索优化，直到你发现无问题」做了一轮自审，发现并修复 **5 个真问题**，其中 1 个是会丢代码的严重 bug。

### ① 并发串台 → 回退空转，**代码丢**（P0，已复现）
同会话并发两条消息时，两个 loop 的 `beginTurn` 争抢 index 里的全局 `current` 标记。后到的 loop 抢走 `current`，先到的 loop 改的文件被挂到**别人的** checkpoint 上；再 rewind 自己那个点 → `actions: []`，而文件还是改坏的状态 = 回退等于没做。

复现实证（`/tmp/concur.mjs`）：
```
cpA= cp-…-9d007c  cpB= cp-…-d09654
A 跟踪结果: true        ← 实际挂在 cpB 上
cpA 文件数: 0
rewind(cpA): [] → a.txt 仍是改坏内容
❌ 第一个 loop 的改动丢跟踪，回退空转
```
**修复**：`trackFile(sessionId, absPath, workspaceRoot, cpId?)` 增加显式 checkpointId；loop 存**实例级** `private _checkpointId`（`run()` 里由 `beginTurn` 赋值），dispatch 时透传。绝不能靠全局 `current` 做归属判定。

### ② Windows 盘符大小写 → rewind 静默全跳过
`trackFile` 用 `opts.workspace`（loop 侧），`rewind` 用 HTTP 端点解析的 workspace，两者可能仅盘符大小写不同。大小写敏感比较会把所有文件判成"已移出工作区"→ 界面显示成功、实际什么都没退。
**修复**：`insideRoot()` 在 win32 下大小写不敏感比较。

### ③ rewind 无审计（合规缺口）
回滚是破坏性操作却无留痕。**修复**：新增 `logRewind`/`readRewindLog`（`rewind-log.jsonl` append-only，preview / apply 分记）+ `GET /v1/session/checkpoints/rewind-log` 端点。对齐 pentest 的 `scope-audit.jsonl` 思路。
**追加加固**：日志超 2MB 自动滚动为 `.1`（只留最近一份），否则长会话反复 preview 会把日志撑爆。

### ④ 存储无生命周期 → 磁盘只涨不跌
会话废弃后 blobs 无人回收。**修复**：`sweepOldSessions(maxAgeDays)`（目录 mtime + 最新 checkpoint ts 双重判定，默认 30 天，对齐 Claude Code）挂进既有 `startTaskCleanupLoop` 的 6 小时定时器，不另起 timer。
**追加加固**：清扫用 `lstat` 而非 `stat` 并显式跳过符号链接 —— 否则根目录下混入一个指向工作区外的链接时，`stat` 会跟随并把它当成"过期目录"递归删出去。

### ⑤ 新增 6 个回归测试时的结构事故
插入 describe 块时把原 `describe('多轮与回收')` 头部覆盖，导致 vitest 收集阶段失败（`Tests  no tests`）。补回 describe 头即恢复。

### 最终验收
| 项 | 结果 |
|---|---|
| `session-checkpoint.test.ts` | **28/28**（20 原用 + 8 自审新增：并发不串台 / 兼容旧调用 / win32 大小写 / 留痕 / 清扫 / fileCount 以清单为准 / 清扫跳符号链接 / 日志滚动） |
| `scope-guard.test.ts` 回归 | **50/50** |
| `scripts/session-checkpoint-e2e.mjs` | **21/21** |
| `scripts/pentest-scope-e2e.mjs` 回归 | **30/30** |
| gateway tsc / GUI tsc | 0 错（rewind 相关）/ 0 错 |

> 注：`automation-engine.ts` 有 2 处 TS2341（`_registry`/`_router` private 访问），来自并行会话的 automation 路由改动，不在本项范围内。
>
> **e2e 脚本跑法提醒**：脚本用 `.ts` 后缀 import，必须用 tsx 跑 —— `node ./node_modules/tsx/dist/cli.mjs scripts/xxx-e2e.mjs`。直接 `node scripts/xxx-e2e.mjs` 会报 `ERR_MODULE_NOT_FOUND`。

### 已知边界（不是 bug，是设计上限）
- `run_command` 改的文件追不到（走 shell，不经文件 API）→ 高危命令前仍须 `createAnchor`
- 子智能体在别的进程改的文件追不到 → 靠 git/worktree 兜底
- 会话被删（`DELETE`）则该会话的 rewind 与审计一并消失
- 并行会话互相覆盖代码 checkpoint 救不了 → 这正是 P1-C worktree 隔离要根治的
