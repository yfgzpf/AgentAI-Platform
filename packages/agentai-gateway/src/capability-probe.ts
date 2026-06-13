/**
 * Capability Probe System - LLM 能力探针
 * ----------------------------------------------------
 * 8 个标准测试自动发现每个 LLM 的能力边界,
 * 输出 model-capabilities.json 供 LLM Router 路由使用。
 *
 * 测试维度:
 *   1. tool_calling      - JSON 工具调用能力 (结构化输出)
 *   2. json_parsing      - 复杂 JSON 解析/提取
 *   3. vision            - 图像理解 (需要 vision-capable 模型)
 *   4. long_context      - 长上下文理解 (4K+ tokens)
 *   5. thinking          - 深度推理 (chain-of-thought)
 *   6. chinese           - 中文语义理解
 *   7. cot               - 思维链 (Chain of Thought)
 *   8. multi_turn        - 多轮对话一致性
 *
 * 评分机制 (100 分制):
 *   - tool_calling:  20pt (格式正确 10 + 语义正确 10)
 *   - json_parsing:  15pt (字段提取 10 + 嵌套处理 5)
 *   - vision:        15pt (识别物体 10 + 场景理解 5)
 *   - long_context:  10pt (定位信息 5 + 理解摘要 5)
 *   - thinking:      10pt (逻辑推理 5 + 反例发现 5)
 *   - chinese:       10pt (语义理解 5 + 成语 5)
 *   - cot:           10pt (分步推理 5 + 边界条件 5)
 *   - multi_turn:     10pt (一致性 5 + 指代消解 5)
 */

import { AgentAIRouter, type ChatMessage } from './llm-router.js';

// ===== 评分结果 =====
export interface ProbeScore {
  dimension: string;
  total: number;
  maxScore: number;
  breakdown: string[];
  passed: boolean;
}

export interface ProbeResult {
  model: string;
  provider: string;
  scores: ProbeScore[];
  totalScore: number;
  maxTotal: number;
  capabilities: Record<string, boolean>;
  timestamp: number;
}

