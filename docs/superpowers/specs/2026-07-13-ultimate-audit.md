# 终极系统审查报告

> 日期：2026-07-13
> 范围：全平台（网关 + 前端 + 5 个外围包）
> 方法：6 个并行深度审查 agent + 文件级逐项核查
> 总扫描文件：500+

---

## 一、总览矩阵

| 维度 | 网关后端 | 前端 GUI | 路由 | 外围包 | 总计 |
|------|---------|---------|------|--------|------|
| **Critical 漏洞** | 2 | 1 | 2 | 1 | **6** |
| **High 漏洞** | 5 | 4 | 3 | 3 | **15** |
| **死代码模块** | 11 | 12 | 3 | 5 | **31** |
| **未融入** | 8 | 10 | 0 | 6 | **24** |
| **重复组件** | 7 | 5 | 2 | 3 | **17** |
| **@ts-nocheck** | 26 | 0 | - | - | **26** |
| **创新点** | 12 | 8 | 0 | 4 | **24** |

**问题总数：119 项 | 创新点：24 项**

---

## 二、6 个 Critical 漏洞（必须立即修复）

### C1. 命令注入 RCE（最高危）
**位置**：`app.ts:120-138` `GET /v1/system/check-dep`
**问题**：`execSync(cmd + ' --version 2>&1')`，`cmd` 来自 `req.query.cmd`，无白名单
**风险**：`cmd="node -e \"require('child_process').exec('rm -rf C:\\\\')\""` 即可 RCE
**修复**：白名单 + 输入校验

### C2. 全局零认证
**位置**：全网关
**问题**：无任何 auth middleware / token / JWT，本地网络内任何主机可调用 `/v1/files/write`、`/v1/settings/keys`、`/v1/cleaner/confirm`、`/v1/qq/connect`
**修复**：加 token middleware

### C3. 任意目录浏览
**位置**：`files.ts:163-203` `GET /v1/fs/list`
**问题**：注释明示"放宽路径限制, 不做 allowedRoots 校验"，攻击者可枚举 `C:\Windows\System32`
**修复**：恢复 allowedRoots 校验

### C4. API Key 明文存储
**位置**：前端 `Settings.tsx:189/311`、`Model3DGen.tsx:52-54`、`VoiceService.ts:25`
**问题**：直接 `localStorage.setItem(envVar, apiKey)`，XSS 即可窃全部密钥
**修复**：改用 sessionStorage 或后端代理

### C5. AI 生成代码无沙箱执行
**位置**：`tools.ts:3298` `discover_or_create_skill`
**问题**：`await import(path.join(skillDir,'index.js'))` 在 gateway 进程内运行 AI 生成代码，无 sandboxGuard
**对比**：`tool-factory.ts` 已用 CodeRunner 沙箱但反而是死代码
**修复**：用 CodeRunner 沙箱包装

### C6. waitForClarification 不监听 abort
**位置**：`agentai-loop.ts:474-483`
**问题**：会话被压制时旧 loop 的 pending Promise 仍挂起 60s，期间持有 context/log 引用，快速连发消息会内存膨胀
**修复**：监听 `this.opts.abortSignal` 立即 reject

---

## 三、15 个 High 漏洞

### H1. Xuanji "clarify" 策略假阻塞
**位置**：`routes/chat.ts:391-412`
**问题**：发送 `clarification_needed` SSE 事件后不 return，继续走 SSE 流式分支调用 LLM。用户看到追问卡片但 AI 已自行作答，UX 矛盾

### H2. 凭证明文存储（QQ）
**位置**：`routes/qq.ts:326` `~/.agentai/qq-config.json` 明文保存 QQ appSecret

### H3. Python 任意执行
**位置**：`python-bridge.ts` 用 `execSync(${PYTHON} "${absPath}")` — 若 `~/.agentai/skills/` 被植入恶意 SKILL.md+main.py 即可执行任意代码

### H4. 3 个决策入口冲突
**位置**：`agentai-loop.ts:2783` + `:2870`
**问题**：MetaCognitiveLoop 返回 `continue`/`retry_with_pua`/`call_tool` 时 fall through 到 ConfidenceEstimator，两者同迭代各注入 directive，可能矛盾

### H5. `metaLoop` 跨消息状态污染
**位置**：`agentai-loop.ts:2785-2796`
**问题**：`stepCount` 跨多轮 `run()` 累积；5 条消息后 `stepCount >= maxMetaSteps=5`，元认知实质失效

