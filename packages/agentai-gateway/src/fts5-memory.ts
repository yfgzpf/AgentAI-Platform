/**
 * FTS5Memory — SQLite FTS5 深层记忆检索
 * ----------------------------------------------------------------
 * 学自: Hermes Agent FTS5 session_search_tool.py
 * 
 * 架构:
 *   .agentai/memory.db (SQLite)
 *     ├── sessions (会话元数据)
 *     ├── messages (消息记录)
 *     └── messages_fts (FTS5 虚拟表 + 自动触发器)
 * 
 * 能力:
 *   - 全文搜索跨会话消息
 *   - 按用户/workspace过滤
 *   - 自动摘要匹配会话
 *   - 父子会话链解析
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { EventEmitter } from 'events';
import { createRequire } from 'node:module';

const AGENTAI_DIR = path.join(os.homedir(), '.agentai');
const DB_PATH = path.join(AGENTAI_DIR, 'memory.db');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace TEXT NOT NULL,
  title TEXT,
  model TEXT,
  message_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  parent_session_id TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content=messages,
  content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
`;

export interface MemorySearchResult {
  sessionId: string;
  userId: string;
  workspace: string;
  title?: string;
  matchContent: string;
  matchCount: number;
  created_at: number;
  updated_at: number;
}

interface SqliteDatabase {
  exec(sql: string): void;
  run(sql: string, ...params: any[]): { lastID?: number; changes?: number };
  get(sql: string, ...params: any[]): any;
  all(sql: string, ...params: any[]): any[];
  close(): void;
}

let dbPromise: Promise<SqliteDatabase> | null = null;

async function getDb(): Promise<SqliteDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    try {
      // 尝试通过 createRequire 加载原生模块
      if (typeof createRequire === 'function') {
        const _require = createRequire(import.meta.url);
        const BetterSqlite3 = _require('better-sqlite3');
        const db = new BetterSqlite3(DB_PATH);
        db.pragma('journal_mode=WAL');
        db.pragma('synchronous=NORMAL');
        db.exec(SCHEMA_SQL);
        console.log('[fts5-memory] SQLite initialized, tables ready');
        return {
          exec: (s: string) => db.exec(s),
          run: (s: string, ...p: any[]) => { const stmt = db.prepare(s); return stmt.run(...p); },
          get: (s: string, ...p: any[]) => { const stmt = db.prepare(s); return stmt.get(...p); },
          all: (s: string, ...p: any[]) => { const stmt = db.prepare(s); return stmt.all(...p); },
          close: () => db.close(),
        };
      }
      throw new Error('createRequire not available');
    } catch {
      // JSON 降级: 持久化文件存储 (支持关键词搜索)
      console.log('[fts5-memory] SQLite unavailable, using JSON fallback');
      const memFile = path.join(AGENTAI_DIR, 'memory.json');

      // 从磁盘加载已有数据
      let data: any[] = [];
      try {
        if (fs.existsSync(memFile)) {
          const raw = fs.readFileSync(memFile, 'utf-8').trim();
          if (raw) data = JSON.parse(raw);
        }
      } catch { /* 从头开始 */ }

      // 关键词 tokenizer (简单中文分词)
      function tokenize(text: string): string[] {
        const tokens = new Set<string>();
        // 英文单词
        const enWords = text.toLowerCase().match(/[a-z0-9_]+/g) || [];
        enWords.forEach(w => tokens.add(w));
        // 中文单字 (去除标点)
        const cnChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [];
        cnChars.forEach(c => tokens.add(c));
        // 中文二元组
        for (let i = 0; i < cnChars.length - 1; i++) {
          const a = cnChars[i];
          const b = cnChars[i + 1];
          if (a && b) tokens.add(a + b);
        }
        return [...tokens];
      }

      // 持久化到磁盘
      function persist() {
        try {
          fs.writeFileSync(memFile, JSON.stringify(data));
        } catch { /* 忽略写入失败 */ }
      }

      return {
        exec: () => {},
        run: (sql: string, ...p: any[]) => {
          // INSERT INTO sessions ...
          if (sql.includes('INSERT INTO sessions')) {
            const [id, userId, workspace, title, _mc, createdAt, updatedAt] = p;
            const existing = data.find((d: any) => d.kind === 'session' && d.id === id);
            if (existing) {
              existing.message_count = (existing.message_count || 0) + 1;
              existing.updated_at = updatedAt;
              if (title) existing.title = title;
            } else {
              data.push({
                kind: 'session', id, user_id: userId, workspace,
                title: title || null, message_count: 1,
                created_at: createdAt, updated_at: updatedAt,
              });
            }
            persist();
            return {};
          }
          // INSERT INTO messages ...
          if (sql.includes('INSERT INTO messages')) {
            const [sessionId, role, content, toolName, toolCallId, timestamp] = p;
            const row = {
              kind: 'message', session_id: sessionId, role,
              content: content || '', tool_name: toolName || null,
              tool_call_id: toolCallId || null, timestamp,
              _tokens: tokenize(content || ''),
            };
            data.push(row);
            // 每 20 条消息持久化一次
            if (data.filter((d: any) => d.kind === 'message').length % 20 === 0) persist();
            return {};
          }
          return {};
        },
        get: (_sql: string, ..._p: any[]) => null,
        all: (sql: string, ...p: any[]) => {
          // messages_fts 搜索
          if (sql.includes('messages_fts')) {
            const query = String(p[0] || '');
            const queryTokens = tokenize(query);
            if (queryTokens.length === 0) return [];

            // 找匹配的消息 → 提取 session_id
            const messages = data.filter((d: any) => d.kind === 'message');
            const scored = messages.map((m: any) => {
              const matchTokens = m._tokens?.filter((t: string) => queryTokens.includes(t)) || [];
              return { msg: m, score: matchTokens.length };
            }).filter(x => x.score > 0)
              .sort((a: any, b: any) => b.score - a.score);

            // 返回匹配的 session 结果
            const seenSessions = new Set<string>();
            const results: any[] = [];
            for (const { msg } of scored) {
              const sk = msg.session_id;
              if (seenSessions.has(sk)) continue;
              seenSessions.add(sk);
              const session = data.find((d: any) => d.kind === 'session' && d.id === sk);
              results.push({
                session_id: sk,
                user_id: session?.user_id || '',
                workspace: session?.workspace || '',
                title: session?.title || null,
                match_content: msg.content?.slice(0, 500) || '',
                created_at: session?.created_at || 0,
                updated_at: session?.updated_at || 0,
              });
              if (results.length >= 50) break;
            }
            return results;
          }
          // sessions 查询
          if (sql.includes('FROM sessions')) {
            let results = data.filter((d: any) => d.kind === 'session');
            const userIdIdx = sql.indexOf('user_id = ?');
            if (userIdIdx >= 0) {
              const userIdVal = String(p[0] || '');
              results = results.filter((r: any) => r.user_id === userIdVal);
            }
            // ORDER BY updated_at DESC LIMIT ?
            const limitIdx = sql.lastIndexOf('LIMIT ?');
            const limit = limitIdx >= 0 ? Number(p[p.length - 1]) || 5 : 5;
            return results
              .sort((a: any, b: any) => (b.updated_at || 0) - (a.updated_at || 0))
              .slice(0, limit);
          }
          // messages 查询
          if (sql.includes('FROM messages')) {
            let results = data.filter((d: any) => d.kind === 'message');
            const sessionIdx = sql.indexOf('session_id = ?');
            if (sessionIdx >= 0) results = results.filter((r: any) => r.session_id === String(p[0]));
            const orderDesc = sql.includes('ORDER BY timestamp DESC');
            if (orderDesc) results = results.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
            const limitIdx = sql.lastIndexOf('LIMIT ?');
            if (limitIdx >= 0) results = results.slice(0, Number(p[p.length - 1]));
            return results;
          }
          return [];
        },
        close: () => { persist(); },
      };
    }
  })();
  return dbPromise;
}

