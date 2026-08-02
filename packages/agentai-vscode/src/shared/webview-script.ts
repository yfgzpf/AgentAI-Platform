/**
 * PulseFlow - 共享 Webview 脚本 (与 GUI 对齐)
 * ----------------------------------------------------
 * 品牌: PulseFlow (产品) + AgentAI Platform (底层框架)
 * 能力:
 *   - 消息流式渲染 (与 GUI Thread.tsx 同样的视觉)
 *   - Markdown 渲染 (marked + highlight.js)
 *   - 工具调用卡片 (与 GUI ToolCard 风格一致)
 *   - @-file 智能引用
 *   - 键盘快捷键 (Enter 发送, Shift+Enter 换行)
 *   - 状态指示 (与 GUI StatusIndicator 一致)
 *
 * 接口约定 (window.AgentAI 命名空间):
 *   - send({ type, payload })   → 发送消息到扩展
 *   - onMessage(callback)        → 接收扩展消息
 *
 * 消息协议:
 *   ext → webview: botStart | botDelta | botDone | botError
 *                    | userMsg  | fileList | toolCall | status
 *   webview → ext: chat       | openFile  | listFiles | toolAction
 */

export function getSharedScript(): string {
    return `
(function () {
    'use strict';
    const vscode = acquireVsCodeApi();
    const PROVIDER = (window.PROVIDER || 'agentai').toLowerCase();
    let msgId = 0;
    let streaming = null; // 当前流式消息 ID

    // === Provider 配色 (与 GUI Avatar.tsx 对齐) ===
    const PALETTE = {
        agentai:  { grad: 'linear-gradient(135deg,#A78BFA,#6366F1 50%,#4338CA)', ring: 'rgba(99,102,241,.85)', letter: 'A', label: 'Atlas' },
        deepseek: { grad: 'linear-gradient(135deg,#67E8F9,#06B6D4 50%,#0369A1)', ring: 'rgba(6,182,212,.85)',  letter: 'D', label: 'DeepSeek' },
        openai:   { grad: 'linear-gradient(135deg,#6EE7B7,#10B981 50%,#047857)', ring: 'rgba(16,185,129,.85)', letter: 'O', label: 'OpenAI' },
        cline:    { grad: 'linear-gradient(135deg,#FCD34D,#F59E0B 50%,#B45309)', ring: 'rgba(245,158,11,.85)', letter: 'C', label: 'Cline' },
        zhipu:    { grad: 'linear-gradient(135deg,#F9A8D4,#EC4899 50%,#BE185D)', ring: 'rgba(236,72,153,.85)', letter: 'Z', label: '智谱 GLM' },
    };
    const AI_STYLE = PALETTE[PROVIDER] || PALETTE.agentai;

    // === 工具栏事件 ===
    document.querySelectorAll('.tb-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            if (action === 'clear') clearLog();
            if (action === 'review') sendMessage('请审查当前项目, 指出问题并给出改进建议');
            if (action === 'toggle-files') {
                const ft = document.getElementById('fileTree');
                if (ft) {
                    const show = ft.style.display === 'none';
                    ft.style.display = show ? 'block' : 'none';
                    if (show) vscode.postMessage({ type: 'listFiles', dir: '.' });
                }
            }
        });
    });

    // === 发送消息 ===
    const inEl = document.getElementById('in');
    const sendBtn = document.getElementById('sendBtn');
    function sendMessage(text) {
        if (!text || !text.trim()) return;
        if (inEl) inEl.value = '';
        addUserMsg(text);
        vscode.postMessage({ type: 'chat', text });
        setStatus('pending', '🤔 思考中...');
        if (sendBtn) sendBtn.disabled = true;
    }
    if (sendBtn) sendBtn.addEventListener('click', () => sendMessage(inEl && inEl.value));
    if (inEl) {
        inEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(inEl.value);
            }
        });
    }

    function clearLog() {
        const log = document.getElementById('log');
        if (log) {
            log.innerHTML = '<div class="empty-state">已清空对话</div>';
            streaming = null;
        }
    }

    // === 用户消息 ===
    function addUserMsg(text) {
        const log = document.getElementById('log');
        if (!log) return;
        const empty = log.querySelector('.empty-state');
        if (empty) empty.remove();
        const msg = document.createElement('div');
        msg.className = 'msg msg-user';
        msg.innerHTML = '<div class="bubble">' + escapeHtml(text) + '</div>';
        log.appendChild(msg);
        scrollToBottom();
    }

    // === AI 消息 (流式) ===
    function addBotStart(id) {
        streaming = id;
        const log = document.getElementById('log');
        if (!log) return;
        const empty = log.querySelector('.empty-state');
        if (empty) empty.remove();
        const msg = document.createElement('div');
        msg.className = 'msg msg-bot';
        msg.id = 'msg-' + id;
        msg.innerHTML =
            '<div class="avatar ai" style="background:' + AI_STYLE.grad + ';border-color:' + AI_STYLE.ring + '">' +
            '<span style="color:' + AI_STYLE.ring + '">' + AI_STYLE.letter + '</span></div>' +
            '<div class="bubble" id="bubble-' + id + '"><span class="cursor"></span></div>';
        log.appendChild(msg);
        scrollToBottom();
    }

    function appendBotDelta(id, text) {
        const el = document.getElementById('bubble-' + id);
        if (!el) return;
        // 删除光标
        const cursor = el.querySelector('.cursor');
        if (cursor) cursor.remove();
        el.insertAdjacentText('beforeend', text);
        // 重新加光标
        const c = document.createElement('span');
        c.className = 'cursor';
        el.appendChild(c);
        scrollToBottom();
    }

    function finishBot(id) {
        const el = document.getElementById('bubble-' + id);
        if (!el) return;
        // 移除最后一个光标
        const cursor = el.querySelector('.cursor');
        if (cursor) cursor.remove();
        // 渲染 markdown (包括代码块高亮)
        const raw = el.textContent;
        el.innerHTML = renderMarkdown(raw);
        // 触发 highlight.js
        if (window.hljs) {
            el.querySelectorAll('pre code').forEach(b => {
                try { window.hljs.highlightElement(b); } catch (e) {}
            });
        }
        streaming = null;
        setStatus('success', '✅ 完成');
        if (sendBtn) sendBtn.disabled = false;
    }

    function errorBot(id, err) {
        const el = document.getElementById('bubble-' + id);
        if (el) {
            el.innerHTML = '<span style="color:var(--error)">❌ ' + escapeHtml(err) + '</span>';
            el.classList.add('error');
        }
        streaming = null;
        setStatus('error', '❌ 错误');
        if (sendBtn) sendBtn.disabled = false;
    }

    // === 工具调用卡片 ===
    function addToolCard(name, args, result, ok) {
        const log = document.getElementById('log');
        if (!log) return;
        const card = document.createElement('div');
        card.className = 'tool-card ' + (ok ? 'success' : 'error');
        const icon = ok ? '🔧' : '⚠️';
        let argsStr = '';
        try { argsStr = typeof args === 'string' ? args : JSON.stringify(args).slice(0, 200); } catch (e) {}
        card.innerHTML =
            '<span class="tool-icon">' + icon + '</span>' +
            '<span><b>' + escapeHtml(name) + '</b></span>' +
            '<span style="color:var(--fg-muted);margin-left:6px">' + escapeHtml(argsStr) + '</span>';
        // 插入到当前流式消息之前
        const cur = streaming ? document.getElementById('msg-' + streaming) : null;
        if (cur) log.insertBefore(card, cur);
        else log.appendChild(card);
        scrollToBottom();
    }

    // === 文件列表 ===
    function renderFileList(dir, files) {
        const ft = document.getElementById('fileTree');
        if (!ft) return;
        ft.innerHTML = '';
        const head = document.createElement('div');
        head.style.cssText = 'padding:2px 0;font-weight:600;opacity:0.7';
        head.textContent = '📂 ' + dir;
        ft.appendChild(head);
        files.forEach(f => {
            const entry = document.createElement('div');
            entry.className = 'file-entry';
            const icon = f.type === 'directory' ? '📁' : '📄';
            entry.innerHTML = '<span class="file-icon">' + icon + '</span>' + escapeHtml(f.name);
            entry.onclick = () => {
                if (f.type === 'directory') {
                    vscode.postMessage({ type: 'listFiles', dir: dir + '/' + f.name });
                } else {
                    vscode.postMessage({ type: 'openFile', path: dir + '/' + f.name });
                }
            };
            ft.appendChild(entry);
        });
    }

    // === 状态指示 ===
    function setStatus(kind, text) {
        const s = document.getElementById('status');
        if (s) {
            s.innerHTML = '<span class="status-dot ' + kind + '"></span>' + escapeHtml(text);
        }
    }

    // === 工具函数 ===
    function scrollToBottom() {
        const log = document.getElementById('log');
        if (log) log.scrollTop = log.scrollHeight;
    }
    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function renderMarkdown(text) {
        if (typeof window.marked === 'undefined') {
            return escapeHtml(text).replace(/\\n/g, '<br>');
        }
        try {
            return window.marked.parse(text, { gfm: true, breaks: true });
        } catch (e) {
            return escapeHtml(text);
        }
    }

    // === 接收扩展消息 ===
    window.addEventListener('message', e => {
        const d = e.data;
        if (!d || !d.type) return;
        switch (d.type) {
            case 'userMsg':    addUserMsg(d.text); break;
            case 'botStart':   addBotStart(d.id); break;
            case 'botDelta':   appendBotDelta(d.id, d.text); break;
            case 'botDone':    finishBot(d.id); break;
            case 'botError':   errorBot(d.id, d.error || 'unknown'); break;
            case 'toolCall':   addToolCard(d.name, d.args, d.result, d.ok !== false); break;
            case 'fileList':   renderFileList(d.dir, d.files || []); break;
            case 'status':     setStatus(d.kind || 'pending', d.text); break;
        }
    });

    // 暴露给扩展注入 prompt
    window.AgentAI = {
        send: sendMessage,
        onMessage: (cb) => window.addEventListener('message', cb),
    };
})();
`;
}
