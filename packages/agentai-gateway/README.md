# @agentai/gateway

AgentAI 智能体网关 — Node.js 实现

## 职责

- **消息路由**: WebSocket / HTTP 消息分发
- **会话管理**: 多渠道会话状态（Redis / SQLite）
- **智能体调度**: 主控 / 引导 / 专业智能体
- **4 渠道适配器**: Web / Desktop / QQ / VSCode / Telegram
- **LLM 智能路由**: AgentAI ↔ DeepSeek 智能切换 + 熔断 + 成本控制
- **钩子触发**: pre/post 消息钩子

## 启动

```bash
# 开发模式
pnpm dev

# 生产模式
pnpm build
pnpm start
```

## 配置

读取 `~/.agentai/config.yaml` + 环境变量。

## 端口

默认 `127.0.0.1:18789`（Tauri 桌面壳连接用）。

## 状态

🚧 阶段 1 落地（基础脚手架）。
