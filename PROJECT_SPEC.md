# AgentAI Platform — 项目规范 v1.1（Tauri 壳 + Node Gateway）

> 项目代号: **AgentAI Platform**
> 命名参考: 富哥指令「AGENTAI参考」
> 文档版本: v1.2 (2026-06-08 09:55 — 密钥管理/教程/Git/品牌 4 份配套文档落地)
> 最后更新: 2026-06-08
> 状态: 开发规范 v1.2 (动手前必读)

---

## 〇、Why / What / How 一句话

**Why**: 富哥要一个**完全免费**的智能体框架平台, 内置生图生视频多模态能力, 桌面端 + QQ 机器人 + VSCode 集成, 底层在 AgentAI 和 DeepSeek 之间可切换。
**What**: 在 `F:\agentai-platform` 新建项目, 桌面壳用 **Tauri (Rust)** 极小化 (5-10MB), 智能体网关用 Node.js (复用 ZhiY.AI 生态), 多模态用 Python 沙箱, QQ/VSCode 都通过 Node Gateway 统一对接。
**How**: 5 阶段开发, 桌面壳/网关/技能三层架构, 严格验收。

---

## 一、参考材料清单（必学，但不带入任何业务逻辑）

| 路径 | 用途 | 借鉴方式 |
|------|------|----------|
| `F:\openclaw迭代源码存放\智Y.AI\zhiy-ai\packages\` | **zhiy-gateway + zhiy-gui** 完整 Node 实现 | **直接复用 + 重命名** |
| `F:\openclaw迭代源码存放\智Y.AI\zhiy-ai\skills\` | **37 个 skill** (含 multi-modal/agent/desktop/web/wechat-bot) | **逐个迁移** |
| `F:\openclaw迭代源码存放\ZhiYAI\项目规范、.txt` | 1253 行 ZhiY.Ai 规范 | **项目骨架直接照搬** |
| `F:\hermes-agent-main\` | Hermes (Nous Research) 多渠道 + 自进化 | **学习模式** |
| `F:\deepseek-reasonix\REASONIX.md` | Reasonix 反思/记忆模式 | **迁移到记忆系统** |
| `F:\lottery-ai\` | 桌面端 Electron 经验 | **学习踩坑** |
| `F:\目录已检查\澳彩\.reasonix\skills\` | 22 个 skill 模板 | **借鉴 SkillSpec 格式** |
| WorkBuddy 架构 (C:\Users\Administrator\WorkBuddy\) | 桌面端 + IDE 集成 | **参考架构模式** |

**说明**: Reasonix 是从澳彩项目提炼的**思维方法论**（八步对冲、庄家五问、必杀三肖），Reasonix 8 步对冲用于**项目决策**（方案选型 / 风险评估），不引入任何彩票/预测业务代码。

---

## 二、命名规范

### 2.1 品牌
- **平台名**: AgentAI Platform
- **主控智能体**: `agentai` (类似 ZhiY.Ai 的 zhiy)
- **引导智能体**: `guidance`
- **核心 Skill 命名**: `agentai-*` 前缀 (e.g. `agentai-image-gen`, `agentai-qq-bot`)
- **目录名**: `agentai-platform`

### 2.2 配置文件 / 路径
- 工作空间根目录: `~/.agentai/`
- 主配置: `~/.agentai/config.yaml`
- 日志: `~/.agentai/logs/`
- 技能目录: `~/.agentai/skills/`
- 临时技能: `~/.agentai/temp_skills/`
- 角色资产库: `~/.agentai/characters/`
- 记忆目录: `~/.agentai/workspace-magic/memory/`

### 2.3 颜色 / Logo
- 主色调: 智能蓝 `#4F46E5`
- 强调色: 玫瑰金 `#F472B6`
- 字体: Inter (英文) + 思源黑体 (中文)
- Logo: 后续设计 (本规范先定义色板)

---

## 三、技术栈（最终版 — Tauri 壳方案）

### 3.1 桌面壳 — Tauri (Rust) ⭐ 富哥拍板
- **Tauri 2.0** (稳定版, 2025-09 发布)
- **WebView**: 系统 WebView2 (Windows) / WKWebView (Mac) / WebKitGTK (Linux)
  - **不打包 Chromium**，安装包 **5-10MB** (vs Electron 150MB+)
