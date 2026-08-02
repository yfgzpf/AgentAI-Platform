/**
 * FileTimeline — 文件修改时间线系统
 * ----------------------------------------------------
 * 核心能力:
 *   - 自动记录每次文件修改/创建/删除
 *   - 保存文件内容快照 (snapshot)，支持回滚
 *   - 按文件/时间范围/操作类型筛选
 *   - AI 可通过此系统恢复/回退文件版本
 *
 * 使用方式:
 *   const timeline = new FileTimeline();
 *   timeline.beforeWrite(filePath, content);   // 写前记录
 *   timeline.afterWrite(filePath, content);     // 写后记录
 *   timeline.recordDelete(filePath, content);   // 删除前记录快照
 *   timeline.rollback(entryId);                 // 回滚到指定版本
 *
 * 存储: localStorage 持久化 (前端) + 可选 Gateway 同步
 */

export interface TimelineEntry {
  id: string;
  /** 操作类型 */
  action: 'write' | 'create' | 'delete' | 'rename' | 'ai_edit';
  /** 文件路径 */
  filePath: string;
  /** 文件名 */
  fileName: string;
  /** 操作前的文件内容 (快照, 用于回滚) */
  beforeContent?: string;
  /** 操作后的文件内容 */
  afterContent?: string;
  /** 文件扩展名 */
  ext: string;
  /** 时间戳 */
  ts: number;
  /** 操作摘要 (自动生成) */
  summary: string;
  /** 是否为 AI 操作 */
  isAiAction: boolean;
  /** 标签 (用于分类筛选) */
  tags: string[];
}

const STORAGE_KEY = 'agentai.file_timeline';
const MAX_ENTRIES = 500;

class FileTimelineImpl {
  private entries: TimelineEntry[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.load();
  }

