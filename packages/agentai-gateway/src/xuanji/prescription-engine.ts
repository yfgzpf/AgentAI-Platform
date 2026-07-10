/**
 * 方剂编排引擎 (Prescription Engine / 方剂编排)
 * 
 * 职责：
 * 1. 根据辨证结果，选择合适的治疗策略
 * 2. 编排工具/技能的执行顺序（君臣佐使）
 * 3. 处理策略间的依赖关系
 * 
 * 对应中医"方剂"概念：
 * - 君药：主治病症的核心工具
 * - 臣药：辅助君药，增强疗效
 * - 佐药：制约副作用，或针对兼症
 * - 使药：引导、调和诸工具
 */

import { DiagnosisReport, TreatmentApproach } from '../diagnosis/diagnosis-engine.js';
import { MedicalCase } from './medical-case.js';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

/**
 * 方剂（治疗方案）
 */
export interface Prescription {
  /** 治法名称 */
  approach: string;
  
  /** 治法描述 */
  description: string;
  
  /** 组成成分（君臣佐使） */
  ingredients: Ingredient[];
  
  /** 执行步骤 */
  steps: Step[];
  
  /** 预期疗效 */
  expectedOutcome: {
    successRate: number;
    estimatedDuration: number;
    keyMetrics: string[];
  };
  
  /** 注意事项 */
  precautions: string[];
}

/**
 * 成分（单味药/工具）
 */
export interface Ingredient {
  /** 角色：君、臣、佐、使 */
  role: 'jun' | 'chen' | 'zuo' | 'shi';
  
  /** 工具/技能名称 */
  tool: string;
  
  /** 作用描述 */
  effect: string;
  
  /** 参数配置 */
  parameters: Record<string, any>;
  
  /** 依赖的其他成分 */
  dependencies?: string[];
  
  /** 执行条件 */
  condition?: string;
}

/**
 * 剂量（执行配置）
 */
export interface Dosage {
  /** 执行顺序 */
  order: number;
  
  /** 重试次数 */
  retries: number;
  
  /** 超时时间 */
  timeout: number;
  
  /** 失败处理策略 */
  onFailure: 'abort' | 'continue' | 'fallback';
}

/**
 * 执行步骤
 */
export interface Step {
  /** 步骤ID */
  id: string;
  
  /** 步骤名称 */
  action: string;
  
  /** 使用的工具 */
  tool?: string;
  
  /** 输入参数 */
  input?: Record<string, any>;
  
  /** 预期输出 */
  expectedOutput?: string;
  
  /** 执行配置 */
  dosage: Dosage;
}

// ═══════════════════════════════════════════════════════════
// 方剂编排引擎
// ═══════════════════════════════════════════════════════════

export class PrescriptionEngine {
  /**
   * 开方 - 根据辨证结果生成治疗方案
   */
  prescribe(
    diagnosis: DiagnosisReport,
    similarCases?: MedicalCase[]
  ): Prescription {
    // 根据辨证结果选择治法
    const approach = diagnosis.recommendedApproach;
    
    // 参考相似医案（如果有成功的）
    const successfulCases = similarCases?.filter(c => c.outcome.status === 'success');
    if (successfulCases && successfulCases.length > 0) {
      // 复用相似案例的治疗方案
      return this.adaptPrescription(successfulCases[0], diagnosis);
    }
    
    // 根据治法生成新方案
    return this.generatePrescription(approach, diagnosis);
  }
  
  /**
   * 生成治疗方案
   */
  private generatePrescription(
    approach: TreatmentApproach,
    diagnosis: DiagnosisReport
  ): Prescription {
    switch (approach) {
      case 'direct':
        return this.generateDirectPrescription(diagnosis);
      case 'step_by_step':
        return this.generateStepByStepPrescription(diagnosis);
      case 'comprehensive':
        return this.generateComprehensivePrescription(diagnosis);
      case 'conservative':
        return this.generateConservativePrescription(diagnosis);
      default:
        return this.generateDirectPrescription(diagnosis);
    }
  }
  
