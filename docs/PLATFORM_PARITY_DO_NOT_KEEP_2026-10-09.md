# 平台能力 vs 自建能力对照：PulseFlow「不要保留」清单

> 生成日期：2026-10-09
> 判定基准：CodeBuddy/WorkBuddy 平台当前运行时实际提供的能力（以本次会话可直接调用的工具清单为准）
> 结论口径：**平台已有且平台更可靠的 → 不要保留自建版本**；平台没有的 → 保留并强化

---

## 一、判定原则

一个模块该不该自建，只问三个问题：

1. 平台运行时是否已原生提供该能力？（我的工具清单里能直接调用）
2. 自建版本是否比平台版本更可靠？（有执行历史、有生态、有维护）
3. 它是不是 PulseFlow 的差异化资产？（中医叙事 / 自进化 / 连续监控）

三问全否 → **删**。第 1 问是 → **不保留，改为调用平台**。第 3 问是 → **保留，不动**。

---

## 二、红区：不要保留（平台已有，自建是重复造轮）

### R1. 自建技能系统 — 5,856 行

| 文件 | 行数 | 判定 |
|---|---|---|
| `skill-code-generator.ts` (+test) | 997 | 删 |
| `skill-dna.ts` (+test) | 1,045 | 删 |
| `skill-orchestrator.ts` | 699 | 删 |
| `skill-training.ts` | 467 | 删 |
| `skill-evolver.ts` (+test) | 484 | 删 |
| `skill-market-tools.ts` | 439 | 删 |
| `skill-market-client.ts` | 339 | 删 |
| `mcp-skill-market-server.ts` | 318 | 删 |
| `skill-market-mock.ts` | 213 | 删（纯 mock） |
| `skill-market-demo.ts` | 157 | 删（纯 demo） |
| `skill-market-integration-demo.ts` | 149 | 删（纯 demo） |
| `skill-indexer.ts` | 288 | 降级为薄适配层 |
| `skill-auto-invoker.ts` | 176 | 降级为薄适配层 |
| `skill-manager.ts` | 85 | 保留（作为唯一入口） |

**平台已有**：Skill 运行时（SKILL.md 加载 + 渐进式披露）、推荐市场一键安装、`find-skills` 检索、用户级/项目级两级作用域、`SkillManage` 生命周期管理（含 agent_created 归属）、安全审计流程。

**为什么不保留自建版**：
- 平台技能有市场分发、有安装/更新/审计闭环，自建的没有
- 自建里 3 个是 demo/mock（519 行），纯原型遗留
- 自建版无安装量、无版本、无安全扫描，等于给自己造了个没有生态的影子市场

**保留什么**：`skill-manager.ts` 作为唯一门面，内部改为**适配平台技能运行时**（把平台已装技能注册成 PulseFlow 可见的 tool），不再自建 skill 存储格式。

---

### R2. 自建浏览器自动化 — 2,033 行

| 文件 | 行数 | 判定 |
|---|---|---|
| `browser-engine.ts` | 967 | 删 |
| `browser-bridge.ts` | 235 | 删 |
| `browser-profile.ts` | 278 | 删 |
| `browser-automation-simple.ts` | 292 | 删 |
| `browser-auto-show.ts` | 52 | 删 |
| `captcha-handler.ts` | 209 | 删 |

**平台已有**：agent-browser（Rust CLI + Node fallback）、tabbit、playwright-browser-automation、stagehand、stealth-browser、qqbrowser——**6 个浏览器技能**已在会话中可直接调用，覆盖导航/截图/表单/反检测/验证码。

**为什么不保留**：6 个成熟技能 vs 1 套自制引擎，能力覆盖是数量级差距。自建引擎还要自己处理 profile、验证码、反爬——这些平台技能已经踩过坑。

---

### R3. 自建定时/自动化 — 1,828 行

| 文件 | 行数 | 判定 |
|---|---|---|
| `automation-engine.ts` | 848 | 删 |
| `automation-store.ts` | 484 | 删 |
| `cron-self-evaluation.ts` | 339 | 删 |
| `cron-dispatcher.ts` | 268 | 删 |
| `cron-job.ts` | 139 | 删 |

**平台已有**：automation 调度（RRULE / 单次）、SQLite 持久化（`automations` + `runtime_state` + `runs` 三表）、执行历史、有效期窗口、目录关联。

**为什么不保留**：自建版没有执行历史、没有运行状态持久化，进程重启就丢。平台版三表结构 + 历史查询完备。自建 1,828 行换来的是"能跑"，平台换来的是"可运维"。

---

### R4. 自建 MCP 客户端 — 1,233 行

| 文件 | 行数 | 判定 |
|---|---|---|
| `mcp-client.ts` | 466 | 删 |
| `mcp/host.ts` | 301 | 删 |
| `mcp/config.ts` | 148 | 删 |
| `tools/mcp-tools.ts` | 127 | 降级 |
| `mcp/` 目录合计 | 915 | — |

**平台已有**：MCP 配置中心（`~/.workbuddy/mcp.json`）、400+ 已连接器（含企业微信、飞书、GitHub、腾讯文档等）、自定义连接器信任机制、连接器管理页。

**为什么不保留**：平台已有 400+ 连接器 + 信任链 + 管理界面，自建客户端只是把 stdio/SSE/HTTP 三种传输重写一遍，且没有连接器生态。

---

### R5. 试验性/原型文件 — 1,965 行（独立第三类）

