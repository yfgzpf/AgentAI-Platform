/**
 * IDE 状态感知 — 实时接收前端编辑器状态
 * 用于注入 AI 上下文, 让 AI 知道用户当前在看什么文件
 */

export interface IdeState {
    /** 当前打开的文件列表 */
    open_files: string[];
    /** 活跃文件路径 */
    active_file?: string;
    /** 活跃文件光标行号 */
    cursor_line?: number;
    /** 选中的代码片段 */
    selected_text?: string;
    /** 诊断错误 */
    diagnostics?: Array<{
        file: string;
        line: number;
        severity: 'error' | 'warning' | 'info';
        message: string;
    }>;
    /** 最近编辑的文件 */
    recent_edits?: string[];
    /** 最后更新时间 */
    updated_at: number;
}

let _state: IdeState | null = null;

export function update_ide_state(state: Omit<IdeState, 'updated_at'>): void {
    _state = { ...state, updated_at: Date.now() };
}

export function get_ide_state(): IdeState | null {
    if (!_state) return null;
    // 超过 30 秒的状态视为过期
    if (Date.now() - _state.updated_at > 30000) return null;
    return _state;
}

/** 格式化为 AI 上下文注入的文本 */
export function format_ide_context(): string | null {
    const s = get_ide_state();
    if (!s) return null;

    const parts: string[] = ['# IDE 状态 (实时)'];

    if (s.open_files.length > 0) {
        const fileList = s.open_files.map(f => {
            const isActive = f === s.active_file;
            const cursor = isActive && s.cursor_line ? ` (L${s.cursor_line})` : '';
            return isActive ? `**${f}${cursor}**` : f;
        }).join(', ');
        parts.push(`打开文件: ${fileList}`);
    }

    if (s.selected_text && s.selected_text.length > 0) {
        parts.push(`选中代码:\n\`\`\`\n${s.selected_text.slice(0, 300)}\n\`\`\``);
    }

    if (s.diagnostics && s.diagnostics.length > 0) {
        const diags = s.diagnostics.slice(0, 5).map(d =>
            `${d.file}:${d.line} — [${d.severity}] ${d.message}`
        ).join('\n');
        parts.push(`诊断:\n${diags}`);
    }

    if (s.recent_edits && s.recent_edits.length > 0) {
        parts.push(`最近编辑: ${s.recent_edits.slice(0, 5).join(', ')}`);
    }

    return parts.length > 1 ? parts.join('\n') : null;
}
