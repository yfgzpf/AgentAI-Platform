# Cleaner API Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 gateway 注册 5 个 `/v1/cleaner/*` HTTP 端点,让 GUI 清理器面板可正常调用

**Architecture:** 新增 `src/cleaner/router.ts`(Express Router,5 端点) + `src/cleaner/index.ts` 加 1 个 public `getRules()` 方法 + `src/index.ts` 顶层 module-level 单例构造 daemon + 启动时 `daemon.start()` + 路由挂载

**Tech Stack:** Express 4 + TypeScript + Vitest + supertest 风格测试(node 内置 fetch 也可)

---

## File Structure

| 文件 | 类型 | 职责 |
|---|---|---|
| `packages/agentai-gateway/src/cleaner/router.ts` | **新建** | `createCleanerRouter(daemon: CleanerDaemon): Router` — 5 端点 + 错误处理 |
| `packages/agentai-gateway/src/cleaner/router.test.ts` | **新建** | 5 endpoint 单元测试(用 node 内置 fetch + express app) |
| `packages/agentai-gateway/src/cleaner/index.ts` | 修改 | 加 `getRules(): Rule[]` public 方法 |
| `packages/agentai-gateway/src/index.ts` | 修改 | 导入 cleaner + audit + 创建 daemon + `app.use('/v1/cleaner', router)` + `daemon.start()` + SIGTERM cleanup |

---

## Task 1: 在 CleanerDaemon 上暴露 getRules()

**Files:**
- Modify: `packages/agentai-gateway/src/cleaner/index.ts:120-150`(getState() 旁)
- Test: 现有 `cleaner.test.ts`(无新测试, 此方法纯 getter,行为由 `runOnce` 等覆盖)

- [ ] **Step 1: 添加 getRules() 方法**

在 `getState()` 后(约 130 行后),加:

```typescript
    /**
     * 获取当前生效的规则列表(router 端点调用)
     * 返回内部引用,前端只读不修改
     */
    getRules(): Rule[] {
        return this.rules;
    }
```

- [ ] **Step 2: 编译验证**

```powershell
cd f:\agentai-platform\packages\agentai-gateway
npm run typecheck
```

Expected: 0 错(无新依赖,无签名变化)

- [ ] **Step 3: 运行现有测试,确保无回归**

```powershell
npm test
```

Expected: 8 文件 / 29 测试全过(基线)

- [ ] **Step 4: Commit**

```powershell
git add packages/agentai-gateway/src/cleaner/index.ts
git commit -m "feat(cleaner): expose getRules() on CleanerDaemon"
```

---

## Task 2: 写 router.ts 失败的端点测试

**Files:**
- Create: `packages/agentai-gateway/src/cleaner/router.test.ts`

- [ ] **Step 1: 写测试文件**

完整内容:

```typescript
/**
 * Cleaner router 端点测试
 * 用 node 内置 fetch + 内存 mock CleanerDaemon
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import { createCleanerRouter } from './router.js';
import type { CleanerDaemon } from './index.js';

function makeMockDaemon(): any {
    return {
        getState: vi.fn().mockResolvedValue({
            version: 1, lastFullRun: 100, lastScan: 200, pendingRiskyPlans: [],
            cumulativeBytes: 0, alertsLast24h: 0, lastRuleReload: 0,
            nextQuickCheckAt: 999, nextFullRunAt: 9999,
        }),
        getRules: vi.fn().mockReturnValue([{ id: 'r1', match: {}, action: 'delete', risk: 'safe' }]),
        runOnce: vi.fn().mockResolvedValue({ bytesFreed: 1024, riskyCount: 0, alertCount: 0, scannedCount: 10, failures: 0 }),
        confirmPlan: vi.fn().mockResolvedValue({ ok: true, bytesFreed: 512 }),
        reportUserHeartbeat: vi.fn(),
    } as unknown as CleanerDaemon;
}

function makeApp(daemon: any) {
    const app = express();
    app.use(express.json());
    app.use('/v1/cleaner', createCleanerRouter(daemon));
    return app;
}

describe('cleaner router', () => {
    it('GET /v1/cleaner/status returns state', async () => {
        const app = makeApp(makeMockDaemon());
        const res = await app._router.handle({ method: 'GET', url: '/v1/cleaner/status' } as any, {} as any, () => {});
        // supertest 不可用时,直接调函数
        // 改用更简单方式: 用 app.listen(0) + fetch
        expect(true).toBe(true); // placeholder
    });
});
```