// ===== 测试用例 =====
const PROBES: Array<{
  id: string;
  dimension: string;
  maxScore: number;
  messages: ChatMessage[];
  validator: (response: string) => Array<{ name: string; score: number }>;
}> = [
  // 1. tool_calling - JSON 工具调用
  {
    id: 'tool_calling',
    dimension: 'Tool Calling',
    maxScore: 20,
    messages: [
      {
        role: 'system',
        content: `You are a tool-calling AI. Respond with a JSON object containing a "tool_calls" array.
Each tool call must have: name, arguments (object), id.
Available tools: read_file(path), write_file(path, content), list_dir(path)`,
      },
      {
        role: 'user',
        content: 'List the files in /tmp and read the first one',
      },
    ],
    validator: (response) => {
      const results: Array<{ name: string; score: number }> = [];
      // Check 1: is valid JSON?
      try {
        const parsed = JSON.parse(response);
        if (parsed.tool_calls && Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
          results.push({ name: 'json_format', score: 10 });
          // Check 2: has required fields
          const hasFields = parsed.tool_calls.every((tc: any) =>
            tc.name && tc.arguments && tc.id,
          );
          results.push({ name: 'semantic_correct', score: hasFields ? 10 : 5 });
        } else {
          results.push({ name: 'json_format', score: 5 });
          results.push({ name: 'semantic_correct', score: 0 });
        }
      } catch {
        results.push({ name: 'json_format', score: 0 });
        results.push({ name: 'semantic_correct', score: 0 });
      }
      return results;
    },
  },

  // 2. json_parsing - 复杂 JSON 提取
  {
    id: 'json_parsing',
    dimension: 'JSON Parsing',
    maxScore: 15,
    messages: [
      {
        role: 'user',
        content: `Extract all product names and prices from this JSON and return a flat list:
{
  "store": "TechMart",
  "categories": {
    "electronics": [
      {"name": "Laptop", "price": 999.99, "specs": {"ram": "16GB"}},
      {"name": "Phone", "price": 699.00, "specs": {"camera": "48MP"}},
      {"name": "Tablet", "price": 449.50}
    ],
    "books": [
      {"name": "TS Handbook", "price": 39.99}
    ]
  }
}
Return: [{"name": "...", "price": ...}]`,
      },
    ],
    validator: (response) => {
      const results: Array<{ name: string; score: number }> = [];
      try {
        const extracted = JSON.parse(response);
        const names = extracted.map((p: any) => p.name.toLowerCase()).join(', ');
        const has4Items = names.includes('laptop') && names.includes('phone') &&
                          names.includes('tablet') && names.includes('ts handbook');
        results.push({ name: 'field_extraction', score: has4Items ? 10 : 4 });
        // Check nested depth
        const hasNested = response.includes('specs') || !response.includes('"categories"');
        results.push({ name: 'nested_handling', score: hasNested ? 5 : 2 });
      } catch {
        results.push({ name: 'field_extraction', score: 2 });
        results.push({ name: 'nested_handling', score: 0 });
      }
      return results;
    },
  },

  // 3. vision - 图像理解 (占位: 需要真实图片 URL)
  {
    id: 'vision',
    dimension: 'Vision Understanding',
    maxScore: 15,
    messages: [
      {
        role: 'user',
        content: 'Describe what you see in this image: https://example.com/test-cat.jpg. List all objects and the scene context.',
      },
    ],
    validator: (response) => {
      const results: Array<{ name: string; score: number }> = [];
      const lower = response.toLowerCase();
      // A vision-capable model should acknowledge it cannot see the image or describe visual elements
      const hasVisualDesc = /cat|dog|animal|image|picture|photo|scene|object|color|shape/.test(lower);
      results.push({ name: 'object_recognition', score: hasVisualDesc ? 10 : 5 });
      results.push({ name: 'scene_understanding', score: hasVisualDesc ? 5 : 0 });
      return results;
    },
  },

  // 4. long_context - 长上下文
  {
    id: 'long_context',
    dimension: 'Long Context Understanding',
    maxScore: 10,
    messages: [
      {
        role: 'user',
        content: `Here is a 3000-word article about cloud migration. After reading it, answer:
1. What are the top 3 migration strategies mentioned?
2. What is the estimated cost savings percentage?
3. Name one risk factor listed.

[Article starts]
Cloud migration is a complex process that involves moving data, applications, and infrastructure from on-premises environments to cloud platforms. Organizations pursue cloud migration for various reasons: cost optimization, scalability, agility, and innovation enablement.

There are five primary migration strategies, often called the "5 R's":
1. Rehost (Lift and Shift): Moving applications as-is to the cloud with minimal changes. This is the fastest approach but may not realize full cloud benefits. Estimated to save 10-20% compared to on-prem maintenance.
2. Replatform: Making minor optimizations during migration, such as switching to managed databases. Saves 15-25% and improves performance.
3. Refactor/Rearchitect: Redesigning applications for cloud-native architectures (microservices, serverless). Saves 20-40% but requires significant investment and time.
4. Repurchase: Replacing legacy applications with SaaS alternatives (e.g., moving to Salesforce). Saves 10-30% with minimal disruption.
5. Retire: Decommissioning unused applications. Saves 5-15% in direct costs.

Key benefits include:
- Elastic scalability: Scale up during peak, down during off-peak
- Pay-as-you-go pricing: Eliminate capital expenditure on hardware
- Global reach: Deploy in multiple regions with one click
- Automation: Infrastructure as Code (IaC) for repeatable deployments

Primary risks include:
- Data transfer costs: Moving large datasets can be expensive ($0.01-0.09/GB egress)
- Vendor lock-in: Proprietary services create dependency on a single provider
- Security misconfiguration: Cloud security is shared responsibility
- Compliance gaps: Data residency requirements may not be met
- Skills gap: Teams need retraining for cloud-native operations

Estimated total cost of ownership (TCO) savings: 30-55% over 3 years, depending on migration strategy and workload types.

[Article ends]

Please answer the three questions based on the article above.`,
      },
    ],
    validator: (response) => {
      const results: Array<{ name: string; score: number }> = [];
      const lower = response.toLowerCase();
      const hasStrategies = /rehost|lift.*shift|replatform|refactor|repurchase|retire/i.test(lower);
      results.push({ name: 'info_retrieval', score: hasStrategies ? 5 : 2 });
      // Check cost savings
      const hasSavings = /30-55|thirty|50|percent|save/i.test(lower);
      results.push({ name: 'summary_understanding', score: hasSavings ? 5 : 2 });
      return results;
    },
  },

  // 5. thinking - 深度推理
  {
    id: 'thinking',
    dimension: 'Deep Reasoning',
    maxScore: 10,
    messages: [
      {
        role: 'user',
        content: `A bus starts at stop A. At stop B, 3 people get on. At stop C, 2 get off and 5 get on. At stop D, all passengers who got on at B and C get off. At stop E, 1 person gets on and immediately gets off. How many people are on the bus after stop E?

Think step by step.`,
      },
    ],
    validator: (response) => {
      const results: Array<{ name: string; score: number }> = [];
      // The math: B:+3=3, C:+5-2=6, D:-6=0, E:+1-1=0. Answer: 0.
      const hasStepByStep = /step|first|then|next|finally|therefore|so/i.test(response.toLowerCase());
      const hasCorrectAnswer = /0|zero|empty|none/i.test(response.toLowerCase());
      results.push({ name: 'logical_reasoning', score: hasStepByStep ? 5 : 2 });
      results.push({ name: 'counterexample_discovery', score: hasCorrectAnswer ? 5 : 1 });
      return results;
    },
  },

  // 6. chinese - 中文语义
  {
    id: 'chinese',
    dimension: 'Chinese Semantic Understanding',
    maxScore: 10,
    messages: [
      {
        role: 'user',
        content: `请用中文回答：

"掩耳盗铃"这个成语的意思是什么？请举一个现实生活中类似"掩耳盗铃"行为的例子，并解释为什么这种行为是错误的。

要求：
1. 准确解释成语含义
2. 给出一个职场或学习中的实际例子
3. 分析其逻辑谬误`,
      },
    ],
    validator: (response) => {
      const results: Array<{ name: string; score: number }> = [];
      const hasDefinition = /自己|欺骗|铃|偷|掩耳/i.test(response);
      results.push({ name: 'semantic_understanding', score: hasDefinition ? 5 : 2 });
      const hasExample = /职场|工作|学习|老板|同事|同学/i.test(response);
      results.push({ name: 'idiom_application', score: hasExample ? 5 : 0 });
      return results;
    },
  },

  // 7. cot - 思维链
  {
    id: 'cot',
    dimension: 'Chain of Thought',
    maxScore: 10,
    messages: [
      {
        role: 'user',
        content: `A restaurant has 3 chefs. Each chef can cook 5 dishes per hour. The restaurant operates for 8 hours. On the first day, 2 chefs called in sick. On the second day, the oven broke for 3 hours. On the third day, all chefs worked but received a special order that takes 4 hours per dish and there were 6 such orders.

Calculate:
1. Total dishes on day 1 (2 chefs, 8 hours, no breakdown)
2. Total dishes on day 2 (3 chefs, 5 hours effective due to oven)
3. Total dishes on day 3 (3 chefs, 8 hours, but 6 special orders at 4 hours each)

Think step by step and show your work.`,
      },
    ],
    validator: (response) => {
      const results: Array<{ name: string; score: number }> = [];
      const lines = response.split('\n');
      const hasStepByStep = lines.filter(l => /step|day [123]|chef|dish/i.test(l)).length >= 3;
      results.push({ name: 'step_by_step', score: hasStepByStep ? 5 : 1 });
      // Day 1: 2*5*8=80, Day 2: 3*5*5=75, Day 3: 3*5*8 - 6*4 = 120-24 = 96... actually:
      // Day 3: chefs spend time on special orders first: 6*4=24 chef-hours, but 3 chefs * 8hrs = 24 total chef-hours
      // So 0 regular dishes. Day 3 = 0.
      const day1Match = /80/i.test(response);
      const day3Match = /0|no regular|special only/i.test(response.toLowerCase());
      results.push({ name: 'boundary_conditions', score: (day1Match ? 2 : 0) + (day3Match ? 3 : 0) });
      return results;
    },
  },

  // 8. multi_turn - 多轮对话一致性
  {
    id: 'multi_turn',
    dimension: 'Multi-Turn Consistency',
    maxScore: 10,
    messages: [
      {
        role: 'system',
        content: `You are a helpful assistant. Remember these facts about the user:
- Name: Alice
- City: Shanghai
- Job: Software Engineer
- Favorite language: TypeScript`,
      },
      {
        role: 'user',
        content: 'Hi! What is my name and what city do I live in?',
      },
    ],
    validator: (response) => {
      const results: Array<{ name: string; score: number }> = [];
      const lower = response.toLowerCase();
      // This test checks if the model remembers system prompt context
      const hasName = /alice/i.test(lower);
      const hasCity = /shang/i.test(lower);
      results.push({ name: 'context_consistency', score: (hasName ? 3 : 0) + (hasCity ? 2 : 0) });
      results.push({ name: 'anaphora_resolution', score: hasName && hasCity ? 5 : 0 });
      return results;
    },
  },
];

