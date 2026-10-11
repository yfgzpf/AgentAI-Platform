# PulseFlow 平台能力实测清单（借鉴参考版）

> **实测日期**：2026-10-10
> **实测方式**：源码级审计（AST/行区间精确统计），非文档摘抄
> **代码基线**：`agentai-gateway` 292 文件 / 29 子系统 / 18090 行核心四件套

---

## 零、先看这一段：文档失真清单

**如果你直接照 AGENTS.md 开发，会踩到这些坑。** 以下都是本次实测发现的、文档与代码不符之处：

| 文档宣称 | 实测结果 | 影响 |
|---|---|---|
| 141 个工具 | **198 个声明**，全部有实现（`tools.ts:749-1382`） | 少估 57 个，架构容量认知偏差 |
| 「8 层上下文注入」 | **49 处 system push 点** | 低估 6 倍，prompt 膨胀风险严重低估 |
| 「system-prompt.ts 约 250 行」 | **625 行**（`system-prompt.ts:16-641`） | 文档自己承认过时但未修订 |
| 「智能决策层已清理死代码」 | 决策层是**活的**，置信度/歧义/元认知均在主循环被真实调用 | 误判为死代码会删掉真正的差异化能力 |
| 「记忆 >30 条自动合并」 | **无合并逻辑**，实际是构建期排序截断（slice） | 照抄会实现出一个不存在的功能 |
| 「测试覆盖 xx%」 | 65 个测试文件，但**6416 行的 agentai-loop.ts 零覆盖** | 核心上帝类无任何回归保护 |

> **教训**：接手任何宣称「已完成/已精简」的项目，第一件事是写个统计脚本核对真实数字，而不是读文档。本文的工具数量就是这么查出来的——中途因为正则截断、shell 引号转义、模板字符串干扰报错 5 次才拿到准数。

---

## 一、直接抄（高价值、低耦合）

### 1. 修复管道 6步 —— 全项目最值得抄的一块

位置：`llm-router.ts:981` `repairPipeline(raw)`，在 `chat():820` 调用。

```
1. flattenToolCalls    llm-router.ts:1235  嵌套对象压成点号键，数组保留不展平
2. scavengeFromThink   llm-router.ts:1260  从<think>块正则打捞被吞的 JSON
3. detectCallStorm     llm-router.ts:1281  同轮≥3调用时签名去重计数，仅告警
4. repairTruncation    llm-router.ts:1294  统计括号差值补齐
5. repairToolCallArgs  llm-router.ts:1172  尾逗号→引号→无引号key→undefined
6. parseTextToolCalls  llm-router.ts:1013  4种降级格式文本转 tool_call
```

**两个「克制」设计是精华：**

- **Step4 只补 args 的括号，绝不动 content。** 代码注释写明原因：对代码内容补 `}` 会破坏语法（`if(x){` 被补成 `if(x){}` 而语法错）。这是很多人写修复器会犯的错。
- **Step5 的 `smartQuoteFix`（:1200）是状态机逐字符扫描**，只把 JSON **边界位置**的单引号换成双引号，字符串**内部**的单引号原样保留，内部双引号转义为 `\"`。动机注释举例：`{"code":"console.log('hello')"}` 不被误伤。用全局正则做这件事必翻车。