- **前端**: React 18 + TS + Vite + Ant Design 5 + Tailwind
- **系统集成**: 系统托盘 / 全局快捷键 / 开机自启 / 自动更新
- **IPC**: Tauri commands (Rust 后端 ↔ JS 前端)
- **打包**: `tauri build` (NSIS / MSI / DMG / AppImage)

### 3.2 智能体网关 — Node.js 22+
- **Express** / **Fastify** HTTP + WebSocket
- **socket.io** 实时通信
- **Bull** 任务队列
- **chokidar** 技能热加载
- **dockerode** 沙箱执行 Python 技能
- **better-sqlite3** 本地存储
- **Redis** 6+ (会话状态)

### 3.3 多模态技能 — Python 3.13 沙箱
- **agentai-image-gen** (对接 Agnes Image 2.1)
- **agentai-video-gen** (对接 Agnes Video / Seedance 2.0)
- **agentai-voice** (TTS/STT)
- **agentai-office** (doc/excel/ppt 生成)
- **37 个技能** 全部从 ZhiY.AI 迁过来, 重命名为 `agentai-*`

### 3.4 QQ 机器人 — Node.js (oicq)
- **oicq** 协议库 (Node.js 原生)
- 私聊 / 群 / 讨论组 事件驱动
- WebSocket 反向连接到 Node Gateway
- 与 Web/Electron/VSCode 共享智能体调度

### 3.5 VSCode 集成 — vsce 扩展
- **vsce** 打包
- VSCode API: workspace / window / commands
- WebSocket 连接到 Node Gateway
- 选中代码 → 调智能体 / 改 bug / 写测试

### 3.6 大模型 (LLM) — 双引擎
- **主**: AgentAI (Agnes API, `https://apihub.agnes-ai.com`)
  - `agnes-text-*` (对话)
  - `agnes-image-2.1-flash` (生图)
  - `agnes-video-*` (生视频)
- **备**: DeepSeek
  - `deepseek-chat`
  - `deepseek-coder`
- **统一接口**: `LLMService` 类
- **切换方式**: 环境变量 `LLM_PROVIDER=agentai|deepseek` + API Key
- **智能路由**: Reasonix 8 步对冲 → 选 Provider → 记录成本 → 失败熔断

### 3.7 GUI 导航 / 路由基线 (v1.3)
- 路由框架: `react-router-dom` v6, 7 个一级路由: `/studio` (默认) / `/image` / `/video` / `/editor` / `/skills` / `/settings` / `/qq`
- 侧栏: 200px 可折叠 (折叠态 56px), antd `Menu` 渲染 7 项, 高亮跟随 `useLocation()`
- 顶栏: 折叠按钮 + 当前页名 + Gateway 健康条 (`/health` 15s 探活) + 当前模型徽标 + 版本号
- 入口: 无 profile → `/onboarding` (受控 Modal, 不再 `window.location.reload`); 有 profile → `/studio`
- `<PageHeader>` 统一页头: 面包屑 `Studio / 子页` + 主标题 + 副标题 + 右侧 `<Space>` 操作区
- 持久化: `agentai-sidebar-collapsed` localStorage 键

### 3.8 多模型配置 (v1.3)
- Store: `useModelStore` (zustand + persist), 字段 `models: ModelConfig[]` / `activeModelId: string` / `addModel` / `removeModel` / `toggleModel` / `setDefault` / `setActive`
- 预置 3 个内置模型: agentai (默认) / deepseek / openai
- 运行时切换: `<ModelSwitcher>` 紧贴输入框左上方, 彩色小圆点 + 标签 + 下拉
- 设置页: Settings → LLM 模型 Tab = `<ModelManager>`, 提供 列表 / 启停 / 测活 / 默认 / + 添加
- Gateway: `POST /v1/chat` / `/v1/editor/chat` / `/v1/editor/chat/stream` / `/v1/qq/message` 接受 `model` 字段, 缺省 `agentai`
- 模型清单: `GET /v1/models` 返回已配模型元信息 (含 `keyPreview` 掩码)
- 兼容 shim: 旧的 `useSettingsStore().provider` 仍可用, 但 setProvider 会自动同步到 `useModelStore().setActive` 并标 `@deprecated`

