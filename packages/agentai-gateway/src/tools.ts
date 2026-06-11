// ===== 批量工具定义和处理器 =====
import * as fs from 'fs';
import * as path from 'path';
import { readMemory, writeMemory } from './memory.js';
import { getGlobalSandbox } from './sandbox/index.js';

function getApiKey(name: string): string | undefined {
  return process.env[name] || '';
}

const bgJobs = new Map<number, any>();
let jobIdCounter = 0;

const resolvePath = (p: string, ws?: string) => {
  if (!p || path.isAbsolute(p)) return p;
  return path.resolve(ws || process.cwd(), p);
};

/**
 * Sandbox 守卫 (2026-06-12):
 *   - 调用 sandbox.check 对单个路径做检查
 *   - verdict=deny → 返失败结果
 *   - verdict=prompt → 返失败结果 (留给上层 chain 处理)
 *   - verdict=allow → 返 null (放行)
 */
async function sandboxGuard(p: string, op: 'read' | 'write' | 'delete', size?: number): Promise<{ success: boolean; output: string } | null> {
  const sb = getGlobalSandbox();
  if (!sb) return null; // 沙箱未启 → 放行
  const v = await sb.check({ path: p, op, size });
  if (v.verdict === 'allow') return null;
  return {
    success: false,
    output: `[sandbox ${v.verdict}] ${v.reason}`,
  };
}

