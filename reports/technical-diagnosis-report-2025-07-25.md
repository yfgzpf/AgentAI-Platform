# AgentAI Platform 技术诊断报告

**报告日期**: 2026-07-25  
**诊断范围**: LLM权限配置、工具链支持、工作流衔接机制  
**严重等级**: 🔴 高危（3个关键功能缺陷）

---

## 📋 执行摘要

AgentAI Platform 当前存在 **三个系统性功能缺陷**，导致系统仅能完成审查分析而无法执行实质性修复操作：

| # | 问题 | 严重度 | 根因位置 | 状态 |
|---|------|--------|----------|------|
| P1 | 循环执行"继续审查"/"读取历史"无法进入修复状态 | 🔴 致命 | `agentai-loop.ts:1882-3449` | 需修复 |
| P2 | 模型选择器下拉不响应交互 | 🟠 严重 | `Composer.tsx:713-720` + `ModelSelector.tsx:278-309` | 需修复 |
| P3 | 提示词优化未接入免费模型 | 🟠 严重 | `PromptOptimizer.tsx:56` + `backend.py:1021-1039` | 需修复 |

---

## 一、P1：循环执行"继续审查"及"读取历史记录"异常行为

### 1.1 问题现象

系统在工具调用返回结果后，持续循环执行以下非生产性操作：
- 反复调用 `read_file` / `search_in_file` 读取已读文件
- 输出描述性文本（"我注意到"、"我发现"、"让我先查看"）
- 无法进入 `write_file` / `multi_edit` 修复实施阶段

### 1.2 根因定位（代码级）

#### 根因A：主循环为 `while(true)` 无条件循环

**文件**: `packages/agentai-gateway/src/agentai-loop.ts`  
**行号**: 1882

```typescript
while (true) {  // ← 行1882：无条件死循环
  // ... 循环体 ...
}
```

**问题**: 循环退出条件全部依赖 **LLM行为被动触发**，而非主动状态机转换。

#### 根因B：防护机制均为"响应式"而非"预防式"

| 防护机制 | 位置 | 触发条件 | 问题 |
|----------|------|----------|------|
| 死循环硬停 | 行3118-3174 | 同工具连续3次相同参数 | **事后检测**，已浪费3轮 |
| 只读不写检测 | 行3176-3186 | 连续5轮中4轮只读 | **阈值过高**（5轮） |
| 描述性回复检测 | 行3412-3449 | 连续4次纯描述 | **正则可绕过** |
| 截断自动恢复 | 行3197-3207 | `finishReason==='length'` | 可能恢复到错误路径 |
| 代际检查 | 行400-401, 1888-1890 | 新run()取代旧run() | 仅防竞态，不防死循环 |

#### 根因C：审查模式提示与执行动作脱节

**文件**: `agentai-loop.ts:1252-1265`

```typescript
if (this.opts.mode === 'review') {
  systemMsgs.push({
    role: 'system',
    content: `
# 审查模式 (Review Mode)
你是一名资深代码审查专家。请对用户指定的代码/文件/项目进行全面审查...
**重要**: 如果你发现了需要修复的问题, 在报告中列出建议后, 
立即调用 write_file/multi_edit 执行修复。不要只报告不修复。
`,
  });
}
```

**矛盾点**: 
1. 模式名为 `"review"`（审查），但系统提示要求"审查+修复"
2. 弱模型（free tier）倾向于遵循模式名"审查"的语义，**只审不改**
3. 无状态机强制从 `reviewing → fixing → completed` 转换

#### 根因D：`isDescriptive` 正则检测可被绕过

**文件**: `agentai-loop.ts:3429-3435`

```typescript
const isDescriptive = /我(看到|发现|了解|注意到|观察到|查看了|分析了)
                    |让我(先|来)|这是|看起来|似乎|大概|目前|现状|情况/i.test(text);
const hasAction = /已(创建|修改|写入|删除|安装|执行|生成)|成功|✅|完成/i.test(text);
const hasToolName = /write_file|multi_edit|edit_file|run_code|install|npm|yarn
                  |pnpm|git|curl|wget|chmod|sudo|apt|pip|docker/i.test(text);
const isPurelyDescriptive = isDescriptive && !hasAction && !hasToolName && !isUserChitChat;
```