| 文件 | 行数 | 判定 |
|---|---|---|
| `ab-testing.ts` | 595 | 删 |
| `lead-conversion-example.ts` | 306 | 删（example） |
| `agent-battle.ts` (+test) | 322 | 删 |
| `skill-market-mock.ts` / `*-demo.ts` / `*-integration-demo.ts` | 519 | 删 |
| `media-generation-demo.ts` | 170 | 删 |
| `enterprise-automation-example.ts` | 206 | 删 |
| `real-content-publisher.example.ts` | 194 | 删 |
| `ai-autonomous-example.ts` | 106 | 删 |
| `debug-tasks-api.ts` | 66 | 删 |

**判定标准**：文件名带 `-demo` / `-example` / `-mock` / `debug-` 的，在主干里就是没清理的原型。这正是那篇微信文章说的"原型不许留仓库"。

---

## 三、黄区：改造保留（平台有雏形但不足，或需中医化）

### Y1. 自建记忆系统 — 1,699 行 → 改造为「医案记忆层」

| 文件 | 行数 | 处置 |
|---|---|---|
| `memory-network.ts` | 402 | 保留（关联网络是中医辨证需要） |
| `memory-manager.ts` | 380 | 保留 |
| `memory-importance.ts` | 258 | 保留（重要性 = 君臣佐使权重） |
| `memory.ts` | 659 | 保留 `WorkspaceJournal`，通用检索层委托平台 |

**不删但要收敛**：平台的三层记忆（云端 profile / 用户 MEMORY.md / 工作区 memory）负责"通用事实与约定"；PulseFlow 的记忆只负责**医案经验、辨证结论、用药反馈**。两者划界，不重叠。

### Y2. 自建知识探索 — 收敛为「蒸馏」一层

`knowledge/github-explorer.ts`(333) + `distiller.ts`(324) + `gap-detector.ts`(227)。

平台已有 WebSearch/WebFetch 做检索。自建 explorer 做的是"找到值得学的东西之后怎么蒸馏成医案"——这后半段是差异化的，**保留 distiller 与 gap-detector，把 explorer 降级为调用平台检索**。

### Y3. 自建 QQ/微信通道 — 1,251 行 → 保留，但明确降级定位

`wechat/` 8 文件 1,251 行 + QQ 反向 WS。

平台已有企业微信/微信/飞书连接器，但**自建通道的价值不在"能连微信"**，而在"Agent 主动出手"（反向 WS、主动回复）。这个差异化是真的，保留，但不要在"通道协议"上和平台连接器竞争——那是平台赢。

---

## 四、绿区：必须保留（平台完全没有 = 你的护城河）

| 模块 | 行数 | 为什么平台替代不了 |
|---|---|---|
| `soul/` 灵魂层 | 2,355 | 内心独白/内部辩论/好奇心/梦境/痛觉感知/价值向量——**平台没有任何对应物**。这是"人格连续性" |
| `qihuang/four-diagnoses.ts` | 699 | 望闻问切四诊合参，平台无 |
| `xuanji/` 医案处方 | 1,232 | 辨证论治 + 处方引擎，平台无 |
| `diagnosis/` 诊断子系统 | 1,384 | 诊断引擎/gap 分析/任务感知，平台无 |
| `judge/self-eval.ts` | 245 | 自验证闭环起点 |
| `governor/` | 656 | 能力矩阵 + 运行时追踪 |
| `sandbox/` | 10 文件 | 沙箱规则引擎（deny/prompt/allow），平台沙箱是运行时的，没有"可编辑规则"概念 |
| `qihuang` + `soul` + `xuanji` 合计 | 4,286 行 | **这就是 PulseFlow 存在的理由** |

---

## 五、量化结论

| 分类 | 文件量 | 行数 | 处置 |
|---|---|---|---|
| 🔴 红区（不要保留） | ~40 | ~11,400 | 删或降级为适配层 |
| 🟡 黄区（改造保留） | ~15 | ~3,000 | 收敛划界 |
| 🟢 绿区（必须保留） | ~40 | ~7,500 | 不动，强化 |
| ⚪ 灰区（本次不动） | 其余 ~290 | — | 后续审查 |

**一句话**：红区 + demo/mock 区合计约 **1.3 万行，占网关自建代码的相当比重**，全部是在重造平台已有的轮子。删掉它们，项目轻 30%+，且**能力不降反升**（换成平台 400+ 连接器、6 个浏览器技能、带历史的调度器）。

**真正让 PulseFlow 立不住的从来不是这些通用基建，而是那 4,286 行中医资产够不够锋利。**

---

## 六、执行顺序建议

1. **第一批（零风险）**：删 R5 试验性文件 1,965 行 + R1 里 3 个 demo/mock 519 行 → 每个文件删前 grep 验证 0 引用，删后 tsc/build 对比
2. **第二批（需接口对齐）**：R2 浏览器 → 把 `browser-engine` 的对外接口换成调平台技能，GUI 的 EmbeddedBrowser 改为调用通道
3. **第三批（架构级）**：R3 调度 + R1 技能 + R4 MCP 三件套统一收敛到平台，先出适配层设计再动刀
4. **不排期**：绿区任何一行都不动

---

## 附：判定依据（本次会话可调用的平台能力实证）

- **技能**：Skill 工具 + 推荐市场安装器 + find-skills 检索 + SkillManage 生命周期
- **浏览器**：agent-browser / tabbit / playwright-browser-automation / stagehand-browser-cli / stealth-browser / qqbrowser（6 个）
- **定时**：automation_update（create/update/view/list/delete，RRULE + SQLite 三表持久化 + 执行历史）
- **MCP**：mcp.json 配置 + 400+ 连接器 + 信任机制
- **记忆**：云端 profile / ~/.workbuddy/MEMORY.md / 工作区 .workbuddy/memory 三层
- **检索**：WebSearch / WebFetch
- **任务**：TaskCreate / TaskUpdate / TaskList / TaskGet
- **文件**：Read / Write / Edit / Glob / Grep / Bash