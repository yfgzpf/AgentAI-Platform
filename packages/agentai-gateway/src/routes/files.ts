/**
 * Files Routes - 文件系统 API
 * 提取自 index.ts, 提供文件树/读写/重命名/删除
 */
import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager, getWorkspaceAllowedRoots } from '../workspace-manager.js';
import { currentRequestWorkspace } from '../request-scope.js';
import { isPathAllowed } from '../safety/path-guard.js';
import { readWorkspaceProfile } from '../workspace-profile.js';

export const filesRouter = Router();

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
 * POST /v1/workspace/create
 * 批 2-B (2026-10-17): 在允许根内创建工作区目录 + `.agentai/` 骨架 + 初始化画像。
 * ⚠️ 只创建, **不切换**当前工作区 — 切换是用户显式动作 (POST /v1/workspace)。
 * Body: { name: string, parent?: string } — name 单段目录名; parent 缺省为当前 projectDir
 */
filesRouter.post('/v1/workspace/create', (req, res) => {
  try {
    const { name, parent } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: '需要 name 参数 (工作区目录名, 单段)' });
    }
    const wm = WorkspaceManager.getInstance();
    const result = wm.createProjectDir(
      name.trim(),
      typeof parent === 'string' && parent.trim() ? parent.trim() : undefined,
    );
    const profile = readWorkspaceProfile(result.path);
    console.log(`[workspace] created: ${result.path} (created=${result.created})`);
    res.json({
      ok: true,
      path: result.path,
      created: result.created,
      existed: result.existed,
      projectDir: wm.projectDir,
      profile: profile ? {
        techStack: profile.techStack ? {
          language: profile.techStack.language,
          framework: profile.techStack.framework,
        } : null,
        createdAt: profile.createdAt,
      } : null,
    });
  } catch (e: any) { res.status(400).json({ error: String(e?.message || e) }); }
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
  const allowed = getWorkspaceAllowedRoots().some(root => resolved.startsWith(root) || resolved.startsWith(path.resolve(root)));
  if (!allowed) {
    throw new Error(`Path not allowed (outside workspace): ${input}`);
  }
  // 防符号链接绕过
  try {
    const real = fs.realpathSync(resolved);
    const allowedReal = getWorkspaceAllowedRoots().some(root => real.startsWith(root) || real.startsWith(path.resolve(root)));
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
 * 构建文件树 - 优化版本
 * - 减少递归深度（2层）
 * - 限制子目录数量（每层最多100个）
 * - 异步处理避免阻塞
 */
function buildTree(dir: string, prefix: string = '', depth: number = 2): any[] {
  if (depth <= 0) return [];
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true })
      .filter(it => !it.name.startsWith('.') && it.name !== 'node_modules' && it.name !== 'dist' && it.name !== 'out' && it.name !== '__pycache__')
      .slice(0, 100) // 限制每层最多100个条目，防止超大目录
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
    return items.map(it => {
      const full = path.join(dir, it.name);
      const isDir = it.isDirectory();
      let children: any[] = [];
      if (isDir && depth > 1) {
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
        hasMore: isDir && depth <= 1, // 标记是否有更多子目录未加载
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
    // 常用盘判定 (2026-10-17 分发安全): 原实现硬编码 ['C:\\','D:\\','E:\\'] —
    // 分发机上这些盘符可能不存在或与用户无关。改为"用户主目录所在盘 +
    // gateway 运行目录所在盘" — 在任何机器上都是最有意义的起点。
    const home = (process.env.USERPROFILE || process.env.HOME || '').toUpperCase();
    const cwdUpper = process.cwd().toUpperCase();
    // Windows 盘符
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i);
      const root = `${letter}:\\`;
      try {
        if (fs.existsSync(root)) {
          drives.push(root);
          if ((home && home.startsWith(root)) || cwdUpper.startsWith(root)) common.push(root);
        }
      } catch { /* skip */ }
    }
    // 额外常用目录
    if (home) common.push(home);
    common.push(process.cwd());
    res.json({ drives, common: [...new Set(common)] });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

/** 获取目录下的扁平文件列表 (Editor 兼容 + 目录树选择器) */
filesRouter.get('/v1/fs/list', (req, res) => {
  try {
    const dir = (req.query.dir as string) || process.cwd();
    // 只阻止路径遍历攻击 (UI浏览器需要访问任意存在的目录)
    if (dir.includes('..')) {
      return res.status(400).json({ error: 'Invalid path traversal' });
    }
    const resolved = path.resolve(dir);
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

/** 读取文件最新备份 (.agentai/backups/) */
filesRouter.get('/v1/files/backup', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    // 2026-10-06: 请求级工作区（原来读全局单例 → 在 A 项目请求却读 B 项目的备份）。
    // app.ts 的中间件已按 header/query/body 建立 ALS 作用域。
    const ws = currentRequestWorkspace() || WorkspaceManager.getInstance().projectDir;
    const backupDir = path.join(ws, '.agentai', 'backups');
    if (!fs.existsSync(backupDir)) return res.json({ ok: true, content: '', message: 'no backups' });
    const fileName = path.basename(filePath);
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith(fileName + '.') && f.endsWith('.bak'))
      .sort().reverse();
    if (backups.length === 0) return res.json({ ok: true, content: '', message: 'no backup for this file' });
    const content = fs.readFileSync(path.join(backupDir, backups[0]!), 'utf-8');
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
    // ⚠️ 2026-10-17 Windows 中文路径归一化 (实机踩坑):
    //   实测 `path.join('F:\\目录已检查\\澳彩', '.agentai', 'evidence')` 会拼出
    //   `F:目录已检查澳彩\.agentai\...` —— 反斜杠被当转义符吞掉, 路径全错。
    //   所以凡是用工作区根去拼路径, 必须先统一成正斜杠 (ws-paths.normWsPath)。
    //   注意: **查询参数里的绝对路径**已经带反斜杠, 不能一刀切替换(会把
    //   Windows 盘符路径搞坏), 所以这里只对"以工作区根为基准"的兜底分支做归一化。
    let safe = path.resolve(filePath);
    if (!fs.existsSync(safe)) {
      // 回退 1 (2026-10-17): 请求级 workspace —— 多工作区场景下不能读错项目。
      //   原来只用 WorkspaceManager 全局单例, 与同文件 L306 的 /v1/files/backup 不一致。
      const ws = currentRequestWorkspace() || WorkspaceManager.getInstance().projectDir;
      if (ws) {
        // 只接**裸文件名** (含相对子目录), 不接绝对路径 —— 否则这里会变成
        //   一个"任意路径读取"入口。限定在工作区的 .agentai/ 证据目录内。
        const rel = String(filePath).replace(/\\/g, '/').replace(/^[/\\]+/, '');
        const normWs = String(ws).replace(/\\/g, '/').replace(/\/+$/, '');
        // 只在 .agentai/ 下找 (证据、附件), 不给整个工作区当搜索域
        const alt = path.resolve(`${normWs}/.agentai/${rel}`);
        if (alt.startsWith(path.resolve(`${normWs}/.agentai`) + path.sep) && fs.existsSync(alt)) {
          safe = alt;
        }
      }
      if (!fs.existsSync(safe)) {
        // 回退 2 (旧逻辑): workspace 根目录 (AI 可能写到这里)
        const wm = WorkspaceManager.getInstance();
        const alt2 = path.resolve(wm.projectDir, '..', '..', path.basename(filePath));
        if (fs.existsSync(alt2)) { safe = alt2; }
      }
    }
    if (!fs.existsSync(safe)) return res.status(404).json({ error: 'file not found' });
    const stat = fs.statSync(safe);
    if (stat.isDirectory()) return res.status(400).json({ error: 'is a directory' });
    if (stat.size > 50 * 1024 * 1024) return res.status(413).json({ error: 'file too large (>50MB)' });
    const filename = path.basename(safe);
    const ext = path.extname(safe).toLowerCase();
    // 图片类型: 内联显示 (让 <img> 标签能渲染)
    const imageTypes: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    };
    if (imageTypes[ext]) {
      res.setHeader('Content-Type', imageTypes[ext]);
      // 图片不设 attachment, 浏览器内联渲染
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    }
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

/** 在系统文件管理器中显示文件 (Windows: explorer /select; macOS: open -R; Linux: xdg-open) */
filesRouter.post('/v1/fs/reveal', (req, res) => {
  try {
    const { path: filePath } = req.body || {};
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const safe = sanitizePath(filePath);
    if (!fs.existsSync(safe)) return res.status(404).json({ error: 'file not found' });
    const dir = fs.statSync(safe).isDirectory() ? safe : path.dirname(safe);
    const { exec } = require('child_process');
    const platform = process.platform;
    if (platform === 'win32') {
      exec(`explorer /select,"${safe.replace(/\//g, '\\')}"`);
    } else if (platform === 'darwin') {
      exec(`open -R "${safe}"`);
    } else {
      exec(`xdg-open "${dir}"`);
    }
    res.json({ ok: true, dir });
  } catch (e: any) {
    res.status(400).json({ error: String(e) });
  }
});

/**
 * GET /v1/project-docs/status
 * 获取项目说明文件状态 (PROJECT_README.md, PROJECT_CONTEXT.md, PROJECT_STATE.md)
 */
filesRouter.get('/v1/project-docs/status', (req, res) => {
  try {
    const wm = WorkspaceManager.getInstance();
    const agentaiDir = path.join(wm.projectDir, '.agentai');
    
    const checkFile = (name: string) => {
      const filePath = path.join(agentaiDir, name);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        return { exists: true, lastModified: stats.mtimeMs };
      }
      return { exists: false, lastModified: 0 };
    };

    res.json({
      files: {
        readme: checkFile('PROJECT_README.md'),
        context: checkFile('PROJECT_CONTEXT.md'),
        state: checkFile('PROJECT_STATE.md'),
      }
    });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /v1/project-docs/read
 * 读取项目说明文件内容
 * query: file=readme|context|state
 */
filesRouter.get('/v1/project-docs/read', (req, res) => {
  try {
    const wm = WorkspaceManager.getInstance();
    const agentaiDir = path.join(wm.projectDir, '.agentai');
    const fileId = req.query.file as string;
    
    const fileMap: Record<string, string> = {
      readme: 'PROJECT_README.md',
      context: 'PROJECT_CONTEXT.md',
      state: 'PROJECT_STATE.md',
    };

    const fileName = fileMap[fileId];
    if (!fileName) {
      res.status(400).json({ error: 'Invalid file id' });
      return;
    }

    const filePath = path.join(agentaiDir, fileName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});
