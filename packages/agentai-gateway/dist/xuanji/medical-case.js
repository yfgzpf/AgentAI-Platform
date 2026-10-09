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
// 医案管理器
// ═══════════════════════════════════════════════════════════
class MedicalCaseManager {
    cases = new Map();
    patientIndex = new Map();
    tagIndex = new Map();
    /**
     * 创建新医案
     */
    createCase(patient, symptoms, diagnosis) {
        const medicalCase = {
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
    updateTreatment(caseId, treatment) {
        const medicalCase = this.cases.get(caseId);
        if (!medicalCase)
            return null;
        medicalCase.treatment = { ...medicalCase.treatment, ...treatment };
        return medicalCase;
    }
    /**
     * 完成医案（记录疗效）
     */
    completeCase(caseId, outcome, lessons) {
        const medicalCase = this.cases.get(caseId);
        if (!medicalCase)
            return null;
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
    queryCases(query) {
        let results = Array.from(this.cases.values());
        if (query.patient) {
            const patientCases = this.patientIndex.get(query.patient);
            if (patientCases) {
                results = results.filter(c => patientCases.has(c.id));
            }
            else {
                return [];
            }
        }
        if (query.status) {
            results = results.filter(c => c.outcome.status === query.status);
        }
        if (query.tags && query.tags.length > 0) {
            results = results.filter(c => query.tags.some(tag => c.lessons.tags.includes(tag)));
        }
        if (query.startTime) {
            results = results.filter(c => c.timestamp >= query.startTime);
        }
        if (query.endTime) {
            results = results.filter(c => c.timestamp <= query.endTime);
        }
        // 按时间倒序
        results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        if (query.limit) {
            results = results.slice(0, query.limit);
        }
        return results;
    }
    /**
     * 查找相似医案
     */
    findSimilarCases(symptoms, limit = 5) {
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
            .filter(s => s.score > 0.3) // 相似度阈值
            .slice(0, limit)
            .map(s => s.case);
    }
    /**
     * 获取统计信息
     */
    getStats() {
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
        const approachCount = {};
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
        const symptomCount = {};
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
    getCase(id) {
        return this.cases.get(id) || null;
    }
    /**
     * 删除医案
     */
    deleteCase(id) {
        const medicalCase = this.cases.get(id);
        if (!medicalCase)
            return false;
        this.cases.delete(id);
        this.unindexCase(medicalCase);
        return true;
    }
    // ═══════════════════════════════════════════════════════════
    // 私有方法
    // ═══════════════════════════════════════════════════════════
    indexCase(medicalCase) {
        // 索引患者
        if (!this.patientIndex.has(medicalCase.patient)) {
            this.patientIndex.set(medicalCase.patient, new Set());
        }
        this.patientIndex.get(medicalCase.patient).add(medicalCase.id);
    }
    indexTags(medicalCase) {
        // 索引标签
        medicalCase.lessons.tags.forEach(tag => {
            if (!this.tagIndex.has(tag)) {
                this.tagIndex.set(tag, new Set());
            }
            this.tagIndex.get(tag).add(medicalCase.id);
        });
    }
    unindexCase(medicalCase) {
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
export function createMedicalCase(patient, symptoms, diagnosis) {
    return medicalCaseManager.createCase(patient, symptoms, diagnosis);
}
/**
 * 完成医案（便捷函数）
 */
export function completeMedicalCase(caseId, outcome, lessons) {
    return medicalCaseManager.completeCase(caseId, outcome, lessons);
}
/**
 * 查找相似医案（便捷函数）
 */
export function findSimilarMedicalCases(symptoms, limit) {
    return medicalCaseManager.findSimilarCases(symptoms, limit);
}
