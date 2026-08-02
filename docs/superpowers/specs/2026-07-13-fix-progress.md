# 修复进度追踪

> 起始日期：2026-07-13
> 范围：网关 + 前端 全系统审查
> 策略：最小改动 + 备份 + 编译验证 + 安全守护

---

## 修复进度

### Critical（3 个）

| # | 问题 | 状态 | 修复日期 | 验证 |
|---|------|------|----------|------|
| 1 | `qq-bot-client.ts` 死代码（无任何引用） | ✅ 已删 | 2026-07-13 | tsc EXIT 0 |
| 2 | `tools.ts` vs `tool-registry.ts` 并行 | ⚠️ 部分 | 2026-07-13 | Xuanji 单例复用，tsc EXIT 0 |
| 3 | `diagnosis/plan-executor.ts` 死代码 | ✅ 标记废弃 | 2026-07-13 | tsc EXIT 0 |

### High（21 个）

| # | 问题 | 状态 |
|---|------|------|
| 4 | `SchedulePanel` vs `AutomationPanel` 95% 重复 | 🟡 待修 |
| 5 | 3 个 ProactiveSuggestion 组件职责模糊 | 🟡 已确认非真重复 |
| 6 | `EditorChatPanel` vs `ChatView` 60% 重复 | 🟡 待审 |
| 7 | `QQBot` (qq.ts) vs `QQBotClient` (删) | ✅ 已删一个 |
| 8 | `prescriptionEngine` 单例 vs `Xuanji` 内部实例 | ✅ 已统一 |
| 9 | `executePlan` 两处（plan-executor + master-controller） | ✅ 已废弃 plan-executor |
| 10 | 20 个 `@ts-nocheck` 文件 | 🟡 长期修复 |
| 11 | `system-prompt.ts.bak.20260712` 备份 | ✅ 已移入 .agentai/backups |

### Medium（20 个）

已发现 20 个，部分合并到 High 中。

### Low（5 个）

- 注释风格
- 测试覆盖
- 命名一致性

---

## 本次修复详情

### 1. 删除 `qq-bot-client.ts` + `qq-bot-client.d.ts`

**操作**：
- 备份到 `.agentai/backups/qq-bot-client.ts.bak.20260713`
- 备份到 `.agentai/backups/qq-bot-client.d.ts.bak.20260713`
- 删除原文件

**安全检查**：
- ✅ 搜索整个 `packages/` 无任何引用
- ✅ `routes/qq.ts` 的 `QQBot` 类独立工作
- ✅ tsc EXIT 0

### 2. 统一 `Xuanji` 使用 `prescriptionEngine` 单例

**文件**：`packages/agentai-gateway/src/xuanji/index.ts`

**改动**：
```typescript
// 改前
import { PrescriptionEngine } from './prescription-engine.js';
this.prescriptionEngine = new PrescriptionEngine();

// 改后
import { prescriptionEngine } from './prescription-engine.js';
this.prescriptionEngine = prescriptionEngine;
```

**安全检查**：
- ✅ `prescriptionEngine` 单例已存在
- ✅ 单例和新建实例行为一致
- ✅ tsc EXIT 0

### 3. 标记 `plan-executor.ts` 为废弃

**文件**：`packages/agentai-gateway/src/diagnosis/plan-executor.ts`

**改动**：425 行 → 88 行（-79%）

**安全检查**：
- ✅ 备份到 `.agentai/backups/plan-executor.ts.bak.20260713`
- ✅ 导出接口保留（向后兼容）
- ✅ 调用时输出警告
- ✅ 真实功能由 `MasterController.executePlan()` 提供
- ✅ tsc EXIT 0

### 4. 清理 `system-prompt.ts.bak.20260712`

**操作**：
- 移到 `.agentai/backups/system-prompt.ts.20260712.bak`
- 删除 `packages/agentai-gateway/src/` 内的 bak

**安全检查**：
- ✅ 内容与 `system-prompt.ts` 完全一致
- ✅ 无其他文件引用 bak
- ✅ tsc EXIT 0

---

## 累计净影响

| 指标 | 数据 |
|------|------|
| 删除文件 | 2 个 |
| 删除代码行 | ~500 行 |
| 标记废弃代码 | ~340 行 |
| 备份文件 | 4 个（位于 `.agentai/backups/`） |
| 编译验证 | ✅ 100% 通过 |

---

## 下一步安全修复候选

| 优先级 | 任务 | 风险 |
|--------|------|------|
| 1 | 合并 `SchedulePanel` + `AutomationPanel` 公共逻辑 | medium |
| 2 | 移除 `tools.ts` 的 `@ts-nocheck` | medium |
| 3 | 进一步拆解 `EditorChatPanel` 与 `ChatView` | low |
| 4 | 补全测试覆盖 | long-term |

---

## 守护原则

1. **不破坏核心功能**：主循环、ALTÉS · 岐黄、QQ Bot 渠道必须保持工作
2. **最小改动**：每次只改一处
3. **备份先行**：删除前必备份到 `.agentai/backups/`
4. **编译验证**：每次改动后必须 `tsc --noEmit` EXIT 0
5. **接口保留**：标记废弃时保留导出接口
6. **可回滚**：所有变更可通过备份还原
