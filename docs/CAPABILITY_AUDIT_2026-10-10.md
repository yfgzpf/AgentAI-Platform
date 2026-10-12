# PulseFlow 平台能力实测清单（借鉴参考版）

> **实测日期**：2026-10-10
> **实测方式**：源码级审计（AST/行区间精确统计），非文档摘抄
> **代码基线**：`agentai-gateway` 292 文件 / 29 子系统 / 18090 行核心四件套
> **增补（2026-10-12，GUI 侧三项，均只动 `packages/agentai-gui/**`）**：
> 1. **浏览器宿主唯一化** —— 原先 `EmbeddedBrowser` 有 **3 个挂载点**（App 右栏 / `GlobalBrowserDrawer` / 中心区 `modes/BrowserMode`），
>    编辑器页同时命中 2 个 → **双份 `io('/browser')` socket 订阅 + 双份帧解码**。
>    现中心区浏览器模式整块删除（`modes/BrowserMode.tsx` 已删），`Editor.tsx` 不再从 `localStorage` 恢复 `'browser'`，
>    `Ctrl+2` 改走 `BrowserHost.open()`，store 去掉 `openBrowser` 且历史 `'browser'` 值回退 `'editor'`。
>    核验：`grep -rn "<EmbeddedBrowser" packages/agentai-gui/src --include=*.tsx | wc -l` → **2**。
>    ⚠️ **未活体验证**：本会话指针/键盘输入通道全线失效（详见 §4 测试布局末段的披露），
>    故「编辑器页实测只挂 1 个浏览器」与「`/browser` socket 连接数」**只有源码文本测试覆盖**。
> 2. **品牌标统一** —— 标题栏原用栅格 `favicon-32.png`，启动页用 `BrandLogo.tsx` 矢量标，两套图形同屏。
>    现 `BrandLogo` 为唯一出口，`favicon.svg` 重写为同几何；文案 中文主名 **岐枢** + 英文副名 **PulseFlow**
>    （内部代码标识符不动）。核验：全项目 tsx 里 `favicon-32.png` → **0**。
> 3. **前端氛围层「星野·深空」** —— 原全站平涂 `--bg`、面板仅靠 1px 边框区分。
>    氛围做成 **`.app-content` 自己的 `background`**（顶部光晕 + 1px 细网格 + 面板内高光），
>    而非叠层 —— 因为不透明 `var(--bg)` 散在 **25 个文件约 50 处**，任何浮层都会被盖死。
>    `backdrop-filter` 毛玻璃**有意不做**并在 AGENTS.md 里披露了原因。

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
- 前端(`packages/agentai-gui`)基线 **252 测试 / 12 文件**（2026-10-12 第二轮：在 209/11 基础上新增
  `src/shell.test.ts`(**42**)。上一轮为 209/11 —— 在 187/10 基础上 `rail-browser` 21→**27**、`token-layer` 43→**50**，
  新增 `src/brand.test.ts`(**9**)）。
  分文件实测：`brand 9 / info-arch 14 / layout-panes 19 / layout-regression 28 / media-contract 25 /
  rail-browser 27 / token-layer 50 / shell 42 / CleanerPanel.format 7 / chatStore 6 / modelStore 9 / modelPicker 15`。
  本轮三处新增契约：
  (a) **浏览器宿主唯一化** —— 全项目 `<EmbeddedBrowser>` 挂载点**恰 2 处**（`App.tsx` / `GlobalBrowserDrawer.tsx`，
  由 `drawerHostActive` 互斥）、`modes/BrowserMode.tsx` 必须**不存在**、`Editor.tsx` 不得再出现 `last === 'browser'`、
  `Ctrl+2` 必须走 `BrowserHost.open()`、store 不得有 `openBrowser` 且历史值 `'browser'` 必须回退成 `'editor'`；
  (b) **品牌标统一** —— 标题栏必须用 `<BrandLogo>` 且全项目 tsx 不得再出现 `favicon-32.png`、
  `岐枢`/`PulseFlow` 双名 lockup 存在、`favicon.svg` 与 `BrandLogo` 的两条 path 串**逐字相同**、
  渐变 id 必须 `useId()` 派生（防多实例 `url(#pf-grad)` 全部解析到第一个 `<defs>`）、`Avatar` 不得再有 `PulseFlow` label；
  (c) **氛围层必须真被消费**（防僵尸 token，前车之鉴是 `--radius-lg` 定义了却零消费）——
  ⚠️ **本项已于 2026-10-12 第二轮反转**：原断言「`--aurora/--grid-line/--grid-size/--panel-hi` 四个装饰 token 必须都定义」
  已**作废** —— 用户实测判定「底背景网格太花」，`--grid-line`/`--grid-size` **两个 token 已整条删除**，
  现在只剩 `--aurora`（顶部柔光）+ `--panel-hi`（面板内高光）两层，断言改为「`--grid-*` 声明数必须为 **0**」。
  `.app-content` 必须真画 `background-image` 且**不得**出现 `backdrop-filter`（毛玻璃本有意不做）这一点不变。
  详见下方「六·补、2026-10-12 第二轮」。
  （2026-10-11：在 109/7 基础上新增
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

---

## 六·补、2026-10-12 第二轮增量：GUI 页面统一 + 桌面打包一致性

> 触发：用户反馈「**底背景网格太花**，优化没到位；要**所有页面**的**统一**优化；
> **打包后**功能缺失 / 与开发状态显示不一致 / 溢出 / 控件与开发状态显示不一致的问题不应再出现」。
> 运行形态确认：**桌面安装包（Tauri 打的 .exe）** —— 所以根因路径是 `build-for-desktop.mjs`，不是 `vite build`。

### 1. 底背景：网格整条删除（对上一轮 §四.4(c) 的反转）

- `--grid-line` / `--grid-size` 从 **3 个主题块（dark / light / porcelain）全部删除**，
  `layout.css` 的 `background-size` 一并删除（网格是唯一需要它的层）。
- 氛围层降到**两层**：`--aurora`（顶部 `radial-gradient` 光晕）+ `--panel-hi`（面板顶部内高光）。
- ⚠️ **`.app-content` 曾被双写**：`agentai-theme.css`（不透明 `background: var(--bg)`）+ `layout.css`（氛围层），
  谁赢只靠 **import 顺序** —— 打包后 CSS 合并顺序一变，氛围层就被冲掉（正是「打包后显示不一致」的一类）。
  现删掉 theme 里那份，**全库只剩 1 处定义**（`layout.css`）。
- 核验：`grep -cE "^\s*--grid-(line|size)\s*:" packages/agentai-gui/src/styles/agentai-theme.css` → **0**；
  `grep -rc "^\.app-content" packages/agentai-gui/src/styles/*.css` → `layout.css:1`，其余 0。
  （⚠️ 朴素 `grep "grid-line"` 会命中「说明为何移除」的注释而返回 1，**别被注释误导** —— 本轮实测踩过一次。）

### 2. 页面壳三件 + 24 页根契约（「所有页面统一」的落地方式）

新增 `src/components/shell/{PageShell,PageHeader,EmptyState}.tsx` + `src/styles/shell.css`
（`main.tsx` **第 5 层** import，排在 `layout.css` 之后 —— CSS 顺序是有意义的，见第 1 条）。

```css
.page-shell  { height:100%; display:flex; flex-direction:column; min-height:0; }
.page-header { height:var(--page-head-h); padding:0 var(--page-pad-x); flex-shrink:0;
               display:flex; align-items:center; gap:12px; border-bottom:1px solid var(--border); }
.page-body   { flex:1; min-height:0; overflow:auto; padding:var(--page-pad-y) var(--page-pad-x); }
```

- ⚠️ `.page-body` 的 **`min-height:0`** 就是**根治 flex 子项溢出**的那一行：
  `flex:1` + `overflow:auto` 缺了它，子项会被内容顶破父容器（对应「溢出」）。
- ⚠️ **24 页统一不靠改 24 个文件**：`App.tsx` 在**唯一渲染点**把 `currentPage.comp` 包进 `<PageShell>`
  （`PAGES` 里 24 个 `comp` 共享这一处）→ 新页面自动继承契约，不会再回到「12 页写 `height:'100%'`、其余不写」的分叉。