### 3.9 Gateway 安全基线 (v1.3)
- CORS 白名单: `AGENTAI_CORS_ORIGINS` 环境变量, 默认 `http://localhost:5173,http://localhost:1420,tauri://localhost`
- WebSocket CORS: 与 HTTP 同步白名单
- 静态 `/media` 仅暴露 `packages/agentai-skills/out`, 不允许 `..` 逃逸 (express.static 默认行为)
- 文件路径解析统一走 `path.resolve()`, 避免相对路径注入
- QQ Bot 默认对所有用户开放; 管理员白名单仅在请求方显式传 `enforceAdmins=true` 时才生效
- SSE 客户端断开: `req.on('close')` 触发 `AbortController.abort()`, 中断 `AgentAILoop`
- bash 工具跨平台: Windows 走 `powershell.exe -NoProfile -NonInteractive`, 通过 `AGENTAI_BASH=cmd` 可回退到 `cmd.exe`

---

## 四、系统架构（Tauri 壳方案）

```
┌─────────────────────────────────────────────────────────────┐
│                  用户入口层 (Entry Layer)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Web GUI  │  │  Tauri   │  │   QQ    │  │ VSCode   │    │
│  │  (React)  │  │ Desktop  │  │  Bot    │  │ Extension│    │
│  │ 5-10MB   │  │  Rust    │  │  oicq   │  │  vsce   │    │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘    │
└───────┼─────────────┼─────────────┼─────────────┼──────────┘
        │             │             │             │
        └─────────────┴──────┬──────┴─────────────┘
                             │ localhost:18789 (WebSocket/HTTP)
┌────────────────────────────▼─────────────────────────────────┐
│              智能体网关层 (Node.js Gateway)                    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  agentai-gateway (Node.js 22 + Socket.io)            │    │
│  │  - 消息路由 / 会话管理 / 智能体调度 / 钩子触发         │    │
│  │  - 4 渠道适配器: Web/Tauri/QQ/VSCode                  │    │
│  │  - LLM 智能路由 (AgentAI ↔ DeepSeek)                 │    │
│  └──────────────────────┬───────────────────────────────┘    │
└─────────────────────────┼────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────┐
│              智能体核心层 (Node.js Core)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  agentai-core                                          │   │
│  │  - 主控智能体 (agentai)                                 │   │
│  │  - 引导智能体 (guidance)                                │   │
│  │  - 技能管理器 (热加载 chokidar)                         │   │
│  │  - 行业管理器 (行业配置)                                │   │
│  │  - 记忆系统 (Reasonix 三层结构)                         │   │
│  │  - LLM 服务 (智能路由 + 熔断)                           │   │
│  │  - 沙箱执行 (Docker)                                    │   │
│  └──────────────────────┬───────────────────────────────┘   │
└─────────────────────────┼────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────┐
│           技能层 (37 个 Python 技能, Docker 沙箱)              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  office  │  │   web    │  │  image   │  │  video   │    │
│  │ doc/excel│  │browser/  │  │generator │  │Seedance/ │    │
│  │   /ppt   │  │scraper   │  │  editor  │  │  Wan2.6  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ desktop  │  │ wechat   │  │   code   │  │   meta   │    │
│  │auto-gui/ │  │   -bot   │  │ executor │  │evolution │    │
│  │ control  │  │ (QQ 扩展)│  │  writer  │  │          │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────┐
│                  数据 / LLM 层                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ SQLite   │  │  Redis   │  │ AgentAI  │  │ DeepSeek │    │
│  │ 本地库   │  │  会话    │  │  API     │  │   API    │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、5 阶段开发计划（21 天）

### 阶段 1: 基础脚手架 (3 天) — 必须 100% 验收
- [ ] `F:\agentai-platform\` 目录结构
  - `packages/agentai-gateway/` (Node.js)
  - `packages/agentai-core/` (Node.js)
  - `packages/agentai-gui/` (React + TS)
  - `packages/agentai-desktop/` (Tauri/Rust)
  - `packages/agentai-skills/` (Python)
- [ ] `package.json` + `pnpm-workspace.yaml`
- [ ] `agentai-gateway` 启动 → WebSocket 端口 18789
- [ ] `agentai-core` 智能体注册 (主控/引导)
- [ ] `agentai-gui` React 桌面端骨架 (登录/主工作区)
- [ ] `agentai-desktop` Tauri 壳 → 嵌入 GUI → 系统托盘
- [ ] 配置 `~/.agentai/config.yaml`
- [ ] **验收**: Tauri 桌面启动后能登录 + 看到欢迎界面 + 控制台 < 100MB

### 阶段 2: 智能体核心 (4 天)
- [ ] LLM 服务统一接口 (AgentAI / DeepSeek 智能路由 + 熔断)
- [ ] 技能管理器 + 热加载 (chokidar)
- [ ] 钩子系统 (异步 Promise)
- [ ] 记忆系统三层结构 (Reasonix 模式)
- [ ] 引导智能体 (需求收集状态机)
- [ ] **验收**: 命令行能调起 agentai 主对话 + 切换 LLM

### 阶段 3: 多模态技能 (5 天) — 重点
- [ ] 迁移 37 个 ZhiY.AI 技能 (优先级: image/video/office/web)
- [ ] `agentai-image-gen` (对接 Agnes Image 2.1)
- [ ] `agentai-video-gen` (对接 Agnes Video / Seedance 2.0)
- [ ] `agentai-voice` (TTS/STT)
- [ ] `agentai-office` (doc/excel/ppt 生成)
- [ ] **验收**: 通过对话生图 + 生视频 + 生成 Word 文档

### 阶段 4: 桌面端 + QQ (4 天)
- [ ] Tauri 桌面端完整 (主工作区 / 行业 / 设置 / 自动更新)
- [ ] QQ 机器人 (oicq 协议)
  - [ ] 私聊 + 群消息接收
  - [ ] 智能体回复
  - [ ] 技能调用穿透
- [ ] 微信机器人 (wechatferry, 备用)
- [ ] 渠道适配器 (Channel Adapter)
- [ ] **验收**: QQ 发消息 → 智能体回复 + 触发技能

### 阶段 5: VSCode 集成 (3 天)
- [ ] VSCode 扩展骨架 (`vsce` 打包)
- [ ] WebSocket 连接到 Node Gateway
- [ ] 选中代码 → 调用智能体
- [ ] 命令面板: `AgentAI: Ask`, `AgentAI: Generate Code`
- [ ] 侧边栏: 对话面板
- [ ] **验收**: VSCode 中能用智能体写代码 / 改 bug

### 阶段 6: 测试 + 文档 (2 天)
- [ ] 单元测试 (Jest / Vitest + pytest)
- [ ] 集成测试 (WebSocket + Docker 沙箱)
- [ ] 用户验收测试 (Tauri + QQ + VSCode 三端)
- [ ] README + API 文档
- [ ] **验收**: 4 渠道全通 + 多模态跑通 + 桌面 < 50MB 内存

**总周期**: ~21 天 (3 周)

---

## 六、Skill 规范 (SkillSpec)

每个 skill 是一个独立目录, 必须包含:

```
agentai-skills/
└── <skill-name>/
    ├── SKILL.md          # 描述 (功能/参数/示例/依赖/作者)
    ├── main.py           # Python 主脚本
    ├── requirements.txt
    └── tests/             # 可选测试
