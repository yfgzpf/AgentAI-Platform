/**
 * AgentAI - Code Action Provider
 * ----------------------------------------------------
 * 右键菜单 AI 入口 (类似 Cursor/Copilot Quick Fix)
 * 6 个高频操作: 解释/修复/重构/优化/测试/文档
 */

import * as vscode from 'vscode';
import { GatewayClient } from '../gateway-client';

const ACTIONS = [
    { id: 'explain', title: '🤖 AgentAI: 解释这段代码', icon: 'comment-discussion' },
    { id: 'fix', title: '🤖 AgentAI: 修复这段代码', icon: 'tools' },
    { id: 'refactor', title: '🤖 AgentAI: 重构这段代码', icon: 'symbol-refactor' },
    { id: 'optimize', title: '🤖 AgentAI: 优化性能', icon: 'zap' },
    { id: 'test', title: '🤖 AgentAI: 生成单元测试', icon: 'beaker' },
    { id: 'doc', title: '🤖 AgentAI: 生成文档注释', icon: 'book' },
    { id: 'translate', title: '🤖 AgentAI: 翻译为英文', icon: 'globe' },
    { id: 'types', title: '🤖 AgentAI: 补充 TypeScript 类型', icon: 'symbol-type-parameter' },
] as const;

export class AgentAICodeActionProvider implements vscode.CodeActionProvider {
    constructor(private gw: GatewayClient) {}

    provideCodeActions(
        doc: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _ctx: vscode.CodeActionContext,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        // 没有选中时不显示
        if (range.isEmpty && range.start.line === range.end.line && range.start.character === range.end.character) {
            return [];
        }

        return ACTIONS.map(a => {
            const action = new vscode.CodeAction(
                a.title,
                vscode.CodeActionKind.QuickFix,
            );
            action.command = {
                command: `agentai.${a.id}Selection`,
                title: a.title,
                arguments: [doc, range],
            };
            action.isPreferred = a.id === 'fix' || a.id === 'explain';
            return action;
        });
    }
}
