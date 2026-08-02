/**
 * 远程开发环境 API 路由
 * 提供 SSH/WSL/Docker 连接管理和 AI 远程操作接口
 */

import { Router, Request, Response } from 'express';
import { remoteManager } from '../remote/connection-manager.js';
import {
  listEnvironments,
  getEnvironment,
  saveEnvironment,
  deleteEnvironment,
} from '../remote/store.js';
import {
  activateRemoteSession,
  deactivateRemoteSession,
  getActiveRemoteSession,
  isRemoteSessionActive,
  detectRemoteIntent,
  suggestEnvironmentSwitch,
  getRemoteEnvironmentSummary,
} from '../remote/ai-integration.js';
import { RemoteEnvironment } from '../remote/types.js';

const router = Router();

/**
 * GET /v1/remote/environments
 * 列出所有保存的远程环境配置
 */
router.get('/environments', (req: Request, res: Response) => {
  try {
    const envs = listEnvironments();
    res.json({ success: true, environments: envs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/remote/environments
 * 创建或更新远程环境配置
 */
router.post('/environments', (req: Request, res: Response) => {
  try {
    const env: RemoteEnvironment = {
      ...req.body,
      id: req.body.id || `env-${Date.now()}`,
      lastUsed: Date.now(),
      useCount: 0,
    };
    saveEnvironment(env);
    res.json({ success: true, environment: env });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /v1/remote/environments/:id
 * 删除远程环境配置
 */
router.delete('/environments/:id', (req: Request, res: Response) => {
  try {
    const success = deleteEnvironment(req.params.id);
    if (success) {
      res.json({ success: true, message: 'Environment deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Environment not found' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/remote/connect/:id
 * 连接到远程环境
 */
router.post('/connect/:id', async (req: Request, res: Response) => {
  try {
    const env = getEnvironment(req.params.id);
    if (!env) {
      return res.status(404).json({ success: false, error: 'Environment not found' });
    }

    const state = await remoteManager.connect(env);

    // 激活远程会话（让 AI 感知）
    await activateRemoteSession(env.id);

    res.json({
      success: true,
      state,
      message: `Connected to ${env.name}`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/remote/disconnect/:id
 * 断开远程环境连接
 */
router.post('/disconnect/:id', async (req: Request, res: Response) => {
  try {
    await remoteManager.disconnect(req.params.id);

    // 如果有活跃的会话是这个环境，停用它
    const activeSession = getActiveRemoteSession();
    if (activeSession?.environmentId === req.params.id) {
      deactivateRemoteSession();
    }

    res.json({ success: true, message: 'Disconnected' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /v1/remote/connections
 * 获取所有活跃连接状态
 */
router.get('/connections', (req: Request, res: Response) => {
  try {
    const connections = remoteManager.getAllConnections();
    const activeSession = getActiveRemoteSession();

    res.json({
      success: true,
      connections,
      activeSession: activeSession ? {
        environmentId: activeSession.environmentId,
        environmentName: activeSession.environment.name,
        connectedAt: activeSession.activatedAt,
      } : null,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/remote/activate/:id
 * 激活指定的远程环境会话（让 AI 感知到）
 */
router.post('/activate/:id', async (req: Request, res: Response) => {
  try {
    const session = await activateRemoteSession(req.params.id);
    res.json({
      success: true,
      session: {
        environmentId: session.environmentId,
        environmentName: session.environment.name,
        activatedAt: session.activatedAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/remote/deactivate
 * 停用当前远程环境会话
 */
router.post('/deactivate', (req: Request, res: Response) => {
  try {
    deactivateRemoteSession();
    res.json({ success: true, message: 'Remote session deactivated' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /v1/remote/status
 * 获取当前远程会话状态
 */
router.get('/status', (req: Request, res: Response) => {
  try {
    const activeSession = getActiveRemoteSession();
    const isActive = isRemoteSessionActive();

    res.json({
      success: true,
      isActive,
      session: activeSession ? {
        environmentId: activeSession.environmentId,
        environmentName: activeSession.environment.name,
        environmentType: activeSession.environment.type,
        currentDirectory: activeSession.state.currentDirectory,
        latency: activeSession.state.latency,
        activatedAt: activeSession.activatedAt,
      } : null,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/remote/detect-intent
 * 检测用户消息中的远程操作意图
 */
router.post('/detect-intent', (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    const intent = detectRemoteIntent(message);
    const suggestion = suggestEnvironmentSwitch(message);

    res.json({
      success: true,
      intent,
      suggestion,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /v1/remote/summary
 * 获取当前远程环境的详细摘要
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const summary = await getRemoteEnvironmentSummary();
    res.json({ success: true, summary });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/remote/:id/exec
 * 在远程环境执行命令（直接 API 调用）
 */
router.post('/:id/exec', async (req: Request, res: Response) => {
  try {
    const { command, cwd } = req.body;
    if (!command) {
      return res.status(400).json({ success: false, error: 'Command is required' });
    }

    const result = await remoteManager.exec(req.params.id, command, cwd);
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/remote/:id/read-file
 * 读取远程文件（直接 API 调用）
 */
router.post('/:id/read-file', async (req: Request, res: Response) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Path is required' });
    }

    const result = await remoteManager.readFile(req.params.id, filePath);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/remote/:id/write-file
 * 写入远程文件（直接 API 调用）
 */
router.post('/:id/write-file', async (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      return res.status(400).json({ success: false, error: 'Path and content are required' });
    }

    const result = await remoteManager.writeFile(req.params.id, filePath, content);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /v1/remote/:id/list-directory
 * 列出远程目录（直接 API 调用）
 */
router.post('/:id/list-directory', async (req: Request, res: Response) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      return res.status(400).json({ success: false, error: 'Path is required' });
    }

    const result = await remoteManager.listDirectory(req.params.id, dirPath);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 工厂函数，用于创建路由实例
export function createRemoteRouter() {
  return router;
}

export default router;