- **页头转换本轮只落地 5 页**（`MonitoringPanel` / `StatsPanel` / `ProactiveSuggestionsPanel` /
  `QQBotPanel` / `KnowledgeBasePanel`）→ `<PageHeader title subtitle icon actions>`，
  消掉各页自写的「`padding:24` + `<Title level={3|4}>`」；**其余 ~17 页有意未动**（避免大规模重排）。
- **页面级空态 1 页**（`SoulPanel` 整页为空）→ `<EmptyState>`；**卡片/页签内小空态有意不动**。
- **3 个不透明页根改透明**（`WorkflowPanel` `var(--panel)` / `SoulPanel` `var(--bg-1)` / `Editor` `var(--editor-bg)`）
  —— 否则它们各自把第 1 条的氛围层盖死。
- 核验：`grep -oE "^\.page-(shell|header|body) \{" packages/agentai-gui/src/styles/shell.css | sort -u | wc -l` → **3**；
  `<PageHeader>` 消费方 5 个真实页面（+1 是定义文件自身）。

### 3. 视口单位 dvh 兜底（「溢出」的另一半）

- `#root` 与 `.app-root` 同时写 `height:100vh` + `height:100dvh`（Tauri WebView2 下 `dvh` 是正确值，`vh` 是旧内核兜底）。
- **零使用的死选择器 `.app-shell` 已删** —— 它曾是「有 `dvh` 兜底但没人用」的假真相，删掉以免出现第三份外壳高度。
- 3 处魔法高度收口：`GlobalBrowserDrawer`(-44) / `GovernorPanel`(-48) / `Scene3DViewer`(-140) →
  `calc(100dvh - var(--chrome-h) …)`，其中 `--chrome-h = 60px = --titlebar-h(36) + --statusbar-h(24)`。
- 核验：`grep -rnE "[:=]\s*['\"]?calc\(100vh" --include=*.tsx --include=*.css packages/agentai-gui/src` → **空**。

### 4. 桌面打包：修掉一个真实的白屏 bug + 新增一致性门

⚠️ **这是本轮最严重的真 bug（实测，非推测）**：旧 `build-for-desktop.mjs:114-131` 用
`readdirSync` 的**字母序** + `slice(1)` 删除「多余」的 `index-*.js`。而 NTFS 排序下：

| 文件 | 内容 | 排序 |
|---|---|---|
| `index-BcQDIzDV.js` (**30.15 kB**) | DecorAI 子应用的**懒加载 chunk** | `B` = 0x42 → **先** |
| `index-CRuT4Reg.js` (**588.61 kB**) | **真入口**（`dist/index.html` 引用的那个） | `C` = 0x43 → **后** |

→ `slice(1)` 保留前者、**删除的恰是真入口** → 安装包启动即**白屏**。
（成因：Vite `chunkFileNames: 'assets/js/[name]-[hash].js'`，任何名叫 `index` 的模块都会产出同名 chunk 撞车。）

**修法**：不再按文件名猜，改为**只从 `dist/index.html` 正则抽出真实 entry，永不删除**；其余 `index-*.js` 只 `logWarn` 报告。

**新增构建后一致性门** `packages/agentai-desktop/src-tauri/scripts/verify-web-build.mjs`
（由 `build-for-desktop.mjs` 打包前 spawn，**非零退出即中止打包**，沿用 `verify-tool-consistency.mjs` 的 fail-fast 风格）：

| 检查 | 拦什么 |
|---|---|
| E1 `dist/index.html` 的 `<title>` == `src/index.html` 的 `<title>` | 「与开发状态显示不一致」（实测：陈旧 dist 里是旧名 `PulseFlow Studio`，源码是 `岐枢 PulseFlow Studio`） |
| E2 HTML 引用的每个 `/assets/**` 真实存在 | 「功能缺失」（白屏第一因） |
| E3 chunk 闭包（产物 JS 的静态 import 都能落地） | 「功能缺失」 |
| E4 favicon 引用与文件均存在 | 图标 404 |
| W1 dist 比源码旧（mtime） | 忘了重新构建 |
| W2 存在未被 HTML 引用的 `index-*.js` | 孤儿 chunk（**只告警，绝不自动删** —— 就是上面那个 bug 的教训） |

**双向实测过**：对**陈旧 dist** exit 1（title 不一致 + W1 + W2）；`npx vite build` 后对**干净构建** exit 0
（6 项通过 / 1 个 WARN=孤儿 chunk，合法）。

### 5. 本轮验收与如实披露

- `cd packages/agentai-gui && npx tsc --noEmit` 干净；`npx vitest run` → **12 文件 / 252 通过**。
- **网关门零改动**，既有基线 `804 测试 / 7 失败`（b1-security 1 / context-fidelity 3 / ledger-wiring 2 / code-runner 1，优化前就在）不变。
- **逐页浏览器取证**：`PAGES` 共 **24** 项，其中 `pascal`（建筑编辑）/ `decorai`（建筑装饰）为 `hidden:true` 无导航入口，
  **其余 22 页全部截图确认** —— 网格消失、顶部柔光在、无横向溢出、状态栏完整（`Gateway 在线 · … · fix/strict-audit-2026-10-03`）。
  ⚠️ **诚实披露**：`pascal` / `decorai` **无法通过点击到达**（无菜单项），本轮**未做视觉取证**；
  它们同样经 `App.tsx` 唯一渲染点套了 `<PageShell>`，但「套上了」是从代码路径推断的，不是截图证据。
- ⚠️ **仍延后（明确未做）**：全库约 **460 处**裸 `fontWeight`/`lineHeight`/`fontFamily` 未批量替换
  （新 token 只在**新增的页壳层**强制使用）；`packages/*/dist/` 未移出 git；3417 处内联 `style={{` 未重构；
  剩余 ~17 页的自有标题条未转 `PageHeader`。
---

## 七、2026-10-11 第三轮增量：运行时守卫「批次1 止血」

来源：`docs/ai-runtime-repair-proposal.md`（5 层方案书）。**复核后发现方案书 5 处诊断与代码不符**，
把已存在/休眠机制当成缺失。故本轮**不新建层**, 只接通休眠机器 + 补 4 个真缺口。
方案书顶部已加「实测校正」三分类表, 原文保留作历史。

### 7.1 四个真缺口与修法

| # | 缺口（实测证据） | 修法 | 类型 |
|---|---|---|---|
| G1 | `duplicateTracker` 声明在**每轮工具分支内**（`const duplicateTracker = new Map()`）→ 每轮重建 → 跨迭代"连续失败 3 次"恒不成立 | 提升为实例字段 `_failTracker`, `run()` 开头 `clear()` | **真 bug 修复** |
| G2 | 跨轮去重只拦**全签名完全相同**的调用；"同一文件反复改、参数每次不同"永远漏网 | 复用 `TaskLedger.writeCount()`（`:158` 已存在, 无需新增）→ `repeat_write` directive, **只提醒不拦截** | 补漏（安全边界内） |
| G3 | 只有**每轮** `TOOL_BUDGET`（`:3808`）; 无"每任务累计"上限 | `TOOL_CALL_BUDGET = 200` + `tool:budget-exceeded` + 复用 `_hardStopNext` 软着陆 | 真缺口 |
| G4 | 唯一迭代上限判断埋在**超时块内**（`if (this.iteration > effectiveMax - 2) break`）→ **没超时 = 无上限** | 循环顶部独立硬闸: 首轮超限软提醒, 再一轮 `break` | 真缺口 |

**G4 的意外后果（重要）**：修好它之后, **5 个既有失败测试转为通过** —— 它们不是断言写错, 而是
`Error: Test timed out in 10000ms`（循环无上限, 一个空转到 `iter=48`）。
> **测试基线因此更新**：`804 测试 / 7 失败` → **`815 测试 / 2 失败`**。
> 剩余 2 个与本轮无关: `b1-security`（断言 `tools.ts` 用 `execFile('git')`）、`safety/code-runner`（断言 `scanForbiddenPatterns` 拒绝 `fs` import）——
> 均为源码契约断言, 且改动前就在失败。
>
> ⚠️ **2026-10-12 补记**：上句的 2 个基线失败**已全部修复**，全仓现为 **0 失败**。
> 两者都是**陈旧断言**（代码是对的、断言停在旧实现/旧策略上），详见 §12。

