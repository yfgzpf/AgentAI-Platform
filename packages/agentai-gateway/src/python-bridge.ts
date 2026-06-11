import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

function findPython(): string {
  const candidates = ['python3', 'python', 'py'];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      return cmd;
    } catch {}
  }
  return 'python3';
}

const PYTHON = findPython();
const SKILLS_BASE = path.resolve('packages', 'agentai-skills');

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

export async function callPython(mainPy: string, args: Record<string, any>): Promise<{ success: boolean; output: string; data?: any }> {
  // 安全临时文件: 使用 crypto 随机名 + 存放系统临时目录，防止竞态读取
  const tmpDir = path.join(os.tmpdir(), 'agentai-py');
  fs.mkdirSync(tmpDir, { recursive: true });
  const randName = crypto.randomBytes(8).toString('hex');
  const tmpFile = path.join(tmpDir, `args_${randName}.json`);
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(args), { encoding: 'utf-8', flag: 'wx' });
    const result = execSync(`${PYTHON} "${mainPy}" --args-file "${tmpFile}"`, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
    try {
      return JSON.parse(result);
    } catch {
      return { success: true, output: result };
    }
  } catch (e: any) {
    return { success: false, output: `Python error: ${e.message || e}` };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}
