/**
 * GitHub OAuth 授权路由
 * 实现真实的 GitHub OAuth 流程，获取用户 token
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const router = Router();

// GitHub OAuth App 配置
// 注意：实际生产环境应该从环境变量读取
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'Ov23li1p5i1eS7q7l0j6';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';

// Token 存储路径
const TOKEN_DIR = path.join(os.homedir(), '.agentai', 'github');
const TOKEN_FILE = path.join(TOKEN_DIR, 'token.json');

// 确保目录存在
function ensureTokenDir(): void {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
}

// 保存 token
function saveToken(token: string, scope: string): void {
  ensureTokenDir();
  const data = {
    token,
    scope,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  
  // 同时配置 git credential helper
  try {
    execSync('git config --global credential.helper store');
    const credsPath = path.join(os.homedir(), '.git-credentials');
    const credLine = `https://oauth:${token}@github.com\n`;
    
    let existingCreds = '';
    if (fs.existsSync(credsPath)) {
      existingCreds = fs.readFileSync(credsPath, 'utf-8');
    }
    
    // 避免重复添加
    if (!existingCreds.includes(`oauth:${token}`)) {
      fs.appendFileSync(credsPath, credLine);
    }
  } catch (e) {
    console.error('[github-auth] Failed to configure git credentials:', e);
  }
}

// 读取 token
export function getGitHubToken(): { token: string; scope: string } | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
      return { token: data.token, scope: data.scope };
    }
  } catch (e) {
    console.error('[github-auth] Failed to read token:', e);
  }
  return null;
}

// 检查是否已授权
export function isGitHubAuthenticated(): boolean {
  return getGitHubToken() !== null;
}

/**
 * GET /auth/github/status — 检查授权状态
 */
router.get('/status', (req, res) => {
  const token = getGitHubToken();
  res.json({
    authenticated: !!token,
    scope: token?.scope || null,
  });
});

/**
 * POST /auth/github/token — 保存 OAuth token（前端通过 popup 获取后传递）
 */
router.post('/token', async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }
  
  try {
    // 使用 code 换取 access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    
    const tokenData = await tokenResponse.json() as any;
    
    if (tokenData.error) {
      res.status(400).json({ error: tokenData.error_description || tokenData.error });
      return;
    }
    
    const { access_token, scope } = tokenData;
    
    // 保存 token
    saveToken(access_token, scope);
    
    // 获取用户信息
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${access_token}`,
        'User-Agent': 'PulseFlow-Gateway',
      },
    });
    
    const userData = await userResponse.json() as any;
    
    res.json({
      success: true,
      user: {
        login: userData.login,
        name: userData.name,
        email: userData.email,
        avatar_url: userData.avatar_url,
      },
      scope,
    });
  } catch (error: any) {
    console.error('[github-auth] Token exchange failed:', error);
    res.status(500).json({ error: error.message || 'Token exchange failed' });
  }
});

/**
 * POST /auth/github/logout — 注销授权
 */
router.post('/logout', (req, res) => {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /auth/github/repos — 获取用户仓库列表
 */
router.get('/repos', async (req, res) => {
  const token = getGitHubToken();
  
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  
  try {
    const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
      headers: {
        'Authorization': `token ${token.token}`,
        'User-Agent': 'PulseFlow-Gateway',
      },
    });
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const repos = await response.json() as any[];
    res.json({
      success: true,
      repos: repos.map((r: any) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        description: r.description,
        private: r.private,
        html_url: r.html_url,
        clone_url: r.clone_url,
        default_branch: r.default_branch,
        updated_at: r.updated_at,
      })),
    });
  } catch (error: any) {
    console.error('[github-auth] Failed to fetch repos:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /auth/github/clone — 克隆仓库到指定工作区
 */
router.post('/clone', async (req, res) => {
  const { repo, workspace } = req.body;
  const token = getGitHubToken();
  
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  
  if (!repo || !workspace) {
    res.status(400).json({ error: 'Missing repo or workspace' });
    return;
  }
  
  try {
    // 构建带 token 的 clone URL
    const cloneUrl = `https://oauth:${token.token}@github.com/${repo}.git`;
    
    // 执行 clone
    const repoName = repo.split('/')[1];
    const targetPath = path.join(workspace, repoName);
    
    execSync(`git clone "${cloneUrl}" "${targetPath}"`, {
      timeout: 60000,
      stdio: 'pipe',
    });
    
    res.json({
      success: true,
      message: `Cloned ${repo} to ${targetPath}`,
      path: targetPath,
    });
  } catch (error: any) {
    console.error('[github-auth] Clone failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export const githubAuthRouter = router;
export default router;
