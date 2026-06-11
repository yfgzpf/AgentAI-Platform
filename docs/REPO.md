# AgentAI-Platform 仓库信息

> **单一可信源** — 仓库地址、协议、CI/CD、热更新等基础设施都登记在这里。
> 任何 AI / 脚本误操作前必须先读本文件, 避免重复之前丢失文件的错误。

---

## 1. 仓库地址 (最终, 不会改)

| 平台 | URL | 备注 |
|------|-----|------|
| **GitHub (主)** | `https://github.com/yfgzpf/AgentAI-Platform.git` | **唯一**官方仓库 |
| 镜像 | (无) | 暂不设镜像, 避免混淆 |

### 远程配置命令 (初始化)

```bash
# 在项目根目录 F:\agentai-platform 执行
git remote add origin https://github.com/yfgzpf/AgentAI-Platform.git
git branch -M main
```

> ⚠️ **不要** `git push` 任何分支到 origin, 除非用户明确说「推」。
> 之前的会话中, 另一个 AI 误把工作树和分支清理了, 造成 45+ 文件丢失。
> 恢复方式是 `git checkout HEAD -- <path>`, 详见 §6。

---

## 2. 协议

| 项 | 值 |
|----|---|
| **协议名** | **Apache License 2.0 (ALP)** |
| 协议全文 | 见 [`LICENSE`](file:///f:/agentai-platform/LICENSE) (已存在, 内容为 Apache 2.0 标准文本) |
| Copyright header | 暂未强制, 后续可批量加 `Copyright 2026 yfgzpf` |

---

## 3. 仓库结构 (实操手册)

```
F:\agentai-platform\
├── packages/
│   ├── agentai-core/        # 智能体核心 (LLM 路由/技能/记忆)
│   ├── agentai-gateway/     # Node.js 网关 (WebSocket/HTTP, :18789)
│   ├── agentai-gui/         # React 前端 (React 18 + TS + Vite)
│   ├── agentai-desktop/     # Tauri 桌面端 (Rust, 安装包 5-10MB)
│   ├── agentai-qqbot/       # QQ 机器人 (oicq)
│   ├── agentai-skills/      # 37 个 Python 技能
│   └── agentai-vscode/      # VSCode 扩展 (vsce)
├── docs/                    # 文档 (含 superpowers/specs/plans)
├── scripts/                 # 一次性脚本
├── .github/workflows/       # CI/CD (含 release-desktop.yml)
├── LICENSE                  # Apache 2.0
└── README.md                # 入口
```

### 受保护目录 (不要动)

- `packages/agentai-core/**`     — 上次丢过, 已 `git checkout HEAD --` 恢复
- `packages/agentai-gui/**`      — 同上
- `packages/agentai-skills/**`   — 同上
- `packages/agentai-desktop/**`  — 同上
- `.env`                         — 密钥, 已在 `.gitignore`

---

## 4. 基础设施目标 (用户最新需求)

> "我们要实现开源的**热更新**及仓库**自动构建桌面端**及相关的"

### 4.1 热更新 (Hot Update)

- **目标**: 用户启动桌面端后, 自动检测 gateway / GUI / core 有新版本, 拉取并热加载, 无需重装
- **架构**:
  - **gateway** (Node.js): 用 `pm2` 或自写 watcher 检测新 commit, 重启进程; 或用 Node.js `--require` 钩子做模块热替换
  - **GUI** (React + Vite): 开发模式 HMR 已有; 生产模式用动态 `import()` + 版本号轮询, 命中新版就提示刷新
  - **core** (TypeScript lib): 发布到 npm 或本地 `file:` 协议, gateway 启动时 `require.resolve` 最新版本
  - **skills** (Python): watcher 已存在 (`registry.startWatcher`), 热重载 OK
- **触发源**:
  - 监听 `origin/main` 的新 commit (每分钟 1 次, 轻量)
  - 或 WebSocket 推送 (GitHub webhook → 简单 HTTP 服务 → 推送给已连客户端)
- **回滚**: 任何一步失败, 自动 `git checkout HEAD~1` 并重启

### 4.2 自动构建桌面端 (CI/CD)

- **平台**: GitHub Actions (`.github/workflows/release-desktop.yml` 已存在骨架)
- **构建产物**:
  - Windows: `.msi` (Tauri MSI) + `.exe` (NSIS)
  - macOS: `.dmg` (Universal: x86_64 + arm64)
  - Linux: `.deb` + `.AppImage`
- **触发**:
  - `push` 到 `main` → 跑构建但不发布 (dev artifact, 7 天过期)
  - `tag` 形如 `v0.2.0` → 跑构建 + 发 GitHub Release + 签名
- **签名**:
  - Windows: 暂用未签名 (Tauri 后续支持 `tauri sign`)
  - macOS: 需要 Apple Developer ID (用户自行配置 secrets)
  - 密钥: `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 存 GitHub Secrets
- **发布通道**:
  - `latest`: 稳定版 (tag 发布)
  - `nightly`: 每日构建 (cron: `0 2 * * *`)

### 4.3 关联设施

- **版本号**: 统一从 `package.json` 的 `version` 字段读取, 用 `standard-version` 或 `release-please` 自动 bump
- **CHANGELOG**: 已有 `CHANGELOG.md`, 用 `standard-version` 自动生成
- **更新源**: 桌面端启动时拉取 `https://api.github.com/repos/yfgzpf/AgentAI-Platform/releases/latest` 拿到最新 tag 和下载链接

---

## 5. 紧急恢复指南 (上次事故复盘)

> 上次另一个 AI 误把工作树 `git worktree remove` 失败后 `Remove-Item` 强删, 连带删了主分支未提交文件。

### 5.1 现象

- `git status` 显示大量 `??` (新文件丢失) 或文件被改
- 工作树被强删

### 5.2 恢复步骤

```bash
# 1. 检出版本库里有的文件
git ls-files | wc -l    # 应 ≥ 45 (核心包)

# 2. 如果文件在工作树丢失, 从 HEAD 恢复
git checkout HEAD -- packages/agentai-core
git checkout HEAD -- packages/agentai-gui
git checkout HEAD -- packages/agentai-skills
git checkout HEAD -- packages/agentai-desktop

# 3. 验证
git status --short
```

### 5.3 防御

- 永远 **不要** `git worktree remove --force` 除非用户明确说
- 永远 **不要** `git reset --hard` 除非用户明确说
- 永远 **不要** `rm -rf` 任何工作树目录
- 任何破坏性命令前先 `git status` 看影响面

---

## 6. 协议相关的源信息

- 项目名: **AgentAI Platform**
- Owner: **yfgzpf** (GitHub 用户名)
- 主分支: `main` (已规划, 旧 `master` 需 `git branch -M main` 转换)
- 协议: **Apache License 2.0**
- 用途: 智能体平台, 桌面/QQ/VSCode/Web 四端统一
- 已知仓库地址: `https://github.com/yfgzpf/AgentAI-Platform.git` (**永久**)

---

## 7. 操作日志

| 日期 | 操作 | 执行者 |
|------|------|--------|
| 2026-06-11 | 创建本文件, 记录最终仓库 URL | Trae IDE |
| 2026-06-11 | git remote add origin (待执行) | Trae IDE |
| 待定 | 推送 main 分支 (用户授权后) | Trae IDE |
