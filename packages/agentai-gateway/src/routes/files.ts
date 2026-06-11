/**
 * Files Routes - 文件系统 API
 * 提取自 index.ts, 提供文件树/读写/重命名/删除
 */
import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';

export const filesRouter = Router();

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

/** 获取文件树 */
filesRouter.get('/v1/files', (req, res) => {
  try {
    const workspace = (req.query.workspace as string) || 'F:\\agentai-platform';
    const resolved = path.resolve(workspace);
    if (!fs.existsSync(resolved)) {
      return res.json({ tree: [], root: resolved, error: 'workspace not found' });
    }
    const tree = buildTree(resolved, '', 5);
    res.json({ tree, root: resolved });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

/** 新建目录 */
filesRouter.post('/v1/files/mkdir', (req, res) => {
  try {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ error: 'path required' });
    fs.mkdirSync(p, { recursive: true });
    res.json({ ok: true, path: p });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

/** 新建文件 */
filesRouter.post('/v1/files/touch', (req, res) => {
  try {
    const { path: p, content = '' } = req.body || {};
    if (!p) return res.status(400).json({ error: 'path required' });
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) fs.writeFileSync(p, content, 'utf-8');
    res.json({ ok: true, path: p });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

/** 重命名 */
filesRouter.post('/v1/files/rename', (req, res) => {
  try {
    const { from, to } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'from & to required' });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    res.json({ ok: true, from, to });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

/** 删除 */
filesRouter.delete('/v1/files', (req, res) => {
  try {
    const p = (req.query.path as string) || '';
    if (!p) return res.status(400).json({ error: 'path required' });
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
    const stat = fs.statSync(p);
    if (stat.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    else fs.unlinkSync(p);
    res.json({ ok: true, path: p });
  } catch (e: any) { res.status(500).json({ error: String(e) }); }
});

/** 读文件 (5MB 限制) */
filesRouter.get('/v1/files/read', (req, res) => {
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

/** 写文件 */
filesRouter.put('/v1/files/write', (req, res) => {
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
