/**
 * MCP Client - Model Context Protocol 客户端
 * 
 * 2026年AI Agent标准协议，用于连接外部工具生态：
 * 1. 发现可用工具
 * 2. 调用MCP工具
 * 3. 资源访问
 * 4. Prompt模板管理
 * 
 * 参考: https://modelcontextprotocol.io/
 */

import { EventEmitter } from 'events';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    logging?: boolean;
  };
}

export interface MCPClientOptions {
  serverUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════
// MCP Client 核心类
// ═══════════════════════════════════════════════════════════

export class MCPClient extends EventEmitter {
  private options: MCPClientOptions;
  private connected = false;
  private tools: Map<string, MCPTool> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private serverInfo: MCPServerInfo | null = null;

  constructor(options: MCPClientOptions) {
    super();
    this.options = {
      timeout: 30000,
      ...options,
    };
  }

  /**
   * 连接到MCP服务器
   */
  async connect(): Promise<MCPServerInfo> {
    console.log(`[MCP] 连接服务器: ${this.options.serverUrl}`);

    try {
      // 发送initialize请求
      const response = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'AgentAI',
          version: '1.0.0',
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Initialize failed');
      }

      // 发送initialized通知
      await this.sendNotification('notifications/initialized');

      this.connected = true;
      
      // 获取服务器信息
      this.serverInfo = response.result as MCPServerInfo;
      
      // 自动发现工具和资源
      if (this.serverInfo.capabilities.tools) {
        await this.discoverTools();
      }
      if (this.serverInfo.capabilities.resources) {
        await this.discoverResources();
      }

      console.log(`[MCP] 已连接到 ${this.serverInfo.name} v${this.serverInfo.version}`);
      this.emit('connected', this.serverInfo);
      
      return this.serverInfo;
    } catch (error: any) {
      console.error(`[MCP] 连接失败:`, error.message);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      await this.sendNotification('shutdown');
      this.connected = false;
      this.tools.clear();
      this.resources.clear();
      this.serverInfo = null;
      console.log('[MCP] 已断开连接');
      this.emit('disconnected');
    } catch (error: any) {
      console.warn('[MCP] 断开连接时出错:', error.message);
    }
  }

  /**
   * 发现可用工具
   */
  async discoverTools(): Promise<MCPTool[]> {
    if (!this.connected) {
      throw new Error('未连接到服务器');
    }

    try {
      const response = await this.sendRequest('tools/list');
      
      if (response.result?.tools) {
        for (const tool of response.result.tools) {
          this.tools.set(tool.name, tool);
        }
        
        console.log(`[MCP] 发现 ${this.tools.size} 个工具`);
        this.emit('tools:discovered', Array.from(this.tools.values()));
      }
      
      return Array.from(this.tools.values());
    } catch (error: any) {
      console.error('[MCP] 发现工具失败:', error.message);
      throw error;
    }
  }

  /**
   * 发现可用资源
   */
  async discoverResources(): Promise<MCPResource[]> {
    if (!this.connected) {
      throw new Error('未连接到服务器');
    }

    try {
      const response = await this.sendRequest('resources/list');
      
      if (response.result?.resources) {
        for (const resource of response.result.resources) {
          this.resources.set(resource.uri, resource);
        }
        
        console.log(`[MCP] 发现 ${this.resources.size} 个资源`);
        this.emit('resources:discovered', Array.from(this.resources.values()));
      }
      
      return Array.from(this.resources.values());
    } catch (error: any) {
      console.error('[MCP] 发现资源失败:', error.message);
      throw error;
    }
  }

