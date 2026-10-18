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
import { getWorkspaceAllowedRoots } from '../workspace-manager.js';
import { getAppTempDir } from '../attachment-store.js';

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

/**
 * 允许根目录 — 2026-10-17 批 2-B: 单一实现已搬至 workspace-manager
 * (getWorkspaceAllowedRoots, 并集语义)。此处保留导出名与签名兼容现有调用方。
 *
 * ⚠️ 原实现的坑 (已随搬迁修复): 用 `require('os').homedir()` 取 home 根 —
 *    ESM 运行时 (tsx / tsc 产物) require 未定义 → ReferenceError 被 catch 吞 →
 *    home 根**从未生效**, 截图存桌面等场景被误拦。
 *
 * ⚠️ 2026-10-19 P0 补充: os.tmpdir() **不一定**在白名单里 (实机 TEMP=F:\temp,
 *    不在 cwd/projectDir/home 任何一个根之下)。而截图(capture_screen)和
 *    上传附件(attachment-store)都落 tmpdir → AI 拿这些路径调 read_file/ocr_image
 *    全部被 "Path not allowed" 拒。故此处单独授予网关自有的临时子目录
 *    (窄授权: 只放行 <tmpdir>/agentai-uploads, 不放开整个 tmpdir)。
 */
export function getAllowedRoots(): string[] {
  const roots = getWorkspaceAllowedRoots();
  try {
    const appTemp = getAppTempDir();
    if (appTemp) roots.push(path.resolve(appTemp));
  } catch { /* attachment-store 不可用时退回原行为 */ }
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
