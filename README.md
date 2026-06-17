<p align="center">
  <img src="./assets/logo-xagent.svg" alt="x-agent" width="120">
</p>

<h1 align="center">x-agent</h1>

<p align="center">
  <strong>授人以渔 · 本地优先 · 自主智能体操作系统 · 行业深度感知</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
  <a href="#"><img src="https://img.shields.io/badge/version-0.5.0--alpha-orange" alt="Version"></a>
  <a href="#"><img src="https://img.shields.io/badge/model-free-green" alt="Free Models"></a>
</p>

<p align="center">
  <sub>Web GUI · Tauri 桌面 · QQ 机器人 · VSCode 扩展 — 四渠道统一接入</sub>
</p>

---

> **不是聊天框，是工作台。不是替你做，是教你做。**
>
> AgentAI Platform 是一个以"授人以渔"为核心理念的自主智能体操作系统。
> 它赋予 AI 自主探索、行业洞察积累和系统自管理三大能力，让 AI 越用越懂你的行业。
> 数据永远在你自己机器上，免费模型优先，强力模型按需切换。

---

## 设计哲学

### 授人以渔，不是授人以鱼

大多数 AI 工具是"替你做"：你提需求，AI 替你做。做完就忘。

AgentAI 是"教你做"——给 AI 最大的能力延伸，让它能：

| 能力 | 传统 AI | AgentAI |
|------|---------|---------|
| **代码探索** | 等你指定文件再读 | 首次对话自动绘制项目代码地图，自主追踪 import 链 |
| **行业理解** | 每次从零开始 | 从对话中自动提取行业洞察，跨会话持久化积累 |
| **系统管理** | 出问题等你排错 | 自检 API Key/磁盘/内存/缓存，自动修复常见问题 |
| **记忆更新** | 需要手动保存 | 每次任务完成后自动写入记忆，行业加权排序 |
| **模型选择** | 手动切换 | 简单对话用免费模型，代码审查/安全分析自动建议强模型 |
| **Token 控制** | 全量加载 | 工具输出语义压缩(节省70-85%)，Skills 按需注入 |

---

## 核心能力

### 1. 自主代码探索 — AI 自己读懂你的项目

```
首次对话
  │
  ├── 自动识别项目类型 (Next.js / Vite / Express / Monorepo ...)
  ├── 定位入口文件和关键目录
  ├── 绘制依赖关系图
  ├── 识别设计模式 (Factory / Observer / Router / Middleware)
  └── 缓存结果，5分钟内不重复扫描
```

系统提供 `explore_project` 工具，AI 在以下场景自动调用：
- 首次进入项目，不知道目录结构时
- 用户提到某个模块但 AI 不了解其依赖时
- 用户问"这个项目怎么组织的"

### 2. 行业洞察自主积累 — 越用越懂你的行业

```
对话中自动提取
  │
  ├── 识别行业 (软件开发 / 装修建材 / 电商运营 / 教育 / 医疗 ...)
  ├── 提取洞察 (工作流 / 最佳实践 / 痛点 / 术语 / 工具)
  ├── 持久化到 ~/.agentai/insights/
  └── 下次对话自动加载行业画像
```

洞察完整度评分 0-100%，低于 50% 时主动提示 AI 学习更多。

### 3. 系统自管理 — AI 管理自己的系统

```
系统自检
  │
  ├── API Key 状态 (5 个 provider 逐个检查)
  ├── 磁盘空间 (自动检测 ~/.agentai/ 大小)
  ├── 记忆文件 (>10MB 触发压缩)
  ├── 缓存状态 (>7天过期文件自动清理)
  └── 端口监听 (检查 Gateway 是否正常)
```

自动修复能力：清理过期缓存 · 压缩超大记忆 · 截断日志 · 释放磁盘空间。

### 4. 智能模型路由 — 免费优先，强力按需