实际更简方案: 用 supertest(已在 deps?).先看 package.json.

- [ ] **Step 2: 检查 supertest 可用**

```powershell
cd f:\agentai-platform\packages\agentai-gateway
Test-Path node_modules/supertest
```

Expected: `True` 或 `False`

- [ ] **Step 3a: 如果 supertest 存在 — 用 supertest**

删除 Step 1 的 placeholder 测试,改为:

```typescript
import request from 'supertest';
import express from 'express';
import { describe, it, expect, vi } from 'vitest';
import { createCleanerRouter } from './router.js';
import type { CleanerDaemon } from './index.js';

function makeMockDaemon(): any {
    return {
        getState: vi.fn().mockResolvedValue({
            version: 1, lastFullRun: 100, lastScan: 200, pendingRiskyPlans: [],
            cumulativeBytes: 0, alertsLast24h: 0, lastRuleReload: 0,
            nextQuickCheckAt: 999, nextFullRunAt: 9999,
        }),
        getRules: vi.fn().mockReturnValue([{ id: 'r1', match: {}, action: 'delete', risk: 'safe' }]),
        runOnce: vi.fn().mockResolvedValue({ bytesFreed: 1024, riskyCount: 0, alertCount: 0, scannedCount: 10, failures: 0 }),
        confirmPlan: vi.fn().mockResolvedValue({ ok: true, bytesFreed: 512 }),
        reportUserHeartbeat: vi.fn(),
    } as unknown as CleanerDaemon;
}

function makeApp(daemon: any) {
    const app = express();
    app.use(express.json());
    app.use('/v1/cleaner', createCleanerRouter(daemon));
    return app;
}

describe('cleaner router', () => {
    it('GET /status returns 200 with state', async () => {
        const res = await request(makeApp(makeMockDaemon())).get('/v1/cleaner/status');
        expect(res.status).toBe(200);
        expect(res.body.nextQuickCheckAt).toBe(999);
        expect(res.body.nextFullRunAt).toBe(9999);
    });

    it('GET /rules returns 200 with rules array', async () => {
        const res = await request(makeApp(makeMockDaemon())).get('/v1/cleaner/rules');
        expect(res.status).toBe(200);
        expect(res.body.rules).toHaveLength(1);
        expect(res.body.rules[0].id).toBe('r1');
    });

    it('POST /scan returns 200 with RunResult', async () => {
        const res = await request(makeApp(makeMockDaemon())).post('/v1/cleaner/scan').send({});
        expect(res.status).toBe(200);
        expect(res.body.bytesFreed).toBe(1024);
        expect(res.body.scannedCount).toBe(10);
    });

    it('POST /confirm with approve returns ok+bytesFreed', async () => {
        const res = await request(makeApp(makeMockDaemon())).post('/v1/cleaner/confirm').send({ planId: 'p1', action: 'approve' });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.bytesFreed).toBe(512);
    });

    it('POST /heartbeat returns 200 ok', async () => {
        const res = await request(makeApp(makeMockDaemon())).post('/v1/cleaner/heartbeat').send({});
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });
});
```

- [ ] **Step 3b: 如果 supertest 不存在 — 安装并继续 Step 3a**

```powershell
npm install --save-dev supertest @types/supertest
```

然后回到 Step 3a。

- [ ] **Step 4: 运行测试,确保 5 个全 fail(因为 router.ts 还没建)**

```powershell
npm test -- router
```

Expected: 5 fail with "Cannot find module './router.js'" or "createCleanerRouter is not a function"

- [ ] **Step 5: Commit(测试先行,即使失败)**

```powershell
git add packages/agentai-gateway/src/cleaner/router.test.ts packages/agentai-gateway/package.json packages/agentai-gateway/package-lock.json
git commit -m "test(cleaner): add router endpoint tests (red)"
```

---

## Task 3: 实现 router.ts

**Files:**
- Create: `packages/agentai-gateway/src/cleaner/router.ts`

