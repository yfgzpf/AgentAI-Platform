// @ts-nocheck
/**
 * Chat Routes - 主对话 API (含 SSE 流式 + MasterController 编排)
 * 提取自 index.ts, 包含 /v1/chat 端点
 * v2: MasterController 前置 → 意图理解→规划→分派子Agent
 */
import { Router, Request, Response } from 'express';
import type { AgentAIRouter } from '../llm-router.js';
import { isFreeProvider } from '../llm-router.js';
import type { ToolRegistry } from '../tool-registry.js';
import { AgentAILoop, addTrustedPattern, getTrustedPatterns, removeTrustedPattern } from '../agentai-loop.js';
import { MasterController } from '../master-controller.js';
import { writeMemory, readMemory } from '../memory.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WorkspaceManager } from '../workspace-manager.js';
import { RateLimiter } from '../rate-limit.js';
// [灰度测试] 新模型选择器 - 通过 FEATURE_FLAGS 控制启用
import * as modelSelector from '../model-selector.js';
import { FEATURE_FLAGS, shouldUseNewModelSelector } from '../feature-flags.js';
// [诊断优先] PulseFlow Xuanji 认知框架
import { Xuanji } from '../xuanji/index.js';
// [模型工厂] 单一真源: alrc-* / alrc:* / factory-* 三种 id 形态全从这里派生
import { FACTORY_MODEL_ENTRIES } from '../factory-registry.js';
import { getCostTracker, CostTracker } from '../cost/index.js';
import { analyzeGaps } from '../diagnosis/gap-analyzer-llm.js';

// Xuanji 实例
const xuanji = new Xuanji({
  enableMedicalCase: true,
  enableSimilarCaseSearch: true,
  enableAutoEvaluation: true,
});

// 速率限制器: 动态区分内部/外部调用
const limiter = new RateLimiter();

/** monorepo 根目录 (gateway 在 packages/agentai-gateway, 向上两级) */
const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');

export interface ChatRouterDeps {
  router: AgentAIRouter;
  registry: ToolRegistry;
  sessionManager: any;  // SessionManager
  frameworkSwitcher?: any; // FrameworkSwitcher
  persistentMemory?: any; // PersistentMemory
  fts5Memory?: any;  // FTS5Memory
  userModel?: any;   // UserModel
  industryEngine?: any; // IndustryEngine
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const r = Router();
  const { router, registry, sessionManager, frameworkSwitcher, persistentMemory, fts5Memory, userModel, industryEngine } = deps;

  // 定期同步可用 provider 数量到 limiter (每 30 秒)
  setInterval(() => {
    const available = Array.from((router as any).providers?.values() || [])
      .filter((p: any) => !p.tripped).length;
    limiter.setAvailableProviders(Math.max(1, available));
  }, 30_000);

  // 活跃loop追踪 — 用于中断正在运行的任务
  const activeLoops = new Map<string, { loop: AgentAILoop; abort: () => void }>();

  /**
   * 迭代轮数「天花板」— 2026-10-12
   * ============================================================
   * 修复前: 本文件 5 处 loop 构造都写死 `maxIterations: 30` (普通对话路径更是只有 10)。
   *   而 AgentAILoop 的 G4 闸门用的就是这个值 ⇒ 它**冒充了模型预算**, 把能力层算出的
   *   autonomous=90 / guided=70 / supervised=50 全部压掉 (能力层那个值原先只打印、不生效)。
   *   症状: 用户显式选 DeepSeek 4.1 (能力层认定 90 轮) 做长任务, 实际 30 轮就被要求收尾。
   * 现在: loop 内部取 `min(能力层值, opts.maxIterations)` (见 agentai-loop.ts「能力层的迭代预算
   *   真正生效」), 所以这里传的语义是**上限封顶**而非模型预算。90 = autonomous 档的上界,
   *   即"不额外限制", 真正的轮数交给能力层裁决。
   * 有意设置小预算的调用方 (subagent 10 / goal-runner 20 / master-controller 20) 不受影响 —— min 只会收紧。
   */
  const MAX_ITERATION_CEILING = 90;

  // 待审批计划存储 — 规划模式审批后等待用户确认
  const pendingPlans = new Map<string, { execPlan: any; message: string; userId: string; workspace: string; sessionId: string; profile?: any; model?: string; displayModel: string }>();

  // 中断当前任务端点
  r.post('/v1/chat/abort', (req: Request, res: Response) => {
    const { sessionId } = req.body || {};
    const key = sessionId || 'default';
    const entry = activeLoops.get(key);
    if (entry) {
      entry.abort();
      activeLoops.delete(key);
      res.json({ ok: true, message: '任务已中断' });
    } else {
      res.json({ ok: true, message: '无活跃任务' });
    }
  });

  /**
   * 审批端点 — 处理两种审批:
   * 1. 文件修改审批 (approvalId 非空): 通知 loop 继续/拒绝
   * 2. 规划模式审批 (approvalId 为空, pendingPlans 有数据): 确认执行计划
   */
  r.post('/v1/chat/approve', async (req: Request, res: Response) => {
    try {
      const { sessionId, approvalId, decision } = req.body || {};
      const key = sessionId || 'default';

      // Case 1: 文件修改审批 → 通过 loop.resolveApproval 解决等待
      if (approvalId) {
        const entry = activeLoops.get(key);
        if (entry?.loop) {
          const ok = entry.loop.resolveApproval(approvalId, decision === 'approve');
          if (ok) {
            res.json({ ok: true, message: decision === 'approve' ? '已批准' : '已拒绝' });
          } else {
            res.status(404).json({ ok: false, error: '审批ID不存在或已过期' });
          }
          return;
        }
        // loop 可能已结束但审批还没来，尝试所有 activeLoops
        for (const [, e] of activeLoops) {
          if (e.loop.resolveApproval(approvalId, decision === 'approve')) {
            res.json({ ok: true, message: decision === 'approve' ? '已批准' : '已拒绝' });
            return;
          }
        }
        res.status(404).json({ ok: false, error: '未找到对应的活跃任务' });
        return;
      }

      // Case 2: 规划模式审批 → 从 pendingPlans 取出并执行
      const plan = pendingPlans.get(key);
      if (plan) {
        pendingPlans.delete(key);
        if (decision === 'approve') {
          // 异步执行已批准的计划
          executePlan(plan, deps).then(
            () => res.json({ ok: true, message: '计划已开始执行' }),
            (err: any) => res.status(500).json({ ok: false, error: err?.message || '执行失败' }),
          );
        } else {
          res.json({ ok: true, message: '计划已取消', rejected: true });
        }
        return;
      }

      res.status(404).json({ ok: false, error: '无待审批项' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || '审批处理失败' });
    }
  });

  // ═══ 审批白名单路由 ═══
  /** GET /v1/trusted-commands — 获取已信任的命令模式 */
  r.get('/v1/trusted-commands', (_req: Request, res: Response) => {
    res.json({ patterns: getTrustedPatterns() });
  });

  /** POST /v1/trusted-commands — 添加信任模式 */
  r.post('/v1/trusted-commands', (req: Request, res: Response) => {
    const { toolName, pathPattern } = req.body || {};
    if (!toolName || !pathPattern) {
      res.status(400).json({ error: 'toolName and pathPattern required' });
      return;
    }
    addTrustedPattern(toolName, pathPattern);
    res.json({ ok: true, patterns: getTrustedPatterns() });
  });

  /** DELETE /v1/trusted-commands — 移除信任模式 */
  r.delete('/v1/trusted-commands', (req: Request, res: Response) => {
    const { toolName, pathPattern } = req.body || {};
    if (!toolName || !pathPattern) {
      res.status(400).json({ error: 'toolName and pathPattern required' });
      return;
    }
    removeTrustedPattern(toolName, pathPattern);
    res.json({ ok: true, patterns: getTrustedPatterns() });
  });

// 行业激活 (支持动态切换)
let currentIndustryId = '';
const tryActivateIndustry = async (reqBody: any) => {
    if (!industryEngine) return;
    const profile = reqBody?.profile;
    const newIndustry = profile?.industry || 'general';
    // 行业变化时重新激活
    if (newIndustry !== currentIndustryId) {
      const config = await industryEngine.activate(newIndustry);
      if (config) {
        // 注册行业技能到 ToolRegistry
        for (const skill of config.skills) {
          registry.register({
            name: skill.name,
            description: skill.description,
            parameters: {
              type: 'object',
              properties: {
                args: {
                  type: 'object',
                  description: skill.description,
                  additionalProperties: true,
                },
              },
              additionalProperties: true,
            },
            parallelSafe: true,
            riskLevel: 'low',
            handler: skill.handler,
          });
        }
        currentIndustryId = newIndustry;
        console.log(`[industry] activated: ${newIndustry}, +${config.skills.length} tools`);
      } else if (newIndustry === 'general') {
        // 切回通用: 清除行业状态
        currentIndustryId = 'general';
        console.log(`[industry] switched to general (no industry)`);
      }
    }
  };


