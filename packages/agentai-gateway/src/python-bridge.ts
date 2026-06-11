import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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
  const tmpFile = path.join(process.cwd(), `.py_args_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`);
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(args), 'utf-8');
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
