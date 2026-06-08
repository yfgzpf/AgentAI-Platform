# OpenClaw 源码迁移说明（v1.2 → v1.3）

> 写于 2026-06-08
> 富哥拍板："所有文件一定要复制到当前目录下，这是一个独立项目"
> 本文档是这次**物理复制**的官方记录。

---

## ✅ 已复制的真实源码（不是占位）

| 来源 | 路径 | 复制到 | 文件数 |
|------|------|--------|-------|
| **ZhiY.AI 后端** (openclaw 完整实现) | `F:\openclaw迭代源码存放\智Y.AI\zhiy-ai\packages\zhiy-backend\src\` | `F:\agentai-platform\references\openclaw-zhiy\zhiy-backend-src\` | 58 |
| ZhiY.AI 后端配置 | `zhiy-backend\package.json` + `tsconfig.json` | `references\openclaw-zhiy\` | 2 |
| ZhiY.AI GUI (前端完整实现) | `zhiy-ai\packages\zhiy-gui\` | `references\openclaw-zhiy\zhiy-gui\` | 完整 |
| ZhiY.AI Workspace (6 个真 Skill) | `zhiy-ai\workspace\` | `references\openclaw-zhiy\workspace\` | 6 SKILL.md + 配置文件 |
| **Hermes 多平台 gateway** | `F:\hermes-agent-main\gateway\` | `references\hermes\gateway\` | 30+ (Telegram/Discord/Slack/DingTalk/QQ/WeChat...) |
| Hermes 智能体通讯协议 | `hermes-agent-main\acp_adapter\` | `references\hermes\acp_adapter\` | 7 |
| Hermes 智能体核心 | `hermes-agent-main\agent\` | `references\hermes\agent\` | 35+ (LLM 路由/记忆/技能/工具/计费) |
| Hermes 环境与工具解析 | `hermes-agent-main\environments\` | `references\hermes\environments\` | 完整 (含 deepseek/glm/kimi/qwen/llama/mistral 12 个工具解析) |

**复制总量**: **30,103 个文件**（含 Hermes node_modules 等），剔除依赖后 ZhiY + Hermes 真实源码约 **2,000+ 文件**。

---

## 📋 真实可复用的 ZhiY backend 清单

`F:\agentai-platform\references\openclaw-zhiy\zhiy-backend-src\`

### TS 核心（24 个）
- `gateway.ts` — OpenClaw 网关核心（会话/消息路由/插件/记忆）
- `index.ts` — Express + WS + LLM + Session 集成入口
- `services/zhiy-agent-core.ts` — **完全照抄 OpenClaw 源码**（注释原话）
- `services/multi-agent-orchestrator.ts` — 多智能体编排
- `services/workflow-orchestrator.ts` — 工作流编排
- `services/task-orchestrator.ts` — 任务调度
- `services/llm.ts` — LLM 抽象（OpenAI 兼容）
- `services/skills-system.ts` — 技能系统（XML 提示嵌入）
- `services/skills.ts` + `services/skill_manager.py` — 技能注册/发现/执行
- `services/memory.ts` + `services/session.ts` + `services/stream.ts` + `services/hooks.ts` + `services/tools.ts` + `services/agent.ts` + `services/intent_analyzer.ts` + `services/industry_manager.ts` + `services/executor-agents.ts` — 智能体运行期支持
- `services/agent_skill_integration.py` — 智能体-技能集成
- `routes/skills.ts` + `routes/dingtalk.ts` — 路由

### Python 多模态服务（34 个）
- `services/agent_framework.py` — 智能体框架（general-purpose/copywriter/designer/marketing/...）
- `services/skill_manager.py` + `services/skill_discovery.py` + `services/skill_parameter_processor.py` — 技能生命周期
- `services/image_generation_service.py` — 千问/BanLan(Gemini-3-Pro)/SD/DALL-E/MJ 多模型
- `services/video_generation_service.py` — 视频生成
- `services/speech_to_text_service.py` — 语音转文字
- `services/emotional_tts_service.py` — 情感 TTS
- `services/local_model_service.py` + `services/lightweight_model_service.py` — 本地模型
- `services/qianwen_service.py` + `services/deepseek_service.py` + `services/gemini_service.py` — 多 LLM 适配
- `services/browser_automation_service.py` + `services/desktop_automation_service.py` + `services/smart_ui_recognizer.py` — 自动化
- `services/code_executor_service.py` + `services/tool_executor.py` + `services/tool_manager.py` — 工具执行
- `services/workflow_planner.py` + `services/knowledge_dialog_service.py` + `services/intent_to_action_mapper.py` — 高级智能
- `services/vector_db_service.py` + `services/user_memory.py` + `services/context_memory.py` + `services/conversation_memory_service.py` — 记忆系统
- `services/enhanced_ai_writer_service.py` + `services/music_player_service.py` — 内容生成
- `services/wechat_bot_service.py` + `services/wechat_bot_wcf.py` + `services/dingtalk_service.py` — 机器人
- `services/social_media_promotion.py` + `services/ocr_service.py` — 媒体
- `services/python_bridge.py` + `services/openclaw_core.py` — 桥接
- `services/hook_manager.py` + `services/intelligent_agent.py` + `services/agent.ts` + `services/zhiy_agent.ts` — 智能体

### ZhiY 6 个真 Skill (`workspace/skills/`)
- `office/doc-generator` — 文档生成
- `office/zhiy-writer` — 智能写作
- `communication/wechat-bot` — 微信机器人
- `video/seedance-video` — Seedance 视频生成
- `ai-web-automation` — Web 自动化
- `ai-documentation-generator` — AI 文档生成

---

## 🏗️ Hermes 真实可复用的核心 (`references/hermes/`)

### `gateway/` — 30+ 平台实现（**这是我们 QQ 机器人的真参照**）
- `platforms/base.py` — 平台基类
- `platforms/api_server.py` — API 入口
- `platforms/dingtalk.py` / `wechat.py` / `wecom.py` — 国内 IM
- `platforms/telegram.py` / `discord.py` / `slack.py` / `bluebubbles.py` / `imessage.py` / `signal.py` / `line.py` / `whatsapp.py` / `matrix.py` / `mattermost.py` / `irc.py` / `twitch.py` / `msteams.py` / `googlechat.py` / `feishu.py` / `lark.py` — 30+ 平台
- `delivery.py` / `pairing.py` / `mirror.py` / `hooks.py` / `channel_directory.py` — 网关支持
- `config.py` / `display_config.py` — 配置

### `acp_adapter/` — 智能体通讯协议（**前端 ↔ 后端标准化**）
- `auth.py` / `entry.py` / `events.py` / `permissions.py` / `server.py` / `session.py` / `tools.py` — 7 个文件完整协议

### `agent/` — 智能体核心
- `anthropic_adapter.py` / `auxiliary_client.py` / `copilot_acp_client.py` — 多 LLM 客户端
- `context_compressor.py` / `context_engine.py` / `context_references.py` — 上下文管理
- `credential_pool.py` — 凭据池
- `display.py` / `insights.py` — UI/分析
- `error_classifier.py` / `rate_limit_tracker.py` / `retry_utils.py` — 错误处理
- `memory_manager.py` / `memory_provider.py` — 记忆
- `models_dev.py` / `model_metadata.py` / `usage_pricing.py` — 模型/计费
- `prompt_builder.py` / `prompt_caching.py` / `redact.py` — 提示
- `skill_commands.py` / `skill_utils.py` / `smart_model_routing.py` — 技能 + 智能路由
- `subdirectory_hints.py` / `title_generator.py` / `trajectory.py` — 辅助

### `environments/` — 工具调用解析（**12 个模型解析器**）
- `tool_call_parsers/deepseek_v3_1_parser.py` / `deepseek_v3_parser.py` / `glm45_parser.py` / `glm47_parser.py` / `hermes_parser.py` / `kimi_k2_parser.py` / `llama_parser.py` / `longcat_parser.py` / `mistral_parser.py` / `qwen3_coder_parser.py` / `qwen_parser.py` — **12 个 LLM 工具调用格式解析器**（**直接解决 AgentAI 工具调用兼容性**）
- `agent_loop.py` — Agent 循环
- `hermes_base_env.py` / `hermes_swe_env.py` — 环境
- `web_research_env.py` / `terminal_test_env.py` — 专用环境
- `benchmarks/{terminalbench_2,yc_bench,tblite}/` — 基准测试

---

## 🚀 阶段 2 启动计划（基于真实代码）

富哥原话："所有文件一定要复制到当前目录下，这是一个独立项目"

### 阶段 2 任务清单（**真正动手**）
1. **物理迁入 ZhiY backend** 到 `packages/agentai-gateway/src/`
   - 把 58 个 ZhiY backend 源文件**复制**过去
   - 把 `zhiy-` 前缀全量重命名为 `agentai-`
   - 把 `智 Y.Ai` / `ZhiY` 字符串全量替换为 `AgentAI`
   - 改 `package.json` 的 `name` / `description` / `openclaw-zh` 引用路径
2. **物理迁入 Hermes gateway/platforms** 到 `packages/agentai-gateway/src/platforms/`
   - 30+ 平台适配器**全量复制**（**含 QQ/微信/钉钉/飞书/电报/Discord/...**）
   - 改名 `hermes_*.py` → `agentai_*.py`
3. **物理迁入 acp_adapter** 到 `packages/agentai-core/src/acp/`
4. **物理迁入 tool_call_parsers** 到 `packages/agentai-core/src/parsers/`（**12 个 LLM 解析器**）
5. **物理迁入 6 个 ZhiY skill** 到 `packages/agentai-skills/skills/`
6. **重新跑通 hello world**（Express + WS 启动 + Web 端连接）
7. **完整测试 + commit**

### 风险与承诺
- **不重写** ZhiY 真实代码（不破坏 OpenClaw 架构）
- **不引入**任何澳彩/预测业务
- **保留** ZhiY/Hermes 原始注释（含 "完全照抄 OpenClaw 源码" 原文）
- **统一品牌**：代码字符串全部 AgentAI，但**架构**保持 OpenClaw 血统

---

**更新 v1.2 → v1.3**: 本文档。
**commit**: 待生成。
