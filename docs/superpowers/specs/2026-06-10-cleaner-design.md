# AgentAI Cleaner — 360-Style 智能清理器 设计规范

> 日期: 2026-06-10
> 状态: 已批准, 待 writing-plans 出实施计划
> 模块归属: `packages/agentai-gateway/src/cleaner/`

## 1. 背景与目标

### 痛点
- 用户长期使用 agentai-platform 后, `~/.agentai/audit/` 和 `~/.agentai/tmp/` 等目录会无限增长, 占用 C 盘空间
- LLM 会话历史/记忆文件没设上限, 几个月后单个文件可达数百 MB
- 现成的"审计清理" (`POST /v1/audit/cleanup?days=30`) 是手动触发的, 用户不会定期调用
- 90% 的智能体平台没有"管家"概念 — 缺少类似 360 安全卫士的自动体检/自动清理/告警闭环

### 目标
1. 周期体检 + 智能调度, 减少 C 盘占用
2. 分级确认, 安全项全自动, 危险项推送给用户
3. 异常增长 (单文件 >100MB / 总占用 >1GB) 实时告警
4. 记忆文件压缩归档, 保留语义、降低体积
5. 零侵入: 不影响 Gateway 主流程, 不引入 LLM 依赖

### 非目标
- 不清理 LLM 会话历史 (chain-store / in-memory session) — 这块走用户主动 reset
- 不清理项目源代码
- 不引入 worker_threads 并行 — 数据规模 < 10GB, 单线程够用
- 不调 LLM 做智能摘要 (避免成本/延迟)

## 2. 范围

| 目录 | 处理 | 风险等级 |
|------|------|----------|
| `~/.agentai/tmp/` (>7d) | 自动删除 | SAFE |
| `~/.agentai/cache/` (>30d) | 自动删除 | SAFE |
| `~/.agentai/audit/YYYY-MM-DD.ndjson` (>30d) | gzip 归档 | SAFE |
| `~/.agentai/memory/project_memory.md` (>200KB) | LLM-free 摘要归档, 保留章节标题 | SAFE |
| `~/.agentai/memory/session_memory_*.jsonl` (>14d) | 移到 `archive/` | SAFE |
| `~/.agentai/cleaner/state.json` | 永不清理 | KEEP |
| `<workspace>/.agentai/preferences.json` | 永不自动清 | KEEP |
| `<workspace>/.agentai/digests/*.json` (>30d) | 移到 `archive/` | SAFE |
| `<workspace>/.agentai/cache/` (>30d) | 自动删除 | SAFE |
| `<workspace>/.agentai/tasks/*.json` (>7d) | 待确认 | RISKY |
| `~/.agentai/audit/YYYY-MM-DD.ndjson` (单文件 >100MB) | 告警 + 待确认 | RISKY |
| 任何单文件 >100MB | 告警 | ALERT |
| 总占用 >1GB | 告警 | ALERT |

## 3. 架构

### 模块文件
```
packages/agentai-gateway/src/cleaner/
├── index.ts          # CleanerDaemon 主循环
├── rules.json        # 声明式规则 (可热加载, 无需 TS 编译)
├── rule-engine.ts    # 规则匹配
├── scanner.ts        # 目录 walk + 文件元信息
├── planner.ts        # 按规则分类 → SAFE/RISKY/ALERT
├── executor.ts       # 执行 SAFE 项, 写 audit
├── alerts.ts         # 异常增长推送通知
├── state.ts          # 状态持久化 (state.json)
├── smart-scheduler.ts # 闲时检测 + CPU 占用感知
└── cleaner.test.ts   # 单元测试 (≥12)
```

### 持久化状态
`~/.agentai/cleaner/state.json`:
```json
{
  "version": 1,
  "lastFullRun": 1730000000000,
  "lastScan": 1730000000000,
  "pendingRiskyPlans": [
    {
      "planId": "p_xxx",
      "category": "audit-oversize",
      "files": [{"path": "...", "size": 104857600}],
      "createdAt": 1730000000000,
      "reason": "audit file >100MB"
    }
  ],
  "cumulativeBytes": 12345678,
  "alertsLast24h": 0
}
```