**绕过场景**: LLM输出包含任一`hasToolName`关键词（如提到"应该用`git`提交"）即被视为非描述性，即使实际未调用任何工具。

### 1.3 状态机设计缺陷分析

```
当前状态机（隐式、无强制转换）:
┌──────────┐    while(true)    ┌──────────┐
│  开始     │ ──────────────→ │  LLM推理   │
└──────────┘                  └──────────┘
       ↑                           │
       │        continue            ▼
       │ ┌──────────────────────────────────┐
       └─│ 工具调用? ├──→ 是 → 执行工具      │
         └──────────────────────────────────┘
                       │ 否
                       ▼
              ┌────────────────┐
              │ 描述性回复检测? │──→ 是(<4次)──→ continue (循环!)
              └────────────────┘
                       │ 否 / 是(≥4次)
                       ▼
                   break (退出)
```

**缺陷**: 
- 无显式 `REVIEWING → FIXING → COMPLETED` 状态定义
- 依赖LLM"自觉"调用write_file，弱模型做不到
- `continue` 分支远多于 `break` 分支

### 1.4 改进建议

#### 方案A：引入显式任务状态机（推荐）

```typescript
// 在 AgentAILoop 类中新增
type TaskPhase = 'analyzing' | 'reviewing' | 'fixing' | 'verifying' | 'completed';
private _taskPhase: TaskPhase = 'analyzing';

// 强制状态转换规则
private advancePhase(): void {
  const toolHistory = this.context.appendOnlyLog
    .filter(m => m.role === 'tool')
    .slice(-5);
  
  const hasReads = toolHistory.some(m => ['read_file','search_in_file'].includes(m.name));
  const hasWrites = toolHistory.some(m => ['write_file','multi_edit'].includes(m.name));
  
  if (this._taskPhase === 'analyzing' && hasReads) {
    this._taskPhase = 'reviewing';
  } else if (this._taskPhase === 'reviewing' && this.iteration >= 3) {
    // 强制进入fixing阶段，不管LLM是否愿意
    this._taskPhase = 'fixing';
    this.directives.add('phase_transition', 
      `[SYSTEM] ⚠️ 阶段转换: 审查阶段结束，现在必须执行修复。调用 write_file/multi_edit。`, 
      'critical'
    );
  } else if (this._taskPhase === 'fixing' && hasWrites) {
    this._taskPhase = 'verifying';
  }
}
```

**实施步骤**:
1. 在 `agentai-loop.ts` 行388附近添加 `_taskPhase` 属性声明
2. 在 `while(true)` 循环开头（行1882后）调用 `this.advancePhase()`
3. 在工具调用处理后（行3192前）根据 `_taskPhase` 注入不同指令
4. `fixing` 阶段连续2次无写操作 → force break

#### 方案B：降低只读检测阈值 + 增强指令

```typescript
// 将行3179的阈值从5降到3
if (toolMsgs.length >= 3) {  // 原 >= 5
  const recentTools = toolMsgs.slice(-3).map((m: any) => m.name || '');
  const readCount = recentTools.filter((t: string) => readTools.includes(t)).length;
  const writeCount = recentTools.filter((t: string) => writeTools.includes(t)).length;
  if (readCount >= 2 && writeCount === 0) {  // 原 readCount >= 4
    this.directives.add('read_only_loop', 
      `[SYSTEM] 🔴 你已读取足够信息！立即调用 write_file 执行修改！`, 
      'critical'  // 原 'high'
    );
  }
}
```

#### 方案C：审查模式分离（长期方案）

将 `mode='review'` 拆分为:
- `mode='review_only'` — 仅审查，输出报告后停止
- `mode='review_and_fix'` — 审查+自动修复（默认）

### 1.5 验证方法

| 测试用例 | 输入 | 预期结果 | 验收标准 |
|----------|------|----------|----------|
| TC-P1-1 | "审查并修复 agentai-loop.ts 的死循环问题" | ≤8轮内必须出现 write_file 调用 | iteration ≤ 8 |
| TC-P1-2 | "分析项目结构" | 允许只读，但≤5轮后停止 | iteration ≤ 5, 无 write_file |
| TC-P1-3 | 发送空消息/闲聊 | 不应触发任何工具调用 | toolCalls.length = 0 |
| TC-P1-4 | 故意让LLM反复读同一文件 | 第3次应触发硬停 | hardStopCount ≥ 1 |

