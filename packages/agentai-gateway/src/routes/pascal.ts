/**
 * Pascal Editor API 路由
 * --------------------------------------------------
 * 提供 3D 建筑编辑器的 HTTP API 接口
 */
import { Router } from 'express';
import { pascalEditor } from '../pascal-editor.js';

export function createPascalRouter(): Router {
  const router = Router();

  // 获取状态
  router.get('/status', (req, res) => {
    try {
      const status = pascalEditor.getStatus();
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 启动服务
  router.post('/start', async (req, res) => {
    try {
      const { port, workspace } = req.body;
      const result = await pascalEditor.start({ port, workspace });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 停止服务
  router.post('/stop', async (req, res) => {
    try {
      const result = await pascalEditor.stop();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 获取当前模型
  router.get('/model', async (req, res) => {
    try {
      const result = await pascalEditor.getCurrentModel();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 导出模型
  router.post('/export', async (req, res) => {
    try {
      const { format, outputPath, modelId } = req.body;
      const result = await pascalEditor.exportModel({ format, outputPath, modelId });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 导入 IFC
  router.post('/import', async (req, res) => {
    try {
      const { filePath } = req.body;
      const result = await pascalEditor.importIFC({ filePath });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
