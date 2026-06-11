// @ts-nocheck
/**
 * 技能发现 API 路由
 * ----------------------------------------------------
 * GET /v1/skills          — 列出所有可用技能
 * GET /v1/skills/:name    — 获取技能详情
 * POST /v1/skills/match   — 根据消息匹配技能
 */

import { Router, Request, Response } from 'express';
import { listAvailableSkills, discoverAndRecommend } from './spawner.js';
import { getSkill } from './loader.js';

export function createSkillsRouter(): Router {
  const router = Router();

  /**
   * GET /v1/skills
   * 列出所有可用技能
   */
  router.get('/', (_req: Request, res: Response) => {
    try {
      const skills = listAvailableSkills();
      res.json({
        count: skills.length,
        skills,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /v1/skills/:name
   * 获取技能详情
   */
  router.get('/:name', (req: Request, res: Response) => {
    try {
      const skill = getSkill(req.params.name);
      if (!skill) {
        return res.status(404).json({ error: `Skill "${req.params.name}" not found` });
      }
      res.json(skill);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /v1/skills/match
   * 根据消息匹配技能
   * Body: { message: string, maxResults?: number }
   */
  router.post('/match', (req: Request, res: Response) => {
    try {
      const { message, maxResults = 5 } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'message required' });
      }
      const matched = discoverAndRecommend(message);
      res.json({
        message,
        matched: matched.length,
        skills: matched.slice(0, maxResults),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
