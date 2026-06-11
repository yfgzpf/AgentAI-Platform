# Worktree Soft Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 git worktree 给每个 Chain 任务开隔离开发环境, 共享 node_modules

**Architecture:** 新增 worktree/ 模块(5 文件) + chain-store/tools 集成 cwd 解析

**Tech Stack:** TypeScript ESM + child_process exec(git 命令) + 平台分支(Win symlink/mklink)

---

## File Structure

| 文件 | 类型 | 行数估 |
|---|---|---:|
| `worktree/types.ts` | 新建 | 50 |
| `worktree/symlink.ts` | 新建 | 100 |
| `worktree/manager.ts` | 新建 | 200 |
| `worktree/index.ts` | 新建 | 100 |
| `worktree/router.ts` | 新建 | 120 |
| `chain-store.ts` | 修改 | +30 |
| `tools.ts` | 修改 | +20 |
| `index.ts` | 修改 | +10 |
| `worktree/*.test.ts` | 新建 | 250 |

**预计总改动**: ~880 行, 9 个文件

---

## Task 1: 类型 + 路径解析

- [ ] 1.1 创建 `worktree/types.ts`: WorktreeInfo / CreateRequest / MergeResult
- [ ] 1.2 写路径工具函数:
  - `getWorktreeBase(): string` (`.worktrees/` 在 git root)
  - `getWorktreePath(name): string`
  - `normalizeBranchName(name): string`(转 `task/<name>`)
  - `getSharedNodeModules(pkg): string[]`(返回需符号链接的路径)
- [ ] 1.3 写 `types.test.ts`: 路径解析 + 平台分支

## Task 2: 符号链接(平台分支)

- [ ] 2.1 创建 `worktree/symlink.ts`:
  - `createSymlink(src, dest): void`
  - Linux/macOS: `fs.symlinkSync(src, dest)`
  - Windows 开发者模式: `fs.symlinkSync(src, dest, 'junction')`  // 用 junction 绕过权限
  - Windows 关闭: 跑 `cmd /c mklink /D <dest> <src>`
  - 都失败: 抛 `SymlinkNotSupportedError`, 提示用户开开发者模式
- [ ] 2.2 写 `symlink.test.ts`:
  - 真建一个 junction, 验证 readdir 通过
  - 测 `EPERM` 抛错
  - 测 `EEXIST` 跳过

## Task 3: Manager(核心)

- [ ] 3.1 创建 `worktree/manager.ts`, `WorktreeManager` 类:
  - 启动时 `git worktree list` 拉现状, 同步 `.agentai/worktrees.json`
  - `create(name, baseBranch?): Promise<WorktreeInfo>`
    - 调 `git worktree add -b task/<name> <path> <base>`
    - 自动符号链接 `node_modules`
    - 写状态文件
  - `list(): WorktreeInfo[]`
  - `get(id): WorktreeInfo | null`
  - `remove(id, force = false): Promise<void>`
    - `git worktree remove --force`
    - `git branch -D task/<name>`
  - `merge(id, target = 'main'): Promise<MergeResult>`
    - `git -C main merge task/<name>`
    - 冲突返 `MergeResult { hasConflicts: true, conflicts: [...] }`
  - `cleanup(maxAgeDays = 30): Promise<number>`(删未活动)
- [ ] 3.2 写 `manager.test.ts`(用 `os.tmpdir()` + `git init`):
  - 完整流程: create → list → remove
  - 错误: 在 main 上建 worktree 拒绝
  - merge 冲突检测

## Task 4: 单例 + 路由

- [ ] 4.1 创建 `worktree/index.ts`:
  - 启动时 `load worktrees.json`
  - 启动 cleanup(每小时检查)
- [ ] 4.2 创建 `worktree/router.ts`:
  - `POST /v1/worktrees` body `{name, baseBranch?}` → `{worktree}`
  - `GET /v1/worktrees` → `{worktrees: WorktreeInfo[]}`
  - `GET /v1/worktrees/:id` → `{worktree}`
  - `POST /v1/worktrees/:id/merge` body `{target?}` → `{mergeResult}`
  - `DELETE /v1/worktrees/:id` body `{force?}` → `{ok}`
  - 错误: 400 with reason
- [ ] 4.3 修改 `index.ts`: 挂路由
- [ ] 4.4 写 `index.test.ts` + `router.test.ts`

## Task 5: chain-store 集成

- [ ] 5.1 修改 `chain-store.ts`:
  - 任务数据加 `worktreeId?: string`
  - `execute(task, ctx)` 时, ctx.cwd = worktree.path
  - 完成时给用户展示 diff(`git diff main..task/<name>`)
- [ ] 5.2 写 `chain-store.test.ts` 增量测试

## Task 6: tools 集成

- [ ] 6.1 修改 `tools.ts`:
  - `read_file`/`write_file`: path 自动 join 到 worktree.cwd(如果有)
  - `bash`: spawn cwd 同样用 worktree.cwd
  - 任何跨 worktree 路径加 warning
- [ ] 6.2 写增量测试

## Task 7: 验证

- [ ] 7.1 `pnpm typecheck` 0 错误
- [ ] 7.2 `pnpm test` 全过(老 + 新 ≥ 8 测试)
- [ ] 7.3 `pnpm -r build` 0 错误
- [ ] 7.4 真实跑: 创建 worktree "test-task", 在内改 README, merge 回 main, 验证

## 风险与备选

- **风险 1**: Windows 符号链接复杂 → 备选: 用 junction(mklink 软链)
- **风险 2**: PowerShell TRAE sandbox 禁 git worktree → 备选: 提示用户在真实仓库运行
- **风险 3**: 共享 node_modules 改动冲突 → 备选: 只符号链接, 不互改; 重建走主 repo
- **风险 4**: 跨 worktree 改同一文件 merge 冲突 → 备选: 给用户冲突报告, 不自动解决

## 不做(明确)

- ❌ GUI 可视化(CLI + API)
- ❌ 远端 worktree
- ❌ 嵌套 worktree
- ❌ 跨 worktree 通信
- ❌ 完整 IDE 集成(vscode workspace 多开)

## 与 PowerShell sandbox 冲突的说明

之前探索发现 PowerShell sandbox 禁 `git worktree add`(EPERM)。本功能应:
- 在**真实仓库** (用户本机或 CI) 才能跑
- 在 sandbox 环境下, 跑测试用 `os.tmpdir()` + `git init` 隔离
- UI 显状态: "Worktree requires dev mode, enable in Settings"

## 完成定义

- 用户能 CLI 跑 `agentai worktree create <name>`
- 任务执行在 worktree 内, 不污染主分支
- 完成后 `agentai worktree merge <id>` 一键合回
- Windows 10/11 + 开发者模式: 100% 可用
- macOS/Linux: 100% 可用
- Windows sandbox: 显"需开发者模式"提示
