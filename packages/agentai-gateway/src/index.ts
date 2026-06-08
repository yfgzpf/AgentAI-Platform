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
import path from 'path';
import fs from 'fs';
import { frameworkSwitcher } from './frameworks/switcher.js';

// ===== 启动时自动读 .env (从 F:\agentai-platform\.env 或 cwd/../../.env) =====
function loadEnv() {
  const candidates: string[] = [
    process.env.AGENTAI_ENV_PATH || '',
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    'F:/agentai-platform/.env',
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, 'utf-8');
      for (const line of text.split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && m[1] && !process.env[m[1]] && m[2] !== undefined) {
          process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
      }
      console.log(`[env] loaded from ${p}`);
      return;
    }
  }
  console.warn('[env] no .env found in', candidates);
}
loadEnv();

const PORT = parseInt(process.env.AGENTAI_PORT || '18789', 10);
const HOST = process.env.AGENTAI_HOST || '127.0.0.1';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 静态资源: 生成的图片/视频 暴露给前端 (页面直接显示)
app.use('/media', express.static(path.resolve(process.cwd(), '../../packages/agentai-skills/out')));

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
    const { message, userId = 'default', workspace = process.cwd(), framework } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }

    // 写 user 消息到记忆
    await writeMemory({ userId, workspace, role: 'user', content: message, source: 'session' });

    // 如果指定 framework, 真接框架 adapter (OpenClaw / Hermes)
    if (framework === 'openclaw' || framework === 'hermes') {
      try {
        const res2 = await frameworkSwitcher.chat(
          [{ role: 'user', content: message }],
          { userId, workspace, tools: [] },
        );
        await writeMemory({
          userId, workspace, role: 'assistant',
          content: res2.content,
          metadata: { framework, provider: res2.provider, durationMs: res2.durationMs },
          source: 'session',
        });
        return res.json({
          content: res2.content,
          toolCalls: res2.toolCalls,
          provider: res2.provider,
          framework,
          usage: res2.usage,
          sessionId: `framework-${Date.now()}`,
        });
      } catch (e: any) {
        return res.status(500).json({ error: String(e) });
      }
    }

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

// ===== Image / Video 生成 (真接 Agnes Python 脚本, 通过 skills_bridge.py 走 stdin JSON) =====
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_BRIDGE = path.resolve(__dirname, '../../agentai-skills/scripts/skills_bridge.py');

function callBridge(payload: Record<string, any>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const pyCandidates: string[] = process.platform === 'win32'
      ? [
          'C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe',
          'C:/Python314/python.exe',
          'python',
          'python3',
          'py',
        ]
      : ['python3', 'python'];
    const py: string = process.env.AGNES_PYTHON || pyCandidates[0]!;

    // 不用 shell + 传 stdin JSON (解决 Windows 中文 arg 编码)
    const child = spawn(py, [SKILL_BRIDGE], {
      env: { ...process.env, AGNES_API_KEY: process.env.AGNES_API_KEY || '' },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as any; // 避免 TS 联合类型把 stdin/stdout 推成 never
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code: number | null) => resolve({ stdout, stderr, code: code ?? 0 }));
    child.on('error', (err: Error) => resolve({ stdout: '', stderr: String(err), code: 127 }));
    // 关键: 写 stdin 然后关
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    setTimeout(() => child.kill(), 360_000); // 6 min
  });
}