**Step6 降级格式矩阵**：`func(args)` / ` ```tool ` 代码块 / `<tool_call>` XML / **DSML 伪XML**（DeepSeek 系私有格式）。工具名用 `KNOWN_TOOLS_NAMES` 白名单（约110个）校验。**解析成功后必须从content 正则擦除已消费文本**，否则模型会重复输出已执行的调用。

### 2. multi_edit 三阶段事务

`tools.ts:1824 / 1862 / 1891`

```
Phase1 预检 + 备份  → 任一 old_str 未找到，直接返回，一字不改
Phase2 原子执行     → 统一 backupId = Date.now()，批量备份
Phase3 回滚        → 任一 write 抛错即 break，遍历 backups 全部还原
```

**预检失败必须完全不改**——这是很多编辑器类工具缺的。备份即一次性令牌：`undo_edit` 用完 `unlinkSync` 删除。

### 3. 沙箱 fail-closed

`sandbox/checker.ts:91行`，优先级 `deny > size > prompt > default-allow`。

```ts
} catch (e: any) {
  return { verdict: 'deny', reason: `Sandbox check error: ...`, source: 'error' };
}
```

**异常必须返回 deny 而不是放行。** 配套 `safety/path-guard.ts:60` 用 `resolved.startsWith(r + path.sep)` 防前缀绕过（`/workspace-evil` 不能通过 `/workspace` 校验）。

### 4. 上下文二段式结构

```
immutablePrefix  → system 部分，构建一次后永不改变，缓存在 context 上
appendOnlyLog    → 历史对话，只追加
```

**这是整个平台最该学的架构决策。** 好处：缓存命中率高、system 稳定可测、不会因为中途改历史而污染前缀。

---

## 二、抄思路，但要重做实现

### 1. 双写验证防抖（有漏报缺陷）

`tools.ts:427` `auto_verify`，`VERIFY_DEBOUNCE_MS = 2000`，合并 2 秒内多次写入为一次 `tsc --noEmit --incremental`（timeout 30s），按 basename 过滤只回传相关错误（`slice(0,10)`）。

**三个缺陷——照抄前必须改：**
- 防抖命中时直接 `return _verifyLastResult`，可能是 `null` → **漏报**
- `multi_edit` 只传 `editedFiles[0]` → 多文件场景漏检
- 只覆盖 `.ts/.tsx/.js/.jsx`，Python/Go 不验证

**改进方向**：防抖期间返回 `pending` 状态而非上次结果；改为全量文件集。

另注意：存在**平行冗余实现** `src/validator.ts`（`detectProject()` 按 package.json/tsconfig/pyproject/go.mod 自动选验证器 + `parseErrors()` 结构化 tsc 输出），但**未被 write_file 链路调用**。这个设计（项目类型自动识别）值得抄，实现冗余不要抄。

### 2. 工具声明与实现的一致性校验

实测结果（`tools.ts:749-1382` 声明 vs `tools.ts:1383-7459` 实现）：

```
声明 198 / 实现 203
声明无实现：0       ← 健康
实现未声明：5       ← edit_file, get_symbols, clear_plan, knowledge_explore, _formatBytes
风险等级：low 107 / medium 51 / high 20
```

注册逻辑 `index.ts:133`：`EXTRA_TOOLS` 循环取 `EXTRA_HANDLERS[spec.name]`，缺 handler 则 `console.warn` + `continue`。**静默跳过**——这 5 个 handler 永远不会注册，但没有任何编译期或启动期错误。

**借鉴点**：注册时的一致性校验思路对，但应该做成**构建期 fail-fast 校验脚本**，而不是运行时 warn。另有`index.ts` 里15 处独立 `registry.register()` 绕过了这套校验，边界不统一。

### 3. MCP 客户端（手写，值得抄结构）

`mcp/host.ts:301行`，**不依赖官方 SDK**，手写 JSON-RPC 2.0。

- 双transport：stdio（spawn）+ HTTP（POST，:237）
- 生命周期：`initialize` → `notifications/initialized` → `tools/list` → 逐个注册（命名 `${server}.${tool}`，统一 `riskLevel: 'medium'`）
- **两处消毒必抄**：
  - `normalizeSchema()` 强制 `type:'object'`（模型经常返回残缺 schema）
  - 工具名 `replace(/[^a-zA-Z0-9_-]/g,'_')`
- 配置持久化到 `.agentai/mcp-servers.json`，`restoreSaved()` 启动重连

### 4. 技能渐进式披露

`skills/loader.ts`（约2100 行引擎）

- 匹配是**关键词打分非语义**：triggers 命中 +10、name +5、description 分词（≥2字）+2，取 top-N（:226）
- **渐进式披露**：只把 name/description/tools/triggers 拼 markdown 注入 system prompt（:303），正文按需 `getSkill(name)` 拉取
- chokidar 热加载（`watcher.ts`）

**借鉴点**：渐进式披露是控制 prompt 膨胀的正确姿势。但关键词匹配太弱，建议自己开发时直接上语义检索。

### 5. 路由五维评分

`model-classifier.ts:580computeScore()`（**不在 llm-router.ts**，文档指错了）

```
复杂度 0.30 + 上下文 0.15 + 成本 0.20 + 成功率 0.25 + 延迟 0.10
```

**两个细节值得抄：**
- **未定价的付费模型成本分给 0.5 中性值**（:604）。注释说明原公式让未填 price 的付费模型与免费模型同拿满分，即「付费当免费」——这是个真实的坑。
- successRate/latency 无数据时默认 **0.5 冷启动**，而不是 0（否则新模型永不被选中）。

**熔断**（`llm-router.ts`）：`CB_COOLDOWN_MS=2min`、`CONSECUTIVE_FAIL_THRESHOLD=3`、限流 429 指数退避 10s→120s、`FLAKY_PROVIDERS={sensenova,longcat}` 设 15s 短超时。
**重要修正**（:692 注释）：移除了 force-untrip——原逻辑对熔断中的 provider 每请求强试一次，**完全绕过 2 分钟冷却**。降级链：用户指定则锁定 → 同模型重试 3 次（指数退避 1s→30s）→ 备用 → 免费池 6 个轮换 → deepseek-flash（关 thinking）→ 兜底文案。
（2026-10-11：DeepSeek 发布 V4.1-Flash，flash 档模型名由 `deepseek-v4-flash` 改为 `deepseek-flash`；代码统一收敛到 `llm-router.ts` 的 `DEEPSEEK_FLASH_MODEL` 常量，旧名保留为兼容别名。）

---

## 三、必须避开的坑

### 1. 上帝类：agentai-loop.ts 6416 行 / 352KB

单文件承载 49 处注入点 + 全部主循环控制 + 决策层调用 + 工具分发。**自己开发时务必按子系统拆分**。至少分出：`context-builder` / `loop-controller` / `tool-dispatcher` / `memory-integration` / `decision-layer`。

### 2. 重复实现

- Step4 截断补齐在 `llm-router.ts:1294` 和 `agentai-loop.ts:3636` 各实现一遍
- `validator.ts` 与 `tools.ts:auto_verify` 两套验证器，只有一套被调用

### 3. 整文件 @ts-nocheck

`tools.ts` 全文关闭类型检查。198 个工具的参数没有类型保障。

### 4. 硬编码本机绝对路径

`_isSafeFileModification()`（`agentai-loop.ts:6265`）里有 `^f:\\agentai-platform\\packages\\...` 这类硬编码路径。AGENTS.md 明令禁止，但自己代码里犯了。

### 5. 跨轮重复检测的误伤（真实 bug，值得当反面教材）

`agentai-loop.ts:3636-3670` 的跨轮去重，签名用 `JSON.stringify(args).slice(0,500)` → 两个不同的 `write_file` 前 500 字符相同 → **用户改动被静默丢弃**。修复为全量签名，且跳过时写 `[SKIPPED]` tool 消息让 AI 可感知。

**教训**：去重/去重逻辑一定要有「可感知的中止信号」，静默丢弃是最坏的一种。

### 6. 上下文膨胀无按需加载

49 处注入是**全量前置 + 关键词门控**，没有真正的按需加载。`MetaCognitiveLoop` 仅弱模型启用（`tier!=='autonomous' && iteration < maxIterations*0.5`），强模型完全绕过决策层。

---

## 四、平台真正稀缺的东西（不是代码能抄的）

### 1. 连续状态监控与三重续跑

三个**互不干扰**的计数器，这是长期任务不崩的关键：

| 计数器 | 值 | 位置 | 作用 |
|---|---|---|---|
| `MAX_AUTO_RESUME` | 10 | `agentai-loop.ts:2601` | 截断续跑（length） |
| `MAX_SHORT_REPLY_RESUME` | 3 | `:2605` | 短回复空转，**排除问候/告别正则** |
| 迭代上限 | — | — | 总轮数保护 |

超时保护**不是硬超时而是降级**（:3196）：`llmTimedOut` 时工具裁剪到 8 个核心、messages 压缩为 `system + 最近6条`、`sanitizeToolMessages` 防assistant→tool 配对断裂。**这个思路比直接 kill 高级得多。**

工作记忆摘要（:2709）每 10 轮生成，**先 `splice` 掉旧的再 `unshift` 新的**——防无限膨胀的关键。

中断用**代际检查**（`myGeneration !== this._runGeneration`）而非 `abortSignal`，优雅 return 而非 throw。

### 2. 自进化的资产化落地

```
evolve_prompt  → .agentai/evolved-rules.json（上限 20 条，超出 slice(-20)）
                → 下次对话全量拼进 prompt（:1292）
