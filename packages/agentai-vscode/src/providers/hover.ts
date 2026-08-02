/**
 * AgentAI - Hover Provider
 * ----------------------------------------------------
 * 鼠标悬停函数/变量时显示 AI 解释 (类似 GitHub Copilot)
 * 使用本地缓存避免重复调用
 */

import * as vscode from 'vscode';
import { GatewayClient } from '../gateway-client';

interface HoverCacheEntry {
    text: string;
    ts: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const CACHE_MAX = 100;

export class AgentAIHoverProvider implements vscode.HoverProvider {
    private cache = new Map<string, HoverCacheEntry>();

    constructor(private gw: GatewayClient) {
        // 定期清理过期缓存
        setInterval(() => {
            const now = Date.now();
            for (const [k, v] of this.cache) {
                if (now - v.ts > CACHE_TTL) this.cache.delete(k);
            }
            if (this.cache.size > CACHE_MAX) {
                const arr = Array.from(this.cache.entries()).sort((a, b) => a[1].ts - b[1].ts);
                for (let i = 0; i < arr.length - CACHE_MAX; i++) this.cache.delete(arr[i][0]);
            }
        }, 60_000);
    }

    async provideHover(doc: vscode.TextDocument, pos: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        // 1. 取当前 token (单词)
        const wordRange = doc.getWordRangeAtPosition(pos);
        if (!wordRange) return undefined;
        const word = doc.getText(wordRange);
        if (!word || word.length < 2) return undefined;

        // 2. 提取所在行的函数签名/上下文
        const lineText = doc.lineAt(pos.line).text;
        let contextSnippet = lineText.trim();
        // 尝试获取更多上下文 (前后 5 行)
        const startLine = Math.max(0, pos.line - 5);
        const endLine = Math.min(doc.lineCount - 1, pos.line + 5);
        const contextBlock = [];
        for (let i = startLine; i <= endLine; i++) {
            contextBlock.push(doc.lineAt(i).text);
        }
        const fullContext = contextBlock.join('\n').trim();

        // 3. 缓存检查
        const cacheKey = `${doc.uri.fsPath}:${word}:${contextSnippet}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return this.makeHover(cached.text, wordRange);
        }

        // 4. 离线 / 未连接 → 简单内联文档
        if (!this.gw.isConnected) {
            return new vscode.Hover([
                `**${word}** (本地)`,
                '---',
                'Gateway 离线, 请启动 pnpm start',
            ], wordRange);
        }

        // 5. 调用 Gateway 快速解释
        try {
            const prompt = `请用 1-2 句话解释代码中的 \`${word}\` (出现在: ${doc.languageId} 文件, 上下文: ${contextSnippet.slice(0, 200)}), 简短直接, 不要 markdown 围栏.`;
            const res: any = await this.gw.httpPost('/v1/chat', {
                message: prompt,
                userId: 'vscode-hover',
                workspace: doc.uri.fsPath,
                stream: false,
            });
            const text = (res?.text || res?.message || 'AI 暂无解释').toString().slice(0, 500);
            this.cache.set(cacheKey, { text, ts: Date.now() });
            return this.makeHover(text, wordRange);
        } catch {
            return undefined;
        }
    }

    private makeHover(text: string, range: vscode.Range): vscode.Hover {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**🤖 AgentAI 解释**\n\n${text}\n\n---\n*输入 \`Cmd+Shift+A\` 打开完整对话*`);
        md.isTrusted = true;
        return new vscode.Hover(md, range);
    }
}
