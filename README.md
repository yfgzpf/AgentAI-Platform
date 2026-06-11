<p align="center">
  <img src="./assets/icon-zodiac.svg" alt="AgentAI Platform" width="120">
</p>

<h1 align="center">AgentAI Platform</h1>

<p align="center">
  <strong>开源 · 本地优先 · 41 工具 · Python 技能无限扩展 · 自进化记忆</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
  <a href="#"><img src="https://img.shields.io/badge/version-0.2.0--alpha-orange" alt="Version"></a>
  <a href="#"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome"></a>
</p>

<p align="center">
  <sub>Web GUI · Tauri 桌面端 · QQ 机器人 · VSCode 扩展 — 四渠道统一接入</sub>
</p>

---

> **你的第二大脑。** AgentAI Platform 是一个完全免费、本地优先的智能体框架。
> 内置 41 个工具，Python 技能无限扩展，三层自进化记忆，
> 跑在你自己机器上，数据不出门。

---

## 为什么选择 AgentAI？

| | ChatGPT | Copilot | Cursor | **AgentAI** |
|---|---------|---------|--------|-------------|
| **价格** | 付费订阅 | 付费订阅 | 付费订阅 | **完全免费** |
| **工具数量** | ~10 | ~5 | ~10 | **41 + 无限 Python 技能** |
| **记忆系统** | 手动管理 | 无 | 会话内 | **3 层自进化记忆 (跨会话/跨项目)** |
| **多模态** | 部分 | 不支持 | 不支持 | **生图/生视频/文档/语音** |
| **渠道覆盖** | Web | IDE | IDE | **Web + 桌面 + QQ + VSCode** |
| **数据隐私** | 云端 | 云端 | 云端 | **本地运行, 数据不出门** |
| **可扩展性** | 有限 | 有限 | 有限 | **Python 沙箱, 任意技能热加载** |
| **开源** | 否 | 否 | 否 | **Apache 2.0** |

---

## 系统架构

```
  Web GUI ──┐                 ┌── 内置工具 (41)
  Tauri ────┤   localhost     │   read/write/edit/search/glob
  QQ Bot ───┼── :18789 ──► Gateway ──► bash/web_fetch/generate_image
  VSCode ───┘   (WS/HTTP)     │   todo/remember/task_chain/mcp
                              └── Python 技能 (37+)
                                  生图 · 生视频 · 文档 · 爬虫
                                  自动化 · 语音 · 代码 · 微信
```

**三层记忆**: 会话缓存 → JSONL 跨会话 → evolution.jsonl 跨项目自学习

**双引擎 LLM**: AgentAI + DeepSeek 智能路由, 失败自动熔断切换

---

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/yfgzpf/AgentAI-Platform.git
cd AgentAI-Platform

# 安装依赖 (推荐 pnpm)
pnpm install

# 一键启动 (Gateway + GUI)
pnpm dev

# 打开浏览器
# http://localhost:5173
```

### 启动桌面端

```bash
# 需要 Rust 环境 (rustup)
pnpm dev:desktop
```

### 启动 QQ 机器人

```bash
pnpm dev:qqbot
```

---

## 内置工具清单

### 文件操作 (12)
`read_file` `write_file` `edit_file` `multi_edit` `delete_file` `copy_file` `move_file`
`list_directory` `directory_tree` `search_files` `search_content` `glob`

### 系统交互 (7)
`bash` `run_background` `job_output` `wait_for_job` `stop_job` `list_jobs` `get_file_info`

### 网络与搜索 (2)
`web_search` `web_fetch`

### 媒体生成 (3)
`generate_image` `generate_video` `query_video`

### 智能体核心 (8)
`submit_plan` `todo_write` `ask_choice` `ask_user` `remember` `recall_memory` `forget` `discover_or_create_skill`

### Python 自动发现
`image-gen` `doc-generator` `browser-auto` `wechat-bot` `lottery-ai` ... (持续增长)

---

## 核心特性

### 自进化记忆
```
Layer 1: volatileScratch  → 当前轮对话缓存
Layer 2: JSONL 文件       → 跨会话持久化
Layer 3: evolution.jsonl  → 跨项目自动学习, 越用越聪明
```

### 技能热加载
写一个 Python 文件放到 `skills/` 目录, AgentAI 自动发现、自动加载。
无需重启, 无需配置, `chokidar` 实时监听。

### 沙箱安全
文件操作受 **Sandbox Rules** 保护：ALLOW / DENY / PROMPT 三级控制,
支持 glob 模式匹配, 用户可在 GUI 中可视化配置。

### 磁盘清理 (360 风格)
智能扫描 + 文件分类 + 安全清理 + 可视化 Treemap,
支持 gzip/git-annex/LLM 归档多种策略。

---

## 技术栈

| 层 | 技术 |
|----|------|
| **桌面壳** | Tauri 2.0 (Rust), 安装包 5-10MB |
| **前端** | React 18 + TypeScript + Vite + Ant Design 5 |
| **网关** | Node.js 22 + Socket.io + Koa |
| **LLM** | AgentAI API + DeepSeek 双引擎智能路由 |
| **技能** | Python 3.13 (Docker 沙箱) |
| **QQ 机器人** | oicq (Node.js 原生协议) |
| **VSCode** | vsce 扩展 |
| **存储** | SQLite + Redis |

---

## 项目结构

```
agentai-platform/
├── packages/
│   ├── agentai-core/        # 智能体核心 (LLM 路由/技能/记忆)
│   ├── agentai-gateway/     # Node.js 网关 (端口 18789)
│   ├── agentai-gui/         # React 前端
│   ├── agentai-desktop/     # Tauri 桌面端
│   ├── agentai-qqbot/       # QQ 机器人
│   ├── agentai-skills/      # Python 技能集合
│   └── agentai-vscode/      # VSCode 扩展
├── docs/                    # 完整文档
├── scripts/                 # 工具脚本
└── assets/                  # Logo 等静态资源
```

---

## 路线图

- [x] 智能体核心 (LLM 路由 + 技能管理 + 记忆系统)
- [x] 41 工具 + Python 技能自动发现
- [x] Web GUI (React + TypeScript)
- [x] 沙箱规则 (Sandbox Rules)
- [x] 磁盘清理工具 (360 风格 + Treemap)
- [x] MCP 多智能体通信协议
- [ ] Tauri 桌面端 (Windows/macOS/Linux)
- [ ] QQ 机器人适配
- [ ] VSCode 扩展
- [ ] 热更新系统
- [ ] CI/CD 自动构建三平台桌面端
- [ ] 模型市场 (插件式 LLM Provider)

---

## 贡献

欢迎 PR！请先阅读 [编码规范](./docs/CODING_GUIDELINES.md)。

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feat/amazing-thing`)
3. 提交更改 (`git commit -m 'feat: add amazing thing'`)
4. 推送到分支 (`git push origin feat/amazing-thing`)
5. 创建 Pull Request

---

## 协议

[Apache License 2.0](./LICENSE) — 自由使用、修改、分发。

---

<p align="center">
  <sub>Made with ❤️ by <a href="https://github.com/yfgzpf">yfgzpf</a></sub>
</p>
