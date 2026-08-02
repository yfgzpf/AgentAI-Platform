/**
 * GitHub 探索器 - GitHub Explorer
 * 自动搜索和评估 GitHub 仓库
 */

import { webSearch } from '../web-search.js';

export interface Repository {
  name: string;
  owner: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  lastUpdated: string;
  language: string;
  topics: string[];
  readmeContent?: string;
  quality: RepositoryQuality;
}

export interface RepositoryQuality {
  knowledgeDensity: number;  // 知识密度 0-1
  documentation: number;     // 文档质量 0-1
  codeQuality: number;       // 代码质量 0-1
  activity: number;          // 活跃度 0-1
  teachingValue: number;     // 教学价值 0-1
  overall: number;           // 综合评分 0-1
}

export interface ExplorationResult {
  query: string;
  repositories: Repository[];
  totalFound: number;
  explorationTime: number;
}

/**
 * 探索 GitHub 仓库
 */
export async function exploreGitHub(
  keywords: string[],
  maxResults: number = 5
): Promise<ExplorationResult> {
  const startTime = Date.now();
  
  // 构建搜索查询
  const query = buildSearchQuery(keywords);
  
  // 执行搜索
  const searchResults = await searchRepositories(query, maxResults * 2);
  
  // 获取详细信息
  const repositories = await Promise.all(
    searchResults.slice(0, maxResults).map(repo => analyzeRepository(repo))
  );
  
  // 按质量排序
  repositories.sort((a, b) => b.quality.overall - a.quality.overall);
  
  return {
    query,
    repositories,
    totalFound: searchResults.length,
    explorationTime: Date.now() - startTime,
  };
}

/**
 * 构建搜索查询
 */
function buildSearchQuery(keywords: string[]): string {
  // GitHub 搜索语法
  const baseQuery = keywords.join(' ');
  
  // 添加质量过滤器
  const qualityFilters = [
    'stars:>10',           // 至少 10 个 star
    'language:TypeScript OR language:JavaScript OR language:Python',
    'sort:stars',
  ];
  
  return `${baseQuery} ${qualityFilters.join(' ')}`;
}

/**
 * 搜索仓库
 */
async function searchRepositories(query: string, limit: number): Promise<any[]> {
  // 使用 web_search 工具搜索 GitHub
  const searchQuery = `site:github.com ${query}`;
  
  const searchResult = await webSearch(searchQuery, {
    topK: limit,
  });
  
  // 解析搜索结果
  const repos = parseSearchResults(searchResult);
  
  return repos;
}

/**
 * 解析搜索结果
 */
function parseSearchResults(searchResults: any[]): any[] {
  // 从搜索结果中提取 GitHub 仓库链接
  const repos: any[] = [];
  
  for (const result of searchResults) {
    if (result.url) {
      // 解析 GitHub URL
      const match = result.url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/\s]+)/);
      if (match) {
        repos.push({
          owner: match[1],
          name: match[2].replace(/\/$/, ''),  // 移除尾部斜杠
          url: result.url,
          description: result.snippet || '',
        });
      }
    }
  }
  
  // 去重
  const seen = new Set<string>();
  return repos.filter(repo => {
    const key = `${repo.owner}/${repo.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 分析仓库质量
 */
async function analyzeRepository(repo: any): Promise<Repository> {
  // 获取 README 内容
  const readmeContent = await fetchReadme(repo.owner, repo.name);
  
  // 计算各项质量指标
  const quality = calculateQuality(repo, readmeContent);
  
  return {
    name: repo.name,
    owner: repo.owner,
    url: `https://github.com/${repo.owner}/${repo.name}`,
    description: repo.description || '',
    stars: repo.stars || 0,
    forks: repo.forks || 0,
    lastUpdated: repo.lastUpdated || '',
    language: repo.language || '',
    topics: repo.topics || [],
    readmeContent,
    quality,
  };
}

/**
 * 获取 README 内容
 */
async function fetchReadme(owner: string, name: string): Promise<string> {
  try {
    // 使用 web_search 获取内容
    const results = await webSearch(
      `site:raw.githubusercontent.com ${owner}/${name} README`,
      { topK: 1 }
    );
    
    if (results && results.length > 0) {
      return (results[0].snippet || '').slice(0, 10000);  // 限制长度
    }
    
    return '';
  } catch (error) {
    return '';
  }
}

/**
 * 计算仓库质量
 */
