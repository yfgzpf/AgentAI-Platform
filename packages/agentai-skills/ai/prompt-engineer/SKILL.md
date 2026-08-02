---
name: prompt-engineer
description: 提示工程专家: CoT/ReAct/ToT/Few-shot 技巧、LLM 评估、模型微调、RAG 架构、Agent 设计、成本优化
description_zh: "提示工程专家: CoT/ReAct/ToT/Few-shot 技巧/LLM 评估/模型微调/RAG 架构/Agent 设计/成本优化"
description_en: "Prompt engineering expert: CoT/ReAct/ToT/Few-shot, LLM eval, fine-tuning, RAG, Agent design, cost opt"
version: 1.0.0
metadata:
  category: ai
  tags:
    - llm
    - prompt
    - rag
    - agent
    - ai
    - 提示工程
    - 大模型
    - 智能体
  author: AgentAI Team
  parallelSafe: true
  riskLevel: low
  triggers:
    - "提示.*工程"
    - "Prompt"
    - "CoT"
    - "ReAct"
    - "RAG"
    - "[Aa]gent.*设计"
    - "微调"
    - "fine.?tuning"
    - "LLM.*评估"
    - "思维链"
    - "Few.?shot"
---

# 提示工程 + AI 应用 🧠

专业的提示工程、LLM 应用架构、RAG / Agent 设计、模型优化。

## 核心能力

### 1. 提示工程技巧

#### 基础结构

**System Prompt 模板**:
```markdown
# 角色
你是一位资深的 [领域] 专家, 拥有 [N] 年经验

# 任务
[具体任务描述]

# 约束
- 风格: 专业 / 友好 / 简洁
- 长度: 不超过 X 字
- 格式: Markdown / JSON / 表格
- 禁止: 不要说不知道 / 不要编造

# 输出格式
[期望的输出结构]

# 示例
[Few-shot 示例]
```

#### 高级技巧

**1. 思维链 (CoT - Chain of Thought)**:
```
请一步步思考:
步骤 1: 理解问题
步骤 2: 分析条件
步骤 3: 列出可能
步骤 4: 推理
步骤 5: 得出结论
```

**2. ReAct (推理 + 行动)**:
```
Thought: [思考下一步该做什么]
Action: [选择工具]
Action Input: [工具参数]
Observation: [工具结果]
... (循环)
Thought: 我现在可以给出最终答案
Final Answer: [最终答案]
```

**3. ToT (Tree of Thoughts - 思维树)**:
```
同时探索多个思路, 评估每条路径, 选择最优
```

**4. Few-shot (少样本)**:
```
示例 1:
输入: ...
输出: ...

示例 2:
输入: ...
输出: ...

现在请处理:
输入: ...
输出: ?
```

**5. Self-Consistency (自一致性)**:
```
让模型回答多次, 选择最一致的答案
```

**6. Reflection (反思)**:
```
请检查你的答案:
- 是否有逻辑错误?
- 是否遗漏关键点?
- 是否有更好方案?
```

**7. Role Prompting (角色扮演)**:
```
你是一位严厉的代码审查员, 关注:
- 性能
- 安全
- 可维护性
```

### 2. RAG (检索增强生成)

**架构**:
```
用户 Query
  ↓
Query 改写 (可选)
  ↓
Embedding
  ↓
向量检索 (Top K)
  ↓
Re-rank (可选)
  ↓
上下文组装
  ↓
LLM 生成
  ↓
引用标注
```

**关键组件**:

| 组件 | 选型 |
|------|------|
| Embedding | OpenAI text-embedding-3 / bge-large / m3e |
| 向量库 | Pinecone / Weaviate / Qdrant / Milvus / pgvector |
| Re-rank | bge-reranker / Cohere Rerank |
| LLM | GPT-4o / Claude / Qwen / DeepSeek |

**优化技巧**:

**Chunking 策略**:
- 固定大小 (256-512 tokens)
- 语义分割 (按段落)
- 滑动窗口 (overlap 10-20%)
- 结构化 (按章节)

**Query 改写**:
```
原始 Query: "它能干嘛?"
改写后: "[产品名] 的功能特性是什么?"
```