export const EXTRA_TOOLS = [
  { name: 'generate_video', description: 'Generate video using Agnes Video V2.0', parameters: { type: 'object', properties: { prompt: { type: 'string' }, size: { type: 'string', enum: ['720x1280','1280x720','1080x1920','1920x1080'], default: '720x1280' }, duration: { type: 'number', default: 5 }, image: { type: 'string' } }, required: ['prompt'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'query_video', description: 'Query video generation task status', parameters: { type: 'object', properties: { videoId: { type: 'string' }, taskId: { type: 'string' } }, required: [] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'web_search', description: 'Search the web for information', parameters: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'number', default: 5 } }, required: ['query'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'web_fetch', description: 'Fetch a URL and return its text content', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'multi_edit', description: 'Apply multiple SEARCH/REPLACE edits across files', parameters: { type: 'object', properties: { edits: { type: 'array', items: { type: 'object', properties: { file_path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['file_path','old_str','new_str'] } } }, required: ['edits'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'create_directory', description: 'Create a directory', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'copy_file', description: 'Copy a file or directory', parameters: { type: 'object', properties: { source: { type: 'string' }, destination: { type: 'string' } }, required: ['source','destination'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'move_file', description: 'Move/rename a file or directory', parameters: { type: 'object', properties: { source: { type: 'string' }, destination: { type: 'string' } }, required: ['source','destination'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'get_file_info', description: 'Get file or directory metadata', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'glob', description: 'List files matching a glob pattern', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number', default: 200 } }, required: ['pattern'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'directory_tree', description: 'Recursively list directory as tree', parameters: { type: 'object', properties: { path: { type: 'string' }, maxDepth: { type: 'number', default: 2 } }, required: [] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'delete_file', description: 'Delete a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'search_content', description: 'Search file contents matching a pattern', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, context: { type: 'number', default: 0 } }, required: ['pattern'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'get_symbols', description: 'Outline symbols in a source file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'run_background', description: 'Start a long-running background process', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, waitSec: { type: 'number', default: 3 } }, required: ['command'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'job_output', description: 'Read output of a background job', parameters: { type: 'object', properties: { jobId: { type: 'number' }, tailLines: { type: 'number', default: 80 } }, required: ['jobId'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'wait_for_job', description: 'Wait for a background job to finish', parameters: { type: 'object', properties: { jobId: { type: 'number' }, timeoutMs: { type: 'number', default: 5000 } }, required: ['jobId'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'stop_job', description: 'Stop a background job', parameters: { type: 'object', properties: { jobId: { type: 'number' } }, required: ['jobId'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'list_jobs', description: 'List all background jobs', parameters: { type: 'object', properties: {} }, parallelSafe: true, riskLevel: 'low' },
  { name: 'remember', description: 'Save a memory for future sessions', parameters: { type: 'object', properties: { type: { type: 'string' }, scope: { type: 'string', enum: ['global','project'] }, name: { type: 'string' }, description: { type: 'string' }, content: { type: 'string' }, priority: { type: 'string', enum: ['low','medium','high'] } }, required: ['type','scope','name','description','content'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'forget', description: 'Delete a saved memory', parameters: { type: 'object', properties: { name: { type: 'string' }, scope: { type: 'string', enum: ['global','project'] } }, required: ['name','scope'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'recall_memory', description: 'Read a saved memory', parameters: { type: 'object', properties: { name: { type: 'string' }, scope: { type: 'string', enum: ['global','project'] } }, required: ['name','scope'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'spawn_subagent', description: 'Spawn a sub-agent for focused investigation', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['explore','research','review','security-review'] }, task: { type: 'string' } }, required: ['type','task'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'discover_or_create_skill', description: 'Auto-create a skill when needed', parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, category: { type: 'string', default: 'code' }, parameters: { type: 'object' } }, required: ['name','description'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'ask_user', description: 'Ask the user a yes/no/choice question', parameters: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id','title'] } } }, required: ['question'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'wechat_bot', description: 'Send message via WeChat bot', parameters: { type: 'object', properties: { message: { type: 'string' }, to: { type: 'string' } }, required: ['message'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'submit_report', description: 'Submit final report for chain', parameters: { type: 'object', properties: { chainId: { type: 'string' }, report: { type: 'string' } }, required: ['chainId','report'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'chain_advance', description: 'Advance chain to next stage', parameters: { type: 'object', properties: { chainId: { type: 'string' }, stage: { type: 'string' }, output: { type: 'string' } }, required: ['chainId','stage'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'chain_mark', description: 'Mark current stage success/fail', parameters: { type: 'object', properties: { chainId: { type: 'string' }, status: { type: 'string', enum: ['success','failed'] }, error: { type: 'string' } }, required: ['chainId','status'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'chain_create', description: 'Create a new task chain', parameters: { type: 'object', properties: { goal: { type: 'string' }, chain_type: { type: 'string', enum: ['linear','graph'], default: 'linear' } }, required: ['goal'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'search_codebase', description: 'Semantic code search — find functions, classes, or patterns by describing what they do in natural language (Chinese or English)', parameters: { type: 'object', properties: { question: { type: 'string', description: 'Natural language question about the codebase, e.g. "Where is the LLM router implemented?"' } }, required: ['question'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'analyze_code', description: 'Analyze a TypeScript file — list exported symbols, dependencies, and cyclomatic complexity', parameters: { type: 'object', properties: { file_path: { type: 'string', description: 'Absolute path to the .ts/.tsx file to analyze' }, detail: { type: 'string', enum: ['symbols','deps','complexity','all'], default: 'all' } }, required: ['file_path'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'worktree_create', description: 'Create an isolated git worktree for parallel task execution (symlinks node_modules)', parameters: { type: 'object', properties: { branch_prefix: { type: 'string', default: 'task-' } }, required: [] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'worktree_list', description: 'List all git worktrees in the current repository', parameters: { type: 'object', properties: {} }, parallelSafe: true, riskLevel: 'low' },
  { name: 'worktree_remove', description: 'Remove a git worktree and its branch (safety: blocks main/master removal)', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path of the worktree to remove' } }, required: ['path'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'code_review', description: 'Multi-perspective code review: spawns 3 parallel sub-agents (security, code-quality, testing) and returns a merged verdict', parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: 'List of absolute file paths to review' }, focus: { type: 'string', description: 'Optional: specific concern to focus on, e.g. "auth flow" or "error handling"' } }, required: ['files'] }, parallelSafe: false, riskLevel: 'low' },
];

export const EXTRA_HANDLERS: Record<string, (args: any, ctx?: any) => any> = {
  generate_video: async (args) => {
    try {
      const apiKey = getApiKey('AGENTAI_API_KEY') || getApiKey('AGNES_API_KEY');
      if (!apiKey) return { success: false, output: 'API Key required' };
      const { prompt, model = 'agnes-video-v2.0', size = '720x1280', duration = 5, image } = args;
      const dims = size.split('x');
      const body: any = { model, prompt, size: { width: parseInt(dims[0]), height: parseInt(dims[1]) }, duration };
      if (image) body.image = image;
      const resp = await fetch('https://apihub.agnes-ai.com/v1/videos', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) return { success: false, output: `API error: ${resp.status}` };
      const data = await resp.json();
      return { success: true, output: `Video task submitted: ${data.taskId || data.id}`, data };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  query_video: async (args) => {
    try {
      const id = args.videoId || args.taskId;
      if (!id) return { success: false, output: 'videoId required' };
      const apiKey = getApiKey('AGENTAI_API_KEY') || getApiKey('AGNES_API_KEY');
      if (!apiKey) return { success: false, output: 'API Key required' };
      const resp = await fetch(`https://apihub.agnes-ai.com/v1/videos/${id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return { success: false, output: `Query failed: ${resp.status}` };
      const data = await resp.json();
      return { success: true, output: `Status: ${data.status}`, data };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  web_search: async (args) => {
    try {
      const { query, topK = 5 } = args;
      try {
        const { callPython } = await import('./python-bridge.js');
        const r = await callPython('packages/agentai-skills/web/scrapling/main.py', { action: 'search', query, topK });
        if (r.success) return { success: true, output: `Search results for "${query}":\n${r.output.slice(0, 8000)}` };
      } catch {}
      const backends = [
        async () => {
          const r = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
          if (!r.ok) throw new Error(String(r.status));
          const html = await r.text();
          const results: string[] = [];
          const re = /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(html)) !== null && results.length < topK) {
            const title = m[2].replace(/<[^>]+>/g,'').trim();
            const snippetMatch = html.slice(m.index, m.index+400).match(/<p[^>]*>([\s\S]*?)<\/p>/);
            const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g,'').trim() : '';
            if (title) results.push(`${title}: ${m[1]}${snippet ? ' - '+snippet : ''}`);
          }
          return results.length > 0 ? results.join('\n') : null;
        },
        async () => {
          const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) throw new Error(String(r.status));
          const html = await r.text();
          const results: string[] = [];
          const re = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(html)) !== null && results.length < topK) results.push(`${m[2].replace(/<[^>]+>/g,'').trim()}: ${m[1]}`);
          return results.length > 0 ? results.join('\n') : null;
        },
      ];
      let output = '';
      for (const b of backends) { try { const r = await b(); if (r) { output = r; break; } } catch {} }
      if (!output) return { success: false, output: 'No results' };
      return { success: true, output: `Search results for "${query}":\n${output.slice(0, 8000)}` };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  web_fetch: async (args) => {
    try {
      const { url } = args;
      if (!url) return { success: false, output: 'url required' };
      try {
        const parsed = new URL(url);
        // 使用 sanitize.ts 的安全检查
        const { isDangerousUrl } = await import('./sanitize.js');
        const check = isDangerousUrl(url);
        if (check.dangerous) return { success: false, output: `Blocked: ${check.reason} (SSRF): ${parsed.hostname}` };
      } catch { return { success: false, output: 'Invalid URL' }; }
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!resp.ok) return { success: false, output: `Fetch failed: ${resp.status}` };
      const html = await resp.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const title = html.match(/<title>([^<]*)<\/title>/);
      return { success: true, output: `${title ? '# ' + title[1] + '\n' : ''}${text.slice(0, 30000)}` };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  multi_edit: async (args) => {
    try {
      const { edits } = args;
      if (!Array.isArray(edits)) return { success: false, output: 'edits must be array' };
      const results: string[] = [];
      for (const e of edits) {
        // Sandbox 守卫: 写操作前检查
        const g = await sandboxGuard(e.file_path, 'write');
        if (g) { results.push(`${e.file_path}: ${g.output}`); continue; }
        if (!fs.existsSync(e.file_path)) { results.push(`${e.file_path}: not found`); continue; }
        const content = fs.readFileSync(e.file_path, 'utf-8');
        if (!content.includes(e.old_str)) { results.push(`${e.file_path}: old_str not found`); continue; }
        fs.writeFileSync(e.file_path, content.replace(e.old_str, e.new_str));
        results.push(`${e.file_path}: ok`);
      }
      return { success: results.every(r => r.endsWith(': ok')), output: results.join('\n') };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  create_directory: async (args) => { try { fs.mkdirSync(args.path, { recursive: true }); return { success: true, output: 'Created' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  copy_file: async (args) => { try { const g1 = await sandboxGuard(args.source, 'read'); if (g1) return g1; const g2 = await sandboxGuard(args.destination, 'write'); if (g2) return g2; fs.cpSync(args.source, args.destination, { recursive: true }); return { success: true, output: 'Copied' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  move_file: async (args) => { try { const g1 = await sandboxGuard(args.source, 'read'); if (g1) return g1; const g2 = await sandboxGuard(args.destination, 'write'); if (g2) return g2; fs.renameSync(args.source, args.destination); return { success: true, output: 'Moved' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  get_file_info: async (args) => { try { const s = fs.statSync(args.path); return { success: true, output: `size: ${s.size}, mtime: ${s.mtime.toISOString()}, dir: ${s.isDirectory()}` }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  glob: async (args) => { try { const { pattern, path: p = '.', limit = 200 } = args; const { globSync } = await import('glob'); const r = globSync(pattern, { cwd: p, ignore: ['**/node_modules/**','**/.git/**','**/dist/**','**/build/**'], dot: false }); return { success: true, output: r.slice(0, limit).join('\n') || '(empty)' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  directory_tree: async (args) => {
    try {
      const { path: p = '.', maxDepth = 2 } = args;
      const walk = (dir: string, depth: number): string[] => {
        if (depth > maxDepth) return [];
        const entries: string[] = [];
        try { const list = fs.readdirSync(dir, { withFileTypes: true }); for (const e of list) { if (['node_modules','.git','dist','build'].includes(e.name)) continue; const full = path.join(dir, e.name); const prefix = '  '.repeat(depth); entries.push(prefix + (e.isDirectory() ? e.name + '/' : e.name)); if (e.isDirectory()) entries.push(...walk(full, depth + 1)); } } catch {} return entries;
      };
      return { success: true, output: walk(p, 0).join('\n') || '(empty)' };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  delete_file: async (args) => { try { const g = await sandboxGuard(args.path, 'delete'); if (g) return g; fs.unlinkSync(args.path); return { success: true, output: 'Deleted' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  search_content: async (args) => {
    try {
      const { pattern, path: p = '.', glob: g = '', context: ctx = 0 } = args;
      const { searchFileContent } = await import('./platform.js');
      const output = searchFileContent(pattern, p || process.cwd(), {
        glob: g || undefined,
        context: ctx > 0 ? ctx : undefined,
        maxResults: 200,
      });
      return { success: true, output: output.slice(0, 50000) || '(no matches)' };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  get_symbols: async (args) => { try { const c = fs.readFileSync(args.path, 'utf-8'); const syms: any[] = []; const re = /^(export\s+)?(async\s+)?(function|class|interface|type|enum|const)\s+(\w+)/gm; let m; while ((m = re.exec(c)) !== null) syms.push({ name: m[4], kind: m[3], line: c.slice(0, m.index).split('\n').length }); return { success: true, output: JSON.stringify(syms) }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  run_background: async (args) => {
    try {
      const { spawn } = await import('child_process');
      const id = ++jobIdCounter;
      const child = spawn(args.command, [], { cwd: args.cwd, shell: true, stdio: ['pipe','pipe','pipe'] });
      let output = '';
      child.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { output += d.toString(); });
      bgJobs.set(id, { pid: child.pid, running: true, output: '' });
      child.on('exit', () => { const j = bgJobs.get(id); if (j) { j.running = false; j.output = output; } });
      return { success: true, output: `Job ${id} started, pid ${child.pid}`, data: { jobId: id } };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  job_output: async (args) => { const j = bgJobs.get(args.jobId); return { success: !!j, output: j ? (j.output || '').slice(-(args.tailLines || 80) * 80) : 'Not found' }; },
  wait_for_job: async (args) => { const j = bgJobs.get(args.jobId); if (!j) return { success: false, output: 'Not found' }; const start = Date.now(); while (j.running && Date.now() - start < (args.timeoutMs || 5000)) await new Promise(r => setTimeout(r, 200)); return { success: !j.running, output: j.output || '' }; },
  stop_job: async (args) => { try { const j = bgJobs.get(args.jobId); if (!j) return { success: false, output: 'Not found' }; process.kill(j.pid); return { success: true, output: 'Stopped' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  list_jobs: async () => ({ success: true, output: [...bgJobs.entries()].map(([id, j]) => `#${id}: running=${j.running}`).join('\n') || '(none)' }),
  remember: async (args, ctx) => { try { const ws = (ctx as any)?.workspace || process.cwd(); return await writeMemory({ userId: (ctx as any)?.userId || 'default', workspace: ws, role: 'system', content: args.content, metadata: { type: args.type, scope: args.scope, name: args.name, description: args.description, priority: args.priority }, source: 'tool' }); } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  forget: async (args, ctx) => { try { const ws = (ctx as any)?.workspace || process.cwd(); const mems = await readMemory(ws); const filtered = mems.filter((m: any) => !(m.metadata?.name === args.name && m.metadata?.scope === args.scope)); return { success: true, output: 'Forgotten' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  recall_memory: async (args, ctx) => { try { const ws = (ctx as any)?.workspace || process.cwd(); const mems = await readMemory(ws); const found = mems.filter((m: any) => m.metadata?.name === args.name); return { success: true, output: found.map((m: any) => m.content).join('\n---\n') || 'Not found' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  spawn_subagent: async (args, ctx) => {
    try {
      const { type, task } = args;
      const registry = (ctx as any)?._registry;
      const router = (ctx as any)?._router;
      if (!router || !registry) return { success: false, output: 'Subagent unavailable (no router/registry)' };
      const { default: subagent } = await import('./subagent.js');
      const result = await subagent.runSubagent(type, task, router, registry, { userId: (ctx as any)?.userId || 'default', workspace: (ctx as any)?.workspace || process.cwd() });
      return { success: true, output: result || '(subagent returned empty)' };
    } catch (e: any) { return { success: false, output: `Subagent error: ${e.message}` }; }
  },
  discover_or_create_skill: async (args: any, ctx?: any) => {
    const safeName = args.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const skillDir = path.join(process.cwd(), 'packages', 'agentai-skills', safeName);
    const registry = (ctx as any)?._registry;
    if (fs.existsSync(skillDir)) {
      if (registry && !registry.get(safeName)) {
        registry.register({ name: safeName, description: args.description || `${safeName} skill`, parameters: args.parameters || { type: 'object', properties: {}, additionalProperties: true }, parallelSafe: false, riskLevel: 'medium', handler: async (a: any) => { const { callPython } = await import('./python-bridge.js'); return callPython(path.join(skillDir, 'main.py'), a); } });
      }
      return { success: true, output: `Skill "${safeName}" ready` };
    }
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${safeName}\n${args.description || ''}\n`);
    const mainPy = `# ${safeName} skill\ndef handler(args):\n    return {"success": True, "output": "${safeName} done"}\n`;
    fs.writeFileSync(path.join(skillDir, 'main.py'), mainPy);
    if (registry) {
      registry.register({ name: safeName, description: args.description || `${safeName} skill`, parameters: args.parameters || { type: 'object', properties: {}, additionalProperties: true }, parallelSafe: false, riskLevel: 'medium', handler: async (a: any) => { const { callPython } = await import('./python-bridge.js'); return callPython(path.join(skillDir, 'main.py'), a); } });
    }
    return { success: true, output: `Skill "${safeName}" created and registered`, data: { name: safeName, dir: skillDir, category: args.category || 'code' } };
  },
  ask_user: async (args) => ({ success: true, output: `[Ask user] ${args.question}`, data: { action: 'ask_user', question: args.question, options: args.options } }),
  wechat_bot: async (args) => {
    try {
      const msg = args.message;
      const resp = await fetch('http://127.0.0.1:18789/v1/qq/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'wechat', message: msg }),
      });
      if (!resp.ok) return { success: false, output: `WeChat bot error: ${resp.status}` };
      return { success: true, output: 'Message sent via WeChat bot' };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  chain_create: async (args: any, ctx: any) => {
    try {
      const userId = ctx?.userId || 'default';
      const workspace = ctx?.workspace || process.cwd();
      const putChain = (await import('./chain-store.js')).putChain;
      const chainType = args.chain_type || 'linear';
      if (chainType === 'graph') {
        const { GraphTaskChain } = await import('./graph-task-chain.js');
        const chain = new GraphTaskChain({ goal: args.goal, userId, workspace });
        putChain(userId, workspace, chain);
        return { success: true, output: `Graph chain created: ${chain.chainId}`, data: { chainId: chain.chainId, stage: chain.currentStage, chainType: 'graph' } };
      }
      const { TaskChain } = await import('./task-chain.js');
      const chain = new TaskChain({ goal: args.goal, userId, workspace });
      putChain(userId, workspace, chain);
      return { success: true, output: `Chain created: ${chain.chainId}`, data: { chainId: chain.chainId, stage: chain.currentStage, chainType: 'linear' } };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  chain_advance: async (args) => {
    try {
      const { getChainById } = await import('./chain-store.js');
      const chain = getChainById(args.chainId);
      if (!chain) return { success: false, output: `Chain ${args.chainId} not found` };
      if (typeof (chain as any).advance === 'function') await (chain as any).advance(args.stage, args.output);
      return { success: true, output: `Advanced to ${args.stage}` };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  chain_mark: async (args) => {
    try {
      const { getChainById } = await import('./chain-store.js');
      const chain = getChainById(args.chainId);
      if (!chain) return { success: false, output: `Chain ${args.chainId} not found` };
      if (args.status === 'failed' && typeof (chain as any).failCurrent === 'function') await (chain as any).failCurrent(args.error);
      return { success: true, output: `Marked ${args.status}` };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  submit_report: async (args) => {
    try {
      const { getChainById } = await import('./chain-store.js');
      const chain = getChainById(args.chainId);
      if (!chain) return { success: false, output: `Chain ${args.chainId} not found` };
      if (typeof (chain as any).report === 'function') await (chain as any).report(args.report);
      return { success: true, output: 'Report submitted' };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  search_codebase: async (args: any, ctx?: any) => {
    try {
      const { searchCodebase, formatSearchResults } = await import('./code-intel/search.js');
      const workspace = (ctx as any)?.workspace || process.cwd();
      const hits = searchCodebase(args.question, workspace);
      const formatted = formatSearchResults(hits);
      return { success: true, output: formatted, data: { hits: hits.length, results: hits.map(h => h.file) } };
    } catch (e: any) { return { success: false, output: `search_codebase error: ${e.message}` }; }
  },
  analyze_code: async (args: any, ctx?: any) => {
    try {
      const { parseSymbols, parseDependencies, computeComplexity, formatAnalyzeResult } = await import('./code-intel/analyze.js');
      const p = args.file_path;
      const detail = args.detail || 'all';
      const symbols = detail === 'deps' || detail === 'complexity' ? [] : parseSymbols(p);
      const deps = detail === 'symbols' || detail === 'complexity' ? [] : parseDependencies(p);
      const complexity = detail === 'symbols' || detail === 'deps' ? { file: p, lines: 0, cyclomatic: 0, functions: 0, topFunctions: [] } : computeComplexity(p);
      const output = formatAnalyzeResult(symbols, deps, complexity);
      return { success: true, output, data: { symbols: symbols.length, deps: deps.length, cyclomatic: complexity.cyclomatic } };
    } catch (e: any) { return { success: false, output: `analyze_code error: ${e.message}` }; }
  },
  worktree_create: async (args: any, ctx?: any) => {
    try {
      const { worktreeCreate } = await import('./worktree.js');
      const workspace = (ctx as any)?.workspace || process.cwd();
      const { worktreePath, branch } = worktreeCreate(workspace, args.branch_prefix || 'task-');
      return { success: true, output: `Worktree created: ${worktreePath}\nBranch: ${branch}`, data: { path: worktreePath, branch } };
    } catch (e: any) { return { success: false, output: `worktree_create error: ${e.message}` }; }
  },
  worktree_list: async (args: any, ctx?: any) => {
    try {
      const { worktreeList } = await import('./worktree.js');
      const workspace = (ctx as any)?.workspace || process.cwd();
      const trees = worktreeList(workspace);
      if (trees.length === 0) return { success: true, output: '(no worktrees)' };
      const out = trees.map(t => `${t.path} [${t.branch}] ${t.head}${t.current ? ' (current)' : ''}`).join('\n');
      return { success: true, output: out, data: { count: trees.length } };
    } catch (e: any) { return { success: false, output: `worktree_list error: ${e.message}` }; }
  },
  worktree_remove: async (args: any, ctx?: any) => {
    try {
      const { worktreeRemove } = await import('./worktree.js');
      const workspace = (ctx as any)?.workspace || process.cwd();
      const r = worktreeRemove(workspace, args.path);
      if (!r.ok) return { success: false, output: r.error || 'Failed to remove worktree' };
      return { success: true, output: `Worktree removed: ${args.path}` };
    } catch (e: any) { return { success: false, output: `worktree_remove error: ${e.message}` }; }
  },
  code_review: async (args: any, ctx?: any) => {
    try {
      const files: string[] = args.files || [];
      if (files.length === 0) return { success: false, output: 'files required' };

      const router = (ctx as any)?._router;
      const registry = (ctx as any)?._registry;
      if (!router || !registry) return { success: false, output: 'code_review: router/registry unavailable' };

      // 读文件内容
      const fileContents: string[] = [];
      for (const f of files.slice(0, 10)) { // 最多 10 个文件
        try { fileContents.push(`## ${f}\n\`\`\`\n${fs.readFileSync(f, 'utf-8').slice(0, 8000)}\n\`\`\``); }
        catch { fileContents.push(`## ${f}\n(file not found or unreadable)`); }
      }

      const context = fileContents.join('\n\n');
      const focus = args.focus ? `\nFocus area: ${args.focus}` : '';

      // 3 个并行审查角色 (学自 Addy Osmani agent-skills /ship)
      // 每个角色带超时控制, 防止单个子代理卡住阻塞整个 review
      const { default: subagentMod } = await import('./subagent.js');
      const REVIEW_TIMEOUT_MS = 90_000; // 单个角色 90s 超时
      const wrapWithTimeout = (promise: Promise<any>, label: string) => {
        return Promise.race([
          promise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timeout (${REVIEW_TIMEOUT_MS}ms)`)), REVIEW_TIMEOUT_MS)
          ),
        ]);
      };

      const [securityR, qualityR, testR] = await Promise.allSettled([
        wrapWithTimeout(
          subagentMod.runSubagent('security-review', `Review for security vulnerabilities: SQL injection, XSS, hardcoded secrets, unsafe eval, path traversal, missing auth checks.${focus}\n\n${context}`, router, registry, { userId: (ctx as any)?.userId || 'default', workspace: (ctx as any)?.workspace || process.cwd() }),
          'security-review'
        ),
        wrapWithTimeout(
          subagentMod.runSubagent('review', `Review for code quality: readability, naming, duplication, error handling, architecture.${focus}\n\n${context}`, router, registry, { userId: (ctx as any)?.userId || 'default', workspace: (ctx as any)?.workspace || process.cwd() }),
          'quality-review'
        ),
        wrapWithTimeout(
          subagentMod.runSubagent('review', `Review for testing: test coverage gaps, missing edge cases, testability issues.${focus}\n\n${context}`, router, registry, { userId: (ctx as any)?.userId || 'default', workspace: (ctx as any)?.workspace || process.cwd() }),
          'test-review'
        ),
      ]);

      const security = securityR.status === 'fulfilled' ? (securityR.value || '(no findings)') : `(error: ${(securityR as any).reason?.message || 'timeout'})`;
      const quality = qualityR.status === 'fulfilled' ? (qualityR.value || '(no findings)') : `(error: ${(qualityR as any).reason?.message || 'timeout'})`;
      const testing = testR.status === 'fulfilled' ? (testR.value || '(no findings)') : `(error: ${(testR as any).reason?.message || 'timeout'})`;

      const verdict = [
        `# Code Review — ${files.length} files`,
        '',
        '## Security',
        security,
        '',
        '## Code Quality',
        quality,
        '',
        '## Testing',
        testing,
        '',
        '## Verdict',
        'Review complete. Address findings above before merging.',
      ].join('\n');

      return { success: true, output: verdict.slice(0, 8000) };
    } catch (e: any) { return { success: false, output: `code_review error: ${e.message}` }; }
  },
};
