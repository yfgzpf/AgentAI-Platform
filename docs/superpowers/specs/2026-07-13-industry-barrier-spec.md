# 行业知识 + GEO + 自动化闭环 — 壁垒建设

> 状态：待用户审阅
> 制定日期：2026-07-13
> 范围：仅在 AgentAI Platform 现有架构内扩展，不引入新包
> 立场：先复用，再补缺口，最后做产品化封装

---

## 1. 背景与问题

之前的方案是脱离项目的"行业白皮书"——大量宏观数据、概念堆砌，但没回答：
- 在 `F:\agentai-platform` 这个具体项目里，这些功能放在哪个文件？
- 怎么和现有的 `industry-engine` / `knowledge-cache` / `governor` / `decision-gate` 串起来？
- 是不是新增包？还是只补文件？

这次重做的核心原则：

1. **不重造轮子**：项目里已经有的（`industry-engine` 6大工作流、`industry-knowledge-base` BM25、`knowledge-cache` SQLite、`governor/runtime-capability-tracker` 能力评分、`llm-router` 多Provider熔断、`cost` 预算控制、`sandbox` 沙箱执行），全部直接复用。
2. **只补缺口**：3个新文件 + 2个增强 + 1个新 SKILL，挂在已有目录树里。
3. **可演示**：不是 PPT，是可在 GUI 里点开就能跑的工作流。

---

## 2. 目标

跑通 **"AI 自动化壁垒"** 的最小闭环：
- 装企用户上传一份 CAD 图纸 / 自然语言需求 → 自动生成报价 + 自动出 GEO 内容 + 自动入知识库
- 跑过的任务被 `knowledge-cache` 记下来，下次直接走缓存（成本 -60%）
- `governor` 持续观察每个模型/技能的实际质量，动态调权重
- `cost` 控制单任务总预算 ¥0.05，超了自动熔断到 fallback

---

## 3. 非目标（明确不做）

- 不重命名现有包（`agentai-gateway` / `agentai-core` 保持）
- 不引入新数据库（用现有 `better-sqlite3` + 已有 `knowledge-cache.jsonl`）
- 不重做行业引擎（`industry-engine.ts` 6 大工作流已覆盖）
- 不做品牌重塑、不上插件市场
- 不做 UI 大改（GUI 侧只加 1 个新页面 + 1 个徽章）

---

## 4. 关键发现：现有能力复用

| 用户提的"壁垒" | 项目里已存在 | 复用方式 |
|---|---|---|
| 知识库 | `industry-knowledge-base.ts` (BM25 本地检索) | 直接喂文档进 `~/.agentai/industry-knowledge/`，AI 自动检索 |
| 知识缓存 | `knowledge-cache.ts` (task→template→result_score) | 跑过的任务自动记入 `~/.agentai/cache/knowledge-cache.jsonl` |
| 行业引擎 | `industry-engine.ts` (6 大工作流 + 9 个行业) | `decoration` 行业已实现报价/材料/CAD 解析 |
| 智能路由 | `llm-router.ts` (4 Provider + 熔断) | 自动选最便宜/最快/最准的 LLM |
| 熔断器 | `governor/runtime-capability-tracker.ts` | 失败率>30% 自动切 Provider |
| 成本控制 | `cost/config.ts` (任务级预算) | 单任务≤¥0.05，超限即熔断 |
| 沙箱执行 | `sandbox/` (Python 容器化) | 跑材料计算器/CAD 解析 |
| 自评 | `judge/self-eval.ts` | 输出质量分 0-1，回流到 knowledge-cache |
| 自创技能 | `auto-skill-creator.ts` | 复杂任务（8+工具调用）自动沉淀为 SKILL.md |
| 决策门 | `decision-gate.ts` | 歧义→澄清 / 低置信→搜索 / 高风险→升级 |

**结论**：你之前想要的 90% 能力**已经在项目里**，只是没有串成"行业壁垒"工作流。这次只补 3 个文件 + 1 个新 SKILL + 2 处增强。

---

## 5. 数据对象（落到 `agentai-gateway`）

### 5.1 `IndustryBarrier`（核心）

```ts
// packages/agentai-gateway/src/industry-barrier.ts (新)
export type BarrierPillar =
  | 'knowledge_base'      // 知识库
  | 'geo_content'         // GEO 内容
  | 'structured_data'     // AI 可读结构化
  | 'auto_pipeline';      // AI 自动化闭环

export interface IndustryBarrier {
  id: string;
  industry: 'decoration' | 'real_estate' | 'ecommerce' | 'education' | 'developer' | 'comic' | 'medical' | 'legal' | 'manufacturing';
  pillar: BarrierPillar;
  title: string;
  /** 触发的用户场景 */
  triggerPatterns: string[];
  /** 实际跑这个 barrier 的累计次数 */
  invocationCount: number;
  /** 累计节省的成本 (USD) */
  savedCostUsd: number;
  /** 累计节省的时间 (秒) */
  savedTimeSec: number;
  /** 知识缓存命中率 */
  cacheHitRate: number;
  createdAt: number;
  lastInvokedAt: number;
}

export interface BarrierRun {
  id: string;
  barrierId: string;
  startedAt: number;
  finishedAt: number;
  /** 来自 decision-gate 的决策 */
  decision: 'continue' | 'ask_user' | 'clarify' | 'web_search';
  /** 来自 self-eval 的质量分 (0-1) */
  qualityScore: number;
  /** 实际花费 (USD) */
  costUsd: number;
  /** 使用的 Provider */
  provider: string;
  /** 使用的子模型 */
  subModel: string;
  /** 是否走缓存 */
  cacheHit: boolean;
  /** 失败原因 (若有) */
  failureReason?: string;
}
```

### 5.2 `GeoContentAsset`（GEO 物料）

```ts
// packages/agentai-gateway/src/geo-content-engine.ts (新)
export type GeoChannel = 'xiaohongshu' | 'douyin' | 'wechat' | 'zhihu' | 'official_site';
export type GeoContentType = 'case_study' | 'guide' | 'faq' | 'comparison' | 'review';

export interface GeoContentAsset {
  id: string;
  industry: string;
  channel: GeoChannel;
  type: GeoContentType;
  title: string;
  body: string;
  /** 关键词 (用于 SEO/GEO 索引) */
  keywords: string[];
  /** 地域词 (北京/朝阳区/望京) */
  regionKeywords: string[];
  /** 关联的真实案例 ID */
  caseId?: string;
  /** 质量分 (来自 self-eval) */
  qualityScore: number;
  /** 发布状态 */
  status: 'draft' | 'published' | 'archived';
  publishedAt?: number;
}
```