export class FTS5Memory extends EventEmitter {
  private db: SqliteDatabase | null = null;
  private ready = false;

  async init(): Promise<void> {
    try {
      // 确保目录存在
      const { mkdirSync, existsSync } = await import('fs');
      if (!existsSync(AGENTAI_DIR)) mkdirSync(AGENTAI_DIR, { recursive: true });
      this.db = await getDb();
      this.ready = true;
      console.log('[fts5-memory] initialized');
    } catch (e: any) {
      console.warn('[fts5-memory] init failed, FTS5 search unavailable:', e.message);
    }
  }

  async recordMessage(opts: {
    sessionId: string;
    userId: string;
    workspace: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolName?: string;
    toolCallId?: string;
    title?: string;
  }): Promise<void> {
    if (!this.ready || !this.db) return;
    try {
      const { sessionId, userId, workspace, role, content, toolName, toolCallId, title } = opts;
      const now = Date.now();

      // 插入或更新 session
      this.db.run(`
        INSERT INTO sessions (id, user_id, workspace, title, message_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          message_count = message_count + 1,
          updated_at = ?,
          title = COALESCE(?, title)
      `, sessionId, userId, workspace, title || null, now, now, now, title || null);

      // 插入消息
      this.db.run(`
        INSERT INTO messages (session_id, role, content, tool_name, tool_call_id, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `, sessionId, role, content?.slice(0, 8000) || '', toolName || null, toolCallId || null, now);
    } catch {}
  }