### 规则声明式 (rules.json)
```json
[
  {
    "id": "tmp-old",
    "match": { "path": "~/.agentai/tmp/*", "mtimeDaysAgo": ">7" },
    "action": "delete",
    "risk": "safe"
  },
  {
    "id": "cache-old",
    "match": { "path": "~/.agentai/cache/*", "mtimeDaysAgo": ">30" },
    "action": "delete",
    "risk": "safe"
  },
  {
    "id": "audit-old",
    "match": { "path": "~/.agentai/audit/*.ndjson", "mtimeDaysAgo": ">30" },
    "action": "gzip-archive",
    "risk": "safe",
    "archiveDir": "~/.agentai/audit/archive/"
  },
  {
    "id": "memory-md-oversize",
    "match": { "path": "~/.agentai/memory/projects/*/project_memory.md", "sizeBytes": ">204800" },
    "action": "llm-free-archive",
    "risk": "safe",
    "strategy": "keep-section-titles-only"
  },
  {
    "id": "session-jsonl-old",
    "match": { "path": "~/.agentai/memory/session_memory_*.jsonl", "mtimeDaysAgo": ">14" },
    "action": "move-archive",
    "risk": "safe",
    "archiveDir": "~/.agentai/memory/archive/"
  },
  {
    "id": "tasks-stale",
    "match": { "path": "<workspace>/.agentai/tasks/*.json", "mtimeDaysAgo": ">7" },
    "action": "confirm-required",
    "risk": "risky"
  },
  {
    "id": "audit-oversize",
    "match": { "path": "~/.agentai/audit/*.ndjson", "sizeBytes": ">104857600" },
    "action": "alert-and-confirm",
    "risk": "risky"
  },
  {
    "id": "any-file-oversize",
    "match": { "sizeBytes": ">104857600" },
    "action": "alert",
    "risk": "alert"
  },
  {
    "id": "total-quota",
    "match": { "totalBytes": ">1073741824" },
    "action": "alert",
    "risk": "alert"
  }
]
```

## 4. 组件

### CleanerDaemon (index.ts)
- `start()`: 启动调度 (首次 +60min, 之后每 24h, 磁盘>80% 时 5min 一次)
- `stop()`: 清理 setInterval, 写 state
- `runOnce(scope)`: 手动触发 (all/safe/risky), 用于 E2E

### RuleEngine
- `loadRules(path)`: 从 rules.json 加载
- `match(file)`: 返回第一条命中规则或 null
- `hotReload()`: 监听文件变化 (fs.watch) 重载

### Scanner
- `scan(scope)`: 递归 walk, 收集 `{path, size, mtime, atime}`
- 用 `fs.promises.readdir` + `stat`, 不跟随 symlink
- 单次扫描 timeout 30s, 超时返回 partial results

### Planner
- 接收 scanner output + rules
- 输出 `{safe: FileAction[], risky: FileAction[], alerts: FileAction[]}`
- 每个 FileAction 含 planId (hash(path+mtime))

### Executor
- `executeSafe(actions)`: 串行执行 (delete/gzip/move)
- 写 `audit.log({action: 'cleaner_run', payload: {planId, files: count, bytes: total, action}})`
- 失败 retry 3 次 (指数退避), 仍失败入"重试队列" 下次跑

### Alerts
- 异常增长 → `pushNotification({type: 'cleaner_alert', level: 'warning', message: '...', file: '...'})`
- 复用 `notification-bus.ts`

### SmartScheduler
- 检测 CPU 占用 (`os.cpus()` 计算, 1s 采样)
- 检测用户 idle: GUI 端通过 `/v1/cleaner/heartbeat` 报心跳, 5min 无 → 视为 idle
- 闲时 + CPU<30% 才跑深层扫描, 否则只跑轻量

## 5. 数据流

```
[Scheduler tick]
  → 轻量 statfs: 磁盘>80%? 立即触发 / 否则等 24h
  → CPU<30% + 用户 idle? 跑深层 / 否则只 stat
  ↓
[Scanner.walk] (depth ≤ 4, ignore node_modules/.git/dist)
  → 输出 FileMeta[]
  ↓
[RuleEngine.match] × N files
  → 命中规则 → 分类
  ↓
[Planner.categorize]
  → SAFE / RISKY / ALERT
  ↓
[分支]
  SAFE   → [Executor.executeSafe] → [audit.log] → [state.update(cumulativeBytes +=)]
  RISKY  → [state.pendingRiskyPlans.push(planId)] → [pushNotification('cleaner_confirm_required')]
  ALERT  → [pushNotification('cleaner_alert')] → [state.alertsLast24h += 1]
  ↓
[用户通过 GUI/Settings 看到通知]
  → 调 POST /v1/cleaner/confirm {planId, action}
  → 服务端查 planId, 批准 → Executor.execute / 拒绝 → state.remove
```