### 5.3 `StructuredDataPage`（结构化数据）

```ts
// packages/agentai-gateway/src/structured-data-engine.ts (新)
export interface StructuredDataPage {
  id: string;
  url: string;
  /** Schema.org JSON-LD 内容 */
  jsonLd: object;
  /** FAQ 条目 */
  faqs: Array<{ question: string; answer: string }>;
  /** 评价聚合 */
  reviews: Array<{ source: string; rating: number; text: string }>;
  /** 上游行业 (decoration/real_estate) */
  industry: string;
  lastUpdated: number;
}
```

---

## 6. 三个新文件的设计

### 6.1 `industry-barrier.ts` — 总指挥

**职责**：
1. 暴露 4 个内置 `IndustryBarrier`（kb / geo / structured / auto-pipeline）
2. 提供 `runBarrier(barrierId, args, ctx)` 单一入口
3. 自动串接：`decision-gate` → `industry-knowledge-base`（先检索） → `industry-engine`（行业工作流） → `llm-router`（带 cache 标记） → `cost`（预算检查） → `judge/self-eval`（打分） → `knowledge-cache`（写入） → `governor`（记录能力） → `auto-skill-creator`（8+ 步则沉淀）

**关键代码骨架**（不完整，看 #7 看完整文件）：

```ts
export async function runBarrier(
  barrierId: string,
  args: Record<string, any>,
  ctx: { userId: string; workspace: string; industry: string }
): Promise<BarrierRunResult> {
  const barrier = getBarrier(barrierId);
  const start = Date.now();
  const runId = nanoid();

  // 1. 决策门：歧义→澄清, 低置信→搜索
  const loopState = { userMessage: args.query || args.text || '', history: [], toolCalls: [], iterations: 0 };
  const decision = decisionGate.decide(loopState);
  if (decision.action === 'ask_user' || decision.action === 'clarify') {
    return { runId, decision, output: decision.injectedPrompt || '需要更多信息' };
  }

  // 2. 知识库检索 (BM25, 已有 industry-knowledge-base)
  const kbHits = await searchIndustryKnowledge(ctx.industry, args.query || '', 5);

  // 3. 行业引擎: 选合适的工作流
  const workflow = pickIndustryWorkflow(barrier, args);

  // 4. 知识缓存: 先看 task hash 有没有命中
  const cache = getKnowledgeCache();
  const taskHash = cache.hashTask(args.query || JSON.stringify(args));
  const cached = cache.query(args.query || JSON.stringify(args));
  if (cached.found && cached.entry.avgScore > 0.7) {
    return { runId, output: cached.entry.templateId, cacheHit: true, costUsd: 0 };
  }

  // 5. 成本检查
  const budget = getCostBudget();
  if (!isWithinBudget('treatment', 0)) {
    return { runId, output: '今日预算已用完', decision: { action: 'stop' } };
  }

  // 6. LLM 调用 (走 llm-router, 自动选 Provider + 熔断)
  const result = await callRouter({ ...args, _systemInjection: kbHits.map(h => h.chunk.text).join('\n\n') });

  // 7. 沙箱执行 (如果是材料计算/CAD 解析)
  let sandboxOutput = '';
  if (workflow.requiresSandbox) {
    sandboxOutput = await sandbox.execute({ type: 'python', code: workflow.pythonCode, args });
  }

  // 8. 自评 (self-eval)
  const evalResult = await selfEval({ prompt: args.query, output: result.text });

  // 9. 写缓存
  cache.record({ taskHash, templateId: workflow.id, score: evalResult.score, persona: ctx.industry });

  // 10. 写 governor (能力矩阵)
  runtimeCapabilityTracker.record({ modelId: result.modelId, taskType: 'industry', success: evalResult.passed, score: evalResult.score, latency: result.latency });

  // 11. 写审计
  audit.log({ action: 'barrier.run', barrierId, runId, cost: result.costUsd });

  return { runId, output: result.text, sandboxOutput, decision, qualityScore: evalResult.score, costUsd: result.costUsd, cacheHit: false, latencyMs: Date.now() - start };
}
```

### 6.2 `geo-content-engine.ts` — GEO 内容工厂

**职责**：
1. 监听 `industry-barrier` 的 `decoration` 行业结果
2. 当跑过 `quotation-generator` / `cad-ai-designer` / `material-selector` 等技能 → 自动生成对应 GEO 物料
3. 复用 `image-gen` (Agnes 2.1) 生成封面图
4. 内容进 `~/.agentai/geo-content/{industry}/` 目录
5. 暴露 `getGeoContent(industry, region, type)` 给前端

**触发映射**（这是壁垒核心）：
- `quotation-generator` 跑过 → 自动生成「北京望京120平装修报价案例」内容
- `material-selector` 跑过 → 自动生成「瓷砖品牌横评」内容
- `requirement-interview` 跑过 → 自动生成「装修避坑FAQ」内容
- `construction-supervisor` 跑过 → 自动生成「水电验收 checklist」内容

### 6.3 `structured-data-engine.ts` — AI 可读数据生成

**职责**：
1. 为每个装企生成 `Schema.org` JSON-LD (LocalBusiness, FAQPage, Service)
2. 收集 `knowledge-cache` 里所有 `decoration` 行业的高分 (score>0.8) 任务 → 转 FAQ
3. 暴露 `getStructuredDataPage(industry, slug)` API
4. 写文件到 `~/.agentai/structured-data/{industry}/` 供前端或外网爬取

### 6.4 新 SKILL：`marketing/geo-content-publisher`

位置：`packages/agentai-skills/marketing/geo-content-publisher/`

```yaml
---
name: geo-content-publisher
description: 建材设计行业的 GEO 内容发布器，自动生成小红书/抖音/官网 SEO 物料。
metadata:
  category: marketing
  tags: [geo, seo, content, 小红书, 抖音, 装修]
  triggers:
    - "GEO.*内容"
    - "[Ss]EO.*文章"
    - "小红书.*文案"
    - "抖音.*脚本"
    - "装修避坑"
    - "材料横评"
    - "报价.*案例"
  riskLevel: low
  parallelSafe: true
  requires:
    bins: [python3]
---
```

