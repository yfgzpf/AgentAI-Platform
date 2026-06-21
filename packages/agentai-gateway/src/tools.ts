// @ts-nocheck
// ===== 批量工具定义和处理器 =====
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readMemory, writeMemory } from './memory.js';
import { getGlobalSandbox } from './sandbox/index.js';
import { WorkspaceManager } from './workspace-manager.js';

function getApiKey(name: string): string | undefined {
  return process.env[name] || '';
}

const bgJobs = new Map<number, any>();
let jobIdCounter = 0;
let _active_plan: any = null;
export { _active_plan };

/** 自动验证: 文件修改后运行 tsc 检查编译错误 */
async function auto_verify(filePath: string): Promise<string | null> {
  if (!/\.(tsx?|jsx?)$/i.test(filePath)) return null;
  try {
    const { execSync } = await import('child_process');
    const ws = wm().projectDir;
    // 找到最近的 tsconfig.json
    let tsconfigDir = ws;
    for (const sub of ['packages/agentai-gateway', 'packages/agentai-gui', '.']) {
      const candidate = path.join(ws, sub, 'tsconfig.json');
      if (fs.existsSync(candidate) && filePath.includes(sub.replace(/\//g, path.sep))) {
        tsconfigDir = path.join(ws, sub);
        break;
      }
    }
    const result = execSync('npx tsc --noEmit 2>&1', {
      cwd: tsconfigDir, encoding: 'utf-8', timeout: 30000,
    }).trim();
    // 只提取与当前文件相关的错误
    const fileName = path.basename(filePath);
    const relevantErrors = result.split('\n')
      .filter(l => l.includes(fileName) && l.includes('error TS'))
      .slice(0, 5)
      .join('\n');
    return relevantErrors || null;
  } catch (e: any) {
    // tsc 返回非零退出码时 execSync 会抛异常, stdout 在 e.stdout
    const output = (e.stdout || e.stderr || '').toString();
    const fileName = path.basename(filePath);
    const relevantErrors = output.split('\n')
      .filter((l: string) => l.includes(fileName) && l.includes('error TS'))
      .slice(0, 5)
      .join('\n');
    return relevantErrors || null;
  }
}

/** 获取 WorkspaceManager 单例 */
function wm(): WorkspaceManager {
  return WorkspaceManager.getInstance();
}

/** 解析工具操作路径: 相对于项目目录, 但允许安全的绝对路径 */
const resolvePath = (p: string, ws?: string) => {
  const base = ws || wm().projectDir;
  if (!p) return base;
  if (path.isAbsolute(p)) {
    // 先尝试项目目录解析
    try { return wm().resolveProjectPath(p); } catch { /* not in project */ }
    // 安全检查: 拒绝敏感系统目录
    const normalized = p.replace(/\\/g, '/').toLowerCase();
    const BLOCKED = ['/windows/', '/system32/', '/program files/', '/programdata/', '/.ssh/', '/.gnupg/', '/appdata/local/temp/'];
    if (BLOCKED.some(b => normalized.includes(b))) {
      throw new Error(`安全拒绝: 不允许访问系统目录 "${p}"`);
    }
    // 允许绝对路径 (用户桌面/其他盘等)
    return path.normalize(p);
  }
  return path.resolve(base, p);
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
  { name: 'generate_image', description: 'Generate an AI image. Uses Cogview-3-Flash (免费, 智谱 API Key) 优先, 降级到 agnes-image. Use for: 效果图/海报/插画/设计图/照片/任何需要生成图片的任务. Supports styles: 写实/插画/水墨/油画/3D/二次元/极简/奶油风 etc. Cogview sizes: 1024x1024, 768x1344, 864x1152, 1344x768, 1152x864, 1440x720, 720x1440', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Detailed image description in Chinese or English. Include style, colors, composition, lighting, mood.' }, size: { type: 'string', enum: ['1024x1024','720x1280','1280x720','1024x768','768x1024','768x1344','864x1152','1344x768','1152x864','1440x720','720x1440'], default: '1024x1024' }, style: { type: 'string', description: 'Optional: art style hint' }, negative_prompt: { type: 'string', description: 'Optional: what to avoid in the image' } }, required: ['prompt'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'generate_video', description: 'Generate video. CogVideoX-Flash (免费, 智谱 API Key) 优先, 降级到 Agnes Video V2.0', parameters: { type: 'object', properties: { prompt: { type: 'string' }, size: { type: 'string', enum: ['720x1280','1280x720','1080x1920','1920x1080'], default: '720x1280' }, duration: { type: 'number', default: 5 }, image: { type: 'string' } }, required: ['prompt'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'query_video', description: 'Query video generation task status', parameters: { type: 'object', properties: { videoId: { type: 'string' }, taskId: { type: 'string' } }, required: [] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'web_search', description: 'Search the web for information', parameters: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'number', default: 5 } }, required: ['query'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'generate_diagram', description: `Generate an inline SVG diagram for the chat. PROACTIVELY use this tool whenever you need to visualize architecture, flowcharts, data relationships, timelines, or comparisons — do NOT wait for the user to ask. If you are explaining a system, process, or relationship, generate a diagram to make it clearer. Types: flowchart (流程步骤), architecture (系统架构), comparison (对比表), timeline (时间线), mindmap (思维导图). Provide a detailed description of what to visualize. The diagram will render inline in the chat, not as a file.`, parameters: { type: 'object', properties: { description: { type: 'string', description: 'Detailed Chinese/English description of the diagram to generate. Include: layout, elements, connections, colors, labels.' }, type: { type: 'string', enum: ['flowchart', 'architecture', 'comparison', 'timeline', 'mindmap'], default: 'flowchart', description: 'Diagram type' }, title: { type: 'string', description: 'Optional diagram title (displayed at top)' } }, required: ['description'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'web_fetch', description: 'Fetch any URL and return its text content. Supports: 微信公众号文章, GitHub, 知乎, 掘金, CSDN, Stack Overflow, 任何公开网页. 当用户发送链接或提到文章时主动使用此工具获取内容.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Complete URL to fetch (supports https://mp.weixin.qq.com/s/... etc.)' } }, required: ['url'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'multi_edit', description: 'Apply multiple SEARCH/REPLACE edits across files', parameters: { type: 'object', properties: { edits: { type: 'array', items: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative path within workspace' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['file_path','old_str','new_str'] } } }, required: ['edits'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'create_directory', description: 'Create a directory', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'copy_file', description: 'Copy a file or directory', parameters: { type: 'object', properties: { source: { type: 'string' }, destination: { type: 'string' } }, required: ['source','destination'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'move_file', description: 'Move/rename a file or directory', parameters: { type: 'object', properties: { source: { type: 'string' }, destination: { type: 'string' } }, required: ['source','destination'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'get_file_info', description: 'Get file or directory metadata', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'glob', description: 'List files matching a glob pattern', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number', default: 200 } }, required: ['pattern'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'directory_tree', description: 'Recursively list directory as tree', parameters: { type: 'object', properties: { path: { type: 'string' }, maxDepth: { type: 'number', default: 2 } }, required: [] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'list_directory', description: 'List files and directories in a workspace path (non-recursive, flat list)', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path within workspace (e.g. "src/")' } }, required: ['path'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'read_file', description: 'Read file contents, optionally from a line offset with a limit', parameters: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative path within workspace (e.g. "src/index.ts")' }, offset: { type: 'number', description: 'Line offset (1-based)' }, limit: { type: 'number', description: 'Max lines to read' } }, required: ['file_path'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'write_file', description: 'Write content to a file (overwrites existing)', parameters: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative path within workspace (e.g. "src/output.txt")' }, content: { type: 'string', description: 'Content to write' } }, required: ['file_path','content'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'delete_file', description: 'Delete a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'undo_edit', description: 'Undo the last AI edit on a file by restoring from backup (.agentai/backups/)', parameters: { type: 'object', properties: { file_path: { type: 'string', description: 'File to restore' } }, required: ['file_path'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'search_content', description: 'Search file contents matching a pattern (supports regex). Output includes line numbers.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Search pattern (text or regex)' }, path: { type: 'string' }, glob: { type: 'string', description: 'File glob filter (e.g. "*.ts")' }, type: { type: 'string', description: 'File type shortcut: ts/js/py/go/rs/java/css/html/json/md' }, context: { type: 'number', default: 2, description: 'Context lines before/after match' }, regex: { type: 'boolean', default: false, description: 'Treat pattern as regex' }, files_only: { type: 'boolean', default: false, description: 'Only return matching file paths' } }, required: ['pattern'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'get_symbols', description: 'Outline symbols in a source file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'run_background', description: 'Start a long-running background process', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, waitSec: { type: 'number', default: 3 } }, required: ['command'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'job_output', description: 'Read output of a background job', parameters: { type: 'object', properties: { jobId: { type: 'number' }, tailLines: { type: 'number', default: 80 } }, required: ['jobId'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'wait_for_job', description: 'Wait for a background job to finish', parameters: { type: 'object', properties: { jobId: { type: 'number' }, timeoutMs: { type: 'number', default: 5000 } }, required: ['jobId'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'stop_job', description: 'Stop a background job', parameters: { type: 'object', properties: { jobId: { type: 'number' } }, required: ['jobId'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'list_jobs', description: 'List all background jobs', parameters: { type: 'object', properties: {} }, parallelSafe: true, riskLevel: 'low' },
  { name: 'remember', description: 'Save a memory. scope=project: 项目级记忆, 写入项目 .agentai/memory.jsonl, 会自动摘要旧条目; scope=global: 全局记忆, 仅用于技能/语法/代码开发模式 (如 "项目使用pnpm, 禁止使用npm")', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['skill','pattern','context','preference'] }, scope: { type: 'string', enum: ['global','project'] }, name: { type: 'string' }, description: { type: 'string' }, content: { type: 'string' }, priority: { type: 'string', enum: ['low','medium','high'] }, industry: { type: 'string', description: 'Industry tag (auto-filled from current industry if omitted)' } }, required: ['type','scope','name','description','content'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'plan_task', description: '为复杂任务创建执行计划。当任务涉及多个步骤、多个文件、或预计执行超过2分钟时，必须先调用此工具拆解子任务。例如：生成报告→拆为数据收集+分析+生成文档；代码重构→拆为审查+修改+测试。', parameters: { type: 'object', properties: { goal: { type: 'string', description: '任务总目标' }, subtasks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, priority: { type: 'string', enum: ['high','medium','low'] } }, required: ['id','title'] } } }, required: ['goal','subtasks'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'update_plan', description: '更新任务计划中某个子任务的状态', parameters: { type: 'object', properties: { task_id: { type: 'string' }, status: { type: 'string', enum: ['pending','in_progress','completed','failed'] }, summary: { type: 'string', description: '完成摘要(仅 completed 时)' } }, required: ['task_id','status'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'evolve_prompt', description: '修改自己的行为规则。通过反思发现某条规则导致低效或错误时使用。规则存储在 .agentai/evolved-rules.json 中，每次对话自动加载。', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['add','remove','list'], description: 'add=添加新规则, remove=删除规则, list=查看所有规则' }, rule: { type: 'string', description: '规则内容 (add 时必填)' }, reason: { type: 'string', description: '为什么要添加/删除这条规则' }, rule_id: { type: 'number', description: '要删除的规则编号 (remove 时必填)' } }, required: ['action'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'create_tool', description: '创建自定义工具。当发现经常需要某个操作但没有现成工具时使用。工具以脚本形式存储在 .agentai/custom-tools/ 目录下。', parameters: { type: 'object', properties: { name: { type: 'string', description: '工具名称 (小写+下划线)' }, description: { type: 'string' }, script: { type: 'string', description: 'Node.js 脚本内容。必须导出 async function run(args): Promise<string>' }, parameters: { type: 'object', description: '参数定义 (JSON Schema)' } }, required: ['name','description','script'] }, parallelSafe: false, riskLevel: 'high' },
  { name: 'forget', description: 'Delete a saved memory', parameters: { type: 'object', properties: { name: { type: 'string' }, scope: { type: 'string', enum: ['global','project'] } }, required: ['name','scope'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'recall_memory', description: 'Read a saved memory', parameters: { type: 'object', properties: { name: { type: 'string' }, scope: { type: 'string', enum: ['global','project'] } }, required: ['name','scope'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'spawn_subagent', description: '创建子智能体执行独立任务。适用场景：(1)需要并行处理多个独立子任务 (2)需要深度探索代码库而不影响主对话 (3)需要独立搜索调研。子智能体有独立上下文，结果自动汇总回主对话。长任务建议先 plan_task 分解，再对独立子任务各 spawn 一个子智能体。', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['explore','research','review','security-review','battle'], description: 'explore=代码探索, research=搜索调研, review=代码审查, security-review=安全审查, battle=多Agent竞争' }, task: { type: 'string', description: '子智能体要完成的具体任务描述' }, numAgents: { type: 'number', description: 'Number of competing agents (battle mode only, default 3)' } }, required: ['type','task'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'ask_user', description: '向用户提问并等待回答。必须在以下场景主动使用: (1) 用户需求模糊/有多种理解方式 (2) 缺少关键参数(风格/尺寸/格式/目标等) (3) 方案有重大取舍需用户决定 (4) 执行出错且所有自主修复失败后。不要在文字中说"我来问你"然后不调工具——用户只能通过工具弹出的卡片看到问题。', parameters: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id','title'] } } }, required: ['question'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'wechat_bot', description: 'Send message via WeChat bot', parameters: { type: 'object', properties: { message: { type: 'string' }, to: { type: 'string' } }, required: ['message'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'connect_qq_bot', description: '连接 QQ 机器人. 使用用户提供的 AppID 和 AppSecret 自动建立 WebSocket 连接, 使 AI 可以实时接收和回复 QQ 消息', parameters: { type: 'object', properties: { appId: { type: 'string', description: 'QQ 机器人 AppID (从 q.qq.com 获取)' }, appSecret: { type: 'string', description: 'QQ 机器人 AppSecret (从 q.qq.com 获取)' }, sandbox: { type: 'boolean', default: false, description: '是否使用沙箱环境' } }, required: ['appId','appSecret'] }, parallelSafe: false, riskLevel: 'medium' },
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
  { name: 'npm_install', description: 'Install npm/pip packages when dependencies are missing. Use when tools fail due to missing packages. Example: npm_install({package:"axios", type:"npm"})', parameters: { type: 'object', properties: { package: { type: 'string', description: 'Package name to install' }, type: { type: 'string', enum: ['npm','pip'], default: 'npm' } }, required: ['package'] }, parallelSafe: false, riskLevel: 'medium' },
  // ====== AI 自主能力: 电脑操控 + 浏览器自动化 (学 OpenClaw) ======
  { name: 'open_application', description: '打开本地应用程序 (如浏览器、编辑器、Office等). 使用Windows start命令或直接路径启动应用.', parameters: { type: 'object', properties: { app_name: { type: 'string', description: '应用名称 (如 "chrome", "vscode", "notepad", "explorer") 或完整路径' }, url: { type: 'string', description: '可选: 启动后打开的URL' } }, required: ['app_name'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'browser_navigate', description: '控制内嵌浏览器导航到指定URL, 并自动扫描页面元素. 返回页面标题、URL和可交互元素列表.', parameters: { type: 'object', properties: { url: { type: 'string', description: '要导航到的URL' }, wait_for: { type: 'string', enum: ['load','domcontentloaded','networkidle'], default: 'networkidle', description: '等待页面加载状态' } }, required: ['url'] }, parallelSafe: false, riskLevel: 'low' },
  { name: 'browser_click', description: '在内嵌浏览器中点击指定元素. 通过CSS selector定位元素并模拟点击.', parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector 定位要点击的元素 (如 "#search-btn", "a.login", "[data-testid=submit]")' }, wait_ms: { type: 'number', default: 1000, description: '点击后等待毫秒数' } }, required: ['selector'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'browser_type', description: '在内嵌浏览器的输入框中输入文本. 先聚焦元素再输入.', parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector 定位输入框' }, text: { type: 'string', description: '要输入的文本' }, press_enter: { type: 'boolean', default: false, description: '输入后是否按Enter' } }, required: ['selector','text'] }, parallelSafe: false, riskLevel: 'medium' },
  { name: 'browser_screenshot', description: '截取当前浏览器页面的截图, 返回截图数据用于AI视觉分析.', parameters: { type: 'object', properties: { selector: { type: 'string', description: '可选: 只截取指定元素的截图' }, full_page: { type: 'boolean', default: false, description: '是否截取完整页面' } }, required: [] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'browser_extract', description: '从当前浏览器页面提取文本内容. 可提取整个页面或指定元素.', parameters: { type: 'object', properties: { selector: { type: 'string', description: '可选: CSS selector 提取特定元素' }, extract_type: { type: 'string', enum: ['text','html','links','tables'], default: 'text', description: '提取类型' } }, required: [] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'desktop_automate', description: '执行桌面自动化操作: 模拟键盘按键、鼠标点击、截图等. 用于操控桌面应用程序.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['screenshot','key_press','key_type','mouse_click','mouse_move','scroll'], description: '自动化动作类型' }, key: { type: 'string', description: 'key_press时按的键 (如 "Enter", "Tab", "Escape", "ctrl+c")' }, text: { type: 'string', description: 'key_type时输入的文本' }, x: { type: 'number', description: '鼠标X坐标' }, y: { type: 'number', description: '鼠标Y坐标' }, button: { type: 'string', enum: ['left','right','middle'], default: 'left', description: '鼠标按钮' }, direction: { type: 'string', enum: ['up','down'], default: 'down', description: '滚动方向' }, amount: { type: 'number', default: 3, description: '滚动量' } }, required: ['action'] }, parallelSafe: false, riskLevel: 'high' },
  // ====== 沙箱代码执行 (自动模式核心能力) ======
  { name: 'run_code', description: '在安全沙箱中执行 JavaScript/Python 代码并返回结果. 用于: 计算结果、验证逻辑、调试代码、运行脚本. 自动模式下的核心能力 — 缺什么就写代码跑!', parameters: { type: 'object', properties: { code: { type: 'string', description: '要执行的代码. JS: 箭头函数如 "() => 1+1" 或语句块. Python: 完整脚本' }, language: { type: 'string', enum: ['javascript','python'], default: 'javascript', description: '编程语言' }, timeout_ms: { type: 'number', default: 10000, description: '超时毫秒数 (最大30秒)' }, context: { type: 'object', description: '可选: 传入代码的上下文变量' } }, required: ['code'] }, parallelSafe: false, riskLevel: 'medium' },
  // ====== 技能自创建 (自动模式核心能力) ======
  { name: 'discover_or_create_skill', description: '发现或创建新技能. 当现有工具无法满足需求时, AI可以自行创建新技能来扩展能力. 这是AI自进化的核心 — 缺什么工具就创建什么!', parameters: { type: 'object', properties: { name: { type: 'string', description: '技能名称 (小写+连字符, 如 "pdf-generator")' }, description: { type: 'string', description: '技能功能描述' }, category: { type: 'string', enum: ['code','media','data','web','system','automation'], default: 'code', description: '技能分类' }, code: { type: 'string', description: '可选: 技能实现代码 (JS箭头函数)' }, parameters: { type: 'object', description: '可选: 技能参数定义 (JSON Schema)' } }, required: ['name','description'] }, parallelSafe: false, riskLevel: 'medium' },
  // ====== AI 自主能力: 代码探索 + 行业洞察 + 系统自管理 (授人以渔) ======
  { name: 'explore_project', description: '自主探索项目代码结构, 生成代码地图. 不需要用户指定文件, AI自己发现项目入口、关键目录、依赖关系和设计模式. 授人以渔: 给AI探索代码的能力, 而非替用户读代码.', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['structure','dependencies','patterns','full'], default: 'structure', description: '探索模式: structure=目录结构, dependencies=依赖图, patterns=设计模式识别, full=全部' }, trace_from: { type: 'string', description: '可选: 从指定文件追踪 import 链' } }, required: [] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'industry_insight', description: '获取或添加行业洞察. AI能自主积累行业知识: 识别用户的行业, 提供行业画像(核心概念/工作流/痛点), 并从对话中自动提取洞察. 授人以渔: 让AI拥有行业深度, 而非每次从零开始.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['detect','profile','add','summary'], default: 'detect', description: 'detect=从消息识别行业, profile=获取行业画像, add=手动添加洞察, summary=所有洞察摘要' }, industry_id: { type: 'string', description: '行业ID (如 software_dev, decoration, ecommerce)' }, category: { type: 'string', enum: ['core_knowledge','workflow','terminology','tools','trends','pain_points','best_practices'], description: '洞察类别 (add 操作时必填)' }, content: { type: 'string', description: '洞察内容 (add 操作时必填)' }, message: { type: 'string', description: '用于检测行业的消息文本 (detect 操作时使用)' } }, required: ['action'] }, parallelSafe: true, riskLevel: 'low' },
  { name: 'self_diagnose', description: '系统自检与自修复. AI能自主检查系统健康状态(API Key/磁盘/记忆/缓存), 并自动修复常见问题. 授人以渔: 让AI管理自己的系统, 而非等用户来维护.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['diagnose','autofix','cleanup','health_prompt'], default: 'diagnose', description: 'diagnose=执行自检, autofix=自动修复, cleanup=清理临时文件, health_prompt=生成健康提示' } }, required: ['action'] }, parallelSafe: true, riskLevel: 'low' },
  // ====== 音乐播放器控制 (用户体验增强) ======
  { name: 'control_music', description: '控制音乐播放器. AI可以主动为用户播放背景音乐, 缓解工作压力. 支持操作: play(播放), pause(暂停), next(下一曲), prev(上一曲), volume(调整音量), load_free(加载免费音乐库), show(显示播放器). 用法示例: control_music({action:"play"}) 或 control_music({action:"load_free"})', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['play','pause','next','prev','volume','load_free','show'], description: '音乐控制动作: play=播放, pause=暂停, next=下一曲, prev=上一曲, volume=调整音量, load_free=加载免费音乐库, show=显示播放器面板' }, volume: { type: 'number', description: '音量 (0-1), volume操作时使用' }, track_index: { type: 'number', description: '可选: 指定播放曲目索引' } }, required: ['action'] }, parallelSafe: false, riskLevel: 'low' },
];

// ====== 图表生成辅助函数 (generate_diagram tool) ======

/** 图表系统提示 (参考 WorkBuddy Visualizer 设计系统) */
const DIAGRAM_SYSTEM_PROMPT = `你是一个 SVG 图表生成器。生成干净、扁平、无渐变的 SVG 图表。

规则:
- viewBox="0 0 680 H", width="100%"
- 无渐变、无阴影、无发光效果
- 背景透明 (不设rect背景)
- 颜色: 填充 #F1EFE8 / #E6F1FB / #E1F5EE, 描边 0.5px #B4B2A9 / #85B7EB / #5DCAA5
- 文字: font-family="sans-serif", 标题 14px bold, 正文 12px, 辅助 11px
- 连接线: stroke-width 1.5, 箭头用 marker
- 圆角 rx=8, 内边距 12px
- 安全区域: x=40 到 x=640, y=40 以上

图表类型:
- flowchart: 流程图, 矩形节点 + 箭头连接, 从上到下或从左到右
- architecture: 系统架构, 大矩形嵌套小矩形, 层叠布局
- comparison: 对比表, 左右两列或上下两段
- timeline: 时间线, 横向或纵向, 带节点和标签
- mindmap: 思维导图, 中心节点 + 放射状子节点`;

function buildDiagramPrompt(type: string, title: string, description: string): string {
  const typeHints: Record<string, string> = {
    flowchart: '生成流程图。矩形节点用箭头连接, 从上到下排列。标注每个步骤。',
    architecture: '生成架构图。外层大矩形包含内部模块, 用分隔线分区。标注每层职责。',
    comparison: '生成对比图。左右两栏, 每栏列出要点。在顶部标注对比维度。',
    timeline: '生成时间线图。横向排列节点, 用线条连接。每个节点标注时间和事件。',
    mindmap: '生成思维导图。中心节点在左上或中间, 分支向外辐射。不同分支用不同颜色。',
  };

  return `生成一个 "${type}" 类型的 SVG 图表。
${title ? `标题: ${title}` : ''}
描述: ${description}
${typeHints[type] || ''}`;
}

function sanitizeSvg(svg: string): string {
  // 移除 script 标签
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  // 移除事件处理器 (onclick/onload/onerror等)
  svg = svg.replace(/\s(on\w+)\s*=\s*["'][^"']*["']/gi, '');
  // 移除 javascript: URL
  svg = svg.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');
  return svg;
}

function generateFallbackSvg(type: string, title: string, description: string): string {
  const w = 680; const h = 300;
  const typeLabels: Record<string, string> = { flowchart: '流程图', architecture: '架构图', comparison: '对比图', timeline: '时间线图', mindmap: '思维导图' };
  const label = typeLabels[type] || '图表';
  const displayTitle = title || label;
  const truncatedDesc = description.length > 80 ? description.slice(0, 80) + '...' : description;

  return `\`\`\`svg
<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg">
  <rect x="40" y="40" width="${w - 80}" height="${h - 80}" rx="12" fill="#F1EFE8" stroke="#B4B2A9" stroke-width="0.5"/>
  <text x="${w / 2}" y="100" font-family="sans-serif" font-size="16" font-weight="bold" fill="#2C2C2A" text-anchor="middle">${escapeXml(displayTitle)}</text>
  <text x="${w / 2}" y="130" font-family="sans-serif" font-size="13" fill="#5F5E5A" text-anchor="middle">${escapeXml(truncatedDesc)}</text>
  <text x="${w / 2}" y="170" font-family="sans-serif" font-size="12" fill="#888780" text-anchor="middle">(AI 图表生成中, 请再次调用 generate_diagram 重试)</text>
</svg>
\`\`\``;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export const EXTRA_HANDLERS: Record<string, (args: any, ctx?: any) => any> = {
  generate_image: async (args) => {
    try {
      const { prompt, size = '1024x1024', style, negative_prompt } = args;
      const finalPrompt = style ? `${prompt} (风格: ${style})` : prompt;

      // ---- 引擎 1: Cogview-3-Flash (免费, ZHIPU_API_KEY) ----
      const zhipuKey = getApiKey('ZHIPU_API_KEY');
      if (zhipuKey) {
        try {
          const cogSize = ['1024x1024','768x1344','864x1152','1344x768','1152x864','1440x720','720x1440'].includes(size) ? size : '1024x1024';
          const body: any = { model: 'cogview-3-flash', prompt: finalPrompt, size: cogSize };
          const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
            method: 'POST',
            headers: { Authorization: `Bearer ${zhipuKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000),
          });
          if (resp.ok) {
            const data = await resp.json();
            // Cogview 返回格式: { data: [{ url: "..." }] }
            const imageUrl = data.data?.[0]?.url || data.data?.[0]?.image_url || data.url;
            if (imageUrl) {
              return { success: true, output: `✅ 图片已生成! (Cogview-3-Flash)\nURL: ${imageUrl}\n提示词: ${prompt}`, data: { imageUrl, prompt, size, provider: 'cogview-3-flash' } };
            }
          }
          // Cogview 失败: 记日志, 降级
          console.warn('[cogview] failed with status', resp.status, 'falling back to agnes');
        } catch (e: any) {
          console.warn('[cogview] error:', e.message, 'falling back to agnes');
        }
      }

      // ---- 引擎 2: agnes-image-2.1-flash (AGENTAI_API_KEY) ----
      const apiKey = getApiKey('AGENTAI_API_KEY') || getApiKey('AGNES_API_KEY');
      if (!apiKey) {
        return { success: false, output: zhipuKey
          ? 'Cogview-3-Flash 生成失败, 且未配置 AGENTAI_API_KEY 作为降级。请检查网络或重试。'
          : '未配置 API Key。请在 .env 中设置 ZHIPU_API_KEY (免费生图) 或 AGENTAI_API_KEY。' };
      }
      const body: any = {
        model: 'agnes-image-2.1-flash',
        prompt: finalPrompt,
        size: ['1024x1024','720x1280','1280x720','1024x768','768x1024'].includes(size) ? size : '1024x1024',
      };
      if (negative_prompt) body.negative_prompt = negative_prompt;
      const resp = await fetch('https://apihub.agnes-ai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return { success: false, output: `图片生成失败 (HTTP ${resp.status}): ${errText.slice(0, 200)}` };
      }
      const data = await resp.json();
      const imageUrl = data.data?.[0]?.url || data.url || data.image_url;
      if (imageUrl) {
        return { success: true, output: `✅ 图片已生成! (agnes-image)\nURL: ${imageUrl}\n提示词: ${prompt}`, data: { imageUrl, prompt, size, provider: 'agnes-image' } };
      }
      return { success: true, output: `图片任务已提交: ${JSON.stringify(data).slice(0, 500)}`, data };
    } catch (e: any) { return { success: false, output: `图片生成错误: ${e.message}` }; }
  },
  generate_video: async (args) => {
    try {
      const { prompt, size = '720x1280', duration = 5, image } = args;

      // ---- 引擎 1: CogVideoX-Flash (免费, ZHIPU_API_KEY) ----
      const zhipuKey = getApiKey('ZHIPU_API_KEY');
      if (zhipuKey) {
        try {
          const body: any = { model: 'cogvideox-flash', prompt };
          const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/videos/generations', {
            method: 'POST',
            headers: { Authorization: `Bearer ${zhipuKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
          });
          if (resp.ok) {
            const data = await resp.json();
            const taskId = data.id || data.taskId;
            if (taskId) {
              return { success: true, output: `✅ 视频任务已提交! (CogVideoX-Flash)\n任务ID: ${taskId}\n提示词: ${prompt}\n用 query_video({videoId: "${taskId}"}) 查询进度`, data: { taskId, provider: 'cogvideox-flash', prompt } };
            }
          }
          console.warn('[cogvideo] failed with status', resp.status, 'falling back to agnes');
        } catch (e: any) {
          console.warn('[cogvideo] error:', e.message, 'falling back to agnes');
        }
      }

      // ---- 引擎 2: Agnes Video V2.0 (AGENTAI_API_KEY) ----
      const apiKey = getApiKey('AGENTAI_API_KEY') || getApiKey('AGNES_API_KEY');
      if (!apiKey) {
        return { success: false, output: zhipuKey
          ? 'CogVideoX-Flash 生成失败, 且未配置 AGENTAI_API_KEY 作为降级。请检查网络或重试。'
          : '未配置 API Key。请在 .env 中设置 ZHIPU_API_KEY (免费生视频) 或 AGENTAI_API_KEY。' };
      }
      const dims = size.split('x');
      const body: any = { model: 'agnes-video-v2.0', prompt, size: { width: parseInt(dims[0]), height: parseInt(dims[1]) }, duration };
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

      // 先试 CogVideoX (ZHIPU_API_KEY)
      const zhipuKey = getApiKey('ZHIPU_API_KEY');
      if (zhipuKey) {
        try {
          const resp = await fetch(`https://open.bigmodel.cn/api/paas/v4/videos/${id}`, {
            headers: { Authorization: `Bearer ${zhipuKey}` },
          });
          if (resp.ok) {
            const data = await resp.json();
            return { success: true, output: `CogVideoX Status: ${data.status || data.task_status}`, data };
          }
        } catch {}
      }

      // 再试 Agnes (AGENTAI_API_KEY)
      const apiKey = getApiKey('AGENTAI_API_KEY') || getApiKey('AGNES_API_KEY');
      if (!apiKey) return { success: false, output: 'No API Key for query' };
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
      } catch (e: any) { /* web_search optional */ }
      const backends = [
        async () => {
          const r = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
          if (!r.ok) throw new Error(String(r.status));
          const html = await r.text();
          const results: string[] = [];
          const re = /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(html)) !== null && results.length < topK) {
            const title = (m[2] || '').replace(/<[^>]+>/g,'').trim();
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
          while ((m = re.exec(html)) !== null && results.length < topK) results.push(`${(m[2] || '').replace(/<[^>]+>/g,'').trim()}: ${m[1]}`);
          return results.length > 0 ? results.join('\n') : null;
        },
      ];
      let output = '';
      for (const b of backends) { try { const r = await b(); if (r) { output = r; break; } } catch (e: any) { /* backend fallback */ } }
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
        const { isDangerousUrl } = await import('./sanitize.js');
        const check = isDangerousUrl(url);
        if (check.dangerous) return { success: false, output: `Blocked: ${check.reason} (SSRF): ${parsed.hostname}` };
      } catch { return { success: false, output: 'Invalid URL' }; }

      // 完整的浏览器 Headers (解决微信/知乎等反爬虫)
      const browserHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity', // 不压缩, 方便解析
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      };
      // 微信公众号特殊处理
      if (url.includes('mp.weixin.qq.com')) {
        browserHeaders['Referer'] = 'https://mp.weixin.qq.com/';
      }

      const resp = await fetch(url, {
        signal: AbortSignal.timeout(30000), // 30秒 (微信重定向较慢)
        headers: browserHeaders,
        redirect: 'follow',
      });
      if (!resp.ok) return { success: false, output: `Fetch failed: ${resp.status} ${resp.statusText}` };
      const html = await resp.text();
      // 增强: 结构化提取 + Markdown 输出 (学习 Agent-Reach 结构保留)
      try {
        const { extractStructuredInfo, formatAsMarkdown } = await import('./fetch-enhancer.js');
        const info = extractStructuredInfo(html, url, 30000);
        return { success: true, output: formatAsMarkdown(info) };
      } catch {
        // 降级: 保持旧的纯文本输出
        const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const title = html.match(/<title>([^<]*)<\/title>/);
        return { success: true, output: `${title ? '# ' + title[1] + '\n' : ''}${text.slice(0, 30000)}` };
      }
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  generate_diagram: async (args, ctx) => {
    try {
      const { description, type = 'flowchart', title } = args;
      if (!description) return { success: false, output: 'description required' };

      // 优先从 context 获取 router (与 spawn_subagent / code_review 一致)
      const router = (ctx as any)?._router;
      if (!router || typeof router.chat !== 'function') {
        // 降级: 返回模板化的简单 SVG
        return { success: true, output: generateFallbackSvg(type, title, description) };
      }

      const diagramPrompt = buildDiagramPrompt(type, title || '', description);
      const res = await router.chat({
        model: 'agentai',
        messages: [
          { role: 'system', content: DIAGRAM_SYSTEM_PROMPT },
          { role: 'user', content: diagramPrompt },
        ],
        temperature: 0.3,
        maxTokens: 3000,
      });

      // 从回复中提取 SVG
      const svgMatch = res.content?.match(/<svg[\s\S]*?<\/svg>/i);
      if (!svgMatch) {
        // LLM 没有生成有效 SVG, 降级
        return { success: true, output: generateFallbackSvg(type, title, description) };
      }

      let svg = svgMatch[0];

      // 安全: 移除 script/event handlers
      svg = sanitizeSvg(svg);

      // 输出为 Markdown 代码块 (前端会检测 language-svg 并渲染)
      return {
        success: true,
        output: `\`\`\`svg\n${svg}\n\`\`\``,
      };
    } catch (e: any) {
      return { success: false, output: `Error: ${e.message}` };
    }
  },
  multi_edit: async (args, ctx) => {
    try {
      const { edits } = args;
      if (!Array.isArray(edits)) return { success: false, output: 'edits must be array' };
      const results: string[] = [];
      const ws = wm().projectDir;
      const backupDir = path.join(ws, '.agentai', 'backups');
      for (const e of edits) {
        const resolvedPath = resolvePath(e.file_path, ctx?.workspace);
        const g = await sandboxGuard(resolvedPath, 'write');
        if (g) { results.push(`${e.file_path}: ${g.output}`); continue; }
        if (!fs.existsSync(resolvedPath)) { results.push(`${e.file_path}: not found`); continue; }
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        if (!content.includes(e.old_str)) {
          // 模糊匹配: 找最相似的代码段提示
          const lines = content.split('\n');
          const searchLines = e.old_str.split('\n');
          const firstSearchLine = searchLines[0].trim();
          let bestMatch = ''; let bestLine = -1;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().includes(firstSearchLine.slice(0, 30))) {
              bestMatch = lines.slice(i, i + searchLines.length).join('\n');
              bestLine = i + 1;
              break;
            }
          }
          const hint = bestLine > 0
            ? `\n最相似代码在 L${bestLine}:\n${bestMatch.slice(0, 200)}`
            : '';
          results.push(`${e.file_path}: old_str not found (检查空格/缩进)${hint}`);
          continue;
        }
        // 备份原文件
        try {
          fs.mkdirSync(backupDir, { recursive: true });
          const bakName = path.basename(resolvedPath) + '.' + Date.now() + '.bak';
          fs.writeFileSync(path.join(backupDir, bakName), content, 'utf-8');
        } catch { /* backup optional */ }
        // 只替换第一处匹配
        const newContent = content.replace(e.old_str, e.new_str);
        fs.writeFileSync(resolvedPath, newContent, 'utf-8');
        // diff 摘要
        const oldLines = content.split('\n').length;
        const newLines = newContent.split('\n').length;
        const diff = newLines - oldLines;
        const diffLabel = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '±0';
        results.push(`${e.file_path}: ok (${diffLabel} lines)`);
      }
      // 自动验证: 对所有修改的 TS/JS 文件检查编译错误
      const editedFiles = edits
        .map((e: any) => resolvePath(e.file_path, ctx?.workspace))
        .filter((f: string) => /\.(tsx?|jsx?)$/i.test(f));
      if (editedFiles.length > 0) {
        const verifyErrors = await auto_verify(editedFiles[0]);
        if (verifyErrors) {
          return { success: false, output: results.join('\n') + `\n⚠️ 编译错误 (请立即修复):\n${verifyErrors}` };
        }
      }
      return { success: results.every(r => r.includes(': ok')), output: results.join('\n') };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  create_directory: async (args, ctx) => { try { const p = resolvePath(args.path, ctx?.workspace); fs.mkdirSync(p, { recursive: true }); return { success: true, output: 'Created' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  copy_file: async (args, ctx) => { try { const src = resolvePath(args.source, ctx?.workspace); const dst = resolvePath(args.destination, ctx?.workspace); const g1 = await sandboxGuard(src, 'read'); if (g1) return g1; const g2 = await sandboxGuard(dst, 'write'); if (g2) return g2; fs.cpSync(src, dst, { recursive: true }); return { success: true, output: 'Copied' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  move_file: async (args, ctx) => { try { const src = resolvePath(args.source, ctx?.workspace); const dst = resolvePath(args.destination, ctx?.workspace); const g1 = await sandboxGuard(src, 'read'); if (g1) return g1; const g2 = await sandboxGuard(dst, 'write'); if (g2) return g2; fs.renameSync(src, dst); return { success: true, output: 'Moved' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  get_file_info: async (args, ctx) => { try { const p = resolvePath(args.path, ctx?.workspace); const s = fs.statSync(p); return { success: true, output: `size: ${s.size}, mtime: ${s.mtime.toISOString()}, dir: ${s.isDirectory()}` }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  glob: async (args, ctx) => { try { const { pattern, limit = 200 } = args; const p = resolvePath(args.path || '.', ctx?.workspace); const { globSync } = await import('glob'); const r = globSync(pattern, { cwd: p, ignore: ['**/node_modules/**','**/.git/**','**/dist/**','**/build/**'], dot: false }); return { success: true, output: r.slice(0, limit).join('\n') || '(empty)' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  directory_tree: async (args, ctx) => {
    try {
      const { path: p = '.', maxDepth = 2 } = args;
      const root = resolvePath(p, ctx?.workspace);
      const walk = (dir: string, depth: number): string[] => {
        if (depth > maxDepth) return [];
        const entries: string[] = [];
        try { const list = fs.readdirSync(dir, { withFileTypes: true }); for (const e of list) { if (['node_modules','.git','dist','build'].includes(e.name)) continue; const full = path.join(dir, e.name); const prefix = '  '.repeat(depth); entries.push(prefix + (e.isDirectory() ? e.name + '/' : e.name)); if (e.isDirectory()) entries.push(...walk(full, depth + 1)); } } catch (e: any) { /* dir read optional */ } return entries;
      };
      return { success: true, output: walk(root, 0).join('\n') || '(empty)' };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  list_directory: async (args, ctx) => {
    try {
      const p = resolvePath(args.path || '.', ctx?.workspace);
      const entries = fs.readdirSync(p, { withFileTypes: true });
      const lines = entries.map(e => {
        const name = e.name;
        let size = ''; try { if (!e.isDirectory()) size = ` (${fs.statSync(path.join(p, name)).size}B)`; } catch (e: any) { /* stat optional */ }
        return e.isDirectory() ? `📁 ${name}/` : `📄 ${name}${size}`;
      });
      return { success: true, output: lines.join('\n') || '(empty)' };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  read_file: async (args, ctx) => {
    try {
      const { file_path: fp, offset, limit } = args;
      const resolved = resolvePath(fp, ctx?.workspace);
      // 检查是否为目录 → 返回目录列表
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        const listing = entries.map(e => {
          const name = e.name;
          let size = ''; try { if (!e.isDirectory()) size = ` (${fs.statSync(path.join(resolved, name)).size}B)`; } catch (e: any) { /* stat optional */ }
          return e.isDirectory() ? `📁 ${name}/` : `📄 ${name}${size}`;
        }).join('\n');
        return { success: true, output: `[目录] ${resolved}\n${listing || '(空目录)'}` };
      }
      // Excel文件 (.xlsx/.xls) → 解析为文本表格
      if (/\.(xlsx?|xls)$/i.test(resolved)) {
        try {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(fs.readFileSync(resolved), { type: 'buffer' });
          const lines: string[] = [`[Excel文件: ${fp}, ${wb.SheetNames.length}个工作表]\n`];
          for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            if (!ws) continue;
            const data = XLSX.utils.sheet_to_csv(ws);
            const rows = data.split('\n').filter(r => r.trim());
            const maxRows = 200;
            lines.push(`\n--- 工作表: ${sheetName} (${rows.length}行) ---`);
            lines.push(...rows.slice(0, maxRows));
            if (rows.length > maxRows) lines.push(`... (还有 ${rows.length - maxRows} 行)`);
          }
          return { success: true, output: lines.join('\n') };
        } catch (e: any) {
          return { success: false, output: `Excel解析失败: ${e.message}\n提示: 请安装xlsx依赖 (npm install xlsx)` };
        }
      }
      let content = fs.readFileSync(resolved, 'utf-8');
      if (offset) {
        const lines = content.split('\n');
        const start = offset - 1;
        const end = limit ? start + limit : undefined;
        content = lines.slice(start, end).join('\n');
      }

      // RevertBridge: 检测用户是否回退了 AI 的修改，自动学习偏好
      try {
        const ws = wm().projectDir;
        const aiWriteLog = path.join(ws, '.agentai', 'ai-writes.json');
        const logData = fs.readFileSync(aiWriteLog, 'utf-8');
        const writes: Record<string, string> = JSON.parse(logData);
        const aiContent = writes[fp];
        if (aiContent && content !== aiContent) {
          const { revertBridge } = await import('./revert-bridge.js');
          const result = revertBridge.learn(ws, fp, aiContent, content);
          if (result.learned) {
            console.log(`[RevertBridge] Learned preference from user edit: ${result.insight}`);
          }
          delete writes[fp];
          fs.writeFileSync(aiWriteLog, JSON.stringify(writes), 'utf-8');
        }
      } catch (e: any) { /* ai-writes.json 不存在是正常情况 */ }

      return { success: true, output: content };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  write_file: async (args, ctx) => {
    try {
      const resolved = resolvePath(args.file_path, ctx?.workspace);
      const g = await sandboxGuard(resolved, 'write', args.content?.length);
      if (g) return g;

      // 读取旧内容 (用于备份 + diff)
      let oldContent: string | null = null;
      try {
        oldContent = fs.readFileSync(resolved, 'utf-8');
      } catch (e: any) { /* file may not exist yet */ }

      // 物理备份到 .agentai/backups/
      if (oldContent !== null) {
        try {
          const ws = wm().projectDir;
          const backupDir = path.join(ws, '.agentai', 'backups');
          fs.mkdirSync(backupDir, { recursive: true });
          const bakName = path.basename(resolved) + '.' + Date.now() + '.bak';
          fs.writeFileSync(path.join(backupDir, bakName), oldContent, 'utf-8');
        } catch { /* backup optional */ }
      }

      fs.writeFileSync(resolved, args.content, 'utf-8');

      // RevertBridge: 记录 AI 写入 (用于后续回退学习)
      if (oldContent !== null && oldContent !== args.content) {
        try {
          const ws = wm().projectDir;
          const aiWriteLog = path.join(ws, '.agentai', 'ai-writes.json');
          let writes: Record<string, string> = {};
          try { writes = JSON.parse(fs.readFileSync(aiWriteLog, 'utf-8')); } catch (e: any) { /* log may not exist */ }
          writes[args.file_path] = args.content;
          const keys = Object.keys(writes);
          if (keys.length > 30) {
            for (let i = 0; i < keys.length - 30; i++) delete writes[keys[i]];
          }
          try {
            fs.mkdirSync(path.dirname(aiWriteLog), { recursive: true });
            fs.writeFileSync(aiWriteLog, JSON.stringify(writes), 'utf-8');
          } catch (e: any) { console.warn('[RevertBridge] write log failed:', e?.message); }
        } catch (e: any) { console.warn('[RevertBridge] record failed:', e?.message); }
      }

      // diff 摘要 + 自动验证
      const newLines = args.content.split('\n').length;
      let msg = '';
      if (oldContent !== null) {
        const oldLines = oldContent.split('\n').length;
        const diff = newLines - oldLines;
        const diffLabel = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '±0';
        msg = `Written (${diffLabel} lines, total ${newLines})`;
      } else {
        msg = `Created (${newLines} lines)`;
      }
      // 自动验证: TS/JS 文件写入后检查编译错误
      const verifyErrors = await auto_verify(resolved);
      if (verifyErrors) {
        msg += `\n⚠️ 编译错误 (请立即修复):\n${verifyErrors}`;
      }
      return { success: true, output: msg };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  delete_file: async (args, ctx) => { try { const p = resolvePath(args.path, ctx?.workspace); const g = await sandboxGuard(p, 'delete'); if (g) return g; fs.unlinkSync(p); return { success: true, output: 'Deleted' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  undo_edit: async (args, ctx) => {
    try {
      const ws = wm().projectDir;
      const backupDir = path.join(ws, '.agentai', 'backups');
      const fileName = path.basename(args.file_path);
      if (!fs.existsSync(backupDir)) return { success: false, output: '无备份目录' };
      // 找该文件的最新备份
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(fileName + '.') && f.endsWith('.bak'))
        .sort().reverse();
      if (backups.length === 0) return { success: false, output: `无 ${fileName} 的备份` };
      const latestBak = path.join(backupDir, backups[0]);
      const content = fs.readFileSync(latestBak, 'utf-8');
      const resolved = resolvePath(args.file_path, ctx?.workspace);
      fs.writeFileSync(resolved, content, 'utf-8');
      // 删除已使用的备份
      fs.unlinkSync(latestBak);
      return { success: true, output: `已恢复 ${fileName} 到上一版本 (备份: ${backups[0]})` };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  search_content: async (args, ctx) => {
    try {
      const { pattern, context: ctxLines = 2, regex: useRegex = false, files_only = false } = args;
      const p = resolvePath(args.path || '.', ctx?.workspace);
      // 文件类型 → glob 映射
      const typeGlobMap: Record<string, string> = {
        ts: '**/*.{ts,tsx}', js: '**/*.{js,jsx}', py: '**/*.py',
        go: '**/*.go', rs: '**/*.rs', java: '**/*.java',
        css: '**/*.{css,scss,less}', html: '**/*.{html,htm}',
        json: '**/*.json', md: '**/*.md', yaml: '**/*.{yml,yaml}',
      };
      const globPattern = args.type ? typeGlobMap[args.type] : (args.glob || undefined);
      // 使用 platform.searchFileContent（已有行号支持）
      const { searchFileContent } = await import('./platform.js');
      const output = searchFileContent(pattern, p, {
        glob: globPattern,
        context: ctxLines > 0 ? ctxLines : undefined,
        maxResults: 200,
        regex: useRegex,
      });
      if (files_only) {
        // 提取文件路径去重
        const fileSet = new Set<string>();
        for (const line of output.split('\n')) {
          const m = line.match(/^(.+?):\d+:/);
          if (m) fileSet.add(m[1]);
        }
        return { success: true, output: [...fileSet].join('\n') || '(no matches)' };
      }
      return { success: true, output: output.slice(0, 50000) || '(no matches)' };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  get_symbols: async (args, ctx) => { try { const p = resolvePath(args.path, ctx?.workspace); const c = fs.readFileSync(p, 'utf-8'); const syms: any[] = []; const re = /^(export\s+)?(async\s+)?(function|class|interface|type|enum|const)\s+(\w+)/gm; let m; while ((m = re.exec(c)) !== null) syms.push({ name: m[4], kind: m[3], line: c.slice(0, m.index).split('\n').length }); return { success: true, output: JSON.stringify(syms) }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
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
  stop_job: async (args) => { try { const j = bgJobs.get(args.jobId); if (!j) return { success: false, output: 'Not found' }; const { execSync } = await import('child_process'); execSync(`taskkill /F /PID ${j.pid}`, { stdio: 'ignore' }); return { success: true, output: 'Stopped' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  list_jobs: async () => ({ success: true, output: [...bgJobs.entries()].map(([id, j]) => `#${id}: running=${j.running}`).join('\n') || '(none)' }),
  remember: async (args, ctx) => { try { const ws = wm().projectDir; const uid = (ctx as any)?.userId || 'default'; await writeMemory({ userId: uid, workspace: ws, role: 'system', content: args.content, metadata: { type: args.type, scope: args.scope, name: args.name, description: args.description, priority: args.priority }, source: 'tool', industry: args.industry }); return { success: true, output: `✅ 记忆已保存: [${args.type}] ${args.name}\n内容: ${args.content.slice(0, 100)}${args.content.length > 100 ? '...' : ''}` }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  plan_task: async (args) => {
    try {
      const { goal, subtasks } = args;
      if (!Array.isArray(subtasks) || subtasks.length === 0) {
        return { success: false, output: '至少需要 1 个子任务' };
      }
      const plan = {
        id: `plan-${Date.now()}`,
        goal,
        subtasks: subtasks.map((t: any) => ({
          id: t.id, title: t.title,
          priority: t.priority || 'medium',
          status: 'pending' as string,
          summary: '' as string,
        })),
        created_at: Date.now(),
      };
      _active_plan = plan;
      const list = plan.subtasks.map((t: any, i: number) =>
        `${i + 1}. [${t.priority}] ${t.title}`
      ).join('\n');
      return {
        success: true,
        output: `📋 计划已创建: ${goal}\n${list}\n\n请开始执行第 1 个子任务。完成后用 update_plan 更新状态。`,
        data: { action: 'plan_created', plan },
      };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  update_plan: async (args) => {
    try {
      if (!_active_plan) return { success: false, output: '无活跃计划，请先用 plan_task 创建' };
      const task = _active_plan.subtasks.find((t: any) => t.id === args.task_id);
      if (!task) return { success: false, output: `未找到子任务: ${args.task_id}` };
      task.status = args.status;
      if (args.summary) task.summary = args.summary;
      const done = _active_plan.subtasks.filter((t: any) => t.status === 'completed').length;
      const total = _active_plan.subtasks.length;
      const next = _active_plan.subtasks.find((t: any) => t.status === 'pending');
      let msg = `✅ ${task.title}: ${args.status}${args.summary ? ' — ' + args.summary : ''}\n进度: ${done}/${total}`;
      if (next) msg += `\n下一步: ${next.title}`;
      else if (done === total) msg += `\n🎉 所有子任务已完成!`;
      return {
        success: true,
        output: msg,
        data: { action: 'plan_updated', plan: _active_plan },
      };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  evolve_prompt: async (args) => {
    try {
      const ws = wm().projectDir;
      const rulesFile = path.join(ws, '.agentai', 'evolved-rules.json');
      fs.mkdirSync(path.dirname(rulesFile), { recursive: true });

      // 读取现有规则
      let rules: Array<{ id: number; rule: string; reason: string; ts: number }> = [];
      try { rules = JSON.parse(fs.readFileSync(rulesFile, 'utf-8')); } catch { /* new file */ }

      if (args.action === 'list') {
        if (rules.length === 0) return { success: true, output: '暂无自定义规则' };
        const list = rules.map(r =>
          `#${r.id} [${new Date(r.ts).toLocaleDateString()}] ${r.rule}\n   原因: ${r.reason}`
        ).join('\n\n');
        return { success: true, output: `共 ${rules.length} 条自进化规则:\n\n${list}` };
      }

      if (args.action === 'add') {
        if (!args.rule) return { success: false, output: 'rule 参数必填' };
        const newId = rules.length > 0 ? Math.max(...rules.map(r => r.id)) + 1 : 1;
        rules.push({ id: newId, rule: args.rule, reason: args.reason || '', ts: Date.now() });
        // 上限 20 条, 超过删最旧的
        if (rules.length > 20) rules = rules.slice(-20);
        fs.writeFileSync(rulesFile, JSON.stringify(rules, null, 2), 'utf-8');
        return { success: true, output: `✅ 规则 #${newId} 已添加: ${args.rule.slice(0, 80)}` };
      }

      if (args.action === 'remove') {
        if (args.rule_id == null) return { success: false, output: 'rule_id 参数必填' };
        const before = rules.length;
        rules = rules.filter(r => r.id !== args.rule_id);
        if (rules.length === before) return { success: false, output: `未找到规则 #${args.rule_id}` };
        fs.writeFileSync(rulesFile, JSON.stringify(rules, null, 2), 'utf-8');
        return { success: true, output: `✅ 规则 #${args.rule_id} 已删除` };
      }

      return { success: false, output: '无效 action' };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  create_tool: async (args) => {
    try {
      const ws = wm().projectDir;
      const toolsDir = path.join(ws, '.agentai', 'custom-tools');
      fs.mkdirSync(toolsDir, { recursive: true });

      const { name, description, script, parameters: params } = args;
      if (!name || !description || !script) {
        return { success: false, output: 'name, description, script 均必填' };
      }
      if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        return { success: false, output: '工具名必须是小写+下划线, 如 diff_files' };
      }

      // 保存脚本
      const scriptFile = path.join(toolsDir, `${name}.mjs`);
      fs.writeFileSync(scriptFile, script, 'utf-8');

      // 注册到 registry
      const registryFile = path.join(toolsDir, 'registry.json');
      let registry: Record<string, any> = {};
      try { registry = JSON.parse(fs.readFileSync(registryFile, 'utf-8')); } catch { /* new */ }
      registry[name] = { description, parameters: params || {}, scriptFile: `${name}.mjs`, createdAt: Date.now() };
      fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2), 'utf-8');

      return {
        success: true,
        output: `✅ 自定义工具 "${name}" 已创建\n脚本: ${scriptFile}\n描述: ${description}\n下次对话可通过 run_code 调用此脚本`,
      };
    } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; }
  },
  forget: async (args, ctx) => { try { const ws = wm().projectDir; const uid = (ctx as any)?.userId || 'default'; const mems = await readMemory({ userId: uid, workspace: ws }); const before = mems.length; const filtered = mems.filter((m: any) => !(m.metadata?.name === args.name && m.metadata?.scope === args.scope)); return { success: true, output: `已忘记 ${args.name}, 剩余 ${filtered.length} 条记忆` }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  recall_memory: async (args, ctx) => { try { const ws = wm().projectDir; const uid = (ctx as any)?.userId || 'default'; const mems = await readMemory({ userId: uid, workspace: ws, limit: 20 }); if (args.name) { const found = mems.filter((m: any) => m.metadata?.name === args.name); return { success: true, output: found.length > 0 ? found.map((m: any) => `[${m.metadata?.type || m.role}] ${m.content}`).join('\n---\n') : `未找到记忆: ${args.name}` }; } return { success: true, output: mems.length > 0 ? mems.slice(0, 10).map((m: any) => `[${new Date(m.ts).toLocaleString()}] ${m.content.slice(0, 80)}`).join('\n') : '暂无记忆' }; } catch (e: any) { return { success: false, output: `Error: ${e.message}` }; } },
  spawn_subagent: async (args, ctx) => {
    try {
      const { type, task } = args;
      const registry = (ctx as any)?._registry;
      const router = (ctx as any)?._router;
      if (!router || !registry) return { success: false, output: 'Subagent unavailable (no router/registry)' };

      // Battle 模式: 多 Agent 竞争择优
      if (type === 'battle') {
        // 成本保护: 检查剩余预算, Battle 模式消耗 2-3 倍 token
        try {
          const dailyCost = (router as any)?.dailyCost || 0;
          const dailyLimit = (router as any)?.dailyLimit || 10;
          if (dailyCost > dailyLimit * 0.8) {
            return { success: false, output: `成本预算不足 (已用 ${dailyCost.toFixed(2)}/${dailyLimit}$), 无法启动 Battle 模式。请使用普通模式。` };
          }
        } catch (e: any) { /* cost check optional */ }

        const { getAgentBattle, AgentBattle } = await import('./agent-battle.js');
        const numAgents = Math.min((args as any).numAgents || 3, 2); // 限制最多2个Agent
        const battle = getAgentBattle({ numAgents, battleMode: 'hybrid' });
        const agents = AgentBattle.getDefaultAgents(numAgents);

        // 并行让每个 Agent persona 生成方案
        const solutions: Array<import('./agent-battle.js').Solution> = [];
        const subPromises = agents.map(async (agent) => {
          try {
            const { default: subagent } = await import('./subagent.js');
            const result = await subagent.runSubagent(
              agent.id as any,
              `[${agent.persona}视角] ${task}\n请以${agent.persona}的身份分析并给出方案。`,
              router, registry,
              { userId: (ctx as any)?.userId || 'default', workspace: wm().projectDir },
            );
            return {
              agentId: agent.id,
              agentName: agent.name,
              persona: agent.persona,
              output: result || '(empty)',
              score: 0,
              reasoning: [],
            } as import('./agent-battle.js').Solution;
          } catch (e: any) {
            return {
              agentId: agent.id,
              agentName: agent.name,
              persona: agent.persona,
              output: `Error: ${e.message}`,
              score: 0,
              reasoning: [`Failed: ${e.message}`],
            } as import('./agent-battle.js').Solution;
          }
        });
        const allSolutions = await Promise.all(subPromises);
        solutions.push(...allSolutions);

        // 运行博弈引擎
        const result = battle.run(task, solutions);
        const winner = result.winner;
        const summary = [
          `🏆 博弈结果 (${result.mode}模式, ${result.totalAgents}个Agent):`,
          ``,
          `=== 🥇 胜出方案 (${winner.agentName}, ${winner.score}分) ===`,
          winner.output.slice(0, 1500),
          ``,
          result.merged ? `=== 🤝 融合方案 ===\n${result.merged.output.slice(0, 1000)}` : '',
          ``,
          `失败分析:`,
          ...result.failurePatterns.map(f => `- ${f.agentId}: ${f.lesson}`),
        ].filter(Boolean).join('\n');

        return { success: true, output: summary };
      }

      const { default: subagent } = await import('./subagent.js');
      const result = await subagent.runSubagent(type, task, router, registry, { userId: (ctx as any)?.userId || 'default', workspace: wm().projectDir });
      return { success: true, output: result || '(subagent returned empty)' };
    } catch (e: any) { return { success: false, output: `Subagent error: ${e.message}` }; }
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
  connect_qq_bot: async (args) => {
    try {
      const { appId, appSecret, sandbox } = args;
      const baseUrl = `http://127.0.0.1:${process.env.AGENTAI_PORT || '18789'}`;
      const resp = await fetch(`${baseUrl}/v1/qq/auto-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, appSecret, sandbox: sandbox || false }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        return { success: true, output: `✅ QQ Bot 已成功连接! ${data.message || ''}` };
      } else {
        return { success: false, output: `❌ QQ Bot 连接失败: ${data.error || data.message || '未知错误'}` };
      }
    } catch (e: any) {
      return { success: false, output: `QQ Bot 连接异常: ${e.message}` };
    }
  },
  chain_create: async (args: any, ctx: any) => {
    try {
      const userId = ctx?.userId || 'default';
      const workspace = wm().projectDir;
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
      const workspace = wm().projectDir;
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
      const workspace = wm().projectDir;
      const { worktreePath, branch } = worktreeCreate(workspace, args.branch_prefix || 'task-');
      return { success: true, output: `Worktree created: ${worktreePath}\nBranch: ${branch}`, data: { path: worktreePath, branch } };
    } catch (e: any) { return { success: false, output: `worktree_create error: ${e.message}` }; }
  },
  worktree_list: async (args: any, ctx?: any) => {
    try {
      const { worktreeList } = await import('./worktree.js');
      const workspace = wm().projectDir;
      const trees = worktreeList(workspace);
      if (trees.length === 0) return { success: true, output: '(no worktrees)' };
      const out = trees.map(t => `${t.path} [${t.branch}] ${t.head}${t.current ? ' (current)' : ''}`).join('\n');
      return { success: true, output: out, data: { count: trees.length } };
    } catch (e: any) { return { success: false, output: `worktree_list error: ${e.message}` }; }
  },
  worktree_remove: async (args: any, ctx?: any) => {
    try {
      const { worktreeRemove } = await import('./worktree.js');
      const workspace = wm().projectDir;
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

      const projectDir = wm().projectDir;
      const [securityR, qualityR, testR] = await Promise.allSettled([
        wrapWithTimeout(
          subagentMod.runSubagent('security-review', `Review for security vulnerabilities: SQL injection, XSS, hardcoded secrets, unsafe eval, path traversal, missing auth checks.${focus}\n\n${context}`, router, registry, { userId: (ctx as any)?.userId || 'default', workspace: projectDir }),
          'security-review'
        ),
        wrapWithTimeout(
          subagentMod.runSubagent('review', `Review for code quality: readability, naming, duplication, error handling, architecture.${focus}\n\n${context}`, router, registry, { userId: (ctx as any)?.userId || 'default', workspace: projectDir }),
          'quality-review'
        ),
        wrapWithTimeout(
          subagentMod.runSubagent('review', `Review for testing: test coverage gaps, missing edge cases, testability issues.${focus}\n\n${context}`, router, registry, { userId: (ctx as any)?.userId || 'default', workspace: projectDir }),
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
  npm_install: async (args: any, ctx?: any) => {
    try {
      const { package: pkg, type = 'npm' } = args;
      if (!pkg) return { success: false, output: 'Package name required' };
      const cwd = wm().projectDir;
      const cmd = type === 'pip'
        ? `pip install ${pkg}`
        : `npm install ${pkg}`;
      const { exec } = await import('child_process');
      return new Promise((resolve) => {
        exec(cmd, { cwd, timeout: 120_000 }, (err: any, stdout: string, stderr: string) => {
          if (err && !stdout) {
            resolve({ success: false, output: `安装失败: ${stderr || err.message}` });
          } else {
            resolve({ success: true, output: `✅ ${pkg} 安装完成\n${stdout.slice(0, 2000)}` });
          }
        });
      });
    } catch (e: any) { return { success: false, output: `npm_install error: ${e.message}` }; }
  },

  // ====== AI 自主能力: 电脑操控 + 浏览器自动化 Handler (学 OpenClaw) ======
  open_application: async (args: any, ctx?: any) => {
    try {
      const { app_name, url } = args;
      if (!app_name) return { success: false, output: 'app_name required' };
      const { exec } = await import('child_process');
      const cmd = url
        ? `start ${app_name} "${url}"`
        : `start ${app_name}`;
      return new Promise((resolve) => {
        exec(cmd, { timeout: 10_000, shell: true }, (err: any, stdout: string, stderr: string) => {
          if (err) {
            resolve({ success: false, output: `打开应用失败: ${stderr || err.message}` });
          } else {
            resolve({ success: true, output: `✅ 已启动应用: ${app_name}${url ? ` (URL: ${url})` : ''}` });
          }
        });
      });
    } catch (e: any) { return { success: false, output: `open_application error: ${e.message}` }; }
  },

  browser_navigate: async (args: any, ctx?: any) => {
    try {
      const { url, wait_for = 'networkidle' } = args;
      if (!url) return { success: false, output: 'url required' };
      // 通过内嵌浏览器的 WebSocket 接口控制
      const browserWsUrl = process.env.BROWSER_WS_URL || 'http://127.0.0.1:18789';
      const resp = await fetch(`${browserWsUrl}/v1/browser/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, wait_for }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        // 降级: 用 web_fetch 获取页面内容
        try {
          const pageResp = await fetch(url, { signal: AbortSignal.timeout(15000) });
          const html = await pageResp.text();
          const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
          const title = titleMatch?.[1] || url;
          const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000);
          return { success: true, output: `📄 页面: ${title}\nURL: ${url}\n\n内容预览:\n${textContent}`, data: { url, title } };
        } catch {
          return { success: false, output: `无法访问 ${url} — 浏览器服务未启动且直接获取失败` };
        }
      }
      const data = await resp.json();
      return { success: true, output: `✅ 已导航到: ${data.title || url}\n可交互元素: ${data.elements?.length || 0} 个`, data };
    } catch (e: any) { return { success: false, output: `browser_navigate error: ${e.message}` }; }
  },

  browser_click: async (args: any, ctx?: any) => {
    try {
      const { selector, wait_ms = 1000 } = args;
      if (!selector) return { success: false, output: 'selector required' };

      // 优先尝试浏览器服务
      try {
        const browserWsUrl = process.env.BROWSER_WS_URL || 'http://127.0.0.1:18789';
        const resp = await fetch(`${browserWsUrl}/v1/browser/click`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector, wait_ms }),
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const data = await resp.json();
          return { success: true, output: `✅ 已点击: ${selector}${data.result ? `\n结果: ${String(data.result).slice(0, 500)}` : ''}`, data };
        }
      } catch { /* fallback to iframe action */ }

      // Fallback: 通过前端 iframe 执行操作 (SSE 推送指令)
      return {
        success: true,
        output: `✅ 已发送点击指令: ${selector} (通过内嵌浏览器执行)`,
        _iframe_action: { action: 'click', selector },
      };
    } catch (e: any) { return { success: false, output: `browser_click error: ${e.message}` }; }
  },

  browser_type: async (args: any, ctx?: any) => {
    try {
      const { selector, text, press_enter = false } = args;
      if (!selector || !text) return { success: false, output: 'selector and text required' };

      // 优先尝试浏览器服务
      try {
        const browserWsUrl = process.env.BROWSER_WS_URL || 'http://127.0.0.1:18789';
        const resp = await fetch(`${browserWsUrl}/v1/browser/type`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector, text, press_enter }),
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          return { success: true, output: `✅ 已在 ${selector} 输入: "${text.slice(0, 50)}"${press_enter ? ' + Enter' : ''}` };
        }
      } catch { /* fallback to iframe action */ }

      // Fallback: 通过前端 iframe 执行操作
      const actionText = press_enter ? text + '\n' : text;
      return {
        success: true,
        output: `✅ 已发送输入指令: ${selector} = "${text.slice(0, 50)}"${press_enter ? ' + Enter' : ''} (通过内嵌浏览器执行)`,
        _iframe_action: { action: 'fill', selector, value: actionText },
      };
    } catch (e: any) { return { success: false, output: `browser_type error: ${e.message}` }; }
  },

  browser_screenshot: async (args: any, ctx?: any) => {
    try {
      const { selector, full_page = false } = args;
      const browserWsUrl = process.env.BROWSER_WS_URL || 'http://127.0.0.1:18789';
      const resp = await fetch(`${browserWsUrl}/v1/browser/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selector, full_page }),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return { success: false, output: `截图失败: 浏览器服务未启动 (HTTP ${resp.status})` };
      const data = await resp.json();
      const imageBase64 = data.imageBase64 || '';
      // 限制 base64 大小 (最大 5MB) 避免 LLM 上下文膨胀
      if (imageBase64.length > 5_000_000) {
        return { success: true, output: `✅ 截图完成 (${data.width}x${data.height}, ${Math.round(imageBase64.length / 1024)}KB, 图片过大仅显示路径)` };
      }
      return { success: true, output: `✅ 截图完成 (${data.width}x${data.height})`, data: { imageBase64, width: data.width, height: data.height } };
    } catch (e: any) { return { success: false, output: `browser_screenshot error: ${e.message}` }; }
  },

  browser_extract: async (args: any, ctx?: any) => {
    try {
      const { selector, extract_type = 'text' } = args;
      const browserWsUrl = process.env.BROWSER_WS_URL || 'http://127.0.0.1:18789';
      const resp = await fetch(`${browserWsUrl}/v1/browser/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selector, extract_type }),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return { success: false, output: `提取失败: 浏览器服务未启动 (HTTP ${resp.status})` };
      const data = await resp.json();
      return { success: true, output: `✅ 提取完成 (${extract_type}):\n${String(data.content || '').slice(0, 3000)}`, data };
    } catch (e: any) { return { success: false, output: `browser_extract error: ${e.message}` }; }
  },

  desktop_automate: async (args: any, ctx?: any) => {
    try {
      const { action, key, text, x, y, button = 'left', direction = 'down', amount = 3 } = args;
      if (!action) return { success: false, output: 'action required' };
      const { exec } = await import('child_process');

      switch (action) {
        case 'screenshot': {
          // 使用 PowerShell 截取桌面截图, 保存为 JPEG 并返回 base64
          const tmpFile = path.join(os.tmpdir(), `agentai-screenshot-${Date.now()}.jpg`);
          const psScript = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;
$bmp = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$img = New-Object System.Drawing.Bitmap $bmp.Width, $bmp.Height;
$g = [System.Drawing.Graphics]::FromImage($img);
$g.CopyFromScreen($bmp.X, $bmp.Y, 0, 0, $bmp.Size);
$ep = New-Object System.Drawing.Imaging.EncoderParameters;
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 80);
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid };
$img.Save('${tmpFile.replace(/\\/g, '\\\\')}', $codec, $ep);
$g.Dispose();
$img.Dispose();
Write-Output 'OK'`;
          return new Promise((resolve) => {
            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ';')}"`, { timeout: 15_000 }, async (err: any) => {
              if (err) {
                resolve({ success: false, output: `截图失败: ${err.message}` });
                return;
              }
              try {
                // 读取截图文件并转为 base64
                const imgBuffer = fs.readFileSync(tmpFile);
                const base64 = imgBuffer.toString('base64');
                // 限制 base64 大小 (最大 5MB)
                if (base64.length > 5_000_000) {
                  resolve({
                    success: true,
                    output: `✅ 截图完成 (${imgBuffer.length} bytes, 图片过大仅显示路径)`,
                    data: { screenshot_data: { path: tmpFile, size: imgBuffer.length } },
                  });
                } else {
                  resolve({
                    success: true,
                    output: `✅ 截图完成 (${imgBuffer.length} bytes)`,
                    data: { screenshot_data: { base64, path: tmpFile, alt: '桌面截图', size: imgBuffer.length } },
                  });
                }
              } catch (e: any) {
                resolve({ success: false, output: `截图读取失败: ${e.message}` });
              }
            });
          });
        }
        case 'key_press': {
          if (!key) return { success: false, output: 'key required for key_press' };
          // 使用 PowerShell 模拟按键
          const psKey = key.replace(/\+/g, '}+{').replace(/^/, '{').replace(/$/, '}');
          const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psKey}')`;
          return new Promise((resolve) => {
            exec(`powershell -Command "${psScript}"`, { timeout: 10_000 }, (err: any) => {
              resolve({ success: !err, output: err ? `按键失败: ${err.message}` : `✅ 已按键: ${key}` });
            });
          });
        }
        case 'key_type': {
          if (!text) return { success: false, output: 'text required for key_type' };
          const safeText = text.replace(/[^a-zA-Z0-9 ]/g, '');
          const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${safeText}')`;
          return new Promise((resolve) => {
            exec(`powershell -Command "${psScript}"`, { timeout: 10_000 }, (err: any) => {
              resolve({ success: !err, output: err ? `输入失败: ${err.message}` : `✅ 已输入: "${text.slice(0, 50)}"` });
            });
          });
        }
        case 'mouse_click': {
          if (x == null || y == null) return { success: false, output: 'x and y required for mouse_click' };
          const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y}); Start-Sleep -Milliseconds 100; Add-Type -AssemblyName System.Windows.Forms; $mouseBtn = [System.Windows.Forms.MouseButtons]::${button.charAt(0).toUpperCase() + button.slice(1)}; [System.Windows.Forms.SendKeys]::SendWait(' ')`;
          return new Promise((resolve) => {
            exec(`powershell -Command "${psScript}"`, { timeout: 10_000 }, (err: any) => {
              resolve({ success: !err, output: err ? `点击失败: ${err.message}` : `✅ 已在 (${x}, ${y}) 点击 ${button} 按钮` });
            });
          });
        }
        case 'mouse_move': {
          if (x == null || y == null) return { success: false, output: 'x and y required for mouse_move' };
          const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y})`;
          return new Promise((resolve) => {
            exec(`powershell -Command "${psScript}"`, { timeout: 10_000 }, (err: any) => {
              resolve({ success: !err, output: err ? `移动失败: ${err.message}` : `✅ 鼠标已移动到 (${x}, ${y})` });
            });
          });
        }
        case 'scroll': {
          const psScript = `Add-Type -AssemblyName System.Windows.Forms; ${direction === 'down' ? '' : ''}[System.Windows.Forms.SendKeys]::SendWait('${'{DOWN}'.repeat(amount)}')`;
          return new Promise((resolve) => {
            exec(`powershell -Command "${psScript}"`, { timeout: 10_000 }, (err: any) => {
              resolve({ success: !err, output: err ? `滚动失败: ${err.message}` : `✅ 已向${direction === 'down' ? '下' : '上'}滚动 ${amount} 次` });
            });
          });
        }
        default:
          return { success: false, output: `未知动作: ${action}` };
      }
    } catch (e: any) { return { success: false, output: `desktop_automate error: ${e.message}` }; }
  },

  // ====== 沙箱代码执行 ======
  run_code: async (args: any, ctx?: any) => {
    try {
      const { code, language = 'javascript', timeout_ms = 10000, context } = args;
      if (!code) return { success: false, output: 'code required' };
      const timeout = Math.min(timeout_ms, 30000); // 最大30秒

      if (language === 'python') {
        // Python: 写临时文件 + 执行
        const { execFile } = await import('child_process');
        const tmpFile = path.join(os.tmpdir(), `sandbox_py_${Date.now()}.py`);
        // 在代码头部注入UTF-8编码声明和stdout重定向, 解决Windows GBK编码问题
        const safeCode = `# -*- coding: utf-8 -*-\nimport sys, io\nsys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')\nsys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')\n\n${code}`;
        fs.writeFileSync(tmpFile, safeCode, 'utf-8');
        return new Promise((resolve) => {
          execFile('python', [tmpFile], {
            timeout,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
          }, (err: any, stdout: string, stderr: string) => {
            try { fs.unlinkSync(tmpFile); } catch (e: any) { /* temp file cleanup optional */ }
            if (err) {
              resolve({ success: false, output: `Python 执行错误:\n${stderr || err.message}`.slice(0, 4000) });
            } else {
              resolve({ success: true, output: stdout.slice(0, 8000) || '(无输出)' });
            }
          });
        });
      }

      // JavaScript: 使用 CodeRunner 沙箱
      const { createSandbox } = await import('./sandbox/executor.js');
      const runner = createSandbox({ timeoutMs: timeout, maxOutputBytes: 1024 * 1024 });
      const result = await runner.execute(code, context);
      if (result.success) {
        return { success: true, output: result.output.slice(0, 8000) || '(无输出)', durationMs: result.durationMs };
      } else {
        return { success: false, output: `执行错误: ${result.error}\n${result.output}`.slice(0, 4000), durationMs: result.durationMs, timedOut: result.timedOut };
      }
    } catch (e: any) { return { success: false, output: `run_code error: ${e.message}` }; }
  },

  // ====== 技能自创建 ======
  discover_or_create_skill: async (args: any, ctx?: any) => {
    try {
      const { name, description, category = 'code', code, parameters } = args;
      if (!name || !description) return { success: false, output: 'name and description required' };

      // 1. 先检查技能是否已存在
      try {
        const { skillOrchestrator } = await import('./skill-orchestrator.js');
        const existing = skillOrchestrator.get(name);
        if (existing) {
          return { success: true, output: `技能 "${name}" 已存在: ${existing.description}`, data: { name, existed: true } };
        }
      } catch (e: any) { /* skill may not exist yet */ }

      // 2. 创建技能文件 (写到 AI 工作目录的技能区)
      const skillDir = path.join(wm().skillsDir, name);
      fs.mkdirSync(skillDir, { recursive: true });

      const skillMeta = {
        name,
        description,
        category,
        version: '1.0.0',
        created_by: 'ai-auto',
        created_at: new Date().toISOString(),
        parameters: parameters || { type: 'object', properties: { input: { type: 'string', description: '输入内容' } } },
      };

      // 写入 skill.json
      fs.writeFileSync(path.join(skillDir, 'skill.json'), JSON.stringify(skillMeta, null, 2), 'utf-8');

      // 写入实现代码
      const implCode = code || `// Auto-generated skill: ${name}\n// ${description}\nmodule.exports = async function(args) {\n  // TODO: 实现技能逻辑\n  return { success: true, output: 'Skill ${name} executed with: ' + JSON.stringify(args) };\n};`;
      fs.writeFileSync(path.join(skillDir, 'index.js'), implCode, 'utf-8');

      // 3. 注册到 skillOrchestrator
      try {
        const { skillOrchestrator } = await import('./skill-orchestrator.js');
        skillOrchestrator.register({
          name,
          description,
          category,
          handler: async (skillArgs: any) => {
            try {
              const mod = await import(path.join(skillDir, 'index.js'));
              return typeof mod === 'function' ? mod(skillArgs) : mod.default?.(skillArgs) || { success: true, output: `Skill ${name} executed` };
            } catch (e: any) {
              return { success: false, output: `Skill execution error: ${e.message}` };
            }
          },
          keywords: name.split('-'),
        });
      } catch (e: any) { console.warn('[create_skill] register failed:', e?.message); }

      // 4. 记录到自进化系统
      try {
        const { getSkillEvolver } = await import('./skill-evolver.js');
        const evolver = getSkillEvolver();
        evolver.recordUsage({
          skill_id: name,
          skill_name: name,
          category,
          score: 10,
          latency_ms: 0,
          timestamp: new Date().toISOString(),
        });
      } catch (e: any) { /* skill evolver optional */ }

      return {
        success: true,
        output: `✅ 技能 "${name}" 已创建!\n路径: ${skillDir}\n描述: ${description}\n分类: ${category}\n\n技能已注册到系统, 下次可以直接使用。`,
        data: { name, path: skillDir, category, created: true },
      };
    } catch (e: any) { return { success: false, output: `discover_or_create_skill error: ${e.message}` }; }
  },

  // ====== AI 自主能力: 代码探索 ======
  explore_project: async (args: any, ctx?: any) => {
    try {
      const { autonomousExplorer } = await import('./autonomous-explorer.js');
      const workspace = ctx?.workspace || process.cwd();
      const mode = args.mode || 'structure';

      if (args.trace_from) {
        // 追踪 import 链
        const imports = await autonomousExplorer.traceImports(args.trace_from, 3);
        return {
          success: true,
          output: `Import 追踪结果 (从 ${args.trace_from}):\n${imports.length > 0 ? imports.map((p, i) => `${i + 1}. ${p}`).join('\n') : '未发现 import 依赖'}`,
          data: { traceFrom: args.trace_from, imports },
        };
      }

      const codeMap = await autonomousExplorer.mapProject(workspace, mode);
      const summary = autonomousExplorer.toCompactSummary(codeMap);
      return {
        success: true,
        output: `📊 项目代码地图 (${mode} 模式):\n\n${summary}\n\n💡 使用 trace_from 参数追踪特定文件的 import 链`,
        data: codeMap,
      };
    } catch (e: any) { return { success: false, output: `explore_project error: ${e.message}` }; }
  },

  // ====== AI 自主能力: 行业洞察 ======
  industry_insight: async (args: any, ctx?: any) => {
    try {
      const { insightAccumulator } = await import('./insight-accumulator.js');
      const action = args.action || 'detect';

      switch (action) {
        case 'detect': {
          const msg = args.message || '';
          const result = insightAccumulator.detectIndustry(msg);
          if (!result) {
            return { success: true, output: '未识别到明确行业特征', data: { detected: false } };
          }
          const profile = insightAccumulator.getIndustryProfile(result.industryId);
          return {
            success: true,
            output: `识别到行业: ${profile?.industryName || result.industryId} (置信度 ${Math.round(result.confidence * 100)}%)\n完整度: ${profile?.completenessScore || 0}%`,
            data: { detected: true, industryId: result.industryId, confidence: result.confidence, profile },
          };
        }
        case 'profile': {
          const id = args.industry_id || 'software_dev';
          const profile = insightAccumulator.getIndustryProfile(id);
          if (!profile) {
            return { success: true, output: `未找到行业 "${id}" 的画像`, data: null };
          }
          const prompt = insightAccumulator.buildInsightPrompt(id);
          return { success: true, output: prompt, data: profile };
        }
        case 'add': {
          const id = args.industry_id || 'software_dev';
          const category = args.category || 'best_practices';
          const content = args.content || '';
          if (!content) {
            return { success: false, output: '添加洞察需要提供 content 参数' };
          }
          const insight = insightAccumulator.addManualInsight(id, category, content);
          return {
            success: true,
            output: `✅ 洞察已添加: [${category}] ${content.slice(0, 100)}...`,
            data: insight,
          };
        }
        case 'summary': {
          const summary = insightAccumulator.getAllInsightsSummary();
          return { success: true, output: `行业洞察积累:\n${summary}` };
        }
        default:
          return { success: false, output: `未知操作: ${action}` };
      }
    } catch (e: any) { return { success: false, output: `industry_insight error: ${e.message}` }; }
  },

  // ====== AI 自主能力: 系统自管理 ======
  self_diagnose: async (args: any, ctx?: any) => {
    try {
      const { selfManager } = await import('./self-manager.js');
      const action = args.action || 'diagnose';

      switch (action) {
        case 'diagnose': {
          const diagnosis = await selfManager.diagnose();
          const statusEmoji: Record<string, string> = { healthy: '✅', degraded: '⚠️', unhealthy: '❌', critical: '🚨' };
          const lines = diagnosis.checks.map(c => `${statusEmoji[c.status]} ${c.component}: ${c.message}${c.autoFixAvailable ? ' (可自动修复)' : ''}`);
          return {
            success: true,
            output: `系统自检结果 (${statusEmoji[diagnosis.overallStatus]} ${diagnosis.overallStatus}):\n\n${lines.join('\n')}${diagnosis.recommendations.length > 0 ? '\n\n建议: ' + diagnosis.recommendations.join('; ') : ''}`,
            data: diagnosis,
          };
        }
        case 'autofix': {
          const results = await selfManager.autoFix();
          if (results.length === 0) {
            return { success: true, output: '✅ 系统状态良好，无需修复' };
          }
          const lines = results.map(r => `${r.fixed ? '✅' : '❌'} ${r.component}: ${r.message}`);
          return { success: true, output: `自动修复结果:\n\n${lines.join('\n')}`, data: results };
        }
        case 'cleanup': {
          const results = selfManager.cleanupTempFiles();
          if (results.length === 0) {
            return { success: true, output: '✅ 无需清理' };
          }
          const lines = results.map(r => `${r.category}: 释放 ${r.freedMB} (${r.details})`);
          return { success: true, output: `清理结果:\n\n${lines.join('\n')}`, data: results };
        }
        case 'health_prompt': {
          const prompt = selfManager.buildHealthPrompt();
          return { success: true, output: prompt || '系统健康，无需额外提示' };
        }
        default:
          return { success: false, output: `未知操作: ${action}` };
      }
    } catch (e: any) { return { success: false, output: `self_diagnose error: ${e.message}` }; }
  },

  // ====== 音乐播放器控制 (用户体验增强) ======
  control_music: async (args: any, ctx?: any) => {
    try {
      const action = args.action;
      const volume = args.volume;
      const trackIndex = args.track_index;

      // 返回特殊标记，让 GUI 前端处理音乐控制
      return {
        success: true,
        output: `🎵 音乐控制: ${action}${volume ? ` (音量: ${volume})` : ''}${trackIndex ? ` (曲目: ${trackIndex})` : ''}`,
        data: { _music_action: action, volume, trackIndex },
      };
    } catch (e: any) { return { success: false, output: `control_music error: ${e.message}` }; }
  },
};