### 7.2 新增守卫对所有 tier 生效（用户决定）

`grep -c "_capabilityTier !== 'autonomous'" agentai-loop.ts` = **5**（与改动前一致）——
即**没有新增任何 tier 门控**。用户跑的是 autonomous 档强模型, 若沿用既有 `!== 'autonomous'` 门控,
新守卫将永不执行。`runtime-guard.test.ts` 有一条断言锁死这个数字, 变化即报警。

### 7.3 已知 / 有意保留的边界（如实记录）

- **写类重复只提醒不拦截**：`agentai-loop.ts` 的历史注释明确写"不同参数被误判为重复 → 用户改动被静默丢弃"。
  故"执行前拦"只用于**全签名相同**（这条 `_toolCallHistory` 机制本来就已存在, 本轮未重做）。
- `_toolCallHistory` **从不清理**（跨 run 残留）——本轮**仅记录为观察项, 未动**（改动会波及续点语义）。
- 60K 上下文预算仍只能丢弃 5 条 soul 注入（priority 恰为 30）, 其余 44 条注入不可触碰 → 属**批次2**, 本轮未动。

### 7.4 本轮核验命令（可复用）

```bash
cd packages/agentai-gateway
npx tsc --noEmit                                        # 0 error
npx vitest run src/runtime-guard.test.ts --reporter=dot # 11 passed
npx vitest run --reporter=dot                           # 815 / 2 failed (基线: 少 5 个超时)
grep -c "systemMsgs.push({ role: 'system'" src/agentai-loop.ts   # 32
grep -c "systemMsgs.push(" src/agentai-loop.ts                   # 49
awk 'NR>=812 && NR<=1927 && /^    try \{/ {c++} END {print c+0}' src/agentai-loop.ts  # 14
```

---

## 八、2026-10-11 批次2 addendum：模型下线 + 用户锁定 + 历史压缩 + 自动化让路

用户实机日志（选择 4.1 却被路由到已下架的 pro；任务频繁中断；自动化卡顿）根因共 5 条，本次修掉全部。

### 8.1 deepseek-v4-pro 下线（官方 2026-09-14 12:00 起 pro→V4.1 Flash）

| 位置 | 改动 | 核验 |
|---|---|---|
| `model-classifier.ts` | 删 `deepseek:v4-pro` / `alrc:deepseek-v4-pro` 条目；4× `recommended` 指向 `deepseek:v4-flash` | `grep -rn "v4-pro" src/model-classifier.ts` → 仅注释 |
| `model-capabilities.ts` | 删 `deepseek-pro` 能力条目；`LEGACY_MODEL_ALIASES` 加 `'deepseek-v4-pro': 'deepseek-flash'` | 同 grep |
| `model-selector.ts` | pro id 映射到 `subModel: 'deepseek-flash'`；删 `isDeepReason → v4-pro` 覆写 | `grep -n "deepseek-v4-pro" src/model-selector.ts` |
| `routes/chat.ts` | 2 张映射表 pro id 改指 flash；删 `isDeepReason` 自动升级 | — |
| `llm-router.ts` | **新增** `RETIRED_MODEL_ALIASES`（**provider 作用域**） | `grep -n "RETIRED_MODEL_ALIASES" src/llm-router.ts` |
| GUI `modelStore.ts` / `Settings.tsx` | 删 pro 卡片/模板行；`MODEL_TIERS` 由 3 行减为 2 行（含 `[2]`→末元素修正） | GUI vitest 252 passed |

**为什么别名必须按 provider 分键**：中转商（alrc / factory / sensenova）**没有** `deepseek-flash` 这个名字，
它们有自己的 `deepseek-v4-flash`。全局 map 会把请求发到一个不存在的模型上 —— 这正是"修 bug 引入新 bug"的典型。

### 8.2 用户选定模型锁定（`modelLocked`）

- loop 侧：`this.opts.userPickedModel === true` → 自动切换守卫拦下，返回诚实错误（`model:lock-refused`）。
- router 侧：`modelLocked` 置位后**两条跨模型 fallback 全关**（free→deepseek 闪电交替、dxnt 兜底）。
- 救援链收敛为 **3 级同模型重试**：`RESCUE_BUDGET_MS=180_000`，各级 60s/60s/45s；原 **L2「跨模型升级到 v4-pro」删除**。
  （原设计是"每层 15s 必挂" vs 正常请求 300s 超时 —— 结构性矛盾，等于必然触发，故同时放宽。）
- ⚠️ **副作用**：GUI 几乎每请求都带 `userPickedModel`，故"免费用完自动切商用"对显式选定的模型**不再成立**（用户要求的取舍）。

### 8.3 历史压缩吞掉 user 消息（真 P0）

原判据 `messages.length > MAX_MSGS(30)` 里含 immutablePrefix 的 36+ 条 system → **恒真** →
每轮压缩 → 最早的 user 消息（就是用户原始诉求）被扫进 `old` 丢弃 → `appendOnlyLog` **0 条 user** →
`llm-router` 兜底注入"请继续完成之前的任务。" → 模型不知道要干什么 → 空回复 → 救援链 → 任务中断。

**修复**：被压掉的旧 user **原样搬回** `recent`（`carriedUsers`，上限 3 条：任务锚点第一条 + 最近 2 条）；
摘要输入仍是整个 `head`（含 user），保证 `## 用户请求` 段有内容且 `old.length > 0` 恒成立。
**没有**改触发判据 —— 实测改判据会让压缩几乎不触发，直接打破 `context-fidelity` 的 3 条契约。

### 8.4 自动化让路

- 新增 `runtime-activity.ts`：TTL 心跳（`USER_TASK_TTL_MS=300_000`，须 > router 300s 超时）。
  **为什么用 TTL 不用计数器**：`run()` 有 15+ 个 return 出口（含 throw / 中断 / 超时），计数器漏一次 `--` 就**永久停摆**。
- `automation-engine.ts` 的 `cron:tick` 顶部：`if (isUserTaskActive()) { ...; return; }` —— 纯让路（不计 success/fail，不自动禁用）。
- `tools.ts` 的 `officecli` 由 `execSync` 改异步 exec（stdout-only）—— 原实现冻结整个事件循环。

### 8.5 本轮核验命令

```bash
cd packages/agentai-gateway
npx tsc --noEmit                                   # 0 error
npx vitest run src/runtime-guard.test.ts --reporter=dot   # 27 passed
npx vitest run src/context-fidelity.test.ts --reporter=dot # 9 passed
npx vitest run --reporter=dot                      # 832 / 2 failed (b1-security 1, code-runner 1 — 改动前既有)
node scripts/verify-tool-consistency.mjs           # 202 声明 / 203 实现, ERROR=0
grep -c "rescueReq(" src/agentai-loop.ts           # 3
grep -c "✓ L2 rescue" src/agentai-loop.ts          # 0
```

### 8.6 如实披露（未能端到端验证的项）

- **无 LLM 环境**：无法真机跑"选 4.1 → 全程只走 4.1"。`modelLocked` 的行为验证是**契约级 + mock 级**
  （`runtime-guard.test.ts` 断言 `router.chat` 收到的 `modelLocked === true`），未做真实 provider 调用。
- **自动化让路的时序**：TTL 行为用 fake timers 验证；真实"用户任务进行中恰好有 cron tick"未在活环境复现。
- `docs/reports/REVOLUTIONARY_PROACTIVE_ENGINE_REPORT.md:319`（`model: 'deepseek-pro'`）与
  `docs/wechat-article-pulseflow.md:104` 仍提 V4 Pro —— 属**历史文档，有意不动**。
- `packages/agentai-gui/src/utils/modelPicker.test.ts:130-132` 用合成 `deepseek-v4-pro` 夹具（能通过），按精准修改原则未动。

