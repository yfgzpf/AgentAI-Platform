/**
 * Industry Knowledge Base — 本地 BM25 检索引擎
 * ----------------------------------------------------
 * 让用户上传行业文档（txt/md/pdf），自动分块存储，
 * AI 在回答时自动检索相关段落作为参考。
 *
 * 不需要外部嵌入 API，纯本地 TF-IDF + BM25 评分。
 *
 * 存储: ~/.agentai/industry-knowledge/
 *   - index.json       ← 文档索引 (docId → metadata)
 *   - chunks.jsonl     ← 所有分块 (docId, index, text)
 *   - bm25.json        ← 预计算 BM25 参数 (DF, avgDL)
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

// ====== 配置 ======
const KB_DIR = path.join(os.homedir(), '.agentai', 'industry-knowledge');
const INDEX_FILE = path.join(KB_DIR, 'index.json');
const CHUNKS_FILE = path.join(KB_DIR, 'chunks.jsonl');
const BM25_FILE = path.join(KB_DIR, 'bm25.json');

const CHUNK_SIZE = 500;   // 每块最大字符数
const CHUNK_OVERLAP = 80; // 块之间重叠字符数

// ====== 类型定义 ======

export interface KbDocument {
  id: string;
  name: string;
  industry: string;
  addedAt: number;
  charCount: number;
  chunkCount: number;
  source?: string;     // 'upload' | 'auto_discover'
  description?: string; // 用户可填写的描述
}

export interface KbChunk {
  docId: string;
  idx: number;
  text: string;
  industry: string;
}

export interface SearchResult {
  chunk: KbChunk;
  score: number;
  docName: string;
}

interface Bm25Params {
  /** document frequency: term → DF */
  df: Record<string, number>;
  /** total number of documents (chunks) */
  totalChunks: number;
  /** average chunk length in words */
  avgDocLen: number;
}

// ====== BM25 引擎 ======

class Bm25Engine {
  private params: Bm25Params = { df: {}, totalChunks: 0, avgDocLen: 1 };
  private k1 = 1.5;
  private b = 0.75;

  load(): void {
    try {
      if (fs.existsSync(BM25_FILE)) {
        this.params = JSON.parse(fs.readFileSync(BM25_FILE, 'utf-8'));
      }
    } catch { /* use defaults */ }
  }

  save(): void {
    try {
      fs.mkdirSync(KB_DIR, { recursive: true });
      fs.writeFileSync(BM25_FILE, JSON.stringify(this.params), 'utf-8');
    } catch { /* silent */ }
  }

  /** 重建 BM25 参数（添加文档时调用） */
  rebuild(chunks: KbChunk[]): void {
    const df: Record<string, number> = {};
    let totalLen = 0;

    for (const ch of chunks) {
      const terms = this._tokenize(ch.text);
      const unique = new Set(terms);
      for (const t of unique) {
        df[t] = (df[t] || 0) + 1;
      }
      totalLen += terms.length;
    }

    this.params = {
      df,
      totalChunks: chunks.length,
      avgDocLen: chunks.length > 0 ? totalLen / chunks.length : 1,
    };
    this.save();
  }

  /** 搜索: 返回 topK 得分结果 */
  search(query: string, chunks: KbChunk[], topK: number = 5): Array<{ chunkIdx: number; score: number }> {
    const queryTerms = this._tokenize(query);
    if (queryTerms.length === 0) return [];

    // 去重 query terms, 同时保留原始频次
    const qTermCounts: Record<string, number> = {};
    for (const t of queryTerms) {
      qTermCounts[t] = (qTermCounts[t] || 0) + 1;
    }
    const uniqueQueryTerms = Object.keys(qTermCounts);

    const N = this.params.totalChunks;
    const avgDL = this.params.avgDocLen;

    // 对每个 chunk 打分
    const scores: Array<{ chunkIdx: number; score: number }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i]!;
      const terms = this._tokenize(ch.text);
      const docLen = terms.length;