handler.py 核心：调 `geo-content-engine.ts` 的 HTTP 端点，自动套用不同平台的文案模板。

---

## 7. 三、五、七：已核实的所有 API 签名 (2026-07-13 最终版)

> 本节修正了 spec 第 6 章中所有推测签名为真实 API。在 Sprint 1 开始前请勿信任 #5/#6 的任何函数调用方式。

### 7.A LLM Router (`llm-router.ts`)

```ts
export interface ChatRequest {
  model?: ProviderId;           // 可选指定子模型
  subModel?: string;            // 子模型名
  messages: ChatMessage[];      // [{role:'system'|'user'|'assistant'|'tool', content: string}]
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSpec[];
  userId?: string;
  workspace?: string;
  onDelta?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  thinking?: boolean;
  thinkingBudget?: number;
  contextWindow?: number;
  modelConfig?: { baseURL: string; modelName: string; provider: string };
  abortSignal?: AbortSignal;
}

export interface ChatResponse {
  content: string;             // ✅ 文本内容
  toolCalls?: ToolCall[];
  finishReason?: string;
  iterations?: number;
  usage: {
    promptTokens: number;      // ✅ prompt tokens
    completionTokens: number;  // ✅ completion tokens
    totalTokens: number;
    cost: number;              // ✅ USD cost (不用 costUsd!)
    cacheHit: boolean;
    source: 'api' | 'estimated';
  };
  provider: ProviderId;        // ✅ provider id
  durationMs: number;          // ✅ 用时毫秒 (不用 latencyMs!)
}

export class AgentAIRouter extends EventEmitter {
  async chat(req: ChatRequest): Promise<ChatResponse> { ... }
}
```

**修正前**：`llmResult.costUsd` → **修正后**：`llmResult.usage.cost`
**修正前**：`llmResult.latencyMs` → **修正后**：`llmResult.durationMs`
**修正前**：`llmResult.model` → **修正后**：`llmResult.provider` (无 model 字段)
**调用方式**：`import { AgentAIRouter } from './llm-router'; const r = await new AgentAIRouter().chat(req);`

### 7.B Industry Knowledge Base (`industry-knowledge-base.ts`)

```ts
export interface SearchResult {
  docName: string;
  score: number;
  chunk: KbChunk;   // { text: string, ... }
}

export class IndustryKnowledgeBase {
  search(query: string, industry?: string, topK: number = 5): SearchResult[];
  buildSystemPromptFragment(query: string, industry?: string, maxChunks?: number): string;
}

export function getKnowledgeBase(): IndustryKnowledgeBase;
```

**修正前**：`searchKnowledge(industry, query, 5)` → **修正后**：`getKnowledgeBase().search(query, industry, 5)`
**修正前**：`await` → **修正后**：同步方法，无需 await

### 7.C Knowledge Cache (`knowledge-cache.ts`)

```ts
export class KnowledgeCache {
  query(query: string): CacheQueryResult;      // { found: boolean, entry?: CacheEntry }
  upsert(query: string, templateId: string, score: number, persona: string): CacheEntry;
  recordScore(query: string, score: number): void;
}

export function getKnowledgeCache(): KnowledgeCache;
```

**修正前**：`cache.record({ taskHash, templateId, score, persona })` → **修正后**：`cache.upsert(query, templateId, score, persona)`
**修正前**：`cache.hashTask(query)` → **修正后**：私有方法 `hashTask`，外部不可调用
**修正前**：`cache.query(cacheKey)` → **修正后**：`cache.query(query)` (传入原文，内部自己 hash)

### 7.D Self Eval (`judge/self-eval.ts`)

```ts
export class SelfEvaluator {
  evaluate(query: string, output: string, persona: string, options?: any): ScoreCard;
}

export function quickScore(query: string, output: string, persona: string = 'general'): ScoreCard;

export function scoreCardToLabel(card: ScoreCard): 'good' | 'passable' | 'bad' | 'fail';

export interface ScoreCard {
  totalScore: number;
  subScores: Record<string, number>;
  label: string;
  passed: boolean;
}
```

**修正前**：`selfEval({ prompt, output, industry })` → **修正后**：`quickScore(query, output, persona)`
**参数类型**：三个 `string`，无 `object` 参数
**修正前**：`evalRes.score` → **修正后**：`evalRes.totalScore`
**注意**：`ScoreCard.totalScore` 范围是 0-10 还是 0-1 取决于 JudgeCriteria 配置

### 7.E Audit (`audit.ts`)

```ts
export function log(entry: {
  reqId?: string;
  userId: string;       // ✅ 必填
  workspace: string;    // ✅ 必填
  action: string;       // ✅ 必填
  result: string;       // ✅ 必填 ('ok'|'error'|...)
  detail?: string;
  durationMs?: number;
}): void;
```

**修正前**：`audit.log({ action, runId, barrierId, cost, quality, cacheHit })` → **修正后**：
`audit.log({ userId, workspace, action, result: 'ok', detail: JSON.stringify({ runId, barrierId, cost, quality }) })`

### 7.F Runtime Capability Tracker (`governor/runtime-capability-tracker.ts`)

```ts
export class RuntimeCapabilityTracker extends EventEmitter {
  recordToolResult(modelId: string, taskType: TaskType, _toolName: string, success: boolean, _durationMs: number): void;
  recordLoopCompletion(modelId: string, taskType: TaskType, success: boolean, iterations: number, qualityScore?: number): void;
  recordReflectorDiagnosis(modelId: string, taskType: TaskType, diagnosisType: string): void;
}

export function getTracker(): RuntimeCapabilityTracker;
export type TaskType = 'coding' | 'research' | 'general' | 'industry';
```

**修正前**：`costTracker.record({ modelId, taskType, success, score, latency })` → **修正后**：
`sandbox 不是 Python 执行器！用 python-bridge.callPython(mainPy, args)`

### 7.G Python Bridge (`python-bridge.ts`) — 真正的"Python 执行器"

```ts
export async function callPython(mainPy: string, args: Record<string, any>): Promise<{ success: boolean; output: string; data?: any }>;
```

