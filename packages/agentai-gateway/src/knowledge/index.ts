/**
 * 知识探索与蒸馏系统 - Knowledge Exploration & Distillation System
 * 导出所有知识相关模块
 */

export { detectKnowledgeGaps, shouldExplore } from './gap-detector.js';
export type { KnowledgeGap, GapAnalysisResult } from './gap-detector.js';

export { exploreGitHub, quickExplore } from './github-explorer.js';
export type { Repository, RepositoryQuality, ExplorationResult } from './github-explorer.js';

export { distillFromRepository, distillFromMultiple } from './distiller.js';
export type { 
  KnowledgeNode, 
  CodeExample, 
  KnowledgeRelationship, 
  KnowledgeSource,
  DistillationResult 
} from './distiller.js';