```
用户消息
  │
  ├── "你好" → agentai (免费 Flash)
  ├── "审查这段代码" → DeepSeek V4 Pro (推荐)
  │   └── 自动检测: 需要强推理能力
  │   └── 如未配置 Key → 在回复中给出配置指引
  └── "帮我生成图片" → 智谱 GLM-4.6V (免费视觉模型, 自动切换)
```

- 5 维评分路由: 复杂度匹配 + 上下文适配 + 成本 + 历史成功率 + 延迟
- 支持 8 个模型: agentai(免费) / deepseek / openai / cline(免费) / zhipu(免费)
- 一键配置 Key: 在设置页粘贴 Key → 自动写入 .env → 路由器实时生效

### 5. Token 精打细算 — 每一条都算账

| 机制 | 节省量 | 位置 |
|------|--------|------|
| **工具输出语义压缩** | 70-85% | `token-compressor.ts` — ANSI过滤/空行折叠/重复去重/智能截断 |
| **Skills 按需注入** | 约 2800 token/次 | agentai-loop.ts — 全量XML(3000+token) → 分类摘要(200 token) |
| **上下文窗口截断** | 防超限 | llm-router.ts — 超 85% 上限时自动丢弃最旧消息 |
| **appendOnlyLog 修剪** | 防膨胀 | MAX_LOG_SIZE=60, 保留 system + 最近 60 条 |
| **不支持工具的模型** | 全跳过 | 如 MiniMax M3, 自动清空 tools 数组避免浪费 |

### 6. 记忆系统 — 三层架构，行业加权

```
记忆评分 = 时效衰减(40%) + 行业加权(30%) + 重要性(30%)

Layer 1: volatileScratch  → 当前轮对话缓存
Layer 2: 持久化文件       → 跨会话持久化 (带行业标签, 自动写入)
Layer 3: insights/        → 行业洞察库 (跨项目积累, 永不丢失)
```

每次 LLM 调用成功后自动写入记忆（`source: auto_reflect`），无需用户手动触发。

### 7. 安全审批 — 高风险操作必须过你这一关

```
AI 调用高风险工具 → 拦截 → 弹出审批卡片 → 你点「允许」或「拒绝」
                                              └── 操作记录写入审计日志
```

### 8. Goal 模式 — 目标驱动，断点续跑

```
目标: "重构认证模块"
  ├── 阶段1: 分析现有代码 ✓
  ├── 阶段2: 设计新架构 ✓
  ├── 阶段3: 实现重构 ← 人工审批节点
  ├── 阶段4: 编写测试 ✓
  └── 阶段5: 验证 ✓
```

硬性上限: 8 阶段 / 2 次重试 / 5min 阶段超时 / 30min 总超时

### 9. 音乐播放器 — AI 主动关怀，缓解工作压力

```
AI 感知用户工作状态 → 主动提示开启背景音乐 → 调用 control_music 工具
  │
  ├── play: 播放音乐 (无曲目时自动加载免费音乐库)
  ├── pause: 暂停播放
  ├── next/prev: 切换曲目
  ├── volume: 调整音量 (0-1)
  ├── load_free: 加载免费音乐库 (SoundHelix/BenSound/Kevin MacLeod)
  └── show: 显示播放器面板
```

内置免费音乐库:
- **SoundHelix** (10首): Ambient/Electronic/Chill/Piano/Jazz 等风格
- **BenSound** (5首): Acoustic Breeze/Sunny/Tenderness/Slow Motion
- **Kevin MacLeod** (2首): Merry Go/Brandenburg Concerto 3

AI 可在对话开始时主动提示: "工作累了? 可以打开底部音乐播放器，放些轻松的背景音乐 🎵"

### 10. 智能模型切换 — 熔断自动切换商用 API

```
免费模型速率限制触发
  │
  ├── 检测连续 3 次熔断 → 自动触发智能切换
  ├── 检查商用 API 密钥 (DeepSeek / OpenAI / 智谱)
  ├── 有密钥 → 无缝切换，任务不中断
  ├── 无密钥 → 提示用户配置，一键获取
  └── 任务紧急时自主决策，不被动等待
```

