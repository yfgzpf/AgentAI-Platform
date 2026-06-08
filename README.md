<p align="center">
  <img src="./assets/logo-256.png" alt="AgentAI Platform" width="200">
</p>

<h1 align="center">AgentAI Platform</h1>

<p align="center">
  <strong>完全免费的智能体框架平台 · 内置生图生视频多模态能力</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#架构">架构</a> ·
  <a href="#文档">文档</a> ·
  <a href="#贡献">贡献</a>
</p>

<p align="center">
  <a href="https://github.com/agentai-platform/agentai-platform/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node">
  </a>
  <a href="https://tauri.app/">
    <img src="https://img.shields.io/badge/tauri-2.0-blue" alt="Tauri">
  </a>
  <a href="https://www.python.org/">
    <img src="https://img.shields.io/badge/python-3.13+-blue" alt="Python">
  </a>
</p>

---

## ✨ 功能特性

- 🖥️ **极小桌面端** — Tauri 2.0 (Rust) 打包，安装包 **5-10MB** (vs Electron 150MB+)
- 🤖 **多模态内置** — Agnes Image 2.1 / Video / 字节 Seedance 2.0 / 即梦
- 💬 **4 渠道接入** — Web 桌面 / QQ 机器人 / VSCode 扩展 / Telegram
- 🧠 **智能 LLM 路由** — AgentAI ↔ DeepSeek 智能切换 + 熔断 + 成本控制
- 🛠️ **37 个开箱技能** — 办公/网页/视频/图像/代码/元技能 (从 ZhiY.AI 迁移)
- 🔒 **零硬编码** — 所有 API Key 由用户填入，AES-256-GCM 加密存储
- 📚 **三段式教程** — 5 分钟跑通 / 15 分钟接多模态 / 30 分钟接 QQ+VSCode
- 🎨 **完整品牌** — Logo 3 套方案 + 智能蓝 #4F46E5 主色

## 🚀 快速开始

```bash
# 1. 克隆
git clone https://github.com/agentai-platform/agentai-platform.git
cd agentai-platform

# 2. 安装依赖
pnpm install

# 3. 首次启动 (启动 GUI 向导)
pnpm dev

# 4. 跟着 5 步向导填入 API Key, 完成
```

完整教程见 [docs/TUTORIAL.md](./docs/TUTORIAL.md)。

## 🏗️ 架构

```
Tauri Desktop (Rust) ── 5-10MB
        │
        ▼ localhost:18789
Node.js Gateway (80MB 进程) ── 智能体调度 + 4 渠道
        │
        ▼
Python 技能 (Docker 沙箱) ── 37 个多模态
```

详细架构见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)（阶段 2 落地）。

## 📚 文档

| 文档 | 说明 |
|------|------|
| [PROJECT_SPEC.md](./PROJECT_SPEC.md) | 13 章节项目规范 v1.2 |
| [docs/TUTORIAL.md](./docs/TUTORIAL.md) | 5/15/30 分钟教程 |
| [docs/KEYS_MANAGEMENT.md](./docs/KEYS_MANAGEMENT.md) | 密钥管理与加密 |
| [docs/GIT_GUIDELINES.md](./docs/GIT_GUIDELINES.md) | Git 工作流规范 |
| [docs/BRAND_GUIDELINES.md](./docs/BRAND_GUIDELINES.md) | 品牌设计规范 |

## 🎯 开发计划 (21 天 / 5 阶段)

1. **基础脚手架** (3 天) — Tauri + Node Gateway 跑通
2. **智能体核心** (4 天) — LLM 路由 + 技能 + 记忆
3. **多模态技能** (5 天) — 37 skill 迁移 + Agnes 多模态
4. **桌面端 + QQ** (4 天) — Tauri 完整 + oicq
5. **VSCode 集成** (3 天) — vsce 扩展
6. **测试 + 文档** (2 天) — 全渠道验收

## 🤝 贡献

PR / Issue 欢迎，详见 [docs/GIT_GUIDELINES.md](./docs/GIT_GUIDELINES.md)。

## 📄 License

MIT © 2026 AgentAI Builder
