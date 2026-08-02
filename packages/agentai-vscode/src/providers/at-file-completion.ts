/**
 * AgentAI - @-file Completion Provider
 * ----------------------------------------------------
 * 行业标准交互: 输入 @ 弹出文件/工具/记忆快速引用
 */

import * as vscode from 'vscode';
import * as path from 'path';

const FILE_LIMIT = 30;
const TOOL_LIMIT = 15;
const MEMORY_LIMIT = 5;

const COMMON_TOOLS = [
    { name: 'read_file', desc: '读取文件' },
    { name: 'write_file', desc: '写入文件' },
    { name: 'edit_file', desc: '编辑文件' },
    { name: 'search_content', desc: '搜索内容' },
    { name: 'shell_run', desc: '执行 shell' },
    { name: 'web_search', desc: 'Web 搜索' },
    { name: 'plan_task', desc: '任务规划' },
    { name: 'remember', desc: '记住信息' },
    { name: 'recall_memory', desc: '回忆记忆' },
    { name: 'browser_navigate', desc: '打开网页' },
    { name: 'capture_screen', desc: '截图' },
    { name: 'list_processes', desc: '列出进程' },
    { name: 'self_diagnose', desc: '系统自检' },
    { name: 'evolve_prompt', desc: '自进化规则' },
    { name: 'create_tool', desc: '创建工具' },
];

const FILE_SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '__pycache__', 'target', 'vendor']);

export class AtFileCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        _token: vscode.CancellationToken,
    ): Promise<vscode.CompletionItem[] | undefined> {
        // 检查光标前是否是 @
        const line = doc.lineAt(pos.line).text;
        const before = line.substring(0, pos.character);
        const atMatch = before.match(/@(\S*)$/);
        if (!atMatch) return undefined;

        const prefix = atMatch[1];
        const items: vscode.CompletionItem[] = [];

        // 1. 文件补全
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const files = await this.walkFiles(workspaceFolder.uri.fsPath, '', prefix, 0, FILE_LIMIT);
            for (const f of files) {
                const item = new vscode.CompletionItem(`📄 ${f.rel}`, vscode.CompletionItemKind.File);
                item.insertText = f.rel;
                item.detail = `文件 · ${f.size}`;
                item.documentation = `相对路径: ${f.rel}\n点击插入到对话`;
                items.push(item);
            }
        }

        // 2. 工具补全
        for (const t of COMMON_TOOLS) {
            if (prefix && !t.name.includes(prefix)) continue;
            const item = new vscode.CompletionItem(`🔧 ${t.name}`, vscode.CompletionItemKind.Function);
            item.insertText = t.name;
            item.detail = `工具 · ${t.desc}`;
            item.documentation = `调用工具: ${t.name}\n${t.desc}`;
            items.push(item);
        }

        // 3. 记忆补全 (从全局状态读取)
        try {
            const globalState = (global as any).agentaiContext?.globalState;
            const memories = globalState?.get('memory') || [];
            for (const m of memories.slice(0, MEMORY_LIMIT)) {
                if (prefix && !m.content.includes(prefix)) continue;
                const item = new vscode.CompletionItem(`🧠 ${m.content.slice(0, 30)}...`, vscode.CompletionItemKind.Reference);
                item.insertText = m.content;
                item.detail = `记忆 · ${m.scope || 'project'}`;
                items.push(item);
            }
        } catch { /* skip */ }

        return items;
    }

    private async walkFiles(
        base: string,
        rel: string,
        prefix: string,
        depth: number,
        limit: number,
    ): Promise<{ rel: string; size: string }[]> {
        if (depth > 4) return [];
        const fs = require('fs') as typeof import('fs');
        const full = path.join(base, rel);
        let entries: import('fs').Dirent[];
        try {
            entries = await fs.promises.readdir(full, { withFileTypes: true });
        } catch { return []; }
        const results: { rel: string; size: string }[] = [];
        for (const e of entries) {
            if (FILE_SKIP.has(e.name)) continue;
            if (e.name.startsWith('.') && e.name !== '.env.example') continue;
            const subRel = rel ? `${rel}/${e.name}` : e.name;
            if (prefix && !subRel.toLowerCase().includes(prefix.toLowerCase())) continue;
            if (e.isDirectory()) {
                const sub = await this.walkFiles(base, subRel, prefix, depth + 1, limit - results.length);
                results.push(...sub);
            } else {
                if (results.length >= limit) break;
                try {
                    const stat = await fs.promises.stat(path.join(base, subRel));
                    results.push({ rel: subRel, size: this.formatSize(stat.size) });
                } catch {
                    results.push({ rel: subRel, size: '?' });
                }
            }
            if (results.length >= limit) break;
        }
        return results;
    }

    private formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    }
}
