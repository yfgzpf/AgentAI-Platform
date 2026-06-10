# Cleaner 周期调度状态展示 — Design Spec

| 字段 | 值 |
|---|---|
| 日期 | 2026-06-11 |
| 作者 | AgentAI Assistant |
| 状态 | Draft (待用户 review) |
| 范围 | 纯展示(零后端逻辑改动) |
| 前置 spec | `2026-06-10-cleaner-design.md` |

---

## 1. 目标 (Goal)

让 GUI 用户在 CleanerPanel 中**直观看到**清理器的周期调度状态:
- 下次磁盘占用检查时间(quick check, 5min 周期)
- 下次全量清理时间(full run, 24h 周期)

**不**改变后端定时器逻辑(保持硬编码 5min/24h/1h 不变)。

## 2. 非目标 (Out of Scope / YAGNI)

明确**不做**以下事项,避免范围蔓延:

- ❌ 不加 env 变量配置 interval
- ❌ 不加 `/v1/cleaner/config` 端点
- ❌ 不改 `setInterval` 周期(保持硬编码)
- ❌ 不加 cron 表达式或"每天 X 点"语义
- ❌ 不加前端 toggle/开关/编辑能力
- ❌ 不改 CleanerDaemon.runOnce 业务逻辑
- ❌ 不动 executor / planner / scanner / rule-engine
- ❌ 不动 CleanerPanel 已有 4 个 Statistic 卡
- ❌ 不加新 polling(复用 15s)

## 3. 架构 (Architecture)

**单向数据流**:

```
Gateway start()           → 计算 nextQuickCheckAt/nextFullRunAt → saveState
Gateway setInterval       → checkDiskAndRun() 触发   → 更新 nextQuick  → saveState
Gateway setTimeout+setInt → runOnce({scope:'all'}) → 更新 nextFull    → saveState

Frontend CleanerPanel useEffect(15s)
                         → GET /v1/cleaner/status
                         → setState({...nextQuickCheckAt, nextFullRunAt})
                         → 渲染 <Card title="调度状态"> + formatRelative()
```

**关键约束**:后端**不新增端点**,字段进入现有 `GET /v1/cleaner/status` 响应(向下兼容)。

## 4. 数据模型 (Data Model)

### CleanerState 新增字段(types.ts)

```typescript
export interface CleanerState {
    // ... existing 7 fields (unchanged) ...
    nextQuickCheckAt: number;   // ms timestamp; 0 = 未调度
    nextFullRunAt: number;      // ms timestamp; 0 = 未调度
}
```

EMPTY_STATE 兜底:
```typescript
export const EMPTY_STATE: CleanerState = {
    // ... existing fields ...
    nextQuickCheckAt: 0,
    nextFullRunAt: 0,
};
```

**字段语义**:
- `nextQuickCheckAt`: 下次 checkDiskAndRun() 触发时间
  - 启动时: `Date.now() + 5*60*1000`
  - checkDiskAndRun() 完成时: `Date.now() + 5*60*1000`
  - runOnce() 完成时: `Date.now() + 5*60*1000`(因为 runOnce 可能由磁盘检查触发)
- `nextFullRunAt`: 下次"全量级别"清理预估时间
  - 启动时: `Date.now() + 60*60*1000`(首次 1h 延迟)
  - 每次 runOnce() 完成时: 滚动到 `Date.now() + 24*60*60*1000`
  - **重要**:当前代码路径下,setTimeout/setInterval 触发的实际是 `scope:'safe'`,不是 `scope:'all'`。但 `nextFullRunAt` 仍按 24h 周期滚动 — 语义为"按当前 setInterval 策略, 下个全量级别时点约在 24h 后"。这是预估, 不是精确承诺。

**向下兼容**: 老 state.json 无此两字段时,被 `loadState` 反序列化为 `undefined`,前端 `formatRelative` 收到 0/NaN 时统一显示 "未调度"。

## 5. 后端改动 (Backend Changes)

### 5.1 types.ts — CleanerState 增 2 字段 (3 行)

文件: `packages/agentai-gateway/src/cleaner/types.ts`

位置: `interface CleanerState` 末尾追加, `EMPTY_STATE` 末尾追加。

### 5.2 index.ts — 3 个最小注入点 (< 8 行)

文件: `packages/agentai-gateway/src/cleaner/index.ts`