- [ ] **Step 1: 写 router 完整实现**

```typescript
/**
 * Cleaner HTTP Router
 * 暴露 5 个端点:
 *  GET  /v1/cleaner/status     拉取 CleanerState
 *  GET  /v1/cleaner/rules      拉取当前生效规则
 *  POST /v1/cleaner/scan       触发一次清理(scope 默认 safe)
 *  POST /v1/cleaner/confirm    确认/拒绝 RISKY 计划
 *  POST /v1/cleaner/heartbeat  用户心跳(智能调度用)
 */
import { Router, type Request, type Response } from 'express';
import type { CleanerDaemon } from './index.js';

export function createCleanerRouter(daemon: CleanerDaemon): Router {
    const router = Router();

    // 统一错误处理 wrapper
    const wrap = (fn: (req: Request, res: Response) => Promise<any>) =>
        async (req: Request, res: Response): Promise<void> => {
            try {
                await fn(req, res);
            } catch (e: any) {
                console.error('[cleaner-router] error:', e?.message || e);
                res.status(500).json({ error: e?.message || 'internal error' });
            }
        };

    router.get('/status', wrap(async (_req, res) => {
        const state = await daemon.getState();
        res.json(state);
    }));

    router.get('/rules', wrap(async (_req, res) => {
        const rules = daemon.getRules();
        res.json({ rules });
    }));

    router.post('/scan', wrap(async (req, res) => {
        // 当前 plan: scope 硬编码 'safe' (与 daemon 内部 setInterval 行为一致)
        // 后续可从 req.body.scope 读取(类型 'safe' | 'risky' | 'all')
        const scope = (req.body?.scope === 'risky' || req.body?.scope === 'all')
            ? req.body.scope
            : 'safe';
        const result = await daemon.runOnce({ scope });
        res.json(result);
    }));

    router.post('/confirm', wrap(async (req, res) => {
        const { planId, action } = req.body || {};
        if (!planId || (action !== 'approve' && action !== 'reject')) {
            res.status(400).json({ error: 'planId and action(approve|reject) required' });
            return;
        }
        const result = await daemon.confirmPlan(planId, action);
        // daemon 返回 {ok:false, error} 时仍 200,前端按 ok 判断
        res.json(result);
    }));

    router.post('/heartbeat', wrap(async (_req, res) => {
        daemon.reportUserHeartbeat();
        res.json({ ok: true });
    }));

    return router;
}
```

- [ ] **Step 2: 跑测试,确保 5 个全过**

```powershell
cd f:\agentai-platform\packages\agentai-gateway
npm test -- router
```

Expected: 5 pass / 0 fail

- [ ] **Step 3: typecheck**

```powershell
npm run typecheck
```

Expected: 0 错

- [ ] **Step 4: Commit**

```powershell
git add packages/agentai-gateway/src/cleaner/router.ts
git commit -m "feat(cleaner): add HTTP router with 5 endpoints (green)"
```

---

## Task 4: 在 src/index.ts 集成 cleaner daemon + router

**Files:**
- Modify: `packages/agentai-gateway/src/index.ts`(4 个改动点)

- [ ] **Step 1: 加导入(在 line 28 附近,现有 import 之后)**

找到 `import { frameworkSwitcher } from './frameworks/switcher.js';` 之后,加:

```typescript
import { CleanerDaemon, stateDir } from './cleaner/index.js';
import { loadRules } from './cleaner/rule-engine.js';
import { createCleanerRouter } from './cleaner/router.js';
import { audit } from './audit.js';
```

- [ ] **Step 2: 加 module-level daemon 单例(在 `app.use(cors())` 之前,约 line 60 前)**

在 `const app = express();` 之前加:

```typescript
// ===== 启动 CleanerDaemon 单例 =====
const rulesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cleaner', 'rules.json');
let cleanerDaemon: CleanerDaemon | null = null;
async function initCleaner(): Promise<void> {
    try {
        const rules = await loadRules(rulesPath);
        cleanerDaemon = new CleanerDaemon({
            rules,
            stateDir: stateDir(),
            scanRoots: [process.cwd(), os.homedir()].filter((p, i, a) => p && a.indexOf(p) === i),
            workspace: process.cwd(),
            audit,
        });
        await cleanerDaemon.start();
        console.log(`[cleaner] daemon started with ${rules.length} rules`);
    } catch (e: any) {
        console.error('[cleaner] init failed:', e?.message || e);
        // 不 throw — gateway 仍启动,前端看到"无规则"提示
    }
}
```

