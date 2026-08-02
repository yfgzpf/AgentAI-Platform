/**
 * AgentAI - Multi-File Composer
 * ----------------------------------------------------
 * 复杂任务编辑器: 描述需求 → AI 拆解 → 多文件 Diff → 一键应用
 * 对标 Cursor Composer / Cloud Code Agent Mode
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { GatewayClient } from '../gateway-client';

interface FileChange {
    filePath: string;
    operation: 'create' | 'modify' | 'delete';
    newContent?: string;
    diff?: string;
}

export class ComposerPanel {
    public static currentPanel: ComposerPanel | null = null;
    private panel: vscode.WebviewPanel;
    private gw: GatewayClient;
    private currentChanges: FileChange[] = [];

    static createOrShow(gw: GatewayClient): void {
        if (ComposerPanel.currentPanel) {
            ComposerPanel.currentPanel.panel.reveal();
            return;
        }
        ComposerPanel.currentPanel = new ComposerPanel(gw);
    }

    private constructor(gw: GatewayClient) {
        this.gw = gw;
        this.panel = vscode.window.createWebviewPanel(
            'agentaiComposer',
            'AgentAI Composer',
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        this.panel.webview.html = this.getHtml();
        this.panel.webview.onDidReceiveMessage((m) => this.handleMsg(m));
        this.panel.onDidDispose(() => { ComposerPanel.currentPanel = null; });
    }

    private async handleMsg(msg: any) {
        if (msg.type === 'plan') {
            await this.handlePlan(msg.goal);
        }
        if (msg.type === 'apply') {
            await this.applyChanges(msg.changes);
        }
        if (msg.type === 'applyAll') {
            await this.applyAll();
        }
        if (msg.type === 'discard') {
            this.currentChanges = [];
            this.panel.webview.postMessage({ type: 'changes', changes: [] });
        }
        if (msg.type === 'openFile') {
            vscode.window.showTextDocument(vscode.Uri.file(msg.path));
        }
    }

    private async handlePlan(goal: string) {
        this.panel.webview.postMessage({ type: 'status', text: '🧠 AI 正在分析需求并拆解任务...' });
        try {
            const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const res: any = await this.gw.httpPost('/v1/chat', {
                message: `你是代码任务规划 AI. 给定用户目标, 返回 JSON 格式的文件变更列表.

目标: ${goal}

工作空间: ${workspace}

返回 JSON 数组, 每个元素格式:
{
  "filePath": "相对路径",
  "operation": "create" | "modify" | "delete",
  "newContent": "完整的新文件内容 (create/modify 时必填, delete 时省略)"
}

规则:
1. 一次最多 10 个文件
2. 优先使用相对路径
3. newContent 必须是完整内容, 不要用省略号
4. 只返回 JSON 数组, 不要其他解释`,
                userId: 'vscode-composer',
                workspace,
                stream: false,
            });
            let text = (res?.text || res?.message || '').toString();
            // 解析 JSON
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) {
                this.panel.webview.postMessage({ type: 'error', text: 'AI 返回格式错误' });
                return;
            }
            const changes: FileChange[] = JSON.parse(match[0]);
            this.currentChanges = changes;
            this.panel.webview.postMessage({ type: 'changes', changes });
            this.panel.webview.postMessage({ type: 'status', text: `✅ 规划完成: ${changes.length} 个文件变更` });
        } catch (e: any) {
            this.panel.webview.postMessage({ type: 'error', text: e.message || String(e) });
        }
    }

    private async applyChanges(indices: number[]) {
        const errors: string[] = [];
        for (const i of indices) {
            const change = this.currentChanges[i];
            if (!change) continue;
            try {
                if (change.operation === 'delete') {
                    const uri = vscode.Uri.file(path.resolve(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.', change.filePath));
                    await vscode.workspace.fs.delete(uri);
                } else if (change.newContent !== undefined) {
                    const uri = vscode.Uri.file(path.resolve(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.', change.filePath));
                    const data = Buffer.from(change.newContent, 'utf8');
                    await vscode.workspace.fs.writeFile(uri, data);
                }
            } catch (e: any) {
                errors.push(`${change.filePath}: ${e.message || e}`);
            }
        }
        this.panel.webview.postMessage({
            type: 'status',
            text: errors.length ? `⚠️ 部分失败: ${errors.join('; ')}` : `✅ 已应用 ${indices.length} 个文件`,
        });
    }

    private async applyAll() {
        await this.applyChanges(this.currentChanges.map((_, i) => i));
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); display: flex; flex-direction: column; height: 100vh; }
  .header { padding: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .header h3 { margin-bottom: 8px; }
  .header p { font-size: 11px; opacity: 0.7; }
  .input-area { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .input-area textarea { width: 100%; min-height: 60px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px; font-family: inherit; font-size: 12px; resize: vertical; }
  .input-area button { margin-top: 6px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; }
  .input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status { padding: 6px 12px; font-size: 11px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-textBlockQuote-background); }
  .changes { flex: 1; overflow-y: auto; padding: 8px 12px; }
  .change { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 8px; overflow: hidden; }
  .change-header { padding: 6px 8px; background: var(--vscode-textBlockQuote-background); display: flex; align-items: center; gap: 6px; font-size: 11px; }
  .change-header label { flex: 1; cursor: pointer; }
  .change-header .op { padding: 1px 4px; border-radius: 2px; font-size: 10px; }
  .op-create { background: #2ea043; color: white; }
  .op-modify { background: #1f6feb; color: white; }
  .op-delete { background: #cf222e; color: white; }
  .change-content { max-height: 300px; overflow: auto; padding: 6px; font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: pre; background: var(--vscode-editor-background); }
  .actions { padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 6px; }
  .actions button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 11px; }
  .actions button.discard { background: var(--vscode-button-secondaryBackground); }
  .empty { text-align: center; padding: 40px; opacity: 0.5; }
  .error { color: var(--vscode-errorForeground); }
</style>
</head><body>
<div class="header">
  <h3>🛠️ Multi-File Composer</h3>
  <p>描述需求 → AI 拆解 → 多文件 Diff → 一键应用</p>
</div>
<div class="input-area">
  <textarea id="goal" placeholder="例如: 重构 src/auth.ts 使用新的 JWT 库, 更新所有引用, 补充单元测试"></textarea>
  <button id="planBtn" onclick="plan()">🧠 规划</button>
</div>
<div id="status" class="status">就绪</div>
<div id="changes" class="changes">
  <div class="empty">输入目标, 点击 "规划" 开始</div>
</div>
<div class="actions" id="actions" style="display:none">
  <button onclick="applyAll()">✅ 全部应用</button>
  <button onclick="applySelected()">☑️ 应用选中</button>
  <button class="discard" onclick="discard()">🗑 清空</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  let currentChanges = [];

  function plan() {
    const goal = document.getElementById('goal').value;
    if (!goal.trim()) return;
    document.getElementById('planBtn').disabled = true;
    vscode.postMessage({ type: 'plan', goal });
  }

  function applyAll() {
    vscode.postMessage({ type: 'applyAll' });
  }

  function applySelected() {
    const checks = document.querySelectorAll('.change-check:checked');
    const indices = Array.from(checks).map(c => parseInt(c.dataset.idx));
    if (indices.length === 0) return alert('请先选中要应用的变更');
    vscode.postMessage({ type: 'apply', changes: indices });
  }

  function discard() {
    vscode.postMessage({ type: 'discard' });
  }

  function renderChanges(changes) {
    currentChanges = changes;
    const container = document.getElementById('changes');
    const actions = document.getElementById('actions');
    if (changes.length === 0) {
      container.innerHTML = '<div class="empty">输入目标, 点击 "规划" 开始</div>';
      actions.style.display = 'none';
      return;
    }
    actions.style.display = 'flex';
    container.innerHTML = '';
    changes.forEach((c, i) => {
      const div = document.createElement('div');
      div.className = 'change';
      const opClass = 'op-' + c.operation;
      const opLabel = c.operation === 'create' ? '+ 新建' : c.operation === 'modify' ? '~ 修改' : '- 删除';
      const content = c.newContent ? c.newContent.slice(0, 2000) : '(删除)';
      div.innerHTML = \`
        <div class="change-header">
          <input type="checkbox" class="change-check" data-idx="\${i}" checked>
          <span class="op \${opClass}">\${opLabel}</span>
          <label onclick="vscode.postMessage({type:'openFile', path:'\${c.filePath}'})">📄 \${c.filePath}</label>
        </div>
        <div class="change-content">\${escapeHtml(content)}</div>
      \`;
      container.appendChild(div);
    });
  }

  function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  window.addEventListener('message', e => {
    const d = e.data;
    if (d.type === 'status') {
      document.getElementById('status').textContent = d.text;
      document.getElementById('planBtn').disabled = false;
    }
    if (d.type === 'error') {
      document.getElementById('status').innerHTML = '<span class="error">❌ ' + d.text + '</span>';
      document.getElementById('planBtn').disabled = false;
    }
    if (d.type === 'changes') {
      renderChanges(d.changes);
    }
  });
</script>
</body></html>`;
    }
}