**注入点 A — start()**:
在 `this.state = await loadState(...)` 之后,`setTimeout` 之前:
```typescript
// 暴露 next* 给前端(硬编码 5min/1h, 与 setInterval 周期一致)
this.state.nextQuickCheckAt = Date.now() + 5 * 60 * 1000;
this.state.nextFullRunAt = Date.now() + 60 * 60 * 1000;
await saveState(this.cfg.stateDir, this.state);  // 持久化初始值
```

**注入点 B — runOnce() 末尾(任何 scope 都更新)**:
在 `saveState(this.cfg.stateDir, this.state)` 之前:
```typescript
// 更新 next*: 下次磁盘检查固定 +5min, 下次全量级别清理滚动到 +24h
// (注: setInterval 实际触发的是 scope:'safe', 但 nextFullRunAt 仍按 24h 周期滚动作为预估)
this.state.nextQuickCheckAt = Date.now() + 5 * 60 * 1000;
this.state.nextFullRunAt = Date.now() + 24 * 60 * 60 * 1000;
```

**注入点 C — checkDiskAndRun() 末尾**:
在 `await this.runOnce({ scope: 'safe' })` 之后:
```typescript
this.state.nextQuickCheckAt = Date.now() + 5 * 60 * 1000;
await saveState(this.cfg.stateDir, this.state);
```

### 5.3 端点: 无新增

