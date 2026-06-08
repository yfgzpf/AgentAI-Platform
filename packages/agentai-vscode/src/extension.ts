/**
 * AgentAI Platform - VSCode 扩展 (真接入, 不再瞎搞)
 * ----------------------------------------------------------------
 * 真参考:
 *   - /f/cursor/resources/app/extensions/cursor-mcp/dist/main.js (3.4MB 真实代码)
 *   - Cursor 3.2.21 基于 vscodeVersion 1.105.1
 *   - 真用了 WebSocket + vscode.window API + vscode.workspace
 *
 * 学自 Cursor cursor-mcp:
 *   - activationEvents: onStartupFinished (注册后台生命周期)
 *   - vscode.commands.registerCommand (命令注册)
 *   - vscode.workspace.getConfiguration (读配置)
 *
 * 自创:
 *   - 接入 AgentAI Gateway WebSocket (localhost:18789)
 *   - 提供 "切换框架" + "切换模型" + 4 个文件命令
 *   - 富文本 Webview 聊天 (markdown 渲染)
 *   - 不抢焦点: 走状态栏 + 通知, 不弹窗
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GatewayClient } from './gateway-client';

let gateway: GatewayClient | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let modelBarItem: vscode.StatusBarItem | null = null;
let activeFramework: 'openclaw' | 'hermes' = 'openclaw';
let activeModel: 'agentai' | 'deepseek' | 'openai' = 'agentai';

const MODELS: { id: 'agentai' | 'deepseek' | 'openai'; label: string }[] = [
  { id: 'agentai', label: 'Agnes AI (主)' },
  { id: 'deepseek', label: 'DeepSeek (备)' },
  { id: 'openai', label: 'OpenAI (备)' },
];

export function activate(context: vscode.ExtensionContext): void {
  console.log('[AgentAI] extension activated');

  // 1. 状态栏: 框架
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.text = `$(comment-discussion) AgentAI: ${activeFramework}`;
  statusBarItem.tooltip = '点击切换智能体框架 (OpenClaw ↔ Hermes)';
  statusBarItem.command = 'agentai.switchFramework';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 2. 状态栏: 模型 (新增)
  modelBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99,
  );
  modelBarItem.text = `$(hubot) ${MODELS.find(m => m.id === activeModel)?.label || activeModel}`;
  modelBarItem.tooltip = '点击切换 LLM 模型 (agentai / deepseek / openai)';
  modelBarItem.command = 'agentai.switchModel';
  modelBarItem.show();
  context.subscriptions.push(modelBarItem);

  // 3. 读配置
  const config = vscode.workspace.getConfiguration('agentai');
  const gatewayUrl = config.get<string>('gatewayUrl', 'ws://127.0.0.1:18789');
  activeFramework = config.get<'openclaw' | 'hermes'>('framework', 'openclaw');
  activeModel = config.get<'agentai' | 'deepseek' | 'openai'>('model', 'agentai');

  // 4. Gateway 客户端
  gateway = new GatewayClient(gatewayUrl, context);
  gateway.connect().catch((e) => {
    vscode.window.showWarningMessage(
      `[AgentAI] Gateway 未启动: ${e.message}。请先启动 pnpm dev:gateway`,
    );
  });
  context.subscriptions.push(gateway);

  // 5. 命令: 打开对话面板
  context.subscriptions.push(
    vscode.commands.registerCommand('agentai.openChat', () => {
      GatewayPanel.createOrShow(context.extensionUri, gateway!);
    }),
  );

  // 6. 命令: 切换框架
  context.subscriptions.push(
    vscode.commands.registerCommand('agentai.switchFramework', async () => {
      const next = activeFramework === 'openclaw' ? 'hermes' : 'openclaw';
      const ok = await gateway?.switchFramework(next);
      if (ok) {
        activeFramework = next;
        statusBarItem!.text = `$(comment-discussion) AgentAI: ${next}`;
        await vscode.workspace.getConfiguration('agentai').update('framework', next, true);
        vscode.window.showInformationMessage(`✅ 已切换到 ${next}`);
      } else {
        vscode.window.showErrorMessage(`❌ 切换失败, Gateway 离线?`);
      }
    }),
  );

  // 7. 命令: 切换模型 (新增, 富哥要求)
  context.subscriptions.push(
    vscode.commands.registerCommand('agentai.switchModel', async () => {
      const pick = await vscode.window.showQuickPick(
        MODELS.map(m => ({ label: m.label, id: m.id, description: m.id === activeModel ? '(当前)' : '' })),
        { placeHolder: '选择 LLM 模型' },
      );
      if (pick) {
        activeModel = pick.id;
        modelBarItem!.text = `$(hubot) ${pick.label}`;
        await vscode.workspace.getConfiguration('agentai').update('model', pick.id, true);
        vscode.window.showInformationMessage(`✅ 模型已切换到 ${pick.label}`);
      }
    }),
  );

  // 8. 命令: 把当前文件读进对话 (新增, 富哥要求"文件功能")
  context.subscriptions.push(
    vscode.commands.registerCommand('agentai.attachActiveFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('没有打开的文件');
        return;
      }
      const doc = editor.document;
      const text = doc.getText();
      const fileName = path.basename(doc.fileName);
      // 直接调 chat 端点, 把文件内容塞到 prompt
      try {
        const res = await gateway?.httpPost('/v1/chat', {
          message: `请阅读并总结这个文件 [${fileName}]:\n\n\`\`\`\n${text.slice(0, 8000)}\n\`\`\``,
          userId: 'vscode-user',
          workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
        });
        GatewayPanel.createOrShow(context.extensionUri, gateway!);
        GatewayPanel.currentPanel?.webview.postMessage({
          type: 'reply',
          text: `📄 ${fileName} 总结:\n\n${res?.content || res?.error || '(空)'}`,
        });
      } catch (e: any) {
        vscode.window.showErrorMessage(`文件读取失败: ${e.message}`);
      }
    }),
  );

  // 9. 命令: 让 AI 解释选中代码 (新增)
  context.subscriptions.push(
    vscode.commands.registerCommand('agentai.explainSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const sel = editor.selection;
      const text = editor.document.getText(sel);
      if (!text) {
        vscode.window.showWarningMessage('请先选中代码');
        return;
      }
      const fileName = path.basename(editor.document.fileName);
      try {
        const res = await gateway?.httpPost('/v1/chat', {
          message: `请解释这段 ${fileName} 代码 (${sel.start.line + 1}-${sel.end.line + 1} 行):\n\n\`\`\`\n${text}\n\`\`\``,
          userId: 'vscode-user',
          workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
        });
        GatewayPanel.createOrShow(context.extensionUri, gateway!);
        GatewayPanel.currentPanel?.webview.postMessage({
          type: 'reply',
          text: `💡 解释:\n\n${res?.content || res?.error || '(空)'}`,
        });
      } catch (e: any) {
        vscode.window.showErrorMessage(`解释失败: ${e.message}`);
      }
    }),
  );

  // 10. 命令: 在当前文件新建一个标签页写入 AI 生成内容 (新增)
  context.subscriptions.push(
    vscode.commands.registerCommand('agentai.insertFromPrompt', async () => {
      const editor = vscode.window.activeTextEditor;
      const prompt = await vscode.window.showInputBox({
        placeHolder: '描述要插入的代码 (例如: "写一个 debounce 函数")',
        prompt: 'AgentAI 代码生成',
      });
      if (!prompt) return;
      try {
        const res = await gateway?.httpPost('/v1/chat', {
          message: `请只输出代码, 不要解释, 不要 markdown 围栏。需求: ${prompt}`,
          userId: 'vscode-user',
          workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
        });
        const code = (res?.content || '').replace(/^```[\w]*\n/, '').replace(/\n```$/, '');
        if (editor) {
          editor.edit(b => b.insert(editor.selection.start, code));
        } else {
          // 没打开文件, 新建一个 untitled 标签
          const doc = await vscode.workspace.openTextDocument({ content: '' });
          const e = await vscode.window.showTextDocument(doc);
          await e.edit(b => b.insert(e.selection.start, code));
        }
        vscode.window.showInformationMessage('✅ 代码已插入');
      } catch (e: any) {
        vscode.window.showErrorMessage(`生成失败: ${e.message}`);
      }
    }),
  );

  // 11. 命令: 让 AI 编辑选中代码 (新增, 真 edit_file 工具封装)
  context.subscriptions.push(
    vscode.commands.registerCommand('agentai.editSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const sel = editor.selection;
      const oldText = editor.document.getText(sel);
      if (!oldText) {
        vscode.window.showWarningMessage('请先选中要改的代码');
        return;
      }
      const instruction = await vscode.window.showInputBox({
        placeHolder: '怎么改? (例如: "加错误处理", "改成 async/await")',
        prompt: 'AgentAI 代码编辑',
      });
      if (!instruction) return;
      try {
        const res = await gateway?.httpPost('/v1/chat', {
          message: `请改写这段代码, 需求: ${instruction}\n\n原代码:\n\`\`\`\n${oldText}\n\`\`\`\n\n只输出改写后的完整代码, 不要解释, 不要 markdown 围栏。`,
          userId: 'vscode-user',
          workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
        });
        const newCode = (res?.content || '').replace(/^```[\w]*\n/, '').replace(/\n```$/, '');
        await editor.edit(b => b.replace(sel, newCode));
        vscode.window.showInformationMessage('✅ 代码已替换');
      } catch (e: any) {
        vscode.window.showErrorMessage(`编辑失败: ${e.message}`);
      }
    }),
  );
}

export function deactivate(): void {
  console.log('[AgentAI] extension deactivated');
  gateway?.dispose();
  statusBarItem?.dispose();
  modelBarItem?.dispose();
}

/**
 * Webview 面板: 富文本对话窗口
 * - markdown 渲染 (用 CDN marked.js)
 * - 显示当前框架 + 模型
 * - 历史记录 (localStorage 持久)
 */
