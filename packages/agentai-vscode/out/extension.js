"use strict";
/**
 * PulseFlow - VSCode 扩展 v5 (AgentAI Platform 底层框架)
 * ----------------------------------------------------
 * v5 重大升级 (2026-07-15):
 *   v4: 5 视图 TreeView + 8 Code Action + @-file
 *   v5 新增:
 *     - CodeLens Provider (函数级 AI 入口, 4 动作)
 *     - Hover Provider (悬停 AI 解释, 5min 缓存)
 *     - Inline Completion Provider (Copilot 风格补全, 24h LRU 缓存)
 *     - Multi-File Composer (Cursor Composer 对标)
 *     - P0 全部 P1 补齐
 *
 * 品牌: PulseFlow (产品) + AgentAI Platform (底层框架)
 * 含义: Pulse (脉动/状态感知) + Flow (流动/智能演进)
 * 理念: 望闻问切 · 因证施治 · 越用越懂你的 AI 智能体
 *
 * 功能总览:
 *   - 对话 Webview + 流式 markdown
 *   - 5 视图 TreeView 侧栏
 *   - 8 Code Action 快速入口
 *   - @-file 上下文补全
 *   - CodeLens 函数级 AI
 *   - Hover AI 解释
 *   - Inline Completion
 *   - Multi-File Composer
 *   - Gateway 状态栏实时监测
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const gateway_client_1 = require("./gateway-client");
const code_action_1 = require("./providers/code-action");
const sidebar_provider_1 = require("./views/sidebar-provider");
const at_file_completion_1 = require("./providers/at-file-completion");
const code_lens_1 = require("./providers/code-lens");
const hover_1 = require("./providers/hover");
const inline_completion_1 = require("./providers/inline-completion");
const composer_panel_1 = require("./views/composer-panel");
const ai_actions_1 = require("./core/ai-actions");
const webview_template_1 = require("./shared/webview-template");
let gateway = null;
let statusBarItem = null;
let sidebarRefresh = null;
function activate(context) {
    // 把 context 暴露给 sidebar 等需要 globalState 的模块
    global.agentaiContext = context;
    // 状态栏
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = `$(hubot) AgentAI`;
    statusBarItem.tooltip = '点击打开 AI 对话';
    statusBarItem.command = 'agentai.openChat';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Gateway 客户端
    const config = vscode.workspace.getConfiguration('agentai');
    const gatewayUrl = config.get('gatewayUrl', 'ws://127.0.0.1:18789');
    gateway = new gateway_client_1.GatewayClient(gatewayUrl);
    context.subscriptions.push(gateway);
    gateway.connect().catch(() => { });
    // 健康监测
    const healthTimer = setInterval(() => {
        if (statusBarItem) {
            const ok = gateway?.isConnected;
            statusBarItem.text = ok ? `$(hubot) AgentAI` : `$(warning) AgentAI Offline`;
            statusBarItem.tooltip = ok ? '点击打开 AI 对话' : 'Gateway 离线，检查 pnpm start';
        }
    }, 5000);
    context.subscriptions.push({ dispose: () => clearInterval(healthTimer) });
    // ===== P0 升级: 5 视图 TreeView 侧栏 =====
    const projectView = new sidebar_provider_1.AgentAISidebarProvider('project');
    const sessionsView = new sidebar_provider_1.AgentAISidebarProvider('sessions');
    const tasksView = new sidebar_provider_1.AgentAISidebarProvider('tasks');
    const toolsView = new sidebar_provider_1.AgentAISidebarProvider('tools');
    const memoryView = new sidebar_provider_1.AgentAISidebarProvider('memory');
    sidebarRefresh = () => {
        projectView.refresh();
        sessionsView.refresh();
        tasksView.refresh();
        toolsView.refresh();
        memoryView.refresh();
    };
    context.subscriptions.push(vscode.window.registerTreeDataProvider('agentai.projectView', projectView), vscode.window.registerTreeDataProvider('agentai.sessionsView', sessionsView), vscode.window.registerTreeDataProvider('agentai.tasksView', tasksView), vscode.window.registerTreeDataProvider('agentai.toolsView', toolsView), vscode.window.registerTreeDataProvider('agentai.memoryView', memoryView));
    // ===== P0 升级: Code Action Provider (8 个入口) =====
    const codeActionProvider = new code_action_1.AgentAICodeActionProvider(gateway);
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: 'file', language: '*' }, codeActionProvider, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
    // ===== P0 升级: @-file Completion Provider =====
    const atFileProvider = new at_file_completion_1.AtFileCompletionProvider();
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ scheme: 'file', language: '*' }, atFileProvider, '@'));
    // ===== P1 升级: CodeLens Provider (函数级 AI 入口) =====
    const codeLensProvider = new code_lens_1.AgentAICodeLensProvider(gateway);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: 'file', language: '*' }, codeLensProvider));
    // ===== P1 升级: Hover Provider (悬停 AI 解释) =====
    const hoverProvider = new hover_1.AgentAIHoverProvider(gateway);
    context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: 'file', language: '*' }, hoverProvider));
    // ===== P1 升级: Inline Completion Provider (Copilot 风格补全) =====
    const inlineCompletionProvider = new inline_completion_1.AgentAIInlineCompletionProvider(gateway);
    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file', language: '*' }, inlineCompletionProvider));
    // ===== 命令注册 =====
    context.subscriptions.push(vscode.commands.registerCommand('agentai.openChat', () => {
        GatewayPanel.createOrShow(context.extensionUri, gateway);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('agentai.explainSelection', async () => {
        await (0, ai_actions_1.handleAIAction)('explain', gateway, () => GatewayPanel.createOrShow(context.extensionUri, gateway), text => GatewayPanel.currentPanel?.sendMessage(text));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('agentai.fixSelection', async () => {
        await (0, ai_actions_1.handleAIAction)('fix', gateway, () => GatewayPanel.createOrShow(context.extensionUri, gateway), text => GatewayPanel.currentPanel?.sendMessage(text));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('agentai.refactorSelection', async () => {
        await (0, ai_actions_1.handleAIAction)('refactor', gateway, () => GatewayPanel.createOrShow(context.extensionUri, gateway), text => GatewayPanel.currentPanel?.sendMessage(text));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('agentai.optimizeSelection', async () => {
        await (0, ai_actions_1.handleAIAction)('optimize', gateway, () => GatewayPanel.createOrShow(context.extensionUri, gateway), text => GatewayPanel.currentPanel?.sendMessage(text));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('agentai.testSelection', async () => {
        await (0, ai_actions_1.handleAIAction)('test', gateway, () => GatewayPanel.createOrShow(context.extensionUri, gateway), text => GatewayPanel.currentPanel?.sendMessage(text));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('agentai.docSelection', async () => {
        await (0, ai_actions_1.handleAIAction)('doc', gateway, () => GatewayPanel.createOrShow(context.extensionUri, gateway), text => GatewayPanel.currentPanel?.sendMessage(text));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('agentai.translateSelection', async () => {
        await (0, ai_actions_1.handleAIAction)('translate', gateway, () => GatewayPanel.createOrShow(context.extensionUri, gateway), text => GatewayPanel.currentPanel?.sendMessage(text));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('agentai.typesSelection', async () => {
        await (0, ai_actions_1.handleAIAction)('types', gateway, () => GatewayPanel.createOrShow(context.extensionUri, gateway), text => GatewayPanel.currentPanel?.sendMessage(text));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('agentai.reviewProject', async () => {
        if (!gateway?.isConnected)
            return vscode.window.showWarningMessage('Gateway 离线');
        GatewayPanel.createOrShow(context.extensionUri, gateway);
        GatewayPanel.currentPanel?.sendMessage('请审查当前项目的代码结构, 指出潜在问题和改进建议');
    }));
    // 编辑选中的代码 (AI 直接重写, 弹窗 Diff 预览)
    context.subscriptions.push(vscode.commands.registerCommand('agentai.editSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const text = editor.document.getText(editor.selection);
        if (!text)
            return vscode.window.showWarningMessage('请先选中代码');
        if (!gateway?.isConnected)
            return vscode.window.showWarningMessage('Gateway 离线');
        const instruction = await vscode.window.showInputBox({
            prompt: '告诉 AI 怎么改这段代码',
            placeHolder: '例如: 加错误处理 / 改用 async / 补充类型注释',
        });
        if (!instruction)
            return;
        GatewayPanel.createOrShow(context.extensionUri, gateway);
        GatewayPanel.currentPanel?.sendMessage(`按下列要求改写代码, 直接输出完整结果, 不要解释:\n\n要求: ${instruction}\n\n原代码 (${editor.document.languageId}):\n\`\`\`\n${text}\n\`\`\``);
    }));
    // AI 生成代码插入 (基于描述)
    context.subscriptions.push(vscode.commands.registerCommand('agentai.insertFromPrompt', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        if (!gateway?.isConnected)
            return vscode.window.showWarningMessage('Gateway 离线');
        const prompt = await vscode.window.showInputBox({
            prompt: '描述要插入的代码',
            placeHolder: '例如: React 函数组件 Props 校验 / 高阶函数 / 排序算法',
        });
        if (!prompt)
            return;
        GatewayPanel.createOrShow(context.extensionUri, gateway);
        GatewayPanel.currentPanel?.sendMessage(`生成代码, 直接输出完整代码, 不要解释, 不要 markdown 围栏:\n\n${prompt}`);
    }));
    // 把当前文件读进对话
    context.subscriptions.push(vscode.commands.registerCommand('agentai.attachActiveFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return vscode.window.showWarningMessage('没有打开的文件');
        if (!gateway?.isConnected)
            return vscode.window.showWarningMessage('Gateway 离线');
        const text = editor.document.getText();
        GatewayPanel.createOrShow(context.extensionUri, gateway);
        const lang = editor.document.languageId;
        GatewayPanel.currentPanel?.sendMessage(`当前文件 (${editor.document.fileName.split(/[\\/]/).pop()}, ${lang}):\n\`\`\`${lang}\n${text.slice(0, 12000)}\n\`\`\``);
    }));
    // 切换 LLM 模型
    context.subscriptions.push(vscode.commands.registerCommand('agentai.switchModel', async () => {
        const models = ['agentai', 'deepseek', 'openai', 'cline', 'zhipu'];
        const picked = await vscode.window.showQuickPick(models, { placeHolder: '选择 LLM 模型' });
        if (picked) {
            await vscode.workspace.getConfiguration('agentai').update('model', picked, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`已切换到模型: ${picked}`);
            statusBarItem.text = `$(hubot) AgentAI · ${picked}`;
        }
    }));
    // 在终端跑 AI 生成的命令
    context.subscriptions.push(vscode.commands.registerCommand('agentai.runInTerminal', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const text = editor.document.getText(editor.selection) || editor.document.lineAt(editor.selection.active.line).text;
        if (!text)
            return vscode.window.showWarningMessage('请先选中命令');
        const term = vscode.window.createTerminal('AgentAI');
        term.show();
        term.sendText(text);
    }));
    // 切换 AgentAI 框架
    context.subscriptions.push(vscode.commands.registerCommand('agentai.switchFramework', async () => {
        const frameworks = ['openclaw', 'hermes'];
        const picked = await vscode.window.showQuickPick(frameworks, { placeHolder: '选择智能体框架' });
        if (picked) {
            await vscode.workspace.getConfiguration('agentai').update('framework', picked, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`已切换框架: ${picked}`);
        }
    }));
    // 打开项目侧栏文件树视图
    context.subscriptions.push(vscode.commands.registerCommand('agentai.openExplorer', async () => {
        if (!gateway?.isConnected)
            return vscode.window.showWarningMessage('Gateway 离线, 请先启动 pnpm start');
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!folder)
            return vscode.window.showWarningMessage('没有打开的工作区');
        GatewayPanel.createOrShow(context.extensionUri, gateway);
        GatewayPanel.currentPanel?.sendMessage(`请浏览项目: ${folder}\n工作空间目录, 列出主要文件结构和 README 摘要`);
    }));
    // 重新连接 Gateway
    context.subscriptions.push(vscode.commands.registerCommand('agentai.reconnect', async () => {
        const config = vscode.workspace.getConfiguration('agentai');
        const url = config.get('gatewayUrl', 'ws://127.0.0.1:18789');
        gateway?.dispose();
        gateway = new gateway_client_1.GatewayClient(url);
        context.subscriptions.push(gateway);
        await gateway.connect();
        vscode.window.showInformationMessage(gateway.isConnected ? '✅ Gateway 已连接' : '❌ Gateway 连接失败');
    }));
    // 侧栏 - 工具类别
    context.subscriptions.push(vscode.commands.registerCommand('agentai.toolCategory', async (category) => {
        GatewayPanel.createOrShow(context.extensionUri, gateway);
        GatewayPanel.currentPanel?.sendMessage(`列出所有 ${category} 类别的工具, 并给出使用建议`);
    }));
    // 侧栏 - 打开历史会话
    context.subscriptions.push(vscode.commands.registerCommand('agentai.openSession', async (id) => {
        vscode.window.showInformationMessage(`打开会话 ${id} (TODO: 调用 /v1/sessions/${id})`);
    }));
    // 侧栏 - 打开任务
    context.subscriptions.push(vscode.commands.registerCommand('agentai.openTask', async (id) => {
        vscode.window.showInformationMessage(`打开任务 ${id} (TODO: 调用 /v1/tasks/${id})`);
    }));
    // 侧栏 - 回忆记忆
    context.subscriptions.push(vscode.commands.registerCommand('agentai.recallMemory', async (id) => {
        vscode.window.showInformationMessage(`回忆记忆 ${id} (TODO: 调用 /v1/memory/${id})`);
    }));
    // 侧栏 - 刷新
    context.subscriptions.push(vscode.commands.registerCommand('agentai.refreshSidebar', () => {
        sidebarRefresh?.();
    }));
    // ===== P1 升级: Composer (多文件编辑器) =====
    context.subscriptions.push(vscode.commands.registerCommand('agentai.openComposer', () => {
        composer_panel_1.ComposerPanel.createOrShow(gateway);
    }));
    // ===== P1 升级: CodeLens 动作 (4 个) =====
    const CODELENS_PROMPTS = {
        explain: (n, c) => `请详细解释 \`${n}\` 这个函数的功能、参数、返回值、算法/设计模式、潜在问题:\n\`\`\`\n${c}\n\`\`\``,
        test: (n, c) => `请为 \`${n}\` 函数生成完整单元测试 (Vitest 风格), 覆盖正常/边界/异常情况, 直接输出完整测试代码, 不要解释:\n\`\`\`\n${c}\n\`\`\``,
        refactor: (n, c) => `请重构 \`${n}\` 函数以提高可读性/可维护性/性能, 直接输出重构后完整代码, 不要解释:\n\`\`\`\n${c}\n\`\`\``,
        doc: (n, c) => `请为 \`${n}\` 函数添加详细 JSDoc 文档注释, 直接输出添加注释后完整代码, 不要解释:\n\`\`\`\n${c}\n\`\`\``,
    };
    for (const action of ['explain', 'test', 'refactor', 'doc']) {
        context.subscriptions.push(vscode.commands.registerCommand(`agentai.codelens.${action}`, async (filePath, name, code) => {
            if (!gateway?.isConnected)
                return vscode.window.showWarningMessage('Gateway 离线');
            GatewayPanel.createOrShow(context.extensionUri, gateway);
            GatewayPanel.currentPanel?.sendMessage(CODELENS_PROMPTS[action](name, code));
        }));
    }
    // ===== P1 升级: 手动触发 Inline Completion =====
    context.subscriptions.push(vscode.commands.registerCommand('agentai.triggerCompletion', async () => {
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }));
}
function deactivate() {
    gateway?.dispose();
    statusBarItem?.dispose();
}
class GatewayPanel {
    static currentPanel = null;
    panel;
    gw;
    msgId = 0;
    static createOrShow(uri, gw) {
        if (GatewayPanel.currentPanel) {
            GatewayPanel.currentPanel.panel.reveal();
            return;
        }
        GatewayPanel.currentPanel = new GatewayPanel(uri, gw);
    }
    constructor(uri, gw) {
        this.gw = gw;
        this.panel = vscode.window.createWebviewPanel('agentaiChat', 'PulseFlow', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        // 使用共享 Webview 模板 (与 GUI 视觉对齐)
        this.panel.webview.html = (0, webview_template_1.getWebviewHtml)({
            title: 'PulseFlow',
            initialMessage: 'PulseFlow — 让智能体理解系统的生命状态\n输入消息开始对话\n用 @ 引用文件/工具/记忆',
            showFileTree: true,
            showComposer: true,
            variant: 'chat',
        });
        this.panel.webview.onDidReceiveMessage((m) => this.handleMsg(m));
        this.panel.onDidDispose(() => { GatewayPanel.currentPanel = null; });
    }
    sendMessage(text) {
        this.panel.webview.postMessage({ type: 'userMsg', text });
        this.doChat(text);
    }
    async handleMsg(msg) {
        if (msg.type === 'chat')
            this.doChat(msg.text);
        if (msg.type === 'openFile')
            vscode.window.showTextDocument(vscode.Uri.file(msg.path));
        if (msg.type === 'listFiles')
            this.listFiles(msg.dir);
        if (msg.type === 'refreshSidebar')
            sidebarRefresh?.();
    }
    async listFiles(dir = '.') {
        try {
            const config = vscode.workspace.getConfiguration('agentai');
            const httpUrl = config.get('gatewayHttpUrl', 'http://127.0.0.1:18789');
            const res = await fetch(`${httpUrl}/v1/files?dir=${encodeURIComponent(dir)}`);
            const data = await res.json();
            this.panel.webview.postMessage({ type: 'fileList', files: data.files || [], dir });
        }
        catch { /* offline */ }
    }
    async doChat(text) {
        const id = ++this.msgId;
        this.panel.webview.postMessage({ type: 'botStart', id });
        await this.gw.streamChat(text, (d) => this.panel.webview.postMessage({ type: 'botDelta', id, text: d }), (f) => this.panel.webview.postMessage({ type: 'botDone', id }), (e) => this.panel.webview.postMessage({ type: 'botError', id, error: e }));
    }
}
//# sourceMappingURL=extension.js.map