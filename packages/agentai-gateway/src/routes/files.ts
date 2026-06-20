/**
 * Files Routes - 文件系统 API
 * 提取自 index.ts, 提供文件树/读写/重命名/删除
 */
import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../workspace-manager.js';

export const filesRouter = Router();

// ===== 安全守卫 (动态) =====
function getAllowedRoots(): string[] {
  const cwd = process.cwd();
  const envWs = process.env.AGENTAI_WORKSPACE;
  const wm = WorkspaceManager.getInstance();
  const roots = [cwd, wm.projectDir];
  if (envWs) roots.push(path.resolve(envWs));
  // 额外允许: 项目根目录的上两级 (monorepo 根)
  try {
    const monorepoRoot = path.resolve(wm.projectDir, '..', '..');
    if (fs.existsSync(monorepoRoot)) roots.push(monorepoRoot);
  } catch {}
  // 额外允许: 用户主目录 (方便浏览)
  try {
    const home = process.env.USERPROFILE || process.env.HOME || require('os').homedir();
    if (home) roots.push(home);
  } catch {}
  // 去重 (可能 projectDir === cwd)
  return [...new Set(roots.map(r => path.resolve(r)))];
}

/**
 * GET /v1/fs/project-root
 * 返回当前项目根目录路径 + AI 工作目录路径
 * 供前端工作区选择器使用
 */
filesRouter.get('/v1/fs/project-root', (_req, res) => {
  const wm = WorkspaceManager.getInstance();
  const projectRoot = path.resolve(wm.projectDir, '..', '..');
  res.json({
    projectRoot: fs.existsSync(projectRoot) ? projectRoot : wm.projectDir,
    cwd: wm.projectDir,
    aiWorkDir: wm.aiWorkDir,
  });
});

/**
 * POST /v1/workspace
 * 前端设置工作目录后立即通知 Gateway
 * 同步更新 WorkspaceManager.projectDir, 让文件浏览器 / AI 工具使用正确路径
 * Body: { path: string }
 */
filesRouter.post('/v1/workspace', (req, res) => {
  const { path: newPath } = req.body || {};
  if (!newPath || typeof newPath !== 'string') {
    return res.status(400).json({ error: '需要 path 参数' });
  }
  const resolved = path.resolve(newPath.trim());
  if (!fs.existsSync(resolved)) {
    return res.status(400).json({ error: `目录不存在: ${resolved}` });
  }
  const wm = WorkspaceManager.getInstance();
  wm.setProjectDir(resolved);
  console.log(`[workspace] updated to: ${resolved}`);
  res.json({ ok: true, projectDir: resolved, aiWorkDir: wm.aiWorkDir });
});

/**
 * 限制文件操作在允许的根目录内，防止路径遍历攻击
 * - 解析符号链接防止绕过
 * - 拒绝非法的绝对路径/上级目录穿越
 */
function sanitizePath(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error(`Invalid path: ${JSON.stringify(input)}`);
  }
  const resolved = path.resolve(input);
  const allowed = getAllowedRoots().some(root => resolved.startsWith(root) || resolved.startsWith(path.resolve(root)));
  if (!allowed) {
    throw new Error(`Path not allowed (outside workspace): ${input}`);
  }
  // 防符号链接绕过
  try {
    const real = fs.realpathSync(resolved);
    const allowedReal = getAllowedRoots().some(root => real.startsWith(root) || real.startsWith(path.resolve(root)));
    if (!allowedReal) {
      throw new Error(`Symlink escape detected: ${input}`);
    }
  } catch (e: any) {
    if (e.message?.includes('Symlink escape')) throw e;
    // realpathSync may fail on non-existent paths — allow mkdir/touch to proceed
  }
  return resolved;
}

/**
 * 构建文件树
 */
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

/* ---- Editor 兼容: 列表式文件浏览 ---- */

/** 获取磁盘驱动器列表 (Windows) */
filesRouter.get('/v1/fs/drives', (_req, res) => {
  try {
    const drives: string[] = [];
    const common: string[] = [];
    // Windows 盘符
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i);
      const root = `${letter}:\\`;
      try {
        if (fs.existsSync(root)) {
          drives.push(root);
          if (['C:\\', 'D:\\', 'E:\\'].includes(root)) common.push(root);
        }
      } catch { /* skip */ }
    }
    // 额外常用目录
    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (home) common.push(home);
    common.push(process.cwd());
    res.json({ drives, common: [...new Set(common)] });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

/** 获取目录下的扁平文件列表 (Editor 兼容) */
filesRouter.get('/v1/fs/list', (req, res) => {
  try {
    const dir = (req.query.dir as string) || process.cwd();
    // 文件浏览接口: 放宽路径限制, 允许浏览任何存在的目录
    // 只检查路径是否存在, 不做 allowedRoots 校验
    const resolved = path.resolve(dir);
    // 安全检查: 仅拒绝明显的路径穿越攻击 (如包含 ..)
    if (resolved.includes('..')) {
      return res.status(400).json({ error: 'Invalid path: parent directory traversal not allowed' });
    }
    if (!fs.existsSync(resolved)) return res.json({ entries: [] });
    // 确认是目录
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) return res.json({ entries: [] });
    } catch {
      return res.json({ entries: [] });
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
      .filter(it => !it.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .map(it => {
        const full = path.join(resolved, it.name);
        let size = 0;
        if (!it.isDirectory()) try { size = fs.statSync(full).size; } catch {}
        return {
          name: it.name,
          path: full,
          type: it.isDirectory() ? 'directory' : 'file',
          size,
        };
      });
    res.json({ entries });
  } catch (e: any) {
    res.status(400).json({ error: String(e) });
  }
});

/** 获取文件树 */
filesRouter.get('/v1/files', (req, res) => {
  try {
    // 兼容两种参数名: workspace=(前端新版) / path=(WorkspacePanel旧版)
    const workspace = (req.query.workspace as string) || (req.query.path as string) || process.cwd();
    const resolved = path.resolve(workspace);
    // 文件树浏览: 放宽限制, 允许浏览任何存在的目录
    if (resolved.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(resolved)) {
      return res.json({ tree: [], root: resolved, error: 'workspace not found' });
    }
    const tree = buildTree(resolved, '', 5);
    res.json({ tree, root: resolved });
  } catch (e: any) {
    res.status(400).json({ error: String(e) });
  }
});

/** 新建目录 */
filesRouter.post('/v1/files/mkdir', (req, res) => {
  try {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ error: 'path required' });
    const safe = sanitizePath(p);
    fs.mkdirSync(safe, { recursive: true });
    res.json({ ok: true, path: safe });
  } catch (e: any) { res.status(400).json({ error: String(e) }); }
});

