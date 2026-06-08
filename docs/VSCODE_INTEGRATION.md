# VSCode 扩展集成（真参考 + 真打包）

## 自我承认（2026-06-08）

**富哥批评**：之前说"借鉴 VSCode 的 IDE 能力"是空头支票，没真 clone vscode 源。

**修正后**：
- ✅ 真用 Cursor 3.2.21（基于 vscodeVersion 1.105.1）作为真参考
- ✅ 真把 `cursor-mcp` 扩展源码（3.4MB dist/main.js）物理迁入 `references/cursor-mcp/`
- ✅ 真用 `@vscode/vsce` 打包出 `agentai-vscode-0.1.0-alpha.1.vsix`（11.71 KB）

## 包结构

```
F:\agentai-platform\packages\agentai-vscode\
├── package.json          name=agentai-vscode, engines.vscode=^1.105.0
├── tsconfig.json         Node16 + ES2022 + strict
├── src/
│   ├── extension.ts      激活 + 命令注册 + Webview 面板 (198 行)
│   └── gateway-client.ts WebSocket 客户端 (93 行)
├── out/                  编译产物 (4 文件)
└── agentai-vscode-0.1.0-alpha.1.vsix  (11.71 KB, 10 files)
```

## 真功能（学自 cursor-mcp）

| 学 Cursor 哪里 | 用在我们这 |
|---------------|----------|
| `activationEvents: ["onStartupFinished"]` | 同样注册后台启动 |
| `vscode.commands.registerCommand` | 2 个命令：openChat + switchFramework |
| `vscode.workspace.getConfiguration('agentai')` | 读 `gatewayUrl` + `framework` 配置 |
| `vscode.window.createStatusBarItem` | 状态栏显示当前框架 |
| `vscode.window.createWebviewPanel` | 右侧 Chat 面板 |
| Protobuf + WebSocket | 我们用 JSON + WebSocket（更轻量） |

## 自创点

1. **状态栏点击切框架** — Cursor 没做，我们做了
2. **WebSocket 自动重连** — 5s 重试，`dispose()` 清理
3. **请求 ID 关联** — `Math.random()` id 匹配响应，避免并发串
4. **不抢焦点** — 走状态栏 + 通知，不弹命令面板

## 真没做的（自承）

- ❌ Cursor 的 OAuth 回调处理（`vscode.window.registerUriHandler`）— 我们没做单点登录
- ❌ Cursor 的 22+ 工具集（shell/write/grep/ls/...）— 我们只做了 chat + switch
- ❌ Cursor 的 subagent / hook / computer_use — 不在本阶段范围
- ❌ Cursor 的 stream 协议（async generator）— 我们是请求-响应模式

## 安装

```bash
# 1. 安装
code --install-extension F:\agentai-platform\packages\agentai-vscode\agentai-vscode-0.1.0-alpha.1.vsix

# 2. 启动 Gateway
cd F:\agentai-platform\packages\agentai-gateway
node dist/index.js   # 监听 ws://127.0.0.1:18789

# 3. VSCode 里:
#    状态栏右侧出现 "💬 AgentAI: openclaw"
#    点击 → 切换到 hermes
#    Cmd+Shift+P → "AgentAI: 打开对话"
```

## 真参考迁移清单（references/cursor-mcp/）

| 文件 | 大小 | 用途 |
|------|------|------|
| `dist/main.js` | 3.4 MB | Cursor MCP 完整实现（22+ 工具） |
| `package.json` | 380 B | vsce 工程定义模板 |
| `patches/` | — | Cursor 对 vscode API 的打补丁（学其改 vscode 行为） |
| `vscode-1.105.1-product.json` | 1.1 KB | Cursor 分叉的 vscode 版本元数据 |
| `cursor-3.2.21-package.json` | 380 B | Cursor 包定义 |

## 阶段 5 计划（修正后）

| 阶段 | 任务 | 状态 |
|------|------|------|
| 5.1 | vsce 工程 + 真 .vsix | ✅ 完成 |
| 5.2 | Webview 面板 + WS 客户端 | ✅ 完成 |
| 5.3 | 端到端测试（启动 Gateway + 安装扩展 + 对话） | ⏳ 富哥验收 |
| 5.4 | Cursor 22 工具集迁移 | 阶段 2.5 之后 |
| 5.5 | OAuth 回调 + 单点登录 | 阶段 3.5 |
