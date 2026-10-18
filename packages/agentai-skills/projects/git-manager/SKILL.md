---
name: git-manager
description: 【本地 git 工作流】改动代码前建回滚锚点、改完必须 git_smart_commit 提交、危险操作前确认、必要时用 worktree 隔离并行改动。触发场景：提交/commit/checkpoint、改代码后要落盘、看 diff、误操作要回滚、并行任务互相覆盖、准备开 PR/rebase/release。不要用它操作 GitHub API（那是 github-skill）。
category: dev
tags: [git, commit, checkpoint, worktree, diff, revert, devops]
author: AgentAI Team
requires:
  bins: [git]
---

# Git Manager — 本地 git 工作流

> 本项目**不用 `run_shell_command` 跑 git**，用专用工具（见下表）。它们走 `execFile(gitBin, argv)` 数组化调用，绕开 shell，Windows 下自动探测 git 绝对路径。

## 一、工具清单（LLM 原生，走它们别手搓 shell）

| 工具 | 用途 | 风险 |
|---|---|---|
| `git_status` | 工作区状态（modified/untracked/staged） | low，可并行 |
| `git_diff` | 差异，支持 staged / file / stat | low，可并行 |
| `git_log` | 提交历史，支持 count / file 过滤 | low，可并行 |
| `git_smart_commit` | **首选**：自动生成 conventional commit 一键提交 | — |
| `git_commit` | 手动 stage + commit（要精确控制 message 时） | — |
| `git_branch` | list / create / switch | medium，**不可并行** |
| `git_push` / `git_pull` | 推 / 拉（支持 rebase） | medium |
| `git_clone` | 克隆 | medium |

辅助（非工具，属纪律门禁 `discipline/gates.ts`）：
- `createAnchor()` — 建回滚锚点 = `git add -A && git commit --no-verify -m "checkpoint: <描述>"`
- `listAnchors()` — 列出最近锚点，断点续跑时反查

## 二、六条不变式（违反就是事故）

1. **改完必提交** —— 任何代码改动落地后调用 `git_smart_commit`，不要攒着。提交信息描述**这个子任务做了什么**，不是"更新代码"。
2. **危险操作先建锚点** —— `git reset --hard` / `git clean -fd` / `git checkout -- .` / `git restore .` / 任何删文件的命令之前，先 `createAnchor()`。平台有门禁会拦你并提示建锚点，别绕。
3. **不推送改写历史** —— 禁止 `push --force`、`commit --amend` 到已推送的分支、`git rebase` 已共享的提交。要改历史先问用户。
4. **一个并行写者一个 worktree** —— 两个任务同时改同一个仓库会互相覆盖（真发生过，`tools.ts` 被并行会话冲掉两次）。并行改文件前建 worktree（见下节）。
5. **不进 worktree 里再建 worktree** —— 先检测：`git rev-parse --git-dir` 与 `git rev-parse --git-common-dir` 不相等 = 已在 worktree 内。
6. **建了就要清** —— worktree 用完 `git worktree remove <path>` → `git branch -D <branch>` → `git worktree prune`，不留孤儿目录。

## 三、标准流程

### 改一个功能
```
1. git_status                     # 先看清工作区脏不脏、有没有别人的未提交改动
2. createAnchor()                 # 脏的（有非本次改动）→ 先建锚点保底
3. ...改代码 / 跑测试...
4. git_diff --stat                # 自查改了哪些文件，有没有顺手改了无关的
5. git_smart_commit               # 提交，message 写清这个子任务
6. git_push                       # 需要同步远端时
```

