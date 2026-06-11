<p align="center">
  <img src="./assets/icon-zodiac.svg" alt="AgentAI Platform" width="120">
</p>

<h1 align="center">AgentAI Platform</h1>

<p align="center">
  <strong>完全免费 · 41 工具 · 5 技能 · 自进化记忆 · 多模态 · 多智能体</strong><br>
  <em>v0.2.0-alpha — 2026-06-10</em>
</p>

---

## 🎯 项目简介

AgentAI Platform 是一个**完全免费**、**本地优先**的智能体平台。融合 Reasonix、Hermes、ZhiY.AI、Cursor-MCP 四大框架精华，提供 41 个内置工具 + Python Bridge 无限技能扩展 + 3层自进化记忆系统。

### 核心差异化

| 对比 | ChatGPT | Copilot | Cursor | **AgentAI** |
|------|---------|---------|--------|-------------|
| 模型 | 付费 | 付费 | 付费 | **免费 (agentai + deepseek 择优)** |
| 工具数 | ~10 | ~5 | ~10 | **41 + 无限 Python 技能** |
| 记忆 | 手动 | 无 | 会话内 | **3 层自进化记忆** |
| 多模态 | ✅ | ❌ | ❌ | **图片/视频/文档/微信** |
| 跨渠道 | Web | IDE | IDE | **Web/QQ/VSCode/桌面/微信** |
| 自学习 | ❌ | ❌ | ❌ | **✅ evolution.jsonl** |
| 安全 | 云端 | 云端 | 云端 | **本地沙箱 + bash 白名单** |

---

## 📊 系统状态 (2026-06-10)

| 指标 | 数值 |
|------|------|
| **内置工具** | 36 |
| **Python 自动发现** | 5 (image-gen, doc-generator, browser-auto, wechat-bot, lottery-ai) |
| **总计** | **41** |
| **测试** | 67/67 ✅ |
| **API 端点** | 全通 ✅ |
| **安全加固** | bash 白名单 + 路径沙箱 + SSRF + 命令注入防 |

---

## 🚀 快速开始

```bash
git clone <repo-url>
cd agentai-platform
pnpm install
pnpm start
```

打开 `http://localhost:5173`

## 🛠️ 工具清单 (41)

### 文件操作 (10)
`read_file` `write_file` `edit_file` `list_directory` `search_files` `search_content` `glob` `directory_tree` `get_file_info` `delete_file`

### 编辑 (3)
`multi_edit` `create_directory`

### 复制移动 (2)
`copy_file` `move_file`

### 进程管理 (6)
`bash` `run_background` `job_output` `wait_for_job` `stop_job` `list_jobs`

### 网络 (2)
`web_search` `web_fetch`

### 代码智能 (2)
`get_symbols` `find_in_code`

### 媒体生成 (3)
`generate_image` `generate_video` `query_video`

### 记忆 (3)
`remember` `recall_memory` `forget`

### 规划与交互 (4)
`submit_plan` `todo_write` `ask_choice` `ask_user`

### 技能管理 (1)
`discover_or_create_skill`

### Python 自动发现 (5)
`image-gen` `doc-generator` `browser-auto` `wechat-bot` `lottery-ai`

---

## 🧠 自进化记忆系统

```
第 1 层: volatileScratch (当前轮)
第 2 层: JSONL 文件 (跨会话)
第 3 层: evolution.jsonl (跨项目, 自动学习)
```

每次对话结束后自动记录成功策略和失败教训，下次启动时系统提示自动注入进化数据。

## 🔒 安全架构

| 防护 | 实现 |
|------|------|
| bash 白名单 | 15 个安全命令 + 危险模式拦截 |
| 路径沙箱 | read/write/edit file 全部限制在 workspace 内 |
| SSRF 防护 | web_fetch 禁止内网/localhost |
| 命令注入 | search_content/glob 用 fs API 替代 shell |
| API Key | .env + .gitignore, 不提交 |

## 📁 项目结构

```
agentai-platform/
├── packages/
│   ├── agentai-gateway/     # 后端 (41 工具 + Python Bridge)
│   ├── agentai-gui/         # 前端 (Vite + React)
│   ├── agentai-core/        # 核心库
│   ├── agentai-skills/      # Python 技能 (5)
│   │   ├── image-gen/
│   │   ├── office/doc-generator/
│   │   ├── web/browser-auto/
│   │   ├── wechat-bot/
│   │   └── finance/lottery-ai/
│   ├── agentai-qqbot/       # QQ 机器人
│   └── agentai-desktop/     # Tauri 桌面
├── assets/                  # 图标
├── docs/                    # 文档
└── references/              # 参考源码
```

---

<p align="center">
  <sub>Built with ❤️ | AgentAI Platform v0.2.0-alpha</sub>
</p>
