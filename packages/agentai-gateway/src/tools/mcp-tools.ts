/**
 * mcp-tools — AI 可调用的 MCP 服务器管理工具
 * ----------------------------------------------------
 * AI 可通过以下工具动态创建/管理 MCP 服务器:
 *   - create_mcp_server   — 创建新 MCP 连接
 *   - list_mcp_servers    — 列出所有连接
 *   - remove_mcp_server   — 断开 MCP 连接
 *   - reconnect_mcp_server — 重连 MCP 服务器
 */
import { ToolRegistry, type ToolEntry } from '../tool-registry.js';
import { MCPHost } from '../mcp/host.js';

export function registerMcpTools(registry: ToolRegistry, mcpHost: MCPHost): void {
  const tools: ToolEntry[] = [
    // ===== 1. create_mcp_server =====
    {
      name: 'create_mcp_server',
      description: '创建并连接一个新的 MCP (Model Context Protocol) 服务器。可用于连接数据库、文件系统、API 等外部工具。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'MCP 服务器名称，如 "my-database"' },
          transport: { type: 'string', enum: ['stdio', 'sse', 'streamable-http'], description: '传输方式: stdio(本地命令) / sse(远程SSE) / streamable-http(HTTP)' },
          command: { type: 'string', description: 'stdio 模式时的命令，如 "npx"' },
          args: { type: 'array', items: { type: 'string' }, description: '命令参数，如 ["-y", "@modelcontextprotocol/server-sqlite", "--db", "data.db"]' },
          url: { type: 'string', description: 'sse/streamable-http 模式时的远程 URL' },
          enabled: { type: 'boolean', description: '是否启用', default: true },
        },
        required: ['name', 'transport'],
      },
      handler: async (args: any, _ctx: any) => {
        const config: any = {
          name: args.name,
          transport: args.transport,
          command: args.command,
          args: args.args || [],
          url: args.url,
          enabled: args.enabled !== false,
        };
        if (!args.command && args.transport === 'stdio') {
          return { success: false, output: '❌ stdio 模式需要提供 command 参数' };
        }
        const result = await mcpHost.addServer(config);
        if (result.ok) {
          return {
            success: true,
            output: `✅ MCP 服务器 "${args.name}" 已连接\n发现 ${result.tools?.length || 0} 个工具: ${(result.tools || []).join(', ') || '无'}\n\n现在可以调用 ${(result.tools || []).map(t => `\`${args.name}.${t}\``).join(', ')} 等工具。`,
          };
        }
        return { success: false, output: `❌ 连接失败: ${result.error}` };
      },
      parallelSafe: false,
      riskLevel: 'medium',
    },

    // ===== 2. list_mcp_servers =====
    {
      name: 'list_mcp_servers',
      description: '列出所有已连接的 MCP 服务器及其提供的工具。',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_args: any, _ctx: any) => {
        const servers = mcpHost.listServers();
        if (servers.length === 0) {
          return { success: true, output: '暂无 MCP 服务器连接。使用 create_mcp_server 创建新连接。' };
        }
        const lines = servers.map(s =>
          `- ${s.name}\n  工具 (${s.tools.length}): ${s.tools.join(', ') || '无'}`
        );
        return { success: true, output: `📡 MCP 服务器 (${servers.length}):\n\n${lines.join('\n\n')}` };
      },
      parallelSafe: true,
      riskLevel: 'low',
    },

    // ===== 3. remove_mcp_server =====
    {
      name: 'remove_mcp_server',
      description: '断开并移除已连接的 MCP 服务器，同时注销其所有工具。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '要移除的 MCP 服务器名称' },
        },
        required: ['name'],
      },
      handler: async (args: any, _ctx: any) => {
        const ok = await mcpHost.removeServer(args.name);
        return ok
          ? { success: true, output: `✅ MCP 服务器 "${args.name}" 已断开，相关工具已注销` }
          : { success: false, output: `❌ 未找到 MCP 服务器: "${args.name}"` };
      },
      parallelSafe: false,
      riskLevel: 'medium',
    },

    // ===== 4. reconnect_mcp_server =====
    {
      name: 'reconnect_mcp_server',
      description: '重新连接已断开的 MCP 服务器。先移除旧连接，再创建新连接。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'MCP 服务器名称' },
        },
        required: ['name'],
      },
      handler: async (args: any, _ctx: any) => {
        // 先移除旧连接
        await mcpHost.removeServer(args.name);
        // 找配置重新连接 — MCP_HOSTS 在 config.ts 中定义
        // 如果 AI 不知道配置，提示用户
        return {
          success: false,
          output: `⚠️ 请先使用 create_mcp_server 重新创建 "${args.name}" 连接，传入相同的配置参数。`,
        };
      },
      parallelSafe: false,
      riskLevel: 'medium',
    },
  ];

  for (const t of tools) registry.register(t);
  console.log(`[mcp-tools] ✅ 已注册 ${tools.length} 个 MCP 管理工具`);
}
