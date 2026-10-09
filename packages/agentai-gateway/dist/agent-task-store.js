/**
 * AgentTaskStore — 持久任务板
 * ============================
 * 对标 Trae TodoWrite 的功能: 在任务执行过程中实时更新任务清单,
 * 实现跨会话的任务连续性 + 下一步引导
 *
 * 核心能力:
 *   1. 任务状态机: pending → running → done / failed
 *   2. 实时 SSE: agent:task:updated 推送给前端
 *   3. 任务摘要注入: 新会话开始时读取最近任务, 注入 system prompt
 *   4. 下一步引导: 任务完成后自动生成下一个推荐任务
 */
import { EventEmitter } from 'events';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
import * as fs from 'fs';
import * as path from 'path';
// ===== Singleton =====
let _instance = null;
const DB_PATH = path.join(process.cwd(), 'data', 'agent-tasks.db');
export class AgentTaskStore extends EventEmitter {
    db;
    ready = false;
    constructor() {
        super();
        this.db = this._open();
    }
    static getInstance(workspace) {
        if (!_instance) {
            _instance = new AgentTaskStore();
            _instance._migrate(workspace);
            _instance.ready = true;
        }
        return _instance;
    }
    // ── 数据库初始化 ──
    _open() {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        const db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.exec(`
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'pending',
        workspace   TEXT NOT NULL,
        created_by  TEXT NOT NULL DEFAULT 'ai',
        parent_id   TEXT,
        tags        TEXT DEFAULT '[]',
        next_step_hint TEXT,
        result      TEXT,
        error       TEXT,
        created_at  INTEGER NOT NULL,
        started_at  INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_status ON agent_tasks(status, workspace);
      CREATE INDEX IF NOT EXISTS idx_created ON agent_tasks(created_at DESC);
    `);
        return db;
    }
    _migrate(workspace) {
        const count = this.db.prepare('SELECT COUNT(*) as c FROM agent_tasks WHERE workspace = ?').get(workspace);
        if (count.c === 0) {
            // 首次创建时写入"初始化任务"
            const initTasks = [
                {
                    id: this._genId(),
                    title: '系统健康检查',
                    description: '检查所有服务状态、模型连接、数据库健康',
                    status: 'pending',
                    workspace,
                    createdBy: 'system',
                    tags: ['system', 'health'],
                    createdAt: Date.now(),
                },
                {
                    id: this._genId(),
                    title: '依赖完整性验证',
                    description: '验证所有 npm/pnpm 依赖已安装且版本兼容',
                    status: 'pending',
                    workspace,
                    createdBy: 'system',
                    tags: ['devops', 'build'],
                    createdAt: Date.now() + 1,
                },
            ];
            const insert = this.db.prepare(`
        INSERT OR IGNORE INTO agent_tasks (id, title, description, status, workspace, created_by, tags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
            for (const t of initTasks) {
                insert.run(t.id, t.title, t.description, t.status, t.workspace, t.createdBy, JSON.stringify(t.tags), t.createdAt);
            }
        }
    }
    _genId() {
        return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    // ── CRUD ──
    create(task) {
        const now = Date.now();
        const id = this._genId();
        const full = { ...task, id, createdAt: now };
        this.db.prepare(`
      INSERT INTO agent_tasks (id, title, description, status, workspace, created_by, parent_id, tags, next_step_hint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(full.id, full.title, full.description || null, full.status, full.workspace, full.createdBy, full.parentId || null, JSON.stringify(full.tags), full.nextStepHint || null, full.createdAt);
        this._emit('task:created', full);
        return full;
    }
    update(id, patch) {
        const existing = this.get(id);
        if (!existing)
            return null;
        const updates = [];
        const values = [];
        const merged = { ...existing };
        for (const [key, val] of Object.entries(patch)) {
            if (val === undefined || val === null)
                continue;
            if (key === 'tags') {
                updates.push('tags = ?');
                values.push(JSON.stringify(val));
            }
            else if (key === 'description' || key === 'result' || key === 'nextStepHint' || key === 'parentId') {
                updates.push(`${key} = ?`);
                values.push(val);
            }
            else {
                updates.push(`${key} = ?`);
                values.push(val);
            }
            merged[key] = val;
        }
        if (patch.status === 'running' && !merged.startedAt)
            merged.startedAt = Date.now();
        if (patch.status === 'done' || patch.status === 'failed')
            merged.completedAt = Date.now();
        updates.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);
        this.db.prepare(`UPDATE agent_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        this._emit('task:updated', merged);
        return merged;
    }
    get(id) {
        const row = this.db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id);
        return row ? this._deserialize(row) : null;
    }
    list(filter = {}) {
        let sql = 'SELECT * FROM agent_tasks WHERE 1=1';
        const params = [];
        if (filter.workspace) {
            sql += ' AND workspace = ?';
            params.push(filter.workspace);
        }
        if (filter.status) {
            sql += ' AND status = ?';
            params.push(filter.status);
        }
        sql += ' ORDER BY created_at DESC';
        if (filter.limit) {
            sql += ' LIMIT ?';
            params.push(filter.limit);
        }
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(r => this._deserialize(r));
    }
    countByStatus(workspace) {
        const rows = this.db.prepare("SELECT status, COUNT(*) as c FROM agent_tasks WHERE workspace = ? GROUP BY status").all(workspace);
        const result = { pending: 0, running: 0, done: 0, failed: 0 };
        for (const r of rows)
            result[r.status] = r.c;
        return result;
    }
    // ── 会话级: 读取最近任务注入 context ──
    getRecentTasks(workspace, limit = 10) {
        return this.list({ workspace, status: 'done', limit });
    }
    getActiveTasks(workspace) {
        return this.list({ workspace, status: 'running' });
    }
    getNextSteps(workspace) {
        // 从最近完成的任务的 nextStepHint 中提取
        const recent = this.list({ workspace, status: 'done', limit: 5 });
        const steps = recent
            .filter(t => t.nextStepHint)
            .map(t => `→ ${t.nextStepHint}`)
            .slice(0, 3);
        return steps;
    }
    // ── 任务完成 → 自动引导下一步 ──
    completeWithNextSteps(taskId, result, workspace, nextStepTitle, nextStepDesc) {
        const task = this.update(taskId, { status: 'done', result });
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        // 自动创建下一个任务
        const nextTask = this.create({
            title: nextStepTitle,
            description: nextStepDesc || `承接 "${task.title}" 的后续工作`,
            status: 'pending',
            workspace,
            createdBy: 'ai',
            parentId: taskId,
            tags: task.tags,
            nextStepHint: '检查下一步任务状态',
        });
        const nextSteps = [`✅ ${task.title} 完成`, `📋 下一步: ${nextTask.title} (${nextTask.id})`];
        this._emit('task:completed', { task, nextSteps });
        return nextTask;
    }
    failWithHint(taskId, error, hint) {
        const task = this.update(taskId, { status: 'failed', result: `失败: ${error}` });
        if (hint && task) {
            task.nextStepHint = hint;
            this._emit('task:failed', { task, error });
        }
        return task;
    }
    // ── 清理 ──
    cleanupOld(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
        const cutoff = Date.now() - maxAgeMs;
        const result = this.db.prepare('DELETE FROM agent_tasks WHERE completed_at < ? AND status IN (\'done\', \'failed\')').run(cutoff);
        return result.changes;
    }
    // ── SSE 事件 ──
    _emit(event, data) {
        this.emit(event, data);
    }
    _deserialize(row) {
        return {
            ...row,
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
            createdAt: row.created_at,
            startedAt: row.started_at,
            completedAt: row.completed_at,
        };
    }
    close() {
        this.db.close();
        _instance = null;
    }
}
// ===== SSE Stream Handler =====
export function createAgentTaskStream(res, workspace) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const store = AgentTaskStore.getInstance(workspace);
    const send = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const handlers = [
        ['task:created', (t) => send('agent_task:created', t)],
        ['task:updated', (t) => send('agent_task:updated', t)],
        ['task:completed', (d) => send('agent_task:completed', d)],
        ['task:failed', (d) => send('agent_task:failed', d)],
    ];
    for (const [event, handler] of handlers) {
        store.on(event, handler);
    }
    res.on('close', () => {
        for (const [event, handler] of handlers) {
            store.off(event, handler);
        }
    });
    return store;
}