---

## 二、P2：模型选择器下拉不进入模型选择

### 2.1 问题现象

用户点击 Composer 或 RightPanel 中的模型选择器：
- Dropdown/Select 弹出层不显示
- 或弹出后点击选项无反应
- 或弹出层被其他元素遮挡（z-index问题）

### 2.2 根因定位

#### 根因A：双模型选择器实例冲突

**文件1**: `packages/agentai-gui/src/components/Composer.tsx:685-720`

```tsx
{/* Composer中的内联Select */}
<Select
  size="small"
  value={activeModels.some(m => m.id === activeModelId) ? activeModelId : activeModels[0]?.id}
  onChange={handleModelChange}  // ← 行716
  style={{ width: 170, fontSize: 11 }}
  variant="borderless"
  popupMatchSelectWidth={false}
  options={groupedArr.map(...)}
/>
```

**文件2**: `packages/agentai-gui/src/components/ModelSelector.tsx:176-184` (full模式)

```tsx
{/* RightPanel中的独立Select */}
<Select
  value={activeModelId}
  onChange={handleSelect}
  style={{ width: '100%' }}
  size="small"
  optionLabelProp="label"
  popupMatchSelectWidth={false}
  options={groupedOptions}
/>
```

**以及** `ModelSelector.tsx:278-309` (compact/minimal模式的Dropdown):

```tsx
<Dropdown
  trigger={['click']}
  menu={{
    items: menuItems,
    onClick: ({ key }) => handleSelect(key),  // ← 行282
    style: { minWidth: 220, maxHeight: 450, overflowY: 'auto' },
  }}
>
  <span ...> {/* 触发器 */} </span>
</Dropdown>
```

**问题**: 同一页面可能同时存在 **2-3个模型选择器实例**（Composer + RightPanel + TitleBar），它们共享同一个 `useModelStore()` 的 `activeModelId`，但各自维护独立的弹出层状态。

#### 根因B：`handleModelChange` 密钥检查阻断切换

**文件**: `Composer.tsx:138-144`

```typescript
const handleModelChange = (modelId: string) => {
  const targetModel = models.find(m => m.id === modelId);
  if (targetModel) {
    const hasKey = !!localStorage.getItem(targetModel.apiKeyEnv);  // ← 行141
    if (!hasKey && targetModel.isCommercial) {  // ← 行142
      message.warning({ 
        content: `「${targetModel.label}」需配置密钥...`, 
        duration: 5, key: 'missing-key' 
      });
      // ⚠️ 这里没有 return，但没有 setActive！
      // 实际上如果走到这里，model不会切换
    }
  }
};
```

**Bug**: 当 `!hasKey && isCommercial` 时，函数既没有 `return` 也没有调用 `setActiveModel(modelId)`，导致**商用模型选择静默失败**。

#### 根因C：Dropdown `getPopupContainer` 缺失

**文件**: `ModelSelector.tsx:278-309`

Ant Design 的 `Dropdown` 组件在有 `overflow:hidden` 的父容器中时，弹出层会被裁剪。

**问题**: 代码未设置 `getPopupContainer={() => document.body}`，导致在 Composer 的 `position:relative` 容器中弹出层不可见或被裁剪。

### 2.3 改进建议

#### 方案A：修复 Composer.handleModelChange（必做）

```typescript
// Composer.tsx 行138-148 修正版
const handleModelChange = (modelId: string) => {
  const targetModel = models.find(m => m.id === modelId);
  if (!targetModel) return;

  // 免费模型直接切换
  if (isFreeModel(targetModel)) {
    setActiveModel(modelId);
    return;
  }

  // 商用模型检查密钥
  const hasKey = !!localStorage.getItem(targetModel.apiKeyEnv) 
    || !!commercialKeys[targetModel.apiKeyEnv];
  
  if (!hasKey) {
    message.warning({ 
      content: `「${targetModel.label}」需配置密钥，请前往 设置 → 模型配置`, 
      duration: 5, key: 'missing-key' 
    });
    // 可选：仍然允许切换（让后端报错更明确）
    // setActiveModel(modelId); 
    return;  // ← 显式return
  }
  
  setActiveModel(modelId);  // ← 有密钥才切换
};
```

