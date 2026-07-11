/**
 * 医案记录模块 (Medical Case / 医案)
 * 
 * 职责：
 * 1. 记录每次任务处理的完整过程（症状→诊断→治疗→疗效）
 * 2. 积累可复用的经验知识
 * 3. 支持医案检索和相似匹配
 * 
 * 对应中医"医案"概念：
 * - 记录患者症状、辨证、方剂、疗效
 * - 用于经验传承和知识积累
 */

// @ts-ignore - uuid types
import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

/**
 * 医案记录
 */
export interface MedicalCase {
  /** 医案唯一ID */
  id: string;
  
  /** 创建时间 */
  timestamp: string;
  
  /** 患者标识（用户ID或系统标识） */
  patient: string;
  
  /** 症状描述（用户原始输入） */
  symptoms: string;
  
  /** 四诊信息 */
  diagnosis: {
    /** 望诊 - 观察到的信息 */
    inspection: {
      taskType: string;
      complexity: string;
      entities: string[];
    };
    
    /** 闻诊 - 识别的歧义/缺口 */
    auscultation: {
      ambiguities: string[];
      gaps: string[];
    };
    
    /** 问诊 - 追问的信息（如果有） */
    inquiry?: {
      questions: string[];
      answers: string[];
    };
    
    /** 切诊 - 诊断结果 */
    palpation: {
      confidence: number;
      riskLevel: string;
      approach: string;
    };
  };
  
  /** 治疗方案 */
  treatment: {
    /** 治法策略 */
    approach: string;
    
    /** 方剂 - 使用的工具/技能组合 */
    prescription: {
      name: string;
      ingredients: string[];  // 工具/技能列表
      dosage: string;         // 使用方式
    }[];
    
    /** 执行步骤 */
    steps: {
      order: number;
      action: string;
      tool?: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      duration?: number;
    }[];
  };
  
  /** 疗效评估 */
  outcome: {
    /** 结果状态 */
    status: 'success' | 'failure' | 'partial' | 'aborted';
    
    /** 成功率 */
    successRate: number;
    
    /** 执行时间（毫秒） */
    duration: number;
    
    /** 输出结果摘要 */
    result: string;
    
    /** 副作用/问题 */
    sideEffects?: string[];
  };
  
  /** 经验教训 */
  lessons: {
    /** 做得好的 */
    strengths: string[];
    
    /** 需要改进的 */
    weaknesses: string[];
    
    /** 可复用的经验 */
    reusable: boolean;
    
    /** 适用场景标签 */
    tags: string[];
  };
  
  /** 关联的其他医案 */
  relatedCases?: string[];
}

/**
 * 医案查询条件
 */
export interface MedicalCaseQuery {
  patient?: string;
  taskType?: string;
  status?: 'success' | 'failure' | 'partial';
  tags?: string[];
  startTime?: string;
  endTime?: string;
  limit?: number;
}

/**
 * 医案统计
 */
export interface MedicalCaseStats {
  totalCases: number;
  successRate: number;
  averageDuration: number;
  topTreatments: { approach: string; count: number; successRate: number }[];
  commonSymptoms: { symptom: string; count: number }[];
}

// ═══════════════════════════════════════════════════════════
// 医案管理器
// ═══════════════════════════════════════════════════════════

class MedicalCaseManager {
  private cases: Map<string, MedicalCase> = new Map();
  private patientIndex: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();
  
  /**
   * 创建新医案
   */
  createCase(
    patient: string,
    symptoms: string,
    diagnosis: MedicalCase['diagnosis']
  ): MedicalCase {
    const medicalCase: MedicalCase = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      patient,
      symptoms,
      diagnosis,
      treatment: {
        approach: diagnosis.palpation.approach,
        prescription: [],
        steps: [],
      },
      outcome: {
        status: 'aborted',
        successRate: 0,
        duration: 0,
        result: '',
      },
      lessons: {
        strengths: [],
        weaknesses: [],
        reusable: false,
        tags: [],
      },
    };
    
    this.cases.set(medicalCase.id, medicalCase);
    this.indexCase(medicalCase);
    