### H6. SmartModelSwitcher 免费池不完整
**位置**：`smart-model-switcher.ts:296`
**问题**：免费池仅 `['agentai','zhipu']`，未含 sensenova/longcat/nvidia/dxnt

### H7. inline 路由遮蔽正式路由
**位置**：`app.ts:238-304` inline `/v1/schedules*` vs line 424 `createTaskSchedulerRouter()`
**问题**：inline 赢，`/stats`、`/pause`、`/resume` 不可达，前端调用 404

### H8. `suggestions` 路由遮蔽
**位置**：`app.ts:455-469` inline `app.get('/v1/suggestions', ...)` 被 line 430 `app.use('/v1/suggestions', suggestionsRouter)` 遮蔽

### H9. `files.ts:295-307` 重复定义
**位置**：`GET /v1/files/read` 两个版本，逻辑不同（第一版 5MB 限制，第二版无）

### H10. CSP 信任外部域
**位置**：`tauri.conf.json` CSP 允许 `https://apihub.agnes-ai.com`，CDN 引入 `marked.min.js`，供应链风险

### H11. 硬编码 URL
**位置**：`App.tsx:372` `http://localhost:3001`（错误端口，gateway 在 18789）+ `vscode extension.ts:215` `http://127.0.0.1:18789`

### H12. 多处 `.catch(() => {})` 静默吞错
**位置**：`App.tsx:385/233`、`Model3DGen.tsx` 等

### H13. 硬编码颜色
**位置**：`ProactiveSuggestionCard.tsx:48-52` 违反 CSS 变量规则

### H14. `splitQQMessage` Prompt 注入
**位置**：`routes/qq.ts` 将 `userId`/`groupId` 直接拼入 LLM 上下文，未做转义

### H15. 路由 hack
**位置**：`routes/qq.ts:537` 手动改写 `req.url` 再 `(r as any).handle(req,res)` 绕过 Express 中间件链

---

## 四、31 个死代码模块

### 4.1 网关死代码（11 个）

| 文件 | 行数 | 状态 |
|------|------|------|
| `decision-gate.ts` | 整文件 | `DecisionGate` 类从未被 import |
| `diagnosis/plan-assembler.ts` | 整文件 | `assemblePlan` 仅供自带测试调用 |
| `diagnosis/step-verifier.ts` | 整文件 | `verifyStep`/`verifySteps` 仅供自带测试 |
| `diagnosis/gap-analyzer.ts` | 整文件 | 被 `gap-analyzer-llm.ts` 完全取代 |
| `diagnosis/quick-diagnose.ts` | 整文件 | 仅 re-export 无消费者 |
| `tool-factory.ts` | 整文件 | `inventTool` 仅测试引用 |
| `skill-training.ts` | 整文件 | `SkillTrainer` 仅被 SkillEvolver 调，后者无生产调用 |
| `skills/doubt-driven-development.ts` | 整文件 | 零导入 |
| `skills/auto-error-repair.ts` | 整文件 | 注册被注释 (skill-orchestrator.ts:359) |
| `router-rate-limiter.ts` | 整文件 | `enhanceRouterWithRateLimit` 无 import |
| `rate-limit-integration.ts` | 整文件 | `setupRateLimit` 无 import |

### 4.2 前端死代码（12 个）

| 文件 | 状态 |
|------|------|
| `sedoxtJWW`（无扩展名） | 旧版 App.tsx 重写残留 |
| `utils/profile.ts` | 仅被 sedoxtJWW 引用 |
| `services/sseParser.ts` `parseSSE` | 0 引用 |
| `services/IdeStateCollector.ts` `ide_state_collector` | 0 引用（AGENTS.md 宣称"IDE 状态感知"前端实际未接） |
| `services/CameraTemplates.ts` | 0 引用 |
| `stores/useAppStore.ts` | useProfileStore 的 7 行僵尸拷贝 |
| `pages/ChatPage.tsx` | 整个 pages/ 目录全死 |
| `pages/SettingsPage.tsx` | 死 |
| `pages/LabPage.tsx` | 死 |
| `pages/TasksPage.tsx` | 死 |
| `pages/KnowledgeGraphPage.tsx` | 死 |
| `components/CleanerPanel.format.test.ts` | 遗留测试 |

