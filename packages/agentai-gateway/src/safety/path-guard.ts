/**
 * path-guard: 路径白名单校验
 * ----------------------------------------------------
 * 用途: 防止 /v1/fs/list 任意目录浏览攻击
 * 默认白名单: cwd + AGENTAI_WORKSPACE
 * 自定义: AGENTAI_FS_ALLOWED_ROOTS=路径1,路径2
 *
 * 安全守护:
 *  - 默认行为兼容（cwd 永远在白名单）
 *  - Windows 系统目录自动拒绝
 *  - 路径必须已存在或可解析
 */
import * as path from 'path';

const FORBIDDEN_PATTERNS = [
  /[\\/]Windows[\\/]System32/i,
  /[\\/]Windows[\\/]SysWOW64/i,
  /[\\/]Program Files[\\/]/i,
  /[\\/]Program Files \(x86\)[\\/]/i,
  /[\\/]ProgramData[\\/]/i,
  /[\\/]System Volume Information[\\/]/i,
  /[\\/]\$Recycle\.Bin[\\/]/i,
  /[\\/]\.git[\\/]/,
];

export function getAllowedRoots(): string[] {
  const roots: string[] = [process.cwd()];
  if (process.env.AGENTAI_WORKSPACE) {
    roots.push(path.resolve(process.env.AGENTAI_WORKSPACE));
  }
  if (process.env.AGENTAI_FS_ALLOWED_ROOTS) {
    for (const r of process.env.AGENTAI_FS_ALLOWED_ROOTS.split(',').map(s => s.trim())) {
      if (r) roots.push(path.resolve(r));
    }
  }
  // 额外允许: 用户主目录 (目录树浏览/工作区选择用)
  try {
    const home = process.env.USERPROFILE || process.env.HOME || require('os').homedir();
    if (home) roots.push(path.resolve(home));
  } catch {}
  return roots;
}

export function isPathAllowed(target: string): boolean {
  if (!target) return false;
  let resolved: string;
  try {
    resolved = path.resolve(target);
  } catch {
    return false;
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(resolved)) return false;
  }
  const roots = getAllowedRoots();
  return roots.some(root => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}