      // 统计 term 在 doc 中的频次
      const tf: Record<string, number> = {};
      for (const t of terms) {
        tf[t] = (tf[t] || 0) + 1;
      }

      let score = 0;
      for (const qt of uniqueQueryTerms) {
        const df = this.params.df[qt] || 0;
        if (df === 0) continue;

        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const termTf = tf[qt] || 0;
        const numerator = termTf * (this.k1 + 1);
        const denominator = termTf + this.k1 * (1 - this.b + this.b * (docLen / avgDL));
        score += idf * (numerator / denominator);
      }

      if (score > 0) {
        scores.push({ chunkIdx: i, score });
      }
    }

    // 按分数降序
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  private _tokenize(text: string): string[] {
    // 中文: 单字分词; 英文: 小写空格分词
    const tokens: string[] = [];

    // 提取中文汉字 (单字)
    const chineseChars = text.match(/[\u4e00-\u9fff]/g);
    if (chineseChars) tokens.push(...chineseChars);

    // 提取英文单词 (小写, 去停用词)
    const engWords = text.toLowerCase().match(/\b[a-z]{2,}\b/g);
    if (engWords) {
      const stopWords = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
        'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
        'would', 'could', 'should', 'may', 'might', 'can', 'shall',
        'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
        'as', 'into', 'through', 'during', 'before', 'after', 'above',
        'below', 'between', 'out', 'off', 'over', 'under', 'again',
        'further', 'then', 'once', 'here', 'there', 'when', 'where',
        'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
        'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
        'own', 'same', 'so', 'than', 'too', 'very', 'just', 'about',
        'and', 'but', 'or', 'if', 'because', 'until', 'while',
        'of', 'this', 'that', 'it', 'its',
      ]);
      tokens.push(...engWords.filter(w => !stopWords.has(w) && w.length > 1));
    }

    // 提取数字 + 单位 (如 "800×800", "45元/m²")
    const measurements = text.match(/\d+(?:[×.]\d+)?(?:[元%°])/g);
    if (measurements) tokens.push(...measurements);

    return tokens;
  }
}

// ====== 知识库管理器 ======

class IndustryKnowledgeBase {
  private documents: Map<string, KbDocument> = new Map();
  private chunks: KbChunk[] = [];
  private bm25: Bm25Engine;
  private dirty = false;

  constructor() {
    this.bm25 = new Bm25Engine();
    this._load();
  }

  // ---- 公开 API ----

  /** 上传文本并建立索引 */
  addTextDocument(
    name: string,
    text: string,
    industry: string,
    source: string = 'upload',
    description?: string,
  ): KbDocument {
    const id = `kb-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const newChunks = this._chunkText(text, id, industry);

    const doc: KbDocument = {
      id,
      name,
      industry,
      addedAt: Date.now(),
      charCount: text.length,
      chunkCount: newChunks.length,
      source,
      description,
    };

    // 追加到全局
    this.documents.set(id, doc);
    this.chunks.push(...newChunks);

    // 重新计算 BM25
    this.bm25.rebuild(this.chunks);
    this.dirty = true;
    this._saveIndex();
    this._saveChunks();

    return doc;
  }

  /** 删除文档及其分块 */
  removeDocument(docId: string): boolean {
    if (!this.documents.has(docId)) return false;
    this.documents.delete(docId);
    this.chunks = this.chunks.filter(c => c.docId !== docId);
    this.bm25.rebuild(this.chunks);
    this.dirty = true;
    this._saveIndex();
    this._saveChunks();
    return true;
  }

  /** 搜索知识库 */
  search(query: string, industry?: string, topK: number = 5): SearchResult[] {
    // 过滤行业
    let candidates = this.chunks;
    if (industry) {
      candidates = candidates.filter(c => c.industry === industry);
    }
    if (candidates.length === 0) return [];

    const results = this.bm25.search(query, candidates, topK);
    return results.map(r => {
      const ch = candidates[r.chunkIdx]!;
      const doc = this.documents.get(ch.docId);
      return {
        chunk: ch,
        score: r.score,
        docName: doc?.name || ch.docId,
      };
    });
  }

  /** 构建系统提示注入片段 */
  buildSystemPromptFragment(query: string, industry?: string, maxChunks: number = 3): string {
    const results = this.search(query, industry, maxChunks);
    if (results.length === 0) return '';

    const parts = results.map(r =>
      `[${r.docName}] (相关度 ${r.score.toFixed(2)})\n${r.chunk.text.trim().slice(0, 300)}`
    );

    return `\n# 行业知识库参考\n以下是与当前任务相关的行业文档片段:\n\n${parts.join('\n\n---\n\n')}\n`;
  }