**修正前**：`sandbox.execute({ type: 'python', code })` → **修正后**：`callPython(mainPyPath, args)`

### 7.H Cost Config (`cost/config.ts`)

```ts
export function getCostBudget(): CostBudget;
export function isWithinBudget(current: number, budget: number, warningThreshold = 0.8): { within: boolean; warning: boolean; };
```

**修正前**：`isWithinBudget('treatment', 0)` → **修正后**：`isWithinBudget(currentTokens, budgetTokens)` (两个 number)
**返回类型**：`{ within: boolean; warning: boolean; }` (不用布尔值直接返回)

### 7.I Sandbox (`sandbox/index.ts`) — 规则检查器，不是执行器

```ts
export class Sandbox {
  start(cfg: SandboxConfig): void;
  close(): void;
  check(req: SandboxCheckRequest): Promise<SandboxCheckResult>;
  getRules(): SandboxRules;
  setRules(rules: SandboxRules): void;
}

export function getGlobalSandbox(): Sandbox | null;
export function initGlobalSandbox(cfg: SandboxConfig = {}): Promise<Sandbox>;
```

### 7.J App Router Pattern (`app.ts`)

```ts
// 所有路由都以 /v1/ 开头
app.get('/v1/workflows/run', ...);
app.post('/v1/workflows/run', ...);
```

**修正前**：`app.get('/api/barriers', ...)` → **修正后**：`app.get('/v1/barriers', ...)`

### 7.K 综合修正后的 runBarrier 伪代码

```ts
import { AgentAIRouter } from './llm-router.js';
import { getKnowledgeBase } from './industry-knowledge-base.js';
import { getKnowledgeCache } from './knowledge-cache.js';
import { getCostBudget, isWithinBudget } from './cost/config.js';
import { quickScore, scoreCardToLabel } from './judge/self-eval.js';
import { getTracker, type TaskType } from './governor/runtime-capability-tracker.js';
import { callPython } from './python-bridge.js';
import { log as auditLog } from './audit.js';
import { initGlobalSandbox, type SandboxConfig } from './sandbox/index.js';

export async function runBarrier(barrierId, args, ctx) {
  const kb = getKnowledgeBase();
  const cache = getKnowledgeCache();
  const tracker = getTracker();
  const router = new AgentAIRouter();

  // 1. 决策门
  const decision = decide({ userMessage: args.query, history: [], toolCalls: [], iterations: 0 });
  if (decision.action === 'ask_user' || decision.action === 'clarify') {
    return { runId, decision, output: decision.injectedPrompt || '需要更多信息。', qualityScore: 0, costUsd: 0, cacheHit: false, latencyMs: Date.now() - start };
  }

  // 2. 缓存查询 (传入原文)
  const cacheKey = JSON.stringify({ barrierId, q: args.query });
  const cached = cache.query(cacheKey);
  if (cached.found && cached.entry.avgScore >= 0.75) {
    return { runId, decision, output: `[CACHE HIT] ${cached.entry.templateId}`, qualityScore: cached.entry.avgScore, costUsd: 0, cacheHit: true, latencyMs: Date.now() - start };
  }

  // 3. 知识库检索 (同步!)
  const kbResults = kb.search(args.query, args.industry, 5);
  const kbContext = kbResults.map(h => `[${h.docName}]\n${h.chunk.text}`).join('\n\n---\n\n');

  // 4. 成本检查 (两 number!)
  const budget = getCostBudget();
  const budgetCheck = isWithinBudget(0, budget.phaseLimits.treatment);
  if (!budgetCheck.within) {
    return { runId, decision, output: '预算已用完。', qualityScore: 0, costUsd: 0, cacheHit: false, latencyMs: Date.now() - start };
  }

  // 5. LLM 调用
  const llmResult = await router.chat({
    messages: [
      { role: 'system', content: `你是${barrier.industry}行业顾问。基于知识库:\n${kbContext}` },
      { role: 'user', content: args.query },
    ],
    maxTokens: 1500,
    userId: ctx.userId,
    workspace: ctx.workspace,
  });

  // 6. 自评 (三个 string!)
  const evalRes = quickScore(args.query, llmResult.content, args.industry);

  // 7. 写缓存 (用 upsert)
  if (evalRes.totalScore >= 4) { // 假设 0-10 分制
    cache.upsert(cacheKey, llmResult.content.slice(0, 200), evalRes.totalScore, args.industry);
  }

  // 8. 写 governor (用 recordLoopCompletion)
  tracker.recordLoopCompletion(llmResult.provider, 'industry' as TaskType, evalRes.passed, 1, evalRes.totalScore / 10);

  // 9. 审计 (必填字段)
  auditLog({ userId: ctx.userId, workspace: ctx.workspace, action: 'barrier.run', result: evalRes.passed ? 'ok' : 'bad', detail: JSON.stringify({ barrierId, cost: llmResult.usage.cost }) });

  return { runId, decision, output: llmResult.content, qualityScore: evalRes.totalScore, costUsd: llmResult.usage.cost, cacheHit: false, latencyMs: Date.now() - start, provider: llmResult.provider };
}
```

### 7.1 `packages/agentai-gateway/src/industry-barrier.ts`