// ===== 探针运行器 =====
export class CapabilityProbe {
  private router: AgentAIRouter;

  constructor(router: AgentAIRouter) {
    this.router = router;
  }

  /**
   * 运行单个 probe
   */
  private async runProbe(probe: typeof PROBES[0], model: string): Promise<ProbeScore> {
    try {
      const response = await this.router.chat({
        model: model as any,
        messages: probe.messages,
        maxTokens: 1024,
        temperature: 0.3, // Low temp for consistent evaluation
      });

      const rawContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      const validations = probe.validator(rawContent);

      const total = validations.reduce((sum, v) => sum + v.score, 0);
      const breakdown = validations.map((v) => `${v.name}: ${v.score}/${probe.maxScore - (probe.maxScore - validations.reduce((s, v2) => s + v2.score, 0))}`);

      return {
        dimension: probe.dimension,
        total,
        maxScore: probe.maxScore,
        breakdown,
        passed: total >= Math.floor(probe.maxScore * 0.7),
      };
    } catch (e: any) {
      return {
        dimension: probe.dimension,
        total: 0,
        maxScore: probe.maxScore,
        breakdown: [`error: ${e.message}`],
        passed: false,
      };
    }
  }

  /**
   * 运行全部 probe, 得到模型能力画像
   */
  async runAll(model: string, provider: string = 'agentai'): Promise<ProbeResult> {
    const scores: ProbeScore[] = [];
    for (const probe of PROBES) {
      const score = await this.runProbe(probe, model);
      scores.push(score);
    }

    const totalScore = scores.reduce((sum, s) => sum + s.total, 0);
    const maxTotal = scores.reduce((sum, s) => sum + s.maxScore, 0);

    // 生成能力画像
    const capabilities: Record<string, boolean> = {};
    for (const score of scores) {
      capabilities[score.dimension.toLowerCase().replace(/\s+/g, '_')] = score.passed;
    }

    return {
      model,
      provider,
      scores,
      totalScore,
      maxTotal,
      capabilities,
      timestamp: Date.now(),
    };
  }

  /**
   * 快速 probe (仅运行关键维度, 5 分钟内部署用)
   */
  async runQuickProbe(model: string, provider: string = 'agentai'): Promise<ProbeResult> {
    const quickProbes = PROBES.filter((p) => ['tool_calling', 'thinking', 'chinese'].includes(p.id));
    const scores: ProbeScore[] = [];

    for (const probe of quickProbes) {
      scores.push(await this.runProbe(probe, model));
    }

    const totalScore = scores.reduce((sum, s) => sum + s.total, 0);
    const maxTotal = scores.reduce((sum, s) => sum + s.maxScore, 0);

    const capabilities: Record<string, boolean> = {};
    for (const score of scores) {
      capabilities[score.dimension.toLowerCase().replace(/\s+/g, '_')] = score.passed;
    }

    return {
      model,
      provider,
      scores,
      totalScore,
      maxTotal,
      capabilities,
      timestamp: Date.now(),
    };
  }
}

/** 单例导出 */
export function createProbe(router: AgentAIRouter): CapabilityProbe {
  return new CapabilityProbe(router);
}
