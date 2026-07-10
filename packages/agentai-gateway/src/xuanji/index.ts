/**
 * Xuanji (璇玑) - 状态感知与辨证推理层
 * 
 * 融合中医辨证思维的智能体认知框架
 * 
 * 核心理念：
 * - 望闻问切：四诊合参，全面感知系统状态
 * - 辨证论治：识别证候模式，确定治法
 * - 君臣佐使：多策略协同编排
 * - 医案传承：经验积累与复用
 * 
 * 架构：
 * ```
 * 用户输入 → 四诊合参 → 辨证推理 → 方剂编排 → 施治执行 → 疗效评估 → 医案记录
 *    │           │           │           │           │           │
 *    ▼           ▼           ▼           ▼           ▼           ▼
 *  症状      状态感知    证候识别    策略选择    工具调用    效果验证    经验积累
 * ```
 */

// ═══════════════════════════════════════════════════════════
// 导出四诊模块（从现有diagnosis模块迁移）
// ═══════════════════════════════════════════════════════════

// 望闻问 - 任务感知
export { 
  perceiveTask,
  type TaskPerceptionReport,
  type InformationGap,
  type TaskType,
  type ActionType,
  type ComplexityLevel,
} from '../diagnosis/task-perception.js';

// 切诊 - 诊断决策
export { 
  diagnoseTask,
  type DiagnosisReport,
  type DiagnosisContext,
  type DiagnosisConfig,
  type TreatmentApproach,
  type RiskLevel,
} from '../diagnosis/diagnosis-engine.js';

// 缺口分析
export {
  analyzeGaps,
  type GapAnalysisReport,
} from '../diagnosis/gap-analyzer.js';

// ═══════════════════════════════════════════════════════════
// 导出医案模块
// ═══════════════════════════════════════════════════════════

export {
  medicalCaseManager,
  createMedicalCase,
  completeMedicalCase,
  findSimilarMedicalCases,
  type MedicalCase,
  type MedicalCaseQuery,
  type MedicalCaseStats,
} from './medical-case.js';

// ═══════════════════════════════════════════════════════════
// 导出方剂编排模块（待实现）
// ═══════════════════════════════════════════════════════════

export {
  PrescriptionEngine,
  type Prescription,
  type Ingredient,
  type Dosage,
} from './prescription-engine.js';

// ═══════════════════════════════════════════════════════════
// 主入口类
// ═══════════════════════════════════════════════════════════

import { perceiveTask, TaskPerceptionReport } from '../diagnosis/task-perception.js';
import { diagnoseTask, DiagnosisReport, DiagnosisContext } from '../diagnosis/diagnosis-engine.js';
import { medicalCaseManager, MedicalCase, createMedicalCase, completeMedicalCase } from './medical-case.js';
import { PrescriptionEngine } from './prescription-engine.js';

export interface XuanjiConfig {
  /** 是否启用医案记录 */
  enableMedicalCase?: boolean;
  /** 是否查找相似医案 */
  enableSimilarCaseSearch?: boolean;
  /** 是否自动评估疗效 */
  enableAutoEvaluation?: boolean;
}

export interface XuanjiResult {
  /** 医案ID */
  caseId?: string;
  /** 四诊报告 */
  perception: TaskPerceptionReport;
  /** 辨证报告 */
  diagnosis: DiagnosisReport;
  /** 方剂（治疗方案） */
  prescription?: {
    approach: string;
    steps: string[];
  };
  /** 相似医案 */
  similarCases?: MedicalCase[];
}

/**
 * Xuanji 主类
 * 
 * 使用示例：
 * ```typescript
 * const xuanji = new Xuanji();
 * const result = await xuanji.processTask(userMessages, context);
 * 
 * // 执行治疗...
 * 
 * // 完成医案
 * await xuanji.completeTreatment(result.caseId!, outcome);
 * ```
 */
export class Xuanji {
  private config: XuanjiConfig;
  private prescriptionEngine: PrescriptionEngine;
  
  constructor(config: XuanjiConfig = {}) {
    this.config = {
      enableMedicalCase: true,
      enableSimilarCaseSearch: true,
      enableAutoEvaluation: true,
      ...config,
    };
    this.prescriptionEngine = new PrescriptionEngine();
  }
  
