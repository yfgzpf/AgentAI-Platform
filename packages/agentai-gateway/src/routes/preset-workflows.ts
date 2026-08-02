/**
 * Preset Workflows API — 预置工作流接口
 * ============================================================
 * 
 * 提供预置工作流的查询、执行和管理接口
 */

import { Router, Request, Response } from 'express';
import {
  PRESET_WORKFLOWS,
  getWorkflowsByCategory,
  getWorkflowByName,
  searchWorkflows,
  getCategories,
  PresetWorkflow,
} from '../preset-workflows/index.js';
import { executeManjuWorkflow, ManjuConfig } from '../preset-workflows/manju-skills.js';

export function createPresetWorkflowsRouter(): Router {
  const router = Router();

  // ═══════════════════════════════════════════════════════════
  // 查询接口
  // ═══════════════════════════════════════════════════════════

  /** GET /api/preset-workflows — 获取所有预置工作流 */
  router.get('/', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      workflows: PRESET_WORKFLOWS.map(w => ({
        name: w.name,
        description: w.description,
        category: w.category,
        icon: w.icon,
        estimatedTime: w.estimatedTime,
        triggers: w.triggers,
        requiredKeys: w.requiredKeys,
      })),
      categories: getCategories(),
    });
  });

  /** GET /api/preset-workflows/categories — 获取分类列表 */
  router.get('/categories', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      categories: getCategories(),
    });
  });

  /** GET /api/preset-workflows/category/:category — 按分类获取 */
  router.get('/category/:category', (req: Request, res: Response) => {
    const { category } = req.params;
    const workflows = getWorkflowsByCategory(category as any);
    res.json({
      ok: true,
      category,
      workflows: workflows.map(w => ({
        name: w.name,
        description: w.description,
        icon: w.icon,
        estimatedTime: w.estimatedTime,
        triggers: w.triggers,
      })),
    });
  });

  /** GET /api/preset-workflows/search?q=xxx — 搜索工作流 */
  router.get('/search', (req: Request, res: Response) => {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing query parameter: q' });
      return;
    }
    const workflows = searchWorkflows(q);
    res.json({
      ok: true,
      query: q,
      workflows: workflows.map(w => ({
        name: w.name,
        description: w.description,
        category: w.category,
        icon: w.icon,
      })),
    });
  });

  /** GET /api/preset-workflows/:name — 获取工作流详情 */
  router.get('/:name', (req: Request, res: Response) => {
    const { name } = req.params;
    const workflow = getWorkflowByName(name);
    if (!workflow) {
      res.status(404).json({ ok: false, error: `Workflow not found: ${name}` });
      return;
    }
    res.json({
      ok: true,
      workflow: {
        name: workflow.name,
        description: workflow.description,
        category: workflow.category,
        icon: workflow.icon,
        estimatedTime: workflow.estimatedTime,
        requiredKeys: workflow.requiredKeys,
        parameters: workflow.parameters,
        examples: workflow.examples,
        stages: workflow.stages.map(s => ({
          skill: s.skill,
          output: s.output,
        })),
      },
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 执行接口
  // ═══════════════════════════════════════════════════════════

  /** POST /api/preset-workflows/:name/execute — 执行工作流 */
  router.post('/:name/execute', async (req: Request, res: Response) => {
    const { name } = req.params;
    const workflow = getWorkflowByName(name);
    
    if (!workflow) {
      res.status(404).json({ ok: false, error: `Workflow not found: ${name}` });
      return;
    }

    // 检查所需 API 密钥
    const missingKeys = workflow.requiredKeys.filter(key => !process.env[key]);
    if (missingKeys.length > 0) {
      res.status(400).json({
        ok: false,
        error: 'Missing required API keys',
        missingKeys,
        message: `请配置以下环境变量: ${missingKeys.join(', ')}`,
      });
      return;
    }

    try {
      // 根据工作流类型执行不同的逻辑
      if (name === 'manju-generator') {
        const config: ManjuConfig = {
          script: req.body.script,
          style: req.body.style,
          videoRatio: req.body.videoRatio,
          duration: req.body.duration,
          audioMode: req.body.audioMode || 'auto',
          voice: req.body.voice,
          bgm: req.body.bgm,
        };

        const apiKey = process.env.AGENTAI_API_KEY || '';
        
        // 启动异步执行
        const result = await executeManjuWorkflow(
          config,
          apiKey,
          (stage, progress) => {
            // 可以通过 WebSocket 推送进度
            console.log(`[manju] ${stage}: ${progress}%`);
          }
        );

        if (result.success) {
          res.json({
            ok: true,
            workflow: name,
            result: {
              scenes: result.scenes,
              imageUrls: result.imageUrls,
              audioUrls: result.audioUrls,
              videoUrls: result.videoUrls,
              finalVideo: result.finalVideo,
            },
          });
        } else {
          res.status(500).json({
            ok: false,
            error: result.error || 'Workflow execution failed',
          });
        }
        return;
      }

      // 其他工作流类型...
      res.status(501).json({
        ok: false,
        error: `Workflow execution not implemented for: ${name}`,
      });

    } catch (error: any) {
      console.error(`[preset-workflows] Execution failed:`, error);
      res.status(500).json({
        ok: false,
        error: error.message || 'Internal server error',
      });
    }
  });

  /** POST /api/preset-workflows/:name/validate — 验证参数 */
  router.post('/:name/validate', (req: Request, res: Response) => {
    const { name } = req.params;
    const workflow = getWorkflowByName(name);
    
    if (!workflow) {
      res.status(404).json({ ok: false, error: `Workflow not found: ${name}` });
      return;
    }

    const errors: string[] = [];
    
    // 验证必填参数
    for (const param of workflow.parameters) {
      if (param.required && !req.body[param.name]) {
        errors.push(`缺少必填参数: ${param.label} (${param.name})`);
      }
    }

    // 验证选项值
    for (const param of workflow.parameters) {
      if (param.type === 'select' && param.options) {
        const value = req.body[param.name];
        if (value && !param.options.find(o => o.value === value)) {
          errors.push(`参数 ${param.name} 的值无效: ${value}`);
        }
      }
    }

    res.json({
      ok: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 状态查询接口
  // ═══════════════════════════════════════════════════════════

  /** GET /api/preset-workflows/status — 检查系统状态 */
  router.get('/system/status', (_req: Request, res: Response) => {
    const status: Record<string, { available: boolean; message: string }> = {};
    
    // 检查各个 API 密钥
    status['agnes'] = {
      available: !!process.env.AGENTAI_API_KEY,
      message: process.env.AGENTAI_API_KEY ? 'Agnes API 已配置' : '缺少 AGENTAI_API_KEY',
    };
    
    status['mimo'] = {
      available: !!process.env.MIMO_API_KEY,
      message: process.env.MIMO_API_KEY ? 'MiMo TTS 已配置' : '缺少 MIMO_API_KEY',
    };
    
    status['deepseek'] = {
      available: !!process.env.DEEPSEEK_API_KEY,
      message: process.env.DEEPSEEK_API_KEY ? 'DeepSeek API 已配置' : '缺少 DEEPSEEK_API_KEY',
    };

    res.json({
      ok: true,
      status,
      allReady: Object.values(status).every(s => s.available),
    });
  });

  return router;
}
