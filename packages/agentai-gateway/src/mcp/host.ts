import { ToolRegistry } from '../tool-registry.js';
import { McpServerConfig } from './config.js';

export class MCPHost {
  private clients = new Map<string, any>();
  private connected = new Set<string>();

  constructor(private registry: ToolRegistry) {}

  async connect(config: McpServerConfig): Promise<void> {
    if (this.connected.has(config.name)) return;
    try {
      // 模拟 MCP 连接: 注册一个代理工具到 Registry
      this.registry.register({
        name: `${config.name}.ping`,
        description: `MCP tool from ${config.name}`,
        parameters: { type: 'object', properties: {}, additionalProperties: true },
        parallelSafe: false,
        riskLevel: 'medium',
        handler: async () => ({ success: true, output: `Connected to ${config.name} (MCP transport: ${config.transport})` }),
      });
      this.connected.add(config.name);
      console.log(`[mcp] connected "${config.name}"`);
    } catch (e: any) {
      console.warn(`[mcp] failed "${config.name}": ${e.message}`);
    }
  }

  isConnected(name: string): boolean { return this.connected.has(name); }
}
