/**
 * 岐枢四诊系统 API 路由
 * ----------------------------------------------------
 * 提供系统健康诊断和用户输入分析接口
 */

import { Router } from 'express';
import { getFourDiagnosesSystem } from '../qihuang/four-diagnoses.js';
import { AgentAIRouter } from '../llm-router.js';

export function createQihuangRouter(llmRouter: AgentAIRouter): Router {
  const router = Router();
  const diagnosis = getFourDiagnosesSystem(llmRouter);

  /**
   * GET /api/qihuang/diagnose
   * 系统自检 - 执行完整四诊
   */
  router.get('/diagnose', async (req, res) => {
    try {
      const result = await diagnosis.diagnose();
      res.json({
        success: true,
        data: result,
        summary: {
          healthScore: result.holisticAssessment.overallHealth,
          severity: result.qie.diagnosis.severity,
          primaryConcern: result.holisticAssessment.primaryConcern,
          prescriptionsCount: result.qie.prescriptions.length,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || '诊断失败',
      });
    }
  });

  /**
   * POST /api/qihuang/analyze-input
   * 分析用户输入 - 问诊
   */
  router.post('/analyze-input', async (req, res) => {
    try {
      const { input } = req.body;
      if (!input || typeof input !== 'string') {
        return res.status(400).json({
          success: false,
          error: '缺少 input 参数',
        });
      }

      const result = await diagnosis.diagnose(input);
      res.json({
        success: true,
        data: {
          ambiguities: result.wenQuestion.ambiguities,
          informationGaps: result.wenQuestion.informationGaps,
          suggestedQuestions: result.wenQuestion.suggestedQuestions,
          userIntent: result.wenQuestion.userIntent,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || '分析失败',
      });
    }
  });

  /**
   * GET /api/qihuang/health
   * 快速健康检查
   */
  router.get('/health', async (req, res) => {
    try {
      const result = await diagnosis.diagnose();
      const health = result.holisticAssessment;

      res.json({
        success: true,
        health: {
          score: health.overallHealth,
          status: health.overallHealth >= 80 ? 'healthy' :
                  health.overallHealth >= 60 ? 'suboptimal' :
                  health.overallHealth >= 40 ? 'degraded' : 'critical',
          primaryConcern: health.primaryConcern,
          recommendedAction: health.recommendedAction,
        },
        checks: {
          wang: result.wang.anomalies.length === 0,
          wen: result.wen.performanceMetrics.errorRate < 0.05,
          qie: result.qie.diagnosis.severity !== 'critical',
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || '健康检查失败',
      });
    }
  });

  /**
   * GET /api/qihuang/prescriptions
   * 获取治疗建议
   */
  router.get('/prescriptions', async (req, res) => {
    try {
      const result = await diagnosis.diagnose();
      res.json({
        success: true,
        prescriptions: result.qie.prescriptions,
        diagnosis: result.qie.diagnosis,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || '获取建议失败',
      });
    }
  });

  return router;
}