  /**
   * 直接执行方案（汗法）
   */
  private generateDirectPrescription(diagnosis: DiagnosisReport): Prescription {
    return {
      approach: '汗法（轻解）',
      description: '单刀直入，快速解决',
      ingredients: [
        {
          role: 'jun',
          tool: 'llm-generate',
          effect: '直接生成解决方案',
          parameters: { mode: 'fast', temperature: 0.3 },
        },
      ],
      steps: [
        {
          id: 'step-1',
          action: '理解需求',
          tool: 'intent-parser',
          dosage: { order: 1, retries: 1, timeout: 5000, onFailure: 'abort' },
        },
        {
          id: 'step-2',
          action: '生成方案',
          tool: 'llm-generate',
          dosage: { order: 2, retries: 2, timeout: 30000, onFailure: 'abort' },
        },
        {
          id: 'step-3',
          action: '执行验证',
          tool: 'validator',
          dosage: { order: 3, retries: 1, timeout: 10000, onFailure: 'continue' },
        },
      ],
      expectedOutcome: {
        successRate: diagnosis.successProbability,
        estimatedDuration: 45000,
        keyMetrics: ['执行时间', '成功率'],
      },
      precautions: ['确保需求明确', '避免过度设计'],
    };
  }
  
  /**
   * 分步执行方案（和法）
   */
  private generateStepByStepPrescription(diagnosis: DiagnosisReport): Prescription {
    return {
      approach: '和法（分步）',
      description: '循序渐进，稳扎稳打',
      ingredients: [
        {
          role: 'jun',
          tool: 'task-planner',
          effect: '制定详细执行计划',
          parameters: { granularity: 'fine' },
        },
        {
          role: 'chen',
          tool: 'step-executor',
          effect: '按步骤执行',
          parameters: { verifyEach: true },
        },
        {
          role: 'zuo',
          tool: 'error-handler',
          effect: '处理执行中的异常',
          parameters: { strategy: 'retry' },
        },
      ],
      steps: [
        {
          id: 'step-1',
          action: '任务分解',
          tool: 'task-planner',
          dosage: { order: 1, retries: 1, timeout: 15000, onFailure: 'abort' },
        },
        {
          id: 'step-2',
          action: '逐步执行',
          tool: 'step-executor',
          dosage: { order: 2, retries: 3, timeout: 120000, onFailure: 'fallback' },
        },
        {
          id: 'step-3',
          action: '结果验证',
          tool: 'validator',
          dosage: { order: 3, retries: 2, timeout: 30000, onFailure: 'continue' },
        },
      ],
      expectedOutcome: {
        successRate: diagnosis.successProbability * 0.9,
        estimatedDuration: 165000,
        keyMetrics: ['步骤完成率', '中间结果质量'],
      },
      precautions: ['每步验证后再继续', '保留回滚点'],
    };
  }
  
  /**
   * 全面重构方案（下法）
   */
  private generateComprehensivePrescription(diagnosis: DiagnosisReport): Prescription {
    return {
      approach: '下法（峻补）',
      description: '全面分析，系统重构',
      ingredients: [
        {
          role: 'jun',
          tool: 'deep-analyzer',
          effect: '深度分析系统现状',
          parameters: { depth: 'comprehensive' },
        },
        {
          role: 'chen',
          tool: 'architect',
          effect: '设计优化方案',
          parameters: { pattern: 'modern' },
        },
        {
          role: 'zuo',
          tool: 'risk-assessor',
          effect: '评估重构风险',
          parameters: { scope: 'full' },
        },
        {
          role: 'shi',
          tool: 'migration-guide',
          effect: '指导平滑迁移',
          parameters: { strategy: 'gradual' },
        },
      ],
      steps: [
        {
          id: 'step-1',
          action: '现状诊断',
          tool: 'deep-analyzer',
          dosage: { order: 1, retries: 1, timeout: 60000, onFailure: 'abort' },
        },
        {
          id: 'step-2',
          action: '方案设计',
          tool: 'architect',
          dosage: { order: 2, retries: 2, timeout: 120000, onFailure: 'abort' },
        },
        {
          id: 'step-3',
          action: '风险评估',
          tool: 'risk-assessor',
          dosage: { order: 3, retries: 1, timeout: 30000, onFailure: 'continue' },
        },
        {
          id: 'step-4',
          action: '实施重构',
          tool: 'refactor-engine',
          dosage: { order: 4, retries: 3, timeout: 300000, onFailure: 'fallback' },
        },
        {
          id: 'step-5',
          action: '验证测试',
          tool: 'test-runner',
          dosage: { order: 5, retries: 2, timeout: 180000, onFailure: 'abort' },
        },
      ],
      expectedOutcome: {
        successRate: diagnosis.successProbability * 0.8,
        estimatedDuration: 600000,
        keyMetrics: ['代码质量提升', '性能改善', '风险可控'],
      },
      precautions: ['备份原始代码', '分阶段实施', '充分测试'],
    };
  }
  