---

## 九、2026-10-12 批次3 addendum — 死循环护栏误杀

### 9.1 现象（用户实机日志）

```
[gw] [tools-filter] iter=1 313 → 25 tools (msg: 为什么你在这里老是不能完成 长任务呢)
[gw] [loop][WARN] 🛑 死循环硬停: search_content 连续 5 次返回相同/错误结果, 强制终止
[gw] [loop][WARN] 🛑🛑 多次硬停后 AI 仍调用同工具, 强制 force break
[gw] [supervisor] ✅ 任务完成 — 17秒 | +0 -0 (0 files)
```

任务在 **第 1 轮** 就被判死循环并强杀；且用户已显式选定 DeepSeek 4.1（`deepseek-flash`，
能力 `tier=autonomous`，`maxIter=90`）—— **不是模型弱，是护栏误判**。

### 9.2 三个叠加缺陷（全部实测定位）

| # | 缺陷 | 位置 | 后果 |
|---|------|------|------|
| A1 | 判据取 `this.context.appendOnlyLog.filter(role==='tool')` | `agentai-loop.ts` 死循环块 | `appendOnlyLog` 是**会话级 append-only（跨任务存活）**，上个任务遗留的 4 条 `search_content::同参数` 让新任务第 1 轮即凑出「4/5 相同」 |
| A2 | `const allExempt = lastToolNames.every(n => LOOP_EXEMPT_TOOLS.has(n))` | 同上 | 5 条里混进 1 条非搜索工具（实测 `generate_diagram`）→ `allExempt=false` → 另 4 条同签名 `search_content` 触发 `maxCount>=4`。**"搜一下再画个图"这种正常操作最容易中招** |
| A3 | `_hardStopCount` / `_toolCallHistory` 只写不清零 | 字段声明处 + `run()` | 进程级累积：跑过 2 次硬停后**之后每一次误判都直接跳 force break**（日志两行连续出现即此）；`_toolCallHistory` 残留还会把上个任务的签名当「重复调用」跳过 |

另有一处同源问题：`repeatName` 取 `last5[0].name`，首条若是豁免工具则**报错工具名**。

### 9.3 修法（**只改 1 个文件**，`agentai-loop.ts`）

1. 新增实例字段 `private _iterToolStartIdx = 0;`（本轮 dispatch 前的 tool 消息水位线）。
2. `const rawResults = await this.dispatchToolCalls(...)` **之前**打点：
   `this._iterToolStartIdx = this.context.appendOnlyLog.filter(m => m.role === 'tool').length;`
3. 判据改为本轮切片：
   `const toolMsgsThisIter = this.context.appendOnlyLog.filter(m => m.role === 'tool').slice(this._iterToolStartIdx);`
4. 豁免按签名：`const countedSigs = sigs.filter(s => !isExemptName(s.split('::')[0] || ''));`
   —— 豁免工具产生的签名**整组剔除**，只统计非豁免签名。空数组守卫 `countedSigs.length > 0 ? Math.max(...) : 0`
   （否则 `Math.max(...[]) === -Infinity` 会意外通过）。
5. `repeatName` 取真正重复的签名：`[...sigCounts.entries()].sort((a,b)=>b[1]-a[1])[0][0].split('::')[0]`。
6. `run()` 开头归零：`this._hardStopCount = 0; this._hardStopNext = false; this._toolCallHistory.clear(); this._iterToolStartIdx = 0;`
   （紧邻既有的 `_failTracker.clear()` / `_toolCallCount = 0` / `_iterCapWarned = false`）。

`LOOP_EXEMPT_TOOLS` 名单**未改**（搜索类工具的正常探索行为仍需保护）；`_hardStopCount >= 2 → force break` 的
**升级语义保留**（只在同一任务内累计）。

### 9.4 本轮核验命令

```bash
cd packages/agentai-gateway
npx tsc --noEmit                                          # 0 error
npx vitest run src/runtime-guard.test.ts --reporter=basic # 33 passed (原 27 + 改-10 共 6)
npx vitest run --reporter=dot                             # 838 / 2 failed (b1-security 1, code-runner 1 — 改动前既有)
grep -n "_iterToolStartIdx" src/agentai-loop.ts           # 声明 + run() 归零 + dispatch 前打点
grep -c "const allExempt = " src/agentai-loop.ts          # 0 (旧全有全无豁免已删)
```

### 9.5 如实披露

- 行为级测试的 LLM 是**打桩的**，验证的是**循环控制流**（不产生 `dead_loop_stop` / `force_break`
  directive 与 `loop:hard-stop` 事件），**不是**"真机上模型不再被误杀"。真机复现需用户重跑同一提示词。
- 未改 `toolMsgs`（整个会话口径）—— 它仍被 `:4804` 的「操作感知提醒」使用，该提醒**有意**看全局，只修了死循环判据。

---

## 十、2026-10-12 批次3b addendum — 迭代预算只打印不生效 (+ agnes 标注更正)

### 10.1 现象

用户："4.1 模型是个强模型呀！是可以做长任的呀！为什么会断呢"

批次3 修掉了第 1 个真因（死循环护栏在 iter=1 误杀，commit `f69a6ac`）。本节记录**第 2 个真因**。

### 10.2 缺陷：能力层算了迭代预算，但从不写回

`model-classifier.ts:813 getRuntimeParams()` 明确产出三档：

| tier | 基础值 | 快模型微调 (`speed > 0.7` → +10) | 最终 |
|---|---|---|---|
| autonomous | 80 | +10 | **90** |
| guided | 60 | +10 | **70** |
| supervised | 40 | +10 | **50** |

但 `agentai-loop.ts`「应用运行时参数」只写回了三项：

```ts
if (!this.opts.userPickedModel) { this.opts.thinking = rt.thinking; this.opts.thinkingBudget = rt.thinkingBudget; }
(this as any)._contextCompressThreshold = rt.contextCompressThreshold;
// ← rt.maxIterations 到此为止。它只出现在下面这行日志里:
logger.info(`... maxIter=${rt.maxIterations} ...`);   // agentai-loop.ts:812 附近
```

核验：
```bash
grep -n "this\.opts\.maxIterations *=" packages/agentai-gateway/src/agentai-loop.ts   # 修复前: 无匹配
grep -n "maxIter=" packages/agentai-gateway/src/agentai-loop.ts                      # 只此一处, 在 logger.info 内
```

真正的上限因此是调用方传入的 `opts.maxIterations`，而 `routes/chat.ts` **5 处** loop 构造全都写死：

| 位置 | 原值 | 场景 |
|---|---|---|
| `:719` | 30 | /v1/chat 早分支建会话 |
| `:1473` | 30 | **显式选模型**（用户实际路径） |
| `:1501` | `auto ? 30 : 10` | 未选模型 → 普通对话**只有 10 轮** |
| `:1704` | 30 | plan 模式 |
| `:1774` | 30 | goal 模式（注释却写"允许更多迭代"，自相矛盾） |

**结论**：显式选 DeepSeek 4.1（能力层认定 autonomous=90 轮）做长任务，实际 30 轮就被要求收尾；
日志里那句 `maxIter=90` 是**误导性的**。

### 10.3 修法

1. `agentai-loop.ts`「应用运行时参数」新增一行，紧邻既有三项：
   `this.opts.maxIterations = Math.min(rt.maxIterations, this.opts.maxIterations);`
   —— 语义：`opts.maxIterations` 降级为**天花板**；取 `min` 所以只可能收紧。
2. `routes/chat.ts` 新增 `const MAX_ITERATION_CEILING = 90;`（= autonomous 档上界，即"不额外限制"），
   5 处写死值全部改用它。
3. **有意设小预算的调用方行为完全不变**（`min` 只会收紧）：
   `subagent.ts:422` 10 / `goal-runner.ts:317,454` 30,20 / `master-controller.ts:575` 20。

### 10.4 本轮核验命令