create_tool    → .agentai/custom-tools/ + registry.json
                → 进程启动时 await import(scriptPath) 动态加载（index.ts:147-193）
记忆           → memory-manager.ts (KV事实层，JSON+JSONL双源)
                → memory.ts/WorkspaceJournal (日志蒸馏层)
```

**已知局限**：自创工具**仅启动时加载，运行期创建的当轮不可见**。这是设计取舍，值得在自己开发时明确标注，避免用户误解。

### 3. xuanji/ 目录：中医皮下的真架构

`xuanji/`（1232行）映射关系——**这不是文案，是真闭环**：

| 中医 | 实际 |
|---|---|
| 望闻问切 | `perceiveTask()` 任务感知 |
| 切诊 | `diagnoseTask()` 决策 |
| 开方 | `prescriptionEngine.prescribe()` → **步骤化 tool 序列** |
| 医案 | `medicalCaseManager` 持久化 |

`routes/chat.ts:340` 调 `processTask`，`:349` 映射为 `strategy: direct/deep/step_by_step`，`:368` **接入成本核算**。`XuanjiResult` 含 `confidence/riskLevel/estimatedSteps/potentialBlockers` —— 本质是**带风险评估的任务规划器**。

对比：`qihuang/four-diagnoses.ts`（699行）在 `agentai-loop.ts:42` **import 但从未调用**，仅通过 `routes/qihuang.ts` 独立 HTTP API 暴露 —— 半死代码。

**同一套中医叙事，一个做成了真闭环，一个做成了摆设。** 这个对比本身就是最好的架构教材。

### 4. 测试布局

- vitest ^3.2.7，覆盖率门槛 lines/functions 60%、branches 50%，timeout 10s
- 65 个测试文件（约 811 个 `it()`）
- **布局特点：绝大多数测试与源码同目录并置**，`__tests__/` 只有 2 个文件
- 安全测试做得扎实：`b1-security.test.ts`(10.7KB)、sandbox 四件套、safety 三件套
- **缺口：6416 行的 agentai-loop.ts 零覆盖，repairPipeline 六步无专项测试**
- 前端(`packages/agentai-gui`)基线 **187 测试 / 10 文件**（2026-10-11：在 109/7 基础上新增
  `src/layout-panes.test.ts`(19) + `src/rail-browser.test.ts`(21) + `src/token-layer.test.ts`(43)
  + `src/info-arch.test.ts`(14)，均为源码文本断言：
  前者锁布局机制 —— 中栏宽度必须自适应 `clamp()`、页面内面板必须两层结构、页面根高度必须 `100%`
  而非 `calc(100vh - N)`；后者锁右栏 信息/浏览器 双模式（`agentai.pane.browser.width` 分轨宽度、
  右栏内容判 `effectiveRailMode` 而非持久化的 `railMode`、恰好 2 个 `.pane-grip`）、
  文件卡片行点击就地展开（`PREVIEW_LINE_CAP=400`）、**浏览器宿主唯一性**
  （`browser-host.ts` 恰好 6 个 `addEventListener`、`GlobalBrowserDrawer.tsx` 为 0，
  防双挂 `EmbeddedBrowser` 导致 `/browser` 命名空间重复订阅）、
  浏览器空态不叠层（iframe 空态必须 `!playwrightMode`）与内容区不写死 `#fff`；
  token-layer 锁 **CSS token 层契约** —— 18 条语义别名必须真实存在、其依赖的 9 个底层 token
  必须在全部 5 个主题块里有定义（否则换主题即解析失败）、别名调用点不得残留硬编码死 fallback、
  `--radius-lg` 不得同层重复定义、通用文本尺度 `--fs-*` 必须存在、
  **文本档（7–28px）禁止裸数字字号**（防再次分叉）、**`var(--fs-*)` 必须真被调用点消费**（防僵尸 token）、
  **圆角恰 4 档且 `--radius-lg/pill` 必须被消费**（防僵尸 token）、**禁止裸数字 `borderRadius`**、
  **绿/红/灰/白四类语义色不得再散落**、**底层 token 死 fallback 归零**；
  info-arch 锁 **信息架构契约** —— 状态栏 `渠道` / `本次会话` 两个折叠入口存在、
  原裸 chip（`QQ`/`微信`/`置信`/`意图`/`计划`/`费用`）不得残留、`TokenPressureBar`
  用 `</Popover>` 距离断言确认**未被一起折叠**（条状图一眼可读，与纯文本诊断值不同）、
  用户菜单唯一且「关于」类控件不再独立、系统下拉 15 页 **100% 标了 `section`** 且
  **同 section 在 `PAGES` 数组里连续**（不连续就会重复出现段标题）、
  免费模型 nag 条可关闭且 `localStorage` 取值包 try/catch。
  核验：`cd packages/agentai-gui && npx vitest run`）