```ts
/**
 * IndustryBarrier — 行业壁垒总指挥
 * =========================================================================
 * 把项目里已存在的模块串成一个"行业壁垒工作流":
 *   decision-gate → industry-knowledge-base → knowledge-cache →
 *   cost → llm-router → sandbox → self-eval → knowledge-cache(写) →
 *   runtime-capability-tracker → audit
 *
 * 这是"AI 自动化壁垒"的核心入口，GUI 侧通过 /api/barriers/* 暴露。
 */

import { nanoid } from 'nanoid';
import { decide, type Decision } from './decision-gate.js';
import { searchKnowledge } from './industry-knowledge-base.js';
import { getKnowledgeCache, type KnowledgeCache } from './knowledge-cache.js';
import { getCostBudget, isWithinBudget } from './cost/config.js';
import { chat as llmChat } from './llm-router.js';
import { getSandbox } from './sandbox/index.js';
import { selfEval } from './judge/self-eval.js';
import { getRuntimeCapabilityTracker } from './governor/runtime-capability-tracker.js';
import { audit } from './audit.js';

// ===== 类型 =====

export type Industry = 'decoration' | 'real_estate' | 'ecommerce' | 'education' | 'developer' | 'comic' | 'medical' | 'legal' | 'manufacturing';
export type BarrierPillar = 'knowledge_base' | 'geo_content' | 'structured_data' | 'auto_pipeline';

export interface IndustryBarrier {
  id: string;
  industry: Industry;
  pillar: BarrierPillar;
  title: string;
  triggerPatterns: string[];
  /** 关联的行业引擎工作流名 (来自 industry-engine.ts) */
  workflowNames: string[];
  /** 是否需要沙箱执行 */
  requiresSandbox: boolean;
}

export interface BarrierRunArgs {
  /** 用户原始输入 */
  query: string;
  /** 行业 */
  industry: Industry;
  /** 装企专属配置 (来自 ~/.agentai/config.yaml) */
  config?: { region?: string; priceTier?: string; brandVoice?: string };
  /** 任意额外参数 */
  [key: string]: any;
}

export interface BarrierRunContext {
  userId: string;
  workspace: string;
}

export interface BarrierRunResult {
  runId: string;
  decision: Decision;
  output: string;
  /** 沙箱执行输出 (如有) */
  sandboxOutput?: string;
  /** 知识库命中 (BM25 top-K 引用) */
  kbCitations?: Array<{ text: string; source: string; score: number }>;
  /** 质量分 (0-1, 来自 self-eval) */
  qualityScore: number;
  costUsd: number;
  cacheHit: boolean;
  latencyMs: number;
  error?: string;
}

// ===== 内置 4 大壁垒 =====

const BUILTIN_BARRIERS: Record<string, IndustryBarrier> = {
  'decoration.kb': {
    id: 'decoration.kb',
    industry: 'decoration',
    pillar: 'knowledge_base',
    title: '装修知识库问答 (基于本地 BM25)',
    triggerPatterns: ['瓷砖怎么选', '地板推荐', '乳胶漆品牌', '美缝价格', '装修报价', '板材环保'],
    workflowNames: ['query_materials_library', 'measure_materials'],
    requiresSandbox: false,
  },
  'decoration.geo': {
    id: 'decoration.geo',
    industry: 'decoration',
    pillar: 'geo_content',
    title: '装修 GEO 内容自动生成 (小红书/抖音/官网)',
    triggerPatterns: ['写一篇装修避坑', '发一条小红书', '抖音脚本', 'SEO 文章', '案例文案'],
    workflowNames: ['generate_property_desc'],
    requiresSandbox: false,
  },
  'decoration.struct': {
    id: 'decoration.struct',
    industry: 'decoration',
    pillar: 'structured_data',
    title: '结构化数据生成 (Schema.org + FAQ)',
    triggerPatterns: ['生成 Schema', 'FAQ 整理', 'AI 可读数据'],
    workflowNames: [],
    requiresSandbox: false,
  },
  'decoration.auto': {
    id: 'decoration.auto',
    industry: 'decoration',
    pillar: 'auto_pipeline',
    title: '端到端自动化 (CAD 解析→报价→材料→GEO 物料)',
    triggerPatterns: ['从图纸到报价', '全流程自动化', '跑一遍完整壁垒'],
    workflowNames: ['recognize_blueprint', 'parse_requirement', 'generate_quotation', 'measure_materials'],
    requiresSandbox: true,
  },
};

// ===== 主入口 =====

export async function runBarrier(
  barrierId: string,
  args: BarrierRunArgs,
  ctx: BarrierRunContext
): Promise<BarrierRunResult> {
  const barrier = BUILTIN_BARRIERS[barrierId];
  if (!barrier) throw new Error(`Unknown barrier: ${barrierId}`);

  const runId = `barrier-${nanoid(10)}`;
  const start = Date.now();
  const cache: KnowledgeCache = getKnowledgeCache();
  const costTracker = getRuntimeCapabilityTracker();

  // 1. 决策门
  const decision = decide({
    userMessage: args.query,
    history: [],
    toolCalls: [],
    iterations: 0,
  });

  if (decision.action === 'ask_user' || decision.action === 'clarify') {
    return {
      runId,
      decision,
      output: decision.injectedPrompt || '需要更多信息才能继续。',
      qualityScore: 0,
      costUsd: 0,
      cacheHit: false,
      latencyMs: Date.now() - start,
    };
  }

  // 2. 知识缓存命中
  const cacheKey = JSON.stringify({ barrierId, q: args.query, cfg: args.config });
  const cached = cache.query(cacheKey);
  if (cached.found && cached.entry.avgScore >= 0.75) {
    return {
      runId,
      decision,
      output: `[CACHE HIT] ${cached.entry.templateId}\n\n${cached.entry.templateId}`,
      qualityScore: cached.entry.avgScore,
      costUsd: 0,
      cacheHit: true,
      latencyMs: Date.now() - start,
    };
  }

  // 3. 知识库检索 (BM25)
  const kbHits = await searchKnowledge(args.industry, args.query, 5);
  const kbContext = kbHits.map((h) => `[知识库:${h.docName}]\n${h.chunk.text}`).join('\n\n---\n\n');

  // 4. 成本预算检查
  if (!isWithinBudget('treatment', 0)) {
    return {
      runId,
      decision: { ...decision, action: 'stop' },
      output: '今日 LLM 预算已用完。明天再试，或调整预算 (config.yaml → cost.dailyLimit)。',
      qualityScore: 0,
      costUsd: 0,
      cacheHit: false,
      latencyMs: Date.now() - start,
    };
  }

  // 5. LLM 调用 (router 自动选 Provider + 熔断)
  let llmResult;
  try {
    llmResult = await llmChat({
      messages: [
        {
          role: 'system',
          content: `你是 ${barrier.industry} 行业的资深顾问。回答必须基于以下知识库:\n\n${kbContext || '(空)'}\n\n行业: ${barrier.industry}\n地域: ${args.config?.region || '未知'}\n价格档: ${args.config?.priceTier || '中档'}\n品牌口吻: ${args.config?.brandVoice || '专业可信'}`,
        },
        { role: 'user', content: args.query },
      ],
      userId: ctx.userId,
      workspace: ctx.workspace,
      maxTokens: 1500,
    });
  } catch (err: any) {
    audit.log({ action: 'barrier.llm_fail', runId, error: String(err) });
    return {
      runId,
      decision,
      output: `LLM 调用失败: ${err.message}`,
      qualityScore: 0,
      costUsd: 0,
      cacheHit: false,
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }

  // 6. 沙箱执行 (材料计算/CAD 解析)
  let sandboxOutput: string | undefined;
  if (barrier.requiresSandbox) {
    const sb = getSandbox();
    const r = await sb.execute({
      type: 'python',
      code: `import json; args = json.loads('''${JSON.stringify(args)}'''); print(json.dumps({"hint":"用 ezdxf 解析 + 报价计算"}, ensure_ascii=False))`,
    });
    sandboxOutput = r.stdout;
  }

  // 7. 自评
  const evalRes = await selfEval({
    prompt: args.query,
    output: llmResult.content,
    industry: args.industry,
  });

  // 8. 写缓存 (仅当质量分高)
  if (evalRes.score >= 0.65) {
    cache.record({
      taskHash: cache.hashTask(cacheKey),
      templateId: llmResult.content.slice(0, 200),
      score: evalRes.score,
      persona: args.industry,
    });
  }

  // 9. 写能力矩阵
  costTracker.record({
    modelId: `${llmResult.provider}:${llmResult.model}`,
    taskType: 'industry',
    success: evalRes.passed,
    score: evalRes.score,
    latency: llmResult.latencyMs,
  });

  // 10. 审计
  audit.log({
    action: 'barrier.run',
    runId,
    barrierId,
    industry: args.industry,
    cost: llmResult.costUsd,
    quality: evalRes.score,
    cacheHit: false,
  });

  return {
    runId,
    decision,
    output: llmResult.content,
    sandboxOutput,
    kbCitations: kbHits.map((h) => ({ text: h.chunk.text.slice(0, 200), source: h.docName, score: h.score })),
    qualityScore: evalRes.score,
    costUsd: llmResult.costUsd,
    cacheHit: false,
    latencyMs: Date.now() - start,
  };
}

// ===== 列出所有可用壁垒 =====
export function listBarriers(industry?: Industry): IndustryBarrier[] {
  return Object.values(BUILTIN_BARRIERS).filter((b) => !industry || b.industry === industry);
}

// ===== GUI 路由 (挂到 app.ts) =====
export function registerBarrierRoutes(app: any): void {
  app.get('/api/barriers', (req: any, res: any) => {
    res.json({ barriers: listBarriers(req.query.industry as Industry) });
  });

  app.post('/api/barriers/:id/run', async (req: any, res: any) => {
    try {
      const result = await runBarrier(
        req.params.id,
        { ...req.body, industry: req.body.industry || 'decoration' },
        { userId: req.headers['x-user-id'] || 'anonymous', workspace: req.headers['x-workspace'] || 'default' }
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
```