```

**SKILL.md 模板**:
```markdown
# <Skill Name>

## 功能
简述技能功能。

## 参数
- `--param1` (type, required): 说明
- `--param2` (type, optional): 说明

## 示例
```bash
python main.py --param1 value1
```

## 依赖
requests>=2.25
```

---

## 七、安全规则 (Reasonix 经验迁移, 非业务)

1. **沙箱执行**: 所有 skill 跑在 Docker 容器, 内存 512M, CPU 1 核, 网络默认关闭
2. **代码静态分析**: 禁止 `eval / exec / Function / child_process / os.system` (在 skill 生成时)
3. **审计日志**: 加密存储, 含时间戳/用户/动作/结果
4. **LLM Cost Guard**: 每次调用记录 token, 超过阈值熔断 (`maxCostPerRun=0.05 USD`)
5. **智能路由熔断**: Provider 连续失败 → 切备用 → 报警

---

## 八、Reasonix 8 步对冲 (项目决策专用, 不带业务逻辑)

每次关键决策 (skill 安装 / LLM 切换 / 渠道接入) 后:
1. 49 候选方案 (穷举所有备选)
2. 与现有架构比对 (冲突/协同)
3. 读上阶段报告 (延迟/风险)
4. 上阶段 Top5 过滤
5. 多方案共识比对
6. 反向信号扫描
7. 加权综合
8. 质证反思

---

## 九、记忆 / 文档规范

### 9.1 三层记忆
- **核心**: `~/.agentai/workspace-magic/MEMORY.md` (长期事实, 跨期)
- **每日**: `~/.agentai/workspace-magic/memory/YYYY-MM-DD.md` (当日日志)
- **任务**: `~/.agentai/workspace-magic/memory/YYYY-MM-DD-<task>.md` (任务归档)

### 9.2 文档必写
- `docs/ARCHITECTURE.md` (系统架构图)
- `docs/API.md` (REST + WebSocket API)
- `docs/SKILL_DEVELOPMENT.md` (如何写新 skill)
- `docs/CHANNEL_INTEGRATION.md` (如何接新渠道: QQ/微信/Slack)
- `docs/VSCODE_INTEGRATION.md`
- `docs/TAURI_BUILD.md` (桌面端打包)
- `docs/DEPLOYMENT.md` (Docker / WSL2 / 桌面端打包)

---

## 十、验收标准 (Definition of Done)

每阶段必须满足:
1. 代码已提交 (`git commit` 留痕)
2. README 段落更新
3. **核心功能跑通** (有实际跑出来的截图/日志)
4. 单元测试通过
5. 至少 1 个集成测试
6. 记忆文件更新 (今日 `.md` + `MEMORY.md` 关键事实)
7. **富哥亲自验收 1 次** (不依赖 Reasonix 自我评分)

---

## 十一、立即动手清单 (Day 1)

1. **创建项目目录**: `F:\agentai-platform\` ✓ (已完成)
2. **git init** + 第一版 `.gitignore` + 提交
3. **复制 ZhiY.AI 包结构** 到 `F:\agentai-platform\packages\` (作为起点)
4. **全局重命名** openclaw→agentai, ZhiY→agentai
5. **写 package.json** (主包 + 5 个子包: gateway/core/gui/desktop/skills)
6. **跑通 hello world**: 启动 gateway → Tauri 桌面端嵌入 GUI → WebSocket 连接成功
7. **写记忆**: 今日 `.md` + `MEMORY.md` (项目代号 / 命名规范 / 5 阶段计划 / Tauri 方案)

---

## 十二、风险预警

- ⚠️ **多模态 API 限流**: Agnes 视频生成限速, 必须有 fallback (字节 Seedance / 即梦)
- ⚠️ **QQ 协议风险**: oicq / go-cqhttp 协议随时可能失效, 监控 + 备用协议
- ⚠️ **Tauri 学习曲线**: Rust 所有权机制 + 系统 WebView 跨平台差异
- ⚠️ **VSCode 跨平台**: 扩展必须支持 Windows/Mac/Linux, 写时测试
- ⚠️ **桌面 vs 网关 IPC**: Tauri 启动/关闭 Node Gateway 的生命周期管理
- ⚠️ **Reasonix 风格**: 不要堆参数, 找结构 (梁文锋原则)

---

## 十三、Tauri vs Electron 决策记录 (v1.1 升级原因)

| 维度 | Electron (v1.0) | Tauri (v1.1) | 提升 |
|------|-----------------|--------------|------|
| 安装包体积 | 150-200MB | **5-10MB** | 20x |
| 启动时间 | 1-3s | **0.3-0.5s** | 6x |
| 内存占用 | 150-300MB | **20-50MB** (壳) + 80MB (Gateway) | 2-3x |
| 多模态技能 | ✅ 复用 | ✅ 复用 | 一致 |
| VSCode 扩展 | ✅ 复用 | ✅ 复用 (Node Gateway) | 一致 |
| QQ 机器人 | ✅ 复用 | ✅ 复用 (Node Gateway) | 一致 |
| 学习曲线 | 低 | 中 (Rust) | 略增 |
| 生态成熟度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 略降 |
| **回滚** | Tauri 阶段失败 → 切回 Electron | 计划已就绪 | 灵活 |

**结论**: Tauri 在体积/性能上的优势压倒 Rust 学习成本, 关键依赖 (Node Gateway/Python 技能) 完全不变, VSCode 扩展 / QQ 机器人复用, 风险可控。

---

**v1.1 完, 等富哥拍板 "干" 启动阶段 1 (Tauri 桌面壳 + Node Gateway 双轨起步)**