完全复用 `GET /v1/cleaner/status`(已注册于 [index.ts:1506](file:///f:/agentai-platform/packages/agentai-gateway/src/index.ts#L1506))。

响应自动包含新字段(JSON 自然序列化)。

## 6. 前端改动 (Frontend Changes)

### 6.1 CleanerPanel.tsx — CleanerState interface 增 2 字段 (2 行)
文件: `packages/agentai-gui/src/components/CleanerPanel.tsx`

位置: 内部 `CleanerState` interface 末尾。

### 6.2 CleanerPanel.tsx — 新增 Card 渲染 (约 25 行)

在已有 4 个 Statistic 卡 `<Row>` 之后插入:

```tsx
<Card
  size="small"
  title={<span><ClockCircleOutlined /> 调度状态</span>}
  style={{ marginTop: 12 }}
>
  <Descriptions size="small" column={1} bordered>
    <Descriptions.Item label="下次磁盘检查">
      {formatRelative(state.nextQuickCheckAt)}
    </Descriptions.Item>
    <Descriptions.Item label="下次全量清理">
      {formatRelative(state.nextFullRunAt)}
    </Descriptions.Item>
  </Descriptions>
</Card>
```

需要 `ClockCircleOutlined` (需添加到现有 `@ant-design/icons` import 行,见文件第 12 行)。

### 6.1.1 CleanerPanel.tsx — import 行加 1 项 (1 行)

在 `@ant-design/icons` import 列表中加 `ClockCircleOutlined`:

```typescript
import {
  ThunderboltOutlined, ReloadOutlined, CheckCircleOutlined, StopOutlined,
  WarningOutlined, SafetyOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
```

### 6.3 CleanerPanel.tsx — 新增 formatRelative 私有函数 (约 20 行)

```typescript
/** 把时间戳格式化为相对时间显示 */
function formatRelative(ts: number, now: number = Date.now()): string {
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

**关键设计**: 第二个参数 `now` 默认 `Date.now()`,但**测试时可注入固定时间**(避免 1 秒漂移问题)。

## 7. 测试 (Testing)

### 7.1 后端单测(扩展 cleaner.test.ts)

加 2 个 case:
1. `start() 后 state 含 nextQuickCheckAt ≈ now+5min`
2. `runOnce({scope:'all'}) 后 nextFullRunAt 更新为 now+24h`

### 7.2 前端单测(新建 CleanerPanel.test.tsx)

- `formatRelative(0) → '未调度'`
- `formatRelative(NaN) → '未调度'`
- `formatRelative(now - 1) → '即将执行'`
- `formatRelative(now + 30_000) → '30 秒后'`
- `formatRelative(now + 90_000) → '1 分钟后'`
- `formatRelative(now + 3_600_000) → '1 小时后'`
- `formatRelative(now + 5_400_000) → '1 小时 30 分后'`
- `formatRelative(now + 86_400_000) → '1 天后'`

### 7.3 E2E (app.spec.ts test 11 微调)

扩展断言,验证 CleanerPanel 含:
- `text=调度状态` 可见
- `text=下次磁盘检查` 可见
- `text=下次全量清理` 可见

## 8. 风险与缓解 (Risks & Mitigations)

| 风险 | 等级 | 缓解 |
|---|---|---|
| 老 state.json 无 next* 字段,被反序列化为 undefined | 低 | `formatRelative` 收到 0/NaN 显示 "未调度" |
| start() 注入点 A 失败 → state 未持久化 | 低 | 用现有 `saveState`,已有 EPERM/EACCES/EBUSY 4 次退避重试 |
| runOnce() 注入点 B 位置错误导致 nextFullRunAt 不更新 | 低 | 位置: 现有 `saveState` 之前,与 `if (opts.scope === 'all')` 同一处 |
| 前端 15s 轮询间隔内时间戳漂移 | 无影响 | 纯展示, 执行由后端 setInterval 决定 |
| 新字段与未来字段重名 | 极低 | 当前 CleanerState 无重名可能 |
| saveState 频次变化(每次 runOnce 多写一次) | 低 | 频次未变(每次 runOnce 本就 saveState), 只是多写 2 个 number |

## 9. 文件清单 (File Manifest)

**后端** (3 files):
- `packages/agentai-gateway/src/cleaner/types.ts` (+3 行)
- `packages/agentai-gateway/src/cleaner/index.ts` (+7 行)
- `packages/agentai-gateway/src/cleaner/cleaner.test.ts` (+~30 行, 2 cases)

**前端** (2 files, 可能 3):
- `packages/agentai-gui/src/components/CleanerPanel.tsx` (+~30 行)
- `packages/agentai-gui/src/components/CleanerPanel.test.tsx` (新建, +~40 行)
- `packages/agentai-gui/e2e/app.spec.ts` (test 11 扩 3 断言)

**未触动**:
- `package.json` / `pnpm-lock.yaml`
- `.env` / `.env.example` / `.gitignore`
- 任何 cleaner 子模块 (executor / planner / scanner / rule-engine / smart-scheduler)
- Gateway 任何其他路由
- 任何 other React 组件
- `state.json` 物理格式(纯加字段, 向下兼容)

## 10. 验收标准 (Acceptance Criteria)

- [ ] `npx tsc --noEmit` 0 错 (backend + frontend)
- [ ] `npx vite build` exit 0
- [ ] 后端 `cleaner.test.ts` 新增 2 case 通过
- [ ] 前端 `CleanerPanel.test.tsx` 新增 ≥ 6 case 通过
- [ ] `smoke-cleaner.cjs` 端到端跑通, `GET /v1/cleaner/status` 响应含 `nextQuickCheckAt` / `nextFullRunAt` 字段
- [ ] 手动启动 Gateway, 1 分钟内 `state.json` 出现两个新字段(非 0)
- [ ] 浏览器访问 `/cleaner` 路由, 看到「调度状态」Card + 两行时间
- [ ] 没有任何现有功能回归(7 个原端点响应 shape 不变, 字段追加而非修改)

## 11. 不破坏的安全护栏 (Safety Guards)

- 不 kill 任何后台进程(18789, 5173 等)
- 不修改任何已存盘的 state.json 文件(只追加新字段, 不删除)
- 不引入新依赖(纯 React + antd + 现有 deps)
- 不改 Gateway 启动/关闭/优雅退出流程
- 不改 CleanerDaemon.start() 的 setInterval/setTimeout 周期
- 不改 CleanerDaemon.runOnce 业务逻辑
- 不动 executor / planner / scanner / rule-engine / smart-scheduler 文件
- 任何失败 → 回滚本次所有改动(只动 5 个文件, 全 revert 简单)
- 不 git commit(等用户授权)

## 12. 后续可选 (Future / Out of Scope)

- 加 env 配置 `AGENTAI_CLEANER_QUICK_INTERVAL_MS` / `FULL_INTERVAL_MS`
- 加 `/v1/cleaner/config` PUT 端点
- 加前端「调度设置」Panel (30min/1h/3h/6h/24h 选择)
- 加 cron 语义("每天 03:00 全量")
- 持久化用户偏好(写到 profile 而非 state.json)

这些都**不在本 spec 范围**。