```bash
cd packages/agentai-gateway
npx tsc --noEmit                                                 # 0 error
npx vitest run src/runtime-guard.test.ts --reporter=dot          # 38 passed (原 33 + 改-11 共 5)
npx vitest run --reporter=dot                                    # 843 / 2 failed (b1-security 1, code-runner 1 — 改动前既有)
grep -n "Math.min(rt.maxIterations" src/agentai-loop.ts          # 1
grep -c "MAX_ITERATION_CEILING" src/routes/chat.ts               # 7 (1 定义 + 4 直接用 + 1 经 autoMaxIters + 1 注释提及)
grep -n "maxIterations: 30\b" src/routes/chat.ts                 # 仅注释
```

### 10.5 如实披露

- **未活体验证**：无 LLM 环境下**不能**证明"选 4.1 真能跑满 90 轮"。改-11 只做源码契约
  （能力层产出值 / min 语义 / 5 处全覆盖 / 天花板不低于任何一档）+ 一条 min 语义行为断言。
- **行为范围扩大**（需知悉）：plan 模式与 goal 模式的迭代上限也一并从 30 放到 90。
  理由是它们用的是同一个武断值、同一类缺陷；goal 模式那行注释与取值本就自相矛盾。
  仍受 60 分钟绝对超时 / `TOOL_CALL_BUDGET=200` / token 预算三重约束。

### 10.6 更正：agnes 的能力标注**不是**那行推荐日志的因（不改代码）

批次2 的日志里 `[model-classifier] 推荐模型: agentai:agnes-2.0-flash` 曾被归因为
"agnes 能力评分虚高把 4.1 挤掉"。**实测推翻**：

```bash
# 用真实 routeByScore 跑（1755 字符 complex 消息）
未过滤候选            → deepseek:v4-flash | agentai:agnes-2.0-flash | ...   ← deepseek 第 1
forceProvider=agentai → agentai:agnes-2.0-flash                            ← agnes 唯一候选
forceProvider=deepseek→ deepseek:v4-flash
```

- `model-classifier.ts:556` 打印的是 `result.slice(0, 3)` —— **只出现 1 个模型 = 候选只剩 1 个**。
- `llm-router.ts:554` `forceProvider = req.model` + `model-classifier.ts:519`
  `if (input.forceProvider && model.provider !== input.forceProvider) continue`。
  所以那次请求到达时 `model='agentai'`，与评分无关。
- 且即使把 agnes 的 `reasoningLevel` 由 `advanced`(0.95) 降到 `enhanced`(0.6)：
  `overall = .35*.95 + .09 + .09 + .05 + .25 + .15 = 0.96` → `.35*.60 + ... = 0.84`，
  而 tier 规则是 `overall>=0.65 AND reasoning>=0.55` → **0.84 与 0.96 同样判为 autonomous**，
  门控行为不变。**故按 AGENTS.md 规矩3「精准修改」决定不改**，仅在此记录
  「agnes 的 `reasoningLevel: 'advanced'` 属虚标，但因 tier 阈值设计它不影响任何门控」。

**仍未能定位**：批次2 第二段日志里 `model= agentai / msgs=1 / 无 [run:chat] 前缀` 的那次调用
**不是主循环**，但用户贴出的日志是截断的，缺少它的上方上下文，无法判定它是哪个内部辅助调用
（`context-manager.ts:243` / `goal-runner` / `marketing-acquisition-engine` 等多处都硬编码 `model: 'agentai'`）。
要定位需要该行**往上 20 行**的完整内容。

> ⚠️ **2026-10-12 名称更正（见 §11）**：本节引用的 `agentai:agnes-2.0-flash`
> 已在 §11 中被改名到 `agentai:agnes-2.5-flash`（官方下架，仅改名 + 窗口 256K→512K，
> 评分权重与 `reasoningLevel` **一字未动**），故本节全部结论不变，只是名字变了。

---

## 十一、2026-10-12 批次4 addendum — 已下架 agnes-2.0 全链路清理 + 子智能体继承父模型

### 11.1 现象（用户实机反馈）

> "子任务是调用了 Agnes 2.0 模型，但这个模型已经被官方下架了，已经不能用了，现有是 2.5-flash 替代了。
>  再说各强模型调用子智能体是自身呀？不要去调其它模型……"

拆成三条独立诉求：
- **D1** `agnes-2.0` / `agnes-2.0-flash` 官方下架（实测 HTTP 503「分组 default 下模型无可用渠道」），全量清除；活替身是 `agnes-2.5-flash`。
- **D2** 强模型调子智能体必须用**父模型自身**（provider + 精确子模型名），**只在断连/熔断时**才降级。
- **D3** 断连降级也要落到**正确的 `agnes-2.5-flash`**，而不是死掉的 2.0。

### 11.2 四条叠加缺陷（全部实测定位，缺一不可）

| # | 缺陷 | 证据（行号） |
|---|------|--------------|
| **1** | `MODEL_MAP['agnes-2.0']` 在 `BUILTIN_IDS` 内 → 前端 `modelConfig` **覆盖不了它**，死名直达上游 | `routes/chat.ts:608`（`BUILTIN_IDS`）、`:634-638`（仅非内置 id 才采信前端）、`:529-532`（`subModel: 'agnes-2.0'`） |
| **2** | 两张别名表**都没有 agnes 键**，老客户端/老持久化发来的死名无人拦 | 修前 `llm-router.ts:63-72`（只有 deepseek/alrc/factory/sensenova）、`model-capabilities.ts:232-237`（只有 deepseek） |
| **3** | `routes/chat.ts:722 modelName: selected.subModel` 把死名灌进 `opts.modelName`，内联子智能体原样继承 —— **这正是用户看到的现象** | `agentai-loop.ts` 内联 spawn `let subModelName = this.opts.modelName;` |
| **4** | `subagent.ts` 另一条路径：`parentModel \|\| 'agentai'` + `modelName: … : ''` **恒空串**，且 5 个调用点**一个 parentModel 都没传** → 子智能体静默跑免费默认档 | 修前 `subagent.ts:396`、`:426`；`tools.ts` 5 处、`expert-team.ts` 1 处 |

### 11.3 修法

**(a) 死模型名清理（网关 10 文件 + GUI 3 文件）**

| 文件 | 改动 |
|------|------|
| `routes/chat.ts:532` / `:1402` | 两张 `MODEL_MAP` 的 `'agnes-2.0'` 键**保留**、`subModel` 改 `'agnes-2.5-flash'`、label 标「原 2.0 别名」、窗口 512000（沿用 deepseek-v4-pro 先例：老 id 静默降级，不再 503） |
| `llm-router.ts:79-82` | `RETIRED_MODEL_ALIASES` 加 **4 键**（`agentai:` / `agnes:` 各 2 键）→ `agnes-2.5-flash`；`resolveRetiredModelAlias` 改为 **export**（供测试断言） |
| `llm-router.ts:44` | `FREE_PROVIDERS` 里 `'agnes-2.0'` **刻意保留**（见 11.6 披露） |
| `model-classifier.ts:67-92` | 注册项 id/subModel 改名 → `agentai:agnes-2.5-flash`，`maxContext` 256K→512K |
| `model-capabilities.ts:50` | 删掉**重复且过期**的 `agnes-2.0`(256K) 条目（与活条目指向同一模型）；`:230-231` `LEGACY_MODEL_ALIASES` 双键兜底 |
| `model-selector.ts:24` | id 保留做别名，`subModel` 改活名 |
| `agentai-loop.ts:2381` / `tools.ts:5088` / `smart-model-switcher.ts:258` | 3 处硬编码 `agnes-2.0-flash` → `agnes-2.5-flash` |
| `run-vision-test.ts:36` | 手工 vision 实测脚本里的死名 → 活名（**全仓扫查时额外发现，不在原 plan 清单内**） |
| GUI `store.ts` / `store/modelStore.ts` / `store/modelStore.test.ts` | `DEFAULT_PROVIDER` → 活 id；别名条目 `models[0]` → 活名；`removeModel` 回退值由隐藏 id `'agentai'` → 活 id；**新增 v16 迁移**（v15 只覆盖 `'agnes-2.0'` 与 `'agentai'`，**漏了 `'agnes-2.0-flash'`**） |

