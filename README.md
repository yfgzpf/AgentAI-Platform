<p align="center">
  <img src="./packages/agentai-gui/public/favicon.svg" alt="PulseFlow" width="120">
</p>

<h1 align="center">PulseFlow</h1>
<h3 align="center">让智能体理解系统的生命状态</h3>
<p align="center"><em>融合中医辨证思维的状态感知型智能体框架</em></p>

<p align="center">
  <strong>望闻问切 · 因证施治 · 越用越懂你的 AI 智能体</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
  <a href="#"><img src="https://img.shields.io/badge/version-0.1.0--alpha-orange" alt="Version"></a>
  <a href="#可用模型"><img src="https://img.shields.io/badge/model-6款免费模型-green" alt="Free Models"></a>
  <a href="#-快速开始"><img src="https://img.shields.io/badge/启动只需-pnpm%20dev-brightgreen" alt="Quick Start"></a>
</p>

<p align="center">
  <sub>Web GUI · Tauri 桌面应用 · QQ 机器人 · VSCode 扩展 — 四端一体，一套后端</sub>
</p>

---

## ✨ 为什么选择 PulseFlow？

> **不是又一个聊天框。是一个会成长、有记忆、懂你行业的 AI 工作伙伴。**

你可能用过 ChatGPT、试过 Cursor、看过各种 AI 助手。它们都很强，但都有一个共同的问题：

**🔁 每次对话都是从零开始。**

PulseFlow 不一样。

| 你想要的 | 其他 AI | **PulseFlow** |
|---------|---------|-------------|
| 昨天教过它用 pnpm 不用 npm | 今天又忘了 | ✅ **记住你的偏好，跨会话不遗忘** |
| 免费就能用，不想每月交 $20 | ❌ 付费或限流 | ✅ **10+ 免费模型自由切换** |
| 中文代码/文档/变量名能理解 | ⚠️ 英文优先，中文二等公民 | ✅ **中文原生优化，提示注入防护** |
| 写代码的同时还能画图、语音、搜索 | 需要切换 3 个工具 | ✅ **多模态内置：图/视频/3D/TTS/音乐** |
| 数据不想传到云端 | ❌ 必须联网 | ✅ **完全本地运行，数据不出机器** |
| 高风险操作（删文件/改配置） | 要么每次问，要么从不问 | ✅ **一次信任，永久生效** |
| 它能越来越聪明 | ❌ 用一年和第一天没区别 | ✅ **自我进化：从错误中学习规则** |
| ALTES 核心 | ❌ 直接开干，经常跑偏 | ✅ **先诊后治：望闻问切 → 因证施治** |

---

## 🎬 30 秒体验

```bash
git clone https://github.com/yfgzpf/AgentAI-Platform.git
cd AgentAI-Platform
pnpm install
pnpm dev
# 打开 http://localhost:5173 → 开始对话
```

**不需要 API Key 就能开始聊天。** 免费模型已预配置，打开即用。

想解锁更强能力？ 设置页粘贴 Key → 自动生效 → 路由器智能分配任务。

---

## 🧠 核心设计理念：岐黄之道，先诊后治

> **《黄帝内经·素问》**："治病必求于本，本立而道生。"

传统 AI 助手的问题：**头痛医头，脚痛医脚**——你问什么，它答什么，从不追问背后的真实需求。

你说"帮我做个网站"，它立刻开始写代码——做到一半才发现需求没搞清楚，推倒重来。

### 岐黄四诊在 PulseFlow 中的映射

