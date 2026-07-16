/**
 * Skills API — 技能执行路由
 * ===========================
 * 提供 /v1/skills 端点, 允许 LLM 和外部系统调用注册的技能
 *
 * 端点:
 *   GET  /v1/skills          - 列出所有技能
 *   GET  /v1/skills/:name    - 获取技能详情
 *   POST /v1/skills/:name/execute - 执行技能
 *   POST /v1/skills/match    - 匹配用户消息 → 技能
 */
import { Router, type Request, type Response } from 'express';
import { skillOrchestrator } from '../skill-orchestrator.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function createSkillsRouter(): Router {
  const r = Router();

  /** GET /v1/skills - 列出所有技能 */
  r.get('/v1/skills', (_req: Request, res: Response) => {
    const all = skillOrchestrator.list();
    res.json({
      success: true,
      data: all.map(s => ({
        name: s.name,
        description: s.description,
        category: s.category,
        tags: s.tags,
        riskLevel: s.riskLevel,
        hasHandler: !!s.handler,
        triggers: (s as any).triggers || [],
      })),
      count: all.length,
    });
  });

  /** GET /v1/skills/:name - 获取技能详情 */
  r.get('/v1/skills/:name', (req: Request, res: Response) => {
    const skill = skillOrchestrator.get(req.params.name!);
    if (!skill) {
      res.status(404).json({ success: false, error: '技能不存在' });
      return;
    }
    res.json({ success: true, data: skill });
  });

  /** POST /v1/skills/:name/execute - 执行技能 */
  r.post('/v1/skills/:name/execute', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const name = req.params.name!;
    const params = req.body || {};
    try {
      const _dbgp = path.join(os.homedir(), 'Downloads', 'py_bridge_debug.log');
      fs.appendFileSync(_dbgp, `\n[routes/skills] name=${name}, params=${JSON.stringify(params)}\n`, 'utf-8');
    } catch {}

    try {
      const result = await skillOrchestrator.executeSkill(name, params);
      res.json({
        ...result,
        durationMs: Date.now() - startTime,
        skill: name,
      });
    } catch (e: any) {
      res.status(500).json({
        success: false,
        error: e.message || String(e),
        durationMs: Date.now() - startTime,
      });
    }
  });

  /** POST /v1/skills/match - 匹配用户消息 */
  r.post('/v1/skills/match', (req: Request, res: Response) => {
    const message = (req.body || {}).message || '';
    const limit = (req.body || {}).limit || 3;
    const matches = skillOrchestrator.smartDispatch(message, limit);
    res.json({ success: true, data: matches, count: matches.length });
  });

  return r;
}