### 4.3 路由死代码（3 个）
- `app.ts:238-304` inline `/v1/schedules*`（被遮蔽）
- `app.ts:455-469` inline `/v1/suggestions`（被遮蔽）
- `files.ts:295-307` 重复 `GET /v1/files/read`

### 4.4 外围包死代码（5 个）
- `agentai-core/` 整个包（无任何包 import 它）
- `agentai-desktop/src/ai-browser-agent.ts` 472 行
- `agentai-qqbot/src/service-legacy.ts` + `client.ts` + `gateway-proxy.ts` + `go-cqhttp.ts` + `config.ts`（go-cqhttp 模式整套）
- `agentai-skills/scripts/skills_bridge.py`（仅支持 image/video）
- `agentai-skills/decoration-quote/`（已被 office/decoration-quotation 取代）

---

## 五、24 个未融入项

### 5.1 网关（8 个）
1. **`prescriptionEngine.prescribe()`** — 计算结果仅写入 medicalCase，不执行
2. **`step-verifier`** — `MasterController.executeSubTask` 后无任何质量验证调用
3. **`decision-gate.ts`** — 拟统一 5 个决策模块但从未被采用
4. **`DeepSeekCacheStrategy`** — fingerprint 缓存设计完整，agentai-loop 标注永久跳过
5. **`model-distiller.nightlyConsolidation`** — 实现完整但无 cron-dispatcher 注册
6. **`SmartModelSwitcher.executeSwitch`** — 全文件无调用方
7. **`capability-probe`** — 仅 admin 手动触发，未参与 router 路由决策
8. **`CostTracker`** — budget 阈值与 router 的 costGuard 体系独立，未联动

### 5.2 前端（10 个）
- `ChatTimeline.tsx`、`WorkspacePanel.tsx`、`FileTimelinePanel.tsx`
- `FileUpload.tsx`、`MonacoEditor.tsx`、`SkillInvoker.tsx`、`TaskChainCard.tsx`
- `knowledge/KnowledgeGraphPanel.tsx`（仅被 sedoxtJWW 引用）
- 整个 `pages/` 目录（5 个文件）

### 5.3 外围包（6 个）
1. **agentai-core** 未被任何包 import（架构违规）
2. **ai-browser-agent.ts** 未注册为 Tauri 命令
3. **handler.py 系列技能** 未融入 `/v1/skills` REST API（13 个技能仅 orchestrator 内部可达）
4. **scanProjectSkills/scanUserSkills** 结果只 console.log，未注册 ToolRegistry
5. **auto-skill-creator 生成的 SKILL.md** 不进 ToolRegistry（LLM 看不到）
6. **qqbot 包** 整体未融入主流（gateway 已自建 QQBot）

---

## 六、17 个重复组件

### 6.1 网关（7 个）

| 重复对 | 重复度 |
|--------|--------|
| `agentai-qqbot` vs `routes/qq.ts` 的 QQBot 类 | 100%（routes/qq.ts 是超集） |
| `moss-tts-server`（desktop）vs `moss-tts-nano`（skills） | 100%（同一份代码两份副本） |
| `rate-limiter.ts` vs `rate-limit.ts` | 80%（两个 RateLimiter 类） |
| `token-estimate.ts` vs `token-utils.ts` | 50% |
| `DeepSeekCacheStrategy` vs `llm-router.cache` | 60% |
| `cost/CostTracker` vs `llm-router.costGuard` | 70% |
| `SmartModelSwitcher` vs `llm-router fallback` | 70% |
| 三套 model 注册表：`model-classifier.MODELS` / `model-selector.BUILTIN_MODELS` / `commercial-model-templates` | 数据分散 |
| 三套技能注册表：`ToolRegistry` / `SkillOrchestrator` / `loader.ts` | 互不相通 |

### 6.2 前端（5 个）

| 重复对 | 重复度 |
|--------|--------|
| `SchedulePanel.tsx` vs `AutomationPanel.tsx` | 95%（同 API） |
| `services/voice.ts` vs `VoiceService.ts` | 80% |
| `stores/useAppStore.ts` vs `useProfileStore` | 100%（僵尸） |
| `ChatView` vs `EditorChatPanel` vs `ChatTimeline` | 60% |
| 3 个 ProactiveSuggestion 组件 | 分层但有冗余类型适配 |

### 6.3 路由（2 个）
- inline `/v1/schedules*` vs `createTaskSchedulerRouter()`
- inline `/v1/suggestions` vs `suggestionsRouter`