### 7.2 `packages/agentai-gateway/src/geo-content-engine.ts`

```ts
/**
 * GeoContentEngine — GEO 内容工厂
 * =========================================================================
 * 监听 industry-barrier 的结果，自动生成 SEO/GEO 友好的内容物料。
 *
 * 输出:
 *   - 小红书/抖音/知乎文案
 *   - 官网 SEO 案例文
 *   - FAQ 文 (供 Schema.org 引用)
 *
 * 存储: ~/.agentai/geo-content/{industry}/{channel}/{slug}.md
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { nanoid } from 'nanoid';
import { chat as llmChat } from './llm-router.js';

const GEO_DIR = path.join(os.homedir(), '.agentai', 'geo-content');

export type GeoChannel = 'xiaohongshu' | 'douyin' | 'wechat' | 'zhihu' | 'official_site';
export type GeoContentType = 'case_study' | 'guide' | 'faq' | 'comparison' | 'review';

export interface GeoContentAsset {
  id: string;
  industry: string;
  channel: GeoChannel;
  type: GeoContentType;
  title: string;
  body: string;
  keywords: string[];
  regionKeywords: string[];
  qualityScore: number;
  status: 'draft' | 'published' | 'archived';
  createdAt: number;
  publishedAt?: number;
}

const CHANNEL_TEMPLATES: Record<GeoChannel, { emojiLimit: number; lengthMax: number; format: string }> = {
  xiaohongshu: { emojiLimit: 8, lengthMax: 800, format: '标题党 + 痛点 + emoji + 步骤 + 标签' },
  douyin: { emojiLimit: 3, lengthMax: 500, format: '前3秒钩子 + 干货 + 互动引导' },
  wechat: { emojiLimit: 0, lengthMax: 3000, format: '标题 + 摘要 + 正文 (含小标题/图片位)' },
  zhihu: { emojiLimit: 0, lengthMax: 5000, format: '专业回答 + 引用 + 案例' },
  official_site: { emojiLimit: 0, lengthMax: 2000, format: 'SEO 标题 + Meta + H2/H3 结构 + FAQ' },
};

export interface GenerateGeoParams {
  industry: string;
  channel: GeoChannel;
  type: GeoContentType;
  /** 主题 (例如 "北京望京120平装修报价") */
  topic: string;
  /** 关键数据 (从真实 case 提取) */
  facts?: string[];
  regionKeywords?: string[];
  priceTier?: string;
}

/** 生成 GEO 内容 (走 LLM，模板驱动) */
export async function generateGeoContent(p: GenerateGeoParams): Promise<GeoContentAsset> {
  const tmpl = CHANNEL_TEMPLATES[p.channel];
  const sysPrompt = `你是 ${p.industry} 行业 GEO 内容专家。目标: 让 AI 搜索引擎 (豆包/DeepSeek/文心) 在回答相关问题时优先引用本内容。
平台: ${p.channel}
格式: ${tmpl.format}
字数: ≤${tmpl.lengthMax}
emoji: ≤${tmpl.emojiLimit}
行业: ${p.industry}
价格档: ${p.priceTier || '中档'}
地域关键词: ${(p.regionKeywords || []).join(', ')}`;

  const userPrompt = `主题: ${p.topic}

${p.facts?.length ? `真实数据:\n${p.facts.map((f) => '- ' + f).join('\n')}` : ''}

