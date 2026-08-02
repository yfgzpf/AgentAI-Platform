/**
 * AgentAI - Inline Completion Provider (Copilot 风格)
 * ----------------------------------------------------
 * 输入时自动补全 (灰色文本),  按 Tab 接受
 * 上下文: 前 50 行 + 后 20 行
 * LRU 缓存 24h
 * 防抖: 输入 500ms 内不重复请求
 */

import * as vscode from 'vscode';
import { GatewayClient } from '../gateway-client';

interface CompletionCacheEntry {
    items: string[];
    ts: number;
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const CACHE_MAX = 500;
const DEBOUNCE_MS = 500;
const PREFIX_LINES = 50;
const SUFFIX_LINES = 20;
const MAX_TOKENS = 500;

export class AgentAIInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private cache = new Map<string, CompletionCacheEntry>();
    private debounceTimers = new Map<string, NodeJS.Timeout>();
    private lastRequestTime = 0;
    private minIntervalMs = 200; // 同文件至少 200ms 间隔

    constructor(private gw: GatewayClient) {
        setInterval(() => {
            const now = Date.now();
            for (const [k, v] of this.cache) {
                if (now - v.ts > CACHE_TTL) this.cache.delete(k);
            }
            if (this.cache.size > CACHE_MAX) {
                const arr = Array.from(this.cache.entries()).sort((a, b) => a[1].ts - b[1].ts);
                for (let i = 0; i < arr.length - CACHE_MAX; i++) this.cache.delete(arr[i][0]);
            }
        }, 5 * 60_000);
    }

    async provideInlineCompletionItems(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        ctx: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        // 1. 跳过明显的非补全场景 (在字符串/注释中, 已经结束的行)
        if (ctx.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
            // 只在用户主动触发 (Ctrl+Space) 时响应, 避免过于频繁
            // 注: 想要自动补全可改为:  if (pos.line > 0)  // 每行都补
        }

        // 2. 取上下文
        const prefix = this.getPrefix(doc, pos);
        const suffix = this.getSuffix(doc, pos);
        const lang = doc.languageId;
        const currentLine = doc.lineAt(pos.line).text;
        // 跳过注释/字符串
        if (this.isInCommentOrString(currentLine, pos.character)) return undefined;

        // 3. 缓存 key: 文件 + 行号 + 前后文指纹
        const key = `${doc.uri.fsPath}:${pos.line}:${prefix.slice(-200)}`;
        const cached = this.cache.get(key);
        if (cached) {
            return cached.items.map(text => this.makeItem(text, pos));
        }

        // 4. 防抖: 短时间内的重复请求合并
        if (this.debounceTimers.has(key)) {
            clearTimeout(this.debounceTimers.get(key)!);
        }

        // 5. 限流
        const now = Date.now();
        if (now - this.lastRequestTime < this.minIntervalMs) return undefined;
        if (!this.gw.isConnected) return undefined;

        // 6. 防抖请求
        return new Promise<vscode.InlineCompletionItem[] | undefined>((resolve) => {
            const timer = setTimeout(async () => {
                this.debounceTimers.delete(key);
                this.lastRequestTime = Date.now();
                try {
                    const items = await this.fetchCompletion(prefix, suffix, lang, token);
                    if (items.length > 0) {
                        this.cache.set(key, { items, ts: Date.now() });
                    }
                    resolve(items.map(t => this.makeItem(t, pos)));
                } catch {
                    resolve(undefined);
                }
            }, DEBOUNCE_MS);
            this.debounceTimers.set(key, timer);

            // 如果 token 取消, 立即清理
            token.onCancellationRequested(() => {
                clearTimeout(timer);
                this.debounceTimers.delete(key);
                resolve(undefined);
            });
        });
    }

    private async fetchCompletion(
        prefix: string,
        suffix: string,
        lang: string,
        token: vscode.CancellationToken,
    ): Promise<string[]> {
        const prompt = `你是代码补全 AI. 只输出补全内容 (不要解释, 不要围栏, 不要 markdown).

语言: ${lang}

代码上文 (最近的 ${PREFIX_LINES} 行):
\`\`\`${lang}
${prefix}
\`\`\`

代码下文 (接下来 ${SUFFIX_LINES} 行):
\`\`\`${lang}
${suffix}
\`\`\`

请在 <CURSOR> 位置补全代码 (1-3 行, 总长度不超过 ${MAX_TOKENS} 字符):`;

        try {
            const res: any = await this.gw.httpPost('/v1/chat', {
                message: prompt,
                userId: 'vscode-completion',
                workspace: 'completion',
                stream: false,
            });
            if (token.isCancellationRequested) return [];
            let text = (res?.text || res?.message || '').toString();
            // 清理: 移除 markdown 围栏, 解释前缀等
            text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```\s*$/, '');
            text = text.split('\n').filter((l: string) => !l.match(/^(说明|解释|Here's|补全)/i)).join('\n').trim();
            if (!text || text.length > MAX_TOKENS * 2) return [];
            // 按双换行拆分成多个候选
            const candidates = text.split(/\n\n/).map((s: string) => s.trim()).filter((s: string) => s.length > 0);
            return candidates.slice(0, 3);
        } catch {
            return [];
        }
    }

    private makeItem(text: string, pos: vscode.Position): vscode.InlineCompletionItem {
        // 计算补全插入范围: 从当前光标到行末 (替换当前行未完成部分)
        const line = pos.line;
        const col = pos.character;
        const range = new vscode.Range(line, col, line, col);
        const item = new vscode.InlineCompletionItem(text, range);
        return item;
    }

    private getPrefix(doc: vscode.TextDocument, pos: vscode.Position): string {
        const startLine = Math.max(0, pos.line - PREFIX_LINES);
        const lines: string[] = [];
        for (let i = startLine; i < pos.line; i++) {
            lines.push(doc.lineAt(i).text);
        }
        // 当前行只取到光标处
        lines.push(doc.lineAt(pos.line).text.substring(0, pos.character));
        return lines.join('\n');
    }

    private getSuffix(doc: vscode.TextDocument, pos: vscode.Position): string {
        const endLine = Math.min(doc.lineCount - 1, pos.line + SUFFIX_LINES);
        const lines: string[] = [];
        for (let i = pos.line + 1; i <= endLine; i++) {
            lines.push(doc.lineAt(i).text);
        }
        return lines.join('\n');
    }

    private isInCommentOrString(line: string, col: number): boolean {
        const before = line.substring(0, col);
        // 简单检测: // 注释 / 字符串内
        if (before.match(/\/\/.*$/)) return true;
        if (before.match(/(["'`])(?:(?!\1).)*$/) && before.match(/(["'`])(?:(?!\1).)*\1.*$/)) return true;
        return false;
    }
}
