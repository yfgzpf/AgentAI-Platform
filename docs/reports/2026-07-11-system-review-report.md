# AgentAI Platform — 全面系统审查报告 (2026-07-11)

> 审查范围：全量编译 + 核心引擎 + 9个gateway子模块 + 前端GUI + 品牌一致性 + 死代码 + 安全
> 方法：tsc --noEmit + 行号级代码阅读 + 集成链路追踪
> 对照基线：2026-07-06 报告

---

## 〇、5天变化概览（07-06 → 07-11）

31次提交，方向转向**行业落地**：

| 方向 | 内容 |
|------|------|
| 品牌迁移 | Atlas → **PulseFlow**（前端显示层） |
| 玄机中医框架 | xuanji/ 认知框架 + 医案系统 + 处方引擎（隐喻式，非真实处方） |
| RPA 获客 | ai-agent路由 + browser-automation + 评论拦截系统 |
| TTS | Edge TTS（默认）+ MIMO商业TTS + Agnes降级 |
| 装饰行业技能包 | cad-ai-designer / quotation-generator / material-selector / construction-supervisor / requirement-interview |
| 数据技能 | chart-generator + database-skill |
| 其他 | Splash屏 / VoiceSelector / BrowserAutomationPanel |

---

## 一、编译状态

```
tsc --noEmit → 1 error
src/skill-orchestrator.ts(346,1): error TS1005: '}' expected.
```

**根因**：`class SkillOrchestrator`（第37行开启）从未闭合。第333行的 `}` 仅闭合 `executeSkill` 方法，之后第335行直接是模块级 `export`，缺少类的闭合大括号。

**修复**（第333行后插入一行）：
```typescript
  }   // 333: 闭合 executeSkill
}     // ← 新增: 闭合 class SkillOrchestrator

export const skillOrchestrator = new SkillOrchestrator();
```

**影响**：gateway 完全无法编译，整个后端不可运行。这是当前**最高优先级**。

---

## 二、安全风险（高危）

### S1. 硬编码 API Key 泄露 ⚠️⚠️⚠️
- `mimo-tts-service.ts:52` — `BUILT_IN_API_KEY = 'sk-cp5szr1336c4uhfnwdbjpl4p8x9ydelvaz6wl42qv57vne49'`
- 已提交进 git 历史，密钥需**立即吊销 + 轮换**
- 修复：删除硬编码，改为强制 `process.env.MIMO_API_KEY`，无则禁用 MIMO provider

### S2. 命令注入
- `browser-automation-simple.ts:54` — `` `browser-use ${command} ${args.join(' ')}` `` 直接字符串拼接 exec
- `command`/`args` 来自外部输入时可注入任意 shell 命令
- 修复：用 `execFile`（不经过 shell）或严格白名单校验

### S3. 脚本写入无校验
- `browser-automation-simple.ts` 写入 `~/.agentai` 无路径规范化，存在目录穿越风险

---

## 三、集成质量（新模块）

| 模块 | 挂载 | 质量 | 判定 |
|------|------|------|------|
| xuanji/ 玄机 | ✅ app.ts:428 + chat.ts深度调用 | 好 | **保留** |
| routes/ai-agent.ts | ❌ 无任何 import 挂载 | 全 TODO + mock数据 | **空壳，删或补** |
| browser-automation-simple.ts | ❌ 无调用者 | 命令注入+孤儿 | **死代码** |
| desktop/ai-browser-agent.ts | ❌ 文件不存在 | — | 引用悬空 |
| edge-tts-service.ts | ✅ voice.ts | 好 | 保留 |
| mimo-tts-service.ts | ✅ voice.ts | 密钥泄露+响应格式猜测 | **修密钥** |
| user-preference-engine.ts | ❌ 无路由暴露 | 内存态无持久化 | 半成品 |
| wechat-acquisition.ts | ❌ 无引用 | 内存态 | **死代码** |
| skill-orchestrator.ts | ✅ 被 skills/ 用 | 编译失败 | **必修** |

---

## 四、死代码清单（7处）

| # | 文件 | 原因 |
|---|------|------|
| D1 | `workflow/engine.ts` (+test) | 无生产消费方，真正活跃的是顶层 workflow-orchestrator.ts |
| D2 | `wechat/index.ts` (CLI入口) | 无 import 者 |
| D3 | `wechat-acquisition.ts` | 零引用 |
| D4 | `proactive-engine.ts` (旧版) | 被 proactive-suggestion-engine.ts 取代 |
| D5 | `agentai-audit/` (整个package) | src全空目录，零代码引用 |
| D6 | `browser-automation-simple.ts` | 孤儿，无调用者 |
| D7 | `routes/ai-agent.ts` | 未挂载，纯mock |

### 核心引擎内死代码（llm-router.ts）
- `rankProviders` [736-742] + `scoreProvider` [749-761] — 注释自承废弃，无调用
- `shouldReflect` [1650-1656] + `reflect` [1658-1667] — 无调用
- `appendOnlyLog.push` [717] — 写入后仅被死代码 reflect 读取，**写而不读**
- `_currentProviderId` [196] — 仅声明，无赋值/读取

### agentai-loop.ts
- `getOrCreateCache` [290-308] — 无调用
- `_globalCache` [287] — 跨实例共享全局可变单例，存在会话间状态泄漏风险
- `ProactiveSuggestionEngine` [1208] — 靠构造函数副作用，变量本身未使用

---

## 五、Bug 清单