要求:
1. 必须包含地域关键词 (用于本地 SEO)
2. 引用真实数据，不要编造
3. 结尾引导: 留 1 个互动问题 (评论/私信/收藏)
4. 输出纯文本，不要 Markdown 标题前缀`;

  const r = await llmChat({
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: Math.ceil(tmpl.lengthMax * 1.5),
  });

  // 提取关键词 (从生成内容中)
  const keywords = extractKeywords(r.content, p.topic);

  const asset: GeoContentAsset = {
    id: `geo-${nanoid(8)}`,
    industry: p.industry,
    channel: p.channel,
    type: p.type,
    title: extractTitle(r.content) || p.topic,
    body: r.content,
    keywords,
    regionKeywords: p.regionKeywords || [],
    qualityScore: 0,
    status: 'draft',
    createdAt: Date.now(),
  };

  // 持久化
  saveGeoAsset(asset);
  return asset;
}

function extractTitle(text: string): string | null {
  const m = text.match(/^(.{5,40}?)[。\n!]/);
  return m ? m[1] : null;
}

function extractKeywords(text: string, seed: string): string[] {
  const kws = new Set<string>();
  // 1. 主题本身
  seed.split(/\s+/).forEach((s) => s.length > 1 && kws.add(s));
  // 2. 文本里出现 2+ 次的 2-6 字词
  const words = text.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  const freq: Record<string, number> = {};
  words.forEach((w) => (freq[w] = (freq[w] || 0) + 1));
  Object.entries(freq)
    .filter(([_, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([w]) => kws.add(w));
  return Array.from(kws).slice(0, 15);
}

function saveGeoAsset(a: GeoContentAsset): void {
  const dir = path.join(GEO_DIR, a.industry, a.channel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${a.id}.json`), JSON.stringify(a, null, 2), 'utf-8');
  fs.writeFileSync(path.join(dir, `${a.id}.md`), matterify(a), 'utf-8');
}

function matterify(a: GeoContentAsset): string {
  return `---
id: ${a.id}
industry: ${a.industry}
channel: ${a.channel}
type: ${a.type}
keywords: ${a.keywords.join(', ')}
region: ${a.regionKeywords.join(', ')}
created: ${new Date(a.createdAt).toISOString()}
---

# ${a.title}

${a.body}
`;
}

/** 列出某行业已生成的 GEO 物料 */
export function listGeoContent(industry: string, channel?: GeoChannel): GeoContentAsset[] {
  const dir = path.join(GEO_DIR, industry, channel || '');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
}

/** 统计 */
export function geoStats(industry: string): { total: number; byChannel: Record<string, number>; byType: Record<string, number> } {
  const assets = listGeoContent(industry);
  const byChannel: Record<string, number> = {};
  const byType: Record<string, number> = {};
  assets.forEach((a) => {
    byChannel[a.channel] = (byChannel[a.channel] || 0) + 1;
    byType[a.type] = (byType[a.type] || 0) + 1;
  });
  return { total: assets.length, byChannel, byType };
}
```

### 7.3 `packages/agentai-gateway/src/structured-data-engine.ts`

```ts
/**
 * StructuredDataEngine — AI 可读结构化数据生成器
 * =========================================================================
 * 为行业生成 Schema.org JSON-LD + FAQ 库 + 评价聚合。
 *
 * 存储: ~/.agentai/structured-data/{industry}/{slug}.json
 * 用途: 让 AI 搜索引擎 (豆包/DeepSeek) 抓取时能直接抽取结构化信号。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { nanoid } from 'nanoid';
import { chat as llmChat } from './llm-router.js';
import { listGeoContent } from './geo-content-engine.js';

const SD_DIR = path.join(os.homedir(), '.agentai', 'structured-data');

export interface StructuredDataPage {
  id: string;
  url: string;
  industry: string;
  jsonLd: object;
  faqs: Array<{ question: string; answer: string }>;
  reviews: Array<{ source: string; rating: number; text: string }>;
  lastUpdated: number;
}

export interface BuildStructuredParams {
  industry: string;
  /** 装企基础信息 */
  business: {
    name: string;
    address: string;
    region: string;
    phone?: string;
    rating?: number;
    reviewCount?: number;
    priceRange?: string;
  };
  /** FAQ 主题 (例如 "老房翻新") */
  faqTopics?: string[];
}

/** 构建一个装企的结构化数据页 */
export async function buildStructuredPage(p: BuildStructuredParams): Promise<StructuredDataPage> {
  // 1. 从 GEO 物料里抽取高质量 FAQ (score>=0.8)
  const geoAssets = listGeoContent(p.industry).filter((a) => a.qualityScore >= 0.8);

  // 2. LLM 生成 FAQ
  const faqTopics = p.faqTopics || [`${p.industry} 多少钱`, `${p.industry} 怎么选`, `${p.industry} 避坑要点`];
  const faqRes = await llmChat({
    messages: [
      {
        role: 'system',
        content: `你是 SEO 专家。为 "${p.business.name}" (${p.business.region}) 生成 10 条本地化 FAQ，每条 1-2 句话回答。
输出 JSON 数组: [{"q":"...","a":"..."}].
问题必须包含地域词 (${p.business.region})，体现本地化。
话题: ${faqTopics.join(' / ')}`,
      },
      { role: 'user', content: '请生成 10 条 FAQ (JSON 数组格式)' },
    ],
    maxTokens: 1500,
  });

  let faqs: Array<{ question: string; answer: string }> = [];
  try {
    const m = faqRes.content.match(/\[[\s\S]*\]/);
    if (m) faqs = JSON.parse(m[0]);
  } catch {
    /* fallback empty */
  }

  // 3. Schema.org JSON-LD (LocalBusiness + FAQPage)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'HomeAndConstructionBusiness',
        '@id': p.business.name,
        name: p.business.name,
        address: {
          '@type': 'PostalAddress',
          streetAddress: p.business.address,
          addressLocality: p.business.region,
        },
        telephone: p.business.phone,
        priceRange: p.business.priceRange || '￥￥',
        aggregateRating: p.business.rating
          ? { '@type': 'AggregateRating', ratingValue: p.business.rating, reviewCount: p.business.reviewCount || 0 }
          : undefined,
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: { '@type': 'Answer', text: f.answer },
        })),
      },
    ],
  };

  const page: StructuredDataPage = {
    id: `sd-${nanoid(8)}`,
    url: `/${p.industry}/${encodeURIComponent(p.business.name)}`,
    industry: p.industry,
    jsonLd,
    faqs,
    reviews: [],
    lastUpdated: Date.now(),
  };

  saveStructuredPage(page);
  return page;
}

