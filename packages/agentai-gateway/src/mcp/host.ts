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
  private processes = new Map<string, { proc: any; tools: string[] }>();

  constructor(private registry: ToolRegistry) {}

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
    const proc = spawn(config.command!, config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
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
      this.registry.register({
        name: `${config.name}.${tool.name}`,
        description: tool.description || `MCP tool: ${tool.name}`,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
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

  private async _connectHttp(config: McpServerConfig): Promise<void> {
    // HTTP transport: POST JSON-RPC
    const toolsResult = await this._httpCall(config.url!, {
      jsonrpc: '2.0', id: 1, method: 'tools/list',
    });
    const tools = (toolsResult?.tools || []) as Array<{ name: string; description?: string; inputSchema?: any }>;
    for (const tool of tools) {
      this.registry.register({
        name: `${config.name}.${tool.name}`,
        description: tool.description || `MCP tool: ${tool.name}`,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
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
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('MCP timeout')); } }, 15000);
    });
  }

  private async _httpCall(url: string | undefined, msg: JsonRpcRequest): Promise<any> {
    if (!url) throw new Error('MCP HTTP URL required');
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(15000),
    });
    const json = await resp.json() as JsonRpcResponse;
    if (json.error) throw new Error(json.error.message);
    return json.result;
  }

  isConnected(name: string): boolean {
    return this.processes.has(name);
  }

  async disconnectAll(): Promise<void> {
    for (const [name, { proc }] of this.processes) {
      try { proc?.kill(); } catch {}
    }
    this.processes.clear();
  }
}