- ✅ **前端字号已收敛（2026-10-11）**：23 种 `fontSize` → 尺度 **六档 11/12/13/16/20/28**。
  ⚠️ 更正：先前文档写的「≤12px 874 处」用的是更严格的正则（要求数字后紧跟 `,`/`}`），属**低估**；
  实测 **1164 处**（8:31 / 9:165 / 10:334 / 11:361 / 12:273）。映射：
  `7,8,9,10,11→--fs-micro(11)`、`11.5,12→--fs-sm(12)`、`13,14,15→--fs-md(13)`、`16,18→--fs-lg(16)`、
  `20,22,24→--fs-xl(20)`、`28→--fs-hero(28)`；共改 **1429 处 / 104 文件**（含 CSS-in-JS 模板串与 `.css` 26 处）。
  有意保留：**≥32px 的图标/emoji/logo 档 35 处**（32×9 / 36×1 / 40×8 / 46×1 / 48×11 / 64×5，
  其中 `fontSize: 64` 是 `{avatar}`、46 是 Splash 大标题）、`em` 相对单位（Markdown 标题 `0.9em`/`1.3em`）、
  以及 `MonacoEditor.tsx` 的 `options.fontSize`（Monaco 只收 number，测试白名单 + 理由）。
  核验：文本档残留裸数字应只剩白名单一处
  `grep -rnE "fontSize:\s*(['\"]?)([7-9]|1[0-9]|2[0-8])\1(?![\d.])" --include=*.tsx packages/agentai-gui/src`
  踩坑记录：替换正则漏 `(?![\d.])` 会把 `fontSize: 9.5` 切成 `'var(--fs-micro)'.5`；
  值换成 CSS 变量必须补引号，否则 `fontSize: var(...)` 里 `var` 是关键字直接语法错；
  CSS 侧需 `(?<![\w-])font-size:` 否则会改坏 `--tool-font-size: 11px` 这类 token 定义。
