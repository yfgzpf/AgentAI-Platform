/**
 * /v1/system/capabilities — 环境能力探测（2026-10-16 打包/部署加固）
 * ============================================================================
 * 为什么需要这个端点:
 * 打包成桌面版（不捆绑 git）或部署到 Docker（镜像内无 .git）时，
 * **部分能力会静默不可用**。以前用户只能在运行时看到 "spawnSync git ENOENT"
 * 这种天书，或者"建了 worktree 但没生效"这种更糟的假象。
 *
 * 这个端点把"当前环境能做什么、不能做什么、为什么、以及有什么替代方案"
 * 一次性说清楚，前端启动时拉一次即可展示能力面板，避免用户踩坑。
 *
 * 覆盖的能力:
 *   - git: 是否装、版本、路径、探测方式
 *   - worktree: 需要 git + 需要当前目录是仓库
 *   - checkpoint/rewind: 存储位置、可用性、剩余保留策略
 *   - 存储根目录: AGENTAI_HOME 实际解析到哪（部署排障第一现场）
 *   - 运行时: 平台、架构、Node 版本
 */

import { Router, type Request, type Response } from 'express';
import * as fsm from 'node:fs';
import { gitEnvCheck } from '../git-runtime.js';
import { worktreeCapability } from '../worktree.js';
import { sessionCheckpointUsage } from '../session-checkpoint.js';
import { resolveAgentAiHome } from '../workspace-manager.js';
import { currentRequestWorkspace } from '../request-scope.js';

const router = Router();

interface CapabilityItem {
  /** 能力标识 */
  key: string;
  /** 是否可用 */
  available: boolean;
  /** 面向用户的名称 */
  name: string;
  /** 不可用时的原因（中文，可直接展示） */
  reason?: string;
  /** 给用户的替代方案 */
  hint?: string;
  /** 补充细节 */
  detail?: Record<string, unknown>;
}

router.get('/', async (_req: Request, res: Response) => {
  const caps: CapabilityItem[] = [];

  // ── 存储根目录（排障第一现场，先算出来） ──
  const aiHome = resolveAgentAiHome();
  const ws = (() => {
    try { return currentRequestWorkspace() || process.cwd(); } catch { return process.cwd(); }
  })();

  // ── git ──
  const git = await gitEnvCheck();
  caps.push({
    key: 'git',
    available: git.available,
    name: 'Git',
    reason: git.reason,
    hint: git.available ? undefined : '安装后重启即生效。Git 是任务隔离（worktree）、会话锚点、依赖检查等能力的基础。',
    detail: { version: git.version, bin: git.bin, source: git.source },
  });

  // ── worktree（需要 git + 需要是 git 仓库） ──
  const wt = await worktreeCapability(ws);
  caps.push({
    key: 'worktree',
    available: wt.available,
    name: '任务隔离 (Git Worktree)',
    reason: wt.reason,
    hint: wt.hint,
    detail: {
      worktreeRoot: wt.worktreeRoot,
      repoPath: wt.repoPath,
      // 仓库有未提交改动 → 建 worktree 的基线会与用户工作区不一致，值得提示
      dirty: wt.dirty,
    },
  });

  // ── 会话 checkpoint / rewind ──
  const cpEnabled = (process.env.SESSION_CHECKPOINT_ENABLED || 'true').toLowerCase() !== 'false';
  let cpDetail: Record<string, unknown> = { enabled: cpEnabled };
  let cpOk = cpEnabled;
  let cpReason: string | undefined;
  if (!cpEnabled) {
    cpReason = '会话级 checkpoint 已被 SESSION_CHECKPOINT_ENABLED=false 关闭';
  } else {
    try {
      // usage 会读磁盘 —— 目录不可写（容器卷权限问题）在这里就会暴露
      const usage = sessionCheckpointUsage('__capability_probe__');
      cpDetail = { enabled: true, ...usage as Record<string, unknown> };
      cpDetail.root = process.env.AGENTAI_CHECKPOINT_ROOT
        ? `${process.env.AGENTAI_CHECKPOINT_ROOT} (由环境变量指定)`
        : `${aiHome}/checkpoints`;
      cpDetail.keep = Number(process.env.SESSION_CHECKPOINT_KEEP || 100);
      cpDetail.retentionDays = Number(process.env.SESSION_CHECKPOINT_RETENTION_DAYS || 30);
    } catch (e: any) {
      cpOk = false;
      cpReason = `checkpoint 存储不可访问: ${e?.message || e}`;
      cpDetail = { enabled: true, root: `${aiHome}/checkpoints` };
    }
  }
  caps.push({
    key: 'checkpoint',
    available: cpOk,
    name: '会话级回退 (Checkpoint / Rewind)',
    reason: cpReason,
    hint: cpOk ? undefined : '会话内改错无法秒退。检查 AGENTAI_HOME 指向的目录是否可写（容器场景尤其常见）。',
    detail: cpDetail,
  });

  res.json({
    ok: true,
    // 汇总：前端一次判断是否需要提示用户
    summary: {
      total: caps.length,
      available: caps.filter(c => c.available).length,
      unavailable: caps.filter(c => !c.available).map(c => c.key),
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      /** 是否跑在容器里（影响路径预期：/app/.agentai 而非 %USERPROFILE%/.agentai） */
      inContainer: fsm.existsSync('/.dockerenv'),
    },
    storage: {
      /** AGENTAI_HOME 实际解析结果 —— 部署排障第一现场 */
      aiHome,
      aiHomeSource: process.env.AGENTAI_HOME ? 'AGENTAI_HOME 环境变量' : '默认 <userHome>/.agentai',
      platformDefault: `${process.platform === 'win32' ? 'C:\\Users\\<用户>\\.agentai' : '~/.agentai'}`,
    },
    workspace: ws,
    capabilities: caps,
  });
});

export { router as systemCapabilityRouter };
