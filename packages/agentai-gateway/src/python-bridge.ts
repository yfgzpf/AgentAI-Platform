import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/**
 * 生成常见 Python 安装路径候选（优先用户级 → 系统级 → 版本降序）
 *  ⚠️ 不要硬编码只列 C:\PythonXXX, 80% 的用户是用 py launcher 或
 *  %LOCALAPPDATA%\Programs\Python\Python3XX 安装的 (默认选项), 原列表会漏掉他们。
 */
function buildPythonCandidates(): string[] {
  const list: string[] = [];
  const versions = ['314', '313', '312', '311', '310'];
  const localAppData = process.env.LOCALAPPDATA || `${process.env.USERPROFILE || '~'}/AppData/Local`;
  const programFiles = process.env.PROGRAMFILES || 'C:/Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)';

  // ① 用户级安装（Python 官网默认安装路径, 绝大多数用户使用这个）
  for (const v of versions) list.push(`${localAppData}/Programs/Python/Python${v}/python.exe`);

  // ② C 盘根（老的 AllUsers 安装方式, 少数开发者）
  for (const v of versions) list.push(`C:/Python${v}/python.exe`);

  // ③ Program Files 级 (通过 MSI 安装时自定义)
  for (const v of versions.slice(0, 3)) {
    list.push(`${programFiles}/Python${v}/python.exe`);
    list.push(`${programFilesX86}/Python${v}/python.exe`);
  }

  // ④ Windows Store 版
  if (process.env.LOCALAPPDATA) {
    list.push(`${process.env.LOCALAPPDATA}/Microsoft/WindowsApps/python.exe`);
    list.push(`${process.env.LOCALAPPDATA}/Microsoft/WindowsApps/python3.exe`);
  }
  return list;
}

function findPython(): string {
  // 1. 优先使用内置 Python Embeddable (打包后放在 resources/python/)
  const possibleBundled = [
    path.resolve(process.cwd(), 'python', 'python.exe'),
    path.resolve(process.cwd(), '..', 'python', 'python.exe'),
    path.resolve(process.cwd(), 'resources', 'python', 'python.exe'),
  ];
  for (const p of possibleBundled) {
    try {
      if (fs.existsSync(p)) {
        execSync(`"${p}" --version`, { stdio: 'ignore' });
        return p;
      }
    } catch {}
  }
  // 2. 常见安装路径 (用户级 → 系统级 → 版本降序)
  for (const p of buildPythonCandidates()) {
    try {
      if (fs.existsSync(p)) return `"${p}"`;
    } catch {}
  }
  // 3. 系统 PATH
  const osName = process.platform;
  const candidates = osName === 'win32'
    ? ['py', 'python', 'python3']
    : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      return cmd;
    } catch {}
  }
  // 4. 兜底: Windows 用 py, Unix 用 python3
  return osName === 'win32' ? 'py' : 'python3';
}

const PYTHON = findPython();

/**
 * 计算 SKILLS_BASE（AgentAI SKILLS 技能集根目录）
 * ╔══════════════════════════════════════════════════════════════╗
 * ║ P0 分发修复: 打包后 monorepo 结构不存在, 不能靠 ../../.. 反推║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║ 优先级:                                                       ║
 * ║   1. AGENTAI_SKILLS_DIR 环境变量 (手动覆盖)                  ║
 * ║   2. process.cwd()/../agentai-skills  (Tauri:                ║
 * ║      cwd=gateway-dist-v2, skills 被打到 resources/相邻目录)  ║
 * ║   3. AGENTAI_HOME (Rust lib.rs env: %APPDATA%/PulseFlow)    ║
 * ║   4. 开发期 fallback: monorepo反推 + 项目路径 + workspace    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
function resolveSkillsBase(): string {
  // 1. 手动覆盖
  if (process.env.AGENTAI_SKILLS_DIR && fs.existsSync(process.env.AGENTAI_SKILLS_DIR)) {
    return process.env.AGENTAI_SKILLS_DIR;
  }

  // 2. 打包后 (Tauri resources) 典型布局:
  //    resources/
  //      gateway-dist-v2/   <- process.cwd() (gateway 启动目录)
  //      agentai-skills/    <- 这里
  const candidates = [
    path.resolve(process.cwd(), '..', 'agentai-skills'),       // Tauri standard
    path.resolve(process.cwd(), 'agentai-skills'),             // 直接放 cwd
  ];

  // 3. AGENTAI_HOME (%APPDATA%/PulseFlow/gateway -> siblings)
  if (process.env.AGENTAI_HOME) {
    candidates.push(path.resolve(process.env.AGENTAI_HOME, '..', 'agentai-skills'));
    candidates.push(path.resolve(process.env.AGENTAI_HOME, 'agentai-skills'));
  }

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)
          && fs.existsSync(path.join(p, 'README.md'))
          && fs.existsSync(path.join(p, 'scripts'))) {
        return p;
      }
    } catch {}
  }

  // 4. 开发期: dist/反推 monorepo 根 → packages/agentai-skills
  try {
    const distDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:\/)/, '$1'));
    const monorepoRoot = path.resolve(distDir, '..', '..', '..');
    const devPath = path.resolve(monorepoRoot, 'packages', 'agentai-skills');
    if (fs.existsSync(devPath)) return devPath;
  } catch {}

  // 5. workspace 配置 (主循环会注入): 最后兜底返回相对路径, 由上层校验
  return path.resolve(process.cwd(), '..', 'agentai-skills');
}

const SKILLS_BASE = resolveSkillsBase();
// 桥接器: 统一处理 --args-file / CLI flag 翻译, 老式 main.py 无需修改
const BRIDGE_PY = path.join(SKILLS_BASE, '_lib', '_bridge.py');

interface SkillInfo {
  name: string;
  dir: string;
  mainPy: string;
}

export function discoverSkills(): SkillInfo[] {
  const results: SkillInfo[] = [];
  if (!fs.existsSync(SKILLS_BASE)) return results;
  for (const cat of fs.readdirSync(SKILLS_BASE)) {
    const catPath = path.join(SKILLS_BASE, cat);
    if (!fs.statSync(catPath).isDirectory()) continue;
    // 一级: skills/web/browser-auto/main.py
    for (const entry of fs.readdirSync(catPath)) {
      const entryPath = path.join(catPath, entry);
      if (fs.statSync(entryPath).isDirectory()) {
        const mainPy = path.join(entryPath, 'main.py');
        if (fs.existsSync(mainPy)) {
          results.push({ name: entry, dir: entryPath, mainPy });
        }
        // 二级: skills/web/browser-auto/main.py
        for (const sub of fs.readdirSync(entryPath)) {
          const subPath = path.join(entryPath, sub);
          if (fs.statSync(subPath).isDirectory()) {
            const subMain = path.join(subPath, 'main.py');
            if (fs.existsSync(subMain)) results.push({ name: sub, dir: subPath, mainPy: subMain });
          }
        }
      }
    }
  }
  return results;
}

/**
 * 调用 Python 技能
 *
 * 协议 (使用 _bridge.py 桥接器):
 *   - python-bridge 把 args 写到临时 JSON 文件
 *   - 调用 _bridge.py --script <main.py> --args-file <json> --timeout <sec>
 *   - 桥接器自动剥离 --args-file, 转换为子脚本的 CLI flag
 *   - 老式 main.py (desktop-control 等) 不用改, 桥接器负责翻译
 *   - 新式 handler.py 可读环境变量 AGENTAI_ARGS_JSON 获取完整 args
 *   - 子脚本最后一行 ##RESULT## {json} 会被桥接器解析后透传
 *
 * 超时: 默认 60 秒, 可通过 options.timeoutMs 自定义
 */