    return medicalCase;
  }
  
  /**
   * 更新治疗方案
   */
  updateTreatment(
    caseId: string,
    treatment: Partial<MedicalCase['treatment']>
  ): MedicalCase | null {
    const medicalCase = this.cases.get(caseId);
    if (!medicalCase) return null;
    
    medicalCase.treatment = { ...medicalCase.treatment, ...treatment };
    return medicalCase;
  }
  
  /**
   * 完成医案（记录疗效）
   */
  completeCase(
    caseId: string,
    outcome: MedicalCase['outcome'],
    lessons?: Partial<MedicalCase['lessons']>
  ): MedicalCase | null {
    const medicalCase = this.cases.get(caseId);
    if (!medicalCase) return null;
    
    medicalCase.outcome = outcome;
    if (lessons) {
      medicalCase.lessons = { ...medicalCase.lessons, ...lessons };
    }
    
    // 重新索引标签
    this.indexTags(medicalCase);
    
    return medicalCase;
  }
  
  /**
   * 查询医案
   */
  queryCases(query: MedicalCaseQuery): MedicalCase[] {
    let results = Array.from(this.cases.values());
    
    if (query.patient) {
      const patientCases = this.patientIndex.get(query.patient);
      if (patientCases) {
        results = results.filter(c => patientCases.has(c.id));
      } else {
        return [];
      }
    }
    
    if (query.status) {
      results = results.filter(c => c.outcome.status === query.status);
    }
    
    if (query.tags && query.tags.length > 0) {
      results = results.filter(c => 
        query.tags!.some(tag => c.lessons.tags.includes(tag))
      );
    }
    
    if (query.startTime) {
      results = results.filter(c => c.timestamp >= query.startTime!);
    }
    
    if (query.endTime) {
      results = results.filter(c => c.timestamp <= query.endTime!);
    }
    
    // 按时间倒序
    results.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    if (query.limit) {
      results = results.slice(0, query.limit);
    }
    
    return results;
  }
  
  /**
   * 查找相似医案
   */
  findSimilarCases(symptoms: string, limit: number = 5): MedicalCase[] {
    // 简单的关键词匹配（可升级为向量相似度）
    const symptomWords = symptoms.toLowerCase().split(/\s+/);
    
    const scoredCases = Array.from(this.cases.values()).map(c => {
      const caseWords = c.symptoms.toLowerCase().split(/\s+/);
      const commonWords = symptomWords.filter(w => caseWords.includes(w));
      const score = commonWords.length / Math.max(symptomWords.length, caseWords.length);
      return { case: c, score };
    });
    
    scoredCases.sort((a, b) => b.score - a.score);
    
    return scoredCases
      .filter(s => s.score > 0.3)  // 相似度阈值
      .slice(0, limit)
      .map(s => s.case);
  }
  
  /**
   * 获取统计信息
   */
  getStats(): MedicalCaseStats {
    const allCases = Array.from(this.cases.values());
    const completedCases = allCases.filter(c => c.outcome.status !== 'aborted');
    
    // 成功率
    const successCases = completedCases.filter(c => c.outcome.status === 'success');
    const successRate = completedCases.length > 0 
      ? successCases.length / completedCases.length 
      : 0;
    
    // 平均执行时间
    const averageDuration = completedCases.length > 0
      ? completedCases.reduce((sum, c) => sum + c.outcome.duration, 0) / completedCases.length
      : 0;
    
    // 常用治法统计
    const approachCount: Record<string, { count: number; successes: number }> = {};
    completedCases.forEach(c => {
      const approach = c.treatment.approach;
      if (!approachCount[approach]) {
        approachCount[approach] = { count: 0, successes: 0 };
      }
      approachCount[approach].count++;
      if (c.outcome.status === 'success') {
        approachCount[approach].successes++;
      }
    });
    
    const topTreatments = Object.entries(approachCount)
      .map(([approach, data]) => ({
        approach,
        count: data.count,
        successRate: data.successes / data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    // 常见症状
    const symptomCount: Record<string, number> = {};
    allCases.forEach(c => {
      const words = c.symptoms.split(/\s+/).slice(0, 5);
      words.forEach(w => {
        symptomCount[w] = (symptomCount[w] || 0) + 1;
      });
    });
    
    const commonSymptoms = Object.entries(symptomCount)
      .map(([symptom, count]) => ({ symptom, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return {
      totalCases: allCases.length,
      successRate,
      averageDuration,
      topTreatments,
      commonSymptoms,
    };
  }
  
  /**
   * 获取单个医案
   */
  getCase(id: string): MedicalCase | null {
    return this.cases.get(id) || null;
  }
  
  /**
   * 删除医案
   */
  deleteCase(id: string): boolean {
    const medicalCase = this.cases.get(id);
    if (!medicalCase) return false;
    
    this.cases.delete(id);
    this.unindexCase(medicalCase);
    
    return true;
  }
  
  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════
  
  private indexCase(medicalCase: MedicalCase): void {
    // 索引患者
    if (!this.patientIndex.has(medicalCase.patient)) {
      this.patientIndex.set(medicalCase.patient, new Set());
    }
    this.patientIndex.get(medicalCase.patient)!.add(medicalCase.id);
  }
  
  private indexTags(medicalCase: MedicalCase): void {
    // 索引标签
    medicalCase.lessons.tags.forEach(tag => {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(medicalCase.id);
    });
  }
  
  private unindexCase(medicalCase: MedicalCase): void {
    // 移除患者索引
    const patientCases = this.patientIndex.get(medicalCase.patient);
    if (patientCases) {
      patientCases.delete(medicalCase.id);
    }
    
    // 移除标签索引
    medicalCase.lessons.tags.forEach(tag => {
      const tagCases = this.tagIndex.get(tag);
      if (tagCases) {
        tagCases.delete(medicalCase.id);
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 导出单例
// ═══════════════════════════════════════════════════════════

export const medicalCaseManager = new MedicalCaseManager();

// ═══════════════════════════════════════════════════════════
// 便捷函数
// ═══════════════════════════════════════════════════════════

/**
 * 创建医案（便捷函数）
 */
export function createMedicalCase(
  patient: string,
  symptoms: string,
  diagnosis: MedicalCase['diagnosis']
): MedicalCase {
  return medicalCaseManager.createCase(patient, symptoms, diagnosis);
}

/**
 * 完成医案（便捷函数）
 */
export function completeMedicalCase(
  caseId: string,
  outcome: MedicalCase['outcome'],
  lessons?: Partial<MedicalCase['lessons']>
): MedicalCase | null {
  return medicalCaseManager.completeCase(caseId, outcome, lessons);
}

/**
 * 查找相似医案（便捷函数）
 */
export function findSimilarMedicalCases(
  symptoms: string,
  limit?: number
): MedicalCase[] {
  return medicalCaseManager.findSimilarCases(symptoms, limit);
}