#### 方案B：修复 Dropdown 弹出层容器（必做）

```tsx
// ModelSelector.tsx 行278-309 修正
<Dropdown
  trigger={['click']}
  getPopupContainer={() => document.body}  // ← 新增这行
  menu={{
    items: menuItems,
    onClick: ({ key }) => handleSelect(key),
    style: { minWidth: 220, maxHeight: 450, overflowY: 'auto' },
  }}
>
```

同样，Composer 中的 Select 也需要：

```tsx
<Select
  getPopupContainer={() => document.body}  // ← 新增
  popupMatchSelectWidth={false}
  // ...其他props
/>
```

#### 方案C：统一模型选择入口（长期）

将页面上的多个模型选择器统一为一个全局单例，通过事件总线通信：

```typescript
// 创建 useModelSelector hook
function useModelSelector() {
  const { activeModelId, setActive } = useModelStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const openSelector = useCallback(() => setDropdownOpen(true), []);
  const closeSelector = useCallback(() => setDropdownOpen(false), []);

  // 全局单例：无论从哪里打开，都是同一个弹出层
  return { activeModelId, setActive, dropdownOpen, openSelector, closeSelector };
}
```

### 2.4 验证方法

| 测试用例 | 操作 | 预期结果 | 验收标准 |
|----------|------|----------|----------|
| TC-P2-1 | 点击 Composer 模型选择器 | Dropdown正常弹出，显示所有可用模型 | 弹出层可见，z-index正确 |
| TC-P2-2 | 选择免费模型(agentai/zhipu) | 即时切换成功 | activeModelId变更 |
| TC-P2-3 | 选择未配密钥的商用模型 | 显示warning提示，模型不切换 | activeModelId不变 |
| TC-P2-4 | 选择已配密钥的商用模型 | 切换成功 | activeModelId变更 |
| TC-P2-5 | 同时打开RightPanel和Composer的选择器 | 不冲突，只有一个弹出层 | 无React多子树警告 |

---

## 三、P3：提示词优化未接入免费模型

### 3.1 问题现象

用户点击 Composer 中"优化提示词"按钮（⚡图标）：
- 功能本身可用（能调用LLM）
- 但总是使用当前选中的模型（可能是付费模型）
- 未优先使用免费模型进行轻量级优化任务
- SkillOpt 后端完全不支持免费模型API

### 3.2 根因定位

#### 根因A：PromptOptimizer 直接使用当前活跃模型

**文件**: `packages/agentai-gui/src/components/PromptOptimizer.tsx:41-59`

```typescript
const resp = await fetch('/v1/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: `你是一个提示词优化专家...`,
    stream: false,
    model: useModelStore.getState().activeModelId,  // ← 行56：直接使用当前模型
    mode: 'auto',
    system: '你只输出 JSON...',
  }),
});
```

**问题**: 
- `activeModelId` 可能是付费模型（如 deepseek-v4-pro）
- 提示词优化是轻量任务（<500 token），使用付费模型浪费配额
- 无免费模型回退逻辑

#### 根因B：SkillOpt 后端无免费模型实现

**文件**: `SkillOpt/skillopt_sleep/backend.py:1021-1039`

```python
def get_backend(name, *, model="", ...) -> Backend:
    n = (name or "mock").strip().lower()
    if n in {"claude", "anthropic", "claude_cli", "claude_code"}:
        return ClaudeCliBackend(model=model, claude_path=claude_path)
    if n in {"codex", "codex_cli", "openai_codex"}:
        return CodexCliBackend(model=model, codex_path=codex_path)
    if n in {"azure", "azure_openai", "aoai"}:
        return AzureOpenAIBackend(deployment=model, endpoint=azure_endpoint)
    if n in {"azure-responses", ...}:
        return AzureResponsesBackend(...)
    return MockBackend()  # ← 默认fallback是Mock，不是免费API
```

