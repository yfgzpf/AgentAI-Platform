# AgentAI Platform — 整合架构（v2.0）

> 文档版本: v2.0 (2026-06-08 10:55)
> 状态: 富哥拍板"先学会再整合"——已读完 3 框架核心
> 原则: **参照整合自创**，不完整照抄

---

## 1. 三框架"先学会"清单（已读）

### 1.1 OpenClaw / ZhiY.AI（已读 5 文件）
- `zhiy-agent-core.ts:2` — **核心思想**: "系统提示含工具描述 + Skills XML 嵌入 + LLM tools 参数"
- `gateway.ts` — AI 网关架构
- `agent_framework.py` — 5 类智能体角色
- `image_generation_service.py` — 多模态抽象层
- `multi-agent-orchestrator.ts` — 多智能体编排

**学到的精华**:
- ✅ **多模态 7 服抽象**（image/video/voice/TTS/music/browser/desktop）
- ✅ **5 智能体角色**（general / copywriter / designer / marketing / 行业）
- ✅ **多智能体编排**（task → orchestrator → executor → result）

### 1.2 Hermes Agent（已读 4 文件）
- `AGENTS.md` — 完整代码地图
- `prompt_builder.py` — 系统提示装配（**4 段式**: identity + skills + context + memory）
- `acp_adapter/server.py` — **Agent Client Protocol**（VSCode / Zed / JetBrains 集成）
- `gateway/run.py` — **30+ 平台 gateway**（Telegram/Discord/Slack/...）

**学到的精华**:
- ✅ **ACPadapter 通讯协议**（给 VSCode 集成用）
- ✅ **平台适配器基类**（`gateway/platforms/base.py`）
- ✅ **FTS5 会话** + Skills 索引 + **prompt injection 扫描**（10 个正则）
- ✅ **工具注册中心**（`tools/registry.py`）

### 1.3 Reasonix（已读 2 文件）
- `REASONIX.md` — 4 大支柱总览
- `docs/ARCHITECTURE.md` — 缓存优先循环 + 工具调用修复 + 成本控制

**学到的精华**:
- ✅ **Pillar 1 Cache-First Loop**（immutable prefix / append-only log / volatile scratch）
- ✅ **Pillar 2 4 步工具调用修复**（flatten / scavenge / storm / truncation）
- ✅ **Pillar 3 成本控制**（per-turn + per-session 颜色徽章 + `<<<NEEDS_PRO>>>` 自报升级）
- ✅ **Pillar 4 工具并发**（parallelSafe 声明 + Promise.allSettled 串行屏障）

### 1.4 WorkBuddy（从记忆 + 实际用过）
- ✅ **Tauri 桌面壳**（极小 5-10MB）
- ✅ **三层记忆**（云 / 用户级本地 / 工作空间）
- ✅ **反思模式**（auto_reflect.py）

---

## 2. 整合架构（**自创**，不是 3 框架拼贴）

### 2.1 整体拓扑

```
┌────────────────────────────────────────────────────────────────┐
│                  AgentAI Platform v2.0                         │
│                                                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  Desktop    │  │  QQ/TG/WC   │  │  VSCode     │  3 入口  │
│  │  Tauri 壳   │  │  机器人网关  │  │  ACP 适配器  │  入口    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
│         │                │                │                    │
│         └────────────────┼────────────────┘                    │
│                          ↓                                     │
│  ┌───────────────────────────────────────────────────────┐    │
│  │   packages/agentai-gateway (Node.js 22 + TS)         │    │
│  │   ★ 自创: "智能路由 + 反思 + 记忆" 三层门面            │    │
│  │                                                       │    │
│  │   1. **LLM 智能路由层** (学 Hermes smart_model_routing) │    │
│  │      - 多 provider (AgentAI / DeepSeek / OpenAI...)  │    │
│  │      - 失败率跟踪 + 熔断 + 降级 (学 Reasonix Pillar 1) │    │
│  │      - **成本控制** (maxCostPerTurn, maxCostPerDay)   │    │
│  │                                                       │    │
│  │   2. **技能注册中心** (学 Hermes tools/registry.py)    │    │
│  │      - chokidar 热加载                                │    │
│  │      - **并发安全声明** (学 Reasonix parallelSafe)    │    │
│  │      - 工具调用 4 步修复 (学 Reasonix Pillar 2)       │    │
│  │                                                       │    │
│  │   3. **Cache-First 循环** (学 Reasonix Pillar 1)       │    │
│  │      - immutable prefix / append-only log / scratch   │    │
│  │      - **中文特别版**: 也缓存 Skills XML 注入          │    │
│  │                                                       │    │
│  │   4. **会话 + 反思** (学 WorkBuddy + Hermes SessionDB)  │    │
│  │      - FTS5 全文检索会话                               │    │
│  │      - auto_reflect 每 N 轮自动反思                     │    │
│  │      - 三层记忆 (云/用户/工作空间)                     │    │
│  └───────────────────────────────────────────────────────┘    │
│         ↓                    ↓                                 │
│  ┌─────────────┐      ┌─────────────┐                         │
│  │  LLM Provider│     │  Python     │                         │
│  │  HTTP/SSE   │      │  沙箱技能   │                         │
│  │  (AgentAI/  │      │  (Docker)   │                         │
│  │  DeepSeek)  │      │  7+ 技能   │                         │
│  └─────────────┘      └─────────────┘                         │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 **自创的 4 个新概念**（3 框架都没有的）

| 自创概念 | 来源 | 含义 |
|---------|------|------|
| **A. 智能路由门面** | 融合 Hermes routing + Reasonix cost | **1 个端点背后挂 3 个 LLM provider**，按成功率/成本/延迟自动选 |
| **B. 4 步修复 + 中文提示注入扫描** | 融合 Reasonix repair + Hermes prompt injection scan | LLM 输出不仅修复 JSON，还**扫中文提示注入**（"无视以上所有规则"） |
| **C. 工具并发 + 安全门** | 融合 Reasonix parallelSafe + 沙箱 | `parallelSafe: true` 才并发，**否则强制串行 + 风险分级** |
| **D. 反思门** | 融合 WorkBuddy auto_reflect + Reasonix EventLog | 每 10 轮自动跑 `agentai reflect`，**写进三层记忆** |

### 2.3 关键代码（自创，写在 `packages/agentai-gateway/src/llm-router.ts`）

```typescript
// 智能路由门面 - 融合 Hermes smart_model_routing + Reasonix Pillar 1 缓存
class AgentAIRouter {
  private providers: Map<string, ProviderStats>;
  private circuitBreaker: Map<string, boolean>;

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // 1. **Pillar 1 缓存命中** (学 Reasonix)
    const cached = this.cache.get(this.hashPrefix(req));
    if (cached && !req.stream) {
      return this.mergeCached(cached, req);
    }