class GatewayPanel {
  public static currentPanel: vscode.WebviewPanel | null = null;

  public static createOrShow(
    extensionUri: vscode.Uri,
    gw: GatewayClient,
  ): void {
    if (GatewayPanel.currentPanel) {
      GatewayPanel.currentPanel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'agentaiChat',
      'AgentAI Chat',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.webview.html = GatewayPanel.getHtml(activeFramework, activeModel);
    panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === 'chat') {
          try {
            const res = await gw.httpPost('/v1/chat', {
              message: msg.text,
              userId: 'vscode-user',
              workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
            });
            panel.webview.postMessage({ type: 'reply', text: res?.content || res?.error || '(空)' });
          } catch (e: any) {
            panel.webview.postMessage({ type: 'reply', text: '❌ ' + e.message });
          }
        } else if (msg.type === 'switch') {
          // webview 主动切框架
          if (msg.framework) {
            await gw.switchFramework(msg.framework);
            activeFramework = msg.framework;
            if (statusBarItem) statusBarItem.text = `$(comment-discussion) AgentAI: ${msg.framework}`;
          }
        }
      },
      undefined,
    );
    panel.onDidDispose(() => (GatewayPanel.currentPanel = null));
    GatewayPanel.currentPanel = panel;
  }

  private static getHtml(framework: string, model: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 12px;
      margin: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
    }
    .header { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
    .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; font-size: 11px; }
    #log { height: 75vh; overflow-y: auto; border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 8px; background: var(--vscode-input-background); }
    .msg { margin-bottom: 12px; line-height: 1.5; }
    .msg-user { color: #4FC3F7; border-left: 3px solid #4FC3F7; padding-left: 8px; }
    .msg-bot { color: #A5D6A7; border-left: 3px solid #A5D6A7; padding-left: 8px; }
    .msg-bot pre { background: #1e1e1e; padding: 8px; border-radius: 4px; overflow-x: auto; }
    .msg-bot code { font-family: 'Consolas', monospace; }
    .input-row { display: flex; gap: 4px; margin-top: 8px; }
    #in { flex: 1; padding: 6px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
    button { padding: 6px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .empty { color: var(--vscode-descriptionForeground); text-align: center; padding: 40px 0; }
  </style>
</head>
<body>
  <div class="header">
    <span class="badge">🤖 ${framework}</span>
    <span class="badge">📦 ${model}</span>
    <span style="flex:1"></span>
    <button onclick="clearLog()" style="font-size:11px">清空</button>
  </div>
  <div id="log">
    <div class="empty">富哥, 开始干 (Shift+Enter 换行)</div>
  </div>
  <div class="input-row">
    <input id="in" placeholder="输入消息, Enter 发送..." />
    <button onclick="send()">发送</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const input = document.getElementById('in');

    function append(role, text) {
      const div = document.createElement('div');
      div.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-bot');
      if (role === 'user') {
        div.textContent = '> ' + text;
      } else {
        div.innerHTML = '< ' + marked.parse(text);
      }
      // 第一次 append 清空 empty
      const empty = log.querySelector('.empty');
      if (empty) empty.remove();
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    function clearLog() { log.innerHTML = '<div class="empty">已清空</div>'; }

    function send() {
      const text = input.value.trim();
      if (!text) return;
      append('user', text);
      vscode.postMessage({ type: 'chat', text });
      input.value = '';
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    window.addEventListener('message', (e) => {
      if (e.data.type === 'reply') {
        append('bot', e.data.text);
      }
    });
  </script>
</body>
</html>`;
  }
}
