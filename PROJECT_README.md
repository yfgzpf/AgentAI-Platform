# AgentAI Platform — 项目说明

> **完全免费的智能体框架平台 · 内置生图生视频多模态能力**
> 桌面端 (Tauri) + QQ 机器人 + VSCode 扩展 四渠道统一接入

---

## 📦 项目结构

```
agentai-platform/
├── packages/
│   ├── agentai-core/        # 智能体核心 (LLM 路由/技能管理/记忆系统)
│   ├── agentai-gateway/     # Node.js 网关 (WebSocket/HTTP, 端口 18789)
│   ├── agentai-gui/         # React 前端界面 (React 18 + TS + Vite)
│   ├── agentai-desktop/     # Tauri 桌面壳 (Rust, 安装包 5-10MB)
│   ├── agentai-qqbot/       # QQ 机器人 (oicq 协议)
│   ├── agentai-skills/      # 37 个 Python 技能 (Docker 沙箱)
│   └── agentai-vscode/      # VSCode 扩展 (vsce)
├── docs/                    # 文档目录
├── scripts/                 # 工具脚本
├── assets/                  # 静态资源 (Logo 等)
├── .agentai/                # 运行时配置目录
├── package.json             # 根包配置 (pnpm workspace)
├── PROJECT_SPEC.md          # 完整项目规范 (13 章节)
├── PROJECT_README.md        # 本文件 — 项目说明
└── README.md                # 对外 README
```

## 🚀 快速启动

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发环境 (Gateway + GUI)
pnpm dev

# 3. 启动桌面端 (需要 Rust 环境)
pnpm dev:desktop
```

## 🏗️ 三层架构

```
┌─ 用户入口层 ─────────────────────────────┐
│  Web GUI  │  Tauri Desktop  │  QQ Bot  │  VSCode  │
└───────────┴────────┬────────┴──────────┴──────────┘
                     │ localhost:18789
┌────────────────────▼────────────────────────────────┐
│  Node.js Gateway — 消息路由 / 会话管理 / 智能体调度   │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Python 技能 (Docker 沙箱) — 37 个多模态技能          │
│  生图 / 生视频 / 办公 / 网页 / 代码 / 语音 ...        │
└─────────────────────────────────────────────────────┘
```

## 🧠 核心技术

| 模块 | 技术栈 | 说明 |
|------|--------|------|
| 桌面壳 | **Tauri 2.0** (Rust) | 安装包 5-10MB, 系统 WebView |
| 前端 | **React 18 + TS + Vite + Ant Design 5** | 响应式 GUI |
| 网关 | **Node.js 22 + Socket.io** | WebSocket 实时通信 |
| LLM 路由 | **AgentAI ↔ DeepSeek** 智能切换 + 熔断 | 统一 LLMService 接口 |
| 技能 | **Python 3.13** (Docker 沙箱) | 37 个技能热加载 |
| QQ 机器人 | **oicq** (Node.js) | 私聊/群聊事件驱动 |
| VSCode | **vsce** 扩展 | 选中代码调智能体 |
| 存储 | **SQLite + Redis** | 本地加密存储 |

## 📋 开发阶段 (21 天 / 5 阶段)

| 阶段 | 内容 | 天数 |
|------|------|------|
| 1 — 基础脚手架 | Tauri + Gateway 跑通 | 3 天 |
| 2 — 智能体核心 | LLM 路由 + 技能 + 记忆 | 4 天 |
| 3 — 多模态技能 | 37 skill 迁移 + 生图生视频 | 5 天 |
| 4 — 桌面端 + QQ | Tauri 完整 + oicq | 4 天 |
| 5 — VSCode 集成 | vsce 扩展 | 3 天 |
| 6 — 测试 + 文档 | 全渠道验收 | 2 天 |

## 📚 文档索引

| 文档 | 说明 |
|------|------|
| [PROJECT_SPEC.md](./PROJECT_SPEC.md) | 完整项目规范 (13 章节) |
| [docs/TUTORIAL.md](./docs/TUTORIAL.md) | 5/15/30 分钟教程 |
| [docs/KEYS_MANAGEMENT.md](./docs/KEYS_MANAGEMENT.md) | 密钥管理与加密 |
| [docs/GIT_GUIDELINES.md](./docs/GIT_GUIDELINES.md) | Git 工作流规范 |
| [docs/BRAND_GUIDELINES.md](./docs/BRAND_GUIDELINES.md) | 品牌设计规范 |
| [docs/CODING_GUIDELINES.md](./docs/CODING_GUIDELINES.md) | 编码规范 |
| [docs/FULL_DEV_PLAN.md](./docs/FULL_DEV_PLAN.md) | 完整开发计划 |
| [docs/INTEGRATION_ARCHITECTURE.md](./docs/INTEGRATION_ARCHITECTURE.md) | 集成架构 |
| [docs/VSCODE_INTEGRATION.md](./docs/VSCODE_INTEGRATION.md) | VSCode 集成说明 |

## 🔒 安全要点

- 所有 API Key 由用户填入, AES-256-GCM 加密存储
- 技能运行在 Docker 沙箱 (内存 512M / CPU 1 核)
- LLM 调用有成本熔断 (`maxCostPerRun=0.05 USD`)
- Provider 连续失败自动切换备用

## 📄 License

MIT © 2026 AgentAI Builder