function calculateQuality(repo: any, readmeContent: string): RepositoryQuality {
  // 知识密度：README 长度 + 代码示例数量
  const knowledgeDensity = calculateKnowledgeDensity(readmeContent);
  
  // 文档质量：README 结构完整性
  const documentation = calculateDocumentationQuality(readmeContent);
  
  // 代码质量：基于 star/fork 比例和语言
  const codeQuality = calculateCodeQuality(repo);
  
  // 活跃度：最近更新时间
  const activity = calculateActivity(repo.lastUpdated);
  
  // 教学价值：示例、教程、注释
  const teachingValue = calculateTeachingValue(readmeContent);
  
  // 综合评分
  const overall = weightedAverage([
    knowledgeDensity * 0.4,
    documentation * 0.3,
    codeQuality * 0.2,
    activity * 0.05,
    teachingValue * 0.05,
  ]);
  
  return {
    knowledgeDensity,
    documentation,
    codeQuality,
    activity,
    teachingValue,
    overall,
  };
}

/**
 * 计算知识密度
 */
function calculateKnowledgeDensity(readme: string): number {
  if (!readme) return 0;
  
  const length = readme.length;
  const codeBlocks = (readme.match(/```/g) || []).length / 2;
  const sections = (readme.match(/^#{1,3}\s/mg) || []).length;
  
  // 长度分数 (0-0.4)
  const lengthScore = Math.min(length / 5000, 1) * 0.4;
  
  // 代码示例分数 (0-0.3)
  const codeScore = Math.min(codeBlocks / 5, 1) * 0.3;
  
  // 章节结构分数 (0-0.3)
  const sectionScore = Math.min(sections / 5, 1) * 0.3;
  
  return lengthScore + codeScore + sectionScore;
}

/**
 * 计算文档质量
 */
function calculateDocumentationQuality(readme: string): number {
  if (!readme) return 0;
  
  const hasInstallation = /install|setup|getting.started/i.test(readme);
  const hasUsage = /usage|example|quick.start/i.test(readme);
  const hasAPI = /api|documentation|reference/i.test(readme);
  const hasContributing = /contributing|development/i.test(readme);
  
  let score = 0;
  if (hasInstallation) score += 0.3;
  if (hasUsage) score += 0.3;
  if (hasAPI) score += 0.2;
  if (hasContributing) score += 0.2;
  
  return score;
}

/**
 * 计算代码质量
 */
function calculateCodeQuality(repo: any): number {
  const stars = repo.stars || 0;
  const forks = repo.forks || 0;
  
  // Star 分数 (0-0.5)
  const starScore = Math.min(Math.log10(stars + 1) / 4, 1) * 0.5;
  
  // Fork 比例分数 (0-0.3)
  const forkRatio = forks / (stars + 1);
  const forkScore = Math.min(forkRatio * 10, 1) * 0.3;
  
  // 语言分数 (0-0.2)
  const popularLangs = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust'];
  const langScore = popularLangs.includes(repo.language) ? 0.2 : 0.1;
  
  return starScore + forkScore + langScore;
}

/**
 * 计算活跃度
 */
function calculateActivity(lastUpdated: string): number {
  if (!lastUpdated) return 0;
  
  const lastUpdate = new Date(lastUpdated);
  const now = new Date();
  const daysDiff = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
  
  if (daysDiff < 7) return 1;
  if (daysDiff < 30) return 0.8;
  if (daysDiff < 90) return 0.6;
  if (daysDiff < 180) return 0.4;
  if (daysDiff < 365) return 0.2;
  return 0.1;
}

/**
 * 计算教学价值
 */
function calculateTeachingValue(readme: string): number {
  if (!readme) return 0;
  
  const hasTutorial = /tutorial|guide|step.by.step/i.test(readme);
  const hasExamples = /example|demo|sample/i.test(readme);
  const hasExplanation = /how.*works|architecture|design/i.test(readme);
  
  let score = 0;
  if (hasTutorial) score += 0.4;
  if (hasExamples) score += 0.4;
  if (hasExplanation) score += 0.2;
  
  return score;
}

/**
 * 加权平均
 */
function weightedAverage(values: number[]): number {
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.min(Math.max(sum, 0), 1);
}

// 快速探索函数
export async function quickExplore(
  concept: string,
  maxResults: number = 3
): Promise<Repository[]> {
  const result = await exploreGitHub([concept], maxResults);
  return result.repositories;
}
