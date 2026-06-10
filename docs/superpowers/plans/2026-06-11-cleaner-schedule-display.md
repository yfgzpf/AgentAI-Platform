# Cleaner 周期调度状态展示 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CleanerPanel 中展示清理器硬编码定时器(5min 磁盘检查 / 24h 全量清理)的下次执行时间,零后端逻辑改动。

**Architecture:** 纯展示 — 后端 CleanerDaemon 在 start()/runOnce()/checkDiskAndRun() 三个现有节点顺手算 next* 时间戳并 saveState(复用现有原子写);前端 CleanerPanel 通过现有 15s 轮询拿到,新增 Card 渲染。

**Tech Stack:** TypeScript (gateway + gui), React, antd (Card / Descriptions / Statistic), vitest (单元测), Playwright (e2e — 已有), tsx (gateway 运行)

**Spec:** [2026-06-11-cleaner-schedule-display.md](../../specs/2026-06-11-cleaner-schedule-display.md)

**Safety guards (执行时遵守):**
- 不 kill 任何后台进程(18789, 5173 等)
- 不 git commit(等用户授权)
- 不引入新依赖
- 不改 executor / planner / scanner / rule-engine / smart-scheduler
- 不动 start() / runOnce() / checkDiskAndRun() 业务逻辑,只 append 时间戳赋值 + saveState

---

## File Structure

**后端** (3 files touched):
- `packages/agentai-gateway/src/cleaner/types.ts` — CleanerState + EMPTY_STATE 增 2 字段
- `packages/agentai-gateway/src/cleaner/index.ts` — 3 个注入点
- `packages/agentai-gateway/src/cleaner/cleaner.test.ts` — 增 2 测

**前端** (3 files touched):
- `packages/agentai-gui/src/components/CleanerPanel.tsx` — interface 增字段 + import + formatRelative + Card
- `packages/agentai-gui/src/components/CleanerPanel.test.tsx` — 新建, formatRelative 8 个 case
- `packages/agentai-gui/e2e/app.spec.ts` — test 11 扩 3 断言

**未触动**:
- `package.json` / 任何 config / `.env` / `.gitignore`
- 任何 cleaner 子模块 (executor / planner / scanner / rule-engine / smart-scheduler)
- Gateway 任何其他路由
- CleanerPanel 已有 4 个 Statistic 卡
- 任何 other React 组件

---

## Task 1: 后端 types.ts 增 2 字段

**Files:**
- Modify: `packages/agentai-gateway/src/cleaner/types.ts:84-114`

- [ ] **Step 1: 在 CleanerState interface 末尾追加 2 字段**

定位: `interface CleanerState` 块(约 84-93 行),在 `lastRuleReload: number;` 之后,`}` 之前插入:

```typescript
    nextQuickCheckAt: number;   // 下次 5min 磁盘检查时间 (ms); 0=未调度
    nextFullRunAt: number;      // 下次 24h 全量清理时间 (ms); 0=未调度
```

- [ ] **Step 2: 在 EMPTY_STATE 末尾追加 2 字段**

定位: `export const EMPTY_STATE: CleanerState = { ... }`(约 106-114 行),在 `lastRuleReload: 0,` 之后,`};` 之前插入:

```typescript
    nextQuickCheckAt: 0,
    nextFullRunAt: 0,
```

- [ ] **Step 3: tsc 验证**

```bash
cd f:\agentai-platform\packages\agentai-gateway
npx tsc --noEmit
```

Expected: 0 错(可能 1-2 个项目原有错误, 关键是这次改动不引入新错)。记录 baseline 错误数, 本 plan 结束后对比。

---

## Task 2: 后端 start() 注入点 A — 初始化 next* 字段

**Files:**
- Modify: `packages/agentai-gateway/src/cleaner/index.ts:start()`

- [ ] **Step 1: 在 start() 中算初始 next* + 立即 saveState**