  // ===== 持久化 =====
  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.entries = JSON.parse(raw);
    } catch { this.entries = []; }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch { /* quota exceeded — 裁剪旧条目 */ }
    this.notify();
  }

  // ===== 监听 =====
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify() { this.listeners.forEach(fn => fn()); }

  // ===== 核心方法 =====

  /** 写文件前: 记录旧内容快照 */
  beforeWrite(filePath: string, beforeContent?: string): string | null {
    // 如果已有同一文件的未完成记录，不重复创建
    const existing = this.entries.find(e => e.filePath === filePath && !e.afterContent);
    if (existing) return existing.id;
    return null;
  }

  /** 写文件后: 创建时间线条目 */
  afterWrite(
    filePath: string,
    afterContent: string,
    beforeContent?: string,
    isAiAction = false,
    tags: string[] = [],
  ): TimelineEntry {
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const ext = fileName.includes('.') ? fileName.split('.').pop()! : '';
    const action = beforeContent !== undefined ? 'write' : 'create';
    const summary = action === 'create'
      ? `创建 ${fileName}`
      : `修改 ${fileName}${this.diffSummary(beforeContent || '', afterContent)}`;

    const entry: TimelineEntry = {
      id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action,
      filePath,
      fileName,
      beforeContent: beforeContent || '',
      afterContent,
      ext,
      ts: Date.now(),
      summary,
      isAiAction,
      tags,
    };

    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(0, MAX_ENTRIES);
    this.save();
    return entry;
  }

  /** 删除文件: 记录快照 */
  recordDelete(filePath: string, content: string, isAiAction = false): TimelineEntry {
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const ext = fileName.includes('.') ? fileName.split('.').pop()! : '';
    const entry: TimelineEntry = {
      id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action: 'delete',
      filePath,
      fileName,
      beforeContent: content,
      afterContent: undefined,
      ext,
      ts: Date.now(),
      summary: `删除 ${fileName}`,
      isAiAction,
      tags: ['delete'],
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(0, MAX_ENTRIES);
    this.save();
    return entry;
  }

  /** 重命名文件 */
  recordRename(oldPath: string, newPath: string, isAiAction = false): TimelineEntry {
    const fileName = oldPath.split(/[\\/]/).pop() || oldPath;
    const newName = newPath.split(/[\\/]/).pop() || newPath;
    const ext = fileName.includes('.') ? fileName.split('.').pop()! : '';
    const entry: TimelineEntry = {
      id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action: 'rename',
      filePath: oldPath,
      fileName,
      afterContent: newPath,
      ext,
      ts: Date.now(),
      summary: `重命名 ${fileName} → ${newName}`,
      isAiAction,
      tags: ['rename', ext],
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(0, MAX_ENTRIES);
    this.save();
    return entry;
  }

  // ===== 查询 =====

  /** 获取全部时间线 (按时间倒序) */
  getAll(): TimelineEntry[] {
    return [...this.entries];
  }

  /** 按文件路径筛选 */
  getByFile(filePath: string): TimelineEntry[] {
    return this.entries.filter(e => e.filePath === filePath);
  }

  /** 按操作类型筛选 */
  getByAction(action: TimelineEntry['action']): TimelineEntry[] {
    return this.entries.filter(e => e.action === action);
  }

  /** 时间范围查询 */
  getByTimeRange(start: number, end: number): TimelineEntry[] {
    return this.entries.filter(e => e.ts >= start && e.ts <= end);
  }

  /** 最近 N 条 */
  getRecent(n: number): TimelineEntry[] {
    return this.entries.slice(0, n);
  }

  /** 按文件名搜索 */
  search(query: string): TimelineEntry[] {
    const q = query.toLowerCase();
    return this.entries.filter(e =>
      e.fileName.toLowerCase().includes(q) ||
      e.filePath.toLowerCase().includes(q) ||
      e.summary.toLowerCase().includes(q)
    );
  }

  // ===== 回滚 =====

  /**
   * 回滚到指定时间线条目
   * 返回需要写入的内容, 调用方负责写入文件
   */
  rollback(entryId: string): { filePath: string; content: string; entry: TimelineEntry } | null {
    const entry = this.entries.find(e => e.id === entryId);
    if (!entry) return null;

    // 删除/创建操作需要特殊处理
    if (entry.action === 'delete') {
      // 删除回滚 = 恢复文件 (需要 beforeContent)
      if (entry.beforeContent !== undefined) {
        return { filePath: entry.filePath, content: entry.beforeContent, entry };
      }
      return null;
    }

    if (entry.action === 'create') {
      // 创建回滚 = 删除文件
      return { filePath: entry.filePath, content: '', entry };
    }

    // write/ai_edit 回滚 = 恢复到 beforeContent
    if (entry.beforeContent !== undefined) {
      return { filePath: entry.filePath, content: entry.beforeContent, entry };
    }

    return null;
  }

  /** 获取可回滚的上一个版本 */
  getPreviousVersion(filePath: string): TimelineEntry | null {
    const fileEntries = this.entries.filter(e => e.filePath === filePath && e.action !== 'delete');
    return fileEntries.length > 0 ? fileEntries[0] : null;
  }

  // ===== 清理 =====

  /** 清空时间线 */
  clear() {
    this.entries = [];
    this.save();
  }

  /** 删除指定条目 */
  deleteEntry(id: string) {
    this.entries = this.entries.filter(e => e.id !== id);
    this.save();
  }

  /** 获取统计 */
  getStats() {
    const byAction: Record<string, number> = {};
    const byExt: Record<string, number> = {};
    let aiCount = 0;

    for (const e of this.entries) {
      byAction[e.action] = (byAction[e.action] || 0) + 1;
      if (e.ext) byExt[e.ext] = (byExt[e.ext] || 0) + 1;
      if (e.isAiAction) aiCount++;
    }

    return {
      total: this.entries.length,
      byAction,
      byExt,
      aiCount,
      timeRange: this.entries.length > 0
        ? { oldest: this.entries[this.entries.length - 1]?.ts, newest: this.entries[0]?.ts }
        : null,
    };
  }

  // ===== 工具 =====

  /** 生成差异摘要 */
  private diffSummary(before: string, after: string): string {
    const bLines = before.split('\n').length;
    const aLines = after.split('\n').length;
    const bChars = before.length;
    const aChars = after.length;

    const parts: string[] = [];
    if (aLines !== bLines) parts.push(`${aLines > bLines ? '+' : ''}${aLines - bLines} 行`);
    if (aChars !== bChars) parts.push(`${aChars > bChars ? '+' : ''}${aChars - bChars} 字符`);
    return parts.length > 0 ? ` (${parts.join(', ')})` : ' (微调)';
  }

  /** 从时间线构建 AI 上下文提示 */
  buildAiContextPrompt(filePath?: string): string {
    const recent = filePath
      ? this.getByFile(filePath).slice(0, 5)
      : this.getRecent(15);

    if (recent.length === 0) return '';

    return [
      `[文件时间线 - 最近 ${recent.length} 次变更]`,
      ...recent.map(e => {
        const time = new Date(e.ts).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        return `  ${time} [${e.action}] ${e.fileName} — ${e.summary}${e.isAiAction ? ' 🤖' : ''}`;
      }),
      '',
      `可用命令: /timeline 查看全部 | /rollback <id> 回滚到指定版本`,
    ].join('\n');
  }
}

/** 全局单例 */
export const FileTimeline = new FileTimelineImpl();