**缺失的后端实现**:
| 目标模型 | API端点 | 认证方式 | 现状 |
|----------|---------|----------|------|
| 智谱 GLM-4 | `open.bigmodel.cn/api/paas/v4` | ZHIPU_API_KEY | ❌ 不存在 |
| 通义千问 Qwen | `dashscope.aliyuncs.com` | DASHSCOPE_API_KEY | ❌ 不存在 |
| DeepSeek | `api.deepseek.com` | DEEPSEEK_API_KEY | ❌ 不存在 |
| AgentAI Atlas Free | `apihub.agnes-ai.com` | 内置免费 | ❌ 不存在 |

#### 根因C：PromptOptimizer 与 SkillOpt 完全断裂

架构分析：

```
用户点击⚡优化
    ↓
PromptOptimizer.tsx → POST /v1/chat (使用当前模型，可能是付费的)
    ↓
Gateway (agentai-loop.ts) → LLM API调用
    ↓
返回优化结果

SkillOpt (独立Python模块):
  backend.py → 只有 Claude/Codex/Azure/Mock 四种后端
  skillopt_webui.py → WebUI界面（独立进程）
  sleep cycle → 自动化prompt优化实验（离线批量）
```

**问题**: PromptOptimizer（前端组件）和 SkillOpt（后端Python模块）之间 **零集成**。SkillOpt 的优化能力（评分/反思/迭代改进）完全没有被前端使用。

### 3.3 改进建议

#### 方案A：PromptOptimizer 优先使用免费模型（快速修复）

```typescript
// PromptOptimizer.tsx 行34-81 修正版
const handleOptimize = useCallback(async () => {
  if (!draft.trim() || loading) return;
  setLoading(true);
  setResult(null);
  setShowPanel(true);

  try {
    // 优先使用免费模型进行轻量优化
    const state = useModelStore.getState();
    const freeModelIds = ['agentai', 'zhipu'];
    const optimizeModel = freeModelIds.includes(state.activeModelId)
      ? state.activeModelId
      : 'agentai';  // 回退到默认免费模型

    const resp = await fetch('/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `你是一个提示词优化专家...`,
        stream: false,
        model: optimizeModel,  // ← 使用免费模型
        mode: 'auto',
        system: '你只输出 JSON...',
      }),
    });
    // ...后续解析不变
  } catch (err) { /* ... */ }
}, [draft, loading]);
```

**优点**: 改动最小（1个文件，5行代码）  
**缺点**: 不使用 SkillOpt 的专业优化能力

#### 方案B：新增 QwenBackend 到 SkillOpt（中期方案）

```python
# 在 SkillOpt/skillopt_sleep/backend.py 末尾添加

class QwenBackend(CliBackend):
    """通义千问 Qwen 后端 (免费额度足够 prompt 优化)"""
    name = "qwen"

    def __init__(self, model: str = "qwen-max", api_key: str = ""):
        super().__init__()
        self.model = model
        self.api_key = api_key or os.environ.get("DASHSCOPE_API_KEY", "")
        self.base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
        self._client = None

    def _get_client(self):
        if self._client is None:
            import openai
            self._client = openai.OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
            )
        return self._client

    def _call(self, prompt: str, *, max_tokens: int = 512, retries: int = 3) -> str:
        import time, random
        for attempt in range(max(1, retries)):
            try:
                resp = self._get_client().chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=max_tokens,
                    temperature=0.3,
                )
                text = resp.choices[0].message.content or ""
                self._tokens += resp.usage.prompt_tokens + resp.usage.completion_tokens
                return text.strip()
            except Exception as e:
                last = e
                if attempt < retries - 1:
                    time.sleep(min(8.0, (2 ** attempt) * 0.5))
        return ""

# 在 get_backend() 函数中添加:
# if n in {"qwen", "qwen-backend", "tongyi"}:
#     return QwenBackend(model=model)
```

#### 方案C：前后端集成 SkillOpt（长期方案）

1. Gateway 新增 `/v1/optimize` 端点，内部调用 SkillOpt 的 `sleep cycle`
2. PromptOptimizer 改为调用此端点而非直接 `/v1/chat`
3. 返回结构包含 score/issues/suggestions/enhanced + 优化过程元数据

