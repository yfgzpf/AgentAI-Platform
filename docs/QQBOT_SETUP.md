# QQ 机器人设置指南

> AgentAI Platform QQ Bot — 独立进程 + 官方 API

---

## 前置条件

1. **QQ 开放平台账号**: https://q.qq.com/ → 创建机器人
2. 获取 `AppID` 和 `AppSecret`
3. Node.js >= 22 (项目的 engine 要求)

---

## 模式选择

| 模式 | 环境变量 | 说明 |
|------|---------|------|
| **官方 SDK** (推荐) | `AGENTAI_QQ_MODE=official` | QQ 官方机器人 API, 稳定, 支持私聊/群@ |
| go-cqhttp | `AGENTAI_QQ_MODE=go-cqhttp` | 兼容旧版, 需自己下载二进制 |

---

## 快速开始 (官方 SDK)

```bash
# 1. 设置环境变量
set AGENTAI_QQ_APPID=你的AppID
set AGENTAI_QQ_SECRET=你的AppSecret
set AGENTAI_QQ_SANDBOX=true    # 如需沙箱环境

# 2. 启动 Gateway (如果还没跑)
pnpm dev:gateway

# 3. 启动 QQ Bot
pnpm --filter agentai-qqbot dev
```

---

## 配置项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `AGENTAI_QQ_MODE` | `official` | 模式选择 |
| `AGENTAI_QQ_APPID` | (必填) | QQ 机器人 AppID |
| `AGENTAI_QQ_SECRET` | (必填) | QQ 机器人 AppSecret |
| `AGENTAI_QQ_SANDBOX` | `false` | 是否使用沙箱 API |
| `AGENTAI_QQ_ADMINS` | (空) | 管理员 QQ 号, 逗号分隔 |
| `AGENTAI_QQ_GROUPS` | (空) | 白名单群号, 逗号分隔 |
| `AGENTAI_QQ_TRIGGER` | (空) | 触发前缀, 留空=所有消息 |
| `AGENTAI_GATEWAY_URL` | `http://127.0.0.1:18789` | Gateway 地址 |

---

## 支持的命令

在 QQ 私聊/群聊输入 (群聊需 @机器人):

| 命令 | 作用 |
|------|------|
| `/help` | 显示帮助 |
| `/new` | 清空上下文, 开始新对话 |
| `/abort` | 中断正在生成的回复 |
| `/compact` | 压缩上下文, 释放 token |
| `/retry` | 重试上次回复 |
| `/model <name>` | 切换模型 (agentai/deepseek/openai) |
| `/effort low/medium/high/max` | 设置 AI 努力程度 |
| `/plan review/auto/yolo` | 设置计划执行模式 |
| `/btw <问题>` | 顺便问 (不中断当前对话) |

---

## 消息体量限制

QQ 单条消息约 1500 字节。超过限制会自动分片发送 (在换行/空格等自然断点处拆分)。

---

## 架构

```
QQ 用户 ──> QQ 服务器 ──> ws(s)://api.sgroup.qq.com ──> QQOfficialBot
                                                            │
                                        HTTP /v1/qq/message ▼
                                                    AgentAI Gateway
                                                            │
                                                        AgentAILoop
```

- QQ Bot 和 Gateway 是**独立进程**, 通过 HTTP 通信
- Bot 每 30s 向 Gateway 发心跳, 状态可在 GUI 设置页查看
- Gateway 挂掉不影响 Bot 本身 (Bot 自动重连)

---

## 常见问题

**Q: 提示 "QQ WebSocket closed before authentication"**
A: 检查 AppID/AppSecret 是否正确, 沙箱环境是否开关匹配。

**Q: 群聊不回复**
A: 检查 `AGENTAI_QQ_GROUPS` 白名单, 留空=所有群。群内需要 @机器人。

**Q: Gateway 离线**
A: 先启动 `pnpm dev:gateway`, Bot 会等 Gateway 上线再发请求。

**Q: 我用的是旧版 go-cqhttp**
A: 设置 `AGENTAI_QQ_MODE=go-cqhttp`, 然后把 go-cqhttp 二进制放 `packages/agentai-qqbot/bin/`。
