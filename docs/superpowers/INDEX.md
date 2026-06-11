# AgentAI Platform — Spec/Plan INDEX

> 集中索引所有 spec 与 plan 文件, 真实仓库上传后可逐个执行

**最后更新**: 2026-06-12
**状态**: 6 specs + 6 plans 已落地

---

## 目录

### 已完成 (HEAD 已实现, 仅供查阅)
- `specs/2026-06-10-cleaner-design.md` — Cleaner 360 风格设计 spec
- `plans/2026-06-10-cleaner.md` — CleanerDaemon 7 模块 + 29 测试
- `specs/2026-06-11-cleaner-api-routes.md` — Cleaner 5 端点 spec
- `plans/2026-06-11-cleaner-api-routes.md` — Cleaner 路由实施 plan
- `specs/2026-06-11-cleaner-schedule-display.md` — 状态卡 spec
- `plans/2026-06-11-cleaner-schedule-display.md` — 状态卡实施 plan

### 待办 (本轮新写, 真实仓库上传后执行)
| Spec | Plan | 估时 | 优先级 | 关键能力 |
|---|---|---|---|---|
| [mcp-ga](specs/2026-06-12-mcp-ga.md) | [mcp-ga](plans/2026-06-12-mcp-ga.md) | 3 天 | 🟡 P1 | MCP 5 server + OAuth 2.1 + 工具桥接 |
| [treemap-viz](specs/2026-06-12-treemap-viz.md) | [treemap-viz](plans/2026-06-12-treemap-viz.md) | 1.5 天 | 🟡 P1 | SpaceSniffer 风格磁盘可视化 |
| [sandbox-rules](specs/2026-06-12-sandbox-rules.md) | [sandbox-rules](plans/2026-06-12-sandbox-rules.md) | 2 天 | 🔴 P0 | 用户配 sandbox, 保护系统代码 |
| [worktree-soft](specs/2026-06-12-worktree-soft.md) | [worktree-soft](plans/2026-06-12-worktree-soft.md) | 2 天 | 🟢 P2 | git worktree 隔离任务 + 共享 node_modules |

---

## 全系统审查 + 行业对标摘要 (2026-06-12)

### 行业现状 (2025-2026)

**Trae 2.0 / SOLO Agent (字节)**
- ✅ 移除固定 Plan 阶段 → 改 "动态 thinking tools"
- ✅ MCP GA + OAuth 2.1 (2025-04)
- ✅ Worktree 隔离 (2025-05)
- ✅ Slash Commands 3 级目录嵌套
- ✅ Skills + Rules + Commands 三层管理
- ✅ Voice + Mobile + 跨平台

**VS Code 1.102-1.106**
- ✅ `vscode-copilot-chat` 完全开源 (MIT, 2025-06)
- ✅ MCP GA (1.102)
- ✅ Plan Agent 独立模式 (1.106, 2025-10)
- ✅ Custom Modes (planning/research)
- ✅ 自动批准指定 terminal 命令

**MCP 跨厂商标准**
- 支持: GitHub Copilot, Cursor, Cline, Windsurf(OpenAI 收购), Sourcegraph, Amazon Q, Augment

**TypeScript AI Agent 框架**
- VoltAgent — zero-config 记忆 + LibSQL 持久化
- LangGraph TS (42k weekly) — StateGraph + checkpoint
- ElizaOS (16.9k stars) — Plugin 4 角色 (Actions/Providers/Evaluators/Services)
- Deep Agent SDK — 2-tier 记忆 (user/project level)

**360 风格清理器**
- WizTree — NTFS MFT 扫描 (极快)
- SpaceSniffer — Treemap 可视化 (开源)
- TreeSize Free — 列表+删除
- CCleaner — 隐私+注册表+启动项

### 我们当前能力

- ✅ Gateway 731 行 (framework switcher + LLM router + Chain 编排 + CleanerDaemon 7 模块)
- ✅ VSCode 扩展 (状态栏 + 2 命令 + WebView)
- ✅ QQ Bot (go-cqhttp + 官方 bot)
- ✅ Cleaner 360 风格 (scanner/planner/executor/alerts/scheduler/state/rules 全套)
- ⚠️ agentai-core stub (26 行)
- ⚠️ GUI 11 组件已实装 (Chat/CleanerPanel/Editor/FrameworkSwitch/ImageGen/Markdown/ModelSelector/Onboarding/QQBotPanel/Settings/SkillLibrary/VideoGen)
- ⚠️ agentai-skills 容器未完
- ⚠️ agentai-desktop Tauri 壳源码未完

### 优化路线图 (12 周)

| 周 | 主题 | 交付物 |
|---|---|---|
| W1-2 | **Sandbox Rules** (P0) | 5 文件 + 集成 cleaner/tools + GUI 编辑器 |
| W3-4 | **MCP GA** (P1) | 11 文件 + 5 server 模板 + OAuth + GUI |
| W5 | **Treemap 可视化** (P1) | 7 文件 + 后端 builder + 前端组件 |
| W6 | **Custom Modes** (P1) | IDE 入口 + quick/plan/full 3 模式 |
| W7-8 | **Plugin 4 角色** (ElizaOS 模型) | Actions/Providers/Evaluators/Services 推广 |
| W9-10 | **Worktree 软实现** (P2) | 9 文件 + 平台分支 + 文档 |
| W11 | **PGLite WASM** | 浏览器端 SQL, 离线工作 |
| W12 | **Slash Commands 嵌套** | 3 级 .trae/commands/ |

---

## 执行顺序 (建议)

1. **立即** — Sandbox Rules (P0, 用户安全最关键)
2. **下周** — MCP GA (P1, 2026 生态入场券)
3. **下下周** — Treemap 可视化 (P1, UX 跃升)
4. **下月** — Custom Modes (P1, IDE 入口)
5. **远期** — Worktree / Plugin / PGLite (P2)

每项执行前, 重新读 spec, 确认无变化, 再读 plan, 跑 task-by-task。