(需在导入区补 `import os from 'os';` 和 `import { fileURLToPath } from 'url';`)

- [ ] **Step 3: 在 `app.use(cors())` 后(约 line 60)加 router 挂载**

在 `app.use(cors());` 之后加:

```typescript
// Cleaner router — 在 daemon 启动后才挂载,但 initCleaner 是 async
// 用 try/catch 包裹,即使 daemon 失败也挂 router(前端可看 status 报错)
app.use('/v1/cleaner', (req, res, next) => {
    if (!cleanerDaemon) {
        res.status(503).json({ error: 'cleaner daemon not initialized' });
        return;
    }
    return createCleanerRouter(cleanerDaemon)(req, res, next);
});
```

(注: router 每次请求都重建 — 可优化: 在 initCleaner 内构造 1 次 router,然后 `app.use('/v1/cleaner', cleanerRouter)`。本次 plan 走简版,接受每次重建开销小)

- [ ] **Step 4: 在 `server.listen` 回调中(约 line 817 之后)加 `initCleaner()` 调用**

找到 `server.listen(PORT, HOST, () => {`,在回调最末尾(`});` 前)加:

```typescript
  // 启动 cleaner daemon (异步,不阻塞 listen 回调)
  initCleaner().catch(err => console.error('[cleaner] start failed:', err));
```

- [ ] **Step 5: 在 SIGTERM handler 中加 daemon.stop()**

找到 SIGTERM handler 块,加:

```typescript
  cleanerDaemon?.stop();
```

- [ ] **Step 6: typecheck**

```powershell
cd f:\agentai-platform\packages/agentai-gateway
npm run typecheck
```

Expected: 0 错(若有缺导入,按报错补)

- [ ] **Step 7: build**

```powershell
npm run build
```

Expected: exit 0, dist/cleaner/rules.json 存在(脚本会自动 copy)

- [ ] **Step 8: 跑所有测试**

```powershell
npm test
```

Expected: 8+ 文件 / 34+ 测试全过(基线 29 + 新增 5)

- [ ] **Step 9: 手动启 gateway 验证路由(可选, dev 模式)**

```powershell
npm run dev
```

(在另一个终端)

```powershell
curl http://127.0.0.1:18789/v1/cleaner/status
curl http://127.0.0.1:18789/v1/cleaner/rules
curl -X POST http://127.0.0.1:18789/v1/cleaner/heartbeat -H "Content-Type: application/json" -d "{}"
```

Expected: 3 个全返回 JSON 200(非 404)

- [ ] **Step 10: Commit**

```powershell
git add packages/agentai-gateway/src/index.ts
git commit -m "feat(cleaner): wire daemon singleton + router mount in gateway"
```

---

## Task 5: 扩展 GUI E2E 测试(覆盖新端点)

**Files:**
- Modify: `packages/agentai-gui/e2e/app.spec.ts:test 11`(约 test 11 "清理器面板可访问")

- [ ] **Step 1: 找到 test 11**

定位关键字: `清理器面板可访问 (Settings → Cleaner tab)`

- [ ] **Step 2: 在 test 11 末尾加 "一键扫描" 交互断言**

在 test 11 最末(`.anticon-clock-circle` 断言后)加:

```typescript
            // 一键扫描按钮可点击 + 完成后不报错
            const scanBtn = page.locator('button:has-text("一键扫描")').first();
            await scanBtn.click();
            // 等待扫描完成(loading 消失)— 给 5s
            await page.waitForTimeout(5000);
            // 状态数据应已更新(lastScan 非 0)— 简化:按钮恢复可点
            await expect(scanBtn).toBeEnabled();
            // 5 个 API 都不应 404 — 通过 page.on('response') 验证
            const responses: number[] = [];
            page.on('response', (r) => {
                if (r.url().includes('/v1/cleaner/')) responses.push(r.status());
            });
            // 触发一次刷新
            await page.locator('button:has-text("刷新")').first().click();
            await page.waitForTimeout(2000);
            const cleanerResponses = responses.filter(s => s >= 200 && s < 300);
            expect(cleanerResponses.length).toBeGreaterThan(0);
```