定位: `start()` 方法(约 60-95 行)。在 `this.state = await loadState(this.cfg.stateDir);` 之后,`// 全量定时:` 注释之前,插入:

```typescript
        // 暴露 next* 给前端(硬编码 5min/1h, 与下方 setInterval 周期一致)
        this.state.nextQuickCheckAt = Date.now() + 5 * 60 * 1000;
        this.state.nextFullRunAt = Date.now() + 60 * 60 * 1000;
        await saveState(this.cfg.stateDir, this.state);
```

**校验**: 这一步不动 `setTimeout` / `setInterval` 周期,只在它们触发前的"准备阶段"多算两个时间戳并持久化。

- [ ] **Step 2: tsc 验证**

```bash
cd f:\agentai-platform\packages\agentai-gateway
npx tsc --noEmit
```

Expected: 0 新错。

---

## Task 3: 后端 runOnce() 注入点 B — 滚动 next* 字段

**Files:**
- Modify: `packages/agentai-gateway/src/cleaner/index.ts:runOnce()`

- [ ] **Step 1: 在 runOnce() 末尾 saveState 之前滚动 next***

定位: `runOnce()` 方法末尾,约 200-205 行:

```typescript
        this.state.lastScan = Date.now();
        if (opts.scope === 'all') this.state.lastFullRun = Date.now();
        await saveState(this.cfg.stateDir, this.state);
        return result;
```

改为:

```typescript
        this.state.lastScan = Date.now();
        if (opts.scope === 'all') this.state.lastFullRun = Date.now();
        // 滚动 next*: 任何 scope 都更新(nextQuick 固定 +5min, nextFull 滚动到 +24h 作为预估)
        // 注: 当前 setInterval 实际触发 scope:'safe', 但 nextFullRunAt 仍按 24h 周期滚动
        this.state.nextQuickCheckAt = Date.now() + 5 * 60 * 1000;
        this.state.nextFullRunAt = Date.now() + 24 * 60 * 60 * 1000;
        await saveState(this.cfg.stateDir, this.state);
        return result;
```

**校验**:
- 任何 scope 都滚动 → 前端总能看到"下个时点"的更新
- 不再 `if (opts.scope === 'all')` 分支(原 plan 误以为定时器触发 scope:all)

- [ ] **Step 2: tsc 验证**

```bash
cd f:\agentai-platform\packages\agentai-gateway
npx tsc --noEmit
```

Expected: 0 新错。

---

## Task 4: 后端 checkDiskAndRun() 注入点 C — 更新 nextQuickCheckAt

**Files:**
- Modify: `packages/agentai-gateway/src/cleaner/index.ts:checkDiskAndRun()`

- [ ] **Step 1: 在 checkDiskAndRun() 末尾更新 next* + saveState**

定位: `checkDiskAndRun()` 方法末尾(约 268-273 行):

```typescript
        if (total > 1024 ** 3) {
            await this.runOnce({ scope: 'safe' });
        }
    }
}
```

改为:

```typescript
        if (total > 1024 ** 3) {
            await this.runOnce({ scope: 'safe' });
        }
        // 每次磁盘检查完毕都更新 nextQuickCheckAt(无论是否触发清理)
        this.state.nextQuickCheckAt = Date.now() + 5 * 60 * 1000;
        await saveState(this.cfg.stateDir, this.state);
    }
}
```

**校验**:
- 即便 total < 1GB(没触发清理),nextQuick 也会更新 → 避免前端显示永远停留在启动时刻 + 5min
- saveState 调用有 EPERM 重试保护(state.ts 已有 4 次退避)

- [ ] **Step 2: tsc 验证**

```bash
cd f:\agentai-platform\packages\agentai-gateway
npx tsc --noEmit
```

Expected: 0 新错。

---

## Task 5: 后端单测 — start() 后 state 含 next* 字段

**Files:**
- Modify: `packages/agentai-gateway/src/cleaner/cleaner.test.ts`

