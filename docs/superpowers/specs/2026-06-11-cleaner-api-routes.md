# Spec: 注册 /v1/cleaner/* API 路由

**日期**: 2026-06-11
**作者**: AgentAI Builder
**关联 plan**: `docs/superpowers/plans/2026-06-11-cleaner-api-routes.md`(待写)
**前置依赖**:
- `2026-06-11-cleaner-schedule-display.md` 已完成(`nextQuickCheckAt` / `nextFullRunAt` 字段就绪)
- `CleanerDaemon` 类 + 子模块(scanner/planner/executor/state/alerts/smart-scheduler/rule-engine)完整存在
- `dist/cleaner/rules.json` 已就位(build 脚本自动 copy)

---

## 1. 目标

在 `packages/agentai-gateway/src/index.ts` 注册 5 个 HTTP 端点,让 `CleanerPanel` 前端能正常调用清理器。

## 2. 非目标

- ❌ 不改 daemon 内部实现(已稳定, 测试 29/29 通过)
- ❌ 不增 WebSocket / SSE 推送(本期用 15s 轮询已足够, 通知走既有 `pushNotification`)
- ❌ 不动 GUI / Desktop / QQ Bot
- ❌ 不改 cleaner 规则内容(rules.json)
- ❌ 不动 audit 既有管线(只注入 `audit` 实现)
- ❌ 不重启 gateway(用户在跑, 改了等他手动重启或新进程; dev 用 `tsx watch` 自动)

## 3. 用户故事

**作为** AgentAI GUI 用户
**当** 打开 设置 → 清理器 Tab
**希望** 看到状态(累计释放/告警/调度时间), 能点 "一键扫描", 看到 "风险计划" 列表
**因为** gateway 现在 404, 清理器不可用

## 4. 端点契约

所有端点前缀 `/v1/cleaner`, JSON in/out, 错误用 HTTP 4xx/5xx + `{error: string}`。

### 4.1 `GET /v1/cleaner/status`

| 项 | 值 |
|---|---|
| 描述 | 拉取当前 CleanerState 完整状态 |
| 响应 200 | `CleanerState`(类型见 `types.ts`):`{version, lastFullRun, lastScan, pendingRiskyPlans, cumulativeBytes, alertsLast24h, lastRuleReload, nextQuickCheckAt, nextFullRunAt}` |
| 响应 5xx | `{error: "daemon not started"}`(进程崩溃但端口还活着) |
| 用例 | CleanerPanel 15s 轮询 |

### 4.2 `GET /v1/cleaner/rules`

| 项 | 值 |
|---|---|
| 描述 | 拉取当前生效的规则列表 |
| 响应 200 | `{rules: Rule[]}`(类型见 `types.ts`:`id, match.{path,mtimeDaysAgo,sizeBytes,totalBytes}, action, risk, archiveDir?, strategy?`) |
| 用例 | CleanerPanel "规则预览" 标签页 |

### 4.3 `POST /v1/cleaner/scan`

| 项 | 值 |
|---|---|
| 描述 | 立即触发一次清理(默认 scope='safe',与硬编码定时器一致) |
| 请求体 | `{}` (空; 后续可加 `{scope: 'safe'\|'risky'\|'all'}`) |
| 响应 200 | `RunResult`:`{bytesFreed, riskyCount, alertCount, scannedCount, failures}` |
| 串行约束 | daemon 内部有 `withLock`, 多次 POST 自动排队; 不需客户端协调 |
| 用例 | "一键扫描" 按钮 |

### 4.4 `POST /v1/cleaner/confirm`

| 项 | 值 |
|---|---|
| 描述 | 用户确认/拒绝一个 RISKY 计划 |
| 请求体 | `{planId: string, action: 'approve'\|'reject'}` |
| 响应 200 | `{ok: true, bytesFreed?: number}` (approve 时含 bytesFreed) |
| 响应 4xx | `{ok: false, error: 'plan not found'}` (HTTP 200 也可能, 看 daemon 现有契约 — 不改 daemon) |
| 用例 | CleanerPanel "风险计划" 列表的"批准/拒绝"按钮 |

### 4.5 `POST /v1/cleaner/heartbeat`

| 项 | 值 |
|---|---|
| 描述 | 上报用户在用(供智能调度决定是否触发深度扫描) |
| 请求体 | `{}` |
| 响应 200 | `{ok: true}` |
| 用例 | CleanerPanel 启动时一次性(无 15s 轮询 — 心跳语义是"在线") |

## 5. 架构

### 5.1 模块拆分

新增 1 个文件 + 改 1 个文件 + 改 1 个 daemon 方法:

| 文件 | 变更 |
|---|---|
| `src/cleaner/router.ts` | **新建** `export function createCleanerRouter(daemon: CleanerDaemon): Router` |
| `src/cleaner/index.ts` | **+1 方法** `getRules(): Rule[]` — 暴露 `this.rules` |
| `src/index.ts` | **+导入 +1 行** `app.use('/v1/cleaner', createCleanerRouter(daemon))` + **+daemon 实例化** |

