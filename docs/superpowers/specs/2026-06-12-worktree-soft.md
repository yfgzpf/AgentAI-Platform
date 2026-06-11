# Spec: Worktree 软实现 (Git Worktree 隔离任务)

**日期**: 2026-06-12
**作者**: AgentAI Builder
**关联 plan**: `docs/superpowers/plans/2026-06-12-worktree-soft.md`
**前置依赖**:
- 之前探索时发现 PowerShell sandbox 禁 `git worktree add`(已记录)
- Trae 2025-05 已发布 Worktree 隔离功能
- 用户未要求过 worktree(但属于能力跃升)

---

## 1. 目标

为 agentai 用户提供"任务隔离"开发环境:
- 每个 task(自动 plan→solve→verify→fix→report 的 Chain 任务)开 1 个 git worktree
- worktree 之间共享 `node_modules`(符号链接), 节省空间
- 主分支不动, 任务互不污染
- 完成后可一键 merge 回主分支

**用户场景**:
- 用户: "重构 cleaner 模块"
- 系统: 在 .worktrees/cleaner-refactor/ 起 worktree
- 所有 LLM 操作在该 worktree 内
- 完成后 diff 给用户, 用户点头 merge

## 2. 非目标

- ❌ 嵌套 worktree(只一层)
- ❌ 跨 worktree 通信(只 git fetch/pull)
- ❌ 远端同步(worktree 操作仅本地)
- ❌ GUI 可视化(CLI + API 即可, GUI 留 v2)

## 3. 架构

```
~/agentai/
├── .worktrees/                   (git worktree base)
│   ├── cleaner-refactor/        (worktree 1, 独立 branch)
│   ├── mcp-ga/                  (worktree 2)
│   └── ...
├── agentai-gateway/             (主 repo)
│   └── packages/
│       └── agentai-gateway/
│           └── node_modules/     (被符号链接共享)
└── .agentai/
    └── worktrees.json            (worktree 状态文件)
```

## 4. 数据模型

```typescript
// packages/agentai-gateway/src/worktree/types.ts
export interface WorktreeInfo {
    id: string;                  // UUID
    name: string;                // "cleaner-refactor"
    path: string;                // "/path/to/.worktrees/cleaner-refactor"
    branch: string;              // "task/cleaner-refactor"
    baseBranch: string;          // "main"
    status: 'active' | 'paused' | 'merged' | 'abandoned';
    createdAt: number;
    updatedAt: number;
    sharedModules: string[];     // 符号链接的 node_modules 路径
    metadata?: Record<string, any>;
}
```

## 5. 文件改动

| 文件 | 类型 | 职责 |
|---|---|---|
| `worktree/types.ts` | **新建** | WorktreeInfo / CreateRequest |
| `worktree/manager.ts` | **新建** | WorktreeManager 单例, 调 git worktree add/remove |
| `worktree/symlink.ts` | **新建** | 共享 node_modules 符号链接(Windows 需 admin 或开发者模式) |
| `worktree/index.ts` | **新建** | 启停 + 状态持久化 |
| `worktree/router.ts` | **新建** | POST /create / GET /list / POST /:id/merge / DELETE /:id |
| `chain-store.ts` | **修改** | chain 任务可指定 worktreeId, 自动切 cwd |
| `tools.ts` | **修改** | `read_file`/`write_file`/`bash` 加 worktree cwd 解析 |
| `index.ts` | **修改** | 挂路由 + 启 WorktreeManager |

## 6. 关键命令

```bash
# 创建
git worktree add -b task/cleaner-refactor ../.worktrees/cleaner-refactor main
# 符号链接 node_modules
ln -s ../../agentai-gateway/packages/agentai-gateway/node_modules ../.worktrees/cleaner-refactor/packages/agentai-gateway/node_modules

# 列出
git worktree list

# 移除
git worktree remove --force .worktrees/cleaner-refactor
git branch -D task/cleaner-refactor
```

## 7. 平台兼容

| 平台 | symlink | 备选 |
|---|---|---|
| Linux | ✅ 原生 | - |
| macOS | ✅ 原生 | - |
| Windows 开发者模式 | ✅ 原生 | - |
| Windows 关闭 | ❌ EPERM | 用 `mklink /D` cmd 命令 |
| Windows sandbox | ❌ EPERM | 提示用户手动 |

## 8. 测试

- 单元: WorktreeInfo JSON 序列化
- 单元: worktree 路径解析(Win/Linux)
- 集成: 真建 worktree + 改文件 + merge + 清理
- 边界: 主分支保护(不能在 main 上建 worktree)

## 9. 性能

- 符号链接 node_modules 节省 ~500MB/任务
- 任务完成清理 worktree(30 天未活动自动删)
- `.worktrees/` 加 `.gitignore` 防误提交