## 6. 端点 (复用 Gateway 18789)

| Method | Path | 用途 |
|--------|------|------|
| GET | `/v1/cleaner/status` | 状态: 上次跑/下次跑/累计清理/待确认数 |
| GET | `/v1/cleaner/plan` | 待确认 plan 列表 |
| POST | `/v1/cleaner/confirm` | `{planId, action: 'approve'\|'reject'}` |
| POST | `/v1/cleaner/run` | `{scope: 'all'\|'safe'\|'risky'}` 手动触发 |
| GET | `/v1/cleaner/rules` | 规则只读列表 |
| PATCH | `/v1/cleaner/rules` | 热更新 (需 admin token) |
| POST | `/v1/cleaner/heartbeat` | GUI 报心跳, 用于 idle 判定 |

## 7. 错误处理

| 场景 | 处理 |
|------|------|
| 扫描 EPERM (无权限) | 跳过 + audit warn, 不阻塞 |
| 删除 EBUSY (文件被占) | retry 3 次 (1s/2s/4s), 仍失败 → 重试队列 |
| gzip 失败 | 跳过 + audit error, 继续其他 |
| state.json 损坏 | 读 backup `state.json.bak`, 都没有则新建空状态 |
| 规则 JSON 损坏 | 加载失败告警, 继续用旧规则 (cached) |
| 磁盘满了执行清理 | 先检查, 不够就中止并告警 |
| 用户重复点 confirm | 幂等, planId 已被处理返回 409 |

## 8. 测试

### 单元 (vitest, ≥ 12 cases)
1. rules.json 加载 + 校验
2. RuleEngine match: 命中 / 不命中 / 多规则优先级
3. Scanner: 空目录 / 大文件 / 符号链接 / 嵌套深目录
4. Planner: SAFE/RISKY/ALERT 分类正确
5. State: 序列化往返 / 损坏恢复
6. Executor: delete / gzip / move 全成功
7. Executor: retry 逻辑 (mock fs)
8. Alerts: 单文件 >100MB 触发
9. Alerts: 总配额 >1GB 触发
10. SmartScheduler: CPU 高 / 用户 busy 跳过
11. 热加载: rules.json 改动 → 重新加载
12. 并发安全: 两次 runOnce 不冲突 (互斥锁)

### E2E (`smoke-cleaner.cjs`, 8-10 cases)
1. 启动后 +1h 触发? (mock 时间)
2. SAFE 自动清: 写 tmp/7d → 触发 → 验证文件消失
3. RISKY 待确认: 写 tasks/7d → 验证进 plan + 通知
4. 用户 confirm approve: 文件删除 + audit 记录
5. 用户 confirm reject: 文件保留 + plan 移除
6. 异常告警: 写 100MB 文件 → 触发 alert
7. 磁盘阈值: mock 90% → 立即触发扫描
8. 状态持久化: 跑一次 → 重启 Gateway → 状态保留
9. 手动 run once: 调 POST /v1/cleaner/run
10. 心跳 idle: 5min 无 → scheduler 跑深层

## 9. 实施分阶段

### 阶段 1: MVP (1 轮)
- rules.json + RuleEngine + Scanner + Planner + Executor
- 手动 run once (`POST /v1/cleaner/run`)
- 状态持久化
- 单测 + E2E

### 阶段 2: 调度 (1 轮)
- CleanerDaemon + 定时器 + 磁盘阈值 watcher
- SmartScheduler (CPU + idle)
- 端点 (status/plan/confirm/heartbeat)

### 阶段 3: 智能化 (1 轮)
- Alerts + pushNotification 接入
- LLM-free 记忆摘要归档 (section titles 保留)
- 规则热加载

### 阶段 4: 集成 (1 轮)
- GUI 设置页加"清理管家" tab
- 显示累计清理字节 / 待确认 plan
- 一键 approve / reject

## 10. 设计原则

1. **零侵入**: 不动 Gateway 主流程, 失败也不影响 chat
2. **可观测**: 所有动作写 audit, 状态可查
3. **可恢复**: state.json + backup, 任何崩溃可重启恢复
4. **声明式优先**: rules.json 一目了然, 非开发也能改
5. **安全优先**: 默认 SAFE, RISKY 必确认, 永不删 preferences/state
6. **LLM-free**: 规则引擎不依赖 LLM, 启动快 / 成本低