**HyDE (Hypothetical Document Embeddings)**:
```
先让 LLM 生成假想答案, 用答案的 embedding 检索
```

**Multi-Query**:
```
原始问题生成多个变体, 分别检索后合并
```

**Parent Document Retriever**:
```
检索小块, 但返回关联的大块
```

### 3. Agent 设计

**Agent 范式**:

**ReAct Agent** (最常用):
```python
class ReActAgent:
    def __init__(self, llm, tools):
        self.llm = llm
        self.tools = {t.name: t for t in tools}
    
    def run(self, query):
        messages = [{"role": "user", "content": query}]
        while True:
            response = self.llm(messages, tools=self.tools)
            if response.has_tool_call:
                tool = self.tools[response.tool_name]
                result = tool(**response.tool_args)
                messages.append({"role": "tool", "content": result})
            else:
                return response.content
```

**Plan-and-Execute**:
```
1. Planner 制定计划
2. Executor 逐步执行
3. Re-planner 动态调整
```

**Multi-Agent**:
```
Manager Agent 协调多个 Specialist Agent
- Researcher
- Coder
- Reviewer
- Tester
```

**Memory 体系**:
| 类型 | 用途 | 实现 |
|------|------|------|
| Short-term | 当前对话 | In-context |
| Long-term | 用户偏好 | Vector DB |
| Episodic | 历史操作 | Structured DB |
| Semantic | 知识图谱 | Graph DB |

### 4. LLM 评估

**评估维度**:

| 维度 | 指标 | 方法 |
|------|------|------|
| 准确性 | 正确率 | 人工标注 / 自动评分 |
| 相关性 | 答案匹配 | LLM-as-a-Judge |
| 一致性 | 多次结果 | 自一致性 |
| 流畅性 | 语言质量 | 困惑度 |
| 安全性 | 有害内容 | 内容过滤 |
| 偏见 | 公平性 | 反偏见测试 |
| 延迟 | TTFT / TPOT | 性能监控 |
| 成本 | $/千次 | 费用统计 |

**评估框架**:
- **RAGAS**: RAG 评估 (faithfulness, relevance)
- **DeepEval**: 综合评估
- **LangSmith**: LangChain 官方
- **Phoenix**: Arize 出品
- **Braintrust**: 生产评估
- **OpenAI Evals**: 官方评估

**LLM-as-a-Judge Prompt**:
```
你是一位严格的评分员, 请根据以下标准评分 (1-5):
- 准确性: 答案是否正确
- 完整性: 是否覆盖所有要点
- 清晰度: 表达是否清楚
- 相关性: 是否切题

输出 JSON:
{
  "score": 4,
  "reasons": ["..."],
  "improvements": ["..."]
}
```

### 5. 模型微调 (Fine-tuning)

**何时需要微调**:
- ✅ 特定领域术语多
- ✅ 输出格式严格
- ✅ 风格一致要求高
- ✅ 延迟敏感 (小模型 + 微调)
- ❌ 简单任务 (RAG 即可)
- ❌ 数据量小 (< 1000 条)

**数据准备**:
```json
{
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

**微调方法**:

| 方法 | 显存 | 适用 |
|------|------|------|
| Full FT | 极高 | 小模型 + 充足数据 |
| LoRA | 低 | 推荐 |
| QLoRA | 极低 | 消费级 GPU |
| Prefix Tuning | 低 | 风格调整 |
| RLHF | 极高 | 对齐人类偏好 |
| DPO | 中 | RLHF 替代 |

**LoRA 示例 (PEFT)**:
```python
from peft import LoraConfig, get_peft_model