- [ ] **Step 1: 读现有 test 文件, 找合适的 beforeEach / describe 块**

```bash
cd f:\agentai-platform\packages\agentai-gateway
Get-Content src/cleaner/cleaner.test.ts | Select-Object -First 60
```

定位 `describe('start' ...)` 或类似块,在 `it('...')` 列表末尾追加。

- [ ] **Step 2: 加 test 1: start() 后 next* 字段被初始化**

```typescript
    it('start() should initialize nextQuickCheckAt and nextFullRunAt', async () => {
        const before = Date.now();
        await daemon.start();
        const state = await daemon.getState();
        // nextQuickCheckAt ≈ before + 5min
        expect(state.nextQuickCheckAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
        expect(state.nextQuickCheckAt).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 100);
        // nextFullRunAt ≈ before + 1h
        expect(state.nextFullRunAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
        expect(state.nextFullRunAt).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000 + 100);
        daemon.stop();
    });
```

- [ ] **Step 3: 加 test 2: runOnce({scope:'all'}) 后 nextFullRunAt 更新**

```typescript
    it('runOnce({scope:all}) should update nextFullRunAt to ~+24h', async () => {
        await daemon.start();
        const before = Date.now();
        const r = await daemon.runOnce({ scope: 'all' });
        expect(r.bytesFreed).toBeGreaterThanOrEqual(0);
        const state = await daemon.getState();
        expect(state.nextFullRunAt).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
        expect(state.nextFullRunAt).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000 + 100);
        // 顺手验证 nextQuickCheckAt 也更新
        expect(state.nextQuickCheckAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
        daemon.stop();
    });
```

- [ ] **Step 4: 跑后端单测**

```bash
cd f:\agentai-platform\packages\agentai-gateway
npx vitest run src/cleaner/cleaner.test.ts
```

Expected: 全 PASS(包括新增 2 case)。

- [ ] **Step 5: 检查后端 full build**

```bash
cd f:\agentai-platform\packages\agentai-gateway
npx tsc --noEmit
```

Expected: 0 新错(对比 Task 1 baseline)。

---

## Task 6: 前端 CleanerState interface 增字段

**Files:**
- Modify: `packages/agentai-gui/src/components/CleanerPanel.tsx`

- [ ] **Step 1: 找 CleanerState interface 位置**

```bash
grep -n "interface CleanerState" f:\agentai-platform\packages\agentai-gui\src\components\CleanerPanel.tsx
```

定位后,在 interface 末尾(`lastRuleReload: number;` 之后,`}` 之前)插入:

```typescript
  nextQuickCheckAt: number;   // 下次磁盘检查时间 (ms); 0=未调度
  nextFullRunAt: number;      // 下次全量清理时间 (ms); 0=未调度
```

- [ ] **Step 2: tsc 验证**

```bash
cd f:\agentai-platform\packages\agentai-gui
npx tsc --noEmit
```

Expected: 0 新错。

---

## Task 7: 前端 formatRelative 纯函数(TDD)

**Files:**
- Create: `packages/agentai-gui/src/components/CleanerPanel.test.tsx`

- [ ] **Step 1: 写失败的 formatRelative 测试 (vitest)**

新建 `CleanerPanel.test.tsx`,写入:

