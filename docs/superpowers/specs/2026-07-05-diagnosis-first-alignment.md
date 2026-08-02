# 诊断优先主链路 — 理念对齐与拓展

> 状态：方向已对齐
> 制定日期：2026-07-05
> 依据：
> - `f:\agentai-platform\.trae\rules\重构说明`（v1.0 品牌愿景参考，**仅作理念来源**）
> - `f:\agentai-platform\AGENTS.md`（项目核心规则，**最高优先级**）
> - `f:\agentai-platform\.trae\rules\project_rules.md`（项目规范）
> 立场：**当前系统最小改动 + 借鉴"先诊后治"思维模式**。品牌名**可任意替换**，本轮不绑定

---

## 0. 立场

| 维度 | 取舍 |
|------|------|
| 品牌名 | 🔄 **可任意替换**。本轮不锁定 ALTEs · 岐黄 或其他具体名字 |
| 哲学叙事（先诊后治 / 由轻到重 / 调方守中） | ✅ **核心借鉴**，作为现有能力的命名参考 |
| 中医术语（望闻问切 / 证型 / 治法） | ⚠️ **限定使用场景**：UI 文案 + 配置项 value，**禁用于代码标识符** |
| 4 数据对象（感知/缺口/诊断/计划） | ✅ **直接落地**，沿用工程命名 |
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

## 2. 借鉴的 4 类行动

| 行动 | 含义 | 工程映射 |
|------|------|----------|
| 望 | 任务感知 | `task-perception` |
| 闻 | 缺口分析 | `gap-analysis` |
| 问 | 探询追问 | `ask_user` 工具 + 模板 |
| 切 | 结构化诊断 | `diagnosis-engine` |

> 上述"望闻问切"**仅作叙述便利**，工程模块名一律英文（见 §3 命名边界）。

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

**叙述用统一映射**（放 `metaphor.style.md`，可任意改名）：
- 望 = 任务感知 (task perception)
- 闻 = 信息缺口分析 (gap analysis)
- 问 = 探询追问 (inquiry)
- 切 = 结构化诊断 (diagnosis)
- 因证施治 = 治法选择 (treatment selection)
- 调方 = 执行中调整 (in-flight adjustment)
- 体质 = 用户模型 (user profile)

---

## 4. 立刻可动手的最小改动（按价值排序）

### 4.1 P0 必做（6 天节奏）

1. **D1**: 4 数据对象落地到 `packages/agentai-core/src/types/`
   - `TaskPerceptionReport`
   - `DiagnosisReport`
   - `ExecutionPlan`
   - `StepVerificationResult`

2. **D2**: 薄包装 `task-perception.ts`
   - 复用 `meta/intent-clarifier`
   - 借鉴参考文档的 `task_perception_report` 字段

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

## 6. 品牌命名（待你定）

由于品牌可任意替换，本节只列**命名需求清单**。请按需填入：

| 维度 | 需求 | 候选 |
|------|------|------|
| 中文品牌名 | 4-6 字、辨识度高、与"诊断 / 智能体"语义有关 | 待定 |
| 英文品牌名 | 国际化、商标可注册、不与开源项目冲突 | 待定 |
| Logo 概念 | 可用 SVG 表达、有文化底蕴 | 待定 |
| Slogan 中文 | 8-12 字、含核心价值主张 | "先诊后治，由轻到重" |
| Slogan 英文 | 1 句、直译中文或新创 | "Diagnose before you prescribe." |
| 隐喻系统 | 选 1 套（中医 / 西医 / 工程 / 自然 / 其他） | 中医（已对齐） |

> **当前默认**：保留参考文档的"中医隐喻系统"作为 UI 文案，但代码和对外 API 仍用工程命名。

---

## 7. 文件处置

- `重构说明`（参考文档 1329 行）：**保留原样**，作为理念来源
- 本文档（`2026-07-05-diagnosis-first-alignment.md`）：作为**工程实施依据**
- 上一轮 `2026-07-05-diagnosis-first-pipeline-design.md`：与本文档一致，可作为 P0 设计稿

---

## 8. 后续

- ✅ 方向已锁定：当前系统最小改动 + 借鉴先诊后治思维 + 品牌名待定
- 🔜 下一步：调用 `writing-plans` 技能，把 §4.1 的 6 天 P0 转成可执行 task 列表
- 🔜 然后：逐项落地
- 🔜 品牌命名：可在任意阶段决定，不影响本轮 P0