- ✅ **前端设计尺度已收敛（2026-10-11，圆角 + 同语义色两项已改完，只剩内联样式）**：
  - **圆角**：`borderRadius` **19 种 → 4 档** `--radius-sm 4 / --radius-md 8 / --radius-lg 12 / --radius-pill 999`；
    共改 **437 处**（tsx 430 + CSS 7）。收敛后实际消费 `md 218 / sm 185 / lg 40 / pill 5`（+ 旧名 `--radius` 2）。
    残留裸数字仅 2 处且均有理由：`App.tsx:1069`（Antd `theme.token.borderRadius` 只收 number）、
    `ImageStudio.tsx:829`（`borderRadius: 0`，无圆角语义）。
  - **语义色**：成功绿 4 值（`#52c41a`/`#10b981`/`#4ade80`/`#22c55e`）→ `var(--success)` **114 处**；
    错误红 3 值（`#ef4444`/`#ff4d4f`/`#f5222d`）→ `var(--danger)` **71 处**；
    灰阶文字 5 值 → `var(--muted|--muted-2|--fg-2)` **54 处**；`color:'#fff'` **52 处** → `var(--fg-on-accent)`
    （含 CSS 共 55）。另顺带清掉 **35 处**直连底层 token 的死 fallback（`var(--panel, #141414)` 类，
    Commit A 只清了别名层，漏了这些）。
    ⚠️ **有意不动四类**（一刀切会改坏语义/视觉，是本轮最大的判断成本）：**分类色板**
    （`EmotionIndicator` 情绪 8 色、`SoulPanel` 疼痛 severe/critical 双红、`TokenPressureBar` 三档、
    `modeStore`/`modelStore` 身份色 —— 同色相多档是有意区分）、**自带表面主题的文件**
    （`TerminalPanel` 终端 prompt 色 / `VoiceDictation` 自绘浮层 / `PreviewMode` 设备框 / `DecorAI` 子应用）、
    **打印导出 HTML 模板**（`PrescriptionCard`/`WritePage` 的 `<style>` 按亮色纸张配色，与 App 主题无关）、
    **渐变艺术**（9 处 `linear-gradient(...)`，只换一半色标会在换主题时半主题化，更难看）。
  - ✅ **信息架构已精简（2026-10-11 第二轮）**：设计尺度收敛后剩下的"乱"是结构性的 ——
    同一屏太多**平级平铺**的碎片，每个都只值一次悬停。四处「常驻 → 折叠」：
    - **状态栏最多 15 个 chip → 最多 9 个（常驻 8 → 7）**：`QQ`/`微信` 两个常驻 chip（+2 个 hover tooltip）→ 一个 `渠道`
      聚合点（异常由聚合点颜色承担）+ Popover 明细；`置信`/`意图`/`计划`/心境/`费用`/模型
      **6 个 tooltip-only 诊断值** → 一个 `本次会话` Popover 入口（入口本身由 `hasSessionStats` 门控，
      全无数据时连入口都不出现）。**`TokenPressureBar` 有意保持常驻** —— 条状图一眼可读。
    - **标题栏右区 3 控件 → 1**：`GitHub 仓库`（外链）+ `联系开发者` + `用户名` → 一个 `用户菜单`
      （前两者不是操作，是"关于"）。
    - **「系统」下拉 15 项平铺 → 5 段**：渠道与通知 / 知识与技能 / 自动化 / 运行与洞察 / 应用设置。
      ⚠️ 同 section 必须在 `PAGES` 里连续，否则段标题重复（已由 `info-arch.test.ts` 断言）。
    - **「免费内置模型」nag 条**：可关闭并记住（`localStorage agentai.nag.freeModelDismissed`）。
  - ⚠️ **仍未做**：内联 `style={{` **3417 处 / 111 个 tsx 文件**（CSS-in-JS 散落，需逐组件抽 CSS class，
    属结构性重构而非可批量替换）。
    ⚠️ 更正：先前把「发现 N 个可恢复的长任务」恢复条列为常驻横条是**错的** ——
    它由 `AutoHideTaskBar`（`ChatView.tsx:13`）8 秒后自动 `setShow(false)`，只在首屏短暂出现；
    `.app-content` 里并没有三条常驻横条。故本轮不动它。
  核验：`grep` 命令与实测数字见 `AGENTS.md` §五·补 第 10、11 条；断言见 `token-layer.test.ts` + `info-arch.test.ts`。
