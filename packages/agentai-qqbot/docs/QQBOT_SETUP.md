# AgentAI QQ Bot - 完整设置指南

> 5 分钟启动属于你自己的 QQ 智能体机器人

## 架构

```
QQ 群/私聊
  ↓ (腾讯 QQ 协议)
go-cqhttp (子进程) ←─── 用户自己下载二进制
  ↓ (反向 WebSocket)
agentai-qqbot (本包) ←─── Node.js 进程
  ↓ (HTTP /v1/qq/message)
agentai-gateway (端口 18789) ←─── 调度 LLM 调用
  ↓ (OpenAI 兼容协议)
agentai / deepseek / openai API
```

## 步骤

### 1. 下载 go-cqhttp

> 警告: QQ 官方不鼓励第三方客户端, 账号**有封号风险**, 建议用小号测试。

从 GitHub Release 下载对应平台:
- Windows: <https://github.com/Mrs4s/go-cqhttp/releases> (go-cqhttp-windows-amd64.exe)
- macOS: `go-cqhttp-darwin-amd64`
- Linux: `go-cqhttp-linux-amd64`

放入 `packages/agentai-qqbot/bin/` 目录:

```bash
# Windows (PowerShell)
mv go-cqhttp-windows-amd64.exe packages/agentai-qqbot/bin/go-cqhttp.exe

# Linux/macOS
mv go-cqhttp-darwin-amd64 packages/agentai-qqbot/bin/go-cqhttp
chmod +x packages/agentai-qqbot/bin/go-cqhttp
```

### 2. 创建 config.yml

参考 `bin/config.example.yml`（下一步会创建），关键配置:
```yaml
account:
  uin: 你的QQ号
  password: '' # 留空用扫码登录
sign-servers: [...] # 风险较高, 可不填
message:
  type: 'ws'  # 走反向 WebSocket
servers:
  - ws:
      address: 127.0.0.1:5700
      version: forward
```

### 3. 安装依赖 + 启动

```bash
# 安装
cd packages/agentai-qqbot
pnpm install

# 编译
pnpm build

# 配置 (一次性)
export AGENTAI_QQ_ACCOUNT=123456
export AGENTAI_QQ_AUTOSTART=1  # 自动启动 go-cqhttp 子进程

# 启动 (需先启动 gateway)
pnpm start
```

### 4. 测试

在 QQ 群 (或私聊) 发送消息, 应看到 bot 自动回复。

## 高级

### 不自动启动 go-cqhttp

如果想手动控制 go-cqhttp:
```bash
# 终端 1
./bin/go-cqhttp -config bin/config.yml

# 终端 2 (无需 autostart)
pnpm start
```

### 触发前缀

让 bot 只响应特定消息 (避免群里刷屏):
```bash
export AGENTAI_QQ_TRIGGER="/ai "
# 群里: "/ai 写首诗"
```

### 群白名单

只允许特定群:
```bash
export AGENTAI_QQ_GROUPS="123456789,987654321"
```

### 管理员命令

`src/client.ts` 已留 adminQQ 配置, 可在 `handleFrame` 里加:
```typescript
if (msg.user_id === admin && prompt.startsWith('/reload')) {
  // 重载配置
}
```

## 故障排查

| 症状 | 原因 | 修法 |
|---|---|---|
| go-cqhttp 一启动就退 | config.yml 格式错 | `cd bin && ./go-cqhttp -debug` 看日志 |
| WS 连不上 (go-cqhttp 日志) | 端口 5700 被占 | 改 config.yml 的 `servers.ws.address` |
| 收不到消息 | sign-server 失败 | 删 `sign-servers` 配置, 用扫码登录 |
| 发不出消息 | HTTP API 端口 (默认 5700) 未启 | 检查 go-cqhttp 启动日志 |
| 群里不响应 | 触发前缀或白名单不匹配 | 调 `AGENTAI_QQ_TRIGGER` / `AGENTAI_QQ_GROUPS` |
| 总是 401/无 LLM 回复 | AgentAI API key 错 | 在根 .env 填 `AGENTAI_API_KEY` |

## 风险声明

- QQ 第三方协议**有封号风险**, 仅限小号测试
- 群里机器人刷屏可能被群主踢
- agentai-qqbot 包不参与账号风控, 用户自负
