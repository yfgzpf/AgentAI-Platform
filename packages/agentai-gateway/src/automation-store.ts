/**
 * AutomationStore — 自动化任务持久化存储 (SQLite)
 * ---------------------------------------------------------------
 * 对标 WorkBuddy SQLite automations 表，提供 cron 任务的完整 CRUD + 重启恢复。
 *
 * 存储: 使用 sql.js (纯 JS SQLite, 零 native 编译依赖)
 * 数据文件: ~/.agentai/automations.db
 * 线程安全: 单例 + 操作队列
 *
 * 2026-06-26 新增 → 升级: JSON 存储 → SQLite (事务安全 + 查询能力)
 * 2026-07-01 修复: create 后自动启动调度 + resumeAll 使用默认 executor
 */


// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./sql-js.d.ts" />

import { EventEmitter } from 'events';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
import { CronJob } from './cron-job.js';

// ═══ 默认 executor (通过 HTTP 调用 gateway /v1/chat) ═══

export type AutomationExecutor = (prompt: string, record: AutomationRecord) => Promise<void>;

let defaultExecutor: AutomationExecutor | null = null;
let defaultGatewayUrl = `http://127.0.0.1:${process.env.AGENTAI_PORT || '18789'}`;

/** 设置默认 executor (供 create 后自动启动 + resumeAll 使用) */
export function setDefaultExecutor(executor: AutomationExecutor): void {
  defaultExecutor = executor;
}

/** 设置默认 gateway URL */
export function setDefaultGatewayUrl(url: string): void {
  defaultGatewayUrl = url;
}

/** 内置 executor: 通过 HTTP 调用 gateway /v1/chat 执行 AI 任务 */
const builtinExecutor: AutomationExecutor = async (prompt, record) => {
  const resp = await fetch(`${defaultGatewayUrl}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt,
      sessionId: `automation-${record.id}`,
      auto: true,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Automation HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
};

// ═══ 数据模型 ═══

export type AutomationStatus = 'ACTIVE' | 'PAUSED';
export type ScheduleType = 'recurring' | 'once';

export interface AutomationRecord {
  id: string;
  name: string;
  prompt: string;
  scheduleType: ScheduleType;
  rrule?: string;
  scheduledAt?: string;
  validFrom?: string;
  validUntil?: string;
  status: AutomationStatus;
  cwd?: string;
  userId?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
  updatedAt: number;
  runCount: number;
  lastResult?: { success: boolean; output?: string; error?: string };
}

// ═══ SQL.js DB 管理 ═══

let sqlModule: any = null;
let dbInstance: any = null;
let dbReady = false;

async function ensureDb(): Promise<any> {
  if (dbReady && dbInstance) return dbInstance;

  if (!sqlModule) {
    // 使用 createRequire 加载 sql.js (ESM 兼容, 解决 Dynamic require of node:fs)
    sqlModule = _require('sql.js');
  }
  const initSqlJs = sqlModule.default || sqlModule;

  const dbPath = path.join(os.homedir(), '.agentai', 'automations.db');
  let buf: Buffer | Uint8Array | undefined;

  try {
    if (fs.existsSync(dbPath)) {
      buf = fs.readFileSync(dbPath);
    }
  } catch { /* 新建 */ }

  const SQL = await initSqlJs();
  const inst = new SQL.Database(buf || new Uint8Array());

  // 建表 DDL
  inst.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL DEFAULT 'recurring',
      rrule TEXT,
      scheduled_at TEXT,
      valid_from TEXT,
      valid_until TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      cwd TEXT,
      user_id TEXT,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      run_count INTEGER NOT NULL DEFAULT 0,
      last_result_json TEXT
    )
  `);

  dbInstance = inst;
  dbReady = true;
  return inst;
}