**(b) 子智能体继承父模型（5 条路径全修）**

```
父 loop (this.opts.model / this.opts.modelName)
   │
   ├─ 内联 spawn (agentai-loop.ts, 强模型主路径)  —— 本就正确, 未动
   │
   └─ dispatchToolCalls 注入 ToolContext { model, modelName }   ← B1/B2 新增
        ├─ spawn_subagent        (tools.ts)   ← B4
        ├─ agent_battle          (tools.ts)   ← B4
        ├─ code_review ×3 并行   (tools.ts)   ← B4
        ├─ run_team              (tools.ts)   ← B4
        └─ team-orchestrator 5 层签名转发      ← B4
             → runSubagent(..., parentModel, parentModelName)   ← B3
                  → new AgentAILoop({ model: subModel, modelName: subModelName })
                       ↳ 仅当父 provider 熔断时: 换 provider + subModelName = ''(走该 provider 默认/env)
```

- `tool-registry.ts:58` 新增 `modelName?: string`，注释明确它与 `model`（provider 名）的区别。
- `subagent.ts:433` `modelName: subModelName || (sensenova 旧兜底)` —— 保留 sensenova 历史兼容分支，不回归。
- **语义关键**：`subModelName = ''` 不是"没模型"，而是"交给 `executeProvider` 按 env/默认解析"；
  熔断换 provider 后父模型名对新 provider 无意义，必须清空。

### 11.4 顺手验证：`maxContext` 256K→512K 会不会改变 5D 路由顺序？

按 `model-classifier.ts` 的权重手算（`W_CONTEXT=.15`，`contextFit = min(maxContext/1M, 1)`）：

| 模型 | ctxFit(256K) | ctxFit(512K) | 变化 |
|------|--------------|--------------|------|
| agnes | 0.0384 | 0.0768 | **+0.0384** |

代入 `computeScore` 得总分：deepseek:v4-flash **0.8074** > agnes@512K **0.7518** > agnes@256K 0.7134。
**结论：改名+调窗口不改变路由顺序**（deepseek 仍第 1）。
再用真实 `routeByScore` 跑两条消息（`short-simple` / `long-hard`）实测确认：
两种窗口下第 1 名都是 `deepseek:v4-flash`、第 2 名都是 agnes。

### 11.5 本轮核验命令（可复用）

```bash
# 1) 新增回归测试 (24 项: 10 行为 + 14 契约)
cd packages/agentai-gateway && npx vitest run src/subagent-model-inherit.test.ts --reporter=dot

# 2) 别名解析行为级断言 (断言 resolveRetiredModelAlias 的 4 个 agnes 键)
cd packages/agentai-gateway && npx vitest run src/subagent-model-inherit.test.ts -t resolveRetiredModelAlias

# 3) 死名残留审计 —— 期望只剩 注释 / 别名键 / 别名目标 / FREE_PROVIDERS / vendor 分组别名
grep -rn "agnes-2\.0" packages/agentai-gateway/src --include=*.ts | grep -v "\.test\.ts"

# 4) 继承链注入点计数
grep -c "ctx?.modelName" packages/agentai-gateway/src/tools.ts            # → 6
grep -c "parentModelName" packages/agentai-gateway/src/team-orchestrator.ts # → 14 (5 形参 + 9 转发/调用)

# 5) 模型注册表 + GUI 迁移
cd packages/agentai-gateway && npx vitest run src/model-registry.test.ts --reporter=dot   # 22 项
cd packages/agentai-gui && npx vitest run src/store/modelStore.test.ts --reporter=dot     # 15 项

# 6) 类型 + 工具一致性 + 全量测试
cd packages/agentai-gateway && npx tsc --noEmit && pnpm verify:tools
cd packages/agentai-gateway && npx vitest run --reporter=dot   # 871 测试 (870 passed + 1 skipped) / 0 失败
cd packages/agentai-gui && npx tsc --noEmit && npx vitest run --reporter=dot  # 258 全通
```

**本轮实测结果**：网关 `tsc` 退出 0；网关 vitest **870 passed / 1 skipped / 0 failed**（869）；
GUI `tsc` 退出 0 + **258/258 通过**；`pnpm verify:tools` **ERROR=0**（202 声明 / 203 实现）。

### 11.6 如实披露（必读）

1. **A3 有意偏离 plan**：plan 说「删除 `FREE_PROVIDERS` 里的 `'agnes-2.0'`」，实现时**保留**了。
   理由：`isFreeProvider` 的语义是「免费档 → 禁用子智能体并发」（`agentai-loop.ts:4051-4058`）。
   若删除，任何**仍以 `agnes-2.0` 作为 modelName** 的路径会被**误判为付费档 → 放行子智能体 → 撞免费额度**，
   正是该处注释原本警告的失效模式。而该名已在 `executeProvider` 里被改写成 `agnes-2.5-flash`，
   到达不了上游，留着无害。已在 `llm-router.ts:40-44` 就地注释说明，并由测试断言"这是刻意的"。

2. **无法端到端验证**：没有可用的真实上游凭据时，**"子智能体确实跑在父模型上"无法自动化证明**。
   本轮的证明只到**参数级**：用打桩的 `AgentAILoop` 断言子 loop 收到的 `{model, modelName}` 正确
   （`subagent-model-inherit.test.ts` 的 6 条行为断言）。真正的"上游返回了什么"需要线上实测，
   这一项**未验证**，不声称已验证。

3. **`expert-team.ts:177` 未改**：`ExpertTeam` 类**全仓无实例化**（只用到同文件的 `EXPERT_TEAM_CONFIGS`，
   见 `tools.ts:7036`），该 `runSubagent` 调用是死代码，拿不到父模型。按「精准修改」**不动**，
   已加 6 行注释警告：若将来把它接进 run 路径，必须同时传 `parentModel + parentModelName`。

4. **`model-classifier.ts` 改名 + 256K→512K 的可见副作用**：`routeByScore` 的候选显示名会从
   `agentai:agnes-2.0-flash` 变成 `agentai:agnes-2.5-flash`（评分维度一字未动 ⇒ 行为等价，
   见 11.4 的实测）。历史日志/文档里出现的旧名属正常，不必按新名去 grep 告警。

5. **`llm-router.ts:1591` 注释同步**：原文写「`agnes-2.0` → 256K」，该条目已删、旧名现在经
   `LEGACY_MODEL_ALIASES` 解析到 512K，注释已更正（纯注释，无行为变化）。

6. ~~**两个既有基线失败未修**~~ → **2026-10-12 已修**：`b1-security`（断言 `tools.ts` 用
   `execFile('git')`）、`safety/code-runner`（断言 `scanForbiddenPatterns` 拒绝 `fs` import）
   在批次5 一并修掉，详见 §12。批次4 提交时它们的原状记录保留在上文，不重写历史。


---

## 十二、批次5：清零基线失败 + 补一个真实的沙箱绕过口子（2026-10-12）

### 12.1 结论一句话

**两个"既有基线失败"都不是代码 bug，是断言停在旧实现上**；但顺手检查同一条路径时
**发现 `scanForbiddenPatterns` 有一个真实绕过口子**，已补。

### 12.2 缺陷 D1 — `b1-security` 断言过时（非 bug）

| 项 | 内容 |
|---|---|
| 断言 | `expect(s).toMatch(/execFile\('git',\s*args,/)` — 要求 `tools.ts` 里必须写 `execFile('git', args, …)` |
| 实现现状 | `execFile(gitBin, args, …)`，`gitBin` 由 DEF-11 引入：Windows 上 `execFile('git')` 报 `ENOENT`，故先 `findGitBinary()` 探完整路径 |
| 判定 | **代码是对的，断言是旧的**。若为迁就断言而回退 `gitBin`，等于把 DEF-11 修好的 Windows 缺陷重新引入 |
| 修法 | 断言改为「经 `execFile` 传 argv 数组、不经 shell」`/execFile\(\s*(?:'git'|gitBin),\s*args,/`，**外加**一条约束 `gitBin` 来源（必须来自平台判断 + `findGitBinary()`，不能是被拼进 shell 的字符串）——保住真正的回归价值 |

