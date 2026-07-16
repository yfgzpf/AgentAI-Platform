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
import { industryEngine } from '../industry-engine.js';
import { WorkspaceManager } from '../workspace-manager.js';

let _industryEngine: any = industryEngine;

/** 注入行业引擎 (由 index.ts 调用) */
export function setIndustryEngine(ie: any) { _industryEngine = ie; }

const AGENTAI_DIR = path.join(os.homedir(), '.agentai');

export function createProfileRouter(): Router {
  const router = Router();

  /**
   * GET /v1/profile
   * 读取当前用户模型的完整数据
   */
  router.get('/', (req: Request, res: Response) => {
    try {
      const uid = (req.query.userId as string) || 'default';
      const model = userModel.get(uid);
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
      const uid = req.body.userId || 'default';

      if (name || industry || useCase || industrySkills) {
        userModel.setIdentity(uid, {
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
        userModel.setIdentity(uid, { questionnaire });
      }

      // 开发偏好持久化到项目 .agentai/profile.json
      const { devPrefs } = req.body || {};
      if (devPrefs && typeof devPrefs === 'object') {
        try {
          const ws = WorkspaceManager.getInstance().projectDir;
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

      const updated = userModel.get(uid);
      res.json({ ok: true, profile: updated.identity });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || '更新用户档案失败' });
    }
  });

  /**
   * GET /v1/industries
   * 返回所有行业配置列表 (含主题色/图标/技能数)
   */
  router.get('/industries', (req: Request, res: Response) => {
    try {
      const all = _industryEngine?.getAllIndustries?.() || [];
      const list = all.map((c: any) => ({
        id: c.id,
        label: c.label,
        theme: c.theme || null,
        skillCount: c.skills?.length || 0,
        supportedFormats: c.supportedFormats || [],
      }));
      res.json({ ok: true, industries: list });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || '获取行业列表失败' });
    }
  });

  /**
   * POST /v1/profile/update
   * 轻量更新用户偏好 (模型选择等), 不触发行业引擎切换
   * Body: { preferredModel, replyStyle, userId }
   */
  router.post('/update', (req: Request, res: Response) => {
    try {
      const { preferredModel, replyStyle, userId, syncAll } = req.body || {};
      const uid = userId || 'default';
      if (preferredModel) {
        // syncAll: 同步到所有已知用户 (GUI 切换模型时需要同步微信/QQ 远程渠道)
        if (syncAll) {
          const allIds = userModel.listUserIds();
          for (const id of ['default', ...allIds]) {
            userModel.setPreference(id, 'preferredModel', preferredModel);
          }
          console.log(`[profile] synced preferredModel=${preferredModel} to all users (count=${allIds.length + 1})`);
        } else {
          userModel.setPreference(uid, 'preferredModel', preferredModel);
        }
      }
      if (replyStyle) {
        userModel.setPreference(uid, 'replyStyle', replyStyle);
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || '更新偏好失败' });
    }
  });

  return router;
}