### 6.4 外围包（3 个）
- qqbot 完整包 vs routes/qq.ts
- moss-tts 两份副本
- splitQQMessage 函数两处

---

## 七、26 个 @ts-nocheck 文件

**网关 src/ 层**：tools.ts、index.ts、llm-router.ts、builtin-tools-manager.ts、smart-model-switcher.ts、rate-limiter.ts、router-rate-limiter.ts、model-distiller.ts、worktree.ts、token-estimate.ts

**routes/**：chat.ts、admin.ts、health.ts

**sandbox/**：index.ts、index.test.ts

**code-intel/**：search.ts、analyze.ts

**frameworks/**：openclaw-adapter.ts、hermes-adapter.ts

**skills/**：watcher.ts、spawner-cli.ts、router.ts、migrate.ts、loader.ts、skill-training.ts

**@ts-ignore 8 处**：browser-engine.ts、browser-profile.ts×2、mimo-tts-service.ts×2、notification-engine.ts、skill-orchestrator.ts:157、xuanji/medical-case.ts

---

## 八、24 个创新点（值得保留）

### 8.1 网关（12 个）

1. **5 层 fallback 链**（指定→cache→ranking→emergency→lightning-swap→dxnt→custom）
2. **闪电交替降级**：免费全熔断时自动切 DeepSeek 并关闭 thinking 模式
3. **Provider 协议白名单** `filterRequestFields` 防 protocol field leakage
4. **Token 压缩 ContentRouter** 自动识别 json/code/directory/log/error
5. **5 维评分路由**（complexity/context/cost/success/latency）
6. **Governor 动态能力矩阵** 运行时表现动态调整排序
7. **MetaReasoner PUA 压力递进** L0→L1→L2 强制 AI 重试 2 轮才问人
8. **CognitiveProfile 认知指纹** 每个 Agent 强项/弱项/工具偏好/失败模式
9. **Xuanji 璇玑中医辨证框架** 完整望闻问切→辨证→君臣佐使方剂→医案积累
10. **AgentBattle 多智能体博弈** N 个 persona + LLM-as-Judge + FailurePattern
11. **SelfModifier 安全自修改** allowedDirs + forbiddenPatterns + 自动备份 + 编译/测试/安全三重验证 + 人工审批
12. **代际中断机制** `_runGeneration` 计数器替代 AbortSignal，新 run 取代旧 run 优雅退出

### 8.2 前端（8 个）

1. **chatStore throttled localStorage** 流式输出 2 秒节流防主线程阻塞
2. **editorChatStore rAF 批量更新** requestAnimationFrame 合并多次 message 更新
3. **PAGES 字典 + lazy import** 12 页代码分割，首屏仅 chat
4. **Splash + ErrorBoundary + PageSkeleton** 三层启动保护
5. **FloatingSuggestionToast** 倒计时进度条 + hover 暂停 + CSS 变量主题
6. **modeStore 4 模式系统**（auto/planning/review/readonly）+ 持久化
7. **多用户身份隔离** `agentai.user.{name}` + sessionStore.currentUserId
8. **taskOrchestratorStore** TRAE 风格 SSE 驱动任务跟随面板

### 8.3 外围包（4 个）

1. **桌面端 PyInstaller exe + HF 模型预打包** 开箱即用
2. **Tauri 子进程端口 TIME_WAIT 处理**
3. **QQBot 沙箱 host 白名单** 防 WebSocket 重定向攻击
4. **双技能注册表演化设计**（loader 元数据 + orchestrator 动态 handler）

---

## 九、修复优先级路线图

### Phase 0：Critical 安全（1-2 天）

| # | 任务 | 风险 | 工作量 |
|---|------|------|--------|
| C1 | `/v1/system/check-dep` 加白名单 | 高 | 0.5 天 |
| C2 | 全局 token middleware | 高 | 1 天 |
| C3 | `files.ts` 恢复 allowedRoots | 高 | 0.2 天 |
| C4 | 前端 API Key 改 sessionStorage | 高 | 0.5 天 |
| C5 | `discover_or_create_skill` 用 CodeRunner | 高 | 0.5 天 |
| C6 | `waitForClarification` 监听 abort | 中 | 0.2 天 |

### Phase 1：High 漏洞（3-4 天）

| # | 任务 | 工作量 |
|---|------|--------|
| H1 | Xuanji clarify 真阻塞 | 0.3 天 |
| H4 | decision-gate 统一决策入口 | 1 天 |
| H5 | metaLoop 每次 run() 重置 | 0.1 天 |
| H7-9 | 删除 inline 路由遮蔽 | 0.3 天 |
| H11 | 删除硬编码 URL | 0.2 天 |

### Phase 2：死代码清理（2-3 天）

| # | 任务 | 工作量 |
|---|------|--------|
| D1 | 删除 11 个网关死代码 | 0.5 天 |
| D2 | 删除 12 个前端死代码 + pages/ | 0.5 天 |
| D3 | 删除 5 个外围包死代码 | 0.5 天 |
| D4 | 删除 `agentai-core` 包 | 0.1 天 |

### Phase 3：重复合并（4-5 天）

| # | 任务 | 工作量 |
|---|------|--------|
| R1 | 删除 qqbot 包（gateway 已有） | 0.5 天 |
| R2 | moss-tts 改 symlink | 0.2 天 |
| R3 | 合并 SchedulePanel + AutomationPanel | 1 天 |
| R4 | 合并 voice.ts + VoiceService.ts | 0.5 天 |
| R5 | 统一三套技能注册表 | 2 天 |
| R6 | 统一 model 注册表 | 1 天 |

### Phase 4：@ts-nocheck 移除（长期）

26 个文件逐个启用类型检查，每个文件预估 0.5-1 天。

**总工作量：10-15 天**

---

## 十、核心判断

### 10.1 系统层次定位

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构完整性** | A- | ALTES · 岐黄 已实现，决策层有 decision-gate 待接入 |
| **代码质量** | C+ | 26 个 @ts-nocheck，119 项问题 |
| **可维护性** | C | 17 项重复，31 项死代码 |
| **安全性** | D | 6 个 Critical，零认证 + RCE + 任意目录 |
| **创新性** | A+ | 24 个独特设计，业界领先 |
| **工程化** | B- | 测试覆盖不足，类型检查大量绕过 |

### 10.2 与重构理念的对齐度

| 理念 | 实现度 | 缺口 |
|------|--------|------|
| 望·任务感知 | 100% | - |
| 闻·缺口分析 | 100% | gap-analyzer.ts 死代码（已有 LLM 版替代） |
| 问·追问 | 70% | Xuanji clarify 假阻塞 |
| 切·诊断 | 100% | - |
| 因证施治 | 60% | prescriptionEngine 不执行、step-verifier 未接入 |
| 治中求验 | 0% | step-verifier 完全未接入 |
| 以简驭繁 | 30% | decision-gate 未接入，3 入口冲突 |

### 10.3 一句话总结

> **这是一个有 24 个创新点、被 119 项问题拖累的天才框架。**
> **6 个 Critical 是真正的危机，必须立即修复。**
> **死代码和重复组件是次要问题，可分阶段清理。**
> **核心架构（诊断优先 + 元认知 + 自进化）已落地，但"治中求验"环节完全缺失。**

---

## 十一、附录

### 11.1 6 个 agent 报告位置

本报告基于以下 6 个并行深度审查 agent 的结果汇总：
1. 模型调用链路审查
2. 核心循环与诊断审查
3. 工具系统审查
4. 前端组件完整性审查
5. 网关路由审查
6. 外围包完整性审查

### 11.2 相关文档

- `2026-07-13-full-audit-report.md` — 初版审查报告
- `2026-07-13-full-deep-audit.md` — 全盘深度审查
- `2026-07-13-fix-summary.md` — 已修复问题汇总
- `2026-07-13-fix-progress.md` — 修复进度追踪
- `2026-07-13-refactor-safety-review.md` — 重构安全审查

### 11.3 已完成修复（截至本报告）

| 修复 | 状态 |
|------|------|
| Critical #1 `qq-bot-client.ts` 死代码 | ✅ 已删 |
| Critical #3 `plan-executor.ts` 死代码 | ✅ 标记废弃 |
| `Xuanji` 单例复用 | ✅ |
| `system-prompt.ts.bak` 清理 | ✅ |
| `ask_human` 阻塞机制 | ✅ |
| `clarify:required` 事件 source 字段 | ✅ |
| `skill-auto-invoker.ts` 导入修复 | ✅ |
| `app.ts` 导入修复 | ✅ |
| `skill-orchestrator.ts` undefined 修复 | ✅ |

**剩余 99 项问题待处理。**
