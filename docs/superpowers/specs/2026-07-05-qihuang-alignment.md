# 中医理念对齐 — AgentAI Platform 借鉴与拓展

> ⚠️ **本文档已被新版替代**，请看 [`2026-07-05-diagnosis-first-alignment.md`](./2026-07-05-diagnosis-first-alignment.md)
> 旧版状态：保留仅供对比参考
> 新版关键变化：品牌名不再绑定，可任意替换

---

## 0. 立场

| 维度 | 取舍 |
|------|------|
| 品牌名（ALTES · 岐黄） | ❌ **不引入**。`AGENTS.md` 明确"不重命名 packages" |
| 哲学叙事（三种文明融合） | ✅ **产品文案层使用**（README、UI 文案、对外宣发） |
| 中医术语（望闻问切 / 证型 / 治法） | ⚠️ **限定使用场景**：UI 文案 + 配置项 value，**禁用于代码命名** |
| 诊断-施治 思维模型 | ✅ **核心借鉴**，作为现有 `meta/` 能力的命名参考 |
| 4 数据对象（感知/缺口/诊断/计划） | ✅ **直接落地**，沿用 v2.0 工程命名 |
| 4 层漏斗（轻到重） | ✅ **借鉴**，指导 LLM 路由选择 |
| 双引擎 / 辩论室 / 回阳救逆 | ❌ **不实现**，P1+ 再考虑 |
| 维纳塔 5 子系统 | ❌ **不实现**，超出当前范围 |

---

## 1. 借鉴的核心思维（不变 + 可拓展）

### 1.1 "先诊后治"思维
- **现状**：当前主循环 `agentai-loop.ts` 直接进入 LLM 调用
- **借鉴**：在主循环前增加"任务感知 + 缺口分析"两步，参考但**不重写主循环**
- **可落地**：复用 `meta/intent-clarifier`（已有）

### 1.2 "由轻到重"漏斗
- **现状**：LLM 路由已有评分机制 + fallback
- **借鉴**：明确"先免费轻量，再付费强模型"的优先级表
- **可落地**：补充路由配置表的轻量优先规则

### 1.3 "留白"处理
- **现状**：歧义检测后要么追问要么硬走
- **借鉴**：4 类处理（追问 / 自补 / 推迟 / 尊重）
- **可落地**：扩展 `IntentClarifier` 的 gap action 字段

### 1.4 "调方"（执行中验证）
- **现状**：`judge/self-eval` + `auto-error-repair` 已部分实现
- **借鉴**：明确验证结果的"继续 / 重试 / 重规划 / 追问"4 个 followup action
- **可落地**：4.2 节中的 4 数据对象之一 `StepVerificationResult`

### 1.5 "体质积累"（用户模型）
- **现状**：`user-model.ts` 已有用户身份 + 行业感知
- **借鉴**：扩展示范为"用户偏好模式 + 行为习惯 + 风险偏好"
- **可落地**：扩展 `user-model.ts` 字段（不重写）

---

## 2. 借鉴但**不照搬**的部分

| ALTES 文档章节 | 借鉴 | 不照搬 | 当前系统映射 |
|---------------|------|--------|------------|
| 第一章 品牌定位 | 思维模型 | 品牌名 / Logo | — |
| 第二章 五大原则 | "先诊后治" "由轻到重" | 三种文明叙事 | 系统提示 / 内部规范 |
| 第三章 架构图 | 三层结构概念 | 整体重写 | 已有 monorepo |
| 第四章 望闻问切 | 四诊思维 + 数据对象 | 5 个中医证型枚举 | `meta/intent-clarifier` + `confidence-estimator` |
| 第五章 因证施治 | 治法选择 + 调方 | 6 个隐喻治法名 | `meta/strategy-selector` + `judge/self-eval` |
| 第六章 ALTES 引擎 | — | — | 已有 `llm-router` / `tool-registry` / `context-manager` |
| 第七章 维纳塔 | — | 5 子系统 | 全部不做 |
| 第八章 双引擎 | 双阶段生成 | 实现细节 | P1+ |
| 第九章 成本控制 | 数字预算 + 监控 | dashboard 实现 | `rate-limiter` 已有部分 |
| 第十章 分期 | P0-P5 思路 | 21-30 周时间 | 压缩到 6 周 |
| 第十一章 编码规范 | 命名 + 数据流约定 | Python 目录结构 | 沿用 TS monorepo |
| 第十二章 Prompt 规范 | 分类 + 模板 | — | `system-prompt.ts` 已有 |
| 第十三章 测试 | 5 证型 + 任务集 | — | 补充 5 类任务 fixture |
| 第十四章 文档 | 文档体系 | 全部新建 | 沿用现有 `.trae/rules/` |
| 第十五章 社区 | — | 全部 | 不做 |

