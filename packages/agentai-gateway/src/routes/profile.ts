/**
 * 用户身份路由 (/v1/profile)
 * --------------------------------------------------
 * 独立于 chat 的用户身份 CRUD 端点
 * - GET  /v1/profile           → 读取当前用户模型
 * - POST /v1/profile           → 更新用户身份 (Onboarding 完成后调用)
 * - POST /v1/profile/questionnaire → 单独持久化问卷答案
 */
import { Router, Request, Response } from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { userModel } from '../user-model.js';

let _industryEngine: any = null;

/** 注入行业引擎 (由 index.ts 调用) */
export function setIndustryEngine(ie: any) { _industryEngine = ie; }

const AGENTAI_DIR = path.join(os.homedir(), '.agentai');

export function createProfileRouter(): Router {
  const router = Router();

  /**
   * GET /v1/profile
   * 读取当前用户模型的完整数据
   */
  router.get('/', (_req: Request, res: Response) => {
    try {
      const model = userModel.get();
      res.json({ ok: true, profile: model });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || '读取用户档案失败' });
    }
  });

  /**
   * POST /v1/profile
   * 更新用户身份 (Onboarding 完成后直接调用, 或 chat 侧同步)
   * Body: { name, industry, useCase, questionnaire, industrySkills, onboardedAt }
   */
  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, industry, useCase, questionnaire, industrySkills, onboardedAt } = req.body || {};

      if (name || industry || useCase || industrySkills) {
        userModel.setIdentity({
          ...(name ? { name } : {}),
          ...(industry ? { industry } : {}),
          ...(useCase ? { role: useCase } : {}),
          ...(industrySkills ? { industrySkills } : {}),
          ...(onboardedAt ? { onboardedAt } : {}),
        });
      }

      // 行业切换时激活行业引擎
      if (industry && _industryEngine) {
        _industryEngine.activate(industry);
        console.log(`[profile] industry switched to: ${industry}`);
      }

      // 问卷答案独立持久化到 ~/.agentai/questionnaire.json
      if (questionnaire && typeof questionnaire === 'object' && Object.keys(questionnaire).length > 0) {
        const qPath = path.join(AGENTAI_DIR, 'questionnaire.json');
        if (!fs.existsSync(AGENTAI_DIR)) fs.mkdirSync(AGENTAI_DIR, { recursive: true });
        fs.writeFileSync(qPath, JSON.stringify({
          industry: industry || '',
          answers: questionnaire,
          updatedAt: Date.now(),
        }, null, 2), 'utf-8');

        // 同时写入 UserModel 的 identity (用于 system prompt 注入)
        userModel.setIdentity({ questionnaire });
      }

      // 开发偏好持久化到项目 .agentai/profile.json
      const { devPrefs } = req.body || {};
      if (devPrefs && typeof devPrefs === 'object') {
        try {
          const ws = require('../workspace-manager.js').WorkspaceManager.getInstance().projectDir;
          const profileDir = path.join(ws, '.agentai');
          if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
          const profilePath = path.join(profileDir, 'profile.json');
          let existing: any = {};
          try { existing = JSON.parse(fs.readFileSync(profilePath, 'utf-8')); } catch { /* new file */ }
          existing.devPrefs = devPrefs;
          existing.updatedAt = Date.now();
          fs.writeFileSync(profilePath, JSON.stringify(existing, null, 2), 'utf-8');
          console.log(`[profile] devPrefs saved: ${JSON.stringify(devPrefs).slice(0, 100)}`);
        } catch (e: any) { console.warn('[profile] devPrefs save failed:', e?.message); }
      }

      const updated = userModel.get();
      res.json({ ok: true, profile: updated.identity });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || '更新用户档案失败' });
    }
  });

  return router;
}
