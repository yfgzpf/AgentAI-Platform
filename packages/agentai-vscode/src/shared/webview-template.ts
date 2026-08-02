/**
 * PulseFlow - 共享 Webview 模板 (AgentAI Platform 底层框架)
 * ----------------------------------------------------
 * 设计目标:
 *   - 与 GUI (Thread.tsx) 视觉一致 (色板/字体/动画)
 *   - 单文件 vanilla HTML+CSS+JS, 无外部依赖 (marked 从 CDN)
 *   - 复用 provider 配色, 消息气泡, 代码块样式
 *   - 支持流式输出, 工具调用可视化, 文件预览
 *
 * 品牌: PulseFlow (产品) + AgentAI Platform (底层框架)
 * 含义: Pulse (脉动/状态感知) + Flow (流动/智能演进)
 *
 * 集成方式:
 *   - VSCode: import { getWebviewHtml, ... } from './shared/webview-template'
 *   - Desktop Lite: 由 build-lite.cjs 编译产物
 */

import { getSharedStyles } from './webview-styles';
import { getSharedScript } from './webview-script';

export interface WebviewConfig {
    title?: string;
    initialMessage?: string;
    showFileTree?: boolean;
    showComposer?: boolean;
    nonce?: string;
    /** Webview 类型: chat (默认) / composer / status */
    variant?: 'chat' | 'composer' | 'status';
}

/**
 * 生成完整 Webview HTML
 */
export function getWebviewHtml(config: WebviewConfig = {}): string {
    const {
        title = 'PulseFlow',
        initialMessage = '输入消息开始对话',
        showFileTree = true,
        showComposer = true,
        nonce = 'agentai-nonce',
        variant = 'chat',
    } = config;

    return `<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' data: https://cdn.jsdelivr.net;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <script src="https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/core.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/typescript.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/javascript.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/python.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/bash.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/languages/json.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css">
    <style nonce="${nonce}">
${getSharedStyles()}
    </style>
</head>
<body class="variant-${variant}">
    <div class="toolbar">
        <button class="tb-btn" data-action="toggle-files" title="文件树">📁</button>
        <button class="tb-btn" data-action="review" title="审查项目">🔍</button>
        <button class="tb-btn" data-action="clear" title="清空">🗑</button>
        <div class="tb-spacer"></div>
        <span class="tb-status" id="status">就绪</span>
    </div>
    ${showFileTree ? `<div class="file-tree" id="fileTree" style="display:none"></div>` : ''}
    <div class="messages" id="log">
        <div class="empty-state">${escapeHtml(initialMessage)}</div>
    </div>
    ${showComposer ? `
    <div class="composer">
        <textarea id="in" placeholder="输入消息... (@引用文件/工具/记忆)  Shift+Enter 换行"></textarea>
        <button class="send-btn" id="sendBtn">发送</button>
    </div>
    ` : ''}
    <script nonce="${nonce}">
${getSharedScript()}
    </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Provider 配色 (与 GUI Avatar.tsx 保持一致)
 */
export const PROVIDER_PALETTE = {
    agentai: { grad: 'linear-gradient(135deg, #A78BFA, #6366F1 50%, #4338CA)', ring: 'rgba(99,102,241,0.85)', letter: 'A', label: 'Atlas' },
    deepseek: { grad: 'linear-gradient(135deg, #67E8F9, #06B6D4 50%, #0369A1)', ring: 'rgba(6,182,212,0.85)', letter: 'D', label: 'DeepSeek' },
    openai: { grad: 'linear-gradient(135deg, #6EE7B7, #10B981 50%, #047857)', ring: 'rgba(16,185,129,0.85)', letter: 'O', label: 'OpenAI' },
    cline: { grad: 'linear-gradient(135deg, #FCD34D, #F59E0B 50%, #B45309)', ring: 'rgba(245,158,11,0.85)', letter: 'C', label: 'Cline' },
    zhipu: { grad: 'linear-gradient(135deg, #F9A8D4, #EC4899 50%, #BE185D)', ring: 'rgba(236,72,153,0.85)', letter: 'Z', label: '智谱 GLM' },
} as const;