  /** 列出所有文档 */
  listDocuments(industry?: string): KbDocument[] {
    const all = Array.from(this.documents.values());
    if (industry) return all.filter(d => d.industry === industry);
    return all;
  }

  /** 获取统计信息 */
  getStats(): { docCount: number; chunkCount: number; industries: string[] } {
    const industries = [...new Set(this.chunks.map(c => c.industry))];
    return {
      docCount: this.documents.size,
      chunkCount: this.chunks.length,
      industries,
    };
  }

  // ---- 内部方法 ----

  private _chunkText(text: string, docId: string, industry: string): KbChunk[] {
    // 先按段落拆分，再合并成 500 字符的块
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const chunks: KbChunk[] = [];
    let current = '';
    let idx = 0;

    for (const para of paragraphs) {
      if (current.length + para.length > CHUNK_SIZE && current.length > 0) {
        chunks.push({ docId, idx: idx++, text: current.trim(), industry });
        // 保留重叠部分
        current = current.slice(-CHUNK_OVERLAP) + '\n' + para;
      } else {
        current += (current ? '\n\n' : '') + para;
      }
    }

    if (current.trim().length > 0) {
      chunks.push({ docId, idx: idx++, text: current.trim(), industry });
    }

    // 如果内容太短，作为一个单独块
    if (chunks.length === 0 && text.trim().length > 0) {
      chunks.push({ docId, idx: 0, text: text.trim(), industry });
    }

    return chunks;
  }

  private _load(): void {
    // 加载索引
    try {
      if (fs.existsSync(INDEX_FILE)) {
        const docs: KbDocument[] = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
        for (const d of docs) this.documents.set(d.id, d);
      }
    } catch { /* first run */ }

    // 加载分块
    try {
      if (fs.existsSync(CHUNKS_FILE)) {
        const content = fs.readFileSync(CHUNKS_FILE, 'utf-8');
        this.chunks = content.split('\n')
          .filter(l => l.trim())
          .map(l => JSON.parse(l));
      }
    } catch { /* first run */ }

    // 加载 BM25
    this.bm25.load();
  }

  private _saveIndex(): void {
    try {
      fs.mkdirSync(KB_DIR, { recursive: true });
      const docs = Array.from(this.documents.values());
      fs.writeFileSync(INDEX_FILE, JSON.stringify(docs, null, 2), 'utf-8');
    } catch { /* silent */ }
  }

  private _saveChunks(): void {
    try {
      fs.mkdirSync(KB_DIR, { recursive: true });
      const lines = this.chunks.map(c => JSON.stringify(c)).join('\n');
      fs.writeFileSync(CHUNKS_FILE, lines + '\n', 'utf-8');
    } catch { /* silent */ }
  }
}

// ====== 全局单例 ======

let _kb: IndustryKnowledgeBase | null = null;

export function getKnowledgeBase(): IndustryKnowledgeBase {
  if (!_kb) {
    _kb = new IndustryKnowledgeBase();
  }
  return _kb;
}

// 清理（用于测试）
export function _resetKb(): void {
  _kb = null;
}
