# AgentAI Platform — 编码规范 (v1.0)

> 生效日期: 2026-06-08
> 来源: 全库审查发现的 6 类 P0/P1 问题
> 违反后果: 代码审查不通过

---

## 规则 1: 路径绝对禁止盘符硬编码

**禁止**:
```typescript
// ❌ 以下写法不可接受
'F:/agentai-platform/.env'
'C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe'
```

**必须使用**:
```typescript
// ✅ 优先方案: 环境变量 + process.cwd() + path.resolve
const envPath = process.env.AGENTAI_ENV_PATH || path.resolve(process.cwd(), '.env');

// ✅ Python 路径: AGNES_PYTHON env var > PATH 查找
const py = process.env.AGNES_PYTHON || 'python3';
```

**违规范例**（已修复）:
- `agentai-gateway/src/index.ts` — 曾硬编码 `F:/agentai-platform/.env` 和 `C:/Users/Administrator/.../python.exe`
- `agentai-qqbot/src/qq-official-bot.ts` — 曾硬编码 `F:/agentai-platform/.env`
- `agentai-core/src/local-server.ts` — 曾硬编码 `F:/agentai-platform/.env`
- `agentai-core/src/system-service.ts` — 曾硬编码 `F:/agentai-platform/.env`
- `agentai-gui/vite-plugin-agent.ts` — 曾硬编码 `F:/agentai-platform/.env`
- `agentai-gui/vite.config.ts` — 曾硬编码 `F:/agentai-platform/.env`

---

## 规则 2: 层间依赖单向

```
agentai-gui  ──HTTP/WS──→  agentai-gateway  ──import──→  agentai-core
                                                              │
agentai-qqbot  ──HTTP──→  agentai-gateway                    │
                                                              │
agentai-vscode ──HTTP/WS→  agentai-gateway                    │
                                                              │
agentai-desktop──IPC────→  agentai-gateway                    ▼
                                                        (无人引用 = 死代码)
```

- **Gateway 必须 import agentai-core**，而非重写一套相同逻辑
- **QQ Bot / VSCode 只能通过 HTTP/WS 调 Gateway**，禁止 `import('agentai-core')`
- **agentai-core 是底层库**，不应 import gateway 或 gui 任何代码

---

## 规则 3: SSE 事件格式

Gateway 发送 SSE 事件时，data JSON **必须**包含 `type` 字段，值与 event name 一致：

```typescript
// ✅ Gateway
function sendEvent(event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify({ type: event, ...data })}\n\n`);
}

// ✅ GUI (按 type 字段 switch)
const ev = JSON.parse(json);     // { type: "delta", delta: "hello" }
switch (ev.type) {
  case 'delta':      handlers.onDelta?.(ev.delta);       break;
  case 'tool_start': handlers.onToolStart?.(ev);         break;
  case 'tool_result':handlers.onToolResult?.(ev);        break;
  case 'status':     handlers.onStatus?.(ev.text);       break;
  case 'done':       handlers.onDone?.(ev);              break;
  case 'error':      handlers.onError?.(ev.error);       break;
}
```

**不要**依赖 SSE `event:` 行来传事件类型给 GUI——GUI 侧只解析 `data:` 行。

---

## 规则 4: 外部资源路径必须可配置

| 配置项 | 环境变量 | 默认值 | 违规范例 |
|--------|---------|--------|---------|
| Python 路径 | `AGNES_PYTHON` | `python3` (Unix) / `python` (Win) | ❌ `C:/Users/Admin/.../python.exe` |
| Gateway 端口 | `AGENTAI_PORT` | `18789` | - |
| CORS 来源 | `AGENTAI_CORS_ORIGINS` | `http://localhost:5173,...` | - |
| 日志级别 | `LOG_LEVEL` | `info` | ❌ 仅 console.log 无级别 |
| .env 路径 | `AGENTAI_ENV_PATH` | `<cwd>/.env` | ❌ `F:/agentai-platform/.env` |

---

## 规则 5: 跨包通信协议

| 源端 | 目标端 | 协议 | URL |
|------|--------|------|-----|
| GUI (React) | Gateway | HTTP + SSE + WS | `ws://127.0.0.1:18789` |
| QQ Bot | Gateway | HTTP | `http://127.0.0.1:18789` |
| VSCode 扩展 | Gateway | HTTP + WS | `ws://127.0.0.1:18789` |
| Tauri Desktop | Gateway | HTTP | `http://127.0.0.1:18789` |

所有 QQ Bot / VSCode / Desktop 对 LLM 的调用必须经过 Gateway，禁止本地 import agentai-core。

---

## 规则 6: 测试验收标准

| 组件 | 测试类型 | 最低要求 |
|------|---------|---------|
| llm-router (智能路由) | 单元测试 (Jest) | 路由选择逻辑 100% 覆盖 |
| 中文提示注入扫描 | 单元测试 + 样本集 | ≥ 50 测试样本，拦截率 ≥ 80% |
| tool-registry (调度) | 单元测试 | 并行/串行分块逻辑 100% |
| api.ts (SSE 解析) | 单元测试 | 所有事件类型各 1 条 |
| GUI 页面 | E2E (Playwright) | 8 个路由加载 + 流式对话 |

---

## 附录: 代码审查标签

- `[P0-HARDPATH]` — 硬编码路径
- `[P0-SSE-FMT]` — SSE 格式不一致
- `[P1-CORE-DUP]` — agentai-core 与 gateway 重复实现
- `[P1-QQ-DIRECT]` — QQ Bot 直连 core 包
- `[P2-NO-LOGGING]` — 无结构化日志
- `[P2-NO-TEST]` — 无单元测试