中医诊疗讲究**"望闻问切"四诊合参**，PulseFlow 将其转化为 AI 的决策链路：

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PulseFlow | 岐黄  诊断决策链路                         │
├──────────┬──────────┬──────────┬──────────┬─────────────────────────┤
│  中医    │   望     │   闻     │   问     │   切     │     治      │
│  四诊    │ 观其色   │ 听其声   │ 问其症   │ 摸其脉   │   开方      │
├──────────┼──────────┼──────────┼──────────┼──────────┼─────────────┤
│  PulseFlow │ 任务感知 │ 缺口分析 │ 探询追问 │ 结构化   │ 方案→执行   │
│  (PulseFlow) │          │          │          │ 诊断     │ →调方       │
├──────────┼──────────┼──────────┼──────────┼──────────┼─────────────┤
│  具体    │ 分析用户 │ 识别信息 │ 主动询问 │ 评估置信 │ 制定治疗    │
│  行为    │ 真实意图 │ 缺失点   │ 澄清歧义 │ 度和风险 │ 计划并验证  │
│          │ (望)     │ (闻)     │ (问)     │ (切)     │ (治)        │
└──────────┴──────────┴──────────┴──────────┴──────────┴─────────────┘
```

### 因证施治：不同问题，不同治法

> **《伤寒论》**："观其脉证，知犯何逆，随证治之。"

ALTES（PulseFlow 岐黄诊断引擎）不追求"一招鲜"，而是根据**任务复杂度**和**风险等级**选择不同治法：

| 任务特征 | 对应中医治法 | PulseFlow 策略 |
|---------|-------------|-----------|
| 简单明确 | **单刀直入** | 直接执行，快速响应 |
| 需求模糊 | **先诊后治** | 望闻问切，澄清后再动手 |
| 复杂项目 | **分阶段调理** | 拆解子任务，逐步验证 |
| 高风险操作 | **慎之又慎** | 多视角验证，安全审批 |
| 出错后 | **调方换药** | 诊断错误原因，调整方案 |

### 实际效果对比

| 场景 | 传统 AI (头痛医头) | PulseFlow 岐黄 (辨证施治) |
|------|-------------------|-----------------|
| "帮我做个电商网站" | 直接写代码（经常跑偏） | 先问：需要哪些功能？用户系统？支付？ |
| "这段代码有问题" | 盲目修改 | 先诊断：是语法错误？逻辑错误？性能问题？ |
| "优化这个函数" | 直接重写 | 先分析：瓶颈在哪？时间复杂度？空间复杂度？ |

这不是慢，这是**精准**——**《素问》**："谨守病机，各司其属。"

---

## 📚 理念溯源：中医智慧 + 现代工程

PulseFlow（岐黄诊断引擎）的设计深受中医典籍启发，在代码中忠实映射了中医经典的治疗策略：

| 典籍 | 核心思想 | 在 PulseFlow 中的体现 |
|------|---------|----------------------|
| **《黄帝内经》** | "上工治未病" | 任务感知，提前发现风险 (`task-perception.ts`) |
| **《伤寒论》** | "随证治之，辨证论治" | 根据任务类型选择不同策略 (`diagnosis-engine.ts`) |
| **《千金方》** | "大医精诚" | 自我验证，追求精准 (`step-verifier.ts`) |
| **《温病条辨》** | "三焦辨证，分阶段治疗" | 复杂任务拆解，分步执行 (`plan-assembler.ts`) |
| **《本草纲目》** | "君臣佐使，配伍有度" | 核心+辅助+制约+调和工具编排 (`prescription-engine.ts`) |

> **注**：PulseFlow 借鉴中医是**理念层面**的——我们学习"先诊后治""因证施治"的思维模式。它本质上是一个**工程系统**。

---

### 7️⃣ 岐黄诊断引擎 — 先诊后治，因证施方

基于《黄帝内经》"四诊合参"思想，PulseFlow 在每次执行前都会经过**望闻问切**四步：

```typescript
// 1. 望 - 任务感知 (task-perception.ts)
const perception = await perceiveTask(messages);
// → { complexity: 'complex', ambiguity: 0.3, gapList: [...] }

// 2. 闻 - 缺口分析 (gap-analyzer.ts)  
if (perception.suggestedAction === 'ask') {
  return { type: 'clarification_needed', gaps: perception.gapList };
}

// 3. 问 - 主动追问 (intent-clarifier.ts)
// 模糊时自动追问，不盲目猜测

// 4. 切 - 诊断决策 (diagnosis-engine.ts)
const diagnosis = await diagnoseTask(perception, context);
// → { confidence: 0.85, riskLevel: 'medium', recommendedApproach: 'multi_step' }

// 5. 开方 (prescription-engine.ts)
const prescription = await prescribe(diagnosis, perception);
// → { steps: [...], verificationPoints: [...] }
```

| 中医治法 | PulseFlow 策略 | 代码实现 |
|---------|-------------|---------|
| **单刀直入** | 简单任务直接执行 | `quick-diagnose()` → direct 策略 |
| **先诊后治** | 需求模糊时追问 | `IntentClarifier` → clarify 策略 |
| **分阶段调理** | 复杂任务拆解 | `plan-assembler` → planning 策略 |
| **慎之又慎** | 高风险操作审批 | `sandbox` + `audit-log` |
| **调方换药** | 出错后调整方案 | `step-verifier` → `adjustPlan()` |

---

### 1️⃣ 跨会话记忆 — 它真的在听你说的话

```
第一次对话: "我的项目用 pnpm，别用 npm"
    ↓
AI 记住 → 写入 ~/.agentai/memory/
    ↓
三天后新会话: "帮我装个依赖"
    ↓
自动使用 pnpm install ✅ （不用再提醒）
```

**三层记忆架构：**
- 📝 **工作记忆** — 当前任务的上下文（每 10 轮自动摘要）
- 🧠 **持久记忆** — 跨会话的经验和偏好（自动写入）
- 🏭 **行业洞察** — 从对话中提取的行业知识（跨项目积累）

### 2️⃣ 自我进化 — 它从自己的错误中学习

```
AI 尝试用 && 连接 PowerShell 命令 → 失败
    ↓
 evolve_prompt({ action: 'add', rule: 'PowerShell 不支持 &&，改用 ;' })
    ↓
存入 ~/.agentai/evolved-rules.json
    ↓
下次对话自动加载 → 永远不再犯同样的错
```

这不是科幻。这是 `evolve_prompt` + `create_tool` 两个原生能力——AI 可以修改自己的行为规则，甚至运行时自创工具脚本。

### 3️⃣ 智能模型路由 — 免费优先，强力按需（因症用药）

```
你说 "你好"     → Agnes Flash（免费）→ 0 成本 ✅
你说 "审查代码" → DeepSeek V4 Pro（付费）→ 自动推荐强模型
你说 "生成图片" → 智谱 GLM-4.6V（免费视觉模型）→ 自动切换
免费模型触发限流  → 无缝切商用 API → 任务不中断
```

**5 维智能评分**：复杂度 + 上下文适配 + 成本 + 历史成功率 + 延迟  
**熔断机制**：连续失败自动切换，恢复后自动回来  
**成本守卫**：每轮 $0.20 上限 / 每天 $5.00 上限，防止意外烧钱

### 4️⃣ 自主代码探索 — 打开项目就懂（望闻问切，初诊即懂）

首次进入项目时，AI 自动：
1. 🔍 识别项目类型（Next.js / Vite / Express / Monorepo ...）
2. 🗺️ 定位入口文件和关键目录
3. 📊 绘制依赖关系图
4. 🏷️ 识别设计模式（Factory / Observer / Router ...）
5. 💾 缓存结果，5 分钟内不重复扫描

**你不用告诉它项目长什么样——它自己会看。**

### 5️⃣ 安全审批 — 信任，但验证（慎之又慎，因证施治）

```
AI 尝试删除文件 → 🔴 高风险操作！
    ↓
弹出审批卡片 → 你点「允许」或「拒绝」
    ↓
   ┌──────────────────────────────┐
   │ ☑️ 信任此类操作（不再询问）    │  ← 点这个
   └──────────────────────────────┘
    ↓
后续同类操作自动放行 ✅
```

**风险分级**：low / medium / high / critical — 不同级别不同处理策略  
**审计日志**：所有操作全记录，可追溯  
**物理备份**：修改前自动备份，`undo_edit` 一键回滚

### 6️⃣ 多模态 — 一个助手干所有事（一方多效，面面俱到）

| 能力 | 说明 |
|------|------|
| 🎨 **图片生成** | 文生图，内置 |
| 🎙️ **TTS 语音** | MOSS-TTS-Nano，可离线 |
| 🎵 **音乐播放** | 内置免费音乐库，AI 主动关怀 |
| 🎥 **视频理解** | GLM-4.6V 视觉模型 |
| 🏗️ **3D 建模** | Three.js 可视化 |
| 📊 **SVG 图表** | 对话内渲染流程图/架构图/思维导图 |
| 📄 **文档解析** | 拖拽上传 xlsx/pdf/docx/csv |

### 7️⃣ 行业知识引擎 — 越用越懂你的行业（久病成良医）

```
你在做装修建材行业
    ↓
AI 从对话中提取: "防水"、"隐蔽工程"、"验收标准"...
    ↓
持久化到 ~/.agentai/insights/
    ↓