- ✅ **前端 CSS token 层已修（2026-10-11，这是"乱"的根因，非审美问题）**：
  **18 个变量被 tsx 消费但从未在任何 CSS 中定义** —— `--text-primary/secondary/tertiary`、`--bg-1`、
  `--muted-1`/`--muted-3`、`--muted-soft`、`--border-color`、`--color-text-muted`、`--bg-primary/secondary`、
  `--bg-active`、`--accent-bg`、`--fg-on-accent`、`--hover`、`--demo-color`。
  因为每个调用点自带硬编码 fallback，同一"语义角色"渲染成 3–6 种颜色
  （`--text-secondary` → `#aaa`×4 / `#888`×2 / `#999`×2；`--text-tertiary` → `#666`×8 / `#555`×4 / `#444`×2 / `#777`×1；
  `--text-primary` → `#ccc`×5 / `#eee`×2 / `#ddd`×1）；少数调用点连 fallback 都没有
  （`SoulPanel` 的 `var(--bg-1)`×4、`Composer.tsx:904` 的 `var(--muted-3)`、`WorkspaceSelector.tsx:249` 的
  `var(--color-text-muted)`）→ **整条声明无效被静默忽略**。另有 `--radius-lg` 在同一暗色 hex 层重复定义
  （14px 再 12px）→ 暗色 12px / 浅色 14px 不一致。
  修法：建 18 条别名全部指向已有底层 token（底层 token 在 5 个主题块里均已定义）；补 6 级通用文本尺度
  `--fs-micro/sm/md/lg/xl/hero` = 11/12/13/16/20/28（此前主题只有对话域字号 `--chat-font-size` 等，
  没有通用尺度）；`--tool-font-size: 10.5px → 11px`、`--ui-font-size → var(--fs-micro)`；
  清掉 39 处已失效的硬编码死 fallback + 3 处 `var(--demo-color, #6366f1)` 的靛蓝残留。
  核验：残留死 fallback
  `grep -rEoh "var\(--(text-primary|text-secondary|text-tertiary|bg-1|hover|bg-active|accent-bg|fg-on-accent|muted-1|muted-3|muted-soft|color-text-muted|bg-primary|bg-secondary|border-color) ?, ?(#|rgba)" --include=*.tsx packages/agentai-gui/src | wc -l` → **0**（修复前 39）；
  `grep -n "radius-lg" packages/agentai-gui/src/styles/agentai-theme.css` → 仅 2 处定义
  （dark/light 两块各一，**均为 12px**；同层重复定义已在 2026-10-11 的圆角收敛中一并去掉）