```typescript
// 未来版 PromptOptimizer.tsx
const resp = await fetch('/v1/optimize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: draft,
    backend: 'qwen',           // 指定使用免费Qwen后端
    iterations: 2,             // SkillOpt 迭代次数
    return_metrics: true,      // 返回评分明细
  }),
});
```

### 3.4 验证方法

| 测试用例 | 操作 | 预期结果 | 验收标准 |
|----------|------|----------|----------|
| TC-P3-1 | 当前模型=deepseek-v4-pro，点击优化 | 使用agentai/zhipu免费模型 | API调用不含付费模型名 |
| TC-P3-2 | 当前模型=agentai，点击优化 | 正常使用agentai | 返回有效JSON |
| TC-P3-3 | 输入空提示词点击优化 | 按钮disabled或不发送请求 | 无网络请求 |
| TC-P3-4 | 输入超长提示词(>2000字) | 正常处理或截断提示 | 无崩溃 |
| TC-P3-5 | 断网状态下点击优化 | 显示友好错误信息 | score=0, issues含错误提示 |

---

## 四、LLM 权限与能力配置综合评估

### 4.1 工具调用权限矩阵

| 工具名称 | 免费模型可用 | 商用模型可用 | 所需权限 | 当前状态 |
|----------|-------------|-------------|----------|----------|
| `read_file` | ✅ | ✅ | 文件系统读取 | ✅ 正常 |
| `write_file` | ✅ | ✅ | 文件系统写入 | ⚠️ 弱模型不主动调用 |
| `multi_edit` | ✅ | ✅ | 文件系统编辑 | ⚠️ 弱模型不主动调用 |
| `search_in_file` | ✅ | ✅ | 文件搜索 | ✅ 正常 |
| `e2b_bash` | ✅ | ✅ | Shell命令执行 | ✅ 正常 |
| `web_search` | ✅ | ✅ | 网络搜索 | ✅ 正常 |
| `take_snapshot` | ✅ | ✅ | 页面快照 | ✅ 正常 |
| `browser_click`等 | ✅ | ✅ | 浏览器控制 | ✅ 正常 |

**结论**: 权限配置本身不是瓶颈。**瓶颈在于弱模型的工具调用决策能力不足**，以及循环保护机制的被动设计。

### 4.2 能力分层与运行时参数

**文件**: `agentai-loop.ts:1301-1340`

```
autonomous (自主): DeepSeek Pro, GPT-4o, Claude Sonnet
  → maxIterations: 50, thinking: true, 跳过元认知
  
guided (引导): Atlas Free (256K), 智谱GLM-4
  → maxIterations: 20, thinking: false, 轻度引导
  
supervised (监管): 小模型
  → maxIterations: 10, 完整引导+反摆烂检测
```

**问题**: 免费模型被归类为 `guided` 或 `supervised`，但这些层级仍有 `while(true)` 循环和多层 continue 分支，弱模型容易陷入。

### 4.3 改进建议：按模型能力差异化循环策略

```typescript
// 在 run() 方法开头根据 tier 设置不同策略
switch (this._capabilityTier) {
  case 'autonomous':
    this.opts.maxIterations = 50;
    this.opts.enableMetaLoop = false;
    break;
  case 'guided':
    this.opts.maxIterations = 20;
    this.opts.enableMetaLoop = true;
    this.opts.aggressiveWritePush = true;  // 新增：第5轮强制写
    break;
  case 'supervised':
    this.opts.maxIterations = 10;
    this.opts.enableMetaLoop = true;
    this.opts.readOnlyThreshold = 2;  // 新增：只读2轮就警告
    break;
}
```

---

## 五、工作流衔接机制评估

### 5.1 当前工作流断层

```
用户请求 → [审查分析] → ❌断层→ [修复实施]
                ↓
         输出描述性报告
                ↓
         继续读取更多文件（循环）
```

**缺失环节**:
1. **意图→行动桥接器**: 从"发现问题"到"调用write_file"缺少强制性转换
2. **进度感知反馈**: 用户看不到当前处于哪个阶段（审查/修复/验证）
3. **人工介入点**: 当循环检测到死耗时，缺少"请用户确认是否继续"的交互

### 5.2 改进建议：增加阶段可视化

在前端 ChatView 中显示当前任务阶段：