function persistDb(inst: any): void {
  const dbPath = path.join(os.homedir(), '.agentai', 'automations.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(inst.export()));
}

function recordToRow(r: AutomationRecord): any {
  return {
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    schedule_type: r.scheduleType,
    rrule: r.rrule || null,
    scheduled_at: r.scheduledAt || null,
    valid_from: r.validFrom || null,
    valid_until: r.validUntil || null,
    status: r.status,
    cwd: r.cwd || null,
    user_id: r.userId || null,
    last_run_at: r.lastRunAt || null,
    next_run_at: r.nextRunAt || null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    run_count: r.runCount,
    last_result_json: r.lastResult ? JSON.stringify(r.lastResult) : null,
  };
}

function rowToRecord(row: any): AutomationRecord {
  const lastResult = row['last_result_json'] ? JSON.parse(row['last_result_json']) : undefined;
  return {
    id: row['id'],
    name: row['name'],
    prompt: row['prompt'],
    scheduleType: row['schedule_type'] as ScheduleType,
    rrule: row['rrule'] || undefined,
    scheduledAt: row['scheduled_at'] || undefined,
    validFrom: row['valid_from'] || undefined,
    validUntil: row['valid_until'] || undefined,
    status: row['status'] as AutomationStatus,
    cwd: row['cwd'] || undefined,
    userId: row['user_id'] || undefined,
    lastRunAt: row['last_run_at'] || undefined,
    nextRunAt: row['next_run_at'] || undefined,
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
    runCount: row['run_count'],
    lastResult,
  };
}

// ═══ RRULE → ms ═══

function parseRruleToMs(rrule: string): number {
  const upper = rrule.toUpperCase();
  const freq = upper.match(/FREQ=(SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)/)?.[1] || 'DAILY';
  const interval = parseInt(upper.match(/INTERVAL=(\d+)/)?.[1] || '1', 10);
  const base: Record<string, number> = {
    SECONDLY: 1000, MINUTELY: 60 * 1000, HOURLY: 3600 * 1000,
    DAILY: 86400 * 1000, WEEKLY: 7 * 86400 * 1000,
    MONTHLY: 30 * 86400 * 1000, YEARLY: 365 * 86400 * 1000,
  };
  return ((base as any)[freq] || base['DAILY']) * interval;
}

function msToCronExpr(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `*/${Math.max(1, mins)} * * * *`;
  const hours = Math.round(ms / 3600000);
  if (hours < 24) return `0 */${Math.max(1, hours)} * * *`;
  const days = Math.round(ms / 86400000);
  return `0 0 */${Math.max(1, days)} * *`;
}

// ═══ 主类 ═══

/**
 * AutomationStore — cron 任务持久化 CRUD + 运行时调度 (SQLite 后端)
 */
export class AutomationStore extends EventEmitter {
  private static instance: AutomationStore | null = null;
  private jobs = new Map<string, CronJob | ReturnType<typeof setTimeout>>();
  private ready = false;

  static async getInstance(): Promise<AutomationStore> {
    if (!AutomationStore.instance) {
      AutomationStore.instance = new AutomationStore();
      await AutomationStore.instance.init();
    }
    return AutomationStore.instance;
  }

  private async init(): Promise<void> {
    await ensureDb();
    this.ready = true;
  }

  // ─── CRUD ───

  async create(input: {
    name: string; prompt: string;
    scheduleType?: ScheduleType; rrule?: string; scheduledAt?: string;
    validFrom?: string; validUntil?: string;
    status?: AutomationStatus; cwd?: string; userId?: string;
  }): Promise<AutomationRecord> {
    if (!this.ready) await this.init();
    const inst = dbInstance!;
    const now = Date.now();

    const record: AutomationRecord = {
      id: crypto.randomUUID(),
      name: input.name, prompt: input.prompt,
      scheduleType: input.scheduleType || 'recurring',
      rrule: input.rrule, scheduledAt: input.scheduledAt,
      validFrom: input.validFrom, validUntil: input.validUntil,
      status: input.status || 'ACTIVE',
      cwd: input.cwd, userId: input.userId,
      createdAt: now, updatedAt: now, runCount: 0,
    };

    record.nextRunAt = this.calcNextRunAt(record);

    const row = recordToRow(record);
    inst.prepare('INSERT INTO automations VALUES (:id,:name,:prompt,:schedule_type,:rrule,:scheduled_at,:valid_from,:valid_until,:status,:cwd,:user_id,:last_run_at,:next_run_at,:created_at,:updated_at,:run_count,:last_result_json)').run(row);
    persistDb(inst);

    // 创建后自动启动调度 (使用默认 executor)
    const executor = defaultExecutor || builtinExecutor;
    this.start(record.id, executor);

    this.emit('created', record);
    console.log(`[automation-store] created: ${record.id} — ${record.name}`);
    return record;
  }

  async get(id: string): Promise<AutomationRecord | undefined> {
    if (!this.ready) await this.init();
    const inst = dbInstance!;
    const rows = inst.prepare('SELECT * FROM automations WHERE id = ?').get(id);
    return rows ? rowToRecord(rows) : undefined;
  }

  async list(filter?: { status?: AutomationStatus; userId?: string }): Promise<AutomationRecord[]> {
    if (!this.ready) await this.init();
    const inst = dbInstance!;
    let sql = 'SELECT * FROM automations';
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) { conditions.push('status = ?'); params.push(filter.status); }
    if (filter?.userId) { conditions.push('user_id = ?'); params.push(filter.userId); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

    // sql.js: prepare().all() 不存在，改用 exec() 或遍历
    try {
      const stmt = inst.prepare(sql);
      if (params.length > 0) stmt.bind(params);
      const rows: any[] = [];
      while (stmt.step()) { rows.push(stmt.getAsObject()); }
      stmt.free();
      return rows.map(rowToRecord);
    } catch {
      // fallback: 无条件查询用 exec
      const result = inst.exec(sql);
      if (!result || result.length === 0) return [];
      const cols = result[0].columns;
      return result[0].values.map((row: any[]) => {
        const obj: any = {};
        cols.forEach((c: string, i: number) => { obj[c] = row[i]; });
        return rowToRecord(obj);
      });
    }
  }

  async update(id: string, patch: Partial<Omit<AutomationRecord, 'id' | 'createdAt'>>): Promise<AutomationRecord | null> {
    if (!this.ready) await this.init();
    const inst = dbInstance!;
    const existing = await this.get(id);
    if (!existing) return null;

    const updated = { ...existing, ...patch, id, updatedAt: Date.now() };
    const row = recordToRow(updated);

    inst.prepare('UPDATE automations SET name=:name,prompt=:prompt,schedule_type=:schedule_type,rrule=:rrule,scheduled_at=:scheduled_at,valid_from=:valid_from,valid_until=:valid_until,status=:status,cwd=:cwd,user_id=:user_id,last_run_at=:last_run_at,next_run_at=:next_run_at,updated_at=:updated_at,run_count=:run_count,last_result_json=:last_result_json WHERE id=:id').run(row);
    persistDb(inst);

    this.emit('updated', updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    if (!this.ready) await this.init();
    const inst = dbInstance!;
    const existing = await this.get(id);
    if (!existing) return false;

    this.stop(id);
    inst.prepare('DELETE FROM automations WHERE id = ?').run(id);
    persistDb(inst);

    this.emit('deleted', { id });
    console.log(`[automation-store] deleted: ${id}`);
    return true;
  }

  async pause(id: string): Promise<boolean> {
    const updated = await this.update(id, { status: 'PAUSED' });
    if (updated) { this.stop(id); return true; }
    return false;
  }

  async activate(id: string, executor?: (prompt: string, record: AutomationRecord) => Promise<void>): Promise<boolean> {
    const record = await this.get(id);
    if (!record) return false;
    await this.update(id, { status: 'ACTIVE' });
    this.start(id, executor || defaultExecutor || builtinExecutor);
    return true;
  }

  // ─── 调度 ───

  start(id: string, executor: (prompt: string, record: AutomationRecord) => Promise<void>): void {
    (async () => {
      const record = await this.get(id);
      if (!record || record.status !== 'ACTIVE') return;

      this.stop(id);

      if (record.scheduleType === 'once') {
        this.scheduleOnce(record, executor);
      } else {
        this.scheduleRecurring(record, executor);
      }
    })();
  }

  stop(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job instanceof CronJob) (job as CronJob).stop();
    else clearTimeout(job as ReturnType<typeof setTimeout>);
    this.jobs.delete(id);
  }

  /** 恢复所有活跃任务 (使用默认 executor 或传入的 executor) */
  async resumeAll(executor?: (prompt: string, record: AutomationRecord) => Promise<void>): Promise<void> {
    const exec = executor || defaultExecutor || builtinExecutor;
    const records = await this.list({ status: 'ACTIVE' });
    let resumed = 0;

    for (const record of records) {
      if (record.scheduleType === 'once' && record.scheduledAt) {
        if (new Date(record.scheduledAt).getTime() < Date.now()) {
          await this.update(record.id, { status: 'PAUSED' });
          continue;
        }
      }
      if (record.validUntil && new Date(record.validUntil).getTime() < Date.now()) {
        await this.update(record.id, { status: 'PAUSED' });
        continue;
      }

      this.start(record.id, exec);
      resumed++;
    }

    if (resumed > 0) console.log(`[automation-store] resumed ${resumed} active automations`);
  }

  // ─── 内部 ───

  private scheduleOnce(record: AutomationRecord, executor: (prompt: string, rec: AutomationRecord) => Promise<void>): void {
    if (!record.scheduledAt) return;
    const delayMs = Math.max(0, new Date(record.scheduledAt).getTime() - Date.now());
    const timer = setTimeout(async () => {
      this.jobs.delete(record.id);
      await this.runTask(record, executor);
      this.update(record.id, { status: 'PAUSED' });
    }, delayMs);
    this.jobs.set(record.id, timer);
    console.log(`[automation-store] scheduled once: ${record.name} in ${Math.round(delayMs / 1000)}s`);
  }

  private scheduleRecurring(record: AutomationRecord, executor: (prompt: string, rec: AutomationRecord) => Promise<void>): void {
    if (!record.rrule) {
      console.warn(`[automation-store] recurring task ${record.id} has no rrule`);
      return;
    }

    const ms = parseRruleToMs(record.rrule);
    const cronExpr = msToCronExpr(ms);

    const job = new CronJob(cronExpr, async () => {
      const r = await this.get(record.id);
      if (!r || r.status !== 'ACTIVE') return;
      if (r.validFrom && new Date(r.validFrom).getTime() > Date.now()) return;
      if (r.validUntil && new Date(r.validUntil).getTime() < Date.now()) { this.pause(record.id); return; }

      await this.runTask(r, executor);
    });

    job.start();
    this.jobs.set(record.id, job);
    console.log(`[automation-store] recurring started: ${record.name} (~${Math.round(ms / 60000)} min)`);
  }

  private async runTask(record: AutomationRecord, executor: (p: string, r: AutomationRecord) => Promise<void>): Promise<void> {
    console.log(`[automation-store] running: ${record.name}`);
    this.emit('run:start', { id: record.id, name: record.name });

    let success = true, error: string | undefined;
    try { await executor(record.prompt, record); }
    catch (e: any) { success = false; error = e?.message || String(e); }

    const now = Date.now();
    const nextRunAt = record.scheduleType === 'recurring' && record.rrule
      ? now + parseRruleToMs(record.rrule)
      : undefined;

    await this.update(record.id, {
      lastRunAt: now, runCount: (record.runCount || 0) + 1,
      nextRunAt,
      lastResult: { success, output: success ? 'OK' : undefined, error },
    });

    this.emit('run:done', { id: record.id, name: record.name, success, durationMs: Date.now() - (record.lastRunAt || now), error });
  }

  private calcNextRunAt(r: AutomationRecord): number | undefined {
    if (r.scheduleType === 'once' && r.scheduledAt) return new Date(r.scheduledAt).getTime();
    if (r.scheduleType === 'recurring' && r.rrule) return Date.now() + parseRruleToMs(r.rrule);
    return undefined;
  }
}

/** 全局单例 (注意: async getInstance 需要 await) */
export let automationStore: AutomationStore | null = null;

export async function getAutomationStore(): Promise<AutomationStore> {
  if (!automationStore) {
    automationStore = await AutomationStore.getInstance();
  }
  return automationStore;
}
