/**
 * IDE 状态管理 — 实时感知用户在编辑器中的操作
 * ================================================
 * 对标 Cursor/Copilot 的编辑器感知能力：
 *   - 用户打开了哪些文件
 *   - 光标位置 + 选中文本
 *   - 当前诊断信息
 *
 * 这些信息注入到 AI 的上下文中，
 * 让 AI 知道"用户现在在看什么、在写什么、遇到了什么错误"
 */

export interface OpenFileInfo {
  path: string;           // 相对于 workspace 的路径
  language: string;       // ts, tsx, py, etc.
  cursorLine: number;     // 光标所在行号 (1-based)
  cursorColumn: number;   // 光标所在列号 (1-based)
  selectedText?: string;  // 选中文本 (如果有)
  visibleRange?: { start: number; end: number };  // 可视范围行号
  lastModified?: number;  // 最后修改时间戳
}

export interface IdeState {
  /** 当前打开的文件列表 */
  openFiles: OpenFileInfo[];
  /** 当前活动文件路径 */
  activeFile?: string;
  /** 最近的诊断 (errors/warnings) */
  diagnostics?: Array<{
    file: string;
    line: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
  }>;
  /** 最后更新时间 */
  updatedAt: number;
  /** 是否在编辑模式 */
  isEditing: boolean;
}

let currentState: IdeState = {
  openFiles: [],
  updatedAt: 0,
  isEditing: false,
};

/** 更新 IDE 状态 (由 GUI 推送) */
export function updateIdeState(partial: Partial<IdeState>): void {
  currentState = {
    ...currentState,
    ...partial,
    updatedAt: Date.now(),
  };
}

/** 获取当前 IDE 状态 */
export function getIdeState(): IdeState {
  return currentState;
}

/**
 * 生成 IDE 上下文文本，注入 AI 系统提示
 * 格式简洁，避免占用过多 token
 */
export function buildIdeContext(): string {
  const s = currentState;
  if (s.openFiles.length === 0) return '';

  const lines: string[] = ['<ide-context>'];

  // 活动文件
  if (s.activeFile) {
    const active = s.openFiles.find(f => f.path === s.activeFile);
    if (active) {
      lines.push(`  当前文件: ${active.path} (${active.language})`);
      lines.push(`  光标: L${active.cursorLine}:${active.cursorColumn}`);
      if (active.selectedText) {
        const truncated = active.selectedText.length > 200
          ? active.selectedText.slice(0, 200) + '...'
          : active.selectedText;
        lines.push(`  选中文本: """${truncated}"""`);
      }
    }
  }

  // 已打开的其他文件
  const otherFiles = s.openFiles.filter(f => f.path !== s.activeFile);
  if (otherFiles.length > 0) {
    const fileNames = otherFiles.map(f => {
      const lang = f.language ? ` (${f.language})` : '';
      return `${f.path}${lang}`;
    }).slice(0, 10); // 最多显示 10 个
    lines.push(`  其他打开的文件 (${otherFiles.length}):`);
    for (const fn of fileNames) {
      lines.push(`    - ${fn}`);
    }
    if (otherFiles.length > 10) {
      lines.push(`    ... 还有 ${otherFiles.length - 10} 个文件`);
    }
  }

  // 诊断
  if (s.diagnostics && s.diagnostics.length > 0) {
    const errors = s.diagnostics.filter(d => d.severity === 'error');
    const warnings = s.diagnostics.filter(d => d.severity === 'warning');
    if (errors.length > 0) {
      lines.push(`  ⚠️ ${errors.length} 个编译错误:`);
      for (const e of errors.slice(0, 5)) {
        lines.push(`    L${e.line} [${e.file.split('/').pop()}] ${e.message}`);
      }
    }
    if (warnings.length > 0) {
      lines.push(`  ⚡ ${warnings.length} 个警告`);
    }
  }

  lines.push('</ide-context>');
  return lines.join('\n');
}

/** 重置 IDE 状态 */
export function resetIdeState(): void {
  currentState = {
    openFiles: [],
    updatedAt: 0,
    isEditing: false,
  };
}