### AI 改错了 → 会话内秒退（不用 git）
平台有**会话级 checkpoint/rewind**（`/rewind` 命令，2026-10-16 上线）：每发一条指令就是一个 checkpoint，AI 用编辑工具改文件前的副本自动存着。
- 选错轮次 → 先看预览（会恢复哪些 / 删除哪些）→ 确认才真回滚，**不动 git 历史、不动对话记录**
- GUI 里 `/rewind` 打开面板；HTTP: `GET /v1/session/checkpoints` + `POST /v1/session/checkpoints/rewind`
- ⚠️ **回退不到的东西**：命令改的文件（`rm`/`mv`/`sed -i`/格式化器）、子智能体在别的进程改的文件 → **那些只能靠 git 锚点/提交**
- 破坏性操作，优先级：**会话内回退 > git 锚点 > 手动改回来**

### 误操作要回滚
- 优先 `git_diff` 看清楚要退掉什么，**不要**上来就 `reset --hard`
- 有锚点 → `createAnchor()`/`listAnchors()` 找到改动前的 sha，按 sha 恢复
- 没锚点 → `git_status` 确认哪些是误改，逐个 `git checkout -- <file>`（**只退误改的文件，不整体回退**）
- 提交错了但还没推 → `git commit --amend` 修正 message
- 已推 → 不改历史，走新提交纠正（`revert` 思路：手工改回来再提交）

### 看项目近况
`git_log -5` 看最近做了什么；`git_diff --stat` 看现在改了什么。启动感知已自动注入最近 5 次提交摘要，不用重复问。

## 四、worktree 隔离（并行/高风险改动）

**什么时候用**：① 任务 A 和任务 B 要同时改文件 ② 想试一个可能推翻重来的大重构 ③ 主工作区有未提交改动但又想试危险操作。

**手动流程**（平台暂无自动 `EnterWorktree` 工具时用这个）：
```bash
# 1. 从当前 HEAD 建隔离工作区（分支名用 feat/xxx 或 fix/xxx，目录名跟分支名对齐）
git worktree add ../wt-<slug> -b <type>/<slug>
# 2. 进去干活，提交在隔离分支上
cd ../wt-<slug> && git add -A && git commit -m "..."
# 3. 收尾二选一
git worktree remove ../wt-<slug>        # 丢弃（改动随分支一起废）
# 或合回主线
cd - && git merge <type>/<slug>
# 4. 清理
git branch -D <type>/<slug> && git worktree prune
```

**注意**：
- worktree **不共享未跟踪文件** —— 新工作区没有 `.env` / 本地 fixtures，需要就手工复制进去（或把文件列进 `.worktreeinclude` 约定）
- 命令 `git worktree add <path> -b <branch>` 和 `--detach` **不能同时用**
- 本机已实测可用（git 2.55.0.windows.3），此前 spec 里"沙箱禁 worktree add"的记录已过期

## 五、绝对禁止

- ❌ 未经用户要求就 `push` 到 `main` / `master`
- ❌ `push --force`、`push --force-with-lease` 到共享分支
- ❌ 对已推送提交 `rebase` 或 `amend`
- ❌ 用 `git reset --hard` / `clean -fd` "清理一下工作区"（会连别人的未提交改动一起没）
- ❌ `git add -A` 在工作区混有他人/无关改动时（会把不相关文件一起提交）
- ❌ 为了让 CI 变绿而删测试或放宽断言

## 六、故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `git commit` 报 nothing to commit | 改动没落盘或已在上一提交里 | `git_status` 确认 |
| commit 被 husky/commitlint 拦 | 提交信息格式不合规 | 按提示改 message（`git commit` 无 `-m` 进编辑器） |
| `ENOENT: git` | Windows 没在 PATH | 平台会自动探测 git 绝对路径；仍失败则查 Git 安装 |
| worktree add 报分支已存在 | 名字撞了 | 换分支名，或先 `git branch -D` 旧分支 |
| 提交进了别人的改动 | 混提交 | `git_smart_commit` 后用 `git_diff HEAD~1 --stat` 自查；已推则新提交纠正 |
| 想看"这次任务改了什么" | — | `git_diff --stat`（工作区）+ `git_log -1 --stat`（最近提交） |