下次聊相关话题 → 自动加载行业画像 → 回答更专业
```

**纯本地 RAG**：BM25 中文分词 + 文档上传 + 自动检索，数据不出机器。

---

## 🏗️ 架构设计：分层解耦，薄包装（君臣佐使，各司其职）

ALTES（PulseFlow 岐黄诊断引擎）采用**薄包装架构**——不重复造轮子，而是把优秀的开源能力串成链路：

```
┌─────────────────────────────────────────────────────────────────┐
│                      PulseFlow | 岐黄 架构分层                        │
├──────────────┬──────────────────────────────────────────────────┤
│   认知决策层   │ 任务感知 → 诊断引擎 → 计划组装 → 步骤验证          │
│   (岐黄)      │ (望闻问切 → 因证施治 → 调方)                      │
├──────────────┼──────────────────────────────────────────────────┤
│   调度引擎层   │ LLM 路由 · 工具调用 · 上下文管理 · 记忆系统        │
│   (AgentAI)   │ (融合 Reasonix + Hermes + ZhiY.AI)               │
├──────────────┼──────────────────────────────────────────────────┤
│   技能执行层   │ 代码执行 · 文件操作 · 浏览器 · 桌面自动化          │
│   (生态)      │ (Python/Node 技能脚本)                           │
├──────────────┼──────────────────────────────────────────────────┤
│   模型接入层   │ Agnes · DeepSeek · OpenAI · NVIDIA · 商汤 ...     │
│   (开放)      │ (OpenAI 兼容接口)                                │
└──────────────┴──────────────────────────────────────────────────┘
```

**设计原则**：
- ✅ **薄包装**：复用现有优秀模块，只写胶水代码
- ✅ **渐进式**：从 60% 到 100%，不推倒重来
- ✅ **可插拔**：每层可独立替换，不影响其他层

---

## 🛠️ 技术实现：岐黄诊断链路（望闻问切 → 因证施治）

### 核心数据流

```typescript
// 1. 任务感知 (望)
const perception = await perceiveTask(messages);
// → { taskType: 'coding', complexity: 'complex', ambiguity: 0.3, gapList: [...] }

// 2. 信息缺口分析 (闻)
if (perception.suggestedAction === 'ask') {
  return { type: 'clarification_needed', gaps: perception.gapList };
}

// 3. 结构化诊断 (切)
const diagnosis = await diagnoseTask(perception, context);
// → { confidence: 0.85, riskLevel: 'medium', recommendedApproach: 'multi_step' }

// 4. 制定治疗方案 (治)
const plan = assemblePlan(diagnosis, perception);
// → { steps: [...], verificationPoints: [...], rollbackStrategy: '...' }

// 5. 执行并验证
for (const step of plan.steps) {
  const result = await executeStep(step);
  const verification = await verifyStep(step, result);
  if (!verification.passed) {
    await adjustPlan(plan, verification.issues);
  }
}
```

### 复用的现有能力（君臣佐使，各司其职）

| 诊断链路 | 复用模块 | 来源 |
|---------|---------|------|
| 任务感知 | `classifyComplexity()` | 现有 model-classifier |
| 意图澄清 | `IntentClarifier` | 现有 meta/ 目录 |
| 置信度评估 | `ConfidenceEstimator` | 现有 meta/ 目录 |
| 策略选择 | `StrategySelector` | 现有 meta/ 目录 |
| 自我验证 | `SelfEval` | 现有 judge/ 目录 |

**不是重写，是串联——像中医配伍一样把独立能力串成诊断链路。**

---

### 8️⃣ 自动验证闭环 — 写完代码自己检查（自我疗愈）

```
AI 写文件 → 自动运行 tsc --noEmit
    ├── 有错误 → 把错误信息返回给 AI → AI 自动修复 → 再验证
    └── 无错误 → 继续下一步 ✅
```

即使弱模型第一次写错了，循环收敛也能到正确结果。**把弱模型变强的杠杆。**

---

## 🆚 和主流方案对比

| | ChatGPT | Cursor | Cline | **AgentAI** |
|---|---------|--------|-------|-------------|
| **价格** | $20/月 | $20/月 | 免费 | **免费模型优先，付费可选** |
| **开源** | ❌ | ❌ | ✅ MIT | **✅ Apache 2.0** |
| **数据隐私** | 云端 | 云端 | 本地 | **本地优先，完全可控** |
| **中文优化** | ⚠️ | ⚠️ | ⚠️ | **✅ 原生中文** |
| **多模态** | 分产品 | ❌ | ❌ | **✅ 内置 7 种** |
| **跨会话记忆** | ❌ | 部分 | ❌ | **✅ 三层架构** |
| **自我进化** | ❌ | ❌ | ❌ | **✅ 原生能力** |
| **多端统一** | Web | IDE | VSCode | **Web+桌面+QQ+VSCode** |
| **模型数量** | 1-2 | 1-2 | 可配 | **8+ Provider（含岐黄诊断）** |
| **安全审批** | ❌ | ❌ | ❌ | **✅ 风险分级+审计** |

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 9（推荐）
- **Python 3**（技能系统需要）

### 安装 & 启动

```bash
# 1. 克隆仓库
git clone https://github.com/yfgzpf/AgentAI-Platform.git
cd AgentAI-Platform