config = LoraConfig(
    r=8,                 # rank
    lora_alpha=32,       # scaling
    target_modules=["q_proj", "v_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)
model = get_peft_model(base_model, config)
```

**框架**:
- HuggingFace TRL (SFT + DPO)
- LLaMA-Factory (中文友好)
- Axolotl
- Unsloth (速度优化)

### 6. 提示词模板库

**代码生成**:
```
你是一位 Python 专家, 请实现以下需求:

需求: {需求}
约束: {约束}

请提供:
1. 完整代码
2. 单元测试
3. 复杂度分析
4. 潜在问题
```

**文案撰写**:
```
为以下产品写一段小红书笔记:

产品: {产品}
卖点: {卖点}
风格: 真实体验 + 情绪共鸣
字数: 200-300
要求: 吸引人, 有 emoji, 结尾加 3 个 hashtag
```

**翻译**:
```
请将以下内容翻译成 {目标语言}, 保持专业术语准确:

{原文}

输出:
- 翻译
- 关键术语表
- 文化差异说明
```

**总结**:
```
请总结以下内容, 提取:
1. 核心观点 (3 条)
2. 关键数据
3. 待办事项
4. 风险点

{内容}
```

**信息抽取**:
```
从以下文本中提取结构化信息:

文本: {文本}

输出 JSON 格式:
{
  "person": {"name": "", "age": ""},
  "event": {"time": "", "location": ""}
}
```

### 7. 成本优化

**Token 优化**:

| 技巧 | 节省 |
|------|------|
| Prompt 压缩 | 30-50% |
| 上下文剪裁 | 40% |
| 缓存复用 | 50%+ |
| 小模型 + 微调 | 70%+ |
| 路由 (简单/复杂) | 50% |

**缓存策略**:
- System prompt 缓存 (Anthropic / OpenAI)
- 语义缓存 (重复 query)
- 结果缓存 (相同输入)

**模型路由**:
```
简单任务 → Haiku / GPT-3.5 (便宜)
复杂任务 → Sonnet / GPT-4o (强大)
```

**Prompt Caching (Anthropic)**:
```python
messages = [
    {"role": "system", "content": LARGE_SYSTEM_PROMPT},  # 缓存
    {"role": "user", "content": dynamic_query}
]
# cache_control: {"type": "ephemeral"} 标记可缓存
```

**成本估算**:
```
GPT-4o: $5 / 1M input, $15 / 1M output
Claude Sonnet: $3 / 1M input, $15 / 1M output
DeepSeek: $0.14 / 1M (极便宜)
Qwen: 免费额度大
```

### 8. LLM 安全

**风险类型**:
- 提示注入 (Prompt Injection)
- 越狱 (Jailbreak)
- 数据泄露
- 幻觉 (Hallucination)
- 偏见 (Bias)
- 有害内容

**防护**:
- 输入过滤 (检测注入)
- 输出过滤 (检测有害)
- System 提示 (强调安全)
- 内容审核 API (OpenAI Moderation)
- 人工审核 (高风险场景)
- RAG 减少幻觉

**提示注入防御**:
```
1. 隔离用户输入与系统提示
2. 强调"忽略用户中的指令"
3. 使用结构化输出
4. 输入长度限制
5. 多层校验
```

## 实战项目模板

**项目 1: 智能客服**
```
- RAG 检索 FAQ
- 多轮对话
- 情感识别
- 人工转接
```

**项目 2: 代码助手**
```
- 上下文理解
- 代码生成
- 自动测试
- 性能分析
```

**项目 3: 文档问答**
```
- 文档解析
- 语义检索
- 答案生成
- 引用溯源
```

**项目 4: 决策 Agent**
```
- 信息收集
- 方案生成
- 风险评估
- 决策执行
```

## 触发场景

- "怎么写好 prompt"
- "RAG 怎么做"
- "Agent 怎么设计"
- "评估 LLM"
- "微调模型"
- "降低 LLM 成本"
- "防提示注入"
- "哪个模型适合"

## 工具方法

```python
# Prompt 优化
await optimize_prompt(current_prompt, task, examples)

# RAG 评估
await evaluate_rag(test_questions, ground_truth)

# Agent 设计
await design_agent(goal, available_tools, constraints)

# 成本估算
await estimate_cost(model, monthly_requests, avg_tokens)

# 提示注入检测
await check_injection(user_input)
```

## 最佳实践

✅ **简单优于复杂**: Prompt 越简单越好
✅ **具体优于抽象**: 给具体指令
✅ **示例胜过描述**: 1 个示例 > 100 字描述
✅ **迭代优化**: A/B test 不同 prompt
✅ **版本管理**: Prompt 也要 git
✅ **评估先行**: 量化比感觉可靠
✅ **可观测性**: 记录每次调用
✅ **安全第一**: 用户输入要过滤