function saveStructuredPage(p: StructuredDataPage): void {
  const dir = path.join(SD_DIR, p.industry);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${p.id}.json`), JSON.stringify(p, null, 2), 'utf-8');
}

export function listStructuredPages(industry: string): StructuredDataPage[] {
  const dir = path.join(SD_DIR, industry);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
}
```

### 7.4 新 SKILL: `packages/agentai-skills/marketing/geo-content-publisher/`

```yaml
---
name: geo-content-publisher
description: 建材设计行业的 GEO 内容发布器。自动生成小红书/抖音/官网 SEO 物料，并按真实数据填充。
description_zh: "装修建材 GEO 内容生成器，对接 agentai-gateway 的 geo-content-engine"
description_en: "GEO content publisher for decoration industry"
version: 1.0.0
metadata:
  category: marketing
  tags: [geo, seo, content, 小红书, 抖音, 装修, decoration]
  author: AgentAI Team
  requires:
    bins: [python3, curl]
  parallelSafe: true
  riskLevel: low
  triggers:
    - "GEO.*内容"
    - "[Ss]EO.*文章"
    - "小红书.*文案"
    - "抖音.*脚本"
    - "装修避坑"
    - "材料横评"
    - "报价.*案例"
    - "发一条"
---
```

`handler.py`:

```python
"""geo-content-publisher handler"""
import json
import urllib.request
import sys
from pathlib import Path

GATEWAY = "http://localhost:18789"

def call_gateway(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{GATEWAY}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else "装修避坑"
    channel = sys.argv[2] if len(sys.argv) > 2 else "xiaohongshu"
    industry = sys.argv[3] if len(sys.argv) > 3 else "decoration"

    r = call_gateway("/api/geo/generate", {
        "industry": industry,
        "channel": channel,
        "type": "case_study",
        "topic": topic,
        "regionKeywords": ["北京", "望京"],
    })
    print(json.dumps(r, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
```

---

## 8. GUI 端增强 (2 处)

### 8.1 新增页面：`packages/gui/src/pages/Barriers.tsx`

显示 4 大壁垒卡片 + 跑过的历史 + 成本节省统计。每个卡片可点 → 弹窗 → 跑 barrier → 实时显示结果 (从 SSE 订阅)。

### 8.2 增强 `App.tsx` 路由

在路由表加 `/barriers`，导航栏加入口。

---

## 9. 落地步骤 (5 个 sprint，每个 1 天)

| Sprint | 任务 | 验收 |
|---|---|---|
| **1** | 新建 `industry-barrier.ts` + 路由 | `curl /api/barriers` 返回 4 个，POST 任一能返回内容 |
| **2** | 新建 `geo-content-engine.ts` + 新 SKILL | `python handler.py "北京望京120平装修"` 生成小红书文案 |
| **3** | 新建 `structured-data-engine.ts` | `buildStructuredPage()` 返回有效 JSON-LD，FAQ ≥5 条 |
| **4** | GUI: 新增 `/barriers` 页面 + 路由 + 徽章 | 打开页面能跑 barrier，实时显示 quality/cost/cacheHit |
| **5** | 端到端跑通 (CAD→报价→GEO→结构化) | 一个完整 E2E 截图，4 大模块全部触发 |

---

## 10. 复用 vs 新增对照

| 模块 | 新建/复用 | 文件 |
|---|---|---|
| 决策门 | 复用 | `decision-gate.ts` |
| 知识库 BM25 | 复用 | `industry-knowledge-base.ts` |
| 知识缓存 SQLite | 复用 | `knowledge-cache.ts` |
| 成本控制 | 复用 | `cost/config.ts` |
| LLM 路由 | 复用 | `llm-router.ts` |
| 沙箱执行 | 复用 | `sandbox/index.ts` |
| 自评 | 复用 | `judge/self-eval.ts` |
| 能力矩阵 | 复用 | `governor/runtime-capability-tracker.ts` |
| 审计 | 复用 | `audit.ts` |
| 行业引擎 | 复用 | `industry-engine.ts` (6 大工作流) |
| **壁垒总指挥** | **新建** | `industry-barrier.ts` |
| **GEO 内容** | **新建** | `geo-content-engine.ts` |
| **结构化数据** | **新建** | `structured-data-engine.ts` |
| **GEO 发布 SKILL** | **新建** | `agentai-skills/marketing/geo-content-publisher/` |
| **GUI 页面** | **新建** | `packages/gui/src/pages/Barriers.tsx` |

新增总计：**3 个 TS + 1 个 SKILL + 1 个页面**，零新依赖。

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| 知识库空 → 检索无结果 | 启动时自动扫描 `packages/agentai-skills/{industry}/SKILL.md` 灌入 |
| 缓存污染 (低质量答案被缓存) | `cache.record()` 前先过 `selfEval.score >= 0.65` |
| LLM 成本失控 | `cost/config.ts` 任务预算 0.05 USD，每日 5w tokens 限额 |
| GEO 内容被 AI 平台识别为机器生成 | 强制注入真实 facts (从 case 库提取)，`self-eval` 验可读性 |
| 用户上传违规文档 | 复用 `sanitize.ts` + `audit-rate-limit.ts` |
| 9 个行业的壁垒工作流不一致 | `BUILTIN_BARRIERS` 用 `industry: 'decoration'` 起步，验证后再扩 |

---

## 12. 与上次方案的关键差异

| 维度 | 上次 (脱离项目) | 这次 (项目内) |
|---|---|---|
| 落地形态 | 行业白皮书 + HTML 演示 | 5 个 Sprint × 1 天 = 5 天可交付 |
| 新增包 | 0 (纯文档) | 3 个 TS + 1 SKILL + 1 页面 |
| 新增依赖 | 0 | 0 (用现有 nanoid) |
| 与现有架构关系 | 完全脱节 | 串接 8 个已有模块 |
| 可验证性 | 看演示页 | 跑 `curl /api/barriers/decoration.auto/run` 即可 |
| 行业范围 | 只讲装修 | 9 个行业通用框架，装修做 demo |
| 成本控制 | 没提 | 复用 `cost/config.ts`，单任务 ≤0.05 USD |
| 自我进化 | 没提 | 复用 `governor` + `auto-skill-creator`，跑 8+ 步自动沉淀新 SKILL |
