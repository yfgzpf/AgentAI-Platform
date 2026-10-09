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
/** 记录 IDE 状态所属的 workspace, 切换 workspace 时自动清理 */
let ideStateWorkspace: string = '';

/**
 * IDE 状态过期时间（毫秒）—— 串味修复
 * ==============================================
 * 原实现无TTL: updatedAt 被记录但从不检查。GUI 关标签页 / 切项目 / 退出应用后，
 * currentState 永远保留最后一次推送的文件列表。
 *→ AI 在新任务里看到"当前文件: xxx.tsx"，而那个文件属于上一个任务。
 *
 * 30 秒: 前端轮询间隔 5s, 30 秒 = 6 次轮询没收到更新就认为用户已关闭编辑器
 * 之前 5 分钟太长 — 用户关了面板后 5 分钟内仍注入旧文件路径
 */
const IDE_STATE_TTL_MS = 30 * 1000;

/** 导出供测试与诊断使用（测试需基于实际 TTL 断言，避免硬编码时间导致调参即红） */
export const IDE_STATE_TTL = IDE_STATE_TTL_MS;

/** 更新 IDE 状态 (由 GUI 推送) */
export function updateIdeState(partial: Partial<IdeState>, workspace?: string): void {
  // 如果 workspace 变了, 清空旧状态 (否则旧文件信息泄漏到新工作区)
  // 注意: 不能写成 `if (workspace && ...)` —— workspace 为空时会跳过比对，
  // 导致 ideStateWorkspace 停在旧值或空串，守卫随之失效（见 buildIdeContext）
  if ((workspace || '') !== ideStateWorkspace) {
    currentState = {
      openFiles: [],
      updatedAt: 0,
      isEditing: false,
    };
    ideStateWorkspace = workspace || '';
  }
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
 *
 * 串味修复（2026-10-03）: 加两道闸 —— TTL 过期 + workspace 严格匹配
 */
export function buildIdeContext(currentWorkspace?: string): string {
  const s = currentState;
  if (s.openFiles.length === 0) return '';

  // === 串味修复四道闸 ===

  // 闸1: TTL —— 状态过期则不注入（否则 AI 看到的是上一个任务的打开文件）
  if (s.updatedAt === 0 || Date.now() - s.updatedAt > IDE_STATE_TTL_MS) {
    return '';
  }

  // 闸 2: workspace 必须匹配 —— 原来写成三元合取，ideStateWorkspace 为空时
  // 守卫整体失效（fail-open），任何工作区都能读到上一份状态。
  // 现在改为 fail-closed: 不知道属于谁就不注入。
  if ((currentWorkspace || '') !== ideStateWorkspace) {
    return '';
  }

  // 闸 3: isEditing 必须为 true —— 用户关闭编辑器面板后不再推送状态,
  // 但 30 秒 TTL 内缓存还在。加 isEditing 检查确保只有用户正在编辑时才注入
  if (!s.isEditing) {
    return '';
  }

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

/**
 * 重置 IDE 状态
 * 串味修复: 原实现漏清 ideStateWorkspace，导致"文件列表清了、归属标记还在"，
 * 下次同 workspace 命中时守卫放行，重新注入一份未知来源的状态。
 */
export function resetIdeState(): void {
  currentState = {
    openFiles: [],
    updatedAt: 0,
    isEditing: false,
  };
  ideStateWorkspace = '';
}