# 2. 安装依赖
pnpm install

# 3. 一键启动（Gateway + Web GUI）
pnpm dev

# 4. 浏览器打开 http://localhost:5173
#    🎉 开始聊天！免费模型已预配置，无需 API Key
```

### 配置增强模型（可选）

1. 打开设置页面（右上角齿轮图标）
2. 粘贴 API Key（DeepSeek / OpenAI / 智谱 ...）
3. 保存 → 自动写入 `.env` → 路由器实时生效

### 启动其他渠道

```bash
pnpm dev:desktop   # Tauri 桌面端（Windows/macOS/Linux）
pnpm dev:qqbot     # QQ 机器人
```

---

## 💰 可用模型

| 模型 | 提供方 | 费用 | 适用场景 |
|------|--------|------|----------|
| **Agnes AI Flash** | agentai | 🆓 免费 | 日常对话、代码生成 |
| **DS Flash** | cline | 🆓 免费 | 辅助开发 |
| **GLM-4.7 Flash** | 智谱 | 🆓 免费 | 文本任务、工具调用 |
| **GLM-4.6V Flash** | 智谱 | 🆓 免费 | 图片/视频分析 |
| **MiniMax M3** | cline | 🆓 免费 | 社交闲聊 |
| **小米 MiMo** | cline | 🆓 免费 | 长上下文、多模态 |
| **DS V4 Pro** | DeepSeek | 💰 付费 | 代码审查、安全分析 |
| **GPT-4o mini** | OpenAI | 💰 付费 | 兜底备用 |

> **💡 提示**：日常使用 6 款免费模型完全够用。付费模型只在需要强推理时自动启用。

---

## 🏗️ 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| **桌面壳** | Tauri 2.0 (Rust) | 5-10MB 安装包，跨三平台 |
| **前端** | React 18 + TypeScript + Vite + Ant Design 5 | 15 个功能页面 |
| **网关** | Node.js 22 + Express + WebSocket | 核心运行时 |
| **LLM 路由** | 5 维评分 + 8 Provider + 智能熔断 | 免费优先，无缝切换 |
| **技能系统** | Python 3 + Docker 沙箱 | 25 个技能目录，12 个可执行 |
| **存储** | 文件系统 + SQLite (FTS5) | 纯本地，零外部依赖 |

---

## 📁 项目结构

```
agentai-platform/
├── packages/
│   ├── agentai-core/              # 类型定义
│   ├── agentai-gateway/           # 🔥 核心运行时 (主循环 + 路由 + 工具)
│   │   ├── src/
│   │   │   ├── agentai-loop.ts    # 主循环引擎 (上下文构建/审批/进化)
│   │   │   ├── llm-router.ts      # 智能路由门面 (熔断/缓存/成本守卫)
│   │   │   ├── tool-registry.ts   # 工具注册中心 (57+ 工具, 风险分级)
│   │   │   ├── sandbox/           # 安全沙箱 (allow/deny/prompt)
│   │   │   ├── memory.ts          # 三层记忆系统
│   │   │   ├── evolution.ts       # 自进化引擎
│   │   │   ├── industry-engine.ts # 行业知识引擎
│   │   │   ├── tools.ts           # 50+ 工具定义
│   │   │   └── ...               # 100+ 源文件
│   ├── agentai-gui/               # React 前端 (15 页)
│   ├── agentai-desktop/           # Tauri 桌面端
│   ├── agentai-qqbot/             # QQ 机器人
│   ├── agentai-skills/            # Python 多模态技能 (25 个)
│   ├── agentai-vscode/            # VSCode 扩展
│   └── agentai-audit/             # 审计日志
├── docs/                          # 架构文档 / 集成文档
└── assets/                        # 静态资源
```

---

## 🗺️ 路线图

### ✅ 已完成
- [x] 智能体核心（LLM 路由 + 技能管理 + 记忆系统）
- [x] 50+ 内置工具 + Python 技能自动发现
- [x] 自主代码探索引擎（项目地图 + 依赖追踪）
- [x] 行业洞察自主积累 + RAG 知识库
- [x] 系统自管理（健康自检 + 自动修复）
- [x] 智能模型路由（5 维评分 + 熔断切换 + 成本守卫 + **岐黄因症选模**）
- [x] Token 4 重压缩（节省 70-85%）+ **岐黄诊断引擎**
- [x] 自进化系统（evolve_prompt + create_tool + **岐黄诊断闭环**）
- [x] 安全审批流（风险分级 + 信任白名单 + **岐黄审计日志**）
- [x] 自动验证闭环（写→验→修→再验）
- [x] 多模态（图片/TTS/音乐/3D/SVG 图表/文档解析 + **岐黄诊断**）
- [x] Web GUI（15 个功能页面）
- [x] Goal 模式（目标驱动 + 断点续跑）
- [x] 智能追问（歧义检测 + 置信度分流 + **岐黄诊断引擎**）
- [x] 任务拆解（plan_task + 进度面板）
- [x] IDE 状态感知
- [x] 中文提示注入扫描（20+ 正则）

### 🚧 进行中
- [ ] Tauri 桌面端三平台打包（CI/CD 已就绪）
- [ ] QQ 机器人生产适配
- [ ] VSCode 扩展完善
- [ ] 热更新系统

### 📌 规划中
- [ ] Plugin System 正式化（Plugin API v1）
- [ ] 模型市场（插件式 LLM Provider）
- [ ] OpenTelemetry 可观测性
- [ ] DI 容器引入（测试友好）
- [ ] VitePress 文档站

---

## 🤝 贡献

我们欢迎任何形式的贡献！

```bash
# 1. Fork 本仓库
# 2. 创建特性分支
git checkout -b feat/amazing-feature