- [ ] **Step 3: 跑 E2E 验证(假设 vite + playwright 已起)**

```powershell
cd f:\agentai-platform\packages/agentai-gui
npx playwright test app.spec.ts -g "清理器面板"
```

Expected: 1 pass

- [ ] **Step 4: Commit**

```powershell
git add packages/agentai-gui/e2e/app.spec.ts
git commit -m "test(gui): e2e cleaner router endpoints (status/scan/heartbeat)"
```

---

## Task 6: 最终全量验证 + 报告

- [ ] **Step 1: 后端全套验证**

```powershell
cd f:\agentai-platform\packages/agentai-gateway
npm run typecheck
npm test
npm run build
```

Expected: 0 错 / 34+ 测试过 / build 成功(含 rules.json)

- [ ] **Step 2: 前端全套验证**

```powershell
cd f:\agentai-platform\packages/agentai-gui
npm test
npm run build
```

Expected: 0 错 / 47+ 测试过 / build 成功

- [ ] **Step 3: 手动集成测试**

1. 重启 gateway(`Ctrl+C` + `npm run dev`)
2. 浏览器打开 `http://localhost:5173`,进 设置 → 清理器
3. 验证:
   - 状态卡显示"累计释放 0 B / 24h 告警 0" 等
   - "调度状态" Card 显示"5 分钟后" "24 小时后" 等相对时间
   - "一键扫描" 按钮可点
   - "规则预览" 区有 11 条规则
   - 浏览器 Network tab: 5 个 `/v1/cleaner/*` 全 200

- [ ] **Step 4: Commit 任何遗漏(若有)**

```powershell
git status
```

若有未 tracked 的 spec/plan 文档改动:

```powershell
git add docs/superpowers/specs/2026-06-11-cleaner-api-routes.md docs/superpowers/plans/2026-06-11-cleaner-api-routes.md
git commit -m "docs(cleaner): spec and plan for api routes registration"
```

---

## Self-Review

### Spec coverage

| Spec 节 | Task |
|---|---|
| 4.1 GET /status | T2 测试 + T3 router + T4 挂载 |
| 4.2 GET /rules | T2 测试 + T3 router + T4 挂载(需 daemon.getRules() = T1) |
| 4.3 POST /scan | T2 测试 + T3 router + T4 挂载 |
| 4.4 POST /confirm | T2 测试 + T3 router + T4 挂载 |
| 4.5 POST /heartbeat | T2 测试 + T3 router + T4 挂载 |
| 5.1 模块拆分 | T1/T2/T3/T4 分别对应 |
| 5.2 单例 | T4 Step 2-3 |
| 5.3 错误处理 | T3 wrap helper |
| 5.4 dev 热重载 | tsx watch 已支持,无新工作 |
| 7.1 单测 | T2 + T3 |
| 7.2 E2E | T5 |
| 7.3 手动 | T6 |

### Placeholder scan
- 无 "TODO" / "TBD" / "类似 Task N"
- 所有代码块完整
- 所有命令带 Expected 输出
- router 每次重建 — Step 3 注: 标了"走简版,后续优化",不算 placeholder,是有意识的 trade-off

### Type consistency
- `CleanerDaemon.getRules()` (T1) → `daemon.getRules()` (T3 router + T4 test) ✅
- `daemon.getState()` 返回 `CleanerState` (types.ts) ✅
- `daemon.runOnce({scope})` 返回 `RunResult` ✅
- `daemon.confirmPlan(planId, action)` 返回 `{ok, bytesFreed?, error?}` ✅
- `daemon.reportUserHeartbeat()` 无返回值 ✅

### 风险
- `path.dirname(fileURLToPath(import.meta.url))` — tsx + node ESM 都支持,无 ESM `__dirname` 替代坑
- `os.homedir()` Windows 正确返回 `C:\Users\xxx`
- audit.log 同步 fire-and-forget,不阻塞 router
- supertest 是否已装: T2 Step 2 检测,T2 Step 3b 兜底安装
