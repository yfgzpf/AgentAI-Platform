/**
 * AgentAI - AI 选中代码操作
 * ----------------------------------------------------
 * 8 种 AI 动作的统一实现: 解释/修复/重构/优化/测试/文档/翻译/补类型
 */

import * as vscode from 'vscode';
import { GatewayClient } from '../gateway-client';

export type AIActionType = 'explain' | 'fix' | 'refactor' | 'optimize' | 'test' | 'doc' | 'translate' | 'types';

const PROMPTS: Record<AIActionType, (lang: string, code: string) => string> = {
    explain: (lang, code) => `请详细解释这段代码的功能、输入输出、关键算法/设计模式、潜在问题:\n\`\`\`${lang}\n${code}\n\`\`\``,
    fix: (lang, code) => `请修复这段代码的 bug (如果有) 并优化 (请直接输出修复后完整代码, 不要解释):\n\`\`\`${lang}\n${code}\n\`\`\``,
    refactor: (lang, code) => `请重构这段代码以提高可读性、可维护性、性能 (请直接输出重构后完整代码, 不要解释):\n\`\`\`${lang}\n${code}\n\`\`\``,
    optimize: (lang, code) => `请找出这段代码的性能瓶颈并优化 (时间复杂度/空间复杂度/IO/缓存), 直接输出优化后完整代码, 不要解释:\n\`\`\`${lang}\n${code}\n\`\`\``,
    test: (lang, code) => `请为这段代码生成完整的单元测试 (Vitest/Jest/Mocha 风格), 覆盖正常/边界/异常情况, 直接输出完整测试代码, 不要解释:\n\`\`\`${lang}\n${code}\n\`\`\``,
    doc: (lang, code) => `请为这段代码添加详细的 JSDoc 文档注释 (参数/返回值/异常/示例), 直接输出添加注释后完整代码, 不要解释:\n\`\`\`${lang}\n${code}\n\`\`\``,
    translate: (lang, code) => `请将这段代码的所有中文注释/字符串翻译为英文, 保留代码结构, 直接输出翻译后完整代码, 不要解释:\n\`\`\`${lang}\n${code}\n\`\`\``,
    types: (lang, code) => `请为这段 JavaScript 代码补充 TypeScript 类型 (函数参数/返回值/变量/接口), 直接输出补全后完整代码, 不要解释:\n\`\`\`${lang}\n${code}\n\`\`\``,
};

export async function handleAIAction(
    action: AIActionType,
    gw: GatewayClient,
    openChat: () => void,
    sendToChat: (text: string) => void,
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('没有打开的编辑器');
        return;
    }
    const text = editor.document.getText(editor.selection);
    if (!text) {
        vscode.window.showWarningMessage('请先选中代码');
        return;
    }
    if (!gw.isConnected) {
        vscode.window.showWarningMessage('Gateway 离线, 请检查 pnpm start');
        return;
    }
    const lang = editor.document.languageId;
    const prompt = PROMPTS[action](lang, text.slice(0, 12000));
    openChat();
    sendToChat(prompt);
}
