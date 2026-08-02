/**
 * ReadTracker — 跟踪 AI 已读取的文件
 * ----------------------------------------------------
 * 用途: 确保 AI 在 edit_file / multi_edit 前先 read_file 过文件内容
 * 实现:
 *   - markRead(path): read_file 成功后调用
 *   - hasRead(path): 编辑前检查, 未读则拒绝
 *   - reset(): 上下文折叠后调用, 强制重新读取
 *
 * 学自: Reasonix src/tools/read-tracker.ts
 */
import * as pathModule from 'path';

export class ReadTracker {
  private _readFiles = new Set<string>();
  private _workspace: string;

  constructor(workspace: string) {
    this._workspace = workspace;
  }

  /** 解析为绝对路径 (统一 key) */
  private resolve(filePath: string): string {
    // 去掉开头的 / 或 ./
    const normalized = filePath.replace(/^[./\\]+/, '');
    return pathModule.resolve(this._workspace, normalized);
  }

  /** 标记文件已读 */
  markRead(filePath: string): void {
    const resolved = this.resolve(filePath);
    this._readFiles.add(resolved);
  }

  /** 检查文件是否已读 */
  hasRead(filePath: string): boolean {
    const resolved = this.resolve(filePath);
    return this._readFiles.has(resolved);
  }

  /** 检查一组文件是否都已读 (用于 multi_edit) */
  allRead(filePaths: string[]): { ok: boolean; missing: string[] } {
    const missing: string[] = [];
    for (const fp of filePaths) {
      if (!this.hasRead(fp)) missing.push(fp);
    }
    return { ok: missing.length === 0, missing };
  }

  /** 重置 (上下文折叠时调用) */
  reset(): void {
    this._readFiles.clear();
  }

  /** 当前已读文件数 */
  get size(): number {
    return this._readFiles.size;
  }
}
