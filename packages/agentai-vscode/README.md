# AgentAI — VSCode Extension

> 在 VSCode 中使用 AgentAI 智能助手，享受 ACP 协议驱动的 AI 编程体验。

## 功能特性

- **智能代码补全** — 基于项目上下文的 AI 补全建议
- **对话式编程** — 侧边栏对话窗口，支持多轮上下文
- **技能自动调用** — 检测任务类型，自动加载行业技能
- **内联文档生成** — 自动生成 README / 注释 / API 文档
- **智能调试辅助** — 错误分析 + 修复建议 + 测试生成
- **代码审查** — 跨文件语义分析，发现潜在问题

## 安装方式

### 方式一：从 VSCode Marketplace 安装（推荐）

在 VSCode 扩展面板搜索 "AgentAI" → 点击安装

### 方式二：从 .vsix 文件安装

```bash
code --install-extension agentai-vscode-x.x.x.vsix
```

### 方式三：开发模式安装

```bash
cd packages/agentai-vscode
pnpm install
code --extensionDevelopmentPath=.
```

## 使用方法

1. 打开命令面板: `Ctrl+Shift+P`
2. 输入 `AgentAI`:
   - `AgentAI: 开始新会话`
   - `AgentAI: 解释选中代码`
   - `AgentAI: 重构选中代码`
   - `AgentAI: 生成单元测试`
3. 点击活动栏的 AgentAI 图标打开聊天面板

## 配置项

| 设置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `agentai.gatewayUrl` | string | `http://localhost:3200` | Gateway 服务地址 |
| `agentai.model` | string | `auto` | 默认模型 |
| `agentai.skillAutoInvoke` | boolean | `true` | 自动识别并调用技能 |
| `agentai.contextLines` | number | `50` | 上下文行数 |

## 要求

- VSCode >= 1.85.0
- Node.js >= 18.0.0
- AgentAI Gateway 运行中

## 开发指南

```bash
pnpm install    # 安装依赖
pnpm compile    # 编译
pnpm watch      # 调试（按 F5）
pnpm package    # 打包 .vsix
pnpm lint       # Lint
```

## License

[Apache-2.0](../../LICENSE)