/** 新建文件 */
filesRouter.post('/v1/files/touch', (req, res) => {
  try {
    const { path: p, content = '' } = req.body || {};
    if (!p) return res.status(400).json({ error: 'path required' });
    const safe = sanitizePath(p);
    fs.mkdirSync(path.dirname(safe), { recursive: true });
    if (!fs.existsSync(safe)) fs.writeFileSync(safe, content, 'utf-8');
    res.json({ ok: true, path: safe });
  } catch (e: any) { res.status(400).json({ error: String(e) }); }
});

/** 重命名 */
filesRouter.post('/v1/files/rename', (req, res) => {
  try {
    const { from, to } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'from & to required' });
    const safeFrom = sanitizePath(from);
    const safeTo = sanitizePath(to);
    fs.mkdirSync(path.dirname(safeTo), { recursive: true });
    fs.renameSync(safeFrom, safeTo);
    res.json({ ok: true, from: safeFrom, to: safeTo });
  } catch (e: any) { res.status(400).json({ error: String(e) }); }
});

/** 删除 */
filesRouter.delete('/v1/files', (req, res) => {
  try {
    const p = (req.query.path as string) || '';
    if (!p) return res.status(400).json({ error: 'path required' });
    const safe = sanitizePath(p);
    if (!fs.existsSync(safe)) return res.status(404).json({ error: 'not found' });
    const stat = fs.statSync(safe);
    if (stat.isDirectory()) fs.rmSync(safe, { recursive: true, force: true });
    else fs.unlinkSync(safe);
    res.json({ ok: true, path: safe });
  } catch (e: any) { res.status(400).json({ error: String(e) }); }
});

/** 读文件 (5MB 限制) */
filesRouter.get('/v1/files/read', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    // 读文件: 放宽限制, 允许读取任何存在的文件
    const safe = path.resolve(filePath);
    if (safe.includes('..')) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(safe)) return res.status(404).json({ error: 'file not found' });
    const stat = fs.statSync(safe);
    if (stat.isDirectory()) return res.status(400).json({ error: 'is a directory' });
    if (stat.size > 5 * 1024 * 1024) return res.status(413).json({ error: 'file too large (>5MB)' });
    const content = fs.readFileSync(safe, 'utf-8');
    res.json({ path: safe, content, size: stat.size, mtime: stat.mtimeMs });
  } catch (e: any) {
    res.status(400).json({ error: String(e) });
  }
});

/** 读取文件内容 (JSON 响应, DiffViewer 用) */
filesRouter.get('/v1/files/read', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const safe = path.resolve(filePath);
    if (!fs.existsSync(safe)) return res.status(404).json({ error: 'file not found' });
    if (fs.statSync(safe).isDirectory()) return res.status(400).json({ error: 'is a directory' });
    const content = fs.readFileSync(safe, 'utf-8');
    res.json({ ok: true, content, path: safe });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e) });
  }
});

/** 读取文件最新备份 (.agentai/backups/) */
filesRouter.get('/v1/files/backup', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const ws = WorkspaceManager.getInstance().projectDir;
    const backupDir = path.join(ws, '.agentai', 'backups');
    if (!fs.existsSync(backupDir)) return res.json({ ok: true, content: '', message: 'no backups' });
    const fileName = path.basename(filePath);
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith(fileName + '.') && f.endsWith('.bak'))
      .sort().reverse();
    if (backups.length === 0) return res.json({ ok: true, content: '', message: 'no backup for this file' });
    const content = fs.readFileSync(path.join(backupDir, backups[0]), 'utf-8');
    res.json({ ok: true, content, backupFile: backups[0] });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e) });
  }
});

/** 下载文件 (前端 FileCard 一键下载) */
filesRouter.get('/api/files/download', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const safe = path.resolve(filePath);
    if (!fs.existsSync(safe)) return res.status(404).json({ error: 'file not found' });
    const stat = fs.statSync(safe);
    if (stat.isDirectory()) return res.status(400).json({ error: 'is a directory' });
    if (stat.size > 50 * 1024 * 1024) return res.status(413).json({ error: 'file too large (>50MB)' });
    const filename = path.basename(safe);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(safe);
    stream.pipe(res);
  } catch (e: any) {
    res.status(400).json({ error: String(e) });
  }
});

/** 写文件 */
filesRouter.put('/v1/files/write', (req, res) => {
  try {
    const { path: filePath, content } = req.body || {};
    if (!filePath) return res.status(400).json({ error: 'path required' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content (string) required' });
    const safe = sanitizePath(filePath);
    fs.mkdirSync(path.dirname(safe), { recursive: true });
    fs.writeFileSync(safe, content, 'utf-8');
    res.json({ ok: true, path: safe, size: content.length });
  } catch (e: any) {
    res.status(400).json({ error: String(e) });
  }
});