- 熔断计数 + 自动恢复机制，AI 自主决策何时切换
- 支持速率感知的子 Agent 任务分配

### 11. 内置工具管理 — 项目自带，开箱即用

```
Gateway 启动时自动检查
  │
  ├── pnpm / npm / tsc / node / vite → 检查可用性
  ├── 缺失工具 → 自动安装
  └── 不可用 → 自动降级备用工具
```

避免依赖外部环境配置，所有 AI 用到的命令都内置于项目中。

### 12. 用户行为与数据预判 — AI 提前准备

```
实时分析用户操作模式
  │
  ├── 识别行为序列 (创建组件 → 测试组件 → 部署)
  ├── 预判下一步行动 → 提前准备资源
  ├── 预测数据需求 → 主动获取并缓存
  └── 安全保护: 不分析敏感数据，不发送外部服务器
```

### 13. 对话内 SVG 图表 — AI 作图，对话内展示

```
AI 调用 generate_diagram
  │
  ├── 流程图 / 架构图 / 对比表 / 时间线 / 思维导图
  ├── 双重安全消毒 (sanitizeSvg + DOMParser)
  └── 对话内直接渲染，无需下载文件
```

### 14. 文件上传 — 图片 + 文档直达 AI 分析

```
拖拽文件到对话框
  │
  ├── 图片 → 自动转 base64 → 合并到消息 image_url
  ├── 文档 (xlsx/pdf/docx/csv) → 解析文本内容
  ├── 注入到 AI 上下文，所有执行路径都能收到
  └── 支持 MasterController / loop.run 双路径
```

---

## 对比

| | ChatGPT | Copilot | Cursor | **AgentAI** |
|---|---------|---------|--------|-------------|
| **价格** | 付费订阅 | 付费订阅 | 付费订阅 | **免费模型优先** |
| **自主探索** | 无 | 无 | 部分 | **自动绘制代码地图 + 追踪依赖** |
| **行业积累** | 无 | 无 | 无 | **自动提取 + 跨会话持久化** |
| **系统自管** | 无 | 无 | 无 | **自检 + 自动修复** |
| **模型切换** | 手动 | 手动 | 手动 | **智能推荐 + 一键配置 Key + 熔断自动切换** |
| **记忆系统** | 手动 | 无 | 会话内 | **3 层自进化 + 行业加权** |
| **Token 优化** | 无 | 无 | 无 | **4 重压缩 + 按需注入** |
| **审批流** | 无 | 无 | 无 | **4 类审批 + 审计日志** |
| **音乐播放** | 无 | 无 | 无 | **AI 主动关怀 + 免费音乐库** |
| **文件处理** | 对话内上传 | 对话内上传 | 对话内上传 | **拖拽上传+多格式解析+全路径注入** |
| **SVG 图表** | 无 | 无 | 无 | **对话内生成+内联渲染+双重消毒** |
| **渠道覆盖** | Web | IDE | IDE | **Web + 桌面 + QQ + VSCode** |
| **数据隐私** | 云端 | 云端 | 云端 | **本地运行，数据不出门** |
| **开源** | 否 | 否 | 否 | **Apache 2.0** |

---

## 系统架构

```
  Web GUI ──┐                                          ┌── 内置工具 (51+)
  Tauri ────┤              localhost:18789              │   explore_project · industry_insight
  QQ Bot ───┼──── HTTP/WS ───► Gateway ────────────────►│   self_diagnose · read/write/edit
  VSCode ───┘                   │                       │   web_search · generate_image
                                │                       │   run_code · spawn_subagent
                     ┌──────────┼──────────┐           │   multi_edit · remember · control_music ...
                     │          │          │           └── Python 技能 (37+)
               自主探索引擎   行业洞察引擎   自管理引擎
               (代码地图+     (行业识别+    (健康自检+
                依赖追踪)     洞察积累)     自动修复)
                     │          │          │
               智能路由 (5维评分+免费优先+熔断切换)
                     │                     │
              记忆系统 (3层+行业加权+自动写入)
                     │
              Token 压缩 (4重机制 · 节省70-85%)
```