### B1. Cost Guard 形同虚设
- `llm-router.ts:823-831` `checkCostGuardPost` — `exceeded` 标记永不为 true，`dailySpend` 无上限累加
- 加上 `costGuard.disabled = true` [182]，整个成本守卫**完全不生效**

### B2. VoiceService profile key 不匹配
- `VoiceService.ts:170` 读 `agentai-profile`
- `App.tsx:117` 写 `agentai-user-profile`
- 结果：唤醒词用户名永远读不到

### B3. xuanji parseInt 无 NaN 校验
- `routes/xuanji.ts:98` `parseInt(limit)` 未校验，NaN 会触发后续错误

### B4. mimo-tts 响应解析是猜测实现
- `mimo-tts-service.ts:136` 自注释"实际API响应格式可能需要调整"，`extractAudioFromResponse` 大概率运行时失败

---

## 六、品牌一致性

三品牌名（PulseFlow / Atlas / AgentAI）跨文件混用：

| 位置 | 当前值 | 应为 |
|------|--------|------|
| App.tsx:404 品牌名 | PulseFlow ✅ | — |
| App.tsx:401 logo alt | **Atlas** ❌ | PulseFlow |
| Editor.tsx:2 注释 | **"Atlas 文件编辑器"** ❌ | PulseFlow |
| system-prompt.ts | PulseFlow ✅ | — |
| system-prompt-lite.ts:23 | **AgentAI** ❌ | PulseFlow |
| chat.ts:473/640 模型标签 | **Atlas** ❌ | PulseFlow |
| localStorage key | agentai.* | 可保留（内部） |
| 事件名 | agentai:* | 可保留（内部） |
| App.tsx.broken | 残留文件 ❌ | 删除 |

---

## 七、前端规则合规（AGENTS.md 规则8）

PAGES 字典（App.tsx:79-98）注册情况：

| 组件 | 注册PAGES | 实际渲染方式 | 判定 |
|------|-----------|-------------|------|
| XuanjiPanel | ✅ | 字典 | 合规 |
| BrowserAutomationPanel | ❌ | Editor.tsx:719 手动JSX | 灰区(子视图) |
| CommentInterceptionWidget | ❌ | RightPanel.tsx:60 手动JSX | 灰区(widget) |
| EmbeddedBrowser | ❌ | BrowserMode.tsx:272 手动JSX | 灰区 |
| VoiceSelector | ❌ | Settings.tsx:392 手动JSX | 灰区 |
| Splash | ❌ | App.tsx:737 手动JSX | 应入字典 |

---

## 八、问题优先级总表

### P0 — 立即修（阻塞运行/安全）
1. **skill-orchestrator.ts 编译错误** — 加一个 `}`，否则后端无法启动
2. **mimo-tts-service.ts 硬编码密钥** — 吊销+轮换+改env

### P1 — 本周修（安全/功能）
3. browser-automation-simple.ts 命令注入 → 改 execFile
4. Cost Guard 修复（exceeded 逻辑 + disabled 改 false）
5. VoiceService profile key 统一
6. 品牌混用4处统一为 PulseFlow

### P2 — 清理（死代码）
7. 删 D1-D7 死代码（7处）
8. 删 llm-router 内 rankProviders/scoreProvider/shouldReflect/reflect
9. 删 agentai-loop getOrCreateCache + _globalCache 重构
10. 删 App.tsx.broken

### P3 — 优化
11. 半成品模块（ai-agent/user-preference/wechat-acquisition）补完或删除
12. 前端组件统一走 PAGES 字典
13. system-prompt 三品牌统一

---

## 九、能力集成总览（对比07-06）

| 能力 | 07-06状态 | 07-11状态 | 变化 |
|------|-----------|-----------|------|
| buildImmutablePrefix 20+层 | ✅ | ✅ | 稳定 |
| Provider 适配自动检测 | ✅ | ✅ | 扩展到9个provider |
| Cost Guard | ⚠️ 未找到reset | ❌ bug确认 | **退化** |
| Evolution 失忆症 | ✅ 治愈 | ✅ | 稳定 |
| WorkspaceJournal | ✅ | ✅ | 稳定 |
| Model Distiller | ✅ | ✅ | 稳定 |
| Goal模式 | ✅ | ✅ | 稳定 |
| 元认知/置信度 | ✅ | ✅ | 稳定 |
| Widget渲染 | ✅ | ✅ | 稳定 |
| AutoSkillDiscovery | ✅ 扫agentai-skills/ | ✅ | 稳定 |
| 玄机框架 | — | ✅ 新增 | 新能力 |
| TTS | — | ✅ 新增(有bug) | 新能力 |
| Cleaner | — | ✅ 新增 | 新能力 |
| Sandbox | — | ✅ 新增 | 新能力 |
| MCP Host | — | ✅ 新增 | 新能力 |

**净增5个活跃模块**，但伴随2个安全漏洞 + 1个编译阻断 + 7处死代码。

---

## 十、建议执行顺序

```
立即(今天): P0-①编译修复 → P0-②密钥轮换
本周:      P1-③④⑤⑥
下周:      P2-⑦⑧⑨⑩ 清理
迭代:      P3 半成品决策
```

**一句话结论**：框架骨架依然扎实（20+上下文层/9 provider/元认知/进化记忆全稳定），但5天高速迭代引入了1个编译阻断 + 2个安全漏洞 + 7处死代码。**先止血（编译+密钥），再清创（死代码），后定型（半成品）**。