```typescript
import { describe, it, expect } from 'vitest';
import { formatRelative } from './CleanerPanel';

describe('formatRelative', () => {
  const NOW = 1_700_000_000_000; // 固定基准时间

  it('returns 未调度 for 0', () => {
    expect(formatRelative(0, NOW)).toBe('未调度');
  });

  it('returns 未调度 for NaN', () => {
    expect(formatRelative(NaN, NOW)).toBe('未调度');
  });

  it('returns 即将执行 for past timestamp', () => {
    expect(formatRelative(NOW - 1, NOW)).toBe('即将执行');
  });

  it('formats seconds', () => {
    expect(formatRelative(NOW + 30_000, NOW)).toBe('30 秒后');
    expect(formatRelative(NOW + 59_000, NOW)).toBe('59 秒后');
  });

  it('formats minutes', () => {
    expect(formatRelative(NOW + 60_000, NOW)).toBe('1 分钟后');
    expect(formatRelative(NOW + 5 * 60_000, NOW)).toBe('5 分钟后');
  });

  it('formats hours', () => {
    expect(formatRelative(NOW + 60 * 60_000, NOW)).toBe('1 小时后');
    expect(formatRelative(NOW + 3 * 60 * 60_000, NOW)).toBe('3 小时后');
  });

  it('formats hours with leftover minutes', () => {
    expect(formatRelative(NOW + 90 * 60_000, NOW)).toBe('1 小时 30 分后');
    expect(formatRelative(NOW + 95 * 60_000, NOW)).toBe('1 小时 35 分后');
  });

  it('formats days', () => {
    expect(formatRelative(NOW + 24 * 60 * 60_000, NOW)).toBe('1 天后');
    expect(formatRelative(NOW + 3 * 24 * 60 * 60_000, NOW)).toBe('3 天后');
  });
});
```

- [ ] **Step 2: 跑测试,确认失败(因为 formatRelative 还没导出)**

```bash
cd f:\agentai-platform\packages\agentai-gui
npx vitest run src/components/CleanerPanel.test.tsx
```

Expected: FAIL with "formatRelative is not exported" 或类似 import error。

- [ ] **Step 3: 在 CleanerPanel.tsx 添加 formatRelative 函数 + export**

在 CleanerPanel.tsx 文件最末尾(export const CleanerPanel 之后),加:

```typescript
/**
 * 把时间戳格式化为相对时间显示
 * @param ts 目标时间戳 (ms)
 * @param now 基准时间戳 (ms), 默认为 Date.now()。测试时注入固定值
 */
export function formatRelative(ts: number, now: number = Date.now()): string {
  if (!ts || isNaN(ts)) return '未调度';
  const diff = ts - now;
  if (diff <= 0) return '即将执行';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} 秒后`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟后`;
  const hr = Math.floor(min / 60);
  const minLeft = min % 60;
  if (hr < 24) return minLeft > 0 ? `${hr} 小时 ${minLeft} 分后` : `${hr} 小时后`;
  const day = Math.floor(hr / 24);
  return `${day} 天后`;
}
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
cd f:\agentai-platform\packages\agentai-gui
npx vitest run src/components/CleanerPanel.test.tsx
```

Expected: 9 case 全 PASS。

- [ ] **Step 5: tsc 验证**

```bash
cd f:\agentai-platform\packages\agentai-gui
npx tsc --noEmit
```

Expected: 0 新错。

---

## Task 8: 前端 Card 渲染 + import ClockCircleOutlined

**Files:**
- Modify: `packages/agentai-gui/src/components/CleanerPanel.tsx`

- [ ] **Step 1: 加 ClockCircleOutlined 到 @ant-design/icons import**

定位第 12 行(已有 import 列表),改为:

```typescript
import {
  ThunderboltOutlined, ReloadOutlined, CheckCircleOutlined, StopOutlined,
  WarningOutlined, SafetyOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
```

- [ ] **Step 2: 在 4 个 Statistic 卡 `<Row>` 之后插入调度状态 Card**

定位: `</Row>` 紧跟(Statistic 卡 4 个 Col 的父),在它之后插入:

```tsx
<Card
  size="small"
  title={<span><ClockCircleOutlined /> 调度状态</span>}
  style={{ marginTop: 12 }}
>
  <Descriptions size="small" column={1} bordered>
    <Descriptions.Item label="下次磁盘检查">
      {formatRelative(state?.nextQuickCheckAt)}
    </Descriptions.Item>
    <Descriptions.Item label="下次全量清理">
      {formatRelative(state?.nextFullRunAt)}
    </Descriptions.Item>
  </Descriptions>
</Card>
```

