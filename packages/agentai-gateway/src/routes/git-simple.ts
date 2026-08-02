/**
 * Git REST API — 简化版，支持动态工作区
 * 通过查询参数传递工作区路径
 */

import { Router } from 'express';
import { execSync } from 'child_process';
import * as path from 'path';

const router = Router();

// 执行 git 命令（使用异步版本避免阻塞事件循环）
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

async function execGitAsync(args: string[], cwd: string, timeout = 10000): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const { stdout } = await execAsync(`git ${args.join(' ')}`, { cwd, encoding: 'utf-8', timeout, maxBuffer: 10 * 1024 * 1024 });
    return { success: true, output: stdout.trim() };
  } catch (e: any) {
    return { success: false, output: '', error: e.message?.slice(0, 500) || 'Git command failed' };
  }
}

// 保留同步版本用于简单操作
function execGit(args: string[], cwd: string, timeout = 10000): { success: boolean; output: string; error?: string } {
  try {
    const out = execSync(`git ${args.join(' ')}`, { cwd, encoding: 'utf-8', timeout, maxBuffer: 10 * 1024 * 1024 }).trim();
    return { success: true, output: out };
  } catch (e: any) {
    return { success: false, output: '', error: e.message?.slice(0, 500) || 'Git command failed' };
  }
}

// 获取工作区路径（从查询参数或请求头）
function getWorkspace(req: any): string {
  return req.headers['x-workspace-path'] || req.query.workspace || process.cwd();
}

// GET /v1/git/status
router.get('/status', async (req: any, res: any) => {
  const cwd = getWorkspace(req);
  
  try {
    // 使用异步操作避免阻塞事件循环
    const branchResult = await execGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 5000);
    const branch = branchResult.success ? branchResult.output : 'unknown';
    
    // 限制文件数量，避免大仓库卡顿
    const statusResult = await execGitAsync(['status', '--porcelain', '-u'], cwd, 10000);
    const files: any[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;
    
    if (statusResult.success && statusResult.output) {
      const lines = statusResult.output.split('\n').filter((l: string) => l.trim()).slice(0, 100); // 最多100个文件
      
      // 批量获取 diff 统计，而不是每个文件单独查询
      const diffStatResult = await execGitAsync(['diff', '--numstat', '--cached'], cwd, 5000);
      const unstagedDiffResult = await execGitAsync(['diff', '--numstat'], cwd, 5000);
      
      const diffStats = new Map<string, { additions: number; deletions: number }>();
      
      // 解析 staged diff
      if (diffStatResult.success) {
        diffStatResult.output.split('\n').forEach((line: string) => {
          const match = line.match(/(\d+)\s+(\d+)\s+(.+)/);
          if (match) {
            diffStats.set(match[3], { additions: parseInt(match[1]) || 0, deletions: parseInt(match[2]) || 0 });
          }
        });
      }
      
      // 解析 unstaged diff
      if (unstagedDiffResult.success) {
        unstagedDiffResult.output.split('\n').forEach((line: string) => {
          const match = line.match(/(\d+)\s+(\d+)\s+(.+)/);
          if (match) {
            const existing = diffStats.get(match[3]);
            if (existing) {
              existing.additions += parseInt(match[1]) || 0;
              existing.deletions += parseInt(match[2]) || 0;
            } else {
              diffStats.set(match[3], { additions: parseInt(match[1]) || 0, deletions: parseInt(match[2]) || 0 });
            }
          }
        });
      }
      
      for (const line of lines) {
        const staged = line[0] !== ' ' && line[0] !== '?';
        const filePath = line.slice(3).trim();
        
        let status: any = 'modified';
        const code = staged ? line[0] : line[1];
        
        switch (code) {
          case 'A': status = 'added'; break;
          case 'D': status = 'deleted'; break;
          case 'R': status = 'renamed'; break;
          case '?': status = 'untracked'; break;
        }
        
        const stats = diffStats.get(filePath);
        const additions = stats?.additions || 0;
        const deletions = stats?.deletions || 0;
        totalAdditions += additions;
        totalDeletions += deletions;
        
        files.push({ path: filePath, status, staged, additions, deletions });
      }
    }
    
    // 异步获取 ahead/behind
    let ahead = 0, behind = 0;
    if (branch !== 'unknown') {
      const aheadBehind = await execGitAsync(['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`], cwd, 5000);
      if (aheadBehind.success) {
        const match = aheadBehind.output.match(/(\d+)\s+(\d+)/);
        if (match) {
          ahead = parseInt(match[1]) || 0;
          behind = parseInt(match[2]) || 0;
        }
      }
    }
    
    const summary = {
      modified: files.filter(f => f.status === 'modified').length,
      added: files.filter(f => f.status === 'added').length,
      deleted: files.filter(f => f.status === 'deleted').length,
      untracked: files.filter(f => f.status === 'untracked').length,
      staged: files.filter(f => f.staged).length,
      totalAdditions,
      totalDeletions,
    };
    
    res.json({ success: true, branch, ahead, behind, files, summary });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /v1/git/add
router.post('/add', (req: any, res: any) => {
  const cwd = getWorkspace(req);
  const { files } = req.body;
  
  try {
    execGit(['add', ...files], cwd);
    res.json({ success: true, message: `Staged ${files.length} file(s)`, files });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /v1/git/commit
router.post('/commit', (req: any, res: any) => {
  const cwd = getWorkspace(req);
  const { message } = req.body;
  
  try {
    const result = execGit(['commit', '-m', message], cwd);
    if (result.success) {
      const hashResult = execGit(['rev-parse', 'HEAD'], cwd);
      res.json({ success: true, message: 'Commit successful', commitHash: hashResult.output });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /v1/git/push
router.post('/push', (req: any, res: any) => {
  const cwd = getWorkspace(req);
  const { remote = 'origin', branch } = req.body;
  
  try {
    const args = ['push', remote];
    if (branch) args.push(branch);
    const result = execGit(args, cwd, 30000);
    if (result.success) {
      res.json({ success: true, message: 'Push successful', output: result.output });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
