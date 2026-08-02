/**
 * External Connections API — 外部连接管理
 * ----------------------------------------
 * 管理 Android设备 / SketchUp / 微信公众号 等外部连接
 */

import { Router, Request, Response } from 'express';

const router = Router();

// 连接状态存储 (内存中，重启后重置)
const connectionStates: Record<string, {
  enabled: boolean;
  status: 'online' | 'offline' | 'error';
  lastCheck?: number;
  config?: Record<string, any>;
}> = {
  android: { enabled: false, status: 'offline' },
  sketchup: { enabled: false, status: 'offline' },
  'wechat-automation': { enabled: false, status: 'offline' },
};

/**
 * GET /api/external-connections/status
 * 获取所有外部连接的状态
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    android: {
      enabled: connectionStates.android.enabled,
      status: connectionStates.android.status,
      details: '需要 Another 桌面应用运行中 (localhost:7070)',
    },
    sketchup: {
      enabled: connectionStates.sketchup.enabled,
      status: connectionStates.sketchup.status,
      details: '需要安装 sketchup-mcp2 + Ruby 扩展 + SketchUp 已打开',
    },
    'wechat-automation': {
      enabled: connectionStates['wechat-automation'].enabled,
      status: connectionStates['wechat-automation'].status,
      details: '需要 DeepSeek API Key + 公众号 AppID/AppSecret',
    },
  });
});

/**
 * POST /api/external-connections/toggle
 * 切换连接启用/禁用状态
 */
router.post('/toggle', (req: Request, res: Response) => {
  const { id, enabled } = req.body;

  if (!id || typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'Missing id or enabled parameter' });
    return;
  }

  if (!connectionStates[id]) {
    res.status(404).json({ error: `Unknown connection: ${id}` });
    return;
  }

  // 更新状态
  connectionStates[id].enabled = enabled;
  connectionStates[id].status = enabled ? 'online' : 'offline';
  connectionStates[id].lastCheck = Date.now();

  console.log(`[external-connections] ${id} ${enabled ? 'enabled' : 'disabled'}`);

  res.json({
    success: true,
    id,
    enabled,
    status: connectionStates[id].status,
  });
});

/**
 * GET /api/external-connections/:id/config
 * 获取特定连接的配置
 */
router.get('/:id/config', (req: Request, res: Response) => {
  const { id } = req.params;

  if (!connectionStates[id]) {
    res.status(404).json({ error: `Unknown connection: ${id}` });
    return;
  }

  res.json({
    id,
    config: connectionStates[id].config || {},
  });
});

/**
 * POST /api/external-connections/:id/config
 * 更新特定连接的配置
 */
router.post('/:id/config', (req: Request, res: Response) => {
  const { id } = req.params;
  const config = req.body;

  if (!connectionStates[id]) {
    res.status(404).json({ error: `Unknown connection: ${id}` });
    return;
  }

  connectionStates[id].config = { ...connectionStates[id].config, ...config };

  res.json({
    success: true,
    id,
    config: connectionStates[id].config,
  });
});

/**
 * POST /api/external-connections/:id/test
 * 测试特定连接
 */
router.post('/:id/test', async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!connectionStates[id]) {
    res.status(404).json({ error: `Unknown connection: ${id}` });
    return;
  }

  // 模拟连接测试
  try {
    let testResult = false;

    switch (id) {
      case 'android':
        // 测试 Another MCP Server 是否可达
        try {
          const response = await fetch('http://localhost:7070/health', { timeout: 5000 } as any);
          testResult = response.ok;
        } catch {
          testResult = false;
        }
        break;
      case 'sketchup':
        // 测试 SketchUp 扩展是否响应
        testResult = false; // 需要实际实现
        break;
      case 'wechat-automation':
        // 测试微信API配置是否有效
        testResult = false; // 需要实际实现
        break;
    }

    connectionStates[id].status = testResult ? 'online' : 'error';
    connectionStates[id].lastCheck = Date.now();

    res.json({
      success: true,
      id,
      reachable: testResult,
      status: connectionStates[id].status,
    });
  } catch (error: any) {
    connectionStates[id].status = 'error';
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
