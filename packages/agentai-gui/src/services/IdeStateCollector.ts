/**
 * IdeStateCollector — 收集编辑器状态推送到 Gateway
 * 让 AI 感知用户当前在看什么文件、有什么错误
 */

interface IdeStatePayload {
    open_files: string[];
    active_file?: string;
    cursor_line?: number;
    selected_text?: string;
    diagnostics?: Array<{
        file: string;
        line: number;
        severity: 'error' | 'warning' | 'info';
        message: string;
    }>;
    recent_edits?: string[];
}

class IdeStateCollector {
    private _timer: ReturnType<typeof setInterval> | null = null;
    private _state: IdeStatePayload = { open_files: [] };
    private _recent_edits: string[] = [];

    start(): void {
        if (this._timer) return;
        // 每 10 秒推送一次
        this._timer = setInterval(() => this._push(), 10000);
        // 监听自定义事件
        window.addEventListener('agentai:file-opened', this._on_file_open);
        window.addEventListener('agentai:file-edited', this._on_file_edit);
        window.addEventListener('agentai:selection-changed', this._on_selection);
    }

    stop(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        window.removeEventListener('agentai:file-opened', this._on_file_open);
        window.removeEventListener('agentai:file-edited', this._on_file_edit);
        window.removeEventListener('agentai:selection-changed', this._on_selection);
    }

    /** 外部调用: 更新打开的文件列表 */
    set_open_files(files: string[]): void {
        this._state.open_files = files;
    }

    /** 外部调用: 设置活跃文件 */
    set_active_file(file: string, line?: number): void {
        this._state.active_file = file;
        this._state.cursor_line = line;
    }

    /** 外部调用: 设置选中文本 */
    set_selection(text: string): void {
        this._state.selected_text = text.slice(0, 500);
    }

    /** 外部调用: 添加诊断错误 */
    set_diagnostics(diags: IdeStatePayload['diagnostics']): void {
        this._state.diagnostics = diags?.slice(0, 10);
    }

    /** 外部调用: 记录文件编辑 */
    record_edit(file: string): void {
        if (!this._recent_edits.includes(file)) {
            this._recent_edits.unshift(file);
            if (this._recent_edits.length > 10) this._recent_edits.pop();
        }
    }

    private _on_file_open = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.path) this.set_active_file(detail.path, detail.line);
    };

    private _on_file_edit = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.path) this.record_edit(detail.path);
    };

    private _on_selection = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.text) this.set_selection(detail.text);
    };

    private async _push(): Promise<void> {
        try {
            const payload: IdeStatePayload = {
                ...this._state,
                recent_edits: this._recent_edits.slice(0, 5),
            };
            await fetch('/v1/ide-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch { /* push optional */ }
    }
}

export const ide_state_collector = new IdeStateCollector();