  /**
   * 处理任务 - 四诊合参 + 辨证 + 开方
   */
  async processTask(
    messages: any[],
    context?: DiagnosisContext
  ): Promise<XuanjiResult> {
    const patient = context?.projectPath || 'anonymous';
    const symptoms = this.extractSymptoms(messages);
    
    // 1. 四诊合参（望闻问）
    const perception = await perceiveTask(messages, context);
    
    // 2. 查找相似医案
    let similarCases: MedicalCase[] | undefined;
    if (this.config.enableSimilarCaseSearch) {
      similarCases = medicalCaseManager.findSimilarCases(symptoms, 3);
    }
    
    // 3. 辨证（切诊）
    const diagnosis = await diagnoseTask(perception, context || {});
    
    // 4. 创建医案
    let caseId: string | undefined;
    if (this.config.enableMedicalCase) {
      const medicalCase = createMedicalCase(patient, symptoms, {
        inspection: {
          taskType: perception.taskType,
          complexity: perception.complexity,
          entities: perception.entities,
        },
        auscultation: {
          ambiguities: perception.ambiguity.flags,
          gaps: perception.gapList.map(g => g.description),
        },
        inquiry: undefined,  // 如有追问，后续更新
        palpation: {
          confidence: diagnosis.confidence,
          riskLevel: diagnosis.riskLevel,
          approach: diagnosis.recommendedApproach,
        },
      });
      caseId = medicalCase.id;
    }
    
    // 5. 开方（方剂编排）
    const prescription = this.prescriptionEngine.prescribe(diagnosis, similarCases);
    
    // 6. 更新医案的治疗方案
    if (caseId) {
      medicalCaseManager.updateTreatment(caseId, {
        approach: prescription.approach,
        prescription: prescription.ingredients.map((ing, idx) => ({
          name: `步骤${idx + 1}`,
          ingredients: [ing.tool],
          dosage: ing.parameters,
        })),
        steps: prescription.steps.map((step, idx) => ({
          order: idx + 1,
          action: step.action,
          tool: step.tool,
          status: 'pending',
        })),
      });
    }
    
    return {
      caseId,
      perception,
      diagnosis,
      prescription: {
        approach: prescription.approach,
        steps: prescription.steps.map(s => s.action),
      },
      similarCases,
    };
  }
  
  /**
   * 完成治疗 - 记录疗效
   */
  async completeTreatment(
    caseId: string,
    outcome: {
      status: 'success' | 'failure' | 'partial';
      result: string;
      duration: number;
      sideEffects?: string[];
    }
  ): Promise<MedicalCase | null> {
    if (!this.config.enableMedicalCase) return null;
    
    // 自动评估经验教训
    const lessons = this.evaluateLessons(caseId, outcome);
    
    return completeMedicalCase(
      caseId,
      {
        status: outcome.status,
        successRate: outcome.status === 'success' ? 1 : outcome.status === 'partial' ? 0.5 : 0,
        duration: outcome.duration,
        result: outcome.result,
        sideEffects: outcome.sideEffects,
      },
      lessons
    );
  }
  
  /**
   * 获取医案统计
   */
  getStats() {
    return medicalCaseManager.getStats();
  }
  
  /**
   * 查询医案
   */
  queryCases(query: Parameters<typeof medicalCaseManager.queryCases>[0]) {
    return medicalCaseManager.queryCases(query);
  }
  
  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════
  
  private extractSymptoms(messages: any[]): string {
    // 提取用户最后一条消息作为症状描述
    const lastUserMessage = messages
      .filter(m => m.role === 'user')
      .pop();
    
    return lastUserMessage?.content || '';
  }
  
  private evaluateLessons(
    caseId: string,
    outcome: { status: string; result: string }
  ): { strengths: string[]; weaknesses: string[]; reusable: boolean; tags: string[] } {
    const medicalCase = medicalCaseManager.getCase(caseId);
    if (!medicalCase) {
      return { strengths: [], weaknesses: [], reusable: false, tags: [] };
    }
    
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const tags: string[] = [];
    
    // 根据结果评估
    if (outcome.status === 'success') {
      strengths.push('治疗方案有效');
      if (medicalCase.diagnosis.palpation.confidence > 0.8) {
        strengths.push('辨证准确');
      }
      tags.push('成功案例');
    } else if (outcome.status === 'failure') {
      weaknesses.push('治疗方案未达预期');
      if (medicalCase.diagnosis.palpation.confidence < 0.5) {
        weaknesses.push('辨证置信度不足');
      }
      tags.push('失败案例');
    } else {
      strengths.push('部分有效');
      weaknesses.push('需要优化');
      tags.push('部分成功');
    }
    
    // 添加任务类型标签
    tags.push(medicalCase.diagnosis.inspection.taskType);
    tags.push(medicalCase.diagnosis.inspection.complexity);
    
    return {
      strengths,
      weaknesses,
      reusable: outcome.status === 'success',
      tags,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 默认导出
// ═══════════════════════════════════════════════════════════

export default Xuanji;
