/**
 * Approval Policy Engine — 分级审批策略引擎
 * --------------------------------------------
 * 根据修改风险等级自动选择审批策略，平衡安全与效率
 *
 * 策略矩阵:
 * - 低风险 (score < 30): 自动执行，事后审计
 * - 中风险 (30-70): 快速审批，5分钟超时自动执行
 * - 高风险 (score > 70): 强制人工审批
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const DEFAULT_CONFIG = {
    lowRiskThreshold: 30,
    highRiskThreshold: 70,
    autoExecutePatterns: [
        '\\.agentai\\/custom-tools\\/',
        '\\.agentai\\/evolved-rules\\.json$',
        'test\\.',
        'spec\\.',
        '_test\\.',
    ],
    requireApprovalPatterns: [
        'src\\/llm-router',
        'src\\/agentai-loop',
        'src\\/tools\\.ts$',
        'package\\.json$',
        'tsconfig',
        '\\.env',
    ],
    mediumRiskTimeoutMs: 5 * 60 * 1000, // 5分钟
    notifications: {
        low: false,
        medium: true,
        high: true,
        critical: true,
    }
};
const CONFIG_FILE = path.join(os.homedir(), '.agentai', 'config', 'approval-policy.json');
class ApprovalPolicyEngine {
    config;
    proposals = new Map();
    listeners = new Set();
    constructor() {
        this.config = this.loadConfig();
    }
    loadConfig() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
                return { ...DEFAULT_CONFIG, ...saved };
            }
        }
        catch (e) {
            console.warn('[approval-policy] Failed to load config:', e);
        }
        return { ...DEFAULT_CONFIG };
    }
    saveConfig() {
        try {
            const dir = path.dirname(CONFIG_FILE);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
        }
        catch (e) {
            console.warn('[approval-policy] Failed to save config:', e);
        }
    }
    /**
     * 计算风险评分 (0-100)
     */
    calculateRiskScore(proposal) {
        let score = 0;
        // 1. 文件路径风险
        if (this.matchesPatterns(proposal.targetFile, this.config.requireApprovalPatterns)) {
            score += 40; // 核心文件高风险
        }
        if (this.matchesPatterns(proposal.targetFile, this.config.autoExecutePatterns)) {
            score -= 20; // 白名单文件低风险
        }
        // 2. 修改类型风险
        const typeRisk = {
            'config': 10,
            'skill': 30,
            'tool': 50,
            'rule': 40,
        };
        score += typeRisk[proposal.type] || 30;
        // 3. 代码复杂度风险 (基于diff行数)
        const diffLines = proposal.diff.split('\n').length;
        if (diffLines > 100)
            score += 20;
        else if (diffLines > 50)
            score += 10;
        // 4. 敏感操作检测
        const sensitivePatterns = [
            /process\.kill/i,
            /eval\s*\(/i,
            /child_process/i,
            /fs\.unlink/i,
            /rm\s+-rf/i,
            /DELETE\s+FROM/i,
            /DROP\s+TABLE/i,
        ];
        for (const pattern of sensitivePatterns) {
            if (pattern.test(proposal.diff)) {
                score += 25;
                break;
            }
        }
        // 5. API密钥/密码检测
        if (/api[_-]?key|password|secret|token/i.test(proposal.diff)) {
            score += 15;
        }
        return Math.min(100, Math.max(0, score));
    }
    matchesPatterns(filePath, patterns) {
        return patterns.some(p => new RegExp(p, 'i').test(filePath));
    }
    /**
     * 确定审批策略
     */
    determinePolicy(riskScore) {
        if (riskScore < this.config.lowRiskThreshold) {
            return {
                level: 'low',
                autoExecute: true,
                timeoutMs: 0,
                requireApproval: false,
                notifyChannels: this.config.notifications.low ? ['console'] : []
            };
        }
        if (riskScore > this.config.highRiskThreshold) {
            return {
                level: riskScore > 90 ? 'critical' : 'high',
                autoExecute: false,
                timeoutMs: Infinity,
                requireApproval: true,
                notifyChannels: ['console', 'ui']
            };
        }
        return {
            level: 'medium',
            autoExecute: true,
            timeoutMs: this.config.mediumRiskTimeoutMs,
            requireApproval: false,
            notifyChannels: this.config.notifications.medium ? ['console', 'ui'] : ['console']
        };
    }
    /**
     * 提交修改提案
     */
    submitProposal(proposal) {
        const riskScore = this.calculateRiskScore(proposal);
        const policy = this.determinePolicy(riskScore);
        const fullProposal = {
            ...proposal,
            id: `prop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            riskScore,
            policy,
            status: policy.autoExecute ? 'auto_executed' : 'pending',
            timestamp: Date.now()
        };
        this.proposals.set(fullProposal.id, fullProposal);
        // 触发通知
        this.notify(fullProposal);
        // 设置超时
        if (policy.timeoutMs > 0 && policy.timeoutMs !== Infinity) {
            setTimeout(() => {
                this.handleTimeout(fullProposal.id);
            }, policy.timeoutMs);
        }
        console.log(`[approval-policy] Proposal ${fullProposal.id}: risk=${riskScore}, level=${policy.level}, auto=${policy.autoExecute}`);
        return fullProposal;
    }
    handleTimeout(proposalId) {
        const proposal = this.proposals.get(proposalId);
        if (proposal && proposal.status === 'pending') {
            proposal.status = 'timeout';
            this.proposals.set(proposalId, proposal);
            this.notify(proposal);
            console.log(`[approval-policy] Proposal ${proposalId} timed out, auto-executing`);
        }
    }
    /**
     * 人工审批
     */
    approve(proposalId, approved, reviewer) {
        const proposal = this.proposals.get(proposalId);
        if (!proposal)
            return null;
        proposal.status = approved ? 'approved' : 'rejected';
        this.proposals.set(proposalId, proposal);
        console.log(`[approval-policy] Proposal ${proposalId} ${approved ? 'approved' : 'rejected'} by ${reviewer || 'unknown'}`);
        this.notify(proposal);
        return proposal;
    }
    /**
     * 获取提案状态
     */
    getProposal(id) {
        return this.proposals.get(id);
    }
    /**
     * 获取所有提案
     */
    getAllProposals() {
        return Array.from(this.proposals.values()).sort((a, b) => b.timestamp - a.timestamp);
    }
    /**
     * 获取待审批提案
     */
    getPendingProposals() {
        return this.getAllProposals().filter(p => p.status === 'pending');
    }
    /**
     * 订阅提案变更
     */
    onProposalChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    notify(proposal) {
        for (const listener of this.listeners) {
            try {
                listener(proposal);
            }
            catch (e) {
                console.error('[approval-policy] Listener error:', e);
            }
        }
    }
    /**
     * 更新配置
     */
    updateConfig(updates) {
        this.config = { ...this.config, ...updates };
        this.saveConfig();
    }
    /**
     * 获取当前配置
     */
    getConfig() {
        return { ...this.config };
    }
}
// 单例
let engine = null;
export function getApprovalEngine() {
    if (!engine) {
        engine = new ApprovalPolicyEngine();
    }
    return engine;
}
// 便捷函数
export function submitModification(proposal) {
    return getApprovalEngine().submitProposal(proposal);
}
export function approveModification(proposalId, approved, reviewer) {
    return getApprovalEngine().approve(proposalId, approved, reviewer);
}
export { ApprovalPolicyEngine };
export default getApprovalEngine;