```typescript
// 从 gateway 事件构建阶段指示器
useEffect(() => {
  const onStageChange = (data: { stage: string; iteration: number }) => {
    setCurrentStage(data.stage);  // 'analyzing' | 'fixing' | 'done'
  };
  eventBus.on('loop:stage', onStageChange);
  return () => eventBus.off('loop:stage', onStageChange);
}, []);
```

UI展示:
```
[🔍 分析中...] → [📝 审查完成] → [🔧 修复中...] → [✅ 完成]
   ↑ iteration 1-3     ↑ iteration 4-6    ↑ iteration 7+   (强制转换)
```

---

## 六、验收标准总表

| ID | 验收项 | 当前状态 | 目标状态 | 优先级 |
|----|--------|----------|----------|--------|
| AC-1 | 审查任务在10轮内完成或强制终止 | ❌ 可能无限循环 | ✅ ≤10轮必有结果 | P0 |
| AC-2 | 只读操作不超过4轮连续 | ❌ 阈值=5轮 | ✅ 阈值=3轮 | P0 |
| AC-3 | 模型选择器Dropdown正常弹出 | ❌ 可能不弹出 | ✅ 100%可用 | P0 |
| AC-4 | 商用模型切换时有明确的密钥提示 | ❌ 静默失败 | ✅ warning+阻止 | P1 |
| AC-5 | 提示词优化默认使用免费模型 | ❌ 使用当前模型 | ✅ 优先免费 | P1 |
| AC-6 | SkillOpt支持至少1种免费API | ❌ 仅Mock/Claude/Codex/Azure | ✅ +QwenBackend | P2 |
| AC-7 | 任务阶段对用户可见 | ❌ 不可见 | ✅ 进度条显示 | P2 |

---

## 七、实施路线图

### Phase 1：紧急修复（1-2天）
- [ ] **P1方案B**: 降低只读检测阈值 5→3，提升指令级别 high→critical
- [ ] **P2方案A**: 修复 `handleModelChange` 的商用模型阻断逻辑
- [ ] **P2方案B**: 所有 Dropdown/Select 添加 `getPopupContainer`
- [ ] **P3方案A**: PromptOptimizer 强制使用免费模型

### Phase 2：结构改善（3-5天）
- [ ] **P1方案A**: 引入显式任务状态机 (`_taskPhase`)
- [ ] **P4**: 按模型能力差异化循环策略
- [ ] **P2方案C**: 统一模型选择器为全局单例

### Phase 3：能力增强（1-2周）
- [ ] **P3方案B**: SkillOpt 新增 QwenBackend + DeepSeekBackend
- [ ] **5.2**: 任务阶段可视化 UI
- [ ] **P1方案C**: 审查模式拆分 review_only / review_and_fix

---

## 八、附录：关键代码位置索引

| 文件 | 关键行号 | 功能 |
|------|----------|------|
| `agentai-loop.ts` | 1882 | `while(true)` 主循环入口 |
| `agentai-loop.ts` | 1252-1265 | 审查模式系统提示 |
| `agentai-loop.ts` | 3118-3174 | 死循环硬停检测 |
| `agentai-loop.ts` | 3176-3186 | 只读不写检测 |
| `agentai-loop.ts` | 3412-3449 | 描述性回复检测 |
| `agentai-loop.ts` | 1301-1340 | 模型能力分层 |
| `Composer.tsx` | 138-144 | `handleModelChange` (有bug) |
| `Composer.tsx` | 685-720 | 内联模型Select |
| `ModelSelector.tsx` | 176-184 | full模式Select |
| `ModelSelector.tsx` | 278-309 | compact/minimal模式Dropdown |
| `PromptOptimizer.tsx` | 41-59 | LLM调用 (使用当前模型) |
| `PromptOptimizer.tsx` | 56 | `model: activeModelId` (问题行) |
| `backend.py` | 1021-1039 | `get_backend()` (缺免费后端) |
| `modelStore.ts` | 55-58 | 免费模型定义 |
| `modelStore.ts` | 179-198 | Zustand store定义 |

---

*报告生成工具: Tabbit AI Agent v0.1.0-alpha.1*  
*诊断方法: 静态代码分析 + 架构追踪 + 正则逻辑验证*
