/**
 * code-runner: AI 生成代码的沙箱执行器
 * ----------------------------------------------------
 * 用途: 替代 tools.ts:3298 的裸 import() 执行 AI 生成的技能
 * 防护: 1. 禁止危险 API (child_process, fs, eval, process.kill)
 *       2. 语法检查 (node --check)
 *       3. 超时控制
 *       4. 临时目录隔离
 */
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const FORBIDDEN_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, reason: 'child_process' },
  { pattern: /\bimport\s+[^;]*['"]child_process['"]/, reason: 'child_process import' },
  { pattern: /require\s*\(\s*['"]fs['"]\s*\)/, reason: 'fs' },
  { pattern: /\bimport\s+[^;]*['"]fs['"]/, reason: 'fs import' },
  { pattern: /\bprocess\s*\.\s*kill\b/, reason: 'process.kill' },
  { pattern: /\beval\s*\(/, reason: 'eval' },
  { pattern: /\bnew\s+Function\s*\(/, reason: 'new Function' },
];

// Python 危险模式 (code-runner 用)
const PY_FORBIDDEN_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bimport\s+(os|subprocess|shutil|socket|ctypes)\b/, reason: 'dangerous module' },
  { pattern: /\bfrom\s+(os|subprocess|shutil|socket|ctypes)\s+import/, reason: 'dangerous module import' },
  { pattern: /\bos\.system\s*\(/, reason: 'os.system' },
  { pattern: /\bsubprocess\.(call|Popen|run|check_call|check_output)/, reason: 'subprocess' },
  { pattern: /\bshutil\.(rmtree|move)\s*\(/, reason: 'shutil file ops' },
  { pattern: /\bopen\s*\([^)]*['"]w['"]/, reason: 'file write' },
  { pattern: /\beval\s*\(/, reason: 'eval' },
  { pattern: /\bexec\s*\(/, reason: 'exec' },
  { pattern: /\b__import__\s*\(/, reason: '__import__' },
  { pattern: /\bpickle\.(load|loads)\s*\(/, reason: 'pickle deserialize' },
];

export interface CodeRunnerOptions {
  timeoutMs?: number;
  args?: any;
}

export interface CodeRunnerResult {
  ok: boolean;
  output?: any;
  error?: string;
}

/** 自动检测脚本类型 */
function detectScriptType(scriptPath: string): 'js' | 'py' {
  return scriptPath.endsWith('.py') ? 'py' : 'js';
}

/** 查找 Python 可执行文件（优先用户级安装路径） */
function findPython(): string {
  const versions = ['314', '313', '312', '311', '310'];
  const localAppData = process.env.LOCALAPPDATA || `${process.env.USERPROFILE || '~'}/AppData/Local`;
  const common: string[] = [];
  for (const v of versions) common.push(`${localAppData}/Programs/Python/Python${v}/python.exe`);
  for (const v of versions) common.push(`C:/Python${v}/python.exe`);
  for (const v of versions.slice(0, 3)) common.push(`${process.env.PROGRAMFILES || 'C:/Program Files'}/Python${v}/python.exe`);
  for (const p of common) {
    try { if (fs.existsSync(p)) return `"${p}"`; } catch {}
  }
  return process.platform === 'win32' ? 'py' : 'python3';
}

/** 静态检查：扫描危险模式 */
export function scanForbiddenPatterns(content: string, type?: 'js' | 'py'): { ok: true } | { ok: false; reason: string } {
  const patterns = type === 'py' ? PY_FORBIDDEN_PATTERNS : FORBIDDEN_PATTERNS;
  for (const { pattern, reason } of patterns) {
    if (pattern.test(content)) {
      return { ok: false, reason: `Forbidden: ${reason}` };
    }
  }
  return { ok: true };
}

/** 语法检查：node --check / python -m py_compile */
export function syntaxCheck(scriptPath: string): { ok: true } | { ok: false; error: string } {
  const type = detectScriptType(scriptPath);
  try {
    if (type === 'py') {
      const py = findPython();
      execSync(`"${py.replace(/"/g, '')}" -m py_compile "${scriptPath}"`, { encoding: 'utf-8', timeout: 10000 });
    } else {
      execSync(`node --check "${scriptPath}"`, { encoding: 'utf-8', timeout: 5000 });
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 沙箱执行 AI 生成的技能 (自动检测 JS/Python) */
export function runSandboxedSkill(
  scriptPath: string,
  opts: CodeRunnerOptions = {}
): CodeRunnerResult {
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `Script not found: ${scriptPath}` };
  }
  const content = fs.readFileSync(scriptPath, 'utf-8');
  const type = detectScriptType(scriptPath);
  // 1. 静态扫描 (按语言选择规则)
  const scan = scanForbiddenPatterns(content, type);
  if (!scan.ok) {
    return { ok: false, error: scan.reason };
  }
  // 2. 语法检查
  const check = syntaxCheck(scriptPath);
  if (!check.ok) {
    return { ok: false, error: `Syntax check failed: ${check.error}` };
  }
  // 3. 在临时目录执行（隔离 + 超时）
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentai-skill-'));
  try {
    const runner = type === 'py'
      ? `cd "${tempDir}" && ${findPython()} "${scriptPath}"`
      : `cd "${tempDir}" && node "${scriptPath}"`;
    const output = execSync(runner, {
      encoding: 'utf-8',
      timeout: opts.timeoutMs || 30000,
      env: {
        ...process.env,
        NODE_ENV: 'sandbox',
        AGENTAI_AUTH_TOKEN: '',
        AGENTAI_FS_ALLOWED_ROOTS: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output };
  } catch (e: any) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}