app.post('/v1/image', async (req, res) => {
  try {
    const { prompt, size = '1024x1024', image } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    if (!process.env.AGNES_API_KEY) return res.status(400).json({ error: 'AGNES_API_KEY not set in .env' });

    const r = await callBridge({ action: 'image', prompt, size, image });
    let data: any = {};
    try { data = JSON.parse(r.stdout.split('\n').filter(Boolean).pop() || '{}'); } catch {}
    if (r.code !== 0 || !data.ok) {
      return res.status(500).json({ error: data.error || r.stderr || 'unknown', code: r.code });
    }
    // 把本地 outputPath 转成 /media/... URL 给前端直接 <img>
    let url: string | null = null;
    if (data.outputPath) {
      const filename = path.basename(data.outputPath);
      url = `/media/${filename}`;
    }
    res.json({ ok: true, url, outputPath: data.outputPath, id: `${Date.now()}` });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/v1/video', async (req, res) => {
  try {
    const { prompt, image, num_frames, frame_rate } = req.body || {};
    if (!prompt && !image) return res.status(400).json({ error: 'prompt or image required' });
    if (!process.env.AGNES_API_KEY) return res.status(400).json({ error: 'AGNES_API_KEY not set in .env' });

    const r = await callBridge({ action: 'video', prompt, image, num_frames, frame_rate });
    let data: any = {};
    try { data = JSON.parse(r.stdout.split('\n').filter(Boolean).pop() || '{}'); } catch {}
    if (r.code !== 0 || !data.ok) {
      return res.status(500).json({ error: data.error || r.stderr || 'unknown', code: r.code });
    }
    res.json({ ok: true, taskId: data.taskId, task_id: data.taskId, status: 'submitted' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/v1/video/:id', async (req, res) => {
  try {
    const r = await callBridge({ action: 'video_status', id: req.params.id });
    let data: any = {};
    try { data = JSON.parse(r.stdout.split('\n').filter(Boolean).pop() || '{}'); } catch {}
    if (r.code !== 0 || !data.ok) {
      return res.status(500).json({ error: data.error || r.stderr || 'unknown' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ===== 密钥管理 (Settings 面板用) =====
const ENV_PATH = process.env.AGENTAI_ENV_PATH || path.resolve(process.cwd(), '../../.env');

function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const text = fs.readFileSync(ENV_PATH, 'utf-8');
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function writeEnv(env: Record<string, string>): void {
  const text = Object.entries(env).map(([k, v]) => `${k}=${v ?? ''}`).join('\n') + '\n';
  fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true });
  fs.writeFileSync(ENV_PATH, text, { mode: 0o600 });
}

const KEY_MAP: Record<string, string> = {
  agentai: 'AGENTAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
};

app.get('/v1/settings/keys', (_req, res) => {
  const env = readEnv();
  const providers = ['agentai', 'deepseek', 'openai'] as const;
  const result: Record<string, { ok: boolean; masked: string; envVar: string }> = {};
  for (const p of providers) {
    const envVar = KEY_MAP[p]!;
    const v: string | undefined = env[envVar] ?? process.env[envVar];
    result[p] = {
      ok: !!v,
      masked: v ? `${v.slice(0, 4)}...${v.slice(-4)} (${v.length} chars)` : '未配置',
      envVar,
    };
  }
  res.json(result);
});

app.post('/v1/settings/keys', (req, res) => {
  try {
    const { provider, apiKey } = req.body || {};
    if (!provider || !KEY_MAP[provider]) return res.status(400).json({ error: 'invalid provider' });
    if (!apiKey || apiKey.length < 8) return res.status(400).json({ error: 'apiKey too short' });
    const env = readEnv();
    env[KEY_MAP[provider]!] = apiKey;
    writeEnv(env);
    process.env[KEY_MAP[provider]!] = apiKey;
    res.json({ ok: true, envVar: KEY_MAP[provider] });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

// ===== 文件上传 (multipart/form-data) =====
import multer from 'multer';
const UPLOAD_DIR = path.resolve(process.cwd(), '../../packages/agentai-skills/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

app.post('/v1/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const filename = req.file.filename;
  res.json({
    ok: true,
    filename,
    originalName: req.file.originalname,
    size: req.file.size,
    url: `/media/uploads/${filename}`,
    mimetype: req.file.mimetype,
  });
});

// ===== 文件树 (VSCode 编辑器用) =====
app.get('/v1/files', (req, res) => {
  try {
    const workspace = (req.query.workspace as string) || 'F:\\agentai-platform';
    const resolved = path.resolve(workspace);
    if (!fs.existsSync(resolved)) {
      return res.json({ tree: [], root: resolved, error: 'workspace not found' });
    }
    const tree = buildTree(resolved, '', 5); // 最深 5 层
    res.json({ tree, root: resolved });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

function buildTree(dir: string, prefix: string = '', depth: number = 5): any[] {
  if (depth <= 0) return [];
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true })
      .filter(it => !it.name.startsWith('.') && it.name !== 'node_modules' && it.name !== 'dist' && it.name !== 'out' && it.name !== '__pycache__')
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
    return items.map(it => {
      const full = path.join(dir, it.name);
      const isDir = it.isDirectory();
      let children: any[] = [];
      if (isDir) {
        children = buildTree(full, prefix + '/' + it.name, depth - 1);
      }
      let size = 0;
      if (!isDir) {
        try { size = fs.statSync(full).size; } catch {}
      }
      return {
        name: it.name,
        path: full,
        type: isDir ? 'directory' : 'file',
        size,
        children: isDir ? children : undefined,
      };
    });
  } catch {
    return [];
  }
}

// 读文件
app.get('/v1/files/read', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return res.status(400).json({ error: 'is a directory' });
    if (stat.size > 5 * 1024 * 1024) return res.status(413).json({ error: 'file too large (>5MB)' });
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ path: filePath, content, size: stat.size, mtime: stat.mtimeMs });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

// 写文件
app.put('/v1/files/write', (req, res) => {
  try {
    const { path: filePath, content } = req.body || {};
    if (!filePath) return res.status(400).json({ error: 'path required' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content (string) required' });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ ok: true, path: filePath, size: content.length });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

// ===== 框架管理 (framework switcher) =====
app.get('/v1/framework/list', (_req, res) => {
  res.json({ frameworks: frameworkSwitcher.list(), status: frameworkSwitcher.status() });
});

app.post('/v1/framework/switch', async (req, res) => {
  try {
    const { to, abRatio = 1, drain = true } = req.body || {};
    if (to !== 'openclaw' && to !== 'hermes') {
      return res.status(400).json({ error: 'invalid framework (openclaw|hermes)' });
    }
    const result = await frameworkSwitcher.switch({ to, abRatio, drain });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/v1/framework/status', (_req, res) => {
  res.json(frameworkSwitcher.status());
});

// OpenClaw 多智能体 dispatch (学 ZhiY multi-agent-orchestrator)
app.post('/v1/openclaw/dispatch', async (req, res) => {
  try {
    const { agentRole, task } = req.body || {};
    if (!task) return res.status(400).json({ error: 'task required' });
    const adapter = frameworkSwitcher['adapters']?.get('openclaw') as any;
    if (!adapter) return res.status(500).json({ error: 'openclaw not registered' });
    const r = await adapter.dispatchToAgent(agentRole || 'general', task);
    res.json({ content: r.content, provider: r.provider, usage: r.usage });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

// ===== QQ Bot webhook (给独立 agentai-qqbot 包调用) =====
app.post('/v1/qq/message', async (req, res) => {
  try {
    const { userId, groupId, message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });
    const sessionKey = `qq:${groupId || 'private'}:${userId || 'anonymous'}`;
    let loop = sessions.get(sessionKey);
    if (!loop) {
      loop = new AgentAILoop(router, registry, [], { maxIterations: 10, userId: `qq-${userId}`, workspace: `qq-group-${groupId}` });
      sessions.set(sessionKey, loop);
    }
    const response = await loop.run(message);
    res.json({ reply: response.content, provider: response.provider, usage: response.usage });
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

  // 初始化 framework switcher (注册 OpenClaw / Hermes 真适配器)
  frameworkSwitcher.initActive({
    userId: 'gateway-bootstrap',
    workspace: process.cwd(),
    tools: registry.toLLMTools(),
  }).catch(err => {
    console.warn('[agentai-gateway] framework init failed:', err.message);
  });
});

// ===== 优雅关闭 =====
process.on('SIGTERM', async () => {
  console.log('[agentai-gateway] shutting down...');
  await registry.stop();
  server.close();
  process.exit(0);
});
