/**
 * MCP Host — JSON-RPC 2.0 over stdio/HTTP
 * 直接实现 MCP 协议，不依赖 @modelcontextprotocol/sdk
 * @see https://modelcontextprotocol.io/specification/2025-06-18
 */
import { ToolRegistry } from '../tool-registry.js';
import { McpServerConfig } from './config.js';
import { spawn } from 'child_process';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: { code: number; message: string };
}

export class MCPHost {
  private processes = new Map<string, { proc: any; tools: string[]; config?: any }>();
  private configPath: string = '';

  constructor(private registry: ToolRegistry, workspace?: string) {
    if (workspace) {
      this.configPath = workspace + '/.agentai/mcp-servers.json';
    }
  }

  /** 持久化当前 MCP 配置 */
  private saveConfig(): void {
    if (!this.configPath) return;
    try {
      const dir = require('path').dirname(this.configPath);
      require('fs').mkdirSync(dir, { recursive: true });
      const data = Array.from(this.processes.entries()).map(([name, entry]) => ({
        name, transport: entry.config?.transport || 'stdio',
        command: entry.config?.command, args: entry.config?.args || [],
        url: entry.config?.url,
      }));
      require('fs').writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {}
  }

  /** 启动时恢复持久化的 MCP 配置 */
  async restoreSaved(): Promise<void> {
    if (!this.configPath) return;
    try {
      const raw = require('fs').readFileSync(this.configPath, 'utf-8');
      const servers = JSON.parse(raw);
      for (const s of servers) {
        if (!this.processes.has(s.name)) {
          await this.connect(s).catch(e => console.warn(`[mcp] 重连 "${s.name}" 失败:`, e?.message));
        }
      }
    } catch { /* 首次运行无文件 */ }
  }

  async connect(config: McpServerConfig): Promise<void> {
    if (this.processes.has(config.name)) return;
    try {
      if (config.transport === 'stdio') {
        await this._connectStdio(config);
      } else {
        await this._connectHttp(config);
      }
      console.log(`[mcp] ✅ connected "${config.name}" (${config.transport})`);
    } catch (e: any) {
      console.warn(`[mcp] ❌ failed "${config.name}": ${e.message}`);
    }
  }

  private async _connectStdio(config: McpServerConfig): Promise<void> {
    // Windows: npx/node 是 batch 脚本, spawn('npx') 找不到, 需要用 cmd.exe 启动
    const isWin = process.platform === 'win32';
    const isWindowsCmd = isWin && (config.command === 'npx' || config.command === 'node');
    const cmd = isWindowsCmd ? process.env.ComSpec || 'cmd.exe' : config.command!;
    const cmdArgs = isWindowsCmd
      ? ['/d', '/s', '/c', `"${config.command}" ${(config.args || []).join(' ')}`]
      : config.args || [];

    const proc = spawn(cmd, cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      windowsHide: true,
    });

    let buffer = '';
    const pending = new Map<string | number, { resolve: (v: any) => void; reject: (e: any) => void }>();
    let idCounter = 0;

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      // JSON-RPC 2.0 帧分隔: \n (每行一个 JSON)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id !== undefined && pending.has(msg.id)) {
            const cb = pending.get(msg.id)!;
            pending.delete(msg.id);
            if (msg.error) cb.reject(new Error(msg.error.message));
            else cb.resolve(msg.result);
          }
        } catch {}
      }
    });

    proc.on('error', (err) => console.warn(`[mcp] ${config.name} error:`, err.message));
    proc.on('exit', (code) => console.log(`[mcp] ${config.name} exited:`, code));

    // 发送 initialize 请求 (MCP 协议握手)
    const initResult = await this._send(proc, pending, () => ++idCounter, {
      jsonrpc: '2.0', id: ++idCounter, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, clientInfo: { name: 'agentai-gateway', version: '0.1.0' } },
    });
    if (initResult?.protocolVersion) {
      // 发送 initialized 通知
      this._send(proc, pending, () => 0, { jsonrpc: '2.0', id: 0, method: 'notifications/initialized' });
    }

    // 获取工具列表
    const toolsResult = await this._send(proc, pending, () => ++idCounter, {
      jsonrpc: '2.0', id: ++idCounter, method: 'tools/list',
    });

    const tools = (toolsResult?.tools || []) as Array<{ name: string; description?: string; inputSchema?: any }>;
    for (const tool of tools) {
      // 修复：确保 parameters 是有效的 JSON Schema，type 必须是 "object"
      const parameters = this.normalizeSchema(tool.inputSchema);
      // 消毒工具名: 只保留 [a-zA-Z0-9_-], 空格/特殊字符替换为 _
      const safeServerName = config.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeToolName = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      
      this.registry.register({
        name: `${safeServerName}.${safeToolName}`,
        description: tool.description || `MCP tool: ${tool.name}`,
        parameters,
        parallelSafe: false,
        riskLevel: 'medium',
        handler: async (args) => {
          try {
            const result = await this._send(proc, pending, () => ++idCounter, {
              jsonrpc: '2.0', id: ++idCounter, method: 'tools/call',
              params: { name: tool.name, arguments: args },
            });
            const texts = (result?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text);
            return { success: true, output: texts.join('\n'), data: result };
          } catch (e: any) {
            return { success: false, output: '', error: e.message };
          }
        },
      });
    }

    this.processes.set(config.name, { proc, tools: tools.map(t => t.name) });
  }

  /**
   * 规范化 JSON Schema，确保符合 DeepSeek 要求
   * DeepSeek 要求: type 必须是 "object"，且必须有 properties
   */
  private normalizeSchema(inputSchema: any): { type: 'object'; properties: Record<string, any>; required?: string[] } {
    // 如果 schema 无效，返回默认空对象 schema
    if (!inputSchema || typeof inputSchema !== 'object') {
      return { type: 'object', properties: {} };
    }
    
    // 如果 type 不是 object，强制设为 object
    if (inputSchema.type !== 'object') {
      console.warn(`[MCP] 修复工具 schema: type "${inputSchema.type}" → "object"`);
      inputSchema.type = 'object';
    }
    
    // 确保 properties 存在
    if (!inputSchema.properties || typeof inputSchema.properties !== 'object') {
      inputSchema.properties = {};
    }
    
    return inputSchema;
  }

  private async _connectHttp(config: McpServerConfig): Promise<void> {
    // HTTP transport: POST JSON-RPC
    const toolsResult = await this._httpCall(config.url!, {
      jsonrpc: '2.0', id: 1, method: 'tools/list',
    });
    const tools = (toolsResult?.tools || []) as Array<{ name: string; description?: string; inputSchema?: any }>;
    for (const tool of tools) {
      // 修复：确保 parameters 是有效的 JSON Schema，type 必须是 "object"
      const parameters = this.normalizeSchema(tool.inputSchema);
      
      this.registry.register({
        name: `${config.name}.${tool.name}`,
        description: tool.description || `MCP tool: ${tool.name}`,
        parameters,
        parallelSafe: false,
        riskLevel: 'medium',
        handler: async (args) => {
          try {
            const r = await this._httpCall(config.url!, {
              jsonrpc: '2.0', id: 1, method: 'tools/call',
              params: { name: tool.name, arguments: args },
            });
            const texts = (r?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text);
            return { success: true, output: texts.join('\n') };
          } catch (e: any) {
            return { success: false, output: '', error: e.message };
          }
        },
      });
    }
    this.processes.set(config.name, { proc: null, tools: tools.map(t => t.name) });
  }

  private _send(proc: any, pending: Map<any, any>, nextId: () => number, msg: JsonRpcRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = msg.id;
      if (id !== 0) pending.set(id, { resolve, reject });
      const data = JSON.stringify(msg) + '\n';
      proc.stdin?.write(data);
      if (id === 0) resolve(null);
      // 超时
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('MCP timeout')); } }, 60000);
    });
  }

  private async _httpCall(url: string | undefined, msg: JsonRpcRequest): Promise<any> {
    if (!url) throw new Error('MCP HTTP URL required');
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(60000),
    });
    const json = await resp.json() as JsonRpcResponse;
    if (json.error) throw new Error(json.error.message);
    return json.result;
  }

  isConnected(name: string): boolean {
    return this.processes.has(name);
  }

  /** 动态添加 MCP 服务器 — 供 AI 工具 create_mcp_server 调用 */
  async addServer(config: McpServerConfig): Promise<{ ok: boolean; error?: string; tools?: string[] }> {
    if (this.processes.has(config.name)) {
      return { ok: false, error: `MCP 服务器 "${config.name}" 已连接` };
    }
    try {
      await this.connect(config);
      const entry = this.processes.get(config.name);
      // 保存 config 用于持久化
      if (entry) entry.config = config;
      this.saveConfig();
      return { ok: true, tools: entry?.tools || [] };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  /** 动态移除 MCP 服务器 — 供 AI 工具 remove_mcp_server 调用 */
  async removeServer(name: string): Promise<boolean> {
    const entry = this.processes.get(name);
    if (!entry) return false;
    // 注销该服务器的所有工具
    for (const toolName of entry.tools) {
      try { this.registry.unregister(`${name}.${toolName}`); } catch {}
    }
    // 终止进程
    try { entry.proc?.kill(); } catch {}
    this.processes.delete(name);
    this.saveConfig();
    return true;
  }

  /** 列出所有已连接的 MCP 服务器 */
  listServers(): Array<{ name: string; tools: string[]; connected: boolean }> {
    return Array.from(this.processes.entries()).map(([name, entry]) => ({
      name, tools: entry.tools, connected: true,
    }));
  }

  /** 获取已注册的工具名列表 */
  getServerTools(name: string): string[] {
    return this.processes.get(name)?.tools || [];
  }

  async disconnectAll(): Promise<void> {
    for (const [name, { proc }] of this.processes) {
      try { proc?.kill(); } catch {}
    }
    this.processes.clear();
  }
}
