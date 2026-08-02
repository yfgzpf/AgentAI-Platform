/**
 * Evolution Vector Search — 进化记忆向量语义搜索
 * ----------------------------------------------------
 * 使用文本嵌入实现语义召回，提升进化记忆匹配准确率
 * 
 * 优化目标: 召回准确率提升30%+
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EvolutionEntry, readEvolution } from './evolution.js';

// 嵌入向量缓存
interface EmbeddingCache {
  text: string;
  embedding: number[];
  ts: number;
}

const CACHE_FILE = path.join(os.homedir(), '.agentai', 'evolution', 'embeddings-cache.json');
const EMBEDDING_DIM = 384; // 使用轻量级嵌入模型

// 简单的向量数据库
class VectorStore {
  private entries: Array<{ entry: EvolutionEntry; embedding: number[] }> = [];
  private cache: Map<string, EmbeddingCache> = new Map();

  constructor() {
    this.loadCache();
  }

  // 加载缓存
  private loadCache(): void {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        this.cache = new Map(Object.entries(data));
        console.log(`[vector-search] Loaded ${this.cache.size} cached embeddings`);
      }
    } catch (e) {
      console.warn('[vector-search] Failed to load cache:', e);
    }
  }

  // 保存缓存
  private saveCache(): void {
    try {
      const dir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = Object.fromEntries(this.cache);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8');
    } catch (e) {
      console.warn('[vector-search] Failed to save cache:', e);
    }
  }

  // 生成嵌入向量 (使用本地轻量级模型或API)
  async generateEmbedding(text: string): Promise<number[]> {
    // 检查缓存
    const cached = this.cache.get(text);
    if (cached) return cached.embedding;

    // 使用简单的词袋模型 + 哈希作为降级方案
    // 实际部署时可替换为: OpenAI text-embedding-3-small 或本地模型
    const embedding = this.simpleEmbedding(text);
    
    // 缓存
    this.cache.set(text, { text, embedding, ts: Date.now() });
    this.saveCache();
    
    return embedding;
  }

  // 简单嵌入实现 (基于词频哈希)
  private simpleEmbedding(text: string): number[] {
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const words = normalized.split(/\s+/).filter(w => w.length > 2);
    
    const embedding = new Array(EMBEDDING_DIM).fill(0);
    
    for (const word of words) {
      // 简单的哈希分布
      for (let i = 0; i < word.length; i++) {
        const charCode = word.charCodeAt(i);
        const idx = charCode % EMBEDDING_DIM;
        embedding[idx] += (charCode / 255) * (1 / word.length);
      }
    }
    
    // L2归一化
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return norm > 0 ? embedding.map(v => v / norm) : embedding;
  }

  // 余弦相似度
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
  }

  // 索引进化记录
  async indexEntries(entries: EvolutionEntry[]): Promise<void> {
    this.entries = [];
    
    for (const entry of entries) {
      const text = `${entry.type} ${entry.content} ${entry.keywords?.join(' ') || ''}`;
      const embedding = await this.generateEmbedding(text);
      this.entries.push({ entry, embedding });
    }
    
    console.log(`[vector-search] Indexed ${this.entries.length} entries`);
  }

  // 语义搜索
  async search(query: string, topK: number = 10, threshold: number = 0.6): Promise<Array<{ entry: EvolutionEntry; score: number }>> {
    if (this.entries.length === 0) {
      await this.indexEntries(readEvolution(200));
    }

    const queryEmbedding = await this.generateEmbedding(query);
    
    const results = this.entries
      .map(({ entry, embedding }) => ({
        entry,
        score: this.cosineSimilarity(queryEmbedding, embedding)
      }))
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    
    return results;
  }

  // 混合搜索 (语义 + 关键词)
  async hybridSearch(query: {
    text: string;
    taskType?: string;
    keywords?: string[];
  }, topK: number = 10): Promise<Array<{ entry: EvolutionEntry; score: number; matchType: 'semantic' | 'keyword' | 'both' }>> {
    
    // 语义搜索结果
    const semanticResults = await this.search(query.text, topK * 2, 0.5);
    const semanticMap = new Map(semanticResults.map(r => [r.entry.ts, r]));
    
    // 关键词匹配
    const allEntries = readEvolution(200);
    const keywordResults = allEntries
      .filter(e => {
        if (query.taskType && e.taskType !== query.taskType) return false;
        if (query.keywords?.length) {
          return query.keywords.some(k => 
            e.keywords?.includes(k) || 
            e.content?.toLowerCase().includes(k.toLowerCase())
          );
        }
        return true;
      })
      .map(entry => ({
        entry,
        score: semanticMap.get(entry.ts)?.score || 0.3,
        matchType: 'keyword' as const
      }));
    
    // 合并结果
    const merged = new Map<number, { entry: EvolutionEntry; score: number; matchType: 'semantic' | 'keyword' | 'both' }>();
    
    for (const r of semanticResults) {
      merged.set(r.entry.ts, { ...r, matchType: 'semantic' });
    }
    
    for (const r of keywordResults) {
      const existing = merged.get(r.entry.ts);
      if (existing) {
        existing.score = Math.max(existing.score, r.score) + 0.1; // 双重匹配加分
        existing.matchType = 'both';
      } else {
        merged.set(r.entry.ts, r);
      }
    }
    
    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

// 单例
let vectorStore: VectorStore | null = null;

export function getVectorStore(): VectorStore {
  if (!vectorStore) {
    vectorStore = new VectorStore();
  }
  return vectorStore;
}

// 导出搜索函数 (替换原有的recallEvolution)
export async function recallEvolutionVector(query: {
  taskDescription: string;
  taskType?: string;
  keywords?: string[];
  limit?: number;
}): Promise<EvolutionEntry[]> {
  const store = getVectorStore();
  const results = await store.hybridSearch({
    text: query.taskDescription,
    taskType: query.taskType,
    keywords: query.keywords
  }, query.limit || 10);
  
  console.log(`[vector-search] Found ${results.length} relevant entries (semantic + keyword)`);
  
  return results.map(r => r.entry);
}

// 兼容性导出 (保持原有API)
export { VectorStore };