**校验**:
- `state?.nextQuickCheckAt` 可选链 → 老 state.json 缺字段时传 undefined, formatRelative 收到 undefined → `!ts` true → "未调度"
- Card marginTop 与现有 Card 视觉一致
- 使用已有 `<Descriptions>` (第 13 行已 import)
- `ClockCircleOutlined` 与 `ThunderboltOutlined` 风格一致

- [ ] **Step 3: tsc 验证**

```bash
cd f:\agentai-platform\packages\agentai-gui
npx tsc --noEmit
```

Expected: 0 新错。

- [ ] **Step 4: 跑 CleanerPanel.test.tsx 确认 formatRelative 仍 PASS**

```bash
cd f:\agentai-platform\packages\agentai-gui
npx vitest run src/components/CleanerPanel.test.tsx
```

Expected: 9 case 全 PASS(没影响 formatRelative 逻辑)。

---

## Task 9: E2E test 11 扩 3 断言

**Files:**
- Modify: `packages/agentai-gui/e2e/app.spec.ts`

- [ ] **Step 1: 找 test 11 位置**

```bash
grep -n "清理器面板可访问" f:\agentai-platform\packages\agentai-gui\e2e\app.spec.ts
```

定位后,在 test 11 末尾(最后一个 `await expect(...).toBeVisible();` 之后,`});` 之前)追加:

```typescript
  // 调度状态 Card 可见
  await expect(page.locator('text=调度状态').first()).toBeVisible();
  await expect(page.locator('text=下次磁盘检查').first()).toBeVisible();
  await expect(page.locator('text=下次全量清理').first()).toBeVisible();
```

- [ ] **Step 2: 检查 Playwright 是否可用(可选, 项目可能没装)**

```bash
cd f:\agentai-platform\packages\agentai-gui
npx playwright --version
```

- 如果返回版本号 → 可继续下一步
- 如果报 "command not found" → 跳过 Task 9 实际跑测, 仅修改文件, 加注释 `// TODO: 待装 @playwright/test 后跑`

- [ ] **Step 3: (条件性)跑 test 11**

如果上一步有 Playwright:

```bash
cd f:\agentai-platform\packages\agentai-gui
npx playwright test e2e/app.spec.ts -g "清理器面板可访问" --reporter=list
```

Expected: PASS。如果有 GUI 服务未启动, 看 `webServer` 配置 — 测试可能需要先 build + preview。

**注意**: 此项目此前 Playwright 装过但 @playwright/test 子包缺失。**不主动装新包**(用户保护原则)。

---

## Task 10: 全量验证 + smoke-cleaner 端到端

**Files:**
- Read only / verification

- [ ] **Step 1: 后端 tsc 验证**

```bash
cd f:\agentai-platform\packages\agentai-gateway
npx tsc --noEmit
```

Expected: 0 新错(对比 Task 1 baseline)。

- [ ] **Step 2: 后端单测全套**

```bash
cd f:\agentai-platform\packages\agentai-gateway
npx vitest run src/cleaner
```

Expected: 全部 PASS(包括新加 2 case)。

- [ ] **Step 3: 前端 tsc + 单元测 + build**

```bash
cd f:\agentai-platform\packages\agentai-gui
npx tsc --noEmit
npx vitest run src/components/CleanerPanel.test.tsx
npx vite build
```

Expected:
- tsc 0 新错
- vitest 9 case PASS
- vite build exit 0, bundle hash 与上一轮 build 不同(说明改动入包)

- [ ] **Step 4: bundle 字节验证 (确认 Card 内容入包)**