  /**
   * 保守方案（温法）
   */
  private generateConservativePrescription(diagnosis: DiagnosisReport): Prescription {
    return {
      approach: '温法（保守）',
      description: '谨慎行事，最小改动',
      ingredients: [
        {
          role: 'jun',
          tool: 'minimal-changer',
          effect: '只做必要的最小改动',
          parameters: { scope: 'minimal' },
        },
        {
          role: 'chen',
          tool: 'safety-checker',
          effect: '安全检查每一步',
          parameters: { strict: true },
        },
      ],
      steps: [
        {
          id: 'step-1',
          action: '影响分析',
          tool: 'impact-analyzer',
          dosage: { order: 1, retries: 1, timeout: 20000, onFailure: 'abort' },
        },
        {
          id: 'step-2',
          action: '最小改动',
          tool: 'minimal-changer',
          dosage: { order: 2, retries: 2, timeout: 60000, onFailure: 'abort' },
        },
        {
          id: 'step-3',
          action: '安全验证',
          tool: 'safety-checker',
          dosage: { order: 3, retries: 2, timeout: 30000, onFailure: 'abort' },
        },
      ],
      expectedOutcome: {
        successRate: diagnosis.successProbability * 0.95,
        estimatedDuration: 110000,
        keyMetrics: ['改动范围', '回归风险'],
      },
      precautions: ['避免过度设计', '优先兼容性'],
    };
  }
  
  /**
   * 复用并调整相似医案的方案
   */
  private adaptPrescription(
    similarCase: MedicalCase,
    currentDiagnosis: DiagnosisReport
  ): Prescription {
    // 基于相似医案的治疗方案，根据当前情况调整
    const originalPrescription = similarCase.treatment.prescription[0];
    
    return {
      approach: `化裁（基于医案 ${similarCase.id.slice(0, 8)}）`,
      description: `参考相似医案，辨证化裁：${originalPrescription.name}`,
      ingredients: [
        {
          role: 'jun',
          tool: 'adapted-strategy',
          effect: '基于历史经验调整的策略',
          parameters: { 
            baseCase: similarCase.id,
            adaptation: 'context-aware' 
          },
        },
        ...similarCase.treatment.prescription.map((p, idx) => ({
          role: (['jun', 'chen', 'zuo', 'shi'][idx] || 'zuo') as Ingredient['role'],
          tool: p.ingredients[0] || 'default-tool',
          effect: `来自医案的经验：${p.name}`,
          parameters: { reused: true },
        })),
      ],
      steps: similarCase.treatment.steps.map((s, idx) => ({
        id: `step-${idx + 1}`,
        action: s.action,
        tool: s.tool,
        dosage: { 
          order: idx + 1, 
          retries: 2, 
          timeout: 60000, 
          onFailure: 'fallback' 
        },
      })),
      expectedOutcome: {
        successRate: similarCase.outcome.successRate * 0.95,  // 略低于原医案
        estimatedDuration: similarCase.outcome.duration * 1.1,  // 略长
        keyMetrics: ['复用成功率', '调整适配度'],
      },
      precautions: ['注意上下文差异', '验证适配效果'],
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 导出单例
// ═══════════════════════════════════════════════════════════

export const prescriptionEngine = new PrescriptionEngine();
