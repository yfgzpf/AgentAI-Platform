/**
 * PulseFlow - 共享 Webview 样式 (与 GUI 对齐)
 * ----------------------------------------------------
 * 品牌: PulseFlow (产品) + AgentAI Platform (底层框架)
 * 设计原则:
 *   - CSS 变量驱动, 支持 VSCode 主题色 + 自定义主题
 *   - 字体/间距/圆角 与 GUI (Thread.tsx) 保持一致
 *   - 关键动画: msg-enter / bubble-enter / avatar-pulse
 *   - 暗色优先, 适配 VSCode 默认主题
 */

export function getSharedStyles(): string {
    return `
    :root {
        /* === 颜色变量 (VSCode 主题优先, 兜底 GUI 色板) === */
        --bg: var(--vscode-editor-background, #1e1e1e);
        --bg-elev: var(--vscode-textBlockQuote-background, #252526);
        --panel: var(--vscode-panel-background, #252526);
        --border: var(--vscode-panel-border, #3c3c3c);
        --fg: var(--vscode-foreground, #d4d4d4);
        --fg-muted: var(--vscode-descriptionForeground, #888);
        --accent: var(--vscode-textLink-foreground, #4fc3f7);
        --accent-strong: #29b6f6;
        --accent-soft: rgba(79, 195, 247, 0.25);
        --error: #f48771;
        --success: #6a9955;
        --warning: #dcdcaa;

        /* === 间距 (与 GUI 对齐) === */
        --gap-1: 4px;
        --gap-2: 8px;
        --gap-3: 12px;
        --gap-4: 16px;

        /* === 圆角 === */
        --radius-sm: 6px;
        --radius: 8px;
        --radius-lg: 12px;
        --radius-bubble: 16px;

        /* === 字体 === */
        --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        --font-mono: var(--vscode-editor-font-family, "Cascadia Code", "Fira Code", Consolas, monospace);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body {
        font-family: var(--font);
        background: var(--bg);
        color: var(--fg);
        font-size: 13px;
        line-height: 1.5;
        display: flex;
        flex-direction: column;
    }

    /* === 工具栏 === */
    .toolbar {
        display: flex;
        align-items: center;
        gap: var(--gap-1);
        padding: 4px 8px;
        background: var(--panel);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
        min-height: 32px;
    }
    .tb-btn {
        background: transparent;
        color: var(--fg);
        border: 1px solid transparent;
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 14px;
        transition: all 0.15s;
    }
    .tb-btn:hover { background: var(--bg-elev); border-color: var(--border); }
    .tb-btn:active { transform: scale(0.95); }
    .tb-spacer { flex: 1; }
    .tb-status {
        font-size: 11px;
        color: var(--fg-muted);
        padding: 0 6px;
    }

    /* === 文件树 === */
    .file-tree {
        max-height: 200px;
        overflow-y: auto;
        padding: 4px 8px;
        background: var(--bg-elev);
        border-bottom: 1px solid var(--border);
        font-size: 11px;
    }
    .file-tree .file-entry {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 1px 4px;
        cursor: pointer;
        border-radius: 3px;
    }
    .file-tree .file-entry:hover { background: var(--accent-soft); }
    .file-tree .file-entry .file-icon { flex-shrink: 0; }

    /* === 消息列表 === */
    .messages {
        flex: 1;
        overflow-y: auto;
        padding: var(--gap-2);
        scroll-behavior: smooth;
    }
    .messages::-webkit-scrollbar { width: 8px; }
    .messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

    .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: var(--fg-muted);
        font-size: 12px;
    }

    /* === 消息气泡 (与 GUI Thread.tsx 对齐) === */
    .msg {
        display: flex;
        gap: var(--gap-2);
        margin-bottom: var(--gap-3);
        animation: msg-enter 0.25s cubic-bezier(0.2, 0, 0, 1);
        align-items: flex-start;
    }
    .msg-user { justify-content: flex-end; }
    .msg-bot { justify-content: flex-start; }

    @keyframes msg-enter {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .msg .avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        position: relative;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
    .msg .avatar.ai {
        background: var(--panel);
        border: 1.5px solid var(--accent);
    }
    .msg .avatar.pending { animation: avatar-pulse 1.4s ease-in-out infinite; }
    @keyframes avatar-pulse {
        0%, 100% { opacity: 0.7; }
        50% { opacity: 1; }
    }

    .msg .bubble {
        max-width: 78%;
        min-width: 0;
        padding: 10px 16px;
        border-radius: var(--radius-bubble);
        font-size: 13px;
        line-height: 1.6;
        word-break: break-word;
        white-space: pre-wrap;
        position: relative;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1);
    }
    .msg-user .bubble {
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #fff;
        border-radius: var(--radius-bubble) var(--radius-bubble) 4px var(--radius-bubble);
        box-shadow: 0 4px 16px var(--accent-soft), 0 1px 4px rgba(0, 0, 0, 0.1);
    }
    .msg-bot .bubble {
        background: var(--bg-elev);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 4px var(--radius-bubble) var(--radius-bubble) var(--radius-bubble);
    }
    .msg-bot .bubble.error {
        border-color: var(--error);
        color: var(--error);
    }

    /* === Markdown 渲染 === */
    .bubble pre {
        background: rgba(0, 0, 0, 0.3);
        padding: var(--gap-2);
        border-radius: var(--radius);
        overflow-x: auto;
        font-family: var(--font-mono);
        font-size: 11px;
        line-height: 1.45;
        margin: 6px 0;
        border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .bubble code {
        font-family: var(--font-mono);
        font-size: 0.92em;
        background: rgba(127, 127, 127, 0.15);
        padding: 1px 5px;
        border-radius: 3px;
    }
    .bubble pre code {
        background: transparent;
        padding: 0;
        border-radius: 0;
    }
    .bubble p { margin: 4px 0; }
    .bubble p:first-child { margin-top: 0; }
    .bubble p:last-child { margin-bottom: 0; }
    .bubble ul, .bubble ol { margin: 4px 0 4px 20px; }
    .bubble a {
        color: var(--accent);
        text-decoration: underline;
    }
    .bubble blockquote {
        border-left: 3px solid var(--accent);
        padding-left: 10px;
        margin: 6px 0;
        color: var(--fg-muted);
    }
    .bubble h1, .bubble h2, .bubble h3 {
        margin: 8px 0 4px;
        font-weight: 600;
    }
    .bubble h1 { font-size: 16px; }
    .bubble h2 { font-size: 15px; }
    .bubble h3 { font-size: 14px; }
    .bubble table {
        border-collapse: collapse;
        margin: 6px 0;
        font-size: 12px;
    }
    .bubble th, .bubble td {
        border: 1px solid var(--border);
        padding: 4px 8px;
    }
    .bubble th { background: var(--bg-elev); }

    /* === 工具调用卡片 === */
    .tool-card {
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 6px 10px;
        margin: 6px 0;
        font-size: 11px;
        font-family: var(--font-mono);
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .tool-card.success { border-left: 3px solid var(--success); }
    .tool-card.error { border-left: 3px solid var(--error); }
    .tool-card .tool-icon { font-size: 14px; }

    /* === 状态指示器 === */
    .status-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--fg-muted);
        margin-right: 4px;
    }
    .status-dot.success { background: var(--success); }
    .status-dot.error { background: var(--error); }
    .status-dot.pending { background: var(--accent); animation: pulse 1s infinite; }
    @keyframes pulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 1; }
    }

    /* === 流式光标 === */
    .cursor {
        display: inline-block;
        width: 2px;
        height: 14px;
        background: var(--accent);
        animation: cursor-blink 1s infinite;
        vertical-align: text-bottom;
        margin-left: 2px;
    }
    @keyframes cursor-blink { 50% { opacity: 0; } }

    /* === Composer (与 GUI Composer.tsx 对齐) === */
    .composer {
        display: flex;
        gap: var(--gap-1);
        padding: 6px 8px;
        background: var(--panel);
        border-top: 1px solid var(--border);
        flex-shrink: 0;
    }
    .composer textarea {
        flex: 1;
        min-height: 36px;
        max-height: 120px;
        padding: 6px 10px;
        background: var(--bg);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-family: var(--font);
        font-size: 13px;
        resize: vertical;
        outline: none;
        transition: border-color 0.15s;
    }
    .composer textarea:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent-soft);
    }
    .composer .send-btn {
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #fff;
        border: none;
        padding: 0 16px;
        border-radius: var(--radius);
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        align-self: stretch;
        transition: opacity 0.15s;
    }
    .composer .send-btn:hover { opacity: 0.9; }
    .composer .send-btn:active { transform: scale(0.97); }
    .composer .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* === 状态变体 (minimal) === */
    body.variant-status .toolbar { display: none; }
    body.variant-status .composer { display: none; }
    body.variant-status .messages { padding: 12px; }
    `;
}
