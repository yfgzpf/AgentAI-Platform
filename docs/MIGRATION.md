# AgentAI Platform 架构迁移指南

> 从 1100 行的单文件 `index.ts` 迁移到模块化的 `app.ts + routes/`

## 为什么迁移

| 问题 | 旧架构 | 新架构 |
|------|--------|--------|
| 单文件行数 | 1100+ | index.ts 1000+ + app.ts 80 |
| 路由耦合 | 所有路由在一个文件 | 按职责拆分到 routes/ |
| 测试性 | 难以 mock | 每个 router 独立可测 |
| 后台任务 | 手动启动 | `startBackgroundJobs()` 一键 |

## 新增/修改文件清单

### 新增模块

| 文件 | 职责 |
|------|------|
| `src/app.ts` | Express app 工厂 + HTTP/Socket 服务器 |
| `src/routes/chat.ts` | `/v1/chat` 主对话 (含 SSE 流式) |
| `src/routes/files.ts` | `/v1/files/*` 文件 CRUD |
| `src/routes/qq.ts` | `/v1/qq/*` QQ Bot webhook + 心跳 |
| `src/routes/health.ts` | `/v1/health`, `/v1/tools` |
| `src/skills/watcher.ts` | chokidar 热加载 |
| `src/session-manager.ts` | LRU session 淘汰 |
| `src/reflector.ts` | 反思门 Agent |
| `src/logger-stub.ts` | 简单日志 (待替换 pino) |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/evolution.ts` | 闭环 + 清理循环 + 摘要 |
| `src/skills/loader.ts` | 新增 registerSkill/unregisterSkill/scanBuiltInSkills |
| `src/agentai-loop.ts` | 接入 reflector 钩子 |
| `src/tools.ts` | code_review 工具加超时控制 |
| `src/index.ts` | 启动 watcher + evolution 清理 |

## 闭环示意

```
用户消息 → AgentAILoop.run()
                ↓
       (iter % 10 === 0)
                ↓
        runReflector() 异步
                ↓
       LLM (cheap provider) 总结
                ↓
       writeEvolution(evolution.jsonl)
                ↓
       cleanupEvolution() (每 6h)
                ↓
       下次启动 → readEvolutionForContext()
                ↓
       注入到 immutablePrefix
```

## 启动后台任务

旧版 (index.ts) 中手动:
```ts
const projectSkills = scanProjectSkills();
// ... 没有 watcher
```

新版 (app.ts) 一键:
```ts
import { createApp, startBackgroundJobs } from './app.js';
const app = createApp(deps);
startBackgroundJobs(skillsDir);  // 自动 watcher + evolution + session mgr
```

## 后续迁移步骤

1. 将 `index.ts` 中剩余路由 (image/video/upload/settings/framework) 抽离到 routes/
2. 引入 pino 替换 logger-stub
3. 加单元测试 (每个 router 一个测试文件)
4. 引入 OpenAPI schema 自动生成

## 性能改善

| 指标 | 旧 | 新 |
|------|-----|-----|
| Session 内存 | 无限增长 | LRU 200 上限 |
| Evolution 文件 | 无限增长 | 1000 条/7 天上限 |
| 技能加载 | 启动时全量 | 启动时全量 + 增量热加载 |
| code_review 阻塞 | 永不超时 | 90s/角色 超时 |
