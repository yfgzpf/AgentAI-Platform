---
name: reverse-engineer-workflow
version: 1.0.0
description: 逆向复刻工作流 — 用 REA MCP 工具 (rea:*) 读懂陌生软件/网页/JS应用的实现思路, 按 analyze→diff→提炼→复刻方案 走, 每条结论带证据, 不抄对方代码。配合 reverse-engineer 子智能体
category: code
tags: [reverse-engineer, 逆向, 逆向复刻, REA, decompile, 反编译, analyze, 复刻, 看懂实现]
triggers:
  - 逆向
  - 逆向复刻
  - 看懂它怎么实现
  - 拆解这个软件
  - 分析这个网页怎么做到的
  - 反编译
  - REA
description_zh: 逆向复刻工作流 — 用 REA MCP 工具 (rea:*) 读懂陌生软件/网页/JS 应用的实现思路, 按 analyze→diff→提炼→复刻方案 走, 每条结论带证据, 不抄对方代码
description_en: Reverse-engineer workflow — use REA MCP tools to understand how an unfamiliar app/web/JS system works, follow analyze -> diff -> distill -> reimplement-plan, every conclusion with evidence, no code copying
riskLevel: low
author: AgentAI
testCommand: echo "reverse-engineer-workflow skill loaded"
---

# Reverse-Engineer Workflow — 读懂别人的系统, 用你的技术栈重写思路

看到陌生软件/网页/功能, 想搞懂它**怎么做到的** (不抄代码, 只学思路)。本技能把 REA 逆向能力固化成可复用流程。核心原则 —— **理解而非抄袭**：每条结论带证据 (file:line / 命令输出)，读懂后按用户自己的技术栈重写，不搬对方源码。

## 触发条件

- 用户说"逆向 / 逆向复刻 / 拆解 X / 看懂它怎么实现 / 分析这个网页怎么做到的 / 反编译 X"
- 用户丢一个本地文件路径 / URL / 打包好的应用，问"它内部怎么做的"

## 前置 (REA 能力现状, 如实说)

- **能跑**：本地文件 / JS 应用 / Electron 应用 / 网页 bundle / 归档 (.zip/.tgz/.asar) — REA 自动降级到这档, 开箱可用
- **需 Ghidra**：原生二进制 (.exe/.apk/.ipa) **深度反编译** — 本机没装 Ghidra 时 REA 自动降级, 只给概览不给函数级细节。要解锁需设 `GHIDRA_INSTALL_DIR` 指向 Ghidra 12.1.x
- REA 工具是 MCP 拉出来的 `rea:*` 前缀工具, 无需 API Key (本地跑)

## 五步工作流

### 1. 定位目标 (REA 分析前先确认对象在不在)

```
list_directory / read_file 看目标文件在不在本地
- 给的是 URL → 先 web_fetch 或 browser_navigate 抓下来, 让 REA 分析本地副本
- 给的是打包应用 (.asar/.apk/.ipa/.exe) → 直接用 rea:analyze_package
- 给的是网页 → rea:analyze_web (抓 bundle 静态分析)
```

### 2. 概览 (REA 第一步永远是 analyze, 拿到"它是什么 + 有哪些关键部件")

```
rea:analyze_package({ path: "目标" })   // 或 rea:analyze_web / rea:analyze_binary
```
REA 返回带 Evidence 的结构：入口点、关键模块、数据流、对外接口。**先读这个再往下**, 别上来就钻细节。

### 3. 拆解关键实现 (按概览指向的重点读)

- 关键算法/接口 → `read_file` 具体模块 + `search_codebase` 语义搜相似模式
- 两个版本/两个实现对比 → `rea:diff_versions` (REA 会出结构化 diff, 标出行为差异)
- 原生函数级 (有 Ghidra 时) → `rea:decompile_app` + `rea:annotate-native-function`
- 行为验证 → `rea:capture-web-screenshot` / `rea:capture-browser-scenario` (跑个场景看实际表现)

每条拆解**必须带证据**：`rea:xxx` 的输出片段 或 `file:line`。没有证据的结论 = 猜测, 标 UNRESOLVED。

### 4. 提炼可复刻点 (用你的话, 不引用对方源码)

把"关键接口 / 核心算法 / 数据流 / 状态机"用**自己的话**复述清楚。这一步是 REA 的核心价值 —— 把对方黑盒变白盒, 但**只描述思路, 不搬代码原文** (对方代码有版权/许可限制)。

### 5. 出复刻方案 (按用户技术栈)

```
用户技术栈: React+TS / Node / 原生 ...
→ 给 1-3 个方案, 每处标明取舍 (为什么选 A 不选 B)
→ 不写完整可运行代码 — 只给思路骨架, 实际代码由主 Agent / 用户写
```

## 输出格式 (逆向复刻报告)

```
## 逆向复刻报告: [目标功能]
- 目标: [用户原话]
- 它是什么: [REA analyze 概览, 1-3 句]
- 理解: [关键接口/算法/数据流, 每条带证据 file:line 或 rea 输出片段]
- 复刻方案: [用户技术栈下 1-3 个, 含每处取舍]
- 不确定点: [哪些结论缺证据, 需要用户补充 / 需装 Ghidra 才能确认]
```

## 红线 (与 reverse-engineer 子智能体同源)

- **理解不抄袭**：可以读懂对方思路, 但**不原样搬代码**进用户项目 (版权/许可)
- **不验证不收**：每个"它是怎么做的"结论, 找不到证据就标 UNRESOLVED, 不编造
- **只分析不改**：本技能是分析者, 不修改任何文件, 不写可运行代码 (那是主 Agent 的活)
- **原生二进制要 Ghidra**：没装时如实说"已降级, 函数级需 GHIDRA_INSTALL_DIR", 别假装能深度反编译

## 工具清单 (REA + 本地)

| 工具 | 用途 | 备注 |
|------|------|------|
| `rea:analyze_package` | 解包+分析 JS/Electron/归档 | 最常用第一步 |
| `rea:analyze_web` | 抓网页 bundle 静态分析 | URL 目标用 |
| `rea:analyze_binary` | 二进制概览 | 原生需 Ghidra 才深 |
| `rea:decompile_app` | 反编译 | 原生需 Ghidra |
| `rea:diff_versions` | 两版本结构化 diff | 对比行为变化 |
| `rea:capture-web-screenshot` | 跑场景截图取证 | 行为验证 |
| `list_directory` / `read_file` / `search_codebase` | 本地拆解 | 配 REA 用 |

## 不适用

- 用户要的是"抄过来直接用" → 不行 (版权 + 许可), 本技能只给思路
- 目标是闭源且**无本地副本** (只能在线看) → 先 web_fetch 抓下来再分析, 抓不到就标"缺本地目标"
- 要深度反编译原生但没装 Ghidra → 如实说降级了, 别硬出函数级结论
