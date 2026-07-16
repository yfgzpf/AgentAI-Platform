/**
 * Cleaner Routes - 智能清理器 HTTP API
 * ----------------------------------------------------
 *   GET  /v1/cleaner/status   → 获取清理器状态
 *   GET  /v1/cleaner/rules    → 获取规则列表
 *   POST /v1/cleaner/scan     → 触发扫描 (scope: safe)
 *   POST /v1/cleaner/confirm  → 确认/拒绝风险计划
 *   POST /v1/cleaner/heartbeat → 上报用户心跳
 */
import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { CleanerDaemon } from '../cleaner/index.js';
import { loadRules } from '../cleaner/rule-engine.js';
import { stateDir } from '../cleaner/state.js';
import type { Rule } from '../cleaner/types.js';

export interface CleanerRouterDeps {
  workspace?: string;
}

let daemonInstance: CleanerDaemon | null = null;

/** 获取或创建清理器守护进程单例 */
async function getDaemon(workspace: string): Promise<CleanerDaemon> {
  if (daemonInstance) return daemonInstance;

  // 加载规则文件
  let rules: Rule[] = [];
  const rulesPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '../cleaner/rules.json');
  try {
    if (fs.existsSync(rulesPath)) {
      rules = await loadRules(rulesPath);
    }
  } catch (e: any) {
    console.warn('[cleaner-route] failed to load rules.json:', e?.message);
  }

  daemonInstance = new CleanerDaemon({
    rules,
    stateDir: stateDir(),
    scanRoots: [workspace || process.cwd()],
    workspace: workspace || process.cwd(),
    audit: {
      log: async (entry) => {
        console.log(`[cleaner-audit] ${entry.action}:`, entry.payload || '');
      },
    },
  });

  await daemonInstance.start();
  console.log(`[cleaner-route] daemon started, ${rules.length} rules loaded`);
  return daemonInstance;
}

export function createCleanerRouter(deps?: CleanerRouterDeps): Router {
  const r = Router();
  const workspace = deps?.workspace || process.cwd();

  /** GET /v1/cleaner/status */
  r.get('/v1/cleaner/status', async (_req: Request, res: Response) => {
    try {
      const daemon = await getDaemon(workspace);
      const state = await daemon.getState();
      res.json(state);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'failed to get cleaner status' });
    }
  });

  /** GET /v1/cleaner/rules */
  r.get('/v1/cleaner/rules', async (_req: Request, res: Response) => {
    try {
      const rulesPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '../cleaner/rules.json');
      let rules: any[] = [];
      if (fs.existsSync(rulesPath)) {
        rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
      }
      res.json({ rules });
    } catch (e: any) {
      res.status(500).json({ rules: [], error: e?.message });
    }
  });

  /** POST /v1/cleaner/scan — 触发扫描 */
  r.post('/v1/cleaner/scan', async (req: Request, res: Response) => {
    try {
      const daemon = await getDaemon(workspace);
      const scope = (req.body?.scope as 'safe' | 'all' | 'risky') || 'safe';
      const result = await daemon.runOnce({ scope });
      res.json({
        ok: true,
        bytesFreed: result.bytesFreed,
        riskyCount: result.riskyCount,
        alertCount: result.alertCount,
        scannedCount: result.scannedCount,
        failures: result.failures,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'scan failed' });
    }
  });

  /** POST /v1/cleaner/confirm — 确认/拒绝风险计划 */
  r.post('/v1/cleaner/confirm', async (req: Request, res: Response) => {
    try {
      const { planId, action } = req.body || {};
      if (!planId || !action) {
        return res.status(400).json({ ok: false, error: 'planId and action required' });
      }
      const daemon = await getDaemon(workspace);
      const result = await daemon.confirmPlan(planId, action);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'confirm failed' });
    }
  });

  /** POST /v1/cleaner/heartbeat — 上报用户心跳 */
  r.post('/v1/cleaner/heartbeat', async (_req: Request, res: Response) => {
    try {
      const daemon = await getDaemon(workspace);
      daemon.reportUserHeartbeat();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return r;
}
