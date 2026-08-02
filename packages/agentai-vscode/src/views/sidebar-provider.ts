/**
 * AgentAI - TreeView 侧栏
 * ----------------------------------------------------
 * 5 大视图: 项目/会话/任务/工具/记忆
 * 让 VSCode 体验对齐 GUI 的 80 组件
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type ViewType = 'project' | 'sessions' | 'tasks' | 'tools' | 'memory';

export class AgentAISidebarProvider implements vscode.TreeDataProvider<AgentAITreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AgentAITreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private viewType: ViewType = 'project') {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: AgentAITreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AgentAITreeItem): Promise<AgentAITreeItem[]> {
        if (this.viewType === 'project') return this.getProjectChildren(element);
        if (this.viewType === 'sessions') return this.getSessionsChildren();
        if (this.viewType === 'tasks') return this.getTasksChildren();
        if (this.viewType === 'tools') return this.getToolsChildren();
        if (this.viewType === 'memory') return this.getMemoryChildren();
        return [];
    }

    private async getProjectChildren(element?: AgentAITreeItem): Promise<AgentAITreeItem[]> {
        if (element) {
            // 展开目录
            if (element.contextValue === 'dir' && element.resourceUri) {
                try {
                    const entries = await fs.promises.readdir(element.resourceUri.fsPath, { withFileTypes: true });
                    return entries
                        .filter(e => !e.name.startsWith('.') || e.name === '.gitignore' || e.name === '.env.example')
                        .slice(0, 50)
                        .map(e => {
                            const uri = vscode.Uri.file(path.join(element.resourceUri!.fsPath, e.name));
                            return new AgentAITreeItem(
                                e.name,
                                e.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                                e.isDirectory() ? 'dir' : 'file',
                                uri,
                            );
                        });
                } catch { return []; }
            }
            return [];
        }
        // 根: 工作区文件夹
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            return [new AgentAITreeItem('未打开工作区', vscode.TreeItemCollapsibleState.None, 'empty')];
        }
        return folders.map(f =>
            new AgentAITreeItem(f.name, vscode.TreeItemCollapsibleState.Collapsed, 'dir', f.uri)
        );
    }

    private async getSessionsChildren(): Promise<AgentAITreeItem[]> {
        // 简单实现: 从本地存储读取会话
        const stored = this.loadFromStorage('sessions') || [];
        if (stored.length === 0) {
            return [new AgentAITreeItem('暂无历史会话', vscode.TreeItemCollapsibleState.None, 'empty')];
        }
        return stored.slice(0, 20).map((s: any) =>
            new AgentAITreeItem(
                s.title || `会话 ${s.id.slice(0, 6)}`,
                vscode.TreeItemCollapsibleState.None,
                'session',
                undefined,
                { command: 'agentai.openSession', arguments: [s.id] }
            )
        );
    }

    private async getTasksChildren(): Promise<AgentAITreeItem[]> {
        const stored = this.loadFromStorage('tasks') || [];
        const running = stored.filter((t: any) => t.status === 'running' || t.status === 'pending');
        if (running.length === 0) {
            return [new AgentAITreeItem('🎉 当前无运行中任务', vscode.TreeItemCollapsibleState.None, 'empty')];
        }
        return running.map((t: any) =>
            new AgentAITreeItem(
                `${t.title || t.id} (${t.progress || 0}%)`,
                vscode.TreeItemCollapsibleState.None,
                'task',
                undefined,
                { command: 'agentai.openTask', arguments: [t.id] }
            )
        );
    }

    private async getToolsChildren(): Promise<AgentAITreeItem[]> {
        // 14 大类工具快捷入口
        const cats = [
            { name: '📁 文件操作', count: 5, command: 'agentai.toolCategory', args: ['file'] },
            { name: '🔍 搜索/查找', count: 4, command: 'agentai.toolCategory', args: ['search'] },
            { name: '🌐 Web/网络', count: 4, command: 'agentai.toolCategory', args: ['web'] },
            { name: '💻 代码/重构', count: 5, command: 'agentai.toolCategory', args: ['code'] },
            { name: '🔀 Git 操作', count: 3, command: 'agentai.toolCategory', args: ['git'] },
            { name: '🖥️ 终端/Shell', count: 3, command: 'agentai.toolCategory', args: ['shell'] },
            { name: '📅 定时/工作流', count: 3, command: 'agentai.toolCategory', args: ['workflow'] },
            { name: '🧠 元认知/记忆', count: 3, command: 'agentai.toolCategory', args: ['meta'] },
            { name: '🌍 浏览器自动化', count: 5, command: 'agentai.toolCategory', args: ['browser'] },
            { name: '🖱️ 桌面控制', count: 4, command: 'agentai.toolCategory', args: ['desktop'] },
            { name: '⚙️ 进程管理', count: 3, command: 'agentai.toolCategory', args: ['process'] },
            { name: '🧬 自进化', count: 4, command: 'agentai.toolCategory', args: ['evolution'] },
            { name: '📋 任务计划', count: 4, command: 'agentai.toolCategory', args: ['planning'] },
            { name: '🏭 行业/系统', count: 2, command: 'agentai.toolCategory', args: ['industry'] },
        ];
        return cats.map(c =>
            new AgentAITreeItem(
                `${c.name} (${c.count})`,
                vscode.TreeItemCollapsibleState.None,
                'tool-cat',
                undefined,
                { command: c.command, arguments: c.args }
            )
        );
    }

    private async getMemoryChildren(): Promise<AgentAITreeItem[]> {
        const stored = this.loadFromStorage('memory') || [];
        if (stored.length === 0) {
            return [new AgentAITreeItem('暂无记忆 (右键 → 添加记忆)', vscode.TreeItemCollapsibleState.None, 'empty')];
        }
        return stored.slice(0, 20).map((m: any) =>
            new AgentAITreeItem(
                m.content.slice(0, 50) + (m.content.length > 50 ? '...' : ''),
                vscode.TreeItemCollapsibleState.None,
                'memory',
                undefined,
                { command: 'agentai.recallMemory', arguments: [m.id] }
            )
        );
    }

    private loadFromStorage(key: string): any {
        try {
            const globalState = (global as any).agentaiContext?.globalState;
            return globalState?.get(key);
        } catch { return null; }
    }
}

export class AgentAITreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly resourceUri?: vscode.Uri,
        public readonly cmd?: { command: string; arguments?: any[] },
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        if (resourceUri) this.resourceUri = resourceUri;
        if (cmd) this.command = cmd as vscode.Command;
        // 设置图标
        if (contextValue === 'dir') this.iconPath = new vscode.ThemeIcon('folder');
        else if (contextValue === 'file') this.iconPath = new vscode.ThemeIcon('file');
        else if (contextValue === 'session') this.iconPath = new vscode.ThemeIcon('comment-discussion');
        else if (contextValue === 'task') this.iconPath = new vscode.ThemeIcon('tasklist');
        else if (contextValue === 'tool-cat') this.iconPath = new vscode.ThemeIcon('tools');
        else if (contextValue === 'memory') this.iconPath = new vscode.ThemeIcon('history');
        else if (contextValue === 'empty') this.iconPath = new vscode.ThemeIcon('info');
    }
}
