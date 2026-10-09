/**
 * ReadTracker — 跟踪 AI 已读取的文件
 * ----------------------------------------------------
 * 用途: 确保 AI 在 edit_file / multi_edit 前先 read_file 过文件内容
 * 实现:
 *   - markRead(path): read_file 成功后调用
 *   - hasRead(path): 编辑前检查, 未读则拒绝
 *   - reset(): 上下文折叠后调用, 强制重新读取
 *
 * src/tools/read-tracker.ts
 */
import * as pathModule from 'path';
export class ReadTracker {
    _readFiles = new Set();
    /** 读取次数（用于 "已读 N 次" 提示） */
    _counts = new Map();
    _workspace;
    constructor(workspace) {
        this._workspace = workspace;
    }
    /** 解析为绝对路径 (统一 key) */
    resolve(filePath) {
        // 去掉开头的 / 或 ./
        const normalized = filePath.replace(/^[./\\]+/, '');
        return pathModule.resolve(this._workspace, normalized);
    }
    /** 标记文件已读，返回这是本会话第几次读该文件（供 read_file 返回"已读 N 次"提示） */
    markRead(filePath) {
        const resolved = this.resolve(filePath);
        this._readFiles.add(resolved);
        this._counts.set(resolved, (this._counts.get(resolved) || 0) + 1);
        return this._counts.get(resolved);
    }
    /** 该文件已被读取过几次（未读过返回 0） */
    countOf(filePath) {
        return this._counts.get(this.resolve(filePath)) || 0;
    }
    /** 已读文件清单（相对工作区，最多 limit 条）—— 供注入任务进度快照 */
    list(limit = 20) {
        return [...this._readFiles]
            .map((abs) => pathModule.relative(this._workspace, abs).replace(/\\/g, '/'))
            .filter((rel) => rel && !rel.startsWith('..'))
            .slice(-limit);
    }
    /** 检查文件是否已读 */
    hasRead(filePath) {
        const resolved = this.resolve(filePath);
        return this._readFiles.has(resolved);
    }
    /** 检查一组文件是否都已读 (用于 multi_edit) */
    allRead(filePaths) {
        const missing = [];
        for (const fp of filePaths) {
            if (!this.hasRead(fp))
                missing.push(fp);
        }
        return { ok: missing.length === 0, missing };
    }
    /** 重置 (上下文折叠时调用) */
    reset() {
        this._readFiles.clear();
        this._counts.clear();
    }
    /** 当前已读文件数 */
    get size() {
        return this._readFiles.size;
    }
}
