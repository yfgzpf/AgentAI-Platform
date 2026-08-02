/**
 * AgentAI - CodeLens Provider
 * ----------------------------------------------------
 * 在每个函数/类上方显示 AI 入口 (类似 Copilot)
 * 4 个动作: 解释 / 测试 / 重构 / 文档
 */

import * as vscode from 'vscode';
import { GatewayClient } from '../gateway-client';

interface CodeBlock {
    name: string;
    range: vscode.Range;
    kind: 'function' | 'class' | 'method' | 'arrow' | 'block';
}

const ACTIONS = [
    { id: 'explain', title: '🤖 解释', icon: 'comment-discussion' },
    { id: 'test', title: '🧪 生成测试', icon: 'beaker' },
    { id: 'refactor', title: '🔧 重构', icon: 'symbol-refactor' },
    { id: 'doc', title: '📝 文档', icon: 'book' },
] as const;

export class AgentAICodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor(private gw: GatewayClient) {
        // 监听编辑器变化, 自动刷新
        vscode.workspace.onDidChangeTextDocument(() => this._onDidChangeCodeLenses.fire());
        vscode.window.onDidChangeActiveTextEditor(() => this._onDidChangeCodeLenses.fire());
    }

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
        const blocks = this.detectCodeBlocks(doc);
        const lenses: vscode.CodeLens[] = [];

        for (const block of blocks) {
            // 每个 block 上方一行放 CodeLens
            const lensRange = new vscode.Range(block.range.start, block.range.start);
            for (const action of ACTIONS) {
                const lens = new vscode.CodeLens(lensRange, {
                    title: action.title,
                    command: `agentai.codelens.${action.id}`,
                    arguments: [doc.uri.fsPath, block.name, doc.getText(block.range)],
                });
                lenses.push(lens);
            }
        }

        return lenses;
    }

    /**
     * 简单的代码块检测: 函数/类/方法/箭头函数
     */
    private detectCodeBlocks(doc: vscode.TextDocument): CodeBlock[] {
        const blocks: CodeBlock[] = [];
        const lang = doc.languageId;
        const text = doc.getText();

        if (['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(lang)) {
            // function name(...) / class Name / const name = (...) =>
            const fnRe = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
            const classRe = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
            const arrowRe = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+(?:<[^>]+>)?)?\s*=\s*(?:async\s+)?\(/gm;
            const methodRe = /^\s+(?:public|private|protected|static|async)?\s*(\w+)\s*\(/gm;

            let m;
            while ((m = fnRe.exec(text)) !== null) {
                const pos = doc.positionAt(m.index);
                const lineEnd = doc.lineAt(pos.line).range.end;
                blocks.push({ name: m[1], range: new vscode.Range(pos, this.findBlockEnd(doc, pos)), kind: 'function' });
            }
            while ((m = classRe.exec(text)) !== null) {
                const pos = doc.positionAt(m.index);
                blocks.push({ name: m[1], range: new vscode.Range(pos, this.findBlockEnd(doc, pos)), kind: 'class' });
            }
            while ((m = arrowRe.exec(text)) !== null) {
                const pos = doc.positionAt(m.index);
                blocks.push({ name: m[1], range: new vscode.Range(pos, this.findBlockEnd(doc, pos)), kind: 'arrow' });
            }
        } else if (lang === 'python') {
            const defRe = /^(?:async\s+)?def\s+(\w+)/gm;
            const classRe = /^class\s+(\w+)/gm;
            let m;
            while ((m = defRe.exec(text)) !== null) {
                const pos = doc.positionAt(m.index);
                blocks.push({ name: m[1], range: new vscode.Range(pos, this.findBlockEnd(doc, pos)), kind: 'function' });
            }
            while ((m = classRe.exec(text)) !== null) {
                const pos = doc.positionAt(m.index);
                blocks.push({ name: m[1], range: new vscode.Range(pos, this.findBlockEnd(doc, pos)), kind: 'class' });
            }
        } else if (lang === 'rust') {
            const fnRe = /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm;
            let m;
            while ((m = fnRe.exec(text)) !== null) {
                const pos = doc.positionAt(m.index);
                blocks.push({ name: m[1], range: new vscode.Range(pos, this.findBlockEnd(doc, pos)), kind: 'function' });
            }
        } else if (lang === 'go') {
            const fnRe = /^func\s+(?:\([^)]*\)\s+)?(\w+)/gm;
            let m;
            while ((m = fnRe.exec(text)) !== null) {
                const pos = doc.positionAt(m.index);
                blocks.push({ name: m[1], range: new vscode.Range(pos, this.findBlockEnd(doc, pos)), kind: 'function' });
            }
        }

        return blocks.slice(0, 50); // 限制最多 50 个
    }

    /**
     * 通过括号匹配找代码块结束位置 (最多 200 行)
     */
    private findBlockEnd(doc: vscode.TextDocument, start: vscode.Position): vscode.Position {
        const startLine = start.line;
        let depth = 0;
        let started = false;
        for (let i = startLine; i < Math.min(startLine + 200, doc.lineCount); i++) {
            const line = doc.lineAt(i).text;
            for (const ch of line) {
                if (ch === '{') { depth++; started = true; }
                else if (ch === '}') {
                    depth--;
                    if (started && depth === 0) {
                        return doc.lineAt(i).range.end;
                    }
                }
            }
        }
        // Python 缩进块
        if (doc.languageId === 'python') {
            const baseIndent = doc.lineAt(startLine).firstNonWhitespaceCharacterIndex;
            for (let i = startLine + 1; i < doc.lineCount; i++) {
                const line = doc.lineAt(i);
                if (line.isEmptyOrWhitespace) continue;
                const indent = line.firstNonWhitespaceCharacterIndex;
                if (indent <= baseIndent) {
                    return doc.lineAt(i - 1).range.end;
                }
            }
        }
        return doc.lineAt(Math.min(startLine + 50, doc.lineCount - 1)).range.end;
    }
}
