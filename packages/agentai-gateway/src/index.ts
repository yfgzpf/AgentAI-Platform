/**
 * AgentAI Gateway 入口
 * ----------------------------------------------------
 * 自创整合: 把 llm-router + tool-registry + agentai-loop 串起来
 * 同时给 desktop / qq / vscode / web 提供 3 个端点
 *
 * 端点:
 *   - HTTP GET  /health              健康检查
 *   - HTTP POST /v1/chat             主对话
 *   - WS      /v1/chat/stream        流式对话
 *   - HTTP GET /v1/tools             列出工具
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md
 */

import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import { AgentAIRouter } from './llm-router.js';
import { ToolRegistry } from './tool-registry.js';
import { AgentAILoop } from './agentai-loop.js';
import { readMemory, writeMemory } from './memory.js';

const PORT = parseInt(process.env.AGENTAI_PORT || '18789', 10);
const HOST = process.env.AGENTAI_HOST || '127.0.0.1';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: '*' } });

// ===== 初始化 3 大组件 =====
const router = new AgentAIRouter();
const registry = new ToolRegistry();
const sessions = new Map<string, AgentAILoop>();

// ===== 注册内置工具 (学 Hermes _HERMES_CORE_TOOLS, 我们只 7 个) =====
const BUILTIN_TOOLS = [
  {
    name: 'read_file',
    description: 'Read file contents from the filesystem',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path' },
        offset: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['file_path'],
    },
    riskLevel: 'low' as const,
    parallelSafe: true,
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['file_path', 'content'],
    },
    riskLevel: 'medium' as const,
    parallelSafe: false,
  },
  {
    name: 'edit_file',
    description: 'Surgical find-and-replace edit',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        old_str: { type: 'string' },
        new_str: { type: 'string' },
      },
      required: ['file_path', 'old_str', 'new_str'],
    },
    riskLevel: 'medium' as const,
    parallelSafe: false,
  },
  {
    name: 'bash',
    description: 'Execute bash command (with timeout)',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'number', default: 30000 },
      },
      required: ['command'],
    },
    riskLevel: 'high' as const,
    parallelSafe: false,
  },
  {
    name: 'list_directory',
    description: 'List directory contents',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
    riskLevel: 'low' as const,
    parallelSafe: true,
  },
  {
    name: 'search_files',
    description: 'Search files by glob pattern',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
      },
      required: ['pattern'],
    },
    riskLevel: 'low' as const,
    parallelSafe: true,
  },
  {
    name: 'generate_image',
    description: 'Generate image from text prompt (multi-modal)',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string', default: 'agnes-image-2.1-flash' },
        width: { type: 'number', default: 1024 },
        height: { type: 'number', default: 1024 },
      },
      required: ['prompt'],
    },
    riskLevel: 'low' as const,
    parallelSafe: true,
  },
];

// 占位 handler (阶段 3 真接 Python 沙箱)
for (const t of BUILTIN_TOOLS) {
  registry.register({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    parallelSafe: t.parallelSafe,
    riskLevel: t.riskLevel,
    handler: async (args) => ({
      success: true,
      output: `[stub ${t.name}] ${JSON.stringify(args)}`,
    }),
  });
}

// ===== 路由 =====

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0-alpha.1',
    components: {
      router: 'ok',
      registry: { tools: registry.list().length },
      sessions: sessions.size,
    },
  });
});

app.get('/v1/tools', (_req, res) => {
  res.json({
    tools: registry.list().map(t => ({
      name: t.name,
      description: t.description,
      parallelSafe: t.parallelSafe,
      riskLevel: t.riskLevel,
    })),
  });
});

app.post('/v1/chat', async (req, res) => {
  try {
    const { message, userId = 'default', workspace = process.cwd() } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }

    // 写 user 消息到记忆
    await writeMemory({ userId, workspace, role: 'user', content: message, source: 'session' });

    // 创建或获取 session
    const sessionKey = `${userId}:${workspace}`;
    let loop = sessions.get(sessionKey);
    if (!loop) {
      loop = new AgentAILoop(router, registry, [], {
        maxIterations: 30,
        userId,
        workspace,
      });
      sessions.set(sessionKey, loop);
    }

    // 跑主循环
    const response = await loop.run(message);

    // 写 assistant 消息
    await writeMemory({
      userId,
      workspace,
      role: 'assistant',
      content: response.content,
      metadata: { provider: response.provider, cost: response.usage.cost, durationMs: response.durationMs },
      source: 'session',
    });

    res.json({
      content: response.content,
      toolCalls: response.toolCalls,
      provider: response.provider,
      usage: response.usage,
      sessionId: loop.getContext().sessionId,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/v1/memory', async (req, res) => {
  try {
    const userId = (req.query.userId as string) || 'default';
    const workspace = req.query.workspace as string | undefined;
    const limit = parseInt((req.query.limit as string) || '50', 10);

    const entries = await readMemory({ userId, workspace, limit });
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ===== WebSocket (给 Tauri 桌面壳用) =====
io.on('connection', (socket) => {
  console.log(`[ws] connected: ${socket.id}`);

  socket.on('chat', async (data: { message: string; userId?: string; workspace?: string }) => {
    try {
      const { message, userId = 'default', workspace = process.cwd() } = data;
      const sessionKey = `${userId}:${workspace}`;
      let loop = sessions.get(sessionKey);
      if (!loop) {
        loop = new AgentAILoop(router, registry, [], { maxIterations: 30, userId, workspace });
        sessions.set(sessionKey, loop);
      }
      const response = await loop.run(message);
      socket.emit('chat:done', response);
    } catch (err) {
      socket.emit('chat:error', { error: String(err) });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[ws] disconnected: ${socket.id}`);
  });
});

// ===== 启动 =====
server.listen(PORT, HOST, () => {
  console.log(`[agentai-gateway] listening on http://${HOST}:${PORT}`);
  console.log(`[agentai-gateway] ${registry.list().length} tools registered`);
  console.log(`[agentai-gateway] visit http://${HOST}:${PORT}/health`);

  // 启动 skills 监听 (学 Hermes)
  registry.startWatcher().catch(err => {
    console.warn('[agentai-gateway] skills watcher failed:', err);
  });
});

// ===== 优雅关闭 =====
process.on('SIGTERM', async () => {
  console.log('[agentai-gateway] shutting down...');
  await registry.stop();
  server.close();
  process.exit(0);
});