  async search(
    query: string,
    opts?: { userId?: string; limit?: number; excludeSessionId?: string }
  ): Promise<MemorySearchResult[]> {
    if (!this.ready || !this.db) return [];
    try {
      const limit = opts?.limit ?? 5;

      // FTS5 搜索
      let sql = `
        SELECT DISTINCT m.session_id, s.user_id, s.workspace, s.title,
               m.content as match_content, s.created_at, s.updated_at
        FROM messages_fts ft
        JOIN messages m ON m.id = ft.rowid
        JOIN sessions s ON s.id = m.session_id
        WHERE messages_fts MATCH ?
      `;
      const params: any[] = [query];

      if (opts?.userId) {
        sql += ` AND s.user_id = ?`;
        params.push(opts.userId);
      }
      if (opts?.excludeSessionId) {
        sql += ` AND s.id != ?`;
        params.push(opts.excludeSessionId);
      }

      sql += ` ORDER BY m.timestamp DESC LIMIT ?`;
      params.push(limit * 10);

      const rows = this.db.all(sql, ...params) as any[];

      // 按 session 分组, 计数
      const map = new Map<string, MemorySearchResult>();
      for (const r of rows) {
        const key = r.session_id;
        if (map.has(key)) {
          map.get(key)!.matchCount++;
        } else {
          map.set(key, {
            sessionId: r.session_id,
            userId: r.user_id,
            workspace: r.workspace,
            title: r.title,
            matchContent: r.match_content,
            matchCount: 1,
            created_at: r.created_at,
            updated_at: r.updated_at,
          });
        }
      }

      return [...map.values()]
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  async getRecentSessions(
    userId?: string,
    limit = 5
  ): Promise<Array<{ sessionId: string; title?: string; msgCount: number; updatedAt: number }>> {
    if (!this.ready || !this.db) return [];
    try {
      let sql = `SELECT id, title, message_count, updated_at FROM sessions`;
      const params: any[] = [];
      if (userId) { sql += ` WHERE user_id = ?`; params.push(userId); }
      sql += ` ORDER BY updated_at DESC LIMIT ?`;
      params.push(limit);
      const rows = this.db.all(sql, ...params) as any[];
      return rows.map((r: any) => ({
        sessionId: r.id,
        title: r.title,
        msgCount: r.message_count,
        updatedAt: r.updated_at,
      }));
    } catch { return []; }
  }

  async getSessionSummary(sessionId: string): Promise<string> {
    if (!this.ready || !this.db) return '';
    try {
      const rows = this.db.all(
        `SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 10`,
        sessionId
      ) as any[];
      return rows.map((r: any) => `[${r.role}] ${r.content?.slice(0, 200)}`).join('\n');
    } catch { return ''; }
  }

  async close(): Promise<void> {
    if (this.db) { this.db.close(); this.db = null; }
    this.ready = false;
  }
}

export const fts5Memory = new FTS5Memory();