### 12.3 缺陷 D2 — `safety/code-runner` 断言过时 + 一个真实漏洞（真 bug）

**过时部分**：原 `it('rejects fs import')` 断言的是**旧严格策略**（拦掉所有 `fs` 导入）。
D7 已有意放宽为「**只拦写操作，允许只读**」（`existsSync/readFileSync/readdirSync/statSync` 等
在技能脚本里很常见）。断言未跟上策略变更 → 红。

**真 bug 部分**：现有 3 条 fs 正则在**解构导入**面前形同虚设：

```js
// 原策略能拦:
fs.writeFileSync(p, d)              // ✅ 命中 /fs\.\s*(write|...)\w*\s*\(/
require('fs').writeFileSync(p, d)   // ✅ 命中 /require\(\s*['"]fs['"]\s*\)\s*\.\s*(write|...)/

// 原策略完全绕过:
import { writeFile } from 'fs'; writeFile(p, d)                  // ❌ 漏
const { rm } = require('fs'); rm(p, { recursive: true })        // ❌ 漏
require('fs').promises.unlink(p)                                 // ❌ 漏
```

**为什么这条重要**：`runSandboxedSkill` 走的是裸 `execSync(node <script>)`，
**没有任何 OS 级隔离**（无 `--permission`、无容器、无 seccomp）。正则黑名单是**唯一一道闸**，
闸上有个洞 = 技能脚本可以任意写盘/删盘。

**修法**：`safety/code-runner.ts` 第 20 条后补 3 条正则（解构 import / 解构 require / `fs.promises` via require）。
**残留绕过（已在代码注释如实标注）**：

```js
import { promises as fsp } from 'fs'; fsp.writeFile(p, d)   // 别名重命名, 正则无法静态识别
```

结论：正则黑名单**本质上堵不完**。正解是给子进程上 OS 级闸门
（`node --permission --allow-fs-read=<tempDir>`），已写入代码注释作为后续项，**本轮不做**
（会改变所有技能脚本的运行契约，属独立批次）。

### 12.4 修完后的基线

```
cd packages/agentai-gateway && npx tsc --noEmit                 # 退出 0
cd packages/agentai-gateway && npx vitest run --reporter=dot    # 69 文件 / 870 passed + 1 skipped / 0 failed (871)
cd packages/agentai-gui     && npx vitest run --reporter=dot    # 12 文件 / 258 passed
```

**相对批次4 的变化**：`865 passed / 2 failed` → `870 passed / 0 failed`
（+1 是 `code-runner.test.ts` 拆出的新用例，+4 是新增的 fs 绕过用例，另 2 个红灯转绿）。

### 12.5 如实披露

1. **`safety` 测试只覆盖 `scanForbiddenPatterns` 的静态匹配，不覆盖 `runSandboxedSkill` 的真实执行**。
   "补了 3 条正则"≠"技能脚本写盘被拦住了"——本轮**未做**真实逃逸尝试（沙箱真实拦截需在独立进程实测）。
2. **D2 的"真 bug"判定基于正则可达性推演**，非线上事故复现。它没有被利用过的证据，
   也没有 CVE；定性为"闸门上的洞"，不是"已发生的越权"。
3. **`gitBin` 断言仍可能随平台演化再变**：本次只锁"传数组、不经 shell"+ 来源约束，
   没有锁死具体探测实现，属有意留白。

---

## 十三、批次6：SKILL.md frontmatter 解析修复 — 38/97 技能对路由不可见（2026-10-12）

### 13.1 结论一句话

`skill-orchestrator` 把 frontmatter 解析不出 `name` 的技能**直接丢弃**（`if (!meta.name) return 0`），
而它用的扁平解析器读不了 CRLF 文件、不剥引号、块式列表读成 `[]` —— 实测 **97 个被扫到的 SKILL.md 里
有 38 个（39%）从未进入注册表**，对 `smartDispatch` / `matchIntent` 完全不可见。

### 13.2 语料规模先纠正：120 个文件，但只有 97 个会被扫到

```
find packages/agentai-skills -name SKILL.md -type f | wc -l          # 120
```

但 `scanDirectory`（`skill-orchestrator.ts:85-102`）的走法是"**子目录里有 SKILL.md 就不再往下走**"，
而 `communication/marketing-skills/SKILL.md` 存在，于是它下面的
`communication/marketing-skills/references/**`（**23 个** playbook）**永远不会被扫描到**。
⇒ 真实输入分母是 **97**，不是 120。仓促写文档时我按 120 算过一遍，此处以实测为准。

### 13.3 修复前后对照（同一批 97 个文件）

| 指标 | 修复前 | 修复后 | 说明 |
|---|---|---|---|
| `name` 解析出 | **59** | **79** | 差额 20 = CRLF 分隔符文件 |
| `description` 引号污染 | **12** | **0** | 旧实现把 `"..."` 原样存进描述，参与分词打分 |
| `tags` 非空 | **10** | **47** | 块式 `- x` 列表旧实现一律读成 `[]` |
| `triggers` 非空 | **16** | **35** | 嵌套 `metadata:` 下的块式列表 |
| 无 frontmatter 块 | 18 | 18 | 正文以 `# 标题` 开头的文件，本就没有 |

"修复前"一列由 `F:\temp\measure-fm2.mjs` 复刻旧 `parseSkillMd` 在**同一批 97 个文件**上跑出（非历史日志），
故两列可比。`tags`/`triggers` 的"修复后"值小于总文件数，是因为只有部分技能声明了这两个键。

修复后 `79 (有 frontmatter 且解出 name) + 18 (无 frontmatter) = 97`，
后者由新增的 `path.basename(skillDir)` 兜底接管（`_registerFromDir`），不再静默丢弃。

复刻旧解析器取"修复前"真值的一次性脚本：`F:\temp\measure-fm2.mjs`（仓外，只读）。

### 13.4 三条叠加缺陷

1. **CRLF 拒收**：`content.match(/^---\n([\s\S]*?)\n---/)` —— 20 个文件用 `\r\n`，锚定直接失配，
   整个 frontmatter 读不到。`auto-skill-discovery.ts:167` 有**同一个** bug。
2. **块式列表读不到**：旧 `parseSkillMd` 靠 `line.split(':')` + `rest.length === 0` 分流，
   `tags:` 这种"key 后留空、值在下一行 `- x`"的 YAML 会被判为"无值"整行跳过。
   `parseSkillMeta` 更严（正则 `^(\w+):\s*(.+)` 要求同行非空值），连 `tags:` 行都进不去。
3. **引号不剥**：旧 `parseSkillMd` 没有引号处理（姊妹函数 `parseSkillMeta:175` 有），
   12 个 `description: "…"` 带着引号进描述分词。

### 13.5 修法（新增 1 个文件 + 改 2 个调用点）

- **新增 `packages/agentai-gateway/src/skill-frontmatter.ts`** —— 唯一解析实现：
  换行归一（`\r\n?` → `\n`）、一级嵌套 `metadata:`、内联 `[a, b]` 与块式 `- a` 两种列表、
  标量引号剥离（保留值内冒号：`description: "专家: CoT"` 不截断）、
  `riskLevel` 只收 `low/medium/high` 三档、任何异常 → 返回 `{}` 不抛（与两个旧解析器契约一致）。
  **不引 yaml 依赖**（项目零新依赖）。
- `skill-orchestrator.ts:parseSkillMd` / `auto-skill-discovery.ts:parseSkillMeta` → 各自内部一行转发，
  签名与返回类型**一字未改**（后者本就是 export，改签名会波及调用方）。
- `_registerFromDir`：`if (!meta.name) return 0` → 先 `meta.name = path.basename(skillDir)` 再继续。
- `SkillDescriptor` 加 `triggers?: string[]`，删掉两处 `@ts-ignore`（让修复有类型保障）。
- `smartDispatch` 的**权重与阈值一行未动**（`+20/+10/+5/+1`、`skill-manager.ts:37` 的 `score/30`、
  0.5/0.7 阈值全部保持）—— 修解析 ≠ 调权重，必须分开观察才能归因。

