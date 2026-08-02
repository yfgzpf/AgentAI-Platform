/**
 * MCP Server 配置
 * ============================
 * 支持两种传输:
 *   - stdio: 本地子进程 (command + args)
 *   - streamable-http: 远程 HTTP (url)
 *
 * 添加新 server: 在 MCP_SERVERS 数组中添加配置
 * 临时禁用: 设置 enabled: false
 */

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  enabled?: boolean;
}

export const MCP_SERVERS: McpServerConfig[] = [
  // ===== 文件系统 =====
  {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    enabled: false,  // 启用后允许 AI 读写项目文件 (已有 read_file/write_file 工具, 可能冗余)
  },

  // ===== Git =====
  {
    name: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    enabled: false,  // 需设置 GITHUB_PERSONAL_ACCESS_TOKEN 环境变量
  },

  // ===== 数据 =====
  {
    name: 'postgres',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
    enabled: false,
  },
  {
    name: 'sqlite',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-sqlite', '--db-path', './data.db'],
    enabled: false,
  },

  // ===== 浏览器自动化 =====
  {
    name: 'puppeteer',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    enabled: false,
  },

  // ===== 搜索 =====
  {
    name: 'brave-search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-brave-search'],
    enabled: false,  // 需设置 BRAVE_API_KEY 环境变量
  },

  // ===== 智能爬虫: Bright Data CLI (MCP 原生支持) =====
  {
    name: 'brightdata',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@brightdata/cli', 'mcp'],
    enabled: false,  // 需设置 BRIGHTDATA_API_KEY，获取: https://get.brightdata.com/webscra
  },

  // ===== Android 设备控制 (Another MCP Server) =====
  // 通用手机自动化: AI 可操作手机上的任何 App (抖音/微信/小红书/快手等)
  // 需要: 安装 Another 桌面应用, 连接 Android 设备 via USB
  // MCP Server 默认监听 localhost:7070
  // @see https://github.com/Zfinix/another
  {
    name: 'android',
    transport: 'streamable-http',
    url: 'http://localhost:7070/mcp',
    enabled: false,  // 需 ANOTHER_ENABLED=1 手动启用
  },

  // ===== 知识库 (无需 API Key) =====
  {
    name: 'memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    enabled: true,  // 无需 API Key，直接启用
  },

  // ===== SketchUp 3D 建模 (本地桥接) =====
  // 让 AI 直接操控 SketchUp 进行建模操作
  // 需要: 安装 sketchup-mcp2 + Ruby 扩展, SketchUp 已打开
  // @see https://github.com/zfinix/sketchup-mcp2
  {
    name: 'sketchup',
    transport: 'stdio',
    command: 'uvx',
    args: ['sketchup-mcp2'],
    enabled: false,  // 需安装 uv + sketchup-mcp2 + SketchUp 后启用
  },
];

/** 运行时使用的 server 列表 (自动检测 + 环境变量 MCP_ENABLED 覆盖) */
export const MCP_HOSTS: McpServerConfig[] = (() => {
  // 检测可用 env
  const hasGithubToken = !!(process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN);
  const hasBraveKey = !!process.env.BRAVE_API_KEY;
  const hasBrightdataKey = !!process.env.BRIGHTDATA_API_KEY;
  const hasPostgresUrl = !!process.env.POSTGRES_URL || !!process.env.DATABASE_URL;
  const hasSqlitePath = !!process.env.SQLITE_DB_PATH;

  // 根据 env 自动启用
  const autoEnabled = (name: string): boolean => {
    switch (name) {
      case 'memory': return true;               // 无需 API Key
      case 'another': return !!process.env.ANOTHER_ENABLED;  // 需 ANOTHER_ENABLED=1 手动启用
      case 'github': return hasGithubToken;      // 有 GITHUB_TOKEN 自动启用
      case 'brave-search': return hasBraveKey;   // 有 BRAVE_API_KEY 自动启用
      case 'brightdata': return hasBrightdataKey;
      case 'postgres': return hasPostgresUrl;
      case 'sqlite': return hasSqlitePath;
      default: return false;
    }
  };

  // MCP_ENABLED 环境变量显式覆盖 — 逗号分隔的 server 名列表
  const filter = process.env.MCP_ENABLED;
  const allowed = filter ? new Set(filter.split(',').map(s => s.trim())) : null;

  return MCP_SERVERS.map(s => ({
    ...s,
    enabled: allowed ? allowed.has(s.name) : autoEnabled(s.name),
  }));
})();