---

## 3. 中医术语使用边界

| 场景 | 允许 | 禁止 |
|------|------|------|
| **产品文案** | ✅ README、UI 提示、对外宣发 | — |
| **前端 UI 按钮 / 提示** | ✅ "开始诊断"、"查看处方"、"调方中" | — |
| **配置文件 value** | ⚠️ 可选 `mode: 'wang' / 'wen' / 'qie'` | 不当主键 |
| **代码标识符（变量/类/枚举/文件）** | ❌ | **完全禁止** |
| **数据库 / API 字段** | ❌ | **完全禁止** |
| **日志 / 错误信息** | ⚠️ 仅在用户可见的 toast | 不进系统日志 |

**统一定义**（放 `metaphor.style.md`）：
- 望 (wang) = 任务感知
- 闻 (wen) = 信息缺口分析
- 问 (wen_ask) = 探询追问
- 切 (qie) = 结构化诊断
- 因证施治 (treatment) = 治法选择
- 调方 (tiaofang) = 执行中调整
- 体质 (constitution) = 用户模型

---

## 4. 立刻可动手的最小改动（按价值排序）

### 4.1 P0 必做（6 天节奏，沿用 v2.0）

1. **D1**: 4 数据对象落地到 `packages/agentai-core/src/types/`
   - `TaskPerceptionReport`
   - `DiagnosisReport`
   - `ExecutionPlan`
   - `StepVerificationResult`

2. **D2**: 薄包装 `task-perception.ts`
   - 复用 `meta/intent-clarifier`
   - 借鉴 ALTES 4.2 章的 `task_perception_report` 字段

3. **D3**: 薄包装 `diagnosis-engine.ts`
   - 复用 `meta/confidence-estimator`
   - **关键决策**：用工程化 `execution_mode`（5 选 1），**不用中医证型 5 选 1**

4. **D4**: 薄包装 `plan-assembler.ts` + `step-verifier.ts`
   - 复用 `tools.plan_task` + `judge/self-eval`
   - followup action: 4 选 1（continue / retry / replan / ask_user）

5. **D5**: 主循环 4 调用点
   - 入口插入 `perception + diagnosis`
   - 决策分支 `clarify_first → ask_user`
   - 每个 step 后 `verify`

6. **D6**: SSE 4 事件 + 4 UI 卡片

### 4.2 P1 推荐（1-2 周，可选）

1. **路由轻量优先规则表**
   - `provider-config.ts` 补充：默认走免费 → 失败升级付费
2. **用户模型扩展**
   - `user-model.ts` 增加 `preference_pattern` / `risk_preference` 字段
3. **4 类缺口 action**
   - `ask / self_fill / defer / respect`，扩展 `IntentClarifier`

### 4.3 P2+ 不做

- 双引擎 / 辩论室 / 对抗验证 → 不实现
- 维纳塔 5 子系统 → 不实现
- 社区治理 → 不实现

---

## 5. 与现有规则的对齐

| 规则 | 当前文档的处理 |
|------|---------------|
| `AGENTS.md` 4 条核心规矩 | ✅ 最小改动、不优化、目标驱动、搜索后再改 |
| `AGENTS.md` Never Rules | ✅ 不硬编码、不重命名、不杀进程 |
| `project_rules.md` 命名规范 | ✅ 沿用小写下划线，模块/类/函数全英文 |
| `project_rules.md` 架构约束 | ✅ 沿用 monorepo + 严格单向依赖 |
| `project_rules.md` 颜色规范 | ✅ 前端用 CSS 变量 |
| `project_rules.md` 组件注册 | ✅ 走 PAGES 字典 |

---

## 6. 文件处置

- `重构说明`（ALTES v1.0 全文）：**保留原样**，作为品牌愿景/产品文案参考
- 本文档（`2026-07-05-qihuang-alignment.md`）：作为**工程实施依据**
- 上一轮 `2026-07-05-diagnosis-first-pipeline-design.md`：与本文档一致，可作为 P0 设计稿

---

## 7. 后续

- ✅ 已锁定方向：当前系统最小改动 + 中医理念借鉴
- 🔜 下一步：调用 `writing-plans` 技能，把 §4.1 的 6 天 P0 转成可执行 task 列表
- 🔜 然后：逐项落地