### 13.6 本轮核验命令

```
cd packages/agentai-gateway && npx tsc --noEmit                   # 退出 0
cd packages/agentai-gateway && npx vitest run --reporter=dot      # 70 文件 / 893 passed + 1 skipped / 0 failed (894)
cd packages/agentai-gateway && npx vitest run src/skill-frontmatter.test.ts   # 23 项；stdout 打印语料真值
cd packages/agentai-gateway && pnpm verify:tools                  # ERROR=0 (202 声明 / 203 实现)
grep -n "path.basename(skillDir)" packages/agentai-gateway/src/skill-orchestrator.ts
```

行为级断言是**可归因的**：临时 SKILL.md 只用"嵌套 metadata + 块式列表"这一形态，
`smartDispatch('trigoneword alphaaa')` 断言分数**恰为 25**（1 trigger×20 + 1 tag×5，name/description 均不命中），
`smartDispatch('trigoneword trigtwoword alphaaa')` 断言**恰为 45**。

### 13.7 如实披露

1. **分母更正**：我上一轮按 120 个文件报"38/120 (32%)"，实测可扫到的只有 97 个 ⇒ **38/97 (39%)**。
   本次一并修正 AGENTS.md 的表述。
2. **不声称"路由变准了"**：本批只保证"解析正确 + 分数可归因"。端到端的匹配质量提升需要真实对话语料评估，
   **未验证**。可观测的即时后果是**更多技能会越过 0.5/0.7 阈值**（自动注入 / 强制调用变多），
   这是修复的预期效果；若噪声明显，应另开一批调权重或阈值，与本批解耦。
3. **23 个被遮蔽的技能仍不可见**：`communication/marketing-skills/references/**` 因父级 `SKILL.md` 存在
   而永远扫不到，**本批未修**（改扫描策略影响面大于本批目标，需单独评估）。
4. **两处刻意不修，仅注释记录**：① `smartDispatch:273` 用 `new RegExp(trigger, 'i')` 直接执行
   SKILL.md 里作者可控的正则（ReDoS 面）；② `_registerFromDir` 硬编码 `parallelSafe: true` /
   `riskLevel: 'low'`，frontmatter 里的同名声明被忽略。
5. **`triggers` 的 ReDoS 与上述 ③④ 均未做动态验证**；`triggers: 16 → 35` 是"非空数组个数"，
   未逐条核验每个正则的合法性（无效正则会在 `smartDispatch` 里被 `catch` 吞掉）。
6. **原计划要"顺带清 2 处文档错误"，实际只清了 1 处**：`recall` 工具不存在（已改 AGENTS.md §2.3）；
   另一条"AGENTS.md 把 `skill-indexer.ts` 当在用模块"**查证后不成立** —— AGENTS.md 从未提及它，
   它只出现在 `docs/PLATFORM_PARITY_DO_NOT_KEEP_2026-10-09.md:38`（已被标注 do-not-keep）。
   该文件确实零 import（全仓只有自身 3 处引用），但**不属于本批范围**，未删。

---

## 十四、批次7：让已存在的中文元数据真正参与技能路由（2026-10-12）

### 14.1 结论一句话

批次6 修好了"技能读不读得到"，本批修"读到的中文元数据**参不参与打分**"。
实测 97 个可达 SKILL.md 里 **66 个带 `description_zh`、33 个带 `display_name`**，
但全仓 `.ts/.tsx` 里 `grep -rn description_zh` **零匹配** —— 这批中文元数据从来没进过任何打分器。
本批让它进 `smartDispatch` 的"描述关键词 +1"通道，并给 18 个无 frontmatter 文件补上正文描述兜底。
**权重 `+20/+10/+5/+1` 与阈值 `0.5/0.7` 一行未动。**

### 14.2 先量后改（Step 0）—— 24 条消息前后对照

用 commit `890f059` 的基线（`.tmp-score-probe.ts` 实测）对照本批实现后的 T1 口径。

| 口径 | 定义 | 0 分消息 | ≥15 (0.5 阈值) | 排序重排 |
|---|---|---|---|---|
| V0 基线 | 旧解析器 + 旧分词 | 10/24 | 2 | — |
| V1 (采用) | 新解析器 + `description+description_zh` + 旧分词 | **9/24** | **2** | 无 |
| V2 (否决) | V1 + 中文 2 字滑窗 (bigram) | 3/24 | **3** | **有错配** |

**为什么否决 V2 (bigram)：** `libtv-skill` 的 `description` 是一大段中文，bigram 会让它在
**6 条消息**上夺走 top1（包括 `生成一个 PPT` → `libtv-skill/10` 的明显错配，`data-analyst/1` 被反超），
并把 `把这个视频转成音频` 顶到 **15 分，越过 0.5 注入阈值**且是**错误技能**。
这正是预登记披露里"若采用 T2 必须报告阈值误触发"的情形 —— 实测发生，故不采用。

**为什么改的是 V1 而不动 agentai-loop 内联打分器：** 该内联打分器（`agentai-loop.ts:912`）
要求 `word.length > 3`，**中文 bigram 长度 2 会被整个过滤掉**，且其 top1 在 V0≡V1≡V2 三种口径下
**全部相同**（实测 24/24）。改它零收益，故不碰那个 6400 行零覆盖文件。

### 14.3 改动清单

| 文件 | 改动 |
|---|---|
| `skill-frontmatter.ts` | 加 `descriptionZh`/`descriptionEn`/`title` 字段；新增 `extractBodyMeta`（正文兜底：`# H1` 之后取首个非标题/引用/列表/围栏/`**`/水平线行，最多前探 40 行）；`description` 回退链 `description → description_en → 正文 → H1`；导出 `scorableText` / `tokenizeScorable`（唯一打分口径，分词与旧 `smartDispatch` 完全一致：`[\s,，、]+`，len≥2） |
| `skill-orchestrator.ts` | `SkillDescriptor` 加 `descriptionZh?: string`；`_registerFromDir` 3 处 `register` 带上它；`parseSkillMd` 透传；`smartDispatch` 描述词那步改 `tokenizeScorable(scorableText(skill))`；注释 120→97；`scanDirectory` 的 `return count` 移出 `catch`（修 TS2366） |
| `auto-skill-discovery.ts` | `readSkillBody` 先归一换行再剥 frontmatter（修 CRLF 文件 frontmatter 原样泄漏给 LLM 的 bug，与批次6 同源） |
| `agentai-loop.ts` | **未改**（见 14.2） |

### 14.4 如实披露

1. **不声称"路由变准了"。** 本批只保证"中文元数据从零引用变为参与打分，且分数可归因"。
   24 条消息是**我自己编的**，不是真实用户语料，不能替代线上评估。
2. **收益有限且可预期**：T1 只把 10→9 条 0 分消息提到 1 分（`帮我定价`、`写文案` 从 0 到 1），
   **不改变 0.5/0.7 注入阈值**，**不改变 top1 排序**。因为 `description` 通道每个词只 +1，
   描述词满打满算也叠不过 tag 的 +5 / trigger 的 +20。
3. **根因比本批更大**：现有分词按空白/标点切，对中文天然不利（`提示工程专家:` 这种 token 永远
   匹配不到用户说的"提示工程"）。真正的中文分词（滑窗/词表）属于**更大改造**，本批刻意不做，
   且 Step 0 已证明 naive bigram 会引入错配。若未来要做，必须配 IDF 或按描述长度归一，
   否则长描述刷分。
4. **18 个文件的正文兜底是启发式**，其中 `meta/brand-design`（正文 `## 技能概述` 之后才是描述）
   经 `extractBodyMeta` 跳过小标题后**能**拿到描述 —— 实测 18/18 全部拿到，比预登记担心的"可能拿不到"乐观。
5. `description_zh` 解析数 = **66**（全部可达、全部非空），`description_en` 同为 66；
   与 `.tmp-zhcount.ts` 独立核验一致。
6. 本批未动 `routes/skills.ts` 的 JSON 白名单，`descriptionZh` 暂不进 API / GUI —— 记为后续。