  /**
   * 调用MCP工具
   */
  async callTool(name: string, args: Record<string, any> = {}): Promise<any> {
    if (!this.connected) {
      throw new Error('未连接到服务器');
    }

    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`工具不存在: ${name}`);
    }

    console.log(`[MCP] 调用工具: ${name}`, args);

    try {
      const startTime = Date.now();
      const response = await this.sendRequest('tools/call', {
        name,
        arguments: args,
      });
      const duration = Date.now() - startTime;

      const result = {
        success: !response.error,
        content: response.result?.content || [],
        isError: response.result?.isError || false,
        durationMs: duration,
      };

      console.log(`[MCP] 工具执行完成: ${name} (${duration}ms)`, result.success ? '✅' : '❌');
      this.emit('tool:called', { name, result });

      return result;
    } catch (error: any) {
      console.error(`[MCP] 工具调用失败 [${name}]:`, error.message);
      this.emit('tool:error', { name, error });
      throw error;
    }
  }

  /**
   * 读取资源内容
   */
  async readResource(uri: string): Promise<any> {
    if (!this.connected) {
      throw new Error('未连接到服务器');
    }

    try {
      const response = await this.sendRequest('resources/read', { uri });
      
      const result = {
        contents: response.result?.contents || [],
        uri,
      };

      this.emit('resource:read', result);
      return result;
    } catch (error: any) {
      console.error(`[MCP] 读取资源失败 [${uri}]:`, error.message);
      throw error;
    }
  }

  /**
   * 列出所有可用工具
   */
  listTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 列出所有可用资源
   */
  listResources(): MCPResource[] {
    return Array.from(this.resources.values());
  }

  /**
   * 获取服务器信息
   */
  getServerInfo(): MCPServerInfo | null {
    return this.serverInfo;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 搜索工具
   */
  searchTools(query: string): MCPTool[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.tools.values()).filter(tool => 
      tool.name.toLowerCase().includes(lowerQuery) ||
      tool.description.toLowerCase().includes(lowerQuery)
    );
  }

  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════

  private async sendRequest(method: string, params?: any): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(`${this.options.serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.options.headers,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: any = await response.json();
      
      if (data.error) {
        throw new Error(data.error?.message || 'RPC Error');
      }

      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async sendNotification(method: string, params?: any): Promise<void> {
    try {
      await fetch(`${this.options.serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.options.headers,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          params,
        }),
      });
    } catch (error: any) {
      console.warn('[MCP] 发送通知失败:', error.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// MCP Server Manager - 管理多个MCP连接
// ═══════════════════════════════════════════════════════════

export class MCPServerManager extends EventEmitter {
  private clients: Map<string, MCPClient> = new Map();

  /**
   * 添加MCP服务器
   */
  async addServer(id: string, url: string): Promise<MCPServerInfo> {
    const client = new MCPClient({ serverUrl: url });
    
    // 监听事件并转发
    client.on('connected', (info) => this.emit('server:connected', { id, info }));
    client.on('disconnected', () => this.emit('server:disconnected', { id }));
    client.on('tools:discovered', (tools) => this.emit('server:tools', { id, tools }));
    client.on('tool:called', (result) => this.emit('tool:called', { id, ...result }));
    client.on('error', (error) => this.emit('server:error', { id, error }));

    // 连接
    const info = await client.connect();
    this.clients.set(id, client);
    
    return info;
  }

  /**
   * 移除MCP服务器
   */
  async removeServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
      this.clients.delete(id);
    }
  }

  /**
   * 调用任意服务器的工具
   */
  async callTool(serverId: string, toolName: string, args: any): Promise<any> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`服务器不存在: ${serverId}`);
    }
    return client.callTool(toolName, args);
  }

  /**
   * 搜索所有服务器的工具
   */
  searchAllTools(query: string): Array<{ serverId: string; tool: MCPTool }> {
    const results: Array<{ serverId: string; tool: MCPTool }> = [];
    
    for (const [serverId, client] of this.clients) {
      const tools = client.searchTools(query);
      for (const tool of tools) {
        results.push({ serverId, tool });
      }
    }
    
    return results;
  }

  /**
   * 获取所有工具（跨服务器）
   */
  getAllTools(): Array<{ serverId: string; tools: MCPTool[] }> {
    const results: Array<{ serverId: string; tools: MCPTool[] }> = [];
    
    for (const [serverId, client] of this.clients) {
      results.push({
        serverId,
        tools: client.listTools(),
      });
    }
    
    return results;
  }

  /**
   * 获取所有已连接的服务器
   */
  getServers(): Array<{ id: string; info: MCPServerInfo | null; connected: boolean }> {
    const results: Array<{ id: string; info: MCPServerInfo | null; connected: boolean }> = [];
    
    for (const [id, client] of this.clients) {
      results.push({
        id,
        info: client.getServerInfo(),
        connected: client.isConnected(),
      });
    }
    
    return results;
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    for (const [id, client] of this.clients) {
      await client.disconnect();
    }
    this.clients.clear();
  }
}

// 单例导出
export const mcpManager = new MCPServerManager();