export async function callPython(
  mainPy: string,
  args: Record<string, any>,
  options: { timeoutMs?: number; cwd?: string } = {},
): Promise<{ success: boolean; output: string; data?: any }> {
  // 将相对路径转为绝对路径: 如果是相对路径则基于 SKILLS_BASE 解析
  const absPath = path.isAbsolute(mainPy) ? mainPy : path.resolve(SKILLS_BASE, mainPy);
  const timeoutMs = options.timeoutMs ?? 60_000;
  const cwd = options.cwd || path.dirname(absPath);

  if (!fs.existsSync(absPath)) {
    return { success: false, output: `脚本不存在: ${absPath}` };
  }
  if (!fs.existsSync(BRIDGE_PY)) {
    return { success: false, output: `桥接器不存在: ${BRIDGE_PY}, 请确认 packages/agentai-skills/_lib/_bridge.py 已创建` };
  }

  // 写临时 args 文件
  const tmpDir = path.join(os.tmpdir(), 'agentai-py');
  fs.mkdirSync(tmpDir, { recursive: true });
  const randName = crypto.randomBytes(8).toString('hex');
  const tmpFile = path.join(tmpDir, `args_${randName}.json`);
  const timeoutSec = Math.max(1, Math.floor(timeoutMs / 1000));

  try {
    fs.writeFileSync(tmpFile, JSON.stringify(args), { encoding: 'utf-8', flag: 'wx' });
    const cmd = `${PYTHON} "${BRIDGE_PY}" --script "${absPath}" --args-file "${tmpFile}" --cwd "${cwd}" --timeout ${timeoutSec}`;
    // DEBUG: 打印调用信息到 .workbuddy (C:\Users\Administrator\Downloads 在白名单)
    try {
      const _dbg = path.join(os.homedir(), 'Downloads', 'py_bridge_debug.log');
      fs.appendFileSync(_dbg, `\n[${new Date().toISOString()}] PYTHON=${PYTHON}\ncmd=${cmd}\nargs=${JSON.stringify(args)}\n`, 'utf-8');
    } catch {}
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutMs + 10_000, // 桥接器自身多 10s
      maxBuffer: 10 * 1024 * 1024,
    });
    try {
      const _dbg = path.join(os.homedir(), 'Downloads', 'py_bridge_debug.log');
      fs.appendFileSync(_dbg, `stdout(last 500)=${stdout.slice(-500)}\n---\n`, 'utf-8');
    } catch {}

    // 桥接器输出最后一行 ##RESULT## {json}
    const lines = stdout.split('\n');
    let resultLine = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith('##RESULT##')) {
        resultLine = lines[i].replace(/^##RESULT##\s*/, '').trim();
        break;
      }
    }
    if (resultLine) {
      try {
        return JSON.parse(resultLine);
      } catch {
        return { success: true, output: resultLine };
      }
    }
    // 兜底: 整个 stdout
    try {
      return JSON.parse(stdout.trim());
    } catch {
      return { success: true, output: stdout.trim() };
    }
  } catch (e: any) {
    // execSync 报错时 stderr 包含在 e.message, 尝试提取 ##RESULT##
    const msg = String(e.message || e);
    const match = msg.match(/##RESULT##\s*({[\s\S]*})/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {/* fall through */}
    }
    return { success: false, output: `Python error: ${msg.slice(0, 2000)}` };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}