### 5.2 CleanerDaemon 单例

`src/index.ts` 在启动时构造 1 个 `CleanerDaemon` 实例, 注入 config, 调 `start()`, 引用保存为 module-level `let cleanerDaemon: CleanerDaemon | null = null`, 路由闭包引用它。

构造参数:
- `rules`: 启动时 `await loadRules(rulesJsonPath)` 一次, 传 cfg.rules
- `stateDir`: `stateDir()` 函数(已有, 优先 `AGENTAI_CLEANER_STATE_DIR` → `~/.agentai/cleaner` → `cwd/.cleaner-state`)
- `scanRoots`: `process.cwd()` + `os.homedir()` 两个(覆盖工作区 + 用户家目录缓存)
- `workspace`: `process.cwd()`
- `audit`: 注入既有 audit 模块(查 `audit.ts`)
- `pushNotification`: 暂不注入, 用 `undefined`(不影响功能, 仅不打 push 通知)
- `scheduler`: 暂不注入(默认就行)

### 5.3 错误处理

- 任何端点内 try/catch 包住, 失败 → 500 + `{error: e.message}`
- 不要 throw 出路由(express 默认 500 page 不友好)
- 启动顺序: `loadRules` → `new CleanerDaemon(cfg)` → `daemon.start()` → `app.use(...)` → `app.listen(...)`
  - 若 `loadRules` 失败, 仍构造 daemon(空 rules 也能跑, 但前端会看到"无规则" — 已知问题, 用户手动恢复)
  - `daemon.start()` 必须 `await` 完, 路由才接

### 5.4 dev 模式热重载

`tsx watch` 模式: 文件改动重启进程, daemon 会重新构造。状态文件持久化(由 `stateDir` 处理) — 重启后状态不丢。

## 6. 数据模型

无新增类型。复用 `CleanerState` / `Rule` / `RunResult` / `RiskyPlan`(全部在 `types.ts`)。

## 7. 测试策略

### 7.1 单元测试 (Vitest)

新建 `src/cleaner/router.test.ts`:
- 5 个 endpoint 各 1 case(共 5 case)
- 用 `supertest` 风格或直接 `app` + `fetch` 模拟(具体看 supabase 是否已在 deps)
- daemon 传 `mock<CleanerDaemon>`, mock 所有方法
- 重点: 端点路由路径正确、参数透传、错误路径覆盖

### 7.2 E2E (Playwright)

扩展 `packages/agentai-gui/e2e/app.spec.ts` test 11:
- 删除旧版"调度状态" 单独断言(本 plan 完成时已加 — 保留)
- 新增: "一键扫描" 按钮可点击 + loading 态 + 完成后状态刷新(扫描结果字节数 > 0 或 = 0 都通过)
- 新增: 进入 Cleaner tab 不再 404(Network tab 200)

### 7.3 手动

- 重启 gateway(用户手动 — `npm run dev` 在 dev 模式; 或 `npm run start` prod)
- 浏览器打开 GUI, 进 设置 → 清理器, 验证 5 个 API 全 200

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| `daemon.start()` 启动慢(磁盘扫描阻塞) | 启动时不调 runOnce, 只 loadState + 设 setInterval |
| `audit` 模块未 import | 查清 audit.ts 的导出, 注入; 不要在 cleaner 包内重新实现 audit |
| `scanRoots` 用 `os.homedir()` 扫描全用户目录太慢 | maxDepth=4(已配置); 加 30s timeout(已配置) |
| GUI 用户的 vite dev server proxy 还没指向新路由 | vite.config.ts 已配 `/v1` → 18789, 改动对 GUI 无感 |
| TBD: 是否需要 CORS | 既有 app.use(cors()) — 不动 |

## 9. 实施依赖

| 文件 | 已读? | 备注 |
|---|---|---|
| `src/cleaner/index.ts` | ✅ | daemon 类完整 |
| `src/cleaner/types.ts` | ✅ | 类型完整 |
| `src/cleaner/rule-engine.ts` | ✅ | loadRules / watchRules 已 export |
| `src/cleaner/state.ts` | ✅ | stateDir 函数已 export |
| `src/index.ts` | ✅ (前 25 行) | 需查后段 + audit 注入点 |
| `src/audit.ts` | ⏳ 待查 | 需确认导出方式 |
| `src/cleaner/router.ts` | 🆕 新建 | - |

## 10. 验收清单

- [ ] `npm run build` 成功
- [ ] `npm run typecheck` 0 错
- [ ] `npm test` 通过(含新增 router.test 5 case)
- [ ] `cd packages/agentai-gui && npm test` 0 错
- [ ] `vite build` 成功
- [ ] 手动启 gateway + GUI, 进 Cleaner tab, 看到状态卡 + 一键扫描按钮 + 规则列表
- [ ] 浏览器 Network tab: 5 个 /v1/cleaner/* 全 200