  r.post('/v1/chat', async (req: Request, res: Response) => {
    const { message, userId = 'default', workspace: rawWorkspace, projectDir: rawProjectDir, framework, stream = false, profile, model: requestModel, emotion, contextWindow, _internal, attachments, thinking, systemRules, modelConfig, activeFile, taskId: requestTaskId, auto, contextInject, mode } = req.body;
    // SSE 断线恢复: 前端重试时带 _retry + _receivedDelta
    const isRetry = !!(req.body as any)._retry;
    const receivedDelta: string = (req.body as any)._receivedDelta || '';

    console.log(`[chat] ➡️ POST /v1/chat | userId=${userId} stream=${stream} model=${requestModel || 'default'} msgLen=${(message || '').length}${isRetry ? ` RETRY (已收 ${receivedDelta.length} 字)` : ''}`);

    // ═══ 智能核心: 多模型自动路由 ═══
    // 当用户没有指定模型时, 根据消息内容自动选择最优模型
    var effectiveModel: string | undefined = requestModel;
    if (!effectiveModel || effectiveModel === 'default' || effectiveModel === 'auto') {
      try {
        const { autoRouteModel } = await import('../intelligent-core.js');
        // 获取可用模型列表
        const router = Router.getInstance();
        const availableModels = Array.from(router.providers.keys()).filter(id => {
          const p = router.providers.get(id);
          return p && !p.tripped;
        });
        const routing = autoRouteModel(message || '', availableModels);
        if (routing.modelId && routing.confidence > 0.5) {
          effectiveModel = routing.modelId;
          console.log(`[chat] 🧠 智能路由: ${routing.taskType} → ${routing.modelId} (${routing.reason}, 置信度 ${(routing.confidence * 100).toFixed(0)}%)`);
        }
      } catch { /* 智能路由失败不影响主流程 */ }
    }

    // 速率限制检查 (内部调用使用更高限制)
    const isInternalReq = !!_internal;
    const rl = limiter.check(userId, isInternalReq);
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter || 60));
      return res.status(429).json({ error: rl.reason, retryAfter: rl.retryAfter });
    }

    try {
      // 允许纯图片消息: 有附件时 message 可以为空
      if (!message && (!attachments || attachments.length === 0)) {
        return res.status(400).json({ error: 'message required' });
      }

      // 动态确定工作区: projectDir > workspace > 全局单例
      // ═══ 2026-10-06 P0 修复: 不再改写全局单例 ═══
      // 原来这里调 wm.setProjectDir(rawProjectDir) 写**进程级**状态，
      // 而 tools.ts 有 48 处读 wm().projectDir 当路径基准 →
      //   请求A 改 projA → 请求B 改 projB → A 的下一轮工具在 projB 上读写并 git commit
      // 症状: 用户看到"AI 在别的项目里乱改文件"。
      //
      // 现在: 只为**本次请求**解析 workspace，请求作用域内所有工具都读它
      //（见 request-scope.ts 的 ALS 机制 + tools.ts 的 ws() 辅助函数）。
      // 全局单例保持不变，仅用于「用户当前选中的目录」这一 UI 语义。
      const wm = WorkspaceManager.getInstance();
      let workspace = wm.projectDir;
      if (rawProjectDir && fs.existsSync(rawProjectDir)) {
        workspace = path.resolve(rawProjectDir);
      } else if (rawWorkspace && fs.existsSync(rawWorkspace)) {
        workspace = path.resolve(rawWorkspace);
      }
      if (!fs.existsSync(workspace)) {
        console.warn(`[chat] project dir "${workspace}" not found, falling back to cwd`);
        workspace = process.cwd();
      }

      // 行业激活 (从用户传入的 profile 读取)
      await tryActivateIndustry(req.body);

      // 更新用户身份 (从 profile 读取完整数据: 姓名/行业/用例/技能)
      if (userModel && profile) {
        if (profile.name) {
          userModel.setIdentity(userId, {
            name: profile.name,
            industry: profile.industry,
            role: profile.useCase,
            industrySkills: profile.industrySkills,
            onboardedAt: profile.onboardedAt,
          });
        }
        // 持久化问卷答案到 ~/.agentai/questionnaire.json
        if (profile.questionnaire && typeof profile.questionnaire === 'object' && Object.keys(profile.questionnaire).length > 0) {
          try {
            const qPath = path.join(os.homedir(), '.agentai', 'questionnaire.json');
            const qDir = path.dirname(qPath);
            if (!fs.existsSync(qDir)) fs.mkdirSync(qDir, { recursive: true });
            fs.writeFileSync(qPath, JSON.stringify({
              industry: profile.industry || '',
              answers: profile.questionnaire,
              updatedAt: Date.now(),
            }, null, 2), 'utf-8');
          } catch (e: any) {
            console.warn('[chat] questionnaire file write failed:', e?.message);
          }
          // 同步问卷到 UserModel identity (独立 try-catch, 避免 userModel 内部异常影响文件写入)
          try {
            userModel.setIdentity(userId, { questionnaire: profile.questionnaire });
          } catch (e: any) {
            console.warn('[chat] questionnaire userModel sync failed:', e?.message);
          }
        }
      }

      // FTS5: 记录用户消息
      if (fts5Memory) {
        fts5Memory.recordMessage({ sessionId: userId, userId, workspace, role: 'user', content: message }).catch(() => {});
      }

      // 记录任务开始时间
      const startTime = Date.now();
      
      // ═══════════════════════════════════════════════════════════
      // [成本控制] PulseFlow - 初始化成本追踪
      // ═══════════════════════════════════════════════════════════
      const costTracker = getCostTracker();
      const taskId = `${userId}-${startTime}`;
      costTracker.startTask(taskId, userId, userId, 'chat', 'simple');
      
      // 监听成本告警
      costTracker.on('alert', (alert) => {
        console.warn(`[cost-alert] ${alert.severity}: ${alert.message}`);
      });
      // ═══════════════════════════════════════════════════════════
      
      // ═══════════════════════════════════════════════════════════
      // [诊断优先] PulseFlow Xuanji - 四诊合参，辨证论治
      // ═══════════════════════════════════════════════════════════
      let diagnosisResult: any;
      let xuanjiCaseId: string | undefined;
      
      if (FEATURE_FLAGS.enableDiagnosisPipeline && !auto) {
        try {
          const diagnoseStart = Date.now();
          console.log(`[xuanji] 🔍 四诊合参 | message=${(message || '').slice(0, 50)}...`);
          
          // 使用 Xuanji 进行完整诊断
          const xuanjiResult = await xuanji.processTask(
            [{ role: 'user', content: message }],
            { projectPath: workspace }
          );
          
          xuanjiCaseId = xuanjiResult.caseId;
          
          // 转换 Xuanji 结果为原有格式（保持兼容）
          diagnosisResult = {
            strategy: xuanjiResult.diagnosis.recommendedApproach === 'direct' ? 'direct' : 
                     xuanjiResult.diagnosis.recommendedApproach === 'comprehensive' ? 'deep' : 'step_by_step',
            confidence: xuanjiResult.diagnosis.confidence,
            riskLevel: xuanjiResult.diagnosis.riskLevel,
            estimatedSteps: xuanjiResult.diagnosis.estimatedSteps,
            potentialBlockers: xuanjiResult.diagnosis.potentialBlockers,
            clarificationQuestions: [],
            // Xuanji 特有数据
            xuanji: {
              caseId: xuanjiResult.caseId,
              perception: xuanjiResult.perception,
              prescription: xuanjiResult.prescription,
              similarCases: xuanjiResult.similarCases,
            },
          };
          
          console.log(`[xuanji] ✅ 辨证完成 | approach=${xuanjiResult.diagnosis.recommendedApproach} confidence=${xuanjiResult.diagnosis.confidence.toFixed(2)} caseId=${xuanjiResult.caseId}`);
          
          // 记录诊断成本（望闻问切 - 四诊合参）
          costTracker.recordPhase(taskId, 'xuanji', 0, 'pulseflow', 'xuanji_framework', {
            approach: xuanjiResult.diagnosis.recommendedApproach,
            confidence: xuanjiResult.diagnosis.confidence,
            caseId: xuanjiResult.caseId,
            duration: Date.now() - diagnoseStart,
          });
          
          // ═══════════════════════════════════════════════════════════
          // [闻阶段] ALTES | 岐黄 - 缺口分析（免费轻量模型）
          // ═══════════════════════════════════════════════════════════
          if (diagnosisResult.strategy !== 'direct') {
            try {
              const wenStart = Date.now();
              console.log(`[diagnosis] 👂 闻阶段：缺口分析`);
              
              const gapResult = await analyzeGaps(message || '', router, { useLLM: true });
              
              // 记录闻阶段成本
              costTracker.recordPhase(taskId, 'wen', gapResult.tokensUsed, 'agentai-free', 'free_lightweight', {
                hasGaps: gapResult.hasGaps,
                gapCount: gapResult.gaps.length,
                duration: Date.now() - wenStart,
              });
              
              console.log(`[diagnosis] ✅ 缺口分析完成 | gaps=${gapResult.gaps.length} tokens=${gapResult.tokensUsed}`);
              
              // 如果LLM发现更多缺口，补充到诊断结果
              if (gapResult.hasGaps && gapResult.clarificationQuestions.length > 0) {
                diagnosisResult.clarificationQuestions = [
                  ...(diagnosisResult.clarificationQuestions || []),
                  ...gapResult.clarificationQuestions,
                ];
                diagnosisResult.strategy = 'clarify';
              }
              
            } catch (err: any) {
              console.warn(`[diagnosis] ⚠️ 缺口分析失败: ${err.message}`);
              // 失败不影响主流程
            }
          }
          // ═══════════════════════════════════════════════════════════
          
          // 策略：先澄清
          if (diagnosisResult.strategy === 'clarify' && diagnosisResult.clarificationQuestions) {
            console.log(`[diagnosis] ⚠️ 需要澄清 | questions=${diagnosisResult.clarificationQuestions.length}`);

            // 记录问阶段成本
            costTracker.recordPhase(taskId, 'ask', 0, 'template', 'rule_based');

            if (!stream) {
              // 结束任务并返回
              const summary = costTracker.endTask(taskId);
              return res.json({
                type: 'clarification_needed',
                questions: diagnosisResult.clarificationQuestions,
                reason: diagnosisResult.reason,
                costSummary: summary,
              });
            }
            // 流式模式下发送澄清事件 + return（防止同时调 LLM）
            sendEvent('clarification_needed', {
              questions: diagnosisResult.clarificationQuestions,
              reason: diagnosisResult.reason,
            });
            // 安全守护: H1 修复 — 真阻塞，避免用户看到追问卡片但 AI 自行作答
            if (stream && res.writableEnded === false) {
              try { res.end(); } catch {}
            }
            return; // 关键：不再继续 LLM
          }
          
        } catch (err: any) {
          console.error(`[diagnosis] ❌ 诊断失败: ${err.message}`);
          // 诊断失败不影响主流程
        }
      }
      // ═══════════════════════════════════════════════════════════

      // ====== SSE 流式 ======
      if (stream === true) {
        // 禁用 Nagle 算法: 每个 SSE 数据包立即发送, 不因 TCP 缓冲而延迟
        req.socket?.setNoDelay?.();
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        // SSE 断线恢复: 如果是重试, 先发送 resume 事件告知前端
        if (isRetry && receivedDelta) {
          try { res.write(`event: resume\ndata: ${JSON.stringify({ received: receivedDelta.length, msg: 'SSE 断线恢复中...' })}\n\n`); } catch {}
        }

const sendEvent = (event: string, data: any) => {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e: any) {
    // SSE 连接已关闭, 静默忽略 — 防止 broken pipe 崩溃整个请求
  }
};

        // ====== SSE keep-alive ======
        // 5 秒心跳: 防止 Nginx/防火墙/浏览器在长 LLM 调用时断连
        const keepAliveTimer = setInterval(() => {
          try { res.write(': heartbeat\n\n'); } catch { /* conn already closed */ }
        }, 5_000);

        // ====== 新消息压制旧对话: 不再排队等待, 直接终止前一个任务 ======
        const sessionKey = `${userId}:${workspace}`;
        const prevEntry = activeLoops.get(sessionKey);
        // P0 修复: ask_user 答案不走压制模式 — 旧 loop 的上下文必须保留
        // 前端发送 isAnswer=true 表示这是对 AI 追问的回答, 不应杀掉旧 loop
        const isAnswer = req.body.isAnswer === true;
        if (prevEntry && !isAnswer) {
          console.log(`[chat] 🛑 压制前一个未完成的对话 | session=${sessionKey}`);
          try { prevEntry.abort(); } catch {}
          activeLoops.delete(sessionKey);
        } else if (prevEntry && isAnswer) {
          console.log(`[chat] 📎 ask_user 答案, 保留旧 session 上下文 | session=${sessionKey}`);
          // 不 abort 旧 loop, 但需要让旧 loop 知道答案已到 (通过 persistentMemory 注入)
        }
        // 释放前一个队列 (如果有), 让本次请求立即通过
        const queueKey = `queue:${userId}:${workspace}`;
        if ((global as any).__msgQueues) {
          const prevResolve = (global as any).__msgQueues.get(queueKey + '_resolve');
          if (typeof prevResolve === 'function') { try { prevResolve(); } catch {} }
        }

        // 建立本请求的队列占位 (供下一个请求压制用)
        let queueReleased = false;
        const releaseQueue = () => { if (!queueReleased) { queueReleased = true; try { (global as any).__msgQueues?.set(queueKey + '_resolve', null); } catch {} } };
        if (!(global as any).__msgQueues) (global as any).__msgQueues = new Map();
        (global as any).__msgQueues.set(queueKey + '_resolve', releaseQueue);

        // 客户端断开时: 清心跳 + 释放队列
        req.on('close', () => {
          clearInterval(keepAliveTimer);
          releaseQueue();
        });

        console.log(`[chat] ✅ queue passed (supersede mode), starting model selection`);

        // ====== 模型映射: 前端 ID → provider + subModel ======
        const MODEL_MAP: Record<string, { provider: string; subModel?: string; label: string; baseURL?: string; contextWindow?: number }> = {
          // ===== Agnes AI (首选) — provider 统一用 'agentai', 因为 providers Map 中注册的是 'agentai' =====
          'agnes-2.5-flash': { provider: 'agentai', subModel: 'agnes-2.5-flash', label: 'Agnes 2.5 Flash (首选)', contextWindow: 512000 },
          // 2026-10-12: agnes-2.0 官方已下架 (实测 HTTP 503「无可用渠道」) → 保留 id 做别名指向活的 2.5-flash。
          // 沿用 deepseek-v4-pro 的处理方式: 老客户端/老持久化发这个 id 时静默降级, 不再 503。
          'agnes-2.0': { provider: 'agentai', subModel: 'agnes-2.5-flash', label: 'Agnes 2.5 Flash (原 2.0 别名)', contextWindow: 512000 },
          // ===== 基础免费模型 =====
          'agentai': { provider: 'agentai', label: '岐枢 Free (Flash)', contextWindow: 512000 },
          'zhipu': { provider: 'zhipu', subModel: 'glm-4.7-flash', label: '智谱 GLM-4.7 Flash', contextWindow: 200000 },
          // ===== DeepSeek (前端 id + 旧兼容 id) =====
          'deepseek': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)', contextWindow: 1000000 },
          // 2026-10-11: pro 官方已下线 → 两个 pro id 保留为别名, 指向 deepseek-flash (旧配置静默降级)
          'deepseek-pro': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1, 原 Pro 别名)', contextWindow: 1000000 },
          'deepseek-flash': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)', contextWindow: 1000000 },
          'deepseek-v4-flash': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)', contextWindow: 1000000 },
          'deepseek-v4-pro': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1, 原 Pro 别名)', contextWindow: 1000000 },
          // ===== OpenAI =====
          'openai': { provider: 'openai', label: 'OpenAI GPT-4o', contextWindow: 128000 },
          'openai-gpt4o': { provider: 'openai', label: 'OpenAI GPT-4o', contextWindow: 128000 },
          // ===== 传统独立商业模型 (前端 id + 旧兼容 id) — 2026-09-05 窗口校准 =====
          'qwen': { provider: 'qwen', subModel: 'qwen-max', label: '通义千问 (阿里云)', contextWindow: 32768 },
          'qwen-max': { provider: 'qwen', subModel: 'qwen-max', label: '通义千问 Qwen-Max', contextWindow: 32768 },
          'moonshot': { provider: 'moonshot', subModel: 'kimi-k2.5', label: '月之暗面 Moonshot', contextWindow: 262144 },
          'moonshot-kimi': { provider: 'moonshot', subModel: 'kimi-k2.5', label: '月之暗面 Kimi', contextWindow: 262144 },
          'anthropic': { provider: 'anthropic', subModel: 'claude-sonnet-4-5-20250929', label: 'Anthropic Claude', contextWindow: 200000 },
          'anthropic-claude': { provider: 'anthropic', subModel: 'claude-sonnet-4-5-20250929', label: 'Anthropic Claude', contextWindow: 200000 },
          'minimax': { provider: 'minimax', subModel: 'MiniMax-M3', label: 'MiniMax', contextWindow: 245000 },
          'minimax-hailuo': { provider: 'minimax', subModel: 'MiniMax-M3', label: 'MiniMax 海螺', contextWindow: 245000 },
          // ===== 豆包/火山引擎 (前端 id) =====
          'doubao-seed-2.0-pro': { provider: 'doubao', subModel: 'doubao-seed-2.0-pro-250728', label: '豆包 Seed-2.0 Pro', contextWindow: 256000 },
          'doubao-1.5-thinking': { provider: 'doubao', subModel: 'doubao-1.5-thinking-vision-pro', label: '豆包 1.5 视觉深度思考', contextWindow: 256000 },
          // ===== 传统兼容 (已不再前端列表中列出, 但仍保留以支持旧持久化数据) =====
          'yi': { provider: 'yi', label: '零一万物 Yi' },
          'baichuan': { provider: 'baichuan', label: '百川智能' },
          // 商汤 SenseNova (免费额度)
          'sensenova-6.7-flash-lite': { provider: 'sensenova', subModel: 'sensenova-6.7-flash-lite', label: 'SenseNova 6.7 Flash-Lite' },
          'sensenova-u1-fast': { provider: 'sensenova', subModel: 'sensenova-u1-fast', label: 'SenseNova U1 Fast' },
          'sensenova-deepseek-v4-flash': { provider: 'sensenova', subModel: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (SenseNova)' },
          'sensenova-glm-5.2': { provider: 'sensenova', subModel: 'glm-5.2', label: 'GLM-5.2 (SenseNova)' },
          // 美团 LongCat (免费额度)
          'longcat-2.0': { provider: 'longcat', subModel: 'LongCat-2.0', label: 'LongCat-2.0' },
          // NVIDIA NIM 模型已移除 (2026-07-25): 需自建 GPU Docker + 端点不稳定 + 中国大陆不可达
        };

        // ===== 模型工厂条目注入 (2026-10-13) =====
        //
        // 原先这里手写了 40 行 alrc-* 条目 (含重复的 `alrc:` 冒号格式), 而
        // model-selector.ts 里另有一份**完全不重叠**的 alrc-* 清单 (那份是 gpt/claude/grok/nano-banana)。
        // 后果: 走老逻辑认识工厂国内模型, 走灰度新逻辑认识工厂 GPT 系 ——
        //        同一个网关, 工厂模型"时好时坏", 取决于命中哪条路径。
        // 现在统一从 factory-registry.ts 派生: 单一真源, 三种 id 形态 (alrc-* / alrc:* / factory-*) 全生成。
        // 新增工厂模型只改 factory-registry.ts 一处。
        Object.assign(MODEL_MAP, FACTORY_MODEL_ENTRIES);

        // 内置 id 快照 —— 必须在下方动态注册之前捕获:
        // 注册后 MODEL_MAP 会混入前端自定义模型, 就再也分不清"内置"和"自定义"了
        const BUILTIN_IDS = new Set(Object.keys(MODEL_MAP));

        // 动态注册自定义模型 (前端通过 modelConfig 传递)
        if (modelConfig && effectiveModel && !MODEL_MAP[effectiveModel]) {
          MODEL_MAP[effectiveModel] = {
            provider: modelConfig.provider || effectiveModel,
            subModel: modelConfig.modelName,
            label: modelConfig.modelName || effectiveModel,
            baseURL: modelConfig.baseURL,
          };
        }

        // ====== 智能模型选择: 检查 provider 是否可用 (欠费/无Key → 自动降级) ======
        // [灰度测试] 支持新旧逻辑切换
        function selectAvailableModel(requestedModel?: string): { provider: string; subModel?: string; label: string; fallback?: boolean; baseURL?: string } {
          const useNew = shouldUseNewModelSelector(userId);

          if (useNew) {
            // 新逻辑: 使用统一模型选择器
            const result = modelSelector.selectAvailableModel(requestedModel, router);
            if (FEATURE_FLAGS.enableModelSelectorDiff) {
              console.log(`[chat][灰度] 新模型选择器: ${result.provider}/${result.subModel || 'default'} (fallback=${result.fallback})`);
            }
            return result;
          }

          // 🔧 自定义模型优先: 仅当 requestedModel 不是内置 id 时, 才直接采信前端传入的 modelConfig
          // ⚠️ 内置 id 必须走 MODEL_MAP: 前端对每个模型都会带 modelConfig, 其 modelName 可能是**显示标签**
          //    (如 "DeepSeek Flash (V4.1, 1M)"), 若在此处采信, 它会被当成 API 模型名发给官方接口 → HTTP 400
          //    "The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed ..."
          if (requestedModel && !BUILTIN_IDS.has(requestedModel) && modelConfig?.baseURL && modelConfig?.provider) {
            console.log(`[chat] selectAvailableModel: 自定义模型 ${requestedModel} → ${modelConfig.provider}/${modelConfig.modelName || ''} (baseURL=${modelConfig.baseURL})`);
            return {
              provider: modelConfig.provider,
              subModel: modelConfig.modelName,
              label: modelConfig.modelName || requestedModel,
              baseURL: modelConfig.baseURL,
              fallback: false,
              contextWindow: modelConfig.contextWindow || 128000, // 自定义模型默认 128K
            };
          }

          // 旧逻辑: 保持原有实现 (验证稳定后删除)
          const mapped = MODEL_MAP[requestedModel || ''] || MODEL_MAP['agentai'];
          console.log(`[chat] selectAvailableModel: requested=${requestedModel}, mapped=${mapped.provider}/${mapped.subModel || 'default'}, inMap=${!!(requestedModel && MODEL_MAP[requestedModel])}`);
          const keyMap: Record<string, string> = {
            agnes: 'AGENTAI_API_KEY',
            agentai: 'AGENTAI_API_KEY',
            deepseek: 'DEEPSEEK_API_KEY',
            openai: 'OPENAI_API_KEY',
            zhipu: 'ZHIPU_API_KEY',
            alrc: 'ALRC_API_KEY',
            factory: 'FACTORY_CHAT_KEY',
            superapi: 'SUPERAPI_API_KEY',
            sensenova: 'SENSENOVA_API_KEY',
            longcat: 'LONGCAT_API_KEY',
            // nvidia: 'NVIDIA_API_KEY', 已移除
            qwen: 'DASHSCOPE_API_KEY',
            moonshot: 'MOONSHOT_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            minimax: 'MINIMAX_API_KEY',
            doubao: 'VOLCANO_API_KEY',
          };
          const envKey = keyMap[mapped.provider] || `${mapped.provider.toUpperCase()}_API_KEY`;
          // 2026-10-13 修复: alrc/factory 系列除了 ALRC_API_KEY, 还可能只配了**分组密钥**
          //   (Settings.tsx 的 6 个分组各自写入 FACTORY_CHAT_KEY / FACTORY_IMAGE_KEY / ...)。
          //   原实现只看 ALRC_API_KEY ⇒ 用户明明填了工厂密钥, 这里判定 hasKey=false
          //   ⇒ 无声降级到免费档, 症状是"选了商用模型却在用免费模型"。
          //   与 llm-router.ts:1515-1542 的分组密钥查找保持同一套变量名。
          const FACTORY_GROUP_ENVS = [
            'FACTORY_CHAT_KEY', 'FACTORY_GPT_KEY', 'FACTORY_CLAUDE_KEY',
            'FACTORY_GROK_KEY', 'FACTORY_IMAGE_KEY', 'FACTORY_VIDEO_KEY',
          ];
          const isFactoryProvider = mapped.provider === 'alrc' || mapped.provider === 'factory';
          const hasFactoryGroupKey = isFactoryProvider
            && FACTORY_GROUP_ENVS.some((k) => !!process.env[k]);
          const hasKey = !!process.env[envKey] || hasFactoryGroupKey;
          const providerStats = router['providers']?.get(mapped.provider);
          const isTripped = providerStats?.tripped === true;

          console.log(`[chat] model check: provider=${mapped.provider}, envKey=${envKey}, hasKey=${hasKey}, factoryGroupKey=${hasFactoryGroupKey}, tripped=${isTripped}`);

          if (hasKey && !isTripped) {
            return { ...mapped, fallback: false };
          }

          console.warn(`[chat] model ${mapped.provider} unavailable (key=${hasKey}, tripped=${isTripped}), falling back`);

          // ═══ 修复: 检查原 provider 是否只是限速冷却中 ═══
          // 如果原 provider (如 agentai) 只是因为 429 限速, 而非永久熔断, 优先让它恢复
          // 避免 agnes → zhipu → deepseek 的无效切换循环
          const originalStats = router['providers']?.get(mapped.provider);
          if (originalStats?.rateLimitCooldownUntil) {
            const now = Date.now();
            if (now >= originalStats.rateLimitCooldownUntil) {
              // 冷却已过期, 原 provider 已恢复 → 优先返回原 provider
              console.log(`[chat] model ${mapped.provider} rate limit expired, recovering → prefer original`);
              return { ...mapped, fallback: false };
            }
            const remainingSec = Math.ceil((originalStats.rateLimitCooldownUntil - now) / 1000);
            console.log(`[chat] model ${mapped.provider} rate-limited (⏳ ${remainingSec}s remaining), will retry after cooldown`);
          }

          const fallbackOrder = ['agentai', 'zhipu', 'deepseek'];
          for (const fb of fallbackOrder) {
            if (fb !== mapped.provider && process.env[keyMap[fb]] && !router['providers']?.get(fb)?.tripped) {
              const fbMapped = MODEL_MAP[fb];
              console.warn(`[chat] model ${mapped.provider} unavailable (key=${hasKey}, tripped=${isTripped}), falling back to ${fb}`);
              return { ...fbMapped, fallback: true, baseURL: undefined };
            }
          }
          return { ...MODEL_MAP['agentai'], fallback: mapped.provider !== 'agentai', baseURL: undefined };
        }

      try {
        const sessionKey = `${userId}:${workspace}`;
        let loop: any;
        let sessionId: string;
        const sessionData = sessionManager.getWithExtra?.(sessionKey) ?? sessionManager.get(sessionKey);
        if (!sessionData) {
          const selected = selectAvailableModel(effectiveModel);
          const userPickedModel = !!effectiveModel && effectiveModel in MODEL_MAP;
          loop = new AgentAILoop(router, registry, [], {
            maxIterations: MAX_ITERATION_CEILING, userId, workspace, persistentMemory,
            fts5Memory,
            model: selected.provider,
            modelName: selected.subModel || '',
            contextWindow: contextWindow || selected.contextWindow || 128000,
            displayModelLabel: selected.label,
            userPickedModel,
            emotion,
            thinking: !!thinking,
            thinkingBudget: thinking ? 4096 : undefined,
            modelConfig: selected.baseURL ? { baseURL: selected.baseURL, modelName: selected.subModel || '', provider: selected.provider } : modelConfig,
            activeFile,
            taskId: requestTaskId,  // 长任务快照: 透传 taskId, 支持跨会话恢复
            contextInject: contextInject || undefined,
            mode: mode || 'auto',  // 运行模式: auto/planning/review/readonly
          });
          const master = new MasterController({
            router, registry, userId, workspace,
            masterModel: 'agentai',
            proModel: 'deepseek',
            multimodalModel: 'agentai', subagentModel: 'agentai',
          });
          // 如果发生了降级, 通知前端
          if (selected.fallback) {
            sendEvent('model_fallback', { from: requestModel, to: selected.label, reason: '原模型不可用，已自动切换' });
          }
          sessionManager.set(sessionKey, { loop, master, userId, workspace, callCount: 1 });
          sessionId = loop.getContext().sessionId;
          if (persistentMemory) {
            persistentMemory.createCheckpoint(sessionId, userId, workspace);
            persistentMemory.addMessage(sessionId, { role: 'user', content: message });
          }
        } else {
          loop = sessionData.loop;
          // P0 修复: 每次新请求创建独立 PM 上下文
          // 之前: sessionId 复用 → 持久消息累积所有历史对话 → "继续"时 AI 看到装修报价单等旧任务
          // 现在: 每个新请求独立 PM, "继续"只注入上一条 PM 对话
          if (persistentMemory) {
            const prevPmSessionId = loop.getContext().sessionId;
            const freshPmSessionId = `pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            persistentMemory.createCheckpoint(freshPmSessionId, userId, workspace);
            // 持久化当前用户消息到新 PM 上下文
            persistentMemory.addMessage(freshPmSessionId, { role: 'user', content: message });
            // 保存上一次的 PM sessionId, 供后续记忆注入使用 (只参考最近 1 次)
            if (prevPmSessionId) {
              try { (sessionData as any)._prevPmSessionId = prevPmSessionId; } catch {}
            }
            sessionId = freshPmSessionId;
            // 更新 loop context 的 sessionId 以使用新的 PM 上下文
            if (loop.getContext) {
              loop.getContext().sessionId = freshPmSessionId;
            }
          } else {
            sessionId = loop.getContext().sessionId;
          }
          // 递增 callCount, 确保 "只在首轮注入历史" 的检查生效
          (sessionData as any).callCount = ((sessionData as any).callCount || 0) + 1;
          sessionManager.set(sessionKey, sessionData);
          // 模型切换: 用户手动选择了不同模型时更新
          if (requestModel && requestModel in MODEL_MAP) {
            const mapped = MODEL_MAP[requestModel];
            if (mapped) {
              const providerChanged = mapped.provider !== loop.opts?.model;
              const subModelChanged = (mapped.subModel || '') !== (loop.opts?.modelName || '');
              if (providerChanged || subModelChanged) {
                console.log(`[chat] model switch: ${loop.opts?.model}/${loop.opts?.modelName} → ${mapped.provider}/${mapped.subModel || ''}`);
                loop.opts.model = mapped.provider;
                loop.opts.modelName = mapped.subModel || '';
                loop.opts.displayModelLabel = mapped.label;
                // 切换时: 如果目标模型有 baseURL, 用其; 否则清空 modelConfig, 避免继续用旧 custom 模型地址
                loop.opts.modelConfig = mapped.baseURL ? { baseURL: mapped.baseURL, modelName: mapped.subModel || '', provider: mapped.provider } : undefined;
              }
            }
          }
        }
        const resSessionId = sessionId;
        // 使用的模型显示名
        const displayModel = MODEL_MAP[requestModel]?.label || (requestModel || 'PulseFlow');

        // 立即发送 thinking 事件 (消除空白等待感)
        sendEvent('thinking', { msg: '正在思考...' });

        // ====== 跨会话记忆注入: 智能分拣, 只参考上次对话 ======
        // P1 修复: 检测上次对话时间, 超过 60 分钟视为全新对话 (不注入旧上下文)
        // 原因: 旧 PM 可能包含几十天前的任务, 沿用会误导 AI
        if (persistentMemory && sessionId) {
          try {
            const sessionData_ = sessionManager.get(sessionKey);
            const prevPmSessionId = sessionData_?._prevPmSessionId;
            const lookupSessionId = prevPmSessionId || sessionId;
            const lastMsgs = persistentMemory.getMessages(lookupSessionId);
            if (lastMsgs?.length) {
                // P1 修复: 检查上次对话的时间戳, 超过 60 分钟则跳过注入
                const lastMsg = lastMsgs[lastMsgs.length - 1];
                const lastMsgTs = lastMsg?.timestamp || 0;
                const ageMin = (Date.now() - lastMsgTs) / 60000;
                if (ageMin > 60) {
                  console.log(`[chat] 上次对话 ${ageMin.toFixed(0)} 分钟前, 跳过旧记忆注入 (session=${lookupSessionId})`);
                  // 清空过期的 _prevPmSessionId, 避免继续沿用
                  if (sessionData_) { try { (sessionData_ as any)._prevPmSessionId = undefined; } catch {} }
                } else {
                  const isContinuation = /^(继续|接着|接着做|上次|之前|刚才|那个|go on|continue|恢复|resume)/i.test(message.trim());
                  if (isContinuation) {
                    // 用户明确要继续 — 注入完整上下文
                    const recent = lastMsgs.slice(-20);
                    const userTurns = recent.filter((m:any) => m.role === 'user');
                    const assistantTurns = recent.filter((m:any) => m.role === 'assistant');
                    const toolTurns = recent.filter((m:any) => m.role === 'tool');
                    const toolSummary = toolTurns
                      .map((m:any) => m.name || (typeof m.content === 'string' ? m.content.match(/^\[(\w+)\]/)?.[1] : '') || '')
                      .filter(Boolean)
                      .filter((n: string) => !n.startsWith('error'))
                      .reduce((acc: string[], n: string) => { if (!acc.includes(n)) acc.push(n); return acc; }, [])
                      .slice(0, 10);
                    const lastUserMsgs = userTurns.slice(-3).map((m: any, i: number) =>
                      `${i + 1}. [用户] ${(typeof m.content === 'string' ? m.content : '[多媒体]').slice(0, 200)}`
                    ).join('\n');
                    const lastAssistantMsgs = assistantTurns.slice(-3).map((m: any, i: number) =>
                      `${i + 1}. [AI] ${(typeof m.content === 'string' ? m.content : '').slice(0, 300)}...`
                    ).join('\n\n');
                    const ctxLines: string[] = [`## 📚 上次会话上下文 (用户要求继续)`];
                    if (lastUserMsgs) ctxLines.push(`\n**用户最近 3 次提问**:\n${lastUserMsgs}`);
                    if (lastAssistantMsgs) ctxLines.push(`\n**AI 最近 3 次回复** (开头 300 字符):\n${lastAssistantMsgs}`);
                    if (toolSummary.length > 0) ctxLines.push(`\n**上轮使用过的工具**: ${toolSummary.join(', ')}`);
                    ctxLines.push(`\n💡 用户说"继续", 请直接基于上文继续, 不要重新探索。`);
                    loopOpts.contextInject = (loopOpts.contextInject || '') + '\n\n' + ctxLines.join('\n');
                  } else {
                    // 普通对话 — 只注入 1 行简短摘要
                    const lastUser = lastMsgs.filter((m:any) => m.role === 'user').pop();
                    const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 80) : '';
                    if (lastUserText) {
                      loopOpts.contextInject = (loopOpts.contextInject || '') + 
                        `\n[上次摘要] 用户上次问了: "${lastUserText}"。当前是新任务, 除非用户提到"继续", 否则不要回顾上次。`;
                    }
                  }
                }
            }
          } catch (e: any) { /* persistent memory init fallback */ }
        }

        // 注册流式 delta 监听 (提前注册, loop.run 内触发)
        loop.on('llm:delta', (info: { delta: string }) => {
          sendEvent('delta', { delta: info.delta });
        });
        // 超时事件 → SSE 通知前端 (前端可显示恢复入口)
        loop.on('timeout', (info: { reason: string; totalMinutes: number; iteration: number }) => {
          sendEvent('timeout', info);
        });
        // 深度思考过程: Agnes AI thinking 模式的思考内容
        loop.on('llm:thinking', (info: { text: string }) => {
          sendEvent('thinking', { text: info.text });
        });
        // 子Agent 进度监听 → 前端可见
        loop.on('subagent:start', (info: any) => {
          sendEvent('subagent_start', { id: info.id, type: info.type, task: info.task });
        });
        loop.on('subagent:done', (info: any) => {
          sendEvent('subagent_done', { id: info.id, result: info.result });
        });
        loop.on('subagent:error', (info: any) => {
          sendEvent('subagent_error', { id: info.id, error: info.error });
        });
        // ★ 2026-10-10 修复「无实时子智能体过程」:
        //   loop 侧已在 :3830-3841 转发 4 类 progress 事件(iteration/progress/
        //   tool_start/tool_done), 但 SSE 层只接了 start/done/error 三个终态,
        //   → 事件源存在但没接到前端。现在补齐转发。
        loop.on('subagent:progress', (info: any) => {
          sendEvent('subagent_progress', {
            id: info.id,
            event: info.event,
            iteration: info.iteration,
            step: info.step,
            description: info.description,
            toolName: info.name || info.toolName,
            // 截断, 避免工具输出过长撑爆 SSE 帧
            result: typeof info.result === 'string' ? info.result.slice(0, 500) : undefined,
          });
        });
        loop.on('subagent:rejected', (info: any) => {
          sendEvent('subagent_rejected', info);
        });
        loop.on('tool:stuck', (info: any) => {
          sendEvent('tool_stuck', { tool: info.tool, count: info.count });
        });
        // 关键修复: 转发工具调用事件到前端 (之前缺失!)
        loop.on('tool:start', (info: any) => {
          sendEvent('tool_start', { callId: info.callId, name: info.name, args: info.args });
        });
        loop.on('tool:result', (info: any) => {
          sendEvent('tool_result', { callId: info.callId, name: info.name, result: info.result, ok: info.ok, durationMs: info.durationMs, data: info.data });
        });
        // 推理过程: LLM调工具前的思考内容 → 前端展示为可折叠卡片
        loop.on('reasoning', (info: any) => {
          sendEvent('reasoning', { text: info.text });
        });
        // 自主修复: 系统检测到错误并自动修复 → 前端展示修复过程
        loop.on('auto:fix', (info: any) => {
          sendEvent('auto_fix', { type: info.type, module: info.module, tool: info.tool, error: info.error });
        });
        // 关键修复: 转发追问事件到前端 (之前缺失!)
        loop.on('ask_user', (info: any) => {
          sendEvent('ask_user', { question: info.question, options: info.options, sessionId: info.sessionId });
        });
        // 关键修复: 转发审批事件到前端 (之前缺失!)
        loop.on('approval:required', (info: any) => {
          sendEvent('approval_required', { id: info.id, type: info.type, filePath: info.filePath, summary: info.summary, riskLevel: info.riskLevel, diff: info.diff });
        });
        // 关键修复: 转发智能模型切换事件到前端
        loop.on('model:auto-switched', (info: any) => {
          sendEvent('model_fallback', { from: info.from, to: info.to, reason: info.reason || '连续熔断自动切换' });
        });
        loop.on('model:need-api-key', (info: any) => {
          // 根据 provider 匹配获取地址
          const keyUrlMap: Record<string, string> = {
            agentai: 'https://platform.agnes-ai.cn/',
            deepseek: 'https://platform.deepseek.com/api_keys',
            openai: 'https://platform.openai.com/api-keys',
            zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
            cline: 'https://cline.bot',
          };
          const keyUrl = keyUrlMap[info.provider] || '';
          sendEvent('ask_user', {
            question: `当前免费模型不可用，建议使用 ${info.provider || '商用API'} 获得更好体验。预估成本: ¥${(info.estimatedCost || 0).toFixed(4)}/千token`,
            options: [
              { id: 'get_key', title: '前往获取密钥', description: keyUrl || '请在对应平台官网获取 API Key' },
              { id: 'provide_key', title: '我已有密钥', description: '在设置页面配置或在此输入' },
              { id: 'continue_free', title: '继续使用免费模型', description: '可能会慢或失败' },
            ],
          });
        });
        
        // ═══ 2026-06-27 修复: widget 渲染通道 ═══
        loop.on('widget:show', (info: any) => {
          sendEvent('widget_show', {
            title: info.title,
            contentType: info.contentType,
            content: info.content,
            width: info.width,
            height: info.height,
          });
        });

        // ═══ 2026-07-02 新增: 意图澄清事件转发 ═══
        loop.on('clarify:required', (info: any) => {
          sendEvent('clarify:required', {
            id: info.id,
            originalMessage: info.originalMessage,
            questions: info.questions,
            ambiguities: info.ambiguities,
            source: info.source || 'intent_clarifier',
          });
        });

        // 2026-06-24 新增: 透明进度转发
        loop.on('progress', (info: any) => {
          sendEvent('progress', info);
        });

        // ═══ 灵魂层 SSE 事件: 实时推送 AI 内心状态到前端 ═══
        // 串味修复: 必须传请求级 workspace, 与 buildImmutablePrefix §4.75 用同一个 key,
        // 否则事件监听绑到 A 的实例、上下文注入读B 的实例（反而制造新的不一致）
        try {
          const { getPainSense, getInnerVoice, getCuriosityEngine, getInternalDebate } = await import('../soul/index.js');
          const painSense = getPainSense(workspace);
          const innerVoice = getInnerVoice(workspace);
          const curiosity = getCuriosityEngine(workspace);
          const debate = getInternalDebate(workspace);

          // 痛觉/愉悦变化 → 推送 mood 事件
          painSense.on('pain', (state: any) => {
            sendEvent('mood', { mood: state.mood, intensity: state.intensity, pain: state.pain, consecutiveFailures: state.consecutiveFailures });
          });
          painSense.on('joy', (state: any) => {
            sendEvent('mood', { mood: state.mood, intensity: state.intensity, joy: state.joy, consecutiveSuccesses: state.consecutiveSuccesses });
          });

          // 内心独白 → 推送 inner_voice 事件
          innerVoice.on('thought', (thought: any) => {
            if (thought.influencesReply) {
              sendEvent('inner_voice', { text: thought.text, mood: thought.mood, context: thought.context });
            }
          });

          // 好奇心新问题 → 推送 curiosity 事件
          curiosity.on('question:added', (q: any) => {
            sendEvent('curiosity', { question: q.question, type: q.type, priority: q.priority });
          });
          curiosity.on('insight', (insight: any) => {
            sendEvent('curiosity', { text: insight.text, type: 'insight' });
          });

          // 内部辩论完成 → 推送 debate 事件
          debate.on('debate:complete', (result: any) => {
            sendEvent('debate', { topic: result.topic, recommendation: result.recommendation, contradictions: result.contradictions, confidence: result.confidence });
          });
        } catch { /* soul SSE events optional */ }

        // 2026-07-22 修复: plan:created 事件转发为 SSE plan_created (之前冒号/下划线不匹配)
        loop.on('plan:created', (info: any) => {
          sendEvent('plan_created', info);
        });
        // 2026-08-03: plan:stage 和 memory:auto-captured 事件转发 (之前缺失, 导致右侧面板不更新)
        loop.on('plan:stage', (info: any) => {
          sendEvent('plan_stage', info);
        });
        loop.on('memory:auto-captured', (info: any) => {
          sendEvent('memory_auto', info);
        });

        // ====== 统一注入附件到上下文 (所有执行路径: loop.run / MasterController subtasks) ======
        let runMessage: string | { content: any[] } = message;
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
          const attachmentParts: string[] = [];
          const imageBlocks: any[] = [];
          for (const att of attachments) {
            if (att.kind === 'image' && att.dataUrl) {
              imageBlocks.push({ type: 'image_url', image_url: { url: att.dataUrl } });
            } else if (att.content) {
              const pathInfo = att.filePath ? `\n[文件路径: ${att.filePath} — 你可以用 read_file 工具直接访问此文件]` : '';
              attachmentParts.push(`--- 附件: ${att.name} ---\n${att.content}${pathInfo}\n--- 附件结束 ---`);
            }
          }
          // 图片统一注入 appendOnlyLog (让所有执行路径都能看到)
          if (imageBlocks.length > 0) {
            const textContent = message || '请查看上传的图片';
            loop.context?.appendOnlyLog?.push({
              role: 'user',
              content: [{ type: 'text', text: textContent }, ...imageBlocks] as any,
            });
            // runMessage 保持纯文本, 避免 loop.run() 重复注入图片
          }
          // 文件内容注入 appendOnlyLog (让 subtask 执行路径也能看到)
          if (attachmentParts.length > 0) {
            loop.context?.appendOnlyLog?.push({
              role: 'user',
              content: `[用户上传了以下文件, 请仔细阅读并分析]\n\n${attachmentParts.join('\n\n')}`,
            });
          }
        }

        // ====== 当前编辑器文件上下文注入 ======
        if (activeFile && typeof activeFile === 'string' && activeFile.trim()) {
          loop.getContext().appendOnlyLog.push({
            role: 'system',
            content: `[上下文] 用户当前正在编辑器中查看文件: ${activeFile}`,
          });
        }

        // ====== 启发式快速路径: 极简消息不绕 MasterController ======
        // 寒暄/简短问答/搜索/媒体生成等简单消息直接走 loop.run()
        // 只有 medium/complex 才进入编排器 (节省 token, 降低延迟)
        const trimmedMessage = (message || '').trim();
        const isVeryShort = trimmedMessage.length < 30;
        const isChatLike = /^(你好|hi|hello|谢谢|感谢|bye|再见|ok|好的|嗯|哦|是|不是|对|不对|yes|no|算了|没事|收到|明白|懂了|了解)$/i.test(trimmedMessage);
        const isSimpleSearch = /^.*(搜索|查找|找|search|find|查|帮我查).*代码|文件|目录|项目|函数|类|组件|接口|接口定义|API.*(路径|内容|地址|URL|端口|状态).*$/i.test(trimmedMessage);
        const isSimpleMedia = /^.*(生成图|生图|画一张|画一个|生成图片|效果图|海报|插画|绘图|AI.*图).*$/i.test(trimmedMessage);
        
        let needMasterController = !isChatLike && !isSimpleSearch && !isSimpleMedia;
        if (isVeryShort && !needMasterController) {
            needMasterController = false; // 极简消息不绕编排器
        }

        effectiveModel = effectiveModel || requestModel || 'agentai';
        // ★ 2026-10-10: 改用统一判定, 消除第三份散落的免费名单
        const isFreeModel = isFreeProvider(effectiveModel);

        // 如果不需要 MasterController, 直接走 loop.run() (分支 3)
        if (!needMasterController) {
            console.log(`[chat] 🚀 快速路径: 不调 MasterController, 直接 loop.run()`);
        }

        const master = needMasterController ? (sessionData?.master || new MasterController({
            router, registry, userId, workspace,
            masterModel: 'agentai',
            proModel: 'deepseek',
            multimodalModel: 'agentai', subagentModel: 'agentai',
        })) : null;

        const execPlan = master ? await master.orchestrate(message).catch((e: any) => {
          console.warn(`[chat] ⚠️ orchestrate 失败: ${e?.message}, 降级到直接 loop.run()`);
          return null;
        }) : null;
        const shouldAutoRun = execPlan?.shouldAutoRun ?? true;

        // ====== 执行分支 (带 try-catch 兜底, 防止异常导致网关掉线) ======
        // 分支 1: 规划模式 → 只规划不执行
        // 分支 2: 商业模型 + 子任务 → MasterController 编排 (并行子Agent/单子Agent)
        // 分支 3: 其他 (免费模型 / shouldAutoRun=true / 快速路径) → loop.run()
        let finalContent: string = '';
        let finalProvider: string = '';
        let finalUsage: any = {};
        let finalToolCalls: any;
        let finalIterations: any;

        try {

        // 规划模式: 非简单任务只规划不执行, 等用户确认
        const reqMode = req.body?.mode || 'auto';
        const isPlanningMode = reqMode === 'planning';
        const needPlanApproval = isPlanningMode && execPlan && execPlan.intent?.complexity !== 'simple';

        if (needPlanApproval) {
          // ======================== 分支 1: 规划模式 ========================
          // 存储计划到 pendingPlans, 等待用户通过 /v1/chat/approve 确认
          pendingPlans.set(sessionId || 'default', {
            execPlan, message, userId, workspace, sessionId: sessionId || 'default',
            profile: req.body?.profile, model: effectiveModel, displayModel,
          });
          sendEvent('plan_created', { chainId: execPlan.id, goal: execPlan.goal,
            stages: execPlan.stages, currentStage: execPlan.stages[0]?.key || 'plan',
            intent: execPlan.intent,
            subtasks: execPlan.subtasks.map(s => ({ id: s.id, title: s.title, description: s.description, status: s.status, agentType: s.agentType })),
            subtaskCount: execPlan.subtasks.length, autoRun: false,
            needsApproval: true, // 标记需要用户确认
          });
          // 发送规划结果, 不执行
          const subtaskLines = (execPlan.subtasks || []).map((s, i) => {
            return `${i + 1}. [${s.agentType || '?'}] ${s.title || '?'}\n   ${(s.description || '').slice(0, 100)}`;
          });
          const planSummary = `📋 任务规划完成 (规划模式 — 需确认后执行)\n\n目标: ${execPlan.goal}\n复杂度: ${execPlan.intent?.complexity || 'unknown'}\n\n子任务:\n${subtaskLines.join('\n')}\n\n请确认是否执行, 或修改任务后执行。`;
          sendEvent('delta', { delta: planSummary });
          sendEvent('done', { provider: 'master-controller', displayModel, content: planSummary, usage: {}, needsApproval: true });
          finalContent = planSummary;
          finalProvider = 'master-controller';
        } else if (master && !shouldAutoRun && execPlan?.subtasks?.length > 1 && !isFreeModel) {
          // ======================== 分支 2a: 复杂多子任务 ========================
          // 商业模型 + 需要子Agent → MasterController 并行执行
          const stages = execPlan.stages || [];
          sendEvent('plan_created', { chainId: execPlan.id, goal: execPlan.goal,
            stages: stages, currentStage: stages[0]?.key || 'plan',
            intent: execPlan.intent,
            subtasks: (execPlan.subtasks || []).map(s => ({ id: s.id, title: s.title, status: s.status, agentType: s.agentType })),
            subtaskCount: (execPlan.subtasks || []).length, autoRun: false });

          // 监听子任务事件并转发到前端
          const onSubtaskStart = (task: any) => {
            sendEvent('plan_stage', { chainId: execPlan.id, stage: 'solve', status: 'running', taskId: task.id, taskTitle: task.title });
            sendEvent('delta', { delta: `\n🔄 子任务 [${task.title}] 开始执行...\n` });
          };
          const onSubtaskEnd = (task: any) => {
            sendEvent('plan_stage', { chainId: execPlan.id, stage: task.status === 'done' ? 'verify' : 'solve', status: task.status, taskId: task.id, taskTitle: task.title });
            const icon = task.status === 'done' ? '✅' : '❌';
            sendEvent('delta', { delta: `\n${icon} 子任务 [${task.title}] ${task.status === 'done' ? '完成' : '失败'}: ${(task.result || '').slice(0, 200)}\n` });
          };
          const onSubtaskModel = (info: any) => {
            sendEvent('delta', { delta: `\n🤖 使用模型: ${info.model} (${info.agentType})\n` });
          };
          master.on('subtask:start', onSubtaskStart);
          master.on('subtask:end', onSubtaskEnd);
          master.on('subtask:model', onSubtaskModel);

          try {
            const subtaskResults = await master.executePlan(execPlan, loop.opts.model, loop.context?.appendOnlyLog);
            const synthesis = await master.synthesize(execPlan.goal, subtaskResults);
            sendEvent('plan_stage', { chainId: execPlan.id, stage: 'report', status: 'done' });
            sendEvent('delta', { delta: `\n\n---\n📋 任务汇总:\n${synthesis}` });
            sendEvent('done', { provider: 'master-controller', displayModel, content: synthesis, usage: {}, subtasks: subtaskResults.map(r => ({ id: r.id, title: r.title, status: r.status })) });
            finalContent = synthesis;
            finalProvider = 'master-controller';
          } finally {
            master.off('subtask:start', onSubtaskStart);
            master.off('subtask:end', onSubtaskEnd);
            master.off('subtask:model', onSubtaskModel);
          }
        } else if (master && !shouldAutoRun && execPlan?.subtasks?.length === 1 && !isFreeModel) {
          // ======================== 分支 2b: 单子任务 ========================
          // 商业模型 + 单子任务 → MasterController 执行子任务 (不通过 loop.run)
          const sub = execPlan.subtasks?.[0];
          const stages = execPlan.stages || [];
          sendEvent('plan_created', { chainId: execPlan.id, goal: execPlan.goal,
            stages: stages, currentStage: stages[0]?.key || 'solve',
            intent: execPlan.intent,
            subtasks: sub ? [{ id: sub.id, title: sub.title, status: sub.status, agentType: sub.agentType }] : [],
            subtaskCount: 1, autoRun: false });

          // 监听子任务事件
          const onSubtaskStart = (task: any) => {
            sendEvent('delta', { delta: `\n🔄 执行: [${task.title}]...\n` });
          };
          const onSubtaskEnd = (task: any) => {
            const icon = task.status === 'done' ? '✅' : '❌';
            sendEvent('delta', { delta: `\n${icon} [${task.title}] ${task.status === 'done' ? '完成' : '失败'}\n` });
          };
          master.on('subtask:start', onSubtaskStart);
          master.on('subtask:end', onSubtaskEnd);

          try {
            const result = await master.executeSubTask(sub, loop.opts.model, loop.context?.appendOnlyLog);
            sendEvent('plan_stage', { chainId: execPlan.id, stage: 'report', status: 'done' });
            sendEvent('delta', { delta: result.result || '(empty)' });
            sendEvent('done', { provider: 'master-controller', displayModel, content: result.result, usage: {} });
            finalContent = result.result || '';
            finalProvider = 'master-controller';
          } finally {
            master.off('subtask:start', onSubtaskStart);
            master.off('subtask:end', onSubtaskEnd);
          }
        } else {
          // ======================== 分支 3: loop.run() (免费模型 / 简单任务 / shouldAutoRun) ========================
          // 简单/中等任务: AgentAILoop 直接执行 (含自动继续 + 工具调用)
          // 免费模型 (agentai/zhipu) + !shouldAutoRun → 跳过编排，直接 loop.run()
          // 只有非simple任务才显示编排器面板
          // 复杂任务: MasterController 编排 (并行子Agent/单子Agent)
          if (execPlan) {
            if (execPlan.intent?.complexity !== 'simple') {
              const stages = execPlan.stages || [];
              const subtasks = execPlan.subtasks || [];
              sendEvent('plan_created', {
                chainId: execPlan.id,
                goal: execPlan.goal,
                stages: stages,
                currentStage: stages[0]?.key || 'plan',
                intent: execPlan.intent,
                subtasks: subtasks.map(s => ({
                  id: s.id, title: s.title, description: s.description, status: s.status, agentType: s.agentType
                })),
                subtaskCount: subtasks.length,
                autoRun: shouldAutoRun,
              });
            }
          }

          // 注入意图提示到 loop 上下文
          const alreadyHints = loop.context?.appendOnlyLog?.filter(
            (m: any) => m.role === 'system' && (
              (typeof m.content === 'string' && m.content.startsWith('[意图评估]')) ||
              (Array.isArray(m.content) && m.content.some((c: any) => typeof c === 'object' && c.text?.startsWith('[意图评估]')))
            )
          );
          if (!alreadyHints?.length && master && execPlan && execPlan.intent) {
            const intentLabel = execPlan.intent.category === 'chat' ? 'chat' : `${execPlan.intent.category}(${execPlan.intent.summary})`;
            loop.context?.appendOnlyLog?.push({
              role: 'system',
              content: `[意图评估] ${intentLabel}`,
            });
          }
          if (!master) {
            loop.context?.appendOnlyLog?.push({
              role: 'system',
              content: `[意图评估] 快速路径 (不调 MasterController)`,
            });
          }

          // 监听loop的工具调用事件, 推进编排器stage
          const onToolStart = () => {
            if (execPlan && execPlan.intent?.complexity !== 'simple') {
              sendEvent('plan_stage', { chainId: execPlan.id, stage: 'solve', status: 'running' });
            }
          };
          const onToolEnd = (info: any) => {
            // tool:result 已通过 sendEvent('tool_result') 推送前端，此处不再需要
          };
          loop.on('tool:start', onToolStart);
          loop.on('tool:result', onToolEnd);

          // 注册loop到活跃追踪 (可被abort端点中断 + 新消息压制)
          let loopAborted = false;
          const abortHandler = () => { loopAborted = true; loop.abort(); };
activeLoops.set(sessionId || 'default', { loop, abort: abortHandler });
activeLoops.set(sessionKey, { loop, abort: abortHandler }); // 供新消息压制用

// P0 修复: SSE 断开时中止 loop — 用户切对话后后台任务立即停止
// 否则 loop 会继续跑 → 调用工具 → HookCapture 找不到 session → 返回 undefined → AI 空回复 → 死循环
req.on('close', () => {
  if (!loopAborted) {
    console.log(`[chat] SSE 客户端断开, 中止 loop: ${sessionKey}`);
    abortHandler();
  }
});

          // 注入前端系统规则 (文件时间线/版本回退/浏览器元素识别等)
          // DEF-02 修复: 按内容去重, 防止同一规则在多轮请求中被重复注入 20+ 次
          if (systemRules && loop.context?.immutablePrefix) {
            const rulesHash = systemRules.slice(0, 200); // 用前 200 字符作为去重键
            const alreadyInjected = loop.context.immutablePrefix.some(
              (m: any) => m.role === 'system' && typeof m.content === 'string'
                && m.content.slice(0, 200) === rulesHash,
            );
            if (!alreadyInjected) {
              loop.context.immutablePrefix.push({
                role: 'system',
                content: systemRules,
              });
            }
          }

          const response = await loop.run(runMessage);

          // 注销loop追踪
          activeLoops.delete(sessionId || 'default');
          activeLoops.delete(sessionKey);

          if (loopAborted) {
            sendEvent('done', { provider: 'aborted', displayModel, content: '[任务已中断]', usage: {} });
            res.end();
            return;
          }

          // loop完成 → 推进到report
          loop.off('tool:start', onToolStart);
          loop.off('tool:end', onToolEnd);
          if (execPlan && execPlan.intent?.complexity !== 'simple') {
            sendEvent('plan_stage', { chainId: execPlan.id, stage: 'report', status: 'done' });
          }

          sendEvent('done', {
            provider: response?.provider || 'unknown',
            displayModel,
            usage: response?.usage,
            content: response?.content,
            toolCalls: response?.toolCalls,
            sessionId: resSessionId,
            iterations: response?.iterations,
          });
          finalContent = response?.content;
          finalProvider = response?.provider;
          finalUsage = response?.usage;
          finalToolCalls = response?.toolCalls;
          finalIterations = response?.iterations;
        }
      } catch (e: any) {
        console.error(`[chat] ❌ 执行分支异常: ${e?.message || e}`);
        sendEvent('delta', { delta: `\n\n❌ 执行出错: ${e?.message || '未知错误'}` });
        sendEvent('done', { provider: 'error', displayModel, content: `执行出错: ${e?.message || '未知错误'}`, usage: {} });
        finalContent = `[ERROR] ${e?.message || '未知错误'}`;
      }

      // 持久化 assistant 回复
        if (persistentMemory && finalContent) {
          persistentMemory.addMessage(resSessionId, { role: 'assistant', content: finalContent });
        }

        // FTS5 深层记忆 + 用户建模
        if (fts5Memory && finalContent) {
          fts5Memory.recordMessage({ sessionId: resSessionId, userId, workspace, role: 'assistant', content: finalContent }).catch(() => {});
        }
        if (userModel && finalContent) {
          const toolNames = (finalToolCalls || []).map((t: any) => t.name || t.function?.name).filter(Boolean);
          userModel.recordInteraction(userId, { toolsUsed: toolNames, messageCount: 1, model: finalProvider || 'unknown' });
          userModel.addHistorySnapshot(userId, { summary: String(finalContent || '').slice(0, 200), sessionId: resSessionId, keyOutcomes: toolNames.length > 0 ? [`Used: ${toolNames.join(', ')}`] : [] });
        }

        res.end();
        releaseQueue();
        } catch (e: any) {
          const errMsg = String(e?.message || e);
          console.error(`[chat-stream] error: ${errMsg}`);
          // 先发 content delta 让用户看到错误, 再发 error 事件
          sendEvent('delta', { delta: `\n\n\`\`\`error\n${errMsg}\n\`\`\`` });
          sendEvent('error', { error: errMsg });
          res.end();
          releaseQueue();
        }
        return;
      }

      // Framework adapter
      if ((framework === 'agentai' || framework === 'pulseflow') && frameworkSwitcher) {
        try {
          const res2 = await frameworkSwitcher.chat(
            [{ role: 'user', content: message }],
            { userId, workspace, tools: [] },
          );
          return res.json({
            content: res2.content,
            toolCalls: res2.toolCalls,
            provider: res2.provider,
            framework,
            usage: res2.usage,
            sessionId: `framework-${Date.now()}`,
          });
        } catch (e: any) {
          return res.status(500).json({ error: String(e) });
        }
      }

      // ====== 模型映射 (非流式路径共用) ======
      const nss_MODEL_MAP: Record<string, { provider: string; subModel?: string; label: string }> = {
        // ===== Agnes AI (首选) — provider 统一用 'agentai', 因为 providers Map 中注册的是 'agentai' =====
        'agnes-2.5-flash': { provider: 'agentai', subModel: 'agnes-2.5-flash', label: 'Agnes 2.5 Flash (首选)' },
        // 2026-10-12: agnes-2.0 已下架 → 别名指向活的 2.5-flash (同 MODEL_MAP)
        'agnes-2.0': { provider: 'agentai', subModel: 'agnes-2.5-flash', label: 'Agnes 2.5 Flash (原 2.0 别名)' },
        // ===== 基础免费模型 =====
        'agentai': { provider: 'agentai', label: '岐枢 Free (Flash)' },
        'zhipu': { provider: 'zhipu', subModel: 'glm-4.7-flash', label: '智谱 GLM-4.7 Flash' },
        // ===== DeepSeek =====
        'deepseek': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)' },
        // 2026-10-11: pro 已下线 → 别名指向 deepseek-flash
        'deepseek-pro': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1, 原 Pro 别名)' },
        'deepseek-flash': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)' },
        'deepseek-v4-flash': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)' },
        'deepseek-v4-pro': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1, 原 Pro 别名)' },
        // ===== OpenAI =====
        'openai': { provider: 'openai', label: 'OpenAI GPT-4o' },
        'openai-gpt4o': { provider: 'openai', label: 'OpenAI GPT-4o' },
        // ===== 传统独立商业模型 =====
        'qwen': { provider: 'qwen', subModel: 'qwen-max', label: '通义千问 (阿里云)' },
        'qwen-max': { provider: 'qwen', subModel: 'qwen-max', label: '通义千问 Qwen-Max' },
        'moonshot': { provider: 'moonshot', subModel: 'kimi-k2.5', label: '月之暗面 Moonshot' },
        'moonshot-kimi': { provider: 'moonshot', subModel: 'kimi-k2.5', label: '月之暗面 Kimi' },
        'anthropic': { provider: 'anthropic', subModel: 'claude-sonnet-4-5-20250929', label: 'Anthropic Claude' },
        'anthropic-claude': { provider: 'anthropic', subModel: 'claude-sonnet-4-5-20250929', label: 'Anthropic Claude' },
        'minimax': { provider: 'minimax', subModel: 'MiniMax-M3', label: 'MiniMax' },
        'minimax-hailuo': { provider: 'minimax', subModel: 'MiniMax-M3', label: 'MiniMax 海螺' },
        // ===== 豆包/火山引擎 =====
        'doubao-seed-2.0-pro': { provider: 'doubao', subModel: 'doubao-seed-2.0-pro-250728', label: '豆包 Seed-2.0 Pro' },
        'doubao-1.5-thinking': { provider: 'doubao', subModel: 'doubao-1.5-thinking-vision-pro', label: '豆包 1.5 视觉深度思考' },
        // ===== 传统兼容 =====
        'yi': { provider: 'yi', label: '零一万物 Yi' },
        'baichuan': { provider: 'baichuan', label: '百川智能' },
        // 商汤 SenseNova
        'sensenova-6.7-flash-lite': { provider: 'sensenova', subModel: 'sensenova-6.7-flash-lite', label: 'SenseNova 6.7 Flash-Lite' },
        'sensenova-u1-fast': { provider: 'sensenova', subModel: 'sensenova-u1-fast', label: 'SenseNova U1 Fast' },
        'sensenova-deepseek-v4-flash': { provider: 'sensenova', subModel: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (SenseNova)' },
        'sensenova-glm-5.2': { provider: 'sensenova', subModel: 'glm-5.2', label: 'GLM-5.2 (SenseNova)' },
        // 美团 LongCat
        'longcat-2.0': { provider: 'longcat', subModel: 'LongCat-2.0', label: 'LongCat-2.0' },
        // SuperAPI 模型工厂
        'alrc-gpt-5.4': { provider: 'alrc', subModel: 'gpt-5.4', label: 'ALRC · GPT-5.4' },
        'alrc-gpt-5.4-mini': { provider: 'alrc', subModel: 'gpt-5.4-mini', label: 'ALRC · GPT-5.4 Mini' },
        'alrc-gpt-5.5': { provider: 'alrc', subModel: 'gpt-5.5', label: 'ALRC · GPT-5.5' },
        'alrc-gpt-5.5-compact': { provider: 'alrc', subModel: 'gpt-5.5-openai-compact', label: 'ALRC · GPT-5.5 Compact' },
        'alrc-gpt-5.6-luna': { provider: 'alrc', subModel: 'gpt-5.6-luna', label: 'ALRC · GPT-5.6 Luna' },
        'alrc-gpt-5.6-sol': { provider: 'alrc', subModel: 'gpt-5.6-sol', label: 'ALRC · GPT-5.6 Sol' },
        'alrc-gpt-5.6-terra': { provider: 'alrc', subModel: 'gpt-5.6-terra', label: 'ALRC · GPT-5.6 Terra' },
        'alrc-claude-fable-5': { provider: 'alrc', subModel: 'claude-fable-5', label: 'ALRC · Claude Fable 5' },
        'alrc-claude-haiku-4-5': { provider: 'alrc', subModel: 'claude-haiku-4-5-20250101', label: 'ALRC · Claude Haiku 4.5' },
        'alrc-claude-opus-4-6': { provider: 'alrc', subModel: 'claude-opus-4-6', label: 'ALRC · Claude Opus 4.6' },
        'alrc-grok-4.5': { provider: 'alrc', subModel: 'grok-4.5', label: 'ALRC · Grok 4.5' },
        'alrc-grok-composer-2.5': { provider: 'alrc', subModel: 'grok-composer-2.5-fast', label: 'ALRC · Grok Composer 2.5' },
        'alrc-lingyan-3.5': { provider: 'alrc', subModel: 'lingyan-3.5', label: 'ALRC · 灵岩 3.5' },
        'alrc-doubao-seed-2-0-pro': { provider: 'alrc', subModel: 'doubao-seed-2-0-pro-260215', label: 'ALRC · 豆包 Seed 2.0 Pro' },
        // ALRC 生图模型
        'alrc-nano-banana': { provider: 'alrc', subModel: 'nano-banana', label: 'ALRC · Nano Banana' },
        'alrc-nano-banana-2': { provider: 'alrc', subModel: 'nano-banana-2', label: 'ALRC · Nano Banana 2' },
        'alrc-nano-banana-pro': { provider: 'alrc', subModel: 'nano-banana-pro', label: 'ALRC · Nano Banana Pro' },
        'alrc-gpt-image-2': { provider: 'alrc', subModel: 'gpt-image-2', label: 'ALRC · GPT Image 2' },
        'alrc-gpt-image-2-vip': { provider: 'alrc', subModel: 'gpt-image-2-vip', label: 'ALRC · GPT Image 2 VIP' },
        // NVIDIA NIM 模型已移除 (2026-07-25)
      };

      // 创建或获取 session (使用 SessionManager LRU)
      const sessionKey = `${userId}:${workspace}`;
      let loop: any;
      let isNewSession = false;
      let sessionData = sessionManager.get(sessionKey);
      if (!sessionData) {
        const mode = req.body?.mode || 'auto';
        const userModelId = req.body?.model;
        const mapped = nss_MODEL_MAP[userModelId];
        const userPicked = !!(mapped && mapped.provider);
        if (userPicked) {
          // SuperAPI: 从 modelConfig 获取子模型名
          const superApiModelName = mapped.provider === 'alrc' && modelConfig?.modelName ? modelConfig.modelName : '';
          loop = new AgentAILoop(router, registry, [], {
            maxIterations: MAX_ITERATION_CEILING, userId, workspace, mode,
            model: mapped.provider,
            modelName: mapped.subModel || superApiModelName || '',
            contextWindow: contextWindow || mapped.contextWindow,
            displayModelLabel: mapped.label,
            userPickedModel: true,
            persistentMemory,
            emotion,
            thinking: !!thinking,
            thinkingBudget: thinking ? 4096 : undefined,
            activeFile,
            taskId: requestTaskId,  // 长任务快照: 透传 taskId
            contextInject: contextInject || undefined,
          });
        } else {
          // 未指定模型或模型不在 MODEL_MAP 中: 优先读取用户偏好, 默认 agentai (免费)
          // 从用户偏好读取模型 (GUI 切换同步过来的值)
          const userPref = userModel?.get(userId)?.preferences?.preferredModel || 'agentai';
          // 通过 nss_MODEL_MAP 统一查找用户偏好模型, 避免硬编码遗漏
          const prefMapped = nss_MODEL_MAP[userPref];
          let chatModel = prefMapped?.provider || 'agentai';
          let modelName = prefMapped?.subModel || '';
          // 2026-10-11: 删除「deepseek + 复杂任务 → 自动升到 deepseek-v4-pro」。
          // ① pro 官方已下线; ② 用户显式选的模型不再被自动替换 (这正是用户抱怨
          //   「选 4.1 却跑到 pro 从而频繁中断」的两处来源之一, 另一处是 model-selector.ts)。
          console.log(`[chat:non-stream] no explicit model, using user preference: ${userPref} → ${chatModel}/${modelName || '(default)'}`);
          // 2026-10-12: 原来这里是 `auto ? 30 : 10` —— 普通对话只有 10 轮, 是"长任务断"的
          //   又一个来源 (见 MAX_ITERATION_CEILING 的说明)。现在统一交给能力层裁决。
          const autoMaxIters = MAX_ITERATION_CEILING;
          loop = new AgentAILoop(router, registry, [], {
            maxIterations: autoMaxIters, userId, workspace, mode, model: chatModel, modelName, persistentMemory, emotion,
            thinking: !!thinking,
            thinkingBudget: thinking ? 4096 : undefined,
            taskId: requestTaskId,  // 长任务快照: 透传 taskId
          });
        }
        sessionManager.set(sessionKey, { loop, userId, workspace, callCount: 1 });
        sessionData = { loop, userId, workspace };
        isNewSession = true;
        // 创建持久化 checkpoint
        if (persistentMemory) {
          const sid = loop.getContext().sessionId;
          persistentMemory.createCheckpoint(sid, userId, workspace);
          persistentMemory.addMessage(sid, { role: 'user', content: message });
        }
      } else {
        // Session 已存在
        // P0 修复: 同样创建独立 PM 上下文, 不追加到旧 checkpoint
        if (persistentMemory) {
          const prevPmSid = sessionData.loop.getContext().sessionId;
          const freshPmSid = `pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          persistentMemory.createCheckpoint(freshPmSid, userId, workspace);
          persistentMemory.addMessage(freshPmSid, { role: 'user', content: message });
          // 更新 loop context sessionId
          if (sessionData.loop.getContext) {
            sessionData.loop.getContext().sessionId = freshPmSid;
          }
          // 保存上一次 PM sessionId
          try { (sessionData as any)._prevPmSessionId = prevPmSid; } catch {}
        }
        // 模型切换: 非流式路径也需要处理
        const userModelId2 = req.body?.model;
        if (userModelId2 && nss_MODEL_MAP[userModelId2]) {
          const mapped = nss_MODEL_MAP[userModelId2];
          const providerChanged = mapped.provider !== sessionData.loop.opts?.model;
          const subModelChanged = (mapped.subModel || '') !== (sessionData.loop.opts?.modelName || '');
          if (providerChanged || subModelChanged) {
            console.log(`[chat:non-stream] model switch: ${sessionData.loop.opts?.model}/${sessionData.loop.opts?.modelName} → ${mapped.provider}/${mapped.subModel || ''}`);
            sessionData.loop.opts.model = mapped.provider;
            sessionData.loop.opts.modelName = mapped.subModel || '';
            sessionData.loop.opts.displayModelLabel = mapped.label;
          }
        }
      }
      const resSessionId = isNewSession ? loop.getContext().sessionId : sessionData.loop.getContext().sessionId;
      loop = sessionData.loop;

      // ====== 非流式路径: 附件注入 (与流式路径相同逻辑) ======
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        const attachmentParts: string[] = [];
        const imageBlocks: any[] = [];
        for (const att of attachments) {
          if (att.kind === 'image' && att.dataUrl) {
            imageBlocks.push({ type: 'image_url', image_url: { url: att.dataUrl } });
          } else if (att.content) {
            const pathInfo = att.filePath ? `\n[文件路径: ${att.filePath} — 你可以用 read_file 工具直接访问此文件]` : '';
            attachmentParts.push(`--- 附件: ${att.name} ---\n${att.content}${pathInfo}\n--- 附件结束 ---`);
          }
        }
        if (imageBlocks.length > 0) {
          const textContent = message || '请查看上传的图片';
          loop.context?.appendOnlyLog?.push({
            role: 'user',
            content: [{ type: 'text', text: textContent }, ...imageBlocks] as any,
          });
        }
        if (attachmentParts.length > 0) {
          loop.context?.appendOnlyLog?.push({
            role: 'user',
            content: `[用户上传了以下文件, 请仔细阅读并分析]\n\n${attachmentParts.join('\n\n')}`,
          });
        }
      }

      // 收集工具事件
      const toolEvents: any[] = [];
      const onToolStart = (info: any) => toolEvents.push({ type: 'tool_start', callId: info.callId, name: info.name, args: info.args });
      const onToolResult = (info: any) => toolEvents.push({ type: 'tool_result', callId: info.callId, name: info.name, result: info.result, data: info.data, ok: info.ok, durationMs: info.durationMs });
      loop.on('tool:start' as any, onToolStart);
      loop.on('tool:result' as any, onToolResult);

      console.log('[chat:non-stream] calling loop.run with model=', loop.opts?.model);
      const response = await loop.run(message);
      console.log('[chat:non-stream] loop.run returned type=', typeof response, 'isNull=', response === null, 'isUndefined=', response === undefined);

      if (!response) {
        return res.status(500).json({ error: 'AI 处理失败，请重试' });
      }

      // 持久化 assistant 回复
      if (persistentMemory) {
        const sid = loop.getContext().sessionId;
        persistentMemory.addMessage(sid, { role: 'assistant', content: response.content || '' });
      }

      loop.off('tool:start' as any, onToolStart);
      loop.off('tool:result' as any, onToolResult);

      // 完成 Xuanji 医案记录
      if (xuanjiCaseId) {
        try {
          await xuanji.completeTreatment(xuanjiCaseId, {
            status: 'success',
            result: response.content || '',
            duration: Date.now() - startTime,
          });
          console.log(`[xuanji] ✅ 医案完成 | caseId=${xuanjiCaseId}`);
        } catch (err: any) {
          console.warn(`[xuanji] ⚠️ 记录医案失败: ${err.message}`);
        }
      }

      res.json({
        content: response.content || '',
        toolCalls: response.toolCalls,
        provider: response.provider || 'unknown',
        usage: response.usage || {},
        toolEvents,
        sessionId: loop.getContext().sessionId,
        xuanjiCaseId,  // 返回医案ID供前端追踪
      });
    } catch (e: any) {
      // 非流式: 返回详细错误信息
      const errMsg = e?.message || String(e);
      const errStack = e?.stack?.slice(0, 300) || '';
      console.error(`[chat] 500: ${errMsg}\n${errStack}`);
      
      // 记录失败到医案
      if (xuanjiCaseId) {
        try {
          await xuanji.completeTreatment(xuanjiCaseId, {
            status: 'failure',
            result: errMsg,
            duration: Date.now() - startTime,
          });
        } catch { /* ignore */ }
      }
      
      res.status(500).json({
        error: errMsg,
        detail: errStack,
        hint: '检查后端日志和 API Key 配置 (AGENTAI_API_KEY)',
      });
    } finally {
      limiter.release(userId, isInternalReq);
    }
  });

  // ===== 记忆 API =====
  // 读取记忆 (前端右侧面板使用)
  r.get('/v1/memory', async (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || 'default';
      const workspace = req.query.workspace as string || process.cwd();
      const limit = parseInt(req.query.limit as string) || 30;
      const mems = await readMemory({ userId, workspace, limit });
      res.json({ ok: true, memories: mems });
    } catch (e: any) {
      res.json({ ok: false, memories: [], error: e.message });
    }
  });

  // 手动写入记忆
  r.post('/v1/memory', async (req: Request, res: Response) => {
    try {
      const { userId = 'default', workspace = process.cwd(), role = 'system', content, metadata, source = 'manual' } = req.body;
      if (!content) { res.json({ ok: false, error: 'content required' }); return; }
      const entry = await writeMemory({ userId, workspace, role, content, metadata, source });
      res.json({ ok: true, entry });
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
  });

  /**
   * 执行已批准的计划 (规划模式审批后调用)
   * 直接用 loop 执行, 不走 SSE 流 — 结果写入记忆后前端下一次请求可见
   * TODO: 后续可升级为通过 Socket.IO 推送实时进度
   */
  async function executePlan(plan: any, planDeps: ChatRouterDeps): Promise<void> {
    const { execPlan, message: planMessage, userId: planUserId, workspace: planWorkspace, sessionId: planSessionId } = plan;
    const { router: planRouter, registry: planRegistry, sessionManager: planSessionMgr, persistentMemory: planPM } = planDeps;

    try {
      const sessionKey = `${planUserId}:${planWorkspace}`;
      const sessionData = planSessionMgr.get(sessionKey);

      // 创建或获取 loop
      let loop: AgentAILoop;
      let master: MasterController;
      if (sessionData?.loop) {
        loop = sessionData.loop;
        master = sessionData.master || new MasterController({
          router: planRouter, registry: planRegistry,
          userId: planUserId, workspace: planWorkspace,
          masterModel: 'agentai',
          proModel: 'deepseek',
          multimodalModel: 'agentai', subagentModel: 'agentai',
        });
      } else {
        loop = new AgentAILoop(planRouter, planRegistry, [], {
          maxIterations: MAX_ITERATION_CEILING, userId: planUserId, workspace: planWorkspace, mode: 'planning',
          model: 'agentai', persistentMemory: planPM,
        });
        master = new MasterController({
          router: planRouter, registry: planRegistry,
          userId: planUserId, workspace: planWorkspace,
          masterModel: 'agentai',
          proModel: 'deepseek',
          multimodalModel: 'agentai', subagentModel: 'agentai',
        });
        planSessionMgr.set(sessionKey, { loop, master, userId: planUserId, workspace: planWorkspace, callCount: 1 });
      }

      // 注入意图提示
      loop.context?.appendOnlyLog?.push({
        role: 'system',
        content: `[用户已确认执行规划] 目标: ${execPlan.goal}`,
      });

      // 根据 subtasks 数量选择执行方式
      if (execPlan.subtasks.length > 1) {
        // 多子任务: 通过 MasterController 分派
        const subtaskResults = await master.executePlan(execPlan, loop.opts.model, loop.context?.appendOnlyLog);
        const synthesis = await master.synthesize(execPlan.goal, subtaskResults);
        console.log(`[chat:approve] 多子任务完成: ${subtaskResults.length} tasks, synthesis length: ${synthesis.length}`);
        // 写入记忆供前端下一次请求可见
        if (planPM) {
          await planPM.save({
            sessionId: planSessionId,
            role: 'assistant',
            content: synthesis,
            metadata: { provider: 'master-controller', subtasks: subtaskResults.map(r => ({ id: r.id, title: r.title, status: r.status })) },
          });
        }
      } else {
        // 单子任务: 直接 loop.run
        const response = await loop.run(planMessage);
        console.log(`[chat:approve] 单子任务完成: provider=${response?.provider}, content length=${(response?.content || '').length}`);
        // 写入记忆
        if (planPM && response?.content) {
          await planPM.save({
            sessionId: planSessionId,
            role: 'assistant',
            content: response.content,
            metadata: { provider: response.provider, iterations: response.iterations },
          });
        }
      }

      console.log(`[chat:approve] 计划执行完成: ${execPlan.id}`);
    } catch (err: any) {
      console.error(`[chat:approve] 计划执行失败: ${err?.message}`);
      throw err;
    }
  }

  // ====== POST /v1/goal — Goal 模式 HTTP 入口 (2026-06-26) ======
  // Goal 模式: 给定宏大目标, AI 自动分阶段迭代验收, 直到满足验收标准
  r.post('/v1/goal', async (req: Request, res: Response) => {
    try {
      const { goal, userId = 'default', workspace, model } = req.body || {};
      if (!goal || typeof goal !== 'string') {
        return res.status(400).json({ error: 'goal 字段不能为空' });
      }

      const ws = workspace || WorkspaceManager.getInstance().root;
      const loop = new AgentAILoop(router, registry, {
        userId,
        workspace: ws,
        model,
        maxIterations: MAX_ITERATION_CEILING,  // 2026-10-12: 原写死 30 与"允许更多迭代"的注释自相矛盾
        reflectEvery: 5,
        includeSkillsIndex: true,
      });

      const result = await loop.runWithGoal(goal);
      return res.json({
        ok: true,
        goalStatus: result.status,
        phases: result.phases,
        summary: result.summary,
        iterationsTotal: result.iterationsTotal,
      });
    } catch (e: any) {
      console.error('[goal] error:', e?.message);
      return res.status(500).json({ error: e?.message || 'Goal mode failed' });
    }
  });

  // ====== POST /v1/cost-guard/reset — 充值后重置成本守卫 (2026-06-27) ======
  r.post('/v1/cost-guard/reset', (_req: Request, res: Response) => {
    try {
      deps.router.resetCostGuard();
      return res.json({ ok: true, message: '成本守卫已重置' });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message });
    }
  });

  // ====== GET /v1/automations — 自动化任务列表 (2026-06-26) ======
  r.get('/v1/automations', async (_req: Request, res: Response) => {
    try {
      const { getAutomationStore } = await import('../automation-store.js');
      const store = await getAutomationStore();
      const records = await store.list();
      return res.json({ ok: true, count: records.length, automations: records });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message });
    }
  });

  // ====== POST /v1/automations — 创建自动化任务 (2026-06-26) ======
  r.post('/v1/automations', async (req: Request, res: Response) => {
    try {
      const { getAutomationStore } = await import('../automation-store.js');
      const store = await getAutomationStore();
      const record = await store.create({
        ...req.body,
        userId: req.body.userId || 'default',
        cwd: req.body.cwd || WorkspaceManager.getInstance().root,
      });
      return res.status(201).json({ ok: true, automation: record });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message });
    }
  });

  // ====== DELETE /v1/automations/:id — 删除自动化任务 (2026-06-26) ======
  r.delete('/v1/automations/:id', async (req: Request, res: Response) => {
    try {
      const { getAutomationStore } = await import('../automation-store.js');
      const store = await getAutomationStore();
      const ok = await store.delete(req.params['id'] || '');
      if (!ok) return res.status(404).json({ error: '任务不存在' });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message });
    }
  });

  // ═══ 2026-07-02 新增: 意图澄清响应端点 ═══
  // 前端 ClarificationCard 提交用户答案后调用此端点
  // 端点通过 activeLoops 找到对应的 loop 并调用 resolveClarification
  r.post('/v1/clarify/respond', (req: Request, res: Response) => {
    try {
      const { clarificationId, answers, sessionId } = req.body || {};
      if (!clarificationId) {
        return res.status(400).json({ ok: false, error: 'clarificationId required' });
      }

      // 优先通过 sessionId 查找
      let entry = activeLoops.get(sessionId || 'default');
      // 兜底: 遍历所有活跃 loop 尝试 resolve
      if (!entry) {
        for (const [, e] of activeLoops) {
          if (e.loop?.resolveClarification?.(clarificationId, answers || {})) {
            return res.json({ ok: true, message: '澄清已提交' });
          }
        }
        return res.status(404).json({ ok: false, error: '未找到对应的澄清请求 (可能已超时)' });
      }

      const ok = entry.loop?.resolveClarification?.(clarificationId, answers || {});
      if (ok) {
        res.json({ ok: true, message: '澄清已提交' });
      } else {
        res.status(404).json({ ok: false, error: '澄清ID不存在或已过期' });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || '澄清处理失败' });
    }
  });

  // ====== GET /v1/metrics/models — 模型性能指标 (Phase 1: 实时显示+选择器对比+性能面板) ======
  r.get('/v1/metrics/models', (_req: Request, res: Response) => {
    try {
      // 动态导入避免循环依赖
      import('../model-metrics-service.js').then(({ modelMetrics }) => {
        const stats = modelMetrics.getAllStats();
        res.json({ ok: true, count: stats.length, models: stats });
      }).catch((err: any) => {
        res.status(500).json({ ok: false, error: err?.message || '指标服务未就绪' });
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ====== GET /v1/metrics/models/:id — 单个模型指标 ======
  r.get('/v1/metrics/models/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      import('../model-metrics-service.js').then(({ modelMetrics }) => {
        const stats = modelMetrics.getStats(id);
        if (!stats) {
          return res.status(404).json({ ok: false, error: '模型暂无数据' });
        }
        res.json({ ok: true, model: stats });
      }).catch((err: any) => {
        res.status(500).json({ ok: false, error: err?.message || '指标服务未就绪' });
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ====== GET /v1/metrics/recent — 最近调用记录 ======
  r.get('/v1/metrics/recent', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      import('../model-metrics-service.js').then(({ modelMetrics }) => {
        const records = modelMetrics.getRecentRecords(limit);
        res.json({ ok: true, count: records.length, records });
      }).catch((err: any) => {
        res.status(500).json({ ok: false, error: err?.message || '指标服务未就绪' });
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ====== GET /v1/metrics/daily — 每日统计 ======
  r.get('/v1/metrics/daily', (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      import('../model-metrics-service.js').then(({ modelMetrics }) => {
        const stats = modelMetrics.getDailyStats(days);
        res.json({ ok: true, count: stats.length, stats });
      }).catch((err: any) => {
        res.status(500).json({ ok: false, error: err?.message || '指标服务未就绪' });
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ====== GET /v1/metrics/export — 导出CSV ======
  r.get('/v1/metrics/export', (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      import('../model-metrics-service.js').then(({ modelMetrics }) => {
        const csv = modelMetrics.exportToCSV(
          startDate as string | undefined,
          endDate as string | undefined
        );
        if (!csv) {
          return res.status(404).json({ ok: false, error: '无数据可导出' });
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=model-metrics-${Date.now()}.csv`);
        res.send(csv);
      }).catch((err: any) => {
        res.status(500).json({ ok: false, error: err?.message || '导出失败' });
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ====== GET /v1/tools/stats — 工具使用率统计 (P0-2) ======
  r.get('/v1/tools/stats', async (_req: Request, res: Response) => {
    try {
      const { toolUsageStats } = await import('../tool-usage-stats.js');
      const allStats = toolUsageStats.getAllStats();
      const staleCount = toolUsageStats.cleanupStale();
      res.json({
        ok: true,
        data: {
          summary: toolUsageStats.getSummary(),
          tools: allStats.map(t => ({
            name: t.toolName,
            calls: t.callCount,
            success: t.successCount,
            fail: t.failCount,
            successRate: t.callCount > 0 ? Math.round(t.successCount / t.callCount * 100) + '%' : '-',
            lastCalled: new Date(t.lastCalled).toISOString(),
            avgDurationMs: t.callCount > 0 ? Math.round(t.totalDurationMs / t.callCount) : 0,
          })),
          cleanedUp: staleCount,
        },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
  }
});

  // ====== GET /v1/evolution/stats — 自进化规则统计 (P0-4) ======
  r.get('/v1/evolution/stats', async (_req: Request, res: Response) => {
    try {
      const { getEvolutionSummary, cleanupEvolution } = await import('../evolution.js');
      const summary = getEvolutionSummary();
      // 自动清理过期规则
      const cleanup = await cleanupEvolution();
      res.json({
        ok: true,
        data: {
          ...summary,
          cleanedUp: cleanup,
        },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ====== POST /v1/evolution/cleanup — 手动触发清理 ======
  r.post('/v1/evolution/cleanup', async (_req: Request, res: Response) => {
    try {
      const { cleanupEvolution } = await import('../evolution.js');
      const result = await cleanupEvolution();
      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ====== POST /v1/prompt/optimize — 提示词优化专家 (接入真实 LLM) ======
  // 核心理念: 用户给中文就按中文复述, 只是把意图描述得更清楚、任务更完整、结构化更清晰
  // 支持 chat / image / video 三种模式
  r.post('/v1/prompt/optimize', async (req: Request, res: Response) => {
    try {
      const { text, type = 'chat', context } = req.body || {};
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text 字段不能为空' });
      }

      // 统一指令: 保持原始语言, 补全意图, 结构化输出
      const typeHint: Record<string, string> = {
        chat: '这是一条对话指令。补全意图, 分解为明确步骤。',
        image: '这是一条生图描述。补充画面细节(主体/背景/光影/构图/风格), 保持原始语言。',
        video: '这是一条生视频描述。补充运动/镜头/环境, 保持原始语言。输出必须是单段连续文本, 不超过150字, 不要分点编号, 不要标题, 不要输出多维增强描述框架。',
      };

      const instruction = `我是提示词优化专家。将用户的原始输入优化为AI能最优理解的提示词。

工作原则:
1. 保持用户原始语言 (中文→中文, 英文→英文)
2. 补全用户没说但AI需要知道的上下文
3. 保留用户原始意图, 不改变核心需求
4. 输出纯净的指令文本, 不加角色介绍、引导语、解释说明
5. ${type === 'video' ? '视频提示词控制在150字以内, 单段文本, 不要分点编号, 不要标题框架' : '如果包含多任务用编号列表分解'}

绝对禁止:
- 不要输出"我是xxx助手"等角色自我介绍
- 不要反问用户、不要要求用户补充信息
- 不要输出元描述或增强维度框架说明
- ★ 不要复述用户原文 (2026-10-06 新增)
  用户实机反馈:「提示词润色会重复多的重述」
  只输出优化后的那一版。不要先把原文复述一遍再给优化版,
  也不要在结尾用「原始描述: xxx」「用户需求: xxx」等标签把原文再说一次。
  视频模型收到这种提示词会困惑(到底该照哪段拍), 长度也白白翻倍。

${typeHint[type] || typeHint.chat}

只输出优化后的提示词文本本身, 不加任何角色介绍、引导语、解释说明, 也不复述原文。`;

      const contextHint = context ? `\n\n参考信息: ${context}` : '';

      // P0 修复: instruction 放 system role, 用户输入放 user role — 防止 LLM 把角色设定泄漏到输出
      // 之前: instruction + 用户输入全塞在 user message 里 → LLM 分不清指令和输入 → 输出"你是一个xxx助手"
      // 之后: system role 传角色设定 + 规则, user role 只传纯用户输入 → LLM 输出纯净的优化结果
      const chatResp = await router.chat({
        model: 'agentai',
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: `${text}${contextHint}` },
        ],
        temperature: 0.3,
        maxTokens: type === 'video' ? 300 : 1000,
      });

      const enhanced = (chatResp.content || '').trim();

      if (!enhanced) {
        throw new Error('LLM 返回空内容');
      }

      res.json({
        ok: true,
        enhanced,
        provider: chatResp.provider || 'agentai',
      });
    } catch (e: any) {
      console.error('[prompt/optimize] Error:', e?.message || e);
      res.json({
        ok: false,
        error: e?.message || '优化失败',
        enhanced: req.body?.text || '',
      });
    }
  });

  return r;
}