```powershell
$f = Get-ChildItem f:\agentai-platform\packages\agentai-gui\dist\assets\*.js | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$bytes = [System.IO.File]::ReadAllBytes($f.FullName)
foreach ($s in @('调度状态', '下次磁盘检查', '下次全量清理', 'nextQuickCheckAt', 'nextFullRunAt', 'formatRelative')) {
    $needle = [System.Text.Encoding]::UTF8.GetBytes($s)
    $count = 0
    for ($i=0; $i -le $bytes.Length - $needle.Length; $i++) {
        $ok = $true
        for ($j=0; $j -lt $needle.Length; $j++) { if ($bytes[$i+$j] -ne $needle[$j]) { $ok = $false; break } }
        if ($ok) { $count++; $i += $needle.Length - 1 }
    }
    "{0,-20} : {1} hit(s)" -f $s, $count
}
```

Expected:
- `调度状态`: ≥1 hit
- `下次磁盘检查` / `下次全量清理`: ≥1 hit
- `nextQuickCheckAt` / `nextFullRunAt`: ≥1 hit(虽然 esbuild minify 通常只 mangle export, interface 字段名也常保留为字符串字面量, 但也可能被 mangle — 0 hit 也可接受, 实际跑起来会通过)
- `formatRelative`: 可能 0(minified 成 1 字母名), 实际能跑即可

- [ ] **Step 5: smoke-cleaner.cjs 端到端 (如果 gateway 还在 18789)**

```bash
cd f:\agentai-platform
node smoke-cleaner.cjs
```

Expected: 7 个端点全 200, 第一个 `GET /v1/cleaner/status` 响应含 `nextQuickCheckAt` 和 `nextFullRunAt` 字段(值非 0)。

**如果 gateway 进程不在**:
- 跳过端到端跑(用户保护原则, 不主动启 gateway)
- 但 tsc + 单测 + build + bundle 验证已足够证明改动正确

- [ ] **Step 6: 清理临时 log 文件**

```powershell
Remove-Item -Force -ErrorAction SilentlyContinue `
    f:\agentai-platform\.tsc-*.log, `
    f:\agentai-platform\.build-*.log, `
    f:\agentai-platform\.verify-*.log, `
    f:\agentai-platform\.vite-build*.log
```

---

## Self-Review

**Spec 覆盖检查**:

| Spec Section | Task |
|---|---|
| 4. 数据模型 (CleanerState 2 字段 + EMPTY_STATE) | Task 1 |
| 5.1 types.ts 改动 | Task 1 |
| 5.2 注入点 A (start) | Task 2 |
| 5.2 注入点 B (runOnce) | Task 3 |
| 5.2 注入点 C (checkDiskAndRun) | Task 4 |
| 5.3 无新端点 (验证复用 /status) | Task 10 Step 5 |
| 6.1 CleanerState interface | Task 6 |
| 6.1.1 import ClockCircleOutlined | Task 8 Step 1 |
| 6.2 Card 渲染 | Task 8 Step 2 |
| 6.3 formatRelative 私有函数 | Task 7 |
| 7.1 后端单测 (2 case) | Task 5 |
| 7.2 前端单测 (≥6 case) | Task 7 |
| 7.3 E2E 扩 3 断言 | Task 9 |
| 8 风险缓解 (兼容 / 不动核心 / 不动 IO) | 全程遵守 |
| 10 验收标准 | Task 10 |
| 11 安全护栏 (不 kill / 不 commit / 不引新依赖) | 全程遵守 |

**Placeholder 扫描**: 无 "TBD" / "TODO" / "fill in details" 步骤。Task 9 Step 2 提到的 "TODO" 是项目历史遗留 Playwright 问题注释, 不是 plan 占位。

**类型一致性**:
- `nextQuickCheckAt` / `nextFullRunAt`: 跨 Task 1, 2, 3, 4, 5, 6, 10 全部一致
- `formatRelative(ts, now)`: 跨 Task 7 测试与实现签名一致
- `state?.nextQuickCheckAt`: 跨 Task 8 一致
- 注入点 B 的 `if (opts.scope === 'all')` 逻辑与 spec Section 4 一致

**完成度**: 10 个 Task 覆盖 spec 全部要点。
