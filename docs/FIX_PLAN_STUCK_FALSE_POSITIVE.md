# 修复计划：挖洞过程中"疑似卡死"提示反复出现

> 状态：**待拍板，尚未实施** · 制定时间 2026-10-17 01:05

---

## 一、问题现象（实机截图）

- `⚠️ 工具 enum_subdomains 疑似卡死 (3 次调用)` **连播十几次**
- count 恒为 3，不涨
- 期间模型在正常汇报（"已确认 tycredit.com（天翼），继续 valaSRC 深挖，已有 2 个洞"）
- **结论：模型根本没卡死，这是误报**

## 二、根因（三层，缺一不可）

### 根因 A：振荡 —— 10-16 的两处修复在互殴 ⭐ 主因

`agentai-loop.ts` 两处代码互相破坏：

| 位置 | 代码 | 意图 |
|---|---|---|
| L4887-4892 | `if (!seenSigsThisRound.has(sig)) { duplicateTracker.delete(sig); **this._stuckEmitted.delete(sig)**; }` | 陈旧剔除：模型换参数后旧失败不再"连续" |
| L4897 | `const firstReport = !this._stuckEmitted.has(sig);` | 边沿触发：同一 sig 只播一次 |

模型在几个域名之间来回试时（`enum_subdomains` 换不同子域名 = 典型）：

```
1. sig=A 连续失败 3 次        → 边沿触发播报一次 ✅
2. 模型换域名 → sig 变 B      → A 不在本轮 → 「已播报」标记被删 ❌
3. 模型换回原域名 → sig 变回 A → !has(A) 成立 → 又播报 ❌
                              ↓
                        每轮重播一次 = 截图里的十几次
```

### 根因 B：`tool:stuck` 这条路**根本没有豁免机制**

⚠️ 重要：`LOOP_EXEMPT_TOOLS`（L5261）**只被死循环硬停使用**，
`tool:stuck`（dup_fail，L4887-4902）**完全不看这个名单**。
→ 所以"往豁免名单加 `enum_subdomains`"这个直觉修法**无效**。

### 根因 C：探测类工具被当成"搜索类"对待

`enum_subdomains` / `http_replay` / `browser_*` **换参数 = 正常探测**，
但 dup_fail 的语义是"同参数连续失败"。扫描不同目标本该豁免，现在没豁免。

### 附带：不是子智能体的锅

截图里"已确认 tycredit.com（天翼）"说明用的是**免费档模型**。
免费模型走 `agentai-loop.ts:4350` 降级路径：**不 spawn 子智能体，主 Agent 自己跑完**。
所以 `enum_subdomains` 是主 Agent 的工具，走主 loop 的 `tool:stuck`。
（真子智能体是独立实例，其 `tool:stuck` 未被转发给主 loop。）

---

## 三、修复方案（分四层，建议 P0 一次做完）

### 🔴 P0-1　播报边沿按【工具名】而非 sig —— 根治振荡

**文件**：`agentai-loop.ts`

```ts
// 新增字段（替代 _stuckEmitted 的语义）
private _stuckEmittedTool = new Set<string>();
// run() 开头一并 clear()

// L4897 改为
const firstReport = !this._stuckEmittedTool.has(toolName);
if (firstReport) {
  this._stuckEmittedTool.add(toolName);
  this.emit('tool:stuck', { tool: toolName, count });
}
```

**语义**：一个任务内，同一个工具**只播报一次**卡死提示。
模型怎么换参数都不会重播 —— 振荡彻底消失。

### 🔴 P0-2　陈旧剔除不再删除"已播报"标记

**文件**：`agentai-loop.ts` L4887-4892

```ts
for (const sig of [...duplicateTracker.keys()]) {
  if (!seenSigsThisRound.has(sig)) {
    duplicateTracker.delete(sig);   // 只清计数，保留播报记录（P0-1 后播报记录在 _stuckEmittedTool）
  }
}
```

### 🔴 P0-3　给 dup_fail 单独建"探测类豁免"名单

**文件**：`agentai-loop.ts`

新增 `PROBE_EXEMPT_TOOLS`，在 dup_fail 判定里跳过：

```
enum_subdomains, http_replay, browser_navigate, browser_click,
browser_extract, wsl_scan, save_evidence, extract_js_endpoints,
send_message, list_windows, desktop_automate
```

**理由**：这些工具换参数就是换了探测目标，属于正常工作流。

### 🟡 P1　前端兜底去重（纵深防御）

**文件**：`ChatView.tsx` `onToolStuck` (L1158)

即使后端漏发，同一工具在同一消息里也只渲染一次：

```ts
onToolStuck: (info) => {
  updateMessage(botId, (m) => {
    const dup = (m.segments || []).some(s =>
      s.kind === 'text' && s.text?.includes(`工具 \`${info.tool}\` 疑似卡死`));
    if (dup) return m;
    return { ...m, segments: [...m.segments, {...}] };
  });
}
```

### 🟢 P2　提示文案改得不那么刺眼

现在的 `疑似卡死` 本身就制造焦虑，且对探测类工具是错误定性。
改成 `工具 X 多次返回失败（可能原因：…）`，只在真有错误时出现。

---

## 四、改动清单

| 文件 | 位置 | 改动 | 风险 |
|---|---|---|---|
| `agentai-loop.ts` | 字段声明 ~L337 | 加 `_stuckEmittedTool` | 低 |
| `agentai-loop.ts` | `run()` ~L2306 | 补 `.clear()` | 低 |
| `agentai-loop.ts` | L4887-4892 | 剔除不删播报标记 | 低 |
| `agentai-loop.ts` | L4893-4902 | 边沿按工具名 | 中（语义变更） |
| `agentai-loop.ts` | dup_fail 判定前 | 加探测类豁免 | 低 |
| `ChatView.tsx` | L1158 | 前端去重 | 低 |

**总改动集中在 1 个文件 5 处 + 1 处前端**，全部在检测层，不触碰任何业务逻辑。

## 五、验证方式

1. **行为测试**（新增，锁不变量）
   - 同一工具换参数反复失败 → `tool:stuck` **只 emit 1 次**
   - 两个不同工具各自失败 3 次 → 各 emit 1 次
   - `enum_subdomains` 换 5 个域名全失败 → **0 次 emit**
   - 陈旧剔除后 `_stuckEmittedTool` 仍保留记录
2. **回归**：`runtime-guard.test.ts`（现有 60 条必须全绿）+ `scope-guard` + `evidence-path` + `pentest-scope`（88 条）
3. `tsc --noEmit`
4. **`npm run build` + grep 验证进 dist**（本仓库已因此栽过两次）

## 六、待确认

- 是否连 **P2 文案**一起改？（改了之后前端措辞会变）
- `LOOP_EXEMPT_TOOLS` 是否顺带补探测类？（硬停那条路也该补，但属另一议题）