**四引擎 LLM 路由**: AgentAI / DeepSeek / OpenAI / Cline / 智谱 — Cost Guard → 缓存命中 → 5 维评分 → 失败降级 → 熔断

---
## 新增引擎 (2026-06-17)

| 引擎 | 文件 | 能力 |
|------|------|------|
| 智能切换引擎 | `smart-model-switcher.ts` | 连续熔断自动切换商用API, 无需人工干预 |
| 内置工具引擎 | `builtin-tools-manager.ts` | pnpm/npm/tsc/node自动检查+安装+降级 |
| 行为预判引擎 | `user-behavior-predictor.ts` | 识别操作模式, 提前准备资源 |
| 数据预判引擎 | `data-predictor.ts` | 预测数据需求, 主动获取并缓存 |
| 速率控制引擎 | `rate-limiter.ts` + `router-rate-limiter.ts` | 速率感知路由+子Agent任务分配 |

---

## 可用模型

| 模型 | 提供方 | 费用 | 适用场景 | 工具调用 |
|------|--------|------|----------|----------|
| **Agnes AI Flash** | agentai | 免费 | 日常对话、代码生成 | ✅ |
| **DS Flash** | cline | 免费 | 辅助开发 | ✅ |
| **GLM-4.7 Flash** | 智谱 | 免费 | 文本任务、工具调用 | ✅ |
| **GLM-4.6V Flash** | 智谱 | 免费 | 图片/视频分析 | ✅ |
| **MiniMax M3** | cline | 免费 | 社交闲聊 | ❌ |
| **小米 MiMo** | cline | 免费 | 长上下文、多模态 | ✅ |
| **DS V4 Pro** | deepseek | 付费 | 代码审查、安全分析 | ✅ |
| **GPT-4o mini** | openai | 付费 | 兜底 | ✅ |

---

## 自主触发矩阵

| AI 行为 | 触发条件 | 工具 |
|---------|----------|------|
| 绘制代码地图 | 首次进入项目 | `explore_project` |
| 追踪 import 链 | 分析模块依赖 | `explore_project {trace_from}` |
| 识别用户行业 | 消息含行业关键词 | `industry_insight {detect}` |
| 注入行业画像 | 对话涉及行业知识 | `industry_insight {profile}` |
| 提取行业洞察 | 对话结束自动执行 | `insightAccumulator.extractInsight()` |
| 系统健康自检 | 连续 2 次工具失败 | `self_diagnose {diagnose}` |
| 自动修复问题 | 自检发现可修复问题 | `self_diagnose {autofix}` |
| 清理临时文件 | 磁盘/缓存过大 | `self_diagnose {cleanup}` |
| 写入记忆 | 每次 LLM 调用成功 | `writeMemory()` (自动) |
| 推荐强模型 | 代码审查/安全分析 | `recommendModel()` |
| 压缩工具输出 | 输出 >1000 字符 | `compressAllToolResults()` |
| 注入匹配技能 | 消息匹配度 ≥6 分 | `smartDispatch()` |

---

## 快速开始

```bash
git clone https://github.com/yfgzpf/AgentAI-Platform.git
cd AgentAI-Platform

# 安装依赖
pnpm install

# 一键启动 (Gateway + GUI)
pnpm dev

# 打开 http://localhost:5173
```

### 配置 API Key（可选，免费模型可直接使用）

打开设置页面 → 粘贴 Key → 自动写入 `.env` → 路由器实时生效。

### 启动其他渠道

```bash
pnpm dev:desktop   # Tauri 桌面端
pnpm dev:qqbot     # QQ 机器人
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Tauri 2.0 (Rust) |
| 前端 | React 18 + TypeScript + Vite + Ant Design 5 |
| 网关 | Node.js 22 + Express + WebSocket |
| LLM 路由 | 5 维评分 + 4 Provider + 智能熔断 |
| 技能 | Python 3 + Node.js (按需发现) |
| 存储 | 文件系统 (.agentai/) + SQLite |

---

## 项目结构

```
agentai-platform/
├── packages/
│   ├── agentai-core/              # 类型定义 (轻量)
│   ├── agentai-gateway/           # Node.js 网关
│   │   ├── src/agentai-loop.ts          # 主循环
│   │   ├── src/llm-router.ts            # 智能路由
│   │   ├── src/model-classifier.ts      # 模型评分 + 智能推荐
│   │   ├── src/autonomous-explorer.ts   # 代码自主探索引擎
│   │   ├── src/insight-accumulator.ts   # 行业洞察积累引擎
│   │   ├── src/self-manager.ts          # 系统自管理引擎
│   │   ├── src/skill-orchestrator.ts    # 技能按需调度
│   │   ├── src/token-compressor.ts      # Token 语义压缩
│   │   ├── src/memory.ts                # 三层记忆 + 行业加权
│   │   ├── src/industry-engine.ts       # 装修建材行业引擎
│   │   ├── src/skill-evolver.ts         # 技能自进化
│   │   ├── src/smart-model-switcher.ts   # 智能模型切换
│   │   ├── src/builtin-tools-manager.ts  # 内置工具管理
│   │   ├── src/user-behavior-predictor.ts # 用户行为预判
│   │   ├── src/data-predictor.ts         # 数据预判
│   │   ├── src/rate-limiter.ts           # 速率限制监控
│   │   └── src/tools.ts                 # 50+ 工具定义
│   ├── agentai-gui/               # React 前端
│   ├── agentai-desktop/           # Tauri 桌面端
│   ├── agentai-qqbot/             # QQ 机器人
│   ├── agentai-skills/            # Python 技能集合
│   └── agentai-vscode/            # VSCode 扩展
├── docs/                          # 完整文档
└── assets/                        # 静态资源
```

---

## 路线图

- [x] 智能体核心 (LLM 路由 + 技能管理 + 记忆系统)
- [x] 50+ 工具 + Python 技能自动发现
- [x] 自主代码探索引擎
- [x] 行业洞察自主积累
- [x] 系统自管理 (自检 + 自动修复)
- [x] 智能模型推荐 + 一键配置 Key
- [x] Skills 按需注入 (节省 2800 token/次)
- [x] Token 4 重压缩机制
- [x] 记忆自动写入 (每次调用后)
- [x] Web GUI
- [x] 高风险操作审批流
- [x] Goal 模式 (断点续跑)
- [x] 对话内 SVG 图表生成
- [x] 音乐播放器 (AI 主动关怀 + 免费音乐库)
- [x] 智能模型切换 (熔断自动切换商用API)
- [x] 内置工具管理 (pnpm/npm/tsc 自动检查+安装)
- [x] 用户行为与数据预判
- [x] 速率限制控制 + 子Agent任务分配
- [x] SkillOpt 验证门控 + 训练循环
- [x] 文件上传 (图片+文档解析+全路径注入)
- [ ] Tauri 桌面端 (Windows/macOS/Linux)
- [ ] QQ 机器人适配
- [ ] VSCode 扩展
- [ ] 热更新系统
- [ ] CI/CD 自动构建三平台桌面端
- [ ] 模型市场 (插件式 LLM Provider)

---

## 贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feat/amazing-thing`)
3. 提交更改 (`git commit -m 'feat: add amazing thing'`)
4. 创建 Pull Request

---

## 协议

[Apache License 2.0](./LICENSE) — 自由使用、修改、分发。

---

<p align="center">
  <sub>授人以渔，不是授人以鱼</sub>
</p>
