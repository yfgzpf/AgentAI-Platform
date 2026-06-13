# AgentAI Platform — 项目规范 v2.0（完整重建）

> 项目代号: **AgentAI Platform**
> 最后更新: 2026-06-xx
> 状态: 生产中

---

## 核心架构

```
┌─────────────────────────────────────────────────────────┐
│                    AgentAI Platform                       │
├─────────────────────────────────────────────────────────┤
│   Web (Vite :5174)        Desktop (Tauri :18789)        │
│   QQ Bot (:18789)         VSCode (:18789)               │
├─────────────────────────────────────────────────────────┤
│              Gateway (Node.js :18789)                    │
│   - AgentAILoop / LLMRouter / ToolRegistry              │
│   - MCP Host / SubAgent / Reflector                     │
│   - ContextManager / TaskChain / GraphTaskChain         │
│   - Skills Router / Python Bridge                       │
├─────────────────────────────────────────────────────────┤
│         Skills (Python)        Models (LLM API)         │
│    image-gen / video-gen /      Agnes / DeepSeek        │
│    wechat / code / office       OpenAI-compatible       │
└─────────────────────────────────────────────────────────┘
```

---

## 前端 UI (Reasonix 主题)

| 组件 | 描述 | 引用 |
|------|------|------|
| 颜色系统 | OKLCH 色域，暗色主题 | `src/styles/global.css` (来自 Reasonix) |
| 布局 | 三栏: 左侧 244px + 内容区 + 右侧 320px | `src/App.tsx` |
| Title Bar | 品牌标识 + 三模式切换 (自动/规划/只读) | `src/App.tsx` |
| Tab Bar | 9 个标签页导航 | `src/App.tsx` PAGES 字典 |
| Status Bar | Gateway 状态 + tools 数 + 模式 | `src/App.tsx` |

### 9 个功能页面

| 路由 | 页面 | 组件 | 状态 |
|------|------|------|------|
| `chat` | 对话 | ChatView | ✅ 三模式 + 流式 + SSE |
| `write` | 写作 | WritePage | ✅ Markdown + AI 补全 + 导出 |
| `image` | 生图 | ImageGen | ✅ Agnes Image API |
| `video` | 生视频 | VideoGen | ✅ Agnes Video API |
| `editor` | 编辑器 | Editor | ✅ 代码编辑 |
| `skills` | 技能库 | SkillLibrary | ✅ |
| `cleaner` | 智能清理 | CleanerPanel | ✅ 仿 360 一键清理 |
| `qq` | QQ Bot | QQBotPanel | ✅ 配置面板 |
| `settings` | 设置 | Settings | ✅ API Key/配置 |

---

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 前端 | React + Vite + Antd 5 | Vite 5.3 |
| 后端 | Node.js + tsx | Node 22 |
| 桌面 | Tauri 2.0 (Rust) | Rust 1.75 |
| 技能 | Python 3.13 | Python 3.13 |
| 主题 | OKLCH CSS 变量 (Reasonix) | — |

---

## Gateway 工具 (43 tools)

| 类别 | 工具 | 
|------|------|
| 内置 | web_search / web_fetch / list_directory / read_file / search_files / search_content / write_file / edit_file / multi_edit |
| 内置 | chain_create / chain_advance / spawn_subagent / explore / research / review / security_review |
| 内置 | generate_image / generate_video / query_video |
| Python | 自动发现的 packages/agentai-skills/ 下所有技能 |
| MCP | 通过 MCPHost 注册的社区工具 |

---

## 编码规范

参见 [docs/CODING_GUIDELINES.md](docs/CODING_GUIDELINES.md)
新增 v2.0 规范: 规则 7 (Reasonix 主题), 规则 8 (组件注册), 规则 9 (禁止 process.kill)

---

## 故障恢复记录

- **process.kill 事件 (2026-06-xx)**: `process.kill()` 误杀父进程导致 F: 盘映射断裂，80+ 未入库文件永久丢失。此后全面禁止 process.kill。
- **文件恢复方式**: 从 Reasonix Code 对话历史逐文件重建。
- **GitHub 仓库**: https://github.com/yfgzpf/AgentAI-Platform (Apache 2.0)