# 3. 提交更改（遵循 Conventional Commits）
git commit -m 'feat: add amazing feature'

# 4. 创建 Pull Request
```

**特别需要帮助的方向：**
- 🔴 主循环 `agentai-loop.ts` 拆分重构（当前 3400+ 行）
- 🟡 测试覆盖补充（核心路径测试）
- 🟢 文档翻译（英文 README / 国际化）
- 🔵 技能贡献（Python 多模态技能）

查看 [`AGENTS.md`](./AGENTS.md) 了解项目的 AI 编码规范。

---

## 📄 协议

[Apache License 2.0](./LICENSE) — 自由使用、修改、分发，包括商业用途。

---

## 💬 别人的评价

> **"这是一个被严重低估的项目 — 它有自我进化的骨架，只差一颗更强的大脑。"**
> 
> — Claude (Anthropic) 在 Trae IDE 中对本项目的真实评价 (2026-06-21)

> **"能力天花板极高、工程地板待抬高。它在架构远见上已经超越了大多数 1.0 版本的开源 Agent 框架。"**
> 
> — Tabbit (E2B AI Agent) 深度代码审查报告 (2026-07-01)

---

## 🙏 致谢

本项目的设计理念融合了以下优秀框架的精华：

- **Reasonix** — Cache-First 上下文管理 + 并行安全声明
- **Hermes** — 30+ 平台适配器理念 + 多端统一
- **OpenClaw** — MCP 工具协议集成
- **WorkBuddy** — 人机协作审批模式

并在此基础上创造了 **5 个原创概念**：
1. **🧠 智能路由门面** — 三维评分 + 熔断 + 成本守卫
2. **🛡️ 中文提示注入扫描** — 20+ 中文正则防护
3. **🔄 反思门控** — SkillOpt 验证 + 训练循环
4. **🤝 信任模式** — 一次审批，永久生效
5. **👁️ 岐黄诊断引擎** — 望闻问切 → 因证施治（Phase 1: 认知完整，施治待补）

---

<p align="center">
  <strong>授人以渔，不是授人以鱼。</strong><br>
  <strong>这个项目有自我进化的骨架 —— 缺的可能是你的一份 Star 或 PR。</strong><br>
  <em>PulseFlow — 让智能体理解系统的生命状态。</em><br>
  <br>
  <a href="https://github.com/yfgzpf/AgentAI-Platform">⭐ Star</a> ·
  <a href="https://github.com/yfgzpf/AgentAI-Platform/issues">🐛 反馈问题</a> ·
  <a href="https://github.com/yfgzpf/AgentAI-Platform/discussions">💬 参与讨论</a>
</p>
