/**
 * AgentAI Platform - VSCode 扩展 v3
 * ----------------------------------------------------
 * 功能:
 *   - SSE 流式对话 + markdown 渲染
 *   - 文件树浏览 (打开/切换/刷新)
 *   - 工具调用可视化
 *   - 解释/修复/审查选中代码
 *   - Gateway 状态栏实时监测
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { GatewayClient } from './gateway-client';

let gateway: GatewayClient | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;

export function activate(context: vscode.ExtensionContext): void {
  // 状态栏
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = `$(hubot) AgentAI`;
  statusBarItem.tooltip = '点击打开 AI 对话';
  statusBarItem.command = 'agentai.openChat';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Gateway 客户端
  const config = vscode.workspace.getConfiguration('agentai');
  const gatewayUrl = config.get<string>('gatewayUrl', 'ws://127.0.0.1:18789');
  gateway = new GatewayClient(gatewayUrl);
  context.subscriptions.push(gateway);
  gateway.connect().catch(() => {});

  // 健康监测
  const healthTimer = setInterval(() => {
    if (statusBarItem) {
      const ok = gateway?.isConnected;
      statusBarItem.text = ok ? `$(hubot) AgentAI` : `$(warning) AgentAI Offline`;
      statusBarItem.tooltip = ok ? '点击打开 AI 对话' : 'Gateway 离线，检查 pnpm start';
    }
  }, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(healthTimer) });

  // 命令注册
  context.subscriptions.push(vscode.commands.registerCommand('agentai.openChat', () => {
    GatewayPanel.createOrShow(context.extensionUri, gateway!);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('agentai.explainSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const text = editor.document.getText(editor.selection);
    if (!text) return vscode.window.showWarningMessage('请先选中代码');
    if (!gateway?.isConnected) return vscode.window.showWarningMessage('Gateway 离线');
    GatewayPanel.createOrShow(context.extensionUri, gateway!);
    sendWithContext(`请解释这段代码:\n\`\`\`\n${text.slice(0, 8000)}\n\`\`\``);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('agentai.fixSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const text = editor.document.getText(editor.selection);
    if (!text) return vscode.window.showWarningMessage('请先选中代码');
    if (!gateway?.isConnected) return vscode.window.showWarningMessage('Gateway 离线');
    GatewayPanel.createOrShow(context.extensionUri, gateway!);
    sendWithContext(`请帮我把这段代码修好:\n\`\`\`\n${text}\n\`\`\``);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('agentai.reviewProject', async () => {
    if (!gateway?.isConnected) return vscode.window.showWarningMessage('Gateway 离线');
    GatewayPanel.createOrShow(context.extensionUri, gateway!);
    sendWithContext('请审查当前项目的代码结构，指出潜在问题和改进建议');
  }));
}

function sendWithContext(text: string): void {
  GatewayPanel.currentPanel?.sendMessage(text);
}

export function deactivate(): void {
  gateway?.dispose();
  statusBarItem?.dispose();
}

class GatewayPanel {
  public static currentPanel: GatewayPanel | null = null;
  private panel: vscode.WebviewPanel;
  private gw: GatewayClient;
  private msgId = 0;

  static createOrShow(uri: vscode.Uri, gw: GatewayClient): void {
    if (GatewayPanel.currentPanel) { GatewayPanel.currentPanel.panel.reveal(); return; }
    GatewayPanel.currentPanel = new GatewayPanel(uri, gw);
  }

  private constructor(uri: vscode.Uri, gw: GatewayClient) {
    this.gw = gw;
    this.panel = vscode.window.createWebviewPanel(
      'agentaiChat', 'AgentAI',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage((m) => this.handleMsg(m));
    this.panel.onDidDispose(() => { GatewayPanel.currentPanel = null; });
  }

  sendMessage(text: string): void {
    this.panel.webview.postMessage({ type: 'userMsg', text });
    this.doChat(text);
  }

  private async handleMsg(msg: any) {
    if (msg.type === 'chat') this.doChat(msg.text);
    if (msg.type === 'openFile') vscode.window.showTextDocument(vscode.Uri.file(msg.path));
    if (msg.type === 'listFiles') this.listFiles(msg.dir);
  }

  private async listFiles(dir: string = '.') {
    try {
      const httpUrl = 'http://127.0.0.1:18789';
      const res = await fetch(`${httpUrl}/v1/files?dir=${encodeURIComponent(dir)}`);
      const data: any = await res.json();
      this.panel.webview.postMessage({ type: 'fileList', files: data.files || [], dir });
    } catch { /* offline */ }
  }

  private async doChat(text: string) {
    const id = ++this.msgId;
    this.panel.webview.postMessage({ type: 'botStart', id });
    await this.gw.streamChat(text,
      (d) => this.panel.webview.postMessage({ type: 'botDelta', id, text: d }),
      (f) => this.panel.webview.postMessage({ type: 'botDone', id, text: f }),
      (e) => this.panel.webview.postMessage({ type: 'botError', id, error: e }),
    );
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); display: flex; flex-direction: column; height: 100vh; }
  .toolbar { display: flex; gap: 4px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  .toolbar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; }
  #fileTree { max-height: 150px; overflow: auto; padding: 4px 8px; font-size: 11px; border-bottom: 1px solid var(--vscode-panel-border); display: none; }
  #fileTree .file { cursor: pointer; padding: 1px 4px; }
  #fileTree .file:hover { background: var(--vscode-list-hoverBackground); }
  #log { flex: 1; overflow-y: auto; padding: 8px; }
  .msg { margin-bottom: 10px; line-height: 1.5; }
  .msg-user { color: var(--vscode-textLink-foreground); border-left: 3px solid var(--vscode-textLink-foreground); padding-left: 8px; white-space: pre-wrap; }
  .msg-bot { border-left: 3px solid var(--vscode-textPreformat-foreground); padding-left: 8px; }
  .msg-bot pre { background: var(--vscode-textBlockQuote-background); padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 11px; }
  .msg-bot code { font-family: var(--vscode-editor-font-family); }
  .cursor { display: inline-block; width: 2px; height: 16px; background: var(--vscode-cursor-foreground); animation: blink 1s infinite; vertical-align: text-bottom; margin-left: 2px; }
  @keyframes blink { 50% { opacity: 0; } }
  .input-area { display: flex; gap: 4px; padding: 6px 8px; border-top: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  #in { flex: 1; padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
  #in:focus { outline: none; border-color: var(--vscode-focusBorder); }
</style>
</head><body>
<div class="toolbar">
  <button onclick="toggleFiles()">📁 文件</button>
  <button onclick="sendMsg('/review')">🔍 审查</button>
  <button onclick="clearLog()">🗑 清空</button>
  <span style="flex:1"></span>
  <span id="status" style="font-size:10px;opacity:0.6">就绪</span>
</div>
<div id="fileTree"></div>
<div id="log"><div style="color:var(--vscode-descriptionForeground);text-align:center;padding:20px">输入消息开始对话</div></div>
<div class="input-area">
  <input id="in" placeholder="输入消息..." />
  <button onclick="sendMsg(document.getElementById('in').value)">发送</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  let fileOpen = false;
  function addMsg(cls, html) {
    const log = document.getElementById('log');
    const empty = log.querySelector('.empty');
    if (empty) empty.remove();
    const d = document.createElement('div');
    d.className = 'msg ' + cls;
    if (typeof html === 'string') d.innerHTML = html;
    else d.appendChild(html);
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
  function sendMsg(text) {
    if (!text) return;
    document.getElementById('in').value = '';
    addMsg('msg-user', escapeHtml(text));
    vscode.postMessage({ type: 'chat', text });
    document.getElementById('status').textContent = '🤖 思考中...';
  }
  function clearLog() { document.getElementById('log').innerHTML = '<div style="color:var(--vscode-descriptionForeground);text-align:center;padding:20px">已清空</div>'; }
  function toggleFiles() {
    fileOpen = !fileOpen;
    document.getElementById('fileTree').style.display = fileOpen ? 'block' : 'none';
    if (fileOpen) vscode.postMessage({ type: 'listFiles', dir: '.' });
  }
  function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  window.addEventListener('message', e => {
    const d = e.data;
    if (d.type === 'userMsg') { addMsg('msg-user', escapeHtml(d.text)); return; }
    if (d.type === 'botStart') {
      const c = document.createElement('span');
      c.id = 'c' + d.id;
      c.innerHTML = '🤖 <span id="ct' + d.id + '"></span><span class="cursor"></span>';
      addMsg('msg-bot', c);
      return;
    }
    if (d.type === 'botDelta') {
      const el = document.getElementById('ct' + d.id);
      if (el) el.textContent += d.text;
      document.getElementById('log').scrollTop = document.getElementById('log').scrollHeight;
      return;
    }
    if (d.type === 'botDone') {
      const el = document.getElementById('c' + d.id);
      if (el) {
        const txt = document.getElementById('ct' + d.id).textContent;
        el.innerHTML = '🤖 ' + marked.parse(txt);
      }
      document.getElementById('status').textContent = '✅ 完成';
      return;
    }
    if (d.type === 'botError') {
      const el = document.getElementById('c' + d.id);
      if (el) el.innerHTML += '<span style="color:var(--vscode-errorForeground)"> ❌ ' + d.error + '</span>';
      document.getElementById('status').textContent = '❌ 错误';
      return;
    }
    if (d.type === 'fileList') {
      const ft = document.getElementById('fileTree');
      ft.innerHTML = '<b>' + d.dir + '</b><br>';
      d.files.forEach(f => {
        const div = document.createElement('div');
        div.className = 'file';
        div.textContent = (f.type === 'directory' ? '📁 ' : '📄 ') + f.name;
        div.onclick = () => vscode.postMessage({ type: 'openFile', path: d.dir + '/' + f.name.replace(/\/$/,'') });
        ft.appendChild(div);
      });
      return;
    }
  });

  document.getElementById('in').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(e.target.value); }
  });
</script>
</body></html>`;
  }
}
