## 修复方案：auto 模式下核心开发工具被双重过滤丢失

### 根因（已逐行核实）
`agentai-loop.ts:2119` 的 else 分支（`_capabilityTier !== 'autonomous'` 时进入）用 AND 逻辑做两道过滤：`filterToolsByIntent` ∩ `getRelevantTools(_taskType)`。第二道的 `CORE_ALWAYS` 白名单（`:2125`）只含决策/生成类工具，**不含 write_file / multi_edit / run_code 等开发工具**。于是这些工具的去留完全取决于 `_taskType`：
- `coding` 任务（消息含"写/修改/文件"等）→ 有 file_ops、无 web_ops → **run_code 被丢**
- `research` 任务（消息含"查/分析"等）→ 有 web_ops、无 file_ops → **write_file / multi_edit 被丢**

加上 `runtime-capability-tracker.ts:541/553` 把免费模型动态降级为 supervised，使其永远走这个 else 分支 —— 这就是"自动模式下永远进不了开发能力"的根因。沙箱（默认禁用，启用后也默认放行）与工具风险等级（只拦 critical，write_file 是 high）均已排除。

### 修复（最小改动，1 处）
**文件**：`packages/agentai-gateway/src/agentai-loop.ts:2125`

把开发核心工具加入 `CORE_ALWAYS` 白名单，使其在任何 `_taskType` 下都豁免任务组过滤。新增（分组+注释，便于后续维护）：
- 文件读写：`write_file`, `multi_edit`, `edit_file`, `undo_edit`, `create_directory`, `delete_file`, `copy_file`, `move_file`, `get_file_info`
- 代码/命令执行：`run_code`, `run_background`, `job_output`
- 文件检索（开发必备）：`search_content`, `glob`, `get_outline`, `find_references`

这是"核心工具白名单"思路：保留"按任务类型裁剪场景化工具（generate_image/browser/decoration 等）以减噪"的设计价值，只把开发核心工具从裁剪中豁免。实现时会先 grep registry 确认每个工具名真实注册（不存在的名字在 `:2129` 的 `CORE_ALWAYS.has()` 判断中无害，但名单保持干净）。

### 不改的部分（避免过度修改，遵循 AGENTS.md 精准原则）
- **不改** `tool-groups.ts` 的分组归类（run_code 在 web_ops）——白名单已根治，动分组还要回归验证行业映射，超出本次范围。
- **不改** `detectTaskType` 正则粗糙性——白名单豁免后，taskType 误判对开发工具无影响。
- **不改** `_capabilityTier` 降级阈值——降级机制本身合理（弱模型确实需要更少噪音），只是不应误伤开发核心工具。
- 前端无需改动（已确认正确发送 `mode:'auto'`）。

### 影响面验证
- `auto` + supervised/guided 模型：**修复目标**，4 种 taskType 下 write_file/multi_edit/run_code 均在最终工具列表。
- `auto` + autonomous 模型：走 `:2115` 全量分支，不受影响。
- `planning`/`review`：走 `:2113` 只读子集分支，不受影响（本就该只读）。
- `readonly`：`:2094` 不进入工具计算，不受影响。

### 验证步骤
1. gateway 包 `npm run typecheck`（或 tsc --noEmit）确认无类型错误。
2. 逻辑走查 4 种 taskType × 关键工具矩阵，确认 write_file/multi_edit/run_code 全部保留。
3. （可选）实跑一个含"修改文件"的消息，观察服务端日志 `[tools-group] taskType=coding filtered X → Y tools` 中 Y 是否包含 run_code。