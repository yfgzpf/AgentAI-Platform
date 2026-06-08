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
 *   - 提供 "切换框架" 命令 (走 frameworkSwitcher)
 *   - 不抢焦点: 走状态栏 + 通知, 不弹窗
 */

import * as vscode from 'vscode';
import { GatewayClient } from './gateway-client';

let gateway: GatewayClient | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let activeFramework: 'openclaw' | 'hermes' = 'openclaw';

export function activate(context: vscode.ExtensionContext): void {
  console.log('[AgentAI] extension activated');

  // 1. 状态栏 (学 Cursor 状态栏模式)
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.text = `$(comment-discussion) AgentAI: ${activeFramework}`;
  statusBarItem.tooltip = '点击切换智能体框架 (OpenClaw ↔ Hermes)';
  statusBarItem.command = 'agentai.switchFramework';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 2. 读配置 (学 Cursor 读 product.json + settings)
  const config = vscode.workspace.getConfiguration('agentai');
  const gatewayUrl = config.get<string>('gatewayUrl', 'ws://127.0.0.1:18789');
  activeFramework = config.get<'openclaw' | 'hermes'>('framework', 'openclaw');

  // 3. 启动 Gateway WebSocket 客户端 (异步, 不阻塞激活)
  gateway = new GatewayClient(gatewayUrl, context);
  gateway.connect().catch((e) => {
    vscode.window.showWarningMessage(
      `[AgentAI] Gateway 未启动: ${e.message}。请先启动 pnpm dev:gateway`,
    );
  });
  context.subscriptions.push(gateway);

  // 4. 注册命令: 打开对话 (面板)
  context.subscriptions.push(
    vscode.commands.registerCommand('agentai.openChat', () => {
      GatewayPanel.createOrShow(context.extensionUri, gateway!);
    }),
  );

  // 5. 注册命令: 切换框架
  context.subscriptions.push(
    vscode.commands.registerCommand('agentai.switchFramework', async () => {
      const next = activeFramework === 'openclaw' ? 'hermes' : 'openclaw';
      const ok = await gateway?.switchFramework(next);
      if (ok) {
        activeFramework = next;
        statusBarItem!.text = `$(comment-discussion) AgentAI: ${next}`;
        vscode.window.showInformationMessage(`✅ 已切换到 ${next}`);
      } else {
        vscode.window.showErrorMessage(`❌ 切换失败, Gateway 离线?`);
      }
    }),
  );
}

export function deactivate(): void {
  console.log('[AgentAI] extension deactivated');
  gateway?.dispose();
  statusBarItem?.dispose();
}

/**
 * Webview 面板: 内嵌对话窗口
 * 学 Cursor 也有 inline chat (Shift+Cmd+I)
 * 我们用 Webview Panel (右侧) 起步
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
    panel.webview.html = GatewayPanel.getHtml();
    panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === 'chat') {
          const res = await gw.chat(msg.text);
          panel.webview.postMessage({ type: 'reply', text: res });
        }
      },
      undefined,
    );
    panel.onDidDispose(() => (GatewayPanel.currentPanel = null));
    GatewayPanel.currentPanel = panel;
  }

  private static getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 12px; }
    #log { height: 70vh; overflow-y: auto; border: 1px solid #444; padding: 8px; }
    .msg-user { color: #4FC3F7; }
    .msg-bot  { color: #A5D6A7; }
    input { width: 100%; padding: 6px; box-sizing: border-box; }
  </style>
</head>
<body>
  <h3>AgentAI Chat (框架: openclaw 默认)</h3>
  <div id="log"></div>
  <input id="in" placeholder="输入消息, 回车发送..." />
  <script>
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const input = document.getElementById('in');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const text = input.value.trim();
        log.innerHTML += '<div class="msg-user">> ' + text + '</div>';
        vscode.postMessage({ type: 'chat', text });
        input.value = '';
      }
    });
    window.addEventListener('message', (e) => {
      if (e.data.type === 'reply') {
        log.innerHTML += '<div class="msg-bot">&lt; ' + e.data.text + '</div>';
        log.scrollTop = log.scrollHeight;
      }
    });
  </script>
</body>
</html>`;
  }
}
