/**
 * 知识蒸馏引擎 - Knowledge Distiller
 * 从 GitHub 仓库等资源中提取结构化知识
 */

import { getAgentAIRouter } from '../llm-router.js';
import { writeMemory } from '../memory.js';
import type { Repository } from './github-explorer.js';

export interface KnowledgeNode {
  id: string;
  concept: string;
  domain: string;
  description: string;
  keyPoints: string[];
  codeExamples: CodeExample[];
  relationships: KnowledgeRelationship[];
  sources: KnowledgeSource[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

export interface CodeExample {
  title: string;
  code: string;
  language: string;
  explanation: string;
}

export interface KnowledgeRelationship {
  target: string;
  type: 'depends_on' | 'contains' | 'related_to' | 'prerequisite';
  strength: number;
}

export interface KnowledgeSource {
  type: 'github' | 'document' | 'community';
  url: string;
  title: string;
  reliability: number;
}

export interface DistillationResult {
  nodes: KnowledgeNode[];
  concepts: string[];
  confidence: number;
  processingTime: number;
}

/**
 * 从仓库中蒸馏知识
 */
export async function distillFromRepository(
  repo: Repository,
  targetConcept: string
): Promise<DistillationResult> {
  const startTime = Date.now();
  
  // 1. 构建蒸馏 Prompt
  const prompt = buildDistillationPrompt(repo, targetConcept);
  
  // 2. 调用 LLM 进行蒸馏
  const router = getAgentAIRouter();
  const response = await router.chat({
    model: 'agentai',  // 使用免费模型
    messages: [
      {
        role: 'system',
        content: 'You are a knowledge distillation expert. Extract structured knowledge from the provided repository content.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.3,
  });
  
  // 3. 解析结构化输出
  const rawContent = response.content || '';
  
  const nodes = parseDistillationOutput(rawContent, repo, targetConcept);
  
  // 4. 存储到记忆系统
  for (const node of nodes) {
    await storeKnowledge(node);
  }
  
  return {
    nodes,
    concepts: nodes.map(n => n.concept),
    confidence: calculateOverallConfidence(nodes),
    processingTime: Date.now() - startTime,
  };
}

/**
 * 构建蒸馏 Prompt
 */
function buildDistillationPrompt(repo: Repository, targetConcept: string): string {
  return `
请从以下 GitHub 仓库内容中提取关于 "${targetConcept}" 的结构化知识。

仓库信息:
- 名称: ${repo.name}
- 描述: ${repo.description}
- 语言: ${repo.language}
- 主题: ${repo.topics.join(', ')}

README 内容:
${repo.readmeContent?.slice(0, 8000) || '未获取到 README'}

请提取以下内容（JSON 格式）:
{
  "concepts": [
    {
      "name": "概念名称",
      "description": "详细描述（200字以内）",
      "keyPoints": ["要点1", "要点2", "要点3"],
      "codeExamples": [
        {
          "title": "示例标题",
          "code": "代码片段",
          "explanation": "代码解释"
        }
      ],
      "relationships": [
        {
          "target": "相关概念",
          "type": "depends_on|contains|related_to|prerequisite",
          "strength": 0.8
        }
      ],
      "confidence": 0.85
    }
  ]
}

要求:
1. 提取与 "${targetConcept}" 最相关的核心概念
2. 包含实际可运行的代码示例
3. 识别概念间的依赖关系
4. 置信度基于内容质量和相关性
5. 最多提取 3 个核心概念
`;
}

/**
 * 解析蒸馏输出
 */
function parseDistillationOutput(
  content: string,
  repo: Repository,
  targetConcept: string
): KnowledgeNode[] {
  try {
    // 尝试提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return [createFallbackNode(repo, targetConcept, content)];
    }
    
    const data = JSON.parse(jsonMatch[0]);
    const concepts = data.concepts || [];
    
    return concepts.map((c: any, index: number) => ({
      id: `${repo.name}-${targetConcept}-${index}`,
      concept: c.name || targetConcept,
      domain: inferDomain(repo.language, repo.topics),
      description: c.description || '',
      keyPoints: c.keyPoints || [],
      codeExamples: (c.codeExamples || []).map((ex: any) => ({
        title: ex.title || '示例',
        code: ex.code || '',
        language: repo.language || 'typescript',
        explanation: ex.explanation || '',
      })),
      relationships: (c.relationships || []).map((rel: any) => ({
        target: rel.target || '',
        type: rel.type || 'related_to',
        strength: rel.strength || 0.5,
      })),
      sources: [{
        type: 'github',
        url: repo.url,
        title: repo.name,
        reliability: repo.quality.overall,
      }],
      confidence: c.confidence || repo.quality.overall,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  } catch (error) {
    // 解析失败，返回原始内容作为回退
    return [createFallbackNode(repo, targetConcept, content)];
  }
}

/**
 * 创建回退节点（解析失败时使用）
 */
function createFallbackNode(
  repo: Repository,
  targetConcept: string,
  rawContent: string
): KnowledgeNode {
  return {
    id: `${repo.name}-${targetConcept}-fallback`,
    concept: targetConcept,
    domain: inferDomain(repo.language, repo.topics),
    description: `从 ${repo.name} 提取的知识（原始解析）`,
    keyPoints: [rawContent.slice(0, 500)],
    codeExamples: [],
    relationships: [],
    sources: [{
      type: 'github',
      url: repo.url,
      title: repo.name,
      reliability: repo.quality.overall * 0.5,  // 降权
    }],
    confidence: 0.3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * 推断领域
 */
function inferDomain(language: string, topics: string[]): string {
  const domainKeywords: Record<string, string> = {
    'TypeScript': 'frontend',
    'JavaScript': 'frontend',
    'Python': 'ai',
    'Go': 'backend',
    'Rust': 'systems',
    'machine-learning': 'ai',
    'react': 'frontend',
    'vue': 'frontend',
    'docker': 'devops',
    'kubernetes': 'devops',
  };
  
  // 从语言推断
  if (domainKeywords[language]) {
    return domainKeywords[language];
  }
  
  // 从主题推断
  for (const topic of topics) {
    if (domainKeywords[topic]) {
      return domainKeywords[topic];
    }
  }
  
  return 'general';
}

/**
 * 存储知识到记忆系统
 */
async function storeKnowledge(node: KnowledgeNode): Promise<void> {
  await writeMemory({
    userId: 'knowledge_system',
    workspace: process.cwd(),
    role: 'system',
    entityId: node.concept,
    content: JSON.stringify({
      type: 'learned_knowledge',
      concept: node.concept,
      domain: node.domain,
      description: node.description,
      keyPoints: node.keyPoints,
      codeExamples: node.codeExamples,
      relationships: node.relationships,
      confidence: node.confidence,
      sources: node.sources,
    }),
    metadata: {
      tags: ['knowledge', node.domain, 'auto-learned'],
    },
    importance: node.confidence,
    source: 'auto_reflect',
  });
}

/**
 * 计算整体置信度
 */
function calculateOverallConfidence(nodes: KnowledgeNode[]): number {
  if (nodes.length === 0) return 0;
  const sum = nodes.reduce((acc, n) => acc + n.confidence, 0);
  return sum / nodes.length;
}

/**
 * 批量蒸馏多个仓库
 */
export async function distillFromMultiple(
  repos: Repository[],
  targetConcept: string
): Promise<DistillationResult> {
  const results: KnowledgeNode[] = [];
  
  for (const repo of repos.slice(0, 3)) {  // 最多处理 3 个仓库
    try {
      const result = await distillFromRepository(repo, targetConcept);
      results.push(...result.nodes);
    } catch (error) {
      console.warn(`Failed to distill from ${repo.name}:`, error);
    }
  }
  
  return {
    nodes: results,
    concepts: [...new Set(results.map(n => n.concept))],
    confidence: calculateOverallConfidence(results),
    processingTime: 0,
  };
}

// 导出类型
export type { Repository } from './github-explorer.js';