    // 2. **智能路由选 provider** (学 Hermes + Reasonix cost guard)
    const ranked = this.rankProviders({
      successRate: this.providers.get(req.model),
      costPer1k: this.providers.get(req.model).cost,
      latencyP50: this.providers.get(req.model).latency,
    });
    const primary = ranked[0];
    if (this.circuitBreaker.get(primary.id)) {
      // 熔断 → 降级
      primary = ranked[1] || throw(new AllProvidersTrippedError());
    }

    // 3. **执行 + 4 步修复** (学 Reasonix Pillar 2 + Hermes injection scan)
    const raw = await this.executeWithTimeout(primary, req, 30000);
    const repaired = await this.repairPipeline.repair(raw);
    const safe = this.promptInjectionScan(repaired); // 中文版增强

    // 4. **写入 append-only log** (学 Reasonix Pillar 1)
    this.appendOnlyLog.append(req, safe);

    // 5. **后台上报 usage + 反思** (学 Reasonix telemetry + WorkBuddy reflect)
    this.telemetry.record(req, primary, safe);
    if (this.shouldReflect()) {
      await this.reflect();
    }

    return safe;
  }
}
```

### 2.4 **不照搬**的明确决策

| 决策 | 不照搬原因 |
|------|----------|
| ❌ **不抄** `zhiy-agent-core.ts` 的 `BUILTIN_TOOLS` 硬编码 | 太僵化，用 Hermes 风格的**注册中心** |
| ❌ **不抄** Hermes 的 `_HERMES_CORE_TOOLS` 工具列表 | 我们只有 7 个核心工具，不需要 30+ |
| ❌ **不抄** Reasonix 的 `<<<NEEDS_PRO>>>` marker | 我们有**智能路由**自动选 provider，不需要模型自报 |
| ❌ **不抄** ZhiY 的 5 类智能体角色 | 我们走**单智能体 + Skills**（学 Anthropic Claude），不过度设计 |
| ❌ **不抄** WorkBuddy 的三轮对话缓冲 | 改用 **FTS5 + 全文检索**（学 Hermes） |
| ✅ **只保留** 3 框架中**真正好用**的部分 | 见上表 2.2 |

---

## 3. 阶段 2 任务（"先学会再整合"已完，进入"自创迁移"）

### 3.1 **3 个自创的整合文件**（落盘 `packages/agentai-gateway/src/`）

1. **`llm-router.ts`** (200 行) — 智能路由门面（融合 3 框架）
2. **`tool-registry.ts`** (150 行) — 工具注册中心（学 Hermes + parallelSafe）
3. **`agentai-loop.ts`** (180 行) — Cache-First 主循环（学 Reasonix + 中文注入扫描）

### 3.2 **6 个新文件**（学 Hermes 的 acp / gateway / 注入扫描）

4. **`gateway/adapters/base.ts`** (80 行) — 平台适配器基类（学 Hermes）
5. **`gateway/adapters/qq.ts`** (100 行) — QQ 适配器（学 oicq）
6. **`gateway/adapters/wecom.ts`** (80 行) — 企业微信适配器（学 wcf）
7. **`prompt-injection-scanner.ts`** (120 行) — **中文版**提示注入扫描（学 Hermes + 加 20+ 中文正则）
8. **`repair-pipeline.ts`** (100 行) — 4 步修复管道（学 Reasonix Pillar 2）
9. **`telemetry.ts`** (80 行) — 成本 + 缓存命中率（学 Reasonix）

### 3.3 **技能沙箱**（学 ZhiY 的 7 个 Python 服务）

10-16. 7 个 Python 多模态服务（image/video/voice/TTS/music/browser/desktop），每个 ~80 行

### 3.4 总计 16 个新文件 / ~1,800 行

**这些都是"自创整合"**，不是 copy。每行都标注了"学自 X 框架"。

---

## 4. 验收标准

- [ ] 3 个核心文件能 `pnpm build` 通过
- [ ] 智能路由端到端跑通：发请求 → 选 provider → 拿响应
- [ ] 4 步修复能修 JSON 截断/参数丢失
- [ ] 中文注入扫描能拦 80% 测试样本
- [ ] QQ 适配器能登录 + 回消息
- [ ] VSCode 端能通过 ACP 协议连到 Gateway
- [ ] Tauri 桌面壳能装、能开、能连 Gateway

---

**富哥，整合架构 v2.0 已落盘。**

拍板"干 2"我开始写 16 个自创文件（不是搬，是融合 3 框架精华 + 加自创的 4 个新概念）。