---

## 五、如果你要动手，建议的落地顺序

| 阶段 | 做什么 | 参考本文 |
|---|---|---|
| P0 | 二段式上下文 + 修复管道6步 + 沙箱 fail-closed | §一.1 §一.3 §一.4 |
| P1 | multi_edit 事务 + 双写验证（改掉漏报）+ 三重续跑 | §一.2 §二.1 §四.1 |
| P2 | MCP 客户端 + 技能渐进式披露 + 五维路由 | §二.3 §二.4 §二.5 |
| P3 | 自进化三件套资产化 + xuanji 式任务规划器 | §四.2 §四.3 |

**核心判断**：这个平台的**框架决策层已经超过大部分商用产品**，瓶颈在单文件过大、prompt 膨胀、核心逻辑零测试。你要借鉴的话，抄 §一 的四个设计 + §四.1 的三重续跑，避开 §三 的六个坑，就已经超过 90% 的开源 Agent 框架。

---

## 附：核心文件速查

| 文件 | 行数 | 作用 |
|---|---|---|
| `tools.ts` | 7714 | 198 工具声明 + 203 handler（全文 @ts-nocheck） |
| `agentai-loop.ts` | 6416 | 上帝类：上下文构建 + 主循环 + 工具分发 |
| `llm-router.ts` | 2245 | 修复管道 + 熔断 + 降级 + 缓存 |
| `model-classifier.ts` | 1091 | 五维评分 + 复杂度分类 |
| `tool-registry.ts` | 624 | 工具注册 + 参数校验 |
| `xuanji/` | 1232 | 任务规划器（真闭环） |
| `skills/` | ~2100 | 技能加载 + 匹配 + 热更新 |
| `mcp/host.ts` | 301 | 手写 JSON-RPC MCP 客户端 |