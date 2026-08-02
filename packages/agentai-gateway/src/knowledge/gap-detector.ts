/**
 * 知识缺口检测器 - Knowledge Gap Detector
 * 基于现有记忆系统，检测任务所需知识的覆盖程度
 */

import { readMemory } from '../memory.js';

export interface KnowledgeGap {
  concept: string;
  domain: string;
  confidence: number;  // 0-1，当前掌握程度
  priority: number;    // 0-1，需求紧迫度
  searchKeywords: string[];
}

export interface GapAnalysisResult {
  gaps: KnowledgeGap[];
  overallCoverage: number;
  recommendedAction: 'explore' | 'proceed' | 'clarify';
}

/**
 * 分析任务并检测知识缺口
 */
export async function detectKnowledgeGaps(
  task: string,
  domain?: string
): Promise<GapAnalysisResult> {
  // 1. 提取任务关键词
  const keywords = extractKeywords(task);
  
  // 2. 查询现有知识
  const existingKnowledge = await queryExistingKnowledge(keywords);
  
  // 3. 计算缺口
  const gaps = calculateGaps(keywords, existingKnowledge, domain);
  
  // 4. 计算整体覆盖率
  const overallCoverage = calculateCoverage(gaps);
  
  // 5. 推荐行动
  const recommendedAction = determineAction(gaps, overallCoverage);
  
  return {
    gaps,
    overallCoverage,
    recommendedAction,
  };
}

/**
 * 提取任务关键词
 */
function extractKeywords(task: string): string[] {
  // 技术术语提取规则
  const techPatterns = [
    /\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/g,  // CamelCase (React, TypeScript)
    /\b[a-z]+-[a-z-]+\b/g,               // kebab-case (machine-learning)
    /\b(?:实现|使用|学习|了解|掌握|探索)\s+([\w\s]+?)(?:\s|$|[,，])/g,
  ];
  
  const keywords = new Set<string>();
  
  // 提取技术术语
  for (const pattern of techPatterns) {
    const matches = task.match(pattern);
    if (matches) {
      matches.forEach(m => keywords.add(m.toLowerCase().trim()));
    }
  }
  
  // 提取显式提到的概念
  const conceptPattern = /[""']([^""']+)[""']/g;
  let match;
  while ((match = conceptPattern.exec(task)) !== null) {
    keywords.add(match[1].toLowerCase());
  }
  
  return Array.from(keywords);
}

/**
 * 查询现有知识
 */
async function queryExistingKnowledge(keywords: string[]): Promise<Map<string, number>> {
  const knowledge = new Map<string, number>();
  
  for (const keyword of keywords) {
    // 查询记忆系统
    const memories = await readMemory({
      userId: 'knowledge_system',
      limit: 5,
    });
    
    // 过滤相关记忆并计算置信度
    const relevantMemories = memories.filter(m => 
      m.content?.toLowerCase().includes(keyword.toLowerCase())
    );
    
    // 计算置信度（基于记忆数量和相关性）
    const confidence = Math.min(relevantMemories.length / 3, 1) * 0.7 + 0.3;
    knowledge.set(keyword, confidence);
  }
  
  return knowledge;
}

/**
 * 计算知识缺口
 */
function calculateGaps(
  keywords: string[],
  existingKnowledge: Map<string, number>,
  domain?: string
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];
  
  for (const keyword of keywords) {
    const confidence = existingKnowledge.get(keyword) || 0;
    
    // 置信度低于阈值，视为缺口
    if (confidence < 0.6) {
      gaps.push({
        concept: keyword,
        domain: domain || inferDomain(keyword),
        confidence,
        priority: calculatePriority(keyword, confidence),
        searchKeywords: generateSearchKeywords(keyword),
      });
    }
  }
  
  // 按优先级排序
  return gaps.sort((a, b) => b.priority - a.priority);
}

/**
 * 推断领域
 */
function inferDomain(keyword: string): string {
  const domainMap: Record<string, string> = {
    'react': 'frontend',
    'vue': 'frontend',
    'angular': 'frontend',
    'node': 'backend',
    'python': 'backend',
    'docker': 'devops',
    'kubernetes': 'devops',
    'machine-learning': 'ai',
    'deep-learning': 'ai',
    'quantum': 'quantum-computing',
    'blockchain': 'blockchain',
  };
  
  return domainMap[keyword.toLowerCase()] || 'general';
}

/**
 * 计算优先级
 */
function calculatePriority(keyword: string, confidence: number): number {
  // 基础优先级
  let priority = 1 - confidence;
  
  // 热门技术加分
  const hotTechs = ['ai', 'machine-learning', 'react', 'python', 'docker'];
  if (hotTechs.some(t => keyword.includes(t))) {
    priority += 0.2;
  }
  
  // 长关键词（更具体）加分
  if (keyword.length > 10) {
    priority += 0.1;
  }
  
  return Math.min(priority, 1);
}

/**
 * 生成搜索关键词
 */
function generateSearchKeywords(concept: string): string[] {
  const keywords = [concept];
  
  // 添加变体
  keywords.push(`${concept} tutorial`);
  keywords.push(`${concept} best practices`);
  keywords.push(`${concept} github`);
  
  // 如果是中文，添加英文搜索
  if (/[\u4e00-\u9fa5]/.test(concept)) {
    // 保持原样，让翻译层处理
  }
  
  return keywords;
}

/**
 * 计算整体覆盖率
 */
function calculateCoverage(gaps: KnowledgeGap[]): number {
  if (gaps.length === 0) return 1;
  
  const totalConfidence = gaps.reduce((sum, g) => sum + g.confidence, 0);
  return totalConfidence / gaps.length;
}

/**
 * 确定推荐行动
 */
function determineAction(gaps: KnowledgeGap[], coverage: number): 'explore' | 'proceed' | 'clarify' {
  if (gaps.length === 0 || coverage > 0.8) {
    return 'proceed';  // 知识充足，直接执行
  }
  
  if (gaps.some(g => g.priority > 0.8)) {
    return 'explore';  // 有高优先级缺口，需要探索
  }
  
  return 'clarify';  // 需要澄清需求
}

// 工具函数：快速检测是否需要探索
export async function shouldExplore(task: string): Promise<boolean> {
  const result = await detectKnowledgeGaps(task);
  return result.recommendedAction === 'explore';
}
