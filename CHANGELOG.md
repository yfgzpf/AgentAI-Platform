# Changelog

## [2.0.0-Atlas] - 2026-06-29 - 品牌升级

### Changed
- 项目品牌由 AgentAI 升级为 Atlas
- 浏览器 favicon 与 Tauri 桌面图标替换为新 LOGO (logo1.jpg)
- 桌面安装包名、窗口标题、About 全部更新为 Atlas
- 浏览器 tab 标题、登录页、引导页、Settings 关于文案同步更新

### Notes
- 后端包名 (`packages/agentai-*`)、import 路径、provider id 保持不变
- 历史版本日志按原样保留

---

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **PulseFlow Xuanji 认知框架**: 融合中医辨证思维的状态感知型智能体框架
  - 四诊合参（望闻问切）任务感知系统
  - 辨证推理引擎（置信度评估、风险分析、治法选择）
  - 方剂编排（汗/和/下/温四法，君臣佐使组织）
  - 医案记录系统（完整生命周期追踪、相似匹配、统计分析）
  - REST API 暴露（6个端点）
  - 前端可视化面板（医案列表、详情、统计仪表盘）
  - 集成到 Chat 主流程（每次对话自动记录医案）
- **PulseFlow 品牌体系**: 统一品牌命名和定位
  - 一句话定位："让智能体理解系统的生命状态"
  - 前端显示更新（标题栏、HTML标题、README）
  - 系统身份更新（system-prompt.ts）
  - 品牌规范文档（PULSEFLOW_BRAND.md）
- **小米MIMO TTS**: 商业级语音合成
  - 内置API密钥，开箱即用
  - 8种音色选择（米男、米女、御姐、青年等）
  - 前端VoiceSelector集成
- **评论区截流获客系统**: 抖音/小红书/视频号获客黑科技
  - 爆款视频监控
  - 评论区意向用户采集
  - AI意向评分
  - 私信话术生成
  - 编辑器右侧面板集成
- **行业 RAG 知识库**: BM25 本地检索引擎 + 文档上传/分块/检索 + 前端管理面板
- **知识库自动注入**: AI 对话时根据用户行业自动检索相关段落注入 system prompt
- **自修复进化记录**: 自动修复(缺模块/编码错误/路径不存在/权限错误)时写入 evolution 日志
- **知识库路由**: `POST /v1/knowledge/upload-file`, `GET /v1/knowledge/search`, `DELETE /v1/knowledge/:id` 等 5 个 API
- Welcome page with 6 core competitive advantages display
- Web search tools: `web_search` + `web_fetch`
- Cross-conversation memory: auto-summarize & carry context
- AI super-awareness: auto-discover & create skills
- AES-256-GCM encrypted config storage
- Gateway auto-start with Vite dev server
- 12 built-in tools (image/video/search/skill creation)
- Chinese zodiac Dragon SVG icon & desktop icons
- VSCode extension with SSE streaming
- QQ Bot with official SDK support
- Onboarding 5-step wizard
- Plan request form

### Fixed
- Input lag: input state isolated with useMemo
- AI reply hidden by tool summaries
- Duplicate command execution with sendingRef lock
- Path traversal vulnerability with safeResolve sandbox
- CSS dark theme for antd Modal/Message/Dropdown
- CORS blocked for 127.0.0.1
- Gateway spawn ENOENT on Windows